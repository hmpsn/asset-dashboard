// ── Recommendation domain types ─────────────────────────────────

import type { ImpactBand } from './impact-band.js';

export type RecPriority = 'fix_now' | 'fix_soon' | 'fix_later' | 'ongoing';
export type RecType = 'technical' | 'content' | 'content_refresh' | 'schema' | 'metadata' | 'performance' | 'accessibility' | 'strategy' | 'aeo' | 'keyword_gap' | 'topic_cluster' | 'cannibalization' | 'local_visibility' | 'local_service_gap' | 'competitor';
export type RecStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';
export type RecActionType = 'automated' | 'manual' | 'content_creation' | 'purchase';

export interface Recommendation {
  id: string;
  workspaceId: string;
  priority: RecPriority;
  type: RecType;
  title: string;
  description: string;
  insight: string;           // human-readable "why this matters" explanation
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  impactScore: number;       // 0–100, used for sorting (derived from opportunity.value once the OV scorer is live)
  /** Unified Opportunity Value breakdown. Optional for legacy rows; when present,
   *  impactScore is a derived read of opportunity.value. See docs/designs/2026-05-31-opportunity-value-model.md. */
  opportunity?: OpportunityScore;
  source: string;            // which check / analysis produced this
  affectedPages: string[];   // page slugs
  trafficAtRisk: number;     // total clicks on affected pages (28d)
  impressionsAtRisk: number; // total impressions on affected pages (28d)
  estimatedGain: string;     // human-readable expected improvement
  actionType: RecActionType;
  productType?: string;      // for purchasable fix upsell
  productPrice?: number;
  /** D2 (audit #11): the keyword this rec targets (set on content-gap recs at mint).
   *  Matched via keywordComparisonKey against in-flight briefs/posts (generation
   *  suppression) and against the published post's targetKeyword (publish-time
   *  resolution in publishPostToWebflow). Absent on legacy rows and non-content recs. */
  targetKeyword?: string;
  status: RecStatus;
  /** Client-safe banded monthly impact (D-IMPACT). Set ONLY on the public projection
   *  (server/routes/recommendations.ts stripEmvFromPublicRecs), derived from the
   *  admin/AI-only opportunity.emvPerWeek which is stripped in the same pass. Absent on
   *  admin-facing payloads (they carry the raw opportunity instead) and when the projected
   *  monthly value is below the display floor. NEVER populated from raw emv client-side. */
  impactBand?: ImpactBand;
  assignedTo?: 'team' | 'client'; // premium → team, growth/free → client
  /** SEO Gen-Quality P2: true when this rec comes from a deterministic-backfill content
   *  gap (re-admitted to meet the >=6 floor), so headline counts / "ready for review"
   *  emails can exclude marginal backfill. Only set (to true) on the flag-ON path —
   *  absent on every legacy/flag-OFF rec, preserving byte-identical output. */
  backfilled?: boolean;
  // ── Strategy v3 — two-axis client-facing lifecycle (SEPARATE from RecStatus) ──
  // RecStatus (status, above) stays the INTERNAL admin triage axis (pending/in_progress/
  // completed/dismissed). clientStatus + lifecycle are the v3 curation axes. strike/throttle/
  // send NEVER write RecStatus — a struck rec must never be swept to 'completed' and read as
  // "✓ done" to the client (the trust-critical graft, spec §6.1). All optional → byte-identical
  // on every legacy/flag-OFF rec (absent ⇒ treated as clientStatus:'system', lifecycle:'active').
  /** Curation axis: system (minted, not yet curated) → curated (operator picked) → sent
   *  (delivered to client) → approved | declined | discussing (client responded). */
  clientStatus?: 'system' | 'curated' | 'sent' | 'approved' | 'declined' | 'discussing';
  /** Suppression axis, orthogonal to clientStatus: active (default) | throttled (hidden
   *  until throttledUntil) | struck (permanently suppressed, won't be re-suggested). */
  lifecycle?: 'active' | 'throttled' | 'struck';
  /** ISO timestamp the throttle expires; the rec auto-resurfaces as active on-read once
   *  Date.now() passes this (no cron — spec §8). Only set when lifecycle==='throttled'. */
  throttledUntil?: string;
  /** ISO timestamp the rec was sent to the client. Set when clientStatus → 'sent'. */
  sentAt?: string;
  /** ISO timestamp the rec was struck. Set when lifecycle → 'struck'. */
  struckAt?: string;
  /** Cascade metadata for keyword/topic strikes that also remove items from strategy
   *  (spec §4.3 "removes from strategy — reversible"). Carries the reversal payload so
   *  Undo can restore the strategy items the strike removed. Absent on non-cascading strikes. */
  cascade?: { removedKeywords?: string[]; removedClusters?: string[]; reversible: boolean };
  /** Where a Send routes. 'deliverable' for RecTypes with a registered deliverable adapter
   *  (content_decay/cannibalization) — their Send goes to the deliverable spine and the rec
   *  reads its lifecycle from client_actions, NOT an independent clientStatus (spec §6.3).
   *  'rec' (default/absent) for all other RecTypes — Send mutates clientStatus directly. */
  sendChannel?: 'deliverable' | 'rec';
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationSet {
  workspaceId: string;
  generatedAt: string;
  recommendations: Recommendation[];
  summary: {
    fixNow: number;
    fixSoon: number;
    fixLater: number;
    ongoing: number;
    totalImpactScore: number;
    trafficAtRisk: number;
    /** Sum of active recommendations' canonical Opportunity Value scores. */
    totalOpportunityValue?: number;
    /** Sum of fix-now/fix-soon recommendations' canonical Opportunity Value scores. */
    actionableOpportunityValue?: number;
    /** Canonical Opportunity Value score for the top active recommendation. */
    topOpportunityValue?: number;
    /** @deprecated Legacy recovery-rate summary fields retained only for historical persisted rows. */
    estimatedRecoverableClicks?: number;
    /** @deprecated Legacy recovery-rate summary fields retained only for historical persisted rows. */
    estimatedRecoverableImpressions?: number;
    /** The id of the highest-ranked active (non-completed, non-dismissed) recommendation,
     *  or null when no active recs exist. Set from the already-sorted recs array so it
     *  always agrees with the Health tab's ordering. */
    topRecommendationId: string | null;
    /** One-line rendered rationale for the #1 (from its opportunity.components).
     *  Optional/absent on legacy sets and when no active recs exist. */
    topOpportunityRationale?: string;
  };
}

// ── Unified Opportunity Value model ──────────────────────────────
// One shared, data-grounded score every producer computes via
// `computeOpportunityValue()` (server/scoring/opportunity-value.ts).
// See docs/designs/2026-05-31-opportunity-value-model.md.

export type OpportunityDimension =
  | 'demand' | 'winnability' | 'intent' | 'effort' | 'businessFit' | 'timing' | 'evidence';

/** Self-describing contribution of one rubric dimension to the score.
 *  Powers the advisor's "why this is #1" and the client's breakdown bars. */
export interface OpportunityComponent {
  dimension: OpportunityDimension;
  rawValue: number | string | null;   // e.g. volume 2400, position 7, "transactional"
  normalized: number;                  // 0..1
  weight: number;                      // display weight (platform default; calibrated in P5)
  contribution: number;                // weight × normalized
  evidence: string;                    // one-line "why" the advisor recites verbatim
}

export interface OpportunityScore {
  value: number;                       // 0..100 — written into Recommendation.impactScore
  emvPerWeek: number;                  // expected value/week; $ when CPC-grounded, intent-weighted-clicks proxy otherwise. Admin/AI-only.
  /** Projected expected value over the OV horizon (emvPerWeek × HORIZON_WEEKS).
   *  P4 CPC-PROXY PLACEHOLDER — NOT real money: it is the same CPC/intent-weighted-clicks
   *  proxy as emvPerWeek, scaled to the horizon. Real GA4 `estimatedRevenue` arrives in P6
   *  (the calibration swap-site is documented in server/scoring/ov-calibration.ts).
   *  Admin/AI-only: clients never see a raw $/wk figure — it is stripped on every public
   *  route (stripEmvFromPublicRecs) and snapshotted onto the outcome row (predicted_emv)
   *  at recordAction time so calibration history accrues even while OV is dark. */
  predictedEmv: number;                // CPC-proxy placeholder; admin/AI-only (see JSDoc).
  roiPerEffortDay: number;             // internal ROI quantity (pre-normalization)
  confidence: number;                  // 0.4..1.0 — grounded-data vs LLM-adjective provenance
  calibration: number;                 // 0.75..1.25 per-workspace (1.0 until outcomes exist)
  groundedSpine: 'roiScore' | 'opportunityScore' | 'computed';
  components: OpportunityComponent[];
  calibrationVersion: string;          // weights-row version → stable client-visible contract
  modelVersion: string;                // 'ov-1'
}

/** Producer-agnostic input. Every rec-producing branch maps its already-available
 *  fields here and calls computeOpportunityValue. All optional fields mirror the
 *  nullability of their source types (PageKeywordMap / ContentGap are all optional). */
export interface OpportunityInput {
  branch: 'quick_win' | 'ranking_opp' | 'content_gap' | 'decay' | 'technical' | 'freshness' | 'diagnostic' | 'local';
  volume?: number | null;
  impressions?: number | null;
  currentPosition?: number | null;
  cpc?: number | null;
  difficulty?: number | null;            // keyword difficulty (KD)
  intent?: 'transactional' | 'commercial' | 'informational' | 'navigational' | null;
  roiScore?: number | null;              // grounded composite (quick-win spine)
  opportunityScore?: number | null;      // grounded composite (content-gap spine)
  /** A producer-precomputed grounded weekly click delta (e.g. CTR-opportunity's
   *  estimatedClickGap). When present it is used directly as the click delta. */
  expectedClickGap?: number | null;
  trendDirection?: 'rising' | 'declining' | 'stable' | null;
  previousClicks?: number | null;        // decay
  currentClicks?: number | null;         // decay / technical traffic proxy
  isRepeatDecay?: boolean | null;        // decay tactic switch
  severity?: 'error' | 'warning' | 'info' | null;  // technical
  isCritical?: boolean | null;           // technical
  llmLabel?: 'high' | 'medium' | 'low' | null;     // demoted to a Confidence-discounted fallback
  authorityStrength?: number | null;     // referring-domains proxy (0..100); P5 sources this per-workspace
  effortDays?: number | null;            // override the per-branch default
  businessFitAlignment?: number | null;  // 0..1 semantic align vs effectiveBusinessPriorities
  /** Per-workspace position→CTR curve (server/scoring/ctr-curve.ts). Falls back to industry curve when absent. */
  ctrCurve?: Record<number, number> | null;
  /** Sum of decaying timing boosts over active opportunity events (P7). Default 0. */
  timingBoost?: number | null;
  /** SEO Gen-Quality P7.1 — local-visibility urgency signal (0..1). A `not_visible`
   *  local-pack posture in a high-intent market raises urgency. ONLY ever fed from the
   *  `useLocalGenQual` local rec branches (server/recommendations.ts) — the scorer never
   *  reads local state itself. Default/absent → 0 → identity multiplier, so the OV value
   *  is byte-identical for every non-local / flag-OFF rec (mirrors the reserved `timing`
   *  term). See server/scoring/opportunity-value.ts `localUrgency`. */
  localVisibilitySignal?: number | null;
}

/** Per-workspace calibrated dimension weights (P5 workspace_opportunity_weights). */
export interface OpportunityWeights {
  demand: number;
  winnability: number;
  intent: number;
  effort: number;
  businessFit: number;
  timing: number;
  evidence: number;
  calibrationVersion: string;
}

/** One entry in a recommendation discussion thread (spec §6.7). Backed by the rec_discussion
 *  table (migration 138). `author` is a display role, not a user id — 'client' (the client's
 *  question) or 'strategist' (the agency reply). Read by the cockpit Discuss filter (P2) and
 *  the client CuratedRecDiscussThread (P4); both build against THIS shape before the substrate
 *  exists (the pre-committed Track-B↔Track-C contract). */
export interface RecDiscussionEntry {
  id: string;
  recId: string;
  workspaceId: string;
  author: 'client' | 'strategist';
  body: string;
  createdAt: string;        // ISO timestamp
}

/** Strategy v3 — the payload an adapter emits to turn a domain item (keyword opportunity,
 *  topic cluster, content gap) INTO a sendable recommendation via the per-row Send spine.
 *  P5 Lane 5C (#6b) builds the keyword-opportunity adapter against this; the policy registry
 *  (below) decides routing (rec vs deliverable) per RecType. Net-new — zero prior matches. */
export interface StrategyRecommendationPayload {
  type: RecType;
  title: string;
  description: string;
  insight: string;                        // "why this matters" — feeds the curated card's why-line
  affectedPages: string[];
  /** Optional pre-resolved product for the priced CTA (decision 1 — Add-to-plan only when set). */
  productType?: string;
  productPrice?: number;
  /** The source domain entity id (e.g. the keyword string or cluster topic) for de-dup + lineage. */
  sourceKey: string;
  source: string;                         // which analysis produced it (mirrors Recommendation.source)
}

/** Per-RecType curation policy (spec §6.2 single-writer policy registry). One entry per RecType
 *  the single-writer (server/recommendation-lifecycle.ts) knows how to mutate. `sendChannel`
 *  decides whether Send mutates clientStatus directly ('rec') or routes to the deliverable spine
 *  ('deliverable' — content_decay/cannibalization read lifecycle from client_actions, spec §6.3).
 *  `cascadeOnStrike` marks RecTypes whose strike also removes strategy items (keyword/topic). */
export interface RecPolicy {
  sendChannel: 'rec' | 'deliverable';
  cascadeOnStrike: boolean;
  /** True when this RecType resolves a productType → a priced Add-to-plan CTA is allowed. */
  monetizable: boolean;
}

/** The registry shape the single-writer consumes. Keyed by RecType; an unlisted RecType is a
 *  bug (it cannot be curated until a policy is registered). Populated in P1 Lane 1B. */
export type RecPolicyRegistry = Partial<Record<RecType, RecPolicy>>;
