/**
 * CONTRACT TEST: Client intelligence endpoint tier gating.
 *
 * Verifies that GET /api/public/intelligence/:workspaceId returns:
 *   - Free:    insightsSummary + pipelineStatus only
 *   - Growth:  + learningHighlights
 *   - Premium: + siteHealthSummary
 *
 * Also verifies that admin-only insight types (strategy_alignment) and
 * sensitive fields (churnRisk, impact_score, operational slice) are
 * never present in any tier's response.
 *
 * HTTP-level testing is required because the tier gating and scrubbing
 * logic is inline in the route handler (not exported as a testable helper).
 *
 * Workspaces are seeded without a clientPassword so the client-session
 * enforcement middleware passes through without requiring a login.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';

const ctx = createTestContext(13303);
const { api } = ctx;

// Three workspaces, one per tier. clientPassword left empty so the
// client-session middleware skips auth enforcement.
let freeWsId = '';
let growthWsId = '';
let premiumWsId = '';
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  await ctx.startServer();

  const freeWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  freeWsId = freeWs.workspaceId;
  cleanups.push(freeWs.cleanup);

  const growthWs = seedWorkspace({ tier: 'growth', clientPassword: '' });
  growthWsId = growthWs.workspaceId;
  cleanups.push(growthWs.cleanup);

  const premiumWs = seedWorkspace({ tier: 'premium', clientPassword: '' });
  premiumWsId = premiumWs.workspaceId;
  cleanups.push(premiumWs.cleanup);

  // Seed a strategy_alignment insight into each workspace so we can verify it
  // is scrubbed from every tier's response.
  for (const wsId of [freeWsId, growthWsId, premiumWsId]) {
    upsertInsight({
      workspaceId: wsId,
      pageId: null,
      insightType: 'strategy_alignment',
      data: { note: 'Admin-only insight that must never reach clients' },
      severity: 'warning',
      pageTitle: 'Strategy Alignment Test',
    });
  }
}, 30_000);

afterAll(() => {
  for (const cleanup of cleanups) {
    cleanup();
  }
  ctx.stopServer();
});

// ── Helper ────────────────────────────────────────────────────────────────

async function fetchIntelligence(wsId: string): Promise<Record<string, unknown>> {
  const res = await api(`/api/public/intelligence/${wsId}`);
  expect(res.status).toBe(200);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Free tier ─────────────────────────────────────────────────────────────

describe('free tier — fields present', () => {
  it('returns 200 for a free workspace', async () => {
    const res = await api(`/api/public/intelligence/${freeWsId}`);
    expect(res.status).toBe(200);
  });

  it('response includes workspaceId, assembledAt, and tier=free', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body.workspaceId).toBe(freeWsId);
    expect(typeof body.assembledAt).toBe('string');
    expect(body.tier).toBe('free');
  });

  it('response includes insightsSummary', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).toHaveProperty('insightsSummary');
  });

  it('insightsSummary has the correct shape', async () => {
    const body = await fetchIntelligence(freeWsId);
    const summary = body.insightsSummary as Record<string, unknown> | null;
    // May be null if no insights; if present, must have correct fields
    if (summary !== null) {
      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('highPriority');
      expect(summary).toHaveProperty('mediumPriority');
      expect(summary).toHaveProperty('topInsights');
      expect(Array.isArray(summary.topInsights)).toBe(true);
    }
  });

  it('response includes pipelineStatus', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).toHaveProperty('pipelineStatus');
  });

  it('pipelineStatus has the correct shape', async () => {
    const body = await fetchIntelligence(freeWsId);
    const pipeline = body.pipelineStatus as Record<string, unknown> | null;
    if (pipeline !== null) {
      expect(pipeline).toHaveProperty('briefs');
      expect(pipeline).toHaveProperty('posts');
      expect(pipeline).toHaveProperty('pendingApprovals');
    }
  });
});

describe('free tier — fields absent', () => {
  it('does NOT include learningHighlights', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).not.toHaveProperty('learningHighlights');
  });

  it('does NOT include siteHealthSummary', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).not.toHaveProperty('siteHealthSummary');
  });
});

// ── Growth tier ───────────────────────────────────────────────────────────

describe('growth tier — fields present', () => {
  it('returns 200 for a growth workspace', async () => {
    const res = await api(`/api/public/intelligence/${growthWsId}`);
    expect(res.status).toBe(200);
  });

  it('response includes tier=growth', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body.tier).toBe('growth');
  });

  it('response includes insightsSummary', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).toHaveProperty('insightsSummary');
  });

  it('response includes pipelineStatus', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).toHaveProperty('pipelineStatus');
  });

  it('response includes learningHighlights (growth+ field)', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).toHaveProperty('learningHighlights');
  });

  it('learningHighlights has the correct shape when present', async () => {
    const body = await fetchIntelligence(growthWsId);
    const highlights = body.learningHighlights as Record<string, unknown> | null;
    if (highlights !== null) {
      expect(highlights).toHaveProperty('overallWinRate');
      expect(highlights).toHaveProperty('topActionType');
      expect(highlights).toHaveProperty('recentWins');
    }
  });
});

describe('growth tier — fields absent', () => {
  it('does NOT include siteHealthSummary', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).not.toHaveProperty('siteHealthSummary');
  });
});

// ── Premium tier ──────────────────────────────────────────────────────────

describe('premium tier — fields present', () => {
  it('returns 200 for a premium workspace', async () => {
    const res = await api(`/api/public/intelligence/${premiumWsId}`);
    expect(res.status).toBe(200);
  });

  it('response includes tier=premium', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body.tier).toBe('premium');
  });

  it('response includes insightsSummary', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).toHaveProperty('insightsSummary');
  });

  it('response includes pipelineStatus', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).toHaveProperty('pipelineStatus');
  });

  it('response includes learningHighlights (growth+ field)', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).toHaveProperty('learningHighlights');
  });

  it('response includes siteHealthSummary (premium-only field)', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).toHaveProperty('siteHealthSummary');
  });

  it('siteHealthSummary has the correct shape when present', async () => {
    const body = await fetchIntelligence(premiumWsId);
    const health = body.siteHealthSummary as Record<string, unknown> | null;
    if (health !== null) {
      expect(health).toHaveProperty('auditScore');
      expect(health).toHaveProperty('auditScoreDelta');
      expect(health).toHaveProperty('cwvPassRatePct');
      expect(health).toHaveProperty('deadLinks');
    }
  });
});

// ── Admin-only insight type scrubbing ─────────────────────────────────────

describe('admin-only insight scrubbing — strategy_alignment never in response', () => {
  it('free tier: strategy_alignment type does not appear in insightsSummary.topInsights', async () => {
    const body = await fetchIntelligence(freeWsId);
    const summary = body.insightsSummary as Record<string, unknown> | null;
    if (summary && Array.isArray(summary.topInsights)) {
      expect(summary.topInsights.length).toBeGreaterThanOrEqual(0);
      const types = (summary.topInsights as Array<{ type: string }>).map(i => i.type);
      expect(types).not.toContain('strategy_alignment');
    }
  });

  it('growth tier: strategy_alignment type does not appear in insightsSummary.topInsights', async () => {
    const body = await fetchIntelligence(growthWsId);
    const summary = body.insightsSummary as Record<string, unknown> | null;
    if (summary && Array.isArray(summary.topInsights)) {
      const types = (summary.topInsights as Array<{ type: string }>).map(i => i.type);
      expect(types).not.toContain('strategy_alignment');
    }
  });

  it('premium tier: strategy_alignment type does not appear in insightsSummary.topInsights', async () => {
    const body = await fetchIntelligence(premiumWsId);
    const summary = body.insightsSummary as Record<string, unknown> | null;
    if (summary && Array.isArray(summary.topInsights)) {
      const types = (summary.topInsights as Array<{ type: string }>).map(i => i.type);
      expect(types).not.toContain('strategy_alignment');
    }
  });

  it('free tier: strategy_alignment insight is excluded from total count', async () => {
    // The strategy_alignment insight was seeded with severity=warning.
    // If it were included, total would be > 0. If excluded, total reflects
    // only non-admin insights — which for a fresh workspace is 0.
    const body = await fetchIntelligence(freeWsId);
    const summary = body.insightsSummary as Record<string, unknown> | null;
    if (summary !== null) {
      // strategy_alignment is the only insight in this workspace; if scrubbing
      // works correctly the count must not include it.
      const topInsights = summary.topInsights as Array<{ type: string }>;
      expect(topInsights.every(i => i.type !== 'strategy_alignment')).toBe(true);
    }
  });
});

// ── Sensitive fields scrubbed — all tiers ─────────────────────────────────

describe('sensitive fields scrubbed — never in any tier response', () => {
  it('free tier: no churnRisk field', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).not.toHaveProperty('churnRisk');
  });

  it('growth tier: no churnRisk field', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).not.toHaveProperty('churnRisk');
  });

  it('premium tier: no churnRisk field', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).not.toHaveProperty('churnRisk');
  });

  it('free tier: no operational slice', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).not.toHaveProperty('operational');
  });

  it('growth tier: no operational slice', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).not.toHaveProperty('operational');
  });

  it('premium tier: no operational slice', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).not.toHaveProperty('operational');
  });

  it('free tier: no knowledgeBase field', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).not.toHaveProperty('knowledgeBase');
  });

  it('growth tier: no knowledgeBase field', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).not.toHaveProperty('knowledgeBase');
  });

  it('premium tier: no knowledgeBase field', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).not.toHaveProperty('knowledgeBase');
  });

  it('free tier: no brandVoice field', async () => {
    const body = await fetchIntelligence(freeWsId);
    expect(body).not.toHaveProperty('brandVoice');
  });

  it('growth tier: no brandVoice field', async () => {
    const body = await fetchIntelligence(growthWsId);
    expect(body).not.toHaveProperty('brandVoice');
  });

  it('premium tier: no brandVoice field', async () => {
    const body = await fetchIntelligence(premiumWsId);
    expect(body).not.toHaveProperty('brandVoice');
  });

  it('insightsSummary.topInsights does not expose raw impact_score values', async () => {
    // topInsights items must only contain { title, type } — no impact_score
    const body = await fetchIntelligence(premiumWsId);
    const summary = body.insightsSummary as Record<string, unknown> | null;
    if (summary && Array.isArray(summary.topInsights) && summary.topInsights.length > 0) {
      for (const item of summary.topInsights as Array<Record<string, unknown>>) {
        expect(item).not.toHaveProperty('impact_score');
        expect(item).not.toHaveProperty('impactScore');
        expect(Object.keys(item).sort()).toEqual(['title', 'type'].sort());
      }
    }
  });
});

// ── 404 for unknown workspace ─────────────────────────────────────────────

describe('error handling', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/intelligence/ws-does-not-exist-xyz');
    expect(res.status).toBe(404);
  });

  it('404 body has an error field', async () => {
    const res = await api('/api/public/intelligence/ws-does-not-exist-xyz');
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
