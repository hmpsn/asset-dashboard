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
import {
  finalizeJobResourceClaims,
  getJob,
  updateJob,
  unregisterAbort,
} from './jobs.js';
import { createLogger } from './logger.js';
import { broadcastToWorkspace } from './broadcast.js';
import { generateCopyForEntry } from './copy-generation.js';
import { getEntry } from './page-strategy.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('copy-entry-generation-job');

function runCopyEntryPostCommitEffect(
  workspaceId: string,
  entryId: string,
  effect: string,
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn(
      { err, workspaceId, entryId, effect },
      'copy entry generation post-commit effect failed',
    );
  }
}

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
    let entryLabel = entryId;
    let generated: Awaited<ReturnType<typeof generateCopyForEntry>>;
    try {
      const entry = getEntry(workspaceId, blueprintId, entryId);
      entryLabel = entry?.name ?? entryId;
      updateJob(jobId, {
        status: 'running',
        message: `Generating copy for "${entryLabel}"...`,
      });

      // generateCopyForEntry returns only after commitGeneratedEntryCopy has
      // durably committed the required sections + metadata artifact.
      generated = await generateCopyForEntry(
        workspaceId,
        blueprintId,
        entryId,
        accumulatedSteering,
        { executionChainId: jobId },
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
      return;
    }

    const { sections, metadata } = generated;

    // The required artifact is committed. Record terminal success before any
    // optional cache, notification, or activity effect. Tolerate only an error
    // raised after updateJob has already committed `done`.
    try {
      updateJob(jobId, {
        status: 'done',
        result: { sections, metadata },
        message: `Copy generated for "${entryLabel}" — ${sections.length} sections`,
      });
    } catch (err) {
      if (getJob(jobId)?.status !== 'done') {
        if (isProgrammingError(err)) {
          log.warn({ err, workspaceId, entryId }, 'copy-entry-generation-job: completion tracking failed');
        } else {
          log.debug({ err, workspaceId, entryId }, 'copy-entry-generation-job: completion tracking failed');
        }
        try {
          updateJob(jobId, {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            message: 'Copy generated, but completion tracking failed',
            result: {
              entryId,
              sectionCount: sections.length,
              metadataId: metadata?.id,
              code: 'completion_tracking_failed',
              artifactCommitted: true,
            },
          });
        } catch (fallbackErr) {
          log.error(
            { err: fallbackErr, jobId, workspaceId, entryId, artifactCommitted: true },
            'copy-entry-generation-job: committed artifact terminal writes failed',
          );
        }
        return;
      }
      log.warn(
        { err, jobId, workspaceId, entryId },
        'copy entry generation success committed but its job event failed',
      );
    }

    runCopyEntryPostCommitEffect(workspaceId, entryId, 'intelligence-cache', () => {
      invalidateContentPipelineIntelligence(workspaceId);
    });
    runCopyEntryPostCommitEffect(workspaceId, entryId, 'copy-section-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
        entryId,
        sectionCount: sections.length,
      });
    });
    runCopyEntryPostCommitEffect(workspaceId, entryId, 'copy-metadata-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_METADATA_UPDATED, { entryId });
    });
    runCopyEntryPostCommitEffect(workspaceId, entryId, 'activity', () => {
      addActivity(
        workspaceId,
        'copy_generated',
        `Generated copy for "${entryLabel}"`,
      );
    });
  } finally {
    try {
      unregisterAbort(jobId);
    } finally {
      // The worker has fully drained. Terminal job writes normally release the
      // claim, but this idempotent safety net also covers a failed terminal
      // write followed by a failed fallback error write. Releasing the claim
      // does not reclassify a copy artifact that already committed.
      finalizeJobResourceClaims(jobId);
    }
  }
}
