import { createLogger } from './logger.js';
import { getInsights } from './analytics-insights-store.js';
import { getROIHighlights } from './roi-attribution.js';
import { callOpenAI } from './openai-helpers.js';
import type { MonthlyDigestData, DigestItem, ROIHighlight } from '../shared/types/narrative.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';

const log = createLogger('monthly-digest');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const digestCache = new Map<string, { result: MonthlyDigestData; ts: number }>();

/**
 * Generate a monthly performance digest for a workspace.
 * Aggregates insights, anomalies, and ROI data into a client-facing narrative.
 */
export async function generateMonthlyDigest(
  workspaceId: string,
  month?: string, // "March 2026" — defaults to current month
): Promise<MonthlyDigestData> {
  const now = new Date();
  const monthLabel = month ?? now.toLocaleString('default', { month: 'long', year: 'numeric' });

  const cacheKey = `${workspaceId}:${monthLabel}`;
  const cached = digestCache.get(cacheKey);
  if (cached && now.getTime() - cached.ts < CACHE_TTL_MS) return cached.result;

  const insights = getInsights(workspaceId);
  const roiHighlights = getROIHighlights(workspaceId, 5);

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

  // Metric changes — placeholder until GSC/GA4 period comparison is wired
  const metrics = {
    clicksChange: 0,
    impressionsChange: 0,
    avgPositionChange: 0,
    pagesOptimized: issuesAddressed.length,
  };

  const summary = await generateDigestSummary(monthLabel, wins, issuesAddressed, roiHighlights, metrics);

  const result: MonthlyDigestData = {
    month: monthLabel,
    period: {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
    },
    summary,
    wins,
    issuesAddressed,
    metrics,
    roiHighlights,
  };

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
  metrics: { pagesOptimized: number },
): Promise<string> {
  try {
    const prompt = `Write a 2-3 sentence monthly performance summary for a website client.
Month: ${month}
Wins: ${wins.length} improvements identified
Issues addressed: ${issues.length} optimizations completed
Pages optimized: ${metrics.pagesOptimized}
ROI highlights: ${roi.length} measurable improvements

Tone: Professional, outcome-focused, reassuring. No jargon. Use "we" language.
Do NOT include specific numbers unless they're impressive. Keep it concise.`;

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
