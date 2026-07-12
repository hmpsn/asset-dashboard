import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceIntelligence } from '../../shared/types/intelligence.js';

const hoisted = vi.hoisted(() => ({
  assembleSeoContext: vi.fn(),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: hoisted.logDebug,
    info: hoisted.logInfo,
    warn: hoisted.logWarn,
  })),
}));

vi.mock('../../server/intelligence/slice-metadata-registry.js', () => ({
  INTELLIGENCE_SLICE_METADATA_REGISTRY: {
    seoContext: { assemble: hoisted.assembleSeoContext },
  },
  canAssembleIntelligenceSlice: vi.fn(() => true),
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: vi.fn(),
}));

import { clearIntelligenceCache } from '../../server/intelligence/cache-clear.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';

function seoContextResult(label: string): Partial<WorkspaceIntelligence> {
  return {
    seoContext: {
      strategy: undefined,
      brandVoice: label,
      effectiveBrandVoiceBlock: '',
      businessContext: '',
      personas: [],
      knowledgeBase: '',
    },
  };
}

describe('workspace intelligence cache invalidation races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts fresh assembly after invalidation and keeps a late stale result out of the cache', async () => {
    const workspaceId = 'ws-intelligence-race-replacement';
    const resolvers: Array<(value: Partial<WorkspaceIntelligence>) => void> = [];
    hoisted.assembleSeoContext.mockImplementation(
      () => new Promise<Partial<WorkspaceIntelligence>>((resolve) => resolvers.push(resolve)),
    );

    clearIntelligenceCache(workspaceId);
    const staleRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    clearIntelligenceCache(workspaceId);
    const freshRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[1]!(seoContextResult('fresh'));
    await expect(freshRead).resolves.toMatchObject({
      seoContext: { brandVoice: 'fresh' },
    });

    resolvers[0]!(seoContextResult('stale'));
    await expect(staleRead).resolves.toMatchObject({
      seoContext: { brandVoice: 'stale' },
    });

    const cachedRead = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    expect(cachedRead.seoContext?.brandVoice).toBe('fresh');
    expect(hoisted.assembleSeoContext).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated in-flight result repopulate an empty cache', async () => {
    const workspaceId = 'ws-intelligence-race-empty-cache';
    const resolvers: Array<(value: Partial<WorkspaceIntelligence>) => void> = [];
    hoisted.assembleSeoContext.mockImplementation(
      () => new Promise<Partial<WorkspaceIntelligence>>((resolve) => resolvers.push(resolve)),
    );

    clearIntelligenceCache(workspaceId);
    const staleRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    clearIntelligenceCache(workspaceId);
    resolvers[0]!(seoContextResult('stale'));
    await staleRead;

    const postInvalidationRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    expect(hoisted.assembleSeoContext).toHaveBeenCalledTimes(2);

    resolvers[1]!(seoContextResult('fresh'));
    await expect(postInvalidationRead).resolves.toMatchObject({
      seoContext: { brandVoice: 'fresh' },
    });
  });

  it('keeps callers coalesced on the replacement when the stale generation settles first', async () => {
    const workspaceId = 'ws-intelligence-race-coalescing';
    const resolvers: Array<(value: Partial<WorkspaceIntelligence>) => void> = [];
    hoisted.assembleSeoContext.mockImplementation(
      () => new Promise<Partial<WorkspaceIntelligence>>((resolve) => resolvers.push(resolve)),
    );

    clearIntelligenceCache(workspaceId);
    const staleRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));

    clearIntelligenceCache(workspaceId);
    const freshRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[0]!(seoContextResult('stale'));
    await staleRead;

    const coalescedRead = buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
    expect(hoisted.assembleSeoContext).toHaveBeenCalledTimes(2);

    resolvers[1]!(seoContextResult('fresh'));
    await expect(Promise.all([freshRead, coalescedRead])).resolves.toEqual([
      expect.objectContaining({ seoContext: expect.objectContaining({ brandVoice: 'fresh' }) }),
      expect.objectContaining({ seoContext: expect.objectContaining({ brandVoice: 'fresh' }) }),
    ]);
    expect(hoisted.assembleSeoContext).toHaveBeenCalledTimes(2);
  });
});
