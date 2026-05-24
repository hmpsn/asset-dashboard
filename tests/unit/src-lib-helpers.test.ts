/**
 * Unit tests for src/lib helper modules.
 *
 * Covers: copyStatusConfig, pageTypeLabels, character-validation, utils,
 * and workspaceQuery / appendWorkspaceQuery URL helpers from src/api/seo.ts.
 *
 * All modules are pure — no browser APIs, no fetch, no DB.
 */
import { describe, it, expect } from 'vitest';

// ── src/lib/copyStatusConfig ─────────────────────────────────────────────────

import { COPY_STATUS_BADGE } from '../../src/lib/copyStatusConfig';

describe('src/lib/copyStatusConfig — COPY_STATUS_BADGE', () => {
  it('has an entry for every CopySectionStatus + "none"', () => {
    const expectedKeys = ['pending', 'draft', 'client_review', 'approved', 'revision_requested', 'none'];
    for (const key of expectedKeys) {
      expect(COPY_STATUS_BADGE).toHaveProperty(key);
    }
  });

  it('pending → zinc badge', () => {
    expect(COPY_STATUS_BADGE.pending.color).toBe('zinc');
    expect(COPY_STATUS_BADGE.pending.label).toBe('Pending');
  });

  it('draft → blue badge', () => {
    expect(COPY_STATUS_BADGE.draft.color).toBe('blue');
    expect(COPY_STATUS_BADGE.draft.label).toBe('Draft');
  });

  it('client_review → teal badge', () => {
    expect(COPY_STATUS_BADGE.client_review.color).toBe('teal');
    expect(COPY_STATUS_BADGE.client_review.label).toBe('In Review');
  });

  it('approved → emerald badge', () => {
    expect(COPY_STATUS_BADGE.approved.color).toBe('emerald');
    expect(COPY_STATUS_BADGE.approved.label).toBe('Approved');
  });

  it('revision_requested → orange badge', () => {
    expect(COPY_STATUS_BADGE.revision_requested.color).toBe('orange');
    expect(COPY_STATUS_BADGE.revision_requested.label).toBe('Revision');
  });

  it('none → zinc badge with "No Copy" label', () => {
    expect(COPY_STATUS_BADGE.none.color).toBe('zinc');
    expect(COPY_STATUS_BADGE.none.label).toBe('No Copy');
  });

  it('every entry has non-empty label and color', () => {
    for (const [key, cfg] of Object.entries(COPY_STATUS_BADGE)) {
      expect(cfg.label.length, `label empty for ${key}`).toBeGreaterThan(0);
      expect(cfg.color.length, `color empty for ${key}`).toBeGreaterThan(0);
    }
  });
});

// ── src/lib/pageTypeLabels ───────────────────────────────────────────────────

import { PAGE_TYPE_LABELS } from '../../src/lib/pageTypeLabels';

describe('src/lib/pageTypeLabels — PAGE_TYPE_LABELS', () => {
  it('homepage → "Homepage"', () => {
    expect(PAGE_TYPE_LABELS['homepage']).toBe('Homepage');
  });

  it('service → "Service"', () => {
    expect(PAGE_TYPE_LABELS['service']).toBe('Service');
  });

  it('location → "Location"', () => {
    expect(PAGE_TYPE_LABELS['location']).toBe('Location');
  });

  it('pricing-page → "Pricing" (hyphenated key)', () => {
    expect(PAGE_TYPE_LABELS['pricing-page']).toBe('Pricing');
  });

  it('provider-profile → "Provider Profile"', () => {
    expect(PAGE_TYPE_LABELS['provider-profile']).toBe('Provider Profile');
  });

  it('procedure-guide → "Procedure Guide"', () => {
    expect(PAGE_TYPE_LABELS['procedure-guide']).toBe('Procedure Guide');
  });

  it('landing → "Landing Page"', () => {
    expect(PAGE_TYPE_LABELS['landing']).toBe('Landing Page');
  });

  it('faq → "FAQ"', () => {
    expect(PAGE_TYPE_LABELS['faq']).toBe('FAQ');
  });

  it('blog → "Blog"', () => {
    expect(PAGE_TYPE_LABELS['blog']).toBe('Blog');
  });

  it('custom → "Custom"', () => {
    expect(PAGE_TYPE_LABELS['custom']).toBe('Custom');
  });

  it('unknown key is undefined (no fallthrough values)', () => {
    expect(PAGE_TYPE_LABELS['nonexistent-key']).toBeUndefined();
  });

  it('has at least 10 defined entries', () => {
    expect(Object.keys(PAGE_TYPE_LABELS).length).toBeGreaterThanOrEqual(10);
  });
});

// ── src/lib/character-validation ────────────────────────────────────────────

import { validateCharacterCount, truncateSmart, getColorClass } from '../../src/lib/character-validation';

describe('src/lib/character-validation — validateCharacterCount', () => {
  it('returns isValid=true when under the limit', () => {
    const result = validateCharacterCount('hello', 100);
    expect(result.isValid).toBe(true);
    expect(result.count).toBe(5);
    expect(result.isOverLimit).toBe(false);
  });

  it('returns isValid=false when over the limit', () => {
    const result = validateCharacterCount('hello world', 5);
    expect(result.isValid).toBe(false);
    expect(result.isOverLimit).toBe(true);
  });

  it('colorClass is emerald below 80%', () => {
    const result = validateCharacterCount('abc', 100); // 3%
    expect(result.colorClass).toBe('emerald');
    expect(result.isNearLimit).toBe(false);
  });

  it('colorClass is amber at 80%+', () => {
    const result = validateCharacterCount('a'.repeat(80), 100); // 80%
    expect(result.colorClass).toBe('amber');
    expect(result.isNearLimit).toBe(true);
  });

  it('colorClass is red at 95%+', () => {
    const result = validateCharacterCount('a'.repeat(95), 100); // 95%
    expect(result.colorClass).toBe('red');
    expect(result.isNearLimit).toBe(true);
  });

  it('percentage is computed correctly', () => {
    const result = validateCharacterCount('a'.repeat(50), 100);
    expect(result.percentage).toBeCloseTo(50);
  });

  it('truncated equals original when within limit', () => {
    const text = 'short text';
    const result = validateCharacterCount(text, 100);
    expect(result.truncated).toBe(text);
  });

  it('truncated is shorter when over limit', () => {
    const text = 'this is a long piece of text that exceeds the limit';
    const result = validateCharacterCount(text, 20);
    expect(result.truncated.length).toBeLessThanOrEqual(20);
  });
});

describe('src/lib/character-validation — truncateSmart', () => {
  it('returns original string when within limit', () => {
    expect(truncateSmart('hello', 10)).toBe('hello');
  });

  it('truncates at word boundary when possible', () => {
    const result = truncateSmart('hello world foo bar', 12);
    // Last space in first 12 chars: "hello world " → boundary at "hello world" (11)
    expect(result).not.toContain('foo');
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it('truncates hard at limit when no good word boundary', () => {
    const result = truncateSmart('abcdefghijklmnop', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('empty string stays empty', () => {
    expect(truncateSmart('', 10)).toBe('');
  });
});

describe('src/lib/character-validation — getColorClass', () => {
  it('returns emerald class below 80', () => {
    expect(getColorClass(50)).toBe('text-emerald-400/80');
  });

  it('returns amber class at 80', () => {
    expect(getColorClass(80)).toBe('text-amber-400/80');
  });

  it('returns amber class between 80 and 95', () => {
    expect(getColorClass(90)).toBe('text-amber-400/80');
  });

  it('returns red class at 95', () => {
    expect(getColorClass(95)).toBe('text-red-400/80');
  });

  it('returns red class above 95', () => {
    expect(getColorClass(100)).toBe('text-red-400/80');
  });
});

// ── src/lib/utils ────────────────────────────────────────────────────────────

import { cn, countWordsFromHtml } from '../../src/lib/utils';

describe('src/lib/utils — cn (class merging)', () => {
  it('merges two simple classes', () => {
    const result = cn('foo', 'bar');
    expect(result).toContain('foo');
    expect(result).toContain('bar');
  });

  it('deduplicates conflicting Tailwind classes (latter wins)', () => {
    // twMerge should resolve bg-red-500 vs bg-blue-500 → bg-blue-500
    const result = cn('bg-red-500', 'bg-blue-500');
    expect(result).not.toContain('bg-red-500');
    expect(result).toContain('bg-blue-500');
  });

  it('handles conditional class (falsy omitted)', () => {
    const result = cn('base', false && 'skipped', 'included');
    expect(result).not.toContain('skipped');
    expect(result).toContain('included');
  });

  it('handles undefined/null gracefully', () => {
    expect(() => cn('a', undefined, null as never)).not.toThrow();
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });
});

describe('src/lib/utils — countWordsFromHtml', () => {
  it('counts words in a simple paragraph', () => {
    expect(countWordsFromHtml('<p>Hello world</p>')).toBe(2);
  });

  it('strips tags before counting — does not count tag tokens', () => {
    // naive split on "<p>Hello</p>" would yield ["<p>Hello</p>"] → 1 or split on space
    expect(countWordsFromHtml('<p>Hello</p>')).toBe(1);
  });

  it('counts across multiple elements', () => {
    expect(countWordsFromHtml('<h1>Title here</h1><p>Body text now</p>')).toBe(5);
  });

  it('handles empty string', () => {
    expect(countWordsFromHtml('')).toBe(0);
  });

  it('handles only-whitespace input', () => {
    expect(countWordsFromHtml('   ')).toBe(0);
  });

  it('handles plain text with no tags', () => {
    expect(countWordsFromHtml('one two three')).toBe(3);
  });

  it('handles nested elements correctly', () => {
    expect(countWordsFromHtml('<ul><li>item one</li><li>item two</li></ul>')).toBe(4);
  });
});
