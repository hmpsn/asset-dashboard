/**
 * C1 (review) — stale-cache resurrection guard.
 *
 * Pre-fix bug: when a recompute yielded totalScoredActions === 0, getWorkspaceLearnings
 * returned the OLD cached blob AND touched computed_at so it never expired — serving a
 * PRE-FIX corrupted aggregate indefinitely. Post-A1, a workspace whose entire history is
 * `not_acted_on` recomputes to 0, so the corrupt blob would be served forever.
 *
 * Fix: a LEARNINGS_LOGIC_VERSION stamp is baked into every cached payload; on read a
 * version mismatch (including a missing stamp from pre-A1 logic) is treated as
 * cache-invalid → recompute, and if the recompute is empty, return the HONEST empty
 * aggregate, not the stale blob.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  getWorkspaceLearnings,
  LEARNINGS_LOGIC_VERSION,
} from '../../server/workspace-learnings.js';

const WS_ID = 'a1-cache-version-ws';

function seedCachedBlob(payload: Record<string, unknown>): void {
  db.prepare(`
    INSERT OR REPLACE INTO workspace_learnings (id, workspace_id, learnings, computed_at)
    VALUES (?, ?, ?, ?)
  `).run(
    'a1-cache-version-row',
    WS_ID,
    JSON.stringify(payload),
    // Fresh timestamp so the TTL is NOT the thing invalidating the cache — only the
    // version gate should matter.
    new Date().toISOString(),
  );
}

// A corrupt, non-trivial aggregate of the kind the pre-fix logic produced (a fabricated
// win rate from not_acted_on suggestions scored as executed). It is intentionally
// missing the logicVersion stamp.
const CORRUPT_PRE_FIX_BLOB = {
  confidence: 'high',
  totalScoredActions: 42,
  content: null,
  strategy: null,
  technical: null,
  overall: { totalWinRate: 0.91, strongWinRate: 0.6, topActionTypes: [], recentTrend: 'improving' },
};

describe('C1 stale-cache resurrection guard', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM action_outcomes WHERE action_id IN (SELECT id FROM tracked_actions WHERE workspace_id = ?)').run(WS_ID);
    db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(WS_ID);
    db.prepare('DELETE FROM workspace_learnings WHERE workspace_id = ?').run(WS_ID);
  });

  afterEach(() => {
    db.prepare('DELETE FROM workspace_learnings WHERE workspace_id = ?').run(WS_ID);
  });

  it('does NOT serve an unversioned (pre-fix) blob when the recompute is empty', () => {
    // No tracked actions → recompute yields totalScoredActions === 0.
    seedCachedBlob(CORRUPT_PRE_FIX_BLOB);

    const result = getWorkspaceLearnings(WS_ID, 'all');

    // The honest empty aggregate, not the fabricated 91% win rate.
    expect(result).not.toBeNull();
    expect(result!.totalScoredActions).toBe(0);
    expect(result!.overall.totalWinRate).toBe(0);
    expect(result!.confidence).toBe('low');
  });

  it('replaces the stale-version row on disk with a current-version empty aggregate', () => {
    seedCachedBlob(CORRUPT_PRE_FIX_BLOB);
    getWorkspaceLearnings(WS_ID, 'all');

    const row = db.prepare('SELECT learnings FROM workspace_learnings WHERE workspace_id = ?').get(WS_ID) as
      | { learnings: string }
      | undefined;
    expect(row).toBeTruthy();
    const stored = JSON.parse(row!.learnings) as { logicVersion?: number; totalScoredActions: number };
    expect(stored.logicVersion).toBe(LEARNINGS_LOGIC_VERSION);
    expect(stored.totalScoredActions).toBe(0);
  });

  it('treats a row stamped with an OLDER version as cache-invalid', () => {
    seedCachedBlob({ ...CORRUPT_PRE_FIX_BLOB, logicVersion: LEARNINGS_LOGIC_VERSION - 1 });

    const result = getWorkspaceLearnings(WS_ID, 'all');
    expect(result!.totalScoredActions).toBe(0);
    expect(result!.overall.totalWinRate).toBe(0);
  });

  it('still serves a CURRENT-version blob on a transient empty recompute (no false invalidation)', () => {
    // A blob produced by current logic represents real historical learnings; a transient
    // data gap (recompute === 0) must NOT discard it.
    seedCachedBlob({
      ...CORRUPT_PRE_FIX_BLOB,
      totalScoredActions: 30,
      overall: { totalWinRate: 0.7, strongWinRate: 0.3, topActionTypes: [], recentTrend: 'stable' },
      logicVersion: LEARNINGS_LOGIC_VERSION,
    });

    const result = getWorkspaceLearnings(WS_ID, 'all');
    // Trustworthy historical context is preserved.
    expect(result!.totalScoredActions).toBe(30);
    expect(result!.overall.totalWinRate).toBe(0.7);
  });
});
