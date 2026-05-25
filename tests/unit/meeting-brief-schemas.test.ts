import { describe, expect, it } from 'vitest';
import {
  meetingBriefRecommendationSchema,
  meetingBriefMetricsSchema,
} from '../../server/schemas/meeting-brief-schemas.js';

describe('meeting brief schemas', () => {
  it('accepts valid recommendations', () => {
    const result = meetingBriefRecommendationSchema.safeParse({
      action: 'Prioritize technical SEO fixes',
      rationale: 'Core pages are underperforming against competitors.',
    });

    expect(result.success).toBe(true);
  });

  it('rejects recommendations missing required fields', () => {
    const result = meetingBriefRecommendationSchema.safeParse({
      action: 'Prioritize technical SEO fixes',
    });

    expect(result.success).toBe(false);
  });

  it('accepts null for nullable metrics fields', () => {
    const result = meetingBriefMetricsSchema.safeParse({
      siteHealthScore: null,
      openRankingOpportunities: 7,
      contentInPipeline: 3,
      overallWinRate: null,
      criticalIssues: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects null for non-nullable metrics fields', () => {
    const result = meetingBriefMetricsSchema.safeParse({
      siteHealthScore: null,
      openRankingOpportunities: null,
      contentInPipeline: 3,
      overallWinRate: 0.42,
      criticalIssues: 1,
    });

    expect(result.success).toBe(false);
  });
});
