/**
 * opportunity-timing — DECAYING timing-boost aggregation (PR7 · Spine B).
 *
 * Reads the active opportunity-event ledger and aggregates the decaying boost per
 * page into a `Map<pagePath, number>`. generateRecommendations consumes this map
 * once per rec-gen cycle and threads `timingBoost` into every computeOpportunityValue
 * call — where it lifts the timing multiplier (`timing = 1 + max(0, timingBoost)`).
 *
 * ═══ NO-OP WHEN THE EVENTS FLAG IS OFF ═══
 * When `opportunity-value-events` is OFF, computeTimingBoosts returns an EMPTY map.
 * maxBoostForPages on an empty map is always 0 → timingBoost 0 → timing multiplier 1
 * → computeOpportunityValue output is byte-identical to the pre-PR7 frozen snapshot.
 *
 * Read-only + try/catch → empty map. A failure here can NEVER break rec generation.
 *
 * Decay model: per page, boost_page = Σ over the page's active events of
 *   boost · exp(−ageDays / halfLifeDays)
 * capped at MAX_PAGE_BOOST so a flurry of events can't hijack the pre-calibration #1.
 * Events whose decayed contribution is below NEGLIGIBLE_BOOST are skipped.
 *
 * ═══ DEFERRED (out of scope for PR7 — documented per the plan) ═══
 *  • SEASONAL events + keyword_monthly_volumes (migration 111): a monthly seasonal
 *    `timing` boost needs ≥1yr of the 12-month volume series that trendDirection()
 *    currently drops (seo-provider-signals.ts). Deferred until that series is
 *    persisted and ≥1yr of data has accrued.
 *  • COMPETITOR defensive-rec MINTING: the competitor detector raises a timing
 *    boost on EXISTING recs (the value) but does NOT mint a net-new defensive rec.
 *    Minting is deferred (design §5 / plan PR7).
 */
import { isFeatureEnabled } from '../feature-flags.js';
import { createLogger } from '../logger.js';
import {
  listActiveOpportunityEvents,
  normalizeEventPagePath,
  type OpportunityEvent,
  type OpportunityEventType,
} from '../opportunity-events.js';

const log = createLogger('opportunity-timing');

/**
 * Per-type DEFAULT boost + half-life. CALIBRATION PATH: P5/P8 outcome calibration
 * will tune these per workspace from realized re-ranking value once history accrues
 * (mirrors workspace_opportunity_weights). Until then they are platform defaults.
 *
 *  • competitor — a competitor overtaking us is the most urgent, fast-fading signal.
 *  • decay      — a decaying page is urgent but recovers over a longer window.
 *  • rank_drop  — a SERP-position decline; medium urgency, medium fade.
 *  • publish    — a fresh publish/apply; a gentle, long nudge to reprioritize.
 */
export const EVENT_BOOST_DEFAULTS: Record<OpportunityEventType, { boost: number; halfLifeDays: number }> = {
  competitor: { boost: 0.6, halfLifeDays: 7 },   // calibration-path: P5 per-workspace
  decay: { boost: 0.5, halfLifeDays: 14 },       // calibration-path: P5 per-workspace
  rank_drop: { boost: 0.4, halfLifeDays: 10 },   // calibration-path: P5 per-workspace
  publish: { boost: 0.3, halfLifeDays: 30 },     // calibration-path: P5 per-workspace
};

/** Per-page boost cap so Timing can't hijack the #1 pre-calibration (design §5). */
export const MAX_PAGE_BOOST = 1.5;

/** Decayed contributions below this are dropped (and the whole event ignored). */
export const NEGLIGIBLE_BOOST = 0.01;

/** Exponential decay of a single event's boost given its age in days. */
function decayedContribution(event: OpportunityEvent, now: Date): number {
  const detectedMs = Date.parse(event.detectedAt);
  if (!Number.isFinite(detectedMs)) return 0;
  const ageDays = Math.max(0, (now.getTime() - detectedMs) / (24 * 60 * 60 * 1000));
  const halfLife = event.halfLifeDays > 0 ? event.halfLifeDays : 1;
  const baseBoost = Number.isFinite(event.boost) && event.boost > 0 ? event.boost : 0;
  if (baseBoost === 0) return 0;
  // exp(−ageDays / halfLife) → at ageDays === halfLife the contribution is ~0.368×.
  const contribution = baseBoost * Math.exp(-ageDays / halfLife);
  return Number.isFinite(contribution) ? contribution : 0;
}

/**
 * Aggregate the DECAYING timing boost per page for a workspace.
 *
 * @returns Map<pagePath (slug), totalBoost capped at MAX_PAGE_BOOST>. EMPTY when
 *          the events flag is OFF, on any error, or when no event contributes
 *          a non-negligible boost. Domain-level events (no pagePath) are ignored
 *          here because the boost is applied per affected page.
 */
export function computeTimingBoosts(workspaceId: string, now: Date = new Date()): Map<string, number> {
  const boosts = new Map<string, number>();

  // ── THE no-op gate: flag OFF → empty map → timingBoost 0 everywhere. ──
  if (!isFeatureEnabled('opportunity-value-events')) return boosts;

  try {
    const events = listActiveOpportunityEvents(workspaceId);
    for (const event of events) {
      const pagePath = normalizeEventPagePath(event.pagePath);
      if (!pagePath) continue; // domain-level event: no per-page boost target
      const contribution = decayedContribution(event, now);
      if (contribution < NEGLIGIBLE_BOOST) continue;
      const prev = boosts.get(pagePath) ?? 0;
      boosts.set(pagePath, prev + contribution);
    }
    // Cap each page's aggregate boost so Timing can't dominate the ranking.
    for (const [page, total] of boosts) {
      boosts.set(page, Math.min(MAX_PAGE_BOOST, total));
    }
  } catch (err) {
    log.warn({ workspaceId, err: err instanceof Error ? err.message : String(err) }, 'computeTimingBoosts failed — returning empty map');
    return new Map<string, number>();
  }

  return boosts;
}

/**
 * The max timing boost across a rec's affected pages (or 0). Used at each
 * computeOpportunityValue push site as `timingBoost`. Slug-normalises each page so
 * it matches the keys computeTimingBoosts produces. On an empty map this is always
 * 0 (the flag-off identity path).
 */
export function maxBoostForPages(boosts: Map<string, number>, affectedPages: readonly string[]): number {
  if (boosts.size === 0 || !affectedPages || affectedPages.length === 0) return 0;
  let max = 0;
  for (const page of affectedPages) {
    const slug = normalizeEventPagePath(page);
    if (!slug) continue;
    const b = boosts.get(slug);
    if (b != null && b > max) max = b;
  }
  return max;
}
