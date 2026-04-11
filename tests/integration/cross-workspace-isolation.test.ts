/**
 * Cross-workspace data isolation tests.
 *
 * Verifies that workspace-scoped queries never leak data across workspace
 * boundaries. Data inserted into workspace A must not appear when querying
 * through workspace B's scope — via both direct DB module calls and HTTP API
 * endpoints.
 *
 * Data types tested:
 *   1. Analytics insights  (analytics_insights table)
 *   2. Approval batches    (approval_batches table)
 *   3. Content requests    (content_topic_requests table)
 *
 * Public API endpoints tested (workspaceId parameter isolation):
 *   - GET /api/public/insights/:workspaceId
 *   - GET /api/public/content-requests/:workspaceId
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { cleanSeedData } from '../global-setup.js';
import { upsertInsight, getInsights } from '../../server/analytics-insights-store.js';
import { createBatch, listBatches, getBatch } from '../../server/approvals.js';
import {
  createContentRequest,
  listContentRequests,
  getContentRequest,
} from '../../server/content-requests.js';

const ctx = createTestContext(13308);
const { api } = ctx;

let wsAId = '';
let wsBId = '';
let wsAWebflowSiteId = '';
let cleanupWorkspaces: () => void;

// IDs for data seeded into workspace A
let wsABatchId = '';
let wsAInsightId = '';
let wsAContentReqId = '';

beforeAll(async () => {
  await ctx.startServer();

  // Seed workspaces without a clientPassword so the public API session
  // enforcement middleware (app.ts) allows unauthenticated access during tests.
  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsAId = wsA.workspaceId;
  wsBId = wsB.workspaceId;
  wsAWebflowSiteId = wsA.webflowSiteId;
  cleanupWorkspaces = () => { wsA.cleanup(); wsB.cleanup(); };

  // ── Seed workspace A with one insight ──────────────────────────
  const insight = upsertInsight({
    workspaceId: wsAId,
    pageId: '/blog/ws-a-isolation-test',
    insightType: 'ranking_opportunity',
    data: { query: 'workspace a unique query', currentPosition: 5 },
    severity: 'opportunity',
    impactScore: 80,
  });
  wsAInsightId = insight.id;

  // ── Seed workspace A with one approval batch ───────────────────
  const batch = createBatch(wsAId, wsAWebflowSiteId, 'WS-A Isolation Batch', [
    {
      pageId: 'page_ws_a_only',
      pageSlug: '/ws-a-only',
      pageTitle: 'WS-A Only Page',
      field: 'seoTitle',
      currentValue: 'Old Title',
      proposedValue: 'WS-A New Title',
    },
  ]);
  wsABatchId = batch.id;

  // ── Seed workspace A with one content request ──────────────────
  const req = createContentRequest(wsAId, {
    topic: 'WS-A Exclusive Topic',
    targetKeyword: 'ws-a-exclusive-keyword-xqz',
    intent: 'informational',
    priority: 'high',
    rationale: 'Testing cross-workspace isolation',
    source: 'strategy',
  });
  wsAContentReqId = req.id;
}, 25_000);

afterAll(() => {
  cleanSeedData(wsAId);
  cleanSeedData(wsBId);
  cleanupWorkspaces();
  ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Analytics Insights isolation (direct module calls)
// ─────────────────────────────────────────────────────────────────────────────

describe('Analytics Insights — cross-workspace isolation', () => {
  it('getInsights(wsB) returns empty array when only wsA has insights', () => {
    const results = getInsights(wsBId);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('getInsights(wsA) returns the seeded insight', () => {
    const results = getInsights(wsAId);
    expect(results.length > 0 && results.every(i => i.workspaceId === wsAId)).toBe(true);
  });

  it('getInsights(wsB) never contains wsA insight id', () => {
    const results = getInsights(wsBId);
    const ids = results.map(i => i.id);
    expect(ids).not.toContain(wsAInsightId);
  });

  it('getInsights with type filter on wsB returns empty array', () => {
    const results = getInsights(wsBId, 'ranking_opportunity');
    expect(results.length).toBe(0);
  });

  it('inserting into wsB does not affect wsA insight list', () => {
    upsertInsight({
      workspaceId: wsBId,
      pageId: '/blog/ws-b-page',
      insightType: 'page_health',
      data: { score: 70 },
      severity: 'warning',
      impactScore: 30,
    });

    const wsAResults = getInsights(wsAId);
    const wsBResults = getInsights(wsBId);

    expect(wsAResults.length > 0 && wsAResults.every(i => i.workspaceId === wsAId)).toBe(true);

    expect(wsBResults.length > 0 && wsBResults.every(i => i.workspaceId === wsBId)).toBe(true);

    // Workspace IDs must not cross over
    const wsAIds = new Set(wsAResults.map(i => i.id));
    const wsBIds = new Set(wsBResults.map(i => i.id));
    for (const id of wsAIds) {
      expect(wsBIds.has(id)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Approval Batches isolation (direct module calls)
// ─────────────────────────────────────────────────────────────────────────────

describe('Approval Batches — cross-workspace isolation', () => {
  it('listBatches(wsB) returns empty array when only wsA has batches', () => {
    const results = listBatches(wsBId);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('listBatches(wsA) returns the seeded batch', () => {
    const results = listBatches(wsAId);
    expect(results.length > 0 && results.every(b => b.workspaceId === wsAId)).toBe(true);
  });

  it('listBatches(wsB) never contains wsA batch id', () => {
    const results = listBatches(wsBId);
    const ids = results.map(b => b.id);
    expect(ids).not.toContain(wsABatchId);
  });

  it('getBatch with wsA batchId scoped to wsB returns undefined', () => {
    // Attempting to look up wsA's batch using wsB's workspace scope must fail
    const result = getBatch(wsBId, wsABatchId);
    expect(result).toBeUndefined();
  });

  it('getBatch with wsA batchId scoped to wsA returns the batch', () => {
    const result = getBatch(wsAId, wsABatchId);
    expect(result).toBeDefined();
    expect(result!.id).toBe(wsABatchId);
    expect(result!.workspaceId).toBe(wsAId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Content Requests isolation (direct module calls)
// ─────────────────────────────────────────────────────────────────────────────

describe('Content Requests — cross-workspace isolation', () => {
  it('listContentRequests(wsB) returns empty array when only wsA has requests', () => {
    const results = listContentRequests(wsBId);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('listContentRequests(wsA) returns the seeded content request', () => {
    const results = listContentRequests(wsAId);
    expect(results.length > 0 && results.every(r => r.workspaceId === wsAId)).toBe(true);
  });

  it('listContentRequests(wsB) never contains wsA content request id', () => {
    const results = listContentRequests(wsBId);
    const ids = results.map(r => r.id);
    expect(ids).not.toContain(wsAContentReqId);
  });

  it('getContentRequest with wsA id scoped to wsB returns undefined', () => {
    const result = getContentRequest(wsBId, wsAContentReqId);
    expect(result).toBeUndefined();
  });

  it('getContentRequest with wsA id scoped to wsA returns the request', () => {
    const result = getContentRequest(wsAId, wsAContentReqId);
    expect(result).toBeDefined();
    expect(result!.id).toBe(wsAContentReqId);
    expect(result!.workspaceId).toBe(wsAId);
    expect(result!.targetKeyword).toBe('ws-a-exclusive-keyword-xqz');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Public API endpoint isolation (HTTP)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights/:workspaceId — HTTP isolation', () => {
  it('returns 200 and non-empty array for wsA', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Every returned insight must belong to wsA
    expect(body.length > 0 && body.every((i: { workspaceId: string }) => i.workspaceId === wsAId)).toBe(true);
  });

  it('returns 200 and does NOT include wsA insight when querying wsB', async () => {
    const res = await api(`/api/public/insights/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const ids = (body as Array<{ id: string }>).map(i => i.id);
    expect(ids).not.toContain(wsAInsightId);
  });

  it('returns 200 and only wsB insights when querying wsB after seeding wsB', async () => {
    // wsB already has a page_health insight inserted in the module-level test above.
    // The HTTP layer must scope it correctly.
    const res = await api(`/api/public/insights/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;

    // Every wsB insight must belong to wsB (filter-based assertion safe for empty arrays)
    expect(body.filter((i: { workspaceId: string }) => i.workspaceId !== wsBId).length).toBe(0);
  });

  it('returns 404 for a non-existent workspace id', async () => {
    const res = await api('/api/public/insights/ws_does_not_exist_xyz');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/content-requests/:workspaceId — HTTP isolation', () => {
  it('returns 200 and non-empty array for wsA', async () => {
    const res = await api(`/api/public/content-requests/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('does NOT include wsA content request id when querying wsB', async () => {
    const res = await api(`/api/public/content-requests/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const ids = (body as Array<{ id: string }>).map(r => r.id);
    expect(ids).not.toContain(wsAContentReqId);
  });

  it('does NOT include wsA exclusive keyword in wsB response', async () => {
    const res = await api(`/api/public/content-requests/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ targetKeyword: string }>;

    const keywords = body.map(r => r.targetKeyword);
    expect(keywords).not.toContain('ws-a-exclusive-keyword-xqz');
  });

  it('returns 404 for a non-existent workspace id', async () => {
    const res = await api('/api/public/content-requests/ws_does_not_exist_xyz');
    expect(res.status).toBe(404);
  });
});
