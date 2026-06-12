import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let seededWorkspace: SeededFullWorkspace | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seededWorkspace = seedWorkspace({ clientPassword: '' });
}, 25_000);

afterAll(async () => {
  seededWorkspace?.cleanup();
  await ctx.stopServer();
});

describe('fixture public pricing route', () => {
  it('GET /api/public/pricing/:id returns 200 with products object and bundles array', async () => {
    expect(seededWorkspace).toBeTruthy();
    if (!seededWorkspace) return;

    const res = await api(`/api/public/pricing/${seededWorkspace.workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as { products: unknown; bundles: unknown };
    expect(typeof body.products).toBe('object');
    expect(body.products).not.toBeNull();
    expect(Array.isArray(body.products)).toBe(false);
    expect(Array.isArray(body.bundles)).toBe(true);
  });

  it('GET /api/public/pricing/:id returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/pricing/ws_fixture_public_pricing_missing');
    expect(res.status).toBe(404);
  });
});
