/**
 * Equivalence guard for the raw-`new URL().pathname` → `normalizePageUrl()`
 * migration (chore/ov-quick-wins, sub-item c).
 *
 * Several src/components/ callsites used the inline pattern:
 *   try { path = new URL(url).pathname; } catch { path = url; }
 * to extract a display path from a (usually) full GSC/analytics URL. They were
 * migrated onto the shared `normalizePageUrl()` helper. This file pins the
 * behavioural contract for the realistic inputs those callsites receive so a
 * future change to the helper can't silently alter what users see.
 *
 * The ONE intentional difference vs raw `new URL().pathname`: the helper strips
 * a trailing slash (and is throw-safe on relative input). Those deltas are
 * asserted explicitly below so they stay deliberate, not accidental.
 */
import { describe, it, expect } from 'vitest';
import { normalizePageUrl } from '../../src/lib/pathUtils.js';

/** The pre-migration inline logic, reproduced verbatim for comparison. */
function legacyExtract(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

describe('normalizePageUrl ↔ legacy new URL().pathname display extraction', () => {
  // Realistic GSC / analytics page URLs (no trailing slash) — output must be
  // byte-identical to the old inline extraction.
  const identicalInputs = [
    'https://example.com/services/seo',
    'https://example.com/blog/post',
    'https://example.com/faq',
    'https://example.com',          // legacy → '/', helper → '/'
    'https://example.com/',         // both → '/'
  ];

  for (const input of identicalInputs) {
    it(`matches legacy extraction for ${input}`, () => {
      expect(normalizePageUrl(input)).toBe(legacyExtract(input));
    });
  }

  it('extracts pathname only (drops query + hash) like the legacy path', () => {
    expect(normalizePageUrl('https://example.com/blog?q=seo#top')).toBe('/blog');
    expect(legacyExtract('https://example.com/blog?q=seo#top')).toBe('/blog');
  });

  it('root URL maps to "/" (DataSnapshots "Homepage" guard still fires)', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
    expect(normalizePageUrl('https://example.com')).toBe('/');
  });

  // Intentional, beneficial divergence: trailing slashes are stripped.
  it('strips a trailing slash that legacy extraction preserved (intentional)', () => {
    expect(legacyExtract('https://example.com/blog/')).toBe('/blog/');
    expect(normalizePageUrl('https://example.com/blog/')).toBe('/blog'); // normalized
  });

  // Intentional, beneficial divergence: relative input is normalized instead of
  // returned raw (legacy returned it raw via the catch arm; for already-path
  // inputs the result is the same once a leading slash is present).
  it('normalizes an already-relative path the same way the catch-arm displayed it', () => {
    expect(normalizePageUrl('/blog/post')).toBe('/blog/post');
    expect(legacyExtract('/blog/post')).toBe('/blog/post');
  });

  it('adds a leading slash to a bare slug (legacy returned it slashless)', () => {
    // Only relevant if a callsite ever receives a bare slug; the leading slash
    // makes the display consistent with every other path label.
    expect(normalizePageUrl('blog')).toBe('/blog');
  });
});
