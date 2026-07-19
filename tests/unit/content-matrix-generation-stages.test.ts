import { describe, expect, it, vi } from 'vitest';

import type { ContentBrief, GeneratedPost } from '../../shared/types/content.js';
import type { ContentGenerationContextV2Result } from '../../shared/types/intelligence.js';
import type { MatrixGenerationPreviewTarget } from '../../shared/types/matrix-generation.js';

vi.mock('../../server/content-brief.js', () => ({
  generateBrief: vi.fn(),
}));

vi.mock('../../server/content-posts.js', () => ({
  generatePost: vi.fn(),
}));

vi.mock('../../server/content-posts-ai.js', () => ({
  countHtmlWords: (html: string) => html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length,
}));

vi.mock('../../server/domains/content/matrix-generation/evidence.js', () => ({
  listCurrentMatrixCellEvidence: vi.fn(() => []),
  renderMatrixCellEvidencePrompt: vi.fn(() => 'MATRIX PAGE FACTS'),
}));

import { generateBrief } from '../../server/content-brief.js';
import { generatePost } from '../../server/content-posts.js';
import {
  generateMatrixBriefStage,
  generateMatrixPostStage,
} from '../../server/domains/content/matrix-generation/stages.js';

function target(): MatrixGenerationPreviewTarget {
  return {
    workspaceId: 'ws-1',
    matrixId: 'matrix-1',
    templateId: 'template-1',
    cellId: 'cell-1',
    pageType: 'location',
    plannedUrl: '/austin/seo-consulting',
    schemaTypes: [],
    targetKeyword: {
      value: 'seo consulting austin',
      source: 'target',
      evidenceRefs: [],
    },
    title: 'SEO Consulting in Austin',
    metaDescription: 'Learn about SEO consulting in Austin.',
    evidenceCapturedAt: '2026-07-14T12:00:00.000Z',
    evidenceFreshThrough: '2020-01-02T03:04:05.000Z',
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
  it('keeps internal evidence mechanics out of every reader-facing generation stage', async () => {
    const generatedBrief: ContentBrief = {
      id: 'brief-1',
      workspaceId: 'ws-1',
      targetKeyword: 'seo consulting austin',
      secondaryKeywords: [],
      suggestedTitle: 'Generated title',
      suggestedMetaDesc: 'Generated description',
      outline: [{
        heading: 'SEO Consulting in Austin',
        notes: 'Explain the verified service.',
        wordCount: 300,
        keywords: [],
      }],
      wordCountTarget: 300,
      intent: 'commercial',
      audience: 'Austin organizations',
      executiveSummary: 'Explain the service clearly for Austin organizations.',
      competitorInsights: '',
      internalLinkSuggestions: [],
      toneAndStyle: 'Warm and plainspoken.',
      createdAt: '2026-07-14T12:00:00.000Z',
      generationProvenance: {
        runId: 'brief-run',
        operation: 'generate_content_brief',
        provider: 'openai',
        model: 'gpt-5.6-terra',
        inputFingerprint: 'a'.repeat(64),
        startedAt: '2026-07-14T12:00:00.000Z',
        completedAt: '2026-07-14T12:00:01.000Z',
        evidenceCapturedAt: '2026-07-14T12:00:00.000Z',
      },
    };
    vi.mocked(generateBrief).mockResolvedValue(generatedBrief);

    const options = {
      workspaceId: 'ws-1',
      target: target(),
      context: {} as ContentGenerationContextV2Result,
      executionChainId: 'chain-1',
      assertAuthority: vi.fn(),
    };
    const brief = await generateMatrixBriefStage(options);
    const briefOptions = vi.mocked(generateBrief).mock.calls.at(-1)?.[2];

    expect(briefOptions?.businessContext).toContain('final reader-facing copy');
    expect(briefOptions?.businessContext).toContain('Never narrate internal evidence');
    expect(brief.toneAndStyle).toBe('Warm and plainspoken.');
    expect(brief.toneAndStyle).not.toContain('Never narrate internal evidence');
    expect(brief.sourceEvidence?.capturedAt).toBe('2020-01-02T03:04:05.000Z');
    expect(brief.generationProvenance?.evidenceCapturedAt).toBe('2020-01-02T03:04:05.000Z');

    vi.mocked(generatePost).mockResolvedValue({
      id: 'post-contract',
      workspaceId: 'ws-1',
      briefId: brief.id,
      targetKeyword: brief.targetKeyword,
      title: brief.suggestedTitle,
      metaDescription: brief.suggestedMetaDesc,
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
    });

    await generateMatrixPostStage(brief, options);
    const postBrief = vi.mocked(generatePost).mock.calls.at(-1)?.[1];
    expect(postBrief?.toneAndStyle?.match(/Never narrate internal evidence/g)).toHaveLength(1);
    expect(postBrief?.executiveSummary).toContain('Explain the service clearly');
    expect(postBrief?.executiveSummary).toContain('MATRIX PAGE FACTS');
    expect(postBrief?.sourceEvidence?.capturedAt).toBe('2020-01-02T03:04:05.000Z');
  });

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

    const result = await generateMatrixPostStage({ toneAndStyle: 'Warm.' } as never, {
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
    const postBrief = vi.mocked(generatePost).mock.calls.at(-1)?.[1];
    expect(postBrief?.toneAndStyle).toContain('Never narrate internal evidence');
  });
});
