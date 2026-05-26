import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13760);
const { api } = ctx;

beforeAll(async () => {
  await ctx.startServer();
});

afterAll(async () => {
  await ctx.stopServer();
});

describe('Fixture roadmap edge routes', () => {
  it('returns roadmap shape', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as { sprints: Array<{ id: string; items: unknown[] }> };
    expect(Array.isArray(body.sprints)).toBe(true);
    if (body.sprints.length > 0) {
      expect(typeof body.sprints[0].id).toBe('string');
      expect(Array.isArray(body.sprints[0].items)).toBe(true);
    }
  });

  it('accepts put with current payload (round-trip)', async () => {
    const get = await api('/api/roadmap');
    expect(get.status).toBe(200);
    const current = await get.json();

    const put = await api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current),
    });
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });
});
