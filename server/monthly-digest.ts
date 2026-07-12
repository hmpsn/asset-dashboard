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
import { isProgrammingError } from './errors.js';
import { listBatches } from './approvals.js';
import { listWorkOrders } from './work-orders.js';
import { getOrComputeMonthlyDigest } from './monthly-digest-cache.js';
import {
  MONTHLY_DIGEST_CLAUSE_IDS,
  parseMonthlyDigestClauseSelection,
  type MonthlyDigestClauseId,
} from './schemas/ai-monthly-digest.js';

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

interface DigestSummaryMetrics {
  clicksChange: number;
  impressionsChange: number;
  avgPositionChange: number;
  pagesOptimized: number;
  sessionsChange?: number;
}

interface DigestEvidenceClause {
  id: MonthlyDigestClauseId;
  sentence: string;
  priority: number;
}

interface DigestClauseEvidence {
  month: string;
  wins: DigestItem[];
  issues: DigestItem[];
  roi: ROIHighlight[];
  metrics: DigestSummaryMetrics;
  attentionInsights: AnalyticsInsight[];
  providerEvidence: { search: boolean; analytics: boolean };
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
  // current-month AI prompt is built only from this bounded read; lifetime workspace learnings are intentionally excluded
  // from an operational digest.
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

  const summary = await generateDigestSummary({
    month: monthLabel,
    wins,
    issues: issuesAddressed,
    roi: roiHighlights,
    metrics: { ...metrics, sessionsChange },
    attentionInsights,
    providerEvidence: {
      search: gscResult.status === 'fulfilled',
      analytics: ga4Result.status === 'fulfilled',
    },
  }, ws.id);

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

function percentMetricClause(
  id: MonthlyDigestClauseId,
  label: string,
  value: number,
): DigestEvidenceClause {
  const magnitude = Math.abs(value);
  const sentence = value === 0
    ? 'No percentage change was recorded for ' + label.toLowerCase() + ' in the current reporting window.'
    : label + ' ' + (value > 0 ? 'increased' : 'decreased') + ' '
      + magnitude.toFixed(1) + '% in the current reporting window.';

  return {
    id,
    sentence,
    priority: 400 + Math.min(magnitude, 100),
  };
}

function searchPositionClause(value: number): DigestEvidenceClause {
  const magnitude = Math.abs(value);
  const sentence = value === 0
    ? 'Average search position recorded no change in the current reporting window.'
    : 'Average search position ' + (value > 0 ? 'improved' : 'worsened') + ' by '
      + magnitude.toFixed(1) + ' spot' + (magnitude === 1 ? '' : 's')
      + ' in the current reporting window.';

  return {
    id: MONTHLY_DIGEST_CLAUSE_IDS.SEARCH_POSITION,
    sentence,
    priority: 400 + Math.min(magnitude, 100),
  };
}

function workActivityClause(
  wins: DigestItem[],
  issues: DigestItem[],
): DigestEvidenceClause | null {
  let sentence: string | null = null;
  if (wins.length > 0 && issues.length > 0) {
    sentence = 'Your site picked up ' + wins.length + ' performance win'
      + (wins.length === 1 ? '' : 's') + ' this period, and ' + issues.length
      + ' optimization' + (issues.length === 1 ? ' was' : 's were') + ' completed.';
  } else if (wins.length > 0) {
    sentence = wins.length + ' performance win' + (wins.length === 1 ? '' : 's')
      + ' spotted on your site this period.';
  } else if (issues.length > 0) {
    sentence = issues.length + ' optimization' + (issues.length === 1 ? ' was' : 's were')
      + ' completed this period.';
  }

  return sentence == null
    ? null
    : {
        id: MONTHLY_DIGEST_CLAUSE_IDS.WORK_ACTIVITY,
        sentence,
        priority: 600,
      };
}

function joinEvidencePhrases(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? '';
  if (phrases.length === 2) return phrases[0] + ', and ' + phrases[1];
  return phrases.slice(0, -1).join(', ') + ', and ' + phrases.at(-1);
}

function roiMeasuredResultsClause(roi: ROIHighlight[]): DigestEvidenceClause | null {
  if (roi.length === 0) return null;

  const platformCount = roi.filter(result => result.attribution === 'platform_executed').length;
  const externalCount = roi.filter(result => result.attribution === 'externally_executed').length;
  const unknownCount = roi.length - platformCount - externalCount;
  const totalAttributedValue = roi.reduce((total, result) => (
    typeof result.attributedValue === 'number'
      && Number.isFinite(result.attributedValue)
      && result.attributedValue > 0
      ? total + result.attributedValue
      : total
  ), 0);

  let sentence = roi.length + ' measured result' + (roi.length === 1 ? ' was' : 's were')
    + ' recorded';
  if (totalAttributedValue > 0) {
    sentence += ' with $' + totalAttributedValue.toFixed(2) + ' in total estimated value';
  }

  const attributionPhrases = [
    platformCount > 0
      ? platformCount + ' followed work implemented through the platform'
      : null,
    externalCount > 0
      ? externalCount + ' followed work implemented on the client side'
      : null,
    unknownCount > 0
      ? 'execution attribution is unavailable for ' + unknownCount
      : null,
  ].filter((phrase): phrase is string => phrase != null);

  if (attributionPhrases.length > 0) {
    sentence += '; ' + joinEvidencePhrases(attributionPhrases);
  }

  return {
    id: MONTHLY_DIGEST_CLAUSE_IDS.ROI_MEASURED_RESULTS,
    sentence: sentence + '.',
    priority: 700,
  };
}

function buildDigestEvidenceClauses(evidence: DigestClauseEvidence): DigestEvidenceClause[] {
  const clauses: DigestEvidenceClause[] = [{
    id: MONTHLY_DIGEST_CLAUSE_IDS.REPORTING_SCOPE,
    sentence: 'Current-month evidence for ' + evidence.month + ' is available for review.',
    priority: 0,
  }];

  if (evidence.providerEvidence.search) {
    if (Number.isFinite(evidence.metrics.clicksChange)) {
      clauses.push(percentMetricClause(
        MONTHLY_DIGEST_CLAUSE_IDS.SEARCH_CLICKS,
        'Search clicks',
        evidence.metrics.clicksChange,
      ));
    }
    if (Number.isFinite(evidence.metrics.impressionsChange)) {
      clauses.push(percentMetricClause(
        MONTHLY_DIGEST_CLAUSE_IDS.SEARCH_IMPRESSIONS,
        'Search impressions',
        evidence.metrics.impressionsChange,
      ));
    }
    if (Number.isFinite(evidence.metrics.avgPositionChange)) {
      clauses.push(searchPositionClause(evidence.metrics.avgPositionChange));
    }
  }

  if (evidence.providerEvidence.analytics) {
    if (evidence.metrics.sessionsChange != null && Number.isFinite(evidence.metrics.sessionsChange)) {
      clauses.push(percentMetricClause(
        MONTHLY_DIGEST_CLAUSE_IDS.ANALYTICS_SESSIONS,
        'Site sessions',
        evidence.metrics.sessionsChange,
      ));
    } else {
      clauses.push({
        id: MONTHLY_DIGEST_CLAUSE_IDS.ANALYTICS_AVAILABLE,
        sentence: 'Analytics comparison data is available for the current reporting window, but no site-session percentage change was reported.',
        priority: 300,
      });
    }
  }

  const workClause = workActivityClause(evidence.wins, evidence.issues);
  if (workClause) clauses.push(workClause);

  if (evidence.attentionInsights.length > 0) {
    const signalCount = evidence.attentionInsights.length;
    clauses.push({
      id: MONTHLY_DIGEST_CLAUSE_IDS.ATTENTION_SIGNALS,
      sentence: signalCount + ' current-month signal' + (signalCount === 1 ? '' : 's')
      + ' ' + (signalCount === 1 ? 'requires' : 'require')
        + ' attention.',
      priority: 500,
    });
  }

  const roiClause = roiMeasuredResultsClause(evidence.roi);
  if (roiClause) clauses.push(roiClause);

  return clauses;
}

function deterministicClauseSelection(clauses: DigestEvidenceClause[]): MonthlyDigestClauseId[] {
  return [...clauses]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, 3)
    .map(clause => clause.id);
}

function renderDigestClauses(
  clauseIds: readonly MonthlyDigestClauseId[],
  clauseMap: ReadonlyMap<MonthlyDigestClauseId, DigestEvidenceClause>,
): string {
  return clauseIds.map(clauseId => {
    const clause = clauseMap.get(clauseId);
    if (!clause) throw new Error('Monthly Digest selected an unavailable clause: ' + clauseId);
    return clause.sentence;
  }).join(' ');
}

async function generateDigestSummary(
  evidence: DigestClauseEvidence,
  workspaceId: string,
): Promise<string> {
  const clauses = buildDigestEvidenceClauses(evidence);
  const clauseMap = new Map(clauses.map(clause => [clause.id, clause]));
  const fallback = () => renderDigestClauses(
    deterministicClauseSelection(clauses),
    clauseMap,
  );
  const prompt = [
    'Select and order 2 or 3 evidence clauses for a website client Monthly Digest.',
    '',
    'Available clauses (these server-authored sentences are the only permitted facts and wording):',
    ...clauses.map(clause => '- ' + clause.id + ': ' + JSON.stringify(clause.sentence)),
    '',
    'Return exactly one JSON object with this shape:',
    '{"clauseIds":["available.id","available.id"]}',
    '',
    'Rules:',
    '- Select 2 or 3 unique IDs from the available list.',
    '- Order the IDs from the strongest lead to the best supporting evidence.',
    '- Do not write, rewrite, summarize, or add prose.',
    '- Do not return keys other than clauseIds.',
  ].join('\n');

  try {
    const result = await callAI({
      operation: 'monthly-digest',
      system: 'Select and order pre-approved Monthly Digest evidence clauses. Never author or modify prose. Return JSON only.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      temperature: 0,
      workspaceId,
    });
    const selectedClauseIds = parseMonthlyDigestClauseSelection(
      result.text,
      clauses.map(clause => clause.id),
    );
    return renderDigestClauses(selectedClauseIds, clauseMap);
  } catch (err) {
    log.warn({ err, workspaceId }, 'AI digest clause selection failed — using deterministic clause order');
    return fallback();
  }
}
