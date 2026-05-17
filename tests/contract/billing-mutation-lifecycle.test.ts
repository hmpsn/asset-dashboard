import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
    const adminInvalidation = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for admin cache invalidation
    const clientDashboard = readFileSync('src/components/ClientDashboard.tsx', 'utf-8'); // readFile-ok — source contract for client cache refresh

    expect(adminInvalidation).toContain('[WS_EVENTS.WORKSPACE_UPDATED]: () => {');
    expect(adminInvalidation).toContain('queryKeys.admin.workspaceHome(workspaceId)');
    expect(adminInvalidation).toContain('queryKeys.admin.workspaceDetail(workspaceId)');
    expect(adminInvalidation).toContain('queryKeys.admin.workspaceOverview()');

    expect(clientDashboard).toContain("'workspace:updated': () => {");
    expect(clientDashboard).toContain(`/api/public/workspace/\${workspaceId}`);
    expect(clientDashboard).toContain("refetchClient('pricing', '')");
  });

  it('content subscription broadcasts invalidate the client subscription reader', () => {
    const queryKeys = readFileSync('src/lib/queryKeys.ts', 'utf-8'); // readFile-ok — source contract for billing query keys
    const clientDashboard = readFileSync('src/components/ClientDashboard.tsx', 'utf-8'); // readFile-ok — source contract for client cache refresh
    const plansTab = readFileSync('src/components/client/PlansTab.tsx', 'utf-8'); // readFile-ok — source contract for client subscription reader

    expect(queryKeys).toContain("contentSubscription: (wsId: string) => ['client-content-subscription', wsId]");
    expect(plansTab).toContain('queryKeys.client.contentSubscription(workspaceId)');
    expect(clientDashboard).toContain("[WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED]: () => refetchClient('content-subscription', '')");
    expect(clientDashboard).toContain("[WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED]: () => refetchClient('content-subscription', '')");
    expect(clientDashboard).toContain("[WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED]: () => refetchClient('content-subscription', '')");
  });
});
