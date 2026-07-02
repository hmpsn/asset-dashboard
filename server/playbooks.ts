import { createJob, updateJob } from './jobs.js';
import { generateBrief } from './content-brief.js';
import { updateClientAction } from './client-actions.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { sanitizeQueryForPrompt } from './utils/text.js';
import { createLogger } from './logger.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { ClientAction } from '../shared/types/client-actions.js';
import { applyClientActionFeedbackLoop } from './domains/inbox/client-action-feedback-loop.js';
import { getActionByWorkspaceAndSource, recordAction } from './outcome-tracking.js';
import type { ContentBrief } from './content-brief.js';

const log = createLogger('playbooks');

/**
 * Enqueue the appropriate implementation playbook for an approved client action.
 * No-op for action types that have no automated playbook — those surface in the
 * admin UI as "Awaiting implementation" and are completed manually.
 */
export function enqueuePlaybook(workspaceId: string, action: ClientAction): void {
  switch (action.sourceType) {
    case 'content_decay':
      enqueueContentDecayPlaybook(workspaceId, action);
      break;
    // aeo_change, internal_link, redirect_proposal:
    // No automated playbook. Admin implements manually and marks complete via UI.
    default:
      break;
  }
}

function enqueueContentDecayPlaybook(workspaceId: string, action: ClientAction): void {
  const payload = action.payload as Record<string, unknown> | undefined;
  const rawKeyword = (payload?.targetKeyword as string) || action.title.replace(/^Refresh:\s*/i, '').trim();
  const targetKeyword = sanitizeQueryForPrompt(rawKeyword);

  if (!targetKeyword) {
    log.warn({ workspaceId, actionId: action.id }, 'content_decay playbook skipped — targetKeyword is empty');
    return;
  }

  const job = createJob(BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE, {
    message: `Generating content brief for "${targetKeyword}"...`,
    workspaceId,
  });

  // Fire-and-forget — runs async, updates job status on completion or error.
  void executeContentDecayPlaybook(workspaceId, action.id, job.id, targetKeyword, payload)
    .catch(err => {
      log.error({ err, jobId: job.id, actionId: action.id }, 'content_decay playbook failed');
      updateJob(job.id, { status: 'error', error: String(err), message: 'Brief generation failed' });
    });
}

/**
 * Reconcile R8-PR1 (Task B13) — attribution seam for the playbook's brief-creation half.
 * `applyClientActionFeedbackLoop` (called below on completion) already stamps attribution
 * for the CLIENT ACTION lifecycle (sourceType: 'client_action'); this records the BRIEF
 * ITSELF as a tracked action (sourceType: 'brief'), mirroring the two other brief_created
 * producers (server/content-brief-generation-job.ts). Idempotent via
 * getActionByWorkspaceAndSource so a retried/duplicate call never double-records. Guarded
 * so a tracking failure can never abort the playbook — mirrors recordSchemaOutcomeAction
 * in server/domains/schema/publish-schema-to-live.ts.
 */
function recordPlaybookBriefOutcomeAction(workspaceId: string, brief: ContentBrief): void {
  try {
    if (getActionByWorkspaceAndSource(workspaceId, 'brief', brief.id)) return;
    recordAction({ // recordAction-ok: only reached after generateBrief succeeds, workspaceId is caller-validated
      workspaceId,
      actionType: 'brief_created',
      sourceType: 'brief',
      sourceId: brief.id,
      pageUrl: null,
      targetKeyword: brief.targetKeyword,
      baselineSnapshot: {
        captured_at: new Date().toISOString(),
      },
      attribution: 'platform_executed',
      // R6 (B11): the brief's suggested title is its identity — snapshot it so the win
      // title survives brief edits/regeneration. Guarded on a real title (FM-2).
      ...(brief.suggestedTitle?.trim()
        ? { source: { label: brief.suggestedTitle.trim(), snapshot: { title: brief.suggestedTitle.trim(), type: 'brief' } } }
        : {}),
    });
  } catch (err) {
    log.warn({ err, workspaceId, briefId: brief.id }, 'Failed to record outcome action for playbook brief creation');
  }
}

async function executeContentDecayPlaybook(
  workspaceId: string,
  actionId: string,
  jobId: string,
  targetKeyword: string,
  payload: Record<string, unknown> | undefined,
): Promise<void> {
  updateJob(jobId, { status: 'running', progress: 10, message: 'Generating content brief...' });

  try {
    const brief = await generateBrief(workspaceId, targetKeyword, {
      pageType: 'BlogPosting',
      referenceUrls: payload?.pageUrl ? [payload.pageUrl as string] : undefined,
    });

    // R8-PR1 (B13): record the brief-creation outcome the moment the external write
    // (generateBrief, which persists the brief row) succeeds — never before. A failed
    // generateBrief call throws above and this line is never reached, so no action is
    // recorded for a failed playbook run.
    recordPlaybookBriefOutcomeAction(workspaceId, brief);

    broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-briefs', workspaceId });
    updateJob(jobId, { status: 'done', progress: 100, message: 'Content brief created' });

    // Transition the action to completed now that the brief exists.
    const completedAction = updateClientAction(workspaceId, actionId, { status: 'completed' });
    if (completedAction) {
      addActivity(workspaceId, 'client_action_completed',
        `Completed client action: ${completedAction.title}`,
        completedAction.summary,
        { actionId: completedAction.id, sourceType: completedAction.sourceType },
      );
      applyClientActionFeedbackLoop(workspaceId, completedAction, 'completed');
    }
    broadcastToWorkspace(workspaceId, WS_EVENTS.CLIENT_ACTION_UPDATE, { actionId, action: 'completed' });
    invalidateIntelligenceCache(workspaceId);

    log.info({ workspaceId, actionId, jobId }, 'content_decay playbook completed');
  } catch (err) {
    updateJob(jobId, { status: 'error', error: String(err), message: 'Brief generation failed' });
    log.error({ err, workspaceId, actionId, jobId }, 'content_decay playbook error');
    throw err; // allow outer .catch() to serve as the final safety net
  }
}
