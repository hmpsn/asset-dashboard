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
 * Called from rank-tracking-scheduler.ts after detectLostVisibility().
 *
 * `runLostVisibilityBridge` is exported for direct unit/integration testing and
 * for the scheduler to call via fireBridge(). Returns { modified: N }.
 */
import { createLogger } from './logger.js';
import {
  getLostVisibilityCount,
  getLostVisibilityQueries,
} from './client-discovered-queries.js';
import {
  upsertInsight,
  getInsight,
} from './analytics-insights-store.js';
import {
  insertOpportunityEvent,
} from './opportunity-events.js';
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
 * Core bridge logic — reads from discovered_queries, mints the insight, and writes an
 * opportunity_event. Safe to call directly; the scheduler wraps it in fireBridge().
 *
 * Returns { modified: 0 } when there are no lost-visibility queries.
 */
export async function runLostVisibilityBridge(workspaceId: string): Promise<BridgeResult> {
  const lostCount = getLostVisibilityCount(workspaceId);
  if (lostCount === 0) {
    return { modified: 0 };
  }

  const rawQueries = getLostVisibilityQueries(workspaceId);

  // Check resolution: if the admin has resolved this insight, the upsert will overwrite
  // the data/severity/impactScore fields (updating counts) but NOT resolution_status
  // (intentionally omitted in the ON CONFLICT SET list — see analytics-insights-store.ts:59).
  // This matches the expected semantics: bridge re-mints always; resolution is preserved.
  const existing = getInsight(workspaceId, null, 'lost_visibility');
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

  // Mint an opportunity_event so the timing engine can lift recommendations for pages
  // that could capture the reclaimed visibility. pagePath=null (workspace-level signal).
  try {
    insertOpportunityEvent({
      workspaceId,
      type: 'rank_drop',
      pagePath: null,
      keyword: null,
      boost: 35,
      halfLifeDays: 14,
      source: 'bridge-lost-visibility',
      payload: { lostCount },
    });
  } catch (evErr) {
    log.warn({ workspaceId, err: evErr }, 'Lost-visibility opportunity-event write failed (non-fatal)');
  }

  log.info({ workspaceId, lostCount, severity, impactScore }, 'Lost-visibility insight minted');

  return { modified: 1 };
}
