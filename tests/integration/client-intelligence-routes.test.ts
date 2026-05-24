/**
 * Integration tests: client-intelligence route
 *
 * Covers:
 *   - GET /api/public/intelligence/:workspaceId unknown → 404
 *   - GET /api/public/intelligence/:workspaceId fresh workspace → 200 with expected shape
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13530);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Client Intelligence Routes WS 13530').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/public/intelligence/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/intelligence/ws_ci_unknown_99');
    expect(res.status).toBe(404);
  });

  it('returns 200 with intelligence object for fresh workspace', async () => {
    const res = await api(`/api/public/intelligence/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('response does not contain restricted admin-only fields', async () => {
    const res = await api(`/api/public/intelligence/${wsId}`);
    const body = await res.json() as Record<string, unknown>;
    // These fields must never be in client-facing intelligence
    expect(body).not.toHaveProperty('knowledgeBase');
    expect(body).not.toHaveProperty('churnRisk');
    expect(body).not.toHaveProperty('brandVoice');
  });

  it('returns consistent shape on repeated calls', async () => {
    const r1 = await api(`/api/public/intelligence/${wsId}`);
    const r2 = await api(`/api/public/intelligence/${wsId}`);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(JSON.stringify(Object.keys(b1 as object).sort()))
      .toBe(JSON.stringify(Object.keys(b2 as object).sort()));
  });
});
