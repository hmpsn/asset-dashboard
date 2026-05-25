import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf-8'); // readFile-ok — source contract test for mutation event invalidation wiring.
}

function eventBlock(source: string, eventKey: string): string {
  const marker = `[WS_EVENTS.${eventKey}]`;
  const start = source.indexOf(marker);
  expect(start, `${marker} handler missing`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n    [WS_EVENTS.', start + marker.length);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('mutation lifecycle invalidation contracts', () => {
  it('approval updates refresh admin and client approval read models', () => {
    const source = readProjectFile('src/hooks/useWsInvalidation.ts');
    const block = eventBlock(source, 'APPROVAL_UPDATE');

    expect(block).toContain('queryKeys.client.approvals(workspaceId)');
    expect(block).toContain('queryKeys.admin.approvals(workspaceId)');
    expect(block).toContain('queryKeys.admin.workspaceHome(workspaceId)');
  });

  it('work-order updates refresh admin workspace home and client work-order read models', () => {
    const invalidationSource = readProjectFile('src/hooks/useWsInvalidation.ts');
    const workOrderBlock = eventBlock(invalidationSource, 'WORK_ORDER_UPDATE');

    expect(workOrderBlock).toContain('queryKeys.admin.workspaceHome(workspaceId)');
    expect(workOrderBlock).toContain('queryKeys.client.workOrders(workspaceId)');

    const queryKeysSource = readProjectFile('src/lib/queryKeys.ts');
    expect(queryKeysSource).toContain("workOrders: (wsId: string) => ['client-work-orders', wsId] as const");

    const clientDashboardSource = readProjectFile('src/components/ClientDashboard.tsx');
    expect(clientDashboardSource).toContain('[WS_EVENTS.WORK_ORDER_UPDATE]');
    expect(clientDashboardSource).toContain("refetchClient('workOrders'");

    const orderStatusSource = readProjectFile('src/components/client/OrderStatus.tsx');
    expect(orderStatusSource).toContain('queryKeys.client.workOrders(workspaceId)');
  });

  it('client action updates refresh client/admin action read models and intelligence surfaces', () => {
    const invalidationSource = readProjectFile('src/hooks/useWsInvalidation.ts');
    const clientActionBlock = eventBlock(invalidationSource, 'CLIENT_ACTION_UPDATE');

    expect(clientActionBlock).toContain('queryKeys.client.clientActions(workspaceId)');
    expect(clientActionBlock).toContain('queryKeys.admin.clientActions(workspaceId)');
    expect(clientActionBlock).toContain('queryKeys.admin.workspaceHome(workspaceId)');
    expect(clientActionBlock).toContain('queryKeys.admin.intelligence(workspaceId)');
    expect(clientActionBlock).toContain('queryKeys.admin.intelligenceAll(workspaceId)');

    const clientDashboardSource = readProjectFile('src/components/ClientDashboard.tsx');
    expect(clientDashboardSource).toContain("'client-action:update'");
    expect(clientDashboardSource).toContain("refetchClient('clientActions'");
  });

  it('content updates refresh content read paths and client-facing intelligence', () => {
    const invalidationSource = readProjectFile('src/hooks/useWsInvalidation.ts');
    const contentBlock = eventBlock(invalidationSource, 'CONTENT_UPDATED');

    expect(contentBlock).toContain('queryKeys.admin.briefs(workspaceId)');
    expect(contentBlock).toContain('queryKeys.admin.posts(workspaceId)');
    expect(contentBlock).toContain('queryKeys.admin.contentPipeline(workspaceId)');
    expect(contentBlock).toContain('queryKeys.admin.workspaceHome(workspaceId)');
    expect(contentBlock).toContain('queryKeys.admin.intelligenceAll(workspaceId)');
    expect(contentBlock).toContain('queryKeys.client.contentRequests(workspaceId)');
    expect(contentBlock).toContain('queryKeys.client.contentPlan(workspaceId)');
    expect(contentBlock).toContain('queryKeys.client.intelligence(workspaceId)');

    const clientDashboardSource = readProjectFile('src/components/ClientDashboard.tsx');
    expect(clientDashboardSource).toContain('[WS_EVENTS.CONTENT_UPDATED]');
    expect(clientDashboardSource).toContain("refetchClient('content'");
    expect(clientDashboardSource).toContain("refetchClient('content-plan'");
    expect(clientDashboardSource).toContain("refetchClient('intelligence'");
  });

  it('treats missing WORK_ORDER_UPDATE invalidation wiring as an invalid regression', () => {
    const invalidationSource = readProjectFile('src/hooks/useWsInvalidation.ts');
    const workOrderBlock = eventBlock(invalidationSource, 'WORK_ORDER_UPDATE');

    expect(workOrderBlock).toContain('queryKeys.admin.workspaceHome(workspaceId)');
    expect(workOrderBlock).toContain('queryKeys.client.workOrders(workspaceId)');
    expect(workOrderBlock).not.toContain('queryKeys.client.contentRequests(workspaceId)');
  });
});
