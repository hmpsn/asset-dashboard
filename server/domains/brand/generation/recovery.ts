import type {
  BrandGenerationCommand,
  BrandGenerationItem,
  BrandGenerationRunStatus,
  PersistedBrandGenerationRun,
} from '../../../../shared/types/brand-generation.js';
import type { GenerationSanitizedError } from '../../../../shared/types/generation-evidence.js';
import { BACKGROUND_JOB_TYPES } from '../../../../shared/types/background-jobs.js';
import { createJob, getJob } from '../../../jobs.js';
import { createLogger } from '../../../logger.js';
import {
  failBrandGenerationAttempt,
  listActiveBrandGenerationRunsForRecovery,
  listBrandGenerationCommandsByJob,
  listPersistedBrandGenerationItems,
  listRunningBrandGenerationAttemptsForJob,
  transitionBrandGenerationItem,
  transitionBrandGenerationRun,
} from './repository.js';
import { queueBrandGenerationJob } from './worker.js';

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
  terminalizedRuns: number;
  failedAttempts: number;
  failedItems: number;
  restoredReviewItems: number;
  preservedItems: number;
  alreadyRecoveredRuns: number;
  errors: number;
}

export interface BrandGenerationRecoveryDependencies {
  listActiveRuns: typeof listActiveBrandGenerationRunsForRecovery;
  listItems: typeof listPersistedBrandGenerationItems;
  listCommandsByJob: typeof listBrandGenerationCommandsByJob;
  listRunningAttempts: typeof listRunningBrandGenerationAttemptsForJob;
  failAttempt: typeof failBrandGenerationAttempt;
  transitionItem: typeof transitionBrandGenerationItem;
  transitionRun: typeof transitionBrandGenerationRun;
  getJob: typeof getJob;
  createJob: typeof createJob;
  queueJob: typeof queueBrandGenerationJob;
  now: () => Date;
}

const DEFAULT_DEPENDENCIES: BrandGenerationRecoveryDependencies = {
  listActiveRuns: listActiveBrandGenerationRunsForRecovery,
  listItems: listPersistedBrandGenerationItems,
  listCommandsByJob: listBrandGenerationCommandsByJob,
  listRunningAttempts: listRunningBrandGenerationAttemptsForJob,
  failAttempt: failBrandGenerationAttempt,
  transitionItem: transitionBrandGenerationItem,
  transitionRun: transitionBrandGenerationRun,
  getJob,
  createJob,
  queueJob: queueBrandGenerationJob,
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

function hasNoPaidWork(run: PersistedBrandGenerationRun, items: readonly BrandGenerationItem[]): boolean {
  const reserved = run.budget.reserved;
  return items.every(item => item.attemptCount === 0)
    && reserved.providerCalls === 0
    && reserved.inputTokens === 0
    && reserved.outputTokens === 0
    && reserved.estimatedCostMicros === 0;
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
    if (command.priorItemStatus === 'ready_for_human_review') {
      return moveItem(deps, run, current, command.priorItemStatus, {
        error: null,
        completedAt: deps.now().toISOString(),
      });
    }
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

  return moveItem(deps, run, current, command.priorItemStatus, {
    error: null,
    completedAt: deps.now().toISOString(),
  });
}

function deriveTerminalStatus(items: readonly BrandGenerationItem[]): BrandGenerationRunStatus {
  if (items.length === 1
    && items[0].target === 'voice_foundation'
    && items[0].status === 'ready_for_human_review') {
    return 'awaiting_review';
  }
  const successful = items.filter(item => (
    item.status === 'ready_for_human_review' || item.status === 'approved'
  )).length;
  if (items.length > 0 && successful === items.length) return 'completed';
  if (successful > 0
    || items.some(item => item.status === 'needs_attention' || item.status === 'changes_requested')) {
    return 'completed_with_errors';
  }
  if (items.length > 0 && items.every(item => item.status === 'blocked_missing_evidence')) return 'blocked';
  if (items.length > 0 && items.every(item => item.status === 'conflict')) return 'conflict';
  if (items.length > 0 && items.every(item => item.status === 'cancelled')) return 'cancelled';
  return 'failed';
}

function terminalStage(status: BrandGenerationRunStatus) {
  if (status === 'awaiting_review') return 'awaiting_voice_finalization' as const;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return 'complete' as const;
  return 'awaiting_operator_review' as const;
}

function terminalizeRun(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand | null,
  deps: BrandGenerationRecoveryDependencies,
  summary: BrandGenerationRecoverySummary,
): void {
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
  let status = deriveTerminalStatus(finalItems);
  if (run.status === 'queued' && !['blocked', 'conflict', 'cancelled', 'failed'].includes(status)) {
    status = 'failed';
  }
  const foundation = finalItems.find(item => item.target === 'voice_foundation');
  deps.transitionRun({
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
          blockingReasons: ['A human operator must finalize brand voice before dependent generation.'],
        }
      : undefined,
    completedAt: status === 'awaiting_review' ? null : now,
  });
  summary.terminalizedRuns += 1;
}

function emptySummary(): BrandGenerationRecoverySummary {
  return {
    scannedRuns: 0,
    repairedJobs: 0,
    terminalizedRuns: 0,
    failedAttempts: 0,
    failedItems: 0,
    restoredReviewItems: 0,
    preservedItems: 0,
    alreadyRecoveredRuns: 0,
    errors: 0,
  };
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
  const runs = deps.listActiveRuns(RECOVERY_LIMIT);
  summary.scannedRuns = runs.length;

  for (const run of runs) {
    try {
      const jobId = run.currentJobId;
      const job = jobId ? deps.getJob(jobId) : undefined;
      if (job?.status === 'pending' || job?.status === 'running') {
        summary.alreadyRecoveredRuns += 1;
        continue;
      }
      const commands = jobId ? deps.listCommandsByJob(run.workspaceId, jobId) : [];
      const command = commands.length === 1 ? commands[0] : null;
      const items = deps.listItems(run.workspaceId, run.id);
      if (run.status === 'queued' && jobId && !job && command && hasNoPaidWork(run, items)) {
        deps.createJob(BACKGROUND_JOB_TYPES.BRAND_DELIVERABLE_GENERATION, {
          id: jobId,
          workspaceId: run.workspaceId,
          total: command.result.selectionCount,
          message: acceptedJobMessage(command),
        });
        deps.queueJob(jobId);
        summary.repairedJobs += 1;
        continue;
      }
      terminalizeRun(run, command, deps, summary);
    } catch (err) {
      summary.errors += 1;
      log.error({ err, runId: run.id, workspaceId: run.workspaceId }, 'brand generation restart recovery failed');
    }
  }

  if (summary.scannedRuns > 0) {
    log.info(summary, 'brand generation restart recovery completed');
  }
  return summary;
}
