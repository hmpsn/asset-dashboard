/**
 * Integration tests for the PATCH /api/workspaces/:id boundary validation of the
 * SEO Decision Engine P4 field `targetGeo` (national/international SERP target).
 *
 * Tests (exercise the admin PATCH + admin GET — targetGeo is admin-edited via the
 * BusinessFootprint geo editor):
 * - valid targetGeo round-trips on admin GET (proves the toAdminWorkspaceView
 *   explicit-field-list lockstep — the serializer must list targetGeo or the editor
 *   silently never reads back the persisted value)
 * - invalid targetGeo (missing required locationCode) → 400 (NOT a silent drop)
 * - targetGeo: null clears it
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson, patchJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

let workspaceId = '';

async function getAdminWorkspace() {
  const res = await api(`/api/workspaces/${workspaceId}`);
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  const res = await postJson('/api/workspaces', { name: 'Target Geo Patch Test' });
  const body = await res.json();
  workspaceId = body.id;
});

describe('PATCH /api/workspaces/:id — targetGeo boundary validation', () => {
  it('round-trips a valid targetGeo on the admin GET', async () => {
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      targetGeo: { locationCode: 2826, languageCode: 'en', countryCode: 'GB', label: 'United Kingdom · English' },
    });
    expect(res.status).toBe(200);
    const ws = await getAdminWorkspace();
    expect(ws.targetGeo.locationCode).toBe(2826);
    expect(ws.targetGeo.languageCode).toBe('en');
    expect(ws.targetGeo.countryCode).toBe('GB');
  });

  it('rejects a targetGeo missing the required locationCode with 400 (not a silent drop)', async () => {
    const before = await getAdminWorkspace();
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      targetGeo: { languageCode: 'en' },
    });
    expect(res.status).toBe(400);
    // Stored value unchanged.
    const after = await getAdminWorkspace();
    expect(after.targetGeo).toEqual(before.targetGeo);
  });

  it('clears targetGeo when set to null', async () => {
    const res = await patchJson(`/api/workspaces/${workspaceId}`, { targetGeo: null });
    expect(res.status).toBe(200);
    const ws = await getAdminWorkspace();
    expect(ws.targetGeo == null).toBe(true);
  });
});
