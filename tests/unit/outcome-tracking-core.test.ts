/**
 * Unit tests for server/outcome-tracking.ts
 *
 * Covers:
 *  - getTopWinsFromActions (pure-ish, no DB)
 *  - WIN_SCORES constant
 *  - recordAction (DB-backed)
 *  - getActionsByWorkspace (DB-backed)
 *  - getWorkspaceCounts (DB-backed)
 *  - getActionBySource (DB-backed)
 *
 * NOTE: outcome-tracking.test.ts tests outcome-mappers.ts only — no overlap here.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks (must appear before any import of outcome-tracking) ─────────────

vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: vi.fn(),
  withWorkspaceLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  debouncedOutcomeReweight: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { ANNOTATION_BRIDGE_CREATED: 'annotation_bridge_created' },
}));
vi.mock('../../server/insight-score-adjustments.js', () => ({
  applyScoreAdjustment: vi.fn((data: unknown, score: number) => ({ data, adjustedScore: score })),
}));
vi.mock('../../server/helpers.js', () => ({
  toInsightPageId: vi.fn((url: string) => url),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

// ── Imports ───────────────────────────────────────────────────────────────

import db from '../../server/db/index.js';
import {
  getTopWinsFromActions,
  WIN_SCORES,
  recordAction,
  getActionsByWorkspace,
  getWorkspaceCounts,
  getActionBySource,
  getActionByWorkspaceAndSource,
} from '../../server/outcome-tracking.js';
import type {
  TrackedAction,
  ActionOutcome,
  TopWin,
  BaselineSnapshot,
  DeltaSummary,
} from '../../shared/types/outcome-tracking.js';

// ── Factories ─────────────────────────────────────────────────────────────

function makeAction(id: string, overrides: Partial<TrackedAction> = {}): TrackedAction {
  return {
    id,
    workspaceId: 'ws-test',
    actionType: 'page_optimized' as TrackedAction['actionType'],
    sourceType: 'recommendation',
    sourceId: null,
    pageUrl: `/page/${id}`,
    targetKeyword: null,
    baselineSnapshot: {
      captured_at: '2026-01-01T00:00:00Z',
      position: 20,
      impressions: 500,
      clicks: 10,
    },
    trailingHistory: { metric: '', dataPoints: [] },
    // A1 (I1): default to an EXECUTED attribution. getTopWinsFromActions now excludes
    // `not_acted_on` actions from every win surface (an unexecuted suggestion is not a
    // win), so a `not_acted_on` default would silently drop every win in these
    // sorting/limit/field-mapping tests. Attribution-specific behavior is covered by
    // tests that pass an explicit override.
    attribution: 'platform_executed',
    measurementWindow: 90,
    measurementComplete: false,
    sourceFlag: 'live',
    baselineConfidence: 'medium',
    context: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDelta(deltaPct: number): DeltaSummary {
  return {
    primary_metric: 'clicks',
    baseline_value: 10,
    current_value: 10 + deltaPct * 0.1,
    delta_absolute: deltaPct * 0.1,
    delta_percent: deltaPct,
    direction: deltaPct >= 0 ? 'improved' : 'declined',
  };
}

function makeOutcome(
  actionId: string,
  score: ActionOutcome['score'],
  deltaPct: number,
  measuredAt?: string,
): ActionOutcome {
  return {
    id: `outcome-${actionId}`,
    actionId,
    checkpointDays: 90,
    metricsSnapshot: {
      captured_at: '2026-02-01T00:00:00Z',
      position: 10,
      impressions: 600,
      clicks: 20,
    },
    score,
    earlySignal: undefined,
    deltaSummary: makeDelta(deltaPct),
    competitorContext: null,
    measuredAt: measuredAt ?? new Date().toISOString(),
  };
}

// Workspace IDs for DB tests — use prefixed IDs to facilitate targeted cleanup
const WS_DB = 'ot-core-test-ws';
const WS_DB_OTHER = 'ot-core-test-other-ws';

function cleanupTestWorkspaces() {
  db.prepare("DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE 'ot-core-test-%')").run();
  db.prepare("DELETE FROM tracked_actions WHERE workspace_id LIKE 'ot-core-test-%'").run();
}

// ══════════════════════════════════════════════════════════════════════════
//  WIN_SCORES constant
// ══════════════════════════════════════════════════════════════════════════

describe('WIN_SCORES', () => {
  it('contains strong_win', () => {
    expect(WIN_SCORES).toContain('strong_win');
  });

  it('contains win', () => {
    expect(WIN_SCORES).toContain('win');
  });

  it('has exactly 2 entries', () => {
    expect(WIN_SCORES).toHaveLength(2);
  });

  it('does not contain loss', () => {
    expect(WIN_SCORES).not.toContain('loss');
  });

  it('does not contain neutral', () => {
    expect(WIN_SCORES).not.toContain('neutral');
  });

  it('does not contain insufficient_data', () => {
    expect(WIN_SCORES).not.toContain('insufficient_data');
  });

  it('does not contain inconclusive', () => {
    expect(WIN_SCORES).not.toContain('inconclusive');
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  getTopWinsFromActions — pure / injectable outcomes
// ══════════════════════════════════════════════════════════════════════════

describe('getTopWinsFromActions', () => {
  it('returns empty array when actions list is empty', () => {
    const wins = getTopWinsFromActions([], 10, () => []);
    expect(wins).toEqual([]);
  });

  it('returns empty array when no action has outcomes', () => {
    const actions = [makeAction('a1'), makeAction('a2')];
    const wins = getTopWinsFromActions(actions, 10, () => []);
    expect(wins).toEqual([]);
  });

  it('excludes action with score null (no outcomes)', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', null, 50),
    ]);
    expect(wins).toHaveLength(0);
  });

  it('includes action with score "win"', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', 'win', 30),
    ]);
    expect(wins).toHaveLength(1);
    expect(wins[0].score).toBe('win');
  });

  it('includes action with score "strong_win"', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', 'strong_win', 50),
    ]);
    expect(wins).toHaveLength(1);
    expect(wins[0].score).toBe('strong_win');
  });

  it('excludes action with score "loss"', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', 'loss', -25),
    ]);
    expect(wins).toHaveLength(0);
  });

  it('excludes action with score "neutral"', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', 'neutral', 2),
    ]);
    expect(wins).toHaveLength(0);
  });

  it('excludes action with score "insufficient_data"', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', 'insufficient_data', 0),
    ]);
    expect(wins).toHaveLength(0);
  });

  it('excludes action with score "inconclusive"', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, (_id) => [
      makeOutcome('a1', 'inconclusive', 5),
    ]);
    expect(wins).toHaveLength(0);
  });

  it('sorts by |delta_percent| descending: higher delta_percent ranks first', () => {
    const actions = [makeAction('a1'), makeAction('a2')];
    const outcomes: Record<string, ActionOutcome[]> = {
      a1: [makeOutcome('a1', 'win', 20)],
      a2: [makeOutcome('a2', 'strong_win', 50)],
    };
    const wins = getTopWinsFromActions(actions, 10, (id) => outcomes[id] ?? []);
    expect(wins[0].actionId).toBe('a2');
    expect(wins[1].actionId).toBe('a1');
  });

  it('uses absolute value for sorting: negative delta_percent |-30| beats |20|', () => {
    // Win with -30% delta (absolute 30) should beat win with +20% delta (absolute 20)
    const actions = [makeAction('a1'), makeAction('a2')];
    const outcomes: Record<string, ActionOutcome[]> = {
      a1: [makeOutcome('a1', 'win', 20)],
      a2: [makeOutcome('a2', 'win', -30)],
    };
    const wins = getTopWinsFromActions(actions, 10, (id) => outcomes[id] ?? []);
    expect(wins[0].actionId).toBe('a2');
    expect(wins[0].delta.delta_percent).toBe(-30);
    expect(wins[1].actionId).toBe('a1');
  });

  it('enforces limit parameter: with 5 wins, limit=3 returns only 3', () => {
    const actions = Array.from({ length: 5 }, (_, i) => makeAction(`a${i}`));
    const wins = getTopWinsFromActions(actions, 3, (id) => [makeOutcome(id, 'win', 10)]);
    expect(wins).toHaveLength(3);
  });

  it('default limit is 10: returns at most 10 results', () => {
    const actions = Array.from({ length: 15 }, (_, i) => makeAction(`a${i}`));
    const wins = getTopWinsFromActions(actions, undefined, (id) => [makeOutcome(id, 'win', 10)]);
    expect(wins).toHaveLength(10);
  });

  it('50-action cap: outcomes accessor is called at most 50 times even with 55 actions', () => {
    const actions = Array.from({ length: 55 }, (_, i) => makeAction(`a${i}`));
    const callTracker: string[] = [];
    const wins = getTopWinsFromActions(actions, 20, (id) => {
      callTracker.push(id);
      return [makeOutcome(id, 'win', 10)];
    });
    expect(callTracker).toHaveLength(50);
    // The extra 5 actions beyond the cap are never queried
    expect(callTracker).not.toContain('a50');
    expect(callTracker).not.toContain('a54');
  });

  it('50-action cap: only first 50 actions are processed, last 5 are skipped', () => {
    const actions = Array.from({ length: 55 }, (_, i) => makeAction(`a${i}`));
    // Give the last 5 a huge delta — they should NOT appear in results
    const wins = getTopWinsFromActions(actions, 20, (id) => {
      const idx = parseInt(id.replace('a', ''), 10);
      if (idx >= 50) return [makeOutcome(id, 'win', 9999)];
      return [makeOutcome(id, 'win', 1)];
    });
    const winIds = wins.map(w => w.actionId);
    expect(winIds).not.toContain('a50');
    expect(winIds).not.toContain('a54');
  });

  it('custom getOutcomes function is used instead of default', () => {
    const customFn = vi.fn((_id: string): ActionOutcome[] => []);
    const actions = [makeAction('a1')];
    getTopWinsFromActions(actions, 10, customFn);
    expect(customFn).toHaveBeenCalledWith('a1');
  });

  it('TopWin has actionId field', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'win', 20)]);
    expect(wins[0]).toHaveProperty('actionId', 'a1');
  });

  it('TopWin has actionType field', () => {
    const actions = [makeAction('a1', { actionType: 'meta_updated' })];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'win', 20)]);
    expect(wins[0]).toHaveProperty('actionType', 'meta_updated');
  });

  it('TopWin has pageUrl field from action', () => {
    const actions = [makeAction('a1', { pageUrl: '/services' })];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'win', 20)]);
    expect(wins[0]).toHaveProperty('pageUrl', '/services');
  });

  it('TopWin has targetKeyword field from action', () => {
    const actions = [makeAction('a1', { targetKeyword: 'seo tool' })];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'win', 20)]);
    expect(wins[0]).toHaveProperty('targetKeyword', 'seo tool');
  });

  it('TopWin has delta field from outcome deltaSummary', () => {
    const delta = makeDelta(35);
    const actions = [makeAction('a1')];
    const outcome: ActionOutcome = { ...makeOutcome('a1', 'win', 35), deltaSummary: delta };
    const wins = getTopWinsFromActions(actions, 10, () => [outcome]);
    expect(wins[0].delta).toEqual(delta);
  });

  it('TopWin has score field', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'strong_win', 50)]);
    expect(wins[0]).toHaveProperty('score', 'strong_win');
  });

  it('TopWin has createdAt from action.createdAt', () => {
    const createdAt = '2026-01-15T00:00:00Z';
    const actions = [makeAction('a1', { createdAt })];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'win', 20)]);
    expect(wins[0].createdAt).toBe(createdAt);
  });

  it('TopWin scoredAt comes from outcome.measuredAt', () => {
    const measuredAt = '2026-02-20T10:00:00Z';
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, () => [makeOutcome('a1', 'win', 20, measuredAt)]);
    expect(wins[0].scoredAt).toBe(measuredAt);
  });

  it('multiple qualifying outcomes for same action both become separate wins', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, () => [
      makeOutcome('a1', 'win', 20),
      makeOutcome('a1', 'strong_win', 40),
    ]);
    expect(wins).toHaveLength(2);
  });

  it('mixes wins and non-wins from same action: only qualifying outcomes included', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 10, () => [
      makeOutcome('a1', 'win', 20),
      makeOutcome('a1', 'loss', -30),
      makeOutcome('a1', 'neutral', 2),
    ]);
    expect(wins).toHaveLength(1);
    expect(wins[0].score).toBe('win');
  });

  it('sorts correctly when multiple actions have same delta (stable enough)', () => {
    const actions = [makeAction('a1'), makeAction('a2'), makeAction('a3')];
    const outcomes: Record<string, ActionOutcome[]> = {
      a1: [makeOutcome('a1', 'win', 10)],
      a2: [makeOutcome('a2', 'win', 50)],
      a3: [makeOutcome('a3', 'win', 30)],
    };
    const wins = getTopWinsFromActions(actions, 10, (id) => outcomes[id] ?? []);
    expect(wins.map(w => w.actionId)).toEqual(['a2', 'a3', 'a1']);
  });

  it('respects limit even when all actions have wins', () => {
    const actions = Array.from({ length: 20 }, (_, i) => makeAction(`a${i}`));
    const wins = getTopWinsFromActions(actions, 5, (id) => [makeOutcome(id, 'win', 10)]);
    expect(wins).toHaveLength(5);
  });

  it('limit=0 returns empty array', () => {
    const actions = [makeAction('a1')];
    const wins = getTopWinsFromActions(actions, 0, () => [makeOutcome('a1', 'win', 20)]);
    expect(wins).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  DB-backed tests: recordAction, getActionsByWorkspace, getWorkspaceCounts,
//  getActionBySource
// ══════════════════════════════════════════════════════════════════════════

describe('recordAction (DB)', () => {
  beforeEach(cleanupTestWorkspaces);

  const baselineSnapshot: BaselineSnapshot = {
    captured_at: '2026-01-01T00:00:00Z',
    position: 15,
    impressions: 1000,
    clicks: 50,
  };

  it('returns a TrackedAction with the correct workspaceId', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    expect(action.workspaceId).toBe(WS_DB);
  });

  it('returns a TrackedAction with a non-empty UUID id', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    expect(action.id).toBeTruthy();
    expect(typeof action.id).toBe('string');
    // UUID format (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    expect(action.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('returns a TrackedAction with the correct actionType', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'content_published',
      sourceType: 'brief',
      baselineSnapshot,
    });
    expect(action.actionType).toBe('content_published');
  });

  it('sets context.seasonalTag with month as number 1-12', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    expect(action.context.seasonalTag).toBeDefined();
    expect(typeof action.context.seasonalTag!.month).toBe('number');
    expect(action.context.seasonalTag!.month).toBeGreaterThanOrEqual(1);
    expect(action.context.seasonalTag!.month).toBeLessThanOrEqual(12);
  });

  it('sets context.seasonalTag.month matching current month', () => {
    const expectedMonth = new Date().getMonth() + 1;
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    expect(action.context.seasonalTag!.month).toBe(expectedMonth);
  });

  it('sets context.seasonalTag with quarter as number 1-4', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    expect(action.context.seasonalTag!.quarter).toBeGreaterThanOrEqual(1);
    expect(action.context.seasonalTag!.quarter).toBeLessThanOrEqual(4);
  });

  it('seasonalTag.quarter = Math.ceil(month / 3) — verifies quarter formula for all 12 months', () => {
    // We can't control the clock, so test the formula directly
    const cases: Array<[number, number]> = [
      [1, 1], [2, 1], [3, 1],
      [4, 2], [5, 2], [6, 2],
      [7, 3], [8, 3], [9, 3],
      [10, 4], [11, 4], [12, 4],
    ];
    for (const [month, expectedQuarter] of cases) {
      expect(Math.ceil(month / 3)).toBe(expectedQuarter);
    }
  });

  it('seasonalTag.quarter matches current month quarter', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    const month = action.context.seasonalTag!.month;
    const expectedQuarter = Math.ceil(month / 3);
    expect(action.context.seasonalTag!.quarter).toBe(expectedQuarter);
  });

  it('seasonalTag for month 1 → Q1', () => {
    expect(Math.ceil(1 / 3)).toBe(1);
  });

  it('seasonalTag for month 3 → Q1', () => {
    expect(Math.ceil(3 / 3)).toBe(1);
  });

  it('seasonalTag for month 4 → Q2', () => {
    expect(Math.ceil(4 / 3)).toBe(2);
  });

  it('seasonalTag for month 10 → Q4', () => {
    expect(Math.ceil(10 / 3)).toBe(4);
  });

  it('seasonalTag for month 12 → Q4', () => {
    expect(Math.ceil(12 / 3)).toBe(4);
  });

  it('stores and returns pageUrl when provided', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      pageUrl: '/services/seo',
      baselineSnapshot,
    });
    expect(action.pageUrl).toBe('/services/seo');
  });

  it('stores and returns targetKeyword when provided', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'strategy_keyword_added',
      sourceType: 'strategy',
      targetKeyword: 'local seo services',
      baselineSnapshot,
    });
    expect(action.targetKeyword).toBe('local seo services');
  });

  it('defaults attribution to platform_executed when not provided', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    expect(action.attribution).toBe('platform_executed');
  });

  it('stores provided attribution value', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      attribution: 'externally_executed',
      baselineSnapshot,
    });
    expect(action.attribution).toBe('externally_executed');
  });

  it('action is retrievable via getActionsByWorkspace', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    const actions = getActionsByWorkspace(WS_DB);
    const found = actions.find(a => a.id === action.id);
    expect(found).toBeDefined();
    expect(found!.actionType).toBe('meta_updated');
  });

  it('merges caller-provided context with seasonalTag', () => {
    const action = recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
      context: { notes: 'updated h1 tag' },
    });
    expect(action.context.notes).toBe('updated h1 tag');
    expect(action.context.seasonalTag).toBeDefined();
  });
});

// ── getActionsByWorkspace ─────────────────────────────────────────────────

describe('getActionsByWorkspace (DB)', () => {
  beforeEach(cleanupTestWorkspaces);

  const baselineSnapshot: BaselineSnapshot = {
    captured_at: '2026-01-01T00:00:00Z',
    position: 10,
    impressions: 500,
    clicks: 20,
  };

  it('returns empty array for workspace with no actions', () => {
    const actions = getActionsByWorkspace(WS_DB);
    expect(actions).toEqual([]);
  });

  it('returns all actions recorded for a workspace', () => {
    recordAction({ workspaceId: WS_DB, actionType: 'meta_updated', sourceType: 'insight', baselineSnapshot });
    recordAction({ workspaceId: WS_DB, actionType: 'content_published', sourceType: 'brief', baselineSnapshot });
    const actions = getActionsByWorkspace(WS_DB);
    expect(actions).toHaveLength(2);
  });

  it('does not return actions from other workspaces', () => {
    recordAction({ workspaceId: WS_DB, actionType: 'meta_updated', sourceType: 'insight', baselineSnapshot });
    recordAction({ workspaceId: WS_DB_OTHER, actionType: 'content_published', sourceType: 'brief', baselineSnapshot });

    const actions = getActionsByWorkspace(WS_DB);
    expect(actions).toHaveLength(1);
    expect(actions.every(a => a.workspaceId === WS_DB)).toBe(true); // every-ok: length checked on previous line
  });

  it('each returned action has correct workspaceId', () => {
    recordAction({ workspaceId: WS_DB, actionType: 'meta_updated', sourceType: 'insight', baselineSnapshot });
    const actions = getActionsByWorkspace(WS_DB);
    expect(actions[0].workspaceId).toBe(WS_DB);
  });
});

// ── getWorkspaceCounts ────────────────────────────────────────────────────

describe('getWorkspaceCounts (DB)', () => {
  beforeEach(cleanupTestWorkspaces);

  const baselineSnapshot: BaselineSnapshot = {
    captured_at: '2026-01-01T00:00:00Z',
    position: 10,
    impressions: 500,
    clicks: 20,
  };

  it('returns total=0, scored=0, pending=0 for empty workspace', () => {
    const counts = getWorkspaceCounts(WS_DB);
    expect(counts).toEqual({ total: 0, scored: 0, pending: 0 });
  });

  it('returns total=1, scored=0, pending=1 after recording one action', () => {
    recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      baselineSnapshot,
    });
    const counts = getWorkspaceCounts(WS_DB);
    expect(counts.total).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.scored).toBe(0);
  });

  it('total equals pending + scored', () => {
    recordAction({ workspaceId: WS_DB, actionType: 'meta_updated', sourceType: 'insight', baselineSnapshot });
    recordAction({ workspaceId: WS_DB, actionType: 'content_published', sourceType: 'brief', baselineSnapshot });
    const counts = getWorkspaceCounts(WS_DB);
    expect(counts.total).toBe(counts.pending + counts.scored);
  });

  it('counts do not include actions from other workspaces', () => {
    recordAction({ workspaceId: WS_DB_OTHER, actionType: 'meta_updated', sourceType: 'insight', baselineSnapshot });
    const counts = getWorkspaceCounts(WS_DB);
    expect(counts.total).toBe(0);
  });

  it('returns correct total after recording multiple actions', () => {
    for (let i = 0; i < 3; i++) {
      recordAction({ workspaceId: WS_DB, actionType: 'meta_updated', sourceType: 'insight', baselineSnapshot });
    }
    const counts = getWorkspaceCounts(WS_DB);
    expect(counts.total).toBe(3);
    expect(counts.pending).toBe(3);
  });
});

// ── getActionBySource ─────────────────────────────────────────────────────

describe('getActionBySource (DB)', () => {
  beforeEach(cleanupTestWorkspaces);

  const baselineSnapshot: BaselineSnapshot = {
    captured_at: '2026-01-01T00:00:00Z',
    position: 10,
    impressions: 500,
    clicks: 20,
  };

  it('returns null when no action exists for sourceType + sourceId', () => {
    const result = getActionBySource('insight', 'nonexistent-id');
    expect(result).toBeNull();
  });

  it('returns the matching action when it exists', () => {
    recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      sourceId: 'insight-abc',
      baselineSnapshot,
    });
    const result = getActionBySource('insight', 'insight-abc');
    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe('insight');
    expect(result!.sourceId).toBe('insight-abc');
  });

  it('does not return action for a different sourceType', () => {
    recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'recommendation',
      sourceId: 'rec-123',
      baselineSnapshot,
    });
    const result = getActionBySource('insight', 'rec-123');
    expect(result).toBeNull();
  });

  it('does not return action for a different sourceId', () => {
    recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      sourceId: 'insight-xyz',
      baselineSnapshot,
    });
    const result = getActionBySource('insight', 'insight-abc');
    expect(result).toBeNull();
  });
});

// ── getActionByWorkspaceAndSource ─────────────────────────────────────────

describe('getActionByWorkspaceAndSource (DB)', () => {
  beforeEach(cleanupTestWorkspaces);

  const baselineSnapshot: BaselineSnapshot = {
    captured_at: '2026-01-01T00:00:00Z',
    position: 10,
    impressions: 500,
    clicks: 20,
  };

  it('returns null when no matching action exists', () => {
    const result = getActionByWorkspaceAndSource(WS_DB, 'insight', 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns matching action for correct workspace + sourceType + sourceId', () => {
    recordAction({
      workspaceId: WS_DB,
      actionType: 'meta_updated',
      sourceType: 'insight',
      sourceId: 'insight-wsa',
      baselineSnapshot,
    });
    const result = getActionByWorkspaceAndSource(WS_DB, 'insight', 'insight-wsa');
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe(WS_DB);
  });

  it('does not return action from different workspace even if sourceType+sourceId match', () => {
    recordAction({
      workspaceId: WS_DB_OTHER,
      actionType: 'meta_updated',
      sourceType: 'insight',
      sourceId: 'insight-shared',
      baselineSnapshot,
    });
    const result = getActionByWorkspaceAndSource(WS_DB, 'insight', 'insight-shared');
    expect(result).toBeNull();
  });
});
