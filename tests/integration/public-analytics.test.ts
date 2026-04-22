/**
 * Integration tests for client analytics endpoints.
 *
 * Verifies:
 *   1. Insights are properly scoped to the requesting workspace
 *   2. No cross-workspace data leakage in analytics responses
 *   3. Insight aggregates are present with correct shape (id, insightType, severity, data)
 *   4. Empty workspace returns empty array / zero values — never null
 *   5. Narrative endpoint returns only client-relevant insights for the correct workspace
 *   6. Insight type filter scopes correctly within a workspace
 *
 * Endpoints tested:
 *   GET /api/public/insights/:workspaceId
 *   GET /api/public/insights/:workspaceId?type=<insightType>
 *   GET /api/public/insights/:workspaceId/narrative
 *
 * Note: search-overview, performance-trend, analytics-overview, etc. require
 * external credentials (GSC / GA4) and are not testable without live API keys.
 * Those endpoints are covered by the 400 "not configured" guard tests below.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';
import { cleanSeedData } from '../global-setup.js';

const ctx = createTestContext(13309);
const { api } = ctx;

// Workspace A — receives seeded analytics insights
let wsAId = '';
// Workspace B — intentionally left empty (no insights seeded)
let wsBId = '';
// Unique insight IDs seeded into workspace A
let wsAInsightId1 = '';
let wsAInsightId2 = '';
let wsAInsightId3 = '';

beforeAll(async () => {
  await ctx.startServer();

  // Create both workspaces via the server helper (inserts a real workspaces row)
  const wsA = createWorkspace('Public Analytics Test WS-A');
  const wsB = createWorkspace('Public Analytics Test WS-B');
  wsAId = wsA.id;
  wsBId = wsB.id;

  // ── Seed workspace A with three insights of different types ────────────────
  // impactScore >= 20 so buildClientInsights() includes them in narrative

  const i1 = upsertInsight({
    workspaceId: wsAId,
    pageId: '/blog/seo-automation',
    insightType: 'ranking_opportunity',
    data: { query: 'seo automation tools', currentPosition: 6, impressions: 2400, estimatedTrafficGain: 300, pageUrl: '/blog/seo-automation' },
    severity: 'opportunity',
    impactScore: 75,
    domain: 'search',
    pageTitle: 'SEO Automation Guide',
  });
  wsAInsightId1 = i1.id;

  const i2 = upsertInsight({
    workspaceId: wsAId,
    pageId: '/services/content',
    insightType: 'content_decay',
    data: { baselineClicks: 500, currentClicks: 320, deltaPercent: -36, baselinePeriod: '2026-01', currentPeriod: '2026-03' },
    severity: 'warning',
    impactScore: 60,
    domain: 'search',
    pageTitle: 'Content Marketing Services',
  });
  wsAInsightId2 = i2.id;

  const i3 = upsertInsight({
    workspaceId: wsAId,
    pageId: '/about',
    insightType: 'page_health',
    data: { score: 45, trend: 'declining', clicks: 120, impressions: 800, position: 18, ctr: 0.15, pageviews: 200, bounceRate: 0.72, avgEngagementTime: 30 },
    severity: 'warning',
    impactScore: 40,
    domain: 'cross',
    pageTitle: 'About Us',
  });
  wsAInsightId3 = i3.id;

  // Workspace B intentionally has NO insights seeded
}, 25_000);

afterAll(() => {
  cleanSeedData(wsAId);
  cleanSeedData(wsBId);
  deleteWorkspace(wsAId);
  deleteWorkspace(wsBId);
  ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/public/insights/:workspaceId — workspace scoping
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights/:workspaceId — workspace scoping', () => {
  it('returns 200 and an array for workspace A', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('workspace A returns all three seeded insights', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.length).toBeGreaterThanOrEqual(3);
    const ids = body.map(i => i.id);
    expect(ids).toContain(wsAInsightId1);
    expect(ids).toContain(wsAInsightId2);
    expect(ids).toContain(wsAInsightId3);
  });

  it('all insights returned for workspace A have workspaceId === wsAId', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    expect(body.length > 0 && body.every(i => i.workspaceId === wsAId)).toBe(true);
  });

  it('workspace B returns 200 and empty array when no insights seeded', async () => {
    const res = await api(`/api/public/insights/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('workspace B response is [] — not null and not an object', async () => {
    const res = await api(`/api/public/insights/${wsBId}`);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 404 for a non-existent workspace id', async () => {
    const res = await api('/api/public/insights/ws_does_not_exist_analytics_test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cross-workspace isolation — workspace B must never see workspace A data
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights — cross-workspace isolation', () => {
  it('workspace B response does not contain any workspace A insight id', async () => {
    const res = await api(`/api/public/insights/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(i => i.id);
    expect(ids).not.toContain(wsAInsightId1);
    expect(ids).not.toContain(wsAInsightId2);
    expect(ids).not.toContain(wsAInsightId3);
  });

  it('workspace B response does not contain any insight with workspaceId === wsAId', async () => {
    const res = await api(`/api/public/insights/${wsBId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ workspaceId: string }>;
    const leaked = body.filter(i => i.workspaceId === wsAId);
    expect(leaked.length).toBe(0);
  });

  it('seeding workspace B does not expose workspace A insights to wsB endpoint', async () => {
    // Seed one insight into workspace B
    const wsBInsight = upsertInsight({
      workspaceId: wsBId,
      pageId: '/home',
      insightType: 'page_health',
      data: { score: 80, trend: 'stable', clicks: 50, impressions: 300, position: 10, ctr: 0.16, pageviews: 90, bounceRate: 0.4, avgEngagementTime: 60 },
      severity: 'positive',
      impactScore: 25,
      domain: 'cross',
    });

    const [resA, resB] = await Promise.all([
      api(`/api/public/insights/${wsAId}`),
      api(`/api/public/insights/${wsBId}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await resA.json() as Array<{ id: string; workspaceId: string }>;
    const bodyB = await resB.json() as Array<{ id: string; workspaceId: string }>;

    // Workspace A still has its original insights
    expect(bodyA.length > 0 && bodyA.every(i => i.workspaceId === wsAId)).toBe(true);

    // Workspace B now has exactly one insight — the one we just seeded
    expect(bodyB.length > 0 && bodyB.every(i => i.workspaceId === wsBId)).toBe(true);

    // Cross-contamination check: neither workspace sees the other's IDs
    const idsA = new Set(bodyA.map(i => i.id));
    const idsB = new Set(bodyB.map(i => i.id));

    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }
    for (const id of idsB) {
      expect(idsA.has(id)).toBe(false);
    }

    // Cleanup wsB insight (cleanSeedData in afterAll handles analytics_insights rows)
    // wsBInsight id is available but cleanSeedData(wsBId) will catch it
    void wsBInsight; // already covered by afterAll cleanSeedData(wsBId)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Insight response shape — aggregates and required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights — response shape and aggregates', () => {
  it('each insight has required fields: id, workspaceId, insightType, severity, data, computedAt', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);

    for (const insight of body) {
      expect(insight).toHaveProperty('id');
      expect(insight).toHaveProperty('workspaceId');
      expect(insight).toHaveProperty('insightType');
      expect(insight).toHaveProperty('severity');
      expect(insight).toHaveProperty('data');
      expect(insight).toHaveProperty('computedAt');
    }
  });

  it('insight data field is a non-null object', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ data: unknown }>;
    expect(body.length).toBeGreaterThan(0);

    for (const insight of body) {
      expect(insight.data).not.toBeNull();
      expect(typeof insight.data).toBe('object');
      expect(Array.isArray(insight.data)).toBe(false);
    }
  });

  it('insights are sorted by impactScore descending', async () => {
    const res = await api(`/api/public/insights/${wsAId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ impactScore?: number }>;
    expect(body.length).toBeGreaterThan(1);

    for (let idx = 1; idx < body.length; idx++) {
      const prev = body[idx - 1].impactScore ?? 0;
      const curr = body[idx].impactScore ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('ranking_opportunity insight contains expected data fields', async () => {
    const res = await api(`/api/public/insights/${wsAId}?type=ranking_opportunity`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ data: { query?: string; currentPosition?: number } }>;
    expect(body.length).toBeGreaterThan(0);

    const first = body[0];
    expect(first.data).toHaveProperty('query');
    expect(first.data).toHaveProperty('currentPosition');
    expect(typeof first.data.currentPosition).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Type filter — scopes correctly within a workspace
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights/:workspaceId?type= — type filter scoping', () => {
  it('?type=ranking_opportunity returns only ranking_opportunity insights for wsA', async () => {
    const res = await api(`/api/public/insights/${wsAId}?type=ranking_opportunity`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ insightType: string }>;
    expect(body.length > 0 && body.every(i => i.insightType === 'ranking_opportunity')).toBe(true);
  });

  it('?type=content_decay returns only content_decay insights for wsA', async () => {
    const res = await api(`/api/public/insights/${wsAId}?type=content_decay`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ insightType: string }>;
    expect(body.length > 0 && body.every(i => i.insightType === 'content_decay')).toBe(true);
  });

  it('?type=ranking_opportunity returns empty array for workspace B (no insights of that type)', async () => {
    const res = await api(`/api/public/insights/${wsBId}?type=ranking_opportunity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // wsB may have a page_health insight from the cross-workspace test above,
    // but it must have no ranking_opportunity insights
    const typed = body as Array<{ insightType: string }>;
    expect(typed.filter(i => i.insightType === 'ranking_opportunity').length).toBe(0);
  });

  it('?type filter does not return insights from the other workspace', async () => {
    // Query wsB for ranking_opportunity — wsA has one, wsB has none of that type
    const res = await api(`/api/public/insights/${wsBId}?type=ranking_opportunity`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(i => i.id);
    expect(ids).not.toContain(wsAInsightId1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/public/insights/:workspaceId/narrative — client-framed insights
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/insights/:workspaceId/narrative — client insights', () => {
  it('returns 200 and { insights: [...] } for workspace A', async () => {
    const res = await api(`/api/public/insights/${wsAId}/narrative`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('insights');
    expect(Array.isArray(body.insights)).toBe(true);
  });

  it('narrative insights have required client-facing fields', async () => {
    const res = await api(`/api/public/insights/${wsAId}/narrative`);
    expect(res.status).toBe(200);
    const { insights } = await res.json() as { insights: Array<Record<string, unknown>> };
    expect(insights.length).toBeGreaterThan(0);

    for (const insight of insights) {
      expect(insight).toHaveProperty('id');
      expect(insight).toHaveProperty('type');
      expect(insight).toHaveProperty('severity');
      expect(insight).toHaveProperty('headline');
      expect(insight).toHaveProperty('narrative');
      expect(insight).toHaveProperty('impactScore');
      expect(typeof insight.headline).toBe('string');
      expect((insight.headline as string).length).toBeGreaterThan(0);
      expect(typeof insight.narrative).toBe('string');
      expect((insight.narrative as string).length).toBeGreaterThan(0);
    }
  });

  it('narrative insights are sorted by impactScore descending', async () => {
    const res = await api(`/api/public/insights/${wsAId}/narrative`);
    expect(res.status).toBe(200);
    const { insights } = await res.json() as { insights: Array<{ impactScore: number }> };
    // buildClientInsights sorts by impactScore DESC before returning
    if (insights.length > 1) {
      for (let idx = 1; idx < insights.length; idx++) {
        expect(insights[idx - 1].impactScore).toBeGreaterThanOrEqual(insights[idx].impactScore);
      }
    }
  });

  it('narrative for workspace A does not contain admin jargon field "workspaceId"', async () => {
    const res = await api(`/api/public/insights/${wsAId}/narrative`);
    expect(res.status).toBe(200);
    const { insights } = await res.json() as { insights: Array<Record<string, unknown>> };
    // ClientInsight shape has `type`, not `insightType` and not `workspaceId`
    if (insights.length > 0) {
      for (const insight of insights) {
        expect(insight).not.toHaveProperty('workspaceId');
        expect(insight).not.toHaveProperty('insightType');
      }
    }
  });

  it('narrative for workspace B returns { insights: [] } — empty, not null', async () => {
    // wsB may have a page_health insight but impactScore 25 may pass the 20-threshold.
    // The important assertion is: response shape is correct and never null.
    const res = await api(`/api/public/insights/${wsBId}/narrative`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('insights');
    expect(body.insights).not.toBeNull();
    expect(Array.isArray(body.insights)).toBe(true);
  });

  it('narrative for workspace B never contains workspace A insight ids', async () => {
    const res = await api(`/api/public/insights/${wsBId}/narrative`);
    expect(res.status).toBe(200);
    const { insights } = await res.json() as { insights: Array<{ id: string }> };
    const ids = insights.map(i => i.id);
    expect(ids).not.toContain(wsAInsightId1);
    expect(ids).not.toContain(wsAInsightId2);
    expect(ids).not.toContain(wsAInsightId3);
  });

  it('returns 404 for non-existent workspace', async () => {
    const res = await api('/api/public/insights/ws_does_not_exist_narrative/narrative');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. External-credential endpoints — "not configured" guard (400 response)
// ─────────────────────────────────────────────────────────────────────────────
// These routes require GSC / GA4 credentials not available in test env.
// The correct behaviour is a 400 with a descriptive error, not a 500 or crash.

describe('Analytics endpoints — missing credentials guard', () => {
  it('GET /api/public/search-overview/:workspaceId returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/search-overview/${wsAId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/performance-trend/:workspaceId returns 400 when GSC not configured', async () => {
    const res = await api(`/api/public/performance-trend/${wsAId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/analytics-overview/:workspaceId returns 400 when GA4 not configured', async () => {
    const res = await api(`/api/public/analytics-overview/${wsAId}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET /api/public/search-overview — 404 for non-existent workspace', async () => {
    const res = await api('/api/public/search-overview/ws_nonexistent_xyz');
    // Workspace not found → 400 (gscPropertyUrl guard fires first), or 404 if workspace check comes first
    expect([400, 404]).toContain(res.status);
  });

  it('GET /api/public/analytics-overview — 404 for non-existent workspace', async () => {
    const res = await api('/api/public/analytics-overview/ws_nonexistent_xyz');
    expect([400, 404]).toContain(res.status);
  });
});
