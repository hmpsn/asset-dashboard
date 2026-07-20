import {
  finishMatrixGenerationAttempt,
  getPersistedMatrixGenerationRun,
  listMatrixGenerationAttempts,
  listMatrixGenerationItems,
  listRecoverableMatrixGenerationRuns,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from './repository.js';
import {
  isItemBlockingMatrixGenerationSetAuditFinding,
  isMatrixGenerationSetAuditRequired,
} from './set-audit.js';
import { matrixGenerationTerminalStatus } from './worker.js';

const TERMINAL_ITEM_STATUSES = new Set([
  'ready_for_human_review',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
  'cancelled',
  'failed',
]);

function restartInterruptedError(message: string, stage?: string) {
  return {
    code: 'matrix_generation_restart_interrupted' as const,
    message,
    retryable: true,
    ...(stage ? { stage } : {}),
  };
}

/** Reconciles interrupted paid work to explicit, retryable item outcomes; never repeats a paid call. */
export function reconcileMatrixGenerationRunsAfterRestart(): number {
  let reconciled = 0;
  for (const run of listRecoverableMatrixGenerationRuns()) {
    for (const item of listMatrixGenerationItems(run.workspaceId, run.id)) {
      if (TERMINAL_ITEM_STATUSES.has(item.status)) continue;
      const runningAttempt = listMatrixGenerationAttempts(run.workspaceId, item.id)
        .find(attempt => attempt.status === 'running');
      if (runningAttempt) {
        finishMatrixGenerationAttempt({
          workspaceId: run.workspaceId,
          itemId: item.id,
          attemptId: runningAttempt.id,
          nextStatus: 'failed',
          error: restartInterruptedError(
            'The server restarted before this generation stage completed.',
            runningAttempt.stage,
          ),
        });
      }
      const current = listMatrixGenerationItems(run.workspaceId, run.id)
        .find(candidate => candidate.id === item.id);
      if (!current || TERMINAL_ITEM_STATUSES.has(current.status)) continue;
      transitionMatrixGenerationItem({
        workspaceId: run.workspaceId,
        itemId: current.id,
        expectedRevision: current.revision,
        nextStatus: 'failed',
        error: restartInterruptedError(
          'The server restarted before this page completed. Retry the selected item explicitly.',
        ),
      });
    }
    const items = listMatrixGenerationItems(run.workspaceId, run.id);
    const currentRun = getPersistedMatrixGenerationRun(run.workspaceId, run.id);
    if (!currentRun) continue;
    if (isMatrixGenerationSetAuditRequired(currentRun.selections.length)) {
      for (const item of items) {
        const unresolvedSetFinding = currentRun.setAuditReport?.findings.some(
          finding => isItemBlockingMatrixGenerationSetAuditFinding(finding)
            && finding.affectedItemIds.includes(item.id),
        ) ?? true;
        if (item.status !== 'ready_for_human_review' || !unresolvedSetFinding) continue;
        transitionMatrixGenerationItem({
          workspaceId: run.workspaceId,
          itemId: item.id,
          expectedRevision: item.revision,
          nextStatus: 'needs_attention',
          error: {
            code: 'matrix_generation_set_audit_incomplete',
            message: 'The server restarted before the required cross-page review completed.',
            retryable: true,
          },
        });
      }
    }
    const reconciledItems = listMatrixGenerationItems(run.workspaceId, run.id);
    transitionMatrixGenerationRun({
      workspaceId: currentRun.workspaceId,
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      nextStatus: matrixGenerationTerminalStatus(reconciledItems),
    });
    reconciled += 1;
  }
  return reconciled;
}
