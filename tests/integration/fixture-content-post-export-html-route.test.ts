import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { seedContentData, type SeededContent } from '../fixtures/content-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);

let seededContent: SeededContent | null = null;
let seededAuth: SeededAuth | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seededContent = seedContentData();
  seededAuth = await seedAuthData();
});

afterAll(async () => {
  seededAuth?.cleanup();
  seededContent?.cleanup();
  await ctx.stopServer();
});

describe('Content post HTML export route with fixture-seeded content data', () => {
  it('GET /api/content-posts/:workspaceId/:postId/export/html returns well-formed HTML with expected content-type and seeded content', async () => {
    const postRes = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(postRes.status).toBe(200);

    const post = await postRes.json() as { title: string; targetKeyword: string };

    const exportRes = await ctx.api(
      `/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}/export/html`,
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('text/html');

    const html = await exportRes.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="description"');
    expect(html).toContain('<body>');
    expect(html).toContain('</html>');
    expect(html).toContain(post.title);
    expect(html.toLowerCase()).toContain(post.targetKeyword.toLowerCase());
  });

  it('GET /api/content-posts/:workspaceId/:postId/export/html denies cross-workspace JWT access', async () => {
    ctx.setAuthToken(seededAuth!.adminToken);

    const res = await ctx.authApi(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}/export/html`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'You do not have access to this workspace' });
  });

  it('GET /api/content-posts/:workspaceId/:postId/export/html treats invalid bearer token as unauthenticated and still returns HTML', async () => {
    ctx.setAuthToken('invalid.token.value');

    const res = await ctx.authApi(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}/export/html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('GET /api/content-posts/:workspaceId/:postId/export/html returns 404 JSON for unknown post id', async () => {
    const res = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/post_does_not_exist/export/html`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Post not found' });
  });

  it('GET /api/content-posts/:workspaceId/:postId/export/html returns 404 JSON for invalid post id value', async () => {
    const res = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/%20/export/html`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Post not found' });
  });

  it('GET /api/content-posts/:workspaceId/:postId/export/html returns 404 when post id route segment is missing', async () => {
    const res = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}//export/html`);
    expect(res.status).toBe(404);
  });
});
