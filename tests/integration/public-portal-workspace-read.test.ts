/**
 * Integration tests for public-portal READ paths — workspace, tier, and pricing.
 *
 * Port: 13600
 *
 * Covers:
 * - GET /api/public/workspace/:id  — 404 unknown, 200 shape for fresh workspace
 * - GET /api/public/tier/:id       — 404 unknown, 200 with { tier: string } shape
 * - GET /api/public/pricing/:id    — 404 unknown, 200 with pricing shape
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13600);
const { api } = ctx;

const UNKNOWN = 'nonexistent-ws-pub-99999';
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Public Portal Workspace Read WS 13600');
  wsId = ws.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── GET /api/public/workspace/:id ─────────────────────────────────────────────

describe('GET /api/public/workspace/:id', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/workspace/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    expect(res.status).toBe(200);
  });

  it('response has expected top-level shape fields', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('id', wsId);
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('baseTier');
    expect(body).toHaveProperty('clientPortalEnabled');
    expect(body).toHaveProperty('requiresPassword');
    expect(body).toHaveProperty('stripeEnabled');
    expect(body).toHaveProperty('hasClientUsers');
    expect(body).toHaveProperty('bookingUrl');
    expect(body).toHaveProperty('onboardingEnabled');
    expect(body).toHaveProperty('onboardingCompleted');
  });

  it('stripeEnabled is a boolean', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.stripeEnabled).toBe('boolean');
  });

  it('hasClientUsers is a boolean', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.hasClientUsers).toBe('boolean');
  });

  it('tier is one of the known tier values', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(['free', 'growth', 'premium']).toContain(body.tier);
  });

  it('bookingUrl is null or a string', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.bookingUrl === null || typeof body.bookingUrl === 'string').toBe(true);
  });

  it('does not expose admin-only fields', async () => {
    const res = await api(`/api/public/workspace/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect('knowledgeBase' in body).toBe(false);
    expect('brandVoice' in body).toBe(false);
    expect('webflowToken' in body).toBe(false);
    expect('stripeCustomerId' in body).toBe(false);
    expect('stripeSubscriptionId' in body).toBe(false);
    expect('appPassword' in body).toBe(false);
    expect('personas' in body).toBe(false);
    expect('competitorDomains' in body).toBe(false);
    expect('keywordStrategy' in body).toBe(false);
  });
});

// ── GET /api/public/tier/:id ──────────────────────────────────────────────────

describe('GET /api/public/tier/:id', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/tier/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace', async () => {
    const res = await api(`/api/public/tier/${wsId}`);
    expect(res.status).toBe(200);
  });

  it('response has { tier, baseTier, isTrial, trialDaysRemaining, trialEndsAt } shape', async () => {
    const res = await api(`/api/public/tier/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('tier');
    expect(body).toHaveProperty('baseTier');
    expect(body).toHaveProperty('isTrial');
    expect(body).toHaveProperty('trialDaysRemaining');
    expect(body).toHaveProperty('trialEndsAt');
  });

  it('tier is a string', async () => {
    const res = await api(`/api/public/tier/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.tier).toBe('string');
  });

  it('isTrial is a boolean', async () => {
    const res = await api(`/api/public/tier/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.isTrial).toBe('boolean');
  });

  it('trialDaysRemaining is a number', async () => {
    const res = await api(`/api/public/tier/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.trialDaysRemaining).toBe('number');
  });

  it('does not expose Stripe secret keys', async () => {
    const res = await api(`/api/public/tier/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect('stripeCustomerId' in body).toBe(false);
    expect('stripeSubscriptionId' in body).toBe(false);
  });
});

// ── GET /api/public/pricing/:id ───────────────────────────────────────────────

describe('GET /api/public/pricing/:id', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await api(`/api/public/pricing/${UNKNOWN}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 for a valid workspace', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    expect(res.status).toBe(200);
  });

  it('response has { products, bundles, currency, stripeEnabled } shape', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('products');
    expect(body).toHaveProperty('bundles');
    expect(body).toHaveProperty('currency');
    expect(body).toHaveProperty('stripeEnabled');
  });

  it('products is an object', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.products).toBe('object');
    expect(body.products).not.toBeNull();
    expect(Array.isArray(body.products)).toBe(false);
  });

  it('bundles is an array', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.bundles)).toBe(true);
  });

  it('bundles array items have id, name, monthlyPrice, includes', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    const body = await res.json() as { bundles: Array<Record<string, unknown>> };
    for (const bundle of body.bundles) {
      expect(bundle).toHaveProperty('id');
      expect(bundle).toHaveProperty('name');
      expect(bundle).toHaveProperty('monthlyPrice');
      expect(bundle).toHaveProperty('includes');
    }
  });

  it('currency is a string', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.currency).toBe('string');
  });

  it('stripeEnabled is a boolean', async () => {
    const res = await api(`/api/public/pricing/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.stripeEnabled).toBe('boolean');
  });
});
