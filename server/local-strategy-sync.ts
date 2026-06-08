/**
 * local-strategy-sync.ts
 *
 * Bidirectional staleness comparator between local SEO visibility data and
 * the keyword strategy. Kept in a focused module to avoid growing the
 * 2500+ line local-seo.ts further.
 *
 * All reads here are cheap aggregates — no full-model builders invoked.
 */

import {
  type LocalStrategySyncStatus,
  LOCAL_DATA_STALE_DAYS,
  LOCAL_NEEDS_REFRESH_REASON,
  LOCAL_SEO_POSTURE,
} from '../shared/types/local-seo.js';
import {
  getLocalSeoPosture,
  listLocalSeoMarkets,
  latestLocalSnapshotAt,
} from './local-seo.js';
import { getWorkspace } from './workspaces.js';

/**
 * Computes the bidirectional sync status between local visibility snapshots and
 * the keyword strategy for a workspace.
 *
 * - `applies` is true only when posture is 'local' or 'hybrid'.
 * - When `applies` is false, all flags are false and reason is null.
 * - Reason precedence: missing → markets_changed → stale → null.
 * - `strategyStaleVsLocal` is true when the strategy was generated before the
 *   most recent local refresh.
 */
export function getLocalStrategySyncStatus(workspaceId: string): LocalStrategySyncStatus {
  const posture = getLocalSeoPosture(workspaceId);
  const applies = posture === LOCAL_SEO_POSTURE.LOCAL || posture === LOCAL_SEO_POSTURE.HYBRID;

  // Read timestamps regardless of applies so we can still surface them.
  const lastLocalRefreshAt = latestLocalSnapshotAt(workspaceId);
  const ws = getWorkspace(workspaceId);
  const rawGeneratedAt = ws?.keywordStrategy?.generatedAt;
  const lastStrategyGeneratedAt = rawGeneratedAt && rawGeneratedAt.length > 0 ? rawGeneratedAt : null;

  if (!applies) {
    return {
      applies: false,
      localNeedsRefresh: false,
      localNeedsRefreshReason: null,
      strategyStaleVsLocal: false,
      lastLocalRefreshAt,
      lastStrategyGeneratedAt,
    };
  }

  // Determine localNeedsRefreshReason with the specified precedence.
  let reason: LocalStrategySyncStatus['localNeedsRefreshReason'] = null;

  if (lastLocalRefreshAt === null) {
    // No usable snapshots yet. Provider-failed rows are diagnostics, not freshness.
    reason = LOCAL_NEEDS_REFRESH_REASON.MISSING;
  } else {
    // Check markets_changed: any market.updatedAt > lastLocalRefreshAt.
    const markets = listLocalSeoMarkets(workspaceId);
    const snapshotDate = new Date(lastLocalRefreshAt);
    const anyMarketNewer = markets.some(
      (m) => new Date(m.updatedAt) > snapshotDate,
    );
    if (anyMarketNewer) {
      reason = LOCAL_NEEDS_REFRESH_REASON.MARKETS_CHANGED;
    } else {
      // Check stale: lastLocalRefreshAt older than LOCAL_DATA_STALE_DAYS days from now.
      const staleCutoff = new Date();
      staleCutoff.setDate(staleCutoff.getDate() - LOCAL_DATA_STALE_DAYS);
      if (snapshotDate < staleCutoff) {
        reason = LOCAL_NEEDS_REFRESH_REASON.STALE;
      }
    }
  }

  const localNeedsRefresh = reason !== null;

  // strategyStaleVsLocal: strategy was generated before the most recent local refresh.
  let strategyStaleVsLocal = false;
  if (lastStrategyGeneratedAt !== null && lastLocalRefreshAt !== null) {
    strategyStaleVsLocal = new Date(lastStrategyGeneratedAt) < new Date(lastLocalRefreshAt);
  }

  return {
    applies,
    localNeedsRefresh,
    localNeedsRefreshReason: reason,
    strategyStaleVsLocal,
    lastLocalRefreshAt,
    lastStrategyGeneratedAt,
  };
}
