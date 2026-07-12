import { createLogger } from './logger.js';
import { getROIHighlightsFromOutcomes } from './outcome-tracking.js';
import { callAI } from './ai.js';
import { getSearchPeriodComparison } from './search-console.js';
import { getGA4PeriodComparison } from './google-analytics.js';
import type { CustomDateRange } from './google-analytics.js';
import type { MonthlyDigestData, DigestItem, ROIHighlight } from '../shared/types/narrative.js';
import type { AnalyticsInsight } from '../shared/types/analytics.js';
import type { Workspace } from './workspaces.js';
import { getInsights } from './analytics-insights-store.js';
import { buildSystemPrompt } from './prompt-assembly.js';
import { isProgrammingError } from './errors.js';
import { listBatches } from './approvals.js';
import { listWorkOrders } from './work-orders.js';
import { getOrComputeMonthlyDigest } from './monthly-digest-cache.js';

const log = createLogger('monthly-digest');
const NO_DATA_SUMMARY = 'No current-month results are available yet. This digest will update after search activity, site visits, completed work, or measured results are recorded.';

interface CurrentUtcReportingWindow {
  dateRange: CustomDateRange;
  startIso: string;
  endIso: string;
  endExclusiveIso: string;
  startMs: number;
  endExclusiveMs: number;
}

function getCurrentUtcReportingWindow(now: Date): CurrentUtcReportingWindow {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEndExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const conservativeReportingCutoff = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 3,
  ));
  const queriedEndDay = conservativeReportingCutoff < monthEndExclusive
    ? new Date(Math.max(start.getTime(), conservativeReportingCutoff.getTime()))
    : new Date(monthEndExclusive.getTime() - 24 * 60 * 60 * 1000);
  const nominalEndExclusiveMs = queriedEndDay.getTime() + 24 * 60 * 60 * 1000;
  const endExclusive = new Date(Math.max(
    start.getTime(),
    Math.min(now.getTime(), nominalEndExclusiveMs),
  ));
  const end = new Date(Math.max(start.getTime(), endExclusive.getTime() - 1));
  const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

  return {
    dateRange: {
      startDate: dateOnly(start),
      endDate: dateOnly(end),
    },
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
    startMs: start.getTime(),
    endExclusiveMs: endExclusive.getTime(),
  };
}

function isInReportingWindow(value: string | null | undefined, window: CurrentUtcReportingWindow): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= window.startMs
    && timestamp < window.endExclusiveMs;
}

/**
 * Generate a monthly performance digest for a workspace.
 * Aggregates insights, anomalies, and ROI data into a client-facing narrative.
 */
export async function generateMonthlyDigest(
  ws: Workspace,
): Promise<MonthlyDigestData> {
  const now = new Date();
  const monthLabel = now.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const reportingWindow = getCurrentUtcReportingWindow(now);
  // The current-month reporting cutoff advances each UTC day. Include the
  // effective provider window in the identity so a cache created just before
  // midnight cannot serve yesterday's period for another 24 hours.
  const cacheIdentity = `${monthLabel}:${reportingWindow.startIso}:${reportingWindow.endExclusiveIso}`;

  return getOrComputeMonthlyDigest(
    ws.id,
    cacheIdentity,
    now.getTime(),
    () => computeDigest(ws, monthLabel, reportingWindow),
  );
}

async function computeDigest(
  ws: Workspace,
  monthLabel: string,
  reportingWindow: CurrentUtcReportingWindow,
): Promise<MonthlyDigestData> {
  // Deterministic digest rollups (wins, resolved "issues addressed", pagesOptimized)
  // need FULL insight coverage — resolved/positive items are typically low-impact and
  // fall outside the slice's prompt-facing bounds (`all` top-100, `byType` top-25/type
  // since G3). Full iteration is not slice-backed post-cap, so this is a documented
  // direct-read exception per docs/rules/intelligence-consumer-builders.md. The
  // current-month AI prompt is built only from this bounded read; lifetime
  // workspace learnings are intentionally excluded from an operational digest.
  let insights: AnalyticsInsight[] = [];
  try {
    insights = [...getInsights(ws.id)].sort( // intel-builder-ok: non-prompt deterministic rollups need full pre-cap coverage (see comment above)
      (a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0),
    );
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'monthly-digest: programming error reading insights');
    // insights unavailable — digest degrades to integration metrics only
  }
  const currentMonthInsights = insights.filter((insight) => (
    isInReportingWindow(insight.computedAt, reportingWindow)
  ));
  const roiHighlights = getROIHighlightsFromOutcomes(ws.id, 5, {
    start: reportingWindow.startIso,
    endExclusive: reportingWindow.endExclusiveIso,
  });

  // Wins: positive severity or positive ranking mover
  const wins = currentMonthInsights
    .filter(i => i.severity === 'positive' || (i.insightType === 'ranking_mover' && isPositiveMove(i)))
    .slice(0, 5)
    .map(insightToDigestItem);

  // Issues addressed: resolved insights + applied approval batches + completed work orders.
  // Approval-apply and work-order completion only set insight resolutionStatus to 'in_progress'
  // via Bridge #7 — they never reach 'resolved'. Count the applied/completed work directly so
  // the digest does not report "0 measurable improvements" after real work is done.
  const resolvedInsightItems = insights
    .filter(i => i.resolutionStatus === 'resolved' && isInReportingWindow(i.resolvedAt, reportingWindow))
    .map(i => ({
      title: i.pageTitle ?? 'Page optimization',
      detail: i.resolutionNote ?? 'Issue addressed',
      insightId: i.id,
      // Stable dedup key: normalized page identifier from insight store
      _dedupKey: `page:${(i.pageId ?? '').toLowerCase().replace(/^\/+/, '')}`,
    }));

  const appliedBatchItems = listBatches(ws.id)
    // A partially applied batch can remain `approved` (applied + approved
    // siblings) or `partial`, yet still contain real completed work. Count item
    // state directly instead of requiring every sibling to apply successfully.
    .flatMap(b =>
      b.items
        .filter(item => item.status === 'applied' && isInReportingWindow(item.updatedAt, reportingWindow))
        .map(item => ({
          title: item.pageTitle || 'Page optimization',
          detail: `${item.field === 'seoTitle' ? 'Title' : 'Meta description'} updated via approved changes`,
          insightId: `batch:${b.id}:${item.id}`,
          // Dedup key: canonical page path (publishedPath preferred over the
          // legacy/display-only pageSlug) + field. A true duplicate of the SAME
          // field on a page collapses, but distinct fields on one page (a title
          // AND a meta-description fix) are BOTH reported — they are separate
          // pieces of completed work.
          _dedupKey: `page:${(item.publishedPath ?? item.pageSlug ?? item.pageId ?? '').toLowerCase().replace(/^\/+/, '')}:${item.field}`,
        })),
    );

  const completedWorkOrderItems = listWorkOrders(ws.id)
    // `closed` is the terminal close-out of completed work, not an undo. Keep
    // it in the completed-work narrative after the operator closes the thread.
    .filter(o => {
      if (o.status !== 'completed' && o.status !== 'closed') return false;
      const completedAt = o.completedAt ?? (o.status === 'closed' ? o.closedAt : undefined) ?? o.updatedAt;
      return isInReportingWindow(completedAt, reportingWindow);
    })
    .map(o => ({
      title: `${o.productType.replace(/_/g, ' ')} completed`,
      detail: `${o.pageIds.length} page${o.pageIds.length !== 1 ? 's' : ''} fixed`,
      insightId: `work-order:${o.id}`,
      // Work orders affect multiple pages; use a unique key per work order
      _dedupKey: `work-order:${o.id}`,
    }));

  // Merge: resolved insights first (most authoritative), then applied batch work,
  // then completed work orders. Dedup by stable FIELD-LEVEL key before capping at 5,
  // keeping the first occurrence of any exact-key duplicate. Keys: page-path+field for
  // approvals (a title AND a meta fix on one page both count; a re-applied same field
  // collapses), insight pageId for resolved insights, work-order id for work orders.
  // Distinct pieces of work are never dropped. (Approval-apply sets insight status to
  // 'in_progress', not 'resolved', so a resolved insight and an applied approval are
  // generally separate events — we do not force-collapse them across sources.)
  const seenDedupKeys = new Set<string>();
  const issuesAddressed = [
    ...resolvedInsightItems,
    ...appliedBatchItems,
    ...completedWorkOrderItems,
  ]
    .filter(item => {
      if (seenDedupKeys.has(item._dedupKey)) return false;
      seenDedupKeys.add(item._dedupKey);
      return true;
    })
    .map(({ _dedupKey: _k, ...rest }) => rest)
    .slice(0, 5);

  // Fetch GSC + GA4 period comparisons concurrently; degrade gracefully if unavailable
  const COMPARISON_DAYS = 28;
  let clicksChange = 0;
  let impressionsChange = 0;
  let avgPositionChange = 0;
  let sessionsChange: number | undefined;

  const [gscResult, ga4Result] = await Promise.allSettled([
    ws.webflowSiteId && ws.gscPropertyUrl
      ? getSearchPeriodComparison(
          ws.webflowSiteId,
          ws.gscPropertyUrl,
          COMPARISON_DAYS,
          reportingWindow.dateRange,
        )
      : Promise.reject(new Error('GSC not configured')),
    ws.ga4PropertyId
      ? getGA4PeriodComparison(ws.ga4PropertyId, COMPARISON_DAYS, reportingWindow.dateRange)
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
    const change = ga4Result.value.changePercent?.sessions;
    if (typeof change === 'number' && Number.isFinite(change)) sessionsChange = change;
  }

  const metrics = {
    clicksChange,
    impressionsChange,
    avgPositionChange,
    pagesOptimized: issuesAddressed.length,
  };

  const attentionInsights = currentMonthInsights
    .filter(insight => insight.severity === 'critical'
      || insight.severity === 'warning'
      || insight.severity === 'opportunity')
    .slice(0, 5);
  const hasProviderEvidence = gscResult.status === 'fulfilled' || ga4Result.status === 'fulfilled';
  const hasOperationalEvidence = wins.length > 0
    || issuesAddressed.length > 0
    || roiHighlights.length > 0
    || attentionInsights.length > 0;
  if (!hasProviderEvidence && !hasOperationalEvidence) {
    return {
      availability: 'no_data',
      month: monthLabel,
      period: {
        start: reportingWindow.startIso,
        end: reportingWindow.endIso,
      },
      summary: NO_DATA_SUMMARY,
      wins: [],
      issuesAddressed: [],
      metrics,
      roiHighlights: [],
    };
  }

  // Reuse the bounded insight read for prompt evidence; no lifetime learning totals.
  let topWinsBlock = '';
  try {
    const positiveInsights = currentMonthInsights
      .filter(i => i.severity === 'positive')
      .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
      .slice(0, 3);
    if (positiveInsights.length > 0) {
      topWinsBlock = `\nNotable wins this period:\n${positiveInsights.map(i => `- ${i.pageTitle ?? i.insightType}`).join('\n')}`;
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'monthly-digest: programming error'); /* insights not available — skip */ }

  const summary = await generateDigestSummary(
    monthLabel,
    wins,
    issuesAddressed,
    roiHighlights,
    { ...metrics, sessionsChange },
    attentionInsights,
    {
      search: gscResult.status === 'fulfilled',
      analytics: ga4Result.status === 'fulfilled',
    },
    topWinsBlock,
    ws.id,
  );

  const result: MonthlyDigestData = {
    availability: 'ready',
    month: monthLabel,
    period: {
      start: reportingWindow.startIso,
      end: reportingWindow.endIso,
    },
    summary,
    wins,
    issuesAddressed,
    metrics,
    roiHighlights,
  };

  return result;
}

function isPositiveMove(insight: AnalyticsInsight): boolean {
  if (insight.insightType !== 'ranking_mover') return false;
  const data = insight.data as unknown as import('../shared/types/analytics.js').RankingMoverData;
  return data.currentPosition < data.previousPosition
    && data.currentPosition > 0
    && (data.previousPosition - data.currentPosition) > 3;
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

function formatAttentionInsightForDigest(insight: AnalyticsInsight): string {
  if (insight.insightType === 'ranking_mover') return 'Ranking movement flagged for review';
  return formatInsightForDigest(insight);
}

async function generateDigestSummary(
  month: string,
  wins: DigestItem[],
  issues: DigestItem[],
  roi: ROIHighlight[],
  metrics: {
    clicksChange: number;
    impressionsChange: number;
    avgPositionChange: number;
    pagesOptimized: number;
    sessionsChange?: number;
  },
  attentionInsights: AnalyticsInsight[],
  providerEvidence: { search: boolean; analytics: boolean },
  topWinsBlock?: string,
  workspaceId?: string,
): Promise<string> {
  const signedPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  const positionTrend = metrics.avgPositionChange > 0
    ? `improved ${metrics.avgPositionChange} spot${metrics.avgPositionChange !== 1 ? 's' : ''}`
    : metrics.avgPositionChange < 0
      ? `worsened ${Math.abs(metrics.avgPositionChange)} spot${Math.abs(metrics.avgPositionChange) !== 1 ? 's' : ''}`
      : 'no change (0 spots)';

  const metricLines = [
    providerEvidence.search ? `Search clicks: ${signedPercent(metrics.clicksChange)}` : null,
    providerEvidence.search ? `Impressions: ${signedPercent(metrics.impressionsChange)}` : null,
    providerEvidence.analytics && metrics.sessionsChange != null
      ? `Site sessions: ${signedPercent(metrics.sessionsChange)}`
      : null,
    providerEvidence.search ? `Average ranking position: ${positionTrend}` : null,
  ].filter(Boolean).join('\n');

  const attentionBlock = attentionInsights.length > 0
    ? `\nSignals requiring attention this period:\n${attentionInsights.map(insight => (
        `- [${insight.severity}] ${insight.pageTitle ?? insight.insightType}: ${formatAttentionInsightForDigest(insight)}`
      )).join('\n')}`
    : '';

  try {
    const roiEvidenceLines = roi.map(result => {
      const value = typeof result.attributedValue === 'number' && result.attributedValue > 0
        ? `; $${result.attributedValue.toFixed(2)} estimated value`
        : '';
      const execution = result.attribution === 'externally_executed'
        ? 'implemented on the client side; do not claim agency execution credit'
        : result.attribution === 'platform_executed'
          ? 'implemented through the platform; agency execution credit is permitted for this row'
          : 'execution attribution unavailable; do not assign execution credit';
      return `  • ${result.pageTitle}: ${result.result} (${result.action})${value}. Execution: ${execution}.`;
    }).join('\n');

    const prompt = `Write a 2-3 sentence monthly performance update for a website client's dashboard.

Data for ${month}:
- ${wins.length} performance win${wins.length === 1 ? '' : 's'} identified
- ${issues.length} optimization${issues.length === 1 ? '' : 's'} completed
- ${metrics.pagesOptimized} page${metrics.pagesOptimized === 1 ? '' : 's'} optimized
- ${roi.length} measurable improvement${roi.length === 1 ? '' : 's'}${roiEvidenceLines ? `\nMeasured results with authoritative execution framing:\n${roiEvidenceLines}` : ''}
${metricLines ? `\nSearch performance this period:\n${metricLines}` : ''}
${topWinsBlock ?? ''}
${attentionBlock}

Voice rules (follow exactly):
- Lead with the most interesting metric or outcome — never start with "In [Month]" or "This month"
- Match the evidence direction exactly. Never recast a decline or a legitimate zero as a win, momentum, or a strong baseline.
- Clear and constructive, like a teammate giving a factual update. Not corporate or templated.
- Use "your site" or "your pages", not "the site" or "the website"
- Mention ONE specific number if it's notable (>10% change). Don't list multiple stats.
- If metrics are flat or slightly negative, frame around what's being learned or where attention is focused — without making promises or commitments about future work.
- Preserve every measured result's execution framing. Client-side work must never receive agency execution credit; unknown attribution stays neutral.
- Never say "we're on it", "we're working on", "we will", or "rest assured" — the scope of work depends on the client's retainer.
- 2-3 sentences max. Warm but concise.`;

    const systemPrompt = buildSystemPrompt(
      workspaceId ?? '',
      'You are writing a concise monthly performance update for a website client dashboard. Write 2-3 factual, encouraging sentences. No fluff.',
    );

    const result = await callAI({
      model: 'gpt-5.4',
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      temperature: 0.4,
      feature: 'monthly-digest',
      workspaceId: workspaceId ?? '',
    });

    return result.text.trim() || fallbackSummary(wins, issues, roi, metrics, attentionInsights, providerEvidence);
  } catch (err) {
    log.warn({ err }, 'AI digest summary failed — using fallback');
    return fallbackSummary(wins, issues, roi, metrics, attentionInsights, providerEvidence);
  }
}

function fallbackSummary(
  wins: DigestItem[],
  issues: DigestItem[],
  roi: ROIHighlight[],
  metrics: {
    clicksChange: number;
    impressionsChange: number;
    avgPositionChange: number;
    pagesOptimized: number;
    sessionsChange?: number;
  },
  attentionInsights: AnalyticsInsight[],
  providerEvidence: { search: boolean; analytics: boolean },
): string {
  const directionalMetrics: Array<{ magnitude: number; sentence: string }> = [];
  const addPercentDirection = (label: string, value: number | undefined) => {
    if (value == null || !Number.isFinite(value) || value === 0) return;
    directionalMetrics.push({
      magnitude: Math.abs(value),
      sentence: `${label} ${value > 0 ? 'increased' : 'decreased'} ${Math.abs(value).toFixed(1)}% in the current reporting window.`,
    });
  };
  if (providerEvidence.search) {
    addPercentDirection('Search clicks', metrics.clicksChange);
    addPercentDirection('Search impressions', metrics.impressionsChange);
    if (Number.isFinite(metrics.avgPositionChange) && metrics.avgPositionChange !== 0) {
      directionalMetrics.push({
        magnitude: Math.abs(metrics.avgPositionChange),
        sentence: `Average search position ${metrics.avgPositionChange > 0 ? 'improved' : 'worsened'} by ${Math.abs(metrics.avgPositionChange).toFixed(1)} spot${Math.abs(metrics.avgPositionChange) === 1 ? '' : 's'} in the current reporting window.`,
      });
    }
  }
  if (providerEvidence.analytics) addPercentDirection('Site sessions', metrics.sessionsChange);

  const metricSentence = directionalMetrics.sort((a, b) => b.magnitude - a.magnitude)[0]?.sentence
    ?? (providerEvidence.search || providerEvidence.analytics
      ? 'Connected provider comparisons are available for this reporting window; no percentage change was recorded in the reported metrics.'
      : null);

  let workSentence: string | null = null;
  if (wins.length > 0 && issues.length > 0) {
    workSentence = `Your site picked up ${wins.length} performance win${wins.length === 1 ? '' : 's'} this period, and ${issues.length} optimization${issues.length === 1 ? ' was' : 's were'} completed.`;
  } else if (wins.length > 0) {
    workSentence = `${wins.length} performance win${wins.length === 1 ? '' : 's'} spotted on your site this period.`;
  } else if (issues.length > 0) {
    workSentence = `${issues.length} optimization${issues.length === 1 ? ' was' : 's were'} completed this period.`;
  }

  const attentionSentence = attentionInsights.length > 0
    ? `${attentionInsights.length} current-month signal${attentionInsights.length === 1 ? '' : 's'} ${attentionInsights.length === 1 ? 'requires' : 'require'} attention: ${attentionInsights.slice(0, 2).map(insight => insight.pageTitle ?? insight.insightType).join(' and ')}.`
    : null;
  const externalCount = roi.filter(result => result.attribution === 'externally_executed').length;
  const roiSentence = roi.length > 0
    ? `${roi.length} measured result${roi.length === 1 ? ' was' : 's were'} recorded${externalCount > 0 ? `, including ${externalCount} from work implemented on the client side` : ''}.`
    : null;

  return [metricSentence, workSentence, attentionSentence, roiSentence]
    .filter((sentence): sentence is string => sentence != null)
    .slice(0, 3)
    .join(' ')
    || 'Current-month evidence is available, but it does not support a directional performance claim.';
}
