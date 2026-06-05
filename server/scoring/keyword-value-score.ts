// ── Keyword Value Score ──────────────────────────────────────────────────────
// Pure, side-effect-free (no DB, no workspace lookups) value-first opportunity
// scorer for the Keyword Hub and content-gap spine.
//
// Formula (§5): score = round( min(100,
//   commercialValue × (FLOOR + (1−FLOOR)·tiebreak) × localRelevanceMultiplier × 100) )
//
// See docs/superpowers/plans/2026-06-05-keyword-value-scoring.md
// and docs/superpowers/specs/2026-06-05-keyword-value-scoring-design.md (§5/§6/§8).

import type { OpportunityInput } from '../../shared/types/recommendations.js';
import type { LocalSeoPosture } from '../../shared/types/local-seo.js';
import type { LocalSeoMarket } from '../../shared/types/local-seo.js';
import { INTENT_WEIGHT, DEFAULT_INTENT_WEIGHT } from './opportunity-value.js';
import { hasMarketModifier, classifyLocalKeywordIntent } from '../local-seo.js';

// ── Public type re-exports ───────────────────────────────────────────────────

/** The 4-bucket value intent consumed by INTENT_WEIGHT. */
export type ValueIntent = NonNullable<OpportunityInput['intent']>;
// = 'transactional' | 'commercial' | 'informational' | 'navigational'

/** Per-request constant built once from getLocalSeoPosture + listLocalSeoMarkets + businessProfile. */
export interface ScoringContext {
  posture: LocalSeoPosture;        // 'local'|'hybrid'|'non_local'|'unknown'
  markets: LocalSeoMarket[];       // from listLocalSeoMarkets(workspaceId)
  city?: string;                   // lowercased businessProfile.address.city
  state?: string;                  // lowercased businessProfile.address.state
}

/** Input for a single keyword to score. */
export interface KeywordValueInput {
  keyword: string;
  volume?: number;
  impressions?: number;
  difficulty?: number;
  cpc?: number;
  intent?: string | null;          // raw provided intent from any source; undefined → derive from keyword
}

// ── Named constants (single source) ─────────────────────────────────────────

/** Within-tier tiebreak weights; sum to 1. */
const W_DEMAND = 0.40;
const W_WIN = 0.60;

/** Score floor — demand/winnability can at most double a score within its commercial tier. */
const FLOOR = 0.50;

/** Reference search volume for demand normalization (log10 scale). */
const DEMAND_REF = 10000;

/** Reference CPC for cpcFactor capping. */
const CPC_REF = 12;

/** Mid-band CPC proxy when cpc is absent/zero (§5, §7). */
const CPC_UNKNOWN = 0.5;

/**
 * Service-keyword regex for isLocalKeyword (pure version of hasLocalIntent without the DB read).
 * Mirrors the regex in local-seo.ts:hasLocalIntent but without the DB-backed service-category path.
 */
const SERVICE_KEYWORD_RE =
  /dentist|dental|orthodont|implant|invisalign|veneer|emergency|clinic|lawyer|attorney|restaurant|contractor|plumber|roofing|med spa/;

// ── Local multiplier table (§8) ───────────────────────────────────────────────

const LOCAL_MULT = {
  local: { isLocal: 1.50, natInfo: 0.60 },
  hybrid: { isLocal: 1.25, natInfo: 0.90 },
} as const;

// ── 5→4 intent adapter ───────────────────────────────────────────────────────

/**
 * Adapts a raw intent string (5-bucket LocalSeoKeywordIntent or anything else) to
 * the 4-bucket ValueIntent consumed by INTENT_WEIGHT.
 *
 *  'comparison' → 'commercial'
 *  4-bucket passthroughs
 *  anything else | null | undefined → null
 */
export function toValueIntent(raw: string | null | undefined): ValueIntent | null {
  if (raw == null) return null;
  if (raw === 'comparison') return 'commercial';
  if (
    raw === 'transactional' ||
    raw === 'commercial' ||
    raw === 'informational' ||
    raw === 'navigational'
  ) {
    return raw as ValueIntent;
  }
  return null;
}

/**
 * Derives a deterministic ValueIntent for a keyword:
 *  1. toValueIntent(provided) if truthy
 *  2. toValueIntent(classifyLocalKeywordIntent(keyword)) — always non-null
 */
export function deriveValueIntent(keyword: string, provided?: string | null): ValueIntent {
  const fromProvided = toValueIntent(provided);
  if (fromProvided !== null) return fromProvided;
  // classifyLocalKeywordIntent returns LocalSeoKeywordIntent which includes 'comparison';
  // toValueIntent maps that to 'commercial'. The classifier never returns 'navigational',
  // so toValueIntent always returns a non-null value here.
  return toValueIntent(classifyLocalKeywordIntent(keyword)) as ValueIntent;
}

/**
 * Maps a ValueIntent (or null) to its INTENT_WEIGHT value.
 * null → DEFAULT_INTENT_WEIGHT (0.5, mid-band).
 */
export function valueIntentWeight(intent: ValueIntent | null): number {
  if (intent === null) return DEFAULT_INTENT_WEIGHT;
  return INTENT_WEIGHT[intent];
}

// ── Pure local predicate (§8) ─────────────────────────────────────────────────

/**
 * Returns true if the keyword is local — no DB reads.
 * Mirrors hasLocalIntent's geo/near-me/service logic without the DB-backed service-category branch.
 */
export function isLocalKeyword(keyword: string, ctx: ScoringContext): boolean {
  const kw = keyword.toLowerCase();
  return (
    hasMarketModifier(keyword, ctx.markets) ||
    Boolean(ctx.city && kw.includes(ctx.city)) ||
    Boolean(ctx.state && kw.includes(ctx.state)) ||
    SERVICE_KEYWORD_RE.test(kw)
  );
}

// ── Posture multiplier (§8) ───────────────────────────────────────────────────

/**
 * Returns the local relevance multiplier for a keyword given the workspace posture.
 * national-informational ≡ !isLocal && intent === 'informational' (D5: only informational demoted).
 */
export function localRelevanceMultiplier(
  posture: LocalSeoPosture,
  isLocal: boolean,
  intent: ValueIntent,
): number {
  if (posture === 'non_local' || posture === 'unknown') return 1.0;
  const isNatInfo = !isLocal && intent === 'informational';
  if (posture === 'local') {
    if (isLocal) return LOCAL_MULT.local.isLocal;
    if (isNatInfo) return LOCAL_MULT.local.natInfo;
    return 1.0;
  }
  // hybrid
  if (isLocal) return LOCAL_MULT.hybrid.isLocal;
  if (isNatInfo) return LOCAL_MULT.hybrid.natInfo;
  return 1.0;
}

// ── Main scorer (§5) ──────────────────────────────────────────────────────────

/**
 * Computes the value-first keyword opportunity score (0..100) for a single keyword.
 *
 * Returns undefined when the signal gate fails (no volume>0, no impressions>0,
 * difficulty==null, no cpc>0, AND no *provided* intent — regex-derived intent does
 * NOT rescue a metric-less keyword).
 */
export function computeKeywordValueScore(
  input: KeywordValueInput,
  ctx: ScoringContext,
): number | undefined {
  const { keyword, volume, impressions, difficulty, cpc, intent } = input;

  // 1. Signal gate — must have at least one raw signal OR a provided intent.
  //    A regex-derived intent does NOT count (toValueIntent on provided intent only).
  const hasSignal =
    (volume !== undefined && volume > 0) ||
    (impressions !== undefined && impressions > 0) ||
    difficulty !== null && difficulty !== undefined ||
    (cpc !== undefined && cpc > 0) ||
    toValueIntent(intent) !== null;

  if (!hasSignal) return undefined;

  // 2. Intent + local
  const resolvedIntent = deriveValueIntent(keyword, intent);
  const local = isLocalKeyword(keyword, ctx);

  // 3. Commercial value (PRIMARY)
  const cpcFactor = cpc !== undefined && cpc > 0 ? Math.min(cpc / CPC_REF, 1) : CPC_UNKNOWN;
  const commercialValue = valueIntentWeight(resolvedIntent) * cpcFactor;

  // 4. Demand + winnability (within-tier tiebreakers)
  //    volume===0 (providers coerce absent volume to 0) must NOT mask real impressions —
  //    an impression-only / not-yet-ranking keyword takes its demand from impressions.
  const signal = volume && volume > 0 ? volume : impressions ?? 0;
  const demand = Math.min(
    Math.log10(1 + signal) / Math.log10(1 + DEMAND_REF),
    1,
  );
  const winnability = 1 - (difficulty ?? 50) / 100;

  // 5. Tiebreak
  const tiebreak = W_DEMAND * demand + W_WIN * winnability;

  // 6. Final score
  const multiplier = localRelevanceMultiplier(ctx.posture, local, resolvedIntent);
  const raw = commercialValue * (FLOOR + (1 - FLOOR) * tiebreak) * multiplier * 100;
  return Math.round(Math.min(100, raw));
}
