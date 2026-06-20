// shared/types/outcome-tracking.ts
// Outcome Intelligence Engine — shared types for server and frontend

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
  | 'content_gap_keep';

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
export type BaselineConfidence = 'exact' | 'estimated';
export type LearningsConfidence = 'high' | 'medium' | 'low';
export type LearningsTrend = 'improving' | 'stable' | 'declining';
export type PlaybookConfidence = 'high' | 'medium' | 'low';
export type DeltaDirection = 'improved' | 'declined' | 'stable';
export type EarlySignal = 'on_track' | 'no_movement' | 'too_early';

/**
 * Single confidence/provenance source carried on EVERY client-facing outcome and money number
 * across The Issue client surface. P0 hard-codes 'estimate_ga4'; P1 graduates to
 * 'actual_reconciled' once named records reconcile the count. The render contract derives the
 * human "estimate" label + rounding precision from this field — see fmtEstimateMoney/Ratio (Lane B).
 */
export type OutcomeProvenance =
  | 'estimate_ga4'        // GA4 key-event aggregate × client lead value. Renders an "estimate" label.
  | 'actual_reconciled';  // Reconciled to call-tracking / CRM / form capture. Renders "actual".

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
  pageUrl: string | null;
  targetKeyword: string | null;
  delta: DeltaSummary;
  score: OutcomeScore;
  /** Realized dollar value of the win outcome (action_outcomes.attributed_value). NULL when no CPC data was available. */
  attributedValue: number | null;
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
}
