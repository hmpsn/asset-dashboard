import type {
  GetMatrixGenerationRequest,
  GetMatrixGenerationResult,
  MatrixArtifactRevisionExpectations,
  MatrixGenerationAcceptedBudget,
  MatrixGenerationBatchBudget,
  MatrixGenerationCostEstimate,
  MatrixGenerationItem,
  MatrixGenerationItemRead,
  MatrixGenerationRun,
  MatrixGenerationSelection,
  MatrixGenerationPreconditionDetails,
  RetryMatrixGenerationCommandRequest,
  RetryMatrixGenerationResult,
  StartMatrixGenerationRequest,
  StartMatrixGenerationResult,
} from '../../../../shared/types/matrix-generation.js';
import {
  MATRIX_GENERATION_BATCH_LIMITS,
  MATRIX_GENERATION_EVIDENCE_VALUE_READ_LIMIT,
  MATRIX_GENERATION_SOURCE_LIMITS,
  matrixGenerationSerializedBytes,
} from '../../../../shared/types/matrix-generation.js';
import { JOB_RESOURCE_TYPES } from '../../../../shared/types/background-jobs.js';
import { getBrief } from '../../../content-brief.js';
import { getPost } from '../../../content-posts-db.js';
import { isFeatureEnabled } from '../../../feature-flags.js';
import {
  ActiveJobResourceConflict,
  createResourceScopedJob,
  getJob,
} from '../../../jobs.js';
import { parseJsonFallback } from '../../../db/json-validation.js';
import { previewMatrixGeneration } from './preview.js';
import { readFrozenMatrixCellEvidence } from './evidence.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import {
  clearMatrixGenerationSetAuditReport,
  createMatrixGenerationRun,
  getMatrixGenerationItem,
  getPersistedMatrixGenerationRun,
  getPersistedMatrixGenerationRunByIdempotency,
  listMatrixGenerationItems,
  projectMatrixGenerationRun,
  transitionMatrixGenerationItem,
} from './repository.js';
import {
  getMatrixGenerationRetryCommandByIdempotency,
  insertMatrixGenerationRetryCommand,
} from './retry-repository.js';
import { queueMatrixGenerationJob } from './worker.js';

const JOB_TYPE = 'content-matrix-generation' as const;

export class MatrixGenerationBatchPreconditionError extends Error {
  readonly code = 'matrix_generation_batch_precondition';
  readonly details: MatrixGenerationPreconditionDetails;

  constructor(message: string, details: MatrixGenerationPreconditionDetails) {
    super(message);
    this.name = 'MatrixGenerationBatchPreconditionError';
    this.details = details;
  }
}

export class MatrixGenerationBatchNotFoundError extends Error {
  readonly code = 'matrix_generation_batch_not_found';

  constructor() {
    super('Matrix generation run was not found');
    this.name = 'MatrixGenerationBatchNotFoundError';
  }
}

function assertFeatureEnabled(workspaceId: string): void {
  if (!isFeatureEnabled('content-matrix-generation', workspaceId)) {
    throw new MatrixGenerationBatchPreconditionError(
      'Content matrix generation is not enabled.',
      {
        reason: 'feature_disabled',
        retryable: false,
        fieldPath: 'workspace_id',
        constraint: 'enable content-matrix-generation before previewing or starting paid work',
      },
    );
  }
}

function assertUniqueSelections(selections: readonly { cellId: string }[]): void {
  if (selections.length === 0 || selections.length > MATRIX_GENERATION_BATCH_LIMITS.maxItems) {
    throw new MatrixGenerationBatchPreconditionError(
      `Select between 1 and ${MATRIX_GENERATION_BATCH_LIMITS.maxItems} matrix cells`,
      { reason: 'invalid_selection', retryable: false, fieldPath: 'selections' },
    );
  }
  if (new Set(selections.map(selection => selection.cellId)).size !== selections.length) {
    throw new MatrixGenerationBatchPreconditionError(
      'A matrix cell can be selected only once',
      { reason: 'invalid_selection', retryable: false, fieldPath: 'selections' },
    );
  }
}

function assertBudget(
  limits: MatrixGenerationBatchBudget,
  estimate: MatrixGenerationCostEstimate,
): void {
  const valid = Number.isInteger(limits.maxProviderCalls)
    && Number.isInteger(limits.maxInputTokens)
    && Number.isInteger(limits.maxOutputTokens)
    && Number.isFinite(limits.maxEstimatedUsd)
    && Number.isInteger(limits.maxConcurrency)
    && limits.maxProviderCalls >= estimate.providerCalls
    && limits.maxInputTokens >= estimate.inputTokens
    && limits.maxOutputTokens >= estimate.outputTokens
    && limits.maxEstimatedUsd >= estimate.estimatedUsd
    && limits.maxConcurrency >= 1
    && limits.maxProviderCalls <= MATRIX_GENERATION_BATCH_LIMITS.maxProviderCalls
    && limits.maxInputTokens <= MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens
    && limits.maxOutputTokens <= MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens
    && limits.maxEstimatedUsd <= MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd
    && limits.maxConcurrency <= MATRIX_GENERATION_BATCH_LIMITS.maxConcurrency;
  if (!valid) {
    throw new MatrixGenerationBatchPreconditionError(
      'Accepted generation limits must cover the estimate without exceeding hard batch ceilings',
      { reason: 'invalid_budget', retryable: false, fieldPath: 'accepted_budget' },
    );
  }
}

function sameStartRequest(
  request: StartMatrixGenerationRequest,
  run: NonNullable<ReturnType<typeof getPersistedMatrixGenerationRunByIdempotency>>,
): boolean {
  if (!run.acceptedBudget || run.selections.length !== request.selections.length) return false;
  if (canonicalGenerationFingerprint(run.acceptedBudget.limits)
    !== canonicalGenerationFingerprint(request.acceptedBudget)) return false;
  return request.selections.every(selection => run.selections.some(accepted => (
    accepted.cellId === selection.cellId
    && accepted.previewFingerprint === selection.expectedPreviewFingerprint
    && canonicalGenerationFingerprint(accepted.sourceRevision)
      === canonicalGenerationFingerprint(selection.expectedSourceRevision)
  )));
}

function getStartReplay(
  request: StartMatrixGenerationRequest,
): StartMatrixGenerationResult | null {
  const replay = getPersistedMatrixGenerationRunByIdempotency(
    request.workspaceId,
    request.matrixId,
    request.idempotencyKey,
  );
  if (!replay) return null;
  if (!sameStartRequest(request, replay) || !replay.jobId || !replay.acceptedBudget) {
    throw new MatrixGenerationBatchPreconditionError(
      'The generation idempotency key was already used for another batch snapshot',
      { reason: 'retry_conflict', retryable: false, fieldPath: 'idempotency_key' },
    );
  }
  return {
    run: projectMatrixGenerationRun(replay),
    jobId: replay.jobId,
    estimatedBudget: replay.acceptedBudget.estimate,
    existing: true,
  };
}

/** Read-only reconciliation seam for a caller that accepted the child before recording its ID. */
export function getMatrixGenerationByIdempotency(
  workspaceId: string,
  matrixId: string,
  idempotencyKey: string,
): MatrixGenerationRun | null {
  const run = getPersistedMatrixGenerationRunByIdempotency(
    workspaceId,
    matrixId,
    idempotencyKey,
  );
  return run ? projectMatrixGenerationRun(run) : null;
}

class MatrixGenerationStartReplay extends Error {
  readonly result: StartMatrixGenerationResult;

  constructor(result: StartMatrixGenerationResult) {
    super('Matrix generation start was already accepted');
    this.name = 'MatrixGenerationStartReplay';
    this.result = result;
  }
}

export async function startMatrixGeneration(
  request: StartMatrixGenerationRequest,
): Promise<StartMatrixGenerationResult> {
  assertFeatureEnabled(request.workspaceId);
  assertUniqueSelections(request.selections);
  const replay = getStartReplay(request);
  if (replay) return replay;
  const previewSelections = request.selections.map(selection => ({
    cellId: selection.cellId,
    expectedSourceRevision: selection.expectedSourceRevision,
  }));
  const [firstPreviewSelection, ...remainingPreviewSelections] = previewSelections;
  if (!firstPreviewSelection) {
    throw new MatrixGenerationBatchPreconditionError(
      'Select at least one matrix cell',
      { reason: 'invalid_selection', retryable: false, fieldPath: 'selections' },
    );
  }
  const preview = await previewMatrixGeneration({
    workspaceId: request.workspaceId,
    matrixId: request.matrixId,
    selections: [firstPreviewSelection, ...remainingPreviewSelections],
  });
  const readyTargets = preview.results.map((result, index) => {
    const requested = request.selections[index];
    if (!requested || result.cellId !== requested.cellId) {
      throw new MatrixGenerationBatchPreconditionError(
        'Every selected cell must match the requested durable selection.',
        { reason: 'invalid_selection', retryable: false, fieldPath: `selections.${index}` },
      );
    }
    if (result.status === 'upgrade_required') {
      throw new MatrixGenerationBatchPreconditionError(
        'The selected template requires an explicit generation-contract upgrade before paid generation can start.',
        {
          reason: 'template_upgrade_required',
          retryable: false,
          fieldPath: `selections.${index}`,
          constraint: 'accept or reject the proposed template upgrade, then re-preview before starting',
        },
      );
    }
    if (result.status === 'blocked') {
      throw new MatrixGenerationBatchPreconditionError(
        'The selected cell has unresolved generation preconditions.',
        {
          reason: 'generation_preconditions_unresolved',
          retryable: false,
          fieldPath: `selections.${index}`,
          constraint: 'resolve the reported blockers, then re-preview before starting',
        },
      );
    }
    if (result.target.effectiveInputFingerprint !== requested.expectedPreviewFingerprint) {
      throw new MatrixGenerationBatchPreconditionError(
        'Current generation authority no longer matches the accepted preview. Re-preview immediately.',
        {
          reason: 'preview_fingerprint_stale',
          retryable: true,
          fieldPath: `selections.${index}.expected_preview_fingerprint`,
          constraint: 're-preview immediately and accept the current fingerprint before starting',
        },
      );
    }
    return result.target;
  });
  const estimate = preview.estimatedBatchBudget;
  if (!estimate) {
    throw new MatrixGenerationBatchPreconditionError(
      'Every selected cell must be ready before accepting a batch budget',
      { reason: 'source_revision_changed', retryable: true, fieldPath: 'selections' },
    );
  }
  assertBudget(request.acceptedBudget, estimate);
  const readySelections = readyTargets.map(target => ({
    matrixId: target.matrixId,
    cellId: target.cellId,
    sourceRevision: target.sourceRevision,
    structuralFingerprint: target.structuralFingerprint,
    previewFingerprint: target.effectiveInputFingerprint,
  }));
  const [firstReadySelection, ...remainingReadySelections] = readySelections;
  if (!firstReadySelection) {
    throw new MatrixGenerationBatchPreconditionError(
      'No matrix cells were ready to generate',
      { reason: 'invalid_selection', retryable: false, fieldPath: 'selections' },
    );
  }
  const selections: MatrixGenerationSelection = [
    firstReadySelection,
    ...remainingReadySelections,
  ];
  const acceptedBudget: MatrixGenerationAcceptedBudget = {
    estimate,
    limits: request.acceptedBudget,
    reserved: {
      providerCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
    },
  };
  try {
    const started = createResourceScopedJob(JOB_TYPE, {
      workspaceId: request.workspaceId,
      total: selections.length,
      message: 'Preparing grounded matrix generation...',
      resources: selections.map(selection => ({
        resourceType: JOB_RESOURCE_TYPES.CONTENT_MATRIX_CELL,
        resourceId: `${request.matrixId}:${selection.cellId}`,
      })),
      accept: job => {
        const acceptedReplay = getStartReplay(request);
        if (acceptedReplay) throw new MatrixGenerationStartReplay(acceptedReplay);
        return createMatrixGenerationRun({
          workspaceId: request.workspaceId,
          matrixId: request.matrixId,
          templateId: readyTargets[0].templateId,
          idempotencyKey: request.idempotencyKey,
          selectionFingerprint: canonicalGenerationFingerprint({ selections, acceptedBudget }),
          selections,
          jobId: job.id,
          acceptedBudget,
          createdBy: request.createdBy,
          mcpExecutionContext: request.mcpExecutionContext,
          previewTargets: readyTargets,
        });
      },
    });
    queueMatrixGenerationJob(started.job.id);
    return {
      run: projectMatrixGenerationRun(started.accepted.run),
      jobId: started.job.id,
      estimatedBudget: estimate,
      existing: false,
    };
  } catch (error) {
    if (error instanceof MatrixGenerationStartReplay) return error.result;
    if (error instanceof ActiveJobResourceConflict) {
      const acceptedReplay = getStartReplay(request);
      if (acceptedReplay) return acceptedReplay;
    }
    throw error;
  }
}

interface LegacyRunItemCursor {
  version: 1;
  runId: string;
  runRevision: number;
  offset: number;
}

interface EvidenceRunItemCursor {
  version: 2;
  runId: string;
  runRevision: number;
  offset: number;
  evidenceOffset: number;
  evidenceValues: true;
}

type RunItemCursor = LegacyRunItemCursor | EvidenceRunItemCursor;

interface DecodedRunItemCursor {
  offset: number;
  evidenceOffset: number;
}

function encodeCursor(cursor: RunItemCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCursor(
  cursor: string,
  runId: string,
  runRevision: number,
  includeEvidenceValues: boolean,
): DecodedRunItemCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.toString('base64url') !== cursor) throw new Error('non-canonical cursor');
    const parsed = parseJsonFallback<unknown>(raw.toString('utf8'), null);
    if (!isRecord(parsed)) throw new Error('cursor payload is not an object');
    if (parsed.runId !== runId || parsed.runRevision !== runRevision
      || typeof parsed.offset !== 'number'
      || !Number.isInteger(parsed.offset)
      || parsed.offset < 0) throw new Error('cursor mismatch');
    if (parsed.version === 1) {
      if (includeEvidenceValues) throw new Error('cursor mode mismatch');
      return { offset: parsed.offset, evidenceOffset: 0 };
    }
    if (parsed.version !== 2
      || parsed.evidenceValues !== true
      || includeEvidenceValues !== true
      || typeof parsed.evidenceOffset !== 'number'
      || !Number.isInteger(parsed.evidenceOffset)
      || parsed.evidenceOffset < 0) throw new Error('cursor mode mismatch');
    return { offset: parsed.offset, evidenceOffset: parsed.evidenceOffset };
  } catch { // catch-ok - malformed opaque cursor input is a normal validation failure.
    throw new MatrixGenerationBatchPreconditionError(
      'The run cursor is invalid or stale; read the run again without a cursor',
      {
        reason: 'invalid_cursor',
        retryable: false,
        fieldPath: 'cursor',
        constraint: 'read the run again without a cursor',
      },
    );
  }
}

function encodeNextRunCursor(
  runId: string,
  runRevision: number,
  state: DecodedRunItemCursor,
  includeEvidenceValues: boolean,
): string {
  return includeEvidenceValues
    ? encodeCursor({
        version: 2,
        runId,
        runRevision,
        offset: state.offset,
        evidenceOffset: state.evidenceOffset,
        evidenceValues: true,
      })
    : encodeCursor({ version: 1, runId, runRevision, offset: state.offset });
}

function currentArtifactRevisions(
  workspaceId: string,
  item: MatrixGenerationItem,
): MatrixArtifactRevisionExpectations {
  const brief = item.briefId ? getBrief(workspaceId, item.briefId) : null;
  const post = item.postId ? getPost(workspaceId, item.postId) : null;
  return {
    brief: {
      artifactType: 'content_brief',
      artifactId: brief?.id ?? null,
      generationRevision: brief?.generationRevision ?? 0,
    },
    post: {
      artifactType: 'generated_post',
      artifactId: post?.id ?? null,
      generationRevision: post?.generationRevision ?? 0,
    },
  };
}

const ACTIVE_ITEM_STATUSES = new Set<MatrixGenerationItem['status']>([
  'preflighting',
  'preflighted',
  'generating_brief',
  'generating_post',
  'auditing_deterministic',
  'auditing_model',
  'revising',
]);

function currentRunCounts(items: readonly MatrixGenerationItem[]): MatrixGenerationRun['counts'] {
  const count = (status: MatrixGenerationItem['status']) => (
    items.filter(item => item.status === status).length
  );
  return {
    selected: items.length,
    queued: count('queued'),
    running: items.filter(item => ACTIVE_ITEM_STATUSES.has(item.status)).length,
    readyForHumanReview: count('ready_for_human_review'),
    needsAttention: count('needs_attention'),
    blocked: count('blocked_missing_evidence'),
    conflicts: count('conflict'),
    failed: count('failed'),
    cancelled: count('cancelled'),
  };
}

function projectRunItem(
  workspaceId: string,
  run: NonNullable<ReturnType<typeof getPersistedMatrixGenerationRun>>,
  item: MatrixGenerationItem,
  evidenceResolutionIds?: readonly string[],
): MatrixGenerationItemRead {
  const { structuralTarget, previewTarget, ...publicItem } = item;
  void structuralTarget;
  const artifactRevisions = currentArtifactRevisions(workspaceId, item);
  return {
    ...publicItem,
    target: previewTarget ? {
      targetKeyword: previewTarget.targetKeyword.value,
      plannedUrl: previewTarget.plannedUrl,
      pageType: previewTarget.pageType,
    } : null,
    setAuditFindings: run.selections.length >= 2
      ? run.setAuditReport?.findings.filter(
          finding => finding.affectedItemIds.includes(item.id),
        ) ?? []
      : [],
    currentArtifactRevisions: artifactRevisions,
    reusableCheckpointFingerprint: previewTarget && artifactRevisions.post.artifactId
      ? artifactCheckpointFingerprint(item, artifactRevisions.post.generationRevision)
      : null,
    ...(evidenceResolutionIds ? {
      evidenceValues: previewTarget
        ? readFrozenMatrixCellEvidence({
            workspaceId,
            matrixId: item.matrixId,
            cellId: item.cellId,
            evidenceResolutionIds,
          })
        : [],
    } : {}),
  };
}

export function getMatrixGeneration(
  request: GetMatrixGenerationRequest,
): GetMatrixGenerationResult {
  const run = getPersistedMatrixGenerationRun(request.workspaceId, request.runId);
  if (!run) throw new MatrixGenerationBatchNotFoundError();
  const limit = request.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MatrixGenerationBatchPreconditionError(
      'Run page limit must be between 1 and 100',
      { reason: 'invalid_selection', retryable: false, fieldPath: 'limit' },
    );
  }
  const includeEvidenceValues = request.includeEvidenceValues === true;
  const cursorState = request.cursor
    ? decodeCursor(request.cursor, run.id, run.revision, includeEvidenceValues)
    : { offset: 0, evidenceOffset: 0 };
  const { offset, evidenceOffset } = cursorState;
  const allItems = listMatrixGenerationItems(request.workspaceId, request.runId);
  if (request.cursor && offset >= allItems.length) {
    throw new MatrixGenerationBatchPreconditionError(
      'The run cursor is invalid or stale; read the run again without a cursor',
      {
        reason: 'invalid_cursor',
        retryable: false,
        fieldPath: 'cursor',
        constraint: 'read the run again without a cursor',
      },
    );
  }
  const projectedRun = {
    ...projectMatrixGenerationRun(run),
    counts: currentRunCounts(allItems),
  };
  const candidates = allItems.slice(offset, offset + limit);
  const remainingEvidenceCount = includeEvidenceValues
    ? allItems.slice(offset).reduce((total, item, index) => (
        total + Math.max(
          0,
          (item.previewTarget?.frozenEvidenceResolutionIds.length ?? 0)
            - (index === 0 ? evidenceOffset : 0),
        )
      ), 0)
    : 0;
  let remainingEvidenceValues = MATRIX_GENERATION_EVIDENCE_VALUE_READ_LIMIT;
  let includedEvidenceValues = 0;
  let nextState = cursorState;
  const items: MatrixGenerationItemRead[] = [];
  candidateLoop:
  for (const [candidateIndex, item] of candidates.entries()) {
    const absoluteItemOffset = offset + candidateIndex;
    const frozenEvidenceIds = item.previewTarget?.frozenEvidenceResolutionIds ?? [];
    const itemEvidenceOffset = includeEvidenceValues && candidateIndex === 0
      ? evidenceOffset
      : 0;
    if (itemEvidenceOffset > frozenEvidenceIds.length) {
      throw new MatrixGenerationBatchPreconditionError(
        'The run cursor is invalid or stale; read the run again without a cursor',
        {
          reason: 'invalid_cursor',
          retryable: false,
          fieldPath: 'cursor',
          constraint: 'read the run again without a cursor',
        },
      );
    }
    if (includeEvidenceValues
      && remainingEvidenceValues === 0
      && itemEvidenceOffset < frozenEvidenceIds.length) break;
    const evidenceResolutionIds = includeEvidenceValues
      ? frozenEvidenceIds.slice(
          itemEvidenceOffset,
          itemEvidenceOffset + remainingEvidenceValues,
        )
      : undefined;
    let candidate: MatrixGenerationItemRead | null = null;
    let tentativeEvidenceCount = includedEvidenceValues;
    let consumedItemEvidence = itemEvidenceOffset;
    let tentativeNextState = nextState;
    while (candidate === null) {
      const projectedCandidate = projectRunItem(
        request.workspaceId,
        run,
        item,
        evidenceResolutionIds,
      );
      const projectedEvidenceCount = includedEvidenceValues
        + (evidenceResolutionIds?.length ?? 0);
      const projectedConsumedEvidence = itemEvidenceOffset
        + (evidenceResolutionIds?.length ?? 0);
      const projectedNextState = includeEvidenceValues
        && projectedConsumedEvidence < frozenEvidenceIds.length
        ? { offset: absoluteItemOffset, evidenceOffset: projectedConsumedEvidence }
        : { offset: absoluteItemOffset + 1, evidenceOffset: 0 };
      const response: GetMatrixGenerationResult = {
        run: projectedRun,
        items: {
          items: [...items, projectedCandidate],
          nextCursor: projectedNextState.offset < allItems.length
            ? encodeNextRunCursor(
                run.id,
                run.revision,
                projectedNextState,
                includeEvidenceValues,
              )
            : null,
        },
        ...(includeEvidenceValues ? {
          evidenceValuesSummary: {
            includedCount: projectedEvidenceCount,
            truncated: projectedEvidenceCount < remainingEvidenceCount,
          },
        } : {}),
      };
      if (matrixGenerationSerializedBytes(response)
        <= MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes) {
        candidate = projectedCandidate;
        tentativeEvidenceCount = projectedEvidenceCount;
        consumedItemEvidence = projectedConsumedEvidence;
        tentativeNextState = projectedNextState;
        break;
      }
      if (evidenceResolutionIds && evidenceResolutionIds.length > 1) {
        evidenceResolutionIds.pop();
        continue;
      }
      if (items.length > 0) break candidateLoop;
      throw new MatrixGenerationBatchPreconditionError(
        'The run item exceeds the MCP response budget and cannot be returned safely',
        { reason: 'invalid_budget', retryable: false, fieldPath: 'items' },
      );
    }
    items.push(candidate);
    includedEvidenceValues = tentativeEvidenceCount;
    remainingEvidenceValues -= evidenceResolutionIds?.length ?? 0;
    nextState = tentativeNextState;
    if (includeEvidenceValues && consumedItemEvidence < frozenEvidenceIds.length) break;
  }
  return {
    run: projectedRun,
    items: {
      items,
      nextCursor: nextState.offset < allItems.length
        ? encodeNextRunCursor(run.id, run.revision, nextState, includeEvidenceValues)
        : null,
    },
    ...(includeEvidenceValues ? {
      evidenceValuesSummary: {
        includedCount: includedEvidenceValues,
        truncated: includedEvidenceValues < remainingEvidenceCount,
      },
    } : {}),
  };
}

function artifactCheckpointFingerprint(item: MatrixGenerationItem, postRevision: number): string {
  return canonicalGenerationFingerprint({
    previewFingerprint: item.previewFingerprint,
    postId: item.postId,
    postRevision,
  });
}

function assertRetryItem(
  request: RetryMatrixGenerationCommandRequest,
  requested: RetryMatrixGenerationCommandRequest['items'][number],
): { item: MatrixGenerationItem; checkpointed: boolean } {
  const item = getMatrixGenerationItem(request.workspaceId, requested.itemId);
  if (!item || item.runId !== request.runId || item.revision !== requested.expectedItemRevision) {
    throw new MatrixGenerationBatchPreconditionError(
      'A selected retry item changed since it was read',
      { reason: 'retry_conflict', retryable: true, fieldPath: 'items.expected_item_revision' },
    );
  }
  if (!['needs_attention', 'blocked_missing_evidence', 'conflict', 'failed'].includes(item.status)) {
    throw new MatrixGenerationBatchPreconditionError(
      'Only terminal items requiring attention can be retried',
      { reason: 'retry_conflict', retryable: false, fieldPath: 'items' },
    );
  }
  if (canonicalGenerationFingerprint(item.sourceRevision)
    !== canonicalGenerationFingerprint(requested.sourceRevision)) {
    throw new MatrixGenerationBatchPreconditionError(
      'A selected retry source revision changed',
      { reason: 'source_revision_changed', retryable: true, fieldPath: 'items.source_revision' },
    );
  }
  const currentArtifacts = currentArtifactRevisions(request.workspaceId, item);
  if (canonicalGenerationFingerprint(currentArtifacts)
    !== canonicalGenerationFingerprint(requested.expectedArtifactRevisions)) {
    throw new MatrixGenerationBatchPreconditionError(
      'A selected retry artifact changed',
      { reason: 'artifact_revision_changed', retryable: true, fieldPath: 'items.expected_artifact_revisions' },
    );
  }
  if (request.mode === 'replace') {
    throw new MatrixGenerationBatchPreconditionError(
      'Replacement retry is not available for matrix batches; resume the failed checkpoint',
      { reason: 'retry_conflict', retryable: false, fieldPath: 'mode' },
    );
  }
  const checkpointed = Boolean(currentArtifacts.post.artifactId && item.previewTarget);
  if (checkpointed && item.status !== 'needs_attention' && item.status !== 'failed') {
    throw new MatrixGenerationBatchPreconditionError(
      'A blocked or conflicted page must be re-previewed before generation can resume',
      { reason: 'source_revision_changed', retryable: true, fieldPath: 'items' },
    );
  }
  const expectedCheckpoint = checkpointed
    ? artifactCheckpointFingerprint(item, currentArtifacts.post.generationRevision)
    : null;
  if (requested.reusableCheckpointFingerprint !== expectedCheckpoint) {
    throw new MatrixGenerationBatchPreconditionError(
      'The reusable retry checkpoint changed',
      { reason: 'checkpoint_changed', retryable: true, fieldPath: 'items.reusable_checkpoint_fingerprint' },
    );
  }
  return { item, checkpointed };
}

export function retryMatrixGeneration(
  request: RetryMatrixGenerationCommandRequest,
): RetryMatrixGenerationResult {
  assertFeatureEnabled(request.workspaceId);
  assertUniqueSelections(request.items.map(item => ({ cellId: item.itemId })));
  const requestFingerprint = canonicalGenerationFingerprint({
    runId: request.runId,
    expectedRunRevision: request.expectedRunRevision,
    items: request.items,
    mode: request.mode,
    replacementAuthorization: request.mode === 'replace'
      ? request.replacementAuthorization
      : null,
  });
  const getRetryReplay = (): RetryMatrixGenerationResult | null => {
    const replay = getMatrixGenerationRetryCommandByIdempotency(
      request.workspaceId,
      request.runId,
      request.idempotencyKey,
    );
    if (!replay) return null;
    if (replay.requestFingerprint !== requestFingerprint) {
      throw new MatrixGenerationBatchPreconditionError(
        'The retry idempotency key was already used for another item selection',
        { reason: 'retry_conflict', retryable: false, fieldPath: 'idempotency_key' },
      );
    }
    const persistedRun = getPersistedMatrixGenerationRun(request.workspaceId, request.runId);
    if (!persistedRun || !getJob(replay.jobId)) throw new MatrixGenerationBatchNotFoundError();
    return { run: projectMatrixGenerationRun(persistedRun), jobId: replay.jobId, existing: true };
  };
  const replay = getRetryReplay();
  if (replay) return replay;
  const run = getPersistedMatrixGenerationRun(request.workspaceId, request.runId);
  if (!run || run.revision !== request.expectedRunRevision) {
    throw new MatrixGenerationBatchPreconditionError(
      'The matrix generation run changed since it was read',
      { reason: 'retry_conflict', retryable: true, fieldPath: 'expected_run_revision' },
    );
  }
  const acceptedItems = request.items.map(item => assertRetryItem(request, item));
  class MatrixGenerationRetryReplay extends Error {
    readonly result: RetryMatrixGenerationResult;

    constructor(result: RetryMatrixGenerationResult) {
      super('Matrix generation retry was already accepted');
      this.name = 'MatrixGenerationRetryReplay';
      this.result = result;
    }
  }
  try {
    const started = createResourceScopedJob(JOB_TYPE, {
      workspaceId: request.workspaceId,
      total: acceptedItems.length,
      message: 'Preparing selected matrix page retries...',
      resources: acceptedItems.map(({ item }) => ({
        resourceType: JOB_RESOURCE_TYPES.CONTENT_MATRIX_CELL,
        resourceId: `${item.matrixId}:${item.cellId}`,
      })),
      accept: job => {
        const acceptedReplay = getRetryReplay();
        if (acceptedReplay) throw new MatrixGenerationRetryReplay(acceptedReplay);
        clearMatrixGenerationSetAuditReport({
          workspaceId: request.workspaceId,
          runId: request.runId,
          expectedRunRevision: run.revision,
        });
        for (const accepted of acceptedItems) {
          transitionMatrixGenerationItem({
            workspaceId: request.workspaceId,
            itemId: accepted.item.id,
            expectedRevision: accepted.item.revision,
            nextStatus: accepted.checkpointed ? 'auditing_deterministic' : 'queued',
            auditReport: null,
            error: null,
          });
        }
        return insertMatrixGenerationRetryCommand({
          request,
          requestFingerprint,
          jobId: job.id,
        });
      },
    });
    queueMatrixGenerationJob(started.job.id);
    const updated = getPersistedMatrixGenerationRun(request.workspaceId, request.runId);
    if (!updated) throw new MatrixGenerationBatchNotFoundError();
    return { run: projectMatrixGenerationRun(updated), jobId: started.job.id, existing: false };
  } catch (error) {
    if (error instanceof MatrixGenerationRetryReplay) return error.result;
    if (error instanceof ActiveJobResourceConflict) {
      const acceptedReplay = getRetryReplay();
      if (acceptedReplay) return acceptedReplay;
    }
    throw error;
  }
}
