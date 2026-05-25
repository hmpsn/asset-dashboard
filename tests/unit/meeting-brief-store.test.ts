import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetStmt = vi.hoisted(() => ({ get: vi.fn() }));
const mockGetHashStmt = vi.hoisted(() => ({ get: vi.fn() }));
const mockUpsertStmt = vi.hoisted(() => ({ run: vi.fn() }));

const mockRecommendationSchema = vi.hoisted(() => ({ __schema: 'meeting-brief-recommendation' }));
const mockMetricsSchema = vi.hoisted(() => ({ __schema: 'meeting-brief-metrics' }));

const mockParseJsonSafeArray = vi.hoisted(() => vi.fn());
const mockParseJsonSafe = vi.hoisted(() => vi.fn());

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM meeting_briefs')) return mockGetStmt;
      if (sql.includes('SELECT prompt_hash FROM meeting_briefs')) return mockGetHashStmt;
      if (sql.includes('INSERT INTO meeting_briefs')) return mockUpsertStmt;
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }),
  },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => {
    const cached = factory();
    return () => cached;
  },
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafe: mockParseJsonSafe,
  parseJsonSafeArray: mockParseJsonSafeArray,
}));

vi.mock('../../server/schemas/meeting-brief-schemas.js', () => ({
  meetingBriefRecommendationSchema: mockRecommendationSchema,
  meetingBriefMetricsSchema: mockMetricsSchema,
}));

import { getMeetingBrief, getMeetingBriefHash, upsertMeetingBrief } from '../../server/meeting-brief-store.js';
import type { MeetingBrief } from '../../shared/types/meeting-brief.js';

const expectedMetricsFallback = {
  siteHealthScore: null,
  openRankingOpportunities: 0,
  contentInPipeline: 0,
  overallWinRate: null,
  criticalIssues: 0,
};

describe('meeting-brief-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMeetingBrief', () => {
    it('returns parsed brief when a row exists and passes JSON parse contexts', () => {
      const row = {
        workspace_id: 'ws-123',
        generated_at: '2026-05-24T12:00:00.000Z',
        situation_summary: 'Momentum is improving week over week.',
        wins: '["raw-win"]',
        attention: '["raw-attention"]',
        recommendations: '[{"title":"Improve metadata"}]',
        blueprint_progress: '6 of 10 complete',
        prompt_hash: 'hash-123',
        metrics: '{"raw":true}',
      };

      const parsedWins = ['Published 3 optimized pages'];
      const parsedAttention = ['Homepage title tag still duplicated'];
      const parsedRecommendations = [{ title: 'Fix homepage metadata', impact: 'high' }];
      const parsedMetrics = {
        siteHealthScore: 84,
        openRankingOpportunities: 9,
        contentInPipeline: 4,
        overallWinRate: 0.5,
        criticalIssues: 1,
      };

      mockGetStmt.get.mockReturnValueOnce(row);
      mockParseJsonSafeArray
        .mockReturnValueOnce(parsedWins)
        .mockReturnValueOnce(parsedAttention)
        .mockReturnValueOnce(parsedRecommendations);
      mockParseJsonSafe.mockReturnValueOnce(parsedMetrics);

      const result = getMeetingBrief('ws-123');

      expect(mockGetStmt.get).toHaveBeenCalledWith('ws-123');
      expect(result).toEqual({
        workspaceId: 'ws-123',
        generatedAt: '2026-05-24T12:00:00.000Z',
        situationSummary: 'Momentum is improving week over week.',
        wins: parsedWins,
        attention: parsedAttention,
        recommendations: parsedRecommendations,
        blueprintProgress: '6 of 10 complete',
        metrics: parsedMetrics,
      });

      expect(mockParseJsonSafeArray).toHaveBeenNthCalledWith(
        1,
        row.wins,
        expect.anything(),
        { table: 'meeting_briefs', field: 'wins' },
      );
      expect(mockParseJsonSafeArray).toHaveBeenNthCalledWith(
        2,
        row.attention,
        expect.anything(),
        { table: 'meeting_briefs', field: 'attention' },
      );
      expect(mockParseJsonSafeArray).toHaveBeenNthCalledWith(
        3,
        row.recommendations,
        mockRecommendationSchema,
        { table: 'meeting_briefs', field: 'recommendations' },
      );

      expect(mockParseJsonSafe).toHaveBeenCalledWith(
        row.metrics,
        mockMetricsSchema,
        expectedMetricsFallback,
        { table: 'meeting_briefs', field: 'metrics' },
      );
    });

    it('returns null when no row exists', () => {
      mockGetStmt.get.mockReturnValueOnce(undefined);

      const result = getMeetingBrief('missing-workspace');

      expect(mockGetStmt.get).toHaveBeenCalledWith('missing-workspace');
      expect(result).toBeNull();
      expect(mockParseJsonSafeArray).not.toHaveBeenCalled();
      expect(mockParseJsonSafe).not.toHaveBeenCalled();
    });

    it('degrades safely when JSON columns parse to fallback shapes', () => {
      const row = {
        workspace_id: 'ws-bad-json',
        generated_at: '2026-05-24T12:00:00.000Z',
        situation_summary: 'Summary',
        wins: 'not json',
        attention: 'not json',
        recommendations: 'not json',
        blueprint_progress: null,
        prompt_hash: null,
        metrics: 'not json',
      };

      mockGetStmt.get.mockReturnValueOnce(row);
      mockParseJsonSafeArray
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);
      mockParseJsonSafe.mockReturnValueOnce(expectedMetricsFallback);

      const result = getMeetingBrief('ws-bad-json');

      expect(result).toEqual({
        workspaceId: 'ws-bad-json',
        generatedAt: '2026-05-24T12:00:00.000Z',
        situationSummary: 'Summary',
        wins: [],
        attention: [],
        recommendations: [],
        blueprintProgress: null,
        metrics: expectedMetricsFallback,
      });
    });
  });

  describe('upsertMeetingBrief', () => {
    it('writes the expected serialized payload', () => {
      const brief: MeetingBrief = {
        workspaceId: 'ws-789',
        generatedAt: '2026-05-25T09:45:00.000Z',
        situationSummary: 'Pipeline is healthy with minor technical blockers.',
        wins: ['Won featured snippet on pricing page'],
        attention: ['Two 5xx pages detected in crawl'],
        recommendations: [{ action: 'Fix 5xx pages', rationale: 'Recover crawl budget and avoid user drop-off' }],
        blueprintProgress: null,
        metrics: {
          siteHealthScore: 78,
          openRankingOpportunities: 14,
          contentInPipeline: 6,
          overallWinRate: 42,
          criticalIssues: 2,
        },
      };

      upsertMeetingBrief(brief, 'prompt-hash-789');

      expect(mockUpsertStmt.run).toHaveBeenCalledWith({
        workspace_id: 'ws-789',
        generated_at: '2026-05-25T09:45:00.000Z',
        situation_summary: 'Pipeline is healthy with minor technical blockers.',
        wins: JSON.stringify(brief.wins),
        attention: JSON.stringify(brief.attention),
        recommendations: JSON.stringify(brief.recommendations),
        blueprint_progress: null,
        prompt_hash: 'prompt-hash-789',
        metrics: JSON.stringify(brief.metrics),
      });
    });

    it('stores null prompt_hash when omitted', () => {
      const brief: MeetingBrief = {
        workspaceId: 'ws-no-hash',
        generatedAt: '2026-05-25T09:45:00.000Z',
        situationSummary: 'No hash case.',
        wins: [],
        attention: [],
        recommendations: [],
        blueprintProgress: null,
        metrics: expectedMetricsFallback,
      };

      upsertMeetingBrief(brief);

      expect(mockUpsertStmt.run).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-no-hash',
          prompt_hash: null,
        }),
      );
    });
  });

  describe('getMeetingBriefHash', () => {
    it('returns hash when row exists', () => {
      mockGetHashStmt.get.mockReturnValueOnce({ prompt_hash: 'hash-abc' });

      const result = getMeetingBriefHash('ws-abc');

      expect(mockGetHashStmt.get).toHaveBeenCalledWith('ws-abc');
      expect(result).toBe('hash-abc');
    });

    it('returns null when row missing or hash is null', () => {
      mockGetHashStmt.get.mockReturnValueOnce(undefined);
      expect(getMeetingBriefHash('ws-missing')).toBeNull();

      mockGetHashStmt.get.mockReturnValueOnce({ prompt_hash: null });
      expect(getMeetingBriefHash('ws-null')).toBeNull();
    });
  });
});
