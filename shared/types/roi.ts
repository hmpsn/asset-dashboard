import type { OutcomeBaseline, OutcomeProvenance } from './the-issue.js';

export interface PageROI {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  clicks: number;
  impressions: number;
  cpc: number;
  trafficValue: number;
  position: number | null;
}

export interface ContentItemROI {
  requestId: string;
  topic: string;
  targetKeyword: string;
  targetPageId: string;
  targetPageSlug?: string;
  status: string;
  clicks: number;
  impressions: number;
  trafficValue: number;
  source?: 'request' | 'matrix';
}

export interface ROIData {
  organicTrafficValue: number;
  adSpendEquivalent: number;
  growthPercent: number | null;
  /**
   * Portfolio "Revenue at stake" (Task 3.4): Σ keywordDollarValue(kw).upsideMonthly
   * over the tracked page_keywords — the monthly $ unlocked if tracked keywords
   * move toward stronger positions. Reuses the single keywordDollarValue helper (no second $ math). 0 when
   * every keyword already ranks #1; absent only on older payloads.
   */
  revenueAtStake?: number;
  pageBreakdown: PageROI[];
  totalClicks: number;
  totalImpressions: number;
  avgCPC: number;
  trackedPages: number;
  contentROI: {
    totalContentSpend: number;
    totalContentValue: number;
    roi: number;
    postsPublished: number;
  } | null;
  contentItems: ContentItemROI[];
  computedAt: string;
  /**
   * The Issue (Client) P0 — outcome-denominated verdict. Present ONLY when the spine flag is ON,
   * GA4 conversions exist, AND workspace.outcomeValue is set; additive + optional → legacy callers
   * and the flag-OFF path are unaffected (byte-identical). provenance is ALWAYS 'estimate_ga4' in P0.
   */
  outcomeVerdict?: {
    outcomeCount: number;
    outcomeUnitLabel: string;
    valuePerOutcome: number;
    estimatedValue: number;            // outcomeCount × valuePerOutcome
    monthlyRetainer: number | null;
    baseline: OutcomeBaseline;
    baselineDeltaCount: number | null; // null while establishing
    provenance: OutcomeProvenance;     // ALWAYS 'estimate_ga4' in P0
  };
}
