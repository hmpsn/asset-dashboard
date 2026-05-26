/**
 * Integration tests for keyword-strategy read paths and basic validation.
 * Covers GET endpoints and PATCH validation-only routes (no AI generation calls).
 *
 * Port: 13688 (assigned range 13688–13695 for wave-24-a12)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13688); // port-ok: assigned range 13688-13695
const { api, patchJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Keyword Strategy Read WS 13688').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Keyword Strategy — GET strategy endpoint', () => {
  it('returns null for a fresh workspace with no strategy', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Fresh workspace has no strategy and no page keywords → null
    expect(body).toBeNull();
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/webflow/keyword-strategy/ws_nonexistent_ks_99999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Keyword Strategy — GET diff endpoint', () => {
  it('returns null for a fresh workspace with no strategy history', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${wsId}/diff`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // No strategy at all → null
    expect(body).toBeNull();
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/webflow/keyword-strategy/ws_nonexistent_ks_99999/diff');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Keyword Strategy — GET signals endpoint', () => {
  it('returns 200 with signals array for a fresh workspace', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${wsId}/signals`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('signals');
    expect(Array.isArray(body.signals)).toBe(true);
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/webflow/keyword-strategy/ws_nonexistent_ks_99999/signals');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Keyword Feedback — GET list endpoint', () => {
  it('returns 200 with empty array for a fresh workspace', async () => {
    const res = await api(`/api/webflow/keyword-feedback/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/webflow/keyword-feedback/ws_nonexistent_ks_99999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('Keyword Strategy — PATCH validation', () => {
  it('returns 400 when PATCH body contains an unrecognized field (strict mode)', async () => {
    const res = await patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      unknownField: 'bad value',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when pageMap entry is missing required fields', async () => {
    const res = await patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      pageMap: [{ pagePath: '/foo' }], // missing pageTitle, primaryKeyword, secondaryKeywords
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 when PATCH body is valid (empty siteKeywords update)', async () => {
    const res = await patchJson(`/api/webflow/keyword-strategy/${wsId}`, {
      siteKeywords: [],
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when PATCH targets an unknown workspaceId', async () => {
    const res = await patchJson('/api/webflow/keyword-strategy/ws_nonexistent_ks_99999', {
      siteKeywords: [],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
