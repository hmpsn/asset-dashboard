import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type { KeywordCommandCenterResponse } from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS } from '../../../shared/types/local-seo.js';
import { assembleStoredKeywordStrategy } from '../../keyword-strategy-assembler.js';
import {
  buildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordVisibilityByKey,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  listLocalSeoMarkets,
} from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import { listPageKeywords, listPageKeywordsLite } from '../../page-keywords.js';
import { getLatestSnapshotRanks, getTrackedKeywords } from '../../rank-tracking.js';
import { getWorkspace } from '../../workspaces.js';
import { LOCAL_CANDIDATE_ROW_LIMIT, gateDiscoveryGaps } from './candidate-boundary.js';
import { readFeedback } from './feedback-store.js';
import {
  buildValueScoringConfig,
  ensureLocalVisibilityRows,
  finalizeDraftRows,
  populateDraftRows,
  safeLostVisibilityRows,
} from './read-model.js';
import { buildCounts, buildFilters } from './row-query.js';
import type { DraftRow } from './types.js';
import { mergeTrackedKeywordProvenance, withResolvedSiteKeywordMetrics } from './tracked-keyword-provenance.js';

const log = createLogger('keyword-command-center');

/**
 * Per-request value-scoring config. Built ONCE per request in the rows-build entry
 * points. Value-first scoring is always on (`on: true` via buildValueScoringConfig);
 * `ctx` carries the posture/markets/city/state captured once per request (never per
 * keyword). Non-scoring key-only paths (e.g. candidate-key enumeration) may pass
 * `{ on: false }` to skip the score. The SAME config (same `ctx`) is threaded into
 * both the candidate merge-back (Task 1.3) and the row finalize (Task 1.4), so the
 * two stages compute the identical valueScore per key by construction.
 */
export async function buildKeywordCommandCenterModel(
  workspaceId: string,
  options: {
    includeLocalSeo?: boolean;
    includeLocalSeoDetails?: boolean;
    includeLocalCandidates?: boolean;
    includeStrategyUx?: boolean;
    timingLabel?: string;
  } = {},
): Promise<KeywordCommandCenterResponse | null> {
  const startedAt = Date.now();
  const marks: Record<string, number> = {};
  const heap: Record<string, number> = {};
  const mark = (stage: string) => {
    marks[stage] = Date.now() - startedAt;
    heap[stage.replace(/Ms$/, 'HeapMb')] = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  };
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  // #19b: siteKeywordMetrics resolved table-first (blob fallback). siteKeywords/
  // generatedAt stay blob-sourced.
  const strategy = withResolvedSiteKeywordMetrics(workspace.id, workspace.keywordStrategy);
  const pageMap = options.includeStrategyUx === false
    ? listPageKeywordsLite(workspace.id)
    : listPageKeywords(workspace.id);
  // contentGaps + keywordGaps via the single assembler (#2). strategy stays the
  // raw blob (siteKeywords/generatedAt) with siteKeywordMetrics table-resolved
  // above, and pageMap keeps the Lite/full page_keywords path above — KCC only
  // needs the two gap arrays here.
  const assembled = assembleStoredKeywordStrategy(workspace.id);
  // Tier-1 + Tier-2 junk gate applied ONCE at the discovery source so the read
  // model (incl. the LOCAL_CANDIDATES filter) never surfaces a junk gap keyword.
  const { contentGaps, keywordGaps } = gateDiscoveryGaps({
    contentGaps: assembled?.contentGaps ?? [],
    keywordGaps: assembled?.keywordGaps ?? [],
  });
  // Wave 3d-i: getTrackedKeywords strips provenance; merge sourceGapKey back from
  // the provenance-bearing table read (KCC is admin-authed) so the tracking row can
  // expose it.
  // Wave 3d-ii: read the table-bearing shape (sourceGapKey + strategyOwned merged
  // back). Ownership/classification now reads strategyOwned directly — the read-time
  // inferTrackedKeywordSources call was RETIRED (the boot backfill still stamps legacy
  // UNKNOWN sources one-time). sourceKeysForRows + trackedKeywordMatchesFilter +
  // protectedReason all agree on this merged shape.
  const trackedKeywords = mergeTrackedKeywordProvenance(
    workspace.id,
    getTrackedKeywords(workspace.id, { includeInactive: true }),
  );
  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const feedback = readFeedback(workspace.id);
  const lostVisibilityRows = safeLostVisibilityRows(workspace.id);
  const lostVisibilityKeys = new Set(lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  mark('sourceLoadingMs');
  const localVisibilityByKeyword = options.includeLocalSeo
    ? options.includeLocalSeoDetails
      ? buildLocalSeoKeywordVisibilityByKey(workspace.id)
      : buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id)
    : new Map();
  // KCC row enrichment uses sourceLabel/detail/pagePath/pageTitle/volume/difficulty.
  // `reasons` and the evaluator's suppression are not needed — cheap default is correct.
  const localCandidates = options.includeLocalSeo && options.includeLocalCandidates === true
    ? (() => {
        // Sort unselected candidates first so the slice doesn't exhaust its budget on
        // strategy/tracking-sourced entries (which are already IN_STRATEGY or TRACKED and
        // therefore get lifecycle=SELECTED).  The "Local Candidates" filter only matches
        // lifecycle=CANDIDATE, so without this reorder the filter returns 0 rows even
        // when hundreds of local_variant / content_gap candidates exist further down the
        // score-sorted list.  Within each group the original score order is preserved.
        const all = buildLocalSeoKeywordCandidates(workspace.id);
        const sorted = [
          ...all.filter(c => !c.selected),
          ...all.filter(c => c.selected),
        ];
        // Task 3 OOM EXCEPTION: the universe-full flag does NOT lift this cap.
        // localCandidates feed the LOCAL_CANDIDATES filter, which takes the MODEL
        // path (buildKeywordCommandCenterModel → full per-row evaluation, not the
        // page-bounded skinny path). Lifting this to UNIVERSE_SAFETY_CEILING would
        // force thousands of full row evaluations into memory at once (the exact
        // OOM regression docs/rules/keyword-command-center.md guards against), so it
        // stays at LOCAL_CANDIDATE_ROW_LIMIT regardless of the flag.
        return sorted.slice(0, LOCAL_CANDIDATE_ROW_LIMIT);
      })()
    : [];
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  mark('localSeoMs');
  const rows = new Map<string, DraftRow>();
  await populateDraftRows(rows, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    strategy,
    pageMap,
    contentGaps,
    keywordGaps,
    trackedKeywords,
    latestRanks,
    feedback,
    localCandidates,
    lostVisibilityRows,
    includeStrategyUx: options.includeStrategyUx,
  });
  ensureLocalVisibilityRows(rows, localVisibilityByKeyword);
  mark('strategyUxMs');
  const finalized = finalizeDraftRows(rows, {
    workspaceId: workspace.id,
    localVisibilityByKeyword,
    activeLocalMarketCount,
    lostVisibilityKeys,
    // Phase 1: precompute row valueScore in finalize when the flag is ON (no DB
    // reads when OFF). The model path's row sort selects the accessor by the same flag.
    valueScoring: buildValueScoringConfig(workspace),
  });
  const finalRows = finalized.rows;
  mark('rowIndexMs');

  log.info({
    workspaceId,
    mode: options.timingLabel ?? 'full',
    rowCount: finalRows.length,
    rawEvidenceTotal: finalized.rawEvidenceTotal,
    rawEvidenceReturned: finalized.rawEvidenceReturned,
    ...marks,
    ...heap,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center read model built');

  return {
    rows: finalRows,
    counts: buildCounts(finalRows),
    filters: buildFilters(finalRows),
    rawEvidenceTotal: finalized.rawEvidenceTotal,
    rawEvidenceReturned: finalized.rawEvidenceReturned,
    generatedAt: strategy?.generatedAt ?? null,
  };
}
