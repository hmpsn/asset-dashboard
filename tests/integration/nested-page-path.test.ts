import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { matchPagePath, resolvePagePath, tryResolvePagePath } from '../../src/lib/pathUtils.js';
import { matchGscUrlToPath, resolvePagePath as serverResolvePagePath, tryResolvePagePath as serverTryResolvePagePath } from '../../server/helpers.js';
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

  it('ALWAYS returns a truthy string — contract that makes `|| undefined` dead code', () => {
    // This is the contract that `tryResolvePagePath` exists to complement.
    // Any caller that writes `resolvePagePath(page) || undefined` has dead code,
    // enforced by scripts/pr-check.ts.
    expect(resolvePagePath({})).toBeTruthy();
    expect(resolvePagePath({ slug: '' })).toBeTruthy();
    expect(resolvePagePath({ publishedPath: '' })).toBeTruthy();
    expect(resolvePagePath({ publishedPath: null })).toBeTruthy();
  });

  it('frontend and backend implementations agree', () => {
    const cases = [
      { slug: 'seo', publishedPath: '/services/seo' },
      { slug: 'seo' },
      {},
      { slug: 'seo', publishedPath: null },
      { publishedPath: '/about' },
    ];
    for (const c of cases) {
      expect(resolvePagePath(c)).toBe(serverResolvePagePath(c));
    }
  });
});

describe('tryResolvePagePath', () => {
  it('returns undefined when both slug and publishedPath are absent', () => {
    expect(tryResolvePagePath({})).toBeUndefined();
  });

  it('returns undefined when both are empty/null', () => {
    expect(tryResolvePagePath({ slug: '', publishedPath: null })).toBeUndefined();
  });

  it('returns resolvePagePath output when slug present', () => {
    expect(tryResolvePagePath({ slug: 'seo' })).toBe('/seo');
  });

  it('returns resolvePagePath output when publishedPath present', () => {
    expect(tryResolvePagePath({ publishedPath: '/services/seo' })).toBe('/services/seo');
  });

  it('frontend and backend implementations agree', () => {
    const cases = [
      { slug: 'seo', publishedPath: '/services/seo' },
      { slug: 'seo' },
      {},
      { slug: '', publishedPath: null },
      { publishedPath: '/about' },
    ];
    for (const c of cases) {
      expect(tryResolvePagePath(c)).toBe(serverTryResolvePagePath(c));
    }
  });
});

describe('matchGscUrlToPath', () => {
  it('matches exact pathname', () => {
    expect(matchGscUrlToPath('https://example.com/services/seo', '/services/seo')).toBe(true);
  });

  it('matches when GSC URL has trailing slash', () => {
    expect(matchGscUrlToPath('https://example.com/services/seo/', '/services/seo')).toBe(true);
  });

  it('matches homepage with trailing slash', () => {
    expect(matchGscUrlToPath('https://example.com/', '/')).toBe(true);
  });

  it('matches homepage with empty pathname', () => {
    expect(matchGscUrlToPath('https://example.com', '/')).toBe(true);
  });

  it('does NOT match nested path when resolved is bare slug', () => {
    expect(matchGscUrlToPath('https://example.com/services/seo', '/seo')).toBe(false);
  });

  it('does NOT match homepage when resolved is specific page', () => {
    expect(matchGscUrlToPath('https://example.com/', '/services/seo')).toBe(false);
  });

  it('handles malformed URL by treating input as a path', () => {
    expect(matchGscUrlToPath('/services/seo/', '/services/seo')).toBe(true);
  });

  it('handles malformed URL without leading slash', () => {
    expect(matchGscUrlToPath('services/seo', '/services/seo')).toBe(true);
  });

  it('is case-insensitive at the path level? (case-sensitive per current contract)', () => {
    // Current contract: case-sensitive. Documenting, not enforcing a change.
    expect(matchGscUrlToPath('https://example.com/Services/SEO', '/services/seo')).toBe(false);
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
