// tests/slice-orphaned-data.test.ts
// Task 4.2 — Wire orphaned data into intelligence slices
// Tests that buildWorkspaceIntelligence surfaces:
//   (a) page_edit_states status summary in operational slice
//   (b) workspace_metrics_snapshots weekly trend in siteHealth slice
//   (c) competitor_snapshots trend in seoContext slice
//   (d) effective tier + usage remaining in operational slice

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted) ────────────────────────────────────────

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

// ── Operational data source mocks (required to load operational slice) ────

vi.mock('../server/activity-log.js', () => ({
  listActivity: vi.fn(() => []),
}));

vi.mock('../server/recommendations.js', () => ({
  loadRecommendations: vi.fn(() => ({ recommendations: [] })),
}));

vi.mock('../server/jobs.js', () => ({
  listJobs: vi.fn(() => []),
}));

vi.mock('../server/approvals.js', () => ({
  listBatches: vi.fn(() => []),
}));

vi.mock('../server/client-actions.js', () => ({
  getClientActionQueueStats: vi.fn(() => ({ pending: 0, oldestAge: null })),
}));

vi.mock('../server/analytics-annotations.js', () => ({
  getAnnotations: vi.fn(() => []),
}));

vi.mock('../server/annotations.js', () => ({
  listAnnotations: vi.fn(() => []),
}));

vi.mock('../server/work-orders.js', () => ({
  listWorkOrders: vi.fn(() => []),
}));

vi.mock('../server/outcome-tracking.js', () => ({
  getActionsByPage: vi.fn(() => []),
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
  getPendingActions: vi.fn(() => []),
  getTopWinsFromActions: vi.fn(() => []),
}));

vi.mock('../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));

vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));

// ── NEW: page_edit_states mock (Task 4.2a) ────────────────────────────────
vi.mock('../server/page-edit-states.js', () => ({
  getAllPageStates: vi.fn(() => ({
    'page-1': { pageId: 'page-1', status: 'fix-proposed', updatedAt: '2026-05-01T00:00:00Z' },
    'page-2': { pageId: 'page-2', status: 'live', updatedAt: '2026-05-01T00:00:00Z' },
    'page-3': { pageId: 'page-3', status: 'clean', updatedAt: '2026-05-01T00:00:00Z' },
    'page-4': { pageId: 'page-4', status: 'fix-proposed', updatedAt: '2026-05-01T00:00:00Z' },
    'page-5': { pageId: 'page-5', status: 'approved', updatedAt: '2026-05-01T00:00:00Z' },
  })),
}));

// ── NEW: workspace-metrics-snapshots mock (Task 4.2b) ─────────────────────
vi.mock('../server/workspace-metrics-snapshots.js', () => ({
  getSnapshots: vi.fn(() => [
    {
      id: 1, workspaceId: 'ws-1', snapshotDate: '2026-05-26',
      totalClicks: 1500, totalImpressions: 30000, avgPosition: 12.5,
      auditScore: 78, organicTrafficValue: 4500, computedAt: Date.now(),
    },
    {
      id: 2, workspaceId: 'ws-1', snapshotDate: '2026-05-19',
      totalClicks: 1200, totalImpressions: 25000, avgPosition: 14.0,
      auditScore: 75, organicTrafficValue: 3800, computedAt: Date.now(),
    },
    {
      id: 3, workspaceId: 'ws-1', snapshotDate: '2026-05-12',
      totalClicks: 1000, totalImpressions: 22000, avgPosition: 15.5,
      auditScore: 72, organicTrafficValue: 3200, computedAt: Date.now(),
    },
  ]),
}));

// ── NEW: competitor-snapshot-store mock (Task 4.2c) ───────────────────────
vi.mock('../server/competitor-snapshot-store.js', () => ({
  getLatestCompetitorSnapshot: vi.fn((workspaceId: string, domain: string) => {
    if (domain === 'competitor-a.com') {
      return {
        id: 'snap-1', workspaceId, competitorDomain: 'competitor-a.com',
        snapshotDate: '2026-05-26', keywordCount: 450, organicTraffic: 8000,
        topKeywords: [{ keyword: 'seo tools', position: 3, volume: 5000 }],
        createdAt: '2026-05-26T00:00:00Z',
      };
    }
    return null;
  }),
}));

// ── Workspace mock (for tier info — Task 4.2d) ────────────────────────────
vi.mock('../server/workspaces.js', () => ({
  computeEffectiveTier: vi.fn(() => 'growth'),
  getWorkspace: vi.fn(() => ({
    id: 'ws-1', tier: 'growth', trialEndsAt: null, personas: [],
    competitorDomains: ['competitor-a.com', 'competitor-b.com'],
  })),
}));

// ── usage-tracking mock (Task 4.2d) ───────────────────────────────────────
vi.mock('../server/usage-tracking.js', () => ({
  getUsageSummary: vi.fn(() => ({
    ai_chats: { used: 10, limit: 50, remaining: 40 },
    strategy_generations: { used: 1, limit: 3, remaining: 2 },
    alt_text_generations: { used: 0, limit: 3, remaining: 3 },
    workspace_context_generations: { used: 0, limit: 3, remaining: 3 },
    brandscript_generations: { used: 2, limit: 5, remaining: 3 },
    voice_calibrations: { used: 0, limit: 10, remaining: 10 },
  })),
}));

// ── Other required mocks for workspace-intelligence.ts ───────────────────

vi.mock('../server/intelligence/seo-context-source.js', () => ({
  buildEffectiveBrandVoiceBlock: vi.fn(() => ''),
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

// ── SiteHealth mocks (needed for siteHealth slice) ─────────────────────────

vi.mock('../server/reports.js', () => ({
  getLatestSnapshot: vi.fn(() => null),
  getPagespeedReport: vi.fn(() => null),
  getPagespeedReports: vi.fn(() => []),
}));

vi.mock('../server/performance-store.js', () => ({
  getDeadLinks: vi.fn(() => []),
  getRedirectChains: vi.fn(() => []),
}));

vi.mock('../server/redirect-store.js', () => ({
  getRedirectChains: vi.fn(() => []),
}));

vi.mock('../server/site-architecture.js', () => ({
  getOrphanPages: vi.fn(() => []),
  getSiteArchitecture: vi.fn(() => null),
}));

vi.mock('../server/schema-validator.js', () => ({
  getSchemaErrors: vi.fn(() => []),
  getSchemaValidationSummary: vi.fn(() => null),
}));

vi.mock('../server/anomaly-detection.js', () => ({
  getAnomalies: vi.fn(() => []),
}));

vi.mock('../server/seo-change-tracker.js', () => ({
  getSeoChanges: vi.fn(() => []),
  listSeoChanges: vi.fn(() => []),
}));

vi.mock('../server/diagnostic-store.js', () => ({
  listDiagnostics: vi.fn(() => []),
}));

// ── Import types ──────────────────────────────────────────────────────────

import type { OperationalSlice, SiteHealthSlice, SeoContextSlice } from '../shared/types/intelligence.js';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Task 4.2 — Orphaned data wired into intelligence slices', () => {
  beforeEach(async () => {
    const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
    invalidateIntelligenceCache('ws-1');
    vi.clearAllMocks();

    // Re-apply mock defaults after clearAllMocks
    const { getAllPageStates } = await import('../server/page-edit-states.js');
    vi.mocked(getAllPageStates).mockReturnValue({
      'page-1': { pageId: 'page-1', status: 'fix-proposed', updatedAt: '2026-05-01T00:00:00Z' } as any,
      'page-2': { pageId: 'page-2', status: 'live', updatedAt: '2026-05-01T00:00:00Z' } as any,
      'page-3': { pageId: 'page-3', status: 'clean', updatedAt: '2026-05-01T00:00:00Z' } as any,
      'page-4': { pageId: 'page-4', status: 'fix-proposed', updatedAt: '2026-05-01T00:00:00Z' } as any,
      'page-5': { pageId: 'page-5', status: 'approved', updatedAt: '2026-05-01T00:00:00Z' } as any,
    });

    const { getSnapshots } = await import('../server/workspace-metrics-snapshots.js');
    vi.mocked(getSnapshots).mockReturnValue([
      {
        id: 1, workspaceId: 'ws-1', snapshotDate: '2026-05-26',
        totalClicks: 1500, totalImpressions: 30000, avgPosition: 12.5,
        auditScore: 78, organicTrafficValue: 4500, computedAt: Date.now(),
      } as any,
      {
        id: 2, workspaceId: 'ws-1', snapshotDate: '2026-05-19',
        totalClicks: 1200, totalImpressions: 25000, avgPosition: 14.0,
        auditScore: 75, organicTrafficValue: 3800, computedAt: Date.now(),
      } as any,
      {
        id: 3, workspaceId: 'ws-1', snapshotDate: '2026-05-12',
        totalClicks: 1000, totalImpressions: 22000, avgPosition: 15.5,
        auditScore: 72, organicTrafficValue: 3200, computedAt: Date.now(),
      } as any,
    ]);

    const { getLatestCompetitorSnapshot } = await import('../server/competitor-snapshot-store.js');
    vi.mocked(getLatestCompetitorSnapshot).mockImplementation((_workspaceId: string, domain: string) => {
      if (domain === 'competitor-a.com') {
        return {
          id: 'snap-1', workspaceId: 'ws-1', competitorDomain: 'competitor-a.com',
          snapshotDate: '2026-05-26', keywordCount: 450, organicTraffic: 8000,
          topKeywords: [{ keyword: 'seo tools', position: 3, volume: 5000 }],
          createdAt: '2026-05-26T00:00:00Z',
        } as any;
      }
      return null;
    });

    const { computeEffectiveTier } = await import('../server/workspaces.js');
    vi.mocked(computeEffectiveTier).mockReturnValue('growth');

    const { getWorkspace } = await import('../server/workspaces.js');
    vi.mocked(getWorkspace).mockReturnValue({
      id: 'ws-1', tier: 'growth', trialEndsAt: null, personas: [],
      competitorDomains: ['competitor-a.com', 'competitor-b.com'],
    } as any);

    const { getUsageSummary } = await import('../server/usage-tracking.js');
    vi.mocked(getUsageSummary).mockReturnValue({
      ai_chats: { used: 10, limit: 50, remaining: 40 },
      strategy_generations: { used: 1, limit: 3, remaining: 2 },
      alt_text_generations: { used: 0, limit: 3, remaining: 3 },
      workspace_context_generations: { used: 0, limit: 3, remaining: 3 },
      brandscript_generations: { used: 2, limit: 5, remaining: 3 },
      voice_calibrations: { used: 0, limit: 10, remaining: 10 },
    } as any);
  });

  describe('(a) page_edit_states status summary in operational slice', () => {
    it('surfaces pageEditStateSummary with counts by status', async () => {
      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

      expect(result.operational).toBeDefined();
      const op = result.operational as OperationalSlice;
      expect(op.pageEditStateSummary).toBeDefined();
      expect(op.pageEditStateSummary!.total).toBe(5);
      expect(op.pageEditStateSummary!.byStatus['fix-proposed']).toBe(2);
      expect(op.pageEditStateSummary!.byStatus['live']).toBe(1);
      expect(op.pageEditStateSummary!.byStatus['clean']).toBe(1);
      expect(op.pageEditStateSummary!.byStatus['approved']).toBe(1);
    });

    it('returns pageEditStateSummary with total=0 when no page states exist', async () => {
      const { getAllPageStates } = await import('../server/page-edit-states.js');
      vi.mocked(getAllPageStates).mockReturnValue({});

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

      const op = result.operational as OperationalSlice;
      expect(op.pageEditStateSummary).toBeDefined();
      expect(op.pageEditStateSummary!.total).toBe(0);
    });

    it('degrades gracefully if page-edit-states throws', async () => {
      const { getAllPageStates } = await import('../server/page-edit-states.js');
      vi.mocked(getAllPageStates).mockImplementation(() => { throw new Error('table missing'); });

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

      expect(result.operational).toBeDefined();
      // pageEditStateSummary is undefined when the source errors — assembler never throws
      const op = result.operational as OperationalSlice;
      expect(op.pageEditStateSummary).toBeUndefined();
    });
  });

  describe('(b) workspace_metrics_snapshots weekly trend in siteHealth slice', () => {
    it('surfaces weeklyMetricsTrend with latestWeek values and snapshot count', async () => {
      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['siteHealth'] });

      expect(result.siteHealth).toBeDefined();
      const health = result.siteHealth as SiteHealthSlice;
      expect(health.weeklyMetricsTrend).toBeDefined();

      const trend = health.weeklyMetricsTrend!;
      // Most recent snapshot is 2026-05-26 with 1500 clicks
      expect(trend.latestWeek.snapshotDate).toBe('2026-05-26');
      expect(trend.latestWeek.totalClicks).toBe(1500);
      expect(trend.latestWeek.auditScore).toBe(78);

      // The slice exposes only latestWeek + snapshotCount — there is no bestWeek
      // field (best-week anchors are computed elsewhere by findBestWeekSince).
      expect(trend.snapshotCount).toBe(3);
    });

    it('returns no weeklyMetricsTrend when no snapshots exist', async () => {
      const { getSnapshots } = await import('../server/workspace-metrics-snapshots.js');
      vi.mocked(getSnapshots).mockReturnValue([]);

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['siteHealth'] });

      const health = result.siteHealth as SiteHealthSlice;
      expect(health.weeklyMetricsTrend).toBeUndefined();
    });

    it('degrades gracefully if getSnapshots throws', async () => {
      const { getSnapshots } = await import('../server/workspace-metrics-snapshots.js');
      vi.mocked(getSnapshots).mockImplementation(() => { throw new Error('table missing'); });

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['siteHealth'] });

      expect(result.siteHealth).toBeDefined();
      const health = result.siteHealth as SiteHealthSlice;
      expect(health.weeklyMetricsTrend).toBeUndefined();
    });
  });

  describe('(c) competitor_snapshots trend in seoContext slice', () => {
    it('surfaces competitorSnapshots for each tracked domain', async () => {
      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

      expect(result.seoContext).toBeDefined();
      const seo = result.seoContext as SeoContextSlice;
      expect(seo.competitorSnapshots).toBeDefined();
      expect(Array.isArray(seo.competitorSnapshots)).toBe(true);

      // competitor-a.com has data; competitor-b.com returns null (not included)
      expect(seo.competitorSnapshots!.length).toBe(1);
      const snap = seo.competitorSnapshots![0];
      expect(snap.competitorDomain).toBe('competitor-a.com');
      expect(snap.keywordCount).toBe(450);
      expect(snap.organicTraffic).toBe(8000);
    });

    it('returns empty competitorSnapshots when workspace has no competitor domains', async () => {
      const { getWorkspace } = await import('../server/workspaces.js');
      vi.mocked(getWorkspace).mockReturnValue({
        id: 'ws-1', tier: 'growth', trialEndsAt: null, personas: [],
        competitorDomains: [],
      } as any);

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

      const seo = result.seoContext as SeoContextSlice;
      expect(seo.competitorSnapshots).toBeDefined();
      expect(seo.competitorSnapshots!.length).toBe(0);
    });

    it('degrades gracefully if competitor snapshot store throws', async () => {
      const { getLatestCompetitorSnapshot } = await import('../server/competitor-snapshot-store.js');
      vi.mocked(getLatestCompetitorSnapshot).mockImplementation(() => { throw new Error('table missing'); });

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['seoContext'] });

      expect(result.seoContext).toBeDefined();
      const seo = result.seoContext as SeoContextSlice;
      expect(seo.competitorSnapshots).toBeUndefined();
    });
  });

  describe('(d) effective tier + usage remaining in operational slice', () => {
    it('surfaces effectiveTier and usageRemaining', async () => {
      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

      expect(result.operational).toBeDefined();
      const op = result.operational as OperationalSlice;
      expect(op.effectiveTier).toBe('growth');
      expect(op.usageRemaining).toBeDefined();
      expect(op.usageRemaining!.ai_chats).toBe(40);
      expect(op.usageRemaining!.strategy_generations).toBe(2);
    });

    it('surfaces effectiveTier as growth when workspace is in trial', async () => {
      const { computeEffectiveTier } = await import('../server/workspaces.js');
      vi.mocked(computeEffectiveTier).mockReturnValue('growth');

      const { getWorkspace } = await import('../server/workspaces.js');
      vi.mocked(getWorkspace).mockReturnValue({
        id: 'ws-1', tier: 'free',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        personas: [], competitorDomains: [],
      } as any);

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

      const op = result.operational as OperationalSlice;
      expect(op.effectiveTier).toBe('growth');
    });

    it('degrades gracefully if usage-tracking throws', async () => {
      const { getUsageSummary } = await import('../server/usage-tracking.js');
      vi.mocked(getUsageSummary).mockImplementation(() => { throw new Error('table missing'); });

      const { invalidateIntelligenceCache } = await import('../server/workspace-intelligence.js');
      invalidateIntelligenceCache('ws-1');

      const { buildWorkspaceIntelligence } = await import('../server/workspace-intelligence.js');
      const result = await buildWorkspaceIntelligence('ws-1', { slices: ['operational'] });

      expect(result.operational).toBeDefined();
      const op = result.operational as OperationalSlice;
      // effectiveTier still set from workspace lookup; usageRemaining undefined
      expect(op.effectiveTier).toBe('growth');
      expect(op.usageRemaining).toBeUndefined();
    });
  });
});
