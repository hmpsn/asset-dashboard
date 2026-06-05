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
import {
  applyKeywordCommandCenterAction,
  deleteKeywordHard,
  isHardDeleteEligible,
} from '../../server/keyword-command-center.js';
import { addTrackedKeyword, getTrackedKeywords, updateTrackedKeywords } from '../../server/rank-tracking.js';
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
    const before = listActivity(ws.id).length;
    wsBroadcast.mockClear();

    const result = deleteKeywordHard(ws.id, 'manual kw');

    expect(result.ok).toBe(true);
    expect(present(ws.id, 'manual kw')).toBe(false);
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
});
