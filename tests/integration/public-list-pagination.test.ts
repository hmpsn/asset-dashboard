/**
 * Integration tests for additive limit/offset pagination on public list endpoints.
 *
 * Contract:
 * - No params → original unpaginated shape (array or object) is unchanged.
 * - limit + offset → { items, pageInfo: { total, limit, offset, hasMore } }.
 * - Invalid params (non-integer, negative, limit > 200) → treated as absent (unpaginated).
 * - Max limit clamp: limit=201 → treated as absent (full list).
 * - Auth and workspace scoping unchanged.
 *
 * Covered endpoints:
 *   GET /api/public/approvals/:workspaceId
 *   GET /api/public/client-actions/:workspaceId
 *   GET /api/public/content-requests/:workspaceId
 *   GET /api/public/requests/:workspaceId
 *   GET /api/public/keyword-feedback/:workspaceId
 *   GET /api/public/page-keywords/:workspaceId
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let wsId = '';

// ── Fixture setup ────────────────────────────────────────────────────────────

/** Insert N approval batches directly into DB. */
function insertApprovalBatches(workspaceId: string, count: number) {
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `batch-pag-${randomUUID().slice(0, 8)}-${i}`;
    ids.push(id);
    db.prepare(`
      INSERT INTO approval_batches (id, workspace_id, site_id, name, items, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
    `).run(id, workspaceId, `site-${i}`, `Batch ${i}`, '[]', now, now);
  }
  return ids;
}

/** Insert N client actions directly into DB. */
function insertClientActions(workspaceId: string, count: number) {
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `action-pag-${randomUUID().slice(0, 8)}-${i}`;
    ids.push(id);
    db.prepare(`
      INSERT INTO client_actions (id, workspace_id, source_type, source_id, title, summary, payload, status, priority, client_note, created_at, updated_at)
      VALUES (?, ?, 'aeo_change', NULL, ?, '', '{}', 'pending', 'medium', NULL, ?, ?)
    `).run(id, workspaceId, `Action ${i}`, now, now);
  }
  return ids;
}

/** Insert N content requests directly into DB. */
function insertContentRequests(workspaceId: string, count: number) {
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `req-pag-${randomUUID().slice(0, 8)}-${i}`;
    ids.push(id);
    db.prepare(`
      INSERT INTO content_topic_requests
        (id, workspace_id, topic, target_keyword, intent, priority, rationale, status,
         brief_id, post_id, client_note, internal_note, decline_reason, client_feedback,
         source, service_type, page_type, upgraded_at, delivery_url, delivery_notes,
         target_page_id, target_page_slug, comments, requested_at, updated_at)
      VALUES (?, ?, ?, ?, 'informational', 'medium', 'Test', 'requested',
              NULL, NULL, NULL, NULL, NULL, NULL,
              'strategy', 'brief_only', 'blog', NULL, NULL, NULL,
              NULL, NULL, '[]', ?, ?)
    `).run(id, workspaceId, `Topic ${i}`, `keyword-${i}`, now, now);
  }
  return ids;
}

/** Insert N client requests directly into DB. */
function insertRequests(workspaceId: string, count: number) {
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `cl-req-pag-${randomUUID().slice(0, 8)}-${i}`;
    ids.push(id);
    db.prepare(`
      INSERT INTO requests (id, workspace_id, title, description, category, priority, status, submitted_by, page_url, page_id, attachments, notes, created_at, updated_at)
      VALUES (?, ?, ?, 'desc', 'bug', 'medium', 'open', NULL, NULL, NULL, NULL, '[]', ?, ?)
    `).run(id, workspaceId, `Request ${i}`, now, now);
  }
  return ids;
}

/** Insert N keyword feedback rows directly into DB. */
function insertKeywordFeedback(workspaceId: string, count: number) {
  const now = new Date().toISOString();
  const keywords: string[] = [];
  for (let i = 0; i < count; i++) {
    const kw = `kw-pag-${randomUUID().slice(0, 8)}-${i}`;
    keywords.push(kw);
    db.prepare(`
      INSERT OR REPLACE INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by, created_at, updated_at)
      VALUES (?, ?, 'approved', NULL, NULL, NULL, ?, ?)
    `).run(workspaceId, kw, now, now);
  }
  return keywords;
}

/** Insert N page keywords directly into DB. */
function insertPageKeywords(workspaceId: string, count: number) {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = `/pag-page-${i}`;
    paths.push(path);
    db.prepare(`
      INSERT OR REPLACE INTO page_keywords
        (workspace_id, page_path, page_title, primary_keyword, secondary_keywords,
         search_intent, current_position, previous_position, impressions, clicks,
         gsc_keywords, volume, difficulty, cpc, secondary_metrics, metrics_source, validated,
         url_level_keywords, url_level_keyword_source,
         optimization_score, analysis_generated_at, optimization_issues, recommendations,
         content_gaps, primary_keyword_presence, long_tail_keywords, competitor_keywords,
         estimated_difficulty, keyword_difficulty, monthly_volume, topic_cluster, search_intent_confidence,
         serp_features, missing_trust_signals, eeat_asset_recommendations)
      VALUES (?, ?, ?, ?, '[]',
              NULL, NULL, NULL, NULL, NULL,
              '[]', NULL, NULL, NULL, NULL, NULL, 0,
              NULL, NULL,
              NULL, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL,
              NULL, NULL, NULL, NULL, NULL,
              NULL, NULL, NULL)
    `).run(workspaceId, path, `Page ${i}`, `keyword-${i}`);
  }
  return paths;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Pagination Test WS').id;

  // Seed 5 rows in each table so we can test limit < total.
  insertApprovalBatches(wsId, 5);
  insertClientActions(wsId, 5);
  insertContentRequests(wsId, 5);
  insertRequests(wsId, 5);
  insertKeywordFeedback(wsId, 5);
  insertPageKeywords(wsId, 5);
});

afterAll(async () => {
  db.prepare('DELETE FROM approval_batches WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM client_actions WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM requests WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getJson(path: string) {
  const res = await api(path);
  expect(res.status).toBe(200);
  return res.json();
}

function assertPageInfo(
  pageInfo: { total: number; limit: number; offset: number; hasMore: boolean },
  expected: { total: number; limit: number; offset: number; hasMore: boolean },
) {
  expect(pageInfo.total).toBe(expected.total);
  expect(pageInfo.limit).toBe(expected.limit);
  expect(pageInfo.offset).toBe(expected.offset);
  expect(pageInfo.hasMore).toBe(expected.hasMore);
}

// ── Approval batches ─────────────────────────────────────────────────────────

describe('GET /api/public/approvals/:workspaceId — pagination', () => {
  it('default (no params) returns an array (unchanged shape)', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}`);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(5);
    // No pageInfo in unpaginated response
    expect(body.pageInfo).toBeUndefined();
  });

  it('limit=2 returns { items, pageInfo } with 2 items and hasMore=true', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}?limit=2`);
    expect(Array.isArray(body)).toBe(false);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(2);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 0, hasMore: true });
  });

  it('limit=2&offset=4 returns last 1 item and hasMore=false', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}?limit=2&offset=4`);
    expect(body.items).toHaveLength(1);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 4, hasMore: false });
  });

  it('limit=10 returns all 5 items and hasMore=false', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}?limit=10`);
    expect(body.items).toHaveLength(5);
    assertPageInfo(body.pageInfo, { total: 5, limit: 10, offset: 0, hasMore: false });
  });

  it('invalid limit (non-integer) falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}?limit=abc`);
    expect(Array.isArray(body)).toBe(true);
  });

  it('limit > 200 (exceeds max) falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}?limit=201`);
    expect(Array.isArray(body)).toBe(true);
  });

  it('negative offset falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/approvals/${wsId}?limit=2&offset=-1`);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Client actions ───────────────────────────────────────────────────────────

describe('GET /api/public/client-actions/:workspaceId — pagination', () => {
  it('default (no params) returns an array (unchanged shape)', async () => {
    const body = await getJson(`/api/public/client-actions/${wsId}`);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=2 returns paginated shape with 2 items', async () => {
    const body = await getJson(`/api/public/client-actions/${wsId}?limit=2`);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(2);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 0, hasMore: true });
  });

  it('limit=2&offset=4 returns 1 item hasMore=false', async () => {
    const body = await getJson(`/api/public/client-actions/${wsId}?limit=2&offset=4`);
    expect(body.items).toHaveLength(1);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 4, hasMore: false });
  });

  it('invalid limit falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/client-actions/${wsId}?limit=bad`);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Content requests ─────────────────────────────────────────────────────────

describe('GET /api/public/content-requests/:workspaceId — pagination', () => {
  it('default (no params) returns an array (unchanged shape)', async () => {
    const body = await getJson(`/api/public/content-requests/${wsId}`);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=3 returns paginated shape with 3 items', async () => {
    const body = await getJson(`/api/public/content-requests/${wsId}?limit=3`);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(3);
    assertPageInfo(body.pageInfo, { total: 5, limit: 3, offset: 0, hasMore: true });
  });

  it('limit=3&offset=3 returns 2 items hasMore=false', async () => {
    const body = await getJson(`/api/public/content-requests/${wsId}?limit=3&offset=3`);
    expect(body.items).toHaveLength(2);
    assertPageInfo(body.pageInfo, { total: 5, limit: 3, offset: 3, hasMore: false });
  });

  it('invalid limit falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/content-requests/${wsId}?limit=xyz`);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Client requests ──────────────────────────────────────────────────────────

describe('GET /api/public/requests/:workspaceId — pagination', () => {
  it('default (no params) returns an array (unchanged shape)', async () => {
    const body = await getJson(`/api/public/requests/${wsId}`);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=2 returns paginated shape with 2 items', async () => {
    const body = await getJson(`/api/public/requests/${wsId}?limit=2`);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(2);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 0, hasMore: true });
  });

  it('limit=2&offset=4 returns 1 item hasMore=false', async () => {
    const body = await getJson(`/api/public/requests/${wsId}?limit=2&offset=4`);
    expect(body.items).toHaveLength(1);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 4, hasMore: false });
  });

  it('invalid limit falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/requests/${wsId}?limit=nope`);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Keyword feedback ─────────────────────────────────────────────────────────

describe('GET /api/public/keyword-feedback/:workspaceId — pagination', () => {
  it('default (no params) returns an array (unchanged shape)', async () => {
    const body = await getJson(`/api/public/keyword-feedback/${wsId}`);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=2 returns paginated shape with 2 items', async () => {
    const body = await getJson(`/api/public/keyword-feedback/${wsId}?limit=2`);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(2);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 0, hasMore: true });
  });

  it('limit=2&offset=4 returns 1 item hasMore=false', async () => {
    const body = await getJson(`/api/public/keyword-feedback/${wsId}?limit=2&offset=4`);
    expect(body.items).toHaveLength(1);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 4, hasMore: false });
  });

  it('invalid limit falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/keyword-feedback/${wsId}?limit=!bad`);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Page keywords ─────────────────────────────────────────────────────────────

describe('GET /api/public/page-keywords/:workspaceId — pagination', () => {
  it('default (no params) returns an array (unchanged shape)', async () => {
    const body = await getJson(`/api/public/page-keywords/${wsId}`);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(5);
  });

  it('limit=2 returns paginated shape with 2 items', async () => {
    const body = await getJson(`/api/public/page-keywords/${wsId}?limit=2`);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(2);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 0, hasMore: true });
  });

  it('limit=2&offset=4 returns 1 item hasMore=false', async () => {
    const body = await getJson(`/api/public/page-keywords/${wsId}?limit=2&offset=4`);
    expect(body.items).toHaveLength(1);
    assertPageInfo(body.pageInfo, { total: 5, limit: 2, offset: 4, hasMore: false });
  });

  it('invalid limit falls back to unpaginated array', async () => {
    const body = await getJson(`/api/public/page-keywords/${wsId}?limit=abc`);
    expect(Array.isArray(body)).toBe(true);
  });
});
