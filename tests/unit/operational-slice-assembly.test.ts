/**
 * Unit tests for server/intelligence/operational-slice.ts
 *
 * Pure unit tests — no DB, no HTTP, no createTestContext.
 * All subsystem imports are mocked at module level; vi.resetAllMocks() + re-apply
 * defaults in beforeEach keeps tests independent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all dynamic imports (module-level) ─────────────────────────────────
// The assembler uses `await import(...)` for every subsystem. vi.mock intercepts
// these at the module graph level so the real modules are never loaded.

vi.mock('../../server/activity-log.js', () => ({
  listActivity: vi.fn(() => []),
  getClientActivitySummary: vi.fn(() => null),
  countActivityByType: vi.fn(() => 0),
}));

vi.mock('../../server/analytics-annotations.js', () => ({
  getAnnotations: vi.fn(() => []),
}));

vi.mock('../../server/annotations.js', () => ({
  listAnnotations: vi.fn(() => []),
}));

vi.mock('../../server/jobs.js', () => ({
  listJobs: vi.fn(() => []),
}));

vi.mock('../../server/usage-tracking.js', () => ({
  getUsageSummary: vi.fn(() => ({})),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ tier: 'free', competitorDomains: [] })),
  computeEffectiveTier: vi.fn(() => 'free'),
}));

vi.mock('../../server/page-edit-states.js', () => ({
  getAllPageStates: vi.fn(() => ({})),
}));

vi.mock('../../server/approvals.js', () => ({
  readApprovalBatchesForIntelligence: vi.fn(() => []),
}));

vi.mock('../../server/client-actions.js', () => ({
  getClientActionQueueStats: vi.fn(() => ({ pending: 0, oldestAge: null })),
}));

vi.mock('../../server/recommendations.js', () => ({
  loadRecommendations: vi.fn(() => null),
  // Faithful mirror of server/recommendations.ts:isActiveRec. The real module
  // imports the DB graph, so it can't be importActual'd in this pure unit test —
  // the active-set predicate is duplicated here. Keep in sync with the source.
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
  getPendingActions: vi.fn(() => []),
}));

vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));

vi.mock('../../server/work-orders.js', () => ({
  listWorkOrders: vi.fn(() => []),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

// ── Import the module under test AFTER mocks are declared ──────────────────
import { assembleOperational } from '../../server/intelligence/operational-slice.js';

// ── Import mocked fns for per-test configuration ───────────────────────────
import { listActivity } from '../../server/activity-log.js';
import { getAnnotations } from '../../server/analytics-annotations.js';
import { listAnnotations } from '../../server/annotations.js';
import { listJobs } from '../../server/jobs.js';
import { getUsageSummary } from '../../server/usage-tracking.js';
import { readApprovalBatchesForIntelligence } from '../../server/approvals.js';
import { getClientActionQueueStats } from '../../server/client-actions.js';
import { loadRecommendations } from '../../server/recommendations.js';
import { getPendingActions } from '../../server/outcome-tracking.js';
import { getPlaybooks } from '../../server/outcome-playbooks.js';
import { listWorkOrders } from '../../server/work-orders.js';
import { getInsights } from '../../server/analytics-insights-store.js';

const WORKSPACE_ID = 'test-ws-operational';

// Helper to reset all mocks to their zero-baseline defaults
function applyZeroDefaults() {
  vi.mocked(listActivity).mockReturnValue([]);
  vi.mocked(getAnnotations).mockReturnValue([]);
  vi.mocked(listAnnotations).mockReturnValue([]);
  vi.mocked(listJobs).mockReturnValue([]);
  vi.mocked(getUsageSummary).mockReturnValue({});
  vi.mocked(readApprovalBatchesForIntelligence).mockReturnValue([]);
  vi.mocked(getClientActionQueueStats).mockReturnValue({ pending: 0, oldestAge: null });
  vi.mocked(loadRecommendations).mockReturnValue(null);
  vi.mocked(getPendingActions).mockReturnValue([]);
  vi.mocked(getPlaybooks).mockReturnValue([]);
  vi.mocked(listWorkOrders).mockReturnValue([]);
  vi.mocked(getInsights).mockReturnValue([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  applyZeroDefaults();
});

// ── 1. Zero-baseline shape ─────────────────────────────────────────────────

describe('assembleOperational — zero baseline', () => {
  it('returns safe zero values for every field when all mocks return empty', async () => {
    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.recentActivity).toEqual([]);
    expect(slice.annotations).toEqual([]);
    expect(slice.pendingJobs).toBe(0);
    expect(slice.timeSaved).toBeNull();
    expect(slice.approvalQueue).toEqual({ pending: 0, oldestAge: null });
    expect(slice.actionBacklog).toEqual({ pendingMeasurement: 0, oldestAge: null });
    expect(slice.recommendationQueue).toEqual({ fixNow: 0, fixSoon: 0, fixLater: 0 });
    expect(slice.workOrders).toEqual({ active: 0, pending: 0 });
    expect(slice.insightAcceptanceRate).toBeNull();
    expect(slice.detectedPlaybooks).toEqual([]);
  });
});

// ── 2. approvalQueue — pending count and oldestAge in HOURS ───────────────

describe('assembleOperational — approvalQueue', () => {
  it('counts pending items and reports oldestAge in hours', async () => {
    const now = Date.now();
    vi.mocked(readApprovalBatchesForIntelligence).mockReturnValue([
      {
        id: 'batch-1',
        workspaceId: WORKSPACE_ID,
        siteId: 'site-1',
        name: 'Batch 1',
        status: 'pending',
        createdAt: new Date(now - 1000).toISOString(),
        updatedAt: new Date(now - 1000).toISOString(),
        items: [
          {
            id: 'item-a',
            pageId: 'p1',
            pageTitle: 'Page A',
            pageSlug: 'page-a',
            field: 'seoTitle',
            currentValue: 'old',
            proposedValue: 'new',
            status: 'pending',
            createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(), // 3 hours old
            updatedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: 'item-b',
            pageId: 'p2',
            pageTitle: 'Page B',
            pageSlug: 'page-b',
            field: 'seoTitle',
            currentValue: 'old',
            proposedValue: 'new',
            status: 'pending',
            createdAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(), // 1 hour old
            updatedAt: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: 'item-c',
            pageId: 'p3',
            pageTitle: 'Page C',
            pageSlug: 'page-c',
            field: 'seoTitle',
            currentValue: 'old',
            proposedValue: 'new',
            status: 'approved', // approved — must not count toward pending or oldestAge
            createdAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(), // 10 hours old
            updatedAt: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.approvalQueue?.pending).toBe(2);
    // oldestAge is in hours (Math.round). Item A is 3 hours old (oldest pending).
    // Item C (10 hours) is approved and must not influence oldestAge.
    expect(slice.approvalQueue?.oldestAge).toBe(3);
  });

  it('returns oldestAge = null when there are no pending items', async () => {
    vi.mocked(readApprovalBatchesForIntelligence).mockReturnValue([
      {
        id: 'batch-2',
        workspaceId: WORKSPACE_ID,
        siteId: 'site-1',
        name: 'Batch 2',
        status: 'approved',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: 'item-d',
            pageId: 'p4',
            pageTitle: 'Page D',
            pageSlug: 'page-d',
            field: 'seoTitle',
            currentValue: 'old',
            proposedValue: 'new',
            status: 'approved',
            createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
            updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.approvalQueue?.pending).toBe(0);
    expect(slice.approvalQueue?.oldestAge).toBeNull();
  });
});

// ── 3. actionBacklog — workspace isolation ─────────────────────────────────

describe('assembleOperational — actionBacklog', () => {
  it('filters getPendingActions by workspaceId (in-memory isolation)', async () => {
    const workspaceA = 'workspace-a-op';
    const workspaceB = 'workspace-b-op';
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    vi.mocked(getPendingActions).mockReturnValue([
      // 2 actions for workspaceA
      {
        id: 'act-1',
        workspaceId: workspaceA,
        actionType: 'meta_updated',
        sourceType: 'insight',
        sourceId: null,
        pageUrl: '/page-1',
        targetKeyword: null,
        baselineSnapshot: { captured_at: twoDaysAgo },
        trailingHistory: { metric: 'clicks', dataPoints: [] },
        attribution: 'platform_executed',
        measurementWindow: 30,
        measurementComplete: false,
        sourceFlag: 'live',
        baselineConfidence: 'exact',
        context: {},
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
      },
      {
        id: 'act-2',
        workspaceId: workspaceA,
        actionType: 'brief_created',
        sourceType: 'manual',
        sourceId: null,
        pageUrl: '/page-2',
        targetKeyword: null,
        baselineSnapshot: { captured_at: oneDayAgo },
        trailingHistory: { metric: 'clicks', dataPoints: [] },
        attribution: 'platform_executed',
        measurementWindow: 30,
        measurementComplete: false,
        sourceFlag: 'live',
        baselineConfidence: 'exact',
        context: {},
        createdAt: oneDayAgo,
        updatedAt: oneDayAgo,
      },
      // 1 action for workspaceB — must be filtered out
      {
        id: 'act-3',
        workspaceId: workspaceB,
        actionType: 'content_published',
        sourceType: 'manual',
        sourceId: null,
        pageUrl: '/page-3',
        targetKeyword: null,
        baselineSnapshot: { captured_at: oneDayAgo },
        trailingHistory: { metric: 'clicks', dataPoints: [] },
        attribution: 'platform_executed',
        measurementWindow: 30,
        measurementComplete: false,
        sourceFlag: 'live',
        baselineConfidence: 'exact',
        context: {},
        createdAt: oneDayAgo,
        updatedAt: oneDayAgo,
      },
    ] as any);

    const slice = await assembleOperational(workspaceA);

    // Only 2 of the 3 pending actions belong to workspaceA
    expect(slice.actionBacklog?.pendingMeasurement).toBe(2);

    // oldestAge is in DAYS. Oldest workspaceA action is 2 days old.
    expect(slice.actionBacklog?.oldestAge).toBe(2);
  });

  it('returns pendingMeasurement = 0 and oldestAge = null when no actions match workspace', async () => {
    vi.mocked(getPendingActions).mockReturnValue([
      {
        id: 'act-other',
        workspaceId: 'other-workspace',
        actionType: 'meta_updated',
        sourceType: 'insight',
        sourceId: null,
        pageUrl: '/page-1',
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        trailingHistory: { metric: 'clicks', dataPoints: [] },
        attribution: 'platform_executed',
        measurementWindow: 30,
        measurementComplete: false,
        sourceFlag: 'live',
        baselineConfidence: 'exact',
        context: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.actionBacklog?.pendingMeasurement).toBe(0);
    expect(slice.actionBacklog?.oldestAge).toBeNull();
  });
});

// ── 4. recommendationQueue — status filtering ──────────────────────────────

describe('assembleOperational — recommendationQueue', () => {
  it('counts pending and undefined-status recommendations by priority bucket', async () => {
    vi.mocked(loadRecommendations).mockReturnValue({
      workspaceId: WORKSPACE_ID,
      generatedAt: new Date().toISOString(),
      summary: { fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0 },
      recommendations: [
        // counted: pending fix_now
        { id: 'r1', workspaceId: WORKSPACE_ID, priority: 'fix_now', type: 'technical', title: 'R1', description: '', insight: '', impact: 'high', effort: 'low', impactScore: 90, source: 'audit', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', actionType: 'manual', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        // counted: undefined status fix_soon
        { id: 'r2', workspaceId: WORKSPACE_ID, priority: 'fix_soon', type: 'content', title: 'R2', description: '', insight: '', impact: 'medium', effort: 'medium', impactScore: 60, source: 'audit', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', actionType: 'manual', status: undefined as any, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        // NOT counted: applied status
        { id: 'r3', workspaceId: WORKSPACE_ID, priority: 'fix_now', type: 'technical', title: 'R3', description: '', insight: '', impact: 'high', effort: 'low', impactScore: 80, source: 'audit', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', actionType: 'manual', status: 'completed' as any, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        // counted: pending fix_later
        { id: 'r4', workspaceId: WORKSPACE_ID, priority: 'fix_later', type: 'content', title: 'R4', description: '', insight: '', impact: 'low', effort: 'high', impactScore: 30, source: 'audit', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', actionType: 'manual', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        // counted as fixLater (unknown priority falls through to else)
        { id: 'r5', workspaceId: WORKSPACE_ID, priority: undefined as any, type: 'content', title: 'R5', description: '', insight: '', impact: 'low', effort: 'high', impactScore: 10, source: 'audit', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', actionType: 'manual', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    } as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.recommendationQueue).toEqual({ fixNow: 1, fixSoon: 1, fixLater: 2 });
  });

  it('returns all zeros when loadRecommendations returns null', async () => {
    vi.mocked(loadRecommendations).mockReturnValue(null);
    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.recommendationQueue).toEqual({ fixNow: 0, fixSoon: 0, fixLater: 0 });
  });
});

// ── 5. insightAcceptanceRate computation ───────────────────────────────────

describe('assembleOperational — insightAcceptanceRate', () => {
  it('computes totalShown, confirmed, dismissed, and rate correctly', async () => {
    vi.mocked(getInsights).mockReturnValue([
      { id: 'i1', resolutionStatus: 'resolved' } as any,
      { id: 'i2', resolutionStatus: 'in_progress' } as any,
      { id: 'i3', resolutionStatus: 'resolved' } as any,
      { id: 'i4', resolutionStatus: 'dismissed' as any } as any, // legacy cast
    ]);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.insightAcceptanceRate).not.toBeNull();
    expect(slice.insightAcceptanceRate?.totalShown).toBe(4);
    // confirmed = resolved (2) + in_progress (1) = 3
    expect(slice.insightAcceptanceRate?.confirmed).toBe(3);
    expect(slice.insightAcceptanceRate?.dismissed).toBe(1);
    expect(slice.insightAcceptanceRate?.rate).toBeCloseTo(0.75, 5);
  });

  it('returns null when getInsights returns an empty array (totalShown = 0 guard)', async () => {
    vi.mocked(getInsights).mockReturnValue([]);
    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.insightAcceptanceRate).toBeNull();
  });

  it('handles insights where all are dismissed — rate = 0', async () => {
    vi.mocked(getInsights).mockReturnValue([
      { id: 'i1', resolutionStatus: 'dismissed' as any } as any,
      { id: 'i2', resolutionStatus: 'dismissed' as any } as any,
    ]);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.insightAcceptanceRate?.confirmed).toBe(0);
    expect(slice.insightAcceptanceRate?.dismissed).toBe(2);
    expect(slice.insightAcceptanceRate?.rate).toBe(0);
  });
});

// ── 6. Annotations merging (analytics + timeline) ─────────────────────────

describe('assembleOperational — annotations merging', () => {
  function makeAnalyticsAnnotations(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `aa-${i}`,
      workspaceId: WORKSPACE_ID,
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      label: `Analytics annotation ${i}`,
      pageUrl: undefined,
    }));
  }

  function makeTimelineAnnotations(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `ta-${i}`,
      workspaceId: WORKSPACE_ID,
      date: `2026-02-${String(i + 1).padStart(2, '0')}`,
      label: `Timeline annotation ${i}`,
    }));
  }

  it('caps analytics annotations at 20 and timeline annotations at 10', async () => {
    vi.mocked(getAnnotations).mockReturnValue(makeAnalyticsAnnotations(25) as any);
    vi.mocked(listAnnotations).mockReturnValue(makeTimelineAnnotations(15) as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.annotations).toHaveLength(30); // 20 analytics + 10 timeline
  });

  it('still appends timeline annotations when analytics throws', async () => {
    vi.mocked(getAnnotations).mockImplementation(() => { throw new Error('analytics down'); });
    vi.mocked(listAnnotations).mockReturnValue(makeTimelineAnnotations(5) as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.annotations).toHaveLength(5);
  });

  it('still includes analytics annotations when timeline throws', async () => {
    vi.mocked(getAnnotations).mockReturnValue(makeAnalyticsAnnotations(5) as any);
    vi.mocked(listAnnotations).mockImplementation(() => { throw new Error('timeline down'); });

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.annotations).toHaveLength(5);
  });

  it('returns empty array when both annotation sources throw', async () => {
    vi.mocked(getAnnotations).mockImplementation(() => { throw new Error('down'); });
    vi.mocked(listAnnotations).mockImplementation(() => { throw new Error('down'); });

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.annotations).toEqual([]);
  });
});

// ── 7. pendingJobs count ────────────────────────────────────────────────────

describe('assembleOperational — pendingJobs', () => {
  it('counts only running and pending jobs, not done or failed', async () => {
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j1', status: 'running', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'j2', status: 'pending', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'j3', status: 'done', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'j4', status: 'error', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.pendingJobs).toBe(2); // running + pending
  });

  it('returns 0 when all jobs are done/error/cancelled', async () => {
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j5', status: 'done', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'j6', status: 'cancelled', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.pendingJobs).toBe(0);
  });
});

// ── 8. Graceful degradation ─────────────────────────────────────────────────

describe('assembleOperational — graceful degradation', () => {
  it('approvalQueue stays at safe zero when the intelligence approval reader throws; rest of slice assembles', async () => {
    vi.mocked(readApprovalBatchesForIntelligence).mockImplementation(() => { throw new Error('db error'); });
    // Give pendingJobs something to verify rest of slice is populated
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j1', status: 'running', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.approvalQueue).toEqual({ pending: 0, oldestAge: null });
    expect(slice.pendingJobs).toBe(1); // rest of slice still ran
  });

  it('actionBacklog stays at safe zero when getPendingActions throws; rest of slice assembles', async () => {
    vi.mocked(getPendingActions).mockImplementation(() => { throw new Error('db error'); });
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j2', status: 'pending', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.actionBacklog).toEqual({ pendingMeasurement: 0, oldestAge: null });
    expect(slice.pendingJobs).toBe(1);
  });

  it('insightAcceptanceRate stays null when getInsights throws; rest of slice assembles', async () => {
    vi.mocked(getInsights).mockImplementation(() => { throw new Error('db error'); });
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j3', status: 'running', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.insightAcceptanceRate).toBeNull();
    expect(slice.pendingJobs).toBe(1);
  });

  it('recommendationQueue stays at zeros when loadRecommendations throws; rest assembles', async () => {
    vi.mocked(loadRecommendations).mockImplementation(() => { throw new Error('store error'); });
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j4', status: 'running', type: 'audit', workspaceId: WORKSPACE_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.recommendationQueue).toEqual({ fixNow: 0, fixSoon: 0, fixLater: 0 });
    expect(slice.pendingJobs).toBe(1);
  });

  it('whole slice returns a valid shape even when all subsystems throw simultaneously', async () => {
    vi.mocked(listActivity).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(getAnnotations).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(listAnnotations).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(listJobs).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(getUsageSummary).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(readApprovalBatchesForIntelligence).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(getClientActionQueueStats).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(loadRecommendations).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(getPendingActions).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(getPlaybooks).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(listWorkOrders).mockImplementation(() => { throw new Error('fail'); });
    vi.mocked(getInsights).mockImplementation(() => { throw new Error('fail'); });

    const slice = await assembleOperational(WORKSPACE_ID);

    // Shape is valid — none of the fields should throw or be undefined unexpectedly
    expect(slice.recentActivity).toEqual([]);
    expect(slice.annotations).toEqual([]);
    expect(slice.pendingJobs).toBe(0);
    expect(slice.timeSaved).toBeNull();
    expect(slice.approvalQueue).toEqual({ pending: 0, oldestAge: null });
    expect(slice.actionBacklog).toEqual({ pendingMeasurement: 0, oldestAge: null });
    expect(slice.recommendationQueue).toEqual({ fixNow: 0, fixSoon: 0, fixLater: 0 });
    expect(slice.workOrders).toEqual({ active: 0, pending: 0 });
    expect(slice.insightAcceptanceRate).toBeNull();
    expect(slice.detectedPlaybooks).toEqual([]);
  });
});

// ── 9. timeSaved computation ────────────────────────────────────────────────

describe('assembleOperational — timeSaved', () => {
  it('computes totalMinutes from usage summary (5 min per use)', async () => {
    vi.mocked(getUsageSummary).mockReturnValue({
      brief_generation: { used: 4 },  // 4 × 5 = 20 min
      post_generation: { used: 2 },   // 2 × 5 = 10 min
    } as any);

    const slice = await assembleOperational(WORKSPACE_ID);

    expect(slice.timeSaved).not.toBeNull();
    expect(slice.timeSaved?.totalMinutes).toBe(30);
    expect(slice.timeSaved?.byFeature).toEqual({
      brief_generation: 20,
      post_generation: 10,
    });
  });

  it('returns timeSaved = null when all usage counts are zero', async () => {
    vi.mocked(getUsageSummary).mockReturnValue({
      brief_generation: { used: 0 },
    } as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.timeSaved).toBeNull();
  });

  it('returns timeSaved = null when usage summary is empty', async () => {
    vi.mocked(getUsageSummary).mockReturnValue({});
    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.timeSaved).toBeNull();
  });
});

// ── 10. workOrders status filtering ────────────────────────────────────────

describe('assembleOperational — workOrders', () => {
  it('counts active (in_progress) and pending work orders correctly', async () => {
    vi.mocked(listWorkOrders).mockReturnValue([
      { id: 'wo1', status: 'in_progress' },
      { id: 'wo2', status: 'in_progress' },
      { id: 'wo3', status: 'pending' },
      { id: 'wo4', status: 'completed' }, // not counted
      { id: 'wo5', status: 'cancelled' }, // not counted
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.workOrders).toEqual({ active: 2, pending: 1 });
  });
});

// ── 11. detectedPlaybooks — capped at 5 ────────────────────────────────────

describe('assembleOperational — detectedPlaybooks', () => {
  it('caps playbooks at 5 and maps names', async () => {
    vi.mocked(getPlaybooks).mockReturnValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `pb-${i}`, name: `Playbook ${i}` })) as any,
    );

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.detectedPlaybooks).toHaveLength(5);
    expect(slice.detectedPlaybooks![0]).toBe('Playbook 0');
  });

  it('excludes playbooks with empty/missing names', async () => {
    vi.mocked(getPlaybooks).mockReturnValue([
      { id: 'pb-1', name: 'Valid Playbook' },
      { id: 'pb-2', name: '' },   // empty string — filtered out
      { id: 'pb-3', name: null }, // null — filtered out
    ] as any);

    const slice = await assembleOperational(WORKSPACE_ID);
    expect(slice.detectedPlaybooks).toEqual(['Valid Playbook']);
  });
});
