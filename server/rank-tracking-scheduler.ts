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
import { getSearchOverview } from './search-console.js';
import { storeRankSnapshot } from './rank-tracking.js';

const log = createLogger('rank-tracking-scheduler');

const DAILY_MS = 24 * 60 * 60 * 1000;

let rankInterval: ReturnType<typeof setInterval> | null = null;

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
      const overview = await getSearchOverview(ws.webflowSiteId, ws.gscPropertyUrl, 7);
      const date = new Date().toISOString().split('T')[0];
      const queries = overview.topQueries.map(q => ({
        query: q.query,
        position: q.position,
        clicks: q.clicks,
        impressions: q.impressions,
        ctr: q.ctr,
      }));
      storeRankSnapshot(ws.id, date, queries);
      log.info({ workspaceId: ws.id, count: queries.length, date }, 'Rank snapshot captured');
    } catch (err) {
      log.warn({ err, workspaceId: ws.id }, 'Failed to capture rank snapshot — skipping workspace');
    }
  }
}

/** Register the daily rank snapshot cron. Safe to call multiple times (idempotent). */
export function startRankTrackingScheduler(): void {
  if (rankInterval) return;

  // Run 2 minutes after startup, then every 24 hours
  setTimeout(() => {
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
