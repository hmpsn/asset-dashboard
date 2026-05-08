import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  listQuickWins,
  replaceAllQuickWins,
  deleteAllQuickWins,
  countQuickWins,
  migrateFromJsonBlob,
} from '../../server/quick-wins.js';
import type { QuickWin } from '../../shared/types/workspace.js';

const cleanupWorkspaceIds: string[] = [];

afterAll(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteAllQuickWins(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function makeQuickWin(overrides: Partial<QuickWin> = {}): QuickWin {
  return {
    pagePath: '/services',
    currentKeyword: 'seo services',
    action: 'Improve title tag',
    estimatedImpact: 'high',
    rationale: 'Low effort meta update can improve CTR',
    roiScore: 82,
    ...overrides,
  };
}

describe('quick-wins table', () => {
  it('replaces and lists quick wins', () => {
    const ws = createWorkspace(`Quick Wins Replace ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllQuickWins(ws.id, [
      makeQuickWin({ pagePath: '/a', action: 'Fix title', roiScore: 60 }),
      makeQuickWin({ pagePath: '/b', action: 'Improve intro', roiScore: 90 }),
    ]);

    const wins = listQuickWins(ws.id);
    expect(wins).toHaveLength(2);
    expect(wins[0].pagePath).toBe('/b');
    expect(wins[1].pagePath).toBe('/a');
    expect(countQuickWins(ws.id)).toBe(2);
  });

  it('preserves rows with same pagePath and action when currentKeyword differs', () => {
    const ws = createWorkspace(`Quick Wins Duplicate Action ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllQuickWins(ws.id, [
      makeQuickWin({ pagePath: '/services', action: 'Improve title tag', currentKeyword: 'seo services' }),
      makeQuickWin({ pagePath: '/services', action: 'Improve title tag', currentKeyword: 'seo company chicago' }),
    ]);

    const wins = listQuickWins(ws.id);
    expect(wins).toHaveLength(2);
    expect(new Set(wins.map((w) => w.currentKeyword))).toEqual(new Set(['seo services', 'seo company chicago']));
  });

  it('migrates quickWins from workspace keywordStrategy blob and strips stale blob field', () => {
    const ws = createWorkspace(`Quick Wins Migrate ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    updateWorkspace(ws.id, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        quickWins: [
          makeQuickWin({ pagePath: '/migrate', action: 'Refresh heading', estimatedImpact: 'medium', roiScore: 44 }),
        ],
        generatedAt: new Date().toISOString(),
      },
    });

    migrateFromJsonBlob();

    const wins = listQuickWins(ws.id);
    expect(wins).toHaveLength(1);
    expect(wins[0].pagePath).toBe('/migrate');
    expect(wins[0].action).toBe('Refresh heading');

    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.quickWins).toBeUndefined();
  });
});
