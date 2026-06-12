/**
 * Integration tests for anomalies API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/anomalies (list all)
 * - GET /api/anomalies/:workspaceId (list by workspace)
 * - GET /api/public/anomalies/:workspaceId (public list)
 * - POST /api/anomalies/:anomalyId/dismiss (dismiss)
 * - POST /api/anomalies/:anomalyId/acknowledge (acknowledge)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Anomalies Test Workspace');
  testWsId = ws.id;
  // Public anomaly endpoints now use requireAuthenticatedClientPortalAuth
  // (see sprint-platform-health-wave8-audit-drift-closure Plan A Task 1).
  // Seed a portal password and authenticate so the test client gets a session
  // cookie. Without this the public GET returns 401 even on a fresh workspace.
  updateWorkspace(testWsId, { clientPassword: 'test-password' });
  const authRes = await postJson(`/api/public/auth/${testWsId}`, { password: 'test-password' });
  expect(authRes.status).toBe(200);
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('Anomalies — list', () => {
  it('GET /api/anomalies returns array', async () => {
    const res = await api('/api/anomalies');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/anomalies/:workspaceId returns array', async () => {
    const res = await api(`/api/anomalies/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/anomalies/:workspaceId returns array', async () => {
    const res = await api(`/api/public/anomalies/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Anomalies — dismiss/acknowledge with bad id', () => {
  it('POST /api/anomalies/:anomalyId/dismiss with bad id returns 404', async () => {
    const res = await postJson('/api/anomalies/anomaly_nonexistent/dismiss', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Anomaly not found');
  });

  it('POST /api/anomalies/:anomalyId/acknowledge with bad id returns 404', async () => {
    const res = await postJson('/api/anomalies/anomaly_nonexistent/acknowledge', {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Anomaly not found');
  });
});
