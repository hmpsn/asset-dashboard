import type {
  AuthorizeBrandContentGenerationRequest,
  AuthorizeBrandContentGenerationResult,
  BrandContentOnboardingCommandResult,
  BrandContentOnboardingGateEvidence,
  BrandContentOnboardingResumeStatus,
  BrandContentOnboardingRun,
  GetBrandContentOnboardingRequest,
  PublicBrandContentOnboardingCreatorAttribution,
  PublicBrandContentOnboardingRun,
  ResumeBrandContentOnboardingRequest,
  ResumeBrandContentOnboardingResult,
  StartBrandContentOnboardingRequest,
  StartBrandContentOnboardingResult,
} from '../../../shared/types/brand-content-onboarding.js';
import type {
  BrandReviewBundleKind,
  BrandReviewItemPayload,
} from '../../../shared/types/brand-generation.js';
import type { BrandDeliverableType } from '../../../shared/types/brand-engine.js';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import type {
  GetMatrixGenerationResult,
  MatrixGenerationItemRead,
  StartMatrixGenerationSelection,
} from '../../../shared/types/matrix-generation.js';
import {
  MatrixGenerationSchemaTypeContractError,
  MatrixGenerationSourceLimitError,
} from '../../../shared/types/matrix-generation.js';
import { addActivity } from '../../activity-log.js';
import { listDeliverables as listBrandDeliverables } from '../../brand-deliverable-read-model.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { findBySourceRef } from '../../client-deliverables.js';
import { getMatrix } from '../../content-matrices.js';
import { getPost } from '../../content-posts-db.js';
import { getTemplate } from '../../content-templates.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { canonicalGenerationFingerprint } from '../../generation-provenance.js';
import { ActiveJobResourceConflict } from '../../jobs.js';
import { createLogger } from '../../logger.js';
import { WS_EVENTS } from '../../ws-events.js';
import {
  assertContentPublishTargetIdentity,
  captureContentPublishAuthority,
} from '../content/publish-post-to-webflow.js';
import {
  MatrixGenerationBatchNotFoundError,
  MatrixGenerationBatchPreconditionError,
  getMatrixGeneration,
  getMatrixGenerationByIdempotency,
  startMatrixGeneration,
} from '../content/matrix-generation/batch-service.js';
import {
  MatrixGenerationRevisionConflictError,
  MatrixGenerationRunIdempotencyConflictError,
} from '../content/matrix-generation/repository.js';
import { MatrixReadServiceError } from '../content/matrix-generation/read-service.js';
import {
  MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST,
  previewMatrixGeneration,
} from '../content/matrix-generation/preview.js';
import { getBrandIntakeRevision } from '../brand/intake/index.js';
import {
  getBrandGeneration,
  resumeBrandGeneration,
  startBrandGeneration,
} from '../brand/generation/service.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationBudgetExceededError,
  BrandGenerationConcurrencyLimitError,
  BrandGenerationFeatureDisabledError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationNotFoundError,
  BrandGenerationPreconditionError,
  BrandGenerationRevisionConflictError,
} from '../brand/generation/errors.js';
import { approvedBrandDeliverableRef } from '../brand/generation/snapshots.js';
import {
  getBrandVoiceAuthoritySummary,
  getFinalizedVoiceSnapshotForGeneration,
  VoiceFinalizationConflictError,
  VoiceFinalizationNotFoundError,
  VoiceFinalizationPreconditionError,
  VoiceFinalizationReadConflictError,
  VoiceGenerationAuthorityConflictError,
} from '../brand/voice-finalization.js';
import {
  parseBrandReviewBundlePayload,
  parseBrandReviewItemPayload,
} from '../brand/review-contracts.js';
import {
  createBrandContentOnboardingRun,
  getBrandContentOnboardingResumeReplay,
  getBrandContentOnboardingRun as getPersistedRun,
  transitionBrandContentOnboardingRun,
} from './repository.js';

export type BrandContentOnboardingServiceErrorCode =
  | 'feature_disabled'
  | 'not_found'
  | 'precondition_failed'
  | 'authority_changed';

export class BrandContentOnboardingServiceError extends Error {
  readonly code: BrandContentOnboardingServiceErrorCode;
  readonly status: number;
  constructor(code: BrandContentOnboardingServiceErrorCode, message: string, status: number) {
    super(message);
    this.name = 'BrandContentOnboardingServiceError';
    this.code = code;
    this.status = status;
  }
}

function translateExpectedChildError(error: unknown): never {
  if (error instanceof BrandGenerationFeatureDisabledError) {
    throw new BrandContentOnboardingServiceError('feature_disabled', error.message, 403);
  }
  if (error instanceof BrandGenerationBudgetExceededError
    || error instanceof BrandGenerationApprovedDeliverableError
    || error instanceof BrandGenerationPreconditionError
    || error instanceof MatrixGenerationBatchPreconditionError
    || error instanceof MatrixGenerationSourceLimitError
    || error instanceof MatrixGenerationSchemaTypeContractError) {
    throw new BrandContentOnboardingServiceError('precondition_failed', error.message, 422);
  }
  if (error instanceof MatrixReadServiceError) {
    throw new BrandContentOnboardingServiceError(
      error.code === 'conflict' ? 'authority_changed' : 'precondition_failed',
      error.message,
      error.code === 'precondition_failed' ? 422 : 409,
    );
  }
  if (error instanceof VoiceFinalizationConflictError
    || error instanceof VoiceFinalizationReadConflictError
    || error instanceof VoiceGenerationAuthorityConflictError) {
    throw new BrandContentOnboardingServiceError('authority_changed', error.message, 409);
  }
  if (error instanceof BrandGenerationConcurrencyLimitError
    || error instanceof BrandGenerationIdempotencyConflictError
    || error instanceof BrandGenerationNotFoundError
    || error instanceof BrandGenerationRevisionConflictError
    || error instanceof MatrixGenerationBatchNotFoundError
    || error instanceof MatrixGenerationRunIdempotencyConflictError
    || error instanceof MatrixGenerationRevisionConflictError
    || error instanceof VoiceFinalizationNotFoundError
    || error instanceof VoiceFinalizationPreconditionError
    || error instanceof ActiveJobResourceConflict) {
    throw new BrandContentOnboardingServiceError('precondition_failed', error.message, 409);
  }
  throw error;
}

const log = createLogger('brand-content-onboarding');

function defaultPublishPreflight(
  workspaceId: string,
  postId: string,
  expectedRevision: number,
): string {
  const post = getPost(workspaceId, postId);
  if (!post || post.status !== 'approved' || post.generationRevision !== expectedRevision) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'An approved page changed after human review',
      409,
    );
  }
  const authority = captureContentPublishAuthority(workspaceId, post);
  assertContentPublishTargetIdentity(
    workspaceId,
    post.id,
    post,
    authority.config.collectionId,
  );
  return `post:${post.id}:${canonicalGenerationFingerprint({
    postRevision: post.generationRevision,
    configFingerprint: authority.config.fingerprint,
    brief: authority.brief,
  })}`;
}

export interface BrandContentOnboardingDependencies {
  isFeatureEnabled: typeof isFeatureEnabled;
  getBrandIntakeRevision: typeof getBrandIntakeRevision;
  startBrandGeneration: typeof startBrandGeneration;
  getBrandGeneration: typeof getBrandGeneration;
  resumeBrandGeneration: typeof resumeBrandGeneration;
  getBrandVoiceAuthoritySummary: typeof getBrandVoiceAuthoritySummary;
  getFinalizedVoiceSnapshotForGeneration: typeof getFinalizedVoiceSnapshotForGeneration;
  findBySourceRef: typeof findBySourceRef;
  listBrandDeliverables: typeof listBrandDeliverables;
  assertMatrixSelectionCurrent: typeof defaultAssertMatrixSelectionCurrent;
  previewMatrixGeneration: typeof previewMatrixGeneration;
  startMatrixGeneration: typeof startMatrixGeneration;
  getMatrixGeneration: typeof getMatrixGeneration;
  getMatrixGenerationByIdempotency: typeof getMatrixGenerationByIdempotency;
  assertPagePublishPreconditions: typeof defaultPublishPreflight;
}

const DEFAULT_DEPENDENCIES: BrandContentOnboardingDependencies = {
  isFeatureEnabled,
  getBrandIntakeRevision,
  startBrandGeneration,
  getBrandGeneration,
  resumeBrandGeneration,
  getBrandVoiceAuthoritySummary,
  getFinalizedVoiceSnapshotForGeneration,
  findBySourceRef,
  listBrandDeliverables,
  assertMatrixSelectionCurrent: defaultAssertMatrixSelectionCurrent,
  previewMatrixGeneration,
  startMatrixGeneration,
  getMatrixGeneration,
  getMatrixGenerationByIdempotency,
  assertPagePublishPreconditions: defaultPublishPreflight,
};

function dependencies(
  overrides?: Partial<BrandContentOnboardingDependencies>,
): BrandContentOnboardingDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function assertEnabled(workspaceId: string, deps: BrandContentOnboardingDependencies): void {
  if (!deps.isFeatureEnabled('brand-deliverable-generation', workspaceId)
    || !deps.isFeatureEnabled('content-matrix-generation', workspaceId)) {
    throw new BrandContentOnboardingServiceError(
      'feature_disabled',
      'Brand and content generation must both be enabled for onboarding orchestration',
      403,
    );
  }
}

function defaultAssertMatrixSelectionCurrent(
  workspaceId: string,
  selection: StartBrandContentOnboardingRequest['matrixSelection'],
): void {
  const matrixIds = new Set(selection.map(item => item.matrixId));
  const cellIds = new Set(selection.map(item => item.cellId));
  if (matrixIds.size !== 1 || cellIds.size !== selection.length) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'Onboarding requires unique cells from exactly one content matrix',
      422,
    );
  }
  const matrixId = selection[0].matrixId;
  const matrix = getMatrix(workspaceId, matrixId);
  const template = matrix ? getTemplate(workspaceId, matrix.templateId) : null;
  if (!matrix || !template) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The selected content matrix or template no longer exists',
      409,
    );
  }
  const cells = new Map(matrix.cells.map(cell => [cell.id, cell]));
  const matrixRevision = matrix.revision ?? 0;
  const templateRevision = template.revision ?? 0;
  if (selection.some(item => {
    const cell = cells.get(item.cellId);
    return !cell
      || item.sourceRevision.matrixRevision !== matrixRevision
      || item.sourceRevision.templateRevision !== templateRevision
      || item.sourceRevision.cellRevision !== (cell.revision ?? 0);
  })) {
    throw new BrandContentOnboardingServiceError(
      'authority_changed',
      'A selected content-matrix source changed before brand generation started',
      409,
    );
  }
}

function projectAttribution(
  attribution: BrandContentOnboardingRun['createdBy'],
): PublicBrandContentOnboardingCreatorAttribution {
  return attribution.actorType === 'operator' || attribution.actorType === 'client'
    ? attribution
    : { actorType: attribution.actorType };
}

function projectRun(run: BrandContentOnboardingRun): PublicBrandContentOnboardingRun {
  const { idempotencyKey: _idempotencyKey, createdBy, gateEvidence, ...safe } = run;
  void _idempotencyKey;
  return {
    ...safe,
    createdBy: projectAttribution(createdBy),
    gateEvidence: gateEvidence.map(evidence => ({
      ...evidence,
      recordedBy: projectAttribution(evidence.recordedBy),
    })) as PublicBrandContentOnboardingRun['gateEvidence'],
  };
}

function commandResult(
  run: BrandContentOnboardingRun,
  options: Pick<BrandContentOnboardingCommandResult, 'advanced' | 'replayed' | 'paidJobId'>,
  actor: BrandContentOnboardingRun['createdBy'] = run.createdBy,
): BrandContentOnboardingCommandResult {
  if (options.advanced && !options.replayed) {
    const metadata = {
      domain: 'brand-content-onboarding',
      runId: run.id,
      status: run.status,
      revision: run.revision,
    };
    try {
      addActivity(
        run.workspaceId,
        'content_updated',
        'Advanced brand-to-content onboarding',
        `Onboarding is now ${run.status.replaceAll('_', ' ')}.`,
        metadata,
        { id: actor.actorId, name: actor.actorLabel },
      );
    } catch (err) {
      log.warn({ err, workspaceId: run.workspaceId, runId: run.id }, 'onboarding activity failed');
    }
    try {
      broadcastToWorkspace(run.workspaceId, WS_EVENTS.WORKSPACE_UPDATED, metadata);
    } catch (err) {
      log.warn({ err, workspaceId: run.workspaceId, runId: run.id }, 'onboarding broadcast failed');
    }
  }
  return { run: projectRun(run), ...options };
}

interface BrandReviewSnapshot {
  deliverable: ClientDeliverable;
  runRevision: number;
  items: Array<{
    rowStatus: string;
    payload: BrandReviewItemPayload;
  }>;
}

function reviewSourceRef(kind: BrandReviewBundleKind, runId: string): string {
  return `brand_generation:${kind}:${runId}`;
}

function readReview(
  deps: BrandContentOnboardingDependencies,
  workspaceId: string,
  kind: BrandReviewBundleKind,
  runId: string,
): BrandReviewSnapshot | null {
  const deliverable = deps.findBySourceRef(
    workspaceId,
    'brand_generation',
    reviewSourceRef(kind, runId),
  );
  if (!deliverable) return null;
  const payload = parseBrandReviewBundlePayload(deliverable.payload);
  if (payload.reviewKind !== kind || payload.runId !== runId) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'Stored brand review identity does not match the onboarding run',
      409,
    );
  }
  const items = (deliverable.items ?? []).map(row => ({
    rowStatus: row.status,
    payload: parseBrandReviewItemPayload(row.itemPayload),
  }));
  if (items.length === 0 || items.some(item => (
    item.payload.reviewKind !== kind || item.payload.runId !== runId
  ))) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'Stored brand review items do not match the onboarding run',
      409,
    );
  }
  return { deliverable, runRevision: payload.runRevision, items };
}

function reviewHasChanges(review: BrandReviewSnapshot): boolean {
  return review.items.some(item => (
    item.rowStatus === 'changes_requested'
    || item.payload.decision?.decision === 'changes_requested'
  ));
}

function reviewIsApproved(review: BrandReviewSnapshot): boolean {
  return review.deliverable.status === 'approved'
    && review.items.every(item => (
      item.rowStatus === 'approved'
      && item.payload.decision?.decision === 'approve'
    ));
}

function exactEvidenceId(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The named gate evidence is not the current durable authority',
      409,
    );
  }
}

function approvedIdentityFromReview(
  deps: BrandContentOnboardingDependencies,
  workspaceId: string,
  review: BrandReviewSnapshot,
) {
  const sourceIds = review.items.map(item => item.payload.sourceDeliverableId);
  if (sourceIds.some(id => id === null) || new Set(sourceIds).size !== sourceIds.length) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'Approved brand review does not identify one durable source per item',
      409,
    );
  }
  const deliverables = new Map(
    deps.listBrandDeliverables(workspaceId).map(deliverable => [deliverable.id, deliverable]),
  );
  return review.items.map(item => {
    const id = item.payload.sourceDeliverableId;
    const deliverable = id ? deliverables.get(id) : null;
    if (!deliverable
      || deliverable.status !== 'approved'
      || deliverable.version !== item.payload.expectedDeliverableVersion) {
      throw new BrandContentOnboardingServiceError(
        'precondition_failed',
        'A reviewed brand deliverable changed or is no longer approved',
        409,
      );
    }
    return approvedBrandDeliverableRef(deliverable);
  }).sort((left, right) => (
    left.deliverableType.localeCompare(right.deliverableType)
    || left.deliverableId.localeCompare(right.deliverableId)
  ));
}

function brandAuthorityIsCurrent(
  deps: BrandContentOnboardingDependencies,
  run: BrandContentOnboardingRun,
): boolean {
  if (!run.finalizedVoice || run.approvedIdentity.length === 0) return false;
  const voice = deps.getBrandVoiceAuthoritySummary(run.workspaceId).readiness;
  if (voice.state !== 'finalized'
    || voice.snapshot.voiceVersion !== run.finalizedVoice.voiceVersion
    || voice.snapshot.fingerprint !== run.finalizedVoice.fingerprint) return false;
  const current = new Map(
    deps.listBrandDeliverables(run.workspaceId).map(deliverable => [deliverable.id, deliverable]),
  );
  return run.approvedIdentity.every(frozen => {
    const deliverable = current.get(frozen.deliverableId);
    if (!deliverable || deliverable.status !== 'approved') return false;
    return canonicalGenerationFingerprint(approvedBrandDeliverableRef(deliverable))
      === canonicalGenerationFingerprint(frozen);
  });
}

function frozenIdentityForPageType(
  run: BrandContentOnboardingRun,
  pageType: keyof typeof MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST,
) {
  const allowed = new Set<BrandDeliverableType>(MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST[pageType]);
  return run.approvedIdentity
    .filter(ref => allowed.has(ref.deliverableType))
    .sort((left, right) => (
      left.deliverableType.localeCompare(right.deliverableType)
      || left.deliverableId.localeCompare(right.deliverableId)
    ));
}

function resumeFingerprint(request: ResumeBrandContentOnboardingRequest): string {
  return canonicalGenerationFingerprint({
    workspaceId: request.workspaceId,
    runId: request.runId,
    expectedRevision: request.expectedRevision,
    expectedStatus: request.expectedStatus,
    gateEvidenceId: request.gateEvidenceId,
  });
}

interface ResumeTransition {
  nextStatus: Parameters<typeof transitionBrandContentOnboardingRun>[0]['nextStatus'];
  currentGate: Parameters<typeof transitionBrandContentOnboardingRun>[0]['currentGate'];
  attentionResumeStatus: Parameters<typeof transitionBrandContentOnboardingRun>[0]['attentionResumeStatus'];
  finalizedVoice?: Parameters<typeof transitionBrandContentOnboardingRun>[0]['finalizedVoice'];
  approvedIdentity?: Parameters<typeof transitionBrandContentOnboardingRun>[0]['approvedIdentity'];
  children?: Parameters<typeof transitionBrandContentOnboardingRun>[0]['children'];
  evidence?: BrandContentOnboardingGateEvidence[];
  paidJobId?: string | null;
}

function applyResumeTransition(
  run: BrandContentOnboardingRun,
  request: ResumeBrandContentOnboardingRequest,
  transition: ResumeTransition,
): ResumeBrandContentOnboardingResult {
  const result = transitionBrandContentOnboardingRun({
    workspaceId: run.workspaceId,
    runId: run.id,
    expectedRevision: request.expectedRevision,
    expectedStatus: request.expectedStatus,
    nextStatus: transition.nextStatus,
    currentGate: transition.currentGate,
    attentionResumeStatus: transition.attentionResumeStatus,
    finalizedVoice: transition.finalizedVoice,
    approvedIdentity: transition.approvedIdentity,
    children: transition.children,
    evidence: transition.evidence,
    resume: {
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: resumeFingerprint(request),
    },
    paidJobId: transition.paidJobId ?? null,
  });
  return commandResult(result.run, {
    advanced: !result.replayed,
    replayed: result.replayed,
    paidJobId: transition.paidJobId ?? null,
  }, request.resumedBy);
}

function needsAttention(
  run: BrandContentOnboardingRun,
  request: ResumeBrandContentOnboardingRequest,
  evidence?: BrandContentOnboardingGateEvidence[],
): ResumeBrandContentOnboardingResult {
  if (run.status === 'needs_attention') {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The onboarding run is already waiting for attention',
      409,
    );
  }
  if (run.status === 'intake_ready' || run.status === 'ready_to_publish'
    || run.status === 'cancelled' || run.status === 'failed') {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'A terminal onboarding run cannot enter needs-attention recovery',
      409,
    );
  }
  return applyResumeTransition(run, request, {
    nextStatus: 'needs_attention',
    currentGate: run.currentGate,
    attentionResumeStatus: run.status as BrandContentOnboardingResumeStatus,
    evidence,
  });
}

function getAllMatrixItems(
  deps: BrandContentOnboardingDependencies,
  workspaceId: string,
  runId: string,
): { result: GetMatrixGenerationResult; items: MatrixGenerationItemRead[] } {
  let result = deps.getMatrixGeneration({ workspaceId, runId, limit: 100 });
  const items = [...result.items.items];
  let cursor = result.items.nextCursor;
  while (cursor) {
    result = deps.getMatrixGeneration({ workspaceId, runId, cursor, limit: 100 });
    items.push(...result.items.items);
    cursor = result.items.nextCursor;
  }
  return { result, items };
}

function unchanged(run: BrandContentOnboardingRun): ResumeBrandContentOnboardingResult {
  return commandResult(run, { advanced: false, replayed: false, paidJobId: null });
}

export function getBrandContentOnboarding(
  request: GetBrandContentOnboardingRequest,
): PublicBrandContentOnboardingRun {
  const run = getPersistedRun(request.workspaceId, request.runId);
  if (!run) {
    throw new BrandContentOnboardingServiceError('not_found', 'Onboarding run not found', 404);
  }
  return projectRun(run);
}

function startBrandContentOnboardingInternal(
  request: StartBrandContentOnboardingRequest,
  overrides?: Partial<BrandContentOnboardingDependencies>,
): StartBrandContentOnboardingResult {
  const deps = dependencies(overrides);
  assertEnabled(request.workspaceId, deps);
  const intake = deps.getBrandIntakeRevision({
    workspaceId: request.workspaceId,
    intakeRevisionId: request.intakeRevisionId,
  }).revision;
  if (!intake
    || intake.revision !== request.expectedIntakeRevision
    || intake.fingerprint !== request.expectedIntakeFingerprint) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The selected brand intake revision changed',
      409,
    );
  }
  deps.assertMatrixSelectionCurrent(request.workspaceId, request.matrixSelection);
  const intakeRevision = {
    intakeRevisionId: intake.id,
    revision: intake.revision,
    fingerprint: intake.fingerprint,
  };
  const accepted = createBrandContentOnboardingRun({
    workspaceId: request.workspaceId,
    intakeRevision,
    matrixSelection: request.matrixSelection,
    brandBudget: request.brandBudget,
    idempotencyKey: request.idempotencyKey,
    createdBy: request.startedBy,
    intakeEvidence: {
      id: `bco_intake_${canonicalGenerationFingerprint(intakeRevision).slice(0, 32)}`,
      gate: 'intake_accepted',
      intakeRevision,
      recordedBy: request.startedBy,
      recordedAt: intake.createdAt,
    },
  });
  const startBrandChild = () => deps.startBrandGeneration({
    workspaceId: request.workspaceId,
    intakeRevisionId: intake.id,
    expectedIntakeRevision: intake.revision,
    expectedIntakeFingerprint: intake.fingerprint,
    selection: { kind: 'preset', preset: 'full_brand_system' },
    budget: request.brandBudget,
    idempotencyKey: `bco_brand_${canonicalGenerationFingerprint(accepted.run.id).slice(0, 32)}`,
    createdBy: request.startedBy,
    mcpExecutionContext: request.mcpExecutionContext,
  });
  if (accepted.run.status !== 'intake_ready') {
    const brand = accepted.run.children.brandRunId ? startBrandChild() : null;
    return commandResult(accepted.run, {
      advanced: false,
      replayed: true,
      paidJobId: brand?.jobId ?? null,
    });
  }

  const brand = startBrandChild();
  const transitioned = transitionBrandContentOnboardingRun({
    workspaceId: request.workspaceId,
    runId: accepted.run.id,
    expectedRevision: accepted.run.revision,
    expectedStatus: 'intake_ready',
    nextStatus: 'brand_generating',
    currentGate: null,
    attentionResumeStatus: null,
    children: { brandRunId: brand.runId },
    resume: {
      idempotencyKey: `bco_start_${canonicalGenerationFingerprint(request.idempotencyKey).slice(0, 32)}`,
      requestFingerprint: canonicalGenerationFingerprint({
        runId: accepted.run.id,
        brandRunId: brand.runId,
        intakeRevision,
      }),
    },
    paidJobId: brand.jobId,
  });
  return commandResult(transitioned.run, {
    advanced: !transitioned.replayed,
    replayed: transitioned.replayed,
    paidJobId: brand.jobId,
  }, request.startedBy);
}

function resumeBrandContentOnboardingInternal(
  request: ResumeBrandContentOnboardingRequest,
  overrides?: Partial<BrandContentOnboardingDependencies>,
): ResumeBrandContentOnboardingResult {
  const deps = dependencies(overrides);
  assertEnabled(request.workspaceId, deps);
  const fingerprint = resumeFingerprint(request);
  const replay = getBrandContentOnboardingResumeReplay(
    request.workspaceId,
    request.runId,
    request.idempotencyKey,
    fingerprint,
  );
  if (replay) {
    return commandResult(replay.run, {
      advanced: false,
      replayed: true,
      paidJobId: replay.paidJobId,
    });
  }
  const run = getPersistedRun(request.workspaceId, request.runId);
  if (!run) {
    throw new BrandContentOnboardingServiceError('not_found', 'Onboarding run not found', 404);
  }
  if (run.revision !== request.expectedRevision || run.status !== request.expectedStatus) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The onboarding run changed since it was read',
      409,
    );
  }
  const brandRunId = run.children.brandRunId;

  switch (run.status) {
    case 'intake_ready':
      throw new BrandContentOnboardingServiceError(
        'precondition_failed',
        'Retry the original onboarding start to recover brand generation acceptance',
        409,
      );

    case 'brand_generating': {
      if (!brandRunId) return needsAttention(run, request);
      exactEvidenceId(request.gateEvidenceId, brandRunId);
      const brand = deps.getBrandGeneration({
        workspaceId: run.workspaceId,
        runId: brandRunId,
        limit: 100,
      });
      if (brand.run.status === 'cancelled') {
        return applyResumeTransition(run, request, {
          nextStatus: 'cancelled', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (brand.run.status === 'failed') {
        return applyResumeTransition(run, request, {
          nextStatus: 'failed', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (['completed_with_errors', 'blocked', 'conflict'].includes(brand.run.status)) {
        return needsAttention(run, request);
      }
      const foundation = brand.itemPage.items.find(item => item.target === 'voice_foundation');
      if (foundation?.status === 'needs_attention'
        || foundation?.status === 'blocked_missing_evidence'
        || foundation?.status === 'conflict'
        || foundation?.status === 'failed') {
        return needsAttention(run, request);
      }
      if (foundation?.status !== 'ready_for_human_review') return unchanged(run);
      return applyResumeTransition(run, request, {
        nextStatus: 'awaiting_voice_review',
        currentGate: 'voice_reviewed',
        attentionResumeStatus: null,
      });
    }

    case 'awaiting_voice_review': {
      if (!brandRunId) return needsAttention(run, request);
      const review = readReview(deps, run.workspaceId, 'voice_foundation', brandRunId);
      if (!review) return unchanged(run);
      exactEvidenceId(request.gateEvidenceId, review.deliverable.id);
      const foundation = review.items.find(item => item.payload.target === 'voice_foundation');
      if (!foundation) return needsAttention(run, request);
      const evidence: BrandContentOnboardingGateEvidence = {
        id: `${review.deliverable.id}:voice-approved`,
        gate: 'voice_reviewed',
        brandRunId,
        foundationItemId: foundation.payload.generationItemId,
        foundationItemRevision: foundation.payload.generationItemRevision,
        reviewDeliverableId: review.deliverable.id,
        recordedBy: request.resumedBy,
        recordedAt: review.deliverable.decidedAt ?? review.deliverable.updatedAt,
      };
      if (reviewHasChanges(review)) {
        return applyResumeTransition(run, request, {
          nextStatus: 'failed', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (!reviewIsApproved(review)) return unchanged(run);
      return applyResumeTransition(run, request, {
        nextStatus: 'awaiting_voice_finalization',
        currentGate: 'voice_finalized',
        attentionResumeStatus: null,
        children: { voiceReviewDeliverableId: review.deliverable.id },
        evidence: [evidence],
      });
    }

    case 'awaiting_voice_finalization': {
      if (!brandRunId) return needsAttention(run, request);
      const authority = deps.getBrandVoiceAuthoritySummary(run.workspaceId).readiness;
      if (authority.state === 'missing') return unchanged(run);
      if (authority.state === 'stale') return needsAttention(run, request);
      const snapshot = deps.getFinalizedVoiceSnapshotForGeneration({
        workspaceId: run.workspaceId,
        expectedVoiceVersion: authority.snapshot.voiceVersion,
        expectedFingerprint: authority.snapshot.fingerprint,
        requireCurrentAuthority: true,
      });
      exactEvidenceId(request.gateEvidenceId, snapshot.id);
      const child = deps.getBrandGeneration({
        workspaceId: run.workspaceId,
        runId: brandRunId,
        limit: 100,
      });
      const resumed = deps.resumeBrandGeneration({
        workspaceId: run.workspaceId,
        runId: brandRunId,
        expectedRunRevision: child.run.revision,
        expectedVoiceVersion: snapshot.voiceVersion,
        expectedVoiceFingerprint: snapshot.fingerprint,
        idempotencyKey: `bco_brand_resume_${canonicalGenerationFingerprint(run.id).slice(0, 32)}`,
        resumedBy: request.resumedBy,
        mcpExecutionContext: request.mcpExecutionContext,
      });
      const voice = {
        voiceProfileId: snapshot.voiceProfileId,
        voiceVersion: snapshot.voiceVersion,
        finalizedBy: snapshot.finalizedBy,
        finalizedAt: snapshot.finalizedAt,
        fingerprint: snapshot.fingerprint,
        anchorEvidenceRefs: snapshot.anchorEvidenceRefs,
      };
      return applyResumeTransition(run, request, {
        nextStatus: 'brand_generating_dependents',
        currentGate: null,
        attentionResumeStatus: null,
        finalizedVoice: voice,
        evidence: [{
          id: `${snapshot.id}:voice-finalized`,
          gate: 'voice_finalized',
          voice,
          recordedBy: request.resumedBy,
          recordedAt: snapshot.finalizedAt,
        }],
        paidJobId: resumed.jobId,
      });
    }

    case 'brand_generating_dependents': {
      if (!brandRunId) return needsAttention(run, request);
      exactEvidenceId(request.gateEvidenceId, brandRunId);
      const brand = deps.getBrandGeneration({
        workspaceId: run.workspaceId,
        runId: brandRunId,
        limit: 100,
      });
      if (brand.run.status === 'cancelled') {
        return applyResumeTransition(run, request, {
          nextStatus: 'cancelled', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (brand.run.status === 'failed') {
        return applyResumeTransition(run, request, {
          nextStatus: 'failed', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (['completed_with_errors', 'blocked', 'conflict'].includes(brand.run.status)) {
        return needsAttention(run, request);
      }
      if (brand.run.status !== 'completed') return unchanged(run);
      const durable = brand.itemPage.items.filter(item => item.target !== 'voice_foundation');
      if (durable.length === 0
        || durable.some(item => !['ready_for_human_review', 'approved'].includes(item.status))) {
        return needsAttention(run, request);
      }
      return applyResumeTransition(run, request, {
        nextStatus: 'awaiting_operator_review',
        currentGate: 'operator_brand_reviewed',
        attentionResumeStatus: null,
      });
    }

    case 'awaiting_operator_review': {
      if (!brandRunId) return needsAttention(run, request);
      const review = readReview(deps, run.workspaceId, 'brand_suite', brandRunId);
      if (!review) return unchanged(run);
      exactEvidenceId(request.gateEvidenceId, review.deliverable.id);
      if (!review.deliverable.sentAt) return unchanged(run);
      const reviewedItemIds = review.items.map(item => item.payload.generationItemId);
      const evidence: BrandContentOnboardingGateEvidence = {
        id: `${review.deliverable.id}:operator-reviewed`,
        gate: 'operator_brand_reviewed',
        brandRunId,
        brandRunRevision: review.runRevision,
        reviewDeliverableId: review.deliverable.id,
        reviewedItemIds: reviewedItemIds as [string, ...string[]],
        recordedBy: request.resumedBy,
        recordedAt: review.deliverable.sentAt,
      };
      if (reviewHasChanges(review)) return needsAttention(run, request);
      return applyResumeTransition(run, request, {
        nextStatus: 'awaiting_client_review',
        currentGate: 'client_brand_reviewed',
        attentionResumeStatus: null,
        children: { brandReviewDeliverableId: review.deliverable.id },
        evidence: [evidence],
      });
    }

    case 'awaiting_client_review': {
      if (!brandRunId) return needsAttention(run, request);
      const review = readReview(deps, run.workspaceId, 'brand_suite', brandRunId);
      if (!review) return needsAttention(run, request);
      exactEvidenceId(request.gateEvidenceId, review.deliverable.id);
      if (reviewHasChanges(review)) return needsAttention(run, request);
      if (!reviewIsApproved(review)) return unchanged(run);
      const approvedIdentity = approvedIdentityFromReview(deps, run.workspaceId, review);
      const approvedItemIds = review.items.map(item => item.payload.generationItemId);
      return applyResumeTransition(run, request, {
        nextStatus: 'awaiting_content_authorization',
        currentGate: 'content_authorized',
        attentionResumeStatus: null,
        approvedIdentity,
        evidence: [{
          id: `${review.deliverable.id}:client-approved`,
          gate: 'client_brand_reviewed',
          brandRunId,
          brandRunRevision: review.runRevision,
          reviewDeliverableId: review.deliverable.id,
          approvedItemIds: approvedItemIds as [string, ...string[]],
          recordedBy: request.resumedBy,
          recordedAt: review.deliverable.decidedAt ?? review.deliverable.updatedAt,
        }],
      });
    }

    case 'awaiting_content_authorization':
      return unchanged(run);

    case 'content_generating': {
      const matrixRunId = run.children.matrixRunId;
      if (!matrixRunId) return needsAttention(run, request);
      exactEvidenceId(request.gateEvidenceId, matrixRunId);
      const matrix = getAllMatrixItems(deps, run.workspaceId, matrixRunId);
      if (matrix.result.run.status === 'cancelled') {
        return applyResumeTransition(run, request, {
          nextStatus: 'cancelled', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (matrix.result.run.status === 'failed') {
        return applyResumeTransition(run, request, {
          nextStatus: 'failed', currentGate: null, attentionResumeStatus: null,
        });
      }
      if (['completed_with_errors', 'blocked', 'conflict'].includes(matrix.result.run.status)) {
        return needsAttention(run, request);
      }
      if (matrix.result.run.status !== 'completed') return unchanged(run);
      if (matrix.items.length !== matrix.result.run.counts.selected
        || matrix.result.run.counts.selected !== run.inputs.matrixSelection.length
        || matrix.items.some(item => item.status !== 'ready_for_human_review')) {
        return needsAttention(run, request);
      }
      return applyResumeTransition(run, request, {
        nextStatus: 'awaiting_content_review',
        currentGate: 'all_pages_approved',
        attentionResumeStatus: null,
      });
    }

    case 'awaiting_content_review': {
      const matrixRunId = run.children.matrixRunId;
      if (!matrixRunId) return needsAttention(run, request);
      exactEvidenceId(request.gateEvidenceId, matrixRunId);
      if (!brandAuthorityIsCurrent(deps, run)) return needsAttention(run, request);
      const matrix = getAllMatrixItems(deps, run.workspaceId, matrixRunId);
      if (matrix.result.run.status !== 'completed'
        || matrix.items.length !== matrix.result.run.counts.selected
        || matrix.result.run.counts.selected !== run.inputs.matrixSelection.length) {
        return needsAttention(run, request);
      }
      if (matrix.items.some(item => item.status !== 'ready_for_human_review')) {
        return needsAttention(run, request);
      }
      if (matrix.items.some(item => item.approvalEvidence === null)) return unchanged(run);
      const pageApprovals = matrix.items.map(item => {
        const approval = item.approvalEvidence!;
        return {
          approvalId: `mpa_${canonicalGenerationFingerprint(approval).slice(0, 32)}`,
          matrixRunId,
          matrixRunRevision: matrix.result.run.revision,
          matrixItemId: item.id,
          matrixItemRevision: item.revision,
          matrixId: item.matrixId,
          cellId: item.cellId,
          sourceRevision: item.sourceRevision,
          postId: approval.postId,
          postGenerationRevision: approval.postRevision,
          approvedBy: approval.approvedBy,
          approvedAt: approval.approvedAt,
        };
      });
      const preconditionCheckIds = pageApprovals.map(approval => (
        deps.assertPagePublishPreconditions(
          run.workspaceId,
          approval.postId,
          approval.postGenerationRevision,
        )
      ));
      const pageApprovalsFingerprint = canonicalGenerationFingerprint(pageApprovals);
      const checkedAt = new Date().toISOString();
      return applyResumeTransition(run, request, {
        nextStatus: 'ready_to_publish',
        currentGate: null,
        attentionResumeStatus: null,
        children: { pageApprovals },
        evidence: [
          {
            id: `bco_pages_${pageApprovalsFingerprint.slice(0, 32)}`,
            gate: 'all_pages_approved',
            pageApprovals: pageApprovals as [typeof pageApprovals[number], ...typeof pageApprovals],
            recordedBy: request.resumedBy,
            recordedAt: checkedAt,
          },
          {
            id: `bco_publish_${canonicalGenerationFingerprint(preconditionCheckIds).slice(0, 32)}`,
            gate: 'publish_preconditions_passed',
            pageApprovalsFingerprint,
            preconditionCheckIds: preconditionCheckIds as [string, ...string[]],
            checkedAt,
            recordedBy: request.resumedBy,
            recordedAt: checkedAt,
          },
        ],
      });
    }

    case 'needs_attention': {
      if (!run.attentionResumeStatus) {
        throw new BrandContentOnboardingServiceError(
          'precondition_failed',
          'The onboarding recovery target is missing',
          409,
        );
      }
      return applyResumeTransition(run, request, {
        nextStatus: run.attentionResumeStatus,
        currentGate: run.currentGate,
        attentionResumeStatus: null,
      });
    }

    case 'ready_to_publish':
    case 'cancelled':
    case 'failed':
      throw new BrandContentOnboardingServiceError(
        'precondition_failed',
        `Onboarding run is terminal in ${run.status}`,
        409,
      );
  }
}

function authorizationFingerprint(request: AuthorizeBrandContentGenerationRequest): string {
  return canonicalGenerationFingerprint({
    workspaceId: request.workspaceId,
    runId: request.runId,
    expectedRevision: request.expectedRevision,
    expectedStatus: request.expectedStatus,
    authorizationId: request.authorizationId,
    expectedMatrixSelectionFingerprint: request.expectedMatrixSelectionFingerprint,
    acceptedBudget: request.acceptedBudget,
  });
}

function matrixChildIdempotencyKey(runId: string): string {
  return `bco_matrix_${canonicalGenerationFingerprint(runId).slice(0, 32)}`;
}

function attachAuthorizedMatrixChild(
  run: BrandContentOnboardingRun,
  request: AuthorizeBrandContentGenerationRequest,
  requestFingerprint: string,
  child: { runId: string; jobId: string },
  startSelections: StartMatrixGenerationSelection[],
  selectionFingerprint: string,
  authorizedBy: AuthorizeBrandContentGenerationRequest['authorizedBy'],
  authorizedAt: string,
): AuthorizeBrandContentGenerationResult {
  const transitioned = transitionBrandContentOnboardingRun({
    workspaceId: run.workspaceId,
    runId: run.id,
    expectedRevision: run.revision,
    expectedStatus: 'awaiting_content_authorization',
    nextStatus: 'content_generating',
    currentGate: null,
    attentionResumeStatus: null,
    children: { matrixRunId: child.runId },
    evidence: [{
      id: `${request.authorizationId}:content-authorized`,
      gate: 'content_authorized',
      authorizationId: request.authorizationId,
      matrixSelectionFingerprint: selectionFingerprint,
      authorizedCellIds: startSelections.map(item => item.cellId) as [string, ...string[]],
      authorizedBy,
      authorizedAt,
      recordedBy: authorizedBy,
      recordedAt: authorizedAt,
    }],
    resume: { idempotencyKey: request.idempotencyKey, requestFingerprint },
    paidJobId: child.jobId,
  });
  return commandResult(transitioned.run, {
    advanced: !transitioned.replayed,
    replayed: transitioned.replayed,
    paidJobId: child.jobId,
  }, authorizedBy);
}

function reconcileAcceptedMatrixChild(
  deps: BrandContentOnboardingDependencies,
  run: BrandContentOnboardingRun,
  request: AuthorizeBrandContentGenerationRequest,
  matrixId: string,
): {
  runId: string;
  jobId: string;
  startSelections: StartMatrixGenerationSelection[];
  selectionFingerprint: string;
  authorizedBy: AuthorizeBrandContentGenerationRequest['authorizedBy'];
  authorizedAt: string;
} | null {
  const existing = deps.getMatrixGenerationByIdempotency(
    run.workspaceId,
    matrixId,
    matrixChildIdempotencyKey(run.id),
  );
  if (!existing) return null;

  const acceptedByCell = new Map(existing.selections.map(selection => [selection.cellId, selection]));
  const startSelections = run.inputs.matrixSelection.map(selected => {
    const accepted = acceptedByCell.get(selected.cellId);
    if (!accepted
      || accepted.matrixId !== selected.matrixId
      || accepted.structuralFingerprint !== selected.structuralFingerprint
      || canonicalGenerationFingerprint(accepted.sourceRevision)
        !== canonicalGenerationFingerprint(selected.sourceRevision)) {
      throw new BrandContentOnboardingServiceError(
        'precondition_failed',
        'The accepted matrix child does not match this onboarding authorization',
        409,
      );
    }
    return {
      cellId: selected.cellId,
      expectedSourceRevision: selected.sourceRevision,
      expectedPreviewFingerprint: accepted.previewFingerprint,
    };
  });
  const selectionFingerprint = canonicalGenerationFingerprint({ matrixId, selections: startSelections });
  if (acceptedByCell.size !== startSelections.length
    || !existing.jobId
    || !existing.acceptedBudget
    || canonicalGenerationFingerprint(existing.acceptedBudget.limits)
      !== canonicalGenerationFingerprint(request.acceptedBudget)
    || selectionFingerprint !== request.expectedMatrixSelectionFingerprint
    || (existing.createdBy.actorType !== 'operator' && existing.createdBy.actorType !== 'client')) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The accepted matrix child does not match this onboarding authorization',
      409,
    );
  }
  return {
    runId: existing.id,
    jobId: existing.jobId,
    startSelections,
    selectionFingerprint,
    authorizedBy: existing.createdBy,
    authorizedAt: existing.createdAt,
  };
}

async function authorizeBrandContentGenerationInternal(
  request: AuthorizeBrandContentGenerationRequest,
  overrides?: Partial<BrandContentOnboardingDependencies>,
): Promise<AuthorizeBrandContentGenerationResult> {
  const deps = dependencies(overrides);
  assertEnabled(request.workspaceId, deps);
  const requestFingerprint = authorizationFingerprint(request);
  const replay = getBrandContentOnboardingResumeReplay(
    request.workspaceId,
    request.runId,
    request.idempotencyKey,
    requestFingerprint,
  );
  if (replay) {
    return commandResult(replay.run, {
      advanced: false,
      replayed: true,
      paidJobId: replay.paidJobId,
    });
  }
  const run = getPersistedRun(request.workspaceId, request.runId);
  if (!run) {
    throw new BrandContentOnboardingServiceError('not_found', 'Onboarding run not found', 404);
  }
  if (run.revision !== request.expectedRevision || run.status !== request.expectedStatus) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The onboarding run changed before content authorization',
      409,
    );
  }
  const matrixIds = new Set(run.inputs.matrixSelection.map(selection => selection.matrixId));
  if (matrixIds.size !== 1) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'One onboarding content run must select cells from exactly one matrix',
      422,
    );
  }
  const matrixId = run.inputs.matrixSelection[0].matrixId;
  const recovered = reconcileAcceptedMatrixChild(deps, run, request, matrixId);
  if (recovered) {
    return attachAuthorizedMatrixChild(
      run,
      request,
      requestFingerprint,
      recovered,
      recovered.startSelections,
      recovered.selectionFingerprint,
      recovered.authorizedBy,
      recovered.authorizedAt,
    );
  }
  if (!brandAuthorityIsCurrent(deps, run)) {
    const changed = transitionBrandContentOnboardingRun({
      workspaceId: run.workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      expectedStatus: 'awaiting_content_authorization',
      nextStatus: 'needs_attention',
      currentGate: run.currentGate,
      attentionResumeStatus: 'awaiting_content_authorization',
      resume: { idempotencyKey: request.idempotencyKey, requestFingerprint },
    });
    return commandResult(changed.run, {
      advanced: !changed.replayed,
      replayed: changed.replayed,
      paidJobId: null,
    }, request.authorizedBy);
  }
  const previewSelections = run.inputs.matrixSelection.map(selection => ({
    cellId: selection.cellId,
    expectedSourceRevision: selection.sourceRevision,
  }));
  const [firstPreview, ...remainingPreview] = previewSelections;
  const preview = await deps.previewMatrixGeneration({
    workspaceId: run.workspaceId,
    matrixId,
    selections: [firstPreview, ...remainingPreview],
  });
  const startSelections = preview.results.map((result, index) => {
    const selected = run.inputs.matrixSelection[index];
    if (!selected
      || result.status !== 'ready'
      || result.cellId !== selected.cellId
      || canonicalGenerationFingerprint(result.sourceRevision)
        !== canonicalGenerationFingerprint(selected.sourceRevision)
      || result.target.structuralFingerprint !== selected.structuralFingerprint
      || canonicalGenerationFingerprint(result.target.voiceSnapshot)
        !== canonicalGenerationFingerprint(run.finalizedVoice)
      || canonicalGenerationFingerprint(result.target.identitySnapshot)
        !== canonicalGenerationFingerprint(
          frozenIdentityForPageType(run, result.target.pageType),
        )) {
      throw new BrandContentOnboardingServiceError(
        'authority_changed',
        'A selected matrix cell or frozen brand authority changed before authorization',
        409,
      );
    }
    return {
      cellId: selected.cellId,
      expectedSourceRevision: selected.sourceRevision,
      expectedPreviewFingerprint: result.target.effectiveInputFingerprint,
    };
  });
  const selectionFingerprint = canonicalGenerationFingerprint({ matrixId, selections: startSelections });
  if (selectionFingerprint !== request.expectedMatrixSelectionFingerprint) {
    throw new BrandContentOnboardingServiceError(
      'precondition_failed',
      'The authorized matrix preview changed; review the current estimate before starting',
      409,
    );
  }
  const [firstStart, ...remainingStart] = startSelections;
  const started = await deps.startMatrixGeneration({
    workspaceId: run.workspaceId,
    matrixId,
    selections: [firstStart, ...remainingStart] as [
      StartMatrixGenerationSelection,
      ...StartMatrixGenerationSelection[],
    ],
    acceptedBudget: request.acceptedBudget,
    idempotencyKey: matrixChildIdempotencyKey(run.id),
    createdBy: request.authorizedBy,
    mcpExecutionContext: null,
  });
  const authorizedAt = new Date().toISOString();
  return attachAuthorizedMatrixChild(
    run,
    request,
    requestFingerprint,
    { runId: started.run.id, jobId: started.jobId },
    startSelections,
    selectionFingerprint,
    request.authorizedBy,
    authorizedAt,
  );
}

export function startBrandContentOnboarding(
  request: StartBrandContentOnboardingRequest,
  overrides?: Partial<BrandContentOnboardingDependencies>,
): StartBrandContentOnboardingResult {
  try {
    return startBrandContentOnboardingInternal(request, overrides);
  } catch (error) {
    return translateExpectedChildError(error);
  }
}

export function resumeBrandContentOnboarding(
  request: ResumeBrandContentOnboardingRequest,
  overrides?: Partial<BrandContentOnboardingDependencies>,
): ResumeBrandContentOnboardingResult {
  try {
    return resumeBrandContentOnboardingInternal(request, overrides);
  } catch (error) {
    return translateExpectedChildError(error);
  }
}

export async function authorizeBrandContentGeneration(
  request: AuthorizeBrandContentGenerationRequest,
  overrides?: Partial<BrandContentOnboardingDependencies>,
): Promise<AuthorizeBrandContentGenerationResult> {
  try {
    return await authorizeBrandContentGenerationInternal(request, overrides);
  } catch (error) {
    return translateExpectedChildError(error);
  }
}
