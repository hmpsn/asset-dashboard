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
  });

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

    expect(vi.mocked(ai.generateIntroduction).mock.calls[0][4]).toEqual({ signal: controller.signal });
    expect(vi.mocked(ai.generateSection)).not.toHaveBeenCalled();
  });
});
