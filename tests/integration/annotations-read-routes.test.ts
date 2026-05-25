/**
 * Integration tests for annotations read and validation endpoints (wave-24-a11).
 *
 * Focused on:
 * - GET /api/annotations/:workspaceId      → 200 with empty array for fresh workspace
 * - GET /api/public/annotations/:workspaceId → 200 with array
 * - POST with missing required fields      → 400
 * - Unknown workspaceId                   → 403 (workspace access guard)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13682);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Annotations Read WS 13682').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/annotations/:workspaceId — list', () => {
  it('returns 200 with an array for a known workspace', async () => {
    const res = await api(`/api/annotations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns empty array for fresh workspace', async () => {
    const res = await api(`/api/annotations/${wsId}`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('returns 403 for unknown workspaceId', async () => {
    const res = await api('/api/annotations/ws_does_not_exist_xyz');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/public/annotations/:workspaceId — public list', () => {
  it('returns 200 with an array for a known workspace', async () => {
    const res = await api(`/api/public/annotations/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('POST /api/annotations/:workspaceId — validation', () => {
  it('returns 400 when both date and label are missing', async () => {
    const res = await postJson(`/api/annotations/${wsId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when label is missing (date provided)', async () => {
    const res = await postJson(`/api/annotations/${wsId}`, { date: '2025-06-01' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when date is missing (label provided)', async () => {
    const res = await postJson(`/api/annotations/${wsId}`, { label: 'No date annotation' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 403 when posting to unknown workspaceId', async () => {
    const res = await postJson('/api/annotations/ws_does_not_exist_xyz', {
      date: '2025-06-01',
      label: 'Some annotation',
    });
    expect(res.status).toBe(403);
  });

  it('creates an annotation with valid payload', async () => {
    const res = await postJson(`/api/annotations/${wsId}`, {
      date: '2025-06-01',
      label: 'Test annotation wave-24',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.label).toBe('Test annotation wave-24');
    expect(body.date).toBe('2025-06-01');
  });
});
