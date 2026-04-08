/**
 * Zod schemas for meeting brief JSON columns.
 */
import { z } from 'zod';

export const meetingBriefRecommendationSchema = z.object({
  action: z.string(),
  rationale: z.string(),
});

export const meetingBriefMetricsSchema = z.object({
  siteHealthScore: z.number().nullable(),
  openRankingOpportunities: z.number(),
  contentInPipeline: z.number(),
  overallWinRate: z.number().nullable(),
  criticalIssues: z.number(),
});
