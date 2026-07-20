import * as cheerio from 'cheerio';

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
    const hasVisibleHeading = block.heading.renderedText !== null;
    const literalHeading = block.heading.renderedText
      ?? generatedSection?.heading?.trim()
      ?? `Section ${index + 1}`;
    const resolvedHeading = block.heading.locked && hasVisibleHeading
      ? literalHeading
      : generatedSection?.heading?.trim() || literalHeading;
    const blockPlaceholders = block.ctaContract.required ? readyPlaceholders : [];
    const frozenLinkBlock = target.verifiedInternalLinks?.find(candidate => (
      candidate.blockId === block.id
    ));
    const notes = [
      block.guidance,
      generatedSection?.notes,
      !hasVisibleHeading
        ? 'This template block has no visible heading. Treat the outline heading as generation scaffolding only; final output must contain no H2 in this block.'
        : block.heading.locked
        ? `Start this section with the exact H2: ${literalHeading}`
        : `Start this section with the branded H2 from this outline. Preserve its wording exactly in the generated HTML. The literal fallback is: ${literalHeading}`,
      frozenLinkBlock
        ? `Render at least ${frozenLinkBlock.minimum} verified internal anchor(s) in this block. Use only these exact href and anchor-text pairs: ${frozenLinkBlock.links.map(link => `<a href="${link.href}">${link.anchorText}</a>`).join(' ')}`
        : undefined,
      block.renderAs === 'table'
        ? 'Render this structured comparison as semantic HTML: one <table> containing <thead> or header <tr>, <th> labels, at least two <tr> rows total, and <td> data cells. Do not flatten the comparison into prose.'
        : undefined,
      blockPlaceholders.length > 0
        ? `Keep these typed requirements visible in the draft: ${blockPlaceholders.join(' ')}`
        : undefined,
    ].filter((value): value is string => Boolean(value?.trim())).join('\n');
    return {
      heading: resolvedHeading,
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
      templateSections: bodyBlocks.map((block, index) => ({
        name: block.heading.renderedText ?? `Section ${index + 1}`,
        headingTemplate: block.heading.renderedText ?? '',
        headingLocked: block.heading.locked,
        headingPresent: block.heading.renderedText !== null,
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
  const bodyBlocks = options.target.blockManifest.blocks
    .filter(block => block.source === 'template');
  post.sections = post.sections.map((section, index) => {
    if (bodyBlocks[index]?.heading.renderedText !== null) return section;
    const $ = cheerio.load(section.content, null, false);
    $('h2').remove();
    const content = $.html();
    return {
      ...section,
      heading: '',
      content,
      wordCount: countHtmlWords(content),
    };
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
