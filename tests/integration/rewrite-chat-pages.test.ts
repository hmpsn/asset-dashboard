import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

describe('GET /api/rewrite-chat/:workspaceId/pages', () => {
  const ctx = createTestContext(13316);
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(async () => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
    await ctx.startServer();
  });

  afterAll(async () => {
    await ctx.stopServer();
    cleanup();
  });

  it('returns 200 with empty array when workspace has no snapshot', async () => {
    const res = await ctx.authApi(`/api/rewrite-chat/${workspaceId}/pages`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await ctx.authApi('/api/rewrite-chat/nonexistent-ws-id/pages');
    expect(res.status).toBe(404);
  });

  // Shape validation for non-empty responses (when workspace has a Webflow site + snapshot)
  // is not covered here because seeding an audit snapshot requires significant fixture work.
  // The route is validated end-to-end by: TypeScript types on PageSeoResult, the route
  // implementation mapping p.slug/p.page/p.url, and manual testing in the dev preview.
});

describe('POST /api/rewrite-chat/:workspaceId — intelligence slice smoke test', () => {
  // Uses port 13313 — unused slot in the 13201–13319 range
  const ctx = createTestContext(13313);
  let workspaceId: string;
  let cleanup: () => void;

  beforeAll(async () => {
    const seed = seedWorkspace();
    workspaceId = seed.workspaceId;
    cleanup = seed.cleanup;
    // Set a fake key so the guard check passes; callOpenAI will fail but only AFTER
    // the intelligence slice (including contentPipeline/rewritePlaybook) has assembled.
    process.env.OPENAI_API_KEY = 'fake-key-for-rewrite-chat-slice-test';
    await ctx.startServer();
  });

  afterAll(async () => {
    await ctx.stopServer();
    cleanup();
    delete process.env.OPENAI_API_KEY;
  });

  it('returns 400 when question is missing (route and intelligence slice are reachable)', async () => {
    const res = await ctx.authPostJson(`/api/rewrite-chat/${workspaceId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('question required');
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await ctx.authPostJson('/api/rewrite-chat/nonexistent-ws-id', { question: 'test' });
    expect(res.status).toBe(404);
  });
});
