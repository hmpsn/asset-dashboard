import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, patchJson, postJson, authApi, authPatchJson, setAuthToken } = ctx;

let seeded: SeededFullWorkspace | null = null;
let foreignAuth: SeededAuth | null = null;

describe('Content briefs suggested route with fixture-seeded workspace', () => {
  beforeAll(async () => {
    await ctx.startServer();
    seeded = seedWorkspace();
    foreignAuth = await seedAuthData();
  }, 25_000);

  afterAll(async () => {
    try {
      foreignAuth?.cleanup();
      seeded?.cleanup();
    } finally {
      await ctx.stopServer();
    }
  });

  it('GET /api/content-briefs/:workspaceId/suggested returns deterministic payload shape on repeated calls', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const [resA, resB] = await Promise.all([
      api(`/api/content-briefs/${seeded.workspaceId}/suggested`),
      api(`/api/content-briefs/${seeded.workspaceId}/suggested`),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as { signals: unknown[] };
    const bodyB = await resB.json() as { signals: unknown[] };

    expect(bodyA).toEqual(expect.objectContaining({ signals: expect.any(Array) }));
    expect(bodyA).toEqual(bodyB);

    for (const signal of bodyA.signals) {
      expect(signal).toEqual(expect.objectContaining({
        type: expect.stringMatching(/^(suggested_brief|refresh_suggestion)$/),
        detail: expect.any(String),
        insightId: expect.any(String),
        impactScore: expect.any(Number),
      }));
    }
  });

  it('GET /api/content-briefs/:workspaceId/suggested with unknown workspace is deterministic 200 with empty signals', async () => {
    const [resA, resB] = await Promise.all([
      api('/api/content-briefs/ws_unknown_fixture_404/suggested'),
      api('/api/content-briefs/ws_unknown_fixture_404/suggested'),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as { signals: unknown[] };
    const bodyB = await resB.json() as { signals: unknown[] };

    expect(bodyA).toEqual({ signals: [] });
    expect(bodyB).toEqual({ signals: [] });
  });

  it('GET /api/content-briefs/:workspaceId/suggested denies cross-workspace JWT with 403', async () => {
    expect(seeded).toBeTruthy();
    expect(foreignAuth).toBeTruthy();
    if (!seeded || !foreignAuth) return;

    setAuthToken(foreignAuth.adminToken);
    const res = await authApi(`/api/content-briefs/${seeded.workspaceId}/suggested`);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: 'You do not have access to this workspace' });
  });

  it('PATCH /api/suggested-briefs/:workspaceId/:briefId rejects invalid status payload with 400 and structured errors', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await patchJson(`/api/suggested-briefs/${seeded.workspaceId}/brief_missing_fixture`, {
      status: 'pending',
      unexpectedField: true,
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; errors: Array<{ path: string; message: string }> };
    expect(body.error).toContain('Invalid enum');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'status' }),
      ]),
    );
  });

  it('PATCH /api/suggested-briefs/:workspaceId/:briefId rejects missing status field with 400', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await patchJson(`/api/suggested-briefs/${seeded.workspaceId}/brief_missing_fixture`, {
      unexpectedField: 'value',
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; errors: Array<{ path: string; message: string }> };
    expect(body.error).toBeTruthy();
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'status' }),
      ]),
    );
  });

  it('POST /api/suggested-briefs/:workspaceId/:briefId/snooze rejects malformed until payload with 400', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await postJson(`/api/suggested-briefs/${seeded.workspaceId}/brief_missing_fixture/snooze`, {
      until: '2026/99/99',
      extra: 'bad',
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; errors: Array<{ path: string; message: string }> };
    expect(body.error).toContain('Invalid');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'until' }),
      ]),
    );
  });

  it('PATCH /api/suggested-briefs/:workspaceId/:briefId denies cross-workspace JWT before lookup', async () => {
    expect(seeded).toBeTruthy();
    expect(foreignAuth).toBeTruthy();
    if (!seeded || !foreignAuth) return;

    setAuthToken(foreignAuth.adminToken);
    const res = await authPatchJson(`/api/suggested-briefs/${seeded.workspaceId}/brief_missing_fixture`, {
      status: 'accepted',
    });
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: 'You do not have access to this workspace' });
  });
});
