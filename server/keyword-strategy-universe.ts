/**
 * keyword-strategy-universe — the single source of the keyword candidate pool.
 *
 * `buildKeywordUniverse(workspaceId, opts)` folds the entire inline pool-build
 * that previously lived in `keyword-strategy-ai-synthesis.ts` (domain rows, GSC
 * queries, competitor keywords, keyword gaps, provider discovery, related,
 * client-tracked, client-requested; branded + declined hard filters) AND owns
 * the provider discovery fetch (the `seoDataMode === 'full'` block that used to
 * live in `keyword-strategy-seo-data.ts`).
 *
 * It is the seam the assembler exists to create: one builder, geo + language
 * resolved once and threaded into every provider call, MCP-seedable, behind the
 * `seo-generation-quality` flag. The legacy two-builder path (synthesis-side
 * pool + `seoDataMode === 'full'` discovery) remains verbatim on the flag-OFF
 * path so flag-OFF is byte-identical to today (G3: kill the drift only on
 * flag-ON; never drop GSC/client candidates or skip the declined filter).
 *
 * The canonical store is an internal `Map<normalizedKeyword, KeywordPoolCandidate>`
 * (the shape synthesis already reads via `keywordPool.get(...)`); `candidates`
 * are derived from it for the typed {@link KeywordUniverse} contract.
 */
import { createLogger } from './logger.js';
import { isProgrammingError } from './errors.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { filterBrandedKeywords } from './competitor-brand-filter.js';
import { filterDeclinedFromPool } from './strategy-filters.js';
import { resolveWorkspaceLocationCode, resolveWorkspaceLanguageCode } from './local-seo.js';
import {
  upsertKeywordPoolCandidate,
  isStrategyQualityDiscoveryKeyword,
  type KeywordPoolCandidate,
} from './keyword-strategy-helpers.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword, type KeywordEvaluationContext } from './keyword-intelligence/index.js';
import type { SeoDataProvider, DomainKeyword, KeywordGapEntry, RelatedKeyword } from './seo-data-provider.js';
import type { CompetitorKeywordData, QuestionKeywordGroup } from './keyword-strategy-seo-data.js';
import type { KeywordSourceEvidence } from '../shared/types/keywords.js';
import {
  KEYWORD_CANDIDATE_SOURCE,
  type KeywordCandidate,
  type KeywordCandidateSource,
  type KeywordUniverse,
  type KeywordUniverseCreditDepth,
} from '../shared/types/keyword-universe.js';

const log = createLogger('keyword-strategy:universe');

export type KeywordStrategyKeywordPool = Map<string, KeywordPoolCandidate>;

// ── Per-workspace monthly provider-call ceiling (assembler-local) ─────────────
// The process-global `creditExhaustedUntil` breaker inside the DataForSEO
// provider is shared across all workspaces and must NOT be relied on for
// per-workspace cost bounding. This is an in-process per-workspace, per-month
// counter of provider discovery calls the assembler initiated. It is intentionally
// conservative + best-effort (resets on restart) — the real cost guard is still
// the provider cache; this just stops one workspace from spending unboundedly in
// a single month if it regenerates repeatedly.
const MONTHLY_PROVIDER_CALL_CEILING = 60;
const monthlyProviderCalls = new Map<string, { month: string; count: number }>();

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/** Returns true if the workspace still has provider-call budget this month, and reserves one call. */
function reserveProviderCall(workspaceId: string): boolean {
  const month = currentMonthKey();
  const entry = monthlyProviderCalls.get(workspaceId);
  if (!entry || entry.month !== month) {
    monthlyProviderCalls.set(workspaceId, { month, count: 1 });
    return true;
  }
  if (entry.count >= MONTHLY_PROVIDER_CALL_CEILING) return false;
  entry.count += 1;
  return true;
}

/** Test-only: reset the in-process monthly ceiling counter. */
export function __resetMonthlyProviderCallCeiling(workspaceId?: string): void {
  if (workspaceId) monthlyProviderCalls.delete(workspaceId);
  else monthlyProviderCalls.clear();
}

// ── Depth selector (repurposed quick/full) ────────────────────────────────────
interface DepthLimits {
  domainSeeds: number;
  siteKeywordSeeds: number;
  keywordsForSiteLimit: number;
  keywordIdeasLimit: number;
  suggestionSeeds: number;
  suggestionsLimit: number;
  relatedSeeds: number;
  relatedLimit: number;
  questionSeeds: number;
  questionsLimit: number;
}

function depthLimits(depth: KeywordUniverseCreditDepth): DepthLimits {
  // `full` mirrors the legacy seoDataMode === 'full' limits; `quick` is a
  // credit-conservative subset (fewer seeds + smaller per-call limits) — but,
  // unlike legacy, discovery still RUNS on quick (it is a depth cap, not a gate).
  if (depth === 'full') {
    return {
      domainSeeds: 5,
      siteKeywordSeeds: 5,
      keywordsForSiteLimit: 50,
      keywordIdeasLimit: 50,
      suggestionSeeds: 3,
      suggestionsLimit: 20,
      relatedSeeds: 5,
      relatedLimit: 10,
      questionSeeds: 5,
      questionsLimit: 10,
    };
  }
  return {
    domainSeeds: 3,
    siteKeywordSeeds: 2,
    keywordsForSiteLimit: 25,
    keywordIdeasLimit: 25,
    suggestionSeeds: 1,
    suggestionsLimit: 15,
    relatedSeeds: 2,
    relatedLimit: 8,
    questionSeeds: 2,
    questionsLimit: 8,
  };
}

// ── Inputs ────────────────────────────────────────────────────────────────────
export interface BuildKeywordUniverseOptions {
  /** Provider (already configured) for the discovery fetch. Null → no discovery. */
  provider: SeoDataProvider | null;
  /**
   * Credit depth. Repurposed from the legacy quick/full `seoDataMode`. On the
   * flag-ON path, "provider present" means a real universe is built regardless of
   * the legacy `'none'` collapse (so MCP-triggered generations are not starved) —
   * a `'none'` mode is treated as `'quick'` depth when a provider exists.
   */
  seoDataMode: 'quick' | 'full' | 'none';
  /** Resolved site domain (host only) for `getKeywordsForSite`. */
  siteDomain: string;
  /** Cached `siteKeywords` from the prior strategy (extra discovery seeds). */
  priorSiteKeywords: string[];
  /** GSC query rows (proven search terms; `source:'gsc'`). */
  gscData: Array<{ query: string; impressions: number }>;
  /** Provider domain organic rows. */
  domainKeywords: DomainKeyword[];
  /** Competitor keyword rows. */
  competitorKeywords: CompetitorKeywordData[];
  /** Competitor keyword gaps. */
  keywordGaps: KeywordGapEntry[];
  /** Pre-fetched discovery evidence (flag-OFF parity input; merged + deduped). */
  discoveryKeywords: KeywordSourceEvidence[];
  /** Pre-fetched related keywords. */
  relatedKeywords: RelatedKeyword[];
  /** Client-requested keywords (already resolved in synthesis scope). */
  requestedKeywords: string[];
  /** Client-declined keywords (already resolved in synthesis scope). */
  declinedKeywords: string[];
  /** Competitor domains for the branded-keyword filter. */
  competitorDomains: string[];
  /** Shared keyword-intelligence evaluation context (the admission funnel ctx). */
  evaluationContext: KeywordEvaluationContext;
  /**
   * SEO Generation Quality P3 (G4) — client content-gap votes. Mapped onto the
   * per-candidate `voteWeight` annotation (matched by normalized topic == keyword).
   */
  contentGapVotes?: { topic: string; votes: number }[];
  /** Optional progress reporter (mirrors synthesis `sendProgress`). */
  sendProgress?: (step: string, detail: string, progress: number) => void;
}

export interface BuildKeywordUniverseResult {
  universe: KeywordUniverse;
  /**
   * The canonical pool Map (normalizedKeyword → {volume,difficulty,source}).
   * Synthesis populates its `keywordPool` from this directly so downstream
   * `keywordPool.get(...)` reads are unchanged.
   */
  pool: KeywordStrategyKeywordPool;
  /** Branded + declined candidates removed (wired to telemetry `suppressedCount`). */
  suppressedCount: number;
  /**
   * Question keywords grouped by seed — the SAME shape the legacy
   * `seoDataMode === 'full'` prefetch in `keyword-strategy-seo-data.ts` produced
   * (`{ seed, questions: { keyword, volume }[] }[]`). The assembler already fetches
   * these (geo + language threaded) to fold into the pool; surfacing the grouped
   * result here lets generation thread them into `enrichKeywordStrategy` so FAQ
   * questions are attached to content gaps on the flag-ON path exactly as before.
   */
  questionKeywords: QuestionKeywordGroup[];
}

// ── Implementation ──────────────────────────────────────────────────────────
export async function buildKeywordUniverse(
  workspaceId: string,
  opts: BuildKeywordUniverseOptions,
): Promise<BuildKeywordUniverseResult> {
  const {
    provider,
    seoDataMode,
    siteDomain,
    priorSiteKeywords,
    gscData,
    domainKeywords,
    competitorKeywords,
    keywordGaps,
    discoveryKeywords,
    relatedKeywords,
    requestedKeywords,
    declinedKeywords,
    competitorDomains,
    evaluationContext,
    contentGapVotes,
    sendProgress,
  } = opts;

  // "provider present" → build a real universe; depth defaults to quick when the
  // legacy mode collapsed to 'none' (the MCP-seed path) but a provider exists.
  const depth: KeywordUniverseCreditDepth = seoDataMode === 'full' ? 'full' : 'quick';
  const limits = depthLimits(depth);

  const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? 2840;
  const languageCode = resolveWorkspaceLanguageCode(workspaceId);

  const pool: KeywordStrategyKeywordPool = new Map();
  const eligible = (k: { keyword: string; volume?: number; difficulty?: number; cpc?: number; source?: string; sourceKind?: string }): boolean => {
    const evaluation = isStrategyPoolEligibleKeyword(k, evaluationContext);
    if (evaluation.suppressed) {
      log.info({ workspaceId, keyword: k.keyword, reasons: evaluation.reasons.map(r => r.message) }, 'Suppressed keyword universe candidate via shared keyword intelligence');
      return false;
    }
    return true;
  };

  // ── (1) Provider discovery fetch (geo + language threaded) ──
  // Owned by the assembler on the flag-ON path. ALWAYS runs when a provider
  // exists (depth-capped), not gated on on/off. The pre-fetched discovery/related
  // arrays (flag-OFF inputs) are still merged so nothing is lost.
  // NOTE: SemRush is language/geo-blind for discovery — it implements only
  // getRelatedKeywords/getQuestionKeywords and ignores the threaded
  // locationCode/languageCode args; DataForSEO (the default provider) honors both. (M3)
  const fetchedDiscovery: KeywordSourceEvidence[] = [];
  const fetchedRelated: RelatedKeyword[] = [];
  // Grouped question keywords (by seed) surfaced for FAQ enrichment — the SAME
  // shape the legacy seoDataMode === 'full' prefetch produced. The questions also
  // enter the pool via `fetchedDiscovery` below; this grouping is additive.
  const questionKeywords: QuestionKeywordGroup[] = [];
  if (provider) {
    sendProgress?.('seo-data', 'Building keyword universe (discovery)...', 0.5);
    const discoverySeeds = [
      ...domainKeywords.filter(k => k.keyword?.trim()).slice(0, limits.domainSeeds).map(k => k.keyword),
      ...priorSiteKeywords.slice(0, limits.siteKeywordSeeds),
    ];

    const runProviderCall = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      if (!reserveProviderCall(workspaceId)) {
        log.warn({ workspaceId }, 'Monthly provider-call ceiling reached for keyword universe — skipping discovery call');
        return [];
      }
      try {
        return await fn();
      } catch (err) {
        if (isProgrammingError(err)) log.warn({ err }, 'keyword-universe: programming error in provider call');
        else log.warn({ err }, 'keyword universe discovery source failed');
        return [];
      }
    };

    // geo (locationCode) + language are both threaded into every discovery call
    // (the `database` slot is left undefined so the provider derives geo from the
    // resolved locationCode, not from a US default). This is the whole-pool-US fix.
    if (provider.getKeywordsForSite && siteDomain) {
      fetchedDiscovery.push(...await runProviderCall(() =>
        provider.getKeywordsForSite!(siteDomain, workspaceId, limits.keywordsForSiteLimit, undefined, locationCode, languageCode)));
    }
    if (provider.getKeywordIdeas && discoverySeeds.length > 0) {
      fetchedDiscovery.push(...await runProviderCall(() =>
        provider.getKeywordIdeas!(discoverySeeds, workspaceId, limits.keywordIdeasLimit, undefined, locationCode, languageCode)));
    }
    if (provider.getKeywordSuggestions) {
      for (const seed of discoverySeeds.slice(0, limits.suggestionSeeds)) {
        fetchedDiscovery.push(...await runProviderCall(() =>
          provider.getKeywordSuggestions!(seed, workspaceId, limits.suggestionsLimit, undefined, locationCode, languageCode)));
      }
    }
    // Related
    const relatedSeeds = domainKeywords.filter(k => k.keyword?.trim()).slice(0, limits.relatedSeeds).map(k => k.keyword);
    for (const seed of relatedSeeds) {
      fetchedRelated.push(...await runProviderCall(() =>
        provider.getRelatedKeywords(seed, workspaceId, limits.relatedLimit, undefined, locationCode, languageCode)));
    }
    // Questions (folded into discovery as a source so they enter the pool too)
    const questionSeeds = domainKeywords.filter(k => k.keyword?.trim() && k.volume > 100).slice(0, limits.questionSeeds).map(k => k.keyword);
    for (const seed of questionSeeds) {
      const questions = await runProviderCall(() =>
        provider.getQuestionKeywords(seed, workspaceId, limits.questionsLimit, undefined, locationCode, languageCode));
      if (questions.length > 0) {
        // Grouped-by-seed shape for FAQ enrichment (mirrors the legacy prefetch).
        questionKeywords.push({ seed, questions: questions.map(q => ({ keyword: q.keyword, volume: q.volume })) });
      }
      for (const q of questions) {
        fetchedDiscovery.push({
          keyword: q.keyword,
          volume: q.volume,
          difficulty: q.difficulty,
          cpc: q.cpc,
          provider: provider.name,
          sourceKind: 'keyword_suggestions',
        });
      }
    }
  }

  // ── coarse source tagging (for sourceCounts) ──
  const coarseSource = new Map<string, KeywordCandidateSource>();
  const tag = (norm: string, source: KeywordCandidateSource): void => {
    if (norm && !coarseSource.has(norm)) coarseSource.set(norm, source);
  };

  // ── (2) Domain organic rows ──
  for (const k of domainKeywords) {
    if (!eligible({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, source: provider?.name ?? 'seo-provider' })) continue;
    const norm = normalizeKeyword(k.keyword);
    if (upsertKeywordPoolCandidate(pool, k.keyword, { volume: k.volume, difficulty: k.difficulty, source: provider?.name ?? 'seo-provider' })) {
      tag(norm, KEYWORD_CANDIDATE_SOURCE.DOMAIN);
    }
  }

  // ── (3) GSC queries (proven search terms; source:'gsc') ──
  for (const r of gscData) {
    const q = normalizeKeyword(r.query);
    if (q.length > 3 && q.split(' ').length >= 2) {
      if (upsertKeywordPoolCandidate(pool, q, { volume: r.impressions, difficulty: 0, source: 'gsc' })) {
        tag(q, KEYWORD_CANDIDATE_SOURCE.GSC);
      }
    }
  }

  // ── (4) Competitor keywords ──
  for (const ck of competitorKeywords) {
    const kw = normalizeKeyword(ck.keyword);
    if (ck.volume > 0 && eligible({ keyword: kw, volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` })) {
      if (upsertKeywordPoolCandidate(pool, kw, { volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` })) {
        tag(kw, KEYWORD_CANDIDATE_SOURCE.COMPETITOR_GAP);
      }
    }
  }

  // ── (5) Keyword gaps (highest priority) ──
  for (const gap of keywordGaps) {
    const kw = normalizeKeyword(gap.keyword);
    if (gap.volume > 0 && eligible({ keyword: kw, volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` })) {
      if (upsertKeywordPoolCandidate(pool, kw, { volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` })) {
        tag(kw, KEYWORD_CANDIDATE_SOURCE.COMPETITOR_GAP);
      }
    }
  }

  // ── (6) Provider discovery (pre-fetched flag-OFF input + assembler-fetched) ──
  // No local seen-set: dedup is owned by `upsertKeywordPoolCandidate`'s Map exactly
  // as the legacy `else` fold does. A pre-set short-circuit would mark an
  // ineligible-first duplicate (e.g. volume:0 first row) as seen and then drop a
  // later eligible duplicate the legacy fold admits — and would also defeat the
  // higher-volume tiebreak. (C2)
  // P2(c): on the flag-ON assembler path, admit KD-0 long-tail (difficulty >= 0)
  // behind the volume floor. `relaxConservatism` rides on the threaded eval context
  // (true whenever the assembler runs, i.e. the flag is ON).
  const relaxConservatism = evaluationContext.relaxConservatism ?? false;
  for (const dk of [...discoveryKeywords, ...fetchedDiscovery]) {
    const kw = normalizeKeyword(dk.keyword);
    if (isStrategyQualityDiscoveryKeyword(dk, relaxConservatism) && eligible(dk)) {
      if (upsertKeywordPoolCandidate(pool, kw, { volume: dk.volume, difficulty: dk.difficulty, source: `discovery:${dk.sourceKind}` })) {
        tag(kw, dk.sourceKind === 'keyword_suggestions' ? KEYWORD_CANDIDATE_SOURCE.QUESTION : KEYWORD_CANDIDATE_SOURCE.PROVIDER_DISCOVERY);
      }
    }
  }

  // ── (7) Related keywords (pre-fetched + assembler-fetched) ──
  // Same as (6): rely on the Map dedup + tiebreak, no local seen-set. (C2)
  for (const rk of [...relatedKeywords, ...fetchedRelated]) {
    const kw = normalizeKeyword(rk.keyword);
    if (rk.volume > 0 && eligible({ keyword: kw, volume: rk.volume, difficulty: rk.difficulty, cpc: rk.cpc, source: 'related' })) {
      if (upsertKeywordPoolCandidate(pool, kw, { volume: rk.volume, difficulty: rk.difficulty, source: 'related' })) {
        tag(kw, KEYWORD_CANDIDATE_SOURCE.RELATED);
      }
    }
  }

  // ── (8) Client-tracked keywords ──
  const clientTracked = getTrackedKeywords(workspaceId);
  for (const tk of clientTracked) {
    const kw = normalizeKeyword(tk.query);
    if (kw.length > 1) {
      if (upsertKeywordPoolCandidate(pool, kw, { volume: 0, difficulty: 0, source: 'client' })) {
        tag(kw, KEYWORD_CANDIDATE_SOURCE.CLIENT_TRACKED);
      }
    }
  }

  // ── (9) Client-requested keywords ──
  for (const kw of requestedKeywords) {
    const norm = normalizeKeyword(kw);
    if (upsertKeywordPoolCandidate(pool, kw, { volume: 0, difficulty: 0, source: 'client' })) {
      tag(norm, KEYWORD_CANDIDATE_SOURCE.CLIENT_REQUESTED);
    }
  }

  // ── (10) Branded competitor filter + (11) declined hard-filter ──
  const sizeBeforeFilters = pool.size;
  const brandedRemoved = filterBrandedKeywords(pool, competitorDomains);
  const declinedRemoved = filterDeclinedFromPool(pool, declinedKeywords);
  const suppressedCount = (sizeBeforeFilters - pool.size);
  if (declinedRemoved > 0) log.info({ workspaceId, declinedRemoved }, 'Removed declined keywords from keyword universe');

  // ── Derive typed candidates + sourceCounts from the canonical Map ──
  // SEO Generation Quality P3 (G4): populate the per-candidate annotation fields
  // (declined/requested/voteWeight/priority) the closed-set prompt consumes. These
  // were never set before P3. `declined` is computed for completeness (surviving
  // candidates are post-filter so it is effectively false); `requested` and
  // `voteWeight` drive the closed-set prompt's prioritization + the synthesis-side
  // requested re-add hard guarantee.
  const requestedSet = new Set(requestedKeywords.map(k => normalizeKeyword(k)).filter(Boolean));
  const declinedSet = new Set(declinedKeywords.map(k => normalizeKeyword(k)).filter(Boolean));
  const voteByKeyword = new Map<string, number>();
  for (const vote of contentGapVotes ?? []) {
    const key = normalizeKeyword(vote.topic);
    if (key) voteByKeyword.set(key, (voteByKeyword.get(key) ?? 0) + vote.votes);
  }
  const candidates: KeywordCandidate[] = [];
  const sourceCounts: Partial<Record<KeywordCandidateSource, number>> = {};
  for (const [kw, m] of pool.entries()) {
    const coarse = coarseSource.get(kw);
    const requested = requestedSet.has(kw);
    const declined = declinedSet.has(kw);
    const voteWeight = voteByKeyword.get(kw);
    const candidate: KeywordCandidate = { keyword: kw, source: m.source, volume: m.volume, difficulty: m.difficulty };
    if (requested) candidate.requested = true;
    if (declined) candidate.declined = true;
    if (voteWeight != null && voteWeight > 0) candidate.voteWeight = voteWeight;
    // Coarse priority signal: requested + voted candidates are high priority.
    if (requested || (voteWeight ?? 0) > 0) candidate.priority = 'high';
    candidates.push(candidate);
    if (coarse) sourceCounts[coarse] = (sourceCounts[coarse] ?? 0) + 1;
  }

  log.info(
    { workspaceId, poolSize: pool.size, depth, locationCode, languageCode, brandedRemoved, declinedRemoved },
    'Built keyword universe',
  );

  const universe: KeywordUniverse = {
    workspaceId,
    locationCode,
    languageCode,
    candidates,
    sourceCounts,
    suppressedCount,
    creditDepth: depth,
  };

  return { universe, pool, suppressedCount, questionKeywords };
}
