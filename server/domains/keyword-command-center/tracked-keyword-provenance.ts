import { keywordIdentityKeyV2 } from '../../../shared/keyword-normalization.js';
import type { TrackedKeywordIdentityMetadata } from '../../../shared/types/keyword-identity.js';
import { TRACKED_KEYWORD_SOURCE, type TrackedKeyword } from '../../../shared/types/rank-tracking.js';
import type { ContentGap, KeywordStrategy } from '../../../shared/types/workspace.js';
import { assembleStoredKeywordStrategy } from '../../keyword-strategy-assembler.js';
import { resolveSiteKeywordMetrics } from '../../site-keyword-metrics.js';
import { listTrackedKeywordRows } from '../../tracked-keywords-store.js';
import { getWorkspace } from '../../workspaces.js';
import { readFeedback } from './feedback-store.js';
import type { FeedbackRow } from './types.js';

export function withResolvedSiteKeywordMetrics(
  workspaceId: string,
  strategy: KeywordStrategy | null | undefined,
): KeywordStrategy | null | undefined {
  if (!strategy) return strategy;
  const resolved = resolveSiteKeywordMetrics(workspaceId);
  return { ...strategy, siteKeywordMetrics: resolved.length > 0 ? resolved : undefined };
}

/**
 * Infer the most likely tracking source when a tracked keyword's stored source is
 * UNKNOWN (typically a legacy migration artifact — pre-source-field rank_tracking_config
 * entries default to UNKNOWN via rank-tracking.ts:140). Cross-references the
 * workspace's current strategy + content gaps + feedback to recover provenance.
 *
 * Pure source stamping: returns updated keyword objects and leaves persistence to
 * the caller. Source ladder (most specific first):
 *   1. siteKeywordMetrics  → STRATEGY_PRIMARY (strategy explicitly produced metrics for it)
 *   2. siteKeywords        → STRATEGY_SITE_KEYWORD
 *   3. keyword_feedback (requested) → CLIENT_REQUESTED
 *   4. content_gaps        → CONTENT_GAP
 *   5. fallback            → original source (likely UNKNOWN)
 *
 * Applied by the legacy boot backfill so table rows are stamped once without
 * making KCC read paths infer source dynamically.
 */
export function inferTrackedKeywordSources(
  trackedKeywords: TrackedKeyword[],
  context: {
    strategy?: KeywordStrategy | null;
    contentGaps?: ContentGap[];
    feedback?: Map<string, FeedbackRow>;
  },
): TrackedKeyword[] {
  const siteKeywordMetricKeys = new Set(
    (context.strategy?.siteKeywordMetrics ?? [])
      .map(m => keywordIdentityKeyV2(m.keyword))
      .filter(Boolean),
  );
  const siteKeywordKeys = new Set(
    (context.strategy?.siteKeywords ?? [])
      .map(k => keywordIdentityKeyV2(k))
      .filter(Boolean),
  );
  const contentGapKeys = new Set(
    (context.contentGaps ?? [])
      .map(gap => keywordIdentityKeyV2(gap.targetKeyword))
      .filter(Boolean),
  );
  return trackedKeywords.map(keyword => {
    const existing = keyword.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
    if (existing !== TRACKED_KEYWORD_SOURCE.UNKNOWN) return keyword;
    const normalized = keywordIdentityKeyV2(keyword.query);
    if (!normalized) return keyword;
    if (siteKeywordMetricKeys.has(normalized)) return { ...keyword, source: TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY };
    if (siteKeywordKeys.has(normalized)) return { ...keyword, source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD };
    const fb = context.feedback?.get(keyword.query);
    if (fb?.status === 'requested') return { ...keyword, source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED };
    if (contentGapKeys.has(normalized)) return { ...keyword, source: TRACKED_KEYWORD_SOURCE.CONTENT_GAP };
    return keyword;
  });
}

/**
 * Wave 3d-i/3d-ii ADMIN exposure: getTrackedKeywords STRIPS the TABLE-ONLY fields
 * (sourceGapKey, strategyOwned) so the general/public read path stays byte-identical.
 * KCC is admin-authed, so it may use them — read from the table
 * (listTrackedKeywordRows, which uses rowToTrackedKeyword directly, NOT the stripping
 * resolver) and merge gap provenance + strategyOwned back onto tracked keywords
 * keyed by keywordComparisonKey. strategyOwned is REQUIRED here so KCC's IN_STRATEGY
 * classification sees real ownership instead of undefined -> false. sourceGapKeyV2
 * remains internal and is omitted by the explicit final KCC tracking DTO mapper.
 */
export function mergeTrackedKeywordProvenance(
  workspaceId: string,
  trackedKeywords: TrackedKeyword[],
): TrackedKeyword[] {
  if (trackedKeywords.length === 0) return trackedKeywords;
  const gapKeyByQuery = new Map<string, string>();
  const gapKeyV2ByQuery = new Map<string, string>();
  const ownedByQuery = new Map<string, boolean>();
  for (const row of listTrackedKeywordRows(workspaceId)) {
    const key = keywordIdentityKeyV2(row.query);
    if (row.sourceGapKey) gapKeyByQuery.set(key, row.sourceGapKey);
    if (row.sourceGapKeyV2) gapKeyV2ByQuery.set(key, row.sourceGapKeyV2);
    // `!== undefined` tri-state guard: `false` is a real value, not "absent".
    if (row.strategyOwned !== undefined) ownedByQuery.set(key, row.strategyOwned);
  }
  if (gapKeyByQuery.size === 0 && gapKeyV2ByQuery.size === 0 && ownedByQuery.size === 0) return trackedKeywords;
  return trackedKeywords.map(keyword => {
    const key = keywordIdentityKeyV2(keyword.query);
    const gapKey = gapKeyByQuery.get(key);
    const gapKeyV2 = gapKeyV2ByQuery.get(key);
    const owned = ownedByQuery.get(key);
    if (gapKey === undefined && gapKeyV2 === undefined && owned === undefined) return keyword;
    const next: TrackedKeyword & TrackedKeywordIdentityMetadata = { ...keyword };
    if (gapKey !== undefined) next.sourceGapKey = gapKey;
    // Internal-only: final KCC DTO construction deliberately does not serialize it.
    if (gapKeyV2 !== undefined) next.sourceGapKeyV2 = gapKeyV2;
    if (owned !== undefined) next.strategyOwned = owned;
    return next;
  });
}

/**
 * Assemble the same inference context the live KCC read paths build (strategy
 * blob with site_keyword_metrics resolved table-first, assembled contentGaps,
 * feedback map) and run the canonical inferTrackedKeywordSources ladder ONCE.
 */
export function inferTrackedKeywordSourcesForWorkspace(
  workspaceId: string,
  trackedKeywords: TrackedKeyword[],
): TrackedKeyword[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return trackedKeywords;
  const strategy = withResolvedSiteKeywordMetrics(workspaceId, workspace.keywordStrategy);
  const contentGaps = assembleStoredKeywordStrategy(workspaceId)?.contentGaps ?? [];
  const feedback = readFeedback(workspaceId);
  return inferTrackedKeywordSources(trackedKeywords, { strategy, contentGaps, feedback });
}
