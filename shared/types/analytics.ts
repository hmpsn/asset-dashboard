// ── Analytics domain types (Search Console + GA4) ───────────────
//
// UNIT CONVENTION: All `ctr` fields in GSC types are PERCENTAGES (e.g., 6.3 for 6.3%).
// The raw GSC API returns decimals (0.063), but server/search-console.ts converts via
// `+(r.ctr * 100).toFixed(1)` at the API boundary. Do NOT multiply by 100 again.
//
// All `bounceRate`, `engagementRate`, `conversionRate` fields are also PERCENTAGES.

export interface SearchQuery {
  query: string;
  clicks: number;
  impressions: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: number;
  position: number;
}

export interface SearchPage {
  page: string;
  clicks: number;
  impressions: number;
  /** Percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: number;
  position: number;
}

export interface SearchOverview {
  totalClicks: number;
  totalImpressions: number;
  /** Percentage (e.g., 4.2 for 4.2%). Do NOT multiply by 100. */
  avgCtr: number;
  avgPosition: number;
  topQueries: SearchQuery[];
  topPages: SearchPage[];
  dateRange: { start: string; end: string };
}

export interface PerformanceTrend {
  date: string;
  clicks: number;
  impressions: number;
  /** Percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: number;
  position: number;
}

export interface SearchComparison {
  current: { clicks: number; impressions: number; ctr: number; position: number };
  previous: { clicks: number; impressions: number; ctr: number; position: number };
  change: { clicks: number; impressions: number; ctr: number; position: number };
  changePercent: { clicks: number; impressions: number; ctr: number; position: number };
}

// ── GSC breakdown types ──────────────────────────────────────────
export interface SearchDeviceBreakdown {
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchCountryBreakdown {
  country: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchTypeBreakdown {
  searchType: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GA4Overview {
  totalUsers: number;
  totalSessions: number;
  totalPageviews: number;
  avgSessionDuration: number;
  /** Percentage (e.g., 45.2 for 45.2%). */
  bounceRate: number;
  /** Percentage (e.g., 68.5 for 68.5%). */
  newUserPercentage: number;
  dateRange: { start: string; end: string };
}

export interface GA4DailyTrend {
  date: string;
  users: number;
  sessions: number;
  pageviews: number;
}

export interface GA4TopPage {
  path: string;
  pageviews: number;
  users: number;
  avgEngagementTime: number;
}

export interface GA4TopSource {
  source: string;
  medium: string;
  users: number;
  sessions: number;
}

export interface GA4DeviceBreakdown {
  device: string;
  users: number;
  sessions: number;
  percentage: number;
}

export interface GA4CountryBreakdown {
  country: string;
  users: number;
  sessions: number;
}

export interface GA4Event {
  eventName: string;
  eventCount: number;
  users: number;
}

export interface GA4EventTrend {
  date: string;
  eventCount: number;
}

export interface GA4ConversionSummary {
  eventName: string;
  conversions: number;
  users: number;
  rate: number;
}

export interface GA4EventPageBreakdown {
  eventName: string;
  pagePath: string;
  eventCount: number;
  users: number;
}

export interface GA4Comparison {
  current: GA4Overview;
  previous: GA4Overview;
  change: { users: number; sessions: number; pageviews: number; bounceRate: number; avgSessionDuration: number };
  changePercent: { users: number; sessions: number; pageviews: number };
}

export interface GA4NewVsReturning {
  segment: string;
  users: number;
  sessions: number;
  bounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  percentage: number;
}

export interface GA4OrganicOverview {
  organicUsers: number;
  organicSessions: number;
  organicPageviews: number;
  organicBounceRate: number;
  engagementRate: number;
  avgEngagementTime: number;
  shareOfTotalUsers: number;
  dateRange: { start: string; end: string };
}

export interface GA4LandingPage {
  landingPage: string;
  sessions: number;
  users: number;
  bounceRate: number;
  avgEngagementTime: number;
  conversions: number;
}

// ── Analytics Intelligence Layer ──────────────────────────────────

export type InsightType =
  | 'page_health'
  | 'ranking_opportunity'    // renamed from quick_win
  | 'content_decay'
  | 'cannibalization'
  | 'keyword_cluster'
  | 'competitor_gap'
  | 'conversion_attribution'
  | 'ranking_mover'          // new: position changes
  | 'ctr_opportunity'        // new: high-impression low-CTR
  | 'serp_opportunity'       // new: rich result eligible
  | 'strategy_alignment'     // new: strategy vs reality
  | 'anomaly_digest';        // new: surfaced anomalies

export type InsightDomain = 'search' | 'traffic' | 'cross';

export type InsightSeverity = 'critical' | 'warning' | 'opportunity' | 'positive';

export interface AnalyticsInsight {
  id: string;
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: Record<string, unknown>;
  severity: InsightSeverity;
  computedAt: string;
  // Enrichment fields (Phase 1)
  pageTitle?: string | null;
  strategyKeyword?: string | null;
  strategyAlignment?: 'aligned' | 'misaligned' | 'untracked' | null;
  auditIssues?: string | null;        // JSON array string
  pipelineStatus?: 'brief_exists' | 'in_progress' | 'published' | null;
  anomalyLinked?: boolean;
  impactScore?: number;
  domain?: InsightDomain;
  // Resolution tracking (Phase 3)
  resolutionStatus?: 'in_progress' | 'resolved' | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
}

// ── Insight data shapes (used in data JSON field) ─────────────────

export interface PageHealthData {
  score: number;          // 0–100
  trend: 'improving' | 'declining' | 'stable';
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
  pageviews: number;
  bounceRate: number;
  avgEngagementTime: number;
}

/** Data shape for ranking_opportunity insights (formerly quick_win) */
export interface QuickWinData {
  query: string;
  currentPosition: number;
  impressions: number;
  estimatedTrafficGain: number;
  pageUrl: string;
}

export interface ContentDecayData {
  baselineClicks: number;
  currentClicks: number;
  deltaPercent: number;
  baselinePeriod: string;
  currentPeriod: string;
}

export interface CannibalizationData {
  query: string;
  pages: string[];
  positions: number[];
  totalImpressions: number;
}

export interface KeywordClusterData {
  label: string;
  queries: string[];
  totalImpressions: number;
  avgPosition: number;
  pillarPage: string | null;
}

export interface CompetitorGapData {
  keyword: string;
  competitorDomain: string;
  competitorPosition: number;
  ourPosition: number | null;
  volume: number;
  difficulty: number;
}

export interface ConversionAttributionData {
  sessions: number;
  conversions: number;
  /** Already a percentage (e.g., 4.0 for 4%). Do NOT multiply by 100. */
  conversionRate: number;
  estimatedRevenue: number | null;
}

export interface RankingMoverData {
  query: string;
  pageUrl: string;
  currentPosition: number;
  previousPosition: number;
  /** Positive = improved (moved up), negative = dropped */
  positionChange: number;
  currentClicks: number;
  previousClicks: number;
  impressions: number;
}

export interface CtrOpportunityData {
  query: string;
  pageUrl: string;
  position: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT divide/multiply by 100. */
  actualCtr: number;
  /** Already a percentage (e.g., 30.0 for 30%). Do NOT divide/multiply by 100. */
  expectedCtr: number;
  ctrRatio: number;
  impressions: number;
  estimatedClickGap: number;
}

export interface SerpOpportunityData {
  pageUrl: string;
  impressions: number;
  clicks: number;
  position: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: number;
  schemaStatus: 'missing' | 'partial' | 'complete';
}

/** Data shape for anomaly_digest insights */
export interface AnomalyDigestData {
  anomalyType: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviationPercent: number;
  durationDays: number;
  firstDetected: string;
  severity: string;
}

// ── Insight Data Map (discriminated union) ────────────────────────
// Use this to get type-safe access to insight data by type.

export interface InsightDataMap {
  page_health: PageHealthData;
  ranking_opportunity: QuickWinData;
  content_decay: ContentDecayData;
  cannibalization: CannibalizationData;
  keyword_cluster: KeywordClusterData;
  competitor_gap: CompetitorGapData;
  conversion_attribution: ConversionAttributionData;
  ranking_mover: RankingMoverData;
  ctr_opportunity: CtrOpportunityData;
  serp_opportunity: SerpOpportunityData;
  strategy_alignment: Record<string, unknown>;
  anomaly_digest: AnomalyDigestData;
}

// ── Insight Feed Filter Keys ──────────────────────────────────────
// Shared constants to prevent string literal mismatches between
// SummaryPills (producer) and InsightFeed (consumer).

export const INSIGHT_FILTER_KEYS = {
  DROPS: 'drops',
  OPPORTUNITIES: 'opportunities',
  WINS: 'wins',
  SCHEMA: 'schema',
  DECAY: 'decay',
} as const;

export type InsightFilterKey = typeof INSIGHT_FILTER_KEYS[keyof typeof INSIGHT_FILTER_KEYS];
