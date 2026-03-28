import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import { getROIHighlights } from './roi-attribution.js';
import { callOpenAI } from './openai-helpers.js';
import { getSearchPeriodComparison } from './search-console.js';
import { getGA4PeriodComparison } from './google-analytics.js';
import type { MonthlyDigestData, DigestItem, ROIHighlight } from '../shared/types/narrative.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { Workspace } from './workspaces.js';

const log = createLogger('monthly-digest');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 200; // bound memory: ~1 entry per workspace per active month
const digestCache = new Map<string, { result: MonthlyDigestData; ts: number }>();
// In-flight dedup: concurrent requests for the same key share one computation
const inflightDigests = new Map<string, Promise<MonthlyDigestData>>();

/**
 * Generate a monthly performance digest for a workspace.
 * Aggregates insights, anomalies, and ROI data into a client-facing narrative.
 */
export async function generateMonthlyDigest(
  ws: Workspace,
  month?: string, // "March 2026" — defaults to current month
): Promise<MonthlyDigestData> {
  const now = new Date();
  const monthLabel = month ?? now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // Parse the month label into actual dates so period/comparisons reflect the correct month
  const targetDate = parseMonthLabel(monthLabel, now);

  const cacheKey = `${ws.id}:${monthLabel}`;
  const cached = digestCache.get(cacheKey);
  if (cached) {
    if (now.getTime() - cached.ts < CACHE_TTL_MS) return cached.result;
    digestCache.delete(cacheKey); // evict expired entry
  }

  // Coalesce concurrent requests — only one OpenAI call per cache key
  const inflight = inflightDigests.get(cacheKey);
  if (inflight) return inflight;

  const promise = computeDigest(ws, monthLabel, targetDate, now);
  inflightDigests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflightDigests.delete(cacheKey);
  }
}

async function computeDigest(
  ws: Workspace,
  monthLabel: string,
  targetDate: Date,
  now: Date,
): Promise<MonthlyDigestData> {
  const cacheKey = `${ws.id}:${monthLabel}`;
  const insights = getInsights(ws.id);
  const roiHighlights = getROIHighlights(ws.id, 5);

  // Wins: positive severity or positive ranking mover
  const wins = insights
    .filter(i => i.severity === 'positive' || (i.insightType === 'ranking_mover' && isPositiveMove(i)))
    .slice(0, 5)
    .map(insightToDigestItem);

  // Issues addressed: resolved insights
  const issuesAddressed = insights
    .filter(i => i.resolutionStatus === 'resolved')
    .slice(0, 5)
    .map(i => ({
      title: i.pageTitle ?? 'Page optimization',
      detail: i.resolutionNote ?? 'Issue addressed',
      insightId: i.id,
    }));

  // Fetch GSC + GA4 period comparisons concurrently; degrade gracefully if unavailable
  const COMPARISON_DAYS = 28;
  let clicksChange = 0;
  let impressionsChange = 0;
  let avgPositionChange = 0;

  const [gscResult, ga4Result] = await Promise.allSettled([
    ws.webflowSiteId && ws.gscPropertyUrl
      ? getSearchPeriodComparison(ws.webflowSiteId, ws.gscPropertyUrl, COMPARISON_DAYS)
      : Promise.reject(new Error('GSC not configured')),
    ws.ga4PropertyId
      ? getGA4PeriodComparison(ws.ga4PropertyId, COMPARISON_DAYS)
      : Promise.reject(new Error('GA4 not configured')),
  ]);

  if (gscResult.status === 'fulfilled') {
    const { changePercent, change } = gscResult.value;
    clicksChange = changePercent.clicks;
    impressionsChange = changePercent.impressions;
    // Negate: lower position = better rank, so improvement is a negative change
    avgPositionChange = +(-change.position).toFixed(1);
  } else {
    log.debug({ workspaceId: ws.id }, 'GSC comparison unavailable for digest metrics');
  }

  if (ga4Result.status === 'fulfilled') {
    // GA4 sessions available for future metrics expansion — currently GSC covers clicks/impressions
    void ga4Result.value;
  }

  const metrics = {
    clicksChange,
    impressionsChange,
    avgPositionChange,
    pagesOptimized: issuesAddressed.length,
  };

  const summary = await generateDigestSummary(monthLabel, wins, issuesAddressed, roiHighlights, metrics);

  const result: MonthlyDigestData = {
    month: monthLabel,
    period: {
      start: new Date(targetDate.getFullYear(), targetDate.getMonth(), 1).toISOString(),
      end: new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).toISOString(),
    },
    summary,
    wins,
    issuesAddressed,
    metrics,
    roiHighlights,
  };

  // Evict oldest entries if cache exceeds size cap
  if (digestCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [...digestCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < Math.ceil(MAX_CACHE_ENTRIES / 4); i++) {
      digestCache.delete(oldest[i][0]);
    }
  }
  digestCache.set(cacheKey, { result, ts: now.getTime() });
  return result;
}

function isPositiveMove(insight: AnalyticsInsight): boolean {
  const data = insight.data as Record<string, unknown>;
  const prev = (data.previousPosition as number) ?? 0;
  const curr = (data.currentPosition as number) ?? 0;
  return curr < prev && curr > 0 && (prev - curr) > 3;
}

function insightToDigestItem(insight: AnalyticsInsight): DigestItem {
  return {
    title: insight.pageTitle ?? 'Performance update',
    detail: formatInsightForDigest(insight),
    insightId: insight.id,
  };
}

function formatInsightForDigest(insight: AnalyticsInsight): string {
  switch (insight.insightType) {
    case 'ranking_mover':
      return 'Ranking improved — now appearing higher in search results';
    case 'ranking_opportunity':
      return 'Close to first page of search results';
    case 'ctr_opportunity':
      return 'Opportunities to increase clicks from search';
    case 'page_health':
      return 'Page health improvements identified';
    case 'competitor_gap':
      return 'Competitive gap opportunity detected';
    case 'serp_opportunity':
      return 'Search visibility improvement detected';
    default:
      return 'Performance update identified';
  }
}

async function generateDigestSummary(
  month: string,
  wins: DigestItem[],
  issues: DigestItem[],
  roi: ROIHighlight[],
  metrics: { clicksChange: number; impressionsChange: number; avgPositionChange: number; pagesOptimized: number },
): Promise<string> {
  const clicksTrend = metrics.clicksChange > 0 ? `+${metrics.clicksChange.toFixed(1)}%` : metrics.clicksChange < 0 ? `${metrics.clicksChange.toFixed(1)}%` : null;
  const impressionsTrend = metrics.impressionsChange > 0 ? `+${metrics.impressionsChange.toFixed(1)}%` : metrics.impressionsChange < 0 ? `${metrics.impressionsChange.toFixed(1)}%` : null;
  const positionTrend = metrics.avgPositionChange > 0 ? `improved ${metrics.avgPositionChange} spot${metrics.avgPositionChange !== 1 ? 's' : ''}` : null;

  const metricLines = [
    clicksTrend ? `Search clicks: ${clicksTrend}` : null,
    impressionsTrend ? `Impressions: ${impressionsTrend}` : null,
    positionTrend ? `Average ranking position: ${positionTrend}` : null,
  ].filter(Boolean).join('\n');

  try {
    const prompt = `Write a 2-3 sentence monthly performance summary for a website client.
Month: ${month}
Wins: ${wins.length} improvements identified
Issues addressed: ${issues.length} optimizations completed
Pages optimized: ${metrics.pagesOptimized}
ROI highlights: ${roi.length} measurable improvements
${metricLines ? `\nSearch performance this period:\n${metricLines}` : ''}

Tone: Professional, outcome-focused, reassuring. No jargon. Use "we" language.
Only mention specific numbers if they are notable (>10% change). Keep it concise.`;

    const result = await callOpenAI({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
    });

    return result || fallbackSummary(month, wins.length, issues.length);
  } catch (err) {
    log.warn({ err }, 'AI digest summary failed — using fallback');
    return fallbackSummary(month, wins.length, issues.length);
  }
}

function fallbackSummary(month: string, wins: number, issues: number): string {
  return `In ${month}, we continued optimizing your site's search performance. ${wins} improvement${wins === 1 ? '' : 's'} were identified and ${issues} issue${issues === 1 ? '' : 's'} were addressed.`;
}

/**
 * Parse a month label like "March 2026" into a Date.
 * Falls back to `fallback` if parsing fails.
 */
function parseMonthLabel(label: string, fallback: Date): Date {
  const parsed = new Date(`${label} 1`);
  return isNaN(parsed.getTime()) ? fallback : parsed;
}
