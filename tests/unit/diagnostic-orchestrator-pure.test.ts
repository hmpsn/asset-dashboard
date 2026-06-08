/**
 * Wave 22 — Unit tests for server/diagnostic-orchestrator.ts
 *
 * The orchestrator has one export (runDiagnostic) plus internal pure logic:
 *   - MODULE_ROUTER selection
 *   - isSoftFourOhFour detection (redirect probe)
 *   - Query breakdown filtering
 *   - Period comparison fallback to empty values
 *   - Backlinks fallback when intelligence unavailable
 *   - Fallback AI synthesis when JSON parse fails
 *   - Error path: missing insight → markDiagnosticFailed
 *
 * All heavy dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getInsights: vi.fn(),
  stampDiagnosticReportId: vi.fn(),
  getWorkspace: vi.fn(),
  getPageTrend: vi.fn(),
  getQueryPageData: vi.fn(),
  getSearchPeriodComparison: vi.fn(),
  getGA4LandingPages: vi.fn(),
  getAllGscPages: vi.fn(),
  scanRedirects: vi.fn(),
  resolveFullPageUrl: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  callAI: vi.fn(),
  probeCanonical: vi.fn(),
  countInternalLinks: vi.fn(),
  completeDiagnosticReport: vi.fn(),
  markDiagnosticFailed: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  addActivity: vi.fn(),
  updateJob: vi.fn(),
  parseJsonSafeArray: vi.fn(),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../server/logger.js', () => ({ createLogger: mocks.createLogger }));
vi.mock('../../server/workspaces.js', () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock('../../server/search-console.js', () => ({
  getPageTrend: mocks.getPageTrend,
  getQueryPageData: mocks.getQueryPageData,
  getSearchPeriodComparison: mocks.getSearchPeriodComparison,
  getAllGscPages: mocks.getAllGscPages,
}));
vi.mock('../../server/google-analytics.js', () => ({ getGA4LandingPages: mocks.getGA4LandingPages }));
vi.mock('../../server/redirect-scanner.js', () => ({ scanRedirects: mocks.scanRedirects }));
vi.mock('../../server/outcome-measurement.js', () => ({ resolveFullPageUrl: mocks.resolveFullPageUrl }));
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: mocks.buildWorkspaceIntelligence,
}));
vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mocks.getInsights,
  stampDiagnosticReportId: mocks.stampDiagnosticReportId,
}));
vi.mock('../../server/ai.js', () => ({ callAI: mocks.callAI }));
vi.mock('../../server/diagnostic-probe.js', () => ({
  probeCanonical: mocks.probeCanonical,
  countInternalLinks: mocks.countInternalLinks,
}));
vi.mock('../../server/diagnostic-store.js', () => ({
  completeDiagnosticReport: mocks.completeDiagnosticReport,
  markDiagnosticFailed: mocks.markDiagnosticFailed,
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: mocks.broadcastToWorkspace }));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    DIAGNOSTIC_COMPLETE: 'diagnostic:complete',
    DIAGNOSTIC_FAILED: 'diagnostic:failed',
  },
}));
vi.mock('../../server/activity-log.js', () => ({ addActivity: mocks.addActivity }));
vi.mock('../../server/jobs.js', () => ({ updateJob: mocks.updateJob }));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafeArray: mocks.parseJsonSafeArray,
}));
vi.mock('../../server/schemas/diagnostics-schemas.js', () => ({
  rootCauseSchema: {},
  remediationActionSchema: {},
}));

import { runDiagnostic } from '../../server/diagnostic-orchestrator.js';

// ── Shared fixture factory ────────────────────────────────────────────────────

function makeAnomalyInsight(type: string, affectedPage: string | null = '/blog/test') {
  return {
    id: 'insight-1',
    insightType: 'anomaly_digest',
    pageId: null,
    pageTitle: null,
    severity: 'critical',
    data: {
      anomalyType: type,
      severity: 'critical',
      metric: 'clicks',
      currentValue: 100,
      expectedValue: 500,
      deviationPercent: -80,
      firstDetected: '2026-05-01T00:00:00Z',
      affectedPage,
    },
  };
}

function makeWorkspace() {
  return {
    webflowSiteId: 'site-1',
    gscPropertyUrl: 'https://example.com',
    ga4PropertyId: 'GA4-123',
    liveDomain: 'https://example.com',
  };
}

function makeAISynthesisJSON(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    rootCauses: [
      { rank: 1, title: 'Page was deleted', confidence: 'high', explanation: 'Redirect chain leads to 404', evidence: ['redirect to /404'] },
    ],
    remediationActions: [
      { priority: 'P0', title: 'Restore page', description: 'Re-publish the deleted page', effort: 'low', impact: 'high', owner: 'dev' },
    ],
    adminReport: '## Executive Summary\nPage was deleted.',
    clientSummary: 'A page was accidentally removed. We are restoring it.',
    ...overrides,
  });
}

function setupDefaultMocks() {
  mocks.getWorkspace.mockReturnValue(makeWorkspace());
  mocks.getInsights.mockReturnValue([makeAnomalyInsight('traffic_drop')]);
  mocks.getPageTrend.mockResolvedValue([]);
  mocks.getQueryPageData.mockResolvedValue([]);
  mocks.getSearchPeriodComparison.mockResolvedValue(null);
  mocks.scanRedirects.mockResolvedValue(null);
  mocks.probeCanonical.mockResolvedValue(null);
  mocks.countInternalLinks.mockResolvedValue({ count: 3, siteMedian: 5, topLinkingPages: [], deficit: 2 });
  mocks.getGA4LandingPages.mockResolvedValue([]);
  mocks.resolveFullPageUrl.mockReturnValue('https://example.com/blog/test');
  mocks.buildWorkspaceIntelligence.mockResolvedValue(null);
  mocks.callAI.mockResolvedValue({ text: makeAISynthesisJSON() });
  mocks.parseJsonSafeArray.mockImplementation((raw: string) => JSON.parse(raw));
  mocks.stampDiagnosticReportId.mockReturnValue(undefined);
  mocks.addActivity.mockReturnValue(undefined);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runDiagnostic — missing insight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockReturnValue(makeWorkspace());
    mocks.getInsights.mockReturnValue([]); // no matching insight
  });

  it('calls markDiagnosticFailed when the anomaly insight is not found', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'missing-id', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.markDiagnosticFailed).toHaveBeenCalledWith('rpt-1', 'Anomaly insight not found');
  });

  it('calls updateJob with error status when insight is missing', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'missing-id', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.updateJob).toHaveBeenCalledWith('job-1', {
      status: 'error',
      message: 'Anomaly insight not found',
    });
  });

  it('does NOT call completeDiagnosticReport when insight is missing', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'missing-id', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.completeDiagnosticReport).not.toHaveBeenCalled();
  });

  it('broadcasts DIAGNOSTIC_FAILED when insight lookup fails', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'missing-id', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'diagnostic:failed',
      expect.objectContaining({ reportId: 'rpt-1', insightId: 'missing-id' }),
    );
  });
});

describe('runDiagnostic — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('calls completeDiagnosticReport on success', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.completeDiagnosticReport).toHaveBeenCalledWith('rpt-1', expect.objectContaining({
      adminReport: expect.any(String),
      clientSummary: expect.any(String),
    }));
  });

  it('broadcasts DIAGNOSTIC_COMPLETE on success', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'diagnostic:complete',
      expect.objectContaining({ reportId: 'rpt-1', insightId: 'insight-1' }),
    );
  });

  it('calls stampDiagnosticReportId after completion', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.stampDiagnosticReportId).toHaveBeenCalledWith('ws-1', 'insight-1', 'rpt-1');
  });

  it('updates job to done status on success', async () => {
    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');
    expect(mocks.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'done' }));
  });
});

describe('runDiagnostic — AI synthesis fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('returns fallback root cause when AI returns unparseable JSON', async () => {
    mocks.callAI.mockResolvedValue({ text: 'NOT JSON AT ALL' });
    // parseJsonSafeArray will fail to parse — simulate empty arrays returned
    mocks.parseJsonSafeArray.mockReturnValue([]);

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    expect(mocks.completeDiagnosticReport).toHaveBeenCalledWith('rpt-1', expect.objectContaining({
      rootCauses: expect.arrayContaining([
        expect.objectContaining({ title: 'Analysis inconclusive', confidence: 'low' }),
      ]),
    }));
  });

  it('returns fallback client summary when AI synthesis fails', async () => {
    mocks.callAI.mockResolvedValue({ text: '{}' });
    mocks.parseJsonSafeArray.mockReturnValue([]);

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.clientSummary).toMatch(/investigating/i);
  });
});

describe('runDiagnostic — error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockReturnValue(makeWorkspace());
    mocks.getInsights.mockReturnValue([makeAnomalyInsight('traffic_drop')]);
  });

  it('calls markDiagnosticFailed when callAI throws', async () => {
    mocks.getPageTrend.mockResolvedValue([]);
    mocks.getQueryPageData.mockResolvedValue([]);
    mocks.getSearchPeriodComparison.mockResolvedValue(null);
    mocks.scanRedirects.mockResolvedValue(null);
    mocks.probeCanonical.mockResolvedValue(null);
    mocks.countInternalLinks.mockResolvedValue({ count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 });
    mocks.getGA4LandingPages.mockResolvedValue([]);
    mocks.resolveFullPageUrl.mockReturnValue('https://example.com/blog/test');
    mocks.buildWorkspaceIntelligence.mockResolvedValue(null);
    mocks.callAI.mockRejectedValue(new Error('OpenAI rate limit'));

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    expect(mocks.markDiagnosticFailed).toHaveBeenCalledWith('rpt-1', 'OpenAI rate limit');
  });

  it('broadcasts DIAGNOSTIC_FAILED on error', async () => {
    mocks.getPageTrend.mockRejectedValue(new Error('GSC error'));
    mocks.getQueryPageData.mockResolvedValue([]);
    mocks.getSearchPeriodComparison.mockResolvedValue(null);
    mocks.scanRedirects.mockResolvedValue(null);
    mocks.probeCanonical.mockResolvedValue(null);
    mocks.countInternalLinks.mockResolvedValue({ count: 0, siteMedian: 0, topLinkingPages: [], deficit: 0 });
    mocks.getGA4LandingPages.mockResolvedValue([]);
    mocks.resolveFullPageUrl.mockReturnValue('https://example.com/blog/test');
    mocks.buildWorkspaceIntelligence.mockResolvedValue(null);
    mocks.callAI.mockRejectedValue(new Error('downstream'));

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'diagnostic:failed',
      expect.objectContaining({ reportId: 'rpt-1' }),
    );
  });
});

describe('runDiagnostic — soft 404 detection (isSoftFourOhFour)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('marks redirect to /404 as soft 404', async () => {
    mocks.scanRedirects.mockResolvedValue({
      chains: [
        {
          originalUrl: 'https://example.com/blog/test',
          hops: [{ url: '/blog/test', status: 301 }, { url: '/404', status: 200 }],
          finalUrl: '/404',
        },
      ],
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.redirectProbe.isSoftFourOhFour).toBe(true);
  });

  it('marks redirect to / (homepage) as soft 404', async () => {
    mocks.scanRedirects.mockResolvedValue({
      chains: [
        {
          originalUrl: 'https://example.com/blog/test',
          hops: [{ url: '/blog/test', status: 301 }, { url: '/', status: 200 }],
          finalUrl: '/',
        },
      ],
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.redirectProbe.isSoftFourOhFour).toBe(true);
  });

  it('marks redirect to /en/ (locale root) as soft 404', async () => {
    mocks.scanRedirects.mockResolvedValue({
      chains: [
        {
          originalUrl: 'https://example.com/blog/test',
          hops: [{ url: '/blog/test', status: 301 }, { url: '/en/', status: 200 }],
          finalUrl: '/en/',
        },
      ],
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.redirectProbe.isSoftFourOhFour).toBe(true);
  });

  it('marks redirect to /404.html as soft 404', async () => {
    mocks.scanRedirects.mockResolvedValue({
      chains: [
        {
          originalUrl: 'https://example.com/blog/test',
          hops: [{ url: '/blog/test', status: 301 }, { url: '/404.html', status: 200 }],
          finalUrl: '/404.html',
        },
      ],
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.redirectProbe.isSoftFourOhFour).toBe(true);
  });

  it('does NOT mark a legitimate redirect as soft 404', async () => {
    mocks.scanRedirects.mockResolvedValue({
      chains: [
        {
          originalUrl: 'https://example.com/blog/test',
          hops: [{ url: '/blog/test', status: 301 }, { url: '/blog/test-v2', status: 200 }],
          finalUrl: '/blog/test-v2',
        },
      ],
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.redirectProbe.isSoftFourOhFour).toBe(false);
  });

  it('returns isSoftFourOhFour=false when no redirect chain matches affected page', async () => {
    mocks.scanRedirects.mockResolvedValue({
      chains: [
        {
          originalUrl: 'https://example.com/other-page',
          hops: [{ url: '/other-page', status: 301 }],
          finalUrl: '/other',
        },
      ],
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.redirectProbe.isSoftFourOhFour).toBe(false);
  });
});

describe('runDiagnostic — context assembly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('builds empty period comparison when GSC returns null', async () => {
    mocks.getSearchPeriodComparison.mockResolvedValue(null);

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    const period = call.diagnosticContext.periodComparison;
    expect(period.current.clicks).toBe(0);
    expect(period.previous.impressions).toBe(0);
    expect(period.changePercent.position).toBe(0);
  });

  it('filters query breakdown to affected page path', async () => {
    mocks.getQueryPageData.mockResolvedValue([
      { query: 'matching query', page: '/blog/test', clicks: 50, impressions: 200, position: 3 },
      { query: 'other query', page: '/other-page', clicks: 10, impressions: 100, position: 8 },
    ]);

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    const queries = call.diagnosticContext.queryBreakdown;
    expect(queries).toHaveLength(1);
    expect(queries[0].query).toBe('matching query');
    expect(queries[0].currentClicks).toBe(50);
  });

  it('limits position history to last 90 entries', async () => {
    const history = Array.from({ length: 120 }, (_, i) => ({
      date: `2026-0${(i % 9) + 1}-01`,
      position: 5 + i,
      clicks: 100,
      impressions: 500,
    }));
    mocks.getPageTrend.mockResolvedValue(history);

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.positionHistory).toHaveLength(90);
  });

  it('marks backlinks unavailable when intelligence returns null and backlinks module is active', async () => {
    mocks.buildWorkspaceIntelligence.mockResolvedValue(null);
    // traffic_drop includes backlinks module
    mocks.getInsights.mockReturnValue([makeAnomalyInsight('traffic_drop')]);

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    const unavailable = call.diagnosticContext.unavailableSources;
    expect(unavailable.some((s: { source: string }) => s.source === 'backlinks')).toBe(true);
  });

  it('uses intelligence backlinkProfile data when available', async () => {
    mocks.buildWorkspaceIntelligence.mockResolvedValue({
      seoContext: {
        backlinkProfile: { totalBacklinks: 420, referringDomains: 35 },
        rankTracking: { avgPosition: 12 },
      },
      operational: { recentActivity: [] },
    });

    await runDiagnostic({ workspaceId: 'ws-1', insightId: 'insight-1', reportId: 'rpt-1' }, 'job-1');

    const call = mocks.completeDiagnosticReport.mock.calls[0][1];
    expect(call.diagnosticContext.backlinks.totalBacklinks).toBe(420);
    expect(call.diagnosticContext.backlinks.referringDomains).toBe(35);
    expect(call.diagnosticContext.siteBaselines.totalBacklinks).toBe(420);
  });
});
