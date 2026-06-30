/**
 * bridge-lost-visibility — insight bridge for lost-visibility detection (G1, audit #9).
 *
 * Wires the existing daily lost-visibility detection (client-discovered-queries.ts /
 * rank-tracking-scheduler.ts) into a proactive `lost_visibility` insight that surfaces
 * in the admin feed and the client InsightsDigest.
 *
 * Bridge authoring rules (docs/rules/bridge-authoring.md):
 *   1. bridgeSource passed to upsertInsight ✓
 *   2. applyScoreAdjustment used for score changes ✓ (base score set directly on first mint;
 *      on re-runs the upsert overwrites the score — no score-adjustment delta is applied
 *      because this bridge owns the base score exclusively)
 *   3. Returns { modified: N }, never calls broadcastToWorkspace() ✓
 *   4. Never calls resolveInsight() ✓ (only checks resolutionStatus to avoid un-resolving)
 *
 * Lifecycle: mints/updates the insight while lost queries exist; when every lost query
 * recovers (lostCount returns to 0), the insight is DELETED so the feed never shows a
 * stale alert for a recovered problem (review fix — bridge-sourced rows are exempt from
 * deleteStaleInsightsByType, so this bridge owns its own cleanup).
 *
 * Note: no opportunity_event is minted. The timing engine's computeTimingBoosts skips
 * events without a pagePath, and lost-visibility detection is workspace-level — a
 * page-resolved event needs a keyword→page mapping first (future work, see plan doc).
 *
 * Called from rank-tracking-scheduler.ts after detectLostVisibility().
 *
 * `runLostVisibilityBridge` is exported for direct unit/integration testing and
 * for the scheduler to call via fireBridge(). Returns { modified: N }.
 */
import { createLogger } from './logger.js';
import { getLostVisibilityCount, getLostVisibilityQueries } from './client-discovered-queries.js';
import {
  upsertInsight,
  getInsight,
  suppressInsights,
} from './analytics-insights-store.js';
import type { BridgeResult } from './bridge-infrastructure.js';
import type { InsightSeverity } from '../shared/types/analytics.js';

const log = createLogger('bridge-lost-visibility');

/** Maximum number of top-lost queries to store in the insight data blob */
const TOP_QUERIES_LIMIT = 5;

/**
 * Compute severity from lost count.
 * - warning:     3+ lost queries (actionable alert level)
 * - opportunity: 1–2 lost queries (heads-up, not yet alarming)
 */
function computeSeverity(lostCount: number): InsightSeverity {
  return lostCount >= 3 ? 'warning' : 'opportunity';
}

/**
 * Compute impactScore from lost count.
 * Floor 30 (always notable), capped at 100. +2 per lost query.
 */
function computeImpactScore(lostCount: number): number {
  return Math.min(100, 30 + lostCount * 2);
}

/**
 * Core bridge logic — reads detected lost-visibility rows and mints, updates, or
 * retires the workspace-level insight. Safe to call directly; the scheduler wraps
 * it in fireBridge().
 */
export async function runLostVisibilityBridge(workspaceId: string): Promise<BridgeResult> {
  const rawQueries = getLostVisibilityQueries(workspaceId);
  const lostCount = getLostVisibilityCount(workspaceId);
  const existing = getInsight(workspaceId, null, 'lost_visibility');

  if (lostCount === 0) {
    // Recovery path (review fix): all previously-lost queries are visible again.
    // Delete the insight — resolved or not — so the admin feed, client digest, and
    // briefing candidates stop surfacing a recovered problem. Returning modified: 1
    // makes the bridge infrastructure broadcast so frontends refresh.
    if (existing) {
      suppressInsights(workspaceId, [existing.id]);
      log.info({ workspaceId, insightId: existing.id }, 'Lost-visibility recovered — insight retired');
      return { modified: 1 };
    }
    return { modified: 0 };
  }

  // Deliberate choice: once an admin resolves the insight, this bridge stops updating
  // it — even if the lost count later escalates. The ON CONFLICT clause would preserve
  // resolution_status on its own, so this skip is an EXTRA-conservative mute: a resolved
  // alert stays muted until the queries recover (which deletes the row above) and a NEW
  // loss re-mints a fresh, unresolved insight. Tradeoff: no re-alert on escalation while
  // still resolved; revisit if admins ask for escalation re-alerts.
  if (existing?.resolutionStatus === 'resolved') {
    log.debug({ workspaceId, lostCount }, 'lost_visibility insight is resolved — skipping upsert');
    return { modified: 0 };
  }

  const topQueries = rawQueries.slice(0, TOP_QUERIES_LIMIT).map(q => ({
    query: q.query || '(unknown query)',        // enrichment fallback: never empty string
    lastPosition: q.lastPosition,
    lastSeen: q.lastSeen,
    totalImpressions: q.totalImpressions,
  }));

  const severity = computeSeverity(lostCount);
  const impactScore = computeImpactScore(lostCount);
  const detectedAt = new Date().toISOString();

  upsertInsight({
    workspaceId,
    pageId: null,
    insightType: 'lost_visibility',
    severity,
    domain: 'search',
    impactScore,
    bridgeSource: 'bridge-lost-visibility',
    data: {
      lostCount,
      topQueries,
      detectedAt,
    },
  });

  log.info({ workspaceId, lostCount, severity, impactScore }, 'Lost-visibility insight minted');

  return { modified: 1 };
}
