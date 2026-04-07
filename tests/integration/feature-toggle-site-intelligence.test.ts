/**
 * Integration tests for siteIntelligenceClientView toggle.
 *
 * Tests:
 * - Default value (NULL in DB → undefined in response)
 * - PATCH false → persists
 * - PATCH true (after false) → persists
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13251);
const { api, postJson, patchJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

let workspaceId = '';

describe('siteIntelligenceClientView toggle', () => {
  beforeAll(async () => {
    const res = await postJson('/api/workspaces', { name: 'SI Toggle Test' });
    const body = await res.json();
    workspaceId = body.id;
  });

  it('defaults to undefined (treated as enabled) on new workspace', async () => {
    const res = await api(`/api/workspaces/${workspaceId}`);
    expect(res.status).toBe(200);
    const ws = await res.json();
    // NULL in DB → field absent from response → frontend treats as true
    expect(ws.siteIntelligenceClientView).toBeUndefined();
  });

  it('PATCH siteIntelligenceClientView false returns 200 and persists', async () => {
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      siteIntelligenceClientView: false,
    });
    expect(res.status).toBe(200);

    const getRes = await api(`/api/workspaces/${workspaceId}`);
    const ws = await getRes.json();
    expect(ws.siteIntelligenceClientView).toBe(false);
  });

  it('PATCH siteIntelligenceClientView true returns 200 and persists', async () => {
    // First set to false (already done above, but re-set for test isolation)
    await patchJson(`/api/workspaces/${workspaceId}`, { siteIntelligenceClientView: false });

    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      siteIntelligenceClientView: true,
    });
    expect(res.status).toBe(200);

    const getRes = await api(`/api/workspaces/${workspaceId}`);
    const ws = await getRes.json();
    expect(ws.siteIntelligenceClientView).toBe(true);
  });
});
