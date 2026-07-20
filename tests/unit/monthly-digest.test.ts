import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import { STUDIO_NAME, STUDIO_URL } from '../../server/constants.js';
import type { Workspace } from '../../server/workspaces.js';

const mocks = vi.hoisted(() => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  getInsights: vi.fn(),
  getROIHighlights: vi.fn(),
  listBatches: vi.fn(),
  listWorkOrders: vi.fn(),
  callAI: vi.fn(),
  getSearchPeriodComparison: vi.fn(),
  getGA4PeriodComparison: vi.fn(),
  isFeatureEnabled: vi.fn(),
  getWorkspaceLearnings: vi.fn(),
  formatLearningsForPrompt: vi.fn(),
  buildRecommendationGenerationContext: vi.fn(),
  learningsPromptContext: '',
  learningsTotal: undefined as number | undefined,
  isProgrammingError: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    debug: mocks.logDebug,
    warn: mocks.logWarn,
  }),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mocks.getInsights,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getROIHighlightsFromOutcomes: mocks.getROIHighlights,
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: mocks.listBatches,
}));

vi.mock('../../server/work-orders.js', () => ({
  listWorkOrders: mocks.listWorkOrders,
}));

vi.mock('../../server/ai.js', () => ({
  callAI: mocks.callAI,
}));

vi.mock('../../server/search-console.js', () => ({
  getSearchPeriodComparison: mocks.getSearchPeriodComparison,
}));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4PeriodComparison: mocks.getGA4PeriodComparison,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: mocks.getWorkspaceLearnings,
  formatLearningsForPrompt: mocks.formatLearningsForPrompt,
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildRecommendationGenerationContext: mocks.buildRecommendationGenerationContext,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

const { generateMonthlyDigest } = await import('../../server/monthly-digest.js');
const { invalidateMonthlyDigestCache } = await import('../../server/monthly-digest-cache.js');

const VALID_AI_SUMMARY = JSON.stringify({
  clauseIds: ['metric.search.clicks', 'metric.search.impressions'],
});

const DEFAULT_SELECTED_SUMMARY = 'Search clicks increased 12.5% in the current reporting window. Search impressions decreased 4.2% in the current reporting window.';
const DEFAULT_FALLBACK_SUMMARY = `${DEFAULT_SELECTED_SUMMARY} Average search position improved by 1.3 spots in the current reporting window.`;
const POSITION_SCOPE_SUMMARY = 'Average search position improved by 1.3 spots in the current reporting window. Current-month evidence for May 2026 is available for review.';
const IMPRESSIONS_SCOPE_SUMMARY = 'Search impressions decreased 4.2% in the current reporting window. Current-month evidence for May 2026 is available for review.';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `ws_digest_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Digest Test Workspace',
    folder: 'digest-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    webflowSiteId: 'wf_1',
    gscPropertyUrl: 'sc-domain:example.com',
    ga4PropertyId: 'ga4_1',
    ...overrides,
  } as Workspace;
}

function makeInsight(overrides: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return {
    id: 'ins_1',
    workspaceId: 'ws_1',
    pageId: '/services',
    insightType: 'ranking_mover',
    severity: 'positive',
    computedAt: '2026-05-20T00:00:00.000Z',
    data: { currentPosition: 4, previousPosition: 10 },
    impactScore: 80,
    pageTitle: 'Service Page',
    ...overrides,
  } as AnalyticsInsight;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

  mocks.getInsights.mockReturnValue([]);
  mocks.getROIHighlights.mockReturnValue([]);
  mocks.listBatches.mockReturnValue([]);
  mocks.listWorkOrders.mockReturnValue([]);
  mocks.callAI.mockResolvedValue({ text: VALID_AI_SUMMARY });
  mocks.getSearchPeriodComparison.mockResolvedValue({
    changePercent: { clicks: 12.5, impressions: -4.2 },
    change: { position: -1.27 },
  });
  mocks.getGA4PeriodComparison.mockResolvedValue({});
  mocks.isFeatureEnabled.mockReturnValue(false);
  mocks.getWorkspaceLearnings.mockReturnValue(null);
  mocks.formatLearningsForPrompt.mockReturnValue('');
  mocks.learningsPromptContext = '';
  mocks.learningsTotal = undefined;
  mocks.buildRecommendationGenerationContext.mockImplementation(async (_workspaceId: string, opts: { slices?: string[]; learningsDomain?: string } = {}) => {
    const slices = opts.slices ?? [];
    const fullInsights = mocks.getInsights();
    const byType = fullInsights.reduce<Record<string, AnalyticsInsight[]>>((acc, insight: AnalyticsInsight) => {
      acc[insight.insightType] = acc[insight.insightType] ?? [];
      acc[insight.insightType].push(insight);
      return acc;
    }, {});
    return {
      intelligence: {
        version: 1,
        workspaceId: _workspaceId,
        assembledAt: new Date().toISOString(),
        insights: slices.includes('insights')
          ? {
              all: fullInsights.slice(0, 100),
              byType,
              bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 },
              topByImpact: fullInsights.slice(0, 10),
            }
          : undefined,
        learnings: slices.includes('learnings')
          ? {
              availability: 'ready',
              summary: mocks.learningsTotal != null ? { totalScoredActions: mocks.learningsTotal } : null,
            }
          : undefined,
      },
      slices,
      promptContext: slices.includes('learnings') ? mocks.learningsPromptContext : '',
      learningsDomain: opts.learningsDomain ?? 'all',
      learningsAvailability: slices.includes('learnings') ? 'ready' : 'not_requested',
    };
  });
  mocks.isProgrammingError.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('monthly-digest generation', () => {
  it('returns honest no-data output and skips AI when the current month has no evidence', async () => {
    const ws = makeWorkspace({
      id: 'ws_no_current_evidence',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.availability).toBe('no_data');
    expect(result.summary).toContain('No current-month results are available yet');
    expect(result.summary).not.toMatch(/held steady|solid baseline/i);
    expect(mocks.callAI).not.toHaveBeenCalled();
  });

  it('keeps fulfilled zero-valued provider evidence ready', async () => {
    const ws = makeWorkspace({ id: 'ws_zero_provider_evidence' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      current: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      previous: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      changePercent: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      change: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({
      current: { totalUsers: 0, totalSessions: 0 },
      previous: { totalUsers: 0, totalSessions: 0 },
      changePercent: { users: 0, sessions: 0, pageviews: 0 },
      change: { users: 0, sessions: 0, pageviews: 0 },
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.availability).toBe('ready');
    expect(result.summary).toContain('No percentage change was recorded for search clicks');
    expect(result.summary).toContain('No percentage change was recorded for search impressions');
    expect(result.summary).not.toMatch(/momentum|strong baseline|solid baseline/i);
    expect(mocks.callAI).toHaveBeenCalledOnce();
  });

  it('bounds insight wins and resolutions to the current UTC month', async () => {
    const ws = makeWorkspace({
      id: 'ws_current_insight_window',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });
    mocks.getInsights.mockReturnValue([
      makeInsight({ id: 'prior-win', computedAt: '2026-04-30T23:59:59.999Z', pageTitle: 'Prior win' }),
      makeInsight({ id: 'current-win', computedAt: '2026-05-01T00:00:00.000Z', pageTitle: 'Current win' }),
      makeInsight({
        id: 'prior-resolution',
        insightType: 'page_health',
        severity: 'warning',
        computedAt: '2026-05-10T00:00:00.000Z',
        resolutionStatus: 'resolved',
        resolvedAt: '2026-04-30T23:59:59.999Z',
      }),
      makeInsight({
        id: 'current-resolution',
        insightType: 'page_health',
        severity: 'warning',
        computedAt: '2026-04-10T00:00:00.000Z',
        resolutionStatus: 'resolved',
        resolvedAt: '2026-05-01T00:00:00.000Z',
      }),
    ]);

    const result = await generateMonthlyDigest(ws);

    expect(result.wins.map((item) => item.insightId)).toEqual(['current-win']);
    expect(result.issuesAddressed.map((item) => item.insightId)).toEqual(['current-resolution']);
  });

  it('computes current UTC month period boundaries and inverts ranking-position delta sign', async () => {
    vi.setSystemTime(new Date('2024-02-25T12:00:00.000Z'));
    const ws = makeWorkspace({ id: 'ws_period_math' });

    const result = await generateMonthlyDigest(ws);

    expect(result.month).toBe('February 2024');
    expect(result.period.start).toMatch(/^2024-02-01T/);
    expect(result.period.end).toMatch(/^2024-02-22T/);
    expect(result.metrics.clicksChange).toBe(12.5);
    expect(result.metrics.impressionsChange).toBe(-4.2);
    expect(result.metrics.avgPositionChange).toBe(1.3);
    expect(result.period.start).toBe('2024-02-01T00:00:00.000Z');
    expect(result.period.end).toBe('2024-02-22T23:59:59.999Z');
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith(
      'wf_1',
      'sc-domain:example.com',
      28,
      { startDate: '2024-02-01', endDate: '2024-02-22' },
    );
    expect(mocks.getGA4PeriodComparison).toHaveBeenCalledWith(
      'ga4_1',
      28,
      { startDate: '2024-02-01', endDate: '2024-02-22' },
    );
    expect(mocks.getROIHighlights).toHaveBeenCalledWith('ws_period_math', 5, {
      start: '2024-02-01T00:00:00.000Z',
      endExclusive: '2024-02-23T00:00:00.000Z',
    });
  });

  it('uses the declared provider cutoff for current-month insight and ROI evidence too', async () => {
    const ws = makeWorkspace({ id: 'ws_one_reporting_window' });
    mocks.getInsights.mockReturnValue([
      makeInsight({ id: 'inside-cutoff', computedAt: '2026-05-22T23:59:59.999Z', pageTitle: 'Inside cutoff' }),
      makeInsight({ id: 'after-cutoff', computedAt: '2026-05-23T00:00:00.000Z', pageTitle: 'After cutoff' }),
    ]);

    const result = await generateMonthlyDigest(ws);

    expect(result.period).toEqual({
      start: '2026-05-01T00:00:00.000Z',
      end: '2026-05-22T23:59:59.999Z',
    });
    expect(result.wins.map((item) => item.insightId)).toEqual(['inside-cutoff']);
    expect(mocks.getROIHighlights).toHaveBeenCalledWith(ws.id, 5, {
      start: result.period.start,
      endExclusive: '2026-05-23T00:00:00.000Z',
    });
  });

  it('clamps the first-day reporting endpoint to now and advances the cache identity with that endpoint', async () => {
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
    const ws = makeWorkspace({ id: 'ws_first_day_partial_window' });
    mocks.getInsights.mockReturnValue([
      makeInsight({ id: 'before-noon', computedAt: '2026-05-01T10:00:00.000Z', pageTitle: 'Before noon' }),
      makeInsight({ id: 'after-noon', computedAt: '2026-05-01T12:30:00.000Z', pageTitle: 'After noon' }),
    ]);

    const noon = await generateMonthlyDigest(ws);

    expect(noon.period).toEqual({
      start: '2026-05-01T00:00:00.000Z',
      end: '2026-05-01T11:59:59.999Z',
    });
    expect(noon.wins.map((item) => item.insightId)).toEqual(['before-noon']);
    expect(mocks.getROIHighlights).toHaveBeenNthCalledWith(1, ws.id, 5, {
      start: noon.period.start,
      endExclusive: '2026-05-01T12:00:00.000Z',
    });

    vi.setSystemTime(new Date('2026-05-01T13:00:00.000Z'));
    const onePm = await generateMonthlyDigest(ws);

    expect(onePm.period.end).toBe('2026-05-01T12:59:59.999Z');
    expect(onePm.wins.map((item) => item.insightId)).toEqual(['before-noon', 'after-noon']);
    expect(mocks.getROIHighlights).toHaveBeenNthCalledWith(2, ws.id, 5, {
      start: onePm.period.start,
      endExclusive: '2026-05-01T13:00:00.000Z',
    });
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
  });

  it('falls back to deterministic summary copy when AI throws and integrations are unavailable', async () => {
    const ws = makeWorkspace({
      id: 'ws_fallback',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });

    mocks.callAI.mockRejectedValueOnce(new Error('AI unavailable'));
    mocks.getInsights.mockReturnValue([
      makeInsight({ id: 'win_1', severity: 'positive' }),
      makeInsight({
        id: 'resolved_1',
        severity: 'warning',
        resolutionStatus: 'resolved',
        resolvedAt: '2026-05-20T00:00:00.000Z',
        resolutionNote: 'Fixed title duplication',
      }),
    ]);

    const result = await generateMonthlyDigest(ws);

    expect(result.metrics.clicksChange).toBe(0);
    expect(result.metrics.impressionsChange).toBe(0);
    expect(result.metrics.avgPositionChange).toBe(0);
    expect(result.summary).toContain('2 performance wins');
    expect(result.summary).toContain('1 optimization was completed');
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('caps the current UTC month at the conservative GSC reporting cutoff', async () => {
    const ws = makeWorkspace({ id: 'ws_current_month_cutoff' });

    const result = await generateMonthlyDigest(ws);

    expect(result.month).toBe('May 2026');
    expect(result.period.start).toBe('2026-05-01T00:00:00.000Z');
    expect(result.period.end).toBe('2026-05-22T23:59:59.999Z');
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith(
      'wf_1',
      'sc-domain:example.com',
      28,
      { startDate: '2026-05-01', endDate: '2026-05-22' },
    );
    expect(mocks.getGA4PeriodComparison).toHaveBeenCalledWith(
      'ga4_1',
      28,
      { startDate: '2026-05-01', endDate: '2026-05-22' },
    );
  });

  it('starts a fresh current-month computation when the UTC reporting cutoff advances', async () => {
    const ws = makeWorkspace({ id: 'ws_current_month_daily_identity' });

    const first = await generateMonthlyDigest(ws);
    expect(first.period.end).toBe('2026-05-22T23:59:59.999Z');

    vi.setSystemTime(new Date('2026-05-26T00:05:00.000Z'));
    const second = await generateMonthlyDigest(ws);

    expect(second.period.end).toBe('2026-05-23T23:59:59.999Z');
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
    expect(mocks.getSearchPeriodComparison).toHaveBeenNthCalledWith(
      2,
      'wf_1',
      'sc-domain:example.com',
      28,
      { startDate: '2026-05-01', endDate: '2026-05-23' },
    );
  });

  it('floors the current-month reporting cutoff at day one', async () => {
    vi.setSystemTime(new Date('2026-05-02T12:00:00.000Z'));
    const ws = makeWorkspace({ id: 'ws_current_month_day_one_floor' });

    const result = await generateMonthlyDigest(ws);

    expect(result.period.start).toBe('2026-05-01T00:00:00.000Z');
    expect(result.period.end).toBe('2026-05-01T23:59:59.999Z');
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith(
      'wf_1',
      'sc-domain:example.com',
      28,
      { startDate: '2026-05-01', endDate: '2026-05-01' },
    );
  });

  it('uses full slice rollups for resolved items beyond the prompt-facing top-100 cap', async () => {
    const ws = makeWorkspace({
      id: 'ws_full_rollup',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });

    const topCapped = Array.from({ length: 100 }, (_, i) =>
      makeInsight({
        id: `top_${i}`,
        severity: 'positive',
        impactScore: 200 - i,
        pageTitle: `Top ${i}`,
      }),
    );
    mocks.getInsights.mockReturnValue([
      ...topCapped,
      makeInsight({
        id: 'resolved_beyond_cap',
        insightType: 'page_health',
        severity: 'warning',
        impactScore: -1,
        resolutionStatus: 'resolved',
        resolvedAt: '2026-05-20T00:00:00.000Z',
        resolutionNote: 'Fixed late issue',
      }),
    ]);

    const result = await generateMonthlyDigest(ws);

    expect(result.metrics.pagesOptimized).toBe(1);
    expect(result.issuesAddressed).toEqual([
      expect.objectContaining({
        insightId: 'resolved_beyond_cap',
        detail: 'Fixed late issue',
      }),
    ]);
  });

  it('offers only current-month deterministic clause IDs and excludes lifetime learnings totals', async () => {
    const ws = makeWorkspace({ id: 'ws_prompt_contract' });

    mocks.getGA4PeriodComparison.mockResolvedValueOnce({
      changePercent: { sessions: 14.2 },
    });
    mocks.learningsTotal = 7;
    mocks.learningsPromptContext = '[Workspace Intelligence]\n## Outcome Learnings (7 tracked outcomes, high confidence)\nLearning A: concise headlines improve CTR.';
    mocks.getInsights.mockReturnValue([
      makeInsight({ id: 'pos_1', severity: 'positive', impactScore: 95, pageTitle: 'Pricing page' }),
      makeInsight({ id: 'pos_2', severity: 'positive', impactScore: 85, pageTitle: 'Services page' }),
    ]);

    await generateMonthlyDigest(ws);

    await vi.waitFor(() => {
      expect(mocks.callAI).toHaveBeenCalledTimes(1);
    });
    const callArgs = mocks.callAI.mock.calls[0][0] as {
      operation?: string;
      messages: Array<{ role: string; content: string }>;
      maxTokens?: number;
    };
    const prompt = callArgs.messages[0]?.content ?? '';

    expect(callArgs.operation).toBe('monthly-digest');
    expect(callArgs.maxTokens).toBe(200);
    expect(prompt).toContain('Return exactly one JSON object');
    expect(prompt).toContain('"clauseIds"');
    expect(prompt).toContain('metric.search.clicks');
    expect(prompt).toContain('Search clicks increased 12.5% in the current reporting window.');
    expect(prompt).toContain('metric.search.impressions');
    expect(prompt).toContain('Search impressions decreased 4.2% in the current reporting window.');
    expect(prompt).toContain('metric.analytics.sessions');
    expect(prompt).toContain('Site sessions increased 14.2% in the current reporting window.');
    expect(prompt).toContain('work.activity');
    expect(prompt).not.toContain('Voice rules');
    expect(mocks.buildRecommendationGenerationContext).not.toHaveBeenCalled();
    expect(prompt).not.toContain('tracked outcomes in workspace learnings');
    expect(prompt).not.toContain('Workspace outcome learnings:');
    expect(prompt).not.toContain('Learning A: concise headlines improve CTR.');
    expect(prompt).not.toContain('Pricing page');
  });

  it('lets AI select and order available clauses while rendering exact server-owned sentences', async () => {
    const ws = makeWorkspace({ id: 'ws_grounded_ai_summary' });
    mocks.callAI.mockResolvedValueOnce({
      text: JSON.stringify({
        clauseIds: ['metric.search.impressions', 'metric.search.clicks'],
      }),
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toBe(
      'Search impressions decreased 4.2% in the current reporting window. Search clicks increased 12.5% in the current reporting window.',
    );
  });

  it('renders selected provider metrics at one-decimal precision', async () => {
    const ws = makeWorkspace({ id: 'ws_prompt_precision_metrics' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: 12.54, impressions: -4.24 },
      change: { position: -1.27 },
    });
    mocks.callAI.mockResolvedValueOnce({
      text: JSON.stringify({
        clauseIds: ['metric.search.clicks', 'metric.search.impressions'],
      }),
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toBe(DEFAULT_SELECTED_SUMMARY);
  });

  it('renders measured ROI without live providers and preserves mixed execution attribution', async () => {
    const ws = makeWorkspace({
      id: 'ws_prompt_precision_value',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });
    mocks.getROIHighlights.mockReturnValueOnce([
      {
        pageTitle: 'Platform page',
        pageUrl: '/platform',
        action: 'Updated pricing-page metadata',
        result: 'Position improved',
        clicksGained: 20,
        attributedValue: 80.126,
        attribution: 'platform_executed',
      },
      {
        pageTitle: 'Client-built page',
        pageUrl: '/client-built',
        action: 'Published new page',
        result: 'Position improved',
        clicksGained: 10,
        attributedValue: 40,
        attribution: 'externally_executed',
      },
    ]);
    mocks.callAI.mockResolvedValueOnce({
      text: JSON.stringify({
        clauseIds: ['roi.measured-results', 'reporting.scope'],
      }),
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toBe(
      '2 measured results were recorded with $120.13 in total estimated value; 1 followed work implemented through the platform, and 1 followed work implemented on the client side. Current-month evidence for May 2026 is available for review.',
    );
  });

  it('rejects unsupported word-form and qualitative performance claims', async () => {
    const ws = makeWorkspace({ id: 'ws_unsupported_qualitative_claims' });
    const summary = 'Revenue doubled this month. Conversions surged across the site.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks increased 12\.5%/i);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('rejects a spelled-out provider magnitude that contradicts numeric evidence', async () => {
    const ws = makeWorkspace({ id: 'ws_unsupported_spelled_metric' });
    const summary = 'Search clicks increased ninety-nine percent. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks increased 12\.5%/i);
  });

  it('rejects a spelled-out ranking magnitude that contradicts position evidence', async () => {
    const ws = makeWorkspace({ id: 'ws_unsupported_spelled_position' });
    const summary = 'Average search position improved ninety-nine spots. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('rejects a spelled-out currency magnitude that contradicts attributed value', async () => {
    const ws = makeWorkspace({ id: 'ws_unsupported_spelled_value' });
    mocks.getROIHighlights.mockReturnValueOnce([{
      pageTitle: 'Pricing page',
      pageUrl: '/pricing',
      action: 'Updated pricing-page metadata',
      result: 'Search clicks increased 12.5%',
      clicksGained: 20,
      attributedValue: 80.13,
      attribution: 'platform_executed',
    }]);
    const summary = 'Estimated value reached nine hundred dollars. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('binds site-traffic direction to GA4 sessions instead of an unrelated positive metric', async () => {
    const ws = makeWorkspace({ id: 'ws_site_traffic_direction' });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: -12.3 } });
    const summary = 'Site traffic increased this month. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('rejects site traffic when analytics evidence is unavailable', async () => {
    const ws = makeWorkspace({ id: 'ws_site_traffic_without_analytics', ga4PropertyId: undefined });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -12.5, impressions: -4.2 },
      change: { position: 1.3 },
    });
    const summary = 'Site traffic increased this month. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('rejects search metrics when search-provider evidence is unavailable', async () => {
    const ws = makeWorkspace({ id: 'ws_clicks_without_search', gscPropertyUrl: undefined });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: 14.2 } });
    const summary = 'Search clicks increased this month. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('rejects analytics metrics when only non-provider operational evidence exists', async () => {
    const ws = makeWorkspace({
      id: 'ws_sessions_without_analytics',
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });
    mocks.getInsights.mockReturnValueOnce([makeInsight({ id: 'operational-win', severity: 'positive' })]);
    const summary = 'Site sessions increased this month. A performance win was identified.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('binds search visibility direction to impressions', async () => {
    const ws = makeWorkspace({ id: 'ws_search_visibility_direction' });
    const summary = 'Search visibility increased this month. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('rejects a qualitative metric that is absent from the evidence', async () => {
    const ws = makeWorkspace({ id: 'ws_unsupported_conversion_claim' });
    const summary = 'Conversions improved across your site. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('does not treat a topic mention as measured authority for an unsupported metric', async () => {
    const ws = makeWorkspace({ id: 'ws_conversion_topic_not_measurement' });
    mocks.getInsights.mockReturnValueOnce([makeInsight({
      id: 'conversion-topic',
      pageTitle: 'Conversion rate optimization',
      severity: 'positive',
    })]);
    const summary = 'Conversion rate improved across your site. The latest signals identify where attention is useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('rejects an unsupported spelled-out evidence count', async () => {
    const ws = makeWorkspace({ id: 'ws_unsupported_word_count' });
    const summary = 'Ninety-nine wins were recorded this month. Current-month evidence is ready for review.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks increased 12\.5%/i);
  });

  it('does not accept prose even when every prose claim is factually supported', async () => {
    const ws = makeWorkspace({ id: 'ws_summary_abbreviation' });
    const summary = 'U.S. Search clicks increased 12.5%. Impressions decreased 4.2%. Your latest signals identify where attention is most useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toBe(DEFAULT_FALLBACK_SUMMARY);
  });

  it.each([
    ['one sentence', 'Your current-month evidence is ready for review.'],
    ['four sentences', 'Evidence is ready. Signals are available. Your pages are represented. Attention areas are clear.'],
    ['an agency commitment', "Search clicks increased 12.5%. We're working on the next round."],
    ['a planned agency commitment', 'Search clicks increased 12.5%. We plan to optimize the next round.'],
    ['an unsupported number', 'Search clicks increased 99%. Your current-month evidence is ready for review.'],
  ])('falls back when AI returns %s', async (label, summary) => {
    const ws = makeWorkspace({ id: `ws_invalid_summary_${label.replaceAll(' ', '_')}` });
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks increased 12\.5%/i);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"clauseIds":'],
    ['unknown ID', JSON.stringify({ clauseIds: ['metric.search.clicks', 'metric.search.unknown'] })],
    ['duplicate ID', JSON.stringify({ clauseIds: ['metric.search.clicks', 'metric.search.clicks'] })],
    ['unavailable ID', JSON.stringify({ clauseIds: ['metric.search.clicks', 'metric.analytics.sessions'] })],
    ['too few IDs', JSON.stringify({ clauseIds: ['metric.search.clicks'] })],
    ['too many IDs', JSON.stringify({ clauseIds: ['metric.search.clicks', 'metric.search.impressions', 'metric.search.position', 'reporting.scope'] })],
    ['model-authored prose field', JSON.stringify({
      clauseIds: ['metric.search.clicks', 'metric.search.impressions'],
      summary: 'Revenue doubled.',
    })],
  ])('falls back to server-selected clauses for %s', async (_label, modelOutput) => {
    const ws = makeWorkspace({ id: `ws_invalid_clause_selection_${Math.random().toString(36).slice(2, 8)}` });
    mocks.callAI.mockResolvedValueOnce({ text: modelOutput });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toBe(DEFAULT_FALLBACK_SUMMARY);
    expect(result.summary).not.toContain('Revenue doubled');
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('does not let an unrelated count authorize a false metric percentage', async () => {
    const ws = makeWorkspace({ id: 'ws_numeric_count_collision' });
    mocks.getInsights.mockReturnValue(Array.from({ length: 5 }, (_, index) => (
      makeInsight({ id: `collision-win-${index}`, pageTitle: `Winning page ${index}` })
    )));
    const summary = 'Search clicks increased 5%. Your current-month evidence is ready for review.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks increased 12\.5%/i);
  });

  it('does not let an opposite-signed metric authorize a false explicit delta', async () => {
    const ws = makeWorkspace({ id: 'ws_numeric_sign_collision' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -12.5, impressions: -4.2 },
      change: { position: 1.27 },
    });
    const summary = 'Search clicks were +12.5% in the reporting window. Your current-month evidence is ready for review.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks decreased 12\.5%/i);
  });

  it('applies one coordinated direction predicate to every named metric', async () => {
    const ws = makeWorkspace({ id: 'ws_coordinated_metric_direction' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -12.5, impressions: 4.2 },
      change: { position: 0 },
    });
    const summary = 'Search clicks and impressions increased. Your current-month evidence is ready for review.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks decreased 12\.5%/i);
  });

  it('does not allow metric values to swap contexts within one sentence', async () => {
    const ws = makeWorkspace({ id: 'ws_swapped_metric_values' });
    const summary = 'Search clicks increased 4.2%, while impressions decreased 12.5%. Your latest signals identify where attention is most useful.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks increased 12\.5%/i);
  });

  it('does not allow count values to swap their labels', async () => {
    const ws = makeWorkspace({
      id: 'ws_swapped_count_values',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });
    mocks.getInsights.mockReturnValue([
      ...Array.from({ length: 5 }, (_, index) => (
        makeInsight({ id: `count-win-${index}`, pageTitle: `Winning page ${index}` })
      )),
      ...Array.from({ length: 2 }, (_, index) => makeInsight({
        id: `count-resolution-${index}`,
        insightType: 'page_health',
        severity: 'warning',
        resolutionStatus: 'resolved',
        resolvedAt: '2026-05-20T00:00:00.000Z',
        pageId: `/resolved-${index}`,
        pageTitle: `Resolved page ${index}`,
      })),
    ]);
    const summary = 'Your site recorded 2 performance wins and 5 optimizations. Current-month evidence is ready for review.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toContain('5 performance wins');
    expect(result.summary).toContain('2 optimizations were completed');
  });

  it('recognizes progressive direction words instead of letting a decline read as growth', async () => {
    const ws = makeWorkspace({ id: 'ws_progressive_direction' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -12.5, impressions: -4.2 },
      change: { position: 1.27 },
    });
    const summary = 'Search clicks are increasing. Current-month evidence is ready for review.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks decreased 12\.5%/i);
  });

  it.each([
    'Site traffic exploded this month. The latest signals identify where attention is useful.',
    'Search clicks jumped this month. The latest signals identify where attention is useful.',
    'Search visibility expanded this month. The latest signals identify where attention is useful.',
  ])('rejects an unrecognized change verb instead of accepting it as directionless: %s', async (summary) => {
    const ws = makeWorkspace({ id: `ws_unrecognized_direction_${Math.random().toString(36).slice(2, 8)}` });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -12.5, impressions: -4.2 },
      change: { position: 1.3 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: -9.4 } });
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('does not accept free prose for separately grounded directions', async () => {
    const ws = makeWorkspace({ id: 'ws_separate_metric_directions' });
    const summary = 'Search clicks increased 12.5%. Impressions decreased 4.2%.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toBe(DEFAULT_FALLBACK_SUMMARY);
  });

  it('falls back when AI reverses a provider metric direction', async () => {
    const ws = makeWorkspace({ id: 'ws_wrong_direction_summary' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -24.6, impressions: -8.1 },
      change: { position: 2.4 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: -12.3 } });
    const summary = 'Search clicks increased 24.6% in the reporting window. Your traffic is moving in the right direction.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/search clicks decreased 24\.6%/i);
  });

  it('falls back when zero provider evidence is recast as momentum', async () => {
    const ws = makeWorkspace({ id: 'ws_zero_recast_summary' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: 0, impressions: 0 },
      change: { position: 0 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: 0 } });
    const summary = 'Your site has strong momentum. Performance is moving in the right direction.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/no percentage change was recorded/i);
  });

  it('does not let completed work authorize performance momentum when measured results are flat', async () => {
    const ws = makeWorkspace({ id: 'ws_flat_metrics_completed_work' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: 0, impressions: 0 },
      change: { position: 0 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: 0 } });
    mocks.getInsights.mockReturnValueOnce([makeInsight({
      id: 'resolved-work',
      insightType: 'page_health',
      severity: 'warning',
      resolutionStatus: 'resolved',
      resolvedAt: '2026-05-20T00:00:00.000Z',
      pageTitle: 'Resolved page',
    })]);
    const summary = 'Your site has strong momentum. One optimization was completed.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).not.toMatch(/strong momentum/i);
    expect(result.summary).toMatch(/1 optimization was completed/i);
  });

  it('does not let one negligible gain recast a materially negative mixed period as momentum', async () => {
    const ws = makeWorkspace({ id: 'ws_mixed_negative_momentum' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: 0.1, impressions: -50 },
      change: { position: 10 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({ changePercent: { sessions: -30 } });
    const summary = 'Your site has strong momentum. Performance is moving in the right direction.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).not.toMatch(/strong momentum|right direction/i);
  });

  it('falls back instead of assigning agency execution credit to client-side work', async () => {
    const ws = makeWorkspace({ id: 'ws_external_credit_summary' });
    mocks.getROIHighlights.mockReturnValueOnce([{
      pageTitle: 'Client-built page',
      pageUrl: '/client-built',
      action: 'Published new post',
      result: 'Position improved',
      clicksGained: 20,
      attributedValue: 80,
      attribution: 'externally_executed',
    }]);
    const summary = "Our work drove the implementation for the client-built page. Your site's measured result is now recorded.";
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/implemented on the client side/i);
  });

  it('treats third-person agency execution language as false credit for client-side work', async () => {
    const ws = makeWorkspace({ id: 'ws_external_credit_third_person' });
    mocks.getROIHighlights.mockReturnValueOnce([{
      pageTitle: 'Client-built page',
      pageUrl: '/client-built',
      action: 'Published new post',
      result: 'Position improved',
      clicksGained: 20,
      attributedValue: 80,
      attribution: 'externally_executed',
    }]);
    const summary = 'The agency implemented the client-built page. Its measured result is now recorded.';
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/implemented on the client side/i);
  });

  it.each([
    'We led the implementation of the pricing page. Its measured result is now recorded.',
    'Our team brought the pricing page live. Its measured result is now recorded.',
    'We took care of publishing the pricing page. Its measured result is now recorded.',
    'The agency was responsible for the launch of the pricing page. Its measured result is now recorded.',
    'The studio implemented the pricing page. Its measured result is now recorded.',
    `${STUDIO_NAME} implemented the pricing page. Its measured result is now recorded.`,
    `The ${STUDIO_NAME} team implemented the pricing page. Its measured result is now recorded.`,
    `${new URL(STUDIO_URL).hostname} implemented the pricing page. Its measured result is now recorded.`,
    `The ${new URL(STUDIO_URL).hostname} team implemented the pricing page. Its measured result is now recorded.`,
    'We helped publish the pricing page. Its measured result is now recorded.',
    'We helped the client launch the pricing page. Its measured result is now recorded.',
    'We oversaw the pricing page implementation. Its measured result is now recorded.',
  ])('rejects external execution credit phrased as: %s', async (summary) => {
    const ws = makeWorkspace({ id: `ws_external_credit_${Math.random().toString(36).slice(2, 8)}` });
    mocks.getROIHighlights.mockReturnValueOnce([{
      pageTitle: 'Pricing page',
      pageUrl: '/pricing',
      action: 'Published new page',
      result: 'Position improved',
      clicksGained: 20,
      attributedValue: 80,
      attribution: 'externally_executed',
    }]);
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
    expect(result.summary).toMatch(/implemented on the client side/i);
  });

  it('renders external execution only from the server-owned ROI clause', async () => {
    const ws = makeWorkspace({ id: 'ws_honest_external_credit' });
    mocks.getROIHighlights.mockReturnValueOnce([{
      pageTitle: 'Pricing page',
      pageUrl: '/pricing',
      action: 'Published new page',
      result: 'Position improved',
      clicksGained: 20,
      attributedValue: 80,
      attribution: 'externally_executed',
    }]);
    mocks.callAI.mockResolvedValueOnce({
      text: JSON.stringify({ clauseIds: ['roi.measured-results', 'reporting.scope'] }),
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toBe(
      '1 measured result was recorded with $80.00 in total estimated value; 1 followed work implemented on the client side. Current-month evidence for May 2026 is available for review.',
    );
  });

  it('renders mixed platform and client execution from one aggregate ROI clause', async () => {
    const ws = makeWorkspace({ id: 'ws_mixed_execution_credit' });
    mocks.getROIHighlights.mockReturnValueOnce([
      {
        pageTitle: 'Platform page',
        pageUrl: '/platform',
        action: 'Published new page',
        result: 'Position improved',
        clicksGained: 20,
        attributedValue: 80,
        attribution: 'platform_executed',
      },
      {
        pageTitle: 'Client-built page',
        pageUrl: '/client-built',
        action: 'Published new page',
        result: 'Position improved',
        clicksGained: 10,
        attributedValue: 40,
        attribution: 'externally_executed',
      },
    ]);
    mocks.callAI.mockResolvedValueOnce({
      text: JSON.stringify({ clauseIds: ['roi.measured-results', 'reporting.scope'] }),
    });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toBe(
      '2 measured results were recorded with $120.00 in total estimated value; 1 followed work implemented through the platform, and 1 followed work implemented on the client side. Current-month evidence for May 2026 is available for review.',
    );
  });

  it.each([
    'Search clicks increased 12.5%. We continue to optimize the next round.',
    'Search clicks increased 12.5%. Our team is working on the next round.',
    'Search clicks increased 12.5%. We are optimizing the next round.',
  ])('rejects unsupported agency work commitments phrased as: %s', async (summary) => {
    const ws = makeWorkspace({ id: `ws_commitment_${Math.random().toString(36).slice(2, 8)}` });
    mocks.callAI.mockResolvedValueOnce({ text: summary });

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).not.toBe(summary);
  });

  it('uses a metric-aware fallback for provider declines when AI fails', async () => {
    const ws = makeWorkspace({ id: 'ws_declining_provider_fallback' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: -24.6, impressions: -8.1 },
      change: { position: 2.4 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({
      changePercent: { sessions: -12.3 },
    });
    mocks.callAI.mockRejectedValueOnce(new Error('AI unavailable'));

    const result = await generateMonthlyDigest(ws);

    expect(result.availability).toBe('ready');
    expect(result.summary).toMatch(/search clicks (?:decreased|declined) 24\.6%/i);
    expect(result.summary).not.toMatch(/held steady|solid baseline|momentum|good signals|on track/i);
  });

  it('uses an honest metric-aware fallback for fulfilled zero-valued provider evidence', async () => {
    const ws = makeWorkspace({ id: 'ws_zero_provider_fallback' });
    mocks.getSearchPeriodComparison.mockResolvedValueOnce({
      changePercent: { clicks: 0, impressions: 0 },
      change: { position: 0 },
    });
    mocks.getGA4PeriodComparison.mockResolvedValueOnce({
      changePercent: { sessions: 0 },
    });
    mocks.callAI.mockResolvedValueOnce({ text: '   ' });

    const result = await generateMonthlyDigest(ws);

    expect(result.availability).toBe('ready');
    expect(result.summary).toMatch(/no percentage change was recorded/i);
    expect(result.summary).not.toMatch(/held steady|solid baseline/i);
  });

  it('treats current-month warning and opportunity insights as evidence in the prompt and fallback', async () => {
    const ws = makeWorkspace({
      id: 'ws_attention_signal_evidence',
      webflowSiteId: undefined,
      gscPropertyUrl: undefined,
      ga4PropertyId: undefined,
    });
    mocks.getInsights.mockReturnValue([
      makeInsight({
        id: 'warning-signal',
        insightType: 'page_health',
        severity: 'warning',
        pageTitle: 'Checkout page',
        computedAt: '2026-05-20T00:00:00.000Z',
      }),
      makeInsight({
        id: 'opportunity-signal',
        insightType: 'ranking_opportunity',
        severity: 'opportunity',
        pageTitle: 'Pricing page',
        computedAt: '2026-05-21T00:00:00.000Z',
      }),
    ]);
    mocks.callAI.mockRejectedValueOnce(new Error('AI unavailable'));

    const result = await generateMonthlyDigest(ws);
    const prompt = (mocks.callAI.mock.calls[0]?.[0] as {
      messages?: Array<{ content: string }>;
    } | undefined)?.messages?.[0]?.content ?? '';

    expect(result.availability).toBe('ready');
    expect(prompt).toContain('attention.signals');
    expect(prompt).toContain('2 current-month signals require attention');
    expect(prompt).not.toContain('Checkout page');
    expect(prompt).not.toContain('Pricing page');
    expect(result.summary).toMatch(/2 current-month signals require attention/i);
    expect(result.summary).not.toMatch(/held steady|solid baseline/i);
  });

  it('offers one deterministic ROI clause with explicit external and unknown execution framing', async () => {
    const ws = makeWorkspace({ id: 'ws_roi_execution_prompt' });
    mocks.getROIHighlights.mockReturnValue([
      {
        pageTitle: 'Client-built page',
        pageUrl: '/client-built',
        action: 'Published new post',
        result: 'Win (+20%)',
        clicksGained: 20,
        attributedValue: 80,
        attribution: 'externally_executed',
      },
      {
        pageTitle: 'Legacy page',
        pageUrl: '/legacy',
        action: 'Updated meta description',
        result: 'Win (+10%)',
        clicksGained: 10,
        attributedValue: 40,
      },
    ]);

    await generateMonthlyDigest(ws);

    const prompt = (mocks.callAI.mock.calls[0]?.[0] as {
      messages?: Array<{ content: string }>;
    } | undefined)?.messages?.[0]?.content ?? '';
    expect(prompt).toContain('roi.measured-results');
    expect(prompt).toContain('$120.00 in total estimated value');
    expect(prompt).toContain('1 followed work implemented on the client side');
    expect(prompt).toContain('execution attribution is unavailable for 1');
    expect(prompt).not.toContain('do not claim agency execution credit');
  });

  it('uses fallback summary when AI returns an empty text payload', async () => {
    const ws = makeWorkspace({ id: 'ws_empty_ai' });

    mocks.callAI.mockResolvedValueOnce({ text: '' });
    mocks.getInsights.mockReturnValue([makeInsight({ id: 'win_only', severity: 'positive' })]);

    const result = await generateMonthlyDigest(ws);

    expect(result.summary).toContain('1 performance win spotted on your site this period');
  });

  it('coalesces concurrent requests for same workspace/month into one AI call', async () => {
    const ws = makeWorkspace({ id: 'ws_dedup' });

    let resolveAI: ((value: { text: string }) => void) | null = null;
    mocks.callAI.mockImplementation(
      () => new Promise<{ text: string }>(resolve => {
        resolveAI = resolve;
      }),
    );

    const first = generateMonthlyDigest(ws);
    const second = generateMonthlyDigest(ws);

    await vi.waitFor(() => {
      expect(mocks.callAI).toHaveBeenCalledTimes(1);
    });

    resolveAI?.({ text: VALID_AI_SUMMARY });

    const [a, b] = await Promise.all([first, second]);
    expect(a.summary).toBe(DEFAULT_SELECTED_SUMMARY);
    expect(b.summary).toBe(DEFAULT_SELECTED_SUMMARY);
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('invalidates every cached month for only the requested workspace', async () => {
    const invalidatedWorkspace = makeWorkspace({ id: 'ws_cache_invalidate' });
    const otherWorkspace = makeWorkspace({ id: 'ws_cache_other' });

    mocks.callAI
      .mockResolvedValueOnce({ text: VALID_AI_SUMMARY })
      .mockResolvedValueOnce({ text: JSON.stringify({ clauseIds: ['metric.search.position', 'reporting.scope'] }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ clauseIds: ['metric.search.impressions', 'reporting.scope'] }) });

    await generateMonthlyDigest(invalidatedWorkspace);
    await generateMonthlyDigest(otherWorkspace);
    invalidateMonthlyDigestCache(invalidatedWorkspace.id);

    const fresh = await generateMonthlyDigest(invalidatedWorkspace);
    const stillCached = await generateMonthlyDigest(otherWorkspace);

    expect(fresh.summary).toBe(IMPRESSIONS_SCOPE_SUMMARY);
    expect(stillCached.summary).toBe(POSITION_SCOPE_SUMMARY);
    expect(mocks.callAI).toHaveBeenCalledTimes(3);
  });

  it('does not let an invalidated in-flight computation repopulate stale cache', async () => {
    const ws = makeWorkspace({ id: 'ws_inflight_invalidation' });
    const resolvers: Array<(value: { text: string }) => void> = [];
    mocks.callAI.mockImplementation(
      () => new Promise<{ text: string }>(resolve => {
        resolvers.push(resolve);
      }),
    );

    const staleRequest = generateMonthlyDigest(ws);
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    invalidateMonthlyDigestCache(ws.id);
    const freshRequest = generateMonthlyDigest(ws);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[1]({
      text: JSON.stringify({ clauseIds: ['metric.search.impressions', 'reporting.scope'] }),
    });
    expect((await freshRequest).summary).toBe(IMPRESSIONS_SCOPE_SUMMARY);

    resolvers[0]({ text: VALID_AI_SUMMARY });
    expect((await staleRequest).summary).toBe(DEFAULT_SELECTED_SUMMARY);

    const cachedAfterRace = await generateMonthlyDigest(ws);
    expect(cachedAfterRace.summary).toBe(IMPRESSIONS_SCOPE_SUMMARY);
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
  });
});
