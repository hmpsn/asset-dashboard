import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedContentData, type SeededContent } from '../fixtures/content-seed.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);

let seededContent: SeededContent | null = null;
let foreignAuth: SeededAuth | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seededContent = seedContentData();
  foreignAuth = await seedAuthData();
}, 30_000);

afterAll(async () => {
  seededContent?.cleanup();
  foreignAuth?.cleanup();
  await ctx.stopServer();
});

describe('Content post routes with fixture-seeded content data', () => {
  it('GET /api/content-posts/:workspaceId includes the seeded post', async () => {
    const res = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seededContent!.postId,
          workspaceId: seededContent!.workspaceId,
        }),
      ]),
    );
  });

  it('GET /api/content-posts/:workspaceId/:postId returns the seeded post', async () => {
    const res = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(seededContent!.postId);
    expect(body.workspaceId).toBe(seededContent!.workspaceId);
  });

  it('GET /api/content-posts/:workspaceId/:postId/export/markdown returns markdown-ish payload with seeded signals', async () => {
    const postRes = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(postRes.status).toBe(200);
    const post = await postRes.json();

    const exportRes = await ctx.api(
      `/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}/export/markdown`,
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('text/markdown');

    const markdown = await exportRes.text();
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).toContain(post.title);
    expect(markdown.toLowerCase()).toContain(String(post.targetKeyword).toLowerCase());
  });

  it('GET /api/content-posts/:workspaceId/:postId returns 404 for unknown post', async () => {
    const res = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/post_does_not_exist`);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/content-posts/:workspaceId/:postId rejects invalid post status transitions without mutating keyword-linked content', async () => {
    const beforeRes = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(beforeRes.status).toBe(200);
    const beforePost = await beforeRes.json() as { status: string; targetKeyword: string; title: string; generationRevision: number };
    expect(beforePost.status).toBe('draft');

    const res = await ctx.patchJson(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`, {
      status: 'approved',
      title: `Should not persist ${Date.now()}`,
      expectedRevision: beforePost.generationRevision,
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid post transition: 'draft' → 'approved'");

    const afterRes = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(afterRes.status).toBe(200);
    const afterPost = await afterRes.json() as { status: string; targetKeyword: string; title: string };
    expect(afterPost.status).toBe(beforePost.status);
    expect(afterPost.title).toBe(beforePost.title);
    expect(afterPost.targetKeyword).toBe(beforePost.targetKeyword);
  });

  it('PATCH /api/content-posts/:workspaceId/:postId rejects malformed request bodies (strict top-level keys + invalid status enum)', async () => {
    const badTopLevel = await ctx.patchJson(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`, {
      expectedRevision: 0,
      unknownField: true,
    });
    expect(badTopLevel.status).toBe(400);

    const badStatus = await ctx.patchJson(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`, {
      expectedRevision: 0,
      status: 'in_review',
    });
    expect(badStatus.status).toBe(400);
  });

  it('PATCH /api/content-posts/:workspaceId/:postId rejects duplicate section indexes and preserves persisted state', async () => {
    const beforeRes = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(beforeRes.status).toBe(200);
    const beforePost = await beforeRes.json() as { sections: unknown[]; generationRevision: number };

    const res = await ctx.patchJson(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`, {
      sections: [
        { index: 0, heading: 'H1', content: '<p>A</p>', wordCount: 50 },
        { index: 0, heading: 'H2', content: '<p>B</p>', wordCount: 60 },
      ],
      expectedRevision: beforePost.generationRevision,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Duplicate section index 0' });

    const afterRes = await ctx.api(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(afterRes.status).toBe(200);
    const afterPost = await afterRes.json() as { sections: unknown[] };
    expect(afterPost.sections).toEqual(beforePost.sections);
  });

  it('enforces workspace boundaries for JWT users on content-post routes', async () => {
    ctx.setAuthToken(foreignAuth!.adminToken);

    const readRes = await ctx.authApi(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`);
    expect(readRes.status).toBe(403);
    expect(await readRes.json()).toEqual({ error: 'You do not have access to this workspace' });

    const patchRes = await ctx.authPatchJson(`/api/content-posts/${seededContent!.workspaceId}/${seededContent!.postId}`, {
      title: 'Cross-workspace write should fail',
    });
    expect(patchRes.status).toBe(403);
    expect(await patchRes.json()).toEqual({ error: 'You do not have access to this workspace' });

    ctx.setAuthToken('');
  });
});
