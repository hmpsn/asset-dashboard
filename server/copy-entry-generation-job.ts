/**
 * Copy Entry Generation Job
 *
 * Wraps generateCopyForEntry() in the background job platform.
 * Called via setImmediate from POST /api/copy/:wsId/:bpId/:entryId/generate.
 *
 * Pattern: identical to schema-generation-job.ts — see that file for rationale.
 */
import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { updateJob, unregisterAbort } from './jobs.js';
import { createLogger } from './logger.js';
import { broadcastToWorkspace } from './broadcast.js';
import { generateCopyForEntry } from './copy-generation.js';
import { getEntry } from './page-strategy.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('copy-entry-generation-job');

export interface RunCopyEntryGenerationJobOptions {
  jobId: string;
  workspaceId: string;
  blueprintId: string;
  entryId: string;
  accumulatedSteering?: string[];
}

export async function runCopyEntryGenerationJob({
  jobId,
  workspaceId,
  blueprintId,
  entryId,
  accumulatedSteering,
}: RunCopyEntryGenerationJobOptions): Promise<void> {
  try {
    const entry = getEntry(workspaceId, blueprintId, entryId);
    const entryLabel = entry?.name ?? entryId;
    updateJob(jobId, {
      status: 'running',
      message: `Generating copy for "${entryLabel}"...`,
    });

    const { sections, metadata } = await generateCopyForEntry(
      workspaceId,
      blueprintId,
      entryId,
      accumulatedSteering,
    );

    // Invalidate intelligence freshness so downstream assembly picks up new copy
    invalidateContentPipelineIntelligence(workspaceId);

    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
      entryId,
      sectionCount: sections.length,
    });
    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_METADATA_UPDATED, { entryId });

    updateJob(jobId, {
      status: 'done',
      result: { sections, metadata },
      message: `Copy generated for "${entryLabel}" — ${sections.length} sections`,
    });

    addActivity(
      workspaceId,
      'copy_generated',
      `Generated copy for "${entryLabel}"`,
    );
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId, entryId }, 'copy-entry-generation-job: programming error');
    } else {
      log.debug({ err, workspaceId, entryId }, 'copy-entry-generation-job: generation failed');
    }
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Copy generation failed',
    });
  } finally {
    unregisterAbort(jobId);
  }
}
