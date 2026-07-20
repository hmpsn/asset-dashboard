import { randomUUID } from 'node:crypto';

import type { GenerationResolverAttribution } from '../../../../shared/types/generation-evidence.js';
import { toGenerationProviderErrorDetail } from '../../../../shared/types/generation-evidence.js';
import type {
  MatrixGenerationAttempt,
  MatrixGenerationItem,
  MatrixGenerationRunStatus,
  MatrixSourceRevision,
  PersistedMatrixGenerationRun,
} from '../../../../shared/types/matrix-generation.js';
import type { McpToolExecutionContext } from '../../../../shared/types/mcp-runtime.js';
import { getBrief } from '../../../content-brief.js';
import { getPost } from '../../../content-posts-db.js';
import { isFeatureEnabled } from '../../../feature-flags.js';
import { GenerationRevisionConflictError } from '../../../generation-provenance.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import { assertPreviewIdentityCurrent, prepareMatrixGenerationCell } from './preview.js';
import { resolveMatrixStructuresWithCensus } from './read-service.js';
import {
  commitMatrixGenerationDraft,
  createMatrixGenerationRun,
  finishMatrixGenerationAttempt,
  getMatrixGenerationItem,
  getPersistedMatrixGenerationRun,
  getPersistedMatrixGenerationRunByIdempotency,
  listMatrixGenerationItems,
  MatrixGenerationRevisionConflictError,
  startMatrixGenerationAttempt,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from './repository.js';
import { generateMatrixBriefStage, generateMatrixPostStage } from './stages.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';

export interface GenerateMatrixCellRequest {
  workspaceId: string;
  matrixId: string;
  cellId: string;
  expectedSourceRevision: MatrixSourceRevision;
  expectedPreviewFingerprint: string;
  idempotencyKey: string;
  createdBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
  signal?: AbortSignal;
}

export interface GenerateMatrixCellResult {
  status: 'draft_created' | 'replayed';
  run: PersistedMatrixGenerationRun;
  item: MatrixGenerationItem;
  briefId: string | null;
  postId: string | null;
  auditPending: boolean;
  replayed: boolean;
}

export class MatrixGenerationCellPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatrixGenerationCellPreconditionError';
  }
}

export class MatrixGenerationCellExecutionError extends Error {
  readonly status: 'failed' | 'conflict' | 'cancelled';
  readonly runId: string;
  readonly itemId: string;

  constructor(
    status: 'failed' | 'conflict' | 'cancelled',
    runId: string,
    itemId: string,
  ) {
    super(`Matrix generation ended in ${status}`);
    this.name = 'MatrixGenerationCellExecutionError';
    this.status = status;
    this.runId = runId;
    this.itemId = itemId;
  }
}

function executionFailureStatus(
  error: unknown,
  signal?: AbortSignal,
): 'failed' | 'conflict' | 'cancelled' {
  if (signal?.aborted) return 'cancelled';
  if (error instanceof MatrixGenerationRevisionConflictError
    || error instanceof GenerationRevisionConflictError
    || (error instanceof Error && /changed after preview|changed since it was read/i.test(error.message))) {
    return 'conflict';
  }
  return 'failed';
}

function runFailureStatus(status: 'failed' | 'conflict' | 'cancelled'): MatrixGenerationRunStatus {
  return status;
}

function terminalError(
  status: 'failed' | 'conflict' | 'cancelled',
  stage?: string,
  cause?: unknown,
) {
  // Only a genuine failure carries a provider detail: conflict and cancel have
  // self-explanatory causes, and echoing their control-flow errors would be
  // noise. Without this, the operator sees only "A required generation stage
  // failed." while the actionable provider error is discarded (2026-07-20 P0).
  const providerError = status === 'failed' ? toGenerationProviderErrorDetail(cause) : undefined;
  return {
    code: `matrix_generation_${status}`,
    message: status === 'conflict'
      ? 'Generation inputs changed before the draft could be committed.'
      : status === 'cancelled'
        ? 'Generation was cancelled before the draft could be committed.'
        : 'A required generation stage failed.',
    retryable: status === 'failed',
    ...(stage ? { stage } : {}),
    ...(providerError ? { providerError } : {}),
  };
}

function safelyFinishAttempt(
  workspaceId: string,
  itemId: string,
  attempt: MatrixGenerationAttempt | null,
  status: 'failed' | 'conflict' | 'cancelled',
  cause?: unknown,
): void {
  if (!attempt || attempt.status !== 'running') return;
  try {
    finishMatrixGenerationAttempt({
      workspaceId,
      itemId,
      attemptId: attempt.id,
      nextStatus: status === 'cancelled' ? 'cancelled' : 'failed',
      error: terminalError(status, attempt.stage, cause),
    });
  } catch { // catch-ok -- the item terminal remains authoritative if attempt bookkeeping raced
    // The durable item transition below remains authoritative if attempt bookkeeping raced.
  }
}

function persistFailure(
  workspaceId: string,
  runId: string,
  itemId: string,
  status: 'failed' | 'conflict' | 'cancelled',
  stage?: string,
  terminalizeRun = true,
  cause?: unknown,
): void {
  const item = getMatrixGenerationItem(workspaceId, itemId);
  if (item && !['ready_for_human_review', 'needs_attention', 'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'].includes(item.status)) {
    try {
      transitionMatrixGenerationItem({
        workspaceId,
        itemId,
        expectedRevision: item.revision,
        nextStatus: status,
        error: terminalError(status, stage, cause),
      });
    } catch { // catch-ok -- a competing item terminal write wins over this stale worker
      // A competing terminal write wins; never rewrite it from this stale worker.
    }
  }
  const run = terminalizeRun ? getPersistedMatrixGenerationRun(workspaceId, runId) : null;
  if (run && (run.status === 'queued' || run.status === 'running')) {
    try {
      transitionMatrixGenerationRun({
        workspaceId,
        runId,
        expectedRevision: run.revision,
        nextStatus: runFailureStatus(status),
      });
    } catch { // catch-ok -- a competing run terminal write wins over this stale worker
      // Same stale-worker rule as the item write.
    }
  }
}

export interface GenerateMatrixRunItemRequest {
  workspaceId: string;
  runId: string;
  itemId: string;
  signal?: AbortSignal;
  beforeBoundedProviderDispatch?: (dispatch: BoundedProviderDispatch) => void;
}

export interface GenerateMatrixRunItemResult {
  item: MatrixGenerationItem;
  briefId: string;
  postId: string;
}

/** Executes one existing run item without creating or terminalizing its parent run. */
export async function generateMatrixRunItem(
  request: GenerateMatrixRunItemRequest,
): Promise<GenerateMatrixRunItemResult> {
  let item = getMatrixGenerationItem(request.workspaceId, request.itemId);
  if (!item || item.runId !== request.runId || item.status !== 'queued') {
    throw new MatrixGenerationRevisionConflictError('item', request.itemId);
  }
  let activeAttempt: MatrixGenerationAttempt | null = null;
  let stage: 'preflight' | 'brief_generation' | 'post_generation' = 'preflight';

  try {
    const structuralWithCensus = await resolveMatrixStructuresWithCensus({
      workspaceId: request.workspaceId,
      matrixId: item.matrixId,
      selections: [{
        cellId: item.cellId,
        expectedSourceRevision: item.sourceRevision,
      }],
    });
    const structuralResult = structuralWithCensus.result.results[0];
    if (!structuralResult || structuralResult.status !== 'resolved') {
      throw new MatrixGenerationRevisionConflictError('item', item.id);
    }
    const prepared = await prepareMatrixGenerationCell(
      request.workspaceId,
      structuralResult,
      structuralWithCensus.pageCensus,
    );
    if (
      prepared.result.status !== 'ready'
      || !prepared.context
      || prepared.result.target.effectiveInputFingerprint !== item.previewFingerprint
      || prepared.result.target.structuralFingerprint !== item.structuralFingerprint
    ) {
      throw new MatrixGenerationRevisionConflictError('item', item.id);
    }
    const target = prepared.result.target;
    const executionChainId = `matrix-cell:${request.runId}:${item.id}:${randomUUID()}`;
    const assertAuthority = () => assertPreviewIdentityCurrent(request.workspaceId, target);

    item = transitionMatrixGenerationItem({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'preflighting',
      structuralTarget: structuralResult.target,
      previewTarget: target,
    });
    assertAuthority();
    item = transitionMatrixGenerationItem({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'preflighted',
    });
    item = transitionMatrixGenerationItem({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'generating_brief',
    });

    stage = 'brief_generation';
    const briefAttempt = startMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedItemRevision: item.revision,
      stage,
      effectiveInputFingerprint: canonicalGenerationFingerprint({
        preview: target.effectiveInputFingerprint,
        stage,
      }),
    });
    item = briefAttempt.item;
    activeAttempt = briefAttempt.attempt;
    const brief = await generateMatrixBriefStage({
      workspaceId: request.workspaceId,
      target,
      context: prepared.context,
      executionChainId,
      signal: request.signal,
      assertAuthority,
      beforeBoundedProviderDispatch: request.beforeBoundedProviderDispatch,
    });
    if (!brief.generationProvenance) {
      throw new Error('Brief generation did not return provenance');
    }
    activeAttempt = finishMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: item.id,
      attemptId: activeAttempt.id,
      nextStatus: 'completed',
      provenance: brief.generationProvenance,
    });
    item = transitionMatrixGenerationItem({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'generating_post',
    });

    stage = 'post_generation';
    const postAttempt = startMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedItemRevision: item.revision,
      stage,
      effectiveInputFingerprint: canonicalGenerationFingerprint({
        preview: target.effectiveInputFingerprint,
        briefInput: brief.generationProvenance.inputFingerprint,
        stage,
      }),
    });
    item = postAttempt.item;
    activeAttempt = postAttempt.attempt;
    const post = await generateMatrixPostStage(brief, {
      workspaceId: request.workspaceId,
      target,
      context: prepared.context,
      executionChainId,
      signal: request.signal,
      assertAuthority,
      beforeBoundedProviderDispatch: request.beforeBoundedProviderDispatch,
    });
    if (post.status !== 'draft' || !post.generationProvenance) {
      throw new Error('Post generation did not produce a complete draft with provenance');
    }
    activeAttempt = finishMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: item.id,
      attemptId: activeAttempt.id,
      nextStatus: 'completed',
      provenance: post.generationProvenance,
    });
    const committed = commitMatrixGenerationDraft({
      workspaceId: request.workspaceId,
      itemId: item.id,
      expectedItemRevision: item.revision,
      target,
      brief,
      post,
    });
    return {
      item: committed.item,
      briefId: committed.brief.id,
      postId: committed.post.id,
    };
  } catch (error) {
    const status = executionFailureStatus(error, request.signal);
    safelyFinishAttempt(request.workspaceId, item.id, activeAttempt, status, error);
    persistFailure(request.workspaceId, request.runId, item.id, status, stage, false, error);
    throw new MatrixGenerationCellExecutionError(status, request.runId, item.id);
  }
}

export async function generateMatrixCell(
  request: GenerateMatrixCellRequest,
): Promise<GenerateMatrixCellResult> {
  if (!isFeatureEnabled('content-matrix-generation', request.workspaceId)) {
    throw new MatrixGenerationCellPreconditionError('Content matrix generation is not enabled');
  }
  const existingRun = getPersistedMatrixGenerationRunByIdempotency(
    request.workspaceId,
    request.matrixId,
    request.idempotencyKey,
  );
  if (existingRun) {
    const [existingSelection] = existingRun.selections;
    if (!existingSelection
      || existingRun.selections.length !== 1
      || existingSelection.cellId !== request.cellId
      || existingSelection.previewFingerprint !== request.expectedPreviewFingerprint
      || canonicalGenerationFingerprint(existingSelection.sourceRevision)
        !== canonicalGenerationFingerprint(request.expectedSourceRevision)) {
      throw new MatrixGenerationCellPreconditionError(
        'The generation idempotency key was already used for another cell snapshot',
      );
    }
    const existingItem = listMatrixGenerationItems(request.workspaceId, existingRun.id)[0];
    if (!existingItem) throw new MatrixGenerationRevisionConflictError('run', existingRun.id);
    return {
      status: 'replayed',
      run: existingRun,
      item: existingItem,
      briefId: existingItem.briefId,
      postId: existingItem.postId,
      auditPending: existingItem.status === 'auditing_deterministic',
      replayed: true,
    };
  }
  const structuralWithCensus = await resolveMatrixStructuresWithCensus({
    workspaceId: request.workspaceId,
    matrixId: request.matrixId,
    selections: [{
      cellId: request.cellId,
      expectedSourceRevision: request.expectedSourceRevision,
    }],
  });
  const structuralResult = structuralWithCensus.result.results[0];
  if (!structuralResult || structuralResult.status !== 'resolved') {
    throw new MatrixGenerationCellPreconditionError(
      'The matrix cell does not satisfy structural generation preflight',
    );
  }
  const prepared = await prepareMatrixGenerationCell(
    request.workspaceId,
    structuralResult,
    structuralWithCensus.pageCensus,
  );
  if (prepared.result.status !== 'ready' || !prepared.context) {
    throw new MatrixGenerationCellPreconditionError(
      'The matrix cell has unresolved preflight requirements',
    );
  }
  const target = prepared.result.target;
  if (target.effectiveInputFingerprint !== request.expectedPreviewFingerprint) {
    throw new MatrixGenerationCellPreconditionError(
      'The generation preview changed; preview the cell again before starting paid work',
    );
  }
  const selection = {
    matrixId: target.matrixId,
    cellId: target.cellId,
    sourceRevision: target.sourceRevision,
    structuralFingerprint: target.structuralFingerprint,
    previewFingerprint: target.effectiveInputFingerprint,
  };
  const created = createMatrixGenerationRun({
    workspaceId: request.workspaceId,
    matrixId: request.matrixId,
    templateId: target.templateId,
    idempotencyKey: request.idempotencyKey,
    selectionFingerprint: canonicalGenerationFingerprint([selection]),
    selections: [selection],
    createdBy: request.createdBy,
    mcpExecutionContext: request.mcpExecutionContext,
  });
  let run = created.run;
  let item = listMatrixGenerationItems(request.workspaceId, run.id)[0];
  if (!item) throw new MatrixGenerationRevisionConflictError('run', run.id);
  if (created.existing) {
    return {
      status: 'replayed',
      run,
      item,
      briefId: item.briefId,
      postId: item.postId,
      auditPending: item.status === 'auditing_deterministic',
      replayed: true,
    };
  }

  try {
    run = transitionMatrixGenerationRun({
      workspaceId: request.workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
    });
    const generated = await generateMatrixRunItem({
      workspaceId: request.workspaceId,
      runId: run.id,
      itemId: item.id,
      signal: request.signal,
    });
    item = generated.item;
    run = getPersistedMatrixGenerationRun(request.workspaceId, run.id) ?? run;
    return {
      status: 'draft_created',
      run,
      item,
      briefId: generated.briefId,
      postId: generated.postId,
      auditPending: true,
      replayed: false,
    };
  } catch (error) {
    const status = error instanceof MatrixGenerationCellExecutionError
      ? error.status
      : executionFailureStatus(error, request.signal);
    persistFailure(request.workspaceId, run.id, item.id, status, undefined, true, error);
    throw new MatrixGenerationCellExecutionError(status, run.id, item.id);
  }
}

export function getGeneratedMatrixCellArtifacts(
  workspaceId: string,
  item: MatrixGenerationItem,
) {
  return {
    brief: item.briefId ? getBrief(workspaceId, item.briefId) ?? null : null,
    post: item.postId ? getPost(workspaceId, item.postId) ?? null : null,
  };
}
