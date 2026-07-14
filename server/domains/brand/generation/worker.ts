import type {
  BrandGenerationAttempt,
  BrandGenerationCandidateAttemptOutput,
  BrandGenerationCommand,
  BrandGenerationItem,
  BrandGenerationRunStatus,
  PersistedBrandGenerationRun,
} from '../../../../shared/types/brand-generation.js';
import { BRAND_GENERATION_LIMITS } from '../../../../shared/types/brand-generation.js';
import type {
  GenerationAuditReport,
  GenerationSanitizedError,
} from '../../../../shared/types/generation-evidence.js';
import {
  getJob,
  isJobCancelled,
  registerAbort,
  unregisterAbort,
  updateJob,
} from '../../../jobs.js';
import { createLogger } from '../../../logger.js';
import {
  getBrandGenerationAuditDisposition,
  runBrandGenerationDeterministicAudit,
} from './audit.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationAttemptCheckpointConflictError,
  BrandGenerationRevisionConflictError,
} from './errors.js';
import {
  applyBrandGenerationArtifactCommittedEffects,
  applyBrandGenerationCompletedEffects,
} from './effects.js';
import {
  auditBrandGenerationCandidate,
  generateBrandGenerationCandidate,
  refineBrandGenerationCandidate,
  type AuditBrandGenerationCandidateInput,
  type GenerateBrandGenerationCandidateInput,
  type RefineBrandGenerationCandidateInput,
} from './operations.js';
import { canonicalBrandGenerationFingerprint } from './fingerprint.js';
import {
  runBrandGenerationPreflight,
  type BrandGenerationFrozenTargetInput,
  type BrandGenerationPreflightResult,
} from './preflight.js';
import {
  buildBrandGenerationAuditPrompt,
  buildBrandGenerationPrompt,
  buildBrandGenerationRefinementPrompt,
  utf8Prefix,
} from './prompt.js';
import {
  beginBrandGenerationAttempt,
  cancelBrandGenerationAttempt,
  commitBrandGenerationDeliverableCandidate,
  commitBrandVoiceFoundationCandidate,
  completeBrandGenerationAttempt,
  failBrandGenerationAttempt,
  getBrandGenerationItem,
  getPersistedBrandGenerationRun,
  listBrandGenerationCommandsByJob,
  listPersistedBrandGenerationItems,
  reserveBrandGenerationAttemptBudget,
  transitionBrandGenerationItem,
  transitionBrandGenerationRun,
} from './repository.js';
import { hydrateBrandGenerationSnapshot } from './snapshots.js';
import { deriveBrandGenerationTerminalStatus } from './terminal-status.js';

const log = createLogger('brand-generation-worker');

const ZERO_USAGE = {
  providerCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostMicros: 0,
} as const;

interface WorkState {
  item: BrandGenerationItem;
  frozenInput: BrandGenerationFrozenTargetInput;
  preflight: BrandGenerationPreflightResult;
  candidate?: BrandGenerationCandidateAttemptOutput;
  candidateAttemptId?: string;
  auditAttemptId?: string;
  auditReport?: GenerationAuditReport;
  failed: boolean;
}

export interface BrandGenerationWorkerDependencies {
  generateCandidate: typeof generateBrandGenerationCandidate;
  refineCandidate: typeof refineBrandGenerationCandidate;
  auditCandidate: typeof auditBrandGenerationCandidate;
}

const DEFAULT_DEPENDENCIES: BrandGenerationWorkerDependencies = {
  generateCandidate: generateBrandGenerationCandidate,
  refineCandidate: refineBrandGenerationCandidate,
  auditCandidate: auditBrandGenerationCandidate,
};

function dependencies(
  overrides?: Partial<BrandGenerationWorkerDependencies>,
): BrandGenerationWorkerDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function sanitizedError(stage: string): GenerationSanitizedError {
  return {
    code: 'brand_generation_stage_failed',
    message: 'Brand generation could not complete this item. Review the durable run before retrying.',
    retryable: true,
    stage,
  };
}

function cancellationError(stage: string): GenerationSanitizedError {
  return {
    code: 'brand_generation_cancelled',
    message: 'Brand generation was cancelled before this stage completed.',
    retryable: true,
    stage,
  };
}

function conflictError(stage: string): GenerationSanitizedError {
  return {
    code: 'brand_generation_artifact_conflict',
    message: 'A newer human change was preserved. Re-read the run and artifact before retrying.',
    retryable: true,
    stage,
  };
}

type ItemEndKind = 'cancelled' | 'conflict' | 'failed';

function itemEndKind(error: unknown, cancelled: boolean): ItemEndKind {
  if (cancelled) return 'cancelled';
  return error instanceof BrandGenerationApprovedDeliverableError
    || error instanceof BrandGenerationAttemptCheckpointConflictError
    || error instanceof BrandGenerationRevisionConflictError
    ? 'conflict'
    : 'failed';
}

function assertNotCancelled(jobId: string, signal: AbortSignal): void {
  if (!signal.aborted && !isJobCancelled(jobId)) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Brand generation was cancelled.');
}

function expectedDeliverableVersion(item: BrandGenerationItem): number | null {
  return item.target === 'voice_foundation'
    ? null
    : item.artifactExpectation.expectedVersion;
}

async function mapBounded<T>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        await run(values[index]);
      }
    },
  );
  await Promise.all(workers);
}

function activeItemsForCommand(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): BrandGenerationItem[] {
  const items = listPersistedBrandGenerationItems(run.workspaceId, run.id);
  if (command.kind === 'revision') {
    const item = items.find(candidate => candidate.id === command.itemId);
    return item ? [item] : [];
  }
  const targets = new Set(run.selectedTargets);
  return items.filter(item => targets.has(item.target) && item.status === 'queued');
}

function allItemsForCommand(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): BrandGenerationItem[] {
  const items = listPersistedBrandGenerationItems(run.workspaceId, run.id);
  if (command.kind === 'revision') {
    return items.filter(item => item.id === command.itemId);
  }
  const targets = new Set(run.selectedTargets);
  return items.filter(item => targets.has(item.target));
}

function moveItem(
  workspaceId: string,
  item: BrandGenerationItem,
  nextStatus: BrandGenerationItem['status'],
  patch?: Parameters<typeof transitionBrandGenerationItem>[0]['patch'],
): BrandGenerationItem {
  return transitionBrandGenerationItem({
    workspaceId,
    runId: item.runId,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus,
    patch,
  });
}

function beginAttempt(
  workspaceId: string,
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
  item: BrandGenerationItem,
  stage: BrandGenerationAttempt['stage'],
  effectiveInputFingerprint = item.inputSnapshot?.fingerprint,
): BrandGenerationAttempt {
  if (!item.inputSnapshot || !effectiveInputFingerprint) {
    throw new Error('Brand generation item has no frozen effective input.');
  }
  return beginBrandGenerationAttempt({
    workspaceId,
    runId: run.id,
    itemId: item.id,
    commandId: command.id,
    jobId: command.jobId,
    stage,
    expectedRunRevision: run.revision,
    expectedItemRevision: item.revision,
    expectedDeliverableVersion: expectedDeliverableVersion(item),
    sourceInputFingerprint: item.inputSnapshot.fingerprint,
    effectiveInputFingerprint,
    reservation: ZERO_USAGE,
  });
}

function reservationCallback(
  workspaceId: string,
  run: PersistedBrandGenerationRun,
  item: BrandGenerationItem,
  attempt: BrandGenerationAttempt,
  jobId: string,
  signal: AbortSignal,
) {
  return (reservation: Parameters<NonNullable<GenerateBrandGenerationCandidateInput['reserveProviderDispatch']>>[0]) => {
    assertNotCancelled(jobId, signal);
    reserveBrandGenerationAttemptBudget({
      workspaceId,
      runId: run.id,
      itemId: item.id,
      attemptId: attempt.id,
      expectedRunRevision: run.revision,
      expectedItemRevision: item.revision,
      effectiveInputFingerprint: reservation.effectiveInputFingerprint,
      reservation: {
        providerCalls: reservation.providerCalls,
        inputTokens: reservation.inputTokens,
        outputTokens: reservation.outputTokens,
        estimatedCostMicros: reservation.estimatedCostMicros,
      },
    });
    assertNotCancelled(jobId, signal);
  };
}

function completeAttempt(
  workspaceId: string,
  item: BrandGenerationItem,
  attempt: BrandGenerationAttempt,
  output: Parameters<typeof completeBrandGenerationAttempt>[0]['output'],
  provenance: Parameters<typeof completeBrandGenerationAttempt>[0]['provenance'],
): BrandGenerationAttempt {
  return completeBrandGenerationAttempt({
    workspaceId,
    runId: item.runId,
    itemId: item.id,
    attemptId: attempt.id,
    output,
    provenance,
  });
}

function currentDeliverableCandidate(
  item: BrandGenerationItem,
): Extract<BrandGenerationCandidateAttemptOutput, { kind: 'deliverable_candidate' }> {
  if (item.target === 'voice_foundation' || item.content === null) {
    throw new Error('Review-directed revision requires an existing durable candidate.');
  }
  return {
    kind: 'deliverable_candidate',
    content: item.content,
    foundationDraft: null,
    claims: item.claims,
    requirements: item.requirements,
    placeholders: item.placeholders,
  };
}

function isCancellation(jobId: string, signal: AbortSignal): boolean {
  return signal.aborted || isJobCancelled(jobId);
}

function endActiveAttempt(
  workspaceId: string,
  item: BrandGenerationItem,
  attempt: BrandGenerationAttempt | null,
  kind: ItemEndKind,
  stage: string,
): void {
  if (!attempt || attempt.status !== 'running') return;
  const input = {
    workspaceId,
    runId: item.runId,
    itemId: item.id,
    attemptId: attempt.id,
    error: kind === 'cancelled'
      ? cancellationError(stage)
      : kind === 'conflict'
        ? conflictError(stage)
        : sanitizedError(stage),
  };
  if (kind === 'cancelled') cancelBrandGenerationAttempt(input);
  else failBrandGenerationAttempt(input);
}

function restoreOrEndItem(
  workspaceId: string,
  command: BrandGenerationCommand,
  itemId: string,
  kind: ItemEndKind,
  stage: string,
): void {
  const current = getBrandGenerationItem(workspaceId, command.runId, itemId);
  if (!current) return;
  const terminal = new Set<BrandGenerationItem['status']>([
    'ready_for_human_review', 'approved', 'changes_requested', 'needs_attention',
    'blocked_missing_evidence', 'conflict', 'cancelled', 'failed',
  ]);
  if (terminal.has(current.status)) return;
  const nextStatus = command.kind === 'revision' && kind !== 'conflict'
    // Revision acceptance invalidates the prior audit/provenance. Cancellation
    // or a retryable stage failure must preserve the human content at a state
    // that can be revised again, never manufacture unaudited ready work.
    ? 'changes_requested'
    : kind === 'cancelled'
      ? 'cancelled'
      : kind;
  moveItem(workspaceId, current, nextStatus, {
    error: kind === 'cancelled'
      ? null
      : kind === 'conflict'
        ? conflictError(stage)
        : sanitizedError(stage),
    completedAt: new Date().toISOString(),
  });
}

async function prepareCandidate(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
  originalItem: BrandGenerationItem,
  signal: AbortSignal,
  deps: BrandGenerationWorkerDependencies,
): Promise<WorkState | null> {
  let item = originalItem;
  let activeAttempt: BrandGenerationAttempt | null = null;
  let stage = 'preflight';
  try {
    assertNotCancelled(command.jobId, signal);
    if (item.status === 'queued') item = moveItem(run.workspaceId, item, 'preflighting');
    if (!item.inputSnapshot) throw new Error('Brand generation item is missing its frozen input.');
    const frozenInput = hydrateBrandGenerationSnapshot(run.workspaceId, item.inputSnapshot);
    const preflight = runBrandGenerationPreflight(frozenInput);
    activeAttempt = beginAttempt(
      run.workspaceId,
      run,
      command,
      item,
      'preflight',
      canonicalBrandGenerationFingerprint({
        stage: 'preflight',
        frozenInput,
      }),
    );
    completeAttempt(run.workspaceId, item, activeAttempt, preflight.attemptOutput, null);
    activeAttempt = null;
    if (!preflight.attemptOutput.readyForPaidWork) {
      item = moveItem(run.workspaceId, item, 'blocked_missing_evidence', {
        requirements: preflight.attemptOutput.requirements,
        placeholders: preflight.attemptOutput.placeholders,
        error: {
          code: 'brand_generation_preflight_blocked',
          message: 'Required evidence is missing. No paid generation was dispatched.',
          retryable: true,
          stage: 'preflight',
        },
        completedAt: new Date().toISOString(),
      });
      return { item, frozenInput, preflight, failed: true };
    }

    stage = command.kind === 'revision' ? 'revision' : 'generation';
    if (command.kind !== 'revision') item = moveItem(run.workspaceId, item, 'generating');
    const attemptStage = command.kind === 'revision'
      ? 'revision'
      : item.target === 'voice_foundation'
        ? 'voice_foundation_generation'
        : 'dependent_generation';
    const priorCandidate = command.kind === 'revision'
      ? currentDeliverableCandidate(originalItem)
      : null;
    const direction = command.kind === 'revision'
      ? command.requestSnapshot.command.direction
      : null;
    const effectivePrompt = command.kind === 'revision'
      ? buildBrandGenerationRefinementPrompt(
          frozenInput,
          preflight,
          priorCandidate!,
          direction!,
        )
      : buildBrandGenerationPrompt(frozenInput, preflight);
    activeAttempt = beginAttempt(
      run.workspaceId,
      run,
      command,
      item,
      attemptStage,
      effectivePrompt.effectiveInputFingerprint,
    );
    const reserveProviderDispatch = reservationCallback(
      run.workspaceId,
      run,
      item,
      activeAttempt,
      command.jobId,
      signal,
    );
    const operation = command.kind === 'revision'
      ? deps.refineCandidate({
          frozenInput,
          preflight,
          effectivePrompt,
          priorCandidate: priorCandidate!,
          direction: direction!,
          automaticRevisionCount: 0,
          reserveProviderDispatch,
          signal,
        } satisfies RefineBrandGenerationCandidateInput)
      : deps.generateCandidate({
          frozenInput,
          preflight,
          effectivePrompt,
          reserveProviderDispatch,
          signal,
        } satisfies GenerateBrandGenerationCandidateInput);
    const generated = await operation;
    assertNotCancelled(command.jobId, signal);
    completeAttempt(
      run.workspaceId,
      item,
      activeAttempt,
      generated.output,
      generated.provenance,
    );
    const candidateAttemptId = activeAttempt.id;
    activeAttempt = null;
    return {
      item,
      frozenInput,
      preflight,
      candidate: generated.output,
      candidateAttemptId,
      failed: false,
    };
  } catch (err) {
    const cancelled = isCancellation(command.jobId, signal);
    const endKind = itemEndKind(err, cancelled);
    try {
      endActiveAttempt(run.workspaceId, item, activeAttempt, endKind, stage);
      restoreOrEndItem(run.workspaceId, command, item.id, endKind, stage);
    } catch (endErr) {
      log.error({ err: endErr, runId: run.id, itemId: item.id }, 'failed to persist item failure');
    }
    if (!cancelled) {
      log.warn({ err, runId: run.id, itemId: item.id, stage }, 'brand generation item stage failed');
    }
    return null;
  }
}

function relatedCandidates(
  work: readonly WorkState[],
  current: WorkState,
) {
  return work
    .filter(candidate => candidate !== current && candidate.candidate)
    .map(candidate => ({
      targetId: candidate.item.target,
      candidate: candidate.candidate!,
    }));
}

function revisionDirection(report: GenerationAuditReport): string {
  const findings = [
    ...report.deterministicChecks
      .filter(check => check.result === 'failed')
      .map(check => check.message),
    ...report.modelFindings
      .filter(finding => finding.severity !== 'info')
      .map(finding => finding.message),
  ];
  const direction = (findings.length > 0
    ? `Address only these audit findings while preserving every grounded fact and placeholder: ${findings.join(' | ')}`
    : 'Improve voice, persona fit, and internal consistency while preserving every grounded fact and placeholder.')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (new TextEncoder().encode(direction).byteLength <= BRAND_GENERATION_LIMITS.maxAutomaticDirectionBytes) {
    return direction;
  }
  return utf8Prefix(direction, BRAND_GENERATION_LIMITS.maxAutomaticDirectionBytes);
}

async function auditWork(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
  work: WorkState,
  allWork: readonly WorkState[],
  revisionCount: 0 | 1,
  signal: AbortSignal,
  deps: BrandGenerationWorkerDependencies,
): Promise<void> {
  if (!work.candidate) return;
  let activeAttempt: BrandGenerationAttempt | null = null;
  let stage = 'deterministic_audit';
  try {
    assertNotCancelled(command.jobId, signal);
    work.item = moveItem(run.workspaceId, work.item, 'auditing_deterministic');
    const deterministicAudit = runBrandGenerationDeterministicAudit({
      frozenInput: work.frozenInput,
      preflight: work.preflight,
      candidate: work.candidate,
      revisionCount,
    });
    activeAttempt = beginAttempt(
      run.workspaceId,
      run,
      command,
      work.item,
      'deterministic_audit',
      canonicalBrandGenerationFingerprint({
        stage: 'deterministic_audit',
        sourceInputFingerprint: work.item.inputSnapshot?.fingerprint,
        candidate: work.candidate,
        revisionCount,
        deterministicAudit,
      }),
    );
    completeAttempt(
      run.workspaceId,
      work.item,
      activeAttempt,
      { kind: 'audit', auditReport: deterministicAudit },
      null,
    );
    activeAttempt = null;
    assertNotCancelled(command.jobId, signal);

    stage = 'model_audit';
    work.item = moveItem(run.workspaceId, work.item, 'auditing_model');
    const related = relatedCandidates(allWork, work);
    const effectivePrompt = buildBrandGenerationAuditPrompt(
      work.frozenInput,
      work.preflight,
      work.candidate,
      deterministicAudit,
      related,
    );
    activeAttempt = beginAttempt(
      run.workspaceId,
      run,
      command,
      work.item,
      'model_audit',
      effectivePrompt.effectiveInputFingerprint,
    );
    const audited = await deps.auditCandidate({
      frozenInput: work.frozenInput,
      preflight: work.preflight,
      effectivePrompt,
      candidate: work.candidate,
      revisionCount,
      deterministicReport: deterministicAudit,
      relatedCandidates: related,
      reserveProviderDispatch: reservationCallback(
        run.workspaceId,
        run,
        work.item,
        activeAttempt,
        command.jobId,
        signal,
      ),
      signal,
    } satisfies AuditBrandGenerationCandidateInput);
    assertNotCancelled(command.jobId, signal);
    completeAttempt(
      run.workspaceId,
      work.item,
      activeAttempt,
      audited.output,
      audited.provenance,
    );
    work.auditAttemptId = activeAttempt.id;
    work.auditReport = audited.output.auditReport;
    activeAttempt = null;
  } catch (err) {
    const cancelled = isCancellation(command.jobId, signal);
    const endKind = itemEndKind(err, cancelled);
    try {
      endActiveAttempt(run.workspaceId, work.item, activeAttempt, endKind, stage);
      restoreOrEndItem(run.workspaceId, command, work.item.id, endKind, stage);
    } catch (endErr) {
      log.error({ err: endErr, runId: run.id, itemId: work.item.id }, 'failed to persist audit failure');
    }
    work.failed = true;
    if (!cancelled) {
      log.warn({ err, runId: run.id, itemId: work.item.id, stage }, 'brand generation audit failed');
    }
  }
}

async function refineWork(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
  work: WorkState,
  signal: AbortSignal,
  deps: BrandGenerationWorkerDependencies,
): Promise<void> {
  if (!work.candidate || work.candidate.kind !== 'deliverable_candidate' || !work.auditReport) return;
  let activeAttempt: BrandGenerationAttempt | null = null;
  const stage = 'automatic_revision';
  try {
    assertNotCancelled(command.jobId, signal);
    work.item = moveItem(run.workspaceId, work.item, 'revising');
    const direction = revisionDirection(work.auditReport);
    const effectivePrompt = buildBrandGenerationRefinementPrompt(
      work.frozenInput,
      work.preflight,
      work.candidate,
      direction,
    );
    activeAttempt = beginAttempt(
      run.workspaceId,
      run,
      command,
      work.item,
      'revision',
      effectivePrompt.effectiveInputFingerprint,
    );
    const revised = await deps.refineCandidate({
      frozenInput: work.frozenInput,
      preflight: work.preflight,
      effectivePrompt,
      priorCandidate: work.candidate,
      direction,
      automaticRevisionCount: 0,
      reserveProviderDispatch: reservationCallback(
        run.workspaceId,
        run,
        work.item,
        activeAttempt,
        command.jobId,
        signal,
      ),
      signal,
    } satisfies RefineBrandGenerationCandidateInput);
    assertNotCancelled(command.jobId, signal);
    completeAttempt(
      run.workspaceId,
      work.item,
      activeAttempt,
      revised.output,
      revised.provenance,
    );
    work.candidate = revised.output;
    work.candidateAttemptId = activeAttempt.id;
    work.auditAttemptId = undefined;
    work.auditReport = undefined;
    activeAttempt = null;
  } catch (err) {
    const cancelled = isCancellation(command.jobId, signal);
    const endKind = itemEndKind(err, cancelled);
    try {
      endActiveAttempt(run.workspaceId, work.item, activeAttempt, endKind, stage);
      restoreOrEndItem(run.workspaceId, command, work.item.id, endKind, stage);
    } catch (endErr) {
      log.error({ err: endErr, runId: run.id, itemId: work.item.id }, 'failed to persist revision failure');
    }
    work.failed = true;
    if (!cancelled) {
      log.warn({ err, runId: run.id, itemId: work.item.id, stage }, 'brand generation automatic revision failed');
    }
  }
}

function finalItemStatus(
  report: GenerationAuditReport,
): Extract<BrandGenerationItem['status'],
  'ready_for_human_review' | 'needs_attention' | 'blocked_missing_evidence'> {
  return report.verdict;
}

function commitWork(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
  work: WorkState,
): void {
  if (!work.candidateAttemptId || !work.auditAttemptId || !work.auditReport) return;
  const nextStatus = finalItemStatus(work.auditReport);
  const input = {
    workspaceId: run.workspaceId,
    runId: run.id,
    itemId: work.item.id,
    candidateAttemptId: work.candidateAttemptId,
    finalAuditAttemptId: work.auditAttemptId,
    expectedRunRevision: run.revision,
    expectedItemRevision: work.item.revision,
    nextStatus,
  };
  if (work.item.target === 'voice_foundation') {
    work.item = commitBrandVoiceFoundationCandidate(input);
    return;
  }
  const result = commitBrandGenerationDeliverableCandidate(input);
  work.item = result.item;
  if (result.kind === 'committed') {
    applyBrandGenerationArtifactCommittedEffects(
      run,
      command,
      result.deliverable,
      result.item.id,
    );
  }
}

function terminalStage(status: BrandGenerationRunStatus) {
  if (status === 'completed') return 'complete' as const;
  if (status === 'cancelled' || status === 'failed') return 'complete' as const;
  return 'awaiting_operator_review' as const;
}

function boundedJobResult(run: PersistedBrandGenerationRun) {
  return {
    runId: run.id,
    counts: run.counts,
    terminalStatus: run.status,
  };
}

function finishRun(
  run: PersistedBrandGenerationRun,
  status: BrandGenerationRunStatus,
  command: BrandGenerationCommand,
  options: {
    stage?: 'awaiting_voice_finalization' | 'awaiting_operator_review' | 'complete';
    voiceReadiness?: PersistedBrandGenerationRun['voiceReadiness'];
    completedAt?: string | null;
  } = {},
): PersistedBrandGenerationRun {
  return transitionBrandGenerationRun({
    workspaceId: run.workspaceId,
    runId: run.id,
    expectedRevision: run.revision,
    nextStatus: status,
    nextStage: options.stage ?? terminalStage(status),
    currentJobId: null,
    voiceReadiness: options.voiceReadiness,
    completedAt: options.completedAt === undefined ? new Date().toISOString() : options.completedAt,
    completionCommandId: command.id,
  });
}

function terminalizeJob(
  jobId: string,
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): void {
  const result = boundedJobResult(run);
  if (isJobCancelled(jobId)) {
    updateJob(jobId, {
      status: 'cancelled',
      message: 'Brand generation cancelled',
      result,
    });
    return;
  }
  if (run.status === 'completed' || run.status === 'awaiting_review') {
    updateJob(jobId, {
      status: 'done',
      progress: command.result.selectionCount,
      total: command.result.selectionCount,
      message: run.status === 'awaiting_review'
        ? 'Voice foundation awaiting human resolution and finalization'
        : 'Brand generation ready for human review',
      result,
      error: undefined,
    });
  } else if (run.status === 'cancelled') {
    updateJob(jobId, { status: 'cancelled', message: 'Brand generation cancelled', result });
  } else {
    updateJob(jobId, {
      status: 'error',
      message: 'Brand generation completed with items requiring attention',
      error: 'Review the durable brand generation run for item-level details.',
      result,
    });
  }
}

function cancelUnfinishedItems(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): void {
  for (const item of allItemsForCommand(run, command)) {
    restoreOrEndItem(run.workspaceId, command, item.id, 'cancelled', 'cancellation');
  }
}

function finishCancellation(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): PersistedBrandGenerationRun {
  cancelUnfinishedItems(run, command);
  const current = getPersistedBrandGenerationRun(run.workspaceId, run.id) ?? run;
  if (command.kind === 'revision') {
    const status = deriveBrandGenerationTerminalStatus(
      listPersistedBrandGenerationItems(run.workspaceId, run.id),
    );
    return finishRun(current, status === 'cancelled' ? 'completed_with_errors' : status, command);
  }
  return finishRun(current, 'cancelled', command);
}

async function executeBrandGenerationJob(
  jobId: string,
  signal: AbortSignal,
  overrides?: Partial<BrandGenerationWorkerDependencies>,
): Promise<PersistedBrandGenerationRun> {
  const deps = dependencies(overrides);
  const commands = listBrandGenerationCommandsByJob(
    getJob(jobId)?.workspaceId ?? '',
    jobId,
  );
  if (commands.length !== 1) {
    throw new Error('Brand generation job must reference exactly one durable command.');
  }
  const command = commands[0];
  let run = getPersistedBrandGenerationRun(command.workspaceId, command.runId);
  if (!run) throw new Error('Brand generation run was not found.');
  if (run.currentJobId !== jobId) {
    throw new Error('Brand generation job is not the current run command.');
  }
  if (run.status === 'queued') {
    const stage = run.selectedTargets.some(target => target === 'voice_foundation')
      ? 'voice_foundation_generation'
      : 'dependent_generation';
    run = transitionBrandGenerationRun({
      workspaceId: run.workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
      nextStage: stage,
      currentJobId: jobId,
      completedAt: null,
    });
  }
  if (run.status !== 'running') throw new Error('Brand generation run is not active.');
  const selectedItems = activeItemsForCommand(run, command);
  if (selectedItems.length === 0) throw new Error('Brand generation command has no active items.');

  const prepared: WorkState[] = [];
  await mapBounded(selectedItems, run.budget.limits.maxConcurrency, async item => {
    const work = await prepareCandidate(run!, command, item, signal, deps);
    if (work) prepared.push(work);
  });
  if (isCancellation(jobId, signal)) return finishCancellation(run, command);

  const candidates = prepared
    .filter(work => !work.failed && work.candidate)
    .sort((left, right) => left.item.target.localeCompare(right.item.target));
  await mapBounded(candidates, run.budget.limits.maxConcurrency, async work => {
    await auditWork(run!, command, work, candidates, work.item.automaticRevisionCount, signal, deps);
  });
  if (isCancellation(jobId, signal)) return finishCancellation(run, command);

  const revisions = candidates.filter(work => (
    !work.failed
    && work.item.target !== 'voice_foundation'
    && work.auditReport
    && getBrandGenerationAuditDisposition(
      work.auditReport,
      work.item.automaticRevisionCount,
    ) === 'revise'
  ));
  await mapBounded(revisions, run.budget.limits.maxConcurrency, work => (
    refineWork(run!, command, work, signal, deps)
  ));
  if (isCancellation(jobId, signal)) return finishCancellation(run, command);
  const revised = revisions.filter(work => !work.failed && work.candidate && !work.auditReport);
  await mapBounded(revised, run.budget.limits.maxConcurrency, work => (
    auditWork(run!, command, work, candidates, 1, signal, deps)
  ));
  if (isCancellation(jobId, signal)) return finishCancellation(run, command);

  for (const work of candidates) {
    if (work.failed || !work.auditReport) continue;
    try {
      commitWork(run, command, work);
    } catch (err) {
      log.warn({ err, runId: run.id, itemId: work.item.id }, 'brand generation artifact commit failed');
      restoreOrEndItem(
        run.workspaceId,
        command,
        work.item.id,
        itemEndKind(err, false),
        'artifact_commit',
      );
      work.failed = true;
    }
  }

  const currentItems = listPersistedBrandGenerationItems(run.workspaceId, run.id);
  const foundation = currentItems.find(item => item.target === 'voice_foundation');
  if (
    currentItems.length === 1
    && (foundation?.status === 'ready_for_human_review'
      || foundation?.status === 'needs_attention')
  ) {
    const blockingReasons: [string, ...string[]] = foundation.status === 'ready_for_human_review'
      ? ['A human operator must finalize brand voice before dependent generation.']
      : [
          'Resolve the foundation evidence requirements and finalize brand voice before dependent generation.',
        ];
    return finishRun(run, 'awaiting_review', command, {
      stage: 'awaiting_voice_finalization',
      voiceReadiness: {
        state: 'provisional',
        foundationItemId: foundation.id,
        blockingReasons,
      },
      completedAt: null,
    });
  }
  return finishRun(run, deriveBrandGenerationTerminalStatus(currentItems), command);
}

export async function runBrandGenerationJob(
  jobId: string,
  overrides?: Partial<BrandGenerationWorkerDependencies>,
): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.workspaceId) return;
  if (job.status === 'cancelled') {
    const command = listBrandGenerationCommandsByJob(job.workspaceId, jobId)[0];
    const current = command
      ? getPersistedBrandGenerationRun(job.workspaceId, command.runId)
      : null;
    if (command && current && (current.status === 'queued' || current.status === 'running')) {
      const ended = finishCancellation(current, command);
      terminalizeJob(jobId, ended, command);
      applyBrandGenerationCompletedEffects(ended, command);
    }
    return;
  }
  const controller = registerAbort(jobId);
  try {
    updateJob(jobId, {
      status: 'running',
      message: 'Generating grounded brand deliverables...',
    });
    const run = await executeBrandGenerationJob(jobId, controller.signal, overrides);
    const command = listBrandGenerationCommandsByJob(job.workspaceId, jobId)[0];
    if (!command) throw new Error('Brand generation job command was not found after execution.');
    terminalizeJob(jobId, run, command);
    applyBrandGenerationCompletedEffects(run, command);
  } catch (err) {
    const commands = listBrandGenerationCommandsByJob(job.workspaceId, jobId);
    const command = commands[0];
    const cancelled = isCancellation(jobId, controller.signal);
    const current = commands[0]
      ? getPersistedBrandGenerationRun(job.workspaceId, commands[0].runId)
      : null;
    if (current?.status === 'running' && command) {
      try {
        const ended = cancelled
          ? finishCancellation(current, command)
          : finishRun(current, 'failed', command);
        terminalizeJob(jobId, ended, command);
        applyBrandGenerationCompletedEffects(ended, command);
      } catch (terminalErr) {
        log.error({ err: terminalErr, jobId }, 'failed to terminalize brand generation run');
      }
    } else if (!cancelled) {
      updateJob(jobId, {
        status: 'error',
        message: 'Brand generation failed',
        error: 'Review the durable brand generation run for details.',
      });
    }
    if (!cancelled) log.error({ err, jobId }, 'brand generation job failed');
  } finally {
    unregisterAbort(jobId);
  }
}

export function queueBrandGenerationJob(jobId: string): void {
  void runBrandGenerationJob(jobId).catch(err => {
    log.error({ err, jobId }, 'queued brand generation job rejected');
  });
}
