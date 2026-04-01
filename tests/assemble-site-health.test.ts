// tests/assemble-site-health.test.ts
// Tests for the siteHealth slice assembler in workspace-intelligence.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before any imports) ─────────────────────

vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));

vi.mock('../server/reports.js', () => ({
  getLatestSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
}));

vi.mock('../server/performance-store.js', () => ({
  getPageSpeed: vi.fn(),
  getLinkCheck: vi.fn(),
}));

vi.mock('../server/redirect-store.js', () => ({
  getRedirectSnapshot: vi.fn(),
}));

vi.mock('../server/anomaly-detection.js', () => ({
  listAnomalies: vi.fn(),
}));

vi.mock('../server/seo-change-tracker.js', () => ({
  getSeoChanges: vi.fn(),
}));

vi.mock('../server/site-architecture.js', () => ({
  getCachedArchitecture: vi.fn(),
  flattenTree: vi.fn(),
}));

vi.mock('../server/schema-validator.js', () => ({
  getValidations: vi.fn(),
}));

vi.mock('../server/aeo-page-review.js', () => ({
  reviewSitePages: vi.fn(),
}));

vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('../server/intelligence-cache.js', () => {
  class MockLRUCache {
    get() { return null; }
    set() { /* noop */ }
    deleteByPrefix() { return 0; }
    stats() { return {}; }
  }
  return {
    LRUCache: MockLRUCache,
    singleFlight: (_key: string, fn: () => unknown) => fn(),
  };
});

vi.mock('../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: vi.fn(),
  debouncedAnomalyBoost: vi.fn(),
  withWorkspaceLock: vi.fn(),
}));

vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn().mockReturnValue({
    strategy: undefined,
    brandVoiceBlock: '',
    businessContext: '',
    knowledgeBlock: '',
  }),
}));

vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn().mockReturnValue([]),
}));

vi.mock('../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn().mockReturnValue(null),
}));

vi.mock('../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn().mockReturnValue([]),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import type { SiteHealthSlice } from '../shared/types/intelligence.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockWorkspace(overrides = {}) {
  return {
    id: 'ws-1',
    name: 'Test Site',
    webflowSiteId: 'site-abc',
    ...overrides,
  };
}

function makeMockSnapshot(scoreOverride = 85, prevScore: number | undefined = 80) {
  return {
    id: 'snap-1',
    siteId: 'site-abc',
    siteName: 'Test Site',
    createdAt: new Date().toISOString(),
    previousScore: prevScore,
    audit: { siteScore: scoreOverride, totalPages: 10, errors: 2, warnings: 5, infos: 3, pages: [], siteWideIssues: [] },
  };
}

function makeMockPageSpeedResult() {
  return {
    siteId: 'site-abc',
    createdAt: new Date().toISOString(),
    result: {
      siteId: 'site-abc',
      strategy: 'mobile',
      pages: [
        { score: 80, vitals: { LCP: 2500, FID: 10, CLS: 0.05, FCP: 1500, INP: 150, SI: 3000, TBT: 100, TTI: 4000 }, url: '/page-1', page: '/page-1', strategy: 'mobile', opportunities: [], diagnostics: [], fetchedAt: new Date().toISOString(), fieldDataAvailable: false },
        { score: 60, vitals: { LCP: 4000, FID: 200, CLS: 0.2, FCP: 2500, INP: 350, SI: 5000, TBT: 500, TTI: 8000 }, url: '/page-2', page: '/page-2', strategy: 'mobile', opportunities: [], diagnostics: [], fetchedAt: new Date().toISOString(), fieldDataAvailable: false },
      ],
      averageScore: 70,
      averageVitals: { LCP: 3250, FID: 105, CLS: 0.125, FCP: 2000, INP: 250, SI: 4000, TBT: 300, TTI: 6000 },
      testedAt: new Date().toISOString(),
    },
  };
}

function makeMockRedirectSnapshot() {
  return {
    id: 'redirect-snap-1',
    siteId: 'site-abc',
    createdAt: new Date().toISOString(),
    result: {
      chains: [
        { originalUrl: '/old-page', hops: [{ url: '/mid', status: 301 }], finalUrl: '/new-page', totalHops: 2, isLoop: false, foundOn: [], type: 'internal' as const },
      ],
      pageStatuses: [],
      summary: { totalPages: 20, healthy: 18, redirecting: 2, notFound: 0, errors: 0, chainsDetected: 1, longestChain: 2 },
      scannedAt: new Date().toISOString(),
    },
  };
}

function makeMockArchitecture() {
  return {
    tree: {
      path: '/',
      name: 'Root',
      source: 'existing' as const,
      children: [],
      depth: 0,
      hasContent: false,
    },
    totalPages: 10,
    existingPages: 8,
    plannedPages: 2,
    strategyPages: 0,
    gaps: [],
    depthDistribution: { 1: 5, 2: 3 },
    orphanPaths: ['/orphan-1', '/orphan-2', '/orphan-3'],
    analyzedAt: new Date().toISOString(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('assembleSiteHealth', () => {
  let buildWorkspaceIntelligence: typeof import('../server/workspace-intelligence.js').buildWorkspaceIntelligence;
  let getWorkspace: ReturnType<typeof vi.fn>;
  let getLatestSnapshot: ReturnType<typeof vi.fn>;
  let listSnapshots: ReturnType<typeof vi.fn>;
  let getPageSpeed: ReturnType<typeof vi.fn>;
  let getLinkCheck: ReturnType<typeof vi.fn>;
  let getRedirectSnapshot: ReturnType<typeof vi.fn>;
  let listAnomalies: ReturnType<typeof vi.fn>;
  let getSeoChanges: ReturnType<typeof vi.fn>;
  let getCachedArchitecture: ReturnType<typeof vi.fn>;
  let flattenTree: ReturnType<typeof vi.fn>;
  let getValidations: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const workspacesMod = await import('../server/workspaces.js');
    getWorkspace = workspacesMod.getWorkspace as ReturnType<typeof vi.fn>;

    const reportsMod = await import('../server/reports.js');
    getLatestSnapshot = reportsMod.getLatestSnapshot as ReturnType<typeof vi.fn>;
    listSnapshots = reportsMod.listSnapshots as ReturnType<typeof vi.fn>;

    const perfMod = await import('../server/performance-store.js');
    getPageSpeed = perfMod.getPageSpeed as ReturnType<typeof vi.fn>;
    getLinkCheck = perfMod.getLinkCheck as ReturnType<typeof vi.fn>;

    const redirectMod = await import('../server/redirect-store.js');
    getRedirectSnapshot = redirectMod.getRedirectSnapshot as ReturnType<typeof vi.fn>;

    const anomalyMod = await import('../server/anomaly-detection.js');
    listAnomalies = anomalyMod.listAnomalies as ReturnType<typeof vi.fn>;

    const changeMod = await import('../server/seo-change-tracker.js');
    getSeoChanges = changeMod.getSeoChanges as ReturnType<typeof vi.fn>;

    const archMod = await import('../server/site-architecture.js');
    getCachedArchitecture = archMod.getCachedArchitecture as ReturnType<typeof vi.fn>;
    flattenTree = archMod.flattenTree as ReturnType<typeof vi.fn>;

    const validatorMod = await import('../server/schema-validator.js');
    getValidations = validatorMod.getValidations as ReturnType<typeof vi.fn>;

    const wiMod = await import('../server/workspace-intelligence.js');
    buildWorkspaceIntelligence = wiMod.buildWorkspaceIntelligence;
  });

  // ── Test 1: Shape completeness ───────────────────────────────────────────

  it('returns a siteHealth slice with all required fields when data is available', async () => {
    getWorkspace.mockReturnValue(makeMockWorkspace());
    getLatestSnapshot.mockReturnValue(makeMockSnapshot(85, 80));
    listSnapshots.mockReturnValue([
      { id: 'snap-1', createdAt: new Date().toISOString(), siteScore: 85, totalPages: 10, errors: 2, warnings: 5, infos: 3 },
      { id: 'snap-0', createdAt: new Date(Date.now() - 86400000).toISOString(), siteScore: 80, totalPages: 10, errors: 3, warnings: 6, infos: 2 },
    ]);
    getPageSpeed.mockReturnValue(makeMockPageSpeedResult());
    getLinkCheck.mockReturnValue({
      siteId: 'site-abc', createdAt: new Date().toISOString(),
      result: { deadLinks: [{ url: '/dead-1' }, { url: '/dead-2' }] },
    });
    getRedirectSnapshot.mockReturnValue(makeMockRedirectSnapshot());
    listAnomalies.mockReturnValue([
      { id: 'a1', type: 'traffic_drop', workspaceId: 'ws-1' },
      { id: 'a2', type: 'audit_score_drop', workspaceId: 'ws-1' },
    ]);
    getSeoChanges.mockReturnValue([
      { id: 'c1', workspaceId: 'ws-1', changedAt: new Date().toISOString() },
      { id: 'c2', workspaceId: 'ws-1', changedAt: new Date().toISOString() },
      { id: 'c3', workspaceId: 'ws-1', changedAt: new Date().toISOString() },
    ]);
    getCachedArchitecture.mockResolvedValue(makeMockArchitecture());
    flattenTree.mockReturnValue([
      { path: '/orphan-1', depth: 1, hasContent: true, source: 'existing', name: 'Orphan 1', children: [] },
      { path: '/orphan-2', depth: 1, hasContent: true, source: 'existing', name: 'Orphan 2', children: [] },
      { path: '/orphan-3', depth: 1, hasContent: true, source: 'existing', name: 'Orphan 3', children: [] },
    ]);
    getValidations.mockReturnValue([
      { status: 'valid', errors: [], warnings: [] },
      { status: 'errors', errors: [{ type: 'required', field: 'name', message: 'Missing' }], warnings: [] },
      { status: 'warnings', errors: [], warnings: [{ type: 'recommended', field: 'image', message: 'Missing' }] },
    ]);

    const intel = await buildWorkspaceIntelligence('ws-1', { slices: ['siteHealth'] });
    const health = intel.siteHealth as SiteHealthSlice;

    // Required fields present
    expect(health).toBeDefined();
    expect(typeof health.auditScore).toBe('number');
    expect(typeof health.deadLinks).toBe('number');
    expect(typeof health.redirectChains).toBe('number');
    expect(typeof health.schemaErrors).toBe('number');
    expect(typeof health.orphanPages).toBe('number');
    expect(health.cwvPassRate).toBeDefined();

    // Values look correct
    expect(health.auditScore).toBe(85);
    expect(health.deadLinks).toBe(2);
    expect(health.redirectChains).toBe(1);
    expect(health.schemaErrors).toBe(1);
    expect(health.orphanPages).toBe(3);

    // Optional Phase 3A fields
    expect(health.anomalyCount).toBe(2);
    expect(health.anomalyTypes).toContain('traffic_drop');
    expect(health.anomalyTypes).toContain('audit_score_drop');
    expect(health.seoChangeVelocity).toBeGreaterThanOrEqual(0);
    expect(health.schemaValidation).toBeDefined();
    expect(health.schemaValidation?.errors).toBe(1);
    expect(health.schemaValidation?.warnings).toBe(1);
    expect(health.schemaValidation?.valid).toBe(1);
  });

  // ── Test 2: Empty data defaults ──────────────────────────────────────────

  it('returns sensible defaults when all sources return null/empty', async () => {
    getWorkspace.mockReturnValue(makeMockWorkspace());
    getLatestSnapshot.mockReturnValue(null);
    listSnapshots.mockReturnValue([]);
    getPageSpeed.mockReturnValue(null);
    getLinkCheck.mockReturnValue(null);
    getRedirectSnapshot.mockReturnValue(null);
    listAnomalies.mockReturnValue([]);
    getSeoChanges.mockReturnValue([]);
    getCachedArchitecture.mockResolvedValue({
      ...makeMockArchitecture(),
      orphanPaths: [],
    });
    flattenTree.mockReturnValue([]);
    getValidations.mockReturnValue([]);

    const intel = await buildWorkspaceIntelligence('ws-1', { slices: ['siteHealth'] });
    const health = intel.siteHealth as SiteHealthSlice;

    expect(health).toBeDefined();
    expect(health.auditScore).toBeNull();
    expect(health.auditScoreDelta).toBeNull();
    expect(health.deadLinks).toBe(0);
    expect(health.redirectChains).toBe(0);
    expect(health.schemaErrors).toBe(0);
    expect(health.orphanPages).toBe(0);
    expect(health.cwvPassRate.mobile).toBeNull();
    expect(health.cwvPassRate.desktop).toBeNull();
    expect(health.anomalyCount).toBe(0);
    expect(health.seoChangeVelocity).toBe(0);
  });

  // ── Test 3: Source failure survival ─────────────────────────────────────

  it('returns a partial slice when some sources throw', async () => {
    getWorkspace.mockReturnValue(makeMockWorkspace());
    getLatestSnapshot.mockReturnValue(makeMockSnapshot(75, 70));
    listSnapshots.mockReturnValue([
      { id: 'snap-1', createdAt: new Date().toISOString(), siteScore: 75, totalPages: 10, errors: 2, warnings: 5, infos: 3 },
    ]);

    // Pagespeed throws
    getPageSpeed.mockImplementation(() => { throw new Error('pagespeed DB locked'); });

    // Link check throws
    getLinkCheck.mockImplementation(() => { throw new Error('link-check DB error'); });

    // Redirect snapshot succeeds
    getRedirectSnapshot.mockReturnValue(makeMockRedirectSnapshot());

    // Anomaly detection throws
    listAnomalies.mockImplementation(() => { throw new Error('anomaly module error'); });

    // SEO changes succeeds
    getSeoChanges.mockReturnValue([
      { id: 'c1', workspaceId: 'ws-1', changedAt: new Date().toISOString() },
    ]);

    // Architecture throws
    getCachedArchitecture.mockRejectedValue(new Error('Webflow API timeout'));
    flattenTree.mockReturnValue([]);

    // Schema validator succeeds
    getValidations.mockReturnValue([
      { status: 'valid', errors: [], warnings: [] },
    ]);

    // Should not throw — assembler must isolate per-source errors
    const intel = await buildWorkspaceIntelligence('ws-1', { slices: ['siteHealth'] });
    const health = intel.siteHealth as SiteHealthSlice;

    expect(health).toBeDefined();

    // Audit score came from reports.ts (which succeeded)
    expect(health.auditScore).toBe(75);

    // Redirect chains still populated (redirect-store succeeded)
    expect(health.redirectChains).toBe(1);

    // Dead links defaults to 0 (link-check threw)
    expect(health.deadLinks).toBe(0);

    // Anomaly count defaults to 0 (anomaly module threw)
    expect(health.anomalyCount).toBe(0);

    // Orphan pages defaults to 0 (architecture threw)
    expect(health.orphanPages).toBe(0);
  });
});
