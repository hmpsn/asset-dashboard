import { describe, expect, it, vi } from 'vitest';

import type { GeneratedPost } from '../../shared/types/content.js';
import type { ContentGenerationContextV2Result } from '../../shared/types/intelligence.js';
import type { MatrixGenerationPreviewTarget } from '../../shared/types/matrix-generation.js';

vi.mock('../../server/content-posts.js', () => ({
  generatePost: vi.fn(),
}));

vi.mock('../../server/content-posts-ai.js', () => ({
  countHtmlWords: (html: string) => html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length,
}));

import { generatePost } from '../../server/content-posts.js';
import { generateMatrixPostStage } from '../../server/domains/content/matrix-generation/stages.js';

function target(): MatrixGenerationPreviewTarget {
  return {
    title: 'SEO Consulting in Austin',
    metaDescription: 'Learn about SEO consulting in Austin.',
    evidenceRequirements: [{
      id: 'matrix-cell:cell-1:cta-details',
      fieldPath: 'cta.details',
      claim: 'The required CTA has verified details.',
      reason: 'CTA details cannot be invented.',
      requirementStage: 'ready',
      claimKind: 'factual',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Provide the verified CTA destination.',
    }],
    blockManifest: {
      totalWordCountTarget: 300,
      blocks: [
        {
          id: 'system:introduction',
          source: 'system',
          generationRole: 'introduction',
          order: 0,
          heading: { level: null, renderedText: null, locked: true },
          guidance: 'Open directly.',
          aeoContract: { modes: ['answer_first'], required: true },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'template:body',
          source: 'template',
          sourceSectionId: 'body',
          generationRole: 'body',
          order: 1,
          heading: { level: 2, renderedText: 'SEO Consulting in Austin', locked: true },
          guidance: 'Explain the service.',
          wordCountTarget: 300,
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'system:conclusion',
          source: 'system',
          generationRole: 'conclusion',
          order: 2,
          heading: { level: 2, renderedText: null, locked: false },
          guidance: 'Close with the primary action.',
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'primary', required: true },
        },
      ],
    },
  } as unknown as MatrixGenerationPreviewTarget;
}

describe('matrix generation post stage', () => {
  it('puts a missing ready-stage CTA fact in the required system conclusion', async () => {
    const post: GeneratedPost = {
      id: 'post-1',
      workspaceId: 'ws-1',
      briefId: 'brief-1',
      targetKeyword: 'seo consulting austin',
      title: 'Generated title',
      metaDescription: 'Generated description',
      introduction: '<p>Introduction.</p>',
      sections: [{
        index: 0,
        heading: 'SEO Consulting in Austin',
        content: '<p>Service details.</p>',
        wordCount: 2,
        targetWordCount: 300,
        keywords: [],
        status: 'done',
      }],
      conclusion: '<p>Next step.</p>',
      totalWordCount: 5,
      targetWordCount: 300,
      status: 'draft',
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z',
    };
    vi.mocked(generatePost).mockResolvedValue(post);

    const result = await generateMatrixPostStage({} as never, {
      workspaceId: 'ws-1',
      target: target(),
      context: {} as ContentGenerationContextV2Result,
      executionChainId: 'chain-1',
      assertAuthority: vi.fn(),
    });

    expect(result.sections[0].content).not.toContain('NEEDS CLIENT INPUT');
    expect(result.conclusion).toContain(
      '[NEEDS CLIENT INPUT: Provide the verified CTA destination.]',
    );
    expect(result.title).toBe('SEO Consulting in Austin');
    expect(result.metaDescription).toBe('Learn about SEO consulting in Austin.');
  });
});
