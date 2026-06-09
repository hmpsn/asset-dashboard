import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const root = resolve(import.meta.dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf-8'); // readFile-ok — source wiring contract for mutation event invalidation.
}

describe('mutation lifecycle invalidation contracts', () => {
  it('approval updates refresh admin and client approval read models', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.APPROVAL_UPDATE, 'ws-1', undefined, 'admin');
    const source = readProjectFile('src/hooks/useWsInvalidation.ts');

    expect(source).toContain('[WS_EVENTS.APPROVAL_UPDATE]: () => invalidateRegistry(WS_EVENTS.APPROVAL_UPDATE)');
    expect(keys).toContainEqual(queryKeys.client.approvals('ws-1'));
    expect(keys).toContainEqual(queryKeys.admin.approvals('ws-1'));
    expect(keys).toContainEqual(queryKeys.admin.workspaceHome('ws-1'));
  });

  it('work-order updates refresh admin workspace home and client work-order read models', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.WORK_ORDER_UPDATE, 'ws-1', undefined, 'admin');

    expect(keys).toContainEqual(queryKeys.admin.workspaceHome('ws-1'));
    expect(keys).toContainEqual(queryKeys.client.workOrders('ws-1'));
  });

  it('client action updates refresh client/admin action read models and intelligence surfaces', () => {
    const adminKeys = getWorkspaceInvalidationKeys(WS_EVENTS.CLIENT_ACTION_UPDATE, 'ws-1', undefined, 'admin');
    const clientKeys = getWorkspaceInvalidationKeys(WS_EVENTS.CLIENT_ACTION_UPDATE, 'ws-1', undefined, 'client-dashboard');
    const clientDashboardSource = readProjectFile('src/components/ClientDashboard.tsx');

    expect(adminKeys).toContainEqual(queryKeys.client.clientActions('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.clientActions('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.workspaceHome('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.intelligence('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.intelligenceAll('ws-1'));
    expect(clientDashboardSource).toContain('[WS_EVENTS.CLIENT_ACTION_UPDATE]: () => invalidateClientEvent(WS_EVENTS.CLIENT_ACTION_UPDATE)');
    expect(clientKeys).toEqual([queryKeys.client.clientActions('ws-1')]);
  });

  it('content updates refresh content read paths and client-facing intelligence', () => {
    const adminKeys = getWorkspaceInvalidationKeys(WS_EVENTS.CONTENT_UPDATED, 'ws-1', undefined, 'admin');
    const clientDashboardSource = readProjectFile('src/components/ClientDashboard.tsx');

    expect(adminKeys).toContainEqual(queryKeys.admin.briefs('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.posts('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.contentPipeline('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.workspaceHome('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.admin.intelligenceAll('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.client.contentRequests('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.client.contentPlan('ws-1'));
    expect(adminKeys).toContainEqual(queryKeys.client.intelligence('ws-1'));

    const clientKeys = getWorkspaceInvalidationKeys(WS_EVENTS.CONTENT_UPDATED, 'ws-1', undefined, 'client-dashboard');
    expect(clientDashboardSource).toContain('[WS_EVENTS.CONTENT_UPDATED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_UPDATED)');
    expect(clientKeys).toContainEqual(queryKeys.client.contentRequests('ws-1'));
    expect(clientKeys).toContainEqual(queryKeys.client.contentPlan('ws-1'));
    expect(clientKeys).toContainEqual(queryKeys.client.intelligence('ws-1'));
  });

  it('treats missing WORK_ORDER_UPDATE invalidation wiring as an invalid regression', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.WORK_ORDER_UPDATE, 'ws-1', undefined, 'admin');

    expect(keys).toContainEqual(queryKeys.admin.workspaceHome('ws-1'));
    expect(keys).toContainEqual(queryKeys.client.workOrders('ws-1'));
    expect(keys).not.toContainEqual(queryKeys.client.contentRequests('ws-1'));
  });
});
