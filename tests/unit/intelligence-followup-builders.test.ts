import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import {
  buildAdminChatIntelligenceContext,
  selectAdminChatSlices,
} from '../../server/intelligence/admin-chat-context-builder.js';
import {
  buildDiagnosticIntelligenceContext,
  resolveDiagnosticAnomalyInsight,
} from '../../server/intelligence/diagnostic-context-builder.js';
import { buildPageAssistContext } from '../../server/intelligence/page-assist-context-builder.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
} from '../../server/workspace-intelligence.js';
import {
  formatKeywordsForPrompt,
  formatKnowledgeBaseForPrompt,
  formatPageMapForPrompt,
} from '../../server/intelligence/formatters.js';
import { formatPersonasForPrompt } from '../../server/intelligence/persona-format.js';

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
  formatForPrompt: vi.fn(),
  formatPageMapForPrompt: vi.fn(() => '[Page Map]'),
}));

vi.mock('../../server/intelligence/formatters.js', () => ({
  formatKeywordsForPrompt: vi.fn(),
  formatKnowledgeBaseForPrompt: vi.fn(),
  formatPageMapForPrompt: vi.fn(),
}));

vi.mock('../../server/intelligence/persona-format.js', () => ({
  formatPersonasForPrompt: vi.fn(),
}));

const anomalyInsight: AnalyticsInsight<'anomaly_digest'> = {
  id: 'insight-anomaly',
  workspaceId: 'ws-test',
  insightType: 'anomaly_digest',
  severity: 'critical',
  title: 'Traffic dropped',
  description: 'Traffic dropped',
  impactScore: 90,
  pageId: '/services',
  pageTitle: 'Services',
  data: {
    anomalyType: 'traffic_drop',
    metric: 'clicks',
    severity: 'critical',
    currentValue: 10,
    expectedValue: 30,
    deviationPercent: -66,
    firstDetected: '2026-05-20T00:00:00.000Z',
    durationDays: 2,
    affectedPage: '/services',
  },
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

const pageHealthInsight: AnalyticsInsight<'page_health'> = {
  id: 'insight-health',
  workspaceId: 'ws-test',
  insightType: 'page_health',
  severity: 'warning',
  title: 'Page health',
  description: 'Needs work',
  impactScore: 50,
  pageId: '/services',
  pageTitle: 'Services',
  data: {
    score: 62,
    trend: 'declining',
    clicks: 20,
    impressions: 100,
    ctr: 20,
    position: 8,
  },
  createdAt: '2026-05-20T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

const mockIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-05-20T00:00:00.000Z',
  seoContext: {
    strategy: undefined,
    brandVoice: '',
    effectiveBrandVoiceBlock: '[Voice]',
    businessContext: '',
    personas: [],
    knowledgeBase: 'Knowledge',
  },
  insights: {
    all: [anomalyInsight, pageHealthInsight],
    byType: {
      anomaly_digest: [anomalyInsight],
      page_health: [pageHealthInsight],
    },
    bySeverity: {
      critical: 1,
      warning: 1,
      opportunity: 0,
      positive: 0,
    },
    topByImpact: [anomalyInsight, pageHealthInsight],
    forPage: [pageHealthInsight],
  },
  learnings: {
    availability: 'ready',
    summary: null,
    confidence: null,
    topActionTypes: [],
    overallWinRate: 0,
    recentTrend: null,
    playbooks: [],
  },
  contentPipeline: {
    briefs: { total: 0, byStatus: {} },
    posts: { total: 0, byStatus: {} },
    matrices: { total: 0, cellsPlanned: 0, cellsPublished: 0 },
    requests: { pending: 0, inProgress: 0, delivered: 0 },
    workOrders: { active: 0 },
    coverageGaps: [],
    seoEdits: { pending: 0, applied: 0, inReview: 0 },
    rewritePlaybook: { patterns: ['Use concise proof.'] },
  },
};

describe('intelligence follow-up builders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue(mockIntelligence);
    vi.mocked(formatForPrompt).mockReturnValue('## Intelligence\nPrompt block');
    vi.mocked(formatKeywordsForPrompt).mockReturnValue('[Keywords]');
    vi.mocked(formatKnowledgeBaseForPrompt).mockReturnValue('[Knowledge]');
    vi.mocked(formatPageMapForPrompt).mockReturnValue('[Page Map]');
    vi.mocked(formatPersonasForPrompt).mockReturnValue('[Personas]');
  });

  it('selects bounded admin chat slices from question categories', () => {
    const slices = selectAdminChatSlices('How are local markets performing?', new Set(['general']));

    expect(slices).toEqual([
      'seoContext',
      'learnings',
      'operational',
      'siteHealth',
      'clientSignals',
      'insights',
      'localSeo',
    ]);
  });

  it('builds admin chat context through canonical intelligence formatting', async () => {
    const result = await buildAdminChatIntelligenceContext('ws-test', 'status report', new Set(['general']));

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-test', {
      slices: result.intelligence ? vi.mocked(buildWorkspaceIntelligence).mock.calls[0]?.[1]?.slices : [],
      learningsDomain: 'all',
      enrichWithBacklinks: true,
    });
    expect(result.workspaceContextBlock).toContain('WORKSPACE INTELLIGENCE CONTEXT');
    expect(result.learningsBlock).toContain('## Intelligence');
  });

  it('resolves diagnostic anomalies from the insights slice', async () => {
    const result = await resolveDiagnosticAnomalyInsight('ws-test', 'insight-anomaly');

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-test', {
      slices: ['insights'],
    });
    expect(result.anomalyInsight?.id).toBe('insight-anomaly');
    expect(result.allInsights).toHaveLength(2);
  });

  it('builds diagnostic intelligence with backlink enrichment and page-scoped summaries', async () => {
    const result = await buildDiagnosticIntelligenceContext('ws-test', {
      pagePath: '/services',
      currentInsightId: 'insight-anomaly',
      includeBacklinks: true,
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-test', {
      slices: ['seoContext', 'insights', 'operational', 'pageProfile'],
      pagePath: '/services',
      enrichWithBacklinks: true,
    });
    expect(result.concurrentAnomalies).toEqual([]);
    expect(result.existingInsights).toEqual([
      { type: 'page_health', severity: 'warning', summary: 'Services' },
    ]);
  });

  it('builds page assist context with option-scoped slices and reusable blocks', async () => {
    const result = await buildPageAssistContext('ws-test', {
      pageUrl: 'https://example.com/services',
      includeContentPipeline: true,
      includeInsights: true,
      includePageElements: true,
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-test', {
      slices: ['seoContext', 'pageProfile', 'pageElements', 'contentPipeline', 'insights'],
      pagePath: '/services',
      learningsDomain: undefined,
    });
    expect(result.pagePath).toBe('/services');
    expect(result.blocks.keywordBlock).toBe('[Keywords]');
    expect(result.blocks.playbookBlock).toContain('Use concise proof.');
    expect(result.blocks.pageInsightsBlock).toContain('Page health');
  });

  it('reuses a base seoContext while assembling only page-scoped slices for bulk callers', async () => {
    const result = await buildPageAssistContext('ws-test', {
      pagePath: '/services/seo',
      baseSeoContext: mockIntelligence.seoContext,
      pageKeywords: {
        pagePath: '/seo',
        pageTitle: 'SEO Services',
        primaryKeyword: 'legacy seo services',
        secondaryKeywords: ['seo consultant'],
      },
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-test', {
      slices: ['pageProfile'],
      pagePath: '/services/seo',
      learningsDomain: undefined,
    });
    expect(result.seoContext?.pageKeywords?.primaryKeyword).toBe('legacy seo services');
    expect(formatKeywordsForPrompt).toHaveBeenCalledWith(expect.objectContaining({
      pageKeywords: expect.objectContaining({ primaryKeyword: 'legacy seo services' }),
    }));
  });
});
