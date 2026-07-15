// shared/types/outcome-tracking.ts
// Outcome Intelligence Engine — shared types for server and frontend

// R5 action catalog: every member of ActionType has a metadata entry in the
// `outcome` context of shared/types/action-catalog.ts (ACTION_CATALOG.outcome),
// verified by tests/contract/action-catalog.test.ts. This union is the source of
// truth for values — the catalog imports it and never redefines it. See
// docs/rules/action-catalog.md.
export type ActionType =
  | 'insight_acted_on'
  | 'content_published'
  | 'brief_created'
  | 'strategy_keyword_added'
  | 'schema_deployed'
  | 'audit_fix_applied'
  | 'content_refreshed'
  | 'internal_link_added'
  | 'meta_updated'
  | 'voice_calibrated'
  | 'competitor_gap_closed'
  | 'cluster_published'
  | 'cannibalization_resolved'
  | 'local_visibility_won'
  | 'local_service_added'
  // Strategy redesign P2 pre-commit (consumed in P3 Lane E) — durable `tracked_actions`
  // keep markers for the managed Topic Clusters / Content Gaps sets (delete-then-reinsert
  // tables; keep state is inferred from these tracked_actions rows, per the
  // CannibalizationTriage precedent). NOTE: `strategy_keyword_added` already exists above;
  // the `strategy_keyword_*` ACTIVITY types live in server/activity-log.ts (ActivityType),
  // NOT here.
  | 'topic_cluster_keep'
  | 'content_gap_keep'
  // Reconcile R8-PR1 (Task B13) — future GBP (Google Business Profile) review-response
  // publish seam. SHIPS DARK: server/google-business-profile-review-response-publish-job.ts
  // records this action at the moment `updateGbpReviewReply` succeeds, but the job cannot
  // actually fire in production until Google API access opens. The recording logic is
  // exercised now by tests so it is correct from day one. See
  // docs/rules/outcome-engine-stubs.md.
  | 'gbp_review_reply';

export type Attribution =
  | 'platform_executed'
  | 'externally_executed'
  | 'not_acted_on';

export type OutcomeScore =
  | 'strong_win'
  | 'win'
  | 'neutral'
  | 'loss'
  | 'insufficient_data'
  | 'inconclusive';

export type SourceFlag = 'live' | 'backfill';

/**
 * Reconcile R6 (Task B11) — the source-system kinds a tracked_actions row is
 * recorded against, as observed across the ~16 production recordAction call sites.
 * This is a SOFT/advisory union: `sourceType` on the row (and on `RecordActionParams`)
 * stays a free `string` so the generic POST /api/outcomes/:ws/actions route and any
 * future producer accept new kinds without a hard enum break. Use `KnownSourceType`
 * only where an exhaustive-ish switch benefits from the known members (e.g.
 * resolveWinTitle) — always keep a fallthrough for the `(string & {})` arm.
 *
 * Read aliases: `content_post`/`content_brief` are historical duplicates of
 * `post`/`brief` that resolveWinTitle already fans in — both kept so the type mirrors
 * the real data.
 */
export type KnownSourceType =
  | 'recommendation'
  | 'insight'
  | 'post'
  | 'content_post'
  | 'brief'
  | 'content_brief'
  | 'content_request'
  | 'client_action'
  | 'approval'
  | 'schema'
  | 'strategy'
  | 'strategy_page_keyword'
  | 'brand_voice'
  | 'content_decay'
  | 'internal_link'
  // Reconcile R8-PR1 (Task B13) recordAction seams — minted AFTER B12 wrote the
  // integrity sweep's classification, so both are added here + classified in
  // server/outcome-source-integrity-sweep-job.ts (D2). `gbp_review_response` is
  // ROW-BACKED (sourceId is a google_business_review_responses.id); `audit` is
  // NOT ROW-CHECKABLE (sourceId is the synthetic `${pageId}-${check}` fix key).
  | 'gbp_review_response'
  | 'audit';

/**
 * Advisory source-ref type. `KnownSourceType | (string & {})` keeps editor
 * autocomplete for the known kinds while still accepting any string at runtime —
 * so threading a snapshot never breaks a producer that emits an unlisted sourceType.
 */
export type SourceRef = KnownSourceType | (string & {});

/**
 * Reconcile R6 (Task B11) — the ephemeral source's IDENTITY snapshotted onto the
 * durable tracked_actions row AT WRITE TIME. Outcomes are designed to outlive their
 * sources (recommendation sets/briefs/approvals are regenerated), so this captures
 * what the source WAS when the action was recorded, letting client-facing win titles
 * resolve snapshot-first instead of degrading to a generic per-action-type label once
 * the live source is gone. All fields optional — a page-ref/self-ref source may only
 * carry a `page`, and a source with no title in scope carries neither.
 *
 * Stored in the `source_snapshot` JSON column (nullable); read via parseJsonSafe with
 * `trackedActionSourceSnapshotSchema`. The resolved title is ALSO denormalized into the
 * flat `source_label` column so the wins read path can index it without JSON parsing.
 */
export interface TrackedActionSourceSnapshot {
  /** The source's human title at record time (rec/brief/post/request/client-action title). */
  title?: string;
  /** The source kind at record time (usually mirrors the row's sourceType). */
  type?: SourceRef;
  /** The page URL/path the source targeted, when it is a page-scoped source. */
  page?: string;
}
export type BaselineConfidence = 'exact' | 'estimated';
export type LearningsConfidence = 'high' | 'medium' | 'low';
export type LearningsTrend = 'improving' | 'stable' | 'declining';
export type PlaybookConfidence = 'high' | 'medium' | 'low';
export type DeltaDirection = 'improved' | 'declined' | 'stable';
export type EarlySignal = 'on_track' | 'no_movement' | 'too_early';

/**
 * Single confidence/provenance source carried on EVERY client-facing outcome and money number
 * across The Issue client surface. P0 hard-codes 'estimate_ga4'; P1a graduates the COUNT's
 * confidence to 'measured_action' once we measure real on-site actions (operator-pinned typed
 * GA4 key-events and/or Webflow form-submission named leads); P3 graduates to 'actual_reconciled'
 * once named records reconcile to revenue. The render contract derives the human label + rounding
 * precision from this field — see fmtEstimateMoney/Ratio + resolveProvenanceRender (Lane B).
 *
 * Ordered by confidence (weakest → strongest); consumers must switch exhaustively and never add a
 * `default` that swallows a future tier.
 */
export type OutcomeProvenance =
  | 'estimate_ga4'        // GA4 key-event aggregate × client lead value. Renders an "estimate" label.
  | 'measured_action'     // P1a: a real website action we measured (GA4 key-event marked as a conversion,
                          //      or a Webflow form-submission named lead). More than an estimate; not yet
                          //      revenue-reconciled. Renders "measured" + an exact count, but the DOLLAR
                          //      figure stays estimate-banded (still count × lead value).
  | 'actual_reconciled';  // P3: reconciled to call-tracking / CRM closed-won. Renders "actual".

/**
 * Reconcile R9 (Task B15) — ADMIN-ONLY per-row coverage/provenance signal on `action_outcomes`,
 * recording how far THIS outcome's value got / how it was derived. Powers the admin coverage
 * funnel (server/outcome-coverage.ts: computeOutcomeCoverage → tracked/measured/reconciled
 * counts) and is DISTINCT from `OutcomeProvenance` above: `OutcomeProvenance` is a
 * workspace-level, computed-at-read-time confidence tier for The Issue's client-facing GA4
 * conversion-tracking maturity and is never persisted. `OutcomeCoverageProvenance` is a
 * PERSISTED, per-outcome-row column consumed only by admin surfaces (OutcomesOverview /
 * OutcomeDashboard) — never rendered client-side. The two intentionally share the
 * 'estimate_ga4' legacy-default vocabulary (the audit's naming), but must not be conflated:
 * do not import one where the other is expected.
 *
 * Funnel stages (weakest → strongest, matching computeOutcomeCoverage's tracked/measured/
 * reconciled buckets):
 */
export type OutcomeCoverageProvenance =
  | 'estimate_ga4'   // Legacy default AND the read-fallback for a NULL provenance column (a row
                     // recorded before this column existed). Counts as the base tracked/measured
                     // funnel stage — never dropped, never promoted to 'reconciled'.
  | 'measured_action' // The outcome's value was derived from a real measured action (not a bare
                      // GA4 estimate). Counts as 'measured' in the funnel.
  | 'actual_reconciled'; // The outcome's value has been reconciled to closed/actual records.
                        // Counts as 'reconciled' in the funnel — the top of the stack.

/**
 * SB-003 (UI-rebuild W1.1) — read-safe admin money-frame for the Engine/cockpit header.
 * CRON-PRECOMPUTED (mirrors return-hook-cron), NEVER computed on a hot GET: computeROI WRITES a
 * snapshot (server/roi.ts → saveSnapshot), so it must not run at render time (AD-003).
 *  - `valueAtStake` REUSES ROIData.revenueAtStake (Σ keyword upsideMonthly) — not re-derived.
 *  - `recoveredSoFar` is net-new: realized/measured outcome value to date.
 *  - `provenance` is the READ-TIME, client-facing tier that drives the estimate/measured/actual
 *    basis pill. It is `OutcomeProvenance`, NEVER `OutcomeCoverageProvenance` (that one is the
 *    admin-only per-row coverage signal above — do not conflate).
 */
export interface AdminMoneyFrame {
  /** Monthly $ unlocked if tracked keywords move toward stronger positions (= ROIData.revenueAtStake). */
  valueAtStake: number;
  /** $ already realized/measured to date (net-new derived). */
  recoveredSoFar: number;
  /** Read-time confidence tier → estimate/measured/actual pill. */
  provenance: OutcomeProvenance;
  /** ISO timestamp of the cron precompute — drives the freshness meta (AD-001). */
  precomputedAt: string;
}

/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
export interface BaselineSnapshot {
  captured_at: string;
  position?: number;
  clicks?: number;
  impressions?: number;
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr?: number;
  sessions?: number;
  /** Already a percentage. */
  bounce_rate?: number;
  /** Already a percentage. */
  engagement_rate?: number;
  conversions?: number;
  page_health_score?: number;
  rich_result_eligible?: boolean;
  rich_result_appearing?: boolean;
  voice_score?: number;
}

export interface TrailingDataPoint {
  date: string;
  value: number;
}

export interface TrailingHistory {
  metric: string;
  dataPoints: TrailingDataPoint[];
}

export interface DeltaSummary {
  primary_metric: string;
  baseline_value: number;
  current_value: number;
  delta_absolute: number;
  delta_percent: number;
  direction: DeltaDirection;
}

export interface CompetitorMovement {
  domain: string;
  keyword: string;
  positionChange: number;
  newContent?: boolean;
}

export interface CompetitorContext {
  competitorMovement?: CompetitorMovement[];
}

export interface SeasonalTag {
  month: number;
  quarter: number;
}

export interface ActionContext {
  competitorActivity?: CompetitorContext;
  seasonalTag?: SeasonalTag;
  relatedActions?: string[];
  notes?: string;
  /** Tracks consecutive positive checks before committing external-execution attribution */
  detectionChecks?: number;
}

export interface TrackedAction {
  id: string;
  workspaceId: string;
  actionType: ActionType;
  sourceType: string;
  sourceId: string | null;
  pageUrl: string | null;
  targetKeyword: string | null;
  baselineSnapshot: BaselineSnapshot;
  trailingHistory: TrailingHistory;
  attribution: Attribution;
  measurementWindow: number;
  measurementComplete: boolean;
  sourceFlag: SourceFlag;
  baselineConfidence: BaselineConfidence;
  context: ActionContext;
  /** SEO Gen-Quality P4: OV `predictedEmv` snapshotted at recordAction time (CPC-proxy
   *  placeholder, NOT real money — see OpportunityScore.predictedEmv). Admin/AI-only,
   *  never client-facing. Since A5 (audit #20) BOTH recommendation-completion paths
   *  snapshot it (live PATCH route AND the outcome-backfill rec pass, which reads it
   *  from the rec blob). null when the source carries no rec opportunity (posts,
   *  insights, legacy rows). Feeds the P6 realized-vs-predicted calibration loop
   *  (server/outcome-emv-calibration.ts). */
  predictedEmv?: number | null;
  /** Reconcile R6 (B11): the source's resolved title snapshotted at record time.
   *  Denormalized flat copy of `sourceSnapshot.title` for index-free win-title lookup.
   *  null when the write site had no source title in scope (page-ref/self-ref sources)
   *  or no `source` was threaded (legacy/pre-B11 rows). */
  sourceLabel?: string | null;
  /** Reconcile R6 (B11): the ephemeral source's identity ({ title?, type?, page? })
   *  captured at record time so client win titles resolve snapshot-first and stop
   *  degrading to a generic label when the live source is regenerated. null when no
   *  `source` was threaded. See TrackedActionSourceSnapshot + docs/adr/0008. */
  sourceSnapshot?: TrackedActionSourceSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionOutcome {
  id: string;
  actionId: string;
  checkpointDays: 7 | 30 | 60 | 90;
  metricsSnapshot: BaselineSnapshot;
  score: OutcomeScore | null;
  earlySignal?: EarlySignal;
  deltaSummary: DeltaSummary;
  competitorContext: CompetitorContext | null;
  measuredAt: string;
  /** Dollar value attributed to this outcome (clicks_delta × page CPC). NULL when inconclusive or no CPC data. */
  attributedValue: number | null;
  /** Describes how attributedValue was computed (e.g. 'clicks_delta_x_cpc'). NULL when attributedValue is NULL. */
  valueBasis: string | null;
  /**
   * Reconcile R9 (Task B15) — ADMIN-ONLY coverage-funnel signal: how far this outcome's value
   * got / how it was derived (see OutcomeCoverageProvenance doc). NULL for rows recorded before
   * this column existed (or when the write site did not thread a value) — computeOutcomeCoverage()
   * treats NULL as the 'estimate_ga4' read-fallback. Never rendered client-side.
   */
  provenance: OutcomeCoverageProvenance | null;
}

/**
 * Reconcile R9 (Task B15) — ADMIN-ONLY outcome coverage funnel response shape, shared between
 * server/outcome-coverage.ts (computeOutcomeCoverage) and src/api/outcomes.ts. `tracked` is the
 * total outcome row count for the workspace (every row reaches at least this stage); `measured`
 * and `reconciled` are inclusive of the stronger stage they gate (reconciled rows also count as
 * measured). Never rendered on a client-facing surface.
 */
export interface OutcomeCoverage {
  tracked: number;
  measured: number;
  reconciled: number;
}

export interface PlaybookStep {
  actionType: ActionType;
  timing?: string;
  detail?: string;
}

export interface PlaybookOutcome {
  metric: string;
  avgImprovement: number;
  avgDaysToResult: number;
}

export interface ActionPlaybook {
  id: string;
  workspaceId: string;
  name: string;
  triggerCondition: string;
  actionSequence: PlaybookStep[];
  historicalWinRate: number;
  sampleSize: number;
  confidence: PlaybookConfidence;
  averageOutcome: PlaybookOutcome;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScoringThreshold {
  strong_win: number;
  win: number;
  neutral_band: number;
}

export interface ScoringConfigEntry {
  primary_metric: string;
  thresholds: ScoringThreshold;
}

export type ScoringConfig = Record<ActionType, ScoringConfigEntry>;

export interface ContentLearnings {
  winRateByFormat: Record<string, number>;
  avgDaysToPage1: number | null;
  bestPerformingTopics: string[];
  optimalWordCount: { min: number; max: number } | null;
  refreshRecoveryRate: number;
  voiceScoreCorrelation: number | null;
}

export interface StrategyLearnings {
  winRateByDifficultyRange: Record<string, number>;
  winRateByCheckpoint: Record<string, number>;
  bestIntentTypes: string[];
  keywordVolumeSweetSpot: { min: number; max: number } | null;
}

export interface TechnicalLearnings {
  winRateByFixType: Record<string, number>;
  schemaTypesWithRichResults: string[];
  avgHealthScoreImprovement: number;
  internalLinkEffectiveness: number;
}

export interface OverallLearnings {
  totalWinRate: number;
  strongWinRate: number;
  topActionTypes: Array<{ type: string; winRate: number; count: number }>;
  recentTrend: LearningsTrend;
}

export interface WorkspaceLearnings {
  workspaceId: string;
  computedAt: string;
  confidence: LearningsConfidence;
  totalScoredActions: number;
  content: ContentLearnings | null;
  strategy: StrategyLearnings | null;
  technical: TechnicalLearnings | null;
  overall: OverallLearnings;
}

// --- API Response types ---

export interface OutcomeScorecard {
  overallWinRate: number;
  strongWinRate: number;
  totalTracked: number;
  totalScored: number;
  pendingMeasurement: number;
  byCategory: Array<{
    actionType: ActionType;
    winRate: number;
    count: number;
    scored: number;
  }>;
  trend: LearningsTrend;
}

export interface TopWin {
  actionId: string;
  actionType: ActionType;
  /** Source system the action originated from (e.g. 'recommendation', 'insight', 'post'). */
  sourceType: string;
  /** Id within the source system; used to resolve the real source title for client display. */
  sourceId: string | null;
  /** R6 (B11): the source's title snapshotted at record time. Resolution is snapshot-FIRST:
   *  when present, resolveWinTitle uses this before the (possibly-stale) live lookup, so a
   *  regenerated/deleted source no longer degrades the win to a generic label. null/absent
   *  for legacy/pre-B11 rows or sources that carried no title. Optional to keep this an
   *  expand-only change — the real producer (getTopWinsFromActions) always sets it, and
   *  every consumer reads it defensively (`win.sourceLabel?.trim()`). */
  sourceLabel?: string | null;
  pageUrl: string | null;
  targetKeyword: string | null;
  delta: DeltaSummary;
  score: OutcomeScore;
  /** Realized dollar value of the win outcome (action_outcomes.attributed_value). NULL when no CPC data was available. */
  attributedValue: number | null;
  /** Reconcile C4 — the honest execution attribution carried through from the tracked
   *  action so client-facing surfaces can frame the win truthfully (e.g.
   *  `externally_executed` must NOT read as "we shipped it"). `not_acted_on` never
   *  reaches a wins surface (getTopWinsFromActions filters it), but the field is on the
   *  full union so consumers switch exhaustively. Expand-only, mirroring `sourceLabel`. */
  attribution: Attribution;
  createdAt: string;
  scoredAt: string;
}

/** Client-facing "we called it" win entry for outcome API routes and the WinsSurface component. */
export interface OutcomeWinEntry {
  actionId: string;
  actionType: ActionType;
  pageUrl: string | null;
  targetKeyword: string | null;
  /** Real source title (recommendation/post/brief/etc.) when resolvable; otherwise an honest generic action label. */
  recommendation: string;
  delta: DeltaSummary;
  score: OutcomeScore;
  /** Realized dollar value of the win outcome. NULL when no CPC data was available. */
  attributedValue: number | null;
  /** Reconcile C4 — honest execution attribution carried through from the tracked action.
   *  WinsSurface must NOT claim "we shipped/built" for `externally_executed` rows (work done
   *  on the client's side that we flagged/called). Only `platform_executed` wins are "what we
   *  shipped". `not_acted_on` never reaches this surface (filtered upstream). */
  attribution: Attribution;
  detectedAt: string;
}

/**
 * Compact, read-back outcome verdict for admin surfaces that close the outcome
 * loop (W5.1): Strategy tab keyword rows, Keyword Hub drawer, Posts/Briefs badges.
 *
 * Built server-side from the LATEST conclusive `action_outcomes` row of a tracked
 * action (highest checkpoint, score not 'insufficient_data'/'inconclusive'). It
 * surfaces the baseline→current movement and the verdict so a UI can render a
 * single chip ("#14→#6 · Win") without re-deriving direction.
 *
 * Position semantics: `baselinePosition`/`currentPosition` are GSC/rank positions
 * where LOWER is better. `direction` is already position-aware (computed by
 * computeDelta), so consumers must NOT re-infer improvement from raw numbers —
 * trust `direction`.
 */
export interface OutcomeReadback {
  actionId: string;
  actionType: ActionType;
  /** Verdict for the latest conclusive checkpoint. */
  score: OutcomeScore;
  /** Checkpoint (days) the verdict was measured at (7/30/60/90). */
  checkpointDays: 7 | 30 | 60 | 90;
  /** Primary metric the verdict scored on (e.g. 'position', 'clicks'). */
  primaryMetric: string;
  /** Position-aware movement direction. Trust this over raw position math. */
  direction: DeltaDirection;
  /** Baseline metric value at action time (e.g. starting position). */
  baselineValue: number;
  /** Current metric value at the measured checkpoint. */
  currentValue: number;
  /** Baseline GSC/rank position when the primary metric is position-based; else null. */
  baselinePosition: number | null;
  /** Current GSC/rank position when the primary metric is position-based; else null. */
  currentPosition: number | null;
  /** Baseline 90-day clicks when captured; else null. */
  baselineClicks: number | null;
  /** Current clicks at the measured checkpoint; else null. */
  currentClicks: number | null;
  /** ISO timestamp the verdict was measured. */
  measuredAt: string;
}

export interface WorkspaceOutcomeOverview {
  workspaceId: string;
  workspaceName: string;
  winRate: number;
  trend: LearningsTrend;
  activeActions: number;
  scoredLast30d: number;
  topWin: TopWin | null;
  attentionNeeded: boolean;
  attentionReason?: string;
  /**
   * Reconcile R9 (Task B15) — ADMIN-ONLY coverage funnel summary for this workspace. Optional
   * so existing consumers of WorkspaceOutcomeOverview are unaffected; OutcomesOverview.tsx is
   * the only renderer. Never surfaced client-side.
   */
  coverage?: OutcomeCoverage;
}
