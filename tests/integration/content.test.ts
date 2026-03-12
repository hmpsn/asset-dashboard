/**
 * Integration tests for content briefs and content posts API endpoints.
 *
 * Tests CRUD operations via HTTP. Does NOT test AI generation (requires API keys).
 *
 * Briefs:
 * - GET /api/content-briefs/:workspaceId
 * - GET /api/content-briefs/:workspaceId/:briefId
 * - PATCH /api/content-briefs/:workspaceId/:briefId
 * - DELETE /api/content-briefs/:workspaceId/:briefId
 *
 * Posts:
 * - GET /api/content-posts/:workspaceId
 * - GET /api/content-posts/:workspaceId/:postId
 * - PATCH /api/content-posts/:workspaceId/:postId
 * - GET /api/content-posts/:workspaceId/:postId/export/markdown
 * - GET /api/content-posts/:workspaceId/:postId/export/html
 * - DELETE /api/content-posts/:workspaceId/:postId
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../../server/data-dir.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13203);
const { api, postJson, patchJson, del } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

const testWsId = 'ws_integ_content_' + Date.now();

// Seed a brief directly (since generateBrief requires OpenAI)
function seedBrief(id: string): void {
  const briefsDir = getDataDir('content-briefs');
  const fp = path.join(briefsDir, `${testWsId}.json`);
  let briefs: unknown[] = [];
  try {
    if (fs.existsSync(fp)) briefs = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { /* fresh */ }
  briefs.push({
    id,
    workspaceId: testWsId,
    targetKeyword: 'integration test keyword',
    secondaryKeywords: ['test'],
    suggestedTitle: 'Integration Test Brief',
    suggestedMetaDesc: 'Meta description',
    outline: [{ heading: 'Section 1', notes: 'Notes', wordCount: 300, keywords: ['test'] }],
    wordCountTarget: 1500,
    intent: 'informational',
    audience: 'general',
    competitorInsights: '',
    internalLinkSuggestions: ['/about'],
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(fp, JSON.stringify(briefs, null, 2));
}

// Seed a post directly
function seedPost(id: string, briefId: string): void {
  const postsDir = getDataDir('content-posts');
  const fp = path.join(postsDir, `${testWsId}.json`);
  let posts: unknown[] = [];
  try {
    if (fs.existsSync(fp)) posts = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { /* fresh */ }
  posts.push({
    id,
    workspaceId: testWsId,
    briefId,
    targetKeyword: 'integration test keyword',
    title: 'Integration Test Post',
    metaDescription: 'Post meta description',
    introduction: '<p>Test introduction</p>',
    sections: [
      { index: 0, heading: 'Section 1', content: '<p>Section 1 content</p>', wordCount: 150, targetWordCount: 300, keywords: ['test'], status: 'done' },
    ],
    conclusion: '<p>Test conclusion</p>',
    totalWordCount: 300,
    targetWordCount: 1500,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(fp, JSON.stringify(posts, null, 2));
}

function cleanup(): void {
  for (const dir of ['content-briefs', 'content-posts']) {
    const fp = path.join(getDataDir(dir), `${testWsId}.json`);
    try { fs.unlinkSync(fp); } catch { /* skip */ }
  }
}

afterAll(() => {
  cleanup();
});

// ── Content Briefs ──

describe('Content Briefs API', () => {
  const briefId = 'brief_integ_' + Date.now();

  it('GET /api/content-briefs/:wsId returns empty array initially', async () => {
    const res = await api(`/api/content-briefs/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns seeded brief after seeding', async () => {
    seedBrief(briefId);
    const res = await api(`/api/content-briefs/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(briefId);
  });

  it('GET /api/content-briefs/:wsId/:briefId returns specific brief', async () => {
    const res = await api(`/api/content-briefs/${testWsId}/${briefId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(briefId);
    expect(body.targetKeyword).toBe('integration test keyword');
  });

  it('GET /api/content-briefs/:wsId/:briefId with bad id returns 404', async () => {
    const res = await api(`/api/content-briefs/${testWsId}/brief_nonexistent`);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/content-briefs/:wsId/:briefId updates fields', async () => {
    const res = await patchJson(`/api/content-briefs/${testWsId}/${briefId}`, {
      suggestedTitle: 'Updated Brief Title',
      wordCountTarget: 2000,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestedTitle).toBe('Updated Brief Title');
    expect(body.wordCountTarget).toBe(2000);
  });

  it('POST /api/content-briefs/:wsId/generate without keyword returns 400', async () => {
    const res = await postJson(`/api/content-briefs/${testWsId}/generate`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('targetKeyword required');
  });

  it('GET /api/content-briefs/:wsId/:briefId/export returns HTML', async () => {
    const res = await api(`/api/content-briefs/${testWsId}/${briefId}/export`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Updated Brief Title');
  });

  it('DELETE /api/content-briefs/:wsId/:briefId removes brief', async () => {
    const res = await del(`/api/content-briefs/${testWsId}/${briefId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it's gone
    const getRes = await api(`/api/content-briefs/${testWsId}/${briefId}`);
    expect(getRes.status).toBe(404);
  });
});

// ── Content Posts ──

describe('Content Posts API', () => {
  const briefId = 'brief_post_integ_' + Date.now();
  const postId = 'post_integ_' + Date.now();

  it('GET /api/content-posts/:wsId returns empty array initially', async () => {
    const res = await api(`/api/content-posts/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns seeded post after seeding', async () => {
    seedBrief(briefId);
    seedPost(postId, briefId);
    const res = await api(`/api/content-posts/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    const ours = body.find((p: { id: string }) => p.id === postId);
    expect(ours).toBeDefined();
  });

  it('GET /api/content-posts/:wsId/:postId returns specific post', async () => {
    const res = await api(`/api/content-posts/${testWsId}/${postId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(postId);
    expect(body.title).toBe('Integration Test Post');
    expect(body.sections).toHaveLength(1);
  });

  it('GET /api/content-posts/:wsId/:postId with bad id returns 404', async () => {
    const res = await api(`/api/content-posts/${testWsId}/post_nonexistent`);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/content-posts/:wsId/:postId updates fields', async () => {
    const res = await patchJson(`/api/content-posts/${testWsId}/${postId}`, {
      title: 'Updated Post Title',
      status: 'review',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Updated Post Title');
    expect(body.status).toBe('review');
  });

  it('POST /api/content-posts/:wsId/generate without briefId returns 400', async () => {
    const res = await postJson(`/api/content-posts/${testWsId}/generate`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('briefId required');
  });

  it('GET /api/content-posts/:wsId/:postId/export/markdown returns markdown', async () => {
    const res = await api(`/api/content-posts/${testWsId}/${postId}/export/markdown`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/markdown');
    const md = await res.text();
    expect(md).toContain('Updated Post Title');
  });

  it('GET /api/content-posts/:wsId/:postId/export/html returns HTML', async () => {
    const res = await api(`/api/content-posts/${testWsId}/${postId}/export/html`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Updated Post Title');
  });

  it('DELETE /api/content-posts/:wsId/:postId removes post', async () => {
    const res = await del(`/api/content-posts/${testWsId}/${postId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it's gone
    const getRes = await api(`/api/content-posts/${testWsId}/${postId}`);
    expect(getRes.status).toBe(404);
  });
});
