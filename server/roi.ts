/**
 * ROI calculations — organic traffic value, ad spend equivalent, content ROI.
 * Uses GSC clicks × CPC from normalized page_keywords rows, with legacy
 * keyword strategy pageMap fallback for older data.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { getWorkspace } from './workspaces.js';
import { listContentRequests } from './content-requests.js';
import { listMatrices } from './content-matrices.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { listPageKeywords } from './page-keywords.js';
import { normalizePageUrl } from './utils/page-address.js';
import { keywordDollarValue } from './scoring/keyword-value-money.js';
import { isFeatureEnabled } from './feature-flags.js';
import { loadGa4SnapshotHistory } from './ga4-snapshots.js';
import { aggregatePinnedOutcomes, computeOutcomeBaseline, selectOutcomeProvenance } from './the-issue-outcome.js';
import { countFormSubmissions } from './form-submissions.js';
import type { Ga4ConversionSnapshot, OutcomeBaseline, OutcomeProvenance, OutcomeTypeBreakdown } from '../shared/types/the-issue.js';


const log = createLogger('roi');
// ── SQLite row shape ──

interface SnapshotRow {
  id: number;
  workspace_id: string;
  organic_traffic_value: number;
  computed_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO roi_snapshots (workspace_id, organic_traffic_value, computed_at)
         VALUES (@workspace_id, @organic_traffic_value, @computed_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM roi_snapshots WHERE workspace_id = ? ORDER BY computed_at ASC`,
  ),
  pruneOld: db.prepare(
    `DELETE FROM roi_snapshots WHERE workspace_id = ? AND computed_at < ?`,
  ),
}));

interface ROISnapshot {
  organicTrafficValue: number;
  computedAt: string;
}

function loadHistory(workspaceId: string): ROISnapshot[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as SnapshotRow[];
  return rows.map(r => ({ organicTrafficValue: r.organic_traffic_value, computedAt: r.computed_at }));
}

function saveSnapshot(workspaceId: string, value: number): void {
  stmts().insert.run({
    workspace_id: workspaceId,
    organic_traffic_value: value,
    computed_at: new Date().toISOString(),
  });
  // Keep last 90 days of daily snapshots
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  stmts().pruneOld.run(workspaceId, cutoff);
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

/**
 * The GA4 conversion snapshot closest to 30 days before `latestCapturedAt`, but only if it lands
 * within the 15–45-day window (mirrors computeGrowthPercent's guard so MoM is apples-to-apples and
 * never anchored to a too-recent or too-stale snapshot). Excludes the latest snapshot itself.
 * Returns null when nothing qualifies — caller surfaces the honest "establishing" state.
 */
export function findPriorOutcomeSnapshot(
  history: Ga4ConversionSnapshot[],
  latestCapturedAt: string,
): Ga4ConversionSnapshot | null {
  const target = new Date(latestCapturedAt).getTime() - 30 * 24 * 60 * 60 * 1000;
  let closest: Ga4ConversionSnapshot | null = null;
  let closestDiff = Infinity;
  for (const s of history) {
    if (s.capturedAt === latestCapturedAt) continue;
    const diff = Math.abs(new Date(s.capturedAt).getTime() - target);
    if (diff < closestDiff) { closest = s; closestDiff = diff; }
  }
  if (!closest) return null;
  // closestDiff is distance from the 30-day mark; ≤15 days ⇒ snapshot is 15–45 days before latest.
  return closestDiff <= 15 * 24 * 60 * 60 * 1000 ? closest : null;
}

export interface ROIData {
  /** Total estimated dollar value of organic traffic this period */
  organicTrafficValue: number;
  /** What the equivalent PPC ad spend would be */
  adSpendEquivalent: number;
  /** Month-over-month growth in traffic value (percentage) */
  growthPercent: number | null;
  /**
   * Portfolio "Revenue at stake" (Task 3.4): Σ keywordDollarValue(kw).upsideMonthly
   * over the page_keywords already loaded here — the monthly $ unlocked if tracked
   * keywords move toward stronger positions. Reuses the single keywordDollarValue helper (no second $ math).
   */
  revenueAtStake?: number;
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
  /**
   * The Issue (Client) P0 — outcome-denominated verdict. Present ONLY when the spine flag is ON,
   * GA4 conversions exist, AND workspace.outcomeValue is set; additive + optional → legacy callers
   * and the flag-OFF path are unaffected. provenance is ALWAYS 'estimate_ga4' in P0.
   */
  outcomeVerdict?: {
    outcomeCount: number;
    outcomeUnitLabel: string;
    valuePerOutcome: number;
    estimatedValue: number;
    monthlyRetainer: number | null;
    baseline: OutcomeBaseline;
    baselineDeltaCount: number | null;
    /**
     * P1 (IA v2): outcome count for the previous comparable 30-day period — the snapshot closest to
     * 30 days before the latest, within a 15–45 day window. null when no qualifying prior snapshot
     * exists (the client then shows the honest "establishing your trend" line, never a fabricated
     * delta). The month-over-month delta is `outcomeCount − priorPeriodCount`.
     */
    priorPeriodCount: number | null;
    provenance: OutcomeProvenance;
    /** P1a: typed breakdown ("23 form fills + 41 calls"). Present when measured-capture is ON. */
    outcomeTypeBreakdown?: OutcomeTypeBreakdown[];
    /** P1a: anonymous reconciliation counts for the trust-guard discrepancy surface. Counts only —
     *  never PII. Present only when measured-capture is ON. */
    outcomeReconciliation?: { ga4Count: number; capturedCount: number };
  };
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
  source?: 'request' | 'matrix';
}

/**
 * Compute ROI data for a workspace.
 * Pulls normalized page_keywords rows (with clicks, CPC) for the workspace,
 * falling back to legacy keywordStrategy.pageMap when rows have not migrated.
 */
export function computeROI(workspaceId: string): ROIData | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;

  const pageKeywordRows = listPageKeywords(workspaceId);
  const legacyPageMap = ws.keywordStrategy?.pageMap ?? [];
  const pages = pageKeywordRows.length > 0 ? pageKeywordRows : legacyPageMap;
  if (pages.length === 0) return null;

  // Build page breakdown
  const pageBreakdown: PageROI[] = [];
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalCPCWeighted = 0;
  let totalValue = 0;
  // Task 3.4: portfolio "Revenue at stake" = Σ upsideMonthly over the same pages,
  // via the single keywordDollarValue helper (one $ definition — no second $ math).
  let revenueAtStake = 0;

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

    revenueAtStake += keywordDollarValue({
      clicks,
      cpc,
      currentPosition: page.currentPosition ?? null,
      impressions,
      ctrCurve: null,
    }).upsideMonthly;

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

  const seenKeywords = new Set<string>();

  for (const req of deliveredReqs) {
    // Try to match by targetPageSlug or targetPageId
    const slug = req.targetPageSlug;
    const normalizedSlug = slug ? normalizePageUrl(slug) : undefined;
    const traffic = normalizedSlug ? pathTraffic.get(normalizedSlug) : undefined;
    const clicks = traffic?.clicks || 0;
    const impressions = traffic?.impressions || 0;
    const cpc = traffic?.cpc || avgCPC;
    const value = clicks * cpc;
    totalContentValue += value;
    if (req.targetKeyword) seenKeywords.add(req.targetKeyword.toLowerCase());

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
      source: 'request',
    });
  }

  // Include published matrix cells not already covered by content requests
  try {
    const matrices = listMatrices(workspaceId);
    for (const matrix of matrices) {
      for (const cell of (matrix.cells || [])) {
        if (cell.status !== 'published' || !cell.targetKeyword) continue;
        if (seenKeywords.has(cell.targetKeyword.toLowerCase())) continue;
        seenKeywords.add(cell.targetKeyword.toLowerCase());

        const slug = cell.plannedUrl;
        const normalizedSlug = slug ? normalizePageUrl(slug) : undefined;
        const traffic = normalizedSlug ? pathTraffic.get(normalizedSlug) : undefined;
        const clicks = traffic?.clicks || 0;
        const impressions = traffic?.impressions || 0;
        const cpc = traffic?.cpc || avgCPC;
        const value = clicks * cpc;
        totalContentValue += value;

        contentItems.push({
          requestId: cell.id,
          topic: cell.variableValues ? Object.values(cell.variableValues).join(' × ') : cell.targetKeyword,
          targetKeyword: cell.targetKeyword,
          targetPageId: cell.id,
          targetPageSlug: slug,
          status: 'published',
          clicks,
          impressions,
          trafficValue: Math.round(value * 100) / 100,
          source: 'matrix',
        });
      }
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'roi: programming error'); /* matrices not available — skip */ }

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
    revenueAtStake: Math.round(revenueAtStake * 100) / 100,
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

  // The Issue (Client) P0 — additive outcome-denominated verdict. Hydrated ONLY when the spine flag
  // is ON for this workspace AND outcomeValue is set AND a GA4 conversion snapshot exists. Otherwise
  // left undefined so the flag-OFF / legacy path is byte-identical (no fabricated number).
  if (isFeatureEnabled('the-issue-client-spine', workspaceId) && ws.outcomeValue) {
    const history = loadGa4SnapshotHistory(ws.id);
    const latest = history.length > 0 ? history[history.length - 1] : null;
    if (latest) {
      const agg = aggregatePinnedOutcomes(ws, latest.byEvent);
      const baseline = computeOutcomeBaseline(ws);
      const baselineDeltaCount =
        baseline.state === 'ready' && baseline.baselineConversions != null
          ? agg.totalConversions - baseline.baselineConversions
          : null;
      // P1 (IA v2): real month-over-month — re-aggregate the SAME pinned outcomes from the prior
      // snapshot so the delta is apples-to-apples. null when no snapshot lands in the window.
      const priorSnapshot = findPriorOutcomeSnapshot(history, latest.capturedAt);
      const priorPeriodCount = priorSnapshot
        ? aggregatePinnedOutcomes(ws, priorSnapshot.byEvent).totalConversions
        : null;
      // P1a current-period window for Webflow form-submission counts/reconciliation: the 30 days
      // ending at the latest snapshot. countFormSubmissions returns 0 when measured-capture is OFF
      // anyway (no leads captured), so the OFF path stays byte-identical.
      const periodEnd = latest.capturedAt.slice(0, 10);
      const periodStartMs = new Date(latest.capturedAt).getTime() - 30 * 24 * 60 * 60 * 1000;
      const currentPeriodRange = { startDate: new Date(periodStartMs).toISOString().slice(0, 10), endDate: periodEnd };
      const periodFormCount = countFormSubmissions(ws.id, currentPeriodRange);
      // P1a provenance seam: graduate the COUNT's confidence to measured_action on confirmed setup
      // (D6); estimate_ga4 otherwise (incl. the flag-OFF / P0 path). The dollar math is unchanged.
      const provenance: OutcomeProvenance = selectOutcomeProvenance(ws, periodFormCount);
      const verdictBaseline: OutcomeBaseline = baseline;
      result.outcomeVerdict = {
        outcomeCount: agg.totalConversions,
        outcomeUnitLabel: ws.outcomeValue.unitLabel,
        valuePerOutcome: ws.outcomeValue.valuePerOutcome,
        estimatedValue: agg.totalConversions * ws.outcomeValue.valuePerOutcome,
        monthlyRetainer: ws.outcomeValue.monthlyRetainer ?? null,
        baseline: verdictBaseline,
        baselineDeltaCount,
        priorPeriodCount,
        provenance,
      };
      // P1a additive fields — only when measured-capture is ON, so the OFF path emits neither
      // (byte-identical to P0). outcomeTypeBreakdown carries the typed rollup; outcomeReconciliation
      // carries anonymous GA4-vs-captured counts (A8) — counts only, never PII (D7).
      if (isFeatureEnabled('the-issue-client-measured-capture', workspaceId)) {
        result.outcomeVerdict.outcomeTypeBreakdown = agg.byType;
        result.outcomeVerdict.outcomeReconciliation = {
          ga4Count: agg.totalConversions,        // anonymous aggregate
          capturedCount: periodFormCount,        // named-lead COUNT only — no names ride the payload
        };
      }
    }
  }

  return result;
}
