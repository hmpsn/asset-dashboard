/**
 * Unit tests for server/outcome-playbooks.ts
 *
 * Tests: getPlaybooks, detectPlaybookPatterns, suggestPlaybook.
 * Uses real SQLite DB, seedWorkspace fixtures, and recordAction/recordOutcome for test data.
 * No HTTP server, no createTestContext, no port needed.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

// ── Dependency mocks ──────────────────────────────────────────────────────────
// Suppress async side-effects from bridges and broadcasts.
vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: vi.fn(),
  withWorkspaceLock: vi.fn(async (_wsId: string, fn: () => unknown) => fn()),
  debouncedOutcomeReweight: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    ANNOTATION_BRIDGE_CREATED: 'annotation_bridge_created',
    OUTCOME_SCORED: 'outcome_scored',
    OUTCOME_PLAYBOOK_DISCOVERED: 'outcome:playbook',
  },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../server/helpers.js', () => ({
  toInsightPageId: (url: string) => url,
}));

vi.mock('../../server/insight-score-adjustments.js', () => ({
  applyScoreAdjustment: vi.fn((data: unknown, score: number, _type: string, delta: number) => ({
    data,
    adjustedScore: score + delta,
  })),
}));

// ── Import the modules under test AFTER mocks ──────────────────────────────────
import {
  getPlaybooks,
  detectPlaybookPatterns,
  suggestPlaybook,
} from '../../server/outcome-playbooks.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import type { BaselineSnapshot, DeltaSummary } from '../../shared/types/outcome-tracking.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const BASELINE: BaselineSnapshot = {
  captured_at: '2026-01-01T00:00:00Z',
  clicks: 100,
  impressions: 2000,
  ctr: 5.0,
  position: 12.5,
};

const WIN_DELTA: DeltaSummary = {
  primary_metric: 'clicks',
  baseline_value: 100,
  current_value: 150,
  delta_absolute: 50,
  delta_percent: 50,
  direction: 'improved',
};

const NEUTRAL_DELTA: DeltaSummary = {
  primary_metric: 'clicks',
  baseline_value: 100,
  current_value: 102,
  delta_absolute: 2,
  delta_percent: 2,
  direction: 'stable',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Monotonically increasing timestamp offset so sequential inserts have distinct created_at values.
let _tsOffset = 0;
function nextTs(): string {
  _tsOffset += 1000; // increment by 1 second per call
  return new Date(Date.now() - 1_000_000 + _tsOffset).toISOString();
}

/**
 * Insert a tracked action directly via DB with an explicit created_at timestamp.
 * This ensures chronological ordering is deterministic even when two actions are
 * inserted for the same page in the same test.
 */
function insertActionWithTs(
  workspaceId: string,
  pageUrl: string,
  actionType: Parameters<typeof recordAction>[0]['actionType'],
  createdAt: string,
) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tracked_actions (id, workspace_id, action_type, source_type, source_id, page_url,
      target_keyword, baseline_snapshot, trailing_history, attribution, measurement_window,
      source_flag, baseline_confidence, context, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    actionType,
    'test',
    null,
    pageUrl,
    null,
    JSON.stringify({ captured_at: createdAt }),
    JSON.stringify({ metric: '', dataPoints: [] }),
    'platform_executed',
    90,
    'live',
    'exact',
    JSON.stringify({ seasonalTag: { month: 1, quarter: 1 } }),
    createdAt,
    createdAt,
  );
  return id;
}

/**
 * Create a tracked action for a workspace+page pair with no outcome (no win).
 */
function createAction(
  workspaceId: string,
  pageUrl: string,
  actionType: Parameters<typeof recordAction>[0]['actionType'] = 'meta_updated',
) {
  return recordAction({
    attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
    workspaceId,
    actionType,
    sourceType: 'test',
    pageUrl,
    baselineSnapshot: BASELINE,
  });
}

/**
 * Helper: insert N pages each with the same 2-action sequence on a workspace.
 * Actions get distinct created_at timestamps so sort-by-created_at is deterministic.
 * actionA is always "first" (earlier timestamp), actionB is "second".
 */
function createMultiActionPages(
  workspaceId: string,
  count: number,
  pageBase = 'https://example.com/page',
  actionA: Parameters<typeof recordAction>[0]['actionType'] = 'content_published',
  actionB: Parameters<typeof recordAction>[0]['actionType'] = 'internal_link_added',
  withWin = false,
) {
  for (let i = 0; i < count; i++) {
    const pageUrl = `${pageBase}-${i}`;
    const tsA = nextTs();
    const tsB = nextTs(); // guaranteed later than tsA
    insertActionWithTs(workspaceId, pageUrl, actionA, tsA);
    const secondId = insertActionWithTs(workspaceId, pageUrl, actionB, tsB);
    if (withWin) {
      // Record a win on the second action and mark complete
      recordOutcome({
        actionId: secondId,
        checkpointDays: 90,
        metricsSnapshot: BASELINE,
        score: 'win',
        deltaSummary: WIN_DELTA,
      });
    }
  }
}

/**
 * Clean all tracked_actions, action_outcomes, and action_playbooks for a workspace.
 */
function cleanWorkspace(workspaceId: string) {
  db.prepare(
    `DELETE FROM action_outcomes WHERE action_id IN (
       SELECT id FROM tracked_actions WHERE workspace_id = ?
     )`,
  ).run(workspaceId);
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM action_playbooks WHERE workspace_id = ?').run(workspaceId);
}

// ── getPlaybooks ──────────────────────────────────────────────────────────────

describe('getPlaybooks', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  it('returns an empty array for a workspace with no playbooks', () => {
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toEqual([]);
  });

  it('returns a playbook after direct DB insert, correctly mapped', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test-pb-001',
      ws.workspaceId,
      'content published → internal link added',
      'content_published',
      JSON.stringify([{ actionType: 'content_published' }, { actionType: 'internal_link_added' }]),
      0.75,
      8,
      'medium',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.75, avgDaysToResult: 0 }),
      1,
      now,
      now,
    );

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);

    const pb = playbooks[0];
    expect(pb.id).toBe('test-pb-001');
    expect(pb.workspaceId).toBe(ws.workspaceId);
    expect(pb.name).toBe('content published → internal link added');
    expect(pb.triggerCondition).toBe('content_published');
    expect(pb.historicalWinRate).toBe(0.75);
    expect(pb.sampleSize).toBe(8);
    expect(pb.confidence).toBe('medium');
    expect(pb.enabled).toBe(true);
    expect(pb.actionSequence).toHaveLength(2);
    expect(pb.actionSequence[0].actionType).toBe('content_published');
    expect(pb.actionSequence[1].actionType).toBe('internal_link_added');
  });

  it('returns playbooks sorted by historical_win_rate DESC', () => {
    const now = new Date().toISOString();
    // Insert two more playbooks with different win rates
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test-pb-002',
      ws.workspaceId,
      'meta updated → schema deployed',
      'meta_updated',
      JSON.stringify([{ actionType: 'meta_updated' }, { actionType: 'schema_deployed' }]),
      0.90,
      12,
      'high',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.9, avgDaysToResult: 0 }),
      1,
      now,
      now,
    );
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test-pb-003',
      ws.workspaceId,
      'audit fix applied → voice calibrated',
      'audit_fix_applied',
      JSON.stringify([{ actionType: 'audit_fix_applied' }, { actionType: 'voice_calibrated' }]),
      0.40,
      4,
      'low',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.4, avgDaysToResult: 0 }),
      1,
      now,
      now,
    );

    const playbooks = getPlaybooks(ws.workspaceId);
    // Should be sorted DESC by historical_win_rate: 0.90, 0.75, 0.40
    expect(playbooks.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < playbooks.length - 1; i++) {
      expect(playbooks[i].historicalWinRate).toBeGreaterThanOrEqual(playbooks[i + 1].historicalWinRate);
    }
  });

  it('maps enabled=0 to false in returned playbook', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test-pb-disabled',
      ws.workspaceId,
      'disabled playbook',
      'content_refreshed',
      JSON.stringify([{ actionType: 'content_refreshed' }]),
      0.3,
      3,
      'low',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.3, avgDaysToResult: 0 }),
      0, // disabled
      now,
      now,
    );

    const playbooks = getPlaybooks(ws.workspaceId);
    const disabled = playbooks.find(p => p.id === 'test-pb-disabled');
    expect(disabled).toBeDefined();
    expect(disabled!.enabled).toBe(false);
  });
});

// ── detectPlaybookPatterns — threshold tests ──────────────────────────────────

describe('detectPlaybookPatterns — threshold: < 3 multi-action pages → { discovered: 0 }', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('returns { discovered: 0 } with no actions at all', () => {
    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });

  it('returns { discovered: 0 } with only 1 action (single page, single action)', () => {
    createAction(ws.workspaceId, 'https://example.com/page-a');
    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });

  it('returns { discovered: 0 } when 2 different pages each have only 1 action', () => {
    // 2 pages, 1 action each → 0 multi-action pages
    createAction(ws.workspaceId, 'https://example.com/page-a', 'meta_updated');
    createAction(ws.workspaceId, 'https://example.com/page-b', 'meta_updated');
    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });

  it('returns { discovered: 0 } when 1 page has 2 actions (only 1 multi-action page)', () => {
    createAction(ws.workspaceId, 'https://example.com/page-a', 'content_published');
    createAction(ws.workspaceId, 'https://example.com/page-a', 'internal_link_added');
    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });

  it('returns { discovered: 0 } when 2 pages each have 2 actions (need at least 3 multi-action pages)', () => {
    createMultiActionPages(ws.workspaceId, 2);
    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });

  it('returns { discovered: 0 } when actions have no pageUrl (all skipped)', () => {
    // Actions without pageUrl are skipped in grouping
    for (let i = 0; i < 5; i++) {
      recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'test',
        pageUrl: null,
        baselineSnapshot: BASELINE,
      });
    }
    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });
});

describe('detectPlaybookPatterns — threshold: sequence count < 3 → not stored', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('returns { discovered: 0 } when sequence appears only once across 3+ multi-action pages', () => {
    // 3 multi-action pages but each has a DIFFERENT sequence
    createAction(ws.workspaceId, 'https://example.com/page-a', 'content_published');
    createAction(ws.workspaceId, 'https://example.com/page-a', 'internal_link_added');

    createAction(ws.workspaceId, 'https://example.com/page-b', 'meta_updated');
    createAction(ws.workspaceId, 'https://example.com/page-b', 'schema_deployed');

    createAction(ws.workspaceId, 'https://example.com/page-c', 'audit_fix_applied');
    createAction(ws.workspaceId, 'https://example.com/page-c', 'voice_calibrated');

    const result = detectPlaybookPatterns(ws.workspaceId);
    // Each sequence appears exactly once — below threshold of 3
    expect(result).toEqual({ discovered: 0 });
  });

  it('returns { discovered: 0 } when sequence appears exactly 2 times (below count >= 3 threshold)', () => {
    // 3 multi-action pages: 2 share one sequence, 1 has a different sequence
    createAction(ws.workspaceId, 'https://example.com/page-a', 'content_published');
    createAction(ws.workspaceId, 'https://example.com/page-a', 'internal_link_added');

    createAction(ws.workspaceId, 'https://example.com/page-b', 'content_published');
    createAction(ws.workspaceId, 'https://example.com/page-b', 'internal_link_added');

    createAction(ws.workspaceId, 'https://example.com/page-c', 'meta_updated');
    createAction(ws.workspaceId, 'https://example.com/page-c', 'schema_deployed');

    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result).toEqual({ discovered: 0 });
  });

  it('discovers a playbook when the same 2-action sequence appears on exactly 3 pages', () => {
    // 3 multi-action pages all sharing the same sequence → count = 3 → stored
    createMultiActionPages(ws.workspaceId, 3);

    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result.discovered).toBe(1);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
  });
});

// ── detectPlaybookPatterns — confidence levels ────────────────────────────────

describe('detectPlaybookPatterns — confidence levels', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('assigns confidence=low for count in [3, 4]', () => {
    createMultiActionPages(ws.workspaceId, 3);
    detectPlaybookPatterns(ws.workspaceId);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('low');
    expect(playbooks[0].sampleSize).toBe(3);
  });

  it('assigns confidence=low for count = 4', () => {
    createMultiActionPages(ws.workspaceId, 4);
    detectPlaybookPatterns(ws.workspaceId);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('low');
    expect(playbooks[0].sampleSize).toBe(4);
  });

  it('assigns confidence=medium for count in [5, 9]', () => {
    createMultiActionPages(ws.workspaceId, 5);
    detectPlaybookPatterns(ws.workspaceId);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('medium');
    expect(playbooks[0].sampleSize).toBe(5);
  });

  it('assigns confidence=medium for count = 9', () => {
    createMultiActionPages(ws.workspaceId, 9);
    detectPlaybookPatterns(ws.workspaceId);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('medium');
    expect(playbooks[0].sampleSize).toBe(9);
  });

  it('assigns confidence=high for count >= 10', () => {
    createMultiActionPages(ws.workspaceId, 10);
    detectPlaybookPatterns(ws.workspaceId);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('high');
    expect(playbooks[0].sampleSize).toBe(10);
  });

  it('assigns confidence=high for count > 10', () => {
    createMultiActionPages(ws.workspaceId, 12);
    detectPlaybookPatterns(ws.workspaceId);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('high');
    expect(playbooks[0].sampleSize).toBe(12);
  });
});

// ── detectPlaybookPatterns — ID determinism (upsert, not duplicate) ───────────

describe('detectPlaybookPatterns — ID determinism', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    // Create 3 pages with the same sequence
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/det', 'content_published', 'internal_link_added');
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  it('running detection twice produces the same playbook ID (upsert, not duplicate)', () => {
    const first = detectPlaybookPatterns(ws.workspaceId);
    expect(first.discovered).toBe(1);

    const playbooksAfterFirst = getPlaybooks(ws.workspaceId);
    expect(playbooksAfterFirst).toHaveLength(1);
    const firstId = playbooksAfterFirst[0].id;

    const second = detectPlaybookPatterns(ws.workspaceId);
    expect(second.discovered).toBe(1);

    const playbooksAfterSecond = getPlaybooks(ws.workspaceId);
    // Still only one playbook — no duplicate was created
    expect(playbooksAfterSecond).toHaveLength(1);
    expect(playbooksAfterSecond[0].id).toBe(firstId);
  });

  it('the playbook ID is 36 characters (sliced sha256 hex)', () => {
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].id).toHaveLength(36);
  });

  it('the ID is a hex string (no UUID dashes pattern — it is sliced hash)', () => {
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    // The ID is the first 36 chars of a sha256 hex digest — valid hex chars only
    expect(playbooks[0].id).toMatch(/^[0-9a-f]{36}$/);
  });
});

// ── detectPlaybookPatterns — win rate computation ─────────────────────────────

describe('detectPlaybookPatterns — win rate computation', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('win rate = 0 when no page has a win outcome', () => {
    // 3 pages with the same sequence, no wins
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/nw', 'meta_updated', 'schema_deployed', false);

    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].historicalWinRate).toBe(0);
  });

  it('win rate = 1 when all pages have a win outcome', () => {
    // 3 pages with the same sequence + win on each
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/aw', 'content_published', 'internal_link_added', true);

    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].historicalWinRate).toBe(1);
  });

  it('win rate = Math.round(winCount/count * 100) / 100 for partial wins', () => {
    // 3 pages, same sequence, 2 have wins → winRate = round(2/3 * 100)/100 = 0.67
    for (let i = 0; i < 3; i++) {
      const pageUrl = `https://example.com/partial-${i}`;
      const tsA = nextTs();
      const tsB = nextTs();
      insertActionWithTs(ws.workspaceId, pageUrl, 'content_refreshed', tsA);
      const secondId = insertActionWithTs(ws.workspaceId, pageUrl, 'voice_calibrated', tsB);
      if (i < 2) {
        // Win on 2 of 3 pages
        recordOutcome({ actionId: secondId, checkpointDays: 90, metricsSnapshot: BASELINE, score: 'win', deltaSummary: WIN_DELTA });
      }
    }

    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    const expected = Math.round((2 / 3) * 100) / 100;
    expect(playbooks[0].historicalWinRate).toBe(expected);
  });

  it('strong_win outcomes also count as wins in win rate computation', () => {
    // 3 pages, same sequence, 1 has strong_win → winRate should be 1/3 rounded
    for (let i = 0; i < 3; i++) {
      const pageUrl = `https://example.com/sw-${i}`;
      const tsA = nextTs();
      const tsB = nextTs();
      insertActionWithTs(ws.workspaceId, pageUrl, 'audit_fix_applied', tsA);
      const secondId = insertActionWithTs(ws.workspaceId, pageUrl, 'strategy_keyword_added', tsB);
      if (i === 0) {
        recordOutcome({ actionId: secondId, checkpointDays: 90, metricsSnapshot: BASELINE, score: 'strong_win', deltaSummary: WIN_DELTA });
      }
    }

    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    const expected = Math.round((1 / 3) * 100) / 100;
    expect(playbooks[0].historicalWinRate).toBe(expected);
  });

  it('incomplete actions (measurement_complete=0) are excluded from win counting', () => {
    // 3 pages, same sequence. One page has a 30-day 'win' outcome (not complete)
    // and two other pages have no outcomes at all.
    // Since measurement_complete=0 (30-day does NOT auto-complete), hasWin should be false for all.
    for (let i = 0; i < 3; i++) {
      const pageUrl = `https://example.com/incomplete-${i}`;
      const tsA = nextTs();
      const tsB = nextTs();
      insertActionWithTs(ws.workspaceId, pageUrl, 'brief_created', tsA);
      const secondId = insertActionWithTs(ws.workspaceId, pageUrl, 'content_published', tsB);
      if (i === 0) {
        // 30-day outcome → does NOT set measurement_complete=1
        recordOutcome({
          actionId: secondId,
          checkpointDays: 30,
          metricsSnapshot: BASELINE,
          score: 'win',
          deltaSummary: WIN_DELTA,
        });
      }
    }

    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    // measurementComplete=false → not counted as win
    expect(playbooks[0].historicalWinRate).toBe(0);
  });
});

// ── detectPlaybookPatterns — name format ─────────────────────────────────────

describe('detectPlaybookPatterns — name format', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('formats 2-action sequence name: underscores → spaces, steps joined with " → "', () => {
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/fmt', 'content_published', 'internal_link_added');
    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].name).toBe('content published → internal link added');
  });

  it('sets triggerCondition to the first action type in the sequence', () => {
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/trig', 'meta_updated', 'schema_deployed');
    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].triggerCondition).toBe('meta_updated');
  });

  it('actionSequence contains both steps with correct actionType values', () => {
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/seq', 'audit_fix_applied', 'voice_calibrated');
    detectPlaybookPatterns(ws.workspaceId);
    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].actionSequence).toHaveLength(2);
    expect(playbooks[0].actionSequence[0].actionType).toBe('audit_fix_applied');
    expect(playbooks[0].actionSequence[1].actionType).toBe('voice_calibrated');
  });
});

// ── detectPlaybookPatterns — multiple distinct sequences ─────────────────────

describe('detectPlaybookPatterns — multiple distinct sequences', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('discovers 2 distinct playbooks when 2 sequences each meet the count threshold', () => {
    // Sequence A: content_published → internal_link_added (3 pages)
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/seqa', 'content_published', 'internal_link_added');
    // Sequence B: meta_updated → schema_deployed (3 pages)
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/seqb', 'meta_updated', 'schema_deployed');

    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result.discovered).toBe(2);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(2);
    const names = playbooks.map(p => p.name);
    expect(names).toContain('content published → internal link added');
    expect(names).toContain('meta updated → schema deployed');
  });

  it('only stores sequences meeting count >= 3, skips those with fewer', () => {
    // Sequence A appears 3 times (meets threshold)
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/threshold-a', 'content_published', 'internal_link_added');
    // Sequence B appears only 2 times (below threshold) — plus 1 different page for multi-action count
    createMultiActionPages(ws.workspaceId, 2, 'https://example.com/threshold-b', 'meta_updated', 'schema_deployed');
    // Add one more page for sequence B area to keep multi-action page count >= 3 but with unique sequence
    createAction(ws.workspaceId, 'https://example.com/threshold-c', 'audit_fix_applied');
    createAction(ws.workspaceId, 'https://example.com/threshold-c', 'voice_calibrated');

    const result = detectPlaybookPatterns(ws.workspaceId);
    // Only sequence A should be stored (3 occurrences); B has 2; C has 1
    expect(result.discovered).toBe(1);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].triggerCondition).toBe('content_published');
  });
});

// ── detectPlaybookPatterns — upsert updates stats on re-run ──────────────────

describe('detectPlaybookPatterns — upsert updates fields on re-run', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  it('updates sample_size and confidence when new data makes count cross a threshold', () => {
    // Initial: 3 pages → low confidence
    createMultiActionPages(ws.workspaceId, 3, 'https://example.com/upsert', 'content_published', 'internal_link_added');
    detectPlaybookPatterns(ws.workspaceId);

    let playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('low');
    expect(playbooks[0].sampleSize).toBe(3);

    // Add 7 more pages with same sequence → count = 10 → high confidence
    createMultiActionPages(ws.workspaceId, 7, 'https://example.com/upsert-more', 'content_published', 'internal_link_added');
    detectPlaybookPatterns(ws.workspaceId);

    playbooks = getPlaybooks(ws.workspaceId);
    // Still only 1 playbook (upserted, not duplicated)
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].confidence).toBe('high');
    expect(playbooks[0].sampleSize).toBe(10);
  });
});

// ── suggestPlaybook ───────────────────────────────────────────────────────────

describe('suggestPlaybook', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(ws.workspaceId);
  });

  it('returns null when no playbooks exist for the workspace', () => {
    const result = suggestPlaybook(ws.workspaceId, 'content_published');
    expect(result).toBeNull();
  });

  it('returns null when no playbook matches the given trigger', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'suggest-pb-01',
      ws.workspaceId,
      'content published → internal link added',
      'content_published',
      JSON.stringify([{ actionType: 'content_published' }, { actionType: 'internal_link_added' }]),
      0.75,
      8,
      'medium',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.75, avgDaysToResult: 0 }),
      1,
      now,
      now,
    );

    // No playbook for 'meta_updated'
    const result = suggestPlaybook(ws.workspaceId, 'meta_updated');
    expect(result).toBeNull();
  });

  it('returns null when the matching playbook has enabled=false', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'suggest-pb-disabled',
      ws.workspaceId,
      'disabled matching playbook',
      'schema_deployed',
      JSON.stringify([{ actionType: 'schema_deployed' }]),
      0.5,
      4,
      'low',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.5, avgDaysToResult: 0 }),
      0, // disabled
      now,
      now,
    );

    const result = suggestPlaybook(ws.workspaceId, 'schema_deployed');
    expect(result).toBeNull();
  });

  it('returns the matching playbook when enabled=true and trigger matches', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'suggest-pb-active',
      ws.workspaceId,
      'meta updated → schema deployed',
      'meta_updated',
      JSON.stringify([{ actionType: 'meta_updated' }, { actionType: 'schema_deployed' }]),
      0.8,
      6,
      'medium',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.8, avgDaysToResult: 0 }),
      1, // enabled
      now,
      now,
    );

    const result = suggestPlaybook(ws.workspaceId, 'meta_updated');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('suggest-pb-active');
    expect(result!.triggerCondition).toBe('meta_updated');
    expect(result!.enabled).toBe(true);
  });

  it('returns only the enabled playbook when both an enabled and disabled playbook share the same trigger', () => {
    const now = new Date().toISOString();
    // This test validates that suggestPlaybook uses getPlaybooks (sorted DESC by win rate)
    // and finds() the first enabled match.
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'suggest-pb-conflict-enabled',
      ws.workspaceId,
      'content refreshed playbook enabled',
      'content_refreshed',
      JSON.stringify([{ actionType: 'content_refreshed' }, { actionType: 'meta_updated' }]),
      0.6,
      5,
      'medium',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.6, avgDaysToResult: 0 }),
      1, // enabled
      now,
      now,
    );
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'suggest-pb-conflict-disabled',
      ws.workspaceId,
      'content refreshed playbook disabled',
      'content_refreshed',
      JSON.stringify([{ actionType: 'content_refreshed' }, { actionType: 'internal_link_added' }]),
      0.9, // higher win rate but disabled
      10,
      'high',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.9, avgDaysToResult: 0 }),
      0, // disabled
      now,
      now,
    );

    const result = suggestPlaybook(ws.workspaceId, 'content_refreshed');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('suggest-pb-conflict-enabled');
    expect(result!.enabled).toBe(true);
  });
});

// ── Workspace isolation ───────────────────────────────────────────────────────

describe('workspace isolation', () => {
  let wsA: SeededFullWorkspace;
  let wsB: SeededFullWorkspace;

  beforeAll(() => {
    wsA = seedWorkspace();
    wsB = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(wsA.workspaceId);
    cleanWorkspace(wsB.workspaceId);
    wsA.cleanup();
    wsB.cleanup();
  });

  afterEach(() => {
    cleanWorkspace(wsA.workspaceId);
    cleanWorkspace(wsB.workspaceId);
  });

  it('detectPlaybookPatterns(wsA) does not discover patterns from wsB data', () => {
    // wsB has 10 pages with the same sequence → would produce 'high' confidence
    createMultiActionPages(wsB.workspaceId, 10, 'https://example.com/wsb', 'content_published', 'internal_link_added');
    // wsA has no data
    const resultA = detectPlaybookPatterns(wsA.workspaceId);
    expect(resultA).toEqual({ discovered: 0 });
  });

  it('getPlaybooks(wsA) does not return playbooks belonging to wsB', () => {
    // Create a playbook for wsB via detection
    createMultiActionPages(wsB.workspaceId, 3, 'https://example.com/wsb2', 'meta_updated', 'schema_deployed');
    detectPlaybookPatterns(wsB.workspaceId);

    const playbooksB = getPlaybooks(wsB.workspaceId);
    expect(playbooksB.length).toBeGreaterThanOrEqual(1);

    // wsA should see nothing
    const playbooksA = getPlaybooks(wsA.workspaceId);
    expect(playbooksA).toHaveLength(0);
  });

  it('detectPlaybookPatterns(wsA) does not affect wsB playbooks', () => {
    // Set up wsB with a playbook
    createMultiActionPages(wsB.workspaceId, 3, 'https://example.com/wsb3', 'content_published', 'internal_link_added');
    detectPlaybookPatterns(wsB.workspaceId);
    const bBefore = getPlaybooks(wsB.workspaceId);
    expect(bBefore).toHaveLength(1);

    // Now run detection for wsA (which has no data)
    detectPlaybookPatterns(wsA.workspaceId);

    const bAfter = getPlaybooks(wsB.workspaceId);
    // wsB playbooks unchanged
    expect(bAfter).toHaveLength(1);
    expect(bAfter[0].id).toBe(bBefore[0].id);
  });

  it('suggestPlaybook(wsA) returns null even when wsB has a matching playbook', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO action_playbooks (id, workspace_id, name, trigger_condition, action_sequence,
        historical_win_rate, sample_size, confidence, average_outcome, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'isolation-pb-wsb',
      wsB.workspaceId,
      'content published → internal link added',
      'content_published',
      JSON.stringify([{ actionType: 'content_published' }, { actionType: 'internal_link_added' }]),
      0.8,
      5,
      'medium',
      JSON.stringify({ metric: 'win_rate', avgImprovement: 0.8, avgDaysToResult: 0 }),
      1,
      now,
      now,
    );

    // wsA should not see wsB's playbook
    const resultA = suggestPlaybook(wsA.workspaceId, 'content_published');
    expect(resultA).toBeNull();
  });

  it('each workspace sees only its own playbooks after independent detection runs', () => {
    // wsA: sequence A
    createMultiActionPages(wsA.workspaceId, 3, 'https://example.com/iso-a', 'meta_updated', 'schema_deployed');
    // wsB: sequence B
    createMultiActionPages(wsB.workspaceId, 3, 'https://example.com/iso-b', 'content_published', 'internal_link_added');

    detectPlaybookPatterns(wsA.workspaceId);
    detectPlaybookPatterns(wsB.workspaceId);

    const pbA = getPlaybooks(wsA.workspaceId);
    const pbB = getPlaybooks(wsB.workspaceId);

    expect(pbA).toHaveLength(1);
    expect(pbB).toHaveLength(1);

    expect(pbA.every(p => p.workspaceId === wsA.workspaceId)).toBe(true); // every-ok: length guard above
    expect(pbB.every(p => p.workspaceId === wsB.workspaceId)).toBe(true); // every-ok: length guard above

    // Verify the correct sequences ended up in each workspace
    expect(pbA[0].triggerCondition).toBe('meta_updated');
    expect(pbB[0].triggerCondition).toBe('content_published');
  });
});

// ── Integration: end-to-end detection → read back via getPlaybooks ────────────

describe('detectPlaybookPatterns — end-to-end: detected playbook survives round-trip', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });

  afterAll(() => {
    cleanWorkspace(ws.workspaceId);
    ws.cleanup();
  });

  it('detected playbook has all expected fields set correctly', () => {
    createMultiActionPages(
      ws.workspaceId,
      5,
      'https://example.com/e2e',
      'content_published',
      'internal_link_added',
      true, // with wins
    );

    const result = detectPlaybookPatterns(ws.workspaceId);
    expect(result.discovered).toBe(1);

    const playbooks = getPlaybooks(ws.workspaceId);
    expect(playbooks).toHaveLength(1);

    const pb = playbooks[0];
    expect(pb.workspaceId).toBe(ws.workspaceId);
    expect(pb.name).toBe('content published → internal link added');
    expect(pb.triggerCondition).toBe('content_published');
    expect(pb.confidence).toBe('medium');
    expect(pb.sampleSize).toBe(5);
    expect(pb.historicalWinRate).toBe(1); // all 5 pages had wins
    expect(pb.enabled).toBe(true);
    expect(pb.actionSequence).toHaveLength(2);
    expect(pb.actionSequence[0].actionType).toBe('content_published');
    expect(pb.actionSequence[1].actionType).toBe('internal_link_added');
    expect(pb.createdAt).toBeTruthy();
    expect(pb.updatedAt).toBeTruthy();
  });

  it('suggestPlaybook works end-to-end after detection', () => {
    const suggested = suggestPlaybook(ws.workspaceId, 'content_published');
    expect(suggested).not.toBeNull();
    expect(suggested!.triggerCondition).toBe('content_published');
    expect(suggested!.enabled).toBe(true);
  });
});
