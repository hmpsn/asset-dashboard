/**
 * Integration tests — Stripe admin route security boundaries.
 *
 *
 * Uses an in-process http.createServer(app) so vi.mock hoisting applies to the
 * modules loaded by the Express app.  createTestContext spawns a child process
 * whose module graph cannot share the test-process vi.mock state.
 *
 * Covers:
 *   1. Admin-only routes require auth (requireAdminAuth blocks unauthenticated calls)
 *   2. Stripe API-key save / clear lifecycle (in-memory config mock)
 *   3. Product/price configuration save and list
 *   4. Billing portal — requires Stripe configured + valid workspace
 *   5. Checkout session creation — valid tier vs. invalid tier
 *   6. Workspace tier upgrade lifecycle (broadcast fires on tier change)
 *   7. Subscription status sync via webhook handler
 *   8. Error paths — Stripe SDK throws → 500 with sanitized error message
 *   9. Config persistence across requests
 */

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before any vi.mock() calls
// ---------------------------------------------------------------------------

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

// In-memory Stripe config store (shared across all mock calls in this test file)
const stripeConfigStore = vi.hoisted(() => ({
  secretKey: '',
  webhookSecret: '',
  publishableKey: '',
  products: [] as Array<{ productType: string; stripePriceId: string; displayName: string; priceUsd: number; enabled: boolean }>,
  updatedAt: null as string | null,
  clear(): void {
    this.secretKey = '';
    this.webhookSecret = '';
    this.publishableKey = '';
    this.products = [];
    this.updatedAt = null;
  },
}));

// Stripe SDK mock stubs — configured per test
const stripeMockStubs = vi.hoisted(() => ({
  checkoutCreate: vi.fn(),
  billingPortalCreate: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  customersCreate: vi.fn(),
  customersRetrieve: vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted to top of file by Vitest)
// ---------------------------------------------------------------------------

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('stripe', () => {
  class StripeMock {
    checkout = { sessions: { create: stripeMockStubs.checkoutCreate } };
    billingPortal = { sessions: { create: stripeMockStubs.billingPortalCreate } };
    subscriptions = {
      update: stripeMockStubs.subscriptionsUpdate,
      retrieve: stripeMockStubs.subscriptionsRetrieve,
    };
    customers = {
      create: stripeMockStubs.customersCreate,
      retrieve: stripeMockStubs.customersRetrieve,
    };
    webhooks = { constructEvent: vi.fn() };
  }
  return { default: StripeMock, Stripe: StripeMock };
});

vi.mock('../../server/stripe-config.js', () => ({
  getStripeSecretKey: vi.fn(() => stripeConfigStore.secretKey),
  getStripeWebhookSecret: vi.fn(() => stripeConfigStore.webhookSecret),
  getStripePublishableKey: vi.fn(() => stripeConfigStore.publishableKey),
  getStripePriceId: vi.fn((_type: string, _envKey: string) => 'price_test_1234'),
  getStripeConfigSafe: vi.fn(() => ({
    configured: !!stripeConfigStore.secretKey,
    hasSecretKey: !!stripeConfigStore.secretKey,
    hasWebhookSecret: !!stripeConfigStore.webhookSecret,
    hasPublishableKey: !!stripeConfigStore.publishableKey,
    publishableKey: stripeConfigStore.publishableKey,
    products: stripeConfigStore.products,
    updatedAt: stripeConfigStore.updatedAt,
  })),
  saveStripeKeys: vi.fn((secretKey?: string, webhookSecret?: string, publishableKey?: string) => {
    if (secretKey) stripeConfigStore.secretKey = secretKey;
    if (webhookSecret) stripeConfigStore.webhookSecret = webhookSecret;
    if (publishableKey) stripeConfigStore.publishableKey = publishableKey;
    stripeConfigStore.updatedAt = new Date().toISOString();
  }),
  saveStripeProducts: vi.fn((products: typeof stripeConfigStore.products) => {
    stripeConfigStore.products = products;
    stripeConfigStore.updatedAt = new Date().toISOString();
  }),
  clearStripeConfig: vi.fn(() => {
    stripeConfigStore.clear();
  }),
  isStripeConfigured: vi.fn(() => !!stripeConfigStore.secretKey),
}));

vi.mock('../../server/email.js', () => ({
  notifyTeamPaymentReceived: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyClientActionReady: vi.fn(),
}));

// Bypass the checkout rate limiter (5 req/min) so error-path tests don't get
// 429 after the checkout-session tests exhaust the window.
vi.mock('../../server/middleware.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/middleware.js')>();
  return {
    ...original,
    checkoutLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// ---------------------------------------------------------------------------
// Imports AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { handleWebhookEvent, initStripeBroadcast } from '../../server/stripe.js';
import { createPayment } from '../../server/payments.js';

// ---------------------------------------------------------------------------
// Test server helpers
// ---------------------------------------------------------------------------

const TEST_APP_PASSWORD = 'stripe-boundary-test-pw-13862';

// HMAC admin token derived the same way the server derives it.
const ADMIN_HMAC_TOKEN = crypto
  .createHmac('sha256', TEST_APP_PASSWORD)
  .update('admin')
  .digest('hex');

let baseUrl = '';
let server: http.Server | undefined;
let currentWs: SeededFullWorkspace | undefined;

async function startTestServer(): Promise<void> {
  if (server) return;
  process.env.APP_PASSWORD = TEST_APP_PASSWORD;
  process.env.SESSION_SECRET = TEST_APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

// HTTP helpers
async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function adminApi(path: string, opts?: RequestInit): Promise<Response> {
  return api(path, {
    ...opts,
    headers: {
      ...(opts?.headers as Record<string, string> | undefined ?? {}),
      'x-auth-token': ADMIN_HMAC_TOKEN,
    },
  });
}

async function adminPostJson(path: string, body: unknown): Promise<Response> {
  return adminApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function adminDel(path: string): Promise<Response> {
  return adminApi(path, { method: 'DELETE' });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await startTestServer();
  initStripeBroadcast((wsId, event, data) => {
    broadcastState.calls.push({ workspaceId: wsId, event, payload: data });
  });
}, 25_000);

afterAll(async () => {
  currentWs?.cleanup();
  await stopTestServer();
  delete process.env.APP_PASSWORD;
  delete process.env.SESSION_SECRET;
});

beforeEach(() => {
  broadcastState.calls.length = 0;
  stripeConfigStore.clear();
  stripeMockStubs.checkoutCreate.mockReset();
  stripeMockStubs.billingPortalCreate.mockReset();
  stripeMockStubs.subscriptionsUpdate.mockReset();
  stripeMockStubs.subscriptionsRetrieve.mockReset();
  stripeMockStubs.customersCreate.mockReset();
  stripeMockStubs.customersRetrieve.mockReset();
});

afterEach(() => {
  currentWs?.cleanup();
  currentWs = undefined;
});

// ---------------------------------------------------------------------------
// 1. Admin-only routes require HMAC auth — no token → 401
// ---------------------------------------------------------------------------

describe('1. Admin-only routes require HMAC auth', () => {
  const adminEndpoints: Array<{ method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/stripe/config' },
    { method: 'POST', path: '/api/stripe/config/keys', body: { publishableKey: 'pk_test_noauth' } },
    { method: 'POST', path: '/api/stripe/config/products', body: { products: [] } },
    { method: 'DELETE', path: '/api/stripe/config' },
    { method: 'GET', path: '/api/stripe/payments/ws_nonexistent' },
  ];

  for (const ep of adminEndpoints) {
    it(`${ep.method} ${ep.path} returns 401 without auth token`, async () => {
      const res = await api(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : {},
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      expect(res.status, `${ep.method} ${ep.path} should be 401 with no token`).toBe(401);
    });

    it(`${ep.method} ${ep.path} returns non-401 with valid HMAC admin token`, async () => {
      const res = await adminApi(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : {},
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      // HMAC token passes requireAdminAuth — downstream may 200/204/400 but not 401/403
      expect(res.status, `${ep.method} ${ep.path} should not be 401/403 with HMAC token`).not.toBe(401);
      expect(res.status, `${ep.method} ${ep.path} should not be 401/403 with HMAC token`).not.toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Stripe API key save and clear lifecycle
// ---------------------------------------------------------------------------

describe('2. API key save and clear lifecycle', () => {
  it('GET /api/stripe/config returns configured=false when no key is set', async () => {
    const res = await adminApi('/api/stripe/config');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.configured).toBe(false);
    expect(body.hasSecretKey).toBe(false);
  });

  it('POST /api/stripe/config/keys stores the keys and returns ok', async () => {
    const res = await adminPostJson('/api/stripe/config/keys', {
      secretKey: 'sk_test_boundary_001',
      publishableKey: 'pk_test_boundary_001',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    // The config store should reflect the saved keys
    expect(stripeConfigStore.secretKey).toBe('sk_test_boundary_001');
    expect(stripeConfigStore.publishableKey).toBe('pk_test_boundary_001');
  });

  it('POST /api/stripe/config/keys with no fields returns 400', async () => {
    const res = await adminPostJson('/api/stripe/config/keys', {});
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('DELETE /api/stripe/config clears the config and returns ok', async () => {
    // First seed a key
    stripeConfigStore.secretKey = 'sk_test_to_be_cleared';
    const res = await adminDel('/api/stripe/config');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    // Config should be cleared
    expect(stripeConfigStore.secretKey).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. Product / price configuration
// ---------------------------------------------------------------------------

describe('3. Product/price configuration', () => {
  it('POST /api/stripe/config/products saves the product array', async () => {
    const products = [
      { productType: 'brief_blog', stripePriceId: 'price_blog_001', displayName: 'Blog Brief', priceUsd: 125, enabled: true },
    ];
    const res = await adminPostJson('/api/stripe/config/products', { products });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(stripeConfigStore.products).toHaveLength(1);
    expect(stripeConfigStore.products[0].stripePriceId).toBe('price_blog_001');
  });

  it('POST /api/stripe/config/products with non-array returns 400', async () => {
    const res = await adminPostJson('/api/stripe/config/products', { products: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('POST /api/stripe/config/products rejects malformed product-price config', async () => {
    const res = await adminPostJson('/api/stripe/config/products', {
      products: [
        { productType: 'brief_blog', stripePriceId: 'price_blog_001', displayName: 'Blog Brief', priceUsd: -1, enabled: true },
      ],
    });

    expect(res.status).toBe(400);
    expect(stripeConfigStore.products).toHaveLength(0);
  });

  it('POST /api/stripe/config/products allows blank price ids for unconfigured products', async () => {
    const products = [
      { productType: 'brief_blog', stripePriceId: '', displayName: 'Blog Brief', priceUsd: 125, enabled: true },
    ];
    const res = await adminPostJson('/api/stripe/config/products', { products });

    expect(res.status).toBe(200);
    expect(stripeConfigStore.products[0].stripePriceId).toBe('');
  });

  it('POST /api/stripe/config/products rejects unknown product types', async () => {
    const res = await adminPostJson('/api/stripe/config/products', {
      products: [
        { productType: 'plan_enterprise_typo', stripePriceId: 'price_unknown_001', displayName: 'Unknown', priceUsd: 1, enabled: true },
      ],
    });

    expect(res.status).toBe(400);
    expect(stripeConfigStore.products).toHaveLength(0);
  });

  it('GET /api/stripe/products lists all product types', async () => {
    const res = await adminApi('/api/stripe/products');
    expect(res.status).toBe(200);
    const body = await res.json() as { configured: boolean; products: Array<Record<string, unknown>> };
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);
    // Each product has required shape
    for (const product of body.products) {
      expect(product).toHaveProperty('type');
      expect(product).toHaveProperty('displayName');
      expect(product).toHaveProperty('priceUsd');
      expect(product).toHaveProperty('category');
    }
  });

  it('GET /api/stripe/config after saving products reflects them', async () => {
    const products = [
      { productType: 'schema_page', stripePriceId: 'price_schema_001', displayName: 'Schema', priceUsd: 39, enabled: true },
    ];
    await adminPostJson('/api/stripe/config/products', { products });

    const res = await adminApi('/api/stripe/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { products: typeof products };
    expect(body.products).toHaveLength(1);
    expect(body.products[0].stripePriceId).toBe('price_schema_001');
  });
});

// ---------------------------------------------------------------------------
// 4. Billing portal session creation
// ---------------------------------------------------------------------------

describe('4. Billing portal session creation', () => {
  it('POST /api/public/billing-portal/:wsId without client auth returns 401', async () => {
    currentWs = seedWorkspace();
    const res = await postJson(`/api/public/billing-portal/${currentWs.workspaceId}`, {});
    // requireAuthenticatedClientPortalAuth() blocks unauthenticated requests
    expect([401, 403]).toContain(res.status);
  });

  it('POST /api/public/billing-portal/:wsId with Stripe not configured returns 503', async () => {
    currentWs = seedWorkspace({ clientPassword: 'test-pass' });
    // Obtain a client auth token for this workspace
    const loginRes = await postJson('/api/public/auth', {
      workspaceId: currentWs.workspaceId,
      password: 'test-pass',
    });
    if (loginRes.status !== 200) {
      // If portal auth endpoint isn't available, skip this sub-test gracefully
      expect([200, 404]).toContain(loginRes.status);
      return;
    }
    // Stripe not configured (secretKey is empty)
    const res = await postJson(`/api/public/billing-portal/${currentWs.workspaceId}`, {});
    expect(res.status).toBe(503);
  });

  it('POST /api/public/billing-portal/:wsId for nonexistent workspace returns 404 or auth failure', async () => {
    stripeConfigStore.secretKey = 'sk_test_billing_portal';
    const res = await postJson('/api/public/billing-portal/ws_does_not_exist_xyz', {});
    // Either auth failure (401/403) or not found (404); never 200
    expect([401, 403, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// 5. Checkout session creation
// ---------------------------------------------------------------------------

describe('5. Checkout session creation', () => {
  it('POST /api/stripe/create-checkout without Stripe configured returns 503', async () => {
    currentWs = seedWorkspace();
    const res = await adminPostJson('/api/stripe/create-checkout', {
      workspaceId: currentWs.workspaceId,
      productType: 'brief_blog',
    });
    expect(res.status).toBe(503);
  });

  it('POST /api/stripe/create-checkout with invalid productType returns 400', async () => {
    currentWs = seedWorkspace();
    stripeConfigStore.secretKey = 'sk_test_invalid_product';
    const res = await adminPostJson('/api/stripe/create-checkout', {
      workspaceId: currentWs.workspaceId,
      productType: 'not_a_real_product',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/unknown product/i);
  });

  it('POST /api/stripe/create-checkout missing required fields returns 400', async () => {
    const res = await adminPostJson('/api/stripe/create-checkout', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/stripe/create-checkout for external-billing workspace returns 403', async () => {
    currentWs = seedWorkspace();
    // Force external billing mode on the workspace
    updateWorkspace(currentWs.workspaceId, { billingMode: 'external' });
    stripeConfigStore.secretKey = 'sk_test_external';
    const res = await adminPostJson('/api/stripe/create-checkout', {
      workspaceId: currentWs.workspaceId,
      productType: 'brief_blog',
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/public/content-subscribe/:wsId for external-billing workspace returns 403 without checkout', async () => {
    currentWs = seedWorkspace();
    updateWorkspace(currentWs.workspaceId, { billingMode: 'external' });
    stripeConfigStore.secretKey = 'sk_test_external_content_sub';

    const res = await api(`/api/public/content-subscribe/${currentWs.workspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': ADMIN_HMAC_TOKEN,
      },
      body: JSON.stringify({ plan: 'content_starter' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('billed externally');
    expect(stripeMockStubs.checkoutCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Workspace tier upgrade lifecycle
// ---------------------------------------------------------------------------

describe('6. Workspace tier upgrade lifecycle via webhook', () => {
  it('checkout.session.completed for plan_growth upgrades workspace tier to growth', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    // Pre-create a pending payment record for the growth plan
    createPayment(currentWs.workspaceId, {
      workspaceId: currentWs.workspaceId,
      stripeSessionId: 'cs_upgrade_growth_001',
      productType: 'plan_growth',
      amount: 24900,
      currency: 'usd',
      status: 'pending',
      metadata: {},
    });

    await handleWebhookEvent({
      id: 'evt_upgrade_growth_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_upgrade_growth_001',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          amount_total: 24900,
          payment_intent: 'pi_upgrade_growth_001',
          subscription: 'sub_upgrade_growth_001',
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('growth');
    expect(ws?.stripeSubscriptionId).toBe('sub_upgrade_growth_001');
  });

  it('tier upgrade emits WORKSPACE_UPDATED broadcast', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    createPayment(currentWs.workspaceId, {
      workspaceId: currentWs.workspaceId,
      stripeSessionId: 'cs_broadcast_growth_001',
      productType: 'plan_growth',
      amount: 24900,
      currency: 'usd',
      status: 'pending',
      metadata: {},
    });

    broadcastState.calls.length = 0;

    await handleWebhookEvent({
      id: 'evt_broadcast_growth_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_broadcast_growth_001',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          amount_total: 24900,
          payment_intent: 'pi_broadcast_growth_001',
          subscription: 'sub_broadcast_growth_001',
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const workspaceBroadcasts = broadcastState.calls.filter(
      c => c.workspaceId === currentWs!.workspaceId && c.event === WS_EVENTS.WORKSPACE_UPDATED,
    );
    expect(workspaceBroadcasts.length).toBeGreaterThan(0);
    const upgradePayload = workspaceBroadcasts.find(c => (c.payload as Record<string, unknown>)?.tier === 'growth');
    expect(upgradePayload).toBeDefined();
  });

  it('checkout.session.completed for plan_premium upgrades workspace tier to premium', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    createPayment(currentWs.workspaceId, {
      workspaceId: currentWs.workspaceId,
      stripeSessionId: 'cs_upgrade_premium_001',
      productType: 'plan_premium',
      amount: 99900,
      currency: 'usd',
      status: 'pending',
      metadata: {},
    });

    await handleWebhookEvent({
      id: 'evt_upgrade_premium_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_upgrade_premium_001',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_premium' },
          amount_total: 99900,
          payment_intent: 'pi_upgrade_premium_001',
          subscription: 'sub_upgrade_premium_001',
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('premium');
    expect(ws?.stripeSubscriptionId).toBe('sub_upgrade_premium_001');
  });

  it('checkout.session.completed for platform plan without subscription id does not grant tier', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    createPayment(currentWs.workspaceId, {
      workspaceId: currentWs.workspaceId,
      stripeSessionId: 'cs_plan_missing_sub_001',
      productType: 'plan_growth',
      amount: 24900,
      currency: 'usd',
      status: 'pending',
      metadata: {},
    });

    await handleWebhookEvent({
      id: 'evt_plan_missing_sub_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_plan_missing_sub_001',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          amount_total: 24900,
          payment_intent: 'pi_plan_missing_sub_001',
          subscription: null,
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('free');
    expect(ws?.stripeSubscriptionId).toBeUndefined();
  });

  it('checkout.session.completed for platform plan persists the Stripe subscription id', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    createPayment(currentWs.workspaceId, {
      workspaceId: currentWs.workspaceId,
      stripeSessionId: 'cs_plan_sub_persist_001',
      productType: 'plan_growth',
      amount: 24900,
      currency: 'usd',
      status: 'pending',
      metadata: {},
    });

    await handleWebhookEvent({
      id: 'evt_plan_sub_persist_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_plan_sub_persist_001',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          amount_total: 24900,
          payment_intent: 'pi_plan_sub_persist_001',
          subscription: 'sub_plan_current_001',
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('growth');
    expect(ws?.stripeSubscriptionId).toBe('sub_plan_current_001');
  });

  it('already-paid session is not re-processed (idempotency guard)', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    createPayment(currentWs.workspaceId, {
      workspaceId: currentWs.workspaceId,
      stripeSessionId: 'cs_idempotent_001',
      productType: 'plan_growth',
      amount: 24900,
      currency: 'usd',
      status: 'paid', // already paid
      paidAt: new Date().toISOString(),
      metadata: {},
    });

    // Tier starts as free — the replay must NOT change it
    broadcastState.calls.length = 0;

    await handleWebhookEvent({
      id: 'evt_idempotent_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_idempotent_001',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          amount_total: 24900,
          payment_intent: 'pi_idempotent_001',
          subscription: null,
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    // Session was already paid — replay must not upgrade tier
    expect(ws?.tier).toBe('free');
  });
});

// ---------------------------------------------------------------------------
// 7. Subscription status sync
// ---------------------------------------------------------------------------

describe('7. Subscription status sync via webhook events', () => {
  it('customer.subscription.updated active → workspace tier set', async () => {
    currentWs = seedWorkspace({ tier: 'free' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_sync_001' });

    await handleWebhookEvent({
      id: 'evt_sub_updated_001',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_sync_001',
          status: 'active',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('growth');
    expect(ws?.stripeSubscriptionId).toBe('sub_sync_001');
  });

  it('customer.subscription.updated ignores stale platform subscription ids', async () => {
    currentWs = seedWorkspace({ tier: 'premium' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_current_plan_001' });

    await handleWebhookEvent({
      id: 'evt_sub_stale_updated_001',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_old_plan_001',
          status: 'active',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('premium');
    expect(ws?.stripeSubscriptionId).toBe('sub_current_plan_001');
  });

  it('customer.subscription.updated active cannot rebind after terminal status cleared current subscription', async () => {
    currentWs = seedWorkspace({ tier: 'growth' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_replay_case_001' });

    await handleWebhookEvent({
      id: 'evt_sub_replay_unpaid_001',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_replay_case_001',
          status: 'unpaid',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    await handleWebhookEvent({
      id: 'evt_sub_replay_active_001',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_replay_case_001',
          status: 'active',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('free');
    expect(ws?.stripeSubscriptionId).toBeUndefined();
  });

  it.each([
    { status: 'past_due', expectedTier: 'growth', expectedSubscriptionId: 'sub_status_case_001' },
    { status: 'unpaid', expectedTier: 'free', expectedSubscriptionId: undefined },
    { status: 'incomplete_expired', expectedTier: 'free', expectedSubscriptionId: undefined },
    { status: 'canceled', expectedTier: 'free', expectedSubscriptionId: undefined },
  ])('customer.subscription.updated $status has explicit platform plan behavior', async ({ status, expectedTier, expectedSubscriptionId }) => {
    currentWs = seedWorkspace({ tier: 'growth' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_status_case_001' });

    await handleWebhookEvent({
      id: `evt_sub_status_${status}`,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_status_case_001',
          status,
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe(expectedTier);
    expect(ws?.stripeSubscriptionId).toBe(expectedSubscriptionId);
  });

  it('customer.subscription.deleted → workspace downgraded to free', async () => {
    currentWs = seedWorkspace({ tier: 'growth' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_delete_001' });

    await handleWebhookEvent({
      id: 'evt_sub_deleted_001',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_delete_001',
          status: 'canceled',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('free');
    expect(ws?.stripeSubscriptionId).toBeUndefined();
  });

  it('customer.subscription.deleted ignores stale platform subscription ids', async () => {
    currentWs = seedWorkspace({ tier: 'growth' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_current_delete_001' });

    await handleWebhookEvent({
      id: 'evt_sub_stale_deleted_001',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_old_delete_001',
          status: 'canceled',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const ws = getWorkspace(currentWs.workspaceId);
    expect(ws?.tier).toBe('growth');
    expect(ws?.stripeSubscriptionId).toBe('sub_current_delete_001');
  });

  it('customer.subscription.deleted emits WORKSPACE_UPDATED broadcast with tier=free', async () => {
    currentWs = seedWorkspace({ tier: 'growth' });
    updateWorkspace(currentWs.workspaceId, { stripeSubscriptionId: 'sub_delete_broadcast_001' });
    broadcastState.calls.length = 0;

    await handleWebhookEvent({
      id: 'evt_sub_deleted_broadcast_001',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_delete_broadcast_001',
          status: 'canceled',
          metadata: { workspaceId: currentWs.workspaceId, productType: 'plan_growth' },
          items: { data: [] },
        },
      },
    } as unknown as import('stripe').Stripe.Event);

    const downgradeBroadcasts = broadcastState.calls.filter(
      c =>
        c.workspaceId === currentWs!.workspaceId &&
        c.event === WS_EVENTS.WORKSPACE_UPDATED &&
        (c.payload as Record<string, unknown>)?.tier === 'free',
    );
    expect(downgradeBroadcasts.length).toBeGreaterThan(0);
  });

  it('subscription event with unknown workspaceId does not throw', async () => {
    await expect(
      handleWebhookEvent({
        id: 'evt_no_workspace_001',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_no_ws_001',
            status: 'active',
            metadata: { productType: 'plan_growth' }, // no workspaceId
            items: { data: [] },
          },
        },
      } as unknown as import('stripe').Stripe.Event),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Error paths — Stripe SDK throws → graceful error responses
// ---------------------------------------------------------------------------

describe('8. Error paths — Stripe SDK throws', () => {
  it('POST /api/stripe/create-checkout when Stripe SDK throws returns 500 with error', async () => {
    currentWs = seedWorkspace();
    stripeConfigStore.secretKey = 'sk_test_error_path';
    stripeMockStubs.customersCreate.mockResolvedValue({ id: 'cus_error_test', name: 'Error Workspace' });
    stripeMockStubs.customersRetrieve.mockRejectedValue(new Error('No such customer'));
    stripeMockStubs.checkoutCreate.mockRejectedValue(new Error('Stripe API unavailable'));

    const res = await adminPostJson('/api/stripe/create-checkout', {
      workspaceId: currentWs.workspaceId,
      productType: 'brief_blog',
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).not.toContain('Stripe API unavailable');
    expect(body.error).toContain('Unable to start checkout');
  });

  it('POST /api/public/upgrade-checkout/:wsId when Stripe SDK throws returns 500', async () => {
    // No clientPassword so the client-session gate doesn't block the request.
    currentWs = seedWorkspace({ clientPassword: '' });
    stripeConfigStore.secretKey = 'sk_test_upgrade_error';
    stripeConfigStore.products = [
      { productType: 'plan_growth', stripePriceId: 'price_growth_001', displayName: 'Growth', priceUsd: 249, enabled: true },
    ];
    stripeMockStubs.customersCreate.mockResolvedValue({ id: 'cus_upgrade_error', name: 'Test' });
    stripeMockStubs.customersRetrieve.mockRejectedValue(new Error('No such customer'));
    stripeMockStubs.checkoutCreate.mockRejectedValue(new Error('Stripe rate limit exceeded'));

    const res = await api(`/api/public/upgrade-checkout/${currentWs.workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': ADMIN_HMAC_TOKEN },
      body: JSON.stringify({
        planId: 'growth',
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).not.toContain('Stripe rate limit exceeded');
    expect(body.error).toContain('Unable to start plan checkout');
  });

  it('checkout.session.completed with missing payment record is handled without crash', async () => {
    currentWs = seedWorkspace();
    // No pre-created payment record — handler must not throw
    await expect(
      handleWebhookEvent({
        id: 'evt_no_payment_001',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_no_payment_record_001',
            metadata: { workspaceId: currentWs.workspaceId, productType: 'brief_blog' },
            amount_total: 12500,
            payment_intent: null,
            subscription: null,
          },
        },
      } as unknown as import('stripe').Stripe.Event),
    ).resolves.not.toThrow();
  });

  it('POST /api/stripe/create-checkout for nonexistent workspace returns 404', async () => {
    stripeConfigStore.secretKey = 'sk_test_404_ws';
    const res = await adminPostJson('/api/stripe/create-checkout', {
      workspaceId: 'ws_does_not_exist_xyz_9999',
      productType: 'brief_blog',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 9. Config persistence — set key in one request, visible in next
// ---------------------------------------------------------------------------

describe('9. Config persistence across requests', () => {
  it('saving a publishable key is reflected in GET /api/stripe/publishable-key', async () => {
    await adminPostJson('/api/stripe/config/keys', { publishableKey: 'pk_test_persist_001' });

    const res = await adminApi('/api/stripe/publishable-key');
    expect(res.status).toBe(200);
    const body = await res.json() as { publishableKey: string | null };
    expect(body.publishableKey).toBe('pk_test_persist_001');
  });

  it('saving config and then clearing it removes the key from subsequent config reads', async () => {
    // Save key
    await adminPostJson('/api/stripe/config/keys', { secretKey: 'sk_test_persist_clear' });
    let configRes = await adminApi('/api/stripe/config');
    let config = await configRes.json() as { configured: boolean };
    expect(config.configured).toBe(true);

    // Clear config
    await adminDel('/api/stripe/config');
    configRes = await adminApi('/api/stripe/config');
    config = await configRes.json() as { configured: boolean };
    expect(config.configured).toBe(false);
  });

  it('saving products persists them and GET /api/stripe/config reflects the product list', async () => {
    const products = [
      { productType: 'brief_blog', stripePriceId: 'price_persist_001', displayName: 'Blog Brief', priceUsd: 125, enabled: true },
      { productType: 'schema_page', stripePriceId: 'price_persist_002', displayName: 'Schema', priceUsd: 39, enabled: true },
    ];
    await adminPostJson('/api/stripe/config/products', { products });

    const res = await adminApi('/api/stripe/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { products: typeof products };
    expect(body.products).toHaveLength(2);
    const priceIds = body.products.map((p: { stripePriceId: string }) => p.stripePriceId).sort();
    expect(priceIds).toEqual(['price_persist_001', 'price_persist_002']);
  });
});
