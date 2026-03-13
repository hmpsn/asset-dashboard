/**
 * Integration tests for churn-signals API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/churn-signals (list all)
 * - GET /api/churn-signals/:workspaceId (list by workspace)
 * - POST /api/churn-signals/:signalId/dismiss (dismiss)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13221);
const { api, postJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Churn Signals Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Churn Signals — list', () => {
  it('GET /api/churn-signals returns array', async () => {
    const res = await api('/api/churn-signals');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/churn-signals/:workspaceId returns array', async () => {
    const res = await api(`/api/churn-signals/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Churn Signals — dismiss', () => {
  it('POST /api/churn-signals/:signalId/dismiss with bad id returns 404', async () => {
    const res = await postJson('/api/churn-signals/signal_nonexistent/dismiss', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Signal not found');
  });
});
