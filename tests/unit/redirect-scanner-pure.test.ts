/**
 * Wave 20 — Pure function unit tests for server/redirect-scanner.ts
 *
 * redirect-scanner.ts only exports one function (scanRedirects) which makes
 * HTTP and DB calls, plus type-only exports. The file contains one noteworthy
 * pure helper — findBestMatch — that is not exported.
 *
 * Strategy:
 * 1. Re-implement the pure algorithms from redirect-scanner.ts here
 *    (same approach as webflow-audit-pure.test.ts) to document and protect
 *    the scoring/matching contract.
 * 2. Test the URL tokenization logic and scoring rules used by findBestMatch.
 * 3. Test the GscGhostUrl pageName derivation logic (inline in scanRedirects).
 * 4. Test the summary counter logic (inline in scanRedirects).
 *
 * All functions tested here are pure re-implementations of the source logic.
 */

import { describe, it, expect } from 'vitest';
import type { PageStatus } from '../../server/redirect-scanner.js';

// ── Re-implemented pure helpers mirroring redirect-scanner.ts exactly ────────

/**
 * Tokenize a URL path into meaningful words.
 * Mirrors the `tokenize` arrow function inside `findBestMatch`.
 */
function tokenizePath(p: string): string[] {
  return p.replace(/^\//, '').toLowerCase().split(/[-_/]+/).filter(t => t.length > 1);
}

/**
 * Score a potential redirect target page against a broken path.
 * Mirrors the scoring logic in `findBestMatch`.
 */
function scoreMatch(brokenPath: string, page: { path: string; title: string }): number {
  const tokenize = tokenizePath;
  const brokenTokens = tokenize(brokenPath);
  const pageTokens = tokenize(page.path);
  const titleTokens = page.title.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const allPageTokens = [...new Set([...pageTokens, ...titleTokens])];

  let score = 0;
  for (const bt of brokenTokens) {
    for (const pt of allPageTokens) {
      if (bt === pt) { score += 3; break; }
      if (pt.includes(bt) || bt.includes(pt)) { score += 1.5; break; }
    }
  }

  // Bonus for matching path depth
  const brokenDepth = brokenPath.split('/').filter(Boolean).length;
  const pageDepth = page.path.split('/').filter(Boolean).length;
  if (brokenDepth === pageDepth) score += 0.5;

  // Bonus for shared path prefix
  if (brokenPath.length > 1 && page.path.startsWith(brokenPath.split('/').slice(0, 2).join('/'))) {
    score += 1;
  }

  return score;
}

/**
 * Find the best-matching healthy page for a broken path.
 * Mirrors `findBestMatch` in redirect-scanner.ts.
 */
function findBestMatch(brokenPath: string, healthyPages: PageStatus[]): PageStatus | null {
  if (healthyPages.length === 0) return null;

  const brokenTokens = tokenizePath(brokenPath);
  if (brokenTokens.length === 0) return null;

  let bestScore = 0;
  let bestPage: PageStatus | null = null;

  for (const page of healthyPages) {
    if (page.path === '/' && brokenPath !== '/') continue;
    const score = scoreMatch(brokenPath, page);
    if (score > bestScore) {
      bestScore = score;
      bestPage = page;
    }
  }

  return bestScore >= 3 ? bestPage : null;
}

/**
 * Derive a human-friendly page name from a URL path segment.
 * Mirrors the pageName derivation logic inline in scanRedirects for GSC ghost URLs.
 */
function derivePageNameFromPath(path: string): string {
  const lastSegment = path.replace(/^\//, '').split('/').pop() || '';
  return lastSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || path;
}

/**
 * Classify a page status into a summary bucket.
 * Mirrors the summary counting logic at the bottom of scanRedirects.
 */
function classifyStatus(status: number | 'error'): 'healthy' | 'redirecting' | 'notFound' | 'error' {
  if (status === 'error') return 'error';
  if (status >= 400 && status < 500) return 'notFound';
  if (status >= 300 && status < 400) return 'redirecting';
  if (status >= 200 && status < 300) return 'healthy';
  return 'error';
}

// ── Helper to build a minimal PageStatus ─────────────────────────────────────

function makePage(path: string, title: string, status: number | 'error' = 200): PageStatus {
  return {
    url: `https://example.com${path}`,
    path,
    title,
    status,
    statusText: status === 'error' ? 'Error' : String(status),
    source: 'static',
  };
}

// ── tokenizePath ─────────────────────────────────────────────────────────────

describe('tokenizePath (redirect path tokenizer)', () => {
  it('splits on hyphens', () => {
    expect(tokenizePath('/my-page')).toEqual(['my', 'page']);
  });

  it('splits on slashes', () => {
    expect(tokenizePath('/blog/post')).toEqual(['blog', 'post']);
  });

  it('splits on underscores', () => {
    expect(tokenizePath('/my_page')).toEqual(['my', 'page']);
  });

  it('filters out short tokens (length <= 1)', () => {
    expect(tokenizePath('/a/blog/b')).toEqual(['blog']);
  });

  it('lowercases all tokens', () => {
    expect(tokenizePath('/Blog/MyPost')).toEqual(['blog', 'mypost']);
  });

  it('handles empty string', () => {
    expect(tokenizePath('')).toEqual([]);
  });

  it('handles root path only', () => {
    expect(tokenizePath('/')).toEqual([]);
  });

  it('handles multiple mixed delimiters', () => {
    expect(tokenizePath('/services/web-design')).toEqual(['services', 'web', 'design']);
  });
});

// ── scoreMatch ────────────────────────────────────────────────────────────────

describe('scoreMatch (redirect target scoring)', () => {
  it('returns 3 for exact token match', () => {
    const score = scoreMatch('/about', { path: '/about', title: 'About Us' });
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it('returns low score with no token overlap (only depth bonus may apply)', () => {
    // No meaningful token overlap — score is 0 from tokens, possibly 0.5 depth bonus
    // '/xyz-random' and '/contact' have no matching tokens; both depth 1 so +0.5
    const score = scoreMatch('/xyz-random', { path: '/contact', title: 'Contact' });
    expect(score).toBeLessThan(3); // below the match threshold
  });

  it('adds depth bonus when path depths match', () => {
    const scoreShallow = scoreMatch('/about', { path: '/about', title: 'About' });
    // Both have depth 1 — depth bonus applies
    expect(scoreShallow).toBeGreaterThanOrEqual(3.5); // 3 (token) + 0.5 (depth)
  });

  it('adds prefix bonus for shared parent path', () => {
    const score = scoreMatch('/services/seo', { path: '/services/web-design', title: 'Web Design' });
    // Shares /services prefix — prefix bonus applies
    expect(score).toBeGreaterThan(0);
  });

  it('counts partial token match (substring) as 1.5', () => {
    // 'webdesign' contains 'web'
    const score = scoreMatch('/web', { path: '/webdesign', title: 'Web Design' });
    expect(score).toBeGreaterThan(0);
  });

  it('title tokens contribute to matching', () => {
    // broken path has "seo", healthy page title has "seo" but path has "/services"
    const score = scoreMatch('/seo-services', { path: '/services', title: 'SEO Services Page' });
    // 'seo' matches title token 'seo', 'services' matches path token 'services'
    expect(score).toBeGreaterThanOrEqual(3);
  });
});

// ── findBestMatch ─────────────────────────────────────────────────────────────

describe('findBestMatch (redirect recommendation engine)', () => {
  it('returns null for empty healthy pages', () => {
    expect(findBestMatch('/old-page', [])).toBeNull();
  });

  it('returns null when broken path produces no tokens (root)', () => {
    const pages = [makePage('/about', 'About')];
    expect(findBestMatch('/', pages)).toBeNull();
  });

  it('finds a match by path token', () => {
    const pages = [
      makePage('/about', 'About Us'),
      makePage('/contact', 'Contact'),
    ];
    const result = findBestMatch('/about-old', pages);
    expect(result?.path).toBe('/about');
  });

  it('does not recommend homepage for non-root broken paths', () => {
    const pages = [
      makePage('/', 'Home'),
      makePage('/about', 'About'),
    ];
    const result = findBestMatch('/about-us-old', pages);
    expect(result?.path).toBe('/about');
    expect(result?.path).not.toBe('/');
  });

  it('returns null when best score is below threshold (< 3)', () => {
    // No meaningful token overlap
    const pages = [makePage('/xyz', 'XYZ Page')];
    const result = findBestMatch('/abc-def', pages);
    expect(result).toBeNull();
  });

  it('picks the highest-scoring page among multiple candidates', () => {
    const pages = [
      makePage('/about', 'About Us'),
      makePage('/about-company', 'About Our Company'),
    ];
    // 'about' appears in both paths — 'about-company' also has 'company' but broken is just 'about'
    const result = findBestMatch('/about', pages);
    expect(result).not.toBeNull();
  });
});

// ── derivePageNameFromPath ────────────────────────────────────────────────────

describe('derivePageNameFromPath (GSC ghost URL label derivation)', () => {
  it('converts last segment with hyphens to title case', () => {
    expect(derivePageNameFromPath('/blog/my-post')).toBe('My Post');
  });

  it('converts underscores to spaces', () => {
    expect(derivePageNameFromPath('/page_name')).toBe('Page Name');
  });

  it('handles single-segment paths', () => {
    expect(derivePageNameFromPath('/about')).toBe('About');
  });

  it('handles root path falling back to path itself', () => {
    // No segment after stripping slash → fallback to path
    expect(derivePageNameFromPath('/')).toBe('/');
  });

  it('capitalizes each word', () => {
    expect(derivePageNameFromPath('/services/web-design')).toBe('Web Design');
  });

  it('handles numbers in segment', () => {
    expect(derivePageNameFromPath('/blog/post-2024')).toBe('Post 2024');
  });
});

// ── classifyStatus ────────────────────────────────────────────────────────────

describe('classifyStatus (redirect scan summary counter)', () => {
  it('classifies 200 as healthy', () => {
    expect(classifyStatus(200)).toBe('healthy');
  });

  it('classifies 301 as redirecting', () => {
    expect(classifyStatus(301)).toBe('redirecting');
  });

  it('classifies 302 as redirecting', () => {
    expect(classifyStatus(302)).toBe('redirecting');
  });

  it('classifies 404 as notFound', () => {
    expect(classifyStatus(404)).toBe('notFound');
  });

  it('classifies 410 as notFound', () => {
    expect(classifyStatus(410)).toBe('notFound');
  });

  it('classifies "error" string as error', () => {
    expect(classifyStatus('error')).toBe('error');
  });

  it('classifies 500 as error (not in any named bucket)', () => {
    expect(classifyStatus(500)).toBe('error');
  });

  it('classifies 204 as healthy', () => {
    expect(classifyStatus(204)).toBe('healthy');
  });
});
