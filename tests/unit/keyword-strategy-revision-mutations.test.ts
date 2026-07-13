import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { clearKeywordFeedback, saveBulkKeywordFeedback, saveKeywordFeedback } from '../../server/keyword-feedback.js';
import { addStrategyKeyword, keepStrategyKeyword, removeStrategyKeyword } from '../../server/domains/strategy/managed-keyword-set.js';
import { getKeywordStrategyGenerationState } from '../../server/keyword-strategy-generation-store.js';

const cleanup: string[] = [];
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
});
