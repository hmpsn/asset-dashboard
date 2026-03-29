// server/schemas/outcome-schemas.ts
// Zod schemas for all Outcome Intelligence Engine JSON columns

import { z } from '../middleware/validate.js';

// --- Action Type enum for Zod ---
export const actionTypeEnum = z.enum([
  'insight_acted_on', 'content_published', 'brief_created',
  'strategy_keyword_added', 'schema_deployed', 'audit_fix_applied',
  'content_refreshed', 'internal_link_added', 'meta_updated',
  'voice_calibrated',
]);

export const attributionEnum = z.enum([
  'platform_executed', 'externally_executed', 'not_acted_on',
]);

export const outcomeScoreEnum = z.enum([
  'strong_win', 'win', 'neutral', 'loss', 'insufficient_data', 'inconclusive',
]);

export const earlySignalEnum = z.enum(['on_track', 'no_movement', 'too_early']);

// --- Baseline Snapshot ---
export const baselineSnapshotSchema = z.object({
  captured_at: z.string(),
  position: z.number().optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
  /** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: z.number().optional(),
  sessions: z.number().optional(),
  /** Already a percentage. */
  bounce_rate: z.number().optional(),
  /** Already a percentage. */
  engagement_rate: z.number().optional(),
  conversions: z.number().optional(),
  page_health_score: z.number().min(0).max(100).optional(),
  rich_result_eligible: z.boolean().optional(),
  rich_result_appearing: z.boolean().optional(),
  voice_score: z.number().min(0).max(100).optional(),
});

// --- Trailing History ---
export const trailingDataPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

export const trailingHistorySchema = z.object({
  metric: z.string(),
  dataPoints: z.array(trailingDataPointSchema),
});

// --- Delta Summary ---
export const deltaSummarySchema = z.object({
  primary_metric: z.string(),
  baseline_value: z.number(),
  current_value: z.number(),
  delta_absolute: z.number(),
  delta_percent: z.number(),
  direction: z.enum(['improved', 'declined', 'stable']),
});

// --- Competitor Context ---
export const competitorMovementSchema = z.object({
  domain: z.string(),
  keyword: z.string(),
  positionChange: z.number(),
  newContent: z.boolean().optional(),
});

export const competitorContextSchema = z.object({
  competitorMovement: z.array(competitorMovementSchema).optional(),
});

// --- Action Context ---
export const seasonalTagSchema = z.object({
  month: z.number().min(1).max(12),
  quarter: z.number().min(1).max(4),
});

export const actionContextSchema = z.object({
  competitorActivity: competitorContextSchema.optional(),
  seasonalTag: seasonalTagSchema.optional(),
  relatedActions: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// --- Playbook Schemas ---
export const playbookStepSchema = z.object({
  actionType: actionTypeEnum,
  timing: z.string().optional(),
  detail: z.string().optional(),
});

export const playbookSequenceSchema = z.array(playbookStepSchema);

export const playbookOutcomeSchema = z.object({
  metric: z.string(),
  avgImprovement: z.number(),
  avgDaysToResult: z.number(),
});

// --- Workspace Learnings ---
export const contentLearningsSchema = z.object({
  winRateByFormat: z.record(z.string(), z.number()),
  avgDaysToPage1: z.number().nullable(),
  bestPerformingTopics: z.array(z.string()),
  optimalWordCount: z.object({ min: z.number(), max: z.number() }).nullable(),
  refreshRecoveryRate: z.number(),
  voiceScoreCorrelation: z.number().nullable(),
});

export const strategyLearningsSchema = z.object({
  winRateByDifficultyRange: z.record(z.string(), z.number()),
  avgTimeToRank: z.record(z.string(), z.number()),
  bestIntentTypes: z.array(z.string()),
  keywordVolumeSweetSpot: z.object({ min: z.number(), max: z.number() }).nullable(),
});

export const technicalLearningsSchema = z.object({
  winRateByFixType: z.record(z.string(), z.number()),
  schemaTypesWithRichResults: z.array(z.string()),
  avgHealthScoreImprovement: z.number(),
  internalLinkEffectiveness: z.number(),
});

export const overallLearningsSchema = z.object({
  totalWinRate: z.number(),
  strongWinRate: z.number(),
  topActionTypes: z.array(z.object({
    type: z.string(),
    winRate: z.number(),
    count: z.number(),
  })),
  recentTrend: z.enum(['improving', 'stable', 'declining']),
});

export const workspaceLearningsDataSchema = z.object({
  workspaceId: z.string(),
  computedAt: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  totalScoredActions: z.number(),
  content: contentLearningsSchema.nullable(),
  strategy: strategyLearningsSchema.nullable(),
  technical: technicalLearningsSchema.nullable(),
  overall: overallLearningsSchema,
});

// --- Scoring Config ---
export const scoringThresholdSchema = z.object({
  strong_win: z.number(),
  win: z.number(),
  neutral_band: z.number(),
});

export const scoringConfigEntrySchema = z.object({
  primary_metric: z.string(),
  thresholds: scoringThresholdSchema,
});

export const scoringConfigSchema = z.record(actionTypeEnum, scoringConfigEntrySchema);
// z.record() does not support .partial(); override schema allows any subset of action types
export const scoringConfigOverrideSchema = z.record(actionTypeEnum, scoringConfigEntrySchema.partial());
