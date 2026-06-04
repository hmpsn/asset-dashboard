/**
 * keyword-strategy-assembler — the single read-path assembler (#2).
 *
 * @reads workspaces (keyword_strategy blob), page_keywords, content_gaps,
 *        quick_wins, keyword_gaps, topic_clusters, cannibalization_issues
 *
 * Collapses the five historically-divergent keyword-strategy read paths onto
 * ONE function with ONE fallback policy:
 *
 *   **table-as-truth, with a per-array table-or-blob fallback**
 *     fromTable.length > 0 ? fromTable : (blobArray ?? [])
 *
 * The fallback is load-bearing for legacy un-migrated workspaces whose data
 * still lives only in the blob — the persist write path strips the six
 * table-backed arrays from the blob (table-as-truth on WRITE), so any workspace
 * re-generated since the strip PRs has an empty blob array and the fallback is a
 * no-op. The fallback is removed only in the later forced-strip PRs, never here.
 *
 * `pageMap` is table-only (no blob fallback): the blob never carries pageMap —
 * it is stripped before storage and only ever exists at the route layer. This
 * matches the existing read paths, all of which read pageMap from the table.
 *
 * Returns the FULL internal shape (`StoredKeywordStrategy`). The public
 * client-safe whitelist projection, `strategyUx`, and `computeOpportunityScore`
 * defaults stay in the route layer — they are NOT applied here.
 *
 * Returns `null` only on the existing short-circuit: no strategy blob AND every
 * table empty (matches keyword-strategy.ts:227 / public-content.ts:149-158).
 */
import { getWorkspace } from './workspaces.js';
import { listPageKeywords } from './page-keywords.js';
import { listContentGaps } from './content-gaps.js';
import { listQuickWins } from './quick-wins.js';
import { listKeywordGaps } from './keyword-gaps.js';
import { listTopicClusters } from './topic-clusters.js';
import { listCannibalizationIssues } from './cannibalization-issues.js';
import type { StoredKeywordStrategy } from '../shared/types/keyword-strategy.js';

/** table-as-truth with a table-or-blob fallback (kept until the forced-strip PR). */
function tableOrBlob<T>(fromTable: T[], blobArray: T[] | undefined): T[] {
  return fromTable.length > 0 ? fromTable : (blobArray ?? []);
}

export function assembleStoredKeywordStrategy(workspaceId: string): StoredKeywordStrategy | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;
  const strategy = ws.keywordStrategy;

  // pageMap is table-only (the blob never carries it — stripped before storage).
  const pageMap = listPageKeywords(workspaceId);
  // The five normalized arrays: table-as-truth, blob fallback for legacy workspaces.
  const contentGaps = tableOrBlob(listContentGaps(workspaceId), strategy?.contentGaps);
  const quickWins = tableOrBlob(listQuickWins(workspaceId), strategy?.quickWins);
  const keywordGaps = tableOrBlob(listKeywordGaps(workspaceId), strategy?.keywordGaps);
  const topicClusters = tableOrBlob(listTopicClusters(workspaceId), strategy?.topicClusters);
  const cannibalization = tableOrBlob(listCannibalizationIssues(workspaceId), strategy?.cannibalization);

  // Existing short-circuit: nothing in the blob and every table empty → null.
  if (
    !strategy
    && pageMap.length === 0
    && contentGaps.length === 0
    && quickWins.length === 0
    && keywordGaps.length === 0
    && topicClusters.length === 0
    && cannibalization.length === 0
  ) {
    return null;
  }

  return {
    siteKeywords: strategy?.siteKeywords ?? [],
    opportunities: strategy?.opportunities ?? [],
    siteKeywordMetrics: strategy?.siteKeywordMetrics,
    pageMap,
    contentGaps,
    quickWins,
    keywordGaps,
    topicClusters,
    cannibalization,
    businessContext: strategy?.businessContext ?? '',
    seoDataMode: strategy?.seoDataMode,
    seoDataStatus: strategy?.seoDataStatus,
    searchSignals: strategy?.searchSignals,
    generatedAt: strategy?.generatedAt ?? null,
  };
}
