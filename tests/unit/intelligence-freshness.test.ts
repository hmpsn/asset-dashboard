import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateContentPipelineCache: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/workspace-data.js', () => ({
  invalidateContentPipelineCache: mocks.invalidateContentPipelineCache,
}));

vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: mocks.invalidateIntelligenceCache,
}));

describe('intelligence freshness helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates both persistent content pipeline summaries and workspace intelligence', async () => {
    const { invalidateContentPipelineIntelligence } = await import('../../server/intelligence-freshness.js');

    invalidateContentPipelineIntelligence('ws-freshness');

    expect(mocks.invalidateContentPipelineCache).toHaveBeenCalledWith('ws-freshness');
    expect(mocks.invalidateIntelligenceCache).toHaveBeenCalledWith('ws-freshness');
  });

  it('still clears workspace intelligence when the persistent content pipeline cache is unavailable', async () => {
    mocks.invalidateContentPipelineCache.mockImplementationOnce(() => {
      throw new Error('no such table: content_pipeline_cache');
    });
    const { invalidateContentPipelineIntelligence } = await import('../../server/intelligence-freshness.js');

    expect(() => invalidateContentPipelineIntelligence('ws-legacy-db')).not.toThrow();

    expect(mocks.invalidateIntelligenceCache).toHaveBeenCalledWith('ws-legacy-db');
  });
});
