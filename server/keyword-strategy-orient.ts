// ── Strategy v2 Orient-zone metrics ───────────────────────────────
// The top-line "where the site sits" glance: a 0–100 visibility score plus
// clicks / impressions / ranked-keywords / avg-position, each with a delta vs the
// previous strategy generation. Computed server-side (admin GET) because the score
// uses the CTR-decay curve and the deltas need the prior strategy_history snapshot.
// See docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md (Phase 1).

import db from './db/index.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { strategyHistoryOrientPageSchema } from './schemas/workspace-schemas.js';
import { buildCtrCurve, type GscKeywordObservation } from './scoring/ctr-curve.js';
import { computeVisibilityScore } from './scoring/visibility-score.js';
import type { OrientMetrics } from '../shared/types/keyword-strategy-ux.js';

/** Minimal page shape for Orient metrics — satisfied by both PageKeywordMap and the
 *  passthrough-parsed prior strategy_history snapshot. */
export interface OrientPage {
  currentPosition?: number;
  volume?: number;
  clicks?: number;
  impressions?: number;
  gscKeywords?: { query: string; clicks: number; impressions: number; position: number }[];
}

function flattenObservations(pages: OrientPage[]): GscKeywordObservation[] {
  const obs: GscKeywordObservation[] = [];
  for (const p of pages) {
    for (const g of p.gscKeywords ?? []) {
      obs.push({ query: g.query, clicks: g.clicks, impressions: g.impressions, position: g.position });
    }
  }
  return obs;
}

interface Aggregate {
  score: number;
  clicks: number;
  impressions: number;
  rankedKeywords: number;
  avgPosition: number;
}

function aggregate(pages: OrientPage[], curve: Record<number, number>): Aggregate {
  const score = computeVisibilityScore(
    pages.map((p) => ({ position: p.currentPosition ?? null, volume: p.volume ?? null })),
    curve,
  );
  let clicks = 0;
  let impressions = 0;
  let rankedSum = 0;
  let rankedKeywords = 0;
  for (const p of pages) {
    clicks += p.clicks ?? 0;
    impressions += p.impressions ?? 0;
    if (typeof p.currentPosition === 'number' && p.currentPosition >= 1) {
      rankedSum += p.currentPosition;
      rankedKeywords += 1;
    }
  }
  return { score, clicks, impressions, rankedKeywords, avgPosition: rankedKeywords > 0 ? rankedSum / rankedKeywords : 0 };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const hasPositiveVolume = (pages: OrientPage[]): boolean =>
  pages.some((p) => typeof p.volume === 'number' && Number.isFinite(p.volume) && p.volume > 0);

/**
 * Pure Orient-metrics builder: current vs prior page sets → score + stat deltas.
 * Exported for unit testing (no DB). A null/empty `priorPages` yields null deltas.
 */
export function buildOrientMetrics(currentPages: OrientPage[], priorPages: OrientPage[] | null): OrientMetrics {
  // One CTR curve (calibrated from the CURRENT period's GSC observations) is applied to BOTH
  // periods, so the visibility-score delta isolates ranking/volume changes rather than conflating
  // them with CTR-curve drift between snapshots.
  const curve = buildCtrCurve(flattenObservations(currentPages)).curve;
  const cur = aggregate(currentPages, curve);
  const prior = priorPages && priorPages.length > 0 ? priorPages : null;
  const prev = prior ? aggregate(prior, curve) : null;

  // The visibility score switches weighting mode (volume-weighted ↔ unweighted) depending on whether
  // any page carries volume. If the two snapshots differ on that, a score delta would reflect the
  // mode switch (e.g. enrichment volume lapsing or freshly arriving) rather than a real ranking
  // change — so suppress it. The raw stat deltas (clicks/impressions/ranked/position) are unaffected.
  const scoreComparable = prev != null && prior != null && hasPositiveVolume(currentPages) === hasPositiveVolume(prior);

  const curAvg = round1(cur.avgPosition);
  const prevAvg = prev ? round1(prev.avgPosition) : 0;

  return {
    visibilityScore: cur.score,
    visibilityScoreDelta: scoreComparable && prev ? cur.score - prev.score : null,
    clicks: cur.clicks,
    clicksDelta: prev ? cur.clicks - prev.clicks : null,
    impressions: cur.impressions,
    impressionsDelta: prev ? cur.impressions - prev.impressions : null,
    rankedKeywords: cur.rankedKeywords,
    rankedKeywordsDelta: prev ? cur.rankedKeywords - prev.rankedKeywords : null,
    avgPosition: curAvg,
    // Delta computed from the already-rounded values so displayed current/prior/delta stay consistent.
    avgPositionDelta: prev ? round1(curAvg - prevAvg) : null,
  };
}

/**
 * Orient-zone metrics for a workspace's current pageMap, reading the latest
 * strategy_history snapshot to derive deltas. Admin GET read path only.
 */
export function computeOrientMetrics(workspaceId: string, currentPageMap: OrientPage[]): OrientMetrics {
  const prevRow = db
    .prepare('SELECT page_map_json FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 1')
    .get(workspaceId) as { page_map_json: string } | undefined;
  const priorPages = prevRow?.page_map_json
    ? (parseJsonSafeArray(prevRow.page_map_json, strategyHistoryOrientPageSchema, {
        workspaceId,
        field: 'page_map_json',
        table: 'strategy_history',
      }) as OrientPage[])
    : null;
  return buildOrientMetrics(currentPageMap, priorPages);
}
