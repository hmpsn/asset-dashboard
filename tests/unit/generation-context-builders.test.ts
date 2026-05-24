import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';
import {
  buildContentGenerationContext,
  buildRecommendationGenerationContext,
} from '../../server/intelligence/generation-context-builders.js';
import {
  buildWorkspaceIntelligence,
  formatForPrompt,
} from '../../server/workspace-intelligence.js';
import { listLocalSeoMarkets } from '../../server/local-seo.js';

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
  formatForPrompt: vi.fn(),
}));

vi.mock('../../server/local-seo.js', () => ({
  listLocalSeoMarkets: vi.fn(() => []),
}));

const mockIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-05-18T00:00:00.000Z',
  learnings: {
    availability: 'ready',
    summary: null,
    confidence: null,
    topActionTypes: [],
    overallWinRate: 0,
    recentTrend: null,
    playbooks: [],
  },
};

describe('generation context builders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue(mockIntelligence);
    vi.mocked(formatForPrompt).mockReturnValue('[Workspace Intelligence]');
    vi.mocked(listLocalSeoMarkets).mockReturnValue([]);
  });

  it('buildContentGenerationContext uses the default content slices and content learnings domain', async () => {
    const result = await buildContentGenerationContext('ws-content');

    expect(buildWorkspaceIntelligence).toHaveBeenCalledTimes(1);
    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-content', {
      slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline'],
      pagePath: undefined,
      learningsDomain: 'content',
      enrichWithBacklinks: undefined,
    });
    expect(formatForPrompt).toHaveBeenCalledWith(mockIntelligence, {
      verbosity: 'detailed',
      sections: vi.mocked(buildWorkspaceIntelligence).mock.calls[0]?.[1]?.slices,
      tokenBudget: undefined,
      learningsDomain: 'content',
    });
    expect(result.slices).toEqual(['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline']);
    expect(result.promptContext).toBe('[Workspace Intelligence]');
    expect(result.learningsDomain).toBe('content');
    expect(result.learningsAvailability).toBe('ready');
  });

  it('reuses the same slices reference for assembly and formatting', async () => {
    await buildRecommendationGenerationContext('ws-rec');

    const assembledSlices = vi.mocked(buildWorkspaceIntelligence).mock.calls[0]?.[1]?.slices;
    const formattedSections = vi.mocked(formatForPrompt).mock.calls[0]?.[1]?.sections;

    expect(formattedSections).toBe(assembledSlices);
  });

  it('adds pageProfile only when pagePath is provided', async () => {
    const result = await buildContentGenerationContext('ws-page', { pagePath: '/pricing' });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-page', {
      slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'pageProfile'],
      pagePath: '/pricing',
      learningsDomain: 'content',
      enrichWithBacklinks: undefined,
    });
    expect(result.pagePath).toBe('/pricing');
    expect(result.slices).toContain('pageProfile');
  });

  it('buildRecommendationGenerationContext uses siteHealth and recommendation defaults', async () => {
    const result = await buildRecommendationGenerationContext('ws-rec');

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-rec', {
      slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'siteHealth'],
      pagePath: undefined,
      learningsDomain: 'all',
      enrichWithBacklinks: undefined,
    });
    expect(formatForPrompt).toHaveBeenCalledWith(mockIntelligence, {
      verbosity: 'detailed',
      sections: vi.mocked(buildWorkspaceIntelligence).mock.calls[0]?.[1]?.slices,
      tokenBudget: undefined,
      learningsDomain: 'all',
    });
    expect(result.slices).toContain('siteHealth');
    expect(result.learningsDomain).toBe('all');
    expect(result.learningsAvailability).toBe('ready');
  });

  it('threads learningsDomain, verbosity, and tokenBudget overrides through both calls', async () => {
    await buildRecommendationGenerationContext('ws-override', {
      pagePath: '/services/seo',
      verbosity: 'compact',
      tokenBudget: 900,
      learningsDomain: 'technical',
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-override', {
      slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'siteHealth', 'pageProfile'],
      pagePath: '/services/seo',
      learningsDomain: 'technical',
      enrichWithBacklinks: undefined,
    });
    expect(formatForPrompt).toHaveBeenCalledWith(mockIntelligence, {
      verbosity: 'compact',
      sections: vi.mocked(buildWorkspaceIntelligence).mock.calls[0]?.[1]?.slices,
      tokenBudget: 900,
      learningsDomain: 'technical',
    });
  });

  it('uses explicit slice overrides without widening to builder defaults', async () => {
    const customSlices = ['seoContext', 'pageProfile'] as const;

    const result = await buildContentGenerationContext('ws-custom', {
      pagePath: '/pricing',
      slices: customSlices,
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-custom', {
      slices: customSlices,
      pagePath: '/pricing',
      learningsDomain: 'content',
      enrichWithBacklinks: undefined,
    });
    expect(formatForPrompt).toHaveBeenCalledWith(mockIntelligence, {
      verbosity: 'detailed',
      sections: customSlices,
      tokenBudget: undefined,
      learningsDomain: 'content',
    });
    expect(result.slices).toBe(customSlices);
  });

  it('adds localSeo to explicit slice overrides when active local markets exist', async () => {
    vi.mocked(listLocalSeoMarkets).mockReturnValue([
      {
        id: 'market-1',
        workspaceId: 'ws-local',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        status: 'active',
        source: 'admin_override',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ]);

    const result = await buildContentGenerationContext('ws-local', {
      slices: ['seoContext'],
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-local', {
      slices: ['seoContext', 'localSeo'],
      pagePath: undefined,
      learningsDomain: 'content',
      enrichWithBacklinks: undefined,
    });
    expect(result.slices).toEqual(['seoContext', 'localSeo']);
  });

  it('allows page-only callers to opt out of localSeo widening', async () => {
    vi.mocked(listLocalSeoMarkets).mockReturnValue([
      {
        id: 'market-1',
        workspaceId: 'ws-local',
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        status: 'active',
        source: 'admin_override',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ]);

    await buildContentGenerationContext('ws-local', {
      pagePath: '/services',
      slices: ['pageProfile'],
      includeLocalSeo: false,
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-local', {
      slices: ['pageProfile'],
      pagePath: '/services',
      learningsDomain: 'content',
      enrichWithBacklinks: undefined,
    });
  });

  it('surfaces not_requested learnings availability when the learnings slice is omitted', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      ...mockIntelligence,
      learnings: undefined,
    });

    const result = await buildContentGenerationContext('ws-no-learnings', {
      slices: ['seoContext'],
    });

    expect(result.learningsAvailability).toBe('not_requested');
  });

  it('surfaces degraded learnings availability when the learnings slice was requested but missing', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      ...mockIntelligence,
      learnings: undefined,
    });

    const result = await buildContentGenerationContext('ws-degraded', {
      slices: ['learnings'],
    });

    expect(result.learningsAvailability).toBe('degraded');
  });

  it('threads backlink enrichment through when a recommendation-style caller opts in', async () => {
    await buildRecommendationGenerationContext('ws-backlinks', {
      enrichWithBacklinks: true,
    });

    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-backlinks', {
      slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline', 'siteHealth'],
      pagePath: undefined,
      learningsDomain: 'all',
      enrichWithBacklinks: true,
    });
  });
});
