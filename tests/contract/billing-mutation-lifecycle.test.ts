import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

describe('billing mutation lifecycle contracts', () => {
  it('content subscription broadcasts are declared as WS_EVENTS constants on both sides', () => {
    const serverEvents = readFileSync('server/ws-events.ts', 'utf-8'); // readFile-ok — source contract for billing event constants
    const clientEvents = readFileSync('src/lib/wsEvents.ts', 'utf-8'); // readFile-ok — source contract for billing event constants mirror

    for (const src of [serverEvents, clientEvents]) {
      expect(src).toContain("CONTENT_SUBSCRIPTION_CREATED: 'content-subscription:created'");
      expect(src).toContain("CONTENT_SUBSCRIPTION_UPDATED: 'content-subscription:updated'");
      expect(src).toContain("CONTENT_SUBSCRIPTION_RENEWED: 'content-subscription:renewed'");
    }
  });

  it('Stripe billing mutations broadcast through WS_EVENTS constants', () => {
    const stripeSrc = readFileSync('server/stripe.ts', 'utf-8'); // readFile-ok — source contract for Stripe mutation broadcasts

    expect(stripeSrc).toContain('WS_EVENTS.WORKSPACE_UPDATED');
    expect(stripeSrc).toContain('WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED');
    expect(stripeSrc).toContain('WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED');
    expect(stripeSrc).toContain('WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED');
    expect(stripeSrc).not.toContain("_broadcastFn?.(workspaceId, 'content-subscription:");
  });

  it('workspace tier broadcasts invalidate admin and client billing readers', () => {
    const clientDashboard = readFileSync('src/components/ClientDashboard.tsx', 'utf-8'); // readFile-ok — source contract for client cache refresh
    const adminInvalidation = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for admin cache wiring
    const adminKeys = getWorkspaceInvalidationKeys(WS_EVENTS.WORKSPACE_UPDATED, 'ws-billing', undefined, 'admin');
    const clientKeys = getWorkspaceInvalidationKeys(WS_EVENTS.WORKSPACE_UPDATED, 'ws-billing', undefined, 'client-dashboard');

    expect(adminInvalidation).toContain('[WS_EVENTS.WORKSPACE_UPDATED]: () => invalidateRegistry(WS_EVENTS.WORKSPACE_UPDATED)');
    expect(adminKeys).toContainEqual(queryKeys.admin.workspaceHome('ws-billing'));
    expect(adminKeys).toContainEqual(queryKeys.admin.workspaceDetail('ws-billing'));
    expect(adminKeys).toContainEqual(queryKeys.admin.workspaceOverview());

    expect(clientDashboard).toContain('[WS_EVENTS.WORKSPACE_UPDATED]: () => {');
    expect(clientDashboard).toContain(`/api/public/workspace/\${workspaceId}`);
    expect(clientDashboard).toContain('invalidateClientEvent(WS_EVENTS.WORKSPACE_UPDATED)');
    expect(clientKeys).toEqual([queryKeys.client.pricing('ws-billing')]);
  });

  it('content subscription broadcasts invalidate the client subscription reader', () => {
    const queryKeysSource = readFileSync('src/lib/queryKeys.ts', 'utf-8'); // readFile-ok — source contract for billing query keys
    const clientDashboard = readFileSync('src/components/ClientDashboard.tsx', 'utf-8'); // readFile-ok — source contract for client subscription subscriber
    const plansTab = readFileSync('src/components/client/PlansTab.tsx', 'utf-8'); // readFile-ok — source contract for client subscription reader
    const dashboardKeys = getWorkspaceInvalidationKeys(
      WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED,
      'ws-billing',
      undefined,
      'client-dashboard',
    );

    expect(queryKeysSource).toContain("contentSubscription: (wsId: string) => ['client-content-subscription', wsId]");
    expect(plansTab).toContain('queryKeys.client.contentSubscription(workspaceId)');
    expect(clientDashboard).toContain('[WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED)');
    expect(dashboardKeys).toEqual([queryKeys.client.contentSubscription('ws-billing')]);
  });

  it('rejects invalid literal billing broadcast regressions in stripe mutations', () => {
    const stripeSrc = readFileSync('server/stripe.ts', 'utf-8'); // readFile-ok — regression guard against string-literal broadcast drift

    expect(stripeSrc).not.toContain("broadcastToWorkspace(workspaceId, 'workspace:updated'");
    expect(stripeSrc).not.toContain("broadcastToWorkspace(workspaceId, 'content-subscription:created'");
    expect(stripeSrc).not.toContain("broadcastToWorkspace(workspaceId, 'content-subscription:updated'");
    expect(stripeSrc).not.toContain("broadcastToWorkspace(workspaceId, 'content-subscription:renewed'");
  });
});
