/**
 * Unit tests for server/outcome-tracking.ts — write-path functions.
 *
 * These are pure DB unit tests: no HTTP server, no createTestContext, no port needed.
 * They exercise the real SQLite DB via direct imports and verify persistence, defaults,
 * scoping, and the 90-day auto-complete path in recordOutcome().
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type {
  TrackedAction,
  ActionOutcome,
  BaselineSnapshot,
  DeltaSummary,
  ActionContext,
} from '../../shared/types/outcome-tracking.js';

const mockInvalidateMonthlyDigestCache = vi.hoisted(() => vi.fn());
const mockInvalidateWorkspaceLearningsCache = vi.hoisted(() => vi.fn());
const mockClearIntelligenceCache = vi.hoisted(() => vi.fn());

// ── Dependency mocks ──────────────────────────────────────────────────────────
// Bridge infrastructure fires async side-effects we don't want in unit tests.
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
    OUTCOME_LEARNINGS_UPDATED: 'outcome_learnings_updated',
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

vi.mock('../../server/monthly-digest-cache.js', () => ({
  invalidateMonthlyDigestCache: mockInvalidateMonthlyDigestCache,
}));

vi.mock('../../server/workspace-learnings-cache.js', () => ({
  invalidateWorkspaceLearningsCache: mockInvalidateWorkspaceLearningsCache,
}));

vi.mock('../../server/intelligence/cache-clear.js', () => ({
  clearIntelligenceCache: mockClearIntelligenceCache,
}));

// ── Import the module under test AFTER mocks ──────────────────────────────────
import {
  recordAction,
  getAction,
  getActionsByWorkspace,
  updateAttribution,
  markActionComplete,
  updateActionContext,
  updateBaselineSnapshot,
  recordOutcome,
  getOutcomesForAction,
  getWorkspaceCounts,
  getTopWinsFromActions,
  WIN_SCORES,
} from '../../server/outcome-tracking.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { fireBridge } from '../../server/bridge-infrastructure.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASELINE: BaselineSnapshot = {
  captured_at: '2026-01-01T00:00:00Z',
  clicks: 100,
  impressions: 2000,
  ctr: 5.0,
  position: 12.5,
};

const DELTA: DeltaSummary = {
  primary_metric: 'clicks',
  baseline_value: 100,
  current_value: 150,
  delta_absolute: 50,
  delta_percent: 50,
  direction: 'improved',
};

const LOSS_DELTA: DeltaSummary = {
  primary_metric: 'clicks',
  baseline_value: 100,
  current_value: 50,
  delta_absolute: -50,
  delta_percent: -50,
  direction: 'declined',
};

function makeBaseline(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  return { ...BASELINE, ...overrides };
}

function makeDelta(overrides: Partial<DeltaSummary> = {}): DeltaSummary {
  return { ...DELTA, ...overrides };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('outcome-tracking write paths', () => {
  let ws: SeededFullWorkspace;
  let ws2: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
    ws2 = seedWorkspace();
  });

  afterAll(() => {
    ws.cleanup();
    ws2.cleanup();
  });

  afterEach(() => {
    vi.mocked(fireBridge).mockClear();
    vi.mocked(broadcastToWorkspace).mockClear();
    mockInvalidateMonthlyDigestCache.mockClear();
    mockInvalidateWorkspaceLearningsCache.mockClear();
    mockClearIntelligenceCache.mockClear();
    // Clean up tracked_actions and action_outcomes for test isolation
    db.prepare(
      `DELETE FROM action_outcomes WHERE action_id IN (
         SELECT id FROM tracked_actions WHERE workspace_id IN (?, ?)
       )`,
    ).run(ws.workspaceId, ws2.workspaceId);
    db.prepare(
      'DELETE FROM tracked_actions WHERE workspace_id IN (?, ?)',
    ).run(ws.workspaceId, ws2.workspaceId);
  });

  // ── recordAction ────────────────────────────────────────────────────────────

  describe('recordAction', () => {
    it('creates annotation bridges only for client-visible outcome actions', () => {
      recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'voice_calibrated',
        sourceType: 'brand_voice',
        sourceId: ws.workspaceId,
        baselineSnapshot: {},
        attribution: 'platform_executed',
      });

      expect(vi.mocked(fireBridge).mock.calls.some(([name]) => name === 'bridge-action-annotation'))
        .toBe(false);

      vi.mocked(fireBridge).mockClear();
      recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        sourceId: 'visible-annotation-action',
        baselineSnapshot: BASELINE,
        attribution: 'platform_executed',
      });

      expect(vi.mocked(fireBridge).mock.calls.some(([name]) => name === 'bridge-action-annotation'))
        .toBe(true);
    });

    it('persists a row and returns a TrackedAction with correct scalar fields', () => {
      const action = recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        sourceId: 'ins-abc',
        pageUrl: 'https://example.com/page',
        targetKeyword: 'best seo tips',
        baselineSnapshot: BASELINE,
        attribution: 'platform_executed',
        measurementWindow: 90,
        sourceFlag: 'live',
        baselineConfidence: 'exact',
      });

      expect(action.id).toBeTruthy();
      expect(action.workspaceId).toBe(ws.workspaceId);
      expect(action.actionType).toBe('meta_updated');
      expect(action.sourceType).toBe('insight');
      expect(action.sourceId).toBe('ins-abc');
      expect(action.pageUrl).toBe('https://example.com/page');
      expect(action.targetKeyword).toBe('best seo tips');
      expect(action.attribution).toBe('platform_executed');
      expect(action.measurementWindow).toBe(90);
      expect(action.sourceFlag).toBe('live');
      expect(action.baselineConfidence).toBe('exact');
      expect(action.createdAt).toBeTruthy();
      expect(action.updatedAt).toBeTruthy();
    });

    it('can be read back via getAction', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      const readBack = getAction(action.id);
      expect(readBack).not.toBeNull();
      expect(readBack!.id).toBe(action.id);
      expect(readBack!.workspaceId).toBe(ws.workspaceId);
    });

    it('applies defaults: measurementWindow=90, sourceFlag=live, baselineConfidence=exact (attribution is REQUIRED, not defaulted — B14)', () => {
      // R8-PR2 (B14): attribution NO LONGER defaults to 'platform_executed' — the caller
      // must pass it explicitly (compile-time required). Only the optional operational
      // fields still default. attribution is passed here to reflect that it's now required.
      const action = recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'schema_deployed',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
        attribution: 'platform_executed',
      });

      expect(action.attribution).toBe('platform_executed');
      expect(action.measurementWindow).toBe(90);
      expect(action.sourceFlag).toBe('live');
      expect(action.baselineConfidence).toBe('exact');
    });

    it('returns measurementComplete=false on a fresh action', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'internal_link_added',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });

      expect(action.measurementComplete).toBe(false);
    });

    it('injects seasonalTag with valid month (1-12) and quarter (1-4) when no context is passed', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });

      const { seasonalTag } = action.context;
      expect(seasonalTag).toBeDefined();
      expect(seasonalTag!.month).toBeGreaterThanOrEqual(1);
      expect(seasonalTag!.month).toBeLessThanOrEqual(12);
      expect(seasonalTag!.quarter).toBeGreaterThanOrEqual(1);
      expect(seasonalTag!.quarter).toBeLessThanOrEqual(4);
    });

    it('merges caller-provided context keys with injected seasonalTag — both are present', () => {
      const callerContext: ActionContext = {
        notes: 'Updated meta title for homepage',
        relatedActions: ['prev-action-id'],
      };

      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
        context: callerContext,
      });

      expect(action.context.notes).toBe('Updated meta title for homepage');
      expect(action.context.relatedActions).toEqual(['prev-action-id']);
      expect(action.context.seasonalTag).toBeDefined();
      expect(action.context.seasonalTag!.month).toBeGreaterThanOrEqual(1);
    });

    it('seasonalTag quarter is mathematically consistent with month', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'voice_calibrated',
        sourceType: 'system',
        baselineSnapshot: BASELINE,
      });

      const { month, quarter } = action.context.seasonalTag!;
      const expectedQuarter = Math.ceil(month / 3);
      expect(quarter).toBe(expectedQuarter);
    });

    it('workspace isolation: actions recorded in ws are not visible from ws2', () => {
      recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_refreshed',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      const ws2Actions = getActionsByWorkspace(ws2.workspaceId);
      expect(ws2Actions.length).toBe(0);
    });

    it('workspace isolation: actions from ws2 are not included in ws results', () => {
      recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        pageUrl: '/page-ws1',
        baselineSnapshot: BASELINE,
      });
      recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws2.workspaceId,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        pageUrl: '/page-ws2',
        baselineSnapshot: BASELINE,
      });

      const ws1Actions = getActionsByWorkspace(ws.workspaceId);
      const ws2Actions = getActionsByWorkspace(ws2.workspaceId);

      expect(ws1Actions.length).toBeGreaterThan(0);
      expect(ws2Actions.length).toBeGreaterThan(0);
      expect(ws1Actions.every(a => a.workspaceId === ws.workspaceId)).toBe(true); // every-ok: length guard above
      expect(ws2Actions.every(a => a.workspaceId === ws2.workspaceId)).toBe(true); // every-ok: length guard above
      expect(ws1Actions.some(a => a.pageUrl === '/page-ws2')).toBe(false);
      expect(ws2Actions.some(a => a.pageUrl === '/page-ws1')).toBe(false);
    });
  });

  // ── R8-PR2 (B14): attribution is REQUIRED at the write layer ──────────────────

  describe('recordAction attribution contract (B14)', () => {
    // NOTE: the COMPILE-TIME assertion (omitting attribution is a type error) lives in
    // server/__tests__/outcome-attribution-required-typecontract.test.ts, because only
    // server/__tests__ is inside the `tsc -b` typecheck scope — tests/ is not. This block
    // covers the RUNTIME half: the stored value is exactly what the caller passed.

    it('stores the exact attribution value passed (no silent rewrite)', () => {
      const platform = recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'post',
        baselineSnapshot: BASELINE,
        attribution: 'platform_executed',
      });
      const notActed = recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'content_refreshed',
        sourceType: 'content_decay',
        baselineSnapshot: BASELINE,
        attribution: 'not_acted_on',
      });
      const external = recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
        attribution: 'externally_executed',
      });

      expect(getAction(platform.id)!.attribution).toBe('platform_executed');
      expect(getAction(notActed.id)!.attribution).toBe('not_acted_on');
      expect(getAction(external.id)!.attribution).toBe('externally_executed');
    });
  });

  // ── updateAttribution ────────────────────────────────────────────────────────

  describe('updateAttribution', () => {
    it('updates attribution and persists the change', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
      });

      expect(action.attribution).toBe('platform_executed');

      updateAttribution(action.id, ws.workspaceId, 'externally_executed');

      const updated = getAction(action.id);
      expect(updated).not.toBeNull();
      expect(updated!.attribution).toBe('externally_executed');
      expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledOnce();
      expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledWith(ws.workspaceId);
      expect(mockInvalidateWorkspaceLearningsCache).toHaveBeenCalledWith(ws.workspaceId);
      expect(mockClearIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
    });

    it('updating attribution on an unknown ID does not throw and silently no-ops', () => {
      // UPDATE ... WHERE id = ? AND workspace_id = ? — missing row is a silent no-op
      expect(() => updateAttribution('non-existent-id-xyz', ws.workspaceId, 'not_acted_on')).not.toThrow();
    });

    it('updating attribution on an action from a different workspace does not affect the original action', () => {
      // Because the prepared statement is only scoped by UUID (not workspace_id),
      // cross-workspace mutation would only be possible if the UUID collides.
      // This test verifies that ws1's action is unchanged after updating ws2's action.
      const ws1Action = recordAction({
        workspaceId: ws.workspaceId,
        actionType: 'brief_created',
        sourceType: 'brief',
        attribution: 'platform_executed',
        baselineSnapshot: BASELINE,
      });

      const ws2Action = recordAction({
        workspaceId: ws2.workspaceId,
        actionType: 'brief_created',
        sourceType: 'brief',
        attribution: 'platform_executed',
        baselineSnapshot: BASELINE,
      });

      // Update ws2's action — should not affect ws1's action
      updateAttribution(ws2Action.id, ws2.workspaceId, 'externally_executed');

      const ws1Check = getAction(ws1Action.id);
      expect(ws1Check!.attribution).toBe('platform_executed');

      const ws2Check = getAction(ws2Action.id);
      expect(ws2Check!.attribution).toBe('externally_executed');
    });
  });

  // ── markActionComplete ───────────────────────────────────────────────────────

  describe('markActionComplete', () => {
    it('sets measurementComplete=true and persists the change', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });

      expect(action.measurementComplete).toBe(false);

      markActionComplete(action.id, ws.workspaceId);

      const updated = getAction(action.id);
      expect(updated).not.toBeNull();
      expect(updated!.measurementComplete).toBe(true);
    });

    it('calling on an unknown ID does not throw', () => {
      expect(() => markActionComplete('non-existent-uuid', ws.workspaceId)).not.toThrow();
    });

    it('does not affect a different action with a different ID', () => {
      const actionA = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'internal_link_added',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });
      const actionB = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      markActionComplete(actionA.id, ws.workspaceId);

      const checkA = getAction(actionA.id);
      const checkB = getAction(actionB.id);

      expect(checkA!.measurementComplete).toBe(true);
      expect(checkB!.measurementComplete).toBe(false);
    });

    it('marking an action from ws2 does not affect ws1 action with different ID', () => {
      const ws1Action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'schema_deployed',
        sourceType: 'schema',
        baselineSnapshot: BASELINE,
      });
      const ws2Action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws2.workspaceId,
        actionType: 'schema_deployed',
        sourceType: 'schema',
        baselineSnapshot: BASELINE,
      });

      markActionComplete(ws2Action.id, ws2.workspaceId);

      expect(getAction(ws1Action.id)!.measurementComplete).toBe(false);
      expect(getAction(ws2Action.id)!.measurementComplete).toBe(true);
    });
  });

  // ── updateActionContext ──────────────────────────────────────────────────────

  describe('updateActionContext', () => {
    it('persists new context values — read back with getAction', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      const newContext: ActionContext = {
        notes: 'Manually updated context note',
        relatedActions: ['related-id-1', 'related-id-2'],
        detectionChecks: 3,
      };

      updateActionContext(action.id, ws.workspaceId, newContext);

      const updated = getAction(action.id);
      expect(updated).not.toBeNull();
      expect(updated!.context.notes).toBe('Manually updated context note');
      expect(updated!.context.relatedActions).toEqual(['related-id-1', 'related-id-2']);
      expect(updated!.context.detectionChecks).toBe(3);
    });

    it('replaces existing context (not merges)', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'voice_calibrated',
        sourceType: 'system',
        baselineSnapshot: BASELINE,
        context: { notes: 'original note', detectionChecks: 1 },
      });

      // Replace entirely — detectionChecks from original should be gone
      updateActionContext(action.id, ws.workspaceId, { notes: 'replaced note' });

      const updated = getAction(action.id);
      expect(updated!.context.notes).toBe('replaced note');
      // detectionChecks was not in the new context object
      expect(updated!.context.detectionChecks).toBeUndefined();
    });

    it('broadcasts an opaque learnings invalidation when hidden-action context changes', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'voice_calibrated',
        sourceType: 'system',
        baselineSnapshot: BASELINE,
      });

      updateActionContext(action.id, ws.workspaceId, { notes: 'new note' });

      expect(broadcastToWorkspace).toHaveBeenCalledWith(
        ws.workspaceId,
        'outcome_learnings_updated',
        {},
      );
    });

    it('does not affect actions from other workspaces', () => {
      const ws1Action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        baselineSnapshot: BASELINE,
        context: { notes: 'ws1 context' },
      });
      const ws2Action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws2.workspaceId,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        baselineSnapshot: BASELINE,
        context: { notes: 'ws2 context' },
      });

      updateActionContext(ws2Action.id, ws2.workspaceId, { notes: 'ws2 updated' });

      // ws1 action must be unaffected
      expect(getAction(ws1Action.id)!.context.notes).toBe('ws1 context');
      expect(getAction(ws2Action.id)!.context.notes).toBe('ws2 updated');
    });
  });

  // ── updateBaselineSnapshot ───────────────────────────────────────────────────

  describe('updateBaselineSnapshot', () => {
    it('persists the new baseline snapshot — read back with getAction', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
      });

      const newSnapshot: BaselineSnapshot = {
        captured_at: '2026-03-01T00:00:00Z',
        clicks: 250,
        impressions: 4000,
        ctr: 6.25,
        position: 8.3,
        sessions: 180,
      };

      updateBaselineSnapshot(action.id, ws.workspaceId, newSnapshot);

      const updated = getAction(action.id);
      expect(updated).not.toBeNull();
      expect(updated!.baselineSnapshot.captured_at).toBe('2026-03-01T00:00:00Z');
      expect(updated!.baselineSnapshot.clicks).toBe(250);
      expect(updated!.baselineSnapshot.ctr).toBe(6.25);
      expect(updated!.baselineSnapshot.sessions).toBe(180);
    });

    it('does not affect actions from another workspace', () => {
      const ws1Action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_refreshed',
        sourceType: 'brief',
        baselineSnapshot: makeBaseline({ clicks: 50 }),
      });
      const ws2Action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws2.workspaceId,
        actionType: 'content_refreshed',
        sourceType: 'brief',
        baselineSnapshot: makeBaseline({ clicks: 999 }),
      });

      updateBaselineSnapshot(ws2Action.id, ws2.workspaceId, makeBaseline({ clicks: 777 }));

      // ws1 action clicks must still be 50
      expect(getAction(ws1Action.id)!.baselineSnapshot.clicks).toBe(50);
      expect(getAction(ws2Action.id)!.baselineSnapshot.clicks).toBe(777);
    });
  });

  // ── recordOutcome ────────────────────────────────────────────────────────────

  describe('recordOutcome', () => {
    it('inserts an outcome row and returns an ActionOutcome with correct checkpointDays', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      const outcome = recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeBaseline({ clicks: 150 }),
        score: 'win',
        deltaSummary: DELTA,
      });

      expect(outcome.id).toBeTruthy();
      expect(outcome.actionId).toBe(action.id);
      expect(outcome.checkpointDays).toBe(30);
      expect(outcome.score).toBe('win');
      expect(outcome.deltaSummary.delta_percent).toBe(50);
      expect(outcome.measuredAt).toBeTruthy();
      expect(mockInvalidateMonthlyDigestCache).toHaveBeenCalledWith(ws.workspaceId);
      expect(mockInvalidateWorkspaceLearningsCache).toHaveBeenCalledWith(ws.workspaceId);
      expect(mockClearIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
      expect(broadcastToWorkspace).toHaveBeenCalledWith(
        ws.workspaceId,
        'outcome_learnings_updated',
        expect.objectContaining({ actionId: action.id, checkpointDays: 30, score: 'win' }),
      );
    });

    it('broadcasts only an opaque learnings invalidation for a hidden scored action', () => {
      const action = recordAction({
        attribution: 'platform_executed',
        workspaceId: ws.workspaceId,
        actionType: 'voice_calibrated',
        sourceType: 'brand_voice',
        sourceId: ws.workspaceId,
        baselineSnapshot: BASELINE,
      });

      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeBaseline({ clicks: 150 }),
        score: 'strong_win',
        deltaSummary: DELTA,
      });

      expect(broadcastToWorkspace).toHaveBeenCalledWith(
        ws.workspaceId,
        'outcome_learnings_updated',
        {},
      );
      expect(JSON.stringify(vi.mocked(broadcastToWorkspace).mock.calls))
        .not.toContain(action.id);
    });

    it('90-day checkpoint marks the action complete', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'schema_deployed',
        sourceType: 'schema',
        baselineSnapshot: BASELINE,
      });

      expect(getAction(action.id)!.measurementComplete).toBe(false);

      recordOutcome({
        actionId: action.id,
        checkpointDays: 90,
        metricsSnapshot: makeBaseline({ clicks: 200 }),
        score: 'strong_win',
        deltaSummary: makeDelta({ delta_percent: 100, direction: 'improved' }),
      });

      const afterOutcome = getAction(action.id);
      expect(afterOutcome).not.toBeNull();
      expect(afterOutcome!.measurementComplete).toBe(true);
    });

    it('30-day checkpoint does NOT mark the action complete', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
      });

      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeBaseline({ clicks: 120 }),
        score: 'win',
        deltaSummary: DELTA,
      });

      expect(getAction(action.id)!.measurementComplete).toBe(false);
    });

    it('60-day checkpoint does NOT mark the action complete', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'internal_link_added',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });

      recordOutcome({
        actionId: action.id,
        checkpointDays: 60,
        metricsSnapshot: makeBaseline({ clicks: 130 }),
        score: 'neutral',
        deltaSummary: makeDelta({ delta_percent: 5 }),
      });

      expect(getAction(action.id)!.measurementComplete).toBe(false);
    });

    it('7-day checkpoint does NOT mark the action complete', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      recordOutcome({
        actionId: action.id,
        checkpointDays: 7,
        metricsSnapshot: makeBaseline({ clicks: 105 }),
        score: null,
        earlySignal: 'on_track',
        deltaSummary: makeDelta({ delta_percent: 5 }),
      });

      expect(getAction(action.id)!.measurementComplete).toBe(false);
    });

    it('OR REPLACE semantics: second outcome for same actionId+checkpointDays replaces the first', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_refreshed',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeBaseline({ clicks: 110 }),
        score: 'neutral',
        deltaSummary: makeDelta({ delta_percent: 10 }),
      });

      // Record a second outcome for the same checkpoint — should replace
      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeBaseline({ clicks: 180 }),
        score: 'win',
        deltaSummary: makeDelta({ delta_percent: 80, direction: 'improved' }),
      });

      const outcomes = getOutcomesForAction(action.id);
      const thirtyDayOutcomes = outcomes.filter(o => o.checkpointDays === 30);

      // Should only be one row for this checkpoint (INSERT OR REPLACE)
      expect(thirtyDayOutcomes.length).toBe(1);
      expect(thirtyDayOutcomes[0].score).toBe('win');
      expect(thirtyDayOutcomes[0].deltaSummary.delta_percent).toBe(80);
    });

    it('multiple distinct checkpoints for the same action all persist', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'strategy_keyword_added',
        sourceType: 'strategy',
        baselineSnapshot: BASELINE,
      });

      recordOutcome({ actionId: action.id, checkpointDays: 7, metricsSnapshot: makeBaseline(), score: null, deltaSummary: makeDelta() });
      recordOutcome({ actionId: action.id, checkpointDays: 30, metricsSnapshot: makeBaseline(), score: 'neutral', deltaSummary: makeDelta() });
      recordOutcome({ actionId: action.id, checkpointDays: 60, metricsSnapshot: makeBaseline(), score: 'win', deltaSummary: makeDelta() });

      const outcomes = getOutcomesForAction(action.id);
      expect(outcomes.length).toBe(3);
      const checkpoints = outcomes.map(o => o.checkpointDays).sort((a, b) => a - b);
      expect(checkpoints).toEqual([7, 30, 60]);
    });

    it('earlySignal is stored and returned correctly', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      const outcome = recordOutcome({
        actionId: action.id,
        checkpointDays: 7,
        metricsSnapshot: makeBaseline(),
        score: null,
        earlySignal: 'too_early',
        deltaSummary: makeDelta({ delta_percent: 2 }),
      });

      expect(outcome.earlySignal).toBe('too_early');
    });

    it('null score is stored and returned as null', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'audit_fix_applied',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });

      const outcome = recordOutcome({
        actionId: action.id,
        checkpointDays: 7,
        metricsSnapshot: makeBaseline(),
        score: null,
        deltaSummary: makeDelta({ delta_percent: 1 }),
      });

      expect(outcome.score).toBeNull();
    });
  });

  // ── getWorkspaceCounts ────────────────────────────────────────────────────────

  describe('getWorkspaceCounts', () => {
    it('returns zero totals for an empty workspace', () => {
      const counts = getWorkspaceCounts(ws.workspaceId);
      expect(counts.total).toBe(0);
      expect(counts.scored).toBe(0);
      expect(counts.pending).toBe(0);
    });

    it('counts total=3, scored=1, pending=2 correctly', () => {
      // Create 3 actions: 2 pending, 1 complete
      const a1 = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
      });
      const a2 = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });
      const a3 = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'schema_deployed',
        sourceType: 'schema',
        baselineSnapshot: BASELINE,
      });

      // Mark a1 complete
      markActionComplete(a1.id, ws.workspaceId);

      const counts = getWorkspaceCounts(ws.workspaceId);
      expect(counts.total).toBe(3);
      expect(counts.scored).toBe(1);
      expect(counts.pending).toBe(2);

      void a2; void a3; // suppress unused var warnings
    });

    it('does not count actions from other workspaces', () => {
      recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws2.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
      });

      const counts = getWorkspaceCounts(ws.workspaceId);
      expect(counts.total).toBe(0);
    });
  });

  // ── getTopWinsFromActions ─────────────────────────────────────────────────────

  describe('getTopWinsFromActions', () => {
    it('returns empty array when no actions have WIN_SCORES outcomes', () => {
      const action = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });

      recordOutcome({
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeBaseline(),
        score: 'neutral',
        deltaSummary: makeDelta({ delta_percent: 5 }),
      });

      const actions = getActionsByWorkspace(ws.workspaceId);
      const wins = getTopWinsFromActions(actions, 10);
      expect(wins.length).toBe(0);
    });

    it('returns wins sorted by absolute delta_percent descending', () => {
      const a1 = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'content_published',
        sourceType: 'brief',
        baselineSnapshot: BASELINE,
      });
      const a2 = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'meta_updated',
        sourceType: 'insight',
        baselineSnapshot: BASELINE,
      });
      const a3 = recordAction({
        attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
        workspaceId: ws.workspaceId,
        actionType: 'internal_link_added',
        sourceType: 'audit',
        baselineSnapshot: BASELINE,
      });

      // a1: win +10%
      recordOutcome({ actionId: a1.id, checkpointDays: 90, metricsSnapshot: makeBaseline(), score: 'win', deltaSummary: makeDelta({ delta_percent: 10, direction: 'improved' }) });
      // a2: loss -50% (larger absolute value)
      recordOutcome({ actionId: a2.id, checkpointDays: 90, metricsSnapshot: makeBaseline(), score: 'loss', deltaSummary: makeDelta({ delta_percent: -50, direction: 'declined' }) });
      // a3: strong_win +80%
      recordOutcome({ actionId: a3.id, checkpointDays: 90, metricsSnapshot: makeBaseline(), score: 'strong_win', deltaSummary: makeDelta({ delta_percent: 80, direction: 'improved' }) });

      const actions = getActionsByWorkspace(ws.workspaceId);
      const wins = getTopWinsFromActions(actions, 10);

      // Only WIN_SCORES (strong_win, win) qualify — loss is excluded
      expect(wins.length).toBeGreaterThan(0);
      expect(wins.every(w => WIN_SCORES.includes(w.score))).toBe(true); // every-ok: length guard above
      // Sorted by absolute delta_percent descending: a3 (80%) before a1 (10%)
      expect(wins[0].delta.delta_percent).toBeGreaterThan(wins[1]?.delta.delta_percent ?? -Infinity);
      expect(wins[0].actionId).toBe(a3.id);
      expect(wins[1].actionId).toBe(a1.id);
    });

    it('respects the limit parameter', () => {
      // Create 5 winning actions
      for (let i = 0; i < 5; i++) {
        const a = recordAction({
          attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
          workspaceId: ws.workspaceId,
          actionType: 'meta_updated',
          sourceType: 'insight',
          baselineSnapshot: BASELINE,
        });
        recordOutcome({
          actionId: a.id,
          checkpointDays: 90,
          metricsSnapshot: makeBaseline(),
          score: 'win',
          deltaSummary: makeDelta({ delta_percent: 20 + i }),
        });
      }

      const actions = getActionsByWorkspace(ws.workspaceId);
      const topTwo = getTopWinsFromActions(actions, 2);
      expect(topTwo.length).toBe(2);
    });

    it('applies the 50-action cap: getOutcomes stub is not called for actions beyond position 50', () => {
      // Create 55 actions but only record outcomes for the last 5 (indices 50-54)
      // The cap ensures only the first 50 actions have getOutcomes called.
      // We verify by checking that a stub is called at most 50 times.
      const allActions: TrackedAction[] = [];
      for (let i = 0; i < 55; i++) {
        allActions.push(recordAction({
          attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
          workspaceId: ws.workspaceId,
          actionType: 'content_published',
          sourceType: 'brief',
          baselineSnapshot: BASELINE,
        }));
      }

      const getOutcomesStub = vi.fn((_actionId: string): ActionOutcome[] => []);

      getTopWinsFromActions(allActions, 10, getOutcomesStub);

      // Should only query outcomes for the first 50 actions
      expect(getOutcomesStub).toHaveBeenCalledTimes(50);
    });

    it('uses custom getOutcomes accessor when provided', () => {
      const actions = [
        {
          id: 'fake-action-1',
          workspaceId: ws.workspaceId,
          actionType: 'content_published' as const,
          sourceType: 'brief',
          sourceId: null,
          pageUrl: '/blog/test',
          targetKeyword: null,
          baselineSnapshot: BASELINE,
          trailingHistory: { metric: 'clicks', dataPoints: [] },
          attribution: 'platform_executed' as const,
          measurementWindow: 90,
          measurementComplete: false,
          sourceFlag: 'live' as const,
          baselineConfidence: 'exact' as const,
          context: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const fakeOutcome: ActionOutcome = {
        id: 'fake-outcome-1',
        actionId: 'fake-action-1',
        checkpointDays: 90,
        metricsSnapshot: makeBaseline({ clicks: 200 }),
        score: 'strong_win',
        deltaSummary: makeDelta({ delta_percent: 100, direction: 'improved' }),
        competitorContext: null,
        measuredAt: new Date().toISOString(),
      };

      const customGetOutcomes = vi.fn((_id: string): ActionOutcome[] => [fakeOutcome]);

      const wins = getTopWinsFromActions(actions, 10, customGetOutcomes);
      expect(wins.length).toBe(1);
      expect(wins[0].actionId).toBe('fake-action-1');
      expect(wins[0].score).toBe('strong_win');
      expect(customGetOutcomes).toHaveBeenCalledTimes(1);
    });
  });
});
