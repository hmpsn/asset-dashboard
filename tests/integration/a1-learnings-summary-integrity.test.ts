/**
 * A1 — learnings-summary integrity over a real mixed fixture (in-process DB path).
 *
 * Seeds a workspace with executed wins, an executed loss, and a batch of
 * `not_acted_on` suggestions (which used to be scored as executed). Asserts the
 * computed learnings summary:
 *   - excludes every `not_acted_on` action from the scored denominator
 *   - reflects only the genuinely-executed outcomes (no fabricated loss lines from
 *     unexecuted suggestions)
 *
 * This is the before/after evidence for the PR body: pre-A1 the win rate is diluted
 * by phantom `not_acted_on` rows; post-A1 it reflects only executed work.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { computeWorkspaceLearnings } from '../../server/workspace-learnings.js';
import type { Attribution, OutcomeScore } from '../../shared/types/outcome-tracking.js';

const WS_ID = 'a1-learnings-summary-ws';

function seedScoredAction(attribution: Attribution, score: OutcomeScore, idx: number): void {
  const action = recordAction({
    workspaceId: WS_ID,
    actionType: 'content_published',
    sourceType: 'post',
    sourceId: `${attribution}-${idx}`,
    pageUrl: `/p-${attribution}-${idx}`,
    targetKeyword: `kw-${idx}`,
    baselineSnapshot: { captured_at: '2026-01-01T00:00:00Z', position: 18, clicks: 5, impressions: 200 },
    attribution,
    sourceFlag: 'live',
    baselineConfidence: 'exact',
  });
  recordOutcome({
    actionId: action.id,
    checkpointDays: 90,
    metricsSnapshot: { captured_at: '2026-04-01T00:00:00Z', position: score === 'loss' ? 25 : 4, clicks: score === 'loss' ? 2 : 40, impressions: 300 },
    score,
    deltaSummary: {
      primary_metric: 'position',
      baseline_value: 18,
      current_value: score === 'loss' ? 25 : 4,
      delta_absolute: score === 'loss' ? 7 : -14,
      delta_percent: score === 'loss' ? 39 : -78,
      direction: score === 'loss' ? 'declined' : 'improved',
    },
  });
}

describe('A1 learnings-summary integrity', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
  });

  afterEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
  });

  it('counts only executed actions and excludes not_acted_on from the win rate', () => {
    // 6 executed wins, 0 executed losses → honest 100% win rate.
    for (let i = 0; i < 6; i++) seedScoredAction('platform_executed', 'win', i);
    // 4 not_acted_on suggestions that happen to carry a 'loss' outcome — these must
    // NOT enter the denominator (pre-A1 they would have dragged the win rate to 60%
    // and fabricated 4 loss lines for work never done).
    for (let i = 0; i < 4; i++) seedScoredAction('not_acted_on', 'loss', i);

    const learnings = computeWorkspaceLearnings(WS_ID);

    expect(learnings.totalScoredActions).toBe(6);
    expect(learnings.overall.totalWinRate).toBe(1); // 6/6, no fabricated losses
    // No action-type entry should report a loss-driven win rate below 1.
    for (const t of learnings.overall.topActionTypes) {
      expect(t.winRate).toBe(1);
    }
  });

  it('keeps externally_executed losses (real signal) in the denominator', () => {
    for (let i = 0; i < 4; i++) seedScoredAction('platform_executed', 'win', i);
    for (let i = 0; i < 2; i++) seedScoredAction('externally_executed', 'loss', 100 + i);

    const learnings = computeWorkspaceLearnings(WS_ID);

    // 6 executed (4 win + 2 loss) → 4/6 ≈ 0.67. Externally-executed losses are real.
    expect(learnings.totalScoredActions).toBe(6);
    expect(learnings.overall.totalWinRate).toBeCloseTo(0.67, 1);
  });
});
