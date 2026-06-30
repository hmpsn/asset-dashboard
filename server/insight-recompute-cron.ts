// server/insight-recompute-cron.ts
// Phase 5: daily activity-gated insight recompute. For each workspace with recent activity whose
// signals are stale (>24h), enqueues the INTELLIGENCE_RECOMPUTE background job. Gated behind the
// `signal-auto-recompute` flag (default OFF — dark-launched so the per-workspace GSC/GA4 cost is
// validated on staging first). Separate from the 6h LRU-warm cron (intelligence-crons.ts), which
// does NOT recompute insights.

import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { hasRecentActivity } from './activity-log.js';
import { getInsights } from './analytics-insights-store.js';
import { isStale } from './domains/analytics-intelligence/computations.js';
import { isFeatureEnabled } from './feature-flags.js';
import { enqueueIntelligenceRecompute } from './intelligence-recompute-job.js';

const log = createLogger('insight-recompute-cron');
const DAILY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 10 * 60 * 1000; // 10 min after boot — off the cold-start spike
// Tight window: this is a DAILY GSC/GA4-pulling recompute, not the 6h in-memory LRU warm (which uses
// 30d). 2 days bounds cost to genuinely-active workspaces (owner decision: conservative + kill-switch).
const RECENT_ACTIVITY_DAYS = 2;

let interval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export async function runDailyInsightRecompute(): Promise<void> {
  if (isRunning) { log.warn('Daily insight recompute already in progress — skipping cycle'); return; }
  // Kill switch: nothing fires until the flag is enabled (after the cost gate is validated on staging).
  if (!isFeatureEnabled('signal-auto-recompute')) return;
  isRunning = true;
  try {
    let enqueued = 0;
    let skippedInactive = 0;
    let skippedFresh = 0;
    for (const ws of listWorkspaces()) {
      try {
        if (!hasRecentActivity(ws.id, RECENT_ACTIVITY_DAYS)) { skippedInactive++; continue; }
        const insights = getInsights(ws.id);
        const newest = insights.length
          ? insights.reduce((n, i) => (i.computedAt > n ? i.computedAt : n), insights[0].computedAt)
          : undefined;
        // Un-forced: skip workspaces whose signals are already fresh (<24h) — self-dedupes against
        // view-triggered recomputes. isStale(undefined) === true, so never-computed workspaces recompute.
        if (!isStale(newest)) { skippedFresh++; continue; }
        enqueueIntelligenceRecompute(ws.id); // flag-gated + hasActiveJob-deduped inside
        enqueued++;
      } catch (err) {
        log.warn({ workspaceId: ws.id, err }, 'Daily insight recompute failed for workspace — skipping');
      }
    }
    log.info({ enqueued, skippedInactive, skippedFresh }, 'Daily insight recompute cycle complete');
  } finally {
    isRunning = false;
  }
}

export function startInsightRecomputeCron(): void {
  if (interval || startupTimeout) return;
  startupTimeout = setTimeout(() => { void runDailyInsightRecompute(); }, STARTUP_DELAY_MS);
  startupTimeout.unref?.();
  interval = setInterval(() => { void runDailyInsightRecompute(); }, DAILY_MS);
  interval.unref?.();
  log.info('Daily insight recompute cron started (every 24h, signal-auto-recompute-gated)');
}

export function stopInsightRecomputeCron(): void {
  if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
  if (interval) { clearInterval(interval); interval = null; }
}
