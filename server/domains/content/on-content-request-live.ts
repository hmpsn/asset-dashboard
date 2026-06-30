import type { ContentTopicRequest } from '../../../shared/types/content.js';
import { updatePageState } from '../../page-edit-states.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../../keyword-strategy-follow-ons.js';
import { createLogger } from '../../logger.js';

const log = createLogger('content:on-live');

/**
 * Side effects to run when a content request transitions to a "live-making"
 * status (delivered or published) and has a target page:
 *  1. Mark the target page live in the page-edit-state inventory.
 *  2. Enqueue the debounced post-update follow-ons (recs regen + llms.txt) —
 *     a new/updated live page changes the inventory the recommendation engine
 *     ranks on, exactly like content-publish.ts and the keyword-strategy paths.
 *
 * Shared by the admin content-requests route AND the MCP `advance_content_status`
 * tool so both paths stay in lockstep — neither can silently skip the page-state
 * update or the follow-on enqueue. The follow-on enqueue is guarded in its own
 * try/catch so a follow-on failure can never abort the caller's request update.
 *
 * No-op when the request has no target page.
 */
export function onContentRequestLive(
  workspaceId: string,
  request: Pick<ContentTopicRequest, 'id' | 'targetPageId'>,
): void {
  if (!request.targetPageId) return;
  updatePageState(workspaceId, request.targetPageId, {
    status: 'live',
    source: 'content-delivery',
    contentRequestId: request.id,
  });
  try {
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId }); // rec-refresh-ok
  } catch (err) {
    log.warn({ err, workspaceId }, 'Failed to enqueue follow-ons after content went live');
  }
}
