/**
 * ROI calculations — organic traffic value, ad spend equivalent, content ROI.
 * Uses GSC clicks × CPC from keyword strategy pageMap.
 */

import { getWorkspace } from './workspaces.js';
import { listContentRequests } from './content-requests.js';

export interface ROIData {
  /** Total estimated dollar value of organic traffic this period */
  organicTrafficValue: number;
  /** What the equivalent PPC ad spend would be */
  adSpendEquivalent: number;
  /** Month-over-month growth in traffic value (percentage) */
  growthPercent: number | null;
  /** Breakdown by page */
  pageBreakdown: PageROI[];
  /** Summary stats */
  totalClicks: number;
  totalImpressions: number;
  avgCPC: number;
  trackedPages: number;
  /** Content investment ROI (if content pricing is configured) */
  contentROI: ContentROIMetrics | null;
  /** Per-content-request ROI attribution */
  contentItems: ContentItemROI[];
  /** Computed at */
  computedAt: string;
}

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

export interface ContentROIMetrics {
  totalContentSpend: number;
  totalContentValue: number;
  roi: number; // percentage
  postsPublished: number;
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
}

/**
 * Compute ROI data for a workspace.
 * Pulls keyword strategy pageMap (with clicks, CPC) from workspace config.
 */
export function computeROI(workspaceId: string): ROIData | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;

  const strategy = ws.keywordStrategy;
  if (!strategy || !strategy.pageMap || strategy.pageMap.length === 0) return null;

  const pages = strategy.pageMap;

  // Build page breakdown
  const pageBreakdown: PageROI[] = [];
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalCPCWeighted = 0;
  let totalValue = 0;

  for (const page of pages) {
    const clicks = page.clicks || 0;
    const impressions = page.impressions || 0;
    const cpc = page.cpc || 0;
    const value = clicks * cpc;

    totalClicks += clicks;
    totalImpressions += impressions;
    totalValue += value;
    if (cpc > 0) {
      totalCPCWeighted += cpc * clicks;
    }

    if (clicks > 0 || cpc > 0) {
      pageBreakdown.push({
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        primaryKeyword: page.primaryKeyword,
        clicks,
        impressions,
        cpc,
        trafficValue: value,
        position: page.currentPosition || null,
      });
    }
  }

  // Sort by traffic value descending
  pageBreakdown.sort((a, b) => b.trafficValue - a.trafficValue);

  const avgCPC = totalClicks > 0 ? totalCPCWeighted / totalClicks : 0;

  // Ad spend equivalent: what you'd pay Google Ads for this traffic
  // Use a 20% markup over raw CPC as typical agency management fee
  const adSpendEquivalent = totalValue * 1.2;

  // Content ROI — cross-reference content requests with traffic data
  const contentReqs = listContentRequests(workspaceId);
  const deliveredReqs = contentReqs.filter(r => (r.status === 'delivered' || r.status === 'published') && r.targetPageId);

  // Build a lookup from pagePath to traffic data
  const pathTraffic = new Map<string, { clicks: number; impressions: number; cpc: number }>();
  for (const page of pages) {
    pathTraffic.set(page.pagePath, { clicks: page.clicks || 0, impressions: page.impressions || 0, cpc: page.cpc || 0 });
  }

  const contentItems: ContentItemROI[] = [];
  let totalContentValue = 0;

  for (const req of deliveredReqs) {
    // Try to match by targetPageSlug or targetPageId
    const slug = req.targetPageSlug;
    const traffic = slug ? pathTraffic.get(slug) || pathTraffic.get(`/${slug}`) : undefined;
    const clicks = traffic?.clicks || 0;
    const impressions = traffic?.impressions || 0;
    const cpc = traffic?.cpc || avgCPC;
    const value = clicks * cpc;
    totalContentValue += value;

    contentItems.push({
      requestId: req.id,
      topic: req.topic,
      targetKeyword: req.targetKeyword,
      targetPageId: req.targetPageId!,
      targetPageSlug: req.targetPageSlug,
      status: req.status,
      clicks,
      impressions,
      trafficValue: Math.round(value * 100) / 100,
    });
  }

  // Sort by traffic value descending
  contentItems.sort((a, b) => b.trafficValue - a.trafficValue);

  // Content ROI metrics
  let contentROI: ContentROIMetrics | null = null;
  const postsPublished = deliveredReqs.length;
  if (postsPublished > 0 && ws.contentPricing) {
    const briefPrice = ws.contentPricing.briefPrice || 0;
    const fullPostPrice = ws.contentPricing.fullPostPrice || 0;
    const totalSpend = deliveredReqs.reduce((s, r) => {
      return s + ((r.serviceType === 'full_post') ? fullPostPrice : briefPrice);
    }, 0);
    const annualizedValue = totalContentValue * 12;
    contentROI = {
      totalContentSpend: totalSpend,
      totalContentValue: Math.round(annualizedValue * 100) / 100,
      roi: totalSpend > 0 ? Math.round(((annualizedValue - totalSpend) / totalSpend) * 10000) / 100 : 0,
      postsPublished,
    };
  } else if (postsPublished > 0) {
    contentROI = {
      totalContentSpend: 0,
      totalContentValue: Math.round(totalContentValue * 12 * 100) / 100,
      roi: 0,
      postsPublished,
    };
  }

  return {
    organicTrafficValue: Math.round(totalValue * 100) / 100,
    adSpendEquivalent: Math.round(adSpendEquivalent * 100) / 100,
    growthPercent: null, // Would need historical data to compute
    pageBreakdown,
    totalClicks,
    totalImpressions,
    avgCPC: Math.round(avgCPC * 100) / 100,
    trackedPages: pageBreakdown.length,
    contentROI,
    contentItems,
    computedAt: new Date().toISOString(),
  };
}
