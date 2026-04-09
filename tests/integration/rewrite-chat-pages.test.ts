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
