import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  isGlobalConnected: vi.fn(() => false),
  buildAdminChatIntelligenceContext: vi.fn(),
  getSearchOverview: vi.fn(),
  getSearchPeriodComparison: vi.fn(),
  getSearchDeviceBreakdown: vi.fn(),
  getSearchCountryBreakdown: vi.fn(),
  getGA4Overview: vi.fn(),
  getGA4PeriodComparison: vi.fn(),
  getGA4TopPages: vi.fn(),
  getGA4TopSources: vi.fn(),
  getGA4OrganicOverview: vi.fn(),
  getGA4NewVsReturning: vi.fn(),
  getGA4Conversions: vi.fn(),
  getGA4LandingPages: vi.fn(),
}));

vi.mock('../../server/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/workspaces.js')>();
  return { ...actual, getWorkspace: mocks.getWorkspace };
});

vi.mock('../../server/google-auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/google-auth.js')>();
  return { ...actual, isGlobalConnected: mocks.isGlobalConnected };
});

vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getSearchOverview: mocks.getSearchOverview,
    getSearchPeriodComparison: mocks.getSearchPeriodComparison,
    getSearchDeviceBreakdown: mocks.getSearchDeviceBreakdown,
    getSearchCountryBreakdown: mocks.getSearchCountryBreakdown,
  };
});

vi.mock('../../server/google-analytics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/google-analytics.js')>();
  return {
    ...actual,
    getGA4Overview: mocks.getGA4Overview,
    getGA4PeriodComparison: mocks.getGA4PeriodComparison,
    getGA4TopPages: mocks.getGA4TopPages,
    getGA4TopSources: mocks.getGA4TopSources,
    getGA4OrganicOverview: mocks.getGA4OrganicOverview,
    getGA4NewVsReturning: mocks.getGA4NewVsReturning,
    getGA4Conversions: mocks.getGA4Conversions,
    getGA4LandingPages: mocks.getGA4LandingPages,
  };
});

vi.mock('../../server/intelligence/admin-chat-context-builder.js', () => ({
  buildAdminChatIntelligenceContext: mocks.buildAdminChatIntelligenceContext,
}));

const emptyIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-provider-context',
  assembledAt: '2026-07-11T00:00:00.000Z',
};

const workspace = {
  id: 'ws-provider-context',
  name: 'Provider Context',
  folder: 'provider-context',
  createdAt: '2026-07-11T00:00:00.000Z',
  tier: 'free' as const,
  webflowSiteId: 'site-scoped-gsc',
  gscPropertyUrl: 'sc-domain:site-scoped.test',
  ga4PropertyId: 'properties/local-fixture',
};

describe('admin chat provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isGlobalConnected.mockReturnValue(false);
    mocks.getWorkspace.mockReturnValue(workspace);
    mocks.buildAdminChatIntelligenceContext.mockResolvedValue({
      intelligence: emptyIntelligence,
      workspaceContextBlock: '',
      learningsBlock: '',
      dataSources: [],
    });

    mocks.getSearchOverview.mockResolvedValue({
      dateRange: { start: '2026-06-12', end: '2026-07-09' },
      totalClicks: 42,
      totalImpressions: 900,
      avgCtr: 4.7,
      avgPosition: 8.2,
      topQueries: [],
      topPages: [],
    });
    mocks.getSearchPeriodComparison.mockResolvedValue({ clicksChange: 12 });
    mocks.getSearchDeviceBreakdown.mockResolvedValue([{ device: 'DESKTOP', clicks: 30 }]);
    mocks.getSearchCountryBreakdown.mockResolvedValue([{ country: 'USA', clicks: 38 }]);

    mocks.getGA4Overview.mockResolvedValue({ totalUsers: 120, totalSessions: 180 });
    mocks.getGA4PeriodComparison.mockResolvedValue({ sessionsChange: 8 });
    mocks.getGA4TopPages.mockResolvedValue([{ path: '/', sessions: 80 }]);
    mocks.getGA4TopSources.mockResolvedValue([{ source: 'google', sessions: 100 }]);
    mocks.getGA4OrganicOverview.mockResolvedValue({ organicSessions: 95 });
    mocks.getGA4NewVsReturning.mockResolvedValue({ newUsers: 70, returningUsers: 50 });
    mocks.getGA4Conversions.mockResolvedValue([{ eventName: 'generate_lead', conversions: 4 }]);
    mocks.getGA4LandingPages.mockResolvedValue([{ path: '/', sessions: 75 }]);
  });

  it('calls canonical GSC wrappers for a configured site when no global token is connected', async () => {
    const { assembleAdminContext } = await import('../../server/admin-chat-context.js');

    const result = await assembleAdminContext(workspace.id, 'Show GSC clicks and impressions');

    expect(mocks.isGlobalConnected).not.toHaveBeenCalled();
    expect(mocks.getSearchOverview).toHaveBeenCalledWith(
      workspace.webflowSiteId,
      workspace.gscPropertyUrl,
      28,
    );
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalled();
    expect(result.sections.some(section => section.startsWith('GOOGLE SEARCH CONSOLE'))).toBe(true);
  });

  it('calls canonical GA4 wrappers so deterministic local properties can resolve without a global token', async () => {
    const { assembleAdminContext } = await import('../../server/admin-chat-context.js');

    const result = await assembleAdminContext(workspace.id, 'What does GA4 show for sessions?');

    expect(mocks.isGlobalConnected).not.toHaveBeenCalled();
    expect(mocks.getGA4Overview).toHaveBeenCalledWith(workspace.ga4PropertyId, 28);
    expect(mocks.getGA4LandingPages).toHaveBeenCalledWith(workspace.ga4PropertyId, 28);
    expect(result.sections.some(section => section.startsWith('GOOGLE ANALYTICS 4 OVERVIEW'))).toBe(true);
  });

  it('degrades gracefully when configured provider reads are unavailable', async () => {
    mocks.getSearchOverview.mockRejectedValue(new Error('site token expired'));
    mocks.getSearchPeriodComparison.mockRejectedValue(new Error('site token expired'));
    mocks.getSearchDeviceBreakdown.mockRejectedValue(new Error('site token expired'));
    mocks.getSearchCountryBreakdown.mockRejectedValue(new Error('site token expired'));
    const { assembleAdminContext } = await import('../../server/admin-chat-context.js');

    const result = await assembleAdminContext(workspace.id, 'Show GSC clicks and impressions');

    expect(result.sections.some(section => section.startsWith('GOOGLE SEARCH CONSOLE'))).toBe(false);
    expect(result.mode).toBe('analyst');
  });
});
