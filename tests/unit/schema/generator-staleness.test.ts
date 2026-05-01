/**
 * Unit tests for `isCatalogStale` — the lazy-refresh staleness predicate
 * extracted from generator.ts. Covers all six branches of the truth table
 * plus invalid-date handling.
 *
 * Background: prior to PR #385 review, the inline check short-circuited
 * on `stored.sourcePublishedAt !== null`, which left the catalog frozen
 * forever once a static page acquired its first lastPublished timestamp
 * (or vice-versa). This file pins the corrected behavior so future
 * refactors cannot regress.
 */
import { describe, it, expect } from 'vitest';
import { isCatalogStale } from '../../../server/schema/generator.js';

describe('isCatalogStale', () => {
  it('returns false when both timestamps are null (no refresh signal)', () => {
    expect(isCatalogStale(null, null)).toBe(false);
  });

  it('returns true when stored is null and input is set (first-time republish acquisition)', () => {
    expect(isCatalogStale(null, '2026-01-15T12:00:00Z')).toBe(true);
  });

  it('returns true when stored is set and input is null (CMS → static migration)', () => {
    expect(isCatalogStale('2026-01-15T12:00:00Z', null)).toBe(true);
  });

  it('returns false when both timestamps are equal (cache hit)', () => {
    const ts = '2026-01-15T12:00:00Z';
    expect(isCatalogStale(ts, ts)).toBe(false);
  });

  it('returns true when input is newer than stored (Webflow republish)', () => {
    expect(isCatalogStale('2026-01-15T12:00:00Z', '2026-02-01T12:00:00Z')).toBe(true);
  });

  it('returns false when input is older than stored (out-of-order webhook)', () => {
    expect(isCatalogStale('2026-02-01T12:00:00Z', '2026-01-15T12:00:00Z')).toBe(false);
  });

  it('returns true when stored timestamp is unparseable (corrupted row should refresh, not freeze)', () => {
    expect(isCatalogStale('not-a-date', '2026-01-15T12:00:00Z')).toBe(true);
  });

  it('returns true when input timestamp is unparseable (defensive — refresh and let extractor decide)', () => {
    expect(isCatalogStale('2026-01-15T12:00:00Z', 'garbage')).toBe(true);
  });

  it('returns true when both timestamps are unparseable', () => {
    expect(isCatalogStale('garbage', 'also-garbage')).toBe(true);
  });

  it('handles ISO with offset suffix (+04:00) consistently with Z form', () => {
    // Same instant — should be cache hit.
    expect(isCatalogStale('2026-01-15T16:00:00+04:00', '2026-01-15T12:00:00Z')).toBe(false);
  });
});
