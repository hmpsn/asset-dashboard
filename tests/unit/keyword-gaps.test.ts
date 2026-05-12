import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  listKeywordGaps,
  replaceAllKeywordGaps,
  deleteAllKeywordGaps,
  countKeywordGaps,
  migrateFromJsonBlob,
} from '../../server/keyword-gaps.js';
import type { KeywordGapItem } from '../../shared/types/workspace.js';

const cleanupWorkspaceIds: string[] = [];

afterAll(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteAllKeywordGaps(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function makeGap(overrides: Partial<KeywordGapItem> = {}): KeywordGapItem {
  return {
    keyword: 'seo audit tool',
    volume: 2400,
    difficulty: 48,
    competitorPosition: 3,
    competitorDomain: 'competitor.com',
    ...overrides,
  };
}

describe('keyword-gaps table', () => {
  it('replaces and lists keyword gaps', () => {
    const ws = createWorkspace(`Keyword Gaps Replace ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllKeywordGaps(ws.id, [
      makeGap({ keyword: 'a keyword', volume: 100 }),
      makeGap({ keyword: 'b keyword', volume: 500 }),
    ]);

    const gaps = listKeywordGaps(ws.id);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].keyword).toBe('b keyword');
    expect(gaps[1].keyword).toBe('a keyword');
    expect(countKeywordGaps(ws.id)).toBe(2);
  });

  it('keeps one row per keyword (replace-all semantics + PK)', () => {
    const ws = createWorkspace(`Keyword Gaps Unique ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllKeywordGaps(ws.id, [
      makeGap({ keyword: 'same keyword', competitorDomain: 'first.com', competitorPosition: 5 }),
      makeGap({ keyword: 'same keyword', competitorDomain: 'second.com', competitorPosition: 2 }),
    ]);

    const gaps = listKeywordGaps(ws.id);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].keyword).toBe('same keyword');
    expect(gaps[0].competitorDomain).toBe('second.com');
    expect(gaps[0].competitorPosition).toBe(2);
  });

  it('migrates keywordGaps from workspace keywordStrategy blob and strips stale blob field', () => {
    const ws = createWorkspace(`Keyword Gaps Migrate ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    updateWorkspace(ws.id, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        keywordGaps: [
          makeGap({ keyword: 'migrate keyword', volume: 1200, difficulty: 31 }),
        ],
        generatedAt: new Date().toISOString(),
      },
    });

    migrateFromJsonBlob();

    const gaps = listKeywordGaps(ws.id);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].keyword).toBe('migrate keyword');
    expect(gaps[0].volume).toBe(1200);

    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.keywordGaps).toBeUndefined();
  });
});
