import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stmts: {
    allWorkspaceIds: { all: vi.fn(() => []) },
    publishedPosts: { all: vi.fn(() => []) },
    resolvedInsights: { all: vi.fn(() => []) },
    recommendationSet: { get: vi.fn(() => undefined) },
  },
  parseJsonSafeArray: vi.fn(() => []),
  recordAction: vi.fn(),
  getActionBySource: vi.fn(() => null),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
  },
}));
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: () => () => mocks.stmts,
}));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafeArray: mocks.parseJsonSafeArray,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: mocks.warn, error: mocks.error, info: mocks.info, debug: vi.fn() }),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  recordAction: mocks.recordAction,
  getActionBySource: mocks.getActionBySource,
}));

import {
  backfillCompletedRecommendations,
  backfillPublishedContent,
  runBackfill,
} from '../../server/outcome-backfill.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stmts.allWorkspaceIds.all.mockReturnValue([]);
  mocks.stmts.publishedPosts.all.mockReturnValue([]);
  mocks.stmts.recommendationSet.get.mockReturnValue(undefined);
  mocks.parseJsonSafeArray.mockReturnValue([]);
  mocks.getActionBySource.mockReturnValue(null);
});

describe('outcome-backfill', () => {
  it('backfillPublishedContent inserts only new published posts', () => {
    mocks.stmts.publishedPosts.all.mockReturnValue([
      { id: 'p1', workspace_id: 'ws_1', target_keyword: 'alpha', published_at: '2026-01-01T00:00:00.000Z' },
      { id: 'p2', workspace_id: 'ws_1', target_keyword: null, published_at: '2026-01-02T00:00:00.000Z' },
    ]);
    mocks.getActionBySource.mockImplementation((sourceType: string, sourceId: string) => {
      if (sourceType === 'post' && sourceId === 'p2') return { id: 'existing' };
      return null;
    });

    const count = backfillPublishedContent('ws_1');

    expect(count).toBe(1);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      actionType: 'content_published',
      sourceType: 'post',
      sourceId: 'p1',
      targetKeyword: 'alpha',
      sourceFlag: 'backfill',
    }));
  });

  it('backfillCompletedRecommendations records only completed non-duplicate recommendations', () => {
    mocks.stmts.recommendationSet.get.mockReturnValue({
      workspace_id: 'ws_2',
      recommendations: '[]',
    });
    mocks.parseJsonSafeArray.mockReturnValue([
      { id: 'r1', status: 'completed', affectedPages: ['/page-a'] },
      { id: 'r2', status: 'pending', affectedPages: ['/page-b'] },
      { id: 'r3', status: 'completed', affectedPages: [] },
    ]);
    mocks.getActionBySource.mockImplementation((sourceType: string, sourceId: string) => {
      if (sourceType === 'recommendation' && sourceId === 'r3') return { id: 'existing' };
      return null;
    });

    const count = backfillCompletedRecommendations('ws_2');

    expect(count).toBe(1);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_2',
      actionType: 'audit_fix_applied',
      sourceType: 'recommendation',
      sourceId: 'r1',
      pageUrl: '/page-a',
    }));
  });

  it('runBackfill processes all workspace ids and returns aggregate counts', () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_a' }, { id: 'ws_b' }]);
    mocks.stmts.publishedPosts.all.mockImplementation((wsId: string) => [
      {
        id: `${wsId}_post_1`,
        workspace_id: wsId,
        target_keyword: 'kw',
        published_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.stmts.resolvedInsights.all.mockImplementation((wsId: string) => [
      {
        id: `${wsId}_insight_1`,
        workspace_id: wsId,
        page_id: '/page',
        resolution_status: 'resolved',
        resolved_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.stmts.recommendationSet.get.mockImplementation((wsId: string) => ({
      workspace_id: wsId,
      recommendations: '[{\"id\":\"r1\",\"status\":\"completed\"}]',
    }));
    mocks.parseJsonSafeArray.mockReturnValue([{ id: 'r1', status: 'completed', affectedPages: ['/page-a'] }]);

    const result = runBackfill();

    expect(result).toEqual({ backfilledCount: 6, errors: 0 });
    expect(mocks.recordAction).toHaveBeenCalledTimes(6);
  });
});
