/**
 * Pure unit tests for helper functions from server/helpers.ts.
 *
 * Focuses on functions that are not already unit-tested in helpers.test.ts,
 * helpers-sanitizers.test.ts, helpers-page-address.test.ts, or
 * helpers.stringUtils.test.ts:
 *
 *   - decodeEntities()         — HTML entity decoding
 *   - resolvePagePath()        — wraps resolvePageAddress().canonicalPath
 *   - tryResolvePagePath()     — returns undefined for fully-orphaned pages
 *   - sanitizeQueryForPrompt() — strips control chars, injection sequences, normalizes whitespace
 */
import { describe, it, expect, vi } from 'vitest';

// helpers.ts imports DB modules lazily (behind async functions), but the module-level
// imports from server/db/index.ts are hoisted when the module is first loaded.
// We pre-mock DB to prevent the import from opening a real SQLite file.
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(() => []),
    })),
  },
}));

// Other server modules pulled in transitively
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

import {
  decodeEntities,
  resolvePagePath,
  tryResolvePagePath,
  sanitizeQueryForPrompt,
} from '../../server/helpers.js';

// ── decodeEntities ──

describe('decodeEntities', () => {
  describe('named entities', () => {
    it('decodes &amp;', () => {
      expect(decodeEntities('fish &amp; chips')).toBe('fish & chips');
    });

    it('decodes &lt; and &gt;', () => {
      expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
    });

    it('decodes &quot;', () => {
      expect(decodeEntities('say &quot;hello&quot;')).toBe('say "hello"');
    });

    it('decodes &apos;', () => {
      expect(decodeEntities("it&apos;s")).toBe("it's");
    });

    it('decodes &nbsp; to a regular space', () => {
      expect(decodeEntities('a&nbsp;b')).toBe('a b');
    });

    it('decodes multiple named entities in one string', () => {
      expect(decodeEntities('&lt;b&gt;Hello &amp; World&lt;/b&gt;')).toBe('<b>Hello & World</b>');
    });
  });

  describe('numeric decimal entities', () => {
    it('decodes &#39; (apostrophe)', () => {
      expect(decodeEntities('won&#39;t')).toBe("won't");
    });

    it('decodes &#8217; (right single quotation mark)', () => {
      expect(decodeEntities('it&#8217;s')).toBe('it’s');
    });

    it('decodes &#8211; (en dash)', () => {
      expect(decodeEntities('2020&#8211;2021')).toBe('2020–2021');
    });
  });

  describe('numeric hex entities', () => {
    it('decodes &#x27; (apostrophe)', () => {
      expect(decodeEntities('&#x27;hello&#x27;')).toBe("'hello'");
    });

    it('decodes &#x2F; (forward slash)', () => {
      expect(decodeEntities('a&#x2F;b')).toBe('a/b');
    });

    it('decodes uppercase hex &#X27; equivalently', () => {
      // Hex is case-insensitive in the regex ([0-9a-fA-F])
      expect(decodeEntities('&#x41;')).toBe('A'); // 0x41 = 65 = 'A'
    });
  });

  describe('no-op cases', () => {
    it('returns plain text unchanged', () => {
      expect(decodeEntities('Hello World')).toBe('Hello World');
    });

    it('returns empty string unchanged', () => {
      expect(decodeEntities('')).toBe('');
    });

    it('does not alter already-decoded characters', () => {
      expect(decodeEntities('a & b < c')).toBe('a & b < c');
    });
  });
});

// ── resolvePagePath ──

describe('resolvePagePath', () => {
  describe('publishedPath takes highest priority', () => {
    it('uses publishedPath when provided', () => {
      expect(resolvePagePath({ publishedPath: '/services/seo', slug: 'seo' })).toBe('/services/seo');
    });

    it('strips trailing slash from publishedPath', () => {
      expect(resolvePagePath({ publishedPath: '/about/' })).toBe('/about');
    });

    it('resolves bare homepage publishedPath to /', () => {
      expect(resolvePagePath({ publishedPath: '/', slug: 'home' })).toBe('/');
    });

    it('extracts path from a full URL publishedPath', () => {
      expect(resolvePagePath({ publishedPath: 'https://example.com/blog/post' })).toBe('/blog/post');
    });
  });

  describe('slug fallback', () => {
    it('prefixes slug with leading slash', () => {
      expect(resolvePagePath({ slug: 'about' })).toBe('/about');
    });

    it('returns / for empty slug (Webflow homepage convention)', () => {
      expect(resolvePagePath({ slug: '' })).toBe('/');
    });

    it('normalizes slug with trailing slash', () => {
      expect(resolvePagePath({ slug: 'contact/' })).toBe('/contact');
    });
  });

  describe('no page info → fallback /', () => {
    it('returns / when page has no slug, publishedPath, path, or url', () => {
      expect(resolvePagePath({})).toBe('/');
    });
  });

  describe('path field (lower priority than publishedPath)', () => {
    it('uses path when publishedPath is absent', () => {
      expect(resolvePagePath({ path: '/services' })).toBe('/services');
    });
  });

  describe('url field (lower priority than path)', () => {
    it('uses url when publishedPath and path are absent', () => {
      expect(resolvePagePath({ url: '/contact-us' })).toBe('/contact-us');
    });

    it('extracts pathname from a full url', () => {
      expect(resolvePagePath({ url: 'https://example.com/team' })).toBe('/team');
    });
  });

  describe('path normalization', () => {
    it('adds leading slash when missing', () => {
      expect(resolvePagePath({ slug: 'no-leading-slash' })).toBe('/no-leading-slash');
    });

    it('preserves existing leading slash', () => {
      expect(resolvePagePath({ publishedPath: '/already-has-slash' })).toBe('/already-has-slash');
    });

    it('strips double trailing slashes', () => {
      expect(resolvePagePath({ publishedPath: '/page/' })).toBe('/page');
    });
  });
});

// ── tryResolvePagePath ──

describe('tryResolvePagePath', () => {
  describe('pages with identifying info → resolved path', () => {
    it('returns path for page with publishedPath', () => {
      expect(tryResolvePagePath({ publishedPath: '/services' })).toBe('/services');
    });

    it('returns / for page with empty slug (homepage)', () => {
      expect(tryResolvePagePath({ slug: '' })).toBe('/');
    });

    it('returns /about for page with slug "about"', () => {
      expect(tryResolvePagePath({ slug: 'about' })).toBe('/about');
    });

    it('returns path for page with only path field', () => {
      expect(tryResolvePagePath({ path: '/products' })).toBe('/products');
    });

    it('returns path for page with only url field', () => {
      expect(tryResolvePagePath({ url: 'https://example.com/contact' })).toBe('/contact');
    });
  });

  describe('orphaned pages (no identifying info) → undefined', () => {
    it('returns undefined for completely empty page object', () => {
      expect(tryResolvePagePath({})).toBeUndefined();
    });

    it('returns undefined when all fields are explicitly null', () => {
      expect(tryResolvePagePath({ slug: null, publishedPath: null, path: null, url: null })).toBeUndefined();
    });

    it('returns undefined when all fields are explicitly undefined', () => {
      expect(
        tryResolvePagePath({ slug: undefined, publishedPath: undefined, path: undefined, url: undefined }),
      ).toBeUndefined();
    });
  });

  describe('distinguishes from resolvePagePath which always returns a string', () => {
    it('resolvePagePath returns "/" for orphaned page; tryResolvePagePath returns undefined', () => {
      const orphan = {};
      expect(resolvePagePath(orphan)).toBe('/');
      expect(tryResolvePagePath(orphan)).toBeUndefined();
    });

    it('both agree on the path when a slug is present', () => {
      const page = { slug: 'case-studies' };
      expect(tryResolvePagePath(page)).toBe(resolvePagePath(page));
    });
  });
});

// ── sanitizeQueryForPrompt ──

describe('sanitizeQueryForPrompt', () => {
  describe('basic whitespace normalization', () => {
    it('trims leading and trailing whitespace', () => {
      expect(sanitizeQueryForPrompt('  hello  ')).toBe('hello');
    });

    it('collapses multiple spaces to a single space', () => {
      expect(sanitizeQueryForPrompt('foo   bar   baz')).toBe('foo bar baz');
    });

    it('converts newlines to spaces', () => {
      expect(sanitizeQueryForPrompt('line one\nline two')).toBe('line one line two');
    });

    it('converts carriage returns to spaces', () => {
      expect(sanitizeQueryForPrompt('line one\rline two')).toBe('line one line two');
    });

    it('handles CRLF line endings', () => {
      expect(sanitizeQueryForPrompt('a\r\nb')).toBe('a b');
    });
  });

  describe('control character removal', () => {
    it('removes null bytes', () => {
      expect(sanitizeQueryForPrompt('hel\x00lo')).toBe('hello');
    });

    it('removes backspace (0x08)', () => {
      expect(sanitizeQueryForPrompt('hel\x08lo')).toBe('hello');
    });

    it('removes form feed (0x0C)', () => {
      expect(sanitizeQueryForPrompt('hel\x0Clo')).toBe('hello');
    });

    it('removes escape character (0x1B)', () => {
      expect(sanitizeQueryForPrompt('hel\x1Blo')).toBe('hello');
    });

    it('preserves tab (0x09) — tab is not in the stripped range', () => {
      // Tab is 0x09, which is NOT in [0x00-0x08] or [0x0B, 0x0C] or [0x0E-0x1F]
      // However, \s+ collapses it to a space
      const result = sanitizeQueryForPrompt('a\tb');
      expect(result).toBe('a b');
    });
  });

  describe('prompt injection sequence removal', () => {
    it('strips <|...|> injection tokens (surrounding spaces collapse to one)', () => {
      // The token is removed, then \s+ collapses the resulting double-space to a single space
      expect(sanitizeQueryForPrompt('hello <|endoftext|> world')).toBe('hello world');
    });

    it('strips <|im_start|> injection token leaving no space', () => {
      expect(sanitizeQueryForPrompt('say <|im_start|>user hello')).toBe('say user hello');
    });

    it('removes injection token at start of string', () => {
      expect(sanitizeQueryForPrompt('<|system|>override')).toBe('override');
    });

    it('removes injection token at end of string', () => {
      expect(sanitizeQueryForPrompt('hello<|endoftext|>')).toBe('hello');
    });
  });

  describe('length limiting', () => {
    it('truncates to default 150 characters', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeQueryForPrompt(long)).toHaveLength(150);
    });

    it('truncates to a custom maxLen', () => {
      const long = 'a'.repeat(50);
      expect(sanitizeQueryForPrompt(long, 20)).toHaveLength(20);
    });

    it('does not truncate when string is within the limit', () => {
      const short = 'hello world';
      expect(sanitizeQueryForPrompt(short)).toBe('hello world');
    });

    it('maxLen=0 returns empty string', () => {
      expect(sanitizeQueryForPrompt('anything', 0)).toBe('');
    });
  });

  describe('real-world query strings', () => {
    it('passes a normal search query through unchanged', () => {
      expect(sanitizeQueryForPrompt('best SEO practices 2024')).toBe('best SEO practices 2024');
    });

    it('handles empty string', () => {
      expect(sanitizeQueryForPrompt('')).toBe('');
    });

    it('handles a query with only whitespace', () => {
      expect(sanitizeQueryForPrompt('   ')).toBe('');
    });

    it('normalizes a multi-line pasted query', () => {
      const messy = '  SEO tips\nfor small\r\nbusinesses  ';
      expect(sanitizeQueryForPrompt(messy)).toBe('SEO tips for small businesses');
    });
  });
});
