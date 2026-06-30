/**
 * Unit tests for server/outcome-backfill.ts
 *
 * Tests the four exported functions:
 *  - backfillPublishedContent
 *  - backfillResolvedInsights
 *  - backfillCompletedRecommendations
 *  - runBackfill
 *
 * All tests use the real SQLite DB (no HTTP server or createTestContext).
 * Bridge side-effects and broadcasts are mocked out.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';

// ── Dependency mocks ────────────────────────────────────────────────────────
// Must appear before importing outcome-backfill or outcome-tracking.

vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: vi.fn(),
  withWorkspaceLock: vi.fn(async (_wsId: string, fn: () => unknown) => fn()),
  debouncedOutcomeReweight: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    ANNOTATION_BRIDGE_CREATED: 'annotation_bridge_created',
    OUTCOME_SCORED: 'outcome_scored',
  },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../server/helpers.js', () => ({
  toInsightPageId: (url: string) => url,
}));

vi.mock('../../server/insight-score-adjustments.js', () => ({
  applyScoreAdjustment: vi.fn((data: unknown, score: number) => ({ data, adjustedScore: score })),
}));

// ── Module under test ────────────────────────────────────────────────────────

import {
  backfillPublishedContent,
  backfillResolvedInsights,
  backfillCompletedRecommendations,
  runBackfill,
} from '../../server/outcome-backfill.js';
import { getActionBySource } from '../../server/outcome-tracking.js';
import {
  saveRecommendations,
  updateRecommendationStatus,
} from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// ── Test workspace setup ─────────────────────────────────────────────────────

// Use a unique workspace ID per test run to avoid cross-test pollution.
const testWsId = `bf-test-ws-${Date.now()}`;

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId, 'Backfill Test WS', testWsId, new Date().toISOString());
});

afterAll(() => {
  // Clean up all seeded rows for this workspace.
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM content_posts WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM analytics_insights WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM recommendation_sets WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(testWsId);
});

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedPost(overrides: { published_at?: string | null; target_keyword?: string | null } = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_posts
       (id, workspace_id, brief_id, target_keyword, title, meta_description, introduction,
        status, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    testWsId,
    randomUUID(),
    overrides.target_keyword ?? 'test keyword',
    'Test Title',
    'Test meta',
    'Test intro',
    'published',
    now,
    now,
    overrides.published_at !== undefined ? overrides.published_at : now,
  );
  return id;
}

/**
 * Seed an analytics_insight.
 *
 * The table has a UNIQUE index on (workspace_id, COALESCE(page_id, '__workspace__'), insight_type).
 * To avoid collisions, each call uses a UUID-based page_id by default so the row is always
 * unique, regardless of how many insights share the workspace.
 */
function seedInsight(overrides: {
  resolution_status?: string | null;
  resolved_at?: string | null;
  page_id?: string | null;
  insight_type?: string;
} = {}) {
  const id = randomUUID();
  // Default to a UUID slug so (workspace, page, type) is always unique.
  // Callers that explicitly want to test a specific page_id pass it in overrides.
  const pageId = overrides.page_id !== undefined ? overrides.page_id : `/${randomUUID()}`;
  const insightType = overrides.insight_type ?? 'quick_win';
  db.prepare(
    `INSERT INTO analytics_insights
       (id, workspace_id, page_id, insight_type, data, severity, resolution_status, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    testWsId,
    pageId,
    insightType,
    JSON.stringify({ title: 'test insight' }),
    'opportunity',
    overrides.resolution_status ?? null,
    overrides.resolved_at ?? null,
  );
  return { id, pageId };
}

function makeBackfillRecommendation(overrides: Partial<Recommendation> & { id?: string } = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
    workspaceId: testWsId,
    priority: 'fix_soon',
    type: 'technical',
    title: 'Fix recommendation',
    description: 'Fix the issue',
    insight: 'The issue suppresses organic performance',
    impact: 'medium',
    effort: 'medium',
    impactScore: 50,
    source: 'audit:test',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'Improves organic performance',
    actionType: 'manual',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecommendationSet(recommendations: Array<Partial<Recommendation> & { id?: string }>) {
  const now = new Date().toISOString();
  const fullRecommendations = recommendations.map(makeBackfillRecommendation);
  db.prepare(
    `INSERT OR REPLACE INTO recommendation_sets (workspace_id, generated_at, recommendations, summary)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId, now, JSON.stringify(fullRecommendations), '{}');
}

function seedSavedRecommendationSet(recommendations: Recommendation[]): RecommendationSet {
  const set: RecommendationSet = {
    workspaceId: testWsId,
    generatedAt: new Date().toISOString(),
    recommendations,
    summary: {
      fixNow: 0,
      fixSoon: recommendations.filter(rec => rec.priority === 'fix_soon').length,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: recommendations.reduce((sum, rec) => sum + rec.impactScore, 0),
      trafficAtRisk: recommendations.reduce((sum, rec) => sum + rec.trafficAtRisk, 0),
      totalOpportunityValue: 0,
      actionableOpportunityValue: 0,
      topRecommendationId: recommendations.find(rec => rec.status !== 'completed' && rec.status !== 'dismissed')?.id ?? null,
    },
  };
  saveRecommendations(set);
  return set;
}

// ── Assertion helpers ────────────────────────────────────────────────────────

function countActionsForWorkspace(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM tracked_actions WHERE workspace_id = ?`)
    .get(testWsId) as { n: number };
  return row.n;
}

// ── Per-test cleanup (runs after EVERY test across all describe blocks) ──────
//
// Each test seeds its own data and expects a clean slate.  Cleaning up after
// every test (instead of at the end of each test body) ensures failures don't
// leave stale data that breaks the next test.

afterEach(() => {
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM content_posts WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM analytics_insights WHERE workspace_id = ?`).run(testWsId);
  db.prepare(`DELETE FROM recommendation_sets WHERE workspace_id = ?`).run(testWsId);
});

// ══════════════════════════════════════════════════════════════════════════════
//  backfillPublishedContent
// ══════════════════════════════════════════════════════════════════════════════

describe('backfillPublishedContent', () => {
  it('returns 0 when workspace has no posts', () => {
    const count = backfillPublishedContent('nonexistent-ws-xyz');
    expect(count).toBe(0);
  });

  it('returns 0 when workspace has no published posts (published_at IS NULL)', () => {
    seedPost({ published_at: null });
    const count = backfillPublishedContent(testWsId);
    expect(count).toBe(0);
  });

  it('returns 1 and creates a tracked action for a published post', () => {
    const postId = seedPost({ published_at: new Date().toISOString() });
    const count = backfillPublishedContent(testWsId);

    expect(count).toBe(1);

    const action = getActionBySource('post', postId);
    expect(action).not.toBeNull();
    expect(action!.actionType).toBe('content_published');
    expect(action!.sourceType).toBe('post');
    expect(action!.sourceId).toBe(postId);
    expect(action!.sourceFlag).toBe('backfill');
    expect(action!.baselineConfidence).toBe('estimated');
  });

  it('returns 2 for 2 published posts and skips 1 unpublished', () => {
    seedPost({ published_at: new Date().toISOString() });
    seedPost({ published_at: new Date().toISOString() });
    seedPost({ published_at: null }); // should be skipped

    const count = backfillPublishedContent(testWsId);
    expect(count).toBe(2);
  });

  it('is idempotent: running twice creates only 1 action per post', () => {
    const postId = seedPost({ published_at: new Date().toISOString() });

    const firstCount = backfillPublishedContent(testWsId);
    const secondCount = backfillPublishedContent(testWsId);

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(0); // already exists, skipped

    expect(countActionsForWorkspace()).toBe(1);

    const action = getActionBySource('post', postId);
    expect(action).not.toBeNull();
  });

  it('records attribution as platform_executed', () => {
    seedPost({ published_at: new Date().toISOString() });
    backfillPublishedContent(testWsId);

    const rows = db
      .prepare(`SELECT attribution FROM tracked_actions WHERE workspace_id = ?`)
      .all(testWsId) as Array<{ attribution: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].attribution).toBe('platform_executed');
  });

  it('records target_keyword from the post row', () => {
    seedPost({ published_at: new Date().toISOString(), target_keyword: 'seo services' });
    backfillPublishedContent(testWsId);

    const rows = db
      .prepare(`SELECT target_keyword FROM tracked_actions WHERE workspace_id = ?`)
      .all(testWsId) as Array<{ target_keyword: string | null }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].target_keyword).toBe('seo services');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  backfillResolvedInsights
// ══════════════════════════════════════════════════════════════════════════════

describe('backfillResolvedInsights', () => {
  it('returns 0 when workspace has no insights', () => {
    const count = backfillResolvedInsights('nonexistent-ws-xyz');
    expect(count).toBe(0);
  });

  it('returns 0 when all insights are unresolved (null status)', () => {
    seedInsight({ resolution_status: null });

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(0);
  });

  it('returns 0 when all insights are in_progress', () => {
    seedInsight({ resolution_status: 'in_progress' });

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(0);
  });

  it('returns 0 for mixed unresolved/in_progress insights with no resolved ones', () => {
    seedInsight({ resolution_status: null });
    seedInsight({ resolution_status: 'in_progress' });

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(0);
  });

  it('returns 1 and creates a tracked action for a resolved insight', () => {
    const { id: insightId } = seedInsight({
      resolution_status: 'resolved',
      resolved_at: new Date().toISOString(),
    });

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(1);

    const action = getActionBySource('insight', insightId);
    expect(action).not.toBeNull();
    expect(action!.actionType).toBe('insight_acted_on');
    expect(action!.sourceType).toBe('insight');
    expect(action!.sourceId).toBe(insightId);
    expect(action!.sourceFlag).toBe('backfill');
    expect(action!.baselineConfidence).toBe('estimated');
  });

  it('does not create an action for an unresolved insight', () => {
    seedInsight({ resolution_status: null });

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(0);
    expect(countActionsForWorkspace()).toBe(0);
  });

  it('does not create an action for an in_progress insight', () => {
    seedInsight({ resolution_status: 'in_progress' });

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(0);
    expect(countActionsForWorkspace()).toBe(0);
  });

  it('is idempotent: running twice creates only 1 action per insight', () => {
    const { id: insightId } = seedInsight({
      resolution_status: 'resolved',
      resolved_at: new Date().toISOString(),
    });

    const firstCount = backfillResolvedInsights(testWsId);
    const secondCount = backfillResolvedInsights(testWsId);

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(0);
    expect(countActionsForWorkspace()).toBe(1);

    const action = getActionBySource('insight', insightId);
    expect(action).not.toBeNull();
  });

  it('backfills 2 resolved and skips 1 unresolved', () => {
    seedInsight({ resolution_status: 'resolved', resolved_at: new Date().toISOString() });
    seedInsight({ resolution_status: 'resolved', resolved_at: new Date().toISOString() });
    seedInsight({ resolution_status: null }); // unresolved — must be skipped

    const count = backfillResolvedInsights(testWsId);
    expect(count).toBe(2);
  });

  it('records page_id as pageUrl on the tracked action', () => {
    const specificPageId = `/specific-page-${randomUUID()}`;
    const { id: insightId } = seedInsight({
      resolution_status: 'resolved',
      resolved_at: new Date().toISOString(),
      page_id: specificPageId,
    });

    backfillResolvedInsights(testWsId);

    const action = getActionBySource('insight', insightId);
    expect(action).not.toBeNull();
    expect(action!.pageUrl).toBe(specificPageId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  backfillCompletedRecommendations
// ══════════════════════════════════════════════════════════════════════════════

describe('backfillCompletedRecommendations', () => {
  it('returns 0 when no recommendation_set exists for the workspace', () => {
    const count = backfillCompletedRecommendations('nonexistent-ws-xyz');
    expect(count).toBe(0);
  });

  it('returns 0 when recommendation_set has no completed recommendations', () => {
    seedRecommendationSet([
      { id: randomUUID(), status: 'pending' },
      { id: randomUUID(), status: 'in_progress' },
    ]);

    const count = backfillCompletedRecommendations(testWsId);
    expect(count).toBe(0);
  });

  it('returns 0 for an empty recommendations array', () => {
    seedRecommendationSet([]);
    const count = backfillCompletedRecommendations(testWsId);
    expect(count).toBe(0);
  });

  it('returns 1 and creates a tracked action for a completed recommendation', () => {
    const recId = randomUUID();
    seedRecommendationSet([{ id: recId, status: 'completed' }]);

    const count = backfillCompletedRecommendations(testWsId);
    expect(count).toBe(1);

    const action = getActionBySource('recommendation', recId);
    expect(action).not.toBeNull();
    expect(action!.actionType).toBe('audit_fix_applied');
    expect(action!.sourceType).toBe('recommendation');
    expect(action!.sourceId).toBe(recId);
    expect(action!.sourceFlag).toBe('backfill');
  });

  it('skips non-completed recommendations and backfills only 2 completed ones', () => {
    seedRecommendationSet([
      { id: randomUUID(), status: 'completed' },
      { id: randomUUID(), status: 'completed' },
      { id: randomUUID(), status: 'pending' },
    ]);

    const count = backfillCompletedRecommendations(testWsId);
    expect(count).toBe(2);
  });

  it('is idempotent: running twice creates only 1 action per recommendation', () => {
    const recId = randomUUID();
    seedRecommendationSet([{ id: recId, status: 'completed' }]);

    const firstCount = backfillCompletedRecommendations(testWsId);
    const secondCount = backfillCompletedRecommendations(testWsId);

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(0);
    expect(countActionsForWorkspace()).toBe(1);
  });

  it('uses affectedPages[0] as pageUrl when available', () => {
    const recId = randomUUID();
    seedRecommendationSet([
      { id: recId, status: 'completed', affectedPages: ['/about', '/contact'] },
    ]);

    backfillCompletedRecommendations(testWsId);

    const action = getActionBySource('recommendation', recId);
    expect(action).not.toBeNull();
    expect(action!.pageUrl).toBe('/about');
  });

  it('sets pageUrl to null when no affectedPages provided', () => {
    const recId = randomUUID();
    seedRecommendationSet([{ id: recId, status: 'completed' }]);

    backfillCompletedRecommendations(testWsId);

    const action = getActionBySource('recommendation', recId);
    expect(action).not.toBeNull();
    expect(action!.pageUrl).toBeNull();
  });

  it('uses normalized row state over the stale legacy blob after row-only status updates', () => {
    const recId = randomUUID();
    const rec = makeBackfillRecommendation({ id: recId, status: 'pending' });
    seedSavedRecommendationSet([rec]);

    const legacyBefore = (db.prepare(
      'SELECT recommendations FROM recommendation_sets WHERE workspace_id = ?',
    ).get(testWsId) as { recommendations: string }).recommendations;

    const updated = updateRecommendationStatus(testWsId, recId, 'completed');
    expect(updated?.status).toBe('completed');
    expect((db.prepare(
      'SELECT recommendations FROM recommendation_sets WHERE workspace_id = ?',
    ).get(testWsId) as { recommendations: string }).recommendations).toBe(legacyBefore);

    const count = backfillCompletedRecommendations(testWsId);

    expect(count).toBe(1);
    const action = getActionBySource('recommendation', recId);
    expect(action).not.toBeNull();
    expect(action!.sourceFlag).toBe('backfill');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  runBackfill
// ══════════════════════════════════════════════════════════════════════════════

describe('runBackfill', () => {
  it('runs without throwing for a workspace with no history', () => {
    const result = runBackfill(testWsId);
    expect(result.errors).toBe(0);
    expect(result.backfilledCount).toBe(0);
  });

  it('returns BackfillResult with backfilledCount and errors as numbers', () => {
    const result = runBackfill(testWsId);
    expect(result).toHaveProperty('backfilledCount');
    expect(result).toHaveProperty('errors');
    expect(typeof result.backfilledCount).toBe('number');
    expect(typeof result.errors).toBe('number');
  });

  it('backfills a published post when called with a workspaceId', () => {
    seedPost({ published_at: new Date().toISOString() });

    const result = runBackfill(testWsId);
    expect(result.backfilledCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);
  });

  it('backfills a resolved insight when called with a workspaceId', () => {
    seedInsight({ resolution_status: 'resolved', resolved_at: new Date().toISOString() });

    const result = runBackfill(testWsId);
    expect(result.backfilledCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);
  });

  it('backfills a completed recommendation when called with a workspaceId', () => {
    const recId = randomUUID();
    seedRecommendationSet([{ id: recId, status: 'completed' }]);

    const result = runBackfill(testWsId);
    expect(result.backfilledCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);
  });

  it('aggregates counts from all three backfill sub-functions', () => {
    seedPost({ published_at: new Date().toISOString() });
    seedInsight({ resolution_status: 'resolved', resolved_at: new Date().toISOString() });
    const recId = randomUUID();
    seedRecommendationSet([{ id: recId, status: 'completed' }]);

    const result = runBackfill(testWsId);
    expect(result.backfilledCount).toBe(3);
    expect(result.errors).toBe(0);
  });

  it('is idempotent: second run creates 0 new actions', () => {
    seedPost({ published_at: new Date().toISOString() });

    const first = runBackfill(testWsId);
    const second = runBackfill(testWsId);

    expect(first.backfilledCount).toBe(1);
    expect(second.backfilledCount).toBe(0);
    expect(countActionsForWorkspace()).toBe(1);
  });

  it('returns errors=0 for a workspace with no history', () => {
    const result = runBackfill(testWsId);
    expect(result.errors).toBe(0);
  });
});
