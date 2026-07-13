// shared/types/keyword-universe.ts
//
// Typed cross-module contract for the keyword candidate universe produced by
// `server/keyword-strategy-universe.ts` (`buildKeywordUniverse`). This is the
// single source of the candidate pool consumed by keyword-strategy synthesis,
// and (in later phases) by MCP + UI. Defined BEFORE implementation per
// Data-Flow #5 — a typed contract, never an inline untyped key/value bag.
//
// Field names mirror the canonical pool contract (`KeywordPoolCandidate` at
// `server/keyword-strategy-helpers.ts`) so demand, CPC, intent, and fine-grained
// source provenance survive the fold that synthesis reads via `keywordPool.get(...)`.

/**
 * Canonical candidate-source values for the keyword universe.
 *
 * Data-Flow #5: a single const string-enum object imported by both the producer
 * (the assembler) and consumers — never raw string literals. Note these are the
 * COARSE universe-level source categories; the synthesis-side pool still uses
 * finer-grained source strings (e.g. `gap:competitor.com`, `competitor:x.com`,
 * `discovery:keyword_ideas`, the provider name) which `KeywordCandidate.source`
 * carries through verbatim so `keywordPoolSourcePriority` keeps working.
 */
export const KEYWORD_CANDIDATE_SOURCE = {
  GSC: 'gsc',
  PROVIDER_DISCOVERY: 'provider-discovery',
  RELATED: 'related',
  QUESTION: 'question',
  CLIENT_TRACKED: 'client-tracked',
  CLIENT_REQUESTED: 'client-requested',
  COMPETITOR_GAP: 'competitor-gap',
  DOMAIN: 'domain',
  /**
   * Local-intent candidates (stored local candidates + city/state/near-me variants)
   * folded into the universe when the caller resolves `includeLocal` true.
   * Sourced from STORED candidates via `buildLocalSeoKeywordCandidates` — never a
   * synchronous provider call in the strategy path.
   */
  LOCAL: 'local',
} as const;

export type KeywordCandidateSource =
  typeof KEYWORD_CANDIDATE_SOURCE[keyof typeof KEYWORD_CANDIDATE_SOURCE];

/**
 * A single keyword candidate in the universe.
 *
 * `source` is a free-form provenance string (carried verbatim from the existing
 * pool builder so the source-priority upsert in `upsertKeywordPoolCandidate`
 * keeps its semantics). The coarse {@link KeywordCandidateSource} categories are
 * what drive `sourceCounts`.
 */
export interface KeywordCandidate {
  keyword: string;
  /** Free-form provenance string (e.g. `gsc`, `gap:competitor.com`, `related`). */
  source: string;
  volume: number;
  difficulty: number;
  cpc?: number;
  intent?: string;
  /**
   * The local market this candidate was generated for, threaded verbatim from the
   * local SEO candidate engine. Set only on
   * market-scoped `local`-source candidates (city/state variants tied to a specific
   * market); market-agnostic local candidates and every non-local source leave this
   * `null`/undefined — never fabricate a market. Gives per-market relevance to the
   * local terms in the strategy pool.
   *
   * Plumbed for local SEO relevance; no current pool consumer reads it yet. The
   * closed-set prompt builder in `keyword-strategy-ai-synthesis.ts` reads only
   * keyword/volume/difficulty/requested/declined — `marketId` is write-only today.
   */
  marketId?: string | null;
  // ── P3 annotations (optional now; populated by the closed-set rewrite) ──
  declined?: boolean;
  requested?: boolean;
  voteWeight?: number;
  priority?: string;
}

/** Depth selector — repurposed from the legacy quick/full `seoDataMode`. */
export type KeywordUniverseCreditDepth = 'quick' | 'full';

/**
 * The assembled keyword universe for one workspace + geo/language.
 *
 * Consumed by keyword-strategy synthesis (which derives its canonical
 * `Map<normalizedKeyword, { volume; difficulty; source }>` from `candidates`)
 * and, in later phases, by MCP + UI.
 */
export interface KeywordUniverse {
  workspaceId: string;
  /** Resolved provider geo (DataForSEO location code; 2840/US fallback). */
  locationCode: number;
  /** Resolved provider language code (`'en'` fallback). */
  languageCode: string;
  candidates: KeywordCandidate[];
  /** Per coarse-source candidate counts (after admission + declined filter). */
  sourceCounts: Partial<Record<KeywordCandidateSource, number>>;
  /** Count of candidates removed by the declined/branded hard filters. */
  suppressedCount: number;
  /** Credit-depth the universe was built at. */
  creditDepth: KeywordUniverseCreditDepth;
}
