/**
 * G3 — InsightsSlice.byType cap: redirected consumers keep PRE-cap count fidelity.
 *
 * The risk class this pins: a consumer computing counts/iteration from `byType`
 * silently under-reports once the 25-per-type cap lands. Contract:
 *   - `countsByType` carries full pre-cap per-type totals.
 *   - `byType` lists are capped at 25, ordered by impactScore desc (divergent
 *     fixture: highest-impact insight is NOT first by insertion order).
 *   - `all` is unaffected by the per-type cap.
 *   - The actual client read path (GET /api/public/intelligence/:id) reports
 *     summary counts equal to the pre-cap totals — not byType-capped counts —
 *     while still scrubbing admin-only insight types.
 *
 * Workspace is seeded without a clientPassword so the client-session
 * enforcement middleware passes through without requiring a login.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';
import { assembleInsights } from '../../server/intelligence/insights-slice.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const TYPE_COUNT = 30; // > 25 cap
let wsId = '';
let cleanup: () => void = () => {};

beforeAll(async () => {
  await ctx.startServer();

  const ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
  wsId = ws.workspaceId;
  cleanup = ws.cleanup;

  // Divergent ordering fixture: insert in ASCENDING impact order so the
  // highest-impact insight is the LAST inserted — the cap must select by
  // impactScore, never by insertion order.
  for (let i = 0; i < TYPE_COUNT; i++) {
    upsertInsight({
      workspaceId: wsId,
      pageId: `/page-${i}`,
      insightType: 'ranking_opportunity',
      data: { keyword: `kw-${i}`, position: 11 + i } as never,
      severity: 'opportunity',
      pageTitle: `Page ${i}`,
      impactScore: i + 1, // 1..30 ascending
    });
  }

  // Admin-only insight: must be scrubbed from client counts AND topInsights.
  upsertInsight({
    workspaceId: wsId,
    pageId: null,
    insightType: 'strategy_alignment',
    data: { note: 'admin only' } as never,
    severity: 'warning',
    impactScore: 500,
  });
}, 30_000);

afterAll(async () => {
  cleanup();
  await ctx.stopServer();
});

describe('assembled slice — cap + pre-cap rollups', () => {
  it('caps byType at 25 per type ordered by impactScore, keeps full countsByType, leaves all unaffected', async () => {
    const slice = await assembleInsights(wsId);

    // byType capped at 25, impact-ordered (highest first despite being inserted last)
    const ranking = slice.byType.ranking_opportunity ?? [];
    expect(ranking).toHaveLength(25);
    expect(ranking[0]?.impactScore).toBe(TYPE_COUNT);
    const scores = ranking.map(i => i.impactScore ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.at(-1)).toBe(6); // 30..6 — the 25 highest of 1..30

    // countsByType carries full PRE-cap totals
    expect(slice.countsByType.ranking_opportunity).toBe(TYPE_COUNT);
    expect(slice.countsByType.strategy_alignment).toBe(1);

    // countsByTypeBySeverity carries the full PRE-cap joint matrix
    expect(slice.countsByTypeBySeverity.ranking_opportunity).toEqual({
      critical: 0, warning: 0, opportunity: TYPE_COUNT, positive: 0,
    });
    expect(slice.countsByTypeBySeverity.strategy_alignment).toEqual({
      critical: 0, warning: 1, opportunity: 0, positive: 0,
    });

    // all is unaffected by the per-type cap (31 insights, under its own 100 cap)
    expect(slice.all).toHaveLength(TYPE_COUNT + 1);

    // bySeverity remains a full pre-cap rollup
    expect(slice.bySeverity.opportunity).toBe(TYPE_COUNT);
    expect(slice.bySeverity.warning).toBe(1);
  });
});

describe('client read path — GET /api/public/intelligence/:workspaceId', () => {
  it('reports summary counts equal to PRE-cap totals, not byType-capped counts', async () => {
    const res = await api(`/api/public/intelligence/${wsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const summary = body.insightsSummary as {
      total: number;
      highPriority: number;
      mediumPriority: number;
      topInsights: Array<{ type: string }>;
    } | null;

    expect(summary).not.toBeNull();
    // 30 opportunity insights — NOT 25 (the byType cap must not leak into counts).
    expect(summary!.mediumPriority).toBe(TYPE_COUNT);
    expect(summary!.total).toBe(TYPE_COUNT);
    // The admin-only strategy_alignment (severity=warning) is scrubbed from counts...
    expect(summary!.highPriority).toBe(0);
    // ...and from topInsights.
    expect(summary!.topInsights.map(i => i.type)).not.toContain('strategy_alignment');
  });
});
