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

async function advanceCompetitorStartup(): Promise<void> {
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  stopIntelligenceCrons();
  stopCompetitorMonitoringCron();
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
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledWith(
      'ws_active',
      expect.objectContaining({
        slices: [
          'seoContext',
          'insights',
          'learnings',
          'contentPipeline',
          'siteHealth',
          'clientSignals',
          'operational',
        ],
      }),
    );

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledTimes(2);

    stopIntelligenceCrons();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mocks.buildWorkspaceIntelligence).toHaveBeenCalledTimes(2);
  });

  it('skips competitor cycle entirely on non-Monday', async () => {
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z')); // Tuesday

    mocks.listWorkspaces.mockReturnValue([
      { id: 'ws_1', liveDomain: 'https://example.com', competitorDomains: ['competitor.com'], seoDataProvider: 'dataforseo' },
    ]);

    startCompetitorMonitoringCron();
    await advanceCompetitorStartup();

    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
    expect(mocks.upsertInsight).not.toHaveBeenCalled();
    expect(mocks.deleteStaleInsightsByType).not.toHaveBeenCalled();
  });

  it('cleans stale competitor insights when provider is missing or unconfigured', async () => {
    mocks.listWorkspaces.mockReturnValue([
      { id: 'ws_missing', liveDomain: 'https://a.com', competitorDomains: ['a.org'] },
      { id: 'ws_unconfigured', liveDomain: 'https://b.com', competitorDomains: ['b.org'], seoDataProvider: 'dataforseo' },
    ]);
    mocks.getConfiguredProvider.mockReturnValue({
      isConfigured: () => false,
      getDomainKeywords: vi.fn(),
    });

    startCompetitorMonitoringCron();
    await advanceCompetitorStartup();

    expect(mocks.deleteStaleInsightsByType).toHaveBeenCalledTimes(2);
    expect(mocks.deleteStaleInsightsByType).toHaveBeenCalledWith('ws_missing', 'competitor_alert', expect.any(String));
    expect(mocks.deleteStaleInsightsByType).toHaveBeenCalledWith('ws_unconfigured', 'competitor_alert', expect.any(String));
  });

  it('does not perform stale cleanup when no domains were processed this cycle', async () => {
    const getDomainKeywords = vi.fn().mockResolvedValue([{ keyword: 'seo agency', position: 3, volume: 700 }]);
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws_1',
        liveDomain: 'https://example.com',
        competitorDomains: ['competitor.com'],
        seoDataProvider: 'dataforseo',
      },
    ]);
    mocks.getConfiguredProvider.mockReturnValue({
      isConfigured: () => true,
      getDomainKeywords,
    });
    mocks.snapshotExistsForDate.mockReturnValue(true);

    startCompetitorMonitoringCron();
    await advanceCompetitorStartup();

    expect(getDomainKeywords).not.toHaveBeenCalled();
    expect(mocks.deleteStaleInsightsByType).not.toHaveBeenCalled();
  });

});
