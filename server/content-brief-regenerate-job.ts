/**
 * content-brief-regenerate-job — W6.2
 *
 * Moves the two synchronous brief AI operations onto the background job platform:
 *   - regenerate       (full brief regeneration with feedback — synthesis-tier model, 7000 tokens, research mode)
 *   - regenerate-outline (outline-only regeneration — synthesis-tier model, 4000 tokens)
 *
 * Both previously held the HTTP connection open for 30–120s with no jobId and no
 * dedupe. The routes now create a CONTENT_BRIEF_REGENERATE job, return 202 { jobId },
 * and this worker performs the AI call + persistence.
 *
 * DECLARED CROSS-LANE CONTRACT (ContentBriefs.tsx is re-wired by a sibling lane):
 *   POST .../regenerate and POST .../outline return 202 { jobId: string };
 *   job completion persists the result to the content_briefs store and broadcasts
 *   BRIEF_UPDATED; failures surface via the job error state.
 *
 * The shared activity + CONTENT_UPDATED broadcast logic that the routes used to run
 * inline lives here so both the direct (none remaining) and background paths stay in
 * parity (background-generation.md §Job Start Contract #5).
 */
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { getBrief, regenerateBrief, regenerateOutline } from './content-brief.js';
import { invalidateContentPipelineIntelligence } from './intelligence-freshness.js';
import {
  createResourceScopedJob,
  getActiveJobForResource,
  getJob,
  runResourceScopedJobWorker,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES, JOB_RESOURCE_TYPES } from '../shared/types/background-jobs.js';
import type { ContentBrief } from '../shared/types/content.js';
import { GenerationRevisionConflictError } from './generation-provenance.js';

const log = createLogger('content-brief-regenerate-job');

export interface BriefRegenerateJobParams {
  mode: 'regenerate';
  workspaceId: string;
  briefId: string;
  feedback: string;
  /** Revision observed before the command was accepted. */
  expectedRevision?: number;
}

export interface BriefOutlineJobParams {
  mode: 'outline';
  workspaceId: string;
  briefId: string;
  feedback?: string;
  /** Revision observed before the command was accepted. */
  expectedRevision?: number;
}

export type ContentBriefRegenerateJobParams = BriefRegenerateJobParams | BriefOutlineJobParams;

export interface StartedContentBriefRegenerateJob {
  jobId: string;
}

function runBriefRegenerationPostCommitEffect(
  workspaceId: string,
  briefId: string,
  effect: string,
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn(
      { err, workspaceId, briefId, effect },
      'content brief regeneration post-commit effect failed',
    );
  }
}

function notifyContentUpdated(
  workspaceId: string,
  briefId: string,
  payload: Record<string, unknown>,
): void {
  runBriefRegenerationPostCommitEffect(workspaceId, briefId, 'intelligence-cache', () => {
    invalidateContentPipelineIntelligence(workspaceId);
  });
  runBriefRegenerationPostCommitEffect(workspaceId, briefId, 'content-updated-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, {
      domain: 'content-briefs',
      ...payload,
    });
  });
}

async function runRegenerate(
  params: BriefRegenerateJobParams,
  executionChainId: string,
  signal: AbortSignal,
): Promise<ContentBrief> {
  const { workspaceId, briefId, feedback } = params;
  const existing = getBrief(workspaceId, briefId);
  if (!existing) throw new Error('Brief not found');
  const newBrief = await regenerateBrief(workspaceId, existing, feedback, {
    expectedRevision: params.expectedRevision,
    executionChainId,
    signal,
  });
  return newBrief;
}

async function runOutline(
  params: BriefOutlineJobParams,
  executionChainId: string,
  signal: AbortSignal,
): Promise<ContentBrief> {
  const { workspaceId, briefId, feedback } = params;
  const result = await regenerateOutline(workspaceId, briefId, feedback, {
    expectedRevision: params.expectedRevision,
    executionChainId,
    signal,
  });
  if (!result) throw new Error('Brief not found');
  return result;
}

function emitRegenerationPostCommitEffects(
  params: ContentBriefRegenerateJobParams,
  brief: ContentBrief,
): void {
  const { workspaceId, briefId } = params;
  const action = params.mode === 'outline'
    ? 'brief_outline_regenerated'
    : 'brief_regenerated';

  runBriefRegenerationPostCommitEffect(workspaceId, brief.id, 'activity', () => {
    addActivity(
      workspaceId,
      params.mode === 'outline' ? 'content_updated' : 'brief_generated',
      params.mode === 'outline'
        ? `Regenerated outline for "${brief.suggestedTitle || brief.targetKeyword}"`
        : `Regenerated content brief for "${brief.targetKeyword}"`,
      params.mode === 'outline' ? undefined : `New brief: ${brief.suggestedTitle}`,
      params.mode === 'outline'
        ? { briefId: brief.id, action }
        : { briefId: brief.id, previousBriefId: briefId, action },
    );
  });
  notifyContentUpdated(workspaceId, brief.id, params.mode === 'outline'
    ? { briefId: brief.id, action }
    : { briefId: brief.id, previousBriefId: briefId, action });
  runBriefRegenerationPostCommitEffect(workspaceId, brief.id, 'brief-updated-broadcast', () => {
    broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEF_UPDATED, params.mode === 'outline'
      ? { briefId: brief.id, action }
      : { briefId: brief.id, previousBriefId: briefId, action });
  });

  if (params.mode === 'outline') {
    log.info(`REGENERATED OUTLINE for brief ${briefId} in workspace ${workspaceId}`);
  } else {
    log.info(`REGENERATED brief ${briefId} -> ${brief.id} for "${brief.targetKeyword}"`);
  }
}

export async function runContentBriefRegenerateJob(
  jobId: string,
  params: ContentBriefRegenerateJobParams,
): Promise<void> {
  await runResourceScopedJobWorker(jobId, async (signal) => {
    let brief: ContentBrief;
    try {
      updateJob(jobId, {
        status: 'running',
        progress: 0,
        total: 1,
        message: params.mode === 'outline' ? 'Regenerating outline...' : 'Regenerating brief...',
      });
      brief = params.mode === 'outline'
        ? await runOutline(params, jobId, signal)
        : await runRegenerate(params, jobId, signal);
    } catch (err) {
      updateJob(jobId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: params.mode === 'outline' ? 'Outline regeneration failed' : 'Brief regeneration failed',
      });
      return;
    }

    try {
      updateJob(jobId, {
        status: 'done',
        progress: 1,
        total: 1,
        result: { brief, briefId: brief.id, mode: params.mode },
        message: params.mode === 'outline'
          ? `Outline regenerated — ${brief.suggestedTitle || brief.targetKeyword}`
          : `Brief regenerated — ${brief.suggestedTitle || brief.targetKeyword}`,
      });
    } catch (err) {
      if (getJob(jobId)?.status === 'done') {
        log.warn(
          { err, jobId, briefId: brief.id },
          'content brief regeneration job success committed but its job event failed',
        );
      } else {
        const error = err instanceof Error ? err.message : String(err);
        try {
          updateJob(jobId, {
            status: 'error',
            error,
            message: 'Brief regeneration committed, but completion tracking failed',
            result: {
              briefId: brief.id,
              mode: params.mode,
              generationRevision: brief.generationRevision,
              code: 'completion_tracking_failed',
              artifactCommitted: true,
            },
          });
        } catch (fallbackErr) {
          log.error({ err: fallbackErr, jobId, briefId: brief.id }, 'Committed brief regeneration completion could not be recorded');
        }
        return;
      }
    }

    emitRegenerationPostCommitEffects(params, brief);
  });
}

export function startContentBriefRegenerateJob(
  params: ContentBriefRegenerateJobParams,
): StartedContentBriefRegenerateJob {
  const brief = getBrief(params.workspaceId, params.briefId);
  if (!brief) throw new Error('Brief not found');
  const expectedRevision = params.expectedRevision ?? brief.generationRevision;
  if (brief.generationRevision !== expectedRevision || brief.supersededBy) {
    throw new GenerationRevisionConflictError('content_brief', params.briefId, expectedRevision);
  }
  const { job, accepted } = createResourceScopedJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE, {
    workspaceId: params.workspaceId,
    resources: [{
      resourceType: JOB_RESOURCE_TYPES.CONTENT_BRIEF,
      resourceId: params.briefId,
    }],
    total: 1,
    message: params.mode === 'outline' ? 'Regenerating outline...' : 'Regenerating brief...',
    accept: () => {
      const current = getBrief(params.workspaceId, params.briefId);
      if (!current
        || current.generationRevision !== expectedRevision
        || current.supersededBy) {
        throw new GenerationRevisionConflictError(
          'content_brief',
          params.briefId,
          expectedRevision,
        );
      }
      return expectedRevision;
    },
  });
  const acceptedParams = { ...params, expectedRevision: accepted };
  setTimeout(() => {
    void runContentBriefRegenerateJob(job.id, acceptedParams).catch(err => {
      log.error({ err, jobId: job.id, workspaceId: params.workspaceId, briefId: params.briefId }, 'content brief regeneration worker rejected after launch');
    });
  }, 100);
  return { jobId: job.id };
}

export function hasActiveBriefRegenerateJob(workspaceId: string, briefId?: string) {
  if (!briefId) return undefined;
  return getActiveJobForResource(workspaceId, {
    resourceType: JOB_RESOURCE_TYPES.CONTENT_BRIEF,
    resourceId: briefId,
  });
}
