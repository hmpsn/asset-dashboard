import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { Workspace } from '../../server/workspaces.js';

const mocks = vi.hoisted(() => ({
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  getInsights: vi.fn(),
  getROIHighlights: vi.fn(),
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

vi.mock('../../server/roi-attribution.js', () => ({
  getROIHighlights: mocks.getROIHighlights,
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
    computedAt: '2026-05-25T00:00:00.000Z',
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
  it('computes requested month period boundaries and inverts ranking-position delta sign', async () => {
    const ws = makeWorkspace({ id: 'ws_period_math' });

    const result = await generateMonthlyDigest(ws, 'February 2024');

    expect(result.month).toBe('February 2024');
    expect(result.period.start).toMatch(/^2024-02-01T/);
    expect(result.period.end).toMatch(/^2024-02-29T/);
    expect(result.metrics.clicksChange).toBe(12.5);
    expect(result.metrics.impressionsChange).toBe(-4.2);
    expect(result.metrics.avgPositionChange).toBe(1.3);
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
        resolutionNote: 'Fixed title duplication',
      }),
    ]);

    const result = await generateMonthlyDigest(ws, 'March 2026');

    expect(result.metrics.clicksChange).toBe(0);
    expect(result.metrics.impressionsChange).toBe(0);
    expect(result.metrics.avgPositionChange).toBe(0);
    expect(result.summary).toContain('2 performance wins');
    expect(result.summary).toContain('1 optimization was completed');
    expect(mocks.logWarn).toHaveBeenCalled();
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
        resolutionNote: 'Fixed late issue',
      }),
    ]);

    const result = await generateMonthlyDigest(ws, 'July 2026');

    expect(result.metrics.pagesOptimized).toBe(1);
    expect(result.issuesAddressed).toEqual([
      expect.objectContaining({
        insightId: 'resolved_beyond_cap',
        detail: 'Fixed late issue',
      }),
    ]);
  });

  it('injects summary contract + learnings context into AI prompt when feature is enabled', async () => {
    const ws = makeWorkspace({ id: 'ws_prompt_contract' });

    mocks.isFeatureEnabled.mockImplementation((flag: string) => flag === 'outcome-ai-injection');
    mocks.learningsTotal = 7;
    mocks.learningsPromptContext = '[Workspace Intelligence]\n## Outcome Learnings (7 tracked outcomes, high confidence)\nLearning A: concise headlines improve CTR.';
    mocks.getInsights.mockReturnValue([
      makeInsight({ id: 'pos_1', severity: 'positive', impactScore: 95, pageTitle: 'Pricing page' }),
      makeInsight({ id: 'pos_2', severity: 'positive', impactScore: 85, pageTitle: 'Services page' }),
    ]);

    await generateMonthlyDigest(ws, 'April 2026');

    await vi.waitFor(() => {
      expect(mocks.callAI).toHaveBeenCalledTimes(1);
    });
    const callArgs = mocks.callAI.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = callArgs.messages[0]?.content ?? '';

    expect(prompt).toContain('Voice rules (follow exactly):');
    expect(prompt).toContain('Lead with the most interesting metric or outcome');
    expect(prompt).toContain('- 7 tracked outcomes in workspace learnings');
    expect(prompt).toContain('Workspace outcome learnings:');
    expect(prompt).toContain('Learning A: concise headlines improve CTR.');
    expect(prompt).toContain('Notable wins this period:');
    expect(prompt).toContain('- Pricing page');
    expect(prompt).toContain('Search clicks: +12.5%');
    expect(prompt).toContain('Impressions: -4.2%');
    expect(prompt).toContain('Average ranking position: improved 1.3 spots');
  });

  it('uses fallback summary when AI returns an empty text payload', async () => {
    const ws = makeWorkspace({ id: 'ws_empty_ai' });

    mocks.callAI.mockResolvedValueOnce({ text: '' });
    mocks.getInsights.mockReturnValue([makeInsight({ id: 'win_only', severity: 'positive' })]);

    const result = await generateMonthlyDigest(ws, 'May 2026');

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

    const first = generateMonthlyDigest(ws, 'June 2026');
    const second = generateMonthlyDigest(ws, 'June 2026');

    await vi.waitFor(() => {
      expect(mocks.callAI).toHaveBeenCalledTimes(1);
    });

    resolveAI?.({ text: 'Shared summary' });

    const [a, b] = await Promise.all([first, second]);
    expect(a.summary).toBe('Shared summary');
    expect(b.summary).toBe('Shared summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });
});
