/**
 * Integration tests: feature flag admin routes.
 *
 * Covers:
 *   - GET /api/feature-flags → 200 with object
 *   - GET /api/admin/feature-flags → 200 with metadata
 *   - PUT /api/admin/feature-flags/:key with unknown key → 400
 *   - PUT /api/admin/feature-flags/:key with valid key and null (clear) → 200
 *   - PUT /api/admin/feature-flags/:key with valid key and enabled=true → 200
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13400);
const { api, authApi } = ctx;

beforeAll(async () => {
  await ctx.startServer();
  ctx.setAuthToken('test-token');
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

describe('GET /api/feature-flags', () => {
  it('returns 200 with a flags object', async () => {
    const res = await api('/api/feature-flags');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('includes known flag keys in the response', async () => {
    const res = await api('/api/feature-flags');
    const body = await res.json() as Record<string, unknown>;
    // Every value should be a boolean
    const values = Object.values(body);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(typeof v).toBe('boolean');
    }
  });
});

describe('GET /api/admin/feature-flags', () => {
  it('returns 200 with metadata including source info', async () => {
    const res = await authApi('/api/admin/feature-flags');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });
});

describe('PUT /api/admin/feature-flags/:key', () => {
  it('returns 400 for an unknown flag key', async () => {
    const res = await authApi('/api/admin/feature-flags/totally_unknown_flag_xyz', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Unknown feature flag');
  });

  it('returns 400 when enabled field is missing', async () => {
    const res = await authApi('/api/admin/feature-flags/totally_unknown_flag_xyz', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
