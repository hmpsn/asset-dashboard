import * as cheerio from 'cheerio';

import type { GeneratedPost } from '../../../../shared/types/content.js';
import type {
  ResolvedPageBlock,
  ResolvedPageBlockManifest,
} from '../../../../shared/types/matrix-generation.js';

export const MATRIX_HEADING_CONTRACT_REASONS = [
  'block_census_mismatch',
  'heading_absent',
  'heading_blank',
  'heading_multiple',
  'heading_not_leading',
  'heading_unexpected',
  'locked_heading_mismatch',
] as const;

export type MatrixHeadingContractReason =
  (typeof MATRIX_HEADING_CONTRACT_REASONS)[number];

export interface MatrixHeadingContractIssue {
  blockId: string;
  fieldPath: string;
  reason: MatrixHeadingContractReason;
}

export class MatrixHeadingContractError extends Error {
  readonly code = 'matrix_heading_contract_failed' as const;
  readonly issues: readonly MatrixHeadingContractIssue[];

  constructor(issues: readonly MatrixHeadingContractIssue[]) {
    super('Generated matrix headings do not match the accepted block manifest.');
    this.name = 'MatrixHeadingContractError';
    this.issues = issues;
  }
}

export interface MatrixHeadingContractInspection<TPost extends GeneratedPost> {
  issues: readonly MatrixHeadingContractIssue[];
  synchronizedPost: TPost;
}

interface MatrixHeadingCandidate {
  block: ResolvedPageBlock;
  html: string;
  fieldPath: string;
  index?: number;
}

function issue(
  blockId: string,
  fieldPath: string,
  reason: MatrixHeadingContractReason,
): MatrixHeadingContractIssue {
  return { blockId, fieldPath, reason };
}

/** Inspect the complete frozen block census without mutating the supplied post. */
export function inspectMatrixGenerationPostHeadings<TPost extends GeneratedPost>(
  manifest: ResolvedPageBlockManifest,
  post: TPost,
): MatrixHeadingContractInspection<TPost> {
  const templateBlocks = manifest.blocks.filter(block => block.source === 'template');
  const introductionBlock = manifest.blocks.find(block => (
    block.source === 'system' && block.generationRole === 'introduction'
  ));
  const conclusionBlock = manifest.blocks.find(block => (
    block.source === 'system' && block.generationRole === 'conclusion'
  ));
  const issues: MatrixHeadingContractIssue[] = [];

  if (
    !introductionBlock
    || !conclusionBlock
    || post.sections.length !== templateBlocks.length
    || manifest.blocks.length !== templateBlocks.length + 2
  ) {
    issues.push(issue('manifest', 'blockManifest.blocks', 'block_census_mismatch'));
  }

  const synchronizedSections = post.sections.map(section => ({ ...section }));
  const candidates: MatrixHeadingCandidate[] = [];
  for (const block of manifest.blocks) {
    if (block.source === 'system' && block.generationRole === 'introduction') {
      candidates.push({ block, html: post.introduction, fieldPath: 'introduction' });
      continue;
    }
    if (block.source === 'system' && block.generationRole === 'conclusion') {
      candidates.push({ block, html: post.conclusion, fieldPath: 'conclusion' });
      continue;
    }
    if (block.source !== 'template') continue;
    const index = templateBlocks.indexOf(block);
    const section = post.sections[index];
    if (!section) continue;
    candidates.push({ block, html: section.content, fieldPath: `sections[${index}].content`, index });
  }

  for (const candidate of candidates) {
    const $ = cheerio.load(candidate.html, null, false);
    const headings = $('h2');
    const hasVisibleHeading = candidate.block.heading.level !== null;
    if (!hasVisibleHeading) {
      if (headings.length > 0) {
        issues.push(issue(candidate.block.id, candidate.fieldPath, 'heading_unexpected'));
      } else if (candidate.index !== undefined && synchronizedSections[candidate.index]) {
        synchronizedSections[candidate.index].heading = '';
      }
      continue;
    }
    if (headings.length === 0) {
      issues.push(issue(candidate.block.id, candidate.fieldPath, 'heading_absent'));
      continue;
    }
    if (headings.length > 1) {
      issues.push(issue(candidate.block.id, candidate.fieldPath, 'heading_multiple'));
      continue;
    }
    const firstMeaningfulRootNode = $.root().contents().toArray().find(node => (
      node.type !== 'comment'
      && (node.type !== 'text' || $(node).text().trim().length > 0)
    ));
    if (
      !firstMeaningfulRootNode
      || firstMeaningfulRootNode.type !== 'tag'
      || firstMeaningfulRootNode.name.toLowerCase() !== 'h2'
    ) {
      issues.push(issue(candidate.block.id, candidate.fieldPath, 'heading_not_leading'));
      continue;
    }
    const renderedText = headings.first().text();
    if (renderedText.trim().length === 0) {
      issues.push(issue(candidate.block.id, candidate.fieldPath, 'heading_blank'));
      continue;
    }
    if (candidate.block.heading.locked
      && renderedText !== candidate.block.heading.renderedText) {
      issues.push(issue(candidate.block.id, candidate.fieldPath, 'locked_heading_mismatch'));
      continue;
    }
    if (candidate.index !== undefined && synchronizedSections[candidate.index]) {
      synchronizedSections[candidate.index].heading = candidate.block.heading.locked
        ? candidate.block.heading.renderedText ?? renderedText
        : renderedText;
    }
  }

  return {
    issues,
    synchronizedPost: {
      ...post,
      sections: synchronizedSections,
    },
  };
}

/**
 * Validate generated HTML against the accepted block manifest and return a cloned post whose
 * unlocked section metadata is derived from its single rendered H2.
 */
export function synchronizeMatrixGenerationPostHeadings<TPost extends GeneratedPost>(
  manifest: ResolvedPageBlockManifest,
  post: TPost,
): TPost {
  const inspection = inspectMatrixGenerationPostHeadings(manifest, post);
  if (inspection.issues.length > 0) {
    throw new MatrixHeadingContractError(inspection.issues);
  }
  return inspection.synchronizedPost;
}
