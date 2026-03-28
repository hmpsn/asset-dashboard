// shared/types/insights.ts
import type { InsightType, InsightSeverity, InsightDomain } from './analytics.js';

/** A single item in the priority feed — transformed from AnalyticsInsight for display */
export interface FeedInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;            // page title, not URL
  headline: string;         // "dropped to page 2", "CTR 1.2% vs 4.8% expected"
  context: string;          // "Position 4 → 11 · Lost ~2,400 clicks/mo · Strategy keyword match"
  pageUrl?: string;         // for drill-down navigation
  domain: InsightDomain;    // for tab filtering
  impactScore: number;      // for ranking (higher = show first)
  actions?: FeedAction[];   // "View in Strategy", "Create Brief", etc.
  details?: string[];       // expandable detail lines (e.g., competing page URLs for cannibalization)
}

export interface FeedAction {
  label: string;            // "View in Strategy", "Create Brief", "View Audit"
  tab: string;              // navigation target (Page type)
  icon?: string;            // lucide icon name
}

/** Strategy intelligence signal derived from insight engine feedback loop */
export interface StrategySignal {
  type: 'momentum' | 'misalignment' | 'content_gap';
  keyword: string;
  pageUrl?: string;
  pageTitle?: string;
  detail: string;
  insightId: string;
  impactScore: number;
}

/** Content pipeline signal derived from insight engine feedback loop */
export interface PipelineSignal {
  type: 'suggested_brief' | 'refresh_suggestion';
  pageUrl?: string;
  pageTitle?: string;
  keyword?: string;
  detail: string;
  insightId: string;
  impactScore: number;
}

/** Summary counts for the pill badges on Overview */
export interface SummaryCount {
  label: string;
  count: number;
  color: string;            // tailwind color name: 'red', 'amber', 'green', 'blue', 'purple'
  filterKey: string;        // used to filter feed when pill is clicked
}
