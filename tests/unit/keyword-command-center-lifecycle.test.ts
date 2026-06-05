/**
 * P3-3b: route the KCC action switch through validateTransition('tracked_keyword', ...).
 *
 * Order inside applyKeywordCommandCenterActionInternal: protection guard → transition
 * guard → write. An illegal transition rolls back inside the txn (no write, no broadcast).
 * Protection ("needs confirmation") and transition ("never allowed") are orthogonal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setBroadcast } from '../../server/broadcast.js';
import { applyKeywordCommandCenterAction } from '../../server/keyword-command-center.js';
import { InvalidTransitionError } from '../../server/state-machines.js';
import { addTrackedKeyword, getTrackedKeywords, updateTrackedKeywords } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../shared/types/keyword-command-center.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';
import { WS_EVENTS } from '../../server/ws-events.js';

function setStatus(workspaceId: string, query: string, status: string): void {
  updateTrackedKeywords(workspaceId, keywords =>
    keywords.map(k => (k.query === query ? { ...k, status: status as never } : k)),
  );
}

function find(workspaceId: string, query: string) {
  return getTrackedKeywords(workspaceId, { includeInactive: true }).find(k => k.query === query);
}

describe('KCC action lifecycle guard (validateTransition)', () => {
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

  describe('legal transitions from a valid state', () => {
    it('active → PAUSE_TRACKING → paused', () => {
      const ws = createWorkspace('Lifecycle Pause');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'kw a', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });

      applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING, keyword: 'kw a' });

      expect(find(ws.id, 'kw a')?.status).toBe(TRACKED_KEYWORD_STATUS.PAUSED);
    });

    it('active → RETIRE → deprecated (with deprecatedAt set)', () => {
      const ws = createWorkspace('Lifecycle Retire');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'kw b', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });

      applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, keyword: 'kw b' });

      const row = find(ws.id, 'kw b');
      expect(row?.status).toBe(TRACKED_KEYWORD_STATUS.DEPRECATED);
      expect(row?.deprecatedAt).toBeTruthy();
    });

    it('deprecated → RESTORE → active (deprecatedAt / replacedBy cleared)', () => {
      const ws = createWorkspace('Lifecycle Restore');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'kw c', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
      applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, keyword: 'kw c' });
      expect(find(ws.id, 'kw c')?.status).toBe(TRACKED_KEYWORD_STATUS.DEPRECATED);

      applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE, keyword: 'kw c' });

      const row = find(ws.id, 'kw c');
      expect(row?.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
      expect(row?.deprecatedAt).toBeUndefined();
      expect(row?.replacedBy).toBeUndefined();
    });
  });

  describe('illegal transition from an invalid state', () => {
    it('deprecated → PAUSE_TRACKING throws InvalidTransitionError, row UNCHANGED, NO broadcast', () => {
      const ws = createWorkspace('Lifecycle Illegal');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'kw d', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
      setStatus(ws.id, 'kw d', TRACKED_KEYWORD_STATUS.DEPRECATED);
      wsBroadcast.mockClear();

      expect(() =>
        applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING, keyword: 'kw d' }),
      ).toThrow(InvalidTransitionError);

      // DB row unchanged.
      expect(find(ws.id, 'kw d')?.status).toBe(TRACKED_KEYWORD_STATUS.DEPRECATED);
      // No rank-tracking broadcast fired.
      expect(wsBroadcast.mock.calls.filter(c => c[1] === WS_EVENTS.RANK_TRACKING_UPDATED)).toHaveLength(0);
    });

    it('replaced → RESTORE throws InvalidTransitionError (replaced is terminal)', () => {
      const ws = createWorkspace('Lifecycle Replaced');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'kw e', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
      setStatus(ws.id, 'kw e', TRACKED_KEYWORD_STATUS.REPLACED);

      expect(() =>
        applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE, keyword: 'kw e' }),
      ).toThrow(InvalidTransitionError);
      expect(find(ws.id, 'kw e')?.status).toBe(TRACKED_KEYWORD_STATUS.REPLACED);
    });
  });

  describe('protection is independent of the transition guard', () => {
    it('protected active + RETIRE (no force) → protection error, NOT a transition error', () => {
      const ws = createWorkspace('Lifecycle Protected');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'protected kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

      let caught: Error | null = null;
      try {
        applyKeywordCommandCenterAction(ws.id, { action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, keyword: 'protected kw' });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(InvalidTransitionError);
      expect(caught!.message).toContain('requires explicit confirmation');
      expect(find(ws.id, 'protected kw')?.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
    });

    it('protected active + RETIRE force:true → passes protection THEN the transition guard (legal)', () => {
      const ws = createWorkspace('Lifecycle Protected Force');
      cleanup.add(ws.id);
      addTrackedKeyword(ws.id, 'protected kw', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

      applyKeywordCommandCenterAction(ws.id, {
        action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
        keyword: 'protected kw',
        force: true,
      });

      expect(find(ws.id, 'protected kw')?.status).toBe(TRACKED_KEYWORD_STATUS.DEPRECATED);
    });
  });
});
