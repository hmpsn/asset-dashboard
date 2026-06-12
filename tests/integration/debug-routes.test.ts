/**
 * Integration tests: GET /api/debug/prompt
 *
 * Tests validation paths without needing external APIs.
 * The debug endpoint is not disabled in the test environment
 * (DISABLE_DEBUG_ENDPOINTS is not set).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Debug Routes WS').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/debug/prompt — validation', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const res = await api('/api/debug/prompt');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('workspaceId');
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await api('/api/debug/prompt?workspaceId=ws_does_not_exist_debug_99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when all specified slices are invalid', async () => {
    const res = await api(`/api/debug/prompt?workspaceId=${wsId}&slices=fakeSlice,anotherFake`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('slices');
  });

  it('returns 200 text/plain for a valid workspace with default slices', async () => {
    const res = await api(`/api/debug/prompt?workspaceId=${wsId}`);
    // Should succeed — returns formatted prompt text
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/plain');
    const text = await res.text();
    expect(typeof text).toBe('string');
  });

  it('returns 200 with a subset of valid slices', async () => {
    const res = await api(`/api/debug/prompt?workspaceId=${wsId}&slices=seoContext,learnings`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/plain');
  });

  it('filters out invalid slices and proceeds when at least one valid slice remains', async () => {
    const res = await api(`/api/debug/prompt?workspaceId=${wsId}&slices=seoContext,invalidSlice`);
    // 'seoContext' is valid so the request should succeed
    expect(res.status).toBe(200);
  });

  it('respects verbosity=compact query param', async () => {
    const res = await api(`/api/debug/prompt?workspaceId=${wsId}&slices=seoContext&verbosity=compact`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/plain');
  });
});
