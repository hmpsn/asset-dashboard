/**
 * ROI calculations — organic traffic value, ad spend equivalent, content ROI.
 * Uses GSC clicks × CPC from keyword strategy pageMap.
 */

import fs from 'fs';
import path from 'path';
import { getWorkspace } from './workspaces.js';
import { listContentRequests } from './content-requests.js';
import { getDataDir } from './data-dir.js';

const ROI_HISTORY_DIR = getDataDir('roi-history');
fs.mkdirSync(ROI_HISTORY_DIR, { recursive: true });

interface ROISnapshot {
  organicTrafficValue: number;
  computedAt: string;
}

function getHistoryFile(workspaceId: string): string {
  return path.join(ROI_HISTORY_DIR, `${workspaceId}.json`);
}

function loadHistory(workspaceId: string): ROISnapshot[] {
  try {
    const f = getHistoryFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  return [];
}

function saveSnapshot(workspaceId: string, value: number): void {
  const history = loadHistory(workspaceId);
  history.push({ organicTrafficValue: value, computedAt: new Date().toISOString() });
  // Keep last 90 days of daily snapshots (max ~90 entries)
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const trimmed = history.filter(s => new Date(s.computedAt).getTime() > cutoff);
  fs.writeFileSync(getHistoryFile(workspaceId), JSON.stringify(trimmed, null, 2));
}

function computeGrowthPercent(workspaceId: string, currentValue: number): number | null {
  const history = loadHistory(workspaceId);
  if (history.length === 0) return null;
  // Find snapshot closest to 30 days ago
  const target = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let closest: ROISnapshot | null = null;
  let closestDiff = Infinity;
  for (const s of history) {
    const diff = Math.abs(new Date(s.computedAt).getTime() - target);
    if (diff < closestDiff) { closest = s; closestDiff = diff; }
  }
  // Only use if the snapshot is within 15-45 day range
  if (!closest) return null;
  const daysAgo = (Date.now() - new Date(closest.computedAt).getTime()) / (24 * 60 * 60 * 1000);
  if (daysAgo < 15 || daysAgo > 45) return null;
  if (closest.organicTrafficValue === 0) return currentValue > 0 ? 100 : 0;
  return Math.round(((currentValue - closest.organicTrafficValue) / closest.organicTrafficValue) * 10000) / 100;
}

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

  const result: ROIData = {
    organicTrafficValue: Math.round(totalValue * 100) / 100,
    adSpendEquivalent: Math.round(adSpendEquivalent * 100) / 100,
    growthPercent: computeGrowthPercent(workspaceId, Math.round(totalValue * 100) / 100),
    pageBreakdown,
    totalClicks,
    totalImpressions,
    avgCPC: Math.round(avgCPC * 100) / 100,
    trackedPages: pageBreakdown.length,
    contentROI,
    contentItems,
    computedAt: new Date().toISOString(),
  };

  // Save snapshot for future MoM comparison
  saveSnapshot(workspaceId, result.organicTrafficValue);

  return result;
}
