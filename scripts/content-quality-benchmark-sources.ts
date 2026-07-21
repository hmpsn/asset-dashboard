import { createHash } from 'node:crypto';
import type {
  ContentQualityBenchmarkCandidate,
  ContentQualityBenchmarkReference,
  ContentQualityBenchmarkReferenceKind,
} from '../shared/types/content-quality-benchmark.js';
import type { CopySection } from '../shared/types/copy-pipeline.js';
import type { GeneratedPost } from '../shared/types/content.js';
import type { MatrixGenerationItem } from '../shared/types/matrix-generation.js';

const OPERATOR_ATTESTATION =
  'I attest that this exact copy was approved by a human for client use.' as const;

export class ContentQualityBenchmarkSourceError extends Error {
  readonly code = 'benchmark_source_not_qualified';

  constructor(message: string) {
    super(message);
    this.name = 'ContentQualityBenchmarkSourceError';
  }
}

export interface QualifiedContentQualityBenchmarkSource {
  kind: ContentQualityBenchmarkReferenceKind;
  /** Caller-supplied opaque source identity. Never included in safe aggregate reports. */
  sourceId: string;
  reference: ContentQualityBenchmarkReference;
  /** Private approved copy. Callers may persist it only in an ignored local artifact. */
  referenceHtml: string;
}

export interface MatrixApprovedPostSourceRequest {
  kind: 'matrix_approved_post';
  workspaceId: string;
  itemId: string;
  postId: string;
}

export interface ApprovedCopySectionsSourceRequest {
  kind: 'approved_copy_sections';
  workspaceId: string;
  entryId: string;
  sectionIds: readonly [string, ...string[]];
}

export interface OperatorCuratedPageSourceRequest {
  kind: 'operator_curated_page';
  sourceId: string;
  html: string;
  attestation: {
    statement: typeof OPERATOR_ATTESTATION;
    approvedAt: string;
  };
}

export interface ContentQualityBenchmarkSourceReaders {
  getMatrixGenerationItem(workspaceId: string, itemId: string): MatrixGenerationItem | null;
  getPost(workspaceId: string, postId: string): GeneratedPost | null;
  getCopySection(workspaceId: string, sectionId: string): CopySection | null;
}

export interface MatrixBenchmarkCandidateRequest {
  workspaceId: string;
  itemId: string;
  postId: string;
  /** Blinded local label. Provider or model names are not permitted. */
  anonymousLabel: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  };
}

function requireExactId(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value) {
    throw new ContentQualityBenchmarkSourceError(`${field} must be an exact non-empty ID`);
  }
  return value;
}

function requireSha256(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ContentQualityBenchmarkSourceError(`${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireIsoTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (value.trim() !== value
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !Number.isFinite(parsed)) {
    throw new ContentQualityBenchmarkSourceError(`${field} must be a valid ISO timestamp`);
  }
  return value;
}

function requirePrivateHtml(value: string): string {
  if (value.trim().length === 0) {
    throw new ContentQualityBenchmarkSourceError('Approved source copy is empty');
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireNonnegativeFinite(value: number, field: string, integer = false): number {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new ContentQualityBenchmarkSourceError(
      `${field} must be a nonnegative${integer ? ' integer' : ' finite number'}`,
    );
  }
  return value;
}

function sameSourceRevision(
  left: MatrixGenerationItem['sourceRevision'],
  right: MatrixGenerationItem['sourceRevision'],
): boolean {
  return left.matrixRevision === right.matrixRevision
    && left.templateRevision === right.templateRevision
    && left.cellRevision === right.cellRevision;
}

function renderPostCopy(post: GeneratedPost): string {
  const sections = post.sections.map(section => section.content).filter(Boolean);
  return requirePrivateHtml([
    `<h1>${escapeHtml(post.title)}</h1>`,
    post.introduction,
    ...sections,
    post.conclusion,
  ].filter(Boolean).join('\n'));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Qualify one explicitly addressed, currently approved matrix post.
 * Merely review-ready items and stale approval snapshots fail closed.
 */
export function qualifyMatrixApprovedPost(
  request: MatrixApprovedPostSourceRequest,
  readers: Pick<ContentQualityBenchmarkSourceReaders, 'getMatrixGenerationItem' | 'getPost'>,
): QualifiedContentQualityBenchmarkSource {
  const workspaceId = requireExactId(request.workspaceId, 'workspaceId');
  const itemId = requireExactId(request.itemId, 'itemId');
  const postId = requireExactId(request.postId, 'postId');
  const item = readers.getMatrixGenerationItem(workspaceId, itemId);
  const post = readers.getPost(workspaceId, postId);
  const approval = item?.approvalEvidence;

  if (
    !item
    || item.workspaceId !== workspaceId
    || item.id !== itemId
    || item.postId !== postId
    || !post
    || post.workspaceId !== workspaceId
    || post.id !== postId
    || post.status !== 'approved'
    || typeof post.generationRevision !== 'number'
    || !approval
    || approval.itemId !== itemId
    || approval.runId !== item.runId
    || approval.matrixId !== item.matrixId
    || approval.cellId !== item.cellId
    || !sameSourceRevision(approval.sourceRevision, item.sourceRevision)
    || approval.postId !== postId
    || approval.postRevision !== post.generationRevision
  ) {
    throw new ContentQualityBenchmarkSourceError(
      'Matrix source is missing current human approval evidence for the exact post revision',
    );
  }

  const referenceHtml = renderPostCopy(post);
  return {
    kind: request.kind,
    sourceId: itemId,
    referenceHtml,
    reference: {
      kind: request.kind,
      contentSha256: sha256(referenceHtml),
      approvalKind: 'human_approved',
      approvedAt: requireIsoTimestamp(approval.approvedAt, 'approvalEvidence.approvedAt'),
      sourceRevision: approval.postRevision,
    },
  };
}

/**
 * Build one blinded candidate from the current, review-ready matrix artifact.
 * Runtime messages, evidence, prompts, and raw authority are deliberately omitted.
 */
export function qualifyMatrixBenchmarkCandidate(
  request: MatrixBenchmarkCandidateRequest,
  readers: Pick<ContentQualityBenchmarkSourceReaders, 'getMatrixGenerationItem' | 'getPost'>,
): ContentQualityBenchmarkCandidate {
  const workspaceId = requireExactId(request.workspaceId, 'workspaceId');
  const itemId = requireExactId(request.itemId, 'itemId');
  const postId = requireExactId(request.postId, 'postId');
  const anonymousLabel = requireExactId(request.anonymousLabel, 'anonymousLabel');
  if (!/^candidate_[a-z0-9]{1,4}$/.test(anonymousLabel)) {
    throw new ContentQualityBenchmarkSourceError(
      'anonymousLabel must be an opaque candidate_* label',
    );
  }

  const item = readers.getMatrixGenerationItem(workspaceId, itemId);
  const post = readers.getPost(workspaceId, postId);
  const preview = item?.previewTarget;
  const audit = item?.auditReport;
  const provenance = post?.generationProvenance;
  if (post) requireIsoTimestamp(post.updatedAt, 'post.updatedAt');
  if (audit) requireIsoTimestamp(audit.auditedAt, 'auditReport.auditedAt');
  if (provenance) {
    requireIsoTimestamp(provenance.startedAt, 'generationProvenance.startedAt');
    requireIsoTimestamp(provenance.completedAt, 'generationProvenance.completedAt');
  }
  if (
    !item
    || item.workspaceId !== workspaceId
    || item.id !== itemId
    || item.postId !== postId
    || item.status !== 'ready_for_human_review'
    || !preview
    || preview.workspaceId !== workspaceId
    || preview.cellId !== item.cellId
    || preview.matrixId !== item.matrixId
    || preview.effectiveInputFingerprint !== item.previewFingerprint
    || !audit
    || audit.verdict !== 'ready_for_human_review'
    || !post
    || post.workspaceId !== workspaceId
    || post.id !== postId
    || !['draft', 'review', 'approved'].includes(post.status)
    || typeof post.generationRevision !== 'number'
    || !provenance
    || !provenance.operation.trim()
    || !provenance.model.trim()
    || Date.parse(post.updatedAt) > Date.parse(audit.auditedAt)
  ) {
    throw new ContentQualityBenchmarkSourceError(
      'Matrix candidate is stale, cross-scoped, or missing current review authority',
    );
  }

  const startedAt = Date.parse(provenance.startedAt);
  const completedAt = Date.parse(provenance.completedAt);
  const durationMs = completedAt - startedAt;
  requireNonnegativeFinite(durationMs, 'generationProvenance.durationMs');
  const promptTokens = requireNonnegativeFinite(request.usage.promptTokens, 'usage.promptTokens', true);
  const completionTokens = requireNonnegativeFinite(
    request.usage.completionTokens,
    'usage.completionTokens',
    true,
  );
  const estimatedCostUsd = requireNonnegativeFinite(
    request.usage.estimatedCostUsd,
    'usage.estimatedCostUsd',
  );
  const inputFingerprint = requireSha256(
    provenance.inputFingerprint,
    'generationProvenance.inputFingerprint',
  );
  const authorityFingerprint = requireSha256(item.previewFingerprint, 'item.previewFingerprint');

  return {
    anonymousLabel,
    html: renderPostCopy(post),
    provenance: {
      operation: provenance.operation,
      provider: provenance.provider,
      model: provenance.model,
      inputFingerprint,
      durationMs,
      promptTokens,
      completionTokens,
      estimatedCostUsd,
    },
    runtimeAudit: {
      authorityFingerprint,
      verdict: audit.verdict,
      deterministicChecks: audit.deterministicChecks.map(check => ({
        id: check.id,
        result: check.result,
      })),
    },
  };
}

/** Qualify only the exact explicitly selected copy-section rows. There is no entry-wide export. */
export function qualifyApprovedCopySections(
  request: ApprovedCopySectionsSourceRequest,
  readers: Pick<ContentQualityBenchmarkSourceReaders, 'getCopySection'>,
): QualifiedContentQualityBenchmarkSource {
  const workspaceId = requireExactId(request.workspaceId, 'workspaceId');
  const entryId = requireExactId(request.entryId, 'entryId');
  if (request.sectionIds.length === 0) {
    throw new ContentQualityBenchmarkSourceError('sectionIds must contain at least one exact source ID');
  }
  const sectionIds = request.sectionIds.map(id => requireExactId(id, 'sectionId'));
  if (new Set(sectionIds).size !== sectionIds.length) {
    throw new ContentQualityBenchmarkSourceError('sectionIds must not contain duplicates');
  }

  const sections = sectionIds.map(sectionId => readers.getCopySection(workspaceId, sectionId));
  if (sections.some(section => (
    !section
    || section.workspaceId !== workspaceId
    || section.entryId !== entryId
    || section.status !== 'approved'
    || !section.generatedCopy?.trim()
  ))) {
    throw new ContentQualityBenchmarkSourceError(
      'Every explicitly selected copy section must exist in the workspace and be approved',
    );
  }

  const approvedSections = sections as CopySection[];
  const referenceHtml = requirePrivateHtml(
    approvedSections.map(section => section.generatedCopy as string).join('\n'),
  );
  const approvedAt = approvedSections.reduce((latest, section) => (
    Date.parse(section.updatedAt) > Date.parse(latest) ? section.updatedAt : latest
  ), requireIsoTimestamp(approvedSections[0].updatedAt, 'copySection.updatedAt'));
  for (const section of approvedSections) {
    requireIsoTimestamp(section.updatedAt, 'copySection.updatedAt');
  }
  const sourceRevision = Math.max(...approvedSections.map(
    section => section.generationRevision ?? section.version,
  ));

  return {
    kind: request.kind,
    sourceId: entryId,
    referenceHtml,
    reference: {
      kind: request.kind,
      contentSha256: sha256(referenceHtml),
      approvalKind: 'human_approved',
      approvedAt,
      sourceRevision,
    },
  };
}

/** Qualify caller-supplied copy only. This function deliberately has no URL or fetch input. */
export function qualifyOperatorCuratedPage(
  request: OperatorCuratedPageSourceRequest,
): QualifiedContentQualityBenchmarkSource {
  const sourceId = requireExactId(request.sourceId, 'sourceId');
  if (request.attestation.statement !== OPERATOR_ATTESTATION) {
    throw new ContentQualityBenchmarkSourceError('Operator attestation is required');
  }
  const referenceHtml = requirePrivateHtml(request.html);
  const approvedAt = requireIsoTimestamp(request.attestation.approvedAt, 'attestation.approvedAt');
  return {
    kind: request.kind,
    sourceId,
    referenceHtml,
    reference: {
      kind: request.kind,
      contentSha256: sha256(referenceHtml),
      approvalKind: 'operator_attested',
      approvedAt,
    },
  };
}

export const CONTENT_QUALITY_BENCHMARK_OPERATOR_ATTESTATION = OPERATOR_ATTESTATION;
