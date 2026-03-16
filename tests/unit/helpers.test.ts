/**
 * Unit tests for server/helpers.ts — pure utility functions.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeString,
  validateEnum,
  parseDateRange,
  applySuppressionsToAudit,
  CRITICAL_CHECKS_SET,
  MODERATE_CHECKS_SET,
} from '../../server/helpers.js';

// ── sanitizeString ──

describe('sanitizeString', () => {
  it('returns empty string for non-string input', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
    expect(sanitizeString(42)).toBe('');
    expect(sanitizeString({})).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('limits length to default 500', () => {
    const long = 'a'.repeat(600);
    expect(sanitizeString(long)).toHaveLength(500);
  });

  it('limits length to custom max', () => {
    expect(sanitizeString('hello world', 5)).toBe('hello');
  });

  it('strips control characters', () => {
    expect(sanitizeString('hello\x00world\x08!')).toBe('helloworld!');
  });

  it('preserves normal text', () => {
    expect(sanitizeString('Hello, World! 123')).toBe('Hello, World! 123');
  });
});

// ── validateEnum ──

describe('validateEnum', () => {
  it('returns the value when it is in the allowed list', () => {
    expect(validateEnum('a', ['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('returns the fallback when value is not allowed', () => {
    expect(validateEnum('x', ['a', 'b', 'c'], 'c')).toBe('c');
  });

  it('returns the fallback for non-string input', () => {
    expect(validateEnum(42, ['a', 'b'], 'b')).toBe('b');
    expect(validateEnum(null, ['a', 'b'], 'a')).toBe('a');
  });
});

// ── parseDateRange ──

describe('parseDateRange', () => {
  it('returns a CustomDateRange when both dates are present', () => {
    const result = parseDateRange({ startDate: '2024-01-01', endDate: '2024-01-31' });
    expect(result).toEqual({ startDate: '2024-01-01', endDate: '2024-01-31' });
  });

  it('returns undefined when startDate is missing', () => {
    expect(parseDateRange({ endDate: '2024-01-31' })).toBeUndefined();
  });

  it('returns undefined when endDate is missing', () => {
    expect(parseDateRange({ startDate: '2024-01-01' })).toBeUndefined();
  });

  it('returns undefined when both are missing', () => {
    expect(parseDateRange({})).toBeUndefined();
  });
});

// ── applySuppressionsToAudit ──

describe('applySuppressionsToAudit', () => {
  const makeAudit = (pages: Array<{
    slug: string;
    issues: Array<{ check: string; severity: 'error' | 'warning' | 'info' }>;
  }>) => ({
    siteScore: 0,
    totalPages: pages.length,
    errors: 0,
    warnings: 0,
    infos: 0,
    pages: pages.map(p => ({
      slug: p.slug,
      url: `https://example.com/${p.slug}`,
      title: p.slug,
      score: 100,
      issues: p.issues.map(i => ({ ...i, message: `Issue: ${i.check}` })),
    })),
    siteWideIssues: [],
  });

  it('returns unmodified audit when no suppressions', () => {
    const audit = makeAudit([{ slug: 'home', issues: [{ check: 'title', severity: 'error' }] }]);
    const result = applySuppressionsToAudit(audit, []);
    expect(result.pages[0].issues).toHaveLength(1);
  });

  it('removes suppressed issues by check+slug match', () => {
    const audit = makeAudit([
      {
        slug: 'about',
        issues: [
          { check: 'title', severity: 'error' },
          { check: 'meta-description', severity: 'warning' },
        ],
      },
    ]);
    const suppressions = [
      { check: 'title', pageSlug: 'about', createdAt: new Date().toISOString() },
    ];
    const result = applySuppressionsToAudit(audit, suppressions);
    expect(result.pages[0].issues).toHaveLength(1);
    expect(result.pages[0].issues[0].check).toBe('meta-description');
  });

  it('recalculates page score after suppression', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'title', severity: 'error' }, // critical -15
          { check: 'og-tags', severity: 'warning' }, // moderate -3
        ],
      },
    ]);
    const suppressions = [
      { check: 'title', pageSlug: 'home', createdAt: new Date().toISOString() },
    ];
    const result = applySuppressionsToAudit(audit, suppressions);
    // Only og-tags warning remains: 100 - 3 = 97
    expect(result.pages[0].score).toBe(97);
  });

  it('calculates correct site score as average of page scores', () => {
    const audit = makeAudit([
      { slug: 'a', issues: [{ check: 'title', severity: 'error' }] },
      { slug: 'b', issues: [] },
    ]);
    const suppressions = [
      { check: 'title', pageSlug: 'a', createdAt: new Date().toISOString() },
    ];
    const result = applySuppressionsToAudit(audit, suppressions);
    // Both pages should have score 100 after suppression
    expect(result.siteScore).toBe(100);
  });

  it('does not suppress issues on non-matching pages', () => {
    const audit = makeAudit([
      { slug: 'home', issues: [{ check: 'title', severity: 'error' }] },
      { slug: 'about', issues: [{ check: 'title', severity: 'error' }] },
    ]);
    const suppressions = [
      { check: 'title', pageSlug: 'home', createdAt: new Date().toISOString() },
    ];
    const result = applySuppressionsToAudit(audit, suppressions);
    expect(result.pages[0].issues).toHaveLength(0); // home — suppressed
    expect(result.pages[1].issues).toHaveLength(1); // about — not suppressed
  });
});

// ── Check set constants ──

describe('check set constants', () => {
  it('CRITICAL_CHECKS_SET contains expected checks', () => {
    expect(CRITICAL_CHECKS_SET.has('title')).toBe(true);
    expect(CRITICAL_CHECKS_SET.has('meta-description')).toBe(true);
    expect(CRITICAL_CHECKS_SET.has('canonical')).toBe(true);
    expect(CRITICAL_CHECKS_SET.has('h1')).toBe(true);
  });

  it('MODERATE_CHECKS_SET contains expected checks', () => {
    expect(MODERATE_CHECKS_SET.has('content-length')).toBe(true);
    expect(MODERATE_CHECKS_SET.has('img-alt')).toBe(true);
    expect(MODERATE_CHECKS_SET.has('og-tags')).toBe(true);
  });

  it('critical and moderate sets are disjoint', () => {
    for (const check of CRITICAL_CHECKS_SET) {
      expect(MODERATE_CHECKS_SET.has(check)).toBe(false);
    }
  });
});
