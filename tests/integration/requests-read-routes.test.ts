/**
 * Integration tests for requests API endpoints.
 *
 * Tests:
 * - GET /api/requests — returns array
 * - GET /api/requests/:id — 404 for unknown id
 * - POST /api/requests — 400 on missing required fields
 * - POST /api/requests — 201 (200) with valid body
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13672);
const { api, postJson } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Requests Routes WS 13672').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Requests — list', () => {
  it('GET /api/requests returns 200 with an array', async () => {
    const res = await api('/api/requests');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/requests?workspaceId=<id> returns 200 with an array', async () => {
    const res = await api(`/api/requests?workspaceId=${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Requests — single read', () => {
  it('GET /api/requests/:id with unknown id returns 404', async () => {
    const res = await api('/api/requests/req_unknown_does_not_exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Requests — create validation', () => {
  it('POST /api/requests with empty body returns 400', async () => {
    const res = await postJson('/api/requests', {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /api/requests missing title returns 400', async () => {
    const res = await postJson('/api/requests', {
      workspaceId: wsId,
      description: 'Test description',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /api/requests missing description returns 400', async () => {
    const res = await postJson('/api/requests', {
      workspaceId: wsId,
      title: 'Test title',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('POST /api/requests missing workspaceId returns 400', async () => {
    const res = await postJson('/api/requests', {
      title: 'Test title',
      description: 'Test description',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Requests — create', () => {
  it('POST /api/requests with valid body creates a request', async () => {
    const res = await postJson('/api/requests', {
      workspaceId: wsId,
      title: 'Integration test request',
      description: 'This is a test request created by the integration suite',
      category: 'seo',
    });
    // Route returns res.json(request) — status is 200 by default (no explicit 201)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.workspaceId).toBe(wsId);
    expect(body.title).toBe('Integration test request');
    expect(body.category).toBe('seo');
  });

  it('POST /api/requests with optional priority creates a request with that priority', async () => {
    const res = await postJson('/api/requests', {
      workspaceId: wsId,
      title: 'Urgent request',
      description: 'This is an urgent test request',
      priority: 'urgent',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.priority).toBe('urgent');
  });

  it('GET /api/requests/:id returns the created request', async () => {
    const createRes = await postJson('/api/requests', {
      workspaceId: wsId,
      title: 'Request for single-get test',
      description: 'Created to verify single-get endpoint',
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const getRes = await api(`/api/requests/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('Request for single-get test');
  });
});
