import type { PersistedGeneratedPost } from '../../../../shared/types/content.js';
import type { ResolvedPageBlockManifest } from '../../../../shared/types/matrix-generation.js';

export const MATRIX_HEADING_CONTRACT_REASONS = [
  'block_census_mismatch',
  'heading_absent',
  'heading_blank',
  'heading_multiple',
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

/**
 * Validate generated HTML against the accepted block manifest and return a cloned post whose
 * unlocked section metadata is derived from its single rendered H2. Implemented in PR2/M5.
 */
export function synchronizeMatrixGenerationPostHeadings(
  _manifest: ResolvedPageBlockManifest,
  _post: PersistedGeneratedPost,
): PersistedGeneratedPost {
  throw new MatrixHeadingContractError([{
    blockId: 'manifest',
    fieldPath: 'blockManifest.blocks',
    reason: 'block_census_mismatch',
  }]);
}
