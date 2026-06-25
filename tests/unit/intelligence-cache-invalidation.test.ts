import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WS_EVENTS } from '../../server/ws-events.js';

const hoisted = vi.hoisted(() => ({
  deleteByPrefix: vi.fn(() => 3),
  stats: vi.fn(() => ({ entries: 0, maxEntries: 200 })),
  get: vi.fn(),
  set: vi.fn(),
  peek: vi.fn(),
  invalidateSubCachePrefix: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('../../server/intelligence-cache.js', () => {
  class MockLRUCache {
    get = hoisted.get;
    set = hoisted.set;
    peek = hoisted.peek;
    stats = hoisted.stats;
    deleteByPrefix = hoisted.deleteByPrefix;
  }
  return {
    LRUCache: MockLRUCache,
    singleFlight: vi.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  };
});

vi.mock('../../server/bridge-infrastructure.js', () => ({
  invalidateSubCachePrefix: hoisted.invalidateSubCachePrefix,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: hoisted.broadcastToWorkspace,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: hoisted.logInfo,
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('invalidateIntelligenceCache leaf module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.deleteByPrefix.mockReturnValue(3);
  });

  it('clears workspace-scoped cache entries, persistent sub-caches, and broadcasts freshness', async () => {
    const { invalidateIntelligenceCache } = await import('../../server/intelligence/cache-invalidation.js');

    invalidateIntelligenceCache('ws-cache-test');

    expect(hoisted.deleteByPrefix).toHaveBeenCalledWith('intelligence:ws-cache-test:');
    expect(hoisted.invalidateSubCachePrefix).toHaveBeenCalledWith('ws-cache-test', '');
    expect(hoisted.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-cache-test',
      WS_EVENTS.INTELLIGENCE_CACHE_UPDATED,
      expect.objectContaining({ workspaceId: 'ws-cache-test' }),
    );
    expect(hoisted.logInfo).toHaveBeenCalledWith(
      { workspaceId: 'ws-cache-test', entriesDeleted: 3 },
      'Intelligence cache invalidated (in-memory + persistent + broadcast)',
    );
  });

  it('does not throw when persistence or broadcast invalidation fails', async () => {
    const { invalidateIntelligenceCache } = await import('../../server/intelligence/cache-invalidation.js');
    hoisted.invalidateSubCachePrefix.mockImplementationOnce(() => {
      throw new Error('legacy db');
    });
    hoisted.broadcastToWorkspace.mockImplementationOnce(() => {
      throw new Error('socket closed');
    });

    expect(() => invalidateIntelligenceCache('ws-best-effort')).not.toThrow();
    expect(hoisted.deleteByPrefix).toHaveBeenCalledWith('intelligence:ws-best-effort:');
  });
});
