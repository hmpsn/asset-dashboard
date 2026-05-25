/**
 * Integration tests for AI stats routes.
 *
 * Routes under /api/ai-stats (mounted with prefix, admin-gated via x-auth-token):
 *   GET /api/ai-stats/deduplication — deduplication queue stats
 *   GET /api/ai-stats/usage — token usage stats (optional ?workspaceId, ?since, ?days)
 *   GET /api/ai-stats/summary — combined performance summary (optional ?workspaceId)
 *
 * Auth: these routes are admin-gated (x-auth-token / verifyAdminToken). The test
 * imports signAdminToken() from the same module singleton so both the server and
 * test share the same SESSION_SECRET derived HMAC key.
 *
 * These routes have no workspace-level 404 semantics — they read from in-memory
 * counters and aggregations, not from per-workspace DB rows.
 *
 * Scenarios covered:
 *   1. GET /deduplication → 200 with expected shape
 *   2. GET /usage → 200 with expected shape
 *   3. GET /usage?workspaceId=X → 200 (workspaceId scoped)
 *   4. GET /summary → 200 with expected shape
 *   5. GET /summary?workspaceId=X → 200 (workspaceId scoped)
 *   6. All numeric fields present in responses
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ---------------------------------------------------------------------------
// In-process server helpers
// ---------------------------------------------------------------------------

let sharedServer: http.Server | null = null;
let sharedBaseUrl = '';
let adminToken = '';
let ws: SeededFullWorkspace;

async function startSharedServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const { signAdminToken } = await import('../../server/middleware.js');
  adminToken = signAdminToken();

  const app = createApp();
  sharedServer = http.createServer(app);
  await new Promise<void>((resolve) => sharedServer!.listen(0, '127.0.0.1', resolve));
  const { port } = sharedServer.address() as AddressInfo;
  sharedBaseUrl = `http://127.0.0.1:${port}`;
}

async function getJson(
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${sharedBaseUrl}${path}`, {
    headers: { 'x-auth-token': adminToken },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

beforeAll(async () => {
  await startSharedServer();
  ws = seedWorkspace();
}, 30_000);

afterAll(() => {
  ws.cleanup();
  sharedServer?.close();
  sharedServer = null;
});

// ---------------------------------------------------------------------------
// Deduplication stats
// ---------------------------------------------------------------------------

describe('GET /api/ai-stats/deduplication', () => {
  it('returns 200', async () => {
    const { status } = await getJson('/api/ai-stats/deduplication');
    expect(status).toBe(200);
  });

  it('response includes pendingRequests field', async () => {
    const { body } = await getJson('/api/ai-stats/deduplication');
    expect(body as Record<string, unknown>).toHaveProperty('pendingRequests');
  });

  it('response includes cacheSize field', async () => {
    const { body } = await getJson('/api/ai-stats/deduplication');
    expect(body as Record<string, unknown>).toHaveProperty('cacheSize');
  });

  it('response includes timestamp field', async () => {
    const { body } = await getJson('/api/ai-stats/deduplication');
    expect(body as Record<string, unknown>).toHaveProperty('timestamp');
  });

  it('pendingRequests is a number', async () => {
    const { body } = await getJson('/api/ai-stats/deduplication');
    const b = body as Record<string, unknown>;
    expect(typeof b.pendingRequests).toBe('number');
  });

  it('cacheSize is a number', async () => {
    const { body } = await getJson('/api/ai-stats/deduplication');
    const b = body as Record<string, unknown>;
    expect(typeof b.cacheSize).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Usage stats
// ---------------------------------------------------------------------------

describe('GET /api/ai-stats/usage', () => {
  it('returns 200', async () => {
    const { status } = await getJson('/api/ai-stats/usage');
    expect(status).toBe(200);
  });

  it('response includes workspaceId field', async () => {
    const { body } = await getJson('/api/ai-stats/usage');
    expect(body as Record<string, unknown>).toHaveProperty('workspaceId');
  });

  it('workspaceId defaults to "all" when not scoped', async () => {
    const { body } = await getJson('/api/ai-stats/usage');
    expect((body as Record<string, unknown>).workspaceId).toBe('all');
  });

  it('response includes period field', async () => {
    const { body } = await getJson('/api/ai-stats/usage');
    expect(body as Record<string, unknown>).toHaveProperty('period');
  });

  it('response includes timestamp field', async () => {
    const { body } = await getJson('/api/ai-stats/usage');
    expect(body as Record<string, unknown>).toHaveProperty('timestamp');
  });

  it('returns 200 with ?workspaceId scoped to a known workspace', async () => {
    const { status, body } = await getJson(
      `/api/ai-stats/usage?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).workspaceId).toBe(ws.workspaceId);
  });

  it('returns 200 with ?workspaceId for an unknown workspace (in-memory, no 404)', async () => {
    const { status } = await getJson(
      '/api/ai-stats/usage?workspaceId=nonexistent-workspace',
    );
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

describe('GET /api/ai-stats/summary', () => {
  it('returns 200', async () => {
    const { status } = await getJson('/api/ai-stats/summary');
    expect(status).toBe(200);
  });

  it('response includes deduplication key', async () => {
    const { body } = await getJson('/api/ai-stats/summary');
    expect(body as Record<string, unknown>).toHaveProperty('deduplication');
  });

  it('response includes usage key', async () => {
    const { body } = await getJson('/api/ai-stats/summary');
    expect(body as Record<string, unknown>).toHaveProperty('usage');
  });

  it('response includes period field', async () => {
    const { body } = await getJson('/api/ai-stats/summary');
    expect(body as Record<string, unknown>).toHaveProperty('period');
  });

  it('deduplication sub-object includes cacheHitRate', async () => {
    const { body } = await getJson('/api/ai-stats/summary');
    const dedup = (body as Record<string, unknown>).deduplication as Record<string, unknown>;
    expect(dedup).toHaveProperty('cacheHitRate');
    expect(typeof dedup.cacheHitRate).toBe('number');
  });

  it('usage sub-object includes totalTokens and totalCalls', async () => {
    const { body } = await getJson('/api/ai-stats/summary');
    const usage = (body as Record<string, unknown>).usage as Record<string, unknown>;
    expect(usage).toHaveProperty('totalTokens');
    expect(usage).toHaveProperty('totalCalls');
  });

  it('returns 200 with ?workspaceId scoped to a known workspace', async () => {
    const { status, body } = await getJson(
      `/api/ai-stats/summary?workspaceId=${ws.workspaceId}`,
    );
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).workspaceId).toBe(ws.workspaceId);
  });
});
