import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS, type WsEventName } from '../../src/lib/wsEvents';

const workspaceId = 'ws-cockpit';
const workspaceHomeKey = queryKeys.admin.workspaceHome(workspaceId);

const workspaceHomeEvents: Array<{ event: WsEventName; payload?: unknown; label?: string }> = [
  { event: WS_EVENTS.APPROVAL_UPDATE },
  { event: WS_EVENTS.APPROVAL_APPLIED },
  { event: WS_EVENTS.REQUEST_CREATED },
  { event: WS_EVENTS.REQUEST_UPDATE },
  { event: WS_EVENTS.CONTENT_REQUEST_CREATED },
  { event: WS_EVENTS.CONTENT_REQUEST_UPDATE },
  { event: WS_EVENTS.BRIEF_UPDATED },
  { event: WS_EVENTS.CONTENT_UPDATED },
  { event: WS_EVENTS.ACTIVITY_NEW },
  { event: WS_EVENTS.AUDIT_COMPLETE },
  { event: WS_EVENTS.WORKSPACE_UPDATED },
  { event: WS_EVENTS.PAGE_STATE_UPDATED },
  { event: WS_EVENTS.CONTENT_PUBLISHED },
  { event: WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED },
  { event: WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED },
  { event: WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED },
  { event: WS_EVENTS.COPY_SECTION_UPDATED },
  { event: WS_EVENTS.SUGGESTED_BRIEF_UPDATED },
  { event: WS_EVENTS.CLIENT_ACTION_UPDATE },
  { event: WS_EVENTS.COPY_BATCH_COMPLETE },
  { event: WS_EVENTS.RECOMMENDATIONS_UPDATED },
  { event: WS_EVENTS.RANK_TRACKING_UPDATED },
  { event: WS_EVENTS.EEAT_ASSETS_UPDATED },
  { event: WS_EVENTS.POST_UPDATED, payload: { postId: 'post-1' }, label: 'POST_UPDATED with postId' },
  { event: WS_EVENTS.POST_UPDATED, payload: {}, label: 'POST_UPDATED without postId' },
  { event: WS_EVENTS.WORK_ORDER_UPDATE },
];

describe('Cockpit workspace-home invalidation coverage', () => {
  it.each(workspaceHomeEvents)('$label $event invalidates the admin workspace-home aggregate', ({ event, payload }) => {
    const keys = getWorkspaceInvalidationKeys(event, workspaceId, payload, 'admin');

    expect(keys).toContainEqual(workspaceHomeKey);
  });
});
