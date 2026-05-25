/**
 * Integration tests for GET /api/public/intelligence/:workspaceId
 *
 * Covers:
 *   - 404 for unknown workspace
 *   - Base response shape (workspaceId, assembledAt always present)
 *   - Free tier: only basic slices exposed, growth/premium fields absent
 *   - Growth tier: growth fields present, premium fields absent
 *   - Premium tier: all fields present
 *   - Trial workspace (free base + future trial_ends_at) → effective growth
 *   - summarizeInsightsForClient filtering:
 *       * strategy_alignment insights excluded from counts
 *       * positive-severity insights excluded from counts
 *       * highPriority = critical + warning; mediumPriority = opportunity
 *   - formatPipelineForClient arithmetic (inProgress brief/post statuses)
 *   - formatSiteHealthForClient cwvPassRatePct math
 *   - Workspace isolation: one workspace's insights don't bleed into another
 *
 * Port: 13366 (port-ok: next free after 13365)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

const ctx = createTestContext(13366); // port-ok: next free after 13365
const { api } = ctx;

// Seeded workspaces — created after server starts so DB is guaranteed up.
let freeWs: SeededFullWorkspace;
let growthWs: SeededFullWorkspace;
let premiumWs: SeededFullWorkspace;
let trialWs: SeededFullWorkspace;
// Workspace with known insight data for filtering math tests
let insightWs: SeededFullWorkspace;

// IDs of rows we insert directly so afterAll can clean them up
const insertedInsightIds: string[] = [];

function insertInsight(opts: {
  id?: string;
  workspaceId: string;
  insightType: string;
  severity: string;
  pageTitle?: string | null;
  impactScore?: number;
  pageId?: string | null;
}): string {
  const id = opts.id ?? `test-ins-${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT OR REPLACE INTO analytics_insights
      (id, workspace_id, page_id, insight_type, data, severity, domain, impact_score, page_title, computed_at)
    VALUES (?, ?, ?, ?, '{}', ?, 'search', ?, ?, datetime('now'))
  `).run(
    id,
    opts.workspaceId,
    opts.pageId ?? null,
    opts.insightType,
    opts.severity,
    opts.impactScore ?? 0,
    opts.pageTitle ?? null,
  );
  insertedInsightIds.push(id);
  return id;
}

beforeAll(async () => {
  await ctx.startServer();

  // clientPassword: '' lets public endpoints skip auth cookies (consistent
  // with the pattern used in tier-gate-enforcement.test.ts).
  freeWs    = seedWorkspace({ tier: 'free',    clientPassword: '' });
  growthWs  = seedWorkspace({ tier: 'growth',  clientPassword: '' });
  premiumWs = seedWorkspace({ tier: 'premium', clientPassword: '' });

  // Trial workspace: free base tier + future trial_ends_at → effective growth
  trialWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(futureDate, trialWs.workspaceId);

  // Workspace for insight filtering math tests
  insightWs = seedWorkspace({ tier: 'free', clientPassword: '' });

  // Insert a known mix of insights into insightWs so we can assert exact counts.
  //
  // The unique constraint is (workspace_id, COALESCE(page_id, '__workspace__'), insight_type),
  // so each row MUST have a distinct pageId to avoid conflict-replace overwriting earlier rows.
  //
  // Expected after filtering (strategy_alignment and positive excluded):
  //   visible = 7 (2 critical + 2 warning + 3 opportunity)
  //   highPriority = 4  (critical + warning)
  //   mediumPriority = 3 (opportunity)
  //
  // Excluded:
  //   1 strategy_alignment (any severity)
  //   2 positive (any type)
  //   Total excluded = 3 → raw rows = 10

  // Critical (2) — each on a distinct page
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'page_health',        severity: 'critical',    impactScore: 10, pageTitle: 'Page A', pageId: '/page-a' });
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'content_decay',       severity: 'critical',    impactScore: 9,  pageTitle: 'Page B', pageId: '/page-b' });
  // Warning (2)
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'ranking_opportunity', severity: 'warning',     impactScore: 8,  pageTitle: 'Page C', pageId: '/page-c' });
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'ctr_opportunity',      severity: 'warning',     impactScore: 7,  pageTitle: 'Page D', pageId: '/page-d' });
  // Opportunity (3)
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'competitor_gap',       severity: 'opportunity', impactScore: 6,  pageTitle: 'Page E', pageId: '/page-e' });
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'keyword_cluster',      severity: 'opportunity', impactScore: 5,  pageTitle: 'Page F', pageId: '/page-f' });
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'serp_opportunity',     severity: 'opportunity', impactScore: 4,  pageTitle: 'Page G', pageId: '/page-g' });
  // Excluded: strategy_alignment (1) — admin-only type
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'strategy_alignment',  severity: 'warning',     impactScore: 3,  pageTitle: 'Hidden SA',    pageId: '/page-h' });
  // Excluded: positive severity (2)
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'page_health',        severity: 'positive',    impactScore: 2,  pageTitle: 'Hidden Pos 1', pageId: '/page-i' });
  insertInsight({ workspaceId: insightWs.workspaceId, insightType: 'ranking_opportunity', severity: 'positive',    impactScore: 1,  pageTitle: 'Hidden Pos 2', pageId: '/page-j' });
}, 25_000);

afterAll(async () => {
  // Clean up inserted insight rows (FK cascade is OFF in tests)
  for (const id of insertedInsightIds) {
    db.prepare('DELETE FROM analytics_insights WHERE id = ?').run(id);
  }

  const tryCleanup = (w: SeededFullWorkspace | undefined) => w?.cleanup();
  tryCleanup(freeWs);
  tryCleanup(growthWs);
  tryCleanup(premiumWs);
  tryCleanup(trialWs);
  tryCleanup(insightWs);

  await ctx.stopServer();
});

// ── 404 for unknown workspace ──────────────────────────────────────────────────

describe('404 for unknown workspace', () => {
  it('returns 404 and error message for a non-existent workspace ID', async () => {
    const res = await api('/api/public/intelligence/does-not-exist');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 404 for an empty-looking workspace ID segment', async () => {
    const res = await api('/api/public/intelligence/nonexistent-ws-id-abc123');
    expect(res.status).toBe(404);
  });
});

// ── Base response shape ─────────────────────────────────────────────────────────

describe('base response shape — fields present on every tier', () => {
  it('free tier response includes workspaceId matching the request', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(freeWs.workspaceId);
  });

  it('response always includes assembledAt (ISO string)', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    const body = await res.json();
    expect(typeof body.assembledAt).toBe('string');
    // Should be a valid ISO timestamp
    expect(() => new Date(body.assembledAt)).not.toThrow();
    expect(new Date(body.assembledAt).toISOString()).toBe(body.assembledAt);
  });

  it('response always includes tier field', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    const body = await res.json();
    expect(['free', 'growth', 'premium']).toContain(body.tier);
  });

  it('response always includes insightsSummary key (may be null)', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    const body = await res.json();
    expect('insightsSummary' in body).toBe(true);
  });

  it('response always includes pipelineStatus key (may be null)', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    const body = await res.json();
    expect('pipelineStatus' in body).toBe(true);
  });
});

// ── Free tier gating ────────────────────────────────────────────────────────────

describe('free tier — correct fields present and absent', () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it('tier field is "free"', () => {
    expect(body.tier).toBe('free');
  });

  it('insightsSummary key is present', () => {
    expect('insightsSummary' in body).toBe(true);
  });

  it('pipelineStatus key is present', () => {
    expect('pipelineStatus' in body).toBe(true);
  });

  // Growth+ fields must be absent on free
  it('learningHighlights key is absent', () => {
    expect('learningHighlights' in body).toBe(false);
  });

  it('rankTrackingSummary key is absent', () => {
    expect('rankTrackingSummary' in body).toBe(false);
  });

  it('serpOpportunities key is absent', () => {
    expect('serpOpportunities' in body).toBe(false);
  });

  it('compositeHealthScore key is absent', () => {
    expect('compositeHealthScore' in body).toBe(false);
  });

  it('weCalledIt key is absent', () => {
    expect('weCalledIt' in body).toBe(false);
  });

  it('copyPipelineStatus key is absent', () => {
    expect('copyPipelineStatus' in body).toBe(false);
  });

  // Premium fields must also be absent on free
  it('siteHealthSummary key is absent', () => {
    expect('siteHealthSummary' in body).toBe(false);
  });

  it('contentDecayAlerts key is absent', () => {
    expect('contentDecayAlerts' in body).toBe(false);
  });
});

// ── Growth tier gating ──────────────────────────────────────────────────────────

describe('growth tier — correct fields present and absent', () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await api(`/api/public/intelligence/${growthWs.workspaceId}`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it('tier field is "growth"', () => {
    expect(body.tier).toBe('growth');
  });

  it('insightsSummary key is present', () => {
    expect('insightsSummary' in body).toBe(true);
  });

  it('pipelineStatus key is present', () => {
    expect('pipelineStatus' in body).toBe(true);
  });

  // Growth+ fields must be present
  it('learningHighlights key is present (may be null)', () => {
    expect('learningHighlights' in body).toBe(true);
  });

  it('rankTrackingSummary key is present (may be null)', () => {
    expect('rankTrackingSummary' in body).toBe(true);
  });

  it('serpOpportunities key is present (may be null)', () => {
    expect('serpOpportunities' in body).toBe(true);
  });

  it('compositeHealthScore key is present (may be null)', () => {
    expect('compositeHealthScore' in body).toBe(true);
  });

  it('weCalledIt key is present (must be an array)', () => {
    expect('weCalledIt' in body).toBe(true);
    expect(Array.isArray(body.weCalledIt)).toBe(true);
  });

  it('copyPipelineStatus key is present (may be null)', () => {
    expect('copyPipelineStatus' in body).toBe(true);
  });

  // Premium-only fields must be absent on growth
  it('siteHealthSummary key is absent', () => {
    expect('siteHealthSummary' in body).toBe(false);
  });

  it('contentDecayAlerts key is absent', () => {
    expect('contentDecayAlerts' in body).toBe(false);
  });
});

// ── Premium tier gating ─────────────────────────────────────────────────────────

describe('premium tier — all fields present', () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it('tier field is "premium"', () => {
    expect(body.tier).toBe('premium');
  });

  it('insightsSummary key is present', () => {
    expect('insightsSummary' in body).toBe(true);
  });

  it('pipelineStatus key is present', () => {
    expect('pipelineStatus' in body).toBe(true);
  });

  // Growth fields present
  it('learningHighlights key is present', () => {
    expect('learningHighlights' in body).toBe(true);
  });

  it('rankTrackingSummary key is present', () => {
    expect('rankTrackingSummary' in body).toBe(true);
  });

  it('serpOpportunities key is present', () => {
    expect('serpOpportunities' in body).toBe(true);
  });

  it('compositeHealthScore key is present', () => {
    expect('compositeHealthScore' in body).toBe(true);
  });

  it('weCalledIt key is present and is an array', () => {
    expect('weCalledIt' in body).toBe(true);
    expect(Array.isArray(body.weCalledIt)).toBe(true);
  });

  it('copyPipelineStatus key is present', () => {
    expect('copyPipelineStatus' in body).toBe(true);
  });

  // Premium-only fields present
  it('siteHealthSummary key is present (may be null)', () => {
    expect('siteHealthSummary' in body).toBe(true);
  });

  it('contentDecayAlerts key is present (may be null or array)', () => {
    expect('contentDecayAlerts' in body).toBe(true);
  });
});

// ── Trial workspace → effective growth ─────────────────────────────────────────

describe('trial workspace — free base tier promotes to growth', () => {
  let body: Record<string, unknown>;

  beforeAll(async () => {
    const res = await api(`/api/public/intelligence/${trialWs.workspaceId}`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it('tier field is "growth" (not "free")', () => {
    expect(body.tier).toBe('growth');
  });

  it('workspaceId matches trial workspace', () => {
    expect(body.workspaceId).toBe(trialWs.workspaceId);
  });

  it('learningHighlights key is present (growth-tier field unlocked)', () => {
    expect('learningHighlights' in body).toBe(true);
  });

  it('rankTrackingSummary key is present', () => {
    expect('rankTrackingSummary' in body).toBe(true);
  });

  it('serpOpportunities key is present', () => {
    expect('serpOpportunities' in body).toBe(true);
  });

  it('weCalledIt key is present', () => {
    expect('weCalledIt' in body).toBe(true);
    expect(Array.isArray(body.weCalledIt)).toBe(true);
  });

  it('siteHealthSummary is still absent (trial does not promote to premium)', () => {
    expect('siteHealthSummary' in body).toBe(false);
  });

  it('contentDecayAlerts is still absent', () => {
    expect('contentDecayAlerts' in body).toBe(false);
  });
});

// ── Trial workspace with expired trial stays free ──────────────────────────────

describe('expired trial workspace — stays on free tier', () => {
  let expiredTrialWs: SeededFullWorkspace;

  beforeAll(() => {
    expiredTrialWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    // Set trial_ends_at in the past
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(pastDate, expiredTrialWs.workspaceId);
  });

  afterAll(() => {
    expiredTrialWs?.cleanup();
  });

  it('tier field is "free" when trial has expired', async () => {
    const res = await api(`/api/public/intelligence/${expiredTrialWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
  });

  it('learningHighlights absent when trial expired', async () => {
    const res = await api(`/api/public/intelligence/${expiredTrialWs.workspaceId}`);
    const body = await res.json();
    expect('learningHighlights' in body).toBe(false);
  });
});

// ── summarizeInsightsForClient filtering math ───────────────────────────────────

describe('summarizeInsightsForClient — filtering and count math', () => {
  let summary: { total: number; highPriority: number; mediumPriority: number; topInsights: Array<{ title: string; type: string }> };

  beforeAll(async () => {
    const res = await api(`/api/public/intelligence/${insightWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // insightWs is free tier so insightsSummary is always present
    summary = body.insightsSummary;
  });

  it('insightsSummary is not null', () => {
    expect(summary).not.toBeNull();
  });

  it('total excludes strategy_alignment and positive-severity insights', () => {
    // 10 rows inserted: 2 critical + 2 warning + 3 opportunity + 1 strategy_alignment + 2 positive
    // Visible: 2 + 2 + 3 = 7
    expect(summary.total).toBe(7);
  });

  it('highPriority counts critical and warning insights', () => {
    // 2 critical + 2 warning = 4
    expect(summary.highPriority).toBe(4);
  });

  it('mediumPriority counts opportunity insights', () => {
    // 3 opportunity
    expect(summary.mediumPriority).toBe(3);
  });

  it('highPriority + mediumPriority equals total', () => {
    expect(summary.highPriority + summary.mediumPriority).toBe(summary.total);
  });

  it('topInsights array has at most 3 items', () => {
    expect(Array.isArray(summary.topInsights)).toBe(true);
    expect(summary.topInsights.length).toBeLessThanOrEqual(3);
  });

  it('topInsights does not include strategy_alignment type', () => {
    const types = summary.topInsights.map((i) => i.type);
    expect(types).not.toContain('strategy_alignment');
  });

  it('topInsights items have title and type fields', () => {
    for (const item of summary.topInsights) {
      expect(typeof item.title).toBe('string');
      expect(typeof item.type).toBe('string');
    }
  });
});

// ── strategy_alignment specifically excluded ────────────────────────────────────

describe('summarizeInsightsForClient — strategy_alignment exclusion', () => {
  it('strategy_alignment rows do not appear in topInsights titles', async () => {
    const res = await api(`/api/public/intelligence/${insightWs.workspaceId}`);
    const body = await res.json();
    const titles = (body.insightsSummary?.topInsights ?? []).map((i: { title: string }) => i.title);
    expect(titles).not.toContain('Hidden SA');
  });
});

// ── positive severity excluded ──────────────────────────────────────────────────

describe('summarizeInsightsForClient — positive severity exclusion', () => {
  it('positive severity rows do not appear in topInsights titles', async () => {
    const res = await api(`/api/public/intelligence/${insightWs.workspaceId}`);
    const body = await res.json();
    const titles = (body.insightsSummary?.topInsights ?? []).map((i: { title: string }) => i.title);
    expect(titles).not.toContain('Hidden Pos 1');
    expect(titles).not.toContain('Hidden Pos 2');
  });
});

// ── insightsSummary shape contract ─────────────────────────────────────────────

describe('insightsSummary shape contract', () => {
  it('all numeric fields are non-negative integers when present', async () => {
    const res = await api(`/api/public/intelligence/${insightWs.workspaceId}`);
    const body = await res.json();
    const s = body.insightsSummary;
    if (s) {
      expect(Number.isInteger(s.total)).toBe(true);
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(s.highPriority)).toBe(true);
      expect(s.highPriority).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(s.mediumPriority)).toBe(true);
      expect(s.mediumPriority).toBeGreaterThanOrEqual(0);
    }
  });

  it('topInsights is an array', async () => {
    const res = await api(`/api/public/intelligence/${insightWs.workspaceId}`);
    const body = await res.json();
    if (body.insightsSummary) {
      expect(Array.isArray(body.insightsSummary.topInsights)).toBe(true);
    }
  });
});

// ── Workspace isolation ─────────────────────────────────────────────────────────

describe('workspace isolation — insights from workspace A do not appear in workspace B', () => {
  let isolationWsA: SeededFullWorkspace;
  let isolationWsB: SeededFullWorkspace;
  const isolationInsightIds: string[] = [];

  beforeAll(() => {
    isolationWsA = seedWorkspace({ tier: 'free', clientPassword: '' });
    isolationWsB = seedWorkspace({ tier: 'free', clientPassword: '' });

    // Insert 2 critical insights into workspace A only (distinct page IDs to avoid unique conflict)
    const id1 = insertInsight({ workspaceId: isolationWsA.workspaceId, insightType: 'page_health',  severity: 'critical', pageTitle: 'WsA Only Page',  impactScore: 99, pageId: '/iso-a-1' });
    const id2 = insertInsight({ workspaceId: isolationWsA.workspaceId, insightType: 'content_decay', severity: 'critical', pageTitle: 'WsA Critical 2', impactScore: 98, pageId: '/iso-a-2' });
    isolationInsightIds.push(id1, id2);
  });

  afterAll(() => {
    for (const id of isolationInsightIds) {
      db.prepare('DELETE FROM analytics_insights WHERE id = ?').run(id);
    }
    isolationWsA?.cleanup();
    isolationWsB?.cleanup();
  });

  it('workspace B insightsSummary.total is 0 (no insights inserted)', async () => {
    const res = await api(`/api/public/intelligence/${isolationWsB.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Workspace B has no insights, so total should be 0
    expect(body.insightsSummary?.total ?? 0).toBe(0);
  });

  it('workspace A insightsSummary.total reflects only its own insights', async () => {
    const res = await api(`/api/public/intelligence/${isolationWsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only 2 critical rows were inserted for wsA — both visible
    expect(body.insightsSummary?.total).toBe(2);
    expect(body.insightsSummary?.highPriority).toBe(2);
  });

  it('workspace B topInsights does not contain page titles from workspace A', async () => {
    const res = await api(`/api/public/intelligence/${isolationWsB.workspaceId}`);
    const body = await res.json();
    const titles = (body.insightsSummary?.topInsights ?? []).map((i: { title: string }) => i.title);
    expect(titles).not.toContain('WsA Only Page');
    expect(titles).not.toContain('WsA Critical 2');
  });
});

// ── pipelineStatus shape contract ──────────────────────────────────────────────

describe('pipelineStatus response shape', () => {
  it('pipelineStatus (when present) has required nested fields', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    const body = await res.json();
    const ps = body.pipelineStatus;
    if (ps !== null && ps !== undefined) {
      expect(ps).toHaveProperty('briefs');
      expect(ps).toHaveProperty('posts');
      expect(ps).toHaveProperty('pendingApprovals');
      expect(ps.briefs).toHaveProperty('total');
      expect(ps.briefs).toHaveProperty('inProgress');
      expect(ps.posts).toHaveProperty('total');
      expect(ps.posts).toHaveProperty('inProgress');
      expect(typeof ps.briefs.total).toBe('number');
      expect(typeof ps.briefs.inProgress).toBe('number');
      expect(typeof ps.posts.total).toBe('number');
      expect(typeof ps.posts.inProgress).toBe('number');
      expect(typeof ps.pendingApprovals).toBe('number');
    }
  });

  it('pipelineStatus.briefs.inProgress is non-negative', async () => {
    const res = await api(`/api/public/intelligence/${growthWs.workspaceId}`);
    const body = await res.json();
    const ps = body.pipelineStatus;
    if (ps) {
      expect(ps.briefs.inProgress).toBeGreaterThanOrEqual(0);
      expect(ps.posts.inProgress).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Growth tier learningHighlights shape ───────────────────────────────────────

describe('growth tier — learningHighlights shape', () => {
  it('learningHighlights (when non-null) has overallWinRate, topActionType, recentWins', async () => {
    const res = await api(`/api/public/intelligence/${growthWs.workspaceId}`);
    const body = await res.json();
    const lh = body.learningHighlights;
    if (lh !== null && lh !== undefined) {
      expect('overallWinRate' in lh).toBe(true);
      expect('topActionType' in lh).toBe(true);
      expect('recentWins' in lh).toBe(true);
      expect(typeof lh.overallWinRate).toBe('number');
      expect(typeof lh.recentWins).toBe('number');
      // topActionType is string or null
      expect(lh.topActionType === null || typeof lh.topActionType === 'string').toBe(true);
    }
  });
});

// ── Growth tier weCalledIt contract ────────────────────────────────────────────

describe('growth tier — weCalledIt is always an array', () => {
  it('weCalledIt is an array on growth tier', async () => {
    const res = await api(`/api/public/intelligence/${growthWs.workspaceId}`);
    const body = await res.json();
    expect(Array.isArray(body.weCalledIt)).toBe(true);
  });

  it('weCalledIt is an array on premium tier', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    const body = await res.json();
    expect(Array.isArray(body.weCalledIt)).toBe(true);
  });

  it('weCalledIt is an array on trial workspace', async () => {
    const res = await api(`/api/public/intelligence/${trialWs.workspaceId}`);
    const body = await res.json();
    expect(Array.isArray(body.weCalledIt)).toBe(true);
  });
});

// ── Premium tier siteHealthSummary shape ───────────────────────────────────────

describe('premium tier — siteHealthSummary shape', () => {
  it('siteHealthSummary (when non-null) has auditScore, deadLinks, cwvPassRatePct', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    const body = await res.json();
    const sh = body.siteHealthSummary;
    if (sh !== null && sh !== undefined) {
      expect('auditScore' in sh).toBe(true);
      expect('auditScoreDelta' in sh).toBe(true);
      expect('cwvPassRatePct' in sh).toBe(true);
      expect('deadLinks' in sh).toBe(true);
      // deadLinks is always a number
      expect(typeof sh.deadLinks).toBe('number');
      // auditScore is number or null
      expect(sh.auditScore === null || typeof sh.auditScore === 'number').toBe(true);
    }
  });
});

// ── cwvPassRatePct math ─────────────────────────────────────────────────────────

describe('formatSiteHealthForClient — cwvPassRatePct arithmetic', () => {
  it('cwvPassRatePct (when present) is an integer between 0 and 100 or null', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    const body = await res.json();
    const sh = body.siteHealthSummary;
    if (sh && sh.cwvPassRatePct !== null) {
      expect(Number.isInteger(sh.cwvPassRatePct)).toBe(true);
      expect(sh.cwvPassRatePct).toBeGreaterThanOrEqual(0);
      expect(sh.cwvPassRatePct).toBeLessThanOrEqual(100);
    }
  });
});

// ── Content decay alerts shape ──────────────────────────────────────────────────

describe('premium tier — contentDecayAlerts shape', () => {
  it('contentDecayAlerts (when array) items have required fields', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    const body = await res.json();
    const alerts = body.contentDecayAlerts;
    if (Array.isArray(alerts) && alerts.length > 0) {
      for (const alert of alerts) {
        expect('pageUrl' in alert).toBe(true);
        expect('clickDrop' in alert).toBe(true);
        expect('detectedAt' in alert).toBe(true);
        expect('hasRefreshBrief' in alert).toBe(true);
      }
    }
  });
});

// ── No knowledgeBase or brandVoice in client response ─────────────────────────

describe('admin-only fields never exposed to client', () => {
  it('knowledgeBase is not present in free tier response', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    const body = await res.json();
    expect('knowledgeBase' in body).toBe(false);
  });

  it('brandVoice is not present in premium tier response', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    const body = await res.json();
    expect('brandVoice' in body).toBe(false);
  });

  it('churnRisk is not present in growth tier response', async () => {
    const res = await api(`/api/public/intelligence/${growthWs.workspaceId}`);
    const body = await res.json();
    expect('churnRisk' in body).toBe(false);
  });

  it('impactScore is not present in any tier response', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    const body = await res.json();
    expect('impactScore' in body).toBe(false);
  });
});
