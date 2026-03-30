/**
 * Unit tests for server/db/outcome-mappers.ts — row-to-domain mappers for outcome tracking.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  rowToTrackedAction,
  rowToActionOutcome,
  rowToActionPlaybook,
  rowToWorkspaceLearnings,
} from '../../server/db/outcome-mappers.js';
import type {
  TrackedActionRow,
  ActionOutcomeRow,
  ActionPlaybookRow,
  WorkspaceLearningsRow,
} from '../../server/db/outcome-mappers.js';

// Mock the logger
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// --- rowToTrackedAction ---

describe('rowToTrackedAction', () => {
  const baselineSnapshot = JSON.stringify({
    captured_at: '2026-01-01T00:00:00Z',
    clicks: 120,
    impressions: 2000,
    ctr: 6.0,
    position: 4.2,
  });

  const trailingHistory = JSON.stringify({
    metric: 'clicks',
    dataPoints: [
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-08', value: 120 },
    ],
  });

  const context = JSON.stringify({
    notes: 'Updated title tag',
    relatedActions: ['action-abc'],
  });

  const fullRow: TrackedActionRow = {
    id: 'ta-001',
    workspace_id: 'ws-test',
    action_type: 'meta_updated',
    source_type: 'insight',
    source_id: 'insight-xyz',
    page_url: 'https://example.com/page',
    target_keyword: 'best seo tool',
    baseline_snapshot: baselineSnapshot,
    trailing_history: trailingHistory,
    attribution: 'platform_executed',
    measurement_window: 90,
    measurement_complete: 0,
    source_flag: 'live',
    baseline_confidence: 'exact',
    context,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
  };

  it('maps scalar fields correctly', () => {
    const result = rowToTrackedAction(fullRow);
    expect(result.id).toBe('ta-001');
    expect(result.workspaceId).toBe('ws-test');
    expect(result.actionType).toBe('meta_updated');
    expect(result.sourceType).toBe('insight');
    expect(result.sourceId).toBe('insight-xyz');
    expect(result.pageUrl).toBe('https://example.com/page');
    expect(result.targetKeyword).toBe('best seo tool');
    expect(result.attribution).toBe('platform_executed');
    expect(result.measurementWindow).toBe(90);
    expect(result.sourceFlag).toBe('live');
    expect(result.baselineConfidence).toBe('exact');
    expect(result.createdAt).toBe('2026-01-01T10:00:00Z');
    expect(result.updatedAt).toBe('2026-01-02T10:00:00Z');
  });

  it('casts measurement_complete 0 → false and 1 → true', () => {
    const incomplete = rowToTrackedAction(fullRow);
    expect(incomplete.measurementComplete).toBe(false);

    const completeRow: TrackedActionRow = { ...fullRow, measurement_complete: 1 };
    const complete = rowToTrackedAction(completeRow);
    expect(complete.measurementComplete).toBe(true);
  });

  it('parses baselineSnapshot JSON correctly', () => {
    const result = rowToTrackedAction(fullRow);
    expect(result.baselineSnapshot.captured_at).toBe('2026-01-01T00:00:00Z');
    expect(result.baselineSnapshot.clicks).toBe(120);
    expect(result.baselineSnapshot.ctr).toBe(6.0);
  });

  it('parses trailingHistory JSON correctly', () => {
    const result = rowToTrackedAction(fullRow);
    expect(result.trailingHistory.metric).toBe('clicks');
    expect(result.trailingHistory.dataPoints).toHaveLength(2);
    expect(result.trailingHistory.dataPoints[0].value).toBe(100);
  });

  it('parses context JSON correctly', () => {
    const result = rowToTrackedAction(fullRow);
    expect(result.context.notes).toBe('Updated title tag');
    expect(result.context.relatedActions).toEqual(['action-abc']);
  });

  it('falls back to EMPTY_BASELINE when baseline_snapshot is empty JSON object', () => {
    const row: TrackedActionRow = { ...fullRow, baseline_snapshot: '{}' };
    const result = rowToTrackedAction(row);
    // EMPTY_BASELINE has captured_at set but no metrics
    expect(typeof result.baselineSnapshot.captured_at).toBe('string');
    expect(result.baselineSnapshot.clicks).toBeUndefined();
  });

  it('falls back to EMPTY_HISTORY when trailing_history is invalid JSON', () => {
    const row: TrackedActionRow = { ...fullRow, trailing_history: '{bad json' };
    const result = rowToTrackedAction(row);
    expect(result.trailingHistory.metric).toBe('');
    expect(result.trailingHistory.dataPoints).toEqual([]);
  });

  it('falls back to EMPTY_CONTEXT when context is empty JSON object', () => {
    const row: TrackedActionRow = { ...fullRow, context: '{}' };
    const result = rowToTrackedAction(row);
    expect(result.context).toEqual({});
  });

  it('handles null sourceId and pageUrl', () => {
    const row: TrackedActionRow = { ...fullRow, source_id: null, page_url: null, target_keyword: null };
    const result = rowToTrackedAction(row);
    expect(result.sourceId).toBeNull();
    expect(result.pageUrl).toBeNull();
    expect(result.targetKeyword).toBeNull();
  });
});

// --- rowToActionOutcome ---

describe('rowToActionOutcome', () => {
  const metricsSnapshot = JSON.stringify({
    captured_at: '2026-02-01T00:00:00Z',
    clicks: 180,
    impressions: 2800,
  });

  const deltaSummary = JSON.stringify({
    primary_metric: 'clicks',
    baseline_value: 120,
    current_value: 180,
    delta_absolute: 60,
    delta_percent: 50,
    direction: 'improved',
  });

  const competitorContext = JSON.stringify({
    competitorMovement: [
      { domain: 'competitor.com', keyword: 'best seo tool', positionChange: -2 },
    ],
  });

  const fullRow: ActionOutcomeRow = {
    id: 'ao-001',
    action_id: 'ta-001',
    checkpoint_days: 30,
    metrics_snapshot: metricsSnapshot,
    score: 'win',
    early_signal: 'on_track',
    delta_summary: deltaSummary,
    competitor_context: competitorContext,
    measured_at: '2026-02-01T12:00:00Z',
  };

  it('maps scalar fields correctly', () => {
    const result = rowToActionOutcome(fullRow);
    expect(result.id).toBe('ao-001');
    expect(result.actionId).toBe('ta-001');
    expect(result.checkpointDays).toBe(30);
    expect(result.score).toBe('win');
    expect(result.earlySignal).toBe('on_track');
    expect(result.measuredAt).toBe('2026-02-01T12:00:00Z');
  });

  it('casts checkpointDays to the correct numeric value', () => {
    const row90: ActionOutcomeRow = { ...fullRow, checkpoint_days: 90 };
    const result = rowToActionOutcome(row90);
    expect(result.checkpointDays).toBe(90);
  });

  it('parses metricsSnapshot correctly', () => {
    const result = rowToActionOutcome(fullRow);
    expect(result.metricsSnapshot.captured_at).toBe('2026-02-01T00:00:00Z');
    expect(result.metricsSnapshot.clicks).toBe(180);
  });

  it('parses deltaSummary correctly', () => {
    const result = rowToActionOutcome(fullRow);
    expect(result.deltaSummary.direction).toBe('improved');
    expect(result.deltaSummary.delta_percent).toBe(50);
    expect(result.deltaSummary.baseline_value).toBe(120);
  });

  it('parses competitorContext when present', () => {
    const result = rowToActionOutcome(fullRow);
    expect(result.competitorContext).not.toBeNull();
    const movements = result.competitorContext?.competitorMovement ?? [];
    expect(movements.length).toBeGreaterThan(0);
    expect(movements[0].domain).toBe('competitor.com');
  });

  it('returns null competitorContext when competitor_context is empty object string', () => {
    const row: ActionOutcomeRow = { ...fullRow, competitor_context: '{}' };
    const result = rowToActionOutcome(row);
    expect(result.competitorContext).toBeNull();
  });

  it('returns null competitorContext when competitor_context is empty string', () => {
    const row: ActionOutcomeRow = { ...fullRow, competitor_context: '' };
    const result = rowToActionOutcome(row);
    expect(result.competitorContext).toBeNull();
  });

  it('maps null score to null', () => {
    const row: ActionOutcomeRow = { ...fullRow, score: null };
    const result = rowToActionOutcome(row);
    expect(result.score).toBeNull();
  });

  it('maps null early_signal to undefined', () => {
    const row: ActionOutcomeRow = { ...fullRow, early_signal: null };
    const result = rowToActionOutcome(row);
    expect(result.earlySignal).toBeUndefined();
  });
});

// --- rowToActionPlaybook ---

describe('rowToActionPlaybook', () => {
  const actionSequence = JSON.stringify([
    { actionType: 'content_published', timing: 'immediate', detail: 'Publish new article' },
    { actionType: 'internal_link_added', timing: '7d', detail: 'Add internal links from related pages' },
  ]);

  const averageOutcome = JSON.stringify({
    metric: 'clicks',
    avgImprovement: 35,
    avgDaysToResult: 45,
  });

  const fullRow: ActionPlaybookRow = {
    id: 'pb-001',
    workspace_id: 'ws-test',
    name: 'Content + Links Playbook',
    trigger_condition: 'declining_impressions',
    action_sequence: actionSequence,
    historical_win_rate: 0.72,
    sample_size: 18,
    confidence: 'high',
    average_outcome: averageOutcome,
    enabled: 1,
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-02-10T00:00:00Z',
  };

  it('maps scalar fields correctly', () => {
    const result = rowToActionPlaybook(fullRow);
    expect(result.id).toBe('pb-001');
    expect(result.workspaceId).toBe('ws-test');
    expect(result.name).toBe('Content + Links Playbook');
    expect(result.triggerCondition).toBe('declining_impressions');
    expect(result.historicalWinRate).toBe(0.72);
    expect(result.sampleSize).toBe(18);
    expect(result.confidence).toBe('high');
    expect(result.createdAt).toBe('2026-01-15T00:00:00Z');
    expect(result.updatedAt).toBe('2026-02-10T00:00:00Z');
  });

  it('casts enabled 1 → true and 0 → false', () => {
    const enabled = rowToActionPlaybook(fullRow);
    expect(enabled.enabled).toBe(true);

    const disabledRow: ActionPlaybookRow = { ...fullRow, enabled: 0 };
    const disabled = rowToActionPlaybook(disabledRow);
    expect(disabled.enabled).toBe(false);
  });

  it('parses actionSequence correctly', () => {
    const result = rowToActionPlaybook(fullRow);
    expect(result.actionSequence.length).toBeGreaterThan(0);
    expect(result.actionSequence).toHaveLength(2);
    expect(result.actionSequence[0].actionType).toBe('content_published');
    expect(result.actionSequence[1].timing).toBe('7d');
  });

  it('falls back to empty array when action_sequence is invalid JSON', () => {
    const row: ActionPlaybookRow = { ...fullRow, action_sequence: '{not an array}' };
    const result = rowToActionPlaybook(row);
    expect(result.actionSequence).toEqual([]);
  });

  it('parses averageOutcome correctly', () => {
    const result = rowToActionPlaybook(fullRow);
    expect(result.averageOutcome.metric).toBe('clicks');
    expect(result.averageOutcome.avgImprovement).toBe(35);
    expect(result.averageOutcome.avgDaysToResult).toBe(45);
  });
});

// --- rowToWorkspaceLearnings ---

describe('rowToWorkspaceLearnings', () => {
  const fullLearningsBlob = JSON.stringify({
    confidence: 'medium',
    totalScoredActions: 42,
    content: {
      winRateByFormat: { 'how-to': 0.7, 'listicle': 0.55 },
      avgDaysToPage1: 38,
      bestPerformingTopics: ['seo tips', 'content strategy'],
      optimalWordCount: { min: 1200, max: 2500 },
      refreshRecoveryRate: 0.6,
      voiceScoreCorrelation: 0.4,
    },
    strategy: {
      winRateByDifficultyRange: { '0-30': 0.8, '31-60': 0.6 },
      winRateByCheckpoint: { '30d': 0.65, '60d': 0.78 },
      bestIntentTypes: ['informational', 'transactional'],
      keywordVolumeSweetSpot: { min: 500, max: 5000 },
    },
    technical: {
      winRateByFixType: { 'schema': 0.65, 'internal_link': 0.5 },
      schemaTypesWithRichResults: ['FAQPage', 'HowTo'],
      avgHealthScoreImprovement: 12,
      internalLinkEffectiveness: 0.45,
    },
    overall: {
      totalWinRate: 0.62,
      strongWinRate: 0.28,
      topActionTypes: [
        { type: 'content_published', winRate: 0.7, count: 15 },
      ],
      recentTrend: 'improving',
    },
  });

  const fullRow: WorkspaceLearningsRow = {
    id: 'wl-001',
    workspace_id: 'ws-test',
    learnings: fullLearningsBlob,
    computed_at: '2026-03-01T00:00:00Z',
  };

  it('maps workspaceId and computedAt from row fields', () => {
    const result = rowToWorkspaceLearnings(fullRow);
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe('ws-test');
    expect(result!.computedAt).toBe('2026-03-01T00:00:00Z');
  });

  it('maps confidence and totalScoredActions from learnings blob', () => {
    const result = rowToWorkspaceLearnings(fullRow);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('medium');
    expect(result!.totalScoredActions).toBe(42);
  });

  it('maps content learnings correctly', () => {
    const result = rowToWorkspaceLearnings(fullRow);
    expect(result).not.toBeNull();
    expect(result!.content).not.toBeNull();
    expect(result!.content!.avgDaysToPage1).toBe(38);
    expect(result!.content!.bestPerformingTopics.length).toBeGreaterThan(0);
    expect(result!.content!.bestPerformingTopics).toContain('seo tips');
  });

  it('maps strategy learnings correctly', () => {
    const result = rowToWorkspaceLearnings(fullRow);
    expect(result).not.toBeNull();
    expect(result!.strategy).not.toBeNull();
    expect(result!.strategy!.bestIntentTypes).toContain('informational');
  });

  it('maps technical learnings correctly', () => {
    const result = rowToWorkspaceLearnings(fullRow);
    expect(result).not.toBeNull();
    expect(result!.technical).not.toBeNull();
    expect(result!.technical!.schemaTypesWithRichResults.length).toBeGreaterThan(0);
    expect(result!.technical!.schemaTypesWithRichResults).toContain('FAQPage');
  });

  it('maps overall learnings correctly', () => {
    const result = rowToWorkspaceLearnings(fullRow);
    expect(result).not.toBeNull();
    expect(result!.overall.totalWinRate).toBe(0.62);
    expect(result!.overall.recentTrend).toBe('improving');
    expect(result!.overall.topActionTypes.length).toBeGreaterThan(0);
    expect(result!.overall.topActionTypes[0].type).toBe('content_published');
  });

  it('applies defaults when optional keys are missing from learnings blob', () => {
    const minimalBlob = JSON.stringify({ overall: { totalWinRate: 0, strongWinRate: 0, topActionTypes: [], recentTrend: 'stable' } });
    const row: WorkspaceLearningsRow = { ...fullRow, learnings: minimalBlob };
    const result = rowToWorkspaceLearnings(row);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('low');
    expect(result!.totalScoredActions).toBe(0);
    expect(result!.content).toBeNull();
    expect(result!.strategy).toBeNull();
    expect(result!.technical).toBeNull();
  });

  it('returns null for malformed JSON in learnings column', () => {
    const row: WorkspaceLearningsRow = { ...fullRow, learnings: '{invalid json' };
    const result = rowToWorkspaceLearnings(row);
    expect(result).toBeNull();
  });

  it('returns null for empty string in learnings column', () => {
    const row: WorkspaceLearningsRow = { ...fullRow, learnings: '' };
    const result = rowToWorkspaceLearnings(row);
    expect(result).toBeNull();
  });
});
