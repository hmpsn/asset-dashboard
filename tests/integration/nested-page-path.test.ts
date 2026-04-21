import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { matchPagePath, resolvePagePath } from '../../src/lib/pathUtils.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertPageKeyword, getPageKeyword } from '../../server/page-keywords.js';

describe('resolvePagePath', () => {
  it('prefers publishedPath over slug', () => {
    expect(resolvePagePath({ slug: 'seo', publishedPath: '/services/seo' })).toBe('/services/seo');
  });

  it('falls back to /${slug} when publishedPath absent', () => {
    expect(resolvePagePath({ slug: 'seo' })).toBe('/seo');
  });

  it('falls back to / when both absent', () => {
    expect(resolvePagePath({})).toBe('/');
  });

  it('handles null publishedPath', () => {
    expect(resolvePagePath({ slug: 'seo', publishedPath: null })).toBe('/seo');
  });
});

describe('matchPagePath — nested page regression guard', () => {
  it('does NOT match when path is full nested path and key is bare slug', () => {
    expect(matchPagePath('/services/seo', '/seo')).toBe(false);
  });

  it('matches exact path', () => {
    expect(matchPagePath('/services/seo', '/services/seo')).toBe(true);
  });

  it('matches when both use resolvePagePath output', () => {
    const page = { slug: 'seo', publishedPath: '/services/seo' };
    expect(matchPagePath('/services/seo', resolvePagePath(page))).toBe(true);
  });
});

describe('store round-trip — resolvePagePath as key derivation', () => {
  let wsId = '';

  beforeAll(() => {
    const ws = createWorkspace('Nested Page Path Test');
    wsId = ws.id;
  });

  afterAll(() => {
    deleteWorkspace(wsId);
  });

  it('stores and retrieves nested page using resolvePagePath-derived key', () => {
    const page = { slug: 'seo', publishedPath: '/services/seo' };
    const resolvedPath = resolvePagePath(page);
    upsertPageKeyword(wsId, {
      pagePath: resolvedPath,
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
    } as any);
    const result = getPageKeyword(wsId, resolvedPath);
    expect(result).toBeDefined();
    expect(result!.pagePath).toBe('/services/seo');
    expect(result!.primaryKeyword).toBe('seo services');
  });

  it('resolvePagePath(slug-only page) stores under /${slug} not publishedPath', () => {
    const page = { slug: 'about' };
    const resolvedPath = resolvePagePath(page);
    expect(resolvedPath).toBe('/about');
    upsertPageKeyword(wsId, {
      pagePath: resolvedPath,
      pageTitle: 'About',
      primaryKeyword: 'about us',
    } as any);
    const result = getPageKeyword(wsId, '/about');
    expect(result).toBeDefined();
    expect(result!.pagePath).toBe('/about');
  });

  it('does NOT retrieve nested page when looked up by bare slug', () => {
    // Regression: /services/seo stored above must NOT appear under /seo lookup
    const result = getPageKeyword(wsId, '/seo');
    expect(result).toBeUndefined();
  });
});
