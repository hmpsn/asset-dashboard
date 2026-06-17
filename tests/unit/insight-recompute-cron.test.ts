import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  flagEnabled: false,
  workspaces: [] as { id: string }[],
  recentActivity: new Map<string, boolean>(),
  insights: new Map<string, { computedAt: string }[]>(),
  stale: true,
  enqueue: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock('../../server/feature-flags.js', () => ({ isFeatureEnabled: () => state.flagEnabled }));
vi.mock('../../server/workspaces.js', () => ({ listWorkspaces: () => state.workspaces }));
vi.mock('../../server/activity-log.js', () => ({ hasRecentActivity: (ws: string) => state.recentActivity.get(ws) ?? false }));
vi.mock('../../server/analytics-insights-store.js', () => ({ getInsights: (ws: string) => state.insights.get(ws) ?? [] }));
vi.mock('../../server/analytics-intelligence.js', () => ({ isStale: () => state.stale }));
vi.mock('../../server/intelligence-recompute-job.js', () => ({ enqueueIntelligenceRecompute: state.enqueue }));

import { runDailyInsightRecompute } from '../../server/insight-recompute-cron.js';

describe('runDailyInsightRecompute (Phase 5c daily cron)', () => {
  beforeEach(() => {
    state.enqueue.mockReset();
    state.flagEnabled = true;
    state.workspaces = [{ id: 'ws1' }];
    state.recentActivity = new Map([['ws1', true]]);
    state.insights = new Map([['ws1', [{ computedAt: '2026-06-15T00:00:00.000Z' }]]]);
    state.stale = true;
  });

  it('kill switch: enqueues nothing when the flag is OFF', async () => {
    state.flagEnabled = false;
    await runDailyInsightRecompute();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('skips workspaces without recent activity (cost gate)', async () => {
    state.recentActivity = new Map([['ws1', false]]);
    await runDailyInsightRecompute();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('skips workspaces whose signals are already fresh (un-forced)', async () => {
    state.stale = false;
    await runDailyInsightRecompute();
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a recompute for an active workspace with stale signals', async () => {
    await runDailyInsightRecompute();
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.enqueue).toHaveBeenCalledWith('ws1');
  });

  it('enqueues only the active+stale workspaces in a mixed set', async () => {
    state.workspaces = [{ id: 'ws1' }, { id: 'ws2' }, { id: 'ws3' }];
    state.recentActivity = new Map([['ws1', true], ['ws2', false], ['ws3', true]]);
    // ws3 has no insight rows → newest undefined → isStale(undefined) path is exercised by the real
    // cron; here isStale is mocked true, so both active workspaces enqueue.
    state.insights = new Map([['ws1', [{ computedAt: '2026-06-15T00:00:00.000Z' }]]]);
    await runDailyInsightRecompute();
    expect(state.enqueue).toHaveBeenCalledTimes(2);
    expect(state.enqueue).toHaveBeenCalledWith('ws1');
    expect(state.enqueue).toHaveBeenCalledWith('ws3');
    expect(state.enqueue).not.toHaveBeenCalledWith('ws2');
  });
});
