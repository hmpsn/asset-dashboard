/**
 * bridge-local-visibility-shift — insight bridge for local SEO snapshot transitions (W5.3).
 *
 * The `local_visibility_snapshots` time series accumulates on every refresh but is read
 * latest-only everywhere — no trend, no insights. This bridge mines the diff between the
 * PREVIOUS latest-per-(market, keyword, device, language) state and the NEW latest state
 * captured by a refresh, and mints `local_visibility_shift` insights for:
 *   - visible → not_visible (direction: 'risk')
 *   - not_visible → visible (direction: 'win')
 *   - a new repeat competitor appearing across a market (direction: 'competitor')
 *
 * Bridge authoring rules (docs/rules/bridge-authoring.md):
 *   1. bridgeSource passed to upsertInsight ✓ (literal 'bridge-local-visibility-shift')
 *   2. score set directly on first mint; this bridge owns the base score exclusively, so
 *      no applyScoreAdjustment delta is layered (mirrors bridge-lost-visibility) ✓
 *   3. Returns { modified: N }, never calls broadcastToWorkspace() ✓
 *   4. Never calls resolveInsight() — only suppresses superseded shift insights it owns ✓
 *
 * Dedup / edge-triggering: the bridge is edge-triggered — it compares prev-latest vs
 * new-latest. An identity whose visibility did NOT change between two refreshes produces
 * no transition, so nothing is re-minted while the state persists (Section 5 anomaly-dedup
 * intent: one active entry per transition, not one per refresh). Each transition upserts on
 * a deterministic dedup pageId (`market::normKeyword::device::lang::direction`), so re-running
 * with the same diff is idempotent. When a `win` transition fires, any stale `risk` insight
 * for the same identity is suppressed (and vice versa) so the feed never shows a recovered
 * problem alongside its recovery.
 *
 * Called from runLocalSeoRefreshJob (server/local-seo.ts) AFTER snapshots are written,
 * passing the pre-refresh latest state captured before the crawl began.
 *
 * `runLocalVisibilityShiftBridge` is exported for direct unit/integration testing and for
 * the refresh job to call via fireBridge(). Returns { modified: N }.
 */
import { createLogger } from './logger.js';
import {
  upsertInsight,
  getInsight,
  suppressInsights,
} from './analytics-insights-store.js';
import type { BridgeResult } from './bridge-infrastructure.js';
import type { InsightSeverity, LocalVisibilityShiftData } from '../shared/types/analytics.js';
import type { LocalVisibilitySnapshot } from '../shared/types/local-seo.js';
import { LOCAL_VISIBILITY_STATUS } from '../shared/types/local-seo.js';

const log = createLogger('bridge-local-visibility-shift');

const BRIDGE_SOURCE = 'bridge-local-visibility-shift';

/**
 * Minimum number of distinct keywords a competitor must appear across (in a single
 * market, in the new snapshot set) to count as a "repeat" competitor worth surfacing.
 * A single appearance is noise; repeat appearance signals a real local rival.
 */
const REPEAT_COMPETITOR_MIN_KEYWORDS = 2;

/** Cap on competitor-shift insights minted per refresh to avoid feed floods. */
const MAX_COMPETITOR_SHIFTS = 5;

type ShiftDirection = LocalVisibilityShiftData['direction'];

/** A snapshot is "visible" when the business was found in the local pack. */
function isVisible(snapshot: Pick<LocalVisibilitySnapshot, 'businessFound' | 'status'>): boolean {
  return snapshot.businessFound && snapshot.status === LOCAL_VISIBILITY_STATUS.SUCCESS;
}

/**
 * A snapshot is a usable signal when it is not a hard provider failure and not degraded.
 * Degraded snapshots carry businessFound=false regardless of actual visibility, so treating
 * them as usable mints spurious risk/win flaps. This matches the postureFromSummaryRow
 * convention in server/local-seo.ts which buckets DEGRADED with PROVIDER_FAILED as
 * untrustworthy.
 */
function isUsable(snapshot: Pick<LocalVisibilitySnapshot, 'status'>): boolean {
  return snapshot.status !== LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED
    && snapshot.status !== LOCAL_VISIBILITY_STATUS.DEGRADED;
}

/** Stable identity key for the latest-per-(market, keyword, device, language) granularity. */
function identityKey(s: Pick<LocalVisibilitySnapshot, 'marketId' | 'normalizedKeyword' | 'device' | 'languageCode'>): string {
  return `${s.marketId}::${s.normalizedKeyword}::${s.device}::${s.languageCode}`;
}

/** Dedup pageId for a per-identity shift insight (one active entry per direction). */
function shiftPageId(key: string, direction: ShiftDirection): string {
  return `local_shift::${key}::${direction}`;
}

/** Dedup pageId for a market-level new-competitor insight. */
function competitorPageId(marketId: string, competitorName: string): string {
  return `local_competitor::${marketId}::${competitorName.toLowerCase()}`;
}

function severityFor(direction: ShiftDirection): InsightSeverity {
  if (direction === 'win') return 'positive';
  if (direction === 'risk') return 'warning';
  return 'opportunity'; // competitor — heads-up, not yet a loss
}

function impactFor(direction: ShiftDirection): number {
  if (direction === 'risk') return 70;     // lost visibility is the most actionable
  if (direction === 'win') return 45;      // a win is notable but not urgent
  return 40;                                // competitor heads-up
}

function competitorName(c: { title?: string; domain?: string }): string | null {
  const name = (c.title || c.domain || '').trim();
  return name.length > 0 ? name : null;
}

/**
 * Build a Map keyed by competitor name → set of normalized keywords it appears in,
 * scoped to a single market, from a list of snapshots for that market.
 */
function competitorKeywordCounts(snapshots: LocalVisibilitySnapshot[]): Map<string, Set<string>> {
  const counts = new Map<string, Set<string>>();
  for (const snap of snapshots) {
    for (const comp of snap.topCompetitors) {
      const name = competitorName(comp);
      if (!name) continue;
      let set = counts.get(name);
      if (!set) { set = new Set<string>(); counts.set(name, set); }
      set.add(snap.normalizedKeyword);
    }
  }
  return counts;
}

/**
 * Core bridge logic — diffs the previous latest-state against the new latest-state and
 * mints/updates/retires `local_visibility_shift` insights. Pure with respect to inputs:
 * the caller supplies both snapshot lists so this is trivially testable without a refresh.
 */
export async function runLocalVisibilityShiftBridge(
  workspaceId: string,
  previousLatest: LocalVisibilitySnapshot[],
  newLatest: LocalVisibilitySnapshot[],
): Promise<BridgeResult> {
  const detectedAt = new Date().toISOString();
  let modified = 0;

  // Index the previous latest state by identity for O(1) transition lookup.
  const prevByKey = new Map<string, LocalVisibilitySnapshot>();
  for (const snap of previousLatest) {
    if (!isUsable(snap)) continue;
    prevByKey.set(identityKey(snap), snap);
  }

  // ── Visibility transitions (risk / win) ──────────────────────────────────
  for (const next of newLatest) {
    if (!isUsable(next)) continue;
    const key = identityKey(next);
    const prev = prevByKey.get(key);
    // A transition requires a prior usable observation to compare against. First-ever
    // observation of an identity is not a transition (no edge), so skip it.
    if (!prev) continue;

    const wasVisible = isVisible(prev);
    const nowVisible = isVisible(next);
    if (wasVisible === nowVisible) continue; // no edge — nothing to mint

    const direction: ShiftDirection = nowVisible ? 'win' : 'risk';
    const opposite: ShiftDirection = nowVisible ? 'risk' : 'win';

    const data: LocalVisibilityShiftData = {
      direction,
      marketId: next.marketId,
      marketLabel: next.marketLabel,
      keyword: next.keyword,
      normalizedKeyword: next.normalizedKeyword,
      device: next.device,
      languageCode: next.languageCode,
      previousRank: prev.localRank ?? null,
      currentRank: next.localRank ?? null,
      detectedAt,
    };

    upsertInsight({
      workspaceId,
      pageId: shiftPageId(key, direction),
      insightType: 'local_visibility_shift',
      severity: severityFor(direction),
      domain: 'search',
      impactScore: impactFor(direction),
      bridgeSource: BRIDGE_SOURCE,
      data,
    });
    modified++;

    // Retire the opposite-direction shift insight for this identity so the feed never
    // shows "lost visibility" next to its own recovery (and vice versa).
    const stale = getInsight(workspaceId, shiftPageId(key, opposite), 'local_visibility_shift');
    if (stale) {
      suppressInsights(workspaceId, [stale.id]);
      modified++;
    }
  }

  // ── New repeat competitors (per market) ──────────────────────────────────
  const newByMarket = new Map<string, LocalVisibilitySnapshot[]>();
  const prevByMarket = new Map<string, LocalVisibilitySnapshot[]>();
  for (const snap of newLatest) {
    if (!isUsable(snap)) continue;
    (newByMarket.get(snap.marketId) ?? newByMarket.set(snap.marketId, []).get(snap.marketId)!).push(snap);
  }
  for (const snap of previousLatest) {
    if (!isUsable(snap)) continue;
    (prevByMarket.get(snap.marketId) ?? prevByMarket.set(snap.marketId, []).get(snap.marketId)!).push(snap);
  }

  let competitorShifts = 0;
  for (const [marketId, marketSnaps] of newByMarket) {
    if (competitorShifts >= MAX_COMPETITOR_SHIFTS) break;
    const newCounts = competitorKeywordCounts(marketSnaps);
    const prevCounts = competitorKeywordCounts(prevByMarket.get(marketId) ?? []);
    const marketLabel = marketSnaps[0]?.marketLabel ?? marketId;

    // Sort by appearance count DESC so the most-present new rivals surface first.
    const ranked = [...newCounts.entries()]
      .filter(([name, kws]) => kws.size >= REPEAT_COMPETITOR_MIN_KEYWORDS && (prevCounts.get(name)?.size ?? 0) < REPEAT_COMPETITOR_MIN_KEYWORDS)
      .sort((a, b) => b[1].size - a[1].size);

    for (const [name, kws] of ranked) {
      if (competitorShifts >= MAX_COMPETITOR_SHIFTS) break;
      const data: LocalVisibilityShiftData = {
        direction: 'competitor',
        marketId,
        marketLabel,
        competitorName: name,
        competitorAppearances: kws.size,
        detectedAt,
      };
      upsertInsight({
        workspaceId,
        pageId: competitorPageId(marketId, name),
        insightType: 'local_visibility_shift',
        severity: severityFor('competitor'),
        domain: 'search',
        impactScore: impactFor('competitor'),
        bridgeSource: BRIDGE_SOURCE,
        data,
      });
      modified++;
      competitorShifts++;
    }
  }

  if (modified > 0) {
    log.info({ workspaceId, modified }, 'Local visibility shift insights minted/updated');
  }

  return { modified };
}
