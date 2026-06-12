/**
 * P3-3c: retire-soft / delete-hard reconciliation.
 *
 * `deleteKeywordHard` is the THIRD (Hub-specific) wrapper over removeTrackedKeyword —
 * it broadcasts RANK_TRACKING_UPDATED action='deleted' + logs activity (the bare
 * removeTrackedKeyword does neither). Eligibility is the NARROW `isHardDeleteEligible`
 * predicate: hard delete is allowed for MANUAL (genuine mistakes) but disallowed without
 * `force` for pinned / CLIENT_REQUESTED / sourceGapKey (strategy/client provenance — those
 * must be RETIRED, not deleted). This is deliberately NOT a blind protectedReason reuse,
 * which flags MANUAL as protected.
 *
 * The reconciliation proof: RETIRE leaves the row (deprecated, restorable); DELETE removes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listActivity } from '../../server/activity-log.js';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import {
  applyKeywordCommandCenterAction,
  deleteKeywordHard,
  isHardDeleteEligible,
} from '../../server/keyword-command-center.js';
import {
  addTrackedKeyword,
  getLatestSnapshotRanks,
  getRankHistory,
  getTrackedKeywords,
  storeRankSnapshot,
  updateTrackedKeywords,
} from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../shared/types/keyword-command-center.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';
import { WS_EVENTS } from '../../server/ws-events.js';

function present(workspaceId: string, query: string): boolean {
  return getTrackedKeywords(workspaceId, { includeInactive: true }).some(k => k.query === query);
}
function find(workspaceId: string, query: string) {
  return getTrackedKeywords(workspaceId, { includeInactive: true }).find(k => k.query === query);
}

describe('isHardDeleteEligible', () => {
  it('MANUAL (unpinned, no provenance) is eligible', () => {
    expect(isHardDeleteEligible({ query: 'x', pinned: false, addedAt: 'now', source: TRACKED_KEYWORD_SOURCE.MANUAL })).toBe(true);
  });
  it('CLIENT_REQUESTED is NOT eligible', () => {
    expect(isHardDeleteEligible({ query: 'x', pinned: false, addedAt: 'now', source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED })).toBe(false);
  });
  it('pinned is NOT eligible (even if MANUAL)', () => {
    expect(isHardDeleteEligible({ query: 'x', pinned: true, addedAt: 'now', source: TRACKED_KEYWORD_SOURCE.MANUAL })).toBe(false);
  });
  it('a sourceGapKey provenance is NOT eligible', () => {
    expect(isHardDeleteEligible({ query: 'x', pinned: false, addedAt: 'now', source: TRACKED_KEYWORD_SOURCE.MANUAL, sourceGapKey: 'gap:x' })).toBe(false);
  });
  it('strategy-owned manual provenance is NOT eligible', () => {
    expect(isHardDeleteEligible({ query: 'x', pinned: false, addedAt: 'now', source: TRACKED_KEYWORD_SOURCE.MANUAL, strategyOwned: true })).toBe(false);
  });
  it('approved/requested feedback provenance is NOT eligible', () => {
    const manual = { query: 'x', pinned: false, addedAt: 'now', source: TRACKED_KEYWORD_SOURCE.MANUAL };
    expect(isHardDeleteEligible(manual, { hasStrategyFeedbackProvenance: true })).toBe(false);
  });
  it('undefined existing is NOT eligible', () => {
    expect(isHardDeleteEligible(undefined)).toBe(false);
  });
});

describe('deleteKeywordHard', () => {
  const cleanup = new Set<string>();
  let wsBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    wsBroadcast = vi.fn();
    setBroadcast(vi.fn(), wsBroadcast);
  });
  afterEach(() => {
    for (const id of cleanup) deleteWorkspace(id);
    cleanup.clear();
  });

  it('MANUAL active → deleteKeywordHard (no force) removes the row + broadcasts deleted + logs activity', () => {
    const ws = createWorkspace('Delete Manual');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'manual kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    storeRankSnapshot(ws.id, '2026-06-01', [
      { query: 'manual kw', position: 4, clicks: 8, impressions: 80, ctr: 0.1 },
      { query: 'kept kw', position: 9, clicks: 3, impressions: 30, ctr: 0.1 },
    ]);
    const before = listActivity(ws.id).length;
    wsBroadcast.mockClear();
    expect(getLatestSnapshotRanks(ws.id).map(rank => rank.query)).toEqual(expect.arrayContaining(['manual kw', 'kept kw']));

    const result = deleteKeywordHard(ws.id, 'manual kw');

    expect(result.ok).toBe(true);
    expect(present(ws.id, 'manual kw')).toBe(false);
    expect(getLatestSnapshotRanks(ws.id).map(rank => rank.query)).toEqual(['kept kw']);
    const deletedBroadcasts = wsBroadcast.mock.calls.filter(
      c => c[1] === WS_EVENTS.RANK_TRACKING_UPDATED && (c[2] as { action?: string })?.action === 'deleted',
    );
    expect(deletedBroadcasts.length).toBe(1);
    expect(listActivity(ws.id).length - before).toBe(1);
  });

  it('CLIENT_REQUESTED → throws without force, row STILL present; force:true deletes', () => {
    const ws = createWorkspace('Delete Client');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'client kw', { source: TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED });

    expect(() => deleteKeywordHard(ws.id, 'client kw')).toThrow();
    expect(present(ws.id, 'client kw')).toBe(true);

    deleteKeywordHard(ws.id, 'client kw', { force: true });
    expect(present(ws.id, 'client kw')).toBe(false);
  });

  it('sourceGapKey provenance → throws without force, row STILL present', () => {
    const ws = createWorkspace('Delete Gap');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'gap kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL, sourceGapKey: 'gap:gap kw' });

    expect(() => deleteKeywordHard(ws.id, 'gap kw')).toThrow();
    expect(present(ws.id, 'gap kw')).toBe(true);
  });

  it('strategyOwned manual provenance → throws without force, row STILL present', () => {
    const ws = createWorkspace('Delete Strategy Owned');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'strategy owned manual', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    updateTrackedKeywords(ws.id, keywords => keywords.map(keyword =>
      keyword.query === 'strategy owned manual' ? { ...keyword, strategyOwned: true } : keyword,
    ));

    expect(() => deleteKeywordHard(ws.id, 'strategy owned manual')).toThrow();
    expect(present(ws.id, 'strategy owned manual')).toBe(true);
  });

  it('approved KCC feedback provenance → throws without force, row STILL present', () => {
    const ws = createWorkspace('Delete Feedback Provenance');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'approved manual', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    applyKeywordCommandCenterAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      keyword: 'approved manual',
    });

    expect(() => deleteKeywordHard(ws.id, 'approved manual')).toThrow();
    expect(present(ws.id, 'approved manual')).toBe(true);
  });

  it('pinned → throws without force', () => {
    const ws = createWorkspace('Delete Pinned');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'pinned kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL, pinned: true });

    expect(() => deleteKeywordHard(ws.id, 'pinned kw')).toThrow();
    expect(present(ws.id, 'pinned kw')).toBe(true);
  });

  it('throws when the keyword is not tracked at all', () => {
    const ws = createWorkspace('Delete Missing');
    cleanup.add(ws.id);
    expect(() => deleteKeywordHard(ws.id, 'never tracked')).toThrow();
  });

  describe('retire-is-soft vs delete-is-hard contrast (reconciliation proof)', () => {
    it('RETIRE leaves the row deprecated+restorable; RESTORE → active; DELETE → absent', () => {
      const ws = createWorkspace('Soft vs Hard');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'lifecycle kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

      // RETIRE (soft) — row remains, deprecated.
      applyKeywordCommandCenterAction(ws.id, {
        action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
        keyword: 'lifecycle kw',
        force: true,
      });
      expect(present(ws.id, 'lifecycle kw')).toBe(true);
      expect(find(ws.id, 'lifecycle kw')?.status).toBe(TRACKED_KEYWORD_STATUS.DEPRECATED);

      // RESTORE — reversible: back to active.
      applyKeywordCommandCenterAction(ws.id, {
        action: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
        keyword: 'lifecycle kw',
      });
      expect(find(ws.id, 'lifecycle kw')?.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);

      // DELETE (hard) — irreversible: gone.
      deleteKeywordHard(ws.id, 'lifecycle kw');
      expect(present(ws.id, 'lifecycle kw')).toBe(false);
    });
  });

  it('hard delete preserves an empty latest snapshot date instead of rolling latest ranks back', () => {
    const ws = createWorkspace('Delete Snapshot Preserve');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'delete me', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
    storeRankSnapshot(ws.id, '2026-06-01', [
      { query: 'keep me', position: 2, clicks: 10, impressions: 100, ctr: 10 },
    ]);
    storeRankSnapshot(ws.id, '2026-06-02', [
      { query: 'delete me', position: 8, clicks: 1, impressions: 20, ctr: 5 },
    ]);

    deleteKeywordHard(ws.id, 'delete me');

    expect(getLatestSnapshotRanks(ws.id)).toEqual([]);
  });

  it('snapshot writes collapse canonical duplicate queries so latest and history agree', () => {
    const ws = createWorkspace('Snapshot Dedupe');
    cleanup.add(ws.id);
    addTrackedKeyword(ws.id, 'Emergency Dentist - Near-Me', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    storeRankSnapshot(ws.id, '2026-06-01', [
      { query: 'Emergency Dentist - Near-Me', position: 9, clicks: 1, impressions: 20, ctr: 5 },
      { query: 'emergency dentist near me', position: 4, clicks: 3, impressions: 30, ctr: 10 },
    ]);

    expect(getLatestSnapshotRanks(ws.id).map(rank => [rank.query, rank.position])).toEqual([
      ['Emergency Dentist - Near-Me', 4],
    ]);
    expect(getRankHistory(ws.id)).toEqual([
      { date: '2026-06-01', positions: { 'Emergency Dentist - Near-Me': 4 } },
    ]);
  });

  it('legacy partial snapshot rows keep positions with missing metrics defaulted to zero', () => {
    const ws = createWorkspace('Snapshot Partial Legacy');
    cleanup.add(ws.id);
    db.prepare(`
      INSERT INTO rank_snapshots (workspace_id, date, queries)
      VALUES (?, ?, ?)
    `).run(ws.id, '2026-06-01', JSON.stringify([{ query: 'legacy kw', position: 6 }]));

    expect(getLatestSnapshotRanks(ws.id)).toEqual([
      { query: 'legacy kw', position: 6, clicks: 0, impressions: 0, ctr: 0, change: undefined },
    ]);
  });
});
