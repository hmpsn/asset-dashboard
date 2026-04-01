import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../server/webflow-pages.js', () => ({
  listPages: vi.fn().mockResolvedValue([]),
  filterPublishedPages: vi.fn().mockReturnValue([]),
}));
vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn().mockReturnValue({ webflowToken: 'tok' }),
}));
vi.mock('../server/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

describe('workspace-data', () => {
  describe('getPageCacheStats', () => {
    it('returns stats with maxEntries matching LRU capacity', async () => {
      const { getPageCacheStats } = await import('../server/workspace-data.js');
      const stats = getPageCacheStats();
      expect(stats).toHaveProperty('maxEntries');
      expect(stats.maxEntries).toBe(100);
      expect(stats).toHaveProperty('entries');
    });
  });

  describe('getContentPipelineSummary', () => {
    it('is exported as a function', async () => {
      const mod = await import('../server/workspace-data.js');
      expect(typeof mod.getContentPipelineSummary).toBe('function');
    });
  });
});
