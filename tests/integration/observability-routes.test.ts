/**
 * Integration tests for observability and diagnostic endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/observability/:workspaceId (known workspace → 200 with report object)
 * - GET /api/observability/:workspaceId (unknown workspace → 404)
 * - GET /api/health/diag (diagnostic info object)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Observability Routes WS 13625').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/observability/:workspaceId', () => {
  it('returns 200 with observability report for known workspace', async () => {
    const res = await api(`/api/observability/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(wsId);
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('window');
    expect(body).toHaveProperty('failedJobs');
    expect(body).toHaveProperty('operationTraces');
    expect(body).toHaveProperty('externalApiFailureRates');
    expect(Array.isArray(body.failedJobs)).toBe(true);
    expect(Array.isArray(body.operationTraces)).toBe(true);
    expect(Array.isArray(body.externalApiFailureRates)).toBe(true);
  });

  it('accepts a custom days parameter', async () => {
    const res = await api(`/api/observability/${wsId}?days=7`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(wsId);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/observability/ws_missing_observability_13625');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Workspace not found');
  });

  it('returns 400 when days parameter is out of range', async () => {
    const res = await api(`/api/observability/${wsId}?days=9999`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('days must be between');
  });
});

describe('GET /api/health/diag', () => {
  it('returns 200 with diagnostic info object', async () => {
    const res = await api('/api/health/diag');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('dataDir');
    expect(body).toHaveProperty('configFile');
    expect(body).toHaveProperty('configExists');
    expect(body).toHaveProperty('envTokenSet');
    expect(body).toHaveProperty('workspaceCount');
    expect(body).toHaveProperty('workspaces');
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(typeof body.workspaceCount).toBe('number');
    expect(body.workspaceCount).toBeGreaterThanOrEqual(1);
  });
});
