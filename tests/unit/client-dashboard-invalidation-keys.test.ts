/**
 * Client-dashboard invalidation coverage for INSIGHT_RESOLVED + CONTENT_PUBLISHED
 * (2026-06-09 audit, data-flow mediums).
 *
 * Both events were handled ONLY in the admin scope (which even listed client keys —
 * dead in a client session): an admin resolving an insight or manually publishing a
 * post left the client portal stale until refocus. The client-dashboard scope must
 * map both events to the real client keys.
 */
import { describe, expect, it } from 'vitest';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation.js';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';
import { queryKeys } from '../../src/lib/queryKeys.js';

const WS = 'ws_test';

function keysFor(event: string) {
  return getWorkspaceInvalidationKeys(event as never, WS, undefined, 'client-dashboard');
}

describe('clientDashboardInvalidationKeys — INSIGHT_RESOLVED / CONTENT_PUBLISHED', () => {
  it('INSIGHT_RESOLVED invalidates the client insight keys', () => {
    const keys = keysFor(WS_EVENTS.INSIGHT_RESOLVED);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContainEqual(queryKeys.client.clientInsights(WS));
  });

  it('CONTENT_PUBLISHED invalidates content plan, ROI, post previews, and activity', () => {
    const keys = keysFor(WS_EVENTS.CONTENT_PUBLISHED);
    expect(keys).toContainEqual(queryKeys.client.contentPlan(WS));
    expect(keys).toContainEqual(queryKeys.client.roi(WS));
    expect(keys).toContainEqual(queryKeys.client.postPreviewAll(WS));
    expect(keys).toContainEqual(queryKeys.client.activity(WS));
  });

});
