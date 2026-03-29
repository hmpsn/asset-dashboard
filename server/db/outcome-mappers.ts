// server/db/outcome-mappers.ts
// Row interfaces and mappers for outcome tracking tables

import { parseJsonSafe } from './json-validation.js';
import {
  baselineSnapshotSchema,
  trailingHistorySchema,
  actionContextSchema,
  deltaSummarySchema,
  competitorContextSchema,
  playbookSequenceSchema,
  playbookOutcomeSchema,
  workspaceLearningsDataSchema,
} from '../schemas/outcome-schemas.js';
import type {
  TrackedAction,
  ActionOutcome,
  ActionPlaybook,
  WorkspaceLearnings,
  BaselineSnapshot,
  TrailingHistory,
  ActionContext,
  DeltaSummary,
  PlaybookStep,
  PlaybookOutcome,
  EarlySignal,
} from '../../shared/types/outcome-tracking.js';

// --- Row interfaces (snake_case from DB) ---

export interface TrackedActionRow {
  id: string;
  workspace_id: string;
  action_type: string;
  source_type: string;
  source_id: string | null;
  page_url: string | null;
  target_keyword: string | null;
  baseline_snapshot: string;
  trailing_history: string;
  attribution: string;
  measurement_window: number;
  measurement_complete: number;
  source_flag: string;
  baseline_confidence: string;
  context: string;
  created_at: string;
  updated_at: string;
}

export interface ActionOutcomeRow {
  id: string;
  action_id: string;
  checkpoint_days: number;
  metrics_snapshot: string;
  score: string | null;
  early_signal: string | null;
  delta_summary: string;
  competitor_context: string;
  measured_at: string;
}

export interface ActionPlaybookRow {
  id: string;
  workspace_id: string;
  name: string;
  trigger_condition: string;
  action_sequence: string;
  historical_win_rate: number;
  sample_size: number;
  confidence: string;
  average_outcome: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceLearningsRow {
  id: string;
  workspace_id: string;
  learnings: string;
  computed_at: string;
}

// --- Fallbacks ---

const freshBaseline = (): BaselineSnapshot => ({ captured_at: new Date().toISOString() });
const EMPTY_HISTORY: TrailingHistory = Object.freeze({ metric: '', dataPoints: [] }) as TrailingHistory;
const EMPTY_CONTEXT: ActionContext = Object.freeze({}) as ActionContext;
const EMPTY_DELTA: DeltaSummary = Object.freeze({
  primary_metric: '',
  baseline_value: 0,
  current_value: 0,
  delta_absolute: 0,
  delta_percent: 0,
  direction: 'stable',
}) as DeltaSummary;
const EMPTY_PLAYBOOK_OUTCOME: PlaybookOutcome = Object.freeze({ metric: '', avgImprovement: 0, avgDaysToResult: 0 }) as PlaybookOutcome;

// --- Mappers ---

export function rowToTrackedAction(row: TrackedActionRow): TrackedAction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type as TrackedAction['actionType'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    pageUrl: row.page_url,
    targetKeyword: row.target_keyword,
    baselineSnapshot: parseJsonSafe(row.baseline_snapshot, baselineSnapshotSchema, freshBaseline(), { field: 'baseline_snapshot', table: 'tracked_actions' }),
    trailingHistory: parseJsonSafe(row.trailing_history, trailingHistorySchema, EMPTY_HISTORY, { field: 'trailing_history', table: 'tracked_actions' }),
    attribution: row.attribution as TrackedAction['attribution'],
    measurementWindow: row.measurement_window,
    measurementComplete: row.measurement_complete === 1,
    sourceFlag: row.source_flag as TrackedAction['sourceFlag'],
    baselineConfidence: row.baseline_confidence as TrackedAction['baselineConfidence'],
    context: parseJsonSafe(row.context, actionContextSchema, EMPTY_CONTEXT, { field: 'context', table: 'tracked_actions' }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToActionOutcome(row: ActionOutcomeRow): ActionOutcome {
  return {
    id: row.id,
    actionId: row.action_id,
    checkpointDays: row.checkpoint_days as ActionOutcome['checkpointDays'],
    metricsSnapshot: parseJsonSafe(row.metrics_snapshot, baselineSnapshotSchema, freshBaseline(), { field: 'metrics_snapshot', table: 'action_outcomes' }),
    score: (row.score as ActionOutcome['score']) ?? null,
    earlySignal: (row.early_signal as EarlySignal) ?? undefined,
    deltaSummary: parseJsonSafe(row.delta_summary, deltaSummarySchema, EMPTY_DELTA, { field: 'delta_summary', table: 'action_outcomes' }),
    competitorContext: row.competitor_context && row.competitor_context !== '{}'
      ? parseJsonSafe(row.competitor_context, competitorContextSchema, null, { field: 'competitor_context', table: 'action_outcomes' })
      : null,
    measuredAt: row.measured_at,
  };
}

export function rowToActionPlaybook(row: ActionPlaybookRow): ActionPlaybook {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    triggerCondition: row.trigger_condition,
    actionSequence: parseJsonSafe(row.action_sequence, playbookSequenceSchema, [] as PlaybookStep[], { field: 'action_sequence', table: 'action_playbooks' }),
    historicalWinRate: row.historical_win_rate,
    sampleSize: row.sample_size,
    confidence: row.confidence as ActionPlaybook['confidence'],
    averageOutcome: parseJsonSafe(row.average_outcome, playbookOutcomeSchema, EMPTY_PLAYBOOK_OUTCOME, { field: 'average_outcome', table: 'action_playbooks' }),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Schema for the subset of fields actually stored in the learnings JSON column
// (workspaceId and computedAt are stored as row columns, not inside the JSON blob)
const learningsStoredSchema = workspaceLearningsDataSchema.omit({ workspaceId: true, computedAt: true });

/**
 * Maps workspace_learnings row to WorkspaceLearnings.
 * The `learnings` JSON column contains the full computed learnings object
 * (content, strategy, technical, overall fields). We parse it and merge
 * with the row-level fields (workspaceId, computedAt).
 */
export function rowToWorkspaceLearnings(row: WorkspaceLearningsRow): WorkspaceLearnings | null {
  const parsed = parseJsonSafe(
    row.learnings,
    learningsStoredSchema.partial(),
    null,
    { field: 'learnings', table: 'workspace_learnings' },
  );
  if (!parsed) return null;
  return {
    workspaceId: row.workspace_id,
    computedAt: row.computed_at,
    confidence: parsed.confidence ?? 'low',
    totalScoredActions: parsed.totalScoredActions ?? 0,
    content: parsed.content ?? null,
    strategy: parsed.strategy ?? null,
    technical: parsed.technical ?? null,
    overall: parsed.overall ?? {
      totalWinRate: 0,
      strongWinRate: 0,
      topActionTypes: [],
      recentTrend: 'stable',
    },
  };
}
