import { describe, it, expect } from 'vitest';
import { normalizeProviderDate } from '../../server/seo-data-provider.js';

describe('normalizeProviderDate', () => {
  it('converts SEMRush Unix epoch seconds (10-digit string) to ISO', () => {
    // 1747509061 → 2025-05-17T...
    const iso = normalizeProviderDate('1747509061');
    expect(iso).toMatch(/^2025-05-17T/);
    expect(() => new Date(iso).toISOString()).not.toThrow();
  });

  it('converts Unix epoch milliseconds (13-digit string) to ISO', () => {
    const iso = normalizeProviderDate('1747509061000');
    expect(iso).toMatch(/^2025-05-17T/);
  });

  it('leaves ISO-8601 input unchanged when Date.parse succeeds', () => {
    const input = '2025-01-15T00:00:00.000Z';
    expect(normalizeProviderDate(input)).toBe(input);
  });

  it('normalizes DataForSEO timestamp format "2021-01-15 00:00:00 +00:00" to ISO', () => {
    const iso = normalizeProviderDate('2021-01-15 00:00:00 +00:00');
    expect(iso).toMatch(/^2021-01-15T/);
  });

  it('returns empty string for empty input', () => {
    expect(normalizeProviderDate('')).toBe('');
  });

  it('returns empty string for unparseable input (no silent fallback to "Invalid Date")', () => {
    expect(normalizeProviderDate('not-a-date')).toBe('');
    expect(normalizeProviderDate('abc123')).toBe('');
  });

  it('returns empty string for zero or negative epoch (placeholder values)', () => {
    expect(normalizeProviderDate('0')).toBe('');
    expect(normalizeProviderDate('-1')).toBe('');
  });
});
