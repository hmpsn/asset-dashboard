/**
 * I1 (review) — `not_acted_on` actions must not feed ANY win surface.
 *
 * Pre-fix, assembleLearnings built topWins / roiAttribution / weCalledIt from the
 * UNFILTERED action list, and getTopWinsFromActions (used by the admin overview/top-wins
 * routes and the client "we called it" route) had no attribution filter. A suggestion the
 * workspace never executed could therefore appear as a "win". An unexecuted suggestion is
 * not a win anywhere.
 *
 * Asserts a `not_acted_on` action carrying a strong_win outcome appears in NONE of
 * topWins / weCalledIt / roiAttribution, while an executed action with the same outcome does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome, getTopWinsForWorkspace } from '../../server/outcome-tracking.js';
import { assembleLearnings } from '../../server/intelligence/learnings-slice.js';
import type { Attribution } from '../../shared/types/outcome-tracking.js';

const WS_ID = 'a1-not-acted-wins-ws';

function seedStrongWin(attribution: Attribution, idx: number): string {
  const action = recordAction({
    workspaceId: WS_ID,
    actionType: 'content_published',
    sourceType: 'post',
    sourceId: `${attribution}-${idx}`,
    pageUrl: `/win-${attribution}-${idx}`,
    targetKeyword: `kw-${idx}`,
    baselineSnapshot: { captured_at: '2026-01-01T00:00:00Z', position: 20, clicks: 5, impressions: 200 },
    attribution,
    sourceFlag: 'live',
    baselineConfidence: 'exact',
  });
  recordOutcome({
    actionId: action.id,
    checkpointDays: 90,
    metricsSnapshot: { captured_at: '2026-04-01T00:00:00Z', position: 2, clicks: 80, impressions: 400 },
    score: 'strong_win',
    deltaSummary: {
      primary_metric: 'position',
      baseline_value: 20,
      current_value: 2,
      delta_absolute: -18,
      delta_percent: -90,
      direction: 'improved',
    },
  });
  return action.id;
}

describe('I1 not_acted_on excluded from win surfaces', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
  });

  afterEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
  });

  it('getTopWinsForWorkspace excludes a not_acted_on strong_win', () => {
    const executedId = seedStrongWin('platform_executed', 1);
    const notActedId = seedStrongWin('not_acted_on', 2);

    const wins = getTopWinsForWorkspace(WS_ID, 10);
    const ids = wins.map(w => w.actionId);

    expect(ids).toContain(executedId);
    expect(ids).not.toContain(notActedId);
  });

  it('assembleLearnings excludes a not_acted_on win from topWins, weCalledIt and roiAttribution', async () => {
    const executedId = seedStrongWin('platform_executed', 1);
    const notActedId = seedStrongWin('not_acted_on', 2);

    const slice = await assembleLearnings(WS_ID);

    expect(slice.topWins.map(w => w.actionId)).toContain(executedId);
    expect(slice.topWins.map(w => w.actionId)).not.toContain(notActedId);

    expect(slice.weCalledIt.map(w => w.actionId)).toContain(executedId);
    expect(slice.weCalledIt.map(w => w.actionId)).not.toContain(notActedId);

    expect(slice.roiAttribution.map(r => r.actionId)).toContain(executedId);
    expect(slice.roiAttribution.map(r => r.actionId)).not.toContain(notActedId);
  });
});
