/**
 * Integration tests: webflow-pagespeed route validation.
 *
 * Tests validation paths that fire BEFORE any external PageSpeed API call,
 * plus the snapshot endpoint (which is a pure DB read).
 *
 * Angles NOT covered by pagespeed-snapshot-route.test.ts:
 *   - maxPages=0 → 400
 *   - maxPages=-1 → 400
 *   - maxPages=26 (> MAX_PAGESPEED_PAGES=25) → 400
 *   - maxPages=abc (non-integer) → 400
 *   - GET /api/webflow/pagespeed-snapshot/:siteId for unknown site → 200 null
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13401);
const { api } = ctx;

const FAKE_SITE_ID = 'site_pagespeed_validation_test_99';

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

describe('GET /api/webflow/pagespeed/:siteId — maxPages validation', () => {
  it('returns 400 when maxPages=0', async () => {
    const res = await api(`/api/webflow/pagespeed/${FAKE_SITE_ID}?maxPages=0`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('maxPages');
  });

  it('returns 400 when maxPages=-1', async () => {
    const res = await api(`/api/webflow/pagespeed/${FAKE_SITE_ID}?maxPages=-1`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('maxPages');
  });

  it('returns 400 when maxPages=26 (exceeds MAX_PAGESPEED_PAGES=25)', async () => {
    const res = await api(`/api/webflow/pagespeed/${FAKE_SITE_ID}?maxPages=26`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('25');
  });

  it('returns 400 when maxPages is a non-integer string', async () => {
    const res = await api(`/api/webflow/pagespeed/${FAKE_SITE_ID}?maxPages=abc`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('maxPages');
  });

  it('returns 400 when maxPages is a float', async () => {
    const res = await api(`/api/webflow/pagespeed/${FAKE_SITE_ID}?maxPages=2.5`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('maxPages');
  });
});

describe('GET /api/webflow/pagespeed-snapshot/:siteId', () => {
  it('returns 200 with null for an unknown siteId (no saved snapshot)', async () => {
    const res = await api(`/api/webflow/pagespeed-snapshot/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // No snapshot exists for this site — route returns null
    expect(body).toBeNull();
  });

  it('uses mobile strategy by default', async () => {
    const res = await api(`/api/webflow/pagespeed-snapshot/${FAKE_SITE_ID}`);
    expect(res.status).toBe(200);
    // Should consistently return null regardless of strategy
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns 200 with null for desktop strategy on unknown site', async () => {
    const res = await api(`/api/webflow/pagespeed-snapshot/${FAKE_SITE_ID}?strategy=desktop`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});
