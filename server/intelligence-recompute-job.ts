import { getOrComputeInsights } from './analytics-intelligence.js';
import { isProgrammingError } from './errors.js';
import { getJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';

const log = createLogger('intelligence-recompute-job');

/**
 * Background worker that recomputes a workspace's analytics insights / intelligence signals.
 *
 * Drives `getOrComputeInsights(ws, undefined, { force: true })` — the full recompute (pulls GSC/GA4),
 * which is why this runs on the background-job platform (CLAUDE.md long-running-provider-work rule)
 * rather than synchronously in a request. The recompute's feedback-loop step broadcasts
 * INTELLIGENCE_SIGNALS_UPDATED, which auto-invalidates the IntelligenceSignals query on the frontend.
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
