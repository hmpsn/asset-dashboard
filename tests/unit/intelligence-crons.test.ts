import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  hasRecentActivity: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  getConfiguredProvider: vi.fn(),
  getLatestCompetitorSnapshot: vi.fn(),
  saveCompetitorSnapshot: vi.fn(),
  detectCompetitorAlerts: vi.fn(),
  saveCompetitorAlerts: vi.fn(),
  snapshotExistsForDate: vi.fn(),
  linkAlertToInsight: vi.fn(),
  upsertInsight: vi.fn(),
  deleteStaleInsightsByType: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/workspaces.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../../server/activity-log.js', () => ({ hasRecentActivity: mocks.hasRecentActivity }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
}));
vi.mock('../../server/seo-data-provider.js', () => ({
  getConfiguredProvider: mocks.getConfiguredProvider,
}));
vi.mock('../../server/competitor-snapshot-store.js', () => ({
  getLatestCompetitorSnapshot: mocks.getLatestCompetitorSnapshot,
  saveCompetitorSnapshot: mocks.saveCompetitorSnapshot,
  detectCompetitorAlerts: mocks.detectCompetitorAlerts,
  saveCompetitorAlerts: mocks.saveCompetitorAlerts,
  snapshotExistsForDate: mocks.snapshotExistsForDate,
  linkAlertToInsight: mocks.linkAlertToInsight,
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  upsertInsight: mocks.upsertInsight,
  deleteStaleInsightsByType: mocks.deleteStaleInsightsByType,
}));

import {
  startCompetitorMonitoringCron,
  startIntelligenceCrons,
  stopCompetitorMonitoringCron,
  stopIntelligenceCrons,
} from '../../server/intelligence-crons.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z')); // Monday
  mocks.listWorkspaces.mockReturnValue([]);
  mocks.hasRecentActivity.mockReturnValue(true);
  mocks.buildWorkspaceIntelligence.mockResolvedValue(undefined);
  mocks.getConfiguredProvider.mockReturnValue({
    isConfigured: () => true,
    getDomainKeywords: vi.fn().mockResolvedValue([]),
  });
  mocks.getLatestCompetitorSnapshot.mockReturnValue(null);
  mocks.saveCompetitorSnapshot.mockReturnValue({ snapshotDate: '2026-05-25' });
  mocks.detectCompetitorAlerts.mockReturnValue([]);
  mocks.snapshotExistsForDate.mockReturnValue(false);
  mocks.upsertInsight.mockReturnValue({ id: 'ins_1' });
});

afterEach(() => {
  stopIntelligenceCrons();
  stopCompetitorMonitoringCron();
  vi.useRealTimers();
});

describe('intelligence crons', () => {
  it('runs refresh for active workspaces and is idempotent on start', async () => {
    mocks.listWorkspaces.mockReturnValue([{ id: 'ws_active' }, { id: 'ws_idle' }]);
    mocks.hasRecentActivity.mockImplementation((id: string) => id === 'ws_active');

    startIntelligenceCrons();
    startIntelligenceCrons();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledTimes(1);
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledWith('ws_active', expect.objectContaining({
      slices: ['seoContext', 'insights', 'learnings', 'contentPipeline', 'siteHealth', 'clientSignals', 'operational'],
    }));

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledTimes(2);

    stopIntelligenceCrons();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledTimes(2);
  });

  it('runs competitor monitoring cycle and writes alerts on Monday', async () => {
    const getDomainKeywords = vi.fn().mockResolvedValue([{ keyword: 'seo agency', position: 3, volume: 700 }]);
    mocks.listWorkspaces.mockReturnValue([{
      id: 'ws_1',
      liveDomain: 'https://example.com',
      competitorDomains: ['competitor.com'],
      seoDataProvider: 'semrush',
    }]);
    mocks.getConfiguredProvider.mockReturnValue({
      isConfigured: () => true,
      getDomainKeywords,
    });
    mocks.getLatestCompetitorSnapshot.mockReturnValue({ snapshotDate: '2026-05-18' });
    mocks.saveCompetitorSnapshot.mockReturnValue({ snapshotDate: '2026-05-25' });
    mocks.detectCompetitorAlerts.mockReturnValue([{
      id: 'alert_1',
      competitorDomain: 'competitor.com',
      alertType: 'ranking_gain',
      keyword: 'seo agency',
      previousPosition: 18,
      currentPosition: 3,
      positionChange: 15,
      volume: 700,
      snapshotDate: '2026-05-25',
      severity: 'high',
    }]);

    startCompetitorMonitoringCron();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(getDomainKeywords).toHaveBeenCalledWith('competitor.com', 'ws_1', 50);
    expect(mocks.upsertInsight).toHaveBeenCalledTimes(1);
    expect(mocks.linkAlertToInsight).toHaveBeenCalledWith('alert_1', 'ins_1', 'ws_1');
    expect(mocks.deleteStaleInsightsByType).toHaveBeenCalledWith('ws_1', 'competitor_alert', expect.any(String));
  });
});
