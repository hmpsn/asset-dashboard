/**
 * Integration tests for health check, integration health, and storage stats endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/health (basic health check)
 * - GET /api/integrations/health/:workspaceId (integration health for known workspace)
 * - GET /api/integrations/health/:workspaceId (404 for unknown workspace)
 * - GET /api/admin/storage-stats (storage statistics object)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13624); // port-ok
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Health Routes WS 13624').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/health', () => {
  it('returns 200 with ok status and expected shape', async () => {
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('hasOpenAIKey');
    expect(body).toHaveProperty('hasWebflowToken');
    expect(body).toHaveProperty('hasGoogleAuth');
    expect(body).toHaveProperty('hasEmailConfig');
    expect(body).toHaveProperty('hasStripe');
    expect(body).toHaveProperty('emailQueue');
  });
});

describe('GET /api/integrations/health/:workspaceId', () => {
  it('returns 200 with integration health payload for known workspace', async () => {
    const res = await api(`/api/integrations/health/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(wsId);
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('integrations');
    expect(Array.isArray(body.integrations)).toBe(true);
    expect(body.integrations.length).toBeGreaterThan(0);
  });

  it('includes expected integration keys in the payload', async () => {
    const res = await api(`/api/integrations/health/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = new Set(
      (body.integrations as Array<{ key: string }>).map((item) => item.key),
    );
    expect(keys.has('webflow')).toBe(true);
    expect(keys.has('google')).toBe(true);
    expect(keys.has('openai')).toBe(true);
    expect(keys.has('email')).toBe(true);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/integrations/health/ws_missing_health_check_13624');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Workspace not found');
  });
});

describe('GET /api/admin/storage-stats', () => {
  it('returns 200 with storage report object', async () => {
    const res = await api('/api/admin/storage-stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalBytes');
    expect(body).toHaveProperty('breakdown');
    expect(body).toHaveProperty('timestamp');
    expect(Array.isArray(body.breakdown)).toBe(true);
  }, 30_000);
});
