import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createClientUser, deleteClientUser } from '../../server/client-users.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';

const ctx = createTestContext(13225);
const { api } = ctx;

let workspaceId = '';
let disabledWorkspaceId = '';
let clientUserId = '';
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  await ctx.startServer();

  const primary = seedWorkspace({ tier: 'growth', clientPassword: '' });
  workspaceId = primary.workspaceId;
  cleanups.push(primary.cleanup);

  const disabled = seedWorkspace({ tier: 'free', clientPassword: '' });
  disabledWorkspaceId = disabled.workspaceId;
  cleanups.push(disabled.cleanup);

  updateWorkspace(workspaceId, {
    webflowToken: 'super-secret-webflow-token',
    stripeCustomerId: 'cus_contract_test_secret',
    stripeSubscriptionId: 'sub_contract_test_secret',
    brandVoice: 'Internal brand voice that must stay server-side',
    knowledgeBase: 'Internal KB that must stay server-side',
    brandLogoUrl: 'https://cdn.test/logo.svg',
    brandAccentColor: '#14b8a6',
    billingMode: 'platform',
    clientPortalEnabled: true,
    seoClientView: true,
    analyticsClientView: true,
    siteIntelligenceClientView: true,
  });

  updateWorkspace(disabledWorkspaceId, {
    clientPortalEnabled: false,
  });

  const clientUser = await createClientUser(
    'workspace-contract-client@test.local',
    'ClientPass1!',
    'Workspace Contract Client',
    workspaceId,
    'client_member',
  );
  clientUserId = clientUser.id;

  upsertInsight({
    workspaceId,
    pageId: 'page-strategy-alignment-contract',
    insightType: 'strategy_alignment',
    data: { note: 'Admin-only type should never appear in public intelligence output' },
    severity: 'warning',
    pageTitle: 'Contract Test Strategy Alignment',
  });
}, 30_000);

afterAll(async () => {
  if (clientUserId) {
    deleteClientUser(clientUserId, workspaceId);
  }
  for (const cleanup of cleanups) {
    cleanup();
  }
  await ctx.stopServer();
});

function collectKeysDeep(input: unknown, out: Set<string>): void {
  if (!input || typeof input !== 'object') return;
  if (Array.isArray(input)) {
    for (const item of input) {
      collectKeysDeep(item, out);
    }
    return;
  }
  for (const [key, value] of Object.entries(input)) {
    out.add(key);
    collectKeysDeep(value, out);
  }
}

describe('GET /api/public/workspace/:id contract', () => {
  it('returns required client-safe fields and omits admin/sensitive fields', async () => {
    const res = await api(`/api/public/workspace/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.id).toBe(workspaceId);
    expect(typeof body.name).toBe('string');
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('baseTier');
    expect(typeof body.requiresPassword).toBe('boolean');
    expect(typeof body.hasClientUsers).toBe('boolean');
    expect(body).toHaveProperty('clientPortalEnabled');
    expect(body).toHaveProperty('seoClientView');
    expect(body).toHaveProperty('analyticsClientView');
    expect(body).toHaveProperty('siteIntelligenceClientView');
    expect(body).toHaveProperty('brandLogoUrl');
    expect(body).toHaveProperty('brandAccentColor');
    expect(body).toHaveProperty('billingMode');
    expect(body).toHaveProperty('bookingUrl');

    expect(body).not.toHaveProperty('webflowToken');
    expect(body).not.toHaveProperty('clientPassword');
    expect(body).not.toHaveProperty('stripeCustomerId');
    expect(body).not.toHaveProperty('stripeSubscriptionId');
    expect(body).not.toHaveProperty('brandVoice');
    expect(body).not.toHaveProperty('knowledgeBase');
  });

  it('returns 403 when client portal is disabled', async () => {
    const res = await api(`/api/public/workspace/${disabledWorkspaceId}`);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Client portal is disabled for this workspace' });
  });

  it('returns 404 for missing workspace', async () => {
    const res = await api('/api/public/workspace/ws_contract_missing');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});

describe('GET /api/public/intelligence/:workspaceId contract', () => {
  it('returns stable shape and excludes admin-only or sensitive fields', async () => {
    const res = await api(`/api/public/intelligence/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.workspaceId).toBe(workspaceId);
    expect(typeof body.assembledAt).toBe('string');
    expect(['free', 'growth', 'premium']).toContain(body.tier);
    expect(body).toHaveProperty('insightsSummary');
    expect(body).toHaveProperty('pipelineStatus');

    const keys = new Set<string>();
    collectKeysDeep(body, keys);
    expect(keys.has('knowledgeBase')).toBe(false);
    expect(keys.has('brandVoice')).toBe(false);
    expect(keys.has('operational')).toBe(false);
    expect(keys.has('churnRisk')).toBe(false);
    expect(keys.has('impact_score')).toBe(false);
    expect(keys.has('bridgeSource')).toBe(false);

    const insightsSummary = body.insightsSummary as { topInsights?: Array<{ type?: string }> } | null;
    const topInsights = insightsSummary?.topInsights ?? [];
    const insightTypes = topInsights.map(item => item.type);
    expect(insightTypes).not.toContain('strategy_alignment');
  });

  it('returns 404 for missing workspace', async () => {
    const res = await api('/api/public/intelligence/ws_contract_missing');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});
