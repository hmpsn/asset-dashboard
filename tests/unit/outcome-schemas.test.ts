import { describe, expect, it } from 'vitest';
import {
  actionTypeEnum,
  attributionEnum,
  earlySignalEnum,
  outcomeScoreEnum,
  workspaceLearningsDataSchema,
} from '../../server/schemas/outcome-schemas.js';

describe('outcome-schemas behavioral contracts', () => {
  it('accepts canonical enum members and rejects invalid ones', () => {
    expect(actionTypeEnum.safeParse('content_published').success).toBe(true);
    expect(attributionEnum.safeParse('platform_executed').success).toBe(true);
    expect(outcomeScoreEnum.safeParse('strong_win').success).toBe(true);
    expect(earlySignalEnum.safeParse('on_track').success).toBe(true);

    expect(actionTypeEnum.safeParse('published').success).toBe(false);
    expect(outcomeScoreEnum.safeParse('great').success).toBe(false);
    expect(earlySignalEnum.safeParse('unknown').success).toBe(false);
  });

  it('validates nested workspace learnings payload and enforces enum contracts', () => {
    const validPayload = {
      workspaceId: 'ws_123',
      computedAt: '2026-05-25T00:00:00.000Z',
      confidence: 'high',
      totalScoredActions: 22,
      content: {
        winRateByFormat: { blog: 0.62 },
        avgDaysToPage1: 18,
        bestPerformingTopics: ['technical seo'],
        optimalWordCount: { min: 900, max: 1400 },
        refreshRecoveryRate: 0.38,
        voiceScoreCorrelation: 0.2,
      },
      strategy: null,
      technical: null,
      overall: {
        totalWinRate: 0.54,
        strongWinRate: 0.22,
        topActionTypes: [{ type: 'content_published', winRate: 0.66, count: 12 }],
        recentTrend: 'improving',
      },
    };

    const validResult = workspaceLearningsDataSchema.safeParse(validPayload);
    const invalidResult = workspaceLearningsDataSchema.safeParse({
      ...validPayload,
      confidence: 'certain',
    });

    expect(validResult.success).toBe(true);
    expect(invalidResult.success).toBe(false);
  });
});
