/**
 * Client-dashboard invalidation coverage for the known WS leak set
 * (2026-06-09 and 2026-06-11 audits, data-flow mediums).
 *
 * These events were handled only in admin scope or not mapped in the client-dashboard
 * scope at all, which left the client portal stale until refocus. Keep this suite
 * focused on the exact leak events we have fixed here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation.js';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';
import { queryKeys } from '../../src/lib/queryKeys.js';

const WS = 'ws_test';

function keysFor(event: string, data?: unknown) {
  return getWorkspaceInvalidationKeys(event as never, WS, data, 'client-dashboard');
}

describe('clientDashboardInvalidationKeys leak coverage', () => {
  it('refreshes the monthly digest for every mutation that changes its inputs', () => {
    for (const event of [
      WS_EVENTS.INSIGHT_RESOLVED,
      WS_EVENTS.APPROVAL_UPDATE,
      WS_EVENTS.APPROVAL_APPLIED,
      WS_EVENTS.WORK_ORDER_UPDATE,
      WS_EVENTS.OUTCOME_SCORED,
      WS_EVENTS.OUTCOME_LEARNINGS_UPDATED,
      WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED,
      WS_EVENTS.OUTCOME_EXTERNAL_DETECTED,
      WS_EVENTS.CLIENT_ACTION_UPDATE,
      WS_EVENTS.RECOMMENDATIONS_UPDATED,
      WS_EVENTS.WORKSPACE_UPDATED,
      WS_EVENTS.VOICE_PROFILE_UPDATED,
    ]) {
      expect(keysFor(event)).toContainEqual(queryKeys.client.monthlyDigest(WS));
    }
  });

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

  it('BRIEF_UPDATED invalidates content requests, content plan, unified inbox, and intelligence', () => {
    const keys = keysFor(WS_EVENTS.BRIEF_UPDATED);
    expect(keys).toEqual([
      queryKeys.client.contentRequests(WS),
      queryKeys.client.contentPlan(WS),
      queryKeys.client.unifiedInbox(WS),
      queryKeys.client.intelligence(WS),
    ]);
  });

  it('CONTENT_REQUEST_UPDATE refreshes linked post authority and review surfaces', () => {
    const keys = keysFor(WS_EVENTS.CONTENT_REQUEST_UPDATE);

    expect(keys).toEqual([
      queryKeys.client.contentRequests(WS),
      queryKeys.client.contentPlan(WS),
      queryKeys.client.unifiedInbox(WS),
      queryKeys.client.postPreviewAll(WS),
      queryKeys.client.intelligence(WS),
    ]);
  });

  it('OUTCOME_ACTION_RECORDED invalidates client outcome summary and intelligence', () => {
    const keys = keysFor(WS_EVENTS.OUTCOME_ACTION_RECORDED);
    expect(keys).toEqual([
      queryKeys.client.outcomeSummary(WS),
      queryKeys.client.intelligence(WS),
    ]);
  });

  it('CLIENT_ACTION_UPDATE refreshes its action, intelligence, and digest consumers', () => {
    expect(keysFor(WS_EVENTS.CLIENT_ACTION_UPDATE)).toEqual([
      queryKeys.client.clientActions(WS),
      queryKeys.client.intelligence(WS),
      queryKeys.client.monthlyDigest(WS),
    ]);
  });

  it('OUTCOME_PLAYBOOK_DISCOVERED invalidates intelligence and its digest consumer', () => {
    const keys = keysFor(WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED);
    expect(keys).toEqual([
      queryKeys.client.intelligence(WS),
      queryKeys.client.monthlyDigest(WS),
    ]);
  });

  it('refreshes client intelligence after Google connection and voice-profile changes', () => {
    const googleConnectionKeys = keysFor(WS_EVENTS.WORKSPACE_UPDATED, {
      googleConnectionChanged: true,
    });
    expect(googleConnectionKeys).toContainEqual(queryKeys.client.intelligence(WS));
    expect(keysFor(WS_EVENTS.WORKSPACE_UPDATED)).not.toContainEqual(
      queryKeys.client.intelligence(WS),
    );

    expect(keysFor(WS_EVENTS.VOICE_PROFILE_UPDATED)).toEqual([
      queryKeys.client.intelligence(WS),
      queryKeys.client.monthlyDigest(WS),
      queryKeys.client.brandSummary(WS),
    ]);
    expect(keysFor(WS_EVENTS.BRAND_IDENTITY_UPDATED)).toEqual([
      queryKeys.client.brandSummary(WS),
    ]);
  });

  it('WORK_ORDER_COMMENT invalidates the dashboard-level inbox and thread comment keys', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.WORK_ORDER_COMMENT,
      WS,
      { id: 'order-7' },
      'client-dashboard',
    );

    expect(keys).toEqual([
      queryKeys.client.workOrderComments(WS, 'order-7'),
      queryKeys.client.unifiedInbox(WS),
    ]);
  });

  it('ClientDashboard subscribes exactly once to every client-dashboard invalidation event', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ClientDashboard.tsx'), 'utf8'); // readFile-ok: contract guard for ClientDashboard workspace-event subscription wiring
    const subscribedEvents = Array.from(
      source.matchAll(/\[WS_EVENTS\.([A-Z0-9_]+)\]\s*:/g),
      match => match[1],
    );
    const mappedEvents = Object.entries(WS_EVENTS)
      .filter(([, event]) => keysFor(event).length > 0)
      .map(([eventName]) => eventName);

    expect(subscribedEvents).toHaveLength(new Set(subscribedEvents).size);
    expect(subscribedEvents.sort()).toEqual(mappedEvents.sort());
  });
});
