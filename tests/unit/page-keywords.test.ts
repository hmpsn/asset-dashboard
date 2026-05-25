import { afterAll, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  countPageKeywords,
  getPageKeyword,
  listPageKeywords,
  upsertAndCleanPageKeywords,
  upsertPageKeyword,
} from '../../server/page-keywords.js';

const cleanupWorkspaceIds = new Set<string>();

afterAll(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteWorkspace(workspaceId);
  }
  cleanupWorkspaceIds.clear();
});

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    pagePath: '/services/seo',
    pageTitle: 'SEO Services',
    primaryKeyword: 'seo services',
    secondaryKeywords: ['seo agency'],
    ...overrides,
  };
}

describe('page-keywords integrity behavior', () => {
  it('upsertAndClean removes stale rows and preserves analysis for surviving same-keyword rows', () => {
    const ws = createWorkspace(`PK Clean ${Date.now()}`);
    cleanupWorkspaceIds.add(ws.id);

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/keep',
      optimizationScore: 88,
      optimizationIssues: ['Missing structured data'],
      analysisGeneratedAt: '2026-05-01T10:00:00.000Z',
    }));
    upsertPageKeyword(ws.id, makePage({
      pagePath: '/remove',
      primaryKeyword: 'old keyword',
      optimizationScore: 41,
      analysisGeneratedAt: '2026-05-01T11:00:00.000Z',
    }));

    upsertAndCleanPageKeywords(ws.id, [
      makePage({
        pagePath: '/keep',
        // Keyword-only strategy refresh: analysis fields omitted on purpose.
        volume: 1200,
        difficulty: 37,
      }),
    ]);

    const keep = getPageKeyword(ws.id, '/keep');
    const removed = getPageKeyword(ws.id, '/remove');

    expect(countPageKeywords(ws.id)).toBe(1);
    expect(removed).toBeUndefined();
    expect(keep?.optimizationScore).toBe(88);
    expect(keep?.optimizationIssues).toEqual(['Missing structured data']);
    expect(keep?.optimizationScoreHistory?.map((x) => x.score)).toEqual([88]);
  });

  it('treats case/whitespace primary keyword variants as equivalent and keeps history/analysis', () => {
    const ws = createWorkspace(`PK Normalize ${Date.now()}`);
    cleanupWorkspaceIds.add(ws.id);

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/normalized',
      primaryKeyword: 'SEO Services',
      optimizationScore: 72,
      analysisGeneratedAt: '2026-05-01T10:00:00.000Z',
      recommendations: ['Keep primary in first paragraph'],
    }));

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/normalized',
      primaryKeyword: ' seo services ',
      // No new analysis payload.
      volume: 900,
    }));

    const row = getPageKeyword(ws.id, '/normalized');
    expect(row?.optimizationScore).toBe(72);
    expect(row?.recommendations).toEqual(['Keep primary in first paragraph']);
    expect(row?.optimizationScoreHistory?.map((x) => x.score)).toEqual([72]);
  });

  it('clears score history when primary keyword materially changes', () => {
    const ws = createWorkspace(`PK Reset ${Date.now()}`);
    cleanupWorkspaceIds.add(ws.id);

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/reassign',
      primaryKeyword: 'seo services',
      optimizationScore: 63,
      analysisGeneratedAt: '2026-05-01T10:00:00.000Z',
    }));

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/reassign',
      primaryKeyword: 'local seo consultant',
      secondaryKeywords: ['seo consultant near me'],
      volume: 700,
    }));

    const row = getPageKeyword(ws.id, '/reassign');
    expect(row?.primaryKeyword).toBe('local seo consultant');
    expect(row?.optimizationScore).toBeUndefined();
    expect(row?.optimizationScoreHistory).toBeUndefined();
  });

  it('preserves analysis and score history when punctuation-only keyword changes are equivalent', () => {
    const ws = createWorkspace(`PK Punctuation ${Date.now()}`);
    cleanupWorkspaceIds.add(ws.id);

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/punctuation',
      primaryKeyword: 'seo services!',
      optimizationScore: 77,
      analysisGeneratedAt: '2026-05-01T10:00:00.000Z',
    }));

    upsertPageKeyword(ws.id, makePage({
      pagePath: '/punctuation',
      primaryKeyword: 'seo services',
    }));

    const row = getPageKeyword(ws.id, '/punctuation');
    expect(row?.optimizationScore).toBe(77);
    expect(row?.optimizationScoreHistory?.map((x) => x.score)).toEqual([77]);
  });

  it('normalizes incoming page paths to prevent duplicate logical rows', () => {
    const ws = createWorkspace(`PK Path ${Date.now()}`);
    cleanupWorkspaceIds.add(ws.id);

    upsertPageKeyword(ws.id, makePage({ pagePath: 'services/path-test' }));
    upsertPageKeyword(ws.id, makePage({ pagePath: '/services/path-test' }));

    const pages = listPageKeywords(ws.id).filter((p) => p.pagePath === '/services/path-test');
    expect(pages).toHaveLength(1);
  });
});
