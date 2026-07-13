import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  KeywordFeedbackBulkConflictError,
  clearKeywordFeedback,
  listPublicKeywordFeedback,
  readKeywordFeedbackIndex,
  saveBulkKeywordFeedback,
  saveKeywordFeedback,
} from '../../server/keyword-feedback.js';
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

describe('keyword feedback v2 compatibility', () => {
  it('assigns distinct-v2 bulk write order by UTF-8 bytes regardless of input order', () => {
    const snapshots = [
      ['C++', 'C', 'C#'],
      ['C#', 'C', 'C++'],
    ].map((keywords, index) => {
      const id = createWorkspace(`feedback order ${index} ${Date.now()}`).id; cleanup.push(id);
      saveBulkKeywordFeedback({
        workspaceId: id,
        keywords: keywords.map(keyword => ({ keyword, status: 'approved' as const })),
      });
      return {
        compat: db.prepare(`
          SELECT keyword_v2, raw_keyword, write_order
            FROM keyword_feedback_v2_compat
           WHERE workspace_id = ? ORDER BY write_order
        `).all(id),
        projection: db.prepare(`
          SELECT keyword, status, reason, source, declined_by
            FROM keyword_feedback WHERE workspace_id = ? ORDER BY keyword COLLATE BINARY
        `).all(id),
      };
    });

    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[0]?.compat).toEqual([
      expect.objectContaining({ keyword_v2: 'c', raw_keyword: 'C', write_order: 1 }),
      expect.objectContaining({ keyword_v2: 'c plus plus', raw_keyword: 'C++', write_order: 2 }),
      expect.objectContaining({ keyword_v2: 'c sharp', raw_keyword: 'C#', write_order: 3 }),
    ]);
  });

  it('keeps colliding v1 identities independent and projects the latest sibling deterministically', () => {
    const id = createWorkspace(`feedback collision ${Date.now()}`).id; cleanup.push(id);
    saveKeywordFeedback({ workspaceId: id, keyword: 'C', status: 'declined', reason: 'language' });
    saveKeywordFeedback({ workspaceId: id, keyword: 'C#', status: 'approved', reason: 'framework' });

    expect(listPublicKeywordFeedback(id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'C', status: 'declined' }),
      expect.objectContaining({ keyword: 'C#', status: 'approved' }),
    ]));
    expect(readKeywordFeedbackIndex(id).get('c')?.status).toBe('declined');
    expect(readKeywordFeedbackIndex(id).get('c#')?.status).toBe('approved');
    expect(db.prepare('SELECT status FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').get(id, 'c'))
      .toEqual(expect.objectContaining({ status: 'approved' }));

    clearKeywordFeedback(id, 'C#');
    expect(db.prepare('SELECT status FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').get(id, 'c'))
      .toEqual(expect.objectContaining({ status: 'declined' }));
  });

  it('retains equivalent raw aliases and rejects a conflicting same-v2 bulk atomically', () => {
    const id = createWorkspace(`feedback aliases ${Date.now()}`).id; cleanup.push(id);
    saveBulkKeywordFeedback({
      workspaceId: id,
      keywords: [
        { keyword: 'C#', status: 'approved' },
        { keyword: 'Ｃ＃', status: 'approved' },
      ],
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM keyword_feedback_v2_compat WHERE workspace_id = ?').get(id))
      .toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM keyword_feedback_v2_aliases WHERE workspace_id = ?').get(id))
      .toEqual({ count: 2 });

    expect(() => saveBulkKeywordFeedback({
      workspaceId: id,
      keywords: [
        { keyword: 'F#', status: 'approved' },
        { keyword: 'Ｆ＃', status: 'declined' },
      ],
    })).toThrow(KeywordFeedbackBulkConflictError);
    expect(readKeywordFeedbackIndex(id).get('F#')).toBeUndefined();
  });

  it('supports v2-only identities without fabricating a v1 rollback key', () => {
    const id = createWorkspace(`feedback v2 only ${Date.now()}`).id; cleanup.push(id);
    saveKeywordFeedback({ workspaceId: id, keyword: '東京', status: 'requested' });
    expect(readKeywordFeedbackIndex(id).get('東京')).toEqual(expect.objectContaining({ keyword: '東京', status: 'requested' }));
    expect(db.prepare('SELECT keyword_v1 FROM keyword_feedback_v2_compat WHERE workspace_id = ?').get(id))
      .toEqual({ keyword_v1: '' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM keyword_feedback WHERE workspace_id = ?').get(id))
      .toEqual({ count: 0 });
  });

  it('archives an unmarked legacy row before projection and deletes that alias without harming the projection', () => {
    const id = createWorkspace(`feedback legacy ${Date.now()}`).id; cleanup.push(id);
    db.prepare(`
      INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
      VALUES (?, 'c', 'requested', 'legacy', 'page_map', NULL)
    `).run(id);
    saveKeywordFeedback({ workspaceId: id, keyword: 'C#', status: 'approved' });

    expect(listPublicKeywordFeedback(id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'c', status: 'requested', reason: 'legacy' }),
      expect.objectContaining({ keyword: 'C#', status: 'approved' }),
    ]));
    expect(clearKeywordFeedback(id, 'c')).toEqual(expect.objectContaining({ existed: true, previousStatus: 'requested' }));
    expect(db.prepare('SELECT status FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?').get(id, 'c'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
  });
});
