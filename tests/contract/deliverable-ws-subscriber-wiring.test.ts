import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

describe('deliverable websocket subscriber wiring', () => {
  it('central admin invalidation hook covers DELIVERABLE events for the workspace deliverables reader', () => {
    const source = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for always-mounted admin subscriber wiring
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.DELIVERABLE_UPDATED, 'ws-deliverables', undefined, 'admin');

    expect(source).toContain('[WS_EVENTS.DELIVERABLE_SENT]: () => invalidateRegistry(WS_EVENTS.DELIVERABLE_SENT)');
    expect(source).toContain('[WS_EVENTS.DELIVERABLE_UPDATED]: () => invalidateRegistry(WS_EVENTS.DELIVERABLE_UPDATED)');
    expect(keys).toEqual([queryKeys.admin.workspaceDeliverables('ws-deliverables')]);
  });

  it('ClientDashboard keeps unified inbox cache fresh even when the inbox tab is not mounted', () => {
    const source = readFileSync('src/components/ClientDashboard.tsx', 'utf-8'); // readFile-ok — source contract for always-mounted client subscriber wiring
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.DELIVERABLE_SENT,
      'ws-deliverables',
      undefined,
      'client-dashboard',
    );

    expect(source).toContain('[WS_EVENTS.DELIVERABLE_SENT]: () => invalidateClientEvent(WS_EVENTS.DELIVERABLE_SENT)');
    expect(source).toContain('[WS_EVENTS.DELIVERABLE_UPDATED]: () => invalidateClientEvent(WS_EVENTS.DELIVERABLE_UPDATED)');
    expect(keys).toEqual([queryKeys.client.unifiedInbox('ws-deliverables')]);
  });

  it('mounted deliverables surfaces keep their local subscribers for live in-view updates', () => {
    const unifiedInbox = readFileSync('src/components/client/inbox/UnifiedInbox.tsx', 'utf-8'); // readFile-ok — source contract for mounted client inbox subscriber
    const adminPane = readFileSync('src/components/admin/ClientDeliverablesPane.tsx', 'utf-8'); // readFile-ok — source contract for mounted admin pane subscriber

    expect(unifiedInbox).toContain('[WS_EVENTS.DELIVERABLE_SENT]: () => invalidateInbox(WS_EVENTS.DELIVERABLE_SENT)');
    expect(unifiedInbox).toContain('[WS_EVENTS.DELIVERABLE_UPDATED]: () => invalidateInbox(WS_EVENTS.DELIVERABLE_UPDATED)');
    expect(adminPane).toContain('[WS_EVENTS.DELIVERABLE_SENT]: () =>');
    expect(adminPane).toContain('[WS_EVENTS.DELIVERABLE_UPDATED]: () =>');
    expect(adminPane).toContain("'admin-deliverables'");
  });
});
