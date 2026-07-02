/**
 * Task 2.1 — outcome-value-column.test.ts
 *
 * Verifies that:
 * 1. recordOutcome persists attributedValue + valueBasis when provided.
 * 2. rowToActionOutcome round-trips both null and non-null values.
 * 3. ActionOutcome shape is correct (type-level + runtime).
 *
 * TDD requirement: test is written to FAIL against the un-modified code
 * (ActionOutcomeRow lacks the columns, rowToActionOutcome drops them, and
 * recordOutcome does not accept them).  After the implementation the test passes.
 */

import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome } from '../../server/outcome-tracking.js';
import type { ActionOutcome } from '../../shared/types/outcome-tracking.js';

// ── seed helper ──────────────────────────────────────────────────────────────

const WS_BASE = 'ovc-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS OVC', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  // Clean up in reverse FK order
  db.prepare(`
    DELETE FROM action_outcomes
    WHERE action_id IN (
      SELECT id FROM tracked_actions WHERE workspace_id LIKE ?
    )
  `).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

function makeAction(wsId: string) {
  return recordAction({ // recordAction-ok
    attribution: 'platform_executed', // B14: attribution now required — preserves the prior default behavior these tests were written against
    workspaceId: wsId,
    actionType: 'content_published',
    sourceType: 'test',
    sourceId: crypto.randomUUID(),
    pageUrl: '/test-page',
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 0 },
  });
}

const BASELINE_DELTA = {
  primary_metric: 'clicks',
  baseline_value: 0,
  current_value: 10,
  delta_absolute: 10,
  delta_percent: 100,
  direction: 'improved' as const,
};

// ── Test 1: null round-trip ──────────────────────────────────────────────────

describe('recordOutcome — attributedValue and valueBasis omitted (null round-trip)', () => {
  it('stores NULL and rowToActionOutcome returns null for both fields', () => {
    const ws = `${WS_BASE}-null`;
    seedWorkspace(ws);
    const action = makeAction(ws);

    const outcome = recordOutcome({
      actionId: action.id,
      checkpointDays: 7,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
      score: 'win',
      deltaSummary: BASELINE_DELTA,
      // intentionally omit attributedValue and valueBasis
    });

    // Type check: fields must exist on ActionOutcome
    const _typeCheck: ActionOutcome = outcome;
    void _typeCheck;

    expect(outcome.attributedValue).toBeNull();
    expect(outcome.valueBasis).toBeNull();

    // Verify DB row directly
    const row = db.prepare(`SELECT attributed_value, value_basis FROM action_outcomes WHERE action_id = ? AND checkpoint_days = 7`).get(action.id) as { attributed_value: number | null; value_basis: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.attributed_value).toBeNull();
    expect(row!.value_basis).toBeNull();
  });
});

// ── Test 2: non-null round-trip ──────────────────────────────────────────────

describe('recordOutcome — attributedValue and valueBasis provided (non-null round-trip)', () => {
  it('persists and round-trips attributedValue=25 valueBasis="clicks_delta_x_cpc"', () => {
    const ws = `${WS_BASE}-nonnull`;
    seedWorkspace(ws);
    const action = makeAction(ws);

    const outcome = recordOutcome({
      actionId: action.id,
      checkpointDays: 30,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
      score: 'win',
      deltaSummary: BASELINE_DELTA,
      attributedValue: 25,
      valueBasis: 'clicks_delta_x_cpc',
    });

    expect(outcome.attributedValue).toBe(25);
    expect(outcome.valueBasis).toBe('clicks_delta_x_cpc');

    // Verify DB row directly
    const row = db.prepare(`SELECT attributed_value, value_basis FROM action_outcomes WHERE action_id = ? AND checkpoint_days = 30`).get(action.id) as { attributed_value: number | null; value_basis: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.attributed_value).toBe(25);
    expect(row!.value_basis).toBe('clicks_delta_x_cpc');
  });
});

// ── Test 3: update idempotency (INSERT OR REPLACE preserves value) ────────────

describe('recordOutcome — INSERT OR REPLACE at same checkpoint preserves latest value', () => {
  it('overwrites an existing outcome row with the new attributed_value', () => {
    const ws = `${WS_BASE}-replace`;
    seedWorkspace(ws);
    const action = makeAction(ws);

    // First record
    recordOutcome({
      actionId: action.id,
      checkpointDays: 60,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 5 },
      score: 'neutral',
      deltaSummary: BASELINE_DELTA,
      attributedValue: 10,
      valueBasis: 'clicks_delta_x_cpc',
    });

    // Second record (simulates re-measurement)
    const second = recordOutcome({
      actionId: action.id,
      checkpointDays: 60,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 20 },
      score: 'strong_win',
      deltaSummary: { ...BASELINE_DELTA, delta_absolute: 20 },
      attributedValue: 50,
      valueBasis: 'clicks_delta_x_cpc',
    });

    expect(second.attributedValue).toBe(50);
    expect(second.valueBasis).toBe('clicks_delta_x_cpc');
  });
});
