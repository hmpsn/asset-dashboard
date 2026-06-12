/**
 * content-brief-regenerate-job — W6.2
 *
 * Moves the two synchronous brief AI operations onto the background job platform:
 *   - regenerate       (full brief regeneration with feedback — gpt-5.4, 7000 tokens, research mode)
 *   - regenerate-outline (outline-only regeneration — gpt-5.4, 4000 tokens)
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
import { createJob, updateJob, hasActiveJob } from './jobs.js';
import { createLogger } from './logger.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { ContentBrief } from '../shared/types/content.js';

const log = createLogger('content-brief-regenerate-job');

export interface BriefRegenerateJobParams {
  mode: 'regenerate';
  workspaceId: string;
  briefId: string;
  feedback: string;
}

export interface BriefOutlineJobParams {
  mode: 'outline';
  workspaceId: string;
  briefId: string;
  feedback?: string;
}

export type ContentBriefRegenerateJobParams = BriefRegenerateJobParams | BriefOutlineJobParams;

export interface StartedContentBriefRegenerateJob {
  jobId: string;
}

function notifyContentUpdated(workspaceId: string, payload: Record<string, unknown>) {
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-briefs', ...payload });
}

async function runRegenerate(params: BriefRegenerateJobParams): Promise<ContentBrief> {
  const { workspaceId, briefId, feedback } = params;
  const existing = getBrief(workspaceId, briefId);
  if (!existing) throw new Error('Brief not found');
  const newBrief = await regenerateBrief(workspaceId, existing, feedback);
  addActivity(
    workspaceId,
    'brief_generated',
    `Regenerated content brief for "${existing.targetKeyword}"`,
    `New brief: ${newBrief.suggestedTitle}`,
    { briefId: newBrief.id, previousBriefId: existing.id, action: 'brief_regenerated' },
  );
  notifyContentUpdated(workspaceId, {
    briefId: newBrief.id,
    previousBriefId: existing.id,
    action: 'brief_regenerated',
  });
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEF_UPDATED, {
    briefId: newBrief.id,
    previousBriefId: existing.id,
    action: 'brief_regenerated',
  });
  log.info(`REGENERATED brief ${briefId} -> ${newBrief.id} for "${existing.targetKeyword}"`);
  return newBrief;
}

async function runOutline(params: BriefOutlineJobParams): Promise<ContentBrief> {
  const { workspaceId, briefId, feedback } = params;
  const result = await regenerateOutline(workspaceId, briefId, feedback);
  if (!result) throw new Error('Brief not found');
  addActivity(
    workspaceId,
    'content_updated',
    `Regenerated outline for "${result.suggestedTitle || result.targetKeyword}"`,
    undefined,
    { briefId: result.id, action: 'brief_outline_regenerated' },
  );
  notifyContentUpdated(workspaceId, { briefId: result.id, action: 'brief_outline_regenerated' });
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEF_UPDATED, {
    briefId: result.id,
    action: 'brief_outline_regenerated',
  });
  log.info(`REGENERATED OUTLINE for brief ${briefId} in workspace ${workspaceId}`);
  return result;
}

export async function runContentBriefRegenerateJob(
  jobId: string,
  params: ContentBriefRegenerateJobParams,
): Promise<void> {
  try {
    updateJob(jobId, {
      status: 'running',
      progress: 0,
      total: 1,
      message: params.mode === 'outline' ? 'Regenerating outline...' : 'Regenerating brief...',
    });
    const brief = params.mode === 'outline'
      ? await runOutline(params)
      : await runRegenerate(params);
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
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: params.mode === 'outline' ? 'Outline regeneration failed' : 'Brief regeneration failed',
    });
  }
}

export function startContentBriefRegenerateJob(
  params: ContentBriefRegenerateJobParams,
): StartedContentBriefRegenerateJob {
  const job = createJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE, {
    workspaceId: params.workspaceId,
    total: 1,
    message: params.mode === 'outline' ? 'Regenerating outline...' : 'Regenerating brief...',
  });
  setTimeout(() => {
    void runContentBriefRegenerateJob(job.id, params);
  }, 100);
  return { jobId: job.id };
}

export function hasActiveBriefRegenerateJob(workspaceId: string) {
  return hasActiveJob(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE, workspaceId);
}
