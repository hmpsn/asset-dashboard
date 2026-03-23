/**
 * Integration tests for workspace CRUD API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/workspaces (list)
 * - POST /api/workspaces (create)
 * - GET /api/workspaces/:id (get single)
 * - PATCH /api/workspaces/:id (update)
 * - DELETE /api/workspaces/:id (delete)
 * - GET /api/workspace-overview (aggregated metrics)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13202);
const { api, postJson, patchJson, del } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

let testWorkspaceId = '';

describe('Workspace CRUD', () => {
  it('GET /api/workspaces returns array', async () => {
    const res = await api('/api/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/workspaces creates a workspace', async () => {
    const res = await postJson('/api/workspaces', {
      name: 'Integration Test Workspace',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('Integration Test Workspace');
    expect(body.tier).toBe('free');
    testWorkspaceId = body.id;
  });

  it('POST /api/workspaces without name returns 400', async () => {
    const res = await postJson('/api/workspaces', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain('required');
  });

  it('GET /api/workspaces/:id returns the created workspace', async () => {
    const res = await api(`/api/workspaces/${testWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(testWorkspaceId);
    expect(body.name).toBe('Integration Test Workspace');
    // Should not expose sensitive fields
    expect(body.webflowToken).toBeUndefined();
    expect(body.clientPassword).toBeUndefined();
  });

  it('GET /api/workspaces/:id with bad id returns 404', async () => {
    const res = await api('/api/workspaces/ws_nonexistent_999');
    expect(res.status).toBe(404);
  });

  it('PATCH /api/workspaces/:id updates fields', async () => {
    const res = await patchJson(`/api/workspaces/${testWorkspaceId}`, {
      name: 'Updated Integration Workspace',
      clientEmail: 'client@test.com',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Integration Workspace');
    expect(body.clientEmail).toBe('client@test.com');
  });

  it('PATCH /api/workspaces/:id with bad id returns 404', async () => {
    const res = await patchJson('/api/workspaces/ws_nonexistent_999', {
      name: 'X',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/workspace-overview returns array with workspace data', async () => {
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Should include our test workspace
    const ours = body.find((w: { id: string }) => w.id === testWorkspaceId);
    expect(ours).toBeDefined();
    expect(ours.name).toBe('Updated Integration Workspace');
    expect(ours).toHaveProperty('tier');
    expect(ours).toHaveProperty('audit');
    expect(ours).toHaveProperty('requests');
    expect(ours).toHaveProperty('approvals');
    expect(ours).toHaveProperty('pageStates');
  });

  it('GET /api/workspaces lists the updated workspace', async () => {
    const res = await api('/api/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ours = body.find((w: { id: string }) => w.id === testWorkspaceId);
    expect(ours).toBeDefined();
    expect(ours.name).toBe('Updated Integration Workspace');
    expect(ours).toHaveProperty('hasPassword');
  });

  it('DELETE /api/workspaces/:id removes the workspace', async () => {
    const res = await del(`/api/workspaces/${testWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET /api/workspaces/:id after delete returns 404', async () => {
    const res = await api(`/api/workspaces/${testWorkspaceId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/workspaces/:id with bad id returns 404', async () => {
    const res = await del('/api/workspaces/ws_nonexistent_999');
    expect(res.status).toBe(404);
  });
});
