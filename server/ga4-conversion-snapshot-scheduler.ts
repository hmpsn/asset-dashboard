/**
 * The Issue (Client) P0 — daily GA4 conversion-snapshot cron.
 *
 * runGa4ConversionSnapshots() — for every GA4-connected workspace, pulls the current key-event
 * conversions (getGA4Conversions), persists one ga4_conversion_snapshots row (saveGa4Snapshot),
 * and ensures the durable engagement-start anchor exists (ensureEngagementAnchor). Each workspace is
 * wrapped in try/catch + log.warn so one failure never aborts the pass (FM-2 honest degradation).
 *
 * Mirrors startRankTrackingScheduler: idempotent setTimeout(2m) + setInterval(DAILY_MS).
 */
import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { getGA4Conversions } from './google-analytics.js';
import { saveGa4Snapshot } from './ga4-snapshots.js';
import { ensureEngagementAnchor } from './the-issue-outcome.js';

const log = createLogger('ga4-conversion-snapshot-scheduler');

const DAILY_MS = 24 * 60 * 60 * 1000;

let snapshotInterval: ReturnType<typeof setInterval> | null = null;
let snapshotStartupTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Capture a GA4 conversion snapshot for every GA4-connected workspace. Each workspace is isolated
 * in its own try/catch so a single GA4 error degrades that workspace only (never throws the pass).
 */
export async function runGa4ConversionSnapshots(): Promise<void> {
  for (const ws of listWorkspaces()) {
    if (!ws.ga4PropertyId) continue;
    try {
      const summary = await getGA4Conversions(ws.ga4PropertyId, 1);
      const totalConversions = summary.reduce((sum, e) => sum + e.conversions, 0);
      const totalUsers = summary.reduce((max, e) => Math.max(max, e.users), 0);
      saveGa4Snapshot({
        workspaceId: ws.id,
        capturedAt: new Date().toISOString(),
        totalConversions,
        totalUsers,
        byEvent: summary,
      });
      await ensureEngagementAnchor(ws);
    } catch (err) {
      log.warn({ err, workspaceId: ws.id }, 'Failed to capture GA4 conversion snapshot — skipping workspace');
    }
  }
}

/** Register the daily GA4 conversion-snapshot cron. Safe to call multiple times (idempotent). */
export function startGa4ConversionSnapshotScheduler(): void {
  if (snapshotInterval || snapshotStartupTimeout) return;

  // Run 2 minutes after startup, then every 24 hours.
  snapshotStartupTimeout = setTimeout(() => {
    snapshotStartupTimeout = null;
    runGa4ConversionSnapshots().catch(err =>
      log.error({ err }, 'GA4 conversion snapshot scheduler initial run error'),
    );
  }, 2 * 60 * 1000);

  snapshotInterval = setInterval(() => {
    runGa4ConversionSnapshots().catch(err =>
      log.error({ err }, 'GA4 conversion snapshot scheduler error'),
    );
  }, DAILY_MS);

  log.info('GA4 conversion snapshot scheduler started (initial run in 2m, then 24h interval)');
}

/** Stop the GA4 conversion-snapshot scheduler (used during graceful shutdown / tests). */
export function stopGa4ConversionSnapshotScheduler(): void {
  if (snapshotStartupTimeout) {
    clearTimeout(snapshotStartupTimeout);
    snapshotStartupTimeout = null;
  }
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}
