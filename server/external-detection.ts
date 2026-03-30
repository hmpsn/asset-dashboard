// server/external-detection.ts
// Detects when recommendations were implemented externally (not through the platform).

import { createLogger } from './logger.js';
import { getNotActedOnActions, updateAttribution, updateActionContext } from './outcome-tracking.js';
import { fetchGscSnapshot } from './outcome-measurement.js';
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
 * Detect external execution by comparing current GSC metrics to the stored baseline.
 * Returns true if the action's primary metric improved beyond a detection threshold,
 * suggesting the recommendation was implemented outside the platform.
 *
 * Only fires for actions with a pageUrl and a real GSC baseline (impressions captured).
 * Actions with no GSC connection or no baseline fall back to false.
 */
async function checkExternalExecution(action: TrackedAction): Promise<boolean> {
  if (!action.pageUrl) return false;

  // Only check actions that have a real GSC baseline — ones with only captured_at
  // have no comparison point and would produce false positives
  const hasBaseline = (
    action.baselineSnapshot.position !== undefined ||
    action.baselineSnapshot.clicks !== undefined
  );
  if (!hasBaseline) return false;

  const current = await fetchGscSnapshot(action.workspaceId, action.pageUrl, 14);
  if (!current) return false;

  const basePos = action.baselineSnapshot.position;
  const curPos = current.position;
  const baseClicks = action.baselineSnapshot.clicks ?? 0;
  const curClicks = current.clicks ?? 0;

  // Position improved by 3+ places (lower is better)
  if (basePos !== undefined && curPos !== undefined && (basePos - curPos) >= 3) return true;

  // Clicks improved by 20%+ with at least 5 absolute clicks
  if (baseClicks > 0 && curClicks >= baseClicks * 1.2 && (curClicks - baseClicks) >= 5) return true;

  return false;
}
