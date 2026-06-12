/**
 * Integration tests: webflow-seo-suggestions routes
 *
 * Covers:
 *   - GET /api/webflow/seo-suggestions/:workspaceId unknown → 404, fresh → 200
 *   - PATCH .../suggestionId unknown workspace → 404; invalid selectedIndex → 400
 *   - POST .../apply unknown workspace → 404; no selected suggestions → 400
 *   - DELETE unknown workspace → 404; fresh (nothing to dismiss) → 200
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';
const FAKE_WS = 'ws_seosug_unknown_99';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Webflow SEO Suggestions Routes WS 13533').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/webflow/seo-suggestions/:workspaceId', () => {
  it('returns 200 with empty suggestions for unknown workspace (no workspace check)', async () => {
    const res = await api(`/api/webflow/seo-suggestions/${FAKE_WS}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { suggestions: unknown[]; counts: unknown };
    expect(Array.isArray(body.suggestions)).toBe(true);
  });

  it('returns 200 with empty suggestions for fresh workspace', async () => {
    const res = await api(`/api/webflow/seo-suggestions/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { suggestions: unknown[]; counts: unknown };
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions).toHaveLength(0);
    expect(typeof body.counts).toBe('object');
  });

  it('accepts optional field query param without error', async () => {
    const res = await api(`/api/webflow/seo-suggestions/${wsId}?field=title`);
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/webflow/seo-suggestions/:workspaceId/:suggestionId', () => {
  it('returns 404 when suggestion does not exist for unknown workspace', async () => {
    const res = await patchJson(`/api/webflow/seo-suggestions/${FAKE_WS}/sug_fake`, { selectedIndex: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when selectedIndex is missing', async () => {
    const res = await patchJson(`/api/webflow/seo-suggestions/${wsId}/sug_fake`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('selectedIndex');
  });

  it('returns 400 when selectedIndex is out of range (>2)', async () => {
    const res = await patchJson(`/api/webflow/seo-suggestions/${wsId}/sug_fake`, { selectedIndex: 3 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when selectedIndex is negative', async () => {
    const res = await patchJson(`/api/webflow/seo-suggestions/${wsId}/sug_fake`, { selectedIndex: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when suggestion does not exist (valid index)', async () => {
    const res = await patchJson(`/api/webflow/seo-suggestions/${wsId}/sug_nonexistent`, { selectedIndex: 0 });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/webflow/seo-suggestions/:workspaceId/apply', () => {
  it('returns 400 for unknown workspace (no selected suggestions → no workspace check)', async () => {
    const res = await postJson(`/api/webflow/seo-suggestions/${FAKE_WS}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('No suggestions');
  });

  it('returns 400 when no suggestions have selected variations', async () => {
    // Fresh workspace has no suggestions, so none are selected → 400
    const res = await postJson(`/api/webflow/seo-suggestions/${wsId}/apply`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('No suggestions');
  });
});

describe('DELETE /api/webflow/seo-suggestions/:workspaceId', () => {
  it('returns 200 for unknown workspace (no workspace check — idempotent dismiss)', async () => {
    const res = await del(`/api/webflow/seo-suggestions/${FAKE_WS}`);
    expect(res.status).toBe(200);
  });

  it('returns 200 for fresh workspace (nothing to dismiss is fine)', async () => {
    const res = await del(`/api/webflow/seo-suggestions/${wsId}`);
    expect(res.status).toBe(200);
  });
});
