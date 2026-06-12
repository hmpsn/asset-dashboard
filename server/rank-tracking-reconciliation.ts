import {
  getLatestSnapshotRanks,
  updateTrackedKeywords,
  type RankEntry,
} from './rank-tracking.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
} from '../shared/types/rank-tracking.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { resolveSiteKeywordMetrics } from './site-keyword-metrics.js';
import { listTrackedKeywordRows } from './tracked-keywords-store.js';
import type { KeywordStrategy, PageKeywordMap } from '../shared/types/workspace.js';

export interface StrategyRankTrackingTarget {
  query: string;
  source: typeof TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY | typeof TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD;
  pagePath?: string;
  pageTitle?: string;
  intent?: string;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  currentPosition?: number;
  clicks?: number;
  impressions?: number;
}

export interface StrategyRankTrackingChangeSet {
  added: TrackedKeyword[];
  retained: TrackedKeyword[];
  reassigned: TrackedKeyword[];
  deprecated: TrackedKeyword[];
  replaced: TrackedKeyword[];
  manuallyPreserved: TrackedKeyword[];
  skipped: Array<{ query: string; reason: string }>;
}

export interface ReconcileStrategyRankTrackingOptions {
  workspaceId: string;
  // siteKeywordMetrics is no longer read off the blob (Wave 3b-ii strip) — the
  // reconcile join resolves volume/difficulty from the site_keyword_metrics table.
  keywordStrategy: Pick<KeywordStrategy, 'siteKeywords' | 'generatedAt'>;
  pageMap: PageKeywordMap[];
  generatedAt?: string;
}

function normalizeQuery(query: string | undefined): string {
  return keywordComparisonKey(query);
}

/**
 * Wave 3d-ii: ownership is read from the decoupled `strategyOwned` flag, NOT the
 * `source` enum. Only reconcile sets strategyOwned===true, and only a strategy
 * target establishes it — so a client-approved page_map/topic_cluster keyword (now
 * kept as CLIENT_REQUESTED, strategyOwned undefined) is no longer mistaken for a
 * strategy-owned keyword and force-deprecated. `false`/`undefined` are NOT owned.
 */
function isStrategyOwned(keyword: TrackedKeyword): boolean {
  return keyword.strategyOwned === true;
}

/**
 * Belt-and-suspenders protection guard for the auto-deprecation branch. Even when
 * strategyOwned===true, NEVER deprecate a pinned / client-requested / manual /
 * gap-provenanced keyword. The strategyOwned gate should already exclude these
 * (reconcile never sets strategyOwned on a client/gap approval), but this is the
 * second lock: client-requested data must survive every reconcile.
 */
function isProtected(keyword: TrackedKeyword): boolean {
  return Boolean(keyword.pinned)
    || keyword.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED
    || keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL
    || Boolean(keyword.sourceGapKey);
}

export function hasStrategyOwnedTrackedKeywords(workspaceId: string): boolean {
  // listTrackedKeywordRows (admin/table shape) carries strategyOwned — getTrackedKeywords
  // STRIPS it, so reading it there would always see undefined → always false.
  return listTrackedKeywordRows(workspaceId).some(isStrategyOwned);
}

function buildTargets(
  workspaceId: string,
  keywordStrategy: ReconcileStrategyRankTrackingOptions['keywordStrategy'],
  pageMap: PageKeywordMap[],
): { targets: Map<string, StrategyRankTrackingTarget>; skipped: StrategyRankTrackingChangeSet['skipped'] } {
  const targets = new Map<string, StrategyRankTrackingTarget>();
  const skipped: StrategyRankTrackingChangeSet['skipped'] = [];

  // #19b table-as-truth (Wave 3b-ii strip): join from the site_keyword_metrics
  // table, the sole store. The volume/difficulty baseline keeps attaching to
  // STRATEGY_SITE_KEYWORD targets through the table.
  const siteKeywordMetrics = resolveSiteKeywordMetrics(workspaceId);

  for (const keyword of keywordStrategy.siteKeywords ?? []) {
    const query = normalizeQuery(keyword);
    if (!query) {
      skipped.push({ query: keyword, reason: 'blank_site_keyword' });
      continue;
    }
    const metrics = siteKeywordMetrics.find(metric => normalizeQuery(metric.keyword) === query);
    targets.set(query, {
      query: keyword.trim(),
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
      volume: metrics?.volume,
      difficulty: metrics?.difficulty,
    });
  }

  for (const page of pageMap) {
    const query = normalizeQuery(page.primaryKeyword);
    if (!query) {
      skipped.push({ query: page.primaryKeyword ?? '', reason: 'blank_page_primary_keyword' });
      continue;
    }
    targets.set(query, {
      query: page.primaryKeyword.trim(),
      source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
      pagePath: page.pagePath,
      pageTitle: page.pageTitle,
      intent: (page as { intent?: string }).intent ?? page.searchIntent,
      volume: page.volume,
      difficulty: page.difficulty,
      cpc: page.cpc,
      currentPosition: page.currentPosition,
      clicks: page.clicks,
      impressions: page.impressions,
    });
  }

  return { targets, skipped };
}

function mergeTarget(
  existing: TrackedKeyword,
  target: StrategyRankTrackingTarget,
  generatedAt: string,
  latestRank?: RankEntry,
): TrackedKeyword {
  const existingSource = existing.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
  const isSiteKeyword = target.source === TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD;
  return {
    ...existing,
    query: existing.query,
    pinned: existing.pinned,
    // Wave 3d-ii STOP LAUNDERING: ownership is now carried by strategyOwned, NOT by
    // overwriting the source enum. Only adopt the strategy source when the existing
    // source is UNKNOWN (genuinely unprovenance'd) — a client-requested / gap / manual
    // keyword that is ALSO a current target KEEPS its real source (and stays protected)
    // while still being marked strategyOwned below.
    source: existingSource === TRACKED_KEYWORD_SOURCE.UNKNOWN ? target.source : existingSource,
    // This keyword matches a current strategy target → reconcile OWNS its lifecycle.
    // Reconcile is the sole writer of strategyOwned=true.
    strategyOwned: true,
    status: TRACKED_KEYWORD_STATUS.ACTIVE,
    // Site-level strategy keywords intentionally clear page ownership. Page
    // targets preserve existing context if the incoming target is sparse.
    pagePath: isSiteKeyword ? undefined : target.pagePath ?? existing.pagePath,
    pageTitle: isSiteKeyword ? undefined : target.pageTitle ?? existing.pageTitle,
    strategyGeneratedAt: existing.strategyGeneratedAt ?? generatedAt,
    lastStrategySeenAt: generatedAt,
    intent: target.intent ?? existing.intent,
    volume: target.volume ?? existing.volume,
    difficulty: target.difficulty ?? existing.difficulty,
    cpc: target.cpc ?? existing.cpc,
    baselinePosition: existing.baselinePosition ?? latestRank?.position ?? target.currentPosition,
    baselineClicks: existing.baselineClicks ?? latestRank?.clicks ?? target.clicks,
    baselineImpressions: existing.baselineImpressions ?? latestRank?.impressions ?? target.impressions,
    replacedBy: undefined,
    deprecatedAt: undefined,
  };
}

export function reconcileStrategyRankTracking(
  options: ReconcileStrategyRankTrackingOptions,
): StrategyRankTrackingChangeSet {
  const generatedAt = options.generatedAt ?? options.keywordStrategy.generatedAt ?? new Date().toISOString();
  const { targets, skipped } = buildTargets(options.workspaceId, options.keywordStrategy, options.pageMap);
  const targetsByPage = new Map<string, StrategyRankTrackingTarget>();
  for (const target of targets.values()) {
    if (target.pagePath && !targetsByPage.has(target.pagePath)) targetsByPage.set(target.pagePath, target);
  }

  const latestRanks = new Map(getLatestSnapshotRanks(options.workspaceId).map(rank => [normalizeQuery(rank.query), rank]));
  const changes: StrategyRankTrackingChangeSet = {
    added: [],
    retained: [],
    reassigned: [],
    deprecated: [],
    replaced: [],
    manuallyPreserved: [],
    skipped,
  };

  updateTrackedKeywords(options.workspaceId, (existingKeywords) => {
    const next: TrackedKeyword[] = [];
    const remainingTargets = new Map(targets);

    for (const existing of existingKeywords) {
      const query = normalizeQuery(existing.query);
      const target = remainingTargets.get(query);
      if (target) {
        const previousPagePath = existing.pagePath;
        const merged = mergeTarget(existing, target, generatedAt, latestRanks.get(query));
        next.push(merged);
        remainingTargets.delete(query);
        if (previousPagePath && target.pagePath && previousPagePath !== target.pagePath && isStrategyOwned(existing)) {
          changes.reassigned.push(merged);
        } else {
          changes.retained.push(merged);
        }
        continue;
      }

      const existingStatus = existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
      if (isStrategyOwned(existing) && existingStatus !== TRACKED_KEYWORD_STATUS.ACTIVE) {
        next.push(existing);
        continue;
      }

      // Wave 3d-ii: deprecate ONLY strategy-owned keywords (strategyOwned===true)
      // that are not protected. `!existing.pinned` is now subsumed by isProtected,
      // but kept explicit as the primary lock; isProtected adds the client/manual/gap
      // belt-and-suspenders so client-requested data can never be auto-deprecated.
      if (isStrategyOwned(existing) && !existing.pinned && !isProtected(existing)) {
        const replacement = existing.pagePath ? targetsByPage.get(existing.pagePath) : undefined;
        const removed: TrackedKeyword = {
          ...existing,
          status: replacement ? TRACKED_KEYWORD_STATUS.REPLACED : TRACKED_KEYWORD_STATUS.DEPRECATED,
          replacedBy: replacement?.query,
          lastStrategySeenAt: generatedAt,
          deprecatedAt: generatedAt,
        };
        next.push(removed);
        if (replacement) changes.replaced.push(removed);
        else changes.deprecated.push(removed);
        continue;
      }

      next.push(existing);
      changes.manuallyPreserved.push(existing);
    }

    for (const target of remainingTargets.values()) {
      const latestRank = latestRanks.get(target.query);
      const added: TrackedKeyword = {
        query: target.query,
        pinned: false,
        addedAt: generatedAt,
        source: target.source,
        // Wave 3d-ii: a keyword newly added FROM a current strategy target is owned by
        // reconcile. Reconcile is the sole writer of strategyOwned=true.
        strategyOwned: true,
        status: TRACKED_KEYWORD_STATUS.ACTIVE,
        pagePath: target.pagePath,
        pageTitle: target.pageTitle,
        strategyGeneratedAt: generatedAt,
        lastStrategySeenAt: generatedAt,
        intent: target.intent,
        volume: target.volume,
        difficulty: target.difficulty,
        cpc: target.cpc,
        baselinePosition: latestRank?.position ?? target.currentPosition,
        baselineClicks: latestRank?.clicks ?? target.clicks,
        baselineImpressions: latestRank?.impressions ?? target.impressions,
      };
      next.push(added);
      changes.added.push(added);
    }

    return next;
  });

  return changes;
}

export function summarizeStrategyRankTrackingChangeSet(changeSet: StrategyRankTrackingChangeSet): {
  added: number;
  retained: number;
  reassigned: number;
  deprecated: number;
  replaced: number;
  manuallyPreserved: number;
  skipped: number;
} {
  return {
    added: changeSet.added.length,
    retained: changeSet.retained.length,
    reassigned: changeSet.reassigned.length,
    deprecated: changeSet.deprecated.length,
    replaced: changeSet.replaced.length,
    manuallyPreserved: changeSet.manuallyPreserved.length,
    skipped: changeSet.skipped.length,
  };
}
