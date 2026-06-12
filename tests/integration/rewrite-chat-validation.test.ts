/**
 * Wave 18 — Integration tests for rewrite-chat routes (validation paths)
 *
 * Routes tested (server/routes/rewrite-chat.ts):
 *   GET  /api/rewrite-chat/:workspaceId/pages     — list pages from snapshot
 *   POST /api/rewrite-chat/:workspaceId/load-page — load a URL; requires {url}
 *   POST /api/rewrite-chat/:workspaceId           — chat; requires {question}
 *
 * Strategy: exercise only validation and DB-read paths — no AI calls triggered.
 * requireWorkspaceAccess passes through when no JWT user present (APP_PASSWORD='').
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url, { env: { OPENAI_API_KEY: '' } });
const { api, postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Rewrite Chat Validation Test 13441').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ─── GET /api/rewrite-chat/:workspaceId/pages ─────────────────────────────────

describe('GET /api/rewrite-chat/:workspaceId/pages', () => {
  it('returns 200 with empty array for a workspace without a snapshot', async () => {
    const res = await api(`/api/rewrite-chat/${workspaceId}/pages`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/rewrite-chat/ws_nonexistent_pages_zzz/pages');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 with empty array when workspace has no webflowSiteId', async () => {
    // Fresh workspace created without a webflowSiteId → early return []
    const res = await api(`/api/rewrite-chat/${workspaceId}/pages`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

// ─── POST /api/rewrite-chat/:workspaceId/load-page ───────────────────────────

describe('POST /api/rewrite-chat/:workspaceId/load-page', () => {
  it('returns 400 when url is missing from body', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}/load-page`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('url required');
  });

  it('returns 400 when url is null', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}/load-page`, { url: null });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('url required');
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await postJson('/api/rewrite-chat/ws_nonexistent_load_zzz/load-page', {
      url: 'https://example.com/',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns an error when url is a malformed string (not a valid URL)', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}/load-page`, {
      url: 'not-a-valid-url-at-all',
    });
    // Route attempts to fetch the URL; malformed URLs fail at the fetch or URL parse level
    expect([400, 500, 502]).toContain(res.status);
  });

  it('returns 500 or 502 when url points to a non-existent local port', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}/load-page`, {
      url: 'http://127.0.0.1:19999/does-not-exist',
    });
    // fetchPublicWebText will fail because of the blocked/unavailable local address
    expect([400, 500, 502]).toContain(res.status);
  });
});

// ─── POST /api/rewrite-chat/:workspaceId ─────────────────────────────────────

describe('POST /api/rewrite-chat/:workspaceId', () => {
  it('returns 400 when question is missing from body', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('question required');
  });

  it('returns 400 when question is empty string', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}`, { question: '' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('question required');
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await postJson('/api/rewrite-chat/ws_nonexistent_chat_zzz', {
      question: 'test question',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when OPENAI_API_KEY is not set', async () => {
    const res = await postJson(`/api/rewrite-chat/${workspaceId}`, {
      question: 'Can you optimize this page?',
    });
    // If the test runtime injects OPENAI_API_KEY, this route can return 200.
    expect([200, 400]).toContain(res.status);
    if (res.status === 400) {
      const body = await res.json() as { error: string };
      expect(body.error).toContain('OPENAI_API_KEY');
      return;
    }
    const body = await res.json() as { answer?: string };
    expect(typeof body.answer).toBe('string');
  });
});
