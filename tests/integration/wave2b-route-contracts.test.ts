/**
 * Wave 2b focused route-contract tests.
 *
 * This file exercises the actual HTTP route boundaries for workspace access,
 * public workspace serialization, and billing/auth surfaces. It intentionally
 * does not mock Stripe business behavior; existing Stripe tests cover checkout
 * and webhook fulfillment. These tests pin the high-risk auth/serialization
 * contracts before later platform-health refactors.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signToken } from '../../server/auth.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import db from '../../server/db/index.js';
import { createPayment } from '../../server/payments.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13220);

let wsAId = '';
let wsBId = '';
let disabledWsId = '';
let trialWsId = '';
let adminUserId = '';
let adminToken = '';
let clientUserAId = '';
let clientUserBId = '';
let clientTokenA = '';
let clientTokenB = '';
let paymentAId = '';
let paymentBId = '';

function clientCookieHeader(workspaceId: string, token: string): string {
  return `client_user_token_${workspaceId}=${token}`;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function getJson(path: string, headers?: Record<string, string>): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await ctx.api(path, headers ? { headers } : undefined);
  const body = await res.json() as Record<string, unknown>;
  return { res, body };
}

beforeAll(async () => {
  await ctx.startServer();

  const wsA = createWorkspace('Wave2b Route Contracts A');
  const wsB = createWorkspace('Wave2b Route Contracts B');
  const disabledWs = createWorkspace('Wave2b Route Contracts Disabled');
  const trialWs = createWorkspace('Wave2b Route Contracts Trial');

  wsAId = wsA.id;
  wsBId = wsB.id;
  disabledWsId = disabledWs.id;
  trialWsId = trialWs.id;

  updateWorkspace(wsAId, {
    clientPassword: 'protected-client-portal',
    webflowSiteId: 'site_wave2b_a',
    webflowSiteName: 'Wave2b Site A',
    gscPropertyUrl: 'https://example.com/',
    ga4PropertyId: 'properties/123456',
    liveDomain: 'wave2b.example.com',
    eventConfig: [{ eventName: 'lead', displayName: 'Lead', pinned: true, group: 'growth' }],
    eventGroups: [{ id: 'growth', name: 'Growth', order: 1, color: '#14b8a6', allowedPages: ['/'] }],
    clientPortalEnabled: true,
    seoClientView: true,
    analyticsClientView: true,
    siteIntelligenceClientView: false,
    autoReports: true,
    brandLogoUrl: 'https://example.com/logo.png',
    brandAccentColor: '#14b8a6',
    contentPricing: { briefPrice: 125, fullPostPrice: 450, currency: 'USD' },
    billingMode: 'platform',
    tier: 'growth',
    onboardingEnabled: true,
    onboardingCompleted: false,
  });
  updateWorkspace(wsBId, { clientPassword: 'protected-other-portal', tier: 'free' });
  updateWorkspace(disabledWsId, { clientPortalEnabled: false });
  updateWorkspace(trialWsId, {
    tier: 'free',
    trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const admin = await createUser(
    'wave2b-admin@test.local',
    'AdminPass1!',
    'Wave2b Admin',
    'member',
    [wsAId],
  );
  adminUserId = admin.id;
  adminToken = signToken({ userId: admin.id, email: admin.email, role: admin.role });

  const clientA = await createClientUser(
    'wave2b-client-a@test.local',
    'ClientPass1!',
    'Wave2b Client A',
    wsAId,
    'client_member',
  );
  clientUserAId = clientA.id;
  clientTokenA = signClientToken(clientA);

  const clientB = await createClientUser(
    'wave2b-client-b@test.local',
    'ClientPass1!',
    'Wave2b Client B',
    wsBId,
    'client_member',
  );
  clientUserBId = clientB.id;
  clientTokenB = signClientToken(clientB);

  const paymentA = createPayment(wsAId, {
    workspaceId: wsAId,
    stripeSessionId: 'cs_wave2b_a',
    productType: 'brief_blog',
    amount: 12500,
    currency: 'usd',
    status: 'pending',
  });
  paymentAId = paymentA.id;

  const paymentB = createPayment(wsBId, {
    workspaceId: wsBId,
    stripeSessionId: 'cs_wave2b_b',
    productType: 'schema_page',
    amount: 3900,
    currency: 'usd',
    status: 'pending',
  });
  paymentBId = paymentB.id;
}, 30_000);

afterAll(async () => {
  db.prepare('DELETE FROM payments WHERE workspace_id IN (?, ?)').run(wsAId, wsBId);
  if (clientUserAId) deleteClientUser(clientUserAId, wsAId);
  if (clientUserBId) deleteClientUser(clientUserBId, wsBId);
  if (adminUserId) deleteUser(adminUserId);
  for (const workspaceId of [wsAId, wsBId, disabledWsId, trialWsId]) {
    if (workspaceId) deleteWorkspace(workspaceId);
  }
  await ctx.stopServer();
});

describe('workspace route access contracts', () => {
  it('allows a scoped internal JWT to read its assigned workspace', async () => {
    const { res, body } = await getJson(`/api/workspaces/${wsAId}`, authHeaders(adminToken));

    expect(res.status).toBe(200);
    expect(body.id).toBe(wsAId);
    expect(body.webflowToken).toBeUndefined();
    expect(body.clientPassword).toBeUndefined();
  });

  it('rejects a scoped internal JWT on a different workspace', async () => {
    const { res, body } = await getJson(`/api/workspaces/${wsBId}`, authHeaders(adminToken));

    expect(res.status).toBe(403);
    expect(String(body.error)).toContain('access');
  });

  it('keeps the HMAC/no-JWT admin path pass-through for workspace routes', async () => {
    const { res, body } = await getJson(`/api/workspaces/${wsAId}`, { 'x-auth-token': 'already-validated-upstream' });

    expect(res.status).toBe(200);
    expect(body.id).toBe(wsAId);
  });

  it('does not allow a workspace A admin route to mutate a workspace B client user by id', async () => {
    const res = await ctx.api(`/api/workspaces/${wsAId}/client-users/${clientUserBId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminToken),
      },
      body: JSON.stringify({ name: 'Cross Workspace Rename Attempt' }),
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body.error).toBe('Client user not found');
  });
});

describe('public workspace serialization contracts', () => {
  it('returns only client-safe public workspace fields', async () => {
    const { res, body } = await getJson(`/api/public/workspace/${wsAId}`);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: wsAId,
      name: 'Wave2b Route Contracts A',
      webflowSiteId: 'site_wave2b_a',
      webflowSiteName: 'Wave2b Site A',
      gscPropertyUrl: 'https://example.com/',
      ga4PropertyId: 'properties/123456',
      liveDomain: 'wave2b.example.com',
      requiresPassword: true,
      clientPortalEnabled: true,
      seoClientView: true,
      analyticsClientView: true,
      siteIntelligenceClientView: false,
      autoReports: true,
      brandLogoUrl: 'https://example.com/logo.png',
      brandAccentColor: '#14b8a6',
      contentPricing: { briefPrice: 125, fullPostPrice: 450, currency: 'USD' },
      tier: 'growth',
      baseTier: 'growth',
      isTrial: false,
      billingMode: 'platform',
      onboardingEnabled: true,
      onboardingCompleted: false,
      hasClientUsers: true,
      bookingUrl: null,
    });
    expect(body.eventConfig).toEqual([{ eventName: 'lead', displayName: 'Lead', pinned: true, group: 'growth' }]);
    expect(body.eventGroups).toEqual([{ id: 'growth', name: 'Growth', order: 1, color: '#14b8a6', allowedPages: ['/'] }]);
    expect(typeof body.stripeEnabled).toBe('boolean');
    expect(typeof body.trialDaysRemaining).toBe('number');
    expect(body.trialEndsAt === null || typeof body.trialEndsAt === 'string').toBe(true);

    for (const forbidden of [
      'webflowToken',
      'clientPassword',
      'stripeCustomerId',
      'stripeSubscriptionId',
      'secretKey',
      'webhookSecret',
      'publishableKey',
      'authToken',
      'token',
      'clientSession',
    ]) {
      expect(body[forbidden], `${forbidden} must not be exposed`).toBeUndefined();
    }
  });

  it('returns 403 when the client portal is disabled', async () => {
    const { res, body } = await getJson(`/api/public/workspace/${disabledWsId}`);

    expect(res.status).toBe(403);
    expect(body.error).toBe('Client portal is disabled for this workspace');
  });

  it('returns 404 for a missing workspace', async () => {
    const { res, body } = await getJson('/api/public/workspace/ws_wave2b_missing');

    expect(res.status).toBe(404);
    expect(body.error).toBe('Workspace not found');
  });

  it('resolves an active free-tier trial to growth while preserving baseTier', async () => {
    const { res, body } = await getJson(`/api/public/workspace/${trialWsId}`);

    expect(res.status).toBe(200);
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(true);
    expect(Number(body.trialDaysRemaining)).toBeGreaterThan(0);
    expect(typeof body.trialEndsAt).toBe('string');
  });
});

describe('billing route auth and workspace contracts', () => {
  const publicBillingCases = [
    { method: 'POST', label: '/api/public/billing-portal/:workspaceId', path: () => `/api/public/billing-portal/${wsAId}`, body: {} },
    { method: 'POST', label: '/api/public/cancel-subscription/:workspaceId', path: () => `/api/public/cancel-subscription/${wsAId}`, body: {} },
    { method: 'POST', label: '/api/public/upgrade-checkout/:workspaceId', path: () => `/api/public/upgrade-checkout/${wsAId}`, body: { planId: 'growth' } },
    { method: 'GET', label: '/api/public/stripe/status/:workspaceId/:sessionId', path: () => `/api/public/stripe/status/${wsAId}/cs_wave2b_a` },
  ] as const;

  for (const route of publicBillingCases) {
    it(`${route.method} ${route.label} rejects no auth`, async () => {
      ctx.clearCookies();
      const res = await ctx.api(route.path(), {
        method: route.method,
        ...(route.body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(route.body),
            }
          : {}),
      });

      expect(res.status).toBe(401);
    });

    it(`${route.method} ${route.label} rejects a cross-workspace client token`, async () => {
      ctx.clearCookies();
      const res = await ctx.api(route.path(), {
        method: route.method,
        headers: {
          ...(route.body ? { 'Content-Type': 'application/json' } : {}),
          Cookie: clientCookieHeader(wsAId, clientTokenB),
        },
        ...(route.body ? { body: JSON.stringify(route.body) } : {}),
      });

      expect(res.status).toBe(401);
    });
  }

  it('allows the owning client token through auth on payment status without exposing other sessions', async () => {
    ctx.clearCookies();
    const ownPayment = await ctx.api(`/api/public/stripe/status/${wsAId}/cs_wave2b_a`, {
      headers: { Cookie: clientCookieHeader(wsAId, clientTokenA) },
    });
    const ownBody = await ownPayment.json() as Record<string, unknown>;

    expect(ownPayment.status).toBe(200);
    expect(ownBody.id).toBe(paymentAId);
    expect(ownBody.status).toBe('pending');

    const otherPayment = await ctx.api(`/api/public/stripe/status/${wsAId}/cs_wave2b_b`, {
      headers: { Cookie: clientCookieHeader(wsAId, clientTokenA) },
    });
    const otherBody = await otherPayment.json() as Record<string, unknown>;

    expect(otherPayment.status).toBe(404);
    expect(otherBody.error).toBe('Payment not found');
  });

  it('scopes admin payment list reads to the requested workspace', async () => {
    const res = await ctx.api(`/api/stripe/payments/${wsAId}`, {
      headers: authHeaders(adminToken),
    });
    const body = await res.json() as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body.some(payment => payment.id === paymentAId)).toBe(true);
    expect(body.some(payment => payment.id === paymentBId)).toBe(false);
    const workspaceIds = new Set(body.map(payment => payment.workspaceId));
    expect(Array.from(workspaceIds)).toEqual([wsAId]);
  });

  it('rejects admin payment list reads for a workspace outside the JWT scope', async () => {
    const res = await ctx.api(`/api/stripe/payments/${wsBId}`, {
      headers: authHeaders(adminToken),
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(403);
    expect(String(body.error)).toContain('access');
  });

  it('does not expose another workspace payment through the single-payment route', async () => {
    const res = await ctx.api(`/api/stripe/payments/${wsAId}/${paymentBId}`, {
      headers: authHeaders(adminToken),
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(body.error).toBe('Payment not found');
  });
});
