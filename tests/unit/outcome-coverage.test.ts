/**
 * Unit tests for server/outcome-coverage.ts (Reconcile R9 / Task B15).
 *
 * computeOutcomeCoverage(workspaceId) buckets action_outcomes rows for a workspace by their
 * `provenance` column into the admin-only coverage funnel: tracked / measured / reconciled.
 *
 * Covers:
 *  - denominators equal the row counts by provenance value on a seeded workspace
 *  - a NULL-provenance row counts as the 'estimate_ga4' legacy read-fallback (tracked only)
 *  - measured/reconciled are inclusive of the stronger stage they gate
 *  - a workspace with no outcome rows returns all-zero counts (never throws)
 */
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// ── Mocks (must appear before any import of outcome-tracking) ─────────────
// Mirrors tests/unit/outcome-tracking-core.test.ts — recordAction/recordOutcome pull in the
// bridge/broadcast/ws-events machinery, which must be stubbed for a DB-only unit test.

vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: vi.fn(),
  withWorkspaceLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  debouncedOutcomeReweight: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { OUTCOME_LEARNINGS_UPDATED: 'outcome:learnings_updated' },
}));
vi.mock('../../server/insight-score-adjustments.js', () => ({
  applyScoreAdjustment: vi.fn((data: unknown, score: number) => ({ data, adjustedScore: score })),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

// ── Imports ───────────────────────────────────────────────────────────────

import db from '../../server/db/index.js';
import { computeOutcomeCoverage } from '../../server/outcome-coverage.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import type { BaselineSnapshot, DeltaSummary } from '../../shared/types/outcome-tracking.js';

// Workspace IDs for DB tests — prefixed for targeted cleanup, matching the outcome-tracking-core
// convention (WS_DB / cleanupTestWorkspaces).
const WS_COVERAGE = 'oc-test-ws';
const WS_EMPTY = 'oc-test-empty-ws';

function cleanupTestWorkspaces() {
  db.prepare(
    "DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE 'oc-test-%')",
  ).run();
  db.prepare("DELETE FROM tracked_actions WHERE workspace_id LIKE 'oc-test-%'").run();
}

const baselineSnapshot: BaselineSnapshot = {
  captured_at: '2026-01-01T00:00:00Z',
  position: 15,
  impressions: 1000,
  clicks: 50,
};

function makeDelta(): DeltaSummary {
  return {
    primary_metric: 'clicks',
    baseline_value: 10,
    current_value: 20,
    delta_absolute: 10,
    delta_percent: 100,
    direction: 'improved',
  };
}

/** Records a tracked action + one outcome row with the given provenance (or omits the field
 *  entirely to simulate a legacy NULL-provenance row when `provenance` is undefined). */
function seedOutcome(workspaceId: string, provenance?: 'estimate_ga4' | 'measured_action' | 'actual_reconciled') {
  const action = recordAction({
    attribution: 'platform_executed',
    workspaceId,
    actionType: 'meta_updated',
    sourceType: 'insight',
    baselineSnapshot,
  });
  return recordOutcome({
    actionId: action.id,
    checkpointDays: 30,
    metricsSnapshot: baselineSnapshot,
    score: 'win',
    deltaSummary: makeDelta(),
    ...(provenance !== undefined ? { provenance } : {}),
  });
}

describe('computeOutcomeCoverage', () => {
  beforeEach(cleanupTestWorkspaces);
  afterAll(cleanupTestWorkspaces);

  it('returns all-zero counts for a workspace with no outcome rows', () => {
    const coverage = computeOutcomeCoverage(WS_EMPTY);
    expect(coverage).toEqual({ tracked: 0, measured: 0, reconciled: 0 });
  });

  it('counts an explicit estimate_ga4 row as tracked only', () => {
    seedOutcome(WS_COVERAGE, 'estimate_ga4');
    const coverage = computeOutcomeCoverage(WS_COVERAGE);
    expect(coverage).toEqual({ tracked: 1, measured: 0, reconciled: 0 });
  });

  it('a NULL-provenance row (legacy, no provenance threaded) counts as the estimate_ga4 read-fallback — tracked only, never dropped', () => {
    seedOutcome(WS_COVERAGE); // no provenance passed → column is NULL
    const coverage = computeOutcomeCoverage(WS_COVERAGE);
    expect(coverage).toEqual({ tracked: 1, measured: 0, reconciled: 0 });
  });

  it('counts a measured_action row as both tracked and measured', () => {
    seedOutcome(WS_COVERAGE, 'measured_action');
    const coverage = computeOutcomeCoverage(WS_COVERAGE);
    expect(coverage).toEqual({ tracked: 1, measured: 1, reconciled: 0 });
  });

  it('counts an actual_reconciled row as tracked, measured, AND reconciled (inclusive of weaker stages)', () => {
    seedOutcome(WS_COVERAGE, 'actual_reconciled');
    const coverage = computeOutcomeCoverage(WS_COVERAGE);
    expect(coverage).toEqual({ tracked: 1, measured: 1, reconciled: 1 });
  });

  it('denominators equal the row counts by provenance on a seeded workspace with a mix of stages', () => {
    // 2 estimate_ga4 (one explicit, one NULL-legacy) + 3 measured_action + 1 actual_reconciled
    seedOutcome(WS_COVERAGE, 'estimate_ga4');
    seedOutcome(WS_COVERAGE); // NULL → estimate_ga4 fallback
    seedOutcome(WS_COVERAGE, 'measured_action');
    seedOutcome(WS_COVERAGE, 'measured_action');
    seedOutcome(WS_COVERAGE, 'measured_action');
    seedOutcome(WS_COVERAGE, 'actual_reconciled');

    const coverage = computeOutcomeCoverage(WS_COVERAGE);
    // tracked = every row = 6
    expect(coverage.tracked).toBe(6);
    // measured = measured_action (3) + actual_reconciled (1) = 4
    expect(coverage.measured).toBe(4);
    // reconciled = actual_reconciled only = 1
    expect(coverage.reconciled).toBe(1);
  });

  it('is workspace-scoped — rows in another workspace do not leak into the count', () => {
    seedOutcome(WS_COVERAGE, 'actual_reconciled');
    seedOutcome(WS_EMPTY, 'actual_reconciled'); // different workspace — reused for a single row here

    const coverageA = computeOutcomeCoverage(WS_COVERAGE);
    const coverageB = computeOutcomeCoverage(WS_EMPTY);
    expect(coverageA).toEqual({ tracked: 1, measured: 1, reconciled: 1 });
    expect(coverageB).toEqual({ tracked: 1, measured: 1, reconciled: 1 });

    // cleanup the WS_EMPTY row this test seeded (beforeEach only cleans 'oc-test-%', which
    // covers both prefixes, so no extra teardown needed — WS_EMPTY matches the LIKE pattern).
  });
});
