/**
 * Zod schemas for insight data shapes.
 *
 * Used by parseJsonSafe/parseJsonFallback when reading insight data from DB.
 * Each schema mirrors the corresponding interface in shared/types/analytics.ts.
 */

import { z } from '../middleware/validate.js';

/** Schema for SiteHealthInsightData — Bridge #15 audit → site_health */
export const siteHealthInsightDataSchema = z.object({
  auditSnapshotId: z.string(),
  siteScore: z.number(),
  previousScore: z.number().nullable(),
  scoreDelta: z.number().nullable(),
  totalPages: z.number(),
  errors: z.number(),
  warnings: z.number(),
  siteWideIssueCount: z.number(),
});

/** Schema for PageHealthData — page-level health from analytics */
export const pageHealthDataSchema = z.object({
  score: z.number(),
  trend: z.enum(['improving', 'declining', 'stable']),
  clicks: z.number(),
  impressions: z.number(),
  position: z.number(),
  ctr: z.number(),
  pageviews: z.number(),
  bounceRate: z.number(),
  avgEngagementTime: z.number(),
});

/**
 * Schema for page_health insight data from Bridge #12 (audit → page_health).
 * Different shape from PageHealthData above — this is the bridge-generated version.
 */
export const auditPageHealthInsightDataSchema = z.object({
  auditSnapshotId: z.string(),
  errorCount: z.number(),
  warningCount: z.number(),
  topIssues: z.array(z.string()),
});
