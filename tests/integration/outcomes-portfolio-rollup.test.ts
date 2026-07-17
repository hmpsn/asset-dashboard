import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutcomePortfolioRollup } from '../../shared/types/outcome-tracking.js';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let workspaceId = '';

function seedWin(
  attribution: 'platform_executed' | 'externally_executed' | 'not_acted_on',
  attributedValue: number,
  clicksGained: number,
): string {
  const action = recordAction({
    workspaceId,
    actionType: 'content_refreshed',
    sourceType: 'portfolio-rollup-test',
    sourceId: `${attribution}-${attributedValue}`,
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 100 },
    attribution,
  });
  const outcome = recordOutcome({
    actionId: action.id,
    checkpointDays: 30,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 100 + clicksGained },
    score: 'win',
    deltaSummary: {
      primary_metric: 'clicks',
      baseline_value: 100,
      current_value: 100 + clicksGained,
      delta_absolute: clicksGained,
      delta_percent: clicksGained,
      direction: 'improved',
    },
    attributedValue,
    valueBasis: 'test',
  });
  return outcome.id;
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Portfolio Rollup Honesty').id;

  const platformAction = recordAction({
    workspaceId,
    actionType: 'content_refreshed',
    sourceType: 'portfolio-rollup-test',
    sourceId: 'platform-deduplicated',
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 100 },
    attribution: 'platform_executed',
  });
  recordOutcome({
    actionId: platformAction.id,
    checkpointDays: 30,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 140 },
    score: 'win',
    deltaSummary: { primary_metric: 'clicks', baseline_value: 100, current_value: 140, delta_absolute: 40, delta_percent: 40, direction: 'improved' },
    attributedValue: 800,
    valueBasis: 'test',
  });
  recordOutcome({
    actionId: platformAction.id,
    checkpointDays: 60,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 180 },
    score: 'strong_win',
    deltaSummary: { primary_metric: 'clicks', baseline_value: 100, current_value: 180, delta_absolute: 80, delta_percent: 80, direction: 'improved' },
    attributedValue: 1_000,
    valueBasis: 'test',
  });

  seedWin('externally_executed', 400, 20);
  seedWin('not_acted_on', 9_000, 999);
  const oldOutcomeId = seedWin('platform_executed', 5_000, 500);
  db.prepare("UPDATE action_outcomes SET measured_at = datetime('now', '-91 days') WHERE id = ?").run(oldOutcomeId);
}, 60_000);

afterAll(async () => {
  if (workspaceId) {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(workspaceId);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
    deleteWorkspace(workspaceId);
  }
  await ctx.stopServer();
});

describe('GET /api/outcomes/portfolio-rollup', () => {
  it('serves one explicit rolling 90-day window for value, click gains, and wins', async () => {
    const response = await api('/api/outcomes/portfolio-rollup');
    expect(response.status).toBe(200);
    const body = await response.json() as OutcomePortfolioRollup;

    expect(body.window).toMatchObject({ days: 90, label: 'Last 90 days' });
    expect(Date.parse(body.window.endExclusive) - Date.parse(body.window.start)).toBe(90 * 24 * 60 * 60 * 1_000);
    expect(body.totals).toMatchObject({ wins: 2, valuePerMonth: 1_400, clicksGained: 100, withValue: 2 });
  });

  it('excludes not_acted_on and out-of-window wins while separating agency and client-side attribution', async () => {
    const response = await api('/api/outcomes/portfolio-rollup');
    const body = await response.json() as OutcomePortfolioRollup;
    const row = body.workspaces.find(item => item.workspaceId === workspaceId);

    expect(row).toBeDefined();
    expect(row!.totals).toMatchObject({ wins: 2, valuePerMonth: 1_400, clicksGained: 100 });
    expect(row!.attribution.platformExecuted).toEqual({ wins: 1, valuePerMonth: 1_000, clicksGained: 80 });
    expect(row!.attribution.externallyExecuted).toEqual({ wins: 1, valuePerMonth: 400, clicksGained: 20 });
    expect(row!.notActedOnExcluded).toBe(true);
  });

  it('returns explicit zero evidence for workspaces with no measured wins in the window', async () => {
    const emptyWorkspace = createWorkspace('Portfolio Rollup Empty').id;
    try {
      const response = await api('/api/outcomes/portfolio-rollup');
      const body = await response.json() as OutcomePortfolioRollup;
      const row = body.workspaces.find(item => item.workspaceId === emptyWorkspace);

      expect(row).toBeDefined();
      expect(row!.hasMeasuredWins).toBe(false);
      expect(row!.totals).toEqual({ wins: 0, valuePerMonth: 0, clicksGained: 0, withValue: 0 });
    } finally {
      deleteWorkspace(emptyWorkspace);
    }
  });
});
