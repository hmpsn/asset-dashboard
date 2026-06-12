/**
 * Integration tests: competitor-schema route
 *
 * Covers:
 *   - GET /api/competitor-schema/:workspaceId unknown → 404
 *   - GET /api/competitor-schema/:workspaceId fresh workspace → 200 {competitors:[], comparisons:[]}
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Competitor Schema Routes WS 13531').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/competitor-schema/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/competitor-schema/ws_cs_unknown_99');
    expect(res.status).toBe(404);
  });

  it('returns 200 with empty arrays for fresh workspace (no competitor domains)', async () => {
    const res = await api(`/api/competitor-schema/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { competitors: unknown[]; comparisons: unknown[] };
    expect(Array.isArray(body.competitors)).toBe(true);
    expect(Array.isArray(body.comparisons)).toBe(true);
    expect(body.competitors).toHaveLength(0);
    expect(body.comparisons).toHaveLength(0);
  });
});
