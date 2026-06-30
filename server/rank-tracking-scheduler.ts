/**
 * Background scheduler for rank tracking.
 *
 * runRankTrackingSnapshots() — captures GSC rank data for every workspace that has
 * a GSC property and a Webflow site ID configured. Runs daily via startRankTrackingScheduler().
 *
 * Key correctness requirement: uses ws.webflowSiteId (not ws.id) when calling
 * getSearchOverview, because OAuth tokens are stored keyed by Webflow site ID.
 */
import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { getSearchOverview, getSearchQueryObservations } from './search-console.js';
import { storeRankSnapshot } from './rank-tracking.js';
import { GSC_METRIC_WINDOW_DAYS } from '../shared/keyword-window.js';
import {
  detectLostVisibility,
  pruneDiscoveredQueries,
  upsertDiscoveredQueries,
  type DiscoveredQueryObservation,
} from './client-discovered-queries.js';
import { fireBridge } from './bridge-infrastructure.js';
import { runLostVisibilityBridge } from './bridge-lost-visibility.js';
import { broadcastToWorkspace } from './broadcast.js';
import { enqueueIntelligenceRecompute } from './intelligence-recompute-job.js';
import { WS_EVENTS } from './ws-events.js';

const log = createLogger('rank-tracking-scheduler');

const DAILY_MS = 24 * 60 * 60 * 1000;

let rankInterval: ReturnType<typeof setInterval> | null = null;
let rankStartupTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Run a rank snapshot for each eligible workspace.
 *
 * @param workspaceIds - Optional list of workspace IDs to restrict to (used in tests).
 *                       When omitted, all workspaces are processed.
 */
export async function runRankTrackingSnapshots(workspaceIds?: string[]): Promise<void> {
  const allWorkspaces = listWorkspaces();
  const targets = workspaceIds
    ? allWorkspaces.filter(ws => workspaceIds.includes(ws.id))
    : allWorkspaces;

  for (const ws of targets) {
    if (!ws.gscPropertyUrl || !ws.webflowSiteId) continue;

    try {
      const [overview, observedQueries] = await Promise.all([
        getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, GSC_METRIC_WINDOW_DAYS, { queryLimit: 5000 }),
        getSearchQueryObservations(ws.webflowSiteId, ws.gscPropertyUrl, GSC_METRIC_WINDOW_DAYS, { maxRows: 5000 }),
      ]);
      const date = new Date().toISOString().split('T')[0];
      const queries = overview.topQueries.map(q => ({
        query: q.query,
        position: q.position,
        clicks: q.clicks,
        impressions: q.impressions,
        ctr: q.ctr,
      }));
      storeRankSnapshot(ws.id, date, queries);

      // Group per-date observations and upsert each date separately so the
      // idempotency CASE (last_snapshot_date = excluded.last_snapshot_date)
      // prevents total_impressions from accumulating overlapping 28-day windows.
      const byDate = new Map<string, DiscoveredQueryObservation[]>();
      for (const row of observedQueries) {
        const group = byDate.get(row.date) ?? [];
        group.push({
          query: row.query,
          position: row.position,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          seenDate: row.date,
        });
        if (!byDate.has(row.date)) byDate.set(row.date, group);
      }
      for (const [snapshotDate, dateQueries] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        upsertDiscoveredQueries(ws.id, dateQueries, snapshotDate);
      }
      detectLostVisibility(ws.id, date);
      pruneDiscoveredQueries(ws.id, date);
      fireBridge('bridge-lost-visibility', ws.id, async () => runLostVisibilityBridge(ws.id));
      // A4 review I2: new daily positions must reach open dashboards live — the
      // requested-keyword trend card (and any rank-history consumer) invalidates
      // on this event. Without it, cron-written snapshots only appeared on refetch.
      broadcastToWorkspace(ws.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
        source: 'rank_snapshot_cron',
        date,
        queryCount: queries.length,
      });
      // Phase 5c: fresh rank data lands → refresh signals. No-ops unless the signal-auto-recompute
      // flag is on; deduped via hasActiveJob (the lost_visibility bridge above owns its own insights).
      enqueueIntelligenceRecompute(ws.id);
      log.info({ workspaceId: ws.id, count: queries.length, date }, 'Rank snapshot captured');
    } catch (err) {
      log.warn({ err, workspaceId: ws.id }, 'Failed to capture rank snapshot — skipping workspace');
    }
  }
}

/** Register the daily rank snapshot cron. Safe to call multiple times (idempotent). */
export function startRankTrackingScheduler(): void {
  if (rankInterval || rankStartupTimeout) return;

  // Run 2 minutes after startup, then every 24 hours
  rankStartupTimeout = setTimeout(() => {
    rankStartupTimeout = null;
    runRankTrackingSnapshots().catch(err =>
      log.error({ err }, 'Rank tracking scheduler initial run error'),
    );
  }, 2 * 60 * 1000);

  rankInterval = setInterval(() => {
    runRankTrackingSnapshots().catch(err =>
      log.error({ err }, 'Rank tracking scheduler error'),
    );
  }, DAILY_MS);

  log.info('Rank tracking scheduler started (initial run in 2m, then 24h interval)');
}

/** Stop the rank tracking scheduler (used during graceful shutdown). */
export function stopRankTrackingScheduler(): void {
  if (rankStartupTimeout) {
    clearTimeout(rankStartupTimeout);
    rankStartupTimeout = null;
  }
  if (rankInterval) {
    clearInterval(rankInterval);
    rankInterval = null;
  }
}
