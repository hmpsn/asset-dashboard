/**
 * Integration tests for workspace list and read endpoints.
 *
 * Covers:
 *  - GET /api/workspaces — 200 with array (includes seeded workspace)
 *  - GET /api/workspace-overview — 200 with array
 *  - GET /api/workspaces/:id — known workspace → 200 with workspace object
 *  - GET /api/workspaces/:id — unknown id → 404
 *  - Sensitive field stripping (webflowToken, clientPassword absent; hasPassword present)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13616);
const { api } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Workspaces List Read WS 13616').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/workspaces', () => {
  it('returns 200 with an array', async () => {
    const res = await api('/api/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('includes the seeded workspace in the list', async () => {
    const res = await api('/api/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; name: string }>;
    const ours = body.find(w => w.id === wsId);
    expect(ours).toBeDefined();
    expect(ours!.name).toBe('Workspaces List Read WS 13616');
  });

  it('strips sensitive fields from list items', async () => {
    const res = await api('/api/workspaces');
    const body = await res.json() as Array<Record<string, unknown>>;
    const ours = body.find(w => w.id === wsId);
    expect(ours).toBeDefined();
    expect(ours!.webflowToken).toBeUndefined();
    expect(ours!.clientPassword).toBeUndefined();
    expect(ours).toHaveProperty('hasPassword');
  });

  it('hasPassword is false for a freshly created workspace', async () => {
    const res = await api('/api/workspaces');
    const body = await res.json() as Array<{ id: string; hasPassword: boolean }>;
    const ours = body.find(w => w.id === wsId);
    expect(ours!.hasPassword).toBe(false);
  });
});

describe('GET /api/workspace-overview', () => {
  it('returns 200 with an array', async () => {
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('includes the seeded workspace in the overview', async () => {
    const res = await api('/api/workspace-overview');
    const body = await res.json() as Array<{ id: string }>;
    const ours = body.find(w => w.id === wsId);
    expect(ours).toBeDefined();
  });

  it('overview item has expected shape fields', async () => {
    const res = await api('/api/workspace-overview');
    const body = await res.json() as Array<Record<string, unknown>>;
    const ours = body.find(w => w.id === wsId);
    expect(ours).toBeDefined();
    expect(ours).toHaveProperty('name');
    expect(ours).toHaveProperty('tier');
    expect(ours).toHaveProperty('hasPassword');
    expect(ours).toHaveProperty('audit');
    expect(ours).toHaveProperty('requests');
    expect(ours).toHaveProperty('approvals');
    expect(ours).toHaveProperty('contentRequests');
    expect(ours).toHaveProperty('workOrders');
    expect(ours).toHaveProperty('contentPlan');
    expect(ours).toHaveProperty('churnSignals');
    expect(ours).toHaveProperty('clientSignals');
    expect(ours).toHaveProperty('pageStates');
    expect(ours).toHaveProperty('isTrial');
    expect(ours).toHaveProperty('hasGsc');
    expect(ours).toHaveProperty('hasGa4');
  });

  it('audit is null when workspace has no webflowSiteId', async () => {
    const res = await api('/api/workspace-overview');
    const body = await res.json() as Array<{ id: string; audit: unknown }>;
    const ours = body.find(w => w.id === wsId);
    expect(ours).toBeDefined();
    // Fresh workspace has no webflowSiteId, so audit must be null
    expect(ours!.audit).toBeNull();
  });

  it('isTrial is a boolean', async () => {
    const res = await api('/api/workspace-overview');
    const body = await res.json() as Array<{ id: string; isTrial: unknown }>;
    const ours = body.find(w => w.id === wsId);
    expect(typeof ours!.isTrial).toBe('boolean');
  });
});

describe('GET /api/workspaces/:id', () => {
  it('returns 200 with the workspace object for a known id', async () => {
    const res = await api(`/api/workspaces/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(wsId);
    expect(body.name).toBe('Workspaces List Read WS 13616');
  });

  it('strips sensitive fields from single-workspace response', async () => {
    const res = await api(`/api/workspaces/${wsId}`);
    const body = await res.json();
    expect(body.webflowToken).toBeUndefined();
    expect(body.clientPassword).toBeUndefined();
    expect(body).toHaveProperty('hasPassword');
  });

  it('returns 404 for an unknown workspace id', async () => {
    const res = await api('/api/workspaces/ws_nonexistent_list_read_99');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
