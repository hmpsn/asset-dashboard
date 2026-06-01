/**
 * FIX 1 — outcome-archive-round-trip.test.ts
 *
 * Verifies that archiveOldActions() round-trips attributed_value and value_basis
 * correctly into action_outcomes_archive. The pre-fix code used
 * `INSERT INTO action_outcomes_archive SELECT *, datetime('now')`, which misaligned
 * columns because migration 106 appended attributed_value/value_basis to the END of
 * action_outcomes but the archive already had archived_at before them (migration 041).
 * This test would fail against the unfixed code because attributed_value would be
 * stored as the archived_at timestamp string and archived_at would receive the REAL
 * attributed_value number (or NULL).
 *
 * After the fix (explicit name-matched column list), attributed_value and value_basis
 * round-trip correctly, and archived_at is a valid ISO/datetime string.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome, archiveOldActions } from '../../server/outcome-tracking.js';

const WS_BASE = 'arc-rt-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Archive RT WS', 'test-folder', new Date().toISOString());
}

afterAll(() => {
  db.prepare(`DELETE FROM action_outcomes_archive WHERE action_id LIKE ?`).run(`arc-rt-%`);
  db.prepare(
    `DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE ?)`,
  ).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM tracked_actions_archive WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

const ATTRIBUTED_VALUE = 37.5;
const VALUE_BASIS = 'clicks_delta_x_cpc';

const WIN_DELTA = {
  primary_metric: 'clicks',
  baseline_value: 10,
  current_value: 25,
  delta_absolute: 15,
  delta_percent: 150,
  direction: 'improved' as const,
};

describe('archiveOldActions — attributed_value / value_basis round-trip in archive', () => {
  let actionId: string;

  beforeAll(() => {
    const ws = `${WS_BASE}-main`;
    seedWorkspace(ws);

    const action = recordAction({ // recordAction-ok
      workspaceId: ws,
      actionType: 'insight_acted_on',
      sourceType: 'archive-rt-test',
      sourceId: 'arc-rt-src-1',
      pageUrl: '/archive-test-page',
      baselineSnapshot: {
        captured_at: new Date(Date.now() - 26 * 30 * 24 * 60 * 60 * 1000).toISOString(),
        clicks: 10,
        impressions: 100,
      },
    });
    actionId = action.id;

    // Record a 90-day outcome (marks measurement_complete = 1) with real attributed_value
    recordOutcome({
      actionId: action.id,
      checkpointDays: 90,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 25 },
      score: 'win',
      deltaSummary: WIN_DELTA,
      attributedValue: ATTRIBUTED_VALUE,
      valueBasis: VALUE_BASIS,
    });

    // Backdate the action so it falls outside the 24-month retention window
    db.prepare( // ws-scope-ok: test backdates a single action row by its unique id
      `UPDATE tracked_actions SET updated_at = ?, created_at = ? WHERE id = ?`,
    ).run(
      new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString(),
      action.id,
    );

    // Run the archive — this inserts the action into tracked_actions_archive
    // and its outcome into action_outcomes_archive, then deletes the originals
    archiveOldActions();
  });

  it('archives the outcome into action_outcomes_archive', () => {
    const row = db.prepare(
      `SELECT * FROM action_outcomes_archive WHERE action_id = ?`,
    ).get(actionId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
  });

  it('round-trips attributed_value as a REAL number (not a timestamp string)', () => {
    const row = db.prepare(
      `SELECT attributed_value FROM action_outcomes_archive WHERE action_id = ?`,
    ).get(actionId) as { attributed_value: unknown } | undefined;

    expect(row).toBeDefined();
    // Pre-fix: attributed_value would be a datetime string like "2026-05-31 18:xx:xx"
    // Post-fix: it must be the numeric ATTRIBUTED_VALUE (37.5)
    expect(typeof row!.attributed_value).toBe('number');
    expect(row!.attributed_value).toBe(ATTRIBUTED_VALUE);
  });

  it('round-trips value_basis as the correct string', () => {
    const row = db.prepare(
      `SELECT value_basis FROM action_outcomes_archive WHERE action_id = ?`,
    ).get(actionId) as { value_basis: unknown } | undefined;

    expect(row).toBeDefined();
    expect(row!.value_basis).toBe(VALUE_BASIS);
  });

  it('stores archived_at as a valid datetime string (not a REAL)', () => {
    const row = db.prepare(
      `SELECT archived_at FROM action_outcomes_archive WHERE action_id = ?`,
    ).get(actionId) as { archived_at: unknown } | undefined;

    expect(row).toBeDefined();
    // Pre-fix: archived_at would be NULL (column after the positional insert ended)
    // or an attributed_value REAL. Post-fix: it must be a parseable datetime string.
    expect(typeof row!.archived_at).toBe('string');
    const parsed = new Date(row!.archived_at as string);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  // NOTE: action_outcomes rows are cascade-deleted when tracked_actions is deleted
  // by deleteArchived. We do not assert the live row is gone here because SQLite's
  // FK cascade depends on connection pragma state; the meaningful contract is
  // that the archive columns round-trip correctly (tests above), which is what
  // the column corruption bug actually broke.
});
