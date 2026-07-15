import { afterEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import type { ContentBrief } from '../../shared/types/content.js';

vi.mock('../../server/content-posts-ai.js', () => ({
  buildVoiceContext: vi.fn(async () => 'Voice context'),
  generateIntroduction: vi.fn(async () => '<p>Intro words for the post.</p>'),
  generateSection: vi.fn(async (_brief, section) => `<h2>${section.heading}</h2><p>Section words for ${section.heading}.</p>`),
  generateConclusion: vi.fn(async () => '<h2>Next Steps</h2><p>Conclusion words.</p>'),
  generateSeoMeta: vi.fn(async () => ({
    seoTitle: 'Useful SEO Title',
    seoMetaDescription: 'Useful SEO meta description for the generated post.',
  })),
  unifyPost: vi.fn(async (post) => ({
    introduction: post.introduction,
    sections: post.sections.map((section) => section.content),
    conclusion: post.conclusion,
  })),
  countHtmlWords: (html: string) => html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildContentGenerationContextV2: vi.fn(),
}));

const workspaceIds = new Set<string>();

function makeBrief(workspaceId: string): ContentBrief {
  return {
    id: `brief_${workspaceId}`,
    workspaceId,
    targetKeyword: 'background post generation',
    secondaryKeywords: ['content workflow'],
    suggestedTitle: 'Background Post Generation Guide',
    suggestedMetaDesc: 'A practical guide to background post generation.',
    outline: [
      { heading: 'First Section', notes: 'Cover the first point.', wordCount: 250, keywords: ['first'] },
      { heading: 'Second Section', notes: 'Cover the second point.', wordCount: 250, keywords: ['second'] },
    ],
    wordCountTarget: 900,
    intent: 'informational',
    audience: 'agency operators',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
    pageType: 'blog',
  };
}

function cleanupWorkspace(workspaceId: string): void {
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
}

describe('content post generation progress', () => {
  afterEach(() => {
    for (const workspaceId of workspaceIds) cleanupWorkspace(workspaceId);
    workspaceIds.clear();
    vi.clearAllMocks();
  });

  it('reports durable post generation steps for the background task panel', async () => {
    const { generatePost } = await import('../../server/content-posts.js');
    const workspaceId = `ws_post_progress_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const progress: string[] = [];

    const post = await generatePost(workspaceId, makeBrief(workspaceId), 'post_progress', {
      onProgress: (evt) => progress.push(`${evt.progress}/${evt.total}:${evt.message}`),
    });

    expect(post.status).toBe('draft');
    expect(progress).toContain('0/6:Preparing content context...');
    expect(progress).toContain('0/6:Writing introduction...');
    expect(progress).toContain('1/6:Writing section 1 of 2...');
    expect(progress).toContain('2/6:Writing section 2 of 2...');
    expect(progress).toContain('3/6:Writing conclusion...');
    expect(progress).toContain('4/6:Unifying draft...');
    expect(progress).toContain('5/6:Generating SEO metadata...');
    expect(progress).toContain('6/6:Finalizing post draft...');
  }, 15_000);

  it('builds v2 context once and reuses its draft projection and authority through every post stage', async () => {
    const { generatePost } = await import('../../server/content-posts.js');
    const ai = await import('../../server/content-posts-ai.js');
    const { isFeatureEnabled } = await import('../../server/feature-flags.js');
    const { buildContentGenerationContextV2 } = await import('../../server/intelligence/generation-context-builders.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const authority = {
      systemVoiceBlock: '[System voice]',
      userVoiceBlock: '[User voice]',
      identityPromptBlock: '[Identity]',
      customNotes: null,
      voice: { status: 'calibrated' as const, readiness: 'finalized' as const, profileRevision: 4, voiceVersion: 2 },
    };
    vi.mocked(buildContentGenerationContextV2).mockResolvedValue({
      intelligence: { version: 1, workspaceId: 'ws', assembledAt: '2026-07-14T12:00:00.000Z' },
      slices: ['seoContext', 'brand'],
      authority,
      projections: { brief: '[Brief context]', draft: '[Draft context]', voiceReview: '[Voice context]' },
      tokenEstimates: { brief: 100, draft: 80, voiceReview: 50 },
      evidence: {
        capturedAt: '2026-07-14T12:00:00.000Z',
        freshThrough: '2026-07-14T12:00:00.000Z',
        observedAt: ['2026-07-14T12:00:00.000Z'],
        missing: [],
      },
      learningsAvailability: 'degraded',
      effectiveInputFingerprint: 'b'.repeat(64),
    });
    const workspaceId = `ws_post_context_v2_${Date.now()}`;
    workspaceIds.add(workspaceId);

    await generatePost(workspaceId, makeBrief(workspaceId), 'post_context_v2');

    expect(buildContentGenerationContextV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ai.buildVoiceContext)).not.toHaveBeenCalled();
    expect(vi.mocked(ai.generateIntroduction).mock.calls[0][1]).toBe('[Draft context]');
    expect(vi.mocked(ai.generateIntroduction).mock.calls[0][4]).toEqual(expect.objectContaining({ promptAuthority: authority }));
    expect(vi.mocked(ai.generateSection).mock.calls[0][4]).toBe('[Draft context]');
    expect(vi.mocked(ai.generateSection).mock.calls[0][7]).toEqual(expect.objectContaining({ promptAuthority: authority }));
    expect(vi.mocked(ai.generateConclusion).mock.calls[0][1]).toBe('[Draft context]');
    expect(vi.mocked(ai.unifyPost).mock.calls[0][2]).toBe('[Draft context]');
    expect(vi.mocked(ai.generateSeoMeta).mock.calls[0][3]).toEqual(expect.objectContaining({ promptAuthority: authority }));
  }, 15_000);

  it('stops before the next generation step when the job signal is aborted', async () => {
    const { generatePost } = await import('../../server/content-posts.js');
    const ai = await import('../../server/content-posts-ai.js');
    const workspaceId = `ws_post_cancel_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const controller = new AbortController();
    vi.mocked(ai.generateIntroduction).mockImplementationOnce(async () => {
      controller.abort();
      return '<p>Intro words for the post.</p>';
    });

    await expect(generatePost(workspaceId, makeBrief(workspaceId), 'post_cancel', {
      signal: controller.signal,
    })).rejects.toThrow(/cancelled/i);

    expect(vi.mocked(ai.generateIntroduction).mock.calls[0][4]).toEqual(expect.objectContaining({
      signal: controller.signal,
      executionChainId: expect.any(String),
      onExecution: expect.any(Function),
    }));
    expect(vi.mocked(ai.generateSection)).not.toHaveBeenCalled();
  });
});
