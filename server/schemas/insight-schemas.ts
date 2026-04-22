/**
 * Zod schemas for insight data shapes.
 *
 * Used by parseJsonSafe/parseJsonFallback when reading insight data from DB.
 * Each schema mirrors the corresponding interface in shared/types/analytics.ts.
 */

import { z } from '../middleware/validate.js';

// --- AuditFindingData (InsightDataMap['audit_finding']) ---
export const auditFindingDataSchema = z.object({
  scope: z.enum(['page', 'site']),
  issueCount: z.number(),
  issueMessages: z.string(),
  siteScore: z.number().optional(),
  source: z.string(),
});

// --- AnomalyDigestData (InsightDataMap['anomaly_digest']) ---
// Cross-referenced against shared/types/analytics.ts:331-340
export const anomalyDigestDataSchema = z.object({
  anomalyType: z.string(),
  metric: z.string(),
  currentValue: z.number(),
  expectedValue: z.number(),
  deviationPercent: z.number(),
  durationDays: z.number(),
  firstDetected: z.string(),
  severity: z.string(),
});

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

/** Schema for PageHealthData — page-level health from analytics.
 *  Includes optional audit-enrichment fields (shared/types/analytics.ts:256-259)
 *  populated when the audit → page_health bridge adds error/warning context. */
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
  auditSnapshotId: z.string().optional(),
  errorCount: z.number().optional(),
  warningCount: z.number().optional(),
  topIssues: z.array(z.string()).optional(),
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

// --- StrategyAlignmentData (InsightDataMap['strategy_alignment']) ---
// Cross-referenced against shared/types/analytics.ts:StrategyAlignmentData
export const strategyAlignmentDataSchema = z.object({
  alignedCount: z.number(),
  misalignedCount: z.number(),
  untrackedCount: z.number(),
  summary: z.string().optional(),
});

// --- QuickWinData (InsightDataMap['ranking_opportunity']) ---
export const rankingOpportunityDataSchema = z.object({
  query: z.string(),
  currentPosition: z.number(),
  impressions: z.number(),
  estimatedTrafficGain: z.number(),
  pageUrl: z.string(),
});

// --- ContentDecayData (InsightDataMap['content_decay']) ---
export const contentDecayDataSchema = z.object({
  baselineClicks: z.number(),
  currentClicks: z.number(),
  deltaPercent: z.number(),
  baselinePeriod: z.string(),
  currentPeriod: z.string(),
});

// --- CannibalizationData (InsightDataMap['cannibalization']) ---
export const cannibalizationDataSchema = z.object({
  query: z.string(),
  pages: z.array(z.string()),
  positions: z.array(z.number()),
  totalImpressions: z.number(),
});

// --- KeywordClusterData (InsightDataMap['keyword_cluster']) ---
export const keywordClusterDataSchema = z.object({
  label: z.string(),
  queries: z.array(z.string()),
  totalImpressions: z.number(),
  avgPosition: z.number(),
  pillarPage: z.string().nullable(),
});

// --- CompetitorGapData (InsightDataMap['competitor_gap']) ---
export const competitorGapDataSchema = z.object({
  keyword: z.string(),
  competitorDomain: z.string(),
  competitorPosition: z.number(),
  ourPosition: z.number().nullable(),
  volume: z.number(),
  difficulty: z.number(),
});

// --- ConversionAttributionData (InsightDataMap['conversion_attribution']) ---
export const conversionAttributionDataSchema = z.object({
  sessions: z.number(),
  conversions: z.number(),
  conversionRate: z.number(),
  estimatedRevenue: z.number().nullable(),
});

// --- RankingMoverData (InsightDataMap['ranking_mover']) ---
export const rankingMoverDataSchema = z.object({
  query: z.string(),
  pageUrl: z.string(),
  currentPosition: z.number(),
  previousPosition: z.number(),
  positionChange: z.number(),
  currentClicks: z.number(),
  previousClicks: z.number(),
  impressions: z.number(),
});

// --- CtrOpportunityData (InsightDataMap['ctr_opportunity']) ---
export const ctrOpportunityDataSchema = z.object({
  query: z.string(),
  pageUrl: z.string(),
  position: z.number(),
  actualCtr: z.number(),
  expectedCtr: z.number(),
  ctrRatio: z.number(),
  impressions: z.number(),
  estimatedClickGap: z.number(),
});

// --- SerpOpportunityData (InsightDataMap['serp_opportunity']) ---
export const serpOpportunityDataSchema = z.object({
  pageUrl: z.string(),
  impressions: z.number(),
  clicks: z.number(),
  position: z.number(),
  ctr: z.number(),
  schemaStatus: z.enum(['missing', 'partial', 'complete']),
});
