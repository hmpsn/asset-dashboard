import { getPost } from '../../../content-posts-db.js';
import type { BoundedProviderDispatch } from '../../../content-posts-ai.js';
import { broadcastToWorkspace } from '../../../broadcast.js';
import { invalidateContentPipelineIntelligence } from '../../../intelligence-freshness.js';
import {
  getJob,
  runResourceScopedJobWorker,
  updateJob,
} from '../../../jobs.js';
import { createLogger } from '../../../logger.js';
import { WS_EVENTS } from '../../../ws-events.js';
import type {
  MatrixGenerationItem,
  MatrixGenerationRunStatus,
  MatrixGenerationSetAuditReport,
} from '../../../../shared/types/matrix-generation.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import {
  auditMatrixGenerationItem,
  reviseMatrixGenerationItemForSetAudit,
} from './item-audit.js';
import {
  getPersistedMatrixGenerationRun,
  getPersistedMatrixGenerationRunByJob,
  listMatrixGenerationItems,
  saveMatrixGenerationSetAuditReport,
  reserveMatrixGenerationBudget,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from './repository.js';
import { getMatrixGenerationRetryCommandByJob } from './retry-repository.js';
import { auditMatrixGenerationSet } from './set-audit.js';
import { generateMatrixRunItem } from './single-cell.js';
import { matrixGenerationProviderReservation } from './budget.js';

const log = createLogger('content-matrix-generation-worker');

function notifyMatrixGenerationUpdated(
  workspaceId: string,
  runId: string,
  status: MatrixGenerationRunStatus,
): void {
  try {
    invalidateContentPipelineIntelligence(workspaceId);
  } catch (err) {
    log.warn({ err, workspaceId, runId }, 'failed to invalidate matrix generation intelligence');
  }
  try {
    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, {
      domain: 'content-plan',
      runId,
      status,
      action: 'matrix_generation_completed',
    });
  } catch (err) {
    log.warn({ err, workspaceId, runId }, 'failed to broadcast matrix generation completion');
  }
}

const TERMINAL_ITEM_STATUSES = new Set<MatrixGenerationItem['status']>([
  'ready_for_human_review',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
  'cancelled',
  'failed',
]);

const TERMINAL_RUN_STATUSES = new Set<MatrixGenerationRunStatus>([
  'completed',
  'completed_with_errors',
  'blocked',
  'conflict',
  'cancelled',
  'failed',
]);

function terminalStatus(items: readonly MatrixGenerationItem[]): MatrixGenerationRunStatus {
  if (items.length > 0 && items.every(item => item.status === 'ready_for_human_review')) {
    return 'completed';
  }
  if (items.length > 0 && items.every(item => item.status === 'blocked_missing_evidence')) {
    return 'blocked';
  }
  if (items.length > 0 && items.every(item => item.status === 'conflict')) return 'conflict';
  if (items.length > 0 && items.every(item => item.status === 'cancelled')) return 'cancelled';
  if (items.length > 0 && items.every(item => item.status === 'failed')) return 'failed';
  return 'completed_with_errors';
}

async function mapBounded(
  itemIds: readonly string[],
  concurrency: number,
  worker: (itemId: string) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const takeNext = async (): Promise<void> => {
    while (nextIndex < itemIds.length) {
      const current = itemIds[nextIndex];
      nextIndex += 1;
      if (current) await worker(current);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, itemIds.length) },
    () => takeNext(),
  ));
}

function cancelQueuedItems(workspaceId: string, runId: string): void {
  for (const item of listMatrixGenerationItems(workspaceId, runId)) {
    if (item.status !== 'queued') continue;
    try {
      transitionMatrixGenerationItem({
        workspaceId,
        itemId: item.id,
        expectedRevision: item.revision,
        nextStatus: 'cancelled',
        error: {
          code: 'matrix_generation_cancelled',
          message: 'Generation was cancelled before this page started.',
          retryable: false,
        },
      });
    } catch { // catch-ok: an already-started item owns its own cancellation transition.
      // The worker that advanced the item will observe the shared abort signal.
    }
  }
}

function demoteReadyItemsWithoutSetAudit(workspaceId: string, runId: string): void {
  const run = getPersistedMatrixGenerationRun(workspaceId, runId);
  if (!run) return;
  for (const item of listMatrixGenerationItems(workspaceId, runId)) {
    const unresolvedSetFinding = run.setAuditReport?.findings.some(
      finding => finding.affectedItemIds.includes(item.id),
    ) ?? true;
    if (item.status !== 'ready_for_human_review' || !unresolvedSetFinding) continue;
    transitionMatrixGenerationItem({
      workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'needs_attention',
      error: {
        code: 'matrix_generation_set_audit_incomplete',
        message: 'The required cross-page review did not complete.',
        retryable: true,
      },
    });
  }
}

function recordUnexpectedWorkerFailure(
  jobId: string,
  workspaceId: string,
  runId: string,
): void {
  try {
    const run = getPersistedMatrixGenerationRun(workspaceId, runId);
    if (!run) return;
    demoteReadyItemsWithoutSetAudit(workspaceId, runId);
    for (const item of listMatrixGenerationItems(workspaceId, runId)) {
      if (!TERMINAL_ITEM_STATUSES.has(item.status)) {
        transitionMatrixGenerationItem({
          workspaceId,
          itemId: item.id,
          expectedRevision: item.revision,
          nextStatus: 'failed',
          error: {
            code: 'matrix_generation_worker_failed',
            message: 'Generation stopped before this page completed.',
            retryable: true,
          },
        });
      }
    }
    const current = getPersistedMatrixGenerationRun(workspaceId, runId);
    if (!current) return;
    const items = listMatrixGenerationItems(workspaceId, runId);
    const status = current.status === 'queued' ? 'failed' : terminalStatus(items);
    const ended = TERMINAL_RUN_STATUSES.has(current.status)
      ? current
      : transitionMatrixGenerationRun({
          workspaceId,
          runId,
          expectedRevision: current.revision,
          nextStatus: status,
        });
    updateJob(jobId, {
      status: 'error',
      progress: items.length - ended.counts.queued - ended.counts.running,
      total: items.length,
      message: 'Matrix generation stopped with pages requiring attention',
      error: 'Matrix generation stopped unexpectedly',
      result: {
        runId: ended.id,
        counts: ended.counts,
        terminalStatus: ended.status,
      },
    });
    notifyMatrixGenerationUpdated(workspaceId, runId, ended.status);
  } catch (err) {
    log.error({ err, jobId, runId }, 'failed to record matrix generation worker failure');
  }
}

async function executeItem(
  workspaceId: string,
  runId: string,
  itemId: string,
  signal: AbortSignal,
  beforeBoundedProviderDispatch: (dispatch: BoundedProviderDispatch) => void,
): Promise<void> {
  if (signal.aborted) return;
  let item = listMatrixGenerationItems(workspaceId, runId).find(candidate => candidate.id === itemId);
  if (!item) return;
  try {
    if (item.status === 'queued') {
      const generated = await generateMatrixRunItem({
        workspaceId,
        runId,
        itemId,
        signal,
        beforeBoundedProviderDispatch,
      });
      item = generated.item;
    }
    if (item.status !== 'auditing_deterministic' || !item.postId) return;
    const post = getPost(workspaceId, item.postId);
    if (!post) throw new Error('Generated matrix post is missing before item audit');
    await auditMatrixGenerationItem({
      workspaceId,
      itemId: item.id,
      expectedItemRevision: item.revision,
      expectedPostRevision: post.generationRevision,
      signal,
      beforeBoundedProviderDispatch,
    });
  } catch (err) {
    log.warn({ err, runId, itemId }, 'matrix generation item ended without a ready result');
  }
}

function failedSetAuditReport(items: readonly MatrixGenerationItem[]): MatrixGenerationSetAuditReport {
  const affectedTargetIds = items.flatMap(item => (
    item.previewTarget?.blockManifest.blocks.slice(0, 1).map(block => `${item.id}:${block.id}`) ?? []
  ));
  const base = {
    source: 'model' as const,
    kind: 'provenance' as const,
    code: 'set_model_audit_failed',
    severity: 'error' as const,
    message: 'The required cross-page model audit did not produce an accepted result.',
    affectedItemIds: items.map(item => item.id),
    affectedTargetIds,
    requiresHumanReview: true,
  };
  return {
    verdict: 'needs_attention',
    findings: [{ id: `mgsf_${canonicalGenerationFingerprint(base)}`, ...base }],
    passCount: 1,
    modelProvenance: null,
    auditedAt: new Date().toISOString(),
  };
}

async function runSetAudit(
  workspaceId: string,
  runId: string,
  signal: AbortSignal,
  beforeBoundedProviderDispatch: (dispatch: BoundedProviderDispatch) => void,
): Promise<void> {
  let readyItems = listMatrixGenerationItems(workspaceId, runId)
    .filter(item => item.status === 'ready_for_human_review' && item.postId && item.previewTarget);
  if (readyItems.length === 0 || signal.aborted) return;
  const candidates = readyItems.flatMap(item => {
    const post = item.postId ? getPost(workspaceId, item.postId) : null;
    return post ? [{ item, post }] : [];
  });
  let result;
  try {
    result = await auditMatrixGenerationSet({
      workspaceId,
      candidates,
      passCount: 1,
      signal,
      beforeBoundedProviderDispatch,
    });
  } catch (err) {
    log.warn({ err, runId }, 'matrix generation set audit failed');
    const run = getPersistedMatrixGenerationRun(workspaceId, runId);
    if (!run) return;
    const report = failedSetAuditReport(readyItems);
    saveMatrixGenerationSetAuditReport({
      workspaceId,
      runId,
      expectedRunRevision: run.revision,
      report,
    });
    for (const item of readyItems) {
      const current = listMatrixGenerationItems(workspaceId, runId)
        .find(candidate => candidate.id === item.id);
      if (current?.status === 'ready_for_human_review') {
        transitionMatrixGenerationItem({
          workspaceId,
          itemId: current.id,
          expectedRevision: current.revision,
          nextStatus: 'needs_attention',
        });
      }
    }
    return;
  }

  const revisionIds = result.proseRevisionItemIds.filter(itemId => {
    const item = readyItems.find(candidate => candidate.id === itemId);
    return item?.automaticRevisionCount === 0;
  });
  let revisionApplied = false;
  for (const itemId of revisionIds) {
    if (signal.aborted) break;
    const item = listMatrixGenerationItems(workspaceId, runId).find(candidate => candidate.id === itemId);
    const post = item?.postId ? getPost(workspaceId, item.postId) : null;
    if (!item || !post || item.status !== 'ready_for_human_review') continue;
    const findings = result.report.findings.filter(finding => (
      finding.kind === 'prose' && finding.affectedItemIds.includes(itemId)
    ));
    const revised = await reviseMatrixGenerationItemForSetAudit({
      workspaceId,
      itemId,
      expectedItemRevision: item.revision,
      expectedPostRevision: post.generationRevision,
      findings,
      signal,
      beforeBoundedProviderDispatch,
    });
    revisionApplied ||= revised.automaticRevisionApplied;
  }
  if (revisionApplied && !signal.aborted) {
    readyItems = listMatrixGenerationItems(workspaceId, runId)
      .filter(item => item.status === 'ready_for_human_review' && item.postId && item.previewTarget);
    const revisedCandidates = readyItems.flatMap(item => {
      const post = item.postId ? getPost(workspaceId, item.postId) : null;
      return post ? [{ item, post }] : [];
    });
    result = await auditMatrixGenerationSet({
      workspaceId,
      candidates: revisedCandidates,
      passCount: 2,
      signal,
      beforeBoundedProviderDispatch,
    });
  }
  const run = getPersistedMatrixGenerationRun(workspaceId, runId);
  if (!run) return;
  saveMatrixGenerationSetAuditReport({
    workspaceId,
    runId,
    expectedRunRevision: run.revision,
    report: result.report,
  });
  if (result.report.verdict === 'passed') return;
  const affected = new Set(result.report.findings.flatMap(finding => finding.affectedItemIds));
  for (const item of listMatrixGenerationItems(workspaceId, runId)) {
    if (item.status === 'ready_for_human_review' && affected.has(item.id)) {
      transitionMatrixGenerationItem({
        workspaceId,
        itemId: item.id,
        expectedRevision: item.revision,
        nextStatus: 'needs_attention',
      });
    }
  }
}

export async function runMatrixGenerationJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job?.workspaceId || job.type !== 'content-matrix-generation') return;
  await runResourceScopedJobWorker(jobId, async signal => {
    const retryCommand = getMatrixGenerationRetryCommandByJob(job.workspaceId!, jobId);
    let run = retryCommand
      ? getPersistedMatrixGenerationRun(job.workspaceId!, retryCommand.runId)
      : getPersistedMatrixGenerationRunByJob(job.workspaceId!, jobId);
    if (!run) throw new Error('Matrix generation run was not found for its job');
    try {
      if (signal.aborted) {
        cancelQueuedItems(run.workspaceId, run.id);
      }
      if (run.status !== 'running') {
        run = transitionMatrixGenerationRun({
          workspaceId: run.workspaceId,
          runId: run.id,
          expectedRevision: run.revision,
          nextStatus: signal.aborted ? 'cancelled' : 'running',
        });
      }
      updateJob(jobId, {
        status: signal.aborted ? 'cancelled' : 'running',
        progress: 0,
        total: retryCommand?.request.items.length ?? run.selections.length,
        message: signal.aborted ? 'Matrix generation cancelled' : 'Generating grounded matrix pages...',
      });
      if (!signal.aborted) {
        const beforeBoundedProviderDispatch = (dispatch: BoundedProviderDispatch): void => {
          reserveMatrixGenerationBudget({
            workspaceId: run!.workspaceId,
            runId: run!.id,
            reservation: matrixGenerationProviderReservation(dispatch),
          });
        };
        const selectedIds = retryCommand?.request.items.map(item => item.itemId)
          ?? listMatrixGenerationItems(run.workspaceId, run.id)
            .filter(item => item.status === 'queued' || item.status === 'auditing_deterministic')
            .map(item => item.id);
        let completed = 0;
        await mapBounded(selectedIds, run.acceptedBudget?.limits.maxConcurrency ?? 1, async itemId => {
          await executeItem(
            run!.workspaceId,
            run!.id,
            itemId,
            signal,
            beforeBoundedProviderDispatch,
          );
          completed += 1;
          updateJob(jobId, {
            progress: completed,
            total: selectedIds.length,
            message: `Processed ${completed}/${selectedIds.length} matrix pages...`,
          });
        });
        if (signal.aborted) cancelQueuedItems(run.workspaceId, run.id);
        else await runSetAudit(
          run.workspaceId,
          run.id,
          signal,
          beforeBoundedProviderDispatch,
        );
      }
      demoteReadyItemsWithoutSetAudit(run.workspaceId, run.id);
      const current = getPersistedMatrixGenerationRun(run.workspaceId, run.id);
      if (!current) throw new Error('Matrix generation run disappeared before completion');
      const items = listMatrixGenerationItems(current.workspaceId, current.id);
      const status = signal.aborted ? 'cancelled' : terminalStatus(items);
      const ended = current.status === status
        ? current
        : transitionMatrixGenerationRun({
            workspaceId: current.workspaceId,
            runId: current.id,
            expectedRevision: current.revision,
            nextStatus: status,
          });
      const result = {
        runId: ended.id,
        counts: ended.counts,
        terminalStatus: ended.status,
      };
      updateJob(jobId, {
        status: status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'error' : 'done',
        progress: items.length,
        total: items.length,
        message: status === 'completed'
          ? 'Matrix pages are ready for human review'
          : 'Matrix generation finished with items requiring attention',
        result,
        ...(status === 'failed' ? { error: 'All selected matrix pages failed' } : {}),
      });
      notifyMatrixGenerationUpdated(current.workspaceId, current.id, ended.status);
    } catch (err) {
      recordUnexpectedWorkerFailure(jobId, run.workspaceId, run.id);
      throw err;
    }
  });
}

export function queueMatrixGenerationJob(jobId: string): void {
  void runMatrixGenerationJob(jobId).catch(err => {
    log.error({ err, jobId }, 'queued matrix generation job rejected');
  });
}
