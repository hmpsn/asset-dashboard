/**
 * Integration tests for annotations API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/annotations/:workspaceId (list)
 * - POST /api/annotations/:workspaceId (create)
 * - DELETE /api/annotations/:workspaceId/:id (delete)
 * - GET /api/public/annotations/:workspaceId (public list)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13215);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Annotations Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Annotations — CRUD', () => {
  let annotationId = '';

  it('GET /api/annotations/:workspaceId returns array', async () => {
    const res = await api(`/api/annotations/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST without date or label returns 400', async () => {
    const res = await postJson(`/api/annotations/${testWsId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('POST without label returns 400', async () => {
    const res = await postJson(`/api/annotations/${testWsId}`, {
      date: '2025-01-15',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('POST creates annotation', async () => {
    const res = await postJson(`/api/annotations/${testWsId}`, {
      date: '2025-01-15',
      label: 'Site redesign launched',
      description: 'Major redesign affecting all pages',
      color: '#ff6600',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.label).toBe('Site redesign launched');
    expect(body.date).toBe('2025-01-15');
    annotationId = body.id;
  });

  it('GET now includes the annotation', async () => {
    const res = await api(`/api/annotations/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    const ours = body.find((a: { id: string }) => a.id === annotationId);
    expect(ours).toBeDefined();
    expect(ours.label).toBe('Site redesign launched');
  });

  it('GET /api/public/annotations/:workspaceId returns same data', async () => {
    const res = await api(`/api/public/annotations/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ours = body.find((a: { id: string }) => a.id === annotationId);
    expect(ours).toBeDefined();
  });

  it('DELETE removes the annotation', async () => {
    const res = await del(`/api/annotations/${testWsId}/${annotationId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET after delete no longer includes it', async () => {
    const res = await api(`/api/annotations/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ours = body.find((a: { id: string }) => a.id === annotationId);
    expect(ours).toBeUndefined();
  });
});
