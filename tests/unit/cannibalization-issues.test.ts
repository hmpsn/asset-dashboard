import { describe, it, expect, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  listCannibalizationIssues,
  replaceAllCannibalizationIssues,
  deleteAllCannibalizationIssues,
  countCannibalizationIssues,
  migrateFromJsonBlob,
} from '../../server/cannibalization-issues.js';
import type { CannibalizationItem } from '../../shared/types/workspace.js';

const cleanupWorkspaceIds: string[] = [];

afterAll(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteAllCannibalizationIssues(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function makeIssue(overrides: Partial<CannibalizationItem> = {}): CannibalizationItem {
  return {
    keyword: 'seo services',
    pages: [
      { path: '/services', position: 6, impressions: 500, clicks: 42, source: 'keyword_map' },
      { path: '/seo-services', position: 9, impressions: 380, clicks: 27, source: 'gsc' },
    ],
    severity: 'medium',
    recommendation: 'Consolidate overlapping pages into one primary URL.',
    ...overrides,
  };
}

describe('cannibalization-issues table', () => {
  it('replaces and lists cannibalization issues', () => {
    const ws = createWorkspace(`Cannibalization Replace ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllCannibalizationIssues(ws.id, [
      makeIssue({ keyword: 'seo services', severity: 'high' }),
      makeIssue({ keyword: 'technical seo audit', severity: 'low' }),
    ]);

    const issues = listCannibalizationIssues(ws.id);
    expect(issues).toHaveLength(2);
    expect(issues[0].keyword).toBe('seo services');
    expect(issues[0].severity).toBe('high');
    expect(issues[1].keyword).toBe('technical seo audit');
    expect(countCannibalizationIssues(ws.id)).toBe(2);
  });

  it('preserves canonical action metadata', () => {
    const ws = createWorkspace(`Cannibalization Metadata ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllCannibalizationIssues(ws.id, [
      makeIssue({
        keyword: 'implant pricing',
        canonicalPath: '/services/dental-implants',
        canonicalUrl: 'https://example.com/services/dental-implants',
        action: 'canonical_tag',
      }),
    ]);

    const issues = listCannibalizationIssues(ws.id);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual(expect.objectContaining({
      keyword: 'implant pricing',
      canonicalPath: '/services/dental-implants',
      canonicalUrl: 'https://example.com/services/dental-implants',
      action: 'canonical_tag',
    }));
  });

  it('keeps one row per keyword (case-insensitive dedupe, last keyword wins)', () => {
    const ws = createWorkspace(`Cannibalization Unique ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllCannibalizationIssues(ws.id, [
      makeIssue({ keyword: 'SEO Services', severity: 'high' }),
      makeIssue({ keyword: 'seo services', severity: 'low' }),
    ]);

    const issues = listCannibalizationIssues(ws.id);
    expect(issues).toHaveLength(1);
    expect(issues[0].keyword).toBe('seo services');
    expect(issues[0].severity).toBe('low');
  });

  it('migrates cannibalization from workspace keywordStrategy blob and strips stale blob field', () => {
    const ws = createWorkspace(`Cannibalization Migrate ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    updateWorkspace(ws.id, {
      keywordStrategy: {
        siteKeywords: [],
        opportunities: [],
        cannibalization: [
          makeIssue({
            keyword: 'migrate keyword',
            severity: 'high',
            canonicalPath: '/canonical',
            canonicalUrl: 'https://example.com/canonical',
            action: 'differentiate',
          }),
        ],
        generatedAt: new Date().toISOString(),
      },
    });

    migrateFromJsonBlob();

    const issues = listCannibalizationIssues(ws.id);
    expect(issues).toHaveLength(1);
    expect(issues[0].keyword).toBe('migrate keyword');
    expect(issues[0].severity).toBe('high');
    expect(issues[0].canonicalPath).toBe('/canonical');
    expect(issues[0].canonicalUrl).toBe('https://example.com/canonical');
    expect(issues[0].action).toBe('differentiate');

    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.cannibalization).toBeUndefined();
  });
});
