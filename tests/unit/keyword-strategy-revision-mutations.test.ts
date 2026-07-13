import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { clearKeywordFeedback, saveBulkKeywordFeedback, saveKeywordFeedback } from '../../server/keyword-feedback.js';
import { addStrategyKeyword, keepStrategyKeyword, removeStrategyKeyword } from '../../server/domains/strategy/managed-keyword-set.js';
import { getKeywordStrategyGenerationState } from '../../server/keyword-strategy-generation-store.js';
import db from '../../server/db/index.js';
import { addTrackedKeywordAndInvalidateStrategy, getTrackedKeywords } from '../../server/rank-tracking.js';
import { deleteKeywordHard } from '../../server/domains/keyword-command-center/action-service.js';
import { setBroadcast } from '../../server/broadcast.js';

const cleanup: string[] = [];
beforeEach(() => setBroadcast(vi.fn(), vi.fn()));
afterEach(() => { for (const id of cleanup.splice(0)) deleteWorkspace(id); });

describe('keyword strategy synthesis-input revision census', () => {
  it('advances for single, bulk, and deleted keyword feedback mutations', () => {
    const id = createWorkspace(`revision feedback ${Date.now()}`).id; cleanup.push(id);
    saveKeywordFeedback({ workspaceId: id, keyword: 'dentist', status: 'declined' });
    expect(getKeywordStrategyGenerationState(id).revision).toBe(1);
    saveBulkKeywordFeedback({ workspaceId: id, keywords: [{ keyword: 'orthodontist', status: 'approved' }] });
    expect(getKeywordStrategyGenerationState(id).revision).toBe(2);
    clearKeywordFeedback(id, 'dentist');
    expect(getKeywordStrategyGenerationState(id).revision).toBe(3);
  });

  it('advances for managed-set add, keep, and remove mutations', () => {
    const id = createWorkspace(`revision managed ${Date.now()}`).id; cleanup.push(id);
    addStrategyKeyword(id, 'emergency dentist', 'manual_add');
    keepStrategyKeyword(id, 'emergency dentist');
    removeStrategyKeyword(id, 'emergency dentist');
    expect(getKeywordStrategyGenerationState(id).revision).toBe(3);
  });

  it('rolls back a tracked-keyword write when the paired revision bump fails', () => {
    const id = createWorkspace(`revision atomic ${Date.now()}`).id; cleanup.push(id);
    db.exec(`CREATE TRIGGER test_revision_abort BEFORE UPDATE OF keyword_strategy_generation_revision ON workspaces
      WHEN OLD.id = '${id}' BEGIN SELECT RAISE(ABORT, 'revision failed'); END;`);
    try {
      expect(() => addTrackedKeywordAndInvalidateStrategy(id, 'atomic dentist')).toThrow('revision failed');
      expect(getTrackedKeywords(id)).toEqual([]);
      expect(getKeywordStrategyGenerationState(id).revision).toBe(0);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS test_revision_abort');
    }
  });

  it('advances atomically for the KCC hard-delete path', () => {
    const id = createWorkspace(`revision hard delete ${Date.now()}`).id; cleanup.push(id);
    addTrackedKeywordAndInvalidateStrategy(id, 'obsolete keyword');
    deleteKeywordHard(id, 'obsolete keyword');
    expect(getKeywordStrategyGenerationState(id).revision).toBe(2);
    expect(getTrackedKeywords(id, { includeInactive: true })).toEqual([]);
  });
});
