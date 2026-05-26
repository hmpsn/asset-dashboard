import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13725); // port-ok: unique in integration suite
const { api, authApi, setAuthToken, clearCookies } = ctx;

let seededWorkspace: SeededFullWorkspace | null = null;
let seededAuth: SeededAuth | null = null;

describe('Keyword strategy signals route with fixture-seeded workspace', () => {
  beforeAll(async () => {
    await ctx.startServer();
    seededWorkspace = seedWorkspace();
    seededAuth = await seedAuthData();
  }, 25_000);

  beforeEach(() => {
    setAuthToken('');
    clearCookies();
  });

  afterAll(async () => {
    try {
      seededAuth?.cleanup();
      seededWorkspace?.cleanup();
    } finally {
      setAuthToken('');
      clearCookies();
      await ctx.stopServer();
    }
  });

  it('GET /api/webflow/keyword-strategy/:workspaceId/signals returns 200 with { signals: array } without auth', async () => {
    expect(seededWorkspace).toBeTruthy();
    if (!seededWorkspace) return;

    const res = await api(`/api/webflow/keyword-strategy/${seededWorkspace.workspaceId}/signals`);
    expect(res.status).toBe(200);

    const body = await res.json() as { signals: unknown[] };
    expect(body).toHaveProperty('signals');
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('returns 403 for JWT user scoped to a different workspace (workspace mismatch)', async () => {
    expect(seededWorkspace).toBeTruthy();
    expect(seededAuth).toBeTruthy();
    if (!seededWorkspace || !seededAuth) return;

    setAuthToken(seededAuth.adminToken);
    const res = await authApi(`/api/webflow/keyword-strategy/${seededWorkspace.workspaceId}/signals`);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'You do not have access to this workspace' });
  });

  it('returns 200 with { signals: array } for JWT user scoped to requested workspace', async () => {
    expect(seededAuth).toBeTruthy();
    if (!seededAuth) return;

    setAuthToken(seededAuth.adminToken);
    const res = await authApi(`/api/webflow/keyword-strategy/${seededAuth.workspaceId}/signals`);

    expect(res.status).toBe(200);
    const body = await res.json() as { signals: unknown[] };
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('treats invalid bearer token as unauthenticated and still returns endpoint shape', async () => {
    expect(seededWorkspace).toBeTruthy();
    if (!seededWorkspace) return;

    const res = await api(`/api/webflow/keyword-strategy/${seededWorkspace.workspaceId}/signals`, {
      headers: {
        Authorization: 'Bearer definitely-not-a-valid-jwt',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { signals: unknown[] };
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/webflow/keyword-strategy/ws_unknown_fixture_keyword_signals_404/signals');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });

  it('returns 404 for invalid input when workspaceId segment is blank', async () => {
    const res = await api('/api/webflow/keyword-strategy//signals');
    expect(res.status).toBe(404);
  });

  it('returns 404 for invalid input when workspaceId is whitespace-only', async () => {
    const res = await api('/api/webflow/keyword-strategy/%20/signals');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});
