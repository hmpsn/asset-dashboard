import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActivity: vi.fn(),
  getAnnotations: vi.fn(),
  listAnnotations: vi.fn(),
  listJobs: vi.fn(),
  getUsageSummary: vi.fn(),
  getWorkspace: vi.fn(),
  computeEffectiveTier: vi.fn(),
  getAllPageStates: vi.fn(),
  listBatches: vi.fn(),
  getClientActionQueueStats: vi.fn(),
  loadRecommendations: vi.fn(),
  getPendingActions: vi.fn(),
  getPlaybooks: vi.fn(),
  listWorkOrders: vi.fn(),
  getInsights: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../server/activity-log.js', () => ({
  listActivity: mocks.listActivity,
}));

vi.mock('../../server/analytics-annotations.js', () => ({
  getAnnotations: mocks.getAnnotations,
}));

vi.mock('../../server/annotations.js', () => ({
  listAnnotations: mocks.listAnnotations,
}));

vi.mock('../../server/jobs.js', () => ({
  listJobs: mocks.listJobs,
}));

vi.mock('../../server/usage-tracking.js', () => ({
  getUsageSummary: mocks.getUsageSummary,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
  computeEffectiveTier: mocks.computeEffectiveTier,
}));

vi.mock('../../server/page-edit-states.js', () => ({
  getAllPageStates: mocks.getAllPageStates,
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: mocks.listBatches,
}));

vi.mock('../../server/client-actions.js', () => ({
  getClientActionQueueStats: mocks.getClientActionQueueStats,
}));

vi.mock('../../server/recommendations.js', () => ({
  loadRecommendations: mocks.loadRecommendations,
  // Faithful mirror of server/recommendations.ts:isActiveRec — the real module pulls the DB graph,
  // so it can't be importActual'd in this pure unit test. Keep in sync with the source (the
  // operational slice routes its rec counter through this predicate per Strategy v3 Lane 1C).
  isActiveRec: (
    rec: { status?: string; lifecycle?: string; throttledUntil?: string; clientStatus?: string },
    now: number = Date.now(),
  ): boolean => {
    if (rec.status === 'completed' || rec.status === 'dismissed') return false;
    if (rec.lifecycle === 'struck') return false;
    if (rec.lifecycle === 'throttled' && rec.throttledUntil && Date.parse(rec.throttledUntil) > now) return false;
    if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'declined') return false;
    return true;
  },
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getPendingActions: mocks.getPendingActions,
}));

vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: mocks.getPlaybooks,
}));

vi.mock('../../server/work-orders.js', () => ({
  listWorkOrders: mocks.listWorkOrders,
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mocks.getInsights,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    debug: mocks.logDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { assembleOperational } = await import('../../server/intelligence/operational-slice.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

  mocks.listActivity.mockReturnValue([
    { type: 'strategy_updated', title: 'Strategy refreshed', createdAt: '2026-05-24T10:00:00.000Z' },
    { type: 'brief_published', description: 'Published client brief', createdAt: '2026-05-23T10:00:00.000Z' },
  ]);

  mocks.getAnnotations.mockReturnValue([
    { date: '2026-05-20', label: 'Algorithm update', pageUrl: '/services' },
  ]);
  mocks.listAnnotations.mockReturnValue([
    { date: '2026-05-22', label: 'Campaign launch' },
  ]);

  mocks.listJobs.mockReturnValue([
    { status: 'pending' },
    { status: 'running' },
    { status: 'completed' },
  ]);

  mocks.getWorkspace.mockReturnValue({ tier: 'growth', competitorDomains: [] });
  mocks.computeEffectiveTier.mockReturnValue('growth');
  mocks.getUsageSummary.mockReturnValue({
    seo_audit: { used: 3, limit: 10, remaining: 7 },
    schema_generation: { used: 0, limit: 10, remaining: 10 },
    keyword_research: { used: 1, limit: 10, remaining: 9 },
  });
  mocks.getAllPageStates.mockReturnValue({
    'page-1': { pageId: 'page-1', status: 'clean', updatedAt: '2026-05-01T00:00:00Z' },
    'page-2': { pageId: 'page-2', status: 'fix-proposed', updatedAt: '2026-05-01T00:00:00Z' },
  });

  mocks.listBatches.mockReturnValue([
    {
      items: [
        { status: 'pending', createdAt: '2026-05-25T10:00:00.000Z' },
        { status: 'approved', createdAt: '2026-05-25T08:00:00.000Z' },
      ],
    },
    {
      items: [
        { status: 'pending', createdAt: '2026-05-25T06:00:00.000Z' },
      ],
    },
  ]);

  mocks.getClientActionQueueStats.mockReturnValue({ pending: 5, oldestAge: 3 });

  mocks.loadRecommendations.mockReturnValue({
    recommendations: [
      { status: 'pending', priority: 'fix_now' },
      { status: 'pending', priority: 'fix_soon' },
      { status: undefined, priority: 'fix_later' },
      // A done fix_now rec must NOT count toward the operational queue. Use a canonical RecStatus
      // ('completed') that isActiveRec excludes — the prior 'applied' was non-canonical and only
      // excluded as a side effect of the old `status === 'pending'` check (Strategy v3 Lane 1C
      // routed this counter through isActiveRec).
      { status: 'completed', priority: 'fix_now' },
    ],
  });

  mocks.getPendingActions.mockReturnValue([
    { workspaceId: 'ws_1', createdAt: '2026-05-10T00:00:00.000Z' },
    { workspaceId: 'ws_2', createdAt: '2026-05-01T00:00:00.000Z' },
    { workspaceId: 'ws_1', createdAt: '2026-05-20T00:00:00.000Z' },
  ]);

  mocks.getPlaybooks.mockReturnValue([
    { name: 'Title testing loop' },
    { name: 'Refresh decayers' },
    { name: '' },
  ]);

  mocks.listWorkOrders.mockReturnValue([
    { status: 'pending' },
    { status: 'in_progress' },
    { status: 'completed' },
    { status: 'in_progress' },
  ]);

  mocks.getInsights.mockReturnValue([
    { resolutionStatus: 'resolved' },
    { resolutionStatus: 'in_progress' },
    { resolutionStatus: 'dismissed' },
    { resolutionStatus: 'new' },
  ]);
});

describe('assembleOperational', () => {
  it('assembles cross-system operational signals into expected shape', async () => {
    const result = await assembleOperational('ws_1');

    expect(result.recentActivity).toEqual([
      {
        type: 'strategy_updated',
        description: 'Strategy refreshed',
        timestamp: '2026-05-24T10:00:00.000Z',
      },
      {
        type: 'brief_published',
        description: 'Published client brief',
        timestamp: '2026-05-23T10:00:00.000Z',
      },
    ]);

    expect(result.annotations).toEqual([
      { date: '2026-05-20', label: 'Algorithm update', pageUrl: '/services' },
      { date: '2026-05-22', label: 'Campaign launch' },
    ]);

    expect(result.pendingJobs).toBe(2);
    expect(result.timeSaved).toEqual({
      totalMinutes: 20,
      byFeature: {
        seo_audit: 15,
        keyword_research: 5,
      },
    });

    expect(result.approvalQueue).toEqual({ pending: 2, oldestAge: 6 });
    expect(result.clientActionQueue).toEqual({ pending: 5, oldestAge: 3 });
    expect(result.recommendationQueue).toEqual({ fixNow: 1, fixSoon: 1, fixLater: 1 });

    expect(result.actionBacklog).toEqual({ pendingMeasurement: 2, oldestAge: 15 });
    expect(result.detectedPlaybooks).toEqual(['Title testing loop', 'Refresh decayers']);
    expect(result.workOrders).toEqual({ active: 2, pending: 1 });

    expect(result.insightAcceptanceRate).toEqual({
      totalShown: 4,
      confirmed: 2,
      dismissed: 1,
      rate: 0.5,
    });

    // New fields (Task 4.2)
    expect(result.effectiveTier).toBe('growth');
    expect(result.usageRemaining).toEqual({
      seo_audit: 7,
      schema_generation: 10,
      keyword_research: 9,
    });
    expect(result.pageEditStateSummary).toEqual({
      total: 2,
      byStatus: { clean: 1, 'fix-proposed': 1 },
    });
  });

  it('degrades gracefully to stable defaults when optional subsystems fail', async () => {
    mocks.listActivity.mockImplementation(() => {
      throw new Error('activity unavailable');
    });
    mocks.getAnnotations.mockImplementation(() => {
      throw new Error('analytics annotations unavailable');
    });
    mocks.listAnnotations.mockImplementation(() => {
      throw new Error('timeline annotations unavailable');
    });
    mocks.listJobs.mockImplementation(() => {
      throw new Error('jobs unavailable');
    });
    mocks.getUsageSummary.mockImplementation(() => {
      throw new Error('usage unavailable');
    });
    mocks.listBatches.mockImplementation(() => {
      throw new Error('approvals unavailable');
    });
    mocks.getClientActionQueueStats.mockImplementation(() => {
      throw new Error('client queue unavailable');
    });
    mocks.loadRecommendations.mockImplementation(() => {
      throw new Error('recommendations unavailable');
    });
    mocks.getPendingActions.mockImplementation(() => {
      throw new Error('pending actions unavailable');
    });
    mocks.getPlaybooks.mockImplementation(() => {
      throw new Error('playbooks unavailable');
    });
    mocks.listWorkOrders.mockImplementation(() => {
      throw new Error('work orders unavailable');
    });
    mocks.getInsights.mockImplementation(() => {
      throw new Error('insight store unavailable');
    });
    mocks.getAllPageStates.mockImplementation(() => {
      throw new Error('page edit states unavailable');
    });

    const result = await assembleOperational('ws_degraded');

    expect(result).toEqual({
      recentActivity: [],
      annotations: [],
      pendingJobs: 0,
      timeSaved: null,
      approvalQueue: { pending: 0, oldestAge: null },
      clientActionQueue: { pending: 0, oldestAge: null },
      recommendationQueue: { fixNow: 0, fixSoon: 0, fixLater: 0 },
      actionBacklog: { pendingMeasurement: 0, oldestAge: null },
      detectedPlaybooks: [],
      workOrders: { active: 0, pending: 0 },
      insightAcceptanceRate: null,
      // New optional fields (Task 4.2):
      // effectiveTier is set before getUsageSummary throws, so it's still populated
      effectiveTier: 'growth',
      // usageRemaining is undefined because getUsageSummary throws before it's set
      usageRemaining: undefined,
      // pageEditStateSummary is undefined because getAllPageStates throws
      pageEditStateSummary: undefined,
    });
    expect(mocks.logDebug).toHaveBeenCalled();
  });

  it('keeps assembled shape even when action timestamps are invalid', async () => {
    mocks.getPendingActions.mockReturnValue([
      { workspaceId: 'ws_1', createdAt: 'not-a-date' },
    ]);

    const result = await assembleOperational('ws_1');

    expect(result.actionBacklog?.pendingMeasurement).toBe(1);
    expect(result.actionBacklog?.oldestAge).toBeNull();
  });
});
