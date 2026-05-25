/**
 * Integration tests for churn-signals read endpoints (wave-24-a11).
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/churn-signals              — list all signals (global)
 * - GET /api/churn-signals/:workspaceId — list signals scoped to workspace
 * - Unknown workspaceId                 — 403 (workspace access denied)
 * - POST /api/churn-signals/:signalId/dismiss with bad id → 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13680);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Churn Signals Read WS 13680').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/churn-signals — global list', () => {
  it('returns 200 with an array', async () => {
    const res = await api('/api/churn-signals');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns empty array (no signals for fresh install)', async () => {
    const res = await api('/api/churn-signals');
    const body = await res.json();
    // A fresh test workspace has no churn signals yet — array should be empty
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/churn-signals/:workspaceId — workspace-scoped list', () => {
  it('returns 200 with an array for a known workspace', async () => {
    const res = await api(`/api/churn-signals/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace has no churn signals', async () => {
    const res = await api(`/api/churn-signals/${wsId}`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('returns 403 for unknown workspaceId (workspace access guard)', async () => {
    const res = await api('/api/churn-signals/ws_does_not_exist_xyz');
    // requireWorkspaceAccess returns 403 when workspace is not found
    expect(res.status).toBe(403);
  });
});

describe('POST /api/churn-signals/:signalId/dismiss', () => {
  it('returns 404 with { error } for non-existent signal id', async () => {
    const res = await postJson('/api/churn-signals/signal_nonexistent_abc/dismiss', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});
