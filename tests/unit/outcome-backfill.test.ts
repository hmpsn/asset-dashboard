import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stmts: {
    allWorkspaceIds: { all: vi.fn(() => []) },
    publishedPosts: { all: vi.fn(() => []) },
    resolvedInsights: { all: vi.fn(() => []) },
    recommendationSet: { get: vi.fn(() => undefined) },
    // A5: predictedEmv repair-pass candidate query (NULL-snapshot rec actions).
    nullEmvRecActions: { all: vi.fn(() => []) },
  },
  parseJsonSafeArray: vi.fn(() => []),
  recordAction: vi.fn(),
  getActionBySource: vi.fn(() => null),
  fillPredictedEmvIfNull: vi.fn(() => true),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    // A5: the repair pass wraps its fills in db.transaction(); the mock just invokes the body.
    transaction: (fn: (...args: unknown[]) => unknown) => fn,
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
  fillPredictedEmvIfNull: mocks.fillPredictedEmvIfNull,
}));

import {
  backfillCompletedRecommendations,
  backfillPublishedContent,
  backfillResolvedInsights,
  runBackfill,
} from '../../server/outcome-backfill.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stmts.allWorkspaceIds.all.mockReturnValue([]);
  mocks.stmts.publishedPosts.all.mockReturnValue([]);
  mocks.stmts.resolvedInsights.all.mockReturnValue([]);
  mocks.stmts.recommendationSet.get.mockReturnValue(undefined);
  mocks.stmts.nullEmvRecActions.all.mockReturnValue([]);
  mocks.parseJsonSafeArray.mockReturnValue([]);
  mocks.getActionBySource.mockReturnValue(null);
  mocks.fillPredictedEmvIfNull.mockReturnValue(true);
});

describe('outcome-backfill', () => {
  it('backfillPublishedContent skips duplicates and uses deterministic fallback timestamp when published_at is missing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

    mocks.stmts.publishedPosts.all.mockReturnValue([
      { id: 'post_dup', workspace_id: 'ws_1', target_keyword: 'alpha', published_at: '2026-05-01T00:00:00.000Z' },
      { id: 'post_new', workspace_id: 'ws_1', target_keyword: 'beta', published_at: null },
    ]);
    mocks.getActionBySource.mockImplementation((sourceType: string, sourceId: string) => {
      if (sourceType === 'post' && sourceId === 'post_dup') return { id: 'existing' };
      return null;
    });

    const count = backfillPublishedContent('ws_1');

    expect(count).toBe(1);
    expect(mocks.recordAction).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      sourceType: 'post',
      sourceId: 'post_new',
      targetKeyword: 'beta',
      baselineSnapshot: { captured_at: '2026-05-25T12:00:00.000Z' },
    }));

    vi.useRealTimers();
  });

  it('backfillResolvedInsights is idempotent and preserves resolved_at in baseline snapshot', () => {
    mocks.stmts.resolvedInsights.all.mockReturnValue([
      {
        id: 'insight_new',
        workspace_id: 'ws_1',
        page_id: '/services',
        resolution_status: 'resolved',
        resolved_at: '2026-05-20T08:00:00.000Z',
      },
      {
        id: 'insight_dup',
        workspace_id: 'ws_1',
        page_id: '/pricing',
        resolution_status: 'resolved',
        resolved_at: null,
      },
    ]);

    mocks.getActionBySource.mockImplementation((sourceType: string, sourceId: string) => {
      if (sourceType === 'insight' && sourceId === 'insight_dup') return { id: 'existing' };
      return null;
    });

    const count = backfillResolvedInsights('ws_1');

    expect(count).toBe(1);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'insight',
      sourceId: 'insight_new',
      pageUrl: '/services',
      baselineSnapshot: { captured_at: '2026-05-20T08:00:00.000Z' },
    }));
  });

  it('backfillCompletedRecommendations tolerates malformed/partial payload entries and only records valid completed recommendations', () => {
    mocks.stmts.recommendationSet.get.mockReturnValue({
      workspace_id: 'ws_2',
      recommendations: '[]',
    });

    mocks.parseJsonSafeArray.mockReturnValue([
      { id: 'rec_ok', status: 'completed', affectedPages: ['/good-page'] },
      { id: '', status: 'completed', affectedPages: ['/empty-id'] },
      { id: 'rec_existing', status: 'completed', affectedPages: ['/existing'] },
      { id: 'rec_pending', status: 'pending', affectedPages: ['/pending'] },
      { id: 'rec_bad_pages', status: 'completed', affectedPages: [42, null] },
    ]);

    mocks.getActionBySource.mockImplementation((sourceType: string, sourceId: string) => {
      if (sourceType === 'recommendation' && sourceId === 'rec_existing') return { id: 'existing' };
      return null;
    });

    const count = backfillCompletedRecommendations('ws_2');

    expect(count).toBe(2);
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'recommendation',
      sourceId: 'rec_ok',
      pageUrl: '/good-page',
    }));
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'recommendation',
      sourceId: 'rec_bad_pages',
      pageUrl: null,
    }));
    expect(mocks.recordAction).not.toHaveBeenCalledWith(expect.objectContaining({ sourceId: '' }));
  });

  it('runBackfill is idempotent across reruns with same source data', () => {
    const seen = new Set<string>();

    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_1' }]);
    mocks.stmts.publishedPosts.all.mockReturnValue([
      { id: 'p1', workspace_id: 'ws_1', target_keyword: 'kw', published_at: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.stmts.resolvedInsights.all.mockReturnValue([
      {
        id: 'i1',
        workspace_id: 'ws_1',
        page_id: '/page',
        resolution_status: 'resolved',
        resolved_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.stmts.recommendationSet.get.mockReturnValue({
      workspace_id: 'ws_1',
      recommendations: '[{"id":"r1","status":"completed"}]',
    });
    mocks.parseJsonSafeArray.mockReturnValue([{ id: 'r1', status: 'completed', affectedPages: ['/page'] }]);

    mocks.getActionBySource.mockImplementation((sourceType: string, sourceId: string) => {
      return seen.has(`${sourceType}:${sourceId}`) ? ({ id: 'existing' }) : null;
    });
    mocks.recordAction.mockImplementation((payload: { sourceType: string; sourceId: string }) => {
      seen.add(`${payload.sourceType}:${payload.sourceId}`);
    });

    const first = runBackfill();
    const second = runBackfill();

    expect(first).toEqual({ backfilledCount: 3, errors: 0 });
    expect(second).toEqual({ backfilledCount: 0, errors: 0 });
    expect(mocks.recordAction).toHaveBeenCalledTimes(3);
  });

  it('runBackfill classifies workspace-level hard failures and continues other workspaces', () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_fail' }, { id: 'ws_ok' }]);

    mocks.stmts.publishedPosts.all.mockImplementation((workspaceId: string) => {
      if (workspaceId === 'ws_fail') throw new Error('content_posts unavailable');
      return [
        { id: 'post_ok', workspace_id: 'ws_ok', target_keyword: 'kw', published_at: '2026-01-01T00:00:00.000Z' },
      ];
    });
    mocks.stmts.resolvedInsights.all.mockReturnValue([]);
    mocks.stmts.recommendationSet.get.mockReturnValue(undefined);

    const result = runBackfill();

    expect(result).toEqual({ backfilledCount: 1, errors: 1 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_fail' }),
      'Workspace backfill failed — skipping',
    );
  });
});
