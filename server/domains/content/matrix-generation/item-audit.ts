import { randomUUID } from 'node:crypto';

import type {
  GenerationAuditReport,
  GenerationSanitizedError,
} from '../../../../shared/types/generation-evidence.js';
import type {
  MatrixGenerationItem,
  MatrixGenerationItemStatus,
  MatrixGenerationPreviewTarget,
  MatrixGenerationSetAuditFinding,
} from '../../../../shared/types/matrix-generation.js';
import type { PersistedGeneratedPost } from '../../../../shared/types/content.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';
import { getDeliverable } from '../../../brand-deliverable-read-model.js';
import { getMatrix } from '../../../content-matrices.js';
import { getTemplate } from '../../../content-templates.js';
import {
  assertPostGenerationRevision,
  getPost,
} from '../../../content-posts-db.js';
import { GenerationRevisionConflictError } from '../../../generation-provenance.js';
import { getFinalizedVoiceSnapshotForGeneration } from '../../brand/voice-finalization.js';
import {
  brandGenerationApprovalFingerprint,
  canonicalBrandGenerationFingerprint,
} from '../../brand/generation/fingerprint.js';
import {
  getMatrixGenerationAuditDisposition,
  mergeMatrixGenerationAudit,
  runMatrixGenerationDeterministicAudit,
} from './audit.js';
import { listCurrentMatrixCellEvidence } from './evidence.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import {
  applyMatrixGenerationRevision,
  auditMatrixGenerationCandidate,
  prepareMatrixGenerationAuditOperation,
  prepareMatrixGenerationRevisionOperation,
  reviseMatrixGenerationCandidate,
  type MatrixGenerationAuditAuthority,
} from './operations.js';
import { buildKnownWorkspacePageCensus } from './read-service.js';
import {
  commitMatrixGenerationRevision,
  finishMatrixGenerationAttemptAndTransitionItem,
  getMatrixGenerationItem,
  MatrixGenerationRevisionConflictError,
  startMatrixGenerationAttempt,
  transitionMatrixGenerationItem,
} from './repository.js';

export interface AuditMatrixGenerationItemRequest {
  workspaceId: string;
  itemId: string;
  expectedItemRevision: number;
  expectedPostRevision: number;
  executionChainId?: string;
  signal?: AbortSignal;
  beforeBoundedProviderDispatch?: (dispatch: BoundedProviderDispatch) => void;
}

export interface AuditMatrixGenerationItemResult {
  item: MatrixGenerationItem;
  post: PersistedGeneratedPost;
  providerCalls: number;
  automaticRevisionApplied: boolean;
}

export interface MatrixGenerationItemAuditDependencies {
  buildKnownPageCensus(workspaceId: string): Promise<{
    paths: string[];
    complete: boolean;
  }>;
  auditCandidate: typeof auditMatrixGenerationCandidate;
  reviseCandidate: typeof reviseMatrixGenerationCandidate;
}

const DEFAULT_DEPENDENCIES: MatrixGenerationItemAuditDependencies = {
  buildKnownPageCensus: buildKnownWorkspacePageCensus,
  auditCandidate: auditMatrixGenerationCandidate,
  reviseCandidate: reviseMatrixGenerationCandidate,
};

function dependencies(
  overrides?: Partial<MatrixGenerationItemAuditDependencies>,
): MatrixGenerationItemAuditDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

export class MatrixGenerationItemAuditPreconditionError extends Error {
  readonly code = 'matrix_generation_item_audit_precondition';

  constructor(message: string) {
    super(message);
    this.name = 'MatrixGenerationItemAuditPreconditionError';
  }
}

interface LoadedAuditItem {
  item: MatrixGenerationItem;
  target: MatrixGenerationPreviewTarget;
  post: PersistedGeneratedPost;
  authority: MatrixGenerationAuditAuthority;
}

function approvedIdentity(
  workspaceId: string,
  target: MatrixGenerationPreviewTarget,
): MatrixGenerationAuditAuthority['approvedIdentity'] {
  return target.identitySnapshot.map(ref => {
    const { approvalFingerprint, ...approval } = ref;
    if (brandGenerationApprovalFingerprint(approval) !== approvalFingerprint) {
      throw new MatrixGenerationItemAuditPreconditionError(
        'The frozen brand identity approval fingerprint is invalid.',
      );
    }
    const deliverable = getDeliverable(workspaceId, ref.deliverableId);
    if (!deliverable || deliverable.deliverableType !== ref.deliverableType) {
      throw new MatrixGenerationItemAuditPreconditionError(
        'A frozen approved brand identity is no longer readable.',
      );
    }
    const content = deliverable.version === ref.version
      ? deliverable.content
      : deliverable.versions.find(version => version.version === ref.version)?.content;
    if (!content || canonicalBrandGenerationFingerprint(content) !== ref.contentFingerprint) {
      throw new MatrixGenerationItemAuditPreconditionError(
        'A frozen approved brand identity no longer matches its accepted version.',
      );
    }
    return {
      deliverableId: ref.deliverableId,
      deliverableType: ref.deliverableType,
      version: ref.version,
      content,
    };
  });
}

function loadAuditItem(
  request: AuditMatrixGenerationItemRequest,
  expectedItemRevision: number,
  expectedPostRevision: number,
  expectedStatus: MatrixGenerationItemStatus = 'auditing_deterministic',
): LoadedAuditItem {
  const item = getMatrixGenerationItem(request.workspaceId, request.itemId);
  if (
    !item
    || item.revision !== expectedItemRevision
    || item.status !== expectedStatus
    || !item.previewTarget
    || !item.postId
    || item.previewFingerprint !== item.previewTarget.effectiveInputFingerprint
  ) {
    throw new MatrixGenerationRevisionConflictError('item', request.itemId);
  }
  const target = item.previewTarget;
  const post = getPost(request.workspaceId, item.postId);
  if (!post || post.generationRevision !== expectedPostRevision) {
    throw new MatrixGenerationRevisionConflictError('item', request.itemId);
  }
  const matrix = getMatrix(request.workspaceId, target.matrixId);
  const template = matrix ? getTemplate(request.workspaceId, matrix.templateId) : null;
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (
    !matrix
    || !template
    || !cell
    || (matrix.revision ?? 0) !== target.sourceRevision.matrixRevision
    || (template.revision ?? 0) !== target.sourceRevision.templateRevision
    || (cell.revision ?? 0) !== target.sourceRevision.cellRevision + 1
    || cell.briefId !== item.briefId
    || cell.postId !== item.postId
  ) {
    throw new MatrixGenerationRevisionConflictError('item', request.itemId);
  }
  const voiceSnapshot = getFinalizedVoiceSnapshotForGeneration({
    workspaceId: request.workspaceId,
    expectedVoiceVersion: target.voiceSnapshot.voiceVersion,
    expectedFingerprint: target.voiceSnapshot.fingerprint,
    requireCurrentAuthority: false,
  });
  return {
    item,
    target,
    post,
    authority: {
      voiceSnapshot,
      approvedIdentity: approvedIdentity(request.workspaceId, target),
      evidenceResolutions: listCurrentMatrixCellEvidence(
        request.workspaceId,
        target.matrixId,
        target.cellId,
      ),
    },
  };
}

function stageError(
  stage: 'deterministic_audit' | 'model_audit' | 'revision',
  code: string,
  message: string,
  retryable: boolean,
): GenerationSanitizedError {
  return { stage, code, message, retryable };
}

function deterministicFingerprint(
  loaded: LoadedAuditItem,
  knownPaths: readonly string[],
  censusComplete: boolean,
): string {
  return canonicalGenerationFingerprint({
    stage: 'deterministic_audit',
    targetFingerprint: loaded.target.effectiveInputFingerprint,
    postId: loaded.post.id,
    postRevision: loaded.post.generationRevision,
    revisionCount: loaded.item.automaticRevisionCount,
    voiceFingerprint: loaded.authority.voiceSnapshot.fingerprint,
    identitySnapshot: loaded.target.identitySnapshot,
    evidence: loaded.authority.evidenceResolutions.map(resolution => ({
      id: resolution.id,
      requirementId: resolution.requirementId,
      value: resolution.value,
    })),
    knownPaths,
    censusComplete,
  });
}

function failedModelReport(
  target: MatrixGenerationPreviewTarget,
  deterministicReport: GenerationAuditReport,
): GenerationAuditReport {
  return mergeMatrixGenerationAudit({
    target,
    deterministicReport,
    modelOutput: {
      revisionRecommended: false,
      findings: [{
        code: 'model_audit_failed',
        severity: 'error',
        message: 'The required model audit did not produce an accepted structured result.',
        affectedTargetIds: [target.blockManifest.blocks[0].id],
        requiresHumanReview: true,
      }],
    },
  });
}

function currentPostOrFallback(
  workspaceId: string,
  post: PersistedGeneratedPost,
): PersistedGeneratedPost {
  return getPost(workspaceId, post.id) ?? post;
}

function terminalResult(
  item: MatrixGenerationItem,
  post: PersistedGeneratedPost,
  providerCalls: number,
  automaticRevisionApplied: boolean,
): AuditMatrixGenerationItemResult {
  return { item, post, providerCalls, automaticRevisionApplied };
}

function finishAttempt(input: {
  loaded: LoadedAuditItem;
  attemptId: string;
  attemptStatus: 'completed' | 'failed' | 'cancelled';
  nextItemStatus: MatrixGenerationItemStatus;
  report?: GenerationAuditReport | null;
  provenance?: Parameters<typeof finishMatrixGenerationAttemptAndTransitionItem>[0]['provenance'];
  error?: GenerationSanitizedError;
}): MatrixGenerationItem {
  return finishMatrixGenerationAttemptAndTransitionItem({
    workspaceId: input.loaded.item.workspaceId,
    itemId: input.loaded.item.id,
    expectedItemRevision: input.loaded.item.revision,
    attemptId: input.attemptId,
    attemptStatus: input.attemptStatus,
    nextItemStatus: input.nextItemStatus,
    provenance: input.provenance,
    attemptError: input.error,
    auditReport: input.report,
    itemError: input.error,
  }).item;
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof MatrixGenerationRevisionConflictError
    || error instanceof GenerationRevisionConflictError;
}

export async function auditMatrixGenerationItem(
  request: AuditMatrixGenerationItemRequest,
  overrides?: Partial<MatrixGenerationItemAuditDependencies>,
): Promise<AuditMatrixGenerationItemResult> {
  const deps = dependencies(overrides);
  const acceptedItem = getMatrixGenerationItem(request.workspaceId, request.itemId);
  if (
    !acceptedItem
    || acceptedItem.revision !== request.expectedItemRevision
    || acceptedItem.status !== 'auditing_deterministic'
  ) {
    throw new MatrixGenerationRevisionConflictError('item', request.itemId);
  }

  // External page discovery happens before the final no-await authority read.
  const pageCensus = await deps.buildKnownPageCensus(request.workspaceId);
  let loaded = loadAuditItem(
    request,
    request.expectedItemRevision,
    request.expectedPostRevision,
  );
  const executionChainId = request.executionChainId ?? `matrix-audit-${randomUUID()}`;
  let providerCalls = 0;
  let automaticRevisionApplied = false;

  while (true) {
    const deterministicAttempt = startMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: loaded.item.id,
      expectedItemRevision: loaded.item.revision,
      stage: 'deterministic_audit',
      effectiveInputFingerprint: deterministicFingerprint(
        loaded,
        pageCensus.paths,
        pageCensus.complete,
      ),
    });
    loaded = { ...loaded, item: deterministicAttempt.item };

    let deterministicReport: GenerationAuditReport;
    try {
      deterministicReport = runMatrixGenerationDeterministicAudit({
        target: loaded.target,
        post: loaded.post,
        evidenceResolutions: loaded.authority.evidenceResolutions,
        knownInternalPaths: pageCensus.paths,
        internalPathCensusComplete: pageCensus.complete,
        voiceGuardrails: loaded.authority.voiceSnapshot.guardrails,
        revisionCount: loaded.item.automaticRevisionCount,
      });
    } catch { // catch-ok: a deterministic contract failure terminalizes the durable attempt.
      const error = stageError(
        'deterministic_audit',
        'matrix_generation_deterministic_audit_failed',
        'The deterministic page audit could not be completed.',
        false,
      );
      const item = finishAttempt({
        loaded,
        attemptId: deterministicAttempt.attempt.id,
        attemptStatus: 'failed',
        nextItemStatus: 'failed',
        error,
      });
      return terminalResult(item, loaded.post, providerCalls, automaticRevisionApplied);
    }

    const deterministicFailed = deterministicReport.deterministicChecks
      .some(check => check.result === 'failed');
    const deterministicNextStatus: MatrixGenerationItemStatus =
      deterministicReport.verdict === 'blocked_missing_evidence'
        ? 'blocked_missing_evidence'
        : !pageCensus.complete
          || (loaded.item.automaticRevisionCount === 1 && deterministicFailed)
          ? 'needs_attention'
          : 'auditing_model';
    loaded = {
      ...loaded,
      item: finishAttempt({
        loaded,
        attemptId: deterministicAttempt.attempt.id,
        attemptStatus: 'completed',
        nextItemStatus: deterministicNextStatus,
        report: deterministicReport,
      }),
    };
    if (deterministicNextStatus !== 'auditing_model') {
      return terminalResult(loaded.item, loaded.post, providerCalls, automaticRevisionApplied);
    }

    const auditInput = {
      workspaceId: request.workspaceId,
      target: loaded.target,
      post: loaded.post,
      authority: loaded.authority,
      deterministicReport,
      executionChainId,
      signal: request.signal,
      beforeBoundedProviderDispatch: request.beforeBoundedProviderDispatch,
    };
    const preparedAudit = prepareMatrixGenerationAuditOperation(auditInput);
    const modelAttempt = startMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: loaded.item.id,
      expectedItemRevision: loaded.item.revision,
      stage: 'model_audit',
      effectiveInputFingerprint: preparedAudit.effectiveInputFingerprint,
    });
    loaded = { ...loaded, item: modelAttempt.item };
    providerCalls += 1;

    let modelResult: Awaited<ReturnType<typeof auditMatrixGenerationCandidate>> | undefined;
    let mergedReport: GenerationAuditReport;
    try {
      modelResult = await deps.auditCandidate({ ...auditInput, prepared: preparedAudit });
      if (
        modelResult.effectiveInputFingerprint !== preparedAudit.effectiveInputFingerprint
        || modelResult.provenance.inputFingerprint !== preparedAudit.effectiveInputFingerprint
      ) {
        throw new MatrixGenerationItemAuditPreconditionError(
          'The model-audit result does not match its reserved provider input.',
        );
      }
      assertPostGenerationRevision(request.workspaceId, loaded.post.id, loaded.post.generationRevision);
      mergedReport = mergeMatrixGenerationAudit({
        target: loaded.target,
        deterministicReport,
        modelOutput: modelResult.output,
      });
    } catch (error) {
      const cancelled = request.signal?.aborted === true;
      const conflict = isRevisionConflict(error);
      const auditError = stageError(
        'model_audit',
        cancelled
          ? 'matrix_generation_cancelled'
          : conflict
            ? 'matrix_generation_conflict'
            : 'matrix_generation_model_audit_failed',
        cancelled
          ? 'Matrix page audit was cancelled.'
          : conflict
            ? 'The generated page changed while its model audit was running.'
            : 'The required model audit did not produce an accepted result.',
        !cancelled && !conflict,
      );
      const report = conflict ? deterministicReport : failedModelReport(loaded.target, deterministicReport);
      const item = finishAttempt({
        loaded,
        attemptId: modelAttempt.attempt.id,
        attemptStatus: cancelled ? 'cancelled' : modelResult && conflict ? 'completed' : 'failed',
        nextItemStatus: cancelled ? 'cancelled' : conflict ? 'conflict' : 'needs_attention',
        report,
        provenance: modelResult?.provenance,
        error: auditError,
      });
      return terminalResult(
        item,
        currentPostOrFallback(request.workspaceId, loaded.post),
        providerCalls,
        automaticRevisionApplied,
      );
    }

    const disposition = getMatrixGenerationAuditDisposition(
      mergedReport,
      loaded.item.automaticRevisionCount,
      modelResult.output.revisionRecommended,
    );
    const modelNextStatus: MatrixGenerationItemStatus = disposition === 'ready'
      ? 'ready_for_human_review'
      : disposition === 'blocked_missing_evidence'
        ? 'blocked_missing_evidence'
        : disposition === 'revise'
          ? 'revising'
          : 'needs_attention';
    loaded = {
      ...loaded,
      item: finishAttempt({
        loaded,
        attemptId: modelAttempt.attempt.id,
        attemptStatus: 'completed',
        nextItemStatus: modelNextStatus,
        report: mergedReport,
        provenance: modelResult.provenance,
      }),
    };
    if (modelNextStatus !== 'revising') {
      return terminalResult(loaded.item, loaded.post, providerCalls, automaticRevisionApplied);
    }

    const revisionInput = {
      workspaceId: request.workspaceId,
      target: loaded.target,
      post: loaded.post,
      authority: loaded.authority,
      auditReport: mergedReport,
      executionChainId,
      signal: request.signal,
      beforeBoundedProviderDispatch: request.beforeBoundedProviderDispatch,
    };
    const preparedRevision = prepareMatrixGenerationRevisionOperation(revisionInput);
    const revisionAttempt = startMatrixGenerationAttempt({
      workspaceId: request.workspaceId,
      itemId: loaded.item.id,
      expectedItemRevision: loaded.item.revision,
      stage: 'revision',
      effectiveInputFingerprint: preparedRevision.effectiveInputFingerprint,
    });
    loaded = { ...loaded, item: revisionAttempt.item };
    providerCalls += 1;

    let revisionResult: Awaited<ReturnType<typeof reviseMatrixGenerationCandidate>> | undefined;
    try {
      revisionResult = await deps.reviseCandidate({
        ...revisionInput,
        prepared: preparedRevision,
      });
      if (
        revisionResult.effectiveInputFingerprint !== preparedRevision.effectiveInputFingerprint
        || revisionResult.provenance.inputFingerprint !== preparedRevision.effectiveInputFingerprint
      ) {
        throw new MatrixGenerationItemAuditPreconditionError(
          'The revision result does not match its reserved provider input.',
        );
      }
      const replacement = applyMatrixGenerationRevision(
        loaded.target,
        loaded.post,
        revisionResult.output,
      );
      const committed = commitMatrixGenerationRevision({
        workspaceId: request.workspaceId,
        itemId: loaded.item.id,
        expectedItemRevision: loaded.item.revision,
        expectedPostRevision: loaded.post.generationRevision,
        attemptId: revisionAttempt.attempt.id,
        replacement,
        provenance: revisionResult.provenance,
      });
      loaded = { ...loaded, item: committed.item, post: committed.post };
      automaticRevisionApplied = true;
    } catch (error) {
      const cancelled = request.signal?.aborted === true;
      const conflict = isRevisionConflict(error);
      const revisionError = stageError(
        'revision',
        cancelled
          ? 'matrix_generation_cancelled'
          : conflict
            ? 'matrix_generation_conflict'
            : 'matrix_generation_revision_failed',
        cancelled
          ? 'Matrix page revision was cancelled.'
          : conflict
            ? 'The generated page changed while its revision was running.'
            : 'The automatic page revision did not produce an accepted result.',
        !cancelled && !conflict,
      );
      const item = finishAttempt({
        loaded,
        attemptId: revisionAttempt.attempt.id,
        attemptStatus: cancelled ? 'cancelled' : 'failed',
        nextItemStatus: cancelled ? 'cancelled' : conflict ? 'conflict' : 'needs_attention',
        report: mergedReport,
        provenance: revisionResult?.provenance,
        error: revisionError,
      });
      return terminalResult(
        item,
        currentPostOrFallback(request.workspaceId, loaded.post),
        providerCalls,
        automaticRevisionApplied,
      );
    }
  }
}

export interface ReviseMatrixGenerationItemForSetAuditRequest {
  workspaceId: string;
  itemId: string;
  expectedItemRevision: number;
  expectedPostRevision: number;
  findings: MatrixGenerationSetAuditFinding[];
  signal?: AbortSignal;
  beforeBoundedProviderDispatch?: (dispatch: BoundedProviderDispatch) => void;
}

/** Spends the same one-pass item allowance on prose-only set feedback, then reruns item gates. */
export async function reviseMatrixGenerationItemForSetAudit(
  request: ReviseMatrixGenerationItemForSetAuditRequest,
  overrides?: Partial<MatrixGenerationItemAuditDependencies>,
): Promise<AuditMatrixGenerationItemResult> {
  const deps = dependencies(overrides);
  let loaded = loadAuditItem(
    request,
    request.expectedItemRevision,
    request.expectedPostRevision,
    'ready_for_human_review',
  );
  if (
    loaded.item.automaticRevisionCount !== 0
    || loaded.item.auditReport?.verdict !== 'ready_for_human_review'
    || request.findings.length === 0
    || request.findings.some(finding => finding.kind !== 'prose')
  ) {
    throw new MatrixGenerationItemAuditPreconditionError(
      'Set-level revision requires an unused allowance and prose-only findings.',
    );
  }
  const blockIds = new Set<string>(loaded.target.blockManifest.blocks.map(block => block.id));
  const modelFindings = request.findings.map(setFinding => {
    const affectedTargetIds = setFinding.affectedTargetIds
      .map(targetId => targetId.startsWith(`${loaded.item.id}:`)
        ? targetId.slice(loaded.item.id.length + 1)
        : targetId)
      .filter(targetId => blockIds.has(targetId));
    return {
      code: `set_${setFinding.code}`,
      severity: setFinding.severity,
      message: setFinding.message,
      affectedTargetIds: affectedTargetIds.length > 0
        ? affectedTargetIds
        : [loaded.target.blockManifest.blocks[0].id],
      requiresHumanReview: false,
    };
  });
  const revisionReport: GenerationAuditReport = {
    ...loaded.item.auditReport,
    verdict: 'needs_attention',
    modelFindings: [...loaded.item.auditReport.modelFindings, ...modelFindings],
    unresolvedRequirementIds: [],
  };
  loaded = {
    ...loaded,
    item: transitionMatrixGenerationItem({
      workspaceId: request.workspaceId,
      itemId: loaded.item.id,
      expectedRevision: loaded.item.revision,
      nextStatus: 'revising',
      auditReport: revisionReport,
    }),
  };
  const executionChainId = `matrix-set-revision-${randomUUID()}`;
  const revisionInput = {
    workspaceId: request.workspaceId,
    target: loaded.target,
    post: loaded.post,
    authority: loaded.authority,
    auditReport: revisionReport,
    executionChainId,
    signal: request.signal,
    beforeBoundedProviderDispatch: request.beforeBoundedProviderDispatch,
  };
  const preparedRevision = prepareMatrixGenerationRevisionOperation(revisionInput);
  const revisionAttempt = startMatrixGenerationAttempt({
    workspaceId: request.workspaceId,
    itemId: loaded.item.id,
    expectedItemRevision: loaded.item.revision,
    stage: 'revision',
    effectiveInputFingerprint: preparedRevision.effectiveInputFingerprint,
  });
  loaded = { ...loaded, item: revisionAttempt.item };
  let revisionResult: Awaited<ReturnType<typeof reviseMatrixGenerationCandidate>> | undefined;
  try {
    revisionResult = await deps.reviseCandidate({
      ...revisionInput,
      prepared: preparedRevision,
    });
    if (
      revisionResult.effectiveInputFingerprint !== preparedRevision.effectiveInputFingerprint
      || revisionResult.provenance.inputFingerprint !== preparedRevision.effectiveInputFingerprint
    ) {
      throw new MatrixGenerationItemAuditPreconditionError(
        'The set-level revision result does not match its reserved provider input.',
      );
    }
    const replacement = applyMatrixGenerationRevision(
      loaded.target,
      loaded.post,
      revisionResult.output,
    );
    const committed = commitMatrixGenerationRevision({
      workspaceId: request.workspaceId,
      itemId: loaded.item.id,
      expectedItemRevision: loaded.item.revision,
      expectedPostRevision: loaded.post.generationRevision,
      attemptId: revisionAttempt.attempt.id,
      replacement,
      provenance: revisionResult.provenance,
    });
    const audited = await auditMatrixGenerationItem({
      workspaceId: request.workspaceId,
      itemId: committed.item.id,
      expectedItemRevision: committed.item.revision,
      expectedPostRevision: committed.post.generationRevision,
      executionChainId,
      signal: request.signal,
      beforeBoundedProviderDispatch: request.beforeBoundedProviderDispatch,
    }, overrides);
    return {
      ...audited,
      providerCalls: audited.providerCalls + 1,
      automaticRevisionApplied: true,
    };
  } catch (error) {
    const cancelled = request.signal?.aborted === true;
    const conflict = isRevisionConflict(error);
    const revisionError = stageError(
      'revision',
      cancelled
        ? 'matrix_generation_cancelled'
        : conflict
          ? 'matrix_generation_conflict'
          : 'matrix_generation_set_revision_failed',
      cancelled
        ? 'Matrix page set revision was cancelled.'
        : conflict
          ? 'The generated page changed while its set revision was running.'
          : 'The set-level page revision did not produce an accepted result.',
      !cancelled && !conflict,
    );
    const item = finishAttempt({
      loaded,
      attemptId: revisionAttempt.attempt.id,
      attemptStatus: cancelled ? 'cancelled' : 'failed',
      nextItemStatus: cancelled ? 'cancelled' : conflict ? 'conflict' : 'needs_attention',
      report: revisionReport,
      provenance: revisionResult?.provenance,
      error: revisionError,
    });
    return terminalResult(
      item,
      currentPostOrFallback(request.workspaceId, loaded.post),
      1,
      false,
    );
  }
}
