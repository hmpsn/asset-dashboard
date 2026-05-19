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

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
  formatForPrompt: vi.fn(),
}));

const mockIntelligence: WorkspaceIntelligence = {
  version: 1,
  workspaceId: 'ws-test',
  assembledAt: '2026-05-18T00:00:00.000Z',
};

describe('generation context builders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue(mockIntelligence);
    vi.mocked(formatForPrompt).mockReturnValue('[Workspace Intelligence]');
  });

  it('buildContentGenerationContext uses the default content slices and content learnings domain', async () => {
    const result = await buildContentGenerationContext('ws-content');

    expect(buildWorkspaceIntelligence).toHaveBeenCalledTimes(1);
    expect(buildWorkspaceIntelligence).toHaveBeenCalledWith('ws-content', {
      slices: ['seoContext', 'insights', 'learnings', 'clientSignals', 'contentPipeline'],
      pagePath: undefined,
      learningsDomain: 'content',
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
    });
    expect(formatForPrompt).toHaveBeenCalledWith(mockIntelligence, {
      verbosity: 'detailed',
      sections: vi.mocked(buildWorkspaceIntelligence).mock.calls[0]?.[1]?.slices,
      tokenBudget: undefined,
      learningsDomain: 'all',
    });
    expect(result.slices).toContain('siteHealth');
    expect(result.learningsDomain).toBe('all');
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
    });
    expect(formatForPrompt).toHaveBeenCalledWith(mockIntelligence, {
      verbosity: 'detailed',
      sections: customSlices,
      tokenBudget: undefined,
      learningsDomain: 'content',
    });
    expect(result.slices).toBe(customSlices);
  });
});
