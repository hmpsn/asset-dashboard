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

  it('returns items shaped as { slug, title, url } when snapshot exists', async () => {
    const res = await ctx.authApi(`/api/rewrite-chat/${workspaceId}/pages`);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    if (body.length > 0) {
      const item = body[0] as Record<string, unknown>;
      expect(typeof item.slug).toBe('string');
      expect(typeof item.title).toBe('string');
      expect(typeof item.url).toBe('string');
    }
  });
});
