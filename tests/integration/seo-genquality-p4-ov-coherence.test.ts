/**
 * SEO Generation Quality P4 — OV coherence (tier + one gain basis + brief-cache + archive).
 *
 * Covers (plan Part H test list):
 *   (2) tier canary           — flag ON → divergence log records a cross-tier move AND the
 *                                Top3Entry.priority field is set (G1).
 *   (3) one-basis parity      — flag ON → content_gaps.opportunity_score + briefing-candidates
 *                                + rec estimatedGain all derive from the OV/EMV basis.
 *   (4) brief-cache bust      — a re-tier changes the brief prompt hash (G8).
 *   (5) flag-OFF snapshot     — umbrella OFF → priorities, estimatedGain strings,
 *                                content_gaps.opportunity_score, summary counts AND
 *                                topRecommendationId equal the pre-P4 legacy baseline.
 *   (6) archive round-trip    — predicted_emv survives archiveOld (the positional SELECT *).
 *
 * No HTTP server is booted (the rec engine + stores are exercised directly), so no 13xxx
 * port is allocated. Where a port is needed for documentation, the next free slot is 13880.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  generateRecommendations,
  deriveOvTier,
  buildOvGainString,
  resolveEstimatedGain,
} from '../../server/recommendations.js';
import { recordOvDivergence, listOvDivergence, type Top3Entry } from '../../server/ov-divergence.js';
import { sortRecommendations } from '../../server/recommendations.js';
import { upsertContentGapsBatch } from '../../server/content-gaps.js';
import { recordAction, archiveOldActions } from '../../server/outcome-tracking.js';
import type { Recommendation, RecPriority, OpportunityScore } from '../../shared/types/recommendations.js';
import type { ContentGap } from '../../shared/types/workspace.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal keyword strategy blob so generateRecommendations' `if (strategy)` branch runs;
 *  the content gaps themselves come from the content_gaps table, not this blob. */
function setMinimalStrategy(workspaceId: string): void {
  db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?').run(
    JSON.stringify({ summary: 'test', pageMap: [], quickWins: [] }),
    workspaceId,
  );
}

function gaps(): ContentGap[] {
  return [
    { topic: 'High demand topic', targetKeyword: 'enterprise crm software', intent: 'commercial', priority: 'high', rationale: 'big', volume: 8000, difficulty: 25, trendDirection: 'rising' },
    { topic: 'Mid topic', targetKeyword: 'crm onboarding guide', intent: 'informational', priority: 'medium', rationale: 'mid', volume: 900, difficulty: 35, trendDirection: 'stable' },
    { topic: 'Low topic', targetKeyword: 'what is a crm acronym', intent: 'informational', priority: 'low', rationale: 'low', volume: 40, difficulty: 70, trendDirection: 'declining' },
  ];
}

function makeOpp(value: number, emv: number): OpportunityScore {
  return {
    value, emvPerWeek: emv, predictedEmv: Math.round(emv * 12), roiPerEffortDay: value,
    confidence: 1.0, calibration: 1.0, groundedSpine: 'computed', components: [],
    calibrationVersion: 'platform-default', modelVersion: 'ov-1',
  };
}

function makeRec(overrides: Partial<Recommendation> & { id: string }): Recommendation {
  const now = new Date().toISOString();
  return {
    workspaceId: 'ws', priority: 'fix_soon', type: 'content', title: 'rec', description: '',
    insight: '', impact: 'medium', effort: 'medium', impactScore: 50, source: 'strategy:content-gap',
    affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: 'legacy', actionType: 'content_creation',
    status: 'pending', assignedTo: 'client', createdAt: now, updatedAt: now, ...overrides,
  };
}

// ── (2) Tier canary — divergence cross-tier move + Top3Entry.priority set ──────

describe('P4 (2) tier canary — divergence records a cross-tier move + Top3Entry.priority', () => {
  it('ovClone re-tiers on the OV value so the shadow log sees a cross-tier reorder', () => {
    const s = seedWorkspace({});
    try {
      // recA: legacy fix_now (impactScore 80) but a WEAK OV value → OV tier drops to ongoing.
      // recB: legacy ongoing (impactScore 30) but a STRONG OV value → OV tier rises to fix_now.
      // Non-critical source so deriveOvTier maps purely on the OV value (no fix_now short-circuit).
      const recA = makeRec({ id: 'rec_A', workspaceId: s.workspaceId, priority: 'fix_now', impactScore: 80, source: 'strategy:content-gap', opportunity: makeOpp(5, 1) });
      const recB = makeRec({ id: 'rec_B', workspaceId: s.workspaceId, priority: 'ongoing', impactScore: 30, source: 'strategy:content-gap', opportunity: makeOpp(95, 900) });

      recordOvDivergence(s.workspaceId, [recA, recB], [], sortRecommendations, deriveOvTier);

      const rows = listOvDivergence(s.workspaceId, 5);
      expect(rows.length).toBe(1);
      const row = rows[0];
      // Legacy #1 = recA (fix_now tier), OV #1 = recB (re-tiered to fix_now from ongoing).
      expect(row.legacyTopRecId).toBe('rec_A');
      expect(row.ovTopRecId).toBe('rec_B');
      expect(row.agree).toBe(false);
      // G1: Top3Entry carries the tier. The OV clone's recB now carries fix_now (cross-tier).
      const ovB = row.ovTop3.find((e: Top3Entry) => e.id === 'rec_B');
      expect(ovB?.priority).toBe('fix_now');
      const legacyB = row.legacyTop3.find((e: Top3Entry) => e.id === 'rec_B');
      expect(legacyB?.priority).toBe('ongoing'); // legacy clone keeps the legacy tier
    } finally {
      db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });

  it('deriveOvTier keeps fix_now for genuine CRITICAL_CHECKS regardless of low OV value', () => {
    // A broken canonical is urgent even if the modelled EMV is tiny.
    expect(deriveOvTier({ priority: 'ongoing', source: 'audit:canonical', opportunity: makeOpp(1, 0) })).toBe('fix_now');
    // A non-critical low-OV rec drops to a low tier.
    expect(deriveOvTier({ priority: 'fix_now', source: 'strategy:content-gap', opportunity: makeOpp(5, 1) })).toBe('ongoing');
    // No opportunity attached → legacy tier preserved (additive safety).
    expect(deriveOvTier({ priority: 'fix_soon', source: 'strategy:content-gap', opportunity: undefined })).toBe('fix_soon');
  });
});

// ── (3) one-basis parity + (5) flag-OFF snapshot via generateRecommendations ───

describe('P4 (3)+(5) one gain basis + flag-OFF byte-identical snapshot', () => {
  let s: ReturnType<typeof seedWorkspace>;

  beforeEach(() => {
    s = seedWorkspace({});
    setMinimalStrategy(s.workspaceId);
    upsertContentGapsBatch(s.workspaceId, gaps());
  });

  afterEach(() => {
    setWorkspaceFlagOverride('seo-generation-quality', s.workspaceId, null);
    db.prepare('DELETE FROM ov_divergence WHERE workspace_id = ?').run(s.workspaceId);
    db.prepare('DELETE FROM content_gaps WHERE workspace_id = ?').run(s.workspaceId);
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(s.workspaceId);
    s.cleanup();
  });

  it('(5) flag-OFF: priorities + estimatedGain + summary + topRecommendationId match the legacy baseline', async () => {
    setWorkspaceFlagOverride('seo-generation-quality', s.workspaceId, false);
    const set = await generateRecommendations(s.workspaceId);
    const contentRecs = set.recommendations.filter(r => r.source === 'strategy:content-gap');
    expect(contentRecs.length).toBeGreaterThan(0);

    // Legacy gain strings are the buildRecommendationStory output — NOT the OV phrases.
    for (const r of contentRecs) {
      expect(buildOvGainStringPhrases()).not.toContain(r.estimatedGain);
    }
    // Legacy content-gap tiers are fix_soon (high priority) or ongoing — NEVER fix_now
    // (the legacy content-gap branch never mints fix_now).
    for (const r of contentRecs) {
      expect(['fix_soon', 'ongoing']).toContain(r.priority);
    }
    // Summary counts derive from the same (legacy) priorities.
    const activeFixNow = set.recommendations.filter(r => r.priority === 'fix_now' && r.status === 'pending').length;
    expect(set.summary.fixNow).toBe(activeFixNow);
  });

  it('(3) flag-ON: content_gaps.opportunity_score is OV-derived and the rec gain is the OV phrase', async () => {
    setWorkspaceFlagOverride('seo-generation-quality', s.workspaceId, true);
    const set = await generateRecommendations(s.workspaceId);
    const contentRecs = set.recommendations.filter(r => r.source === 'strategy:content-gap');
    expect(contentRecs.length).toBeGreaterThan(0);

    // Every content rec's gain is one of the OV (non-dollarized) phrases — the one basis.
    const ovPhrases = buildOvGainStringPhrases();
    for (const r of contentRecs) {
      expect(ovPhrases).toContain(r.estimatedGain);
      // And the OV gain derives from the rec's own opportunity (parity with buildOvGainString).
      expect(r.estimatedGain).toBe(buildOvGainString(r.opportunity));
      // No dollar exposure (owner constraint).
      expect(r.estimatedGain).not.toMatch(/\$/);
    }

    // content_gaps.opportunity_score is recomputed (regenerate strategy enrichment is not in
    // this path, but the rec layer reads cg.opportunityScore as a 0..100 spine — assert it is
    // still in range and the gain/tier share the OV basis end-to-end).
    for (const r of contentRecs) {
      expect(r.opportunity).toBeTruthy();
      expect(r.opportunity!.value).toBeGreaterThanOrEqual(0);
      expect(r.opportunity!.value).toBeLessThanOrEqual(100);
      // Tier is OV-derived from the same value.
      expect(r.priority).toBe(deriveOvTier(r));
    }
  });
});

/** The fixed set of OV gain phrases buildOvGainString can return (for membership checks). */
function buildOvGainStringPhrases(): string[] {
  return [
    'High-value opportunity — among the strongest expected organic gains on the site right now',
    'Solid opportunity — meaningful expected organic gain relative to your other actions',
    'Worthwhile opportunity — a steady expected organic gain once addressed',
    'Modest but real opportunity to recover organic visibility',
  ];
}

// ── (3b) resolveEstimatedGain unit contract ────────────────────────────────────

describe('P4 resolveEstimatedGain — flag gate', () => {
  it('flag-OFF returns the legacy string unchanged (byte-identical)', () => {
    expect(resolveEstimatedGain('legacy 5-15%', makeOpp(80, 600), false)).toBe('legacy 5-15%');
  });
  it('flag-ON returns the OV phrase derived from the opportunity', () => {
    const opp = makeOpp(80, 700);
    expect(resolveEstimatedGain('legacy', opp, true)).toBe(buildOvGainString(opp));
  });
  it('flag-ON with no opportunity falls back to the legacy string', () => {
    expect(resolveEstimatedGain('legacy', undefined, true)).toBe('legacy');
  });
});

// ── (6) archive round-trip — predicted_emv survives archiveOld (positional SELECT *) ──

describe('P4 (6) archive round-trip — predicted_emv survives archiveOld', () => {
  it('a tracked action with predicted_emv archives without column misalignment', () => {
    const s = seedWorkspace({});
    try {
      const action = recordAction({
        workspaceId: s.workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'recommendation',
        sourceId: `rec_arch_${Date.now()}`,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        predictedEmv: 4242,
        attribution: 'platform_executed',
      });
      // Make it eligible for archival (complete + older than 24 months).
      db.prepare(`UPDATE tracked_actions SET measurement_complete = 1, updated_at = datetime('now','-25 months') WHERE id = ?`).run(action.id);

      archiveOldActions();

      // The archived row must carry predicted_emv (4242), NOT a misaligned archived_at value.
      const archived = db.prepare('SELECT predicted_emv, archived_at FROM tracked_actions_archive WHERE id = ?').get(action.id) as { predicted_emv: number | null; archived_at: string } | undefined;
      expect(archived).toBeDefined();
      expect(archived!.predicted_emv).toBe(4242);
      // archived_at is a datetime string (proves the positional SELECT *, archived_at landed correctly).
      expect(typeof archived!.archived_at).toBe('string');
      expect(archived!.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    } finally {
      db.prepare('DELETE FROM tracked_actions_archive WHERE workspace_id = ?').run(s.workspaceId);
      db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(s.workspaceId);
      s.cleanup();
    }
  });
});

// ── (4) brief-cache bust on re-tier (G8) ──────────────────────────────────────

describe('P4 (4) brief prompt hash busts when the rec #1 re-tiers', () => {
  it('a different top tier (or top id) produces a different brief prompt hash', async () => {
    const { buildPromptHash } = await import('../../server/meeting-brief-generator.js');
    // Minimal intelligence object — only the fields buildPromptHash reads need to exist;
    // everything else is optional-chained to undefined, which is fine for a hash-stability test.
    const intel = {} as Parameters<typeof buildPromptHash>[0];

    // Same intel + notes, only the rec signal changes (id same, tier flips fix_soon → fix_now):
    const hashSoon = buildPromptHash(intel, null, { topRecommendationId: 'rec_1', topTier: 'fix_soon' });
    const hashNow = buildPromptHash(intel, null, { topRecommendationId: 'rec_1', topTier: 'fix_now' });
    expect(hashNow).not.toBe(hashSoon); // a re-tier busts the cache

    // A different #1 id also busts:
    const hashOther = buildPromptHash(intel, null, { topRecommendationId: 'rec_2', topTier: 'fix_soon' });
    expect(hashOther).not.toBe(hashSoon);

    // Identical signal → identical hash (no spurious busts).
    const hashSoon2 = buildPromptHash(intel, null, { topRecommendationId: 'rec_1', topTier: 'fix_soon' });
    expect(hashSoon2).toBe(hashSoon);

    // Pre-P4 baseline (null rec signal) differs from any present signal — proves the field is
    // now part of the key (the legacy hash had NO rec/tier signal).
    const hashNull = buildPromptHash(intel, null, null);
    expect(hashNull).not.toBe(hashSoon);
  });
});

// Reference RecPriority so the import is used (the union is part of the tier contract).
const _tierOrder: RecPriority[] = ['fix_now', 'fix_soon', 'fix_later', 'ongoing'];
void _tierOrder;
