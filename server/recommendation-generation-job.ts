import { addActivity } from './activity-log.js';
import { isProgrammingError } from './errors.js';
import { getJob, updateJob } from './jobs.js';
import { createLogger } from './logger.js';
import { generateRecommendations } from './recommendations.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';

const log = createLogger('recommendation-generation-job');

export async function runRecommendationGenerationJob(
  jobId: string,
  workspaceId: string,
  reason = 'explicit',
): Promise<void> {
  const jobWasCancelled = () => getJob(jobId)?.status === 'cancelled';
  if (jobWasCancelled()) return;

  try {
    updateJob(jobId, {
      status: 'running',
      progress: 0,
      total: 100,
      message: 'Generating recommendations...',
    });

    const set = await generateRecommendations(workspaceId);
    if (jobWasCancelled()) return;

    invalidateIntelligenceCache(workspaceId);
    if (reason === 'explicit') {
      addActivity(
        workspaceId,
        'recommendations_generated',
        'Recommendations refreshed',
        `${set.recommendations.length} recommendations generated`,
        {
          source: 'recommendations_job',
          reason,
          jobId,
          recommendationCount: set.recommendations.length,
          generatedAt: set.generatedAt,
        },
      );
    }
    updateJob(jobId, {
      status: 'done',
      progress: 100,
      total: 100,
      message: `Recommendations ready — ${set.recommendations.length} items`,
      result: {
        persisted: true,
        generatedAt: set.generatedAt,
        recommendationCount: set.recommendations.length,
        summary: set.summary,
      },
    });
  } catch (err) {
    if (jobWasCancelled()) return;
    if (isProgrammingError(err)) log.warn({ err, workspaceId, jobId }, 'Recommendation generation job failed with programming error');
    else log.debug({ err, workspaceId, jobId }, 'Recommendation generation job failed');
    updateJob(jobId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      message: 'Recommendation generation failed',
    });
  }
}
