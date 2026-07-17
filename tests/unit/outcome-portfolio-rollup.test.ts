import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { buildOutcomePortfolioRollup } from '../../server/outcome-portfolio-rollup.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const NOW = new Date('2026-07-17T12:00:00.000Z');
let workspaceId = '';

function addOutcome(
  attribution: 'platform_executed' | 'externally_executed' | 'not_acted_on',
  value: number,
  clicks: number,
  measuredAt: string,
): void {
  const action = recordAction({
    workspaceId,
    actionType: 'content_refreshed',
    sourceType: 'portfolio-unit-test',
    sourceId: `${attribution}-${value}`,
    baselineSnapshot: { captured_at: measuredAt, clicks: 100 },
    attribution,
  });
  const outcome = recordOutcome({
    actionId: action.id,
    checkpointDays: 30,
    metricsSnapshot: { captured_at: measuredAt, clicks: 100 + clicks },
    score: 'win',
    deltaSummary: {
      primary_metric: 'clicks',
      baseline_value: 100,
      current_value: 100 + clicks,
      delta_absolute: clicks,
      delta_percent: clicks,
      direction: 'improved',
    },
    attributedValue: value,
    valueBasis: 'test',
  });
  db.prepare('UPDATE action_outcomes SET measured_at = ? WHERE id = ?').run(measuredAt, outcome.id);
}

beforeAll(() => {
  workspaceId = createWorkspace('Outcome Portfolio Unit').id;
  addOutcome('platform_executed', 1_000, 80, '2026-07-15T12:00:00.000Z');
  addOutcome('externally_executed', 400, 20, '2026-06-15T12:00:00.000Z');
  addOutcome('not_acted_on', 9_000, 999, '2026-07-15T12:00:00.000Z');
  addOutcome('platform_executed', 5_000, 500, '2026-04-17T11:59:59.000Z');
});

afterAll(() => {
  db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(workspaceId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
});

describe('buildOutcomePortfolioRollup', () => {
  it('uses an exact 90-day interval and excludes unexecuted or older wins', () => {
    const rollup = buildOutcomePortfolioRollup(NOW);
    const workspace = rollup.workspaces.find(item => item.workspaceId === workspaceId);

    expect(rollup.window).toEqual({
      days: 90,
      label: 'Last 90 days',
      start: '2026-04-18T12:00:00.000Z',
      endExclusive: '2026-07-17T12:00:00.000Z',
    });
    expect(workspace?.totals).toEqual({ wins: 2, valuePerMonth: 1_400, clicksGained: 100, withValue: 2 });
    expect(workspace?.notActedOnExcluded).toBe(true);
  });

  it('keeps platform agency credit separate from client-side execution', () => {
    const workspace = buildOutcomePortfolioRollup(NOW).workspaces.find(item => item.workspaceId === workspaceId);

    expect(workspace?.attribution.platformExecuted).toEqual({ wins: 1, valuePerMonth: 1_000, clicksGained: 80 });
    expect(workspace?.attribution.externallyExecuted).toEqual({ wins: 1, valuePerMonth: 400, clicksGained: 20 });
  });
});
