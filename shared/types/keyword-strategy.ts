// ── Assembled keyword-strategy read shape ───────────────────────────────────
//
// `StoredKeywordStrategy` is the single internal shape returned by
// `assembleStoredKeywordStrategy(workspaceId)` (server/keyword-strategy-assembler.ts).
// It collapses the five historically-divergent keyword-strategy read paths
// (admin GET, public GET, the four Keyword Command Center sites, and the
// seo-context intelligence slice) onto one assembler with one fallback policy.
//
// Authority: **table-as-truth, with a table-or-blob fallback per array** — the
// table value wins whenever the table has rows; otherwise the legacy blob array
// is used (so un-migrated legacy workspaces don't lose data before the later
// forced-strip PRs land). See the assembler module for the exact policy.
//
// This is the FULL internal shape. The public client-safe whitelist projection,
// `strategyUx`, and `computeOpportunityScore` defaults stay in the route layer
// — they are NOT applied here.
import type {
  KeywordStrategy,
  PageKeywordMap,
  ContentGap,
  QuickWin,
  KeywordGapItem,
  TopicCluster,
  CannibalizationItem,
  SeoDataMode,
  SeoDataStatus,
} from './workspace.ts';

/** The per-keyword SEMRush metric shape. As of #19b (Wave 3b-i) this is backed
 *  by the `site_keyword_metrics` table (table-first, blob fallback); the blob
 *  array is still written and read as the fallback until the 3b-ii strip. */
export type SiteKeywordMetric = NonNullable<KeywordStrategy['siteKeywordMetrics']>[number];

export interface StoredKeywordStrategy {
  /** Top-level target keywords (blob-sourced). */
  siteKeywords: string[];
  /** Keyword gaps / untapped opportunities (blob-sourced). */
  opportunities: string[];
  /** SEMRush data for site keywords — `site_keyword_metrics` table (#19b),
   *  table-first with blob fallback (the blob is kept until the 3b-ii strip). */
  siteKeywordMetrics?: SiteKeywordMetric[];
  /** Per-page keyword assignments — `page_keywords` table (table-only, no blob fallback). */
  pageMap: PageKeywordMap[];
  /** Content gaps — `content_gaps` table, blob fallback. MUST carry all whitelisted
   *  fields incl. `backfilled` (the SEO-genquality P2 honesty flag). */
  contentGaps: ContentGap[];
  /** Low-effort high-impact fixes — `quick_wins` table, blob fallback. */
  quickWins: QuickWin[];
  /** Competitor keyword gaps — `keyword_gaps` table, blob fallback. */
  keywordGaps: KeywordGapItem[];
  /** Topical authority clusters — `topic_clusters` table, blob fallback. */
  topicClusters: TopicCluster[];
  /** Keyword cannibalization issues — `cannibalization_issues` table, blob fallback. */
  cannibalization: CannibalizationItem[];
  /** User-provided business context (blob-sourced). */
  businessContext: string;
  /** Which SEO provider enrichment mode was used (blob-sourced). */
  seoDataMode?: SeoDataMode;
  /** Whether provider grounding was available/degraded during generation (blob-sourced). */
  seoDataStatus?: SeoDataStatus;
  /** Enriched search signals stored alongside the strategy (blob-sourced). */
  searchSignals?: KeywordStrategy['searchSignals'];
  /** `null` when the strategy blob is absent but table rows synthesized the shell. */
  generatedAt: string | null;
}
