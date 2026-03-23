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
import db from '../../server/db/index.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13203);
const { api, postJson, patchJson, del } = ctx;

const testWsId = 'ws_integ_content_' + Date.now();

beforeAll(async () => {
  // Seed workspace so FK constraints on content tables are satisfied
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId, 'Test Content WS', testWsId, new Date().toISOString());
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

// Seed a brief directly via SQLite (since generateBrief requires OpenAI)
function seedBrief(id: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO content_briefs
       (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
        suggested_meta_desc, outline, word_count_target, intent, audience,
        competitor_insights, internal_link_suggestions, created_at)
     VALUES
       (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
        @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
        @competitor_insights, @internal_link_suggestions, @created_at)`,
  ).run({
    id,
    workspace_id: testWsId,
    target_keyword: 'integration test keyword',
    secondary_keywords: JSON.stringify(['test']),
    suggested_title: 'Integration Test Brief',
    suggested_meta_desc: 'Meta description',
    outline: JSON.stringify([{ heading: 'Section 1', notes: 'Notes', wordCount: 300, keywords: ['test'] }]),
    word_count_target: 1500,
    intent: 'informational',
    audience: 'general',
    competitor_insights: '',
    internal_link_suggestions: JSON.stringify(['/about']),
    created_at: new Date().toISOString(),
  });
}

// Seed a post directly via SQLite
function seedPost(id: string, briefId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO content_posts
       (id, workspace_id, brief_id, target_keyword, title, meta_description,
        introduction, sections, conclusion, total_word_count, target_word_count,
        status, created_at, updated_at)
     VALUES
       (@id, @workspace_id, @brief_id, @target_keyword, @title, @meta_description,
        @introduction, @sections, @conclusion, @total_word_count, @target_word_count,
        @status, @created_at, @updated_at)`,
  ).run({
    id,
    workspace_id: testWsId,
    brief_id: briefId,
    target_keyword: 'integration test keyword',
    title: 'Integration Test Post',
    meta_description: 'Post meta description',
    introduction: '<p>Test introduction</p>',
    sections: JSON.stringify([
      { index: 0, heading: 'Section 1', content: '<p>Section 1 content</p>', wordCount: 150, targetWordCount: 300, keywords: ['test'], status: 'done' },
    ]),
    conclusion: '<p>Test conclusion</p>',
    total_word_count: 300,
    target_word_count: 1500,
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function cleanup(): void {
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(testWsId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(testWsId);
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
