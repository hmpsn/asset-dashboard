/**
 * Integration tests for misc uncovered routes — Wave 14
 *
 * Covers:
 *  - GET /api/ai-stats/deduplication
 *  - GET /api/ai-stats/usage
 *  - GET /api/ai-stats/summary
 *  - GET /api/revenue/summary
 *  - DELETE /api/revenue/payments/:id
 *  - DELETE /api/revenue/payments (all)
 *  - GET /api/workspace-badges/:id
 *  - GET /api/suggested-briefs/:workspaceId
 *  - GET /api/suggested-briefs/:workspaceId/:briefId
 *  - PATCH /api/suggested-briefs/:workspaceId/:briefId
 *  - POST /api/suggested-briefs/:workspaceId/:briefId/snooze
 *  - POST /api/suggested-briefs/:workspaceId/:briefId/dismiss
 */

import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import { createPayment, deleteAllPayments } from '../../server/payments.js';
import { createSuggestedBrief } from '../../server/suggested-briefs-store.js';
import db from '../../server/db/index.js';

// ── Pin SESSION_SECRET so the HMAC admin token is deterministic ───────────────
// The server derives: HMAC(sha256, SESSION_SECRET || APP_PASSWORD || random).update('admin')
// By pinning SESSION_SECRET here (before createTestContext reads process.env),
// it is spread into the spawned server's env, making the token predictable.
const TEST_SESSION_SECRET = 'test-ai-stats-session-secret-misc-wave14';
process.env.SESSION_SECRET = TEST_SESSION_SECRET;

const ctx = createTestContext(13384);
const { api, del, startServer, stopServer } = ctx;

// ── Admin HMAC token (mirrors server/middleware.ts: signAdminToken) ──────────
const ADMIN_HMAC_TOKEN = crypto
  .createHmac('sha256', TEST_SESSION_SECRET)
  .update('admin')
  .digest('hex');

function adminHeaders(): Record<string, string> {
  return { 'x-auth-token': ADMIN_HMAC_TOKEN };
}

async function adminApi(urlPath: string, opts: RequestInit = {}): Promise<Response> {
  return api(urlPath, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string> | undefined ?? {}),
      ...adminHeaders(),
    },
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let ws1: { workspaceId: string; cleanup: () => void } = { workspaceId: '', cleanup: () => {} };
let ws2: { workspaceId: string; cleanup: () => void } = { workspaceId: '', cleanup: () => {} };

beforeAll(async () => {
  await startServer();

  const pair = seedTwoWorkspaces();
  ws1 = pair.wsA;
  ws2 = pair.wsB;
}, 30_000);

afterAll(async () => {
  // Clean up payment and suggested_briefs rows created during tests
  db.prepare("DELETE FROM payments WHERE workspace_id LIKE 'test-ws-%'").run();
  db.prepare("DELETE FROM suggested_briefs WHERE workspace_id LIKE 'test-ws-%'").run();
  ws1.cleanup();
  ws2.cleanup();
  await stopServer();
  // Restore SESSION_SECRET so other test files in this process aren't affected
  delete process.env.SESSION_SECRET;
});

// ════════════════════════════════════════════════════════════════════════════
// ai-stats routes
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/ai-stats/deduplication', () => {
  it('returns deduplication stats shape', async () => {
    const res = await adminApi('/api/ai-stats/deduplication');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('pendingRequests');
    expect(body).toHaveProperty('cacheSize');
    expect(body).toHaveProperty('oldestPendingAge');
    expect(body).toHaveProperty('oldestCacheAge');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.pendingRequests).toBe('number');
    expect(typeof body.cacheSize).toBe('number');
  });

  it('returns 403 when no admin token provided', async () => {
    const res = await api('/api/ai-stats/deduplication');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Admin access required');
  });

  it('returns 403 when invalid admin token provided', async () => {
    const res = await api('/api/ai-stats/deduplication', {
      headers: { 'x-auth-token': 'bad-token-not-valid' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Admin access required');
  });
});

describe('GET /api/ai-stats/usage', () => {
  it('returns usage stats shape without params', async () => {
    const res = await adminApi('/api/ai-stats/usage');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('workspaceId');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('timestamp');
    expect(body.workspaceId).toBe('all');
  });

  it('returns usage stats scoped to a workspaceId param', async () => {
    const res = await adminApi(`/api/ai-stats/usage?workspaceId=${ws1.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(ws1.workspaceId);
  });

  it('accepts a since param and includes it in period', async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await adminApi(`/api/ai-stats/usage?since=${encodeURIComponent(since)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toMatch(/since/);
  });

  it('returns 403 when no admin token provided', async () => {
    const res = await api('/api/ai-stats/usage');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/ai-stats/summary', () => {
  it('returns summary with deduplication and usage sub-objects', async () => {
    const res = await adminApi('/api/ai-stats/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('deduplication');
    expect(body).toHaveProperty('usage');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('workspaceId');
    expect(body).toHaveProperty('timestamp');
    expect(body.period).toBe('last 7 days');
    expect(body.workspaceId).toBe('all');
    expect(typeof body.deduplication.cacheHitRate).toBe('number');
    expect(typeof body.usage.totalTokens).toBe('number');
    expect(typeof body.usage.totalCalls).toBe('number');
    expect(typeof body.usage.avgTokensPerCall).toBe('number');
  });

  it('returns summary scoped to a workspaceId', async () => {
    const res = await adminApi(`/api/ai-stats/summary?workspaceId=${ws1.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(ws1.workspaceId);
  });

  it('returns 403 when no admin token provided', async () => {
    const res = await api('/api/ai-stats/summary');
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// revenue routes
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/revenue/summary', () => {
  it('returns correct shape with no payments', async () => {
    // Start with clean state
    deleteAllPayments();

    const res = await api('/api/revenue/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalRevenue');
    expect(body).toHaveProperty('totalTransactions');
    expect(body).toHaveProperty('currentMonthRevenue');
    expect(body).toHaveProperty('prevMonthRevenue');
    expect(body).toHaveProperty('months');
    expect(body).toHaveProperty('byWorkspace');
    expect(body).toHaveProperty('byProduct');
    expect(body).toHaveProperty('recent');
    expect(body.totalRevenue).toBe(0);
    expect(body.totalTransactions).toBe(0);
    expect(Array.isArray(body.months)).toBe(true);
    expect(body.months).toHaveLength(12);
    expect(Array.isArray(body.byWorkspace)).toBe(true);
    expect(Array.isArray(body.byProduct)).toBe(true);
    expect(Array.isArray(body.recent)).toBe(true);
  });

  it('aggregates paid payments correctly', async () => {
    deleteAllPayments();

    const now = new Date().toISOString();
    createPayment(ws1.workspaceId, {
      workspaceId: ws1.workspaceId,
      stripeSessionId: 'sess_test_1',
      productType: 'content_item',
      amount: 5000,
      currency: 'usd',
      status: 'paid',
      paidAt: now,
    });
    createPayment(ws1.workspaceId, {
      workspaceId: ws1.workspaceId,
      stripeSessionId: 'sess_test_2',
      productType: 'content_item',
      amount: 3000,
      currency: 'usd',
      status: 'paid',
      paidAt: now,
    });
    // Pending payment — should NOT be included in revenue totals
    createPayment(ws2.workspaceId, {
      workspaceId: ws2.workspaceId,
      stripeSessionId: 'sess_test_3',
      productType: 'content_item',
      amount: 9999,
      currency: 'usd',
      status: 'pending',
    });

    const res = await api('/api/revenue/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRevenue).toBe(8000);
    expect(body.totalTransactions).toBe(2);
    expect(body.byWorkspace).toHaveLength(1);
    expect(body.byWorkspace[0].revenue).toBe(8000);
    expect(body.byProduct).toHaveLength(1);
    expect(body.byProduct[0].productType).toBe('content_item');
    expect(body.byProduct[0].revenue).toBe(8000);
  });

  it('recent payments list is capped at 20', async () => {
    deleteAllPayments();
    const now = new Date().toISOString();
    for (let i = 0; i < 25; i++) {
      createPayment(ws1.workspaceId, {
        workspaceId: ws1.workspaceId,
        stripeSessionId: `sess_cap_test_${i}`,
        productType: 'content_item',
        amount: 100,
        currency: 'usd',
        status: 'paid',
        paidAt: now,
      });
    }
    const res = await api('/api/revenue/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recent.length).toBeLessThanOrEqual(20);
  });
});

describe('DELETE /api/revenue/payments/:id', () => {
  it('deletes a known payment and returns ok', async () => {
    deleteAllPayments();
    const payment = createPayment(ws1.workspaceId, {
      workspaceId: ws1.workspaceId,
      stripeSessionId: 'sess_del_single',
      productType: 'content_item',
      amount: 1000,
      currency: 'usd',
      status: 'paid',
      paidAt: new Date().toISOString(),
    });

    const res = await del(`/api/revenue/payments/${payment.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it no longer appears in summary
    const summaryRes = await api('/api/revenue/summary');
    const summaryBody = await summaryRes.json();
    expect(summaryBody.totalTransactions).toBe(0);
  });

  it('returns 404 for unknown payment id', async () => {
    const res = await del('/api/revenue/payments/pay_does_not_exist_xyz');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Payment not found');
  });
});

describe('DELETE /api/revenue/payments (purge all)', () => {
  it('purges all payments and returns deleted count', async () => {
    deleteAllPayments();
    const now = new Date().toISOString();
    createPayment(ws1.workspaceId, {
      workspaceId: ws1.workspaceId,
      stripeSessionId: 'sess_purge_1',
      productType: 'content_item',
      amount: 500,
      currency: 'usd',
      status: 'paid',
      paidAt: now,
    });
    createPayment(ws2.workspaceId, {
      workspaceId: ws2.workspaceId,
      stripeSessionId: 'sess_purge_2',
      productType: 'tier_upgrade',
      amount: 2000,
      currency: 'usd',
      status: 'paid',
      paidAt: now,
    });

    const res = await del('/api/revenue/payments');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.deleted).toBe('number');
    expect(body.deleted).toBeGreaterThanOrEqual(2);

    // Verify clean state
    const summaryRes = await api('/api/revenue/summary');
    const summaryBody = await summaryRes.json();
    expect(summaryBody.totalTransactions).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// workspace-badges routes
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/workspace-badges/:id', () => {
  it('returns badge shape for workspace with no content', async () => {
    const res = await api(`/api/workspace-badges/${ws1.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('pendingRequests');
    expect(body).toHaveProperty('hasContent');
    expect(typeof body.pendingRequests).toBe('number');
    expect(typeof body.hasContent).toBe('boolean');
    expect(body.pendingRequests).toBe(0);
    expect(body.hasContent).toBe(false);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspace-badges/ws_does_not_exist_badge_test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });

  it('workspace isolation: ws1 badges are independent from ws2', async () => {
    // ws1 and ws2 are independent — both return 200 with their own counts
    const [res1, res2] = await Promise.all([
      api(`/api/workspace-badges/${ws1.workspaceId}`),
      api(`/api/workspace-badges/${ws2.workspaceId}`),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    // Each workspace's badge data should be independently valid shapes
    expect(typeof body1.pendingRequests).toBe('number');
    expect(typeof body2.pendingRequests).toBe('number');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// suggested-briefs routes
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/suggested-briefs/:workspaceId', () => {
  beforeAll(() => {
    // Seed one pending brief for ws1
    createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'integration test keyword',
      reason: 'Test reason for integration',
      priority: 'high',
    });
  });

  it('returns array of pending/snoozed briefs for workspace', async () => {
    const res = await api(`/api/suggested-briefs/${ws1.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const brief = body.find((b: { keyword: string }) => b.keyword === 'integration test keyword');
    expect(brief).toBeDefined();
    expect(brief.workspaceId).toBe(ws1.workspaceId);
    expect(brief.status).toBe('pending');
  });

  it('returns empty array for workspace with no briefs', async () => {
    // ws2 has no seeded briefs
    const res = await api(`/api/suggested-briefs/${ws2.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('includes dismissed briefs when ?all=true', async () => {
    // Create and dismiss a brief for ws1
    const brief = createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'dismissed test keyword for all param',
      reason: 'Will be dismissed',
      priority: 'low',
    });
    db.prepare("UPDATE suggested_briefs SET status = 'dismissed', resolved_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      brief.id,
    );

    const resDefault = await api(`/api/suggested-briefs/${ws1.workspaceId}`);
    const defaultBody = await resDefault.json();
    const foundInDefault = defaultBody.some((b: { keyword: string }) => b.keyword === 'dismissed test keyword for all param');
    expect(foundInDefault).toBe(false);

    const resAll = await api(`/api/suggested-briefs/${ws1.workspaceId}?all=true`);
    const allBody = await resAll.json();
    const foundInAll = allBody.some((b: { keyword: string }) => b.keyword === 'dismissed test keyword for all param');
    expect(foundInAll).toBe(true);
  });

  it('workspace isolation: ws1 briefs do not appear in ws2 response', async () => {
    const [res1, res2] = await Promise.all([
      api(`/api/suggested-briefs/${ws1.workspaceId}`),
      api(`/api/suggested-briefs/${ws2.workspaceId}`),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    const ws1Ids = new Set((body1 as Array<{ workspaceId: string }>).map(b => b.workspaceId));
    const ws2Ids = new Set((body2 as Array<{ workspaceId: string }>).map(b => b.workspaceId));

    // All items in ws1 response belong to ws1
    for (const wsId of ws1Ids) {
      expect(wsId).toBe(ws1.workspaceId);
    }
    // ws2 response is empty (no seeded data cross-contamination)
    expect(ws2Ids.size).toBe(0);
  });
});

describe('GET /api/suggested-briefs/:workspaceId/:briefId', () => {
  let seededBriefId = '';

  beforeAll(() => {
    const brief = createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'single brief fetch test',
      reason: 'Reason for single fetch',
      priority: 'medium',
    });
    seededBriefId = brief.id;
  });

  it('returns the specific brief by id', async () => {
    const res = await api(`/api/suggested-briefs/${ws1.workspaceId}/${seededBriefId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(seededBriefId);
    expect(body.workspaceId).toBe(ws1.workspaceId);
    expect(body.keyword).toBe('single brief fetch test');
  });

  it('returns 404 for unknown brief id', async () => {
    const res = await api(`/api/suggested-briefs/${ws1.workspaceId}/brief_does_not_exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Suggested brief not found');
  });

  it('returns 404 when brief id belongs to a different workspace (isolation)', async () => {
    // ws1's brief id queried against ws2 should 404
    const res = await api(`/api/suggested-briefs/${ws2.workspaceId}/${seededBriefId}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Suggested brief not found');
  });
});

describe('PATCH /api/suggested-briefs/:workspaceId/:briefId (update status)', () => {
  let briefId = '';

  beforeAll(() => {
    const brief = createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'patch status test keyword',
      reason: 'Testing status update',
      priority: 'medium',
    });
    briefId = brief.id;
  });

  it('accepts status and updates to "accepted"', async () => {
    const res = await ctx.patchJson(`/api/suggested-briefs/${ws1.workspaceId}/${briefId}`, {
      status: 'accepted',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(briefId);
    expect(body.status).toBe('accepted');
    expect(body.resolvedAt).toBeTruthy();
  });

  it('returns 404 when brief id does not exist', async () => {
    const res = await ctx.patchJson(`/api/suggested-briefs/${ws1.workspaceId}/nonexistent_brief_id`, {
      status: 'dismissed',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Suggested brief not found');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await ctx.patchJson(`/api/suggested-briefs/${ws1.workspaceId}/${briefId}`, {
      status: 'invalid_status_value',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when brief belongs to a different workspace', async () => {
    // briefId belongs to ws1, ws2 cannot update it
    const res = await ctx.patchJson(`/api/suggested-briefs/${ws2.workspaceId}/${briefId}`, {
      status: 'dismissed',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/suggested-briefs/:workspaceId/:briefId/snooze', () => {
  let briefId = '';

  beforeAll(() => {
    const brief = createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'snooze test keyword unique xyz',
      reason: 'Testing snooze',
      priority: 'low',
    });
    briefId = brief.id;
  });

  it('snoozes the brief until the specified date', async () => {
    const snoozeUntil = '2099-12-31';
    const res = await ctx.postJson(`/api/suggested-briefs/${ws1.workspaceId}/${briefId}/snooze`, {
      until: snoozeUntil,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(briefId);
    expect(body.status).toBe('snoozed');
    expect(body.snoozedUntil).toBe(snoozeUntil);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await ctx.postJson(`/api/suggested-briefs/${ws1.workspaceId}/${briefId}/snooze`, {
      until: 'not-a-date',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown brief', async () => {
    const res = await ctx.postJson(`/api/suggested-briefs/${ws1.workspaceId}/no_such_brief/snooze`, {
      until: '2099-01-01',
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when brief belongs to a different workspace', async () => {
    const res = await ctx.postJson(`/api/suggested-briefs/${ws2.workspaceId}/${briefId}/snooze`, {
      until: '2099-06-01',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/suggested-briefs/:workspaceId/:briefId/dismiss', () => {
  let briefId = '';

  beforeAll(() => {
    const brief = createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'dismiss endpoint test keyword abc',
      reason: 'Testing dismiss endpoint',
      priority: 'medium',
    });
    briefId = brief.id;
  });

  it('dismisses the brief and persists the status', async () => {
    const res = await ctx.postJson(`/api/suggested-briefs/${ws1.workspaceId}/${briefId}/dismiss`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(briefId);
    expect(body.status).toBe('dismissed');
    expect(body.resolvedAt).toBeTruthy();
  });

  it('returns 404 for unknown brief', async () => {
    const res = await ctx.postJson(`/api/suggested-briefs/${ws1.workspaceId}/no_such_brief_dismiss/dismiss`, {});
    expect(res.status).toBe(404);
  });

  it('dismissed brief no longer appears in default list', async () => {
    const res = await api(`/api/suggested-briefs/${ws1.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.some((b: { id: string }) => b.id === briefId);
    expect(found).toBe(false);
  });

  it('returns 404 when brief belongs to a different workspace', async () => {
    const brief = createSuggestedBrief({
      workspaceId: ws1.workspaceId,
      keyword: 'dismiss isolation test keyword unique',
      reason: 'Cross-workspace dismiss attempt',
      priority: 'low',
    });
    const res = await ctx.postJson(
      `/api/suggested-briefs/${ws2.workspaceId}/${brief.id}/dismiss`,
      {},
    );
    expect(res.status).toBe(404);
  });
});
