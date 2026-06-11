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

function keysFor(event: string) {
  return getWorkspaceInvalidationKeys(event as never, WS, undefined, 'client-dashboard');
}

describe('clientDashboardInvalidationKeys leak coverage', () => {
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

  it('OUTCOME_ACTION_RECORDED invalidates client outcome summary and intelligence', () => {
    const keys = keysFor(WS_EVENTS.OUTCOME_ACTION_RECORDED);
    expect(keys).toEqual([
      queryKeys.client.outcomeSummary(WS),
      queryKeys.client.intelligence(WS),
    ]);
  });

  it('OUTCOME_PLAYBOOK_DISCOVERED invalidates only client intelligence', () => {
    const keys = keysFor(WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED);
    expect(keys).toEqual([queryKeys.client.intelligence(WS)]);
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

  it('ClientDashboard subscribes to the leak events it maps', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ClientDashboard.tsx'), 'utf8'); // readFile-ok: contract guard for ClientDashboard workspace-event subscription wiring

    for (const eventName of [
      'BRIEF_UPDATED',
      'WORK_ORDER_COMMENT',
      'OUTCOME_ACTION_RECORDED',
      'OUTCOME_PLAYBOOK_DISCOVERED',
    ]) {
      expect(source).toContain(`[WS_EVENTS.${eventName}]`);
    }
  });
});
