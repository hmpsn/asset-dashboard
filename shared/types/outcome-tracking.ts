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
  | 'voice_calibrated';

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
  avgTimeToRank: Record<string, number>;
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
  pageUrl: string | null;
  targetKeyword: string | null;
  delta: DeltaSummary;
  score: OutcomeScore;
  createdAt: string;
  scoredAt: string;
}

export interface WeCalledItEntry {
  actionId: string;
  actionType: ActionType;
  pageUrl: string | null;
  targetKeyword: string | null;
  recommendation: string;
  delta: DeltaSummary;
  detectedAt: string;
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
