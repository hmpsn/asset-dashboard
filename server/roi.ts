/**
 * ROI calculations — organic traffic value, ad spend equivalent, content ROI.
 * Uses GSC clicks × CPC from keyword strategy pageMap.
 */

import { getWorkspace } from './workspaces.js';

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

  // Content ROI (if workspace has content pricing + delivered content)
  let contentROI: ContentROIMetrics | null = null;
  if (ws.contentPricing) {
    // Count delivered content by reading content requests
    // (simplified — full implementation would read content-requests store)
    const fullPostPrice = ws.contentPricing.fullPostPrice || 0;
    // Rough estimation: average post generates 50 clicks/month at avg CPC
    const estimatedPostValue = 50 * avgCPC;
    if (fullPostPrice > 0 && estimatedPostValue > 0) {
      contentROI = {
        totalContentSpend: fullPostPrice,
        totalContentValue: estimatedPostValue * 12, // annualized
        roi: ((estimatedPostValue * 12 - fullPostPrice) / fullPostPrice) * 100,
        postsPublished: 0, // would be populated from content request data
      };
    }
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
    computedAt: new Date().toISOString(),
  };
}
