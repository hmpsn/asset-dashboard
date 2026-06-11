/**
 * Wave 18 — Integration tests for public-chat usage routes
 * Port: 13440
 *
 * Routes tested (server/routes/public-chat.ts):
 *   GET /api/public/chat-usage/:workspaceId — rate limit check for a workspace
 *   GET /api/public/usage/:workspaceId      — unified usage summary
 *
 * These routes are not covered in the existing public-chat-routes.test.ts
 * (port 13350), which focuses on session CRUD.
 *
 * Also covers supplemental cases for:
 *   GET /api/public/chat-sessions/:workspaceId — invalid channel filter → 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13440, { autoPublicAuth: true }); // port-ok: wave-18-a3 range 13440-13454
const { api } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Public Chat Usage Routes Test 13440').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

// ─── GET /api/public/chat-usage/:workspaceId ──────────────────────────────────

describe('GET /api/public/chat-usage/:workspaceId', () => {
  it('returns 200 with rate limit info for a known workspace', async () => {
    const res = await api(`/api/public/chat-usage/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      allowed: boolean;
      used: number;
      limit: number | null;
      remaining: number | null;
      tier: string;
    };
    expect(typeof body.allowed).toBe('boolean');
    expect(typeof body.used).toBe('number');
    // limit/remaining are null only for unlimited premium-tier workspaces.
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('remaining');
    expect(typeof body.tier).toBe('string');
  });

  it('returns tier field on the response', async () => {
    const res = await api(`/api/public/chat-usage/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { tier: string };
    // Workspace starts as free tier
    expect(body.tier).toBeTruthy();
  });

  it('reports allowed=true for a fresh workspace (no sessions used)', async () => {
    const freshWsId = createWorkspace('Fresh Workspace Chat Usage 13440').id;
    try {
      const res = await api(`/api/public/chat-usage/${freshWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { allowed: boolean; used: number };
      expect(body.allowed).toBe(true);
      expect(body.used).toBe(0);
    } finally {
      deleteWorkspace(freshWsId);
    }
  });

  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/chat-usage/ws_unknown_chat_usage_zzz');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});

// ─── GET /api/public/usage/:workspaceId ──────────────────────────────────────

describe('GET /api/public/usage/:workspaceId', () => {
  it('returns 200 with tier and usage for a known workspace', async () => {
    const res = await api(`/api/public/usage/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tier: string;
      usage: Record<string, { used: number; limit: number; remaining: number }>;
    };
    expect(typeof body.tier).toBe('string');
    expect(typeof body.usage).toBe('object');
    expect(body.usage).not.toBeNull();
  });

  it('usage includes all tracked feature keys', async () => {
    const res = await api(`/api/public/usage/${workspaceId}`);
    const body = await res.json() as {
      usage: Record<string, { used: number; limit: number; remaining: number }>;
    };
    const keys = Object.keys(body.usage);
    expect(keys).toContain('ai_chats');
    expect(keys).toContain('strategy_generations');
    expect(keys).toContain('alt_text_generations');
    expect(keys).toContain('workspace_context_generations');
    expect(keys).toContain('brandscript_generations');
    expect(keys).toContain('voice_calibrations');
  });

  it('each feature entry has used, limit, and remaining fields', async () => {
    const res = await api(`/api/public/usage/${workspaceId}`);
    const body = await res.json() as {
      usage: Record<string, { used: number; limit: number; remaining: number }>;
    };
    const aiChats = body.usage['ai_chats'];
    expect(typeof aiChats.used).toBe('number');
    expect(aiChats).toHaveProperty('limit');
    expect(aiChats).toHaveProperty('remaining');
    // Fresh workspace — no usage recorded
    expect(aiChats.used).toBe(0);
  });

  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/usage/ws_unknown_usage_zzz');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});

// ─── GET /api/public/chat-sessions/:workspaceId — channel filter validation ───
// (Supplemental: not in existing public-chat-routes.test.ts which focuses on CRUD)

describe('GET /api/public/chat-sessions/:workspaceId — channel filter', () => {
  it('returns 400 for an invalid channel value', async () => {
    const res = await api(`/api/public/chat-sessions/${workspaceId}?channel=bogus_channel`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Invalid channel');
  });

  it('returns 400 for channel=all (not a valid ChatChannel)', async () => {
    const res = await api(`/api/public/chat-sessions/${workspaceId}?channel=all`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Invalid channel');
  });

  it('returns 200 for valid channel=client', async () => {
    const res = await api(`/api/public/chat-sessions/${workspaceId}?channel=client`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 400 for non-client channel=admin on the public route', async () => {
    const res = await api(`/api/public/chat-sessions/${workspaceId}?channel=admin`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-client channel=search on the public route', async () => {
    const res = await api(`/api/public/chat-sessions/${workspaceId}?channel=search`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with no channel filter (defaults to client sessions)', async () => {
    const res = await api(`/api/public/chat-sessions/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 404 for unknown workspace regardless of channel', async () => {
    const res = await api('/api/public/chat-sessions/ws_unknown_zzz?channel=client');
    expect(res.status).toBe(404);
  });
});
