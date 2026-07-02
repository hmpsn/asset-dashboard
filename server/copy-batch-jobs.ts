import { randomUUID } from 'crypto';

import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import { createJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';
import { getBlueprint } from './page-strategy.js';
import { generateCopyForEntry } from './copy-generation.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { BatchJob } from '../shared/types/copy-pipeline.js';

const log = createLogger('copy-batch-jobs');

const batchStmts = createStmtCache(() => ({
  insertJob: db.prepare(
    `INSERT INTO copy_batch_jobs (id, workspace_id, blueprint_id, mode, entry_ids_json, batch_size, status, progress_json, accumulated_steering, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '[]', ?, ?)`,
  ),
  getSteering: db.prepare(
    `SELECT accumulated_steering FROM copy_batch_jobs WHERE id = ? AND workspace_id = ?`,
  ),
  updateProgress: db.prepare(
    `UPDATE copy_batch_jobs SET progress_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
  ),
  updateStatus: db.prepare(
    `UPDATE copy_batch_jobs SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`, // status-ok: documented exemption — copy_batch_jobs is a job-progress MIRROR of the real background job (guarded via updateJob → BACKGROUND_JOB_TRANSITIONS). It records running/complete/failed for the batch, with a catch-any→failed crash path; guarding the mirror would risk the crash path. See docs/rules/lifecycle-state-machines.md.
  ),
  getById: db.prepare(
    `SELECT * FROM copy_batch_jobs WHERE id = ? AND workspace_id = ?`,
  ),
}));

interface BatchJobRow {
  id: string;
  workspace_id: string;
  blueprint_id: string;
  mode: string;
  entry_ids_json: string;
  batch_size: number;
  status: string;
  progress_json: string;
  accumulated_steering: string;
  created_at: string;
  updated_at: string;
}

interface BatchProgressJson {
  total: number;
  generated: number;
  reviewed: number;
  approved: number;
}

export interface StartCopyBatchGenerationParams {
  workspaceId: string;
  blueprintId: string;
  entryIds: string[];
  mode?: string;
  batchSize?: number;
}

export interface StartedCopyBatchGenerationJob {
  jobId: string;
  batchId: string;
}

function notifyCopyPipelineUpdated(workspaceId: string): void {
  invalidateContentPipelineIntelligence(workspaceId);
}

export function rowToBatchJob(row: BatchJobRow): BatchJob {
  const entryIds = parseJsonFallback<string[]>(row.entry_ids_json, []);
  const progress = parseJsonFallback<BatchProgressJson>(row.progress_json, { total: 0, generated: 0, reviewed: 0, approved: 0 });
  const accumulatedSteering = parseJsonFallback<string[]>(row.accumulated_steering, []);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    blueprintId: row.blueprint_id,
    entryIds,
    status: row.status as BatchJob['status'],
    batchSize: row.batch_size,
    mode: row.mode as BatchJob['mode'],
    progress,
    accumulatedSteering,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getCopyBatchJob(workspaceId: string, batchId: string): BatchJob | null {
  const row = batchStmts().getById.get(batchId, workspaceId) as BatchJobRow | undefined;
  return row ? rowToBatchJob(row) : null;
}

export function createCopyBatchGenerationJob(params: StartCopyBatchGenerationParams): StartedCopyBatchGenerationJob {
  const { workspaceId, blueprintId, entryIds, mode, batchSize } = params;
  const blueprint = getBlueprint(workspaceId, blueprintId);
  if (!blueprint) {
    throw new Error('Blueprint not found');
  }

  const batchId = `bj_${randomUUID()}`;
  const now = new Date().toISOString();
  const resolvedMode = mode ?? 'review_inbox';
  const total = entryIds.length;
  const resolvedBatchSize = batchSize ?? total;
  const initialProgress = JSON.stringify({ total, generated: 0, reviewed: 0, approved: 0 });

  const job = createJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, {
    workspaceId,
    total,
    message: `Generating copy for ${total} page${total !== 1 ? 's' : ''}...`,
  });

  try {
    batchStmts().insertJob.run(batchId, workspaceId, blueprintId, resolvedMode, JSON.stringify(entryIds), resolvedBatchSize, initialProgress, now, now);
    notifyCopyPipelineUpdated(workspaceId);
  } catch (err) {
    updateJob(job.id, { status: 'error', error: 'Failed to create batch job record', message: 'Batch generation failed' });
    log.error({ err, workspaceId, blueprintId }, 'Failed to create batch job record');
    throw new Error('Failed to start batch job');
  }

  addActivity(
    workspaceId,
    'copy_batch_started',
    `Batch copy generation started (${total} pages)`,
  );

  broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_BATCH_PROGRESS, {
    batchId,
    total,
    generated: 0,
    failed: 0,
  });

  return { jobId: job.id, batchId };
}

export async function runCopyBatchGenerationJob(params: StartCopyBatchGenerationParams & { jobId: string; batchId: string }): Promise<void> {
  const { workspaceId, blueprintId, entryIds, jobId, batchId } = params;
  const total = entryIds.length;
  let generated = 0;
  let failed = 0;

  try {
    updateJob(jobId, { status: 'running', progress: 0, total, message: `Generating 0/${total} pages...` });

    const jobRow = batchStmts().getSteering.get(batchId, workspaceId) as { accumulated_steering: string } | undefined;
    const accumulatedSteering = parseJsonFallback<string[]>(
      jobRow?.accumulated_steering ?? '[]',
      [],
    );

    for (const entryId of entryIds) {
      try {
        await generateCopyForEntry(workspaceId, blueprintId, entryId, accumulatedSteering);
        generated++;
      } catch (err) {
        log.error({ err, workspaceId, blueprintId, entryId }, 'Batch entry generation failed');
        failed++;
      }

      const batchNow = new Date().toISOString();
      const progressJson = JSON.stringify({ total, generated, reviewed: 0, approved: 0 });
      // txn-ok: intentionally non-atomic — per-entry progress update is independent of final status update
      batchStmts().updateProgress.run(progressJson, batchNow, batchId, workspaceId);

      updateJob(jobId, {
        progress: generated + failed,
        total,
        message: `Generated ${generated}/${total} pages${failed > 0 ? `, ${failed} failed` : ''}`,
      });

      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_BATCH_PROGRESS, {
        batchId,
        total,
        generated,
        failed,
      });
    }

    const completedAt = new Date().toISOString();
    const finalStatus = failed === total ? 'failed' : 'complete';
    const jobStatus = finalStatus === 'failed' ? 'error' : 'done';

    batchStmts().updateStatus.run(finalStatus, completedAt, batchId, workspaceId);
    notifyCopyPipelineUpdated(workspaceId);

    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_BATCH_COMPLETE, {
      batchId,
      total,
      generated,
      failed,
      status: finalStatus,
    });

    addActivity(
      workspaceId,
      'copy_batch_complete',
      `Batch copy generation complete (${generated}/${total} pages)`,
    );

    updateJob(jobId, {
      status: jobStatus,
      progress: total,
      total,
      result: { batchId, total, generated, failed, status: finalStatus },
      message: jobStatus === 'done' ? `Batch complete — ${generated}/${total} pages` : 'Batch generation failed',
      error: jobStatus === 'error' ? 'All copy batch entries failed' : undefined,
    });
  } catch (err) {
    const completedAt = new Date().toISOString();
    batchStmts().updateStatus.run('failed', completedAt, batchId, workspaceId);
    updateJob(jobId, {
      status: 'error',
      progress: generated + failed,
      total,
      error: err instanceof Error ? err.message : String(err),
      message: 'Batch generation failed',
      result: { batchId, total, generated, failed, status: 'failed' },
    });
    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_BATCH_COMPLETE, {
      batchId,
      total,
      generated,
      failed,
      status: 'failed',
    });
  }
}
