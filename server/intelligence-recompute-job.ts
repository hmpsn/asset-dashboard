import { getOrComputeInsights } from './analytics-intelligence.js';
import { broadcastToWorkspace } from './broadcast.js';
import { isProgrammingError } from './errors.js';
import { getJob, updateJob, createJob, hasActiveJob } from './jobs.js';
import { isFeatureEnabled } from './feature-flags.js';
import { createLogger } from './logger.js';
import { WS_EVENTS } from './ws-events.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

const log = createLogger('intelligence-recompute-job');

/**
 * Enqueue an automated intelligence recompute for a workspace — the single entry point for the daily
 * cron (Phase 5c) and the on-mutation triggers (strategy edit / rank snapshot / content publish).
 *
 * Gated on the `signal-auto-recompute` flag (default OFF → dark-launched, so the GSC/GA4 cost can be
 * watched on staging) and deduped via `hasActiveJob` so a burst of triggers collapses to one job.
 * The manual "Recompute now" route does NOT go through this — it always enqueues regardless of the flag.
 */
export function enqueueIntelligenceRecompute(workspaceId: string): void {
  if (!isFeatureEnabled('signal-auto-recompute')) return;
  if (hasActiveJob(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE, workspaceId)) return;
  const job = createJob(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE, { workspaceId, message: 'Refreshing signals...' });
  setTimeout(() => { void runIntelligenceRecomputeJob(job.id, workspaceId); }, 100);
}

/**
 * Background worker that recomputes a workspace's analytics insights / intelligence signals.
 *
 * Drives `getOrComputeInsights(ws, undefined, { force: true })` — the full recompute (pulls GSC/GA4),
 * which is why this runs on the background-job platform (CLAUDE.md long-running-provider-work rule)
 * rather than synchronously in a request. On success it broadcasts INTELLIGENCE_SIGNALS_UPDATED
 * unconditionally (the feedback loop only broadcasts when >0 signals result), so the IntelligenceSignals
 * query/caption refresh even when a recompute clears all signals.
 *
 * Shared by the manual "Recompute now" button, the daily activity-gated cron, and the on-mutation
 * triggers (Phase 5c). FM-2: any failure ends the job in `error` status.
 *
 * NOTE: deliberately does NOT call addActivity — the daily cron (5c) gates on hasRecentActivity, so a
 * recompute that logged activity would keep the workspace perpetually "active" and self-trigger the
 * cron forever. Observability comes from the jobs table + JOB_CREATED/UPDATED broadcasts (NotificationBell).
 */
export async function runIntelligenceRecomputeJob(jobId: string, workspaceId: string): Promise<void> {
  const jobWasCancelled = () => getJob(jobId)?.status === 'cancelled';
  if (jobWasCancelled()) return;

  try {
    updateJob(jobId, { status: 'running', progress: 0, total: 100, message: 'Refreshing signals...' });

    const insights = await getOrComputeInsights(workspaceId, undefined, { force: true });
    if (jobWasCancelled()) return;

    // Always refresh the IntelligenceSignals card. The recompute's feedback loop only broadcasts
    // INTELLIGENCE_SIGNALS_UPDATED when it produces >0 signals, so a recompute that CLEARS all signals
    // (the most important "Recompute now" case) would otherwise leave the stale list + "Computed X ago"
    // caption on screen until refocus/staleTime. This unconditional broadcast covers that gap (and the
    // cron / on-mutation paths); a redundant double-fire when signals>0 is harmless (idempotent invalidate).
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, {
      source: 'intelligence_recompute',
      insightCount: insights.length,
    });

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      total: 100,
      message: `Signals refreshed — ${insights.length} insights`,
    });
  } catch (err) {
    if (jobWasCancelled()) return;
    if (isProgrammingError(err)) log.warn({ err, workspaceId, jobId }, 'Intelligence recompute job failed with programming error');
    else log.debug({ err, workspaceId, jobId }, 'Intelligence recompute job failed');
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Signal refresh failed',
    });
  }
}
