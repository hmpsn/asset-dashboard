import { keywordComparisonKey, findBestParent } from '../../../shared/keyword-normalization.js';
import {
  type KeywordCommandCenterMetrics,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSourceLabel,
} from '../../../shared/types/keyword-command-center.js';
import type { LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
} from '../../../shared/types/rank-tracking.js';
import type { Workspace } from '../../../shared/types/workspace.js';
import { getLostVisibilityCount, getLostVisibilityKeys, getLostVisibilityQueries } from '../../client-discovered-queries.js';
import { buildKeywordStrategyUxPayload } from '../../keyword-strategy-ux.js';
import { getLatestSerpSnapshots } from '../../serp-snapshots-store.js';
import { createLogger } from '../../logger.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import {
  computeKeywordValueScore,
  computeKeywordValueComponents,
  keywordValueReasons,
} from '../../scoring/keyword-value-score.js';
import { buildKeywordValueScoringContext } from '../../scoring/keyword-value-context.js';
import { keywordDollarValue } from '../../scoring/keyword-value-money.js';
import {
  UNIVERSE_SAFETY_CEILING,
  addCandidateKeysFromBundle,
  isTier1JunkKeyword,
  mergeMetricsInto,
  selectRankEvidence,
  type CandidateRowMetricParity,
  type CandidateRowMetricProjection,
  type RowCandidateKey,
} from './candidate-boundary.js';
import {
  buildLocalSeoState,
  buildNextActions,
  ensureRow,
  feedbackState,
  lifecycleStatus,
  protectedReason,
  setAssignment,
  sourceFromExplanation,
  sourceFromKeywordGap,
  statusLabel,
  trackingSourceDetail,
} from './row-lifecycle.js';
import {
  setKeywordCommandCenterRowValueScore,
  sortRows,
} from './row-query.js';
import type {
  CommandCenterSourceBundle,
  DraftRow,
  FinalizedRows,
  LostVisibilityQuery,
  RowFinalizeContext,
  ValueScoringConfig,
} from './types.js';

const log = createLogger('keyword-command-center');

/**
 * Build the per-request value-scoring config. Fetches posture + markets ONCE and
 * captures the business-profile city/state -- never per keyword. Value-first
 * scoring is always on (the `on` discriminator is retained so non-scoring paths
 * -- e.g. key-only candidate enumeration -- can still opt out with `{ on: false }`).
 */
export function buildValueScoringConfig(workspace: Workspace): ValueScoringConfig {
  return {
    on: true,
    ctx: buildKeywordValueScoringContext(workspace),
  };
}

function addSource(row: DraftRow, source: KeywordCommandCenterSourceLabel): void {
  if (row.sourceLabels.some(existing => existing.kind === source.kind && existing.label === source.label && existing.detail === source.detail)) return;
  row.sourceLabels.push(source);
}

function mergeMetrics(row: DraftRow, metrics: KeywordCommandCenterMetrics): void {
  row.metrics = mergeMetricsInto(row.keyword, row.metrics, metrics);
}

export function safeLostVisibilityKeys(workspaceId: string): Set<string> {
  try {
    return getLostVisibilityKeys(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility keys');
    return new Set<string>();
  }
}

export function safeLostVisibilityRows(workspaceId: string): LostVisibilityQuery[] {
  try {
    return getLostVisibilityQueries(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility rows');
    return [];
  }
}

export function safeLostVisibilityCount(workspaceId: string): number {
  try {
    return getLostVisibilityCount(workspaceId);
  } catch (err) {
    log.debug({ err, workspaceId }, 'discovered_queries unavailable while reading lost visibility count');
    return safeLostVisibilityRows(workspaceId).length;
  }
}

export async function populateDraftRows(rows: Map<string, DraftRow>, bundle: CommandCenterSourceBundle): Promise<void> {
  const strategy = bundle.strategy;

  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const row = ensureRow(rows, metric.keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
    mergeMetrics(row, { volume: metric.volume, difficulty: metric.difficulty });
  }

  for (const keyword of strategy?.siteKeywords ?? []) {
    const row = ensureRow(rows, keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
  }

  for (const page of bundle.pageMap) {
    const pageKeywords = [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].filter(Boolean);
    for (const keyword of pageKeywords) {
      const row = ensureRow(rows, keyword);
      if (!row) continue;
      setAssignment(row, {
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        role: 'page_keyword',
      });
      addSource(row, { kind: 'page_assignment', label: 'Page assignment', detail: page.pageTitle ?? page.pagePath });
      mergeMetrics(row, {
        volume: page.volume,
        difficulty: page.difficulty,
        cpc: page.cpc,
        intent: page.searchIntent,
      });
    }
  }

  for (const gap of bundle.contentGaps) {
    const row = ensureRow(rows, gap.targetKeyword);
    if (!row) continue;
    setAssignment(row, {
      pageTitle: gap.topic,
      role: 'content_gap',
    });
    addSource(row, { kind: 'content_gap', label: 'Content opportunity', detail: gap.topic });
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
      cpc: gap.cpc,
      intent: gap.intent,
    });
  }

  const strategyUx = bundle.includeStrategyUx === false
    ? null
    : await buildKeywordStrategyUxPayload({
      workspaceId: bundle.workspaceId,
      workspaceName: bundle.workspaceName,
      strategy: strategy ?? null,
      siteKeywordMetrics: strategy?.siteKeywordMetrics,
      pageMap: bundle.pageMap,
      contentGaps: bundle.contentGaps,
      keywordGaps: bundle.keywordGaps,
      surface: 'admin',
      trackedKeywords: bundle.trackedKeywords,
      includeWorkspaceIntelligence: bundle.includeWorkspaceIntelligence,
    });

  for (const explanation of strategyUx?.explanations ?? []) {
    const row = ensureRow(rows, explanation.keyword);
    if (!row) continue;
    row.explanation = explanation;
    row.rawEvidenceOnly = Boolean(explanation.rawEvidenceOnly);
    addSource(row, sourceFromExplanation(explanation));
    mergeMetrics(row, {
      volume: explanation.role === 'content_gap'
        ? bundle.contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.volume
        : undefined,
      difficulty: explanation.role === 'content_gap'
        ? bundle.contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.difficulty
        : undefined,
    });
  }

  for (const gap of bundle.keywordGaps) {
    const row = ensureRow(rows, gap.keyword);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? !row.explanation;
    addSource(row, sourceFromKeywordGap(gap));
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
    });
  }

  for (const keyword of bundle.trackedKeywords) {
    const row = ensureRow(rows, keyword.query);
    if (!row) continue;
    row.tracking = keyword;
    addSource(row, {
      kind: keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL ? 'manual' : 'tracking',
      label: 'Rank tracking',
      detail: trackingSourceDetail(keyword.source),
    });
    mergeMetrics(row, {
      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,
      intent: keyword.intent,
      currentPosition: keyword.baselinePosition,
      clicks: keyword.baselineClicks,
      impressions: keyword.baselineImpressions,
    });
  }

  for (const [normalized, row] of bundle.feedback) {
    const draft = ensureRow(rows, row.keyword);
    if (!draft) continue;
    draft.feedback = feedbackState(row);
    addSource(draft, {
      kind: row.status === 'requested' ? 'client_request' : 'feedback',
      label: row.status === 'requested' ? 'Requested keyword' : 'Keyword feedback',
      detail: row.status,
    });
    if (draft.normalizedKeyword !== normalized) rows.set(normalized, draft);
  }

  for (const lost of bundle.lostVisibilityRows ?? []) {
    const row = ensureRow(rows, lost.query);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? true;
    addSource(row, {
      kind: 'rank_data',
      label: 'Lost Search Console visibility',
      detail: `Last seen ${lost.lastSeen}`,
    });
    mergeMetrics(row, {
      currentPosition: lost.lastPosition ?? undefined,
      impressions: lost.totalImpressions,
    });
  }

  const strategyKeys = [...rows.entries()]
    .filter(([, row]) => row.rawEvidenceOnly !== true)
    .map(([key]) => key);
  const metricsMap = new Map(
    strategyKeys.map(key => [key, rows.get(key)?.metrics.impressions ?? 0]),
  );
  const variantParentMap = new Map<string, string>();
  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    if (!normalizedQuery || rows.has(normalizedQuery)) continue;
    const parent = findBestParent(normalizedQuery, strategyKeys, metricsMap);
    if (parent) variantParentMap.set(normalizedQuery, parent);
  }

  const rankedUntrackedFiltered = bundle.latestRanks
    .filter(rank => !rows.has(keywordComparisonKey(rank.query)))
    .filter(rank => !variantParentMap.has(keywordComparisonKey(rank.query)));
  const { selected: rankedUntracked } = selectRankEvidence(rankedUntrackedFiltered, bundle.workspaceId);
  for (const rank of rankedUntracked) {
    const row = ensureRow(rows, rank.query);
    if (!row) continue;
    row.rank = rank;
    addSource(row, { kind: 'rank_data', label: 'Search Console evidence', detail: 'Ranking query not currently selected' });
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  for (const rank of bundle.latestRanks) {
    const row = rows.get(keywordComparisonKey(rank.query));
    if (!row) continue;
    row.rank = rank;
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  if (isFeatureEnabled('national-serp-tracking', bundle.workspaceId)) {
    for (const snap of getLatestSerpSnapshots(bundle.workspaceId)) {
      const row = rows.get(keywordComparisonKey(snap.query));
      if (!row) continue;
      mergeMetrics(row, {
        nationalPosition: snap.position,
        matchedUrl: snap.matchedUrl,
        serpFeatures: snap.features,
        aiOverviewCited: snap.aiOverviewCited,
        aiOverviewPresent: snap.aiOverviewPresent,
      });
    }
  }

  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    const parentKey = variantParentMap.get(normalizedQuery);
    if (!parentKey) continue;
    const parentRow = rows.get(parentKey);
    if (!parentRow) continue;
    parentRow.variants = parentRow.variants ?? [];
    parentRow.variants.push(rank);
    parentRow.metrics.impressions = (parentRow.metrics.impressions ?? 0) + rank.impressions;
    parentRow.metrics.clicks = (parentRow.metrics.clicks ?? 0) + rank.clicks;
    if (
      parentRow.metrics.currentPosition == null
      || rank.position < parentRow.metrics.currentPosition
    ) {
      parentRow.metrics.currentPosition = rank.position;
    }
  }

  for (const candidate of bundle.localCandidates ?? []) {
    if (isTier1JunkKeyword(candidate.keyword)) continue;
    const row = ensureRow(rows, candidate.keyword);
    if (!row) continue;
    row.localCandidate = candidate;
    addSource(row, {
      kind: 'local_candidate',
      label: candidate.sourceLabel,
      detail: candidate.detail,
    });
    mergeMetrics(row, {
      volume: candidate.volume,
      difficulty: candidate.difficulty,
    });
  }
}

export function finalizeDraftRow(row: DraftRow, context: RowFinalizeContext): KeywordCommandCenterRow {
  const status = lifecycleStatus(row);
  const protection = protectedReason(row.tracking);
  const explanationRole = row.explanation?.role;
  const isProtected = Boolean(protection);
  const localSeo = context.localVisibilityByKeyword.get(row.normalizedKeyword);
  const localSeoState = buildLocalSeoState(row, status, localSeo, context.activeLocalMarketCount);
  const finalized: KeywordCommandCenterRow = {
    keyword: row.keyword,
    normalizedKeyword: row.normalizedKeyword,
    lifecycleStatus: status,
    statusLabel: statusLabel(status),
    sourceLabels: row.sourceLabels,
    metrics: row.metrics,
    assignment: row.explanation ? {
      pagePath: row.explanation.pagePath,
      pageTitle: row.explanation.pageTitle,
      role: explanationRole === 'competitor_gap' ? 'raw_evidence' : explanationRole,
    } : row.assignment ?? (row.localCandidate?.pagePath || row.localCandidate?.pageTitle ? {
      pagePath: row.localCandidate.pagePath,
      pageTitle: row.localCandidate.pageTitle,
      role: row.localCandidate.source === 'content_gap' ? 'content_gap' : 'page_keyword',
    } : undefined),
    feedback: row.feedback,
    tracking: row.tracking ? {
      status: row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      source: row.tracking.source,
      pinned: row.tracking.pinned,
      addedAt: row.tracking.addedAt,
      pagePath: row.tracking.pagePath,
      pageTitle: row.tracking.pageTitle,
      replacedBy: row.tracking.replacedBy,
      deprecatedAt: row.tracking.deprecatedAt,
      sourceGapKey: row.tracking.sourceGapKey,
      strategyOwned: row.tracking.strategyOwned,
      hasSignal: row.metrics.currentPosition != null
        || row.metrics.clicks != null
        || row.metrics.impressions != null,
    } : { status: 'not_tracked' },
    explanation: row.explanation,
    localSeo,
    localSeoState,
    nextActions: buildNextActions(row, status, isProtected, protection, localSeoState),
    isProtected,
    protectionReason: protection,
    rawEvidenceOnly: row.rawEvidenceOnly,
    variantCount: row.variants?.length ?? 0,
    variants: row.variants?.map(variant => ({
      query: variant.query,
      position: variant.position,
      clicks: variant.clicks,
      impressions: variant.impressions,
      ctr: variant.ctr,
    })),
    isLostVisibility: context.lostVisibilityKeys?.has(row.normalizedKeyword) ?? false,
  };

  if (context.valueScoring?.on && context.valueScoring.ctx) {
    const input = {
      keyword: finalized.keyword,
      volume: finalized.metrics.volume,
      impressions: finalized.metrics.impressions,
      difficulty: finalized.metrics.difficulty,
      cpc: finalized.metrics.cpc,
      intent: finalized.metrics.intent,
    };
    const { score, components } = computeKeywordValueComponents(input, context.valueScoring.ctx);
    if (score !== undefined) {
      setKeywordCommandCenterRowValueScore(finalized, score);
      finalized.opportunityScore = score;
    }
    if (components !== undefined) {
      finalized.valueReasons = keywordValueReasons(components, {
        cpc: finalized.metrics.cpc,
        volume: finalized.metrics.volume,
        difficulty: finalized.metrics.difficulty,
      });
    }
  }

  const hasRealizedSignal = finalized.metrics.clicks != null
    || finalized.metrics.impressions != null
    || finalized.metrics.currentPosition != null;
  if (finalized.metrics.cpc != null && finalized.metrics.cpc > 0 && hasRealizedSignal) {
    const money = keywordDollarValue({
      clicks: finalized.metrics.clicks,
      cpc: finalized.metrics.cpc,
      currentPosition: finalized.metrics.currentPosition,
      impressions: finalized.metrics.impressions,
      ctrCurve: null,
    });
    finalized.currentMonthly = money.currentMonthly;
    finalized.upsideMonthly = money.upsideMonthly;
  }
  return finalized;
}

export function finalizeDraftRows(rows: Map<string, DraftRow>, context: RowFinalizeContext): FinalizedRows {
  const rawEvidenceRows = [...rows.values()].filter(row => row.rawEvidenceOnly && !row.tracking && !row.feedback && !row.localCandidate);
  const allowedRawEvidence = new Set(
    rawEvidenceRows
      .sort((a, b) => (b.metrics.volume ?? 0) - (a.metrics.volume ?? 0))
      .slice(0, UNIVERSE_SAFETY_CEILING)
      .map(row => row.normalizedKeyword),
  );

  const finalRows = [...rows.values()]
    .filter(row => !row.rawEvidenceOnly || row.tracking || row.feedback || row.localCandidate || allowedRawEvidence.has(row.normalizedKeyword))
    .map(row => finalizeDraftRow(row, context))
    .sort(sortRows);

  return {
    rows: finalRows,
    rawEvidenceTotal: rawEvidenceRows.length,
    rawEvidenceReturned: allowedRawEvidence.size,
  };
}

export function ensureLocalVisibilityRows(
  rows: Map<string, DraftRow>,
  localVisibilityByKeyword: Map<string, LocalSeoKeywordVisibilitySummary>,
): void {
  for (const [normalizedKeyword, visibility] of localVisibilityByKeyword) {
    const row = ensureRow(rows, visibility.keyword);
    if (!row) continue;
    if (row.normalizedKeyword !== normalizedKeyword) rows.set(normalizedKeyword, row);
    addSource(row, {
      kind: 'local_visibility',
      label: 'Local visibility',
      detail: visibility.label,
    });
  }
}

export async function __candidateRowMetricParityForTest(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary> = new Map(),
): Promise<CandidateRowMetricParity> {
  const valueScoring: ValueScoringConfig = { on: true, ctx: { posture: 'non_local', markets: [] } };

  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, { ...bundle, includeStrategyUx: false }, localVisibility, valueScoring);
  const candidate = new Map<string, CandidateRowMetricProjection>();
  for (const c of candidates.values()) {
    candidate.set(c.key, { demand: c.demand, clicks: c.clicks, rank: c.rank, difficulty: c.difficulty, cpc: c.cpc, intent: c.intent, valueScore: c.valueScore });
  }

  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, { ...bundle, includeStrategyUx: false });
  ensureLocalVisibilityRows(rows, localVisibility);
  const row = new Map<string, CandidateRowMetricProjection>();
  for (const r of rows.values()) {
    const rowValue = valueScoring.ctx
      ? computeKeywordValueScore(
          {
            keyword: r.keyword,
            volume: r.metrics.volume,
            impressions: r.metrics.impressions,
            difficulty: r.metrics.difficulty,
            cpc: r.metrics.cpc,
            intent: r.metrics.intent,
          },
          valueScoring.ctx,
        )
      : undefined;
    row.set(r.normalizedKeyword, {
      demand: r.metrics.volume ?? r.metrics.impressions ?? 0,
      clicks: r.metrics.clicks,
      rank: r.metrics.currentPosition,
      difficulty: r.metrics.difficulty,
      cpc: r.metrics.cpc,
      intent: r.metrics.intent,
      valueScore: rowValue,
    });
  }
  return { candidate, row };
}
