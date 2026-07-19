import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_VISIBILITY_POSTURE } from '../../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS } from '../../../shared/types/rank-tracking.js';
import { isSuspiciousPlannerGroupedVolume } from '../../keyword-strategy-helpers.js';
import { createLogger } from '../../logger.js';
import {
  UNIVERSE_SAFETY_CEILING,
  selectRankEvidence,
  trackedKeywordMatchesFilter,
} from './candidate-boundary.js';
import {
  buildFilterFacetsFromCounts,
  type SkinnyFilterCounts,
} from './row-query.js';
import {
  buildKeywordCommandCenterSourceSnapshot,
  type KeywordCommandCenterSourceSnapshot,
} from './source-snapshot.js';

const log = createLogger('keyword-command-center');

export async function buildKeywordCommandCenterSummary(
  workspaceId: string,
  options: { includeLocalSeo?: boolean; sourceSnapshot?: KeywordCommandCenterSourceSnapshot } = {},
): Promise<KeywordCommandCenterSummaryResponse | null> {
  const startedAt = Date.now();
  const snapshot = options.sourceSnapshot ?? buildKeywordCommandCenterSourceSnapshot(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeSummary: true,
  });
  if (!snapshot) return null;
  const { workspace } = snapshot;

  const allKeys = new Set<string>();
  const inStrategyKeys = new Set<string>();
  const pageAssignedKeys = new Set<string>();
  const contentKeys = new Set<string>();
  const rawEvidenceKeys = new Set<string>();
  const keysWithVolume = new Set<string>();
  const addKey = (target: Set<string>, keyword: string | undefined) => {
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    target.add(key);
    allKeys.add(key);
  };
  const markVolume = (keyword: string | undefined, volume: number | undefined | null) => {
    if (volume == null || volume <= 0) return;
    if (isSuspiciousPlannerGroupedVolume(keyword, volume)) return;
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    keysWithVolume.add(key);
  };

  const summaryStrategy = snapshot.strategy;
  for (const metric of summaryStrategy?.siteKeywordMetrics ?? []) {
    addKey(inStrategyKeys, metric.keyword);
    markVolume(metric.keyword, metric.volume);
  }
  for (const keyword of summaryStrategy?.siteKeywords ?? []) addKey(inStrategyKeys, keyword);

  for (const page of snapshot.pageMap) {
    addKey(pageAssignedKeys, page.primaryKeyword);
    addKey(inStrategyKeys, page.primaryKeyword);
    markVolume(page.primaryKeyword, page.volume);
    for (const secondary of page.secondaryKeywords ?? []) {
      addKey(pageAssignedKeys, secondary);
      addKey(inStrategyKeys, secondary);
    }
  }

  const { contentGaps, keywordGaps } = snapshot;
  for (const gap of contentGaps) {
    addKey(contentKeys, gap.targetKeyword);
    addKey(inStrategyKeys, gap.targetKeyword);
    markVolume(gap.targetKeyword, gap.volume);
  }

  for (const gap of keywordGaps) {
    addKey(rawEvidenceKeys, gap.keyword);
    markVolume(gap.keyword, gap.volume);
  }

  const feedback = snapshot.feedback;
  const trackedKeywords = snapshot.trackedKeywords;
  for (const tracked of trackedKeywords) {
    addKey(allKeys, tracked.query);
    markVolume(tracked.query, tracked.volume);
  }
  const trackedKeys = new Set(trackedKeywords.map(keyword => keywordComparisonKey(keyword.query)).filter(Boolean));

  for (const tracked of trackedKeywords) {
    if (trackedKeywordMatchesFilter(tracked, KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY)) {
      addKey(inStrategyKeys, tracked.query);
    }
  }

  for (const row of feedback.values()) addKey(allKeys, row.keyword);
  const feedbackKeys = new Set([...feedback.keys()]);

  for (const row of feedback.values()) {
    if (row.status === 'approved') addKey(inStrategyKeys, row.keyword);
  }
  for (const row of feedback.values()) {
    if (row.status === 'declined' || row.status === 'requested') {
      const key = keywordComparisonKey(row.keyword);
      if (key) inStrategyKeys.delete(key);
    }
  }

  const latestRanks = snapshot.latestRanks;
  const lostVisibilityRows = snapshot.lostVisibilityRows;
  const lostVisibilityCount = snapshot.lostVisibilityCount;
  const lostVisibilityKeys = new Set(lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  for (const key of lostVisibilityKeys) allKeys.add(key);
  const rankEvidenceKeys = new Set<string>();
  const rankEvidenceFiltered = latestRanks.filter(
    rank => !allKeys.has(keywordComparisonKey(rank.query)),
  );
  const rankEvidence = selectRankEvidence(rankEvidenceFiltered, workspace.id);
  for (const rank of rankEvidence.selected) {
    addKey(rankEvidenceKeys, rank.query);
  }
  const rankEvidenceTotal = rankEvidence.total;

  const strikingDistanceKeys = new Set<string>();
  for (const rank of latestRanks) {
    if (rank.position >= 11 && rank.position <= 20) {
      const key = keywordComparisonKey(rank.query);
      if (key) strikingDistanceKeys.add(key);
    }
  }
  for (const tracked of trackedKeywords) {
    const pos = tracked.baselinePosition;
    if (pos != null && pos >= 11 && pos <= 20) {
      const key = keywordComparisonKey(tracked.query);
      if (key) strikingDistanceKeys.add(key);
    }
  }
  const strikingDistanceCount = strikingDistanceKeys.size;

  const activeTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
  const inactiveTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE);
  const requested = [...feedback.values()].filter(row => row.status === 'requested');
  const declined = [...feedback.values()].filter(row => row.status === 'declined');
  const rawEvidenceOnlyKeys = new Set(
    [...rawEvidenceKeys].filter(key =>
      !inStrategyKeys.has(key)
      && !trackedKeys.has(key)
      && !feedbackKeys.has(key)
    ),
  );
  const localVisibility = options.includeLocalSeo ? snapshot.localVisibilityByKeyword ?? new Map() : new Map();
  for (const key of localVisibility.keys()) allKeys.add(key);
  const localVisibilityValues = [...localVisibility.values()];

  const localCandidatesCount = options.includeLocalSeo ? snapshot.localCandidatesCount ?? 0 : 0;

  const missingVolume = Math.max(0, allKeys.size - keysWithVolume.size);

  const counts: KeywordCommandCenterCounts = {
    total: allKeys.size,
    inStrategy: inStrategyKeys.size,
    tracked: activeTracked.length,
    needsReview: requested.length + rankEvidenceKeys.size,
    evidence: rawEvidenceOnlyKeys.size,
    local: localVisibility.size,
    localCandidates: localCandidatesCount,
    retired: inactiveTracked.length,
    declined: declined.length,
    strikingDistance: strikingDistanceCount,
    missingVolume,
    lostVisibility: lostVisibilityCount,
  };
  const filterCounts: SkinnyFilterCounts = {
    all: counts.total,
    inStrategy: counts.inStrategy,
    tracked: counts.tracked,
    needsReview: counts.needsReview,
    content: contentKeys.size,
    pageAssigned: pageAssignedKeys.size,
    rawEvidence: counts.evidence,
    local: counts.local,
    localCandidates: localCandidatesCount,
    strikingDistance: strikingDistanceCount,
    visibleLocally: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length,
    possibleMatch: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length,
    notVisible: localVisibilityValues.filter(item =>
      item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ).length,
    notChecked: 0,
    providerDegraded: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length,
    requested: requested.length,
    declined: declined.length,
    retired: inactiveTracked.length,
    lostVisibility: lostVisibilityCount,
  };

  log.info({
    workspaceId,
    mode: 'summary-skinny',
    totalKeys: counts.total,
    trackedCount: trackedKeywords.length,
    contentGapCount: contentGaps.length,
    keywordGapCount: keywordGaps.length,
    localVisibilityCount: localVisibility.size,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center summary built');

  const droppedRankEvidenceTail = Math.max(0, rankEvidenceTotal - rankEvidence.selected.length);
  const rawEvidenceReturnedCap = UNIVERSE_SAFETY_CEILING;

  return {
    counts,
    filters: buildFilterFacetsFromCounts(filterCounts),
    rawEvidenceTotal: rawEvidenceOnlyKeys.size + droppedRankEvidenceTail,
    rawEvidenceReturned: Math.min(counts.evidence, rawEvidenceReturnedCap),
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
    summarizedAt: new Date().toISOString(),
    geoLabel: snapshot.geoLabel,
    trafficValueMonthly: snapshot.trafficValueMonthly ?? null,
    rankKpis: snapshot.rankKpis,
    topicClusters: snapshot.topicClusters,
    cannibalization: snapshot.cannibalization,
    rankFreshness: snapshot.rankFreshness,
  };
}
