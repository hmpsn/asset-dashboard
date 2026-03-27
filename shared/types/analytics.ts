// ── Analytics domain types (Search Console + GA4) ───────────────

export interface SearchQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchOverview {
  totalClicks: number;
  totalImpressions: number;
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
  bounceRate: number;
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
  | 'quick_win'
  | 'content_decay'
  | 'cannibalization'
  | 'keyword_cluster'
  | 'competitor_gap'
  | 'conversion_attribution';

export type InsightSeverity = 'critical' | 'warning' | 'opportunity' | 'positive';

export interface AnalyticsInsight {
  id: string;
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: Record<string, unknown>;
  severity: InsightSeverity;
  computedAt: string;
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
  conversionRate: number;
  estimatedRevenue: number | null;
}
