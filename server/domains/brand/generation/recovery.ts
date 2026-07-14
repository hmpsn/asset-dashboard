import type {
  BrandGenerationCommand,
  BrandGenerationItem,
  BrandGenerationRunStatus,
  PersistedBrandGenerationRun,
} from '../../../../shared/types/brand-generation.js';
import type { GenerationSanitizedError } from '../../../../shared/types/generation-evidence.js';
import { BACKGROUND_JOB_TYPES } from '../../../../shared/types/background-jobs.js';
import { createJob, getJob, updateJob } from '../../../jobs.js';
import { createLogger } from '../../../logger.js';
import { applyBrandGenerationCompletedEffects } from './effects.js';
import {
  cancelBrandGenerationAttempt,
  countBrandGenerationAttemptsForCommand,
  failBrandGenerationAttempt,
  isBrandGenerationJobRepairEligible,
  listActiveBrandGenerationRunsForRecovery,
  listBrandGenerationCommandsByJob,
  listPersistedBrandGenerationItems,
  listRunningBrandGenerationAttemptsForJob,
  listTerminalBrandGenerationRunsForRecovery,
  removeRestartInterruptedBrandGenerationJobForRepair,
  transitionBrandGenerationItem,
  transitionBrandGenerationRun,
  type BrandGenerationRecoveryCursor,
  type TerminalBrandGenerationRunRecoveryCandidate,
} from './repository.js';
import { queueBrandGenerationJob } from './worker.js';
import { deriveBrandGenerationTerminalStatus } from './terminal-status.js';

const log = createLogger('brand-generation-recovery');
const RECOVERY_LIMIT = 100;

const ACTIVE_ITEM_STATUSES = new Set<BrandGenerationItem['status']>([
  'queued',
  'preflighting',
  'generating',
  'auditing_deterministic',
  'auditing_model',
  'revising',
]);

const COMPLETED_ITEM_STATUSES = new Set<BrandGenerationItem['status']>([
  'ready_for_human_review',
  'approved',
  'changes_requested',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
]);

export interface BrandGenerationRecoverySummary {
  scannedRuns: number;
  repairedJobs: number;
  reconciledTerminalJobs: number;
  terminalizedRuns: number;
  cancelledRuns: number;
  failedAttempts: number;
  cancelledAttempts: number;
  failedItems: number;
  restoredReviewItems: number;
  preservedItems: number;
  alreadyRecoveredRuns: number;
  errors: number;
}

export interface BrandGenerationRecoveryDependencies {
  listActiveRuns: typeof listActiveBrandGenerationRunsForRecovery;
  listTerminalRuns: typeof listTerminalBrandGenerationRunsForRecovery;
  listItems: typeof listPersistedBrandGenerationItems;
  listCommandsByJob: typeof listBrandGenerationCommandsByJob;
  countCommandAttempts: typeof countBrandGenerationAttemptsForCommand;
  listRunningAttempts: typeof listRunningBrandGenerationAttemptsForJob;
  failAttempt: typeof failBrandGenerationAttempt;
  cancelAttempt: typeof cancelBrandGenerationAttempt;
  transitionItem: typeof transitionBrandGenerationItem;
  transitionRun: typeof transitionBrandGenerationRun;
  getJob: typeof getJob;
  createJob: typeof createJob;
  updateJob: typeof updateJob;
  removeInterruptedJob: typeof removeRestartInterruptedBrandGenerationJobForRepair;
  queueJob: typeof queueBrandGenerationJob;
  applyCompletedEffects: typeof applyBrandGenerationCompletedEffects;
  now: () => Date;
}

const DEFAULT_DEPENDENCIES: BrandGenerationRecoveryDependencies = {
  listActiveRuns: listActiveBrandGenerationRunsForRecovery,
  listTerminalRuns: listTerminalBrandGenerationRunsForRecovery,
  listItems: listPersistedBrandGenerationItems,
  listCommandsByJob: listBrandGenerationCommandsByJob,
  countCommandAttempts: countBrandGenerationAttemptsForCommand,
  listRunningAttempts: listRunningBrandGenerationAttemptsForJob,
  failAttempt: failBrandGenerationAttempt,
  cancelAttempt: cancelBrandGenerationAttempt,
  transitionItem: transitionBrandGenerationItem,
  transitionRun: transitionBrandGenerationRun,
  getJob,
  createJob,
  updateJob,
  removeInterruptedJob: removeRestartInterruptedBrandGenerationJobForRepair,
  queueJob: queueBrandGenerationJob,
  applyCompletedEffects: applyBrandGenerationCompletedEffects,
  now: () => new Date(),
};

function recoveryError(): GenerationSanitizedError {
  return {
    code: 'brand_generation_restart_interrupted',
    message: 'A server restart interrupted this attempt. Review the durable run and submit a new command with a new idempotency key if work should continue.',
    retryable: false,
    stage: 'restart_recovery',
  };
}

function cancellationError(): GenerationSanitizedError {
  return {
    code: 'brand_generation_cancelled',
    message: 'Brand generation was cancelled before this stage completed.',
    retryable: true,
    stage: 'cancellation',
  };
}

function isRestartInterruptedJob(
  job: NonNullable<ReturnType<typeof getJob>>,
  workspaceId: string,
): boolean {
  return job.type === BACKGROUND_JOB_TYPES.BRAND_DELIVERABLE_GENERATION
    && job.workspaceId === workspaceId
    && job.status === 'error'
    && job.message === 'Interrupted by server restart'
    && job.error === 'Server restarted — job interrupted';
}

function acceptedJobMessage(command: BrandGenerationCommand): string {
  if (command.kind === 'resume') return 'Preparing dependent brand deliverables...';
  if (command.kind === 'revision') return 'Preparing the requested brand revision...';
  return 'Preparing grounded brand generation...';
}

function moveItem(
  deps: BrandGenerationRecoveryDependencies,
  run: PersistedBrandGenerationRun,
  item: BrandGenerationItem,
  nextStatus: BrandGenerationItem['status'],
  patch: Parameters<typeof transitionBrandGenerationItem>[0]['patch'],
): BrandGenerationItem {
  return deps.transitionItem({
    workspaceId: run.workspaceId,
    runId: run.id,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus,
    patch,
  });
}

function restoreRevisionItem(
  deps: BrandGenerationRecoveryDependencies,
  run: PersistedBrandGenerationRun,
  command: Extract<BrandGenerationCommand, { kind: 'revision' }>,
  item: BrandGenerationItem,
): BrandGenerationItem | null {
  if (item.id !== command.itemId || COMPLETED_ITEM_STATUSES.has(item.status)) return null;
  if (item.status === 'cancelled') return null;

  const interrupted = recoveryError();
  let current = item;
  if (current.status === 'auditing_deterministic' || current.status === 'auditing_model') {
    current = moveItem(deps, run, current, 'revising', {
      error: interrupted,
      completedAt: null,
    });
  } else if (current.status !== 'revising') {
    if (current.status !== 'failed') {
      current = moveItem(deps, run, current, 'failed', {
        error: interrupted,
        completedAt: deps.now().toISOString(),
      });
    }
    current = moveItem(deps, run, current, 'revising', {
      error: null,
      completedAt: null,
    });
  }

  // Revision acceptance clears the old audit/provenance. Restoring a prior
  // ready state would manufacture an unaudited "ready" artifact.
  return moveItem(deps, run, current, 'changes_requested', {
    error: null,
    completedAt: deps.now().toISOString(),
  });
}

function terminalStage(status: BrandGenerationRunStatus) {
  if (status === 'awaiting_review') return 'awaiting_voice_finalization' as const;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return 'complete' as const;
  return 'awaiting_operator_review' as const;
}

function boundedJobResult(run: PersistedBrandGenerationRun) {
  return {
    runId: run.id,
    counts: run.counts,
    terminalStatus: run.status,
  };
}

function terminalizeGenericJob(
  deps: BrandGenerationRecoveryDependencies,
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): void {
  const result = boundedJobResult(run);
  if (run.status === 'completed' || run.status === 'awaiting_review') {
    deps.updateJob(command.jobId, {
      status: 'done',
      progress: command.result.selectionCount,
      total: command.result.selectionCount,
      message: run.status === 'awaiting_review'
        ? 'Voice foundation awaiting human resolution and finalization'
        : 'Brand generation ready for human review',
      result,
      error: undefined,
    });
    return;
  }
  if (run.status === 'cancelled') {
    deps.updateJob(command.jobId, {
      status: 'cancelled',
      message: 'Brand generation cancelled',
      result,
      error: undefined,
    });
    return;
  }
  deps.updateJob(command.jobId, {
    status: 'error',
    message: 'Brand generation completed with items requiring attention',
    error: 'Review the durable brand generation run for item-level details.',
    result,
  });
}

function createAcceptedJob(
  deps: BrandGenerationRecoveryDependencies,
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): void {
  deps.createJob(BACKGROUND_JOB_TYPES.BRAND_DELIVERABLE_GENERATION, {
    id: command.jobId,
    workspaceId: run.workspaceId,
    total: command.result.selectionCount,
    message: acceptedJobMessage(command),
  });
}

function recreateRestartInterruptedJob(
  deps: BrandGenerationRecoveryDependencies,
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): boolean {
  if (!deps.removeInterruptedJob(run.workspaceId, command.jobId)) return false;
  createAcceptedJob(deps, run, command);
  return true;
}

function terminalizeRun(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand | null,
  deps: BrandGenerationRecoveryDependencies,
  summary: BrandGenerationRecoverySummary,
): PersistedBrandGenerationRun {
  const now = deps.now().toISOString();
  const error = recoveryError();
  const jobId = run.currentJobId;
  if (jobId) {
    for (const attempt of deps.listRunningAttempts(run.workspaceId, run.id, jobId)) {
      deps.failAttempt({
        workspaceId: run.workspaceId,
        runId: run.id,
        itemId: attempt.itemId,
        attemptId: attempt.id,
        error,
      });
      summary.failedAttempts += 1;
    }
  }

  const items = deps.listItems(run.workspaceId, run.id);
  for (const item of items) {
    if (command?.kind === 'revision' && item.id === command.itemId) {
      const restored = restoreRevisionItem(deps, run, command, item);
      if (restored) summary.restoredReviewItems += 1;
      else summary.preservedItems += 1;
      continue;
    }
    if (!ACTIVE_ITEM_STATUSES.has(item.status)) {
      summary.preservedItems += 1;
      continue;
    }
    moveItem(deps, run, item, 'failed', { error, completedAt: now });
    summary.failedItems += 1;
  }

  const finalItems = deps.listItems(run.workspaceId, run.id);
  let status = deriveBrandGenerationTerminalStatus(finalItems);
  if (run.status === 'queued' && !['blocked', 'conflict', 'cancelled', 'failed'].includes(status)) {
    status = 'failed';
  }
  const foundation = finalItems.find(item => item.target === 'voice_foundation');
  const ended = deps.transitionRun({
    workspaceId: run.workspaceId,
    runId: run.id,
    expectedRevision: run.revision,
    nextStatus: status,
    nextStage: terminalStage(status),
    currentJobId: null,
    voiceReadiness: status === 'awaiting_review' && foundation
      ? {
          state: 'provisional',
          foundationItemId: foundation.id,
          blockingReasons: foundation.status === 'needs_attention'
            ? [
                'Resolve the foundation evidence requirements and finalize brand voice before dependent generation.',
              ]
            : ['A human operator must finalize brand voice before dependent generation.'],
        }
      : undefined,
    completedAt: status === 'awaiting_review' ? null : now,
    completionCommandId: command?.id,
  });
  summary.terminalizedRuns += 1;
  return ended;
}

function cancelRun(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand | null,
  deps: BrandGenerationRecoveryDependencies,
  summary: BrandGenerationRecoverySummary,
): PersistedBrandGenerationRun {
  const now = deps.now().toISOString();
  const jobId = run.currentJobId;
  if (jobId) {
    for (const attempt of deps.listRunningAttempts(run.workspaceId, run.id, jobId)) {
      deps.cancelAttempt({
        workspaceId: run.workspaceId,
        runId: run.id,
        itemId: attempt.itemId,
        attemptId: attempt.id,
        error: cancellationError(),
      });
      summary.cancelledAttempts += 1;
    }
  }

  const items = deps.listItems(run.workspaceId, run.id);
  const selectedTargets = new Set(run.selectedTargets);
  for (const item of items) {
    const belongsToCommand = command?.kind === 'revision'
      ? item.id === command.itemId
      : selectedTargets.has(item.target);
    if (!belongsToCommand || !ACTIVE_ITEM_STATUSES.has(item.status)) {
      summary.preservedItems += 1;
      continue;
    }
    if (command?.kind === 'revision') {
      const restored = restoreRevisionItem(deps, run, command, item);
      if (restored) summary.restoredReviewItems += 1;
      else summary.preservedItems += 1;
      continue;
    }
    moveItem(deps, run, item, 'cancelled', { error: null, completedAt: now });
  }

  const finalItems = deps.listItems(run.workspaceId, run.id);
  let status: BrandGenerationRunStatus = 'cancelled';
  if (command?.kind === 'revision') {
    const derived = deriveBrandGenerationTerminalStatus(finalItems);
    status = derived === 'cancelled' ? 'completed_with_errors' : derived;
  }
  const ended = deps.transitionRun({
    workspaceId: run.workspaceId,
    runId: run.id,
    expectedRevision: run.revision,
    nextStatus: status,
    nextStage: terminalStage(status),
    currentJobId: null,
    completedAt: status === 'awaiting_review' ? null : now,
    completionCommandId: command?.id,
  });
  summary.cancelledRuns += 1;
  return ended;
}

function emptySummary(): BrandGenerationRecoverySummary {
  return {
    scannedRuns: 0,
    repairedJobs: 0,
    reconciledTerminalJobs: 0,
    terminalizedRuns: 0,
    cancelledRuns: 0,
    failedAttempts: 0,
    cancelledAttempts: 0,
    failedItems: 0,
    restoredReviewItems: 0,
    preservedItems: 0,
    alreadyRecoveredRuns: 0,
    errors: 0,
  };
}

function processActiveRun(
  run: PersistedBrandGenerationRun,
  deps: BrandGenerationRecoveryDependencies,
  summary: BrandGenerationRecoverySummary,
): void {
  const jobId = run.currentJobId;
  const job = jobId ? deps.getJob(jobId) : undefined;
  if (job?.status === 'pending' || job?.status === 'running') {
    summary.alreadyRecoveredRuns += 1;
    return;
  }
  const commands = jobId ? deps.listCommandsByJob(run.workspaceId, jobId) : [];
  const command = commands.length === 1 ? commands[0] : null;
  if (job?.status === 'cancelled') {
    const ended = cancelRun(run, command, deps, summary);
    deps.updateJob(job.id, {
      status: 'cancelled',
      message: 'Brand generation cancelled',
      result: boundedJobResult(ended),
      error: undefined,
    });
    if (command) deps.applyCompletedEffects(ended, command);
    return;
  }

  const items = deps.listItems(run.workspaceId, run.id);
  const commandAttemptCount = command
    ? deps.countCommandAttempts(run.workspaceId, run.id, command.id)
    : -1;
  const repairable = command !== null
    && isBrandGenerationJobRepairEligible(run, command, items, commandAttemptCount);
  const restartInterrupted = job !== undefined
    && isRestartInterruptedJob(job, run.workspaceId);
  if (jobId && command && repairable && (job === undefined || restartInterrupted)) {
    if (restartInterrupted) {
      if (!recreateRestartInterruptedJob(deps, run, command)) return;
    } else {
      createAcceptedJob(deps, run, command);
    }
    deps.queueJob(jobId);
    summary.repairedJobs += 1;
    return;
  }

  const ended = terminalizeRun(run, command, deps, summary);
  let completionEffectReady = true;
  if (restartInterrupted && command) {
    completionEffectReady = recreateRestartInterruptedJob(deps, ended, command);
    if (completionEffectReady) terminalizeGenericJob(deps, ended, command);
  }
  if (command && completionEffectReady) deps.applyCompletedEffects(ended, command);
}

function processTerminalRun(
  candidate: TerminalBrandGenerationRunRecoveryCandidate,
  deps: BrandGenerationRecoveryDependencies,
  summary: BrandGenerationRecoverySummary,
): void {
  const { run, jobId } = candidate;
  const job = deps.getJob(jobId);
  if (!job || !isRestartInterruptedJob(job, run.workspaceId)) return;
  const commands = deps.listCommandsByJob(run.workspaceId, jobId);
  if (commands.length !== 1) return;
  const command = commands[0]!;
  if (!recreateRestartInterruptedJob(deps, run, command)) return;
  terminalizeGenericJob(deps, run, command);
  deps.applyCompletedEffects(run, command);
  summary.reconciledTerminalJobs += 1;
}

function nextCursor(run: PersistedBrandGenerationRun): BrandGenerationRecoveryCursor {
  return { updatedAt: run.updatedAt, runId: run.id };
}

/**
 * Reconciles the durable brand-generation ledger after `initJobs()` has marked
 * pre-restart generic jobs terminal. Only a never-started accepted command may
 * be requeued; interrupted paid work is truthfully terminalized for a new command.
 */
export function reconcileBrandGenerationRunsAfterRestart(
  overrides?: Partial<BrandGenerationRecoveryDependencies>,
): BrandGenerationRecoverySummary {
  const deps = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const summary = emptySummary();
  let activeCursor: BrandGenerationRecoveryCursor | undefined;
  while (true) {
    const runs = deps.listActiveRuns(RECOVERY_LIMIT, activeCursor);
    summary.scannedRuns += runs.length;
    for (const run of runs) {
      try {
        processActiveRun(run, deps, summary);
      } catch (err) {
        summary.errors += 1;
        log.error({ err, runId: run.id, workspaceId: run.workspaceId }, 'brand generation restart recovery failed');
      }
    }
    if (runs.length < RECOVERY_LIMIT) break;
    activeCursor = nextCursor(runs[runs.length - 1]!);
  }

  let terminalCursor: BrandGenerationRecoveryCursor | undefined;
  while (true) {
    const candidates = deps.listTerminalRuns(RECOVERY_LIMIT, terminalCursor);
    summary.scannedRuns += candidates.length;
    for (const candidate of candidates) {
      try {
        processTerminalRun(candidate, deps, summary);
      } catch (err) {
        summary.errors += 1;
        log.error({
          err,
          runId: candidate.run.id,
          workspaceId: candidate.run.workspaceId,
        }, 'terminal brand generation job recovery failed');
      }
    }
    if (candidates.length < RECOVERY_LIMIT) break;
    terminalCursor = nextCursor(candidates[candidates.length - 1]!.run);
  }

  if (summary.scannedRuns > 0) {
    log.info(summary, 'brand generation restart recovery completed');
  }
  return summary;
}
