import type {
  ContentBrief,
  GeneratedPost,
} from '../../../../shared/types/content.js';
import {
  canRenderGenerationPlaceholder,
} from '../../../../shared/types/generation-evidence.js';
import type { ContentGenerationContextV2Result } from '../../../../shared/types/intelligence.js';
import type { MatrixGenerationPreviewTarget } from '../../../../shared/types/matrix-generation.js';
import { generateBrief } from '../../../content-brief.js';
import { generatePost } from '../../../content-posts.js';
import { countHtmlWords } from '../../../content-posts-ai.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';
import { MATRIX_READER_FACING_PROSE_CONTRACT } from './audit.js';
import {
  listCurrentMatrixCellEvidence,
  renderMatrixCellEvidencePrompt,
} from './evidence.js';

export interface MatrixGenerationStageOptions {
  workspaceId: string;
  target: MatrixGenerationPreviewTarget;
  context: ContentGenerationContextV2Result;
  executionChainId: string;
  signal?: AbortSignal;
  assertAuthority: () => void;
  beforeBoundedProviderDispatch?: (dispatch: BoundedProviderDispatch) => void;
}

function placeholderToken(requirement: MatrixGenerationPreviewTarget['evidenceRequirements'][number]): string {
  return `[NEEDS CLIENT INPUT: ${requirement.clientSafePrompt ?? requirement.reason}]`;
}

function readerFacingToneAndStyle(value: string | undefined): string {
  const current = value?.trim();
  if (current?.includes(MATRIX_READER_FACING_PROSE_CONTRACT)) return current;
  return [current, MATRIX_READER_FACING_PROSE_CONTRACT].filter(Boolean).join('\n');
}

function lockedOutline(target: MatrixGenerationPreviewTarget, generated: ContentBrief) {
  const bodyBlocks = target.blockManifest.blocks.filter(block => block.source === 'template');
  const readyPlaceholders = target.evidenceRequirements
    .filter(canRenderGenerationPlaceholder)
    .map(placeholderToken);
  return bodyBlocks.map((block, index) => {
    const generatedSection = generated.outline[index];
    const blockPlaceholders = block.ctaContract.required ? readyPlaceholders : [];
    const notes = [
      block.guidance,
      generatedSection?.notes,
      blockPlaceholders.length > 0
        ? `Keep these typed requirements visible in the draft: ${blockPlaceholders.join(' ')}`
        : undefined,
    ].filter((value): value is string => Boolean(value?.trim())).join('\n');
    return {
      heading: block.heading.renderedText ?? generatedSection?.heading ?? block.sourceSectionId,
      ...(generatedSection?.subheadings?.length
        ? { subheadings: generatedSection.subheadings }
        : {}),
      notes,
      wordCount: block.wordCountTarget ?? generatedSection?.wordCount ?? 250,
      keywords: generatedSection?.keywords ?? [],
    };
  });
}

export async function generateMatrixBriefStage(
  options: MatrixGenerationStageOptions,
): Promise<ContentBrief> {
  const { target } = options;
  const resolutions = listCurrentMatrixCellEvidence(
    options.workspaceId,
    target.matrixId,
    target.cellId,
  );
  const evidencePrompt = renderMatrixCellEvidencePrompt(
    target.evidenceRequirements,
    resolutions,
  );
  const bodyBlocks = target.blockManifest.blocks.filter(block => block.source === 'template');
  const generated = await generateBrief(
    options.workspaceId,
    target.targetKeyword.value,
    {
      businessContext: [
        `STRUCTURAL PAGE TARGET (layout and targeting only; not business-fact evidence):\nPage type: ${target.pageType}\nPlanned path: ${target.plannedUrl}`,
        evidencePrompt,
        MATRIX_READER_FACING_PROSE_CONTRACT,
      ].filter(Boolean).join('\n\n'),
      pageType: target.pageType,
      templateId: target.templateId,
      templateSections: bodyBlocks.map(block => ({
        name: block.heading.renderedText ?? block.sourceSectionId,
        headingTemplate: block.heading.renderedText ?? block.sourceSectionId,
        guidance: block.guidance,
        wordCountTarget: block.wordCountTarget ?? 250,
      })),
      templateTitlePattern: target.title,
      templateMetaDescPattern: target.metaDescription,
      keywordLocked: true,
      keywordSource: 'matrix',
      keywordValidation: target.targetKeyword.validation,
      generationStyle: 'standard',
    },
    {
      persist: false,
      executionChainId: options.executionChainId,
      signal: options.signal,
      generationContextV2: options.context,
      skipKeywordStrategyCrossref: true,
      assertAuthority: options.assertAuthority,
      maxRetries: 0,
      beforeBoundedProviderDispatch: options.beforeBoundedProviderDispatch,
    },
  );
  return {
    ...generated,
    targetKeyword: target.targetKeyword.value,
    suggestedTitle: target.title,
    suggestedMetaDesc: target.metaDescription,
    outline: lockedOutline(target, generated),
    wordCountTarget: target.blockManifest.totalWordCountTarget,
    pageType: target.pageType,
    templateId: target.templateId,
    keywordLocked: true,
    keywordSource: 'matrix',
    keywordValidation: target.targetKeyword.validation,
    schemaRecommendations: target.schemaTypes.map(type => ({
      type,
      notes: 'Apply the schema type locked by the content template.',
    })),
    sourceEvidence: {
      ...(generated.sourceEvidence ?? {}),
      capturedAt: target.evidenceFreshThrough,
    },
    generationRevision: 0,
    generationProvenance: generated.generationProvenance
      ? {
          ...generated.generationProvenance,
          evidenceCapturedAt: target.evidenceFreshThrough,
        }
      : generated.generationProvenance,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export async function generateMatrixPostStage(
  brief: ContentBrief,
  options: MatrixGenerationStageOptions,
): Promise<GeneratedPost> {
  const resolutions = listCurrentMatrixCellEvidence(
    options.workspaceId,
    options.target.matrixId,
    options.target.cellId,
  );
  const evidencePrompt = renderMatrixCellEvidencePrompt(
    options.target.evidenceRequirements,
    resolutions,
  );
  const contractedBrief = {
    ...brief,
    executiveSummary: [
      brief.executiveSummary?.trim(),
      evidencePrompt,
    ].filter(Boolean).join('\n\n'),
    toneAndStyle: readerFacingToneAndStyle(brief.toneAndStyle),
    sourceEvidence: {
      ...(brief.sourceEvidence ?? {}),
      capturedAt: options.target.evidenceFreshThrough,
    },
  };
  const post = await generatePost(options.workspaceId, contractedBrief, undefined, {
    persist: false,
    executionChainId: options.executionChainId,
    signal: options.signal,
    generationContextV2: options.context,
    assertAuthority: options.assertAuthority,
    maxRetries: 0,
    beforeBoundedProviderDispatch: options.beforeBoundedProviderDispatch,
  });
  const placeholders = options.target.evidenceRequirements
    .filter(canRenderGenerationPlaceholder)
    .map(placeholderToken);
  if (placeholders.length > 0) {
    const bodyBlocks = options.target.blockManifest.blocks
      .filter(block => block.source === 'template');
    const ctaIndex = bodyBlocks.findIndex(block => block.ctaContract.required);
    if (ctaIndex >= 0 && post.sections[ctaIndex]) {
      const missing = placeholders.filter(token => !post.sections[ctaIndex].content.includes(token));
      if (missing.length > 0) {
        post.sections[ctaIndex].content += missing
          .map(token => `<p>${escapeHtml(token)}</p>`)
          .join('');
        post.sections[ctaIndex].wordCount = countHtmlWords(post.sections[ctaIndex].content);
      }
    } else if (options.target.blockManifest.blocks.at(-1)?.ctaContract.required) {
      const missing = placeholders.filter(token => !post.conclusion.includes(token));
      post.conclusion += missing.map(token => `<p>${escapeHtml(token)}</p>`).join('');
    }
  }
  post.title = options.target.title;
  post.metaDescription = options.target.metaDescription;
  post.seoTitle = options.target.title;
  post.seoMetaDescription = options.target.metaDescription;
  post.targetWordCount = options.target.blockManifest.totalWordCountTarget;
  post.totalWordCount = countHtmlWords(post.introduction)
    + post.sections.reduce((sum, section) => sum + countHtmlWords(section.content), 0)
    + countHtmlWords(post.conclusion);
  return post;
}
