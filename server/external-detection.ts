// server/external-detection.ts
// Detects when recommendations were implemented externally (not through the platform).

import { createLogger } from './logger.js';
import { getNotActedOnActions, updateAttribution, updateActionContext } from './outcome-tracking.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import type { TrackedAction, ActionContext } from '../shared/types/outcome-tracking.js';

const log = createLogger('external-detection');

export async function detectExternalExecutions(): Promise<{ detected: number; checked: number }> {
  const notActedOn = getNotActedOnActions();
  let detected = 0;

  for (const action of notActedOn) {
    try {
      const isExecuted = await checkExternalExecution(action);
      if (isExecuted) {
        // Require 2 consecutive positive checks before committing attribution
        const checks = action.context.detectionChecks ?? 0;
        if (checks >= 1) {
          updateAttribution(action.id, 'externally_executed');
          broadcastToWorkspace(action.workspaceId, WS_EVENTS.OUTCOME_EXTERNAL_DETECTED, { actionId: action.id });
          detected++;
          log.info({ actionId: action.id, actionType: action.actionType }, 'External execution detected');
        } else {
          const ctx: ActionContext = {
            ...action.context,
            detectionChecks: checks + 1,
          };
          updateActionContext(action.id, ctx);
        }
      } else if ((action.context.detectionChecks ?? 0) > 0) {
        // Reset counter — checks must be consecutive
        updateActionContext(action.id, { ...action.context, detectionChecks: 0 });
      }
    } catch (err) {
      log.warn({ err, actionId: action.id }, 'Error checking external execution');
    }
  }

  return { detected, checked: notActedOn.length };
}

/**
 * Stub detection — checks based on action type.
 *
 * TODO: Wire to actual page content checks (fetch page, compare schema, meta tags, etc.)
 * For now returns false — detection will be wired when page fetching is available.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function checkExternalExecution(_action: TrackedAction): Promise<boolean> {
  return false;
}
