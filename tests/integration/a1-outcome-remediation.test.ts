/**
 * I2 (review) — one-time historical-pollution remediation.
 *
 * Two corrupted populations survive A1's go-forward fixes and cannot be recreated
 * correctly by re-running the backfill (the source_type+source_id dedup key blocks it):
 *   (a) recommendation-sourced actions hardcoded to audit_fix_applied by the pre-A1
 *       backfill, whose rec type maps elsewhere;
 *   (b) neutral/loss outcomes whose primary_metric is a phantom (non-BaselineSnapshot) key.
 *
 * Asserts: (a) a seeded mislabeled action gets relabeled to its mapped ActionType; the
 * audit-family rec is left as audit_fix_applied; a rec that no longer exists is left + not
 * relabeled; (b) a seeded phantom-metric loss becomes inconclusive while a real-metric loss
 * is untouched; and that a SECOND run is a no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome, getAction, getOutcomesForAction } from '../../server/outcome-tracking.js';
import { runOutcomeRemediation } from '../../server/outcome-remediation.js';
import { saveRecommendations } from '../../server/recommendations.js';
import type { DeltaSummary } from '../../shared/types/outcome-tracking.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

const WS_ID = 'a1-remediation-ws';

function delta(primaryMetric: string): DeltaSummary {
  return {
    primary_metric: primaryMetric,
    baseline_value: 0,
    current_value: 0,
    delta_absolute: 0,
    delta_percent: 0,
    direction: 'stable',
  };
}

function seedRecActionLabeledAuditFix(sourceId: string): string {
  const action = recordAction({
    workspaceId: WS_ID,
    actionType: 'audit_fix_applied', // the pre-A1 hardcoded label
    sourceType: 'recommendation',
    sourceId,
    pageUrl: '/p',
    targetKeyword: null,
    baselineSnapshot: { captured_at: '2026-01-01T00:00:00Z' },
    sourceFlag: 'backfill',
    baselineConfidence: 'estimated',
    attribution: 'platform_executed',
  });
  return action.id;
}

function seedOutcome(actionId: string, primaryMetric: string, score: 'neutral' | 'loss' | 'win'): string {
  const outcome = recordOutcome({
    actionId,
    checkpointDays: 90,
    metricsSnapshot: { captured_at: '2026-04-01T00:00:00Z' },
    score,
    deltaSummary: delta(primaryMetric),
  });
  return outcome.id;
}

function makeRecommendation(overrides: {
  id: string;
  type: 'content' | 'technical';
  source: string;
}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    workspaceId: WS_ID,
    priority: 'fix_soon',
    type: overrides.type,
    title: 'Recommendation',
    description: 'Recommendation description',
    insight: 'Recommendation insight',
    impact: 'medium',
    effort: 'medium',
    impactScore: 50,
    source: overrides.source,
    affectedPages: ['/p'],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'Improves organic performance',
    actionType: 'manual',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  };
}

describe('I2 outcome remediation', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(WS_ID);
    // R7 cutover: seed via the normalized write path (rows) — loadRecommendationSet reads rows only.
    saveRecommendations({
      workspaceId: WS_ID,
      generatedAt: new Date().toISOString(),
      recommendations: [
        makeRecommendation({ id: 'rec-content', type: 'content', source: 'audit:content' }),
        makeRecommendation({ id: 'rec-tech', type: 'technical', source: 'audit:speed' }),
      ] as Recommendation[],
      summary: {
        fixNow: 0, fixSoon: 2, fixLater: 0, ongoing: 0,
        totalImpactScore: 100, trafficAtRisk: 0,
        totalOpportunityValue: 0, actionableOpportunityValue: 0,
        topRecommendationId: null,
      },
    });
  });

  afterEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(WS_ID);
  });

  it('relabels a mislabeled content action and leaves the audit-family one', () => {
    const contentActionId = seedRecActionLabeledAuditFix('rec-content');
    const techActionId = seedRecActionLabeledAuditFix('rec-tech');

    const res = runOutcomeRemediation();

    expect(res.relabeledActions).toBe(1);
    expect(getAction(contentActionId)!.actionType).toBe('content_published');
    // technical → audit_fix_applied is correct; must NOT be re-labeled.
    expect(getAction(techActionId)!.actionType).toBe('audit_fix_applied');
  });

  it('leaves an action whose rec no longer exists (and does not relabel it)', () => {
    const orphanActionId = seedRecActionLabeledAuditFix('rec-deleted-gone');

    const res = runOutcomeRemediation();

    expect(res.relabeledActions).toBe(0);
    expect(getAction(orphanActionId)!.actionType).toBe('audit_fix_applied');
  });

  it('re-marks a phantom-metric loss as inconclusive but leaves a real-metric loss', () => {
    // Two separate actions — action_outcomes is unique on (action_id, checkpoint_days),
    // so a phantom and a real outcome cannot coexist on one action at the same checkpoint.
    const phantomActionId = seedRecActionLabeledAuditFix('rec-content');
    const realActionId = seedRecActionLabeledAuditFix('rec-tech');
    // brief_created scoring names content_produced (phantom). A pre-fix loss on it was fabricated.
    const phantomId = seedOutcome(phantomActionId, 'content_produced', 'loss');
    const realId = seedOutcome(realActionId, 'position', 'loss'); // a genuine measured loss

    const res = runOutcomeRemediation();

    expect(res.remarkedOutcomes).toBe(1);
    expect(getOutcomesForAction(phantomActionId).find(o => o.id === phantomId)!.score).toBe('inconclusive');
    expect(getOutcomesForAction(realActionId).find(o => o.id === realId)!.score).toBe('loss');
  });

  it('is idempotent — a second run is a no-op', () => {
    const contentActionId = seedRecActionLabeledAuditFix('rec-content');
    seedOutcome(contentActionId, 'click_recovery', 'neutral'); // phantom

    const first = runOutcomeRemediation();
    expect(first.relabeledActions).toBe(1);
    expect(first.remarkedOutcomes).toBe(1);

    const second = runOutcomeRemediation();
    expect(second.relabeledActions).toBe(0);
    expect(second.remarkedOutcomes).toBe(0);
  });
});
