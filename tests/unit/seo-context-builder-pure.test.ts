/**
 * Pure transformation function tests for server/helpers.ts.
 *
 * Tests all functions that take plain values and return plain values
 * (no DB, no filesystem, no network) from the helpers module:
 *  - decodeEntities()
 *  - normalizePath()
 *  - matchPagePath()
 *  - findPageMapEntry()
 *  - matchGscUrlToPath()
 *  - applyBulkKeywordGuards()
 *  - normalizePageUrl()
 *  - matchPageIdentity()
 *  - sanitizeString()
 *  - sanitizeErrorMessage()
 *  - sanitizeForPromptInjection()
 *  - sanitizeQueryForPrompt()
 *  - validateEnum()
 *  - parseDateRange()
 *  - resolvePagePath() / tryResolvePagePath()
 *
 * DB-touching functions (buildSchemaContext, etc.) are covered by integration
 * tests. This file stays strictly pure: no mocks needed, no async code.
 */
import { describe, it, expect } from 'vitest';

import {
  decodeEntities,
  normalizePath,
  matchPagePath,
  findPageMapEntry,
  matchGscUrlToPath,
  applyBulkKeywordGuards,
  normalizePageUrl,
  matchPageIdentity,
  sanitizeString,
  sanitizeErrorMessage,
  sanitizeForPromptInjection,
  sanitizeQueryForPrompt,
  validateEnum,
  parseDateRange,
  resolvePagePath,
  tryResolvePagePath,
} from '../../server/helpers.js';

// ── decodeEntities ────────────────────────────────────────────────────────────

describe('decodeEntities', () => {
  it('decodes &amp; to &', () => {
    expect(decodeEntities('A &amp; B')).toBe('A & B');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &quot; to double-quote', () => {
    expect(decodeEntities('He said &quot;hello&quot;')).toBe('He said "hello"');
  });

  it('decodes &apos; to single-quote', () => {
    expect(decodeEntities('don&apos;t')).toBe("don't");
  });

  it('decodes &nbsp; to space', () => {
    expect(decodeEntities('A&nbsp;B')).toBe('A B');
  });

  it('decodes hex entities like &#x27; (apostrophe)', () => {
    expect(decodeEntities('it&#x27;s')).toBe("it's");
  });

  it('decodes decimal entities like &#39; (apostrophe)', () => {
    expect(decodeEntities('it&#39;s')).toBe("it's");
  });

  it('decodes &#8217; (right single quote / curly apostrophe)', () => {
    expect(decodeEntities('it&#8217;s')).toBe("it’s");
  });

  it('returns plain strings unchanged', () => {
    expect(decodeEntities('Hello world')).toBe('Hello world');
  });

  it('decodes multiple entities in one string', () => {
    expect(decodeEntities('&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;')).toBe('<p>Tom & Jerry</p>');
  });
});

// ── normalizePath ─────────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('adds leading slash when missing', () => {
    expect(normalizePath('about')).toBe('/about');
  });

  it('strips trailing slash', () => {
    expect(normalizePath('/about/')).toBe('/about');
  });

  it('preserves the homepage slash', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('handles already-normalized paths unchanged', () => {
    expect(normalizePath('/services/seo')).toBe('/services/seo');
  });

  it('does not double the leading slash', () => {
    expect(normalizePath('/already/')).toBe('/already');
  });

  it('handles empty string as homepage', () => {
    expect(normalizePath('')).toBe('/');
  });
});

// ── matchPagePath ─────────────────────────────────────────────────────────────

describe('matchPagePath', () => {
  it('matches identical normalized paths', () => {
    expect(matchPagePath('/about', '/about')).toBe(true);
  });

  it('matches with trailing slash vs without', () => {
    expect(matchPagePath('/about/', '/about')).toBe(true);
    expect(matchPagePath('/about', '/about/')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPagePath('/About', '/about')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchPagePath('/about', '/contact')).toBe(false);
  });
});

// ── findPageMapEntry ──────────────────────────────────────────────────────────

describe('findPageMapEntry', () => {
  const pageMap = [
    { pagePath: '/about', title: 'About' },
    { pagePath: '/services/seo', title: 'SEO' },
  ];

  it('returns matching entry by exact path', () => {
    expect(findPageMapEntry(pageMap, '/about')).toEqual({ pagePath: '/about', title: 'About' });
  });

  it('returns matching entry with trailing slash in query', () => {
    expect(findPageMapEntry(pageMap, '/about/')).toEqual({ pagePath: '/about', title: 'About' });
  });

  it('returns undefined when path not found', () => {
    expect(findPageMapEntry(pageMap, '/missing')).toBeUndefined();
  });

  it('is case-insensitive on the query path', () => {
    expect(findPageMapEntry(pageMap, '/ABOUT')).toEqual({ pagePath: '/about', title: 'About' });
  });
});

// ── matchGscUrlToPath ─────────────────────────────────────────────────────────

describe('matchGscUrlToPath', () => {
  it('matches full URL pathname against resolved path', () => {
    expect(matchGscUrlToPath('https://example.com/about', '/about')).toBe(true);
  });

  it('matches bare path against resolved path', () => {
    expect(matchGscUrlToPath('/about', '/about')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchGscUrlToPath('/about', '/contact')).toBe(false);
  });

  it('matches homepage: GSC "/" against resolved "/"', () => {
    expect(matchGscUrlToPath('/', '/')).toBe(true);
  });

  it('matches homepage: GSC "" against resolved "/"', () => {
    expect(matchGscUrlToPath('', '/')).toBe(true);
  });

  it('matches full URL of homepage against resolved "/"', () => {
    expect(matchGscUrlToPath('https://example.com/', '/')).toBe(true);
  });
});

// ── applyBulkKeywordGuards ────────────────────────────────────────────────────

describe('applyBulkKeywordGuards', () => {
  it('zeroes out metrics when semrushBlock is empty', () => {
    const analysis: Record<string, unknown> = { keywordDifficulty: 42, monthlyVolume: 1000 };
    applyBulkKeywordGuards(analysis, '');
    expect(analysis.keywordDifficulty).toBe(0);
    expect(analysis.monthlyVolume).toBe(0);
  });

  it('leaves metrics intact when semrushBlock is non-empty', () => {
    const analysis: Record<string, unknown> = { keywordDifficulty: 42, monthlyVolume: 1000 };
    applyBulkKeywordGuards(analysis, 'Monthly volume: 1234');
    expect(analysis.keywordDifficulty).toBe(42);
    expect(analysis.monthlyVolume).toBe(1000);
  });

  it('is a no-op when analysis is not an object', () => {
    // Should not throw
    applyBulkKeywordGuards(null as unknown as Record<string, unknown>, '');
    applyBulkKeywordGuards([] as unknown as Record<string, unknown>, '');
  });
});

// ── normalizePageUrl / matchPageIdentity ──────────────────────────────────────

describe('normalizePageUrl', () => {
  it('strips origin from full URL', () => {
    expect(normalizePageUrl('https://example.com/about')).toBe('/about');
  });

  it('normalizes bare path', () => {
    expect(normalizePageUrl('about/')).toBe('/about');
  });

  it('handles root URL', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
  });
});

describe('matchPageIdentity', () => {
  it('matches full URL against path', () => {
    expect(matchPageIdentity('https://example.com/about', '/about')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPageIdentity('/ABOUT', '/about')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchPageIdentity('/about', '/contact')).toBe(false);
  });
});

// ── sanitizeString ────────────────────────────────────────────────────────────

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('truncates to maxLen', () => {
    expect(sanitizeString('abcde', 3)).toBe('abc');
  });

  it('strips control characters', () => {
    expect(sanitizeString('hel\x01lo')).toBe('hello');
  });

  it('preserves tabs, line feeds, and carriage returns (not stripped by control char pattern)', () => {
    // Only \x00-\x08, \x0B, \x0C, \x0E-\x1F are stripped; \t=\x09, \n=\x0A, \r=\x0D survive
    expect(sanitizeString('a\tb')).toBe('a\tb');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeString(42 as unknown as string)).toBe('');
    expect(sanitizeString(null as unknown as string)).toBe('');
    expect(sanitizeString(undefined as unknown as string)).toBe('');
  });

  it('defaults maxLen to 500', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeString(long).length).toBe(500);
  });
});

// ── sanitizeErrorMessage ──────────────────────────────────────────────────────

describe('sanitizeErrorMessage', () => {
  it('returns fallback for non-Error values', () => {
    expect(sanitizeErrorMessage('oops', 'fallback')).toBe('fallback');
    expect(sanitizeErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('returns fallback for Error with message > 200 chars', () => {
    const long = new Error('x'.repeat(201));
    expect(sanitizeErrorMessage(long, 'fallback')).toBe('fallback');
  });

  it('returns fallback when message contains SQLITE_ pattern', () => {
    const err = new Error('SQLITE_CONSTRAINT: UNIQUE failed');
    expect(sanitizeErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('returns fallback when err.code starts with SQLITE_', () => {
    const err = Object.assign(new Error('Constraint failed'), { code: 'SQLITE_CONSTRAINT' });
    expect(sanitizeErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('returns the message for safe errors', () => {
    const err = new Error('Invalid email address');
    expect(sanitizeErrorMessage(err, 'fallback')).toBe('Invalid email address');
  });

  it('returns fallback when message contains "no such table"', () => {
    const err = new Error('no such table: users');
    expect(sanitizeErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('returns fallback when message contains stack frame pattern', () => {
    const err = new Error('Error at server/index.ts:42');
    expect(sanitizeErrorMessage(err, 'fallback')).toBe('fallback');
  });
});

// ── sanitizeForPromptInjection ────────────────────────────────────────────────

describe('sanitizeForPromptInjection', () => {
  it('wraps content in untrusted_user_content tags', () => {
    const result = sanitizeForPromptInjection('Hello world');
    expect(result).toContain('<untrusted_user_content>');
    expect(result).toContain('</untrusted_user_content>');
    expect(result).toContain('Hello world');
  });

  it('removes control tokens', () => {
    const result = sanitizeForPromptInjection('before <|system|> after');
    expect(result).toContain('[removed-control-token]');
    expect(result).not.toContain('<|system|>');
  });

  it('strips NUL and control characters', () => {
    const result = sanitizeForPromptInjection('a\x00b\x01c');
    expect(result).toContain('abc');
  });

  it('escapes untrusted_user_content tags inside the input', () => {
    const result = sanitizeForPromptInjection('<untrusted_user_content>injection</untrusted_user_content>');
    expect(result).toContain('&lt;untrusted_user_content&gt;');
  });
});

// ── sanitizeQueryForPrompt ────────────────────────────────────────────────────

describe('sanitizeQueryForPrompt', () => {
  it('collapses multiple spaces to one', () => {
    expect(sanitizeQueryForPrompt('a   b')).toBe('a b');
  });

  it('removes newlines', () => {
    expect(sanitizeQueryForPrompt('line1\nline2')).toBe('line1 line2');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeQueryForPrompt('  hello  ')).toBe('hello');
  });

  it('truncates to maxLen', () => {
    expect(sanitizeQueryForPrompt('abcde', 3)).toBe('abc');
  });

  it('defaults maxLen to 150', () => {
    const long = 'x '.repeat(100);
    expect(sanitizeQueryForPrompt(long).length).toBeLessThanOrEqual(150);
  });
});

// ── validateEnum ──────────────────────────────────────────────────────────────

describe('validateEnum', () => {
  const allowed = ['a', 'b', 'c'] as const;

  it('returns the value when it is in the allowed set', () => {
    expect(validateEnum('a', [...allowed], 'a')).toBe('a');
    expect(validateEnum('c', [...allowed], 'a')).toBe('c');
  });

  it('returns fallback when value is not in allowed set', () => {
    expect(validateEnum('d', [...allowed], 'a')).toBe('a');
  });

  it('returns fallback for undefined', () => {
    expect(validateEnum(undefined, [...allowed], 'b')).toBe('b');
  });

  it('returns fallback for empty string when not in allowed set', () => {
    expect(validateEnum('', ['x', 'y'], 'x')).toBe('x');
  });
});

// ── parseDateRange ────────────────────────────────────────────────────────────

describe('parseDateRange', () => {
  it('returns a CustomDateRange when both startDate and endDate are present', () => {
    const result = parseDateRange({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(result).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' });
  });

  it('returns undefined when startDate is missing', () => {
    expect(parseDateRange({ endDate: '2026-01-31' })).toBeUndefined();
  });

  it('returns undefined when endDate is missing', () => {
    expect(parseDateRange({ startDate: '2026-01-01' })).toBeUndefined();
  });

  it('returns undefined for empty query', () => {
    expect(parseDateRange({})).toBeUndefined();
  });
});

// ── resolvePagePath / tryResolvePagePath ─────────────────────────────────────

describe('resolvePagePath', () => {
  it('uses publishedPath when present', () => {
    expect(resolvePagePath({ publishedPath: '/services/seo', slug: 'seo' })).toBe('/services/seo');
  });

  it('falls back to slug when publishedPath is absent', () => {
    expect(resolvePagePath({ slug: 'about' })).toBe('/about');
  });

  it('returns "/" for homepage (slug: "")', () => {
    expect(resolvePagePath({ slug: '' })).toBe('/');
  });

  it('normalizes full URL publishedPath to pathname', () => {
    expect(resolvePagePath({ publishedPath: 'https://example.com/about/' })).toBe('/about');
  });

  it('returns "/" for page with no fields', () => {
    expect(resolvePagePath({})).toBe('/');
  });
});

describe('tryResolvePagePath', () => {
  it('returns undefined for page with no slug, path, publishedPath, or url', () => {
    expect(tryResolvePagePath({})).toBeUndefined();
  });

  it('returns path when slug is empty string (homepage)', () => {
    expect(tryResolvePagePath({ slug: '' })).toBe('/');
  });

  it('returns resolved path when publishedPath is present', () => {
    expect(tryResolvePagePath({ publishedPath: '/about' })).toBe('/about');
  });

  it('returns resolved path when slug is present', () => {
    expect(tryResolvePagePath({ slug: 'about' })).toBe('/about');
  });
});
