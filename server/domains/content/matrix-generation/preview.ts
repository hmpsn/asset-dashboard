import type {
  ApprovedBrandDeliverableRef,
} from '../../../../shared/types/brand-generation.js';
import type {
  BrandDeliverable,
  BrandDeliverableType,
} from '../../../../shared/types/brand-engine.js';
import type { BriefPageType } from '../../../../shared/types/content.js';
import type {
  GenerationEvidenceRequirement,
} from '../../../../shared/types/generation-evidence.js';
import type {
  ContentGenerationContextV2Result,
} from '../../../../shared/types/intelligence.js';
import type {
  MatrixArtifactRevisionExpectations,
  MatrixGenerationEvidenceResolution,
  MatrixGenerationCostEstimate,
  MatrixGenerationPreviewResult,
  MatrixGenerationPreviewTarget,
  PreviewMatrixGenerationRequest,
  PreviewMatrixGenerationResult,
  ResolvedMatrixStructuralTarget,
} from '../../../../shared/types/matrix-generation.js';
import { MATRIX_GENERATION_BATCH_LIMITS } from '../../../../shared/types/matrix-generation.js';
import { listDeliverables } from '../../../brand-deliverable-read-model.js';
import { getBrief } from '../../../content-brief.js';
import {
  getBrandVoiceAuthoritySummary,
  getFinalizedVoiceSnapshotForGeneration,
} from '../../../domains/brand/voice-finalization.js';
import {
  brandGenerationApprovalFingerprint,
  canonicalBrandGenerationFingerprint,
} from '../../../domains/brand/generation/fingerprint.js';
import { getMatrix } from '../../../content-matrices.js';
import { getTemplate } from '../../../content-templates.js';
import { getPost } from '../../../content-posts-db.js';
import {
  buildContentGenerationContextV2,
  ContentGenerationContextBudgetError,
} from '../../../intelligence/generation-context-builders.js';
import {
  getCustomPromptNotes,
  renderSystemVoiceAuthorityBlock,
} from '../../../prompt-assembly.js';
import {
  buildMatrixCellEvidenceRequirements,
  freezeMatrixGenerationVerifiedInternalLinks,
  listCurrentMatrixCellEvidence,
  matrixArtifactRevisionExpectations,
} from './evidence.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import {
  assertMatrixGenerationEstimatedProviderInput,
  MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET,
  MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING,
  MatrixGenerationProviderInputEnvelopeError,
  matrixGenerationEstimatedUsdCeiling,
  matrixGenerationInputReservationCeiling,
  matrixGenerationProjectionTokenEstimate,
  matrixGenerationRenderedInputUtf8Bytes,
} from './budget.js';
import {
  resolveMatrixStructures,
  resolveMatrixStructuresWithCensus,
  type WorkspaceKnownPageCensus,
} from './read-service.js';
import {
  MATRIX_GENERATION_SET_AUDIT_MAX_ITEM_ID_UTF8_BYTES,
  MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS,
  projectMatrixGenerationSetAuditPage,
  renderMatrixGenerationSetAuditProviderInput,
} from './set-audit-input.js';

export const MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST = {
  blog: ['messaging_pillars', 'personas'],
  landing: ['messaging_pillars', 'differentiators', 'objection_handling', 'positioning_matrix'],
  service: ['messaging_pillars', 'differentiators', 'objection_handling', 'positioning_matrix'],
  location: [],
  pillar: ['messaging_pillars', 'personas'],
  product: ['messaging_pillars', 'differentiators', 'objection_handling', 'positioning_matrix'],
  resource: ['messaging_pillars', 'personas'],
} as const satisfies Record<BriefPageType, readonly BrandDeliverableType[]>;

interface FrozenIdentity {
  refs: ApprovedBrandDeliverableRef[];
  promptBlock: string;
  evidenceTimestamps: string[];
}

export interface PreparedMatrixGenerationCell {
  result: MatrixGenerationPreviewResult;
  context?: ContentGenerationContextV2Result;
}

export const MATRIX_GENERATION_PREVIEW_STAGES = [
  'generation_context',
  'cell_budget',
  'evidence_range',
  'preview_fingerprint',
  'batch_budget',
  'mcp_projection',
] as const;

export type MatrixGenerationPreviewStage =
  (typeof MATRIX_GENERATION_PREVIEW_STAGES)[number];

export const MATRIX_GENERATION_CONTEXT_BUDGETS = {
  brief: MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET,
  draft: MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET,
  voiceReview: MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET,
} as const;

type MatrixGenerationPreviewFailureCode = 'precondition_failed' | 'internal_error';

class MatrixGenerationAuthorityBudgetError extends Error {
  constructor() {
    super('Matrix generation authority exceeds its UTF-8 byte ceiling');
    this.name = 'MatrixGenerationAuthorityBudgetError';
  }
}

class MatrixGenerationBatchBudgetLimitError extends Error {
  readonly dimension: 'provider_calls' | 'input_tokens' | 'output_tokens'
    | 'estimated_usd' | 'max_concurrency';

  constructor(dimension: MatrixGenerationBatchBudgetLimitError['dimension']) {
    super('Matrix generation batch estimate exceeds its accepted hard limit');
    this.name = 'MatrixGenerationBatchBudgetLimitError';
    this.dimension = dimension;
  }
}

function safeFailureClassification(error: unknown): string {
  if (error instanceof ContentGenerationContextBudgetError) {
    return 'content_generation_context_budget';
  }
  if (error instanceof MatrixGenerationAuthorityBudgetError) {
    return 'matrix_generation_authority_budget';
  }
  if (error instanceof MatrixGenerationProviderInputEnvelopeError) {
    return 'matrix_generation_provider_input_envelope';
  }
  if (error instanceof MatrixGenerationBatchBudgetLimitError) {
    return 'matrix_generation_batch_budget_limit';
  }
  if (error instanceof TypeError) return 'type_error';
  if (error instanceof RangeError) return 'range_error';
  if (error instanceof SyntaxError) return 'syntax_error';
  return 'unexpected_error';
}

/**
 * Safe stage boundary for the preview-only ready tail. Raw exceptions are
 * deliberately not retained so MCP logging cannot accidentally serialize
 * prompts, evidence, causes, messages, or stacks.
 */
export class MatrixGenerationPreviewStageError extends Error {
  readonly code: MatrixGenerationPreviewFailureCode;
  readonly stage: MatrixGenerationPreviewStage;
  readonly cellId: string;
  readonly classification: string;
  readonly fieldPath: string | null;
  readonly constraint: string | null;

  private constructor(input: {
    code: MatrixGenerationPreviewFailureCode;
    stage: MatrixGenerationPreviewStage;
    cellId: string;
    classification: string;
    fieldPath?: string;
    constraint?: string;
  }) {
    super(input.code === 'precondition_failed'
      ? 'The matrix generation preview exceeds a safe generation limit.'
      : 'The matrix generation preview could not complete.');
    this.name = 'MatrixGenerationPreviewStageError';
    this.code = input.code;
    this.stage = input.stage;
    this.cellId = input.cellId;
    this.classification = input.classification;
    this.fieldPath = input.fieldPath ?? null;
    this.constraint = input.constraint ?? null;
  }

  static from(
    stage: MatrixGenerationPreviewStage,
    cellId: string,
    error: unknown,
  ): MatrixGenerationPreviewStageError {
    if (error instanceof MatrixGenerationPreviewStageError) return error;
    if (error instanceof ContentGenerationContextBudgetError) {
      return new MatrixGenerationPreviewStageError({
        code: 'precondition_failed',
        stage,
        cellId,
        classification: safeFailureClassification(error),
        fieldPath: `generation_context.${error.stage}`,
        constraint: `required frozen authority and target evidence must fit within the ${MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET}-token matrix context budget`,
      });
    }
    if (error instanceof MatrixGenerationAuthorityBudgetError) {
      return new MatrixGenerationPreviewStageError({
        code: 'precondition_failed',
        stage,
        cellId,
        classification: safeFailureClassification(error),
        fieldPath: 'generation_context.authority',
        constraint: `serialized frozen voice, approved identity, and custom notes must not exceed ${MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING} UTF-8 bytes`,
      });
    }
    if (error instanceof MatrixGenerationProviderInputEnvelopeError) {
      return new MatrixGenerationPreviewStageError({
        code: 'precondition_failed',
        stage,
        cellId,
        classification: safeFailureClassification(error),
        fieldPath: 'generation_context.provider_input',
        constraint: 'every rendered matrix provider input must fit the shared per-dispatch application envelope',
      });
    }
    if (error instanceof MatrixGenerationBatchBudgetLimitError) {
      return new MatrixGenerationPreviewStageError({
        code: 'precondition_failed',
        stage,
        cellId,
        classification: safeFailureClassification(error),
        fieldPath: `accepted_budget.${error.dimension}`,
        constraint: 'the complete batch estimate must fit the start-content-matrix-generation hard limits',
      });
    }
    return new MatrixGenerationPreviewStageError({
      code: 'internal_error',
      stage,
      cellId,
      classification: safeFailureClassification(error),
    });
  }
}

async function runPreviewStage<T>(
  stage: MatrixGenerationPreviewStage,
  cellId: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw MatrixGenerationPreviewStageError.from(stage, cellId, error);
  }
}

function approvedRef(deliverable: BrandDeliverable): ApprovedBrandDeliverableRef {
  const contentFingerprint = canonicalBrandGenerationFingerprint(deliverable.content);
  const approvedAt = deliverable.updatedAt;
  const base = {
    deliverableId: deliverable.id,
    deliverableType: deliverable.deliverableType,
    version: deliverable.version,
    approvedAt,
    contentFingerprint,
  };
  return { ...base, approvalFingerprint: brandGenerationApprovalFingerprint(base) };
}

function freezeIdentity(
  pageType: BriefPageType,
  deliverables: readonly BrandDeliverable[],
): FrozenIdentity {
  const allowed = new Set<BrandDeliverableType>(MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST[pageType]);
  const selected = deliverables
    .filter(deliverable => deliverable.status === 'approved'
      && allowed.has(deliverable.deliverableType)
      && deliverable.content.trim().length > 0)
    .sort((left, right) => left.deliverableType.localeCompare(right.deliverableType)
      || left.id.localeCompare(right.id));
  return {
    refs: selected.map(approvedRef),
    promptBlock: selected.length > 0
      ? `APPROVED BRAND IDENTITY (use only for positioning and messaging):\n${selected
          .map(deliverable => `${deliverable.deliverableType}: ${deliverable.content.trim()}`)
          .join('\n')}`
      : '',
    evidenceTimestamps: selected.map(deliverable => deliverable.updatedAt),
  };
}

function voiceRequirement(
  target: ResolvedMatrixStructuralTarget,
  snapshot: ReturnType<typeof getFinalizedVoiceSnapshotForGeneration> | null,
): GenerationEvidenceRequirement {
  const base = {
    id: `matrix-cell:${target.cellId}:finalized-voice`,
    fieldPath: 'brand.voice',
    claim: 'The page uses the current finalized brand voice authority.',
    reason: 'Paid page generation requires an immutable, operator-finalized voice.',
    requirementStage: 'preflight' as const,
    claimKind: 'structural' as const,
    clientSafePrompt: 'Finalize the brand voice before generating this page.',
  };
  if (!snapshot) return { ...base, status: 'missing', sourceRefs: [] };
  return {
    ...base,
    status: 'verified',
    sourceRefs: [{
      sourceType: 'voice_profile',
      sourceId: snapshot.voiceProfileId,
      sourceRevision: snapshot.voiceVersion,
      fieldPath: 'finalized_voice',
      label: 'Finalized brand voice',
      capturedAt: snapshot.finalizedAt,
    }],
  };
}

function identityRequirement(
  target: ResolvedMatrixStructuralTarget,
  identity: FrozenIdentity,
): GenerationEvidenceRequirement | null {
  if (target.pageType === 'location') return null;
  const base = {
    id: `matrix-cell:${target.cellId}:approved-identity`,
    fieldPath: 'brand.identity',
    claim: 'The page uses approved brand identity appropriate to its page type.',
    reason: 'Page messaging cannot be grounded in draft or unapproved brand positioning.',
    requirementStage: 'preflight' as const,
    claimKind: 'structural' as const,
    clientSafePrompt: 'Approve at least one relevant brand identity or messaging deliverable.',
  };
  if (identity.refs.length === 0) return { ...base, status: 'missing', sourceRefs: [] };
  const [firstRef, ...remainingRefs] = identity.refs.map(ref => ({
    sourceType: 'brand_deliverable' as const,
    sourceId: ref.deliverableId,
    sourceRevision: ref.version,
    fieldPath: ref.deliverableType,
    label: `Approved ${ref.deliverableType}`,
    capturedAt: ref.approvedAt,
  }));
  if (!firstRef) return { ...base, status: 'missing', sourceRefs: [] };
  return {
    ...base,
    status: 'verified',
    sourceRefs: [firstRef, ...remainingRefs],
  };
}

function artifactRequirements(
  workspaceId: string,
  target: ResolvedMatrixStructuralTarget,
  expected: MatrixArtifactRevisionExpectations,
): GenerationEvidenceRequirement[] {
  const requirements: GenerationEvidenceRequirement[] = [];
  if (expected.brief.artifactId && !getBrief(workspaceId, expected.brief.artifactId)) {
    requirements.push({
      id: `matrix-cell:${target.cellId}:linked-brief`,
      fieldPath: 'artifacts.brief',
      claim: 'The linked content brief exists.',
      reason: 'A missing linked artifact makes replacement authority ambiguous.',
      requirementStage: 'preflight',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Repair or clear the missing content brief link.',
    });
  }
  const existingPost = expected.post.artifactId
    ? getPost(workspaceId, expected.post.artifactId)
    : undefined;
  if (expected.post.artifactId && !existingPost) {
    requirements.push({
      id: `matrix-cell:${target.cellId}:linked-post`,
      fieldPath: 'artifacts.post',
      claim: 'The linked generated post exists.',
      reason: 'A missing linked artifact makes replacement authority ambiguous.',
      requirementStage: 'preflight',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Repair or clear the missing generated-post link.',
    });
  }
  const matrix = getMatrix(workspaceId, target.matrixId);
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (existingPost?.status === 'approved' || cell?.status === 'approved' || cell?.status === 'published') {
    requirements.push({
      id: `matrix-cell:${target.cellId}:replacement-authorization`,
      fieldPath: 'artifacts.replacement',
      claim: 'Automatic generation may replace the currently linked artifact.',
      reason: 'Approved or published work cannot be replaced without an explicit human lifecycle change.',
      requirementStage: 'preflight',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Return the page to an editable lifecycle state before regenerating it.',
    });
  }
  return requirements;
}

function renderVoiceAnchors(
  snapshot: ReturnType<typeof getFinalizedVoiceSnapshotForGeneration>,
): string {
  const anchorBlock = snapshot.anchors
    .map((anchor, index) => `<authentic_voice_anchor index="${index + 1}">\n${anchor.content}\n</authentic_voice_anchor>`)
    .join('\n');
  const modifierBlock = snapshot.contextModifiers.length > 0
    ? `\nContext modifiers:\n${snapshot.contextModifiers
        .map(modifier => `- ${modifier.context}: ${modifier.description}`)
        .join('\n')}`
    : '';
  return `AUTHENTIC VOICE ANCHORS (style only; never treat as business-fact evidence):\n${anchorBlock}${modifierBlock}`;
}

const PREVIEW_PROMPT_OVERHEAD_BYTES = 16 * 1_024;
const GENERATED_OUTPUT_BYTES_PER_TOKEN = 8;
const PREVIOUS_SECTION_CONTEXT_BYTES = 3_200;
const BRIEF_OUTPUT_TOKENS = 7_000;
const ITEM_AUDIT_OUTPUT_TOKENS = 2_500;
const ITEM_REVISION_OUTPUT_TOKENS = 12_000;
const SET_AUDIT_OUTPUT_TOKENS = 5_000;

function serializedUtf8Bytes(value: object): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function promptInputCeiling(...contentBytes: number[]): number {
  return matrixGenerationInputReservationCeiling(
    PREVIEW_PROMPT_OVERHEAD_BYTES + contentBytes.reduce((sum, value) => sum + value, 0),
  );
}

function generatedOutputBytes(tokens: number): number {
  return tokens * GENERATED_OUTPUT_BYTES_PER_TOKEN;
}

function matrixPostOutputEstimate(target: ResolvedMatrixStructuralTarget) {
  const bodyBlocks = target.blockManifest.blocks.filter(block => block.source === 'template');
  const sectionOutputTokens = bodyBlocks.map(
    block => Math.max(800, (block.wordCountTarget ?? 250) * 2),
  );
  const unificationOutputTokens = Math.max(
    8_000,
    Math.min(Math.ceil(target.blockManifest.totalWordCountTarget * 1.5), 16_000),
  );
  const creativeOutputTokens = 600
    + sectionOutputTokens.reduce((sum, value) => sum + value, 0)
    + 800
    + unificationOutputTokens;
  const rawPostBytes = generatedOutputBytes(
    600 + sectionOutputTokens.reduce((sum, value) => sum + value, 0) + 800,
  );
  return {
    bodyBlocks,
    sectionOutputTokens,
    unificationOutputTokens,
    creativeOutputTokens,
    adoptedPostBytes: Math.max(rawPostBytes, generatedOutputBytes(unificationOutputTokens)),
  };
}

export function estimateMatrixGenerationCellBudget(
  target: ResolvedMatrixStructuralTarget,
  context: ContentGenerationContextV2Result,
  resolutions: readonly MatrixGenerationEvidenceResolution[],
): MatrixGenerationCostEstimate {
  const {
    bodyBlocks,
    creativeOutputTokens,
    adoptedPostBytes,
  } = matrixPostOutputEstimate(target);
  const auditPostBytes = Math.max(
    adoptedPostBytes,
    generatedOutputBytes(ITEM_REVISION_OUTPUT_TOKENS),
  );
  const briefOutputBytes = generatedOutputBytes(BRIEF_OUTPUT_TOKENS);
  const targetBytes = serializedUtf8Bytes(target);
  const authorityBytes = serializedUtf8Bytes({
    authority: context.authority,
    evidenceResolutions: resolutions,
  });
  const briefProjectionBytes = Buffer.byteLength(context.projections.brief, 'utf8');
  const draftProjectionBytes = Buffer.byteLength(context.projections.draft, 'utf8');

  const briefInput = promptInputCeiling(
    targetBytes,
    authorityBytes,
    briefProjectionBytes,
  );
  const draftStageInput = promptInputCeiling(
    authorityBytes,
    draftProjectionBytes,
    briefOutputBytes,
  );
  const priorSectionInput = PREVIOUS_SECTION_CONTEXT_BYTES
    * bodyBlocks.length
    * Math.max(0, bodyBlocks.length - 1)
    / 2;
  const maximumPriorSectionInput = matrixGenerationInputReservationCeiling(
    PREVIOUS_SECTION_CONTEXT_BYTES * Math.max(0, bodyBlocks.length - 1),
  ) - matrixGenerationInputReservationCeiling(0);
  const maximumProseStageInputPerDispatch = draftStageInput + maximumPriorSectionInput;
  const proseStageInput = (draftStageInput * 2 * (bodyBlocks.length + 2))
    + (priorSectionInput * 2);
  const unificationInputPerDispatch = promptInputCeiling(
    authorityBytes,
    draftProjectionBytes,
    briefOutputBytes,
    adoptedPostBytes,
  );
  const unificationInput = unificationInputPerDispatch * 2;
  const seoInput = promptInputCeiling(authorityBytes, briefOutputBytes);
  const itemOperationInputPerDispatch = promptInputCeiling(
    targetBytes,
    authorityBytes,
    auditPostBytes,
  );
  const itemOperationInput = itemOperationInputPerDispatch * 3;
  [
    briefInput,
    draftStageInput,
    maximumProseStageInputPerDispatch,
    unificationInputPerDispatch,
    seoInput,
    itemOperationInputPerDispatch,
  ].forEach(assertMatrixGenerationEstimatedProviderInput);
  const inputTokens = briefInput
    + proseStageInput
    + unificationInput
    + seoInput
    + itemOperationInput;

  // Creative prose may reserve both Anthropic and OpenAI when fallback is needed.
  // Three item-level calls cover the reachable audit→revision→audit ceiling.
  const providerCalls = 1 + (2 * (bodyBlocks.length + 3)) + 1 + 3;
  const outputTokens = BRIEF_OUTPUT_TOKENS
    + (creativeOutputTokens * 2)
    + 200
    + (ITEM_AUDIT_OUTPUT_TOKENS * 2)
    + ITEM_REVISION_OUTPUT_TOKENS;
  return {
    providerCalls,
    inputTokens,
    outputTokens,
    estimatedUsd: matrixGenerationEstimatedUsdCeiling(inputTokens, outputTokens),
    maxConcurrency: 1,
  };
}

export function estimateMatrixGenerationBatchBudget(
  targets: readonly MatrixGenerationPreviewTarget[],
): MatrixGenerationCostEstimate {
  const estimates = targets.map(target => target.estimatedPaidBudget);
  const generationInput = estimates.reduce((sum, estimate) => sum + estimate.inputTokens, 0);
  const generationOutput = estimates.reduce((sum, estimate) => sum + estimate.outputTokens, 0);
  const setAuditPasses = targets.length >= 2 ? 2 : 0;
  const setAuditInputPerDispatch = setAuditPasses === 0
    ? 0
    : estimateMatrixGenerationSetAuditInputReservation(targets);
  if (setAuditInputPerDispatch > 0) {
    assertMatrixGenerationEstimatedProviderInput(setAuditInputPerDispatch);
  }
  const inputTokens = generationInput + (setAuditInputPerDispatch * setAuditPasses);
  const outputTokens = generationOutput + (SET_AUDIT_OUTPUT_TOKENS * setAuditPasses);
  const estimate = {
    providerCalls: estimates.reduce((sum, estimate) => sum + estimate.providerCalls, 0)
      + setAuditPasses,
    inputTokens,
    outputTokens,
    estimatedUsd: matrixGenerationEstimatedUsdCeiling(inputTokens, outputTokens),
    maxConcurrency: Math.min(MATRIX_GENERATION_BATCH_LIMITS.maxConcurrency, targets.length),
  };
  const limits = [
    ['provider_calls', estimate.providerCalls, MATRIX_GENERATION_BATCH_LIMITS.maxProviderCalls],
    ['input_tokens', estimate.inputTokens, MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens],
    ['output_tokens', estimate.outputTokens, MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens],
    ['estimated_usd', estimate.estimatedUsd, MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd],
    ['max_concurrency', estimate.maxConcurrency, MATRIX_GENERATION_BATCH_LIMITS.maxConcurrency],
  ] as const;
  const exceeded = limits.find(([, actual, limit]) => actual > limit);
  if (exceeded) throw new MatrixGenerationBatchBudgetLimitError(exceeded[0]);
  return estimate;
}

function previewSetAuditItemId(index: number): string {
  const suffix = index.toString().padStart(4, '0');
  const emojiBytes = Buffer.byteLength('🧭', 'utf8');
  const count = Math.floor(
    (MATRIX_GENERATION_SET_AUDIT_MAX_ITEM_ID_UTF8_BYTES
      - Buffer.byteLength(suffix, 'utf8')) / emojiBytes,
  );
  return `${'🧭'.repeat(count)}${suffix}`;
}

export function estimateMatrixGenerationSetAuditInputReservation(
  targets: readonly MatrixGenerationPreviewTarget[],
): number {
  const maximumPageText = '🧭'.repeat(MATRIX_GENERATION_SET_AUDIT_MAX_PAGE_TEXT_CHARS);
  const pages = targets.map((target, index) => projectMatrixGenerationSetAuditPage({
    itemId: previewSetAuditItemId(index),
    target,
    text: maximumPageText,
  }));
  const { renderedInput } = renderMatrixGenerationSetAuditProviderInput(pages);
  const serializedUtf8Bytes = matrixGenerationRenderedInputUtf8Bytes({
    provider: 'openai',
    fallback: false,
    renderedInput,
    maxOutputTokens: SET_AUDIT_OUTPUT_TOKENS,
  });
  return matrixGenerationInputReservationCeiling(serializedUtf8Bytes);
}

function evidenceRange(timestamps: readonly string[], fallback: string) {
  const sorted = [...new Set(timestamps.filter(Boolean))].sort();
  return {
    capturedAt: sorted.at(-1) ?? fallback,
    freshThrough: sorted[0] ?? fallback,
  };
}

export async function prepareMatrixGenerationCell(
  workspaceId: string,
  structural: Extract<
    Awaited<ReturnType<typeof resolveMatrixStructures>>['results'][number],
    { status: 'resolved' }
  >,
  pageCensus: WorkspaceKnownPageCensus,
): Promise<PreparedMatrixGenerationCell> {
  const target = structural.target;
  const matrix = getMatrix(workspaceId, target.matrixId);
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (!matrix || !cell) {
    return {
      result: {
        status: 'blocked',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        omittedOptionalSections: target.blockManifest.omittedOptionalSections ?? [],
        evidenceRequirements: target.structuralRequirements,
        blockingRequirementIds: target.structuralBlockingRequirementIds,
        expectedArtifactRevisions: {
          brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
          post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
        },
      },
    };
  }
  const expectedArtifactRevisions = matrixArtifactRevisionExpectations(workspaceId, cell);
  const resolutions = listCurrentMatrixCellEvidence(
    workspaceId,
    target.matrixId,
    target.cellId,
  );
  const verifiedInternalLinks = freezeMatrixGenerationVerifiedInternalLinks(
    target,
    resolutions,
    pageCensus,
  );
  const cellRequirements = buildMatrixCellEvidenceRequirements(
    target,
    resolutions,
    new Set(verifiedInternalLinks.map(block => block.evidenceRequirementId)),
  );
  const identity = freezeIdentity(target.pageType, listDeliverables(workspaceId));

  const voiceSummary = getBrandVoiceAuthoritySummary(workspaceId);
  let voiceSnapshot: ReturnType<typeof getFinalizedVoiceSnapshotForGeneration> | null = null;
  if (voiceSummary.readiness.state === 'finalized') {
    voiceSnapshot = getFinalizedVoiceSnapshotForGeneration({
      workspaceId,
      expectedVoiceVersion: voiceSummary.readiness.snapshot.voiceVersion,
      expectedFingerprint: voiceSummary.readiness.snapshot.fingerprint,
      requireCurrentAuthority: true,
    });
  }

  const requiredIdentity = identityRequirement(target, identity);
  const requirements = [
    ...target.structuralRequirements,
    ...cellRequirements,
    voiceRequirement(target, voiceSnapshot),
    ...(requiredIdentity ? [requiredIdentity] : []),
    ...artifactRequirements(workspaceId, target, expectedArtifactRevisions),
  ];
  const blockingRequirementIds = requirements
    .filter(requirement => requirement.requirementStage === 'preflight'
      && (requirement.status === 'missing' || requirement.status === 'conflicting'))
    .map(requirement => requirement.id);
  if (!voiceSnapshot || blockingRequirementIds.length > 0) {
    return {
      result: {
        status: 'blocked',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        omittedOptionalSections: target.blockManifest.omittedOptionalSections ?? [],
        evidenceRequirements: requirements,
        blockingRequirementIds,
        expectedArtifactRevisions,
      },
    };
  }

  const context = await runPreviewStage('generation_context', target.cellId, () => {
    const authority = {
      systemVoiceBlock: renderSystemVoiceAuthorityBlock(
        voiceSnapshot.voiceDNA,
        voiceSnapshot.guardrails,
      ),
      userVoiceBlock: renderVoiceAnchors(voiceSnapshot),
      identityPromptBlock: identity.promptBlock,
      customNotes: getCustomPromptNotes(workspaceId),
      voice: {
        status: 'calibrated' as const,
        readiness: 'finalized' as const,
        profileRevision: voiceSnapshot.profileRevision,
        voiceVersion: voiceSnapshot.voiceVersion,
      },
    };
    if (serializedUtf8Bytes(authority) > MATRIX_GENERATION_AUTHORITY_UTF8_BYTE_CEILING) {
      throw new MatrixGenerationAuthorityBudgetError();
    }
    return buildContentGenerationContextV2(workspaceId, {
      targetKeyword: target.targetKeyword.value,
      pagePath: target.plannedUrl,
      allowKeywordTargetMatch: false,
      providerMetricsObservedAt: target.targetKeyword.validation?.validatedAt ?? null,
      authority,
      budgets: MATRIX_GENERATION_CONTEXT_BUDGETS,
      projectionTokenEstimator: matrixGenerationProjectionTokenEstimate,
    });
  });
  const estimatedPaidBudget = await runPreviewStage('cell_budget', target.cellId, () => (
    estimateMatrixGenerationCellBudget(target, context, resolutions)
  ));
  const evidence = await runPreviewStage('evidence_range', target.cellId, () => evidenceRange([
    ...context.evidence.observedAt,
    voiceSnapshot.finalizedAt,
    ...identity.evidenceTimestamps,
    ...resolutions.map(resolution => resolution.sourceRef.capturedAt),
  ], context.evidence.capturedAt));
  const previewCore = {
    structuralFingerprint: target.structuralFingerprint,
    blockManifestFingerprint: target.blockManifest.fingerprint,
    voiceSnapshot: {
      voiceProfileId: voiceSnapshot.voiceProfileId,
      voiceVersion: voiceSnapshot.voiceVersion,
      finalizedBy: voiceSnapshot.finalizedBy,
      finalizedAt: voiceSnapshot.finalizedAt,
      fingerprint: voiceSnapshot.fingerprint,
      anchorEvidenceRefs: voiceSnapshot.anchorEvidenceRefs,
    },
    identitySnapshot: identity.refs,
    evidenceRequirements: requirements,
    expectedArtifactRevisions,
    contextFingerprint: context.effectiveInputFingerprint,
    estimatedPaidBudget,
    ...(verifiedInternalLinks.length > 0 ? { verifiedInternalLinks } : {}),
  };
  const effectiveInputFingerprint = await runPreviewStage(
    'preview_fingerprint',
    target.cellId,
    () => canonicalGenerationFingerprint(previewCore),
  );
  const previewTarget: MatrixGenerationPreviewTarget = {
    ...target,
    voiceSnapshot: previewCore.voiceSnapshot,
    identitySnapshot: identity.refs,
    evidenceRequirements: requirements,
    evidenceCapturedAt: evidence.capturedAt,
    evidenceFreshThrough: evidence.freshThrough,
    expectedArtifactRevisions,
    effectiveInputFingerprint,
    blockingRequirementIds: [],
    estimatedPaidBudget,
    ...(verifiedInternalLinks.length > 0 ? { verifiedInternalLinks } : {}),
  };
  return {
    result: {
      status: 'ready',
      matrixId: target.matrixId,
      templateId: target.templateId,
      cellId: target.cellId,
      sourceRevision: target.sourceRevision,
      target: previewTarget,
    },
    context,
  };
}

export async function previewMatrixGeneration(
  request: PreviewMatrixGenerationRequest,
): Promise<PreviewMatrixGenerationResult> {
  const structuralWithCensus = await resolveMatrixStructuresWithCensus(request);
  const structural = structuralWithCensus.result;
  const results: MatrixGenerationPreviewResult[] = [];
  for (const item of structural.results) {
    if (item.status === 'upgrade_required') {
      results.push({
        status: 'upgrade_required',
        matrixId: item.matrixId,
        templateId: item.templateId,
        cellId: item.cellId,
        sourceRevision: item.sourceRevision,
        proposal: item.proposal,
      });
      continue;
    }
    if (item.status === 'blocked') {
      const matrix = getMatrix(request.workspaceId, item.matrixId);
      const cell = matrix?.cells.find(candidate => candidate.id === item.cellId);
      results.push({
        status: 'blocked',
        matrixId: item.matrixId,
        templateId: item.templateId,
        cellId: item.cellId,
        sourceRevision: item.sourceRevision,
        omittedOptionalSections: [],
        evidenceRequirements: item.blockers,
        blockingRequirementIds: item.blockers.map(blocker => blocker.id),
        expectedArtifactRevisions: cell
          ? matrixArtifactRevisionExpectations(request.workspaceId, cell)
          : {
              brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
              post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
            },
      });
      continue;
    }
    results.push((await prepareMatrixGenerationCell(
      request.workspaceId,
      item,
      structuralWithCensus.pageCensus,
    )).result);
  }
  const readyResults = results.filter(
    (result): result is Extract<MatrixGenerationPreviewResult, { status: 'ready' }> => (
      result.status === 'ready'
    ),
  );
  const estimatedBatchBudget = readyResults.length === results.length
    ? await runPreviewStage(
        'batch_budget',
        readyResults[0]?.cellId ?? request.selections[0]?.cellId ?? 'unknown',
        () => estimateMatrixGenerationBatchBudget(
          readyResults.map(result => result.target),
        ),
      )
    : null;
  return {
    results,
    estimatedBatchBudget,
  };
}

export function assertPreviewIdentityCurrent(
  workspaceId: string,
  target: MatrixGenerationPreviewTarget,
): void {
  const matrix = getMatrix(workspaceId, target.matrixId);
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (!matrix || !cell) throw new Error('Matrix generation source no longer exists');
  const template = getTemplate(workspaceId, matrix.templateId);
  if (!template) throw new Error('Matrix generation template no longer exists');
  const sourceRevision = {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: template.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
  if (canonicalGenerationFingerprint(sourceRevision)
    !== canonicalGenerationFingerprint(target.sourceRevision)) {
    throw new Error('Matrix generation source changed after preview');
  }
  if (canonicalGenerationFingerprint(matrixArtifactRevisionExpectations(workspaceId, cell))
    !== canonicalGenerationFingerprint(target.expectedArtifactRevisions)) {
    throw new Error('A linked content artifact changed after preview');
  }
  getFinalizedVoiceSnapshotForGeneration({
    workspaceId,
    expectedVoiceVersion: target.voiceSnapshot.voiceVersion,
    expectedFingerprint: target.voiceSnapshot.fingerprint,
    requireCurrentAuthority: true,
  });
  const current = freezeIdentity(target.pageType, listDeliverables(workspaceId));
  if (canonicalGenerationFingerprint(current.refs)
    !== canonicalGenerationFingerprint(target.identitySnapshot)) {
    throw new Error('Approved brand identity changed after preview');
  }
}
