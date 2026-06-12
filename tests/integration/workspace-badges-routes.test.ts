/**
 * Integration tests: GET /api/workspace-badges/:id
 *
 * Covers:
 *   - 404 for unknown workspace
 *   - Fresh workspace → 200 {pendingRequests: 0, hasContent: false}
 *   - Shape validation: both fields present and correctly typed
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Workspace Badges Routes WS').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/workspace-badges/:id', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspace-badges/ws_does_not_exist_badges_99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 for a fresh workspace', async () => {
    const res = await api(`/api/workspace-badges/${wsId}`);
    expect(res.status).toBe(200);
  });

  it('returns {pendingRequests: 0, hasContent: false} for a fresh workspace', async () => {
    const res = await api(`/api/workspace-badges/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { pendingRequests: number; hasContent: boolean };
    expect(body.pendingRequests).toBe(0);
    expect(body.hasContent).toBe(false);
  });

  it('returns a number for pendingRequests field', async () => {
    const res = await api(`/api/workspace-badges/${wsId}`);
    const body = await res.json() as { pendingRequests: number; hasContent: boolean };
    expect(typeof body.pendingRequests).toBe('number');
    expect(typeof body.hasContent).toBe('boolean');
  });
});
