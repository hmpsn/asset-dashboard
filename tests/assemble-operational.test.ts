// tests/assemble-operational.test.ts
// Tests for the operational slice assembler in workspace-intelligence.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before any imports) ─────────────────────

// Mock DB directly — workspace-intelligence.ts uses db.prepare().all() and .get()
vi.mock('../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
  },
}));

vi.mock('../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

// ── Operational data source mocks ─────────────────────────────────────────

vi.mock('../server/activity-log.js', () => ({
  listActivity: vi.fn(() => [
    { id: 'a1', type: 'content', title: 'Brief created', description: 'Test brief', createdAt: '2026-03-30T10:00:00Z' },
  ]),
}));

vi.mock('../server/recommendations.js', () => ({
  loadRecommendations: vi.fn(() => ({
    recommendations: [
      { id: 'r1', priority: 'fix_now', status: 'pending' },
      { id: 'r2', priority: 'fix_soon', status: 'pending' },
      { id: 'r3', priority: 'fix_later', status: 'pending' },
    ],
  })),
}));

vi.mock('../server/jobs.js', () => ({
  listJobs: vi.fn(() => [
    { id: 'j1', status: 'pending', type: 'audit' },
    { id: 'j2', status: 'running', type: 'report' },
    { id: 'j3', status: 'done', type: 'audit' },
  ]),
}));

vi.mock('../server/approvals.js', () => ({
  listBatches: vi.fn(() => [
    {
      id: 'b1',
      items: [
        { id: 'i1', status: 'pending', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
        { id: 'i2', status: 'approved', createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
      ],
    },
  ]),
}));

vi.mock('../server/analytics-annotations.js', () => ({
  getAnnotations: vi.fn(() => [
    { id: 'ann1', date: '2026-03-01', label: 'Traffic spike', pageUrl: '/blog/test' },
    { id: 'ann2', date: '2026-03-15', label: 'Algorithm update' },
  ]),
}));

vi.mock('../server/annotations.js', () => ({
  listAnnotations: vi.fn(() => [
    { id: 'tann1', date: '2026-03-20', label: 'Content refresh' },
  ]),
}));

vi.mock('../server/work-orders.js', () => ({
  listWorkOrders: vi.fn(() => [
    { id: 'wo1', status: 'in_progress' },
    { id: 'wo2', status: 'in_progress' },
    { id: 'wo3', status: 'pending' },
    { id: 'wo4', status: 'completed' },
  ]),
}));

vi.mock('../server/outcome-tracking.js', () => ({
  getPendingActions: vi.fn(() => [
    { id: 'pa1', workspaceId: 'ws-1', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'pa2', workspaceId: 'ws-1', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'pa3', workspaceId: 'ws-other', createdAt: new Date().toISOString() },
  ]),
}));

vi.mock('../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => [
    { id: 'pb1', pattern: 'internal-link-boost', name: 'Internal Link Boost' },
    { id: 'pb2', pattern: 'title-refresh', name: 'Title Refresh' },
    { id: 'pb3', name: 'Schema Markup', pattern: 'schema-markup' },
  ]),
}));

vi.mock('../server/usage-tracking.js', () => ({
  getUsageSummary: vi.fn(() => ({
    briefs: { used: 5, limit: 10 },
    audits: { used: 3, limit: 10 },
    reports: { used: 0, limit: 10 },
  })),
}));

vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => [
    { id: 'ins1', resolutionStatus: 'resolved', insightType: 'traffic_drop', severity: 'warning', impactScore: 70 },
    { id: 'ins2', resolutionStatus: 'in_progress', insightType: 'keyword_opportunity', severity: 'opportunity', impactScore: 60 },
    { id: 'ins3', resolutionStatus: 'dismissed', insightType: 'backlink_gap', severity: 'warning', impactScore: 50 },
    { id: 'ins4', resolutionStatus: 'open', insightType: 'traffic_drop', severity: 'critical', impactScore: 90 },
  ]),
}));

vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-1', tier: 'growth', personas: [] })),
}));

// ── Mocks for other slices used by workspace-intelligence.ts ──────────────

vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({
    strategy: null,
    brandVoiceBlock: '',
    businessContext: '',
    knowledgeBlock: '',
  })),
  getRawBrandVoice: vi.fn(() => ''),
  getRawKnowledge: vi.fn(() => ''),
}));

vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => null),
}));

vi.mock('../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../server/ws-events.js', () => ({
  WS_EVENTS: { INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated' },
}));

vi.mock('../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: vi.fn(),
  debouncedAnomalyBoost: vi.fn(),
  withWorkspaceLock: vi.fn(),
}));

vi.mock('../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import type { OperationalSlice } from '../shared/types/intelligence.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('assembleOperational', () => {
  beforeEach(async () => {
    // Invalidate LRU cache so each test starts fresh
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
    vi.clearAllMocks();

    // Re-apply default mock implementations after clearAllMocks
    const { listActivity } = await import('../server/activity-log.js');
    vi.mocked(listActivity).mockReturnValue([
      { id: 'a1', type: 'content', title: 'Brief created', description: 'Test brief', createdAt: '2026-03-30T10:00:00Z' } as any,
    ]);

    const { loadRecommendations } = await import('../server/recommendations.js');
    vi.mocked(loadRecommendations).mockReturnValue({
      recommendations: [
        { id: 'r1', priority: 'fix_now', status: 'pending' },
        { id: 'r2', priority: 'fix_soon', status: 'pending' },
        { id: 'r3', priority: 'fix_later', status: 'pending' },
      ],
    } as any);

    const { listJobs } = await import('../server/jobs.js');
    vi.mocked(listJobs).mockReturnValue([
      { id: 'j1', status: 'pending', type: 'audit' } as any,
      { id: 'j2', status: 'running', type: 'report' } as any,
      { id: 'j3', status: 'done', type: 'audit' } as any,
    ]);

    const { listBatches } = await import('../server/approvals.js');
    vi.mocked(listBatches).mockReturnValue([
      {
        id: 'b1',
        items: [
          { id: 'i1', status: 'pending', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
          { id: 'i2', status: 'approved', createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
        ],
      } as any,
    ]);

    const { getAnnotations } = await import('../server/analytics-annotations.js');
    vi.mocked(getAnnotations).mockReturnValue([
      { id: 'ann1', date: '2026-03-01', label: 'Traffic spike', pageUrl: '/blog/test' } as any,
      { id: 'ann2', date: '2026-03-15', label: 'Algorithm update' } as any,
    ]);

    const { listAnnotations } = await import('../server/annotations.js');
    vi.mocked(listAnnotations).mockReturnValue([
      { id: 'tann1', date: '2026-03-20', label: 'Content refresh' } as any,
    ]);

    const { listWorkOrders } = await import('../server/work-orders.js');
    vi.mocked(listWorkOrders).mockReturnValue([
      { id: 'wo1', status: 'in_progress' } as any,
      { id: 'wo2', status: 'in_progress' } as any,
      { id: 'wo3', status: 'pending' } as any,
      { id: 'wo4', status: 'completed' } as any,
    ]);

    const { getPendingActions } = await import('../server/outcome-tracking.js');
    vi.mocked(getPendingActions).mockReturnValue([
      { id: 'pa1', workspaceId: 'ws-1', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() } as any,
      { id: 'pa2', workspaceId: 'ws-1', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() } as any,
      { id: 'pa3', workspaceId: 'ws-other', createdAt: new Date().toISOString() } as any,
    ]);

    const { getPlaybooks } = await import('../server/outcome-playbooks.js');
    vi.mocked(getPlaybooks).mockReturnValue([
      { id: 'pb1', pattern: 'internal-link-boost', name: 'Internal Link Boost' } as any,
      { id: 'pb2', pattern: 'title-refresh', name: 'Title Refresh' } as any,
      { id: 'pb3', name: 'Schema Markup', pattern: 'schema-markup' } as any,
    ]);

    const { getUsageSummary } = await import('../server/usage-tracking.js');
    vi.mocked(getUsageSummary).mockReturnValue({
      briefs: { used: 5, limit: 10 },
      audits: { used: 3, limit: 10 },
      reports: { used: 0, limit: 10 },
    } as any);

    const { getInsights } = await import('../server/analytics-insights-store.js');
    vi.mocked(getInsights).mockReturnValue([
      { id: 'ins1', resolutionStatus: 'resolved', insightType: 'traffic_drop', severity: 'warning', impactScore: 70 } as any,
      { id: 'ins2', resolutionStatus: 'in_progress', insightType: 'keyword_opportunity', severity: 'opportunity', impactScore: 60 } as any,
      { id: 'ins3', resolutionStatus: 'dismissed', insightType: 'backlink_gap', severity: 'warning', impactScore: 50 } as any,
      { id: 'ins4', resolutionStatus: 'open', insightType: 'traffic_drop', severity: 'critical', impactScore: 90 } as any,
    ]);

    const { getWorkspace } = await import('../server/workspaces.js');
    vi.mocked(getWorkspace).mockReturnValue({ id: 'ws-1', tier: 'growth', personas: [] } as any);
  });

  it('returns all required fields with default data sources', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    expect(result.operational).toBeDefined();
    const op = result.operational as OperationalSlice;

    // Required fields
    expect(op).toHaveProperty('recentActivity');
    expect(op).toHaveProperty('annotations');
    expect(op).toHaveProperty('pendingJobs');
    expect(op).toHaveProperty('timeSaved');
    expect(op).toHaveProperty('approvalQueue');
    expect(op).toHaveProperty('recommendationQueue');
    expect(op).toHaveProperty('actionBacklog');
    expect(op).toHaveProperty('detectedPlaybooks');
    expect(op).toHaveProperty('workOrders');
    expect(op).toHaveProperty('insightAcceptanceRate');
  });

  it('returns correct recentActivity from activity log', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.recentActivity.length).toBe(1);
    expect(op.recentActivity[0].type).toBe('content');
    expect(op.recentActivity[0].description).toBe('Brief created');
    expect(op.recentActivity[0].timestamp).toBe('2026-03-30T10:00:00Z');
  });

  it('merges annotations from both sources', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    // 2 from analytics-annotations + 1 from annotations
    expect(op.annotations.length).toBe(3);
    const labels = op.annotations.map(a => a.label);
    expect(labels).toContain('Traffic spike');
    expect(labels).toContain('Algorithm update');
    expect(labels).toContain('Content refresh');
  });

  it('analytics annotations do not include pageUrl (not in AnalyticsAnnotation interface)', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    // AnalyticsAnnotation has: id, workspaceId, date, label, category, createdBy, createdAt — no pageUrl
    const trafficSpike = op.annotations.find(a => a.label === 'Traffic spike');
    expect(trafficSpike).toBeDefined();
    expect(trafficSpike?.pageUrl).toBeUndefined();
  });

  it('counts pending and running jobs as pendingJobs', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    // j1=pending, j2=running counted; j3=done not counted
    expect(op.pendingJobs).toBe(2);
  });

  it('computes timeSaved from usage tracking', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    // briefs: 5 * 5 = 25 min, audits: 3 * 5 = 15 min, reports: 0 * 5 = 0 min
    expect(op.timeSaved).not.toBeNull();
    expect(op.timeSaved?.totalMinutes).toBe(40);
    expect(op.timeSaved?.byFeature.briefs).toBe(25);
    expect(op.timeSaved?.byFeature.audits).toBe(15);
    expect(op.timeSaved?.byFeature).not.toHaveProperty('reports'); // 0 not included
  });

  it('computes approvalQueue with pending count and oldest age', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.approvalQueue?.pending).toBe(1);
    expect(op.approvalQueue?.oldestAge).not.toBeNull();
    // The oldest pending item was created ~2 hours ago, so oldestAge rounds to ~2h
    expect(typeof op.approvalQueue?.oldestAge).toBe('number');
  });

  it('counts recommendations by priority in recommendationQueue', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.recommendationQueue?.fixNow).toBe(1);
    expect(op.recommendationQueue?.fixSoon).toBe(1);
    expect(op.recommendationQueue?.fixLater).toBe(1);
  });

  it('filters actionBacklog to current workspace only', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    // pa1 and pa2 are ws-1; pa3 is ws-other
    expect(op.actionBacklog?.pendingMeasurement).toBe(2);
    expect(op.actionBacklog?.oldestAge).not.toBeNull();
    expect(op.actionBacklog?.oldestAge).toBe(3);
  });

  it('returns detectedPlaybooks from outcome-playbooks', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.detectedPlaybooks).toBeDefined();
    expect(Array.isArray(op.detectedPlaybooks)).toBe(true);
    expect(op.detectedPlaybooks?.length).toBe(3);
    expect(op.detectedPlaybooks).toContain('Internal Link Boost');
    expect(op.detectedPlaybooks).toContain('Title Refresh');
    expect(op.detectedPlaybooks).toContain('Schema Markup');
  });

  it('counts workOrders by status', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.workOrders?.active).toBe(2);
    expect(op.workOrders?.pending).toBe(1);
  });

  it('computes insightAcceptanceRate from insight resolutions', async () => {
    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.insightAcceptanceRate).not.toBeNull();
    // 4 total insights: 1 resolved + 1 in_progress = 2 confirmed, 1 dismissed
    expect(op.insightAcceptanceRate?.totalShown).toBe(4);
    expect(op.insightAcceptanceRate?.confirmed).toBe(2);
    expect(op.insightAcceptanceRate?.dismissed).toBe(1);
    expect(op.insightAcceptanceRate?.rate).toBeCloseTo(0.5);
  });

  it('returns sensible defaults when all sources are empty', async () => {
    const { listActivity } = await import('../server/activity-log.js');
    const { loadRecommendations } = await import('../server/recommendations.js');
    const { listJobs } = await import('../server/jobs.js');
    const { listBatches } = await import('../server/approvals.js');
    const { getAnnotations } = await import('../server/analytics-annotations.js');
    const { listAnnotations } = await import('../server/annotations.js');
    const { listWorkOrders } = await import('../server/work-orders.js');
    const { getPendingActions } = await import('../server/outcome-tracking.js');
    const { getPlaybooks } = await import('../server/outcome-playbooks.js');
    const { getUsageSummary } = await import('../server/usage-tracking.js');
    const { getInsights } = await import('../server/analytics-insights-store.js');

    vi.mocked(listActivity).mockReturnValue([]);
    vi.mocked(loadRecommendations).mockReturnValue({ recommendations: [] } as any);
    vi.mocked(listJobs).mockReturnValue([]);
    vi.mocked(listBatches).mockReturnValue([]);
    vi.mocked(getAnnotations).mockReturnValue([]);
    vi.mocked(listAnnotations).mockReturnValue([]);
    vi.mocked(listWorkOrders).mockReturnValue([]);
    vi.mocked(getPendingActions).mockReturnValue([]);
    vi.mocked(getPlaybooks).mockReturnValue([]);
    vi.mocked(getUsageSummary).mockReturnValue({} as any);
    vi.mocked(getInsights).mockReturnValue([]);

    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;

    expect(op.recentActivity).toEqual([]);
    expect(op.annotations).toEqual([]);
    expect(op.pendingJobs).toBe(0);
    expect(op.timeSaved).toBeNull();
    expect(op.approvalQueue?.pending).toBe(0);
    expect(op.approvalQueue?.oldestAge).toBeNull();
    expect(op.recommendationQueue?.fixNow).toBe(0);
    expect(op.recommendationQueue?.fixSoon).toBe(0);
    expect(op.recommendationQueue?.fixLater).toBe(0);
    expect(op.actionBacklog?.pendingMeasurement).toBe(0);
    expect(op.actionBacklog?.oldestAge).toBeNull();
    expect(op.detectedPlaybooks).toEqual([]);
    expect(op.workOrders?.active).toBe(0);
    expect(op.workOrders?.pending).toBe(0);
    expect(op.insightAcceptanceRate).toBeNull();
  });

  it('is resilient to errors in individual data sources', async () => {
    const { listActivity } = await import('../server/activity-log.js');
    const { listJobs } = await import('../server/jobs.js');
    const { getPlaybooks } = await import('../server/outcome-playbooks.js');

    vi.mocked(listActivity).mockImplementation(() => { throw new Error('DB error'); });
    vi.mocked(listJobs).mockImplementation(() => { throw new Error('Jobs table missing'); });
    vi.mocked(getPlaybooks).mockImplementation(() => { throw new Error('Playbooks error'); });

    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    // Should not throw — errors are caught per source
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    expect(result.operational).toBeDefined();
    const op = result.operational as OperationalSlice;
    expect(op.recentActivity).toEqual([]);
    expect(op.pendingJobs).toBe(0);
    expect(op.detectedPlaybooks).toEqual([]);
    // Other sources should still work
    expect(op.recommendationQueue?.fixNow).toBe(1);
  });

  it('does not include insightAcceptanceRate when no insights exist', async () => {
    const { getInsights } = await import('../server/analytics-insights-store.js');
    vi.mocked(getInsights).mockReturnValue([]);

    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');

    const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
    const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

    const op = result.operational as OperationalSlice;
    expect(op.insightAcceptanceRate).toBeNull();
  });
});
