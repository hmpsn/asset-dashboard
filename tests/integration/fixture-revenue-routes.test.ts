import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, del } = ctx;

beforeAll(async () => {
  await ctx.startServer();
});

afterAll(async () => {
  await ctx.stopServer();
});

describe('Fixture revenue routes', () => {
  it('returns summary shape with 12 months', async () => {
    const res = await api('/api/revenue/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as { months: unknown[]; totalRevenue: number };
    expect(body.months).toHaveLength(12);
    expect(typeof body.totalRevenue).toBe('number');
  });

  it('returns 404 for unknown payment delete id', async () => {
    const res = await del('/api/revenue/payments/nonexistent-fixture-payment-id');
    expect(res.status).toBe(404);
  });

  it('supports bulk purge route', async () => {
    const res = await del('/api/revenue/payments');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ ok: true, deleted: expect.any(Number) }));
  });
});
