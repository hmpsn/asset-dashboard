import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
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
  buildSystemPrompt: vi.fn(),
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

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

const { generateMonthlyDigest } = await import('../../server/monthly-digest.js');
const { invalidateMonthlyDigestCache } = await import('../../server/monthly-digest-cache.js');

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
  mocks.callAI.mockResolvedValue({ text: 'AI summary text' });
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
  mocks.buildSystemPrompt.mockReturnValue('system prompt');
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

  it('keeps the AI prompt current-month scoped and excludes lifetime learnings totals', async () => {
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
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = callArgs.messages[0]?.content ?? '';

    expect(prompt).toContain('Voice rules (follow exactly):');
    expect(prompt).toContain('Lead with the most interesting metric or outcome');
    expect(mocks.buildRecommendationGenerationContext).not.toHaveBeenCalled();
    expect(prompt).not.toContain('tracked outcomes in workspace learnings');
    expect(prompt).not.toContain('Workspace outcome learnings:');
    expect(prompt).not.toContain('Learning A: concise headlines improve CTR.');
    expect(prompt).toContain('Notable wins this period:');
    expect(prompt).toContain('- Pricing page');
    expect(prompt).toContain('Search clicks: +12.5%');
    expect(prompt).toContain('Impressions: -4.2%');
    expect(prompt).toContain('Site sessions: +14.2%');
    expect(prompt).toContain('Average ranking position: improved 1.3 spots');
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
    expect(prompt).toContain('Signals requiring attention this period:');
    expect(prompt).toContain('Checkout page');
    expect(prompt).toContain('Pricing page');
    expect(result.summary).toMatch(/2 current-month signals require attention/i);
    expect(result.summary).not.toMatch(/held steady|solid baseline/i);
  });

  it('gives every ROI prompt row explicit execution framing without crediting unknown attribution', async () => {
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
    expect(prompt).toContain('implemented on the client side');
    expect(prompt).toContain('do not claim agency execution credit');
    expect(prompt).toContain('execution attribution unavailable');
    expect(prompt).toContain('do not assign execution credit');
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

    resolveAI?.({ text: 'Shared summary' });

    const [a, b] = await Promise.all([first, second]);
    expect(a.summary).toBe('Shared summary');
    expect(b.summary).toBe('Shared summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('invalidates every cached month for only the requested workspace', async () => {
    const invalidatedWorkspace = makeWorkspace({ id: 'ws_cache_invalidate' });
    const otherWorkspace = makeWorkspace({ id: 'ws_cache_other' });

    mocks.callAI
      .mockResolvedValueOnce({ text: 'Original invalidated summary' })
      .mockResolvedValueOnce({ text: 'Other workspace summary' })
      .mockResolvedValueOnce({ text: 'Fresh invalidated summary' });

    await generateMonthlyDigest(invalidatedWorkspace);
    await generateMonthlyDigest(otherWorkspace);
    invalidateMonthlyDigestCache(invalidatedWorkspace.id);

    const fresh = await generateMonthlyDigest(invalidatedWorkspace);
    const stillCached = await generateMonthlyDigest(otherWorkspace);

    expect(fresh.summary).toBe('Fresh invalidated summary');
    expect(stillCached.summary).toBe('Other workspace summary');
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

    resolvers[1]({ text: 'Fresh summary' });
    expect((await freshRequest).summary).toBe('Fresh summary');

    resolvers[0]({ text: 'Stale summary' });
    expect((await staleRequest).summary).toBe('Stale summary');

    const cachedAfterRace = await generateMonthlyDigest(ws);
    expect(cachedAfterRace.summary).toBe('Fresh summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
  });
});
