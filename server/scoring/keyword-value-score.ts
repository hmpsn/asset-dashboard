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
import { classifyLocalKeywordIntent, hasMarketModifier } from '../domains/local-seo/keyword-intent.js';

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

// ── Component interface (§6, PR 2) ───────────────────────────────────────────

/**
 * The internal scoring components exposed by computeKeywordValueComponents.
 * Provides one value-component vocabulary for the kwv-value-breakdown render layer.
 */
export interface KeywordValueComponents {
  commercialValue: number;
  demand: number;
  winnability: number;
  localMultiplier: number;
  intent: ValueIntent;
}

// ── Main scorer (§5) ──────────────────────────────────────────────────────────

/**
 * Computes the value-first keyword opportunity score and its internal components.
 *
 * Returns { score: undefined, components: undefined } when the signal gate fails
 * (no volume>0, no impressions>0, difficulty==null, no cpc>0, AND no *provided*
 * intent — regex-derived intent does NOT rescue a metric-less keyword).
 *
 * The scalar wrapper computeKeywordValueScore delegates entirely to this function.
 */
export function computeKeywordValueComponents(
  input: KeywordValueInput,
  ctx: ScoringContext,
): { score: number | undefined; components: KeywordValueComponents | undefined } {
  const { keyword, volume, impressions, difficulty, cpc, intent } = input;

  // 1. Signal gate — must have at least one raw signal OR a provided intent.
  //    A regex-derived intent does NOT count (toValueIntent on provided intent only).
  const hasSignal =
    (volume !== undefined && volume > 0) ||
    (impressions !== undefined && impressions > 0) ||
    difficulty !== null && difficulty !== undefined ||
    (cpc !== undefined && cpc > 0) ||
    toValueIntent(intent) !== null;

  if (!hasSignal) return { score: undefined, components: undefined };

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
  const localMultiplier = localRelevanceMultiplier(ctx.posture, local, resolvedIntent);
  const raw = commercialValue * (FLOOR + (1 - FLOOR) * tiebreak) * localMultiplier * 100;
  const score = Math.round(Math.min(100, raw));

  return {
    score,
    components: { commercialValue, demand, winnability, localMultiplier, intent: resolvedIntent },
  };
}

// ── Volume demand bands for plain-language reasons ───────────────────────────

const DEMAND_HIGH  = 1000;
const DEMAND_MODEST = 100;

/**
 * Returns plain-language reason strings from Layer-1 value components + raw signals.
 * Ordered by contribution: intent → winnability → demand → local.
 *
 * - intent: cpc>0 → "Commercial intent · $9 CPC"; else "<Capitalized-intent> intent"
 * - winnability: raw.difficulty present → "Winnable · KD 24"; else omitted
 * - demand: raw.volume present → banded label + formatted volume/mo; else omitted
 * - local: ONLY when components.localMultiplier > 1 → "Local boost ×1.5"
 */
export function keywordValueReasons(
  components: KeywordValueComponents,
  raw: { cpc?: number; volume?: number; difficulty?: number },
): string[] {
  const reasons: string[] = [];

  // 1. Intent reason
  const intentLabel = components.intent.charAt(0).toUpperCase() + components.intent.slice(1);
  if (raw.cpc !== undefined && raw.cpc > 0) {
    // Clean money formatting: "$9" for 9, "$12.35" for 12.347 (no fractional dust).
    const cpcStr = Number.isInteger(raw.cpc) ? `${raw.cpc}` : raw.cpc.toFixed(2);
    reasons.push(`${intentLabel} intent · $${cpcStr} CPC`);
  } else {
    reasons.push(`${intentLabel} intent`);
  }

  // 2. Winnability reason — banded off the COMPUTED winnability so the label can't say
  //    "Winnable" for a KD-90 keyword. winnability = 1 − difficulty/100.
  if (raw.difficulty != null) {
    const winLabel =
      components.winnability >= 0.6 ? 'Winnable' :
      components.winnability >= 0.3 ? 'Competitive' :
      'Hard';
    reasons.push(`${winLabel} · KD ${raw.difficulty}`);
  }

  // 3. Demand reason — only when volume is REAL. volume:0 is provider-coerced "absent"
  //    (the score itself treats 0 as absent, §5 :213); never render "Low demand · 0/mo".
  if (raw.volume != null && raw.volume > 0) {
    const demandLabel =
      raw.volume >= DEMAND_HIGH ? 'Strong demand' :
      raw.volume >= DEMAND_MODEST ? 'Modest demand' :
      'Low demand';
    const formatted = raw.volume.toLocaleString('en-US');
    reasons.push(`${demandLabel} · ${formatted}/mo`);
  }

  // 4. Local boost (only when multiplier > 1)
  if (components.localMultiplier > 1) {
    reasons.push(`Local boost ×${components.localMultiplier}`);
  }

  return reasons;
}

/**
 * Thin wrapper: returns only the score from computeKeywordValueComponents.
 * The 4 existing scalar callers are unaffected — they receive the same number | undefined.
 *
 * Returns undefined when the signal gate fails.
 */
export function computeKeywordValueScore(
  input: KeywordValueInput,
  ctx: ScoringContext,
): number | undefined {
  return computeKeywordValueComponents(input, ctx).score;
}
