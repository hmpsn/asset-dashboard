import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  getJob: vi.fn(),
  updateJob: vi.fn(),
  generateRecommendations: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: state.addActivity,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: state.broadcastToWorkspace,
}));

vi.mock('../../server/jobs.js', () => ({
  getJob: state.getJob,
  updateJob: state.updateJob,
}));

vi.mock('../../server/recommendations.js', () => ({
  generateRecommendations: state.generateRecommendations,
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: state.invalidateIntelligenceCache,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { runRecommendationGenerationJob } from '../../server/recommendation-generation-job.js';

describe('runRecommendationGenerationJob', () => {
  beforeEach(() => {
    state.addActivity.mockReset();
    state.broadcastToWorkspace.mockReset();
    state.getJob.mockReset();
    state.updateJob.mockReset();
    state.generateRecommendations.mockReset();
    state.invalidateIntelligenceCache.mockReset();
    state.getJob.mockReturnValue({ status: 'running' });
    state.generateRecommendations.mockResolvedValue({
      generatedAt: '2026-06-08T20:00:00.000Z',
      recommendations: [{ id: 'rec-1' }, { id: 'rec-2' }],
      summary: { total: 2 },
    });
  });

  it('logs explicit recommendation refreshes to the activity feed on success', async () => {
    await runRecommendationGenerationJob('job-1', 'ws-1', 'explicit');

    expect(state.addActivity).toHaveBeenCalledWith(
      'ws-1',
      'recommendations_generated',
      'Recommendations refreshed',
      '2 recommendations generated',
      expect.objectContaining({
        source: 'recommendations_job',
        reason: 'explicit',
        jobId: 'job-1',
        recommendationCount: 2,
      }),
    );
  });

  it('does not create activity log noise for non-explicit recommendation runs', async () => {
    await runRecommendationGenerationJob('job-2', 'ws-1', 'local_seo_refresh');

    expect(state.addActivity).not.toHaveBeenCalled();
  });
});
