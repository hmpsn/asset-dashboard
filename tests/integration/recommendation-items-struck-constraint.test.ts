/**
 * Reconcile R4-PR2 — DB-level backstop for the struck≠completed invariant
 * (migration 168-recommendation-items-struck-ne-completed.sql).
 *
 * R4-PR1 (already merged) added the APP-LEVEL guard: StruckRecCompletionError in
 * server/domains/recommendations/status-service.ts refuses to complete a struck (or
 * sent/discussing/approved) recommendation via updateRecommendationStatus. This suite
 * covers the DB-level half — an INSERT + UPDATE trigger pair on recommendation_items
 * that makes lifecycle='struck' AND status='completed' unbypassable even by a direct
 * SQL write, and confirms the app guard still fires FIRST on the normal app path (the
 * trigger is a backstop, not the primary UX).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { strikeRecommendation } from '../../server/recommendation-lifecycle.js';
import { applyBulkRecommendationAction } from '../../server/domains/recommendations/route-mutations.js';
import { StruckRecCompletionError, updateRecommendationStatus } from '../../server/domains/recommendations/status-service.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const MIGRATION_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../server/db/migrations/168-recommendation-items-struck-ne-completed.sql',
);

const MIGRATION_171_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../server/db/migrations/171-recommendation-items-struck-completed-payload-cleanup.sql',
);

/** Extract the exact cleanup UPDATE statement from the migration file so this test and the
 *  migration can never diverge on the resolution status OR the timestamp format. Matches the
 *  first `UPDATE recommendation_items ... ;` statement in the file. */
function migrationCleanupStatement(): string {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const match = sql.match(/UPDATE\s+recommendation_items[\s\S]*?;/i);
  if (!match) throw new Error('Could not locate the cleanup UPDATE statement in migration 168');
  return match[0];
}

/** Extract the exact one-time payload-cleanup UPDATE from migration 171, so this test and the
 *  migration can never diverge. Migration 171 finishes what 168 started: 168 reset only the
 *  STATUS COLUMN of struck+completed rows; 171 also rewrites the payload JSON (reads parse the
 *  payload only). */
function migration171Statement(): string {
  const sql = readFileSync(MIGRATION_171_PATH, 'utf-8');
  const match = sql.match(/UPDATE\s+recommendation_items[\s\S]*?;/i);
  if (!match) throw new Error('Could not locate the cleanup UPDATE statement in migration 171');
  return match[0];
}

let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: 't', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 's', affectedPages: ['home'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId, generatedAt: new Date().toISOString(), recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

/** Minimal direct-SQL row insert bypassing all app-layer writers, to prove the DB trigger
 *  (not just the app guard) rejects the invariant violation. Mirrors itemParams() in
 *  server/domains/recommendations/storage.ts closely enough for FK/NOT NULL satisfaction. */
function rawInsertItem(overrides: { id: string; status: string; lifecycle: string | null }): void {
  const now = new Date().toISOString();
  const payload = JSON.stringify(rec({ id: overrides.id, status: overrides.status as Recommendation['status'], lifecycle: overrides.lifecycle as Recommendation['lifecycle'] }));
  db.prepare(`
    INSERT INTO recommendation_items (
      workspace_id, id, rank_order, type, priority, status, source, impact,
      impact_score, client_status, lifecycle, target_keyword, created_at,
      updated_at, payload
    ) VALUES (
      @workspace_id, @id, @rank_order, @type, @priority, @status, @source,
      @impact, @impact_score, @client_status, @lifecycle, @target_keyword,
      @created_at, @updated_at, @payload
    )
  `).run({
    workspace_id: wsId,
    id: overrides.id,
    rank_order: 0,
    type: 'metadata',
    priority: 'fix_now',
    status: overrides.status,
    source: 's',
    impact: 'high',
    impact_score: 50,
    client_status: null,
    lifecycle: overrides.lifecycle,
    target_keyword: null,
    created_at: now,
    updated_at: now,
    payload,
  });
}

beforeAll(() => {
  wsId = createWorkspace('Rec Struck Constraint Test').id;
  // recommendation_items FKs to recommendation_sets(workspace_id) — seed an (empty) set row up
  // front so every raw-SQL test below satisfies the FK regardless of execution order, and any
  // FOREIGN KEY failure the tests observe can only ever be attributable to the trigger under test.
  seed([]);
});
afterAll(() => { deleteWorkspace(wsId); });

describe('recommendation_items struck≠completed DB trigger', () => {
  it('trigger exists on recommendation_items', () => {
    const triggers = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'recommendation_items'`)
      .all() as Array<{ name: string }>;
    const names = triggers.map(t => t.name);
    expect(names).toContain('trg_recommendation_items_struck_ne_completed_insert');
    expect(names).toContain('trg_recommendation_items_struck_ne_completed_update');
  });

  it('rejects a direct INSERT that violates the invariant (lifecycle=struck AND status=completed)', () => {
    expect(() => rawInsertItem({ id: 'raw-insert-1', status: 'completed', lifecycle: 'struck' }))
      .toThrowError(/SQLITE_CONSTRAINT|struck recommendation cannot have status=completed/);

    // Confirm nothing was actually persisted (ABORT rolls back the statement).
    const row = db.prepare(`SELECT id FROM recommendation_items WHERE workspace_id = ? AND id = ?`).get(wsId, 'raw-insert-1');
    expect(row).toBeUndefined();
  });

  it('rejects a direct UPDATE that violates the invariant', () => {
    // Seed a valid struck-but-pending row first (via a clean insert), then attempt to flip
    // status to completed directly with SQL, bypassing the app guard entirely.
    rawInsertItem({ id: 'raw-update-1', status: 'pending', lifecycle: 'struck' });

    expect(() =>
      db.prepare(`UPDATE recommendation_items SET status = 'completed' WHERE workspace_id = ? AND id = ?`)
        .run(wsId, 'raw-update-1')
    ).toThrowError(/SQLITE_CONSTRAINT|struck recommendation cannot have status=completed/);

    // Confirm the row is unchanged (still pending).
    const row = db.prepare(`SELECT status FROM recommendation_items WHERE workspace_id = ? AND id = ?`).get(wsId, 'raw-update-1') as { status: string } | undefined;
    expect(row?.status).toBe('pending');
  });

  it('allows a direct INSERT/UPDATE when lifecycle=struck but status is NOT completed', () => {
    expect(() => rawInsertItem({ id: 'raw-insert-ok', status: 'pending', lifecycle: 'struck' })).not.toThrow();
    expect(() =>
      db.prepare(`UPDATE recommendation_items SET status = 'in_progress' WHERE workspace_id = ? AND id = ?`)
        .run(wsId, 'raw-insert-ok')
    ).not.toThrow();
  });

  it('a full regen save (writeItems delete+reinsert) of a CLEAN set is unaffected by the trigger', () => {
    // No violations anywhere in this set — the ordinary saveRecommendations (delete-then-reinsert
    // inside one transaction) path must succeed exactly as before the migration.
    seed([
      rec({ id: 'clean-1', status: 'pending' }),
      rec({ id: 'clean-2', status: 'completed' }),
      rec({ id: 'clean-3', status: 'in_progress', lifecycle: 'struck' }),
      rec({ id: 'clean-4', status: 'dismissed', lifecycle: 'active' }),
    ]);

    const loaded = loadRecommendations(wsId);
    expect(loaded?.recommendations).toHaveLength(4);
    expect(loaded?.recommendations.find(r => r.id === 'clean-3')?.lifecycle).toBe('struck');
    expect(loaded?.recommendations.find(r => r.id === 'clean-3')?.status).toBe('in_progress');
  });

  it('the guarded app path (updateRecommendationStatus) throws StruckRecCompletionError BEFORE reaching the trigger', () => {
    seed([rec({ id: 'app-guard-1', status: 'pending' })]);
    const struck = strikeRecommendation(wsId, 'app-guard-1');
    expect(struck?.lifecycle).toBe('struck');

    // The app-level guard must fire — a StruckRecCompletionError, NOT a raw SQLITE_CONSTRAINT
    // error bubbling up from the trigger. This proves the app guard shields the trigger on the
    // normal write path (trigger is a backstop for direct/out-of-band writes only).
    expect(() => updateRecommendationStatus(wsId, 'app-guard-1', 'completed')).toThrow(StruckRecCompletionError);

    // Status must remain unchanged (never reached the DB write at all).
    const loaded = loadRecommendations(wsId);
    const after = loaded?.recommendations.find(r => r.id === 'app-guard-1');
    expect(after?.status).toBe('pending');
    expect(after?.lifecycle).toBe('struck');
  });

  it('migration cleanup UPDATE resolves a pre-existing struck+completed row to pending', () => {
    // The migration's cleanup UPDATE (168-recommendation-items-struck-ne-completed.sql) runs
    // BEFORE the triggers are created, specifically so a historical violation (written before the
    // R4-PR1 app guard existed) doesn't ABORT the migration itself or a subsequent regen. We
    // can't re-run migration 168 against this already-migrated DB, but we CAN reproduce its exact
    // ordering here: drop the triggers, plant a violation the triggers would normally reject, run
    // the identical cleanup UPDATE statement from the migration file, then reinstate the triggers
    // — proving the cleanup statement actually resolves the violation it's meant to.
    db.exec(`DROP TRIGGER IF EXISTS trg_recommendation_items_struck_ne_completed_insert`);
    db.exec(`DROP TRIGGER IF EXISTS trg_recommendation_items_struck_ne_completed_update`);
    try {
      rawInsertItem({ id: 'legacy-violation-1', status: 'completed', lifecycle: 'struck' });
      const before = db.prepare(`SELECT status FROM recommendation_items WHERE workspace_id = ? AND id = ?`).get(wsId, 'legacy-violation-1') as { status: string };
      expect(before.status).toBe('completed');

      // Run the EXACT cleanup statement read from the migration file (not a hand-copied one), so
      // the test can never drift from the migration on the resolution status OR the timestamp
      // format. If someone regressed the migration's `strftime(...)` back to CURRENT_TIMESTAMP,
      // the ISO-8601 assertion below fails here — the regression this migration's comment warns of.
      db.exec(migrationCleanupStatement());

      const after = db.prepare(`SELECT status, lifecycle, updated_at FROM recommendation_items WHERE workspace_id = ? AND id = ?`).get(wsId, 'legacy-violation-1') as { status: string; lifecycle: string; updated_at: string };
      expect(after.status).toBe('pending');
      expect(after.lifecycle).toBe('struck');
      // The cleanup must stamp an ISO-8601 timestamp (matching new Date().toISOString()), NOT
      // SQLite's default 'YYYY-MM-DD HH:MM:SS' — this pins the strftime format contract.
      expect(after.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      // Reinstate the triggers exactly as migration 168 defines them, regardless of assertion outcome.
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_recommendation_items_struck_ne_completed_insert
        BEFORE INSERT ON recommendation_items
        FOR EACH ROW
        WHEN NEW.lifecycle = 'struck' AND NEW.status = 'completed'
        BEGIN
          SELECT RAISE(ABORT, 'recommendation_items: a struck recommendation cannot have status=completed');
        END;
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_recommendation_items_struck_ne_completed_update
        BEFORE UPDATE ON recommendation_items
        FOR EACH ROW
        WHEN NEW.lifecycle = 'struck' AND NEW.status = 'completed'
        BEGIN
          SELECT RAISE(ABORT, 'recommendation_items: a struck recommendation cannot have status=completed');
        END;
      `);
    }

    // After reinstatement, the trigger must again reject new violations — proving cleanup +
    // trigger creation together leave the table permanently clean going forward.
    expect(() => rawInsertItem({ id: 'post-cleanup-violation', status: 'completed', lifecycle: 'struck' }))
      .toThrowError(/SQLITE_CONSTRAINT|struck recommendation cannot have status=completed/);
  });

  it('no struck+completed rows remain in the workspace after this suite (global invariant sanity check)', () => {
    const violations = db
      .prepare(`SELECT COUNT(*) as cnt FROM recommendation_items WHERE workspace_id = ? AND lifecycle = 'struck' AND status = 'completed'`)
      .get(wsId) as { cnt: number };
    expect(violations.cnt).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 regression — striking an ALREADY-completed rec is a LEGITIMATE operator action.
//
// B6's app guard blocks only the forward leg (setting status='completed' on a struck rec). The
// REVERSE — striking a rec that is already status='completed' — is legal and unguarded, and
// strikeRecommendation writes ONLY the lifecycle axis. Without the invariant-preserving reset,
// that persist would produce lifecycle='struck' + status='completed', which this migration's
// UPDATE trigger now ABORTs → a 500 on a legitimate strike (and an ENTIRE bulk-strike abort,
// since applyBulkRecommendationAction runs the whole batch in ONE transaction). The fix resets
// status→pending inside the same strike mutation so the trigger can never fire on the app path.
// ─────────────────────────────────────────────────────────────────────────────

describe('C1 — strike of an already-completed rec succeeds (status reset to pending)', () => {
  let cwsId = '';
  beforeAll(() => { cwsId = createWorkspace('Rec Strike-Completed Regression Test').id; });
  afterAll(() => { deleteWorkspace(cwsId); });

  function seedC(recs: Recommendation[]): void {
    saveRecommendations({
      workspaceId: cwsId,
      generatedAt: new Date().toISOString(),
      recommendations: recs.map(r => ({ ...r, workspaceId: cwsId })),
      summary: computeRecommendationSummary(recs),
    });
  }

  it('strikeRecommendation on a completed rec resets status→pending and does NOT throw a SQLite abort', () => {
    // status='completed' + lifecycle='active' is a legal, unguarded starting state.
    seedC([rec({ id: 'strike-completed-1', status: 'completed', lifecycle: 'active' })]);

    // Must NOT throw (pre-fix this raised SqliteError: SQLITE_CONSTRAINT_TRIGGER).
    const struck = strikeRecommendation(cwsId, 'strike-completed-1');
    expect(struck).not.toBeNull();
    expect(struck?.lifecycle).toBe('struck');
    // The invariant-preserving reset: status must have been reverted from completed → pending.
    expect(struck?.status).toBe('pending');

    // And the persisted row reflects both axes consistently (no contradictory row on disk).
    const loaded = loadRecommendations(cwsId);
    const after = loaded?.recommendations.find(r => r.id === 'strike-completed-1');
    expect(after?.lifecycle).toBe('struck');
    expect(after?.status).toBe('pending');
  });

  it('strikeRecommendation on a NON-completed rec leaves status untouched (no spurious reset)', () => {
    seedC([rec({ id: 'strike-inprogress-1', status: 'in_progress', lifecycle: 'active' })]);

    const struck = strikeRecommendation(cwsId, 'strike-inprogress-1');
    expect(struck?.lifecycle).toBe('struck');
    // Only 'completed' is reset; in_progress must survive the strike unchanged.
    expect(struck?.status).toBe('in_progress');
  });

  it('bulk strike over a batch containing a completed rec strikes ALL of them (no batch abort)', () => {
    // One completed rec in the batch would, pre-fix, ABORT the entire single-transaction bulk
    // strike. Post-fix all three are struck and the completed one is reset to pending.
    seedC([
      rec({ id: 'bulk-a', status: 'pending', lifecycle: 'active' }),
      rec({ id: 'bulk-b', status: 'completed', lifecycle: 'active' }),
      rec({ id: 'bulk-c', status: 'in_progress', lifecycle: 'active' }),
    ]);

    const mutated = applyBulkRecommendationAction({
      workspaceId: cwsId,
      recIds: ['bulk-a', 'bulk-b', 'bulk-c'],
      action: 'strike',
    });
    expect(mutated).toHaveLength(3);

    const loaded = loadRecommendations(cwsId);
    const byId = new Map(loaded!.recommendations.map(r => [r.id, r]));
    // All three struck.
    expect(byId.get('bulk-a')?.lifecycle).toBe('struck');
    expect(byId.get('bulk-b')?.lifecycle).toBe('struck');
    expect(byId.get('bulk-c')?.lifecycle).toBe('struck');
    // The formerly-completed rec was reset to pending; the others keep their status.
    expect(byId.get('bulk-a')?.status).toBe('pending');
    expect(byId.get('bulk-b')?.status).toBe('pending');
    expect(byId.get('bulk-c')?.status).toBe('in_progress');

    // No contradictory rows remain for this workspace.
    const violations = db
      .prepare(`SELECT COUNT(*) as cnt FROM recommendation_items WHERE workspace_id = ? AND lifecycle = 'struck' AND status = 'completed'`)
      .get(cwsId) as { cnt: number };
    expect(violations.cnt).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C4 — migration 171 finishes 168's cleanup by rewriting the PAYLOAD JSON.
//
// 168's one-time UPDATE reset only the `status` COLUMN of struck+completed rows. But reads
// parse the `payload` JSON ONLY (itemRowToRecommendation), so a row whose column was cleaned
// to 'pending' while its payload still says {status:'completed'} is STILL served as completed
// on a struck rec — and re-derives a struck+completed column on the next regen, ABORTing the
// whole writeItems transaction via the 168 trigger. Migration 171 rewrites $.status in the
// payload (and keeps the column consistent) to close that residual gap.
// ─────────────────────────────────────────────────────────────────────────────

describe('migration 171 — one-time payload cleanup for residual struck+completed blobs', () => {
  let mwsId = '';
  beforeAll(() => {
    mwsId = createWorkspace('Rec Migration171 Payload Cleanup Test').id;
    // Seed an empty set row so recommendation_items FKs are satisfied.
    saveRecommendations({
      workspaceId: mwsId, generatedAt: new Date().toISOString(), recommendations: [],
      summary: computeRecommendationSummary([]),
    });
  });
  afterAll(() => { deleteWorkspace(mwsId); });

  it('rewrites $.status in the payload of a row 168 left half-cleaned (column pending, payload still completed)', () => {
    // Reproduce EXACTLY the residual state 168 leaves: the STATUS COLUMN is already 'pending'
    // (168's column-only UPDATE ran), but the PAYLOAD JSON still carries status:'completed'.
    // This row does NOT violate the trigger (column status='pending'), so we can insert it
    // directly without dropping the triggers.
    const now = new Date().toISOString();
    const staleBlob = JSON.stringify(
      rec({ id: 'mig171-residual', status: 'completed', lifecycle: 'struck', workspaceId: mwsId }),
    );
    db.prepare(`
      INSERT INTO recommendation_items (
        workspace_id, id, rank_order, type, priority, status, source, impact,
        impact_score, client_status, lifecycle, target_keyword, created_at, updated_at, payload
      ) VALUES (?, 'mig171-residual', 0, 'metadata', 'fix_now', 'pending', 's', 'high',
        50, NULL, 'struck', NULL, ?, ?, ?)
    `).run(mwsId, now, now, staleBlob);

    // Precondition: the column is clean but the payload is not — the residual bug 171 fixes.
    const before = db.prepare(
      `SELECT status, payload FROM recommendation_items WHERE workspace_id = ? AND id = ?`,
    ).get(mwsId, 'mig171-residual') as { status: string; payload: string };
    expect(before.status).toBe('pending');
    expect((JSON.parse(before.payload) as Recommendation).status).toBe('completed');

    // Run the EXACT statement from the migration file (not a hand-copied one) so this test
    // can never drift from migration 171.
    db.exec(migration171Statement());

    const after = db.prepare(
      `SELECT status, lifecycle, payload, updated_at FROM recommendation_items WHERE workspace_id = ? AND id = ?`,
    ).get(mwsId, 'mig171-residual') as { status: string; lifecycle: string; payload: string; updated_at: string };
    // Both the column AND the payload are now 'pending'.
    expect(after.status).toBe('pending');
    expect(after.lifecycle).toBe('struck');
    const payload = JSON.parse(after.payload) as Recommendation;
    expect(payload.status).toBe('pending');
    expect(payload.lifecycle).toBe('struck');
    // ISO-8601 timestamp contract (matches new Date().toISOString()), not SQLite's default.
    expect(after.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // The reader (payload-only) now sees pending.
    const loaded = loadRecommendations(mwsId);
    const loadedRec = loaded?.recommendations.find(r => r.id === 'mig171-residual');
    expect(loadedRec?.status).toBe('pending');
    expect(loadedRec?.lifecycle).toBe('struck');
  });

  it('does not touch a struck rec whose payload is legitimately non-completed', () => {
    const now = new Date().toISOString();
    const okBlob = JSON.stringify(
      rec({ id: 'mig171-ok', status: 'in_progress', lifecycle: 'struck', workspaceId: mwsId }),
    );
    db.prepare(`
      INSERT INTO recommendation_items (
        workspace_id, id, rank_order, type, priority, status, source, impact,
        impact_score, client_status, lifecycle, target_keyword, created_at, updated_at, payload
      ) VALUES (?, 'mig171-ok', 1, 'metadata', 'fix_now', 'in_progress', 's', 'high',
        50, NULL, 'struck', NULL, ?, ?, ?)
    `).run(mwsId, now, now, okBlob);

    db.exec(migration171Statement());

    const after = db.prepare(
      `SELECT status, payload FROM recommendation_items WHERE workspace_id = ? AND id = ?`,
    ).get(mwsId, 'mig171-ok') as { status: string; payload: string };
    expect(after.status).toBe('in_progress');
    expect((JSON.parse(after.payload) as Recommendation).status).toBe('in_progress');
  });
});
