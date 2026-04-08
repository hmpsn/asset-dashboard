/**
 * Codebase-wide audit: SUM() queries return 0 (not null) when no rows match.
 *
 * SQLite SUM() returns NULL (not 0) when no rows match a WHERE clause.
 * Frontend counters that receive NULL silently break — they display nothing
 * or NaN instead of the expected zero. Every SUM() in the codebase should be
 * wrapped in COALESCE(SUM(col), 0) OR the calling function must supply a
 * safe fallback.
 *
 * AUDIT RESULTS (as of current codebase):
 *
 *   server/seo-suggestions.ts — getSuggestionCounts()
 *     Query:   COALESCE(SUM(...), 0) as pending
 *     Query:   COALESCE(SUM(...), 0) as selected
 *     Status:  COALESCE present ✓ — double-protected by `|| 0` in return statement ✓
 *
 *   server/outcome-tracking.ts — getWorkspaceCounts()
 *     Query:   COALESCE(SUM(CASE WHEN measurement_complete = 1 ...), 0) AS scored
 *     Query:   COALESCE(SUM(CASE WHEN measurement_complete = 0 ...), 0) AS pending
 *     Status:  COALESCE present ✓ — null-safe fallback `?? { total:0, ... }` in return ✓
 *
 * Each test below exercises the function against an empty workspace (no rows
 * matching the WHERE clause) and asserts the returned fields are 0, not null.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import db from '../../server/db/index.js';
import { getSuggestionCounts } from '../../server/seo-suggestions.js';
import { getWorkspaceCounts } from '../../server/outcome-tracking.js';

// ─── Shared teardown ──────────────────────────────────────────────────────────

const testWorkspaceIds: string[] = [];

function makeWorkspaceId(): string {
  const id = `test-sum-${randomUUID().slice(0, 8)}`;
  testWorkspaceIds.push(id);
  return id;
}

afterAll(() => {
  for (const id of testWorkspaceIds) {
    db.prepare('DELETE FROM seo_suggestions WHERE workspace_id = ?').run(id);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(id);
  }
});

// ─── 1. getSuggestionCounts (server/seo-suggestions.ts) ──────────────────────
//
// SUM() queries involved:
//   COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending
//   COALESCE(SUM(CASE WHEN status = 'pending' AND selected_index IS NOT NULL THEN 1 ELSE 0 END), 0) as selected

describe('getSuggestionCounts — SUM() returns 0 when no rows exist', () => {
  it('returns pending=0 for a workspace with no suggestions', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getSuggestionCounts(workspaceId);

    expect(counts.pending).toBe(0);
    expect(typeof counts.pending).toBe('number');
    // Explicitly confirm it is not null or undefined
    expect(counts.pending).not.toBeNull();
    expect(counts.pending).not.toBeUndefined();
  });

  it('returns selected=0 for a workspace with no suggestions', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getSuggestionCounts(workspaceId);

    expect(counts.selected).toBe(0);
    expect(typeof counts.selected).toBe('number');
    expect(counts.selected).not.toBeNull();
    expect(counts.selected).not.toBeUndefined();
  });

  it('returns total=0 for a workspace with no suggestions', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getSuggestionCounts(workspaceId);

    expect(counts.total).toBe(0);
    expect(typeof counts.total).toBe('number');
  });

  it('returns all-zero shape { pending, selected, total } for empty workspace', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getSuggestionCounts(workspaceId);

    expect(counts).toEqual({ pending: 0, selected: 0, total: 0 });
  });

  it('returns pending=0 when workspace has only non-pending suggestions', () => {
    const workspaceId = makeWorkspaceId();
    const id = `test-sug-${randomUUID().slice(0, 8)}`;

    // Insert a single applied suggestion — none are pending
    db.prepare(`
      INSERT INTO seo_suggestions
        (id, workspace_id, site_id, page_id, page_title, page_slug, field, current_value, variations, status)
      VALUES (?, ?, 'site-x', 'page-x', 'Home', '/', 'title', 'Old Title', '[]', 'applied')
    `).run(id, workspaceId);

    const counts = getSuggestionCounts(workspaceId);

    // total must reflect the one row
    expect(counts.total).toBe(1);
    // pending SUM() over zero matching rows — must be 0 not null
    expect(counts.pending).toBe(0);
    expect(typeof counts.pending).toBe('number');
    // selected SUM() over zero matching rows — must be 0 not null
    expect(counts.selected).toBe(0);
    expect(typeof counts.selected).toBe('number');
  });

  it('returns selected=0 when pending suggestions exist but none have a selection', () => {
    const workspaceId = makeWorkspaceId();
    const id = `test-sug-${randomUUID().slice(0, 8)}`;

    // Insert a pending suggestion with no selected_index (NULL)
    db.prepare(`
      INSERT INTO seo_suggestions
        (id, workspace_id, site_id, page_id, page_title, page_slug, field, current_value, variations, selected_index, status)
      VALUES (?, ?, 'site-y', 'page-y', 'About', '/about', 'description', 'Old Desc', '[]', NULL, 'pending')
    `).run(id, workspaceId);

    const counts = getSuggestionCounts(workspaceId);

    expect(counts.pending).toBe(1);
    // selected_index IS NULL → the inner SUM CASE counts 0 matching rows → must return 0 not null
    expect(counts.selected).toBe(0);
    expect(typeof counts.selected).toBe('number');
    expect(counts.selected).not.toBeNull();
  });
});

// ─── 2. getWorkspaceCounts (server/outcome-tracking.ts) ──────────────────────
//
// SUM() queries involved:
//   COALESCE(SUM(CASE WHEN measurement_complete = 1 THEN 1 ELSE 0 END), 0) AS scored
//   COALESCE(SUM(CASE WHEN measurement_complete = 0 THEN 1 ELSE 0 END), 0) AS pending

describe('getWorkspaceCounts — SUM() returns 0 when no rows exist', () => {
  it('returns scored=0 for a workspace with no tracked actions', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getWorkspaceCounts(workspaceId);

    expect(counts.scored).toBe(0);
    expect(typeof counts.scored).toBe('number');
    expect(counts.scored).not.toBeNull();
    expect(counts.scored).not.toBeUndefined();
  });

  it('returns pending=0 for a workspace with no tracked actions', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getWorkspaceCounts(workspaceId);

    expect(counts.pending).toBe(0);
    expect(typeof counts.pending).toBe('number');
    expect(counts.pending).not.toBeNull();
    expect(counts.pending).not.toBeUndefined();
  });

  it('returns total=0 for a workspace with no tracked actions', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getWorkspaceCounts(workspaceId);

    expect(counts.total).toBe(0);
    expect(typeof counts.total).toBe('number');
  });

  it('returns all-zero shape { total, scored, pending } for empty workspace', () => {
    const workspaceId = makeWorkspaceId();
    const counts = getWorkspaceCounts(workspaceId);

    expect(counts).toEqual({ total: 0, scored: 0, pending: 0 });
  });

  it('returns scored=0 when all tracked actions are pending (measurement_complete=0)', () => {
    const workspaceId = makeWorkspaceId();
    const id = `test-ta-${randomUUID().slice(0, 8)}`;

    // Insert one pending (measurement_complete=0) action — no scored rows
    db.prepare(`
      INSERT INTO tracked_actions
        (id, workspace_id, action_type, source_type, baseline_snapshot, measurement_complete)
      VALUES (?, ?, 'meta_updated', 'insight', '{}', 0)
    `).run(id, workspaceId);

    const counts = getWorkspaceCounts(workspaceId);

    expect(counts.total).toBe(1);
    // SUM() over zero measurement_complete=1 rows → must return 0, not null
    expect(counts.scored).toBe(0);
    expect(typeof counts.scored).toBe('number');
    expect(counts.scored).not.toBeNull();
  });

  it('returns pending=0 when all tracked actions are scored (measurement_complete=1)', () => {
    const workspaceId = makeWorkspaceId();
    const id = `test-ta-${randomUUID().slice(0, 8)}`;

    // Insert one scored (measurement_complete=1) action — no pending rows
    db.prepare(`
      INSERT INTO tracked_actions
        (id, workspace_id, action_type, source_type, baseline_snapshot, measurement_complete)
      VALUES (?, ?, 'link_added', 'insight', '{}', 1)
    `).run(id, workspaceId);

    const counts = getWorkspaceCounts(workspaceId);

    expect(counts.total).toBe(1);
    // SUM() over zero measurement_complete=0 rows → must return 0, not null
    expect(counts.pending).toBe(0);
    expect(typeof counts.pending).toBe('number');
    expect(counts.pending).not.toBeNull();
  });
});

// ─── 3. Raw SQLite behaviour sanity-check ─────────────────────────────────────
//
// Documents the underlying SQLite behaviour that COALESCE guards against.
// These tests prove the database itself returns NULL from a bare SUM() with
// no matching rows — validating that the COALESCE wrappers above are necessary.

describe('SQLite SUM() raw behaviour — NULL without COALESCE', () => {
  it('bare SUM() returns null from SQLite when no rows match', () => {
    // Query a guaranteed-empty filter: a UUID workspace with no rows.
    const emptyId = `test-raw-${randomUUID()}`;

    const row = db.prepare(
      `SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS s FROM seo_suggestions WHERE workspace_id = ?`
    ).get(emptyId) as { s: number | null };

    // SQLite returns NULL, not 0, when SUM has no input rows.
    // This is the exact bug that COALESCE prevents — document it here.
    expect(row.s).toBeNull();
  });

  it('COALESCE(SUM(), 0) returns 0 from SQLite when no rows match', () => {
    const emptyId = `test-raw-${randomUUID()}`;

    const row = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS s FROM seo_suggestions WHERE workspace_id = ?`
    ).get(emptyId) as { s: number };

    expect(row.s).toBe(0);
    expect(typeof row.s).toBe('number');
  });

  it('bare SUM() returns null from SQLite on tracked_actions with no rows', () => {
    const emptyId = `test-raw-${randomUUID()}`;

    const row = db.prepare(
      `SELECT SUM(CASE WHEN measurement_complete = 1 THEN 1 ELSE 0 END) AS s FROM tracked_actions WHERE workspace_id = ?`
    ).get(emptyId) as { s: number | null };

    expect(row.s).toBeNull();
  });

  it('COALESCE(SUM(), 0) returns 0 from SQLite on tracked_actions with no rows', () => {
    const emptyId = `test-raw-${randomUUID()}`;

    const row = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN measurement_complete = 1 THEN 1 ELSE 0 END), 0) AS s FROM tracked_actions WHERE workspace_id = ?`
    ).get(emptyId) as { s: number };

    expect(row.s).toBe(0);
    expect(typeof row.s).toBe('number');
  });
});
