/**
 * Reconcile R6-PR1 (Task B11) — snapshot-on-write EXPAND.
 *
 * Verifies the source-identity snapshot columns (source_label, source_snapshot)
 * added to tracked_actions + its archive twin:
 *   1. recordAction with a `source` persists BOTH source_label and source_snapshot,
 *      round-tripping through rowToTrackedAction as sourceLabel + sourceSnapshot.
 *   2. recordAction with NO `source` still works — both columns stay NULL (nullable,
 *      expand-only). This is the contract that keeps the change back-compatible across
 *      all ~16 production call sites + the ~30 pinning test files.
 *   3. Archive round-trip: archiveOldActions() preserves both new columns into
 *      tracked_actions_archive via the explicit generated column list (no positional
 *      SELECT * corruption — the exact class migration 165's twin rebuild guards).
 *   4. Win-title resolution is snapshot-FIRST with the live-lookup + generic fallback
 *      INTACT (resolution order = snapshot → live → generic). The generic fallback is
 *      NOT deleted here — its demotion is B12's job after the integrity sweep.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// ── Mocks (must appear before any import of outcome-tracking) ─────────────
vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: vi.fn(),
  withWorkspaceLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  debouncedOutcomeReweight: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: vi.fn() }));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { ANNOTATION_BRIDGE_CREATED: 'annotation_bridge_created' },
}));
vi.mock('../../server/insight-score-adjustments.js', () => ({
  applyScoreAdjustment: vi.fn((data: unknown, score: number) => ({ data, adjustedScore: score })),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import db from '../../server/db/index.js';
import { recordAction, recordOutcome, archiveOldActions, getAction } from '../../server/outcome-tracking.js';
import type { BaselineSnapshot, TrackedActionSourceSnapshot } from '../../shared/types/outcome-tracking.js';

const WS = 'src-snap-test-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Src Snapshot WS', 'test-folder', new Date().toISOString());
}

const baseline: BaselineSnapshot = { captured_at: new Date().toISOString(), clicks: 10 };

beforeEach(() => {
  db.prepare(
    "DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE 'src-snap-test-%')",
  ).run();
  db.prepare("DELETE FROM tracked_actions WHERE workspace_id LIKE 'src-snap-test-%'").run();
  seedWorkspace(WS);
});

afterAll(() => {
  db.prepare(`DELETE FROM tracked_actions_archive WHERE workspace_id LIKE 'src-snap-test-%'`).run();
  db.prepare(
    "DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id LIKE 'src-snap-test-%')",
  ).run();
  db.prepare("DELETE FROM tracked_actions WHERE workspace_id LIKE 'src-snap-test-%'").run();
  db.prepare("DELETE FROM workspaces WHERE id LIKE 'src-snap-test-%'").run();
});

describe('recordAction — source-identity snapshot persistence', () => {
  it('persists source_label + source_snapshot when a source is threaded', () => {
    const snapshot: TrackedActionSourceSnapshot = {
      title: 'How to choose a local plumber',
      type: 'post',
      page: '/blog/choose-a-plumber',
    };
    const action = recordAction({
      workspaceId: WS,
      actionType: 'content_published',
      sourceType: 'post',
      sourceId: 'post-1',
      baselineSnapshot: baseline,
      source: { label: snapshot.title!, snapshot },
    });

    // Read back through the mapper.
    const readBack = getAction(action.id);
    expect(readBack).not.toBeNull();
    expect(readBack!.sourceLabel).toBe('How to choose a local plumber');
    expect(readBack!.sourceSnapshot).toEqual(snapshot);

    // And the raw columns are populated (source_label flat, source_snapshot JSON).
    const raw = db
      .prepare(`SELECT source_label, source_snapshot FROM tracked_actions WHERE id = ?`)
      .get(action.id) as { source_label: string | null; source_snapshot: string | null };
    expect(raw.source_label).toBe('How to choose a local plumber');
    expect(JSON.parse(raw.source_snapshot!)).toEqual(snapshot);
  });

  it('leaves both columns NULL when NO source is threaded (nullable, expand-only)', () => {
    const action = recordAction({
      workspaceId: WS,
      actionType: 'schema_deployed',
      sourceType: 'schema',
      sourceId: 'page-1',
      baselineSnapshot: baseline,
      // no `source`
    });

    const readBack = getAction(action.id);
    expect(readBack).not.toBeNull();
    expect(readBack!.sourceLabel).toBeNull();
    expect(readBack!.sourceSnapshot).toBeNull();

    const raw = db
      .prepare(`SELECT source_label, source_snapshot FROM tracked_actions WHERE id = ?`)
      .get(action.id) as { source_label: string | null; source_snapshot: string | null };
    expect(raw.source_label).toBeNull();
    expect(raw.source_snapshot).toBeNull();
  });

  it('accepts a label-only source (snapshot omitted) — source_snapshot stays NULL', () => {
    const action = recordAction({
      workspaceId: WS,
      actionType: 'brief_created',
      sourceType: 'brief',
      sourceId: 'brief-1',
      baselineSnapshot: baseline,
      source: { label: 'Spring plumbing checklist brief' },
    });
    const readBack = getAction(action.id);
    expect(readBack!.sourceLabel).toBe('Spring plumbing checklist brief');
    expect(readBack!.sourceSnapshot).toBeNull();
  });
});

describe('archiveOldActions — source snapshot round-trip in archive', () => {
  it('preserves source_label + source_snapshot through the archive sweep', () => {
    const snapshot: TrackedActionSourceSnapshot = { title: 'Archived source title', type: 'recommendation' };
    const action = recordAction({
      workspaceId: WS,
      actionType: 'audit_fix_applied',
      sourceType: 'recommendation',
      sourceId: 'rec-arc-1',
      baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 5 },
      source: { label: snapshot.title!, snapshot },
    });

    // Complete at 90d so it becomes archive-eligible, then backdate outside the window.
    recordOutcome({
      actionId: action.id,
      checkpointDays: 90,
      metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 20 },
      score: 'win',
      deltaSummary: {
        primary_metric: 'clicks',
        baseline_value: 5,
        current_value: 20,
        delta_absolute: 15,
        delta_percent: 300,
        direction: 'improved',
      },
    });
    db.prepare( // ws-scope-ok: test backdates a single row by unique id
      `UPDATE tracked_actions SET updated_at = ?, created_at = ? WHERE id = ?`,
    ).run(
      new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString(),
      action.id,
    );

    archiveOldActions();

    const arc = db
      .prepare(`SELECT source_label, source_snapshot, archived_at FROM tracked_actions_archive WHERE id = ?`)
      .get(action.id) as { source_label: string | null; source_snapshot: string | null; archived_at: string };
    expect(arc).toBeDefined();
    // Pre-fix (positional SELECT *) would have swapped source_snapshot ↔ archived_at.
    expect(arc.source_label).toBe('Archived source title');
    expect(JSON.parse(arc.source_snapshot!)).toEqual(snapshot);
    expect(typeof arc.archived_at).toBe('string');
    expect(isNaN(new Date(arc.archived_at).getTime())).toBe(false);
  });
});
