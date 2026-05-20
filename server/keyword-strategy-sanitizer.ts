import { createLogger } from './logger.js';
import { normalizePath } from './helpers.js';
import type { KeywordEvaluationContext } from './keyword-intelligence/index.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword } from './keyword-intelligence/index.js';
import { isTopicKeywordCoveredByPageMap, type KeywordStrategyCannibalizationIssue, type KeywordStrategyTopicCluster } from './keyword-strategy-enrichment.js';
import type { DomainKeyword, KeywordGapEntry } from './seo-data-provider.js';
import type { CompetitorKeywordData } from './keyword-strategy-seo-data.js';
import type {
  StrategyContentGap,
  StrategyOutput,
  StrategyPageMapEntry,
  KeywordStrategyKeywordPool,
} from './keyword-strategy-ai-synthesis.js';

const log = createLogger('keyword-strategy:sanitizer');

export interface SanitizeKeywordStrategyOptions {
  workspaceId: string;
  strategy: StrategyOutput;
  keywordPool: KeywordStrategyKeywordPool;
  evaluationContext: KeywordEvaluationContext;
  stage: 'post-synthesis' | 'post-enrichment';
}

export interface SanitizeKeywordStrategyDerivedArtifactsOptions {
  topicClusters: KeywordStrategyTopicCluster[];
  cannibalization: KeywordStrategyCannibalizationIssue[];
  pageMap: StrategyPageMapEntry[];
  keywordPool: KeywordStrategyKeywordPool;
  evaluationContext: KeywordEvaluationContext;
  domainKeywords: DomainKeyword[];
  competitorKeywords: CompetitorKeywordData[];
}

export interface SanitizeKeywordStrategyKeywordGapsOptions {
  keywordGaps: KeywordGapEntry[];
  keywordPool: KeywordStrategyKeywordPool;
  evaluationContext: KeywordEvaluationContext;
}

export interface SanitizeKeywordStrategyResult {
  strategy: StrategyOutput;
  removed: {
    pageMappings: Array<{ pagePath: string; keyword: string; reason: string }>;
    siteKeywords: string[];
    contentGaps: string[];
    quickWins: string[];
    secondaryKeywords: string[];
  };
  repaired: Array<{ pagePath: string; from: string; to: string; source: string }>;
  updatedPagePaths: string[];
}

interface KeywordCheck {
  ok: boolean;
  normalized: string;
  reason: string;
}

function checkKeyword(
  keyword: string | undefined,
  source: string,
  keywordPool: KeywordStrategyKeywordPool,
  evaluationContext: KeywordEvaluationContext,
): KeywordCheck {
  const normalized = normalizeKeyword(keyword ?? '');
  if (!normalized) return { ok: false, normalized, reason: 'blank_keyword' };
  const poolMatch = keywordPool.get(normalized);
  const evaluation = isStrategyPoolEligibleKeyword({
    keyword: keyword ?? '',
    volume: poolMatch?.volume ?? 0,
    difficulty: poolMatch?.difficulty ?? 0,
    source: poolMatch?.source ?? source,
  }, evaluationContext);
  if (evaluation.suppressed) {
    const reason = evaluation.reasons.find(item => item.weight < 0)?.type ?? 'suppressed_by_keyword_intelligence';
    return { ok: false, normalized, reason };
  }
  return { ok: true, normalized, reason: 'accepted' };
}

function pageIdentityFallback(page: StrategyPageMapEntry): string | null {
  const title = page.pageTitle?.trim();
  const pathPhrase = page.pagePath?.split('/').filter(Boolean).join(' ');
  const fallback = normalizeKeyword(title || pathPhrase || '');
  return fallback || null;
}

function candidateFallbacks(page: StrategyPageMapEntry, stage: SanitizeKeywordStrategyOptions['stage']): Array<{ keyword: string; source: string }> {
  const identityFallback = stage === 'post-enrichment' ? pageIdentityFallback(page) : null;
  return [
    ...(page.secondaryKeywords ?? []).map(keyword => ({ keyword, source: 'secondary_keyword' })),
    ...[...(page.urlLevelKeywords ?? [])]
      .sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0) || b.volume - a.volume)
      .map(item => ({ keyword: item.keyword, source: 'url_level_keyword' })),
    ...[...(page.gscKeywords ?? [])]
      .sort((a, b) => b.impressions - a.impressions)
      .map(item => ({ keyword: item.query, source: 'gsc_keyword' })),
    ...(identityFallback ? [{ keyword: identityFallback, source: 'page_identity' }] : []),
  ];
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value.trim());
  }
  return out;
}

function sanitizePageMap(
  pageMap: StrategyPageMapEntry[],
  options: SanitizeKeywordStrategyOptions,
  result: SanitizeKeywordStrategyResult,
): StrategyPageMapEntry[] {
  const next: StrategyPageMapEntry[] = [];
  const seenPaths = new Set<string>();

  for (const page of pageMap) {
    const normalizedPagePath = page.pagePath ? normalizePath(page.pagePath) : '';
    if (!normalizedPagePath || seenPaths.has(normalizedPagePath)) continue;
    seenPaths.add(normalizedPagePath);

    const pageCopy: StrategyPageMapEntry = { ...page };
    const originalPrimary = pageCopy.primaryKeyword ?? '';
    const secondary: string[] = [];
    let pageUpdated = false;
    for (const keyword of pageCopy.secondaryKeywords ?? []) {
      const check = checkKeyword(keyword, 'secondary_keyword', options.keywordPool, options.evaluationContext);
      if (check.ok) secondary.push(keyword.trim());
      else {
        result.removed.secondaryKeywords.push(keyword);
        pageUpdated = true;
      }
    }
    pageCopy.secondaryKeywords = dedupeStrings(secondary);

    const primaryCheck = checkKeyword(pageCopy.primaryKeyword, 'page_primary_keyword', options.keywordPool, options.evaluationContext);
    if (!primaryCheck.ok) {
      const fallback = candidateFallbacks({ ...pageCopy, secondaryKeywords: pageCopy.secondaryKeywords }, options.stage)
        .find(candidate => checkKeyword(candidate.keyword, candidate.source, options.keywordPool, options.evaluationContext).ok);
      if (fallback) {
        pageCopy.primaryKeyword = fallback.keyword;
        pageCopy.validated = false;
        delete pageCopy.volume;
        delete pageCopy.difficulty;
        delete pageCopy.cpc;
        delete pageCopy.currentPosition;
        delete pageCopy.metricsSource;
        delete pageCopy.serpFeatures;
        delete pageCopy.serpTargeting;
        result.repaired.push({ pagePath: pageCopy.pagePath, from: originalPrimary, to: fallback.keyword, source: fallback.source });
        pageUpdated = true;
      } else if (options.stage === 'post-synthesis') {
        pageCopy.primaryKeyword = '';
        pageCopy.validated = false;
        delete pageCopy.volume;
        delete pageCopy.difficulty;
        delete pageCopy.cpc;
        delete pageCopy.currentPosition;
        delete pageCopy.metricsSource;
        delete pageCopy.serpFeatures;
        delete pageCopy.serpTargeting;
        pageUpdated = true;
      } else {
        result.removed.pageMappings.push({ pagePath: pageCopy.pagePath, keyword: originalPrimary, reason: primaryCheck.reason });
        continue;
      }
    }

    const primaryNormalized = normalizeKeyword(pageCopy.primaryKeyword);
    const beforeSecondaryCount = pageCopy.secondaryKeywords.length;
    pageCopy.secondaryKeywords = dedupeStrings(pageCopy.secondaryKeywords ?? [])
      .filter(keyword => normalizeKeyword(keyword) !== primaryNormalized);
    if (pageCopy.secondaryKeywords.length !== beforeSecondaryCount) pageUpdated = true;
    const secondarySet = new Set(pageCopy.secondaryKeywords.map(keyword => normalizeKeyword(keyword)));
    if (pageCopy.secondaryMetrics?.length) {
      const beforeMetricsCount = pageCopy.secondaryMetrics.length;
      pageCopy.secondaryMetrics = pageCopy.secondaryMetrics
        .filter(metric => secondarySet.has(normalizeKeyword(metric.keyword)));
      if (pageCopy.secondaryMetrics.length !== beforeMetricsCount) pageUpdated = true;
    }
    if (pageUpdated) result.updatedPagePaths.push(pageCopy.pagePath);
    next.push(pageCopy);
  }

  return next;
}

function sanitizeSiteKeywords(
  siteKeywords: string[] | undefined,
  pageMap: StrategyPageMapEntry[],
  options: SanitizeKeywordStrategyOptions,
  result: SanitizeKeywordStrategyResult,
): string[] {
  const kept: string[] = [];
  for (const keyword of siteKeywords ?? []) {
    const check = checkKeyword(keyword, 'site_keyword', options.keywordPool, options.evaluationContext);
    if (check.ok) kept.push(keyword.trim());
    else result.removed.siteKeywords.push(keyword);
  }

  if (kept.length > 0) return dedupeStrings(kept).slice(0, 15);

  return dedupeStrings(
    pageMap
      .map(page => page.primaryKeyword)
      .filter(keyword => checkKeyword(keyword, 'site_keyword_fallback', options.keywordPool, options.evaluationContext).ok),
  ).slice(0, 15);
}

function sanitizeContentGaps(
  contentGaps: StrategyContentGap[] | undefined,
  options: SanitizeKeywordStrategyOptions,
  result: SanitizeKeywordStrategyResult,
): StrategyContentGap[] {
  const seen = new Set<string>();
  const kept: StrategyContentGap[] = [];
  for (const gap of contentGaps ?? []) {
    const check = checkKeyword(gap.targetKeyword, 'content_gap', options.keywordPool, options.evaluationContext);
    if (!check.ok) {
      result.removed.contentGaps.push(gap.targetKeyword ?? '');
      continue;
    }
    if (seen.has(check.normalized)) continue;
    seen.add(check.normalized);
    kept.push({ ...gap, targetKeyword: gap.targetKeyword.trim() });
  }
  return kept;
}

function sanitizeQuickWins(
  quickWins: StrategyOutput['quickWins'] | undefined,
  pageMap: StrategyPageMapEntry[],
  result: SanitizeKeywordStrategyResult,
): StrategyOutput['quickWins'] {
  const survivingPagePaths = new Set(pageMap.map(page => normalizePath(page.pagePath)));
  return (quickWins ?? []).filter((quickWin) => {
    if (survivingPagePaths.has(normalizePath(quickWin.pagePath))) return true;
    result.removed.quickWins.push(quickWin.pagePath);
    return false;
  });
}

export function sanitizeKeywordStrategyOutput(options: SanitizeKeywordStrategyOptions): SanitizeKeywordStrategyResult {
  const result: SanitizeKeywordStrategyResult = {
    strategy: { ...options.strategy },
    removed: { pageMappings: [], siteKeywords: [], contentGaps: [], quickWins: [], secondaryKeywords: [] },
    repaired: [],
    updatedPagePaths: [],
  };

  const pageMap = sanitizePageMap(options.strategy.pageMap ?? [], options, result);
  result.strategy = {
    ...options.strategy,
    pageMap,
    siteKeywords: sanitizeSiteKeywords(options.strategy.siteKeywords, pageMap, options, result),
    opportunities: dedupeStrings(options.strategy.opportunities ?? []),
    contentGaps: sanitizeContentGaps(options.strategy.contentGaps, options, result),
    quickWins: sanitizeQuickWins(options.strategy.quickWins, pageMap, result),
  };

  const removedCount = result.removed.pageMappings.length
    + result.removed.siteKeywords.length
    + result.removed.contentGaps.length
    + result.removed.quickWins.length
    + result.removed.secondaryKeywords.length;
  if (removedCount > 0 || result.repaired.length > 0) {
    log.info({
      workspaceId: options.workspaceId,
      stage: options.stage,
      removed: {
        pageMappings: result.removed.pageMappings.length,
        siteKeywords: result.removed.siteKeywords.length,
        contentGaps: result.removed.contentGaps.length,
        quickWins: result.removed.quickWins.length,
        secondaryKeywords: result.removed.secondaryKeywords.length,
      },
      repaired: result.repaired.length,
    }, 'Sanitized keyword strategy output through shared keyword intelligence');
  }

  return result;
}

export function sanitizeKeywordStrategyDerivedArtifacts(
  options: SanitizeKeywordStrategyDerivedArtifactsOptions,
): { topicClusters: KeywordStrategyTopicCluster[]; cannibalization: KeywordStrategyCannibalizationIssue[] } {
  const allowed = (keyword: string | undefined, source: string): boolean =>
    checkKeyword(keyword, source, options.keywordPool, options.evaluationContext).ok;

  const domainByKeyword = new Map(options.domainKeywords.map(keyword => [normalizeKeyword(keyword.keyword), keyword])); // map-dup-ok
  const ownedRankingKeywords = new Set(domainByKeyword.keys());
  const topicClusters: KeywordStrategyTopicCluster[] = [];

  for (const cluster of options.topicClusters) {
    const keywords = dedupeStrings(cluster.keywords)
      .map(keyword => normalizeKeyword(keyword))
      .filter(keyword => allowed(keyword, 'topic_cluster'));
    if (keywords.length < 3) continue;

    const owned = keywords.filter(keyword =>
      ownedRankingKeywords.has(keyword) || isTopicKeywordCoveredByPageMap(keyword, options.pageMap)
    );
    const gap = keywords.filter(keyword => !owned.includes(keyword));
    const positions = owned
      .map(keyword => domainByKeyword.get(keyword)?.position)
      .filter((position): position is number => typeof position === 'number');

    let topCompetitor: string | undefined;
    let topCompetitorCoverage: number | undefined;
    if (options.competitorKeywords.length > 0) {
      const competitorCoverage = new Map<string, number>();
      for (const competitorKeyword of options.competitorKeywords) {
        if (keywords.includes(normalizeKeyword(competitorKeyword.keyword))) {
          competitorCoverage.set(competitorKeyword.domain, (competitorCoverage.get(competitorKeyword.domain) ?? 0) + 1);
        }
      }
      const best = [...competitorCoverage.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > owned.length) {
        topCompetitor = best[0];
        topCompetitorCoverage = Math.round((best[1] / keywords.length) * 100);
      }
    }

    topicClusters.push({
      ...cluster,
      keywords,
      ownedCount: owned.length,
      totalCount: keywords.length,
      coveragePercent: Math.round((owned.length / keywords.length) * 100),
      avgPosition: positions.length > 0
        ? Math.round(positions.reduce((sum, position) => sum + position, 0) / positions.length)
        : undefined,
      topCompetitor,
      topCompetitorCoverage,
      gap,
    });
  }

  return {
    topicClusters: topicClusters.sort((a, b) => a.coveragePercent - b.coveragePercent),
    cannibalization: options.cannibalization.filter(issue => allowed(issue.keyword, 'cannibalization_issue')),
  };
}

export function sanitizeKeywordStrategyKeywordGaps(
  options: SanitizeKeywordStrategyKeywordGapsOptions,
): KeywordGapEntry[] {
  return options.keywordGaps.filter(gap =>
    checkKeyword(gap.keyword, `keyword_gap:${gap.competitorDomain}`, options.keywordPool, options.evaluationContext).ok
  );
}
