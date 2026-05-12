import { createJob, updateJob } from './jobs.js';
import { generateBrief } from './content-brief.js';
import { updateClientAction } from './client-actions.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { sanitizeQueryForPrompt } from './helpers.js';
import { createLogger } from './logger.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import type { ClientAction } from '../shared/types/client-actions.js';

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

async function executeContentDecayPlaybook(
  workspaceId: string,
  actionId: string,
  jobId: string,
  targetKeyword: string,
  payload: Record<string, unknown> | undefined,
): Promise<void> {
  updateJob(jobId, { status: 'running', progress: 10, message: 'Generating content brief...' });

  try {
    await generateBrief(workspaceId, targetKeyword, {
      pageType: 'BlogPosting',
      referenceUrls: payload?.pageUrl ? [payload.pageUrl as string] : undefined,
    });

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
