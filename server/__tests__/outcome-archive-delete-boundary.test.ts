/**
 * D5 — outcome-archive-delete-boundary.test.ts
 *
 * archiveOldActions() archives rows older than 24 months into tracked_actions_archive,
 * then DELETEs the originals from tracked_actions. The delete used to re-evaluate an
 * INDEPENDENT `datetime('now','-24 months')` cutoff, so a row on the 24-month boundary
 * could be deleted WITHOUT having been archived (its outcomes CASCADE-lost), or archived
 * but not deleted. The fix keys the DELETE on ARCHIVE MEMBERSHIP
 * (`id IN (SELECT id FROM tracked_actions_archive)`), so a live row is deleted IFF it was
 * archived.
 *
 * This test pins two invariants of the membership-keyed delete:
 *   1. An old completed action IS archived AND removed from the live table.
 *   2. A RECENT completed action (never archived) is NEVER deleted — proving the delete
 *      set is exactly the archive set, not a re-derived time window.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import db from '../../server/db/index.js';
import { recordAction, recordOutcome, archiveOldActions, getAction } from '../../server/outcome-tracking.js';

const WS = 'arc-del-boundary-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Archive Del Boundary WS', 'test-folder', new Date().toISOString());
}

const WIN_DELTA = {
  primary_metric: 'clicks',
  baseline_value: 10,
  current_value: 25,
  delta_absolute: 15,
  delta_percent: 150,
  direction: 'improved' as const,
};

let oldActionId: string;
let recentActionId: string;

beforeAll(() => {
  seedWorkspace(WS);

  // ── Old completed action (should be archived + deleted) ──
  const old = recordAction({ // recordAction-ok
    attribution: 'platform_executed',
    workspaceId: WS,
    actionType: 'insight_acted_on',
    sourceType: 'arc-del-boundary-test',
    sourceId: 'old-src',
    pageUrl: '/old-page',
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 10 },
  });
  oldActionId = old.id;
  recordOutcome({
    actionId: old.id,
    checkpointDays: 90,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 25 },
    score: 'win',
    deltaSummary: WIN_DELTA,
  });
  // Backdate BEYOND the 24-month retention window so archiveOld copies it.
  db.prepare( // ws-scope-ok: test backdates a single action row by its unique id
    `UPDATE tracked_actions SET updated_at = ?, created_at = ? WHERE id = ?`,
  ).run(
    new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    new Date(Date.now() - 25 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    old.id,
  );

  // ── Recent completed action (measurement_complete=1 but WITHIN the window) ──
  // It must never be archived nor deleted — proving the delete keys on archive
  // membership, not a re-derived time cutoff.
  const recent = recordAction({ // recordAction-ok
    attribution: 'platform_executed',
    workspaceId: WS,
    actionType: 'insight_acted_on',
    sourceType: 'arc-del-boundary-test',
    sourceId: 'recent-src',
    pageUrl: '/recent-page',
    baselineSnapshot: { captured_at: new Date().toISOString(), clicks: 5 },
  });
  recentActionId = recent.id;
  recordOutcome({
    actionId: recent.id,
    checkpointDays: 90,
    metricsSnapshot: { captured_at: new Date().toISOString(), clicks: 12 },
    score: 'win',
    deltaSummary: WIN_DELTA,
  });
  // NOT backdated — updated_at is "now", inside the 24-month window.

  archiveOldActions();
});

afterAll(() => {
  db.prepare(`DELETE FROM action_outcomes WHERE action_id IN (?, ?)`).run(oldActionId, recentActionId);
  db.prepare(`DELETE FROM action_outcomes_archive WHERE action_id IN (?, ?)`).run(oldActionId, recentActionId);
  db.prepare(`DELETE FROM tracked_actions WHERE workspace_id = ?`).run(WS);
  db.prepare(`DELETE FROM tracked_actions_archive WHERE workspace_id = ?`).run(WS);
  db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(WS);
});

describe('archiveOldActions — delete keys on archive membership (D5)', () => {
  it('archives the old action into tracked_actions_archive', () => {
    const row = db.prepare(
      `SELECT id FROM tracked_actions_archive WHERE id = ?`,
    ).get(oldActionId) as { id: string } | undefined;
    expect(row?.id).toBe(oldActionId);
  });

  it('removes the archived old action from the live tracked_actions table', () => {
    expect(getAction(oldActionId)).toBeNull();
  });

  it('never archives the recent (in-window) action', () => {
    const row = db.prepare(
      `SELECT id FROM tracked_actions_archive WHERE id = ?`,
    ).get(recentActionId) as { id: string } | undefined;
    expect(row).toBeUndefined();
  });

  it('never deletes the recent action — it is not in the archive, so the membership-keyed delete leaves it live', () => {
    const live = getAction(recentActionId);
    expect(live).not.toBeNull();
    expect(live?.id).toBe(recentActionId);
  });
});
