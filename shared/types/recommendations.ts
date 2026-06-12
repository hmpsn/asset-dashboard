// ── Recommendation domain types ─────────────────────────────────

import type { ImpactBand } from './impact-band.js';

export type RecPriority = 'fix_now' | 'fix_soon' | 'fix_later' | 'ongoing';
export type RecType = 'technical' | 'content' | 'content_refresh' | 'schema' | 'metadata' | 'performance' | 'accessibility' | 'strategy' | 'aeo' | 'keyword_gap' | 'topic_cluster' | 'cannibalization' | 'local_visibility' | 'local_service_gap';
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
