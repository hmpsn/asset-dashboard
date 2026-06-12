/**
 * Unit tests for pure/exported functions in server/search-console.ts.
 * Wave 8 — search-console pure function coverage.
 *
 * Tests: formatGscCtr, formatGscPosition, computePercentChange,
 *        extractGscPagePathname, findTopDroppedPage, findTopSpikedPage,
 *        gscDateRange, paginateGscQuery (already covered in gsc-pagination.test.ts
 *        but additional edge-case tests added here for completeness).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatGscCtr,
  formatGscPosition,
  computePercentChange,
  extractGscPagePathname,
  findTopDroppedPage,
  findTopSpikedPage,
  gscDateRange,
  paginateGscQuery,
} from '../../server/search-console.js';

afterEach(() => {
  vi.useRealTimers();
});

// ─── formatGscCtr ───────────────────────────────────────────────────────────

describe('formatGscCtr', () => {
  it('converts GSC decimal CTR to percentage rounded to 1 decimal', () => {
    expect(formatGscCtr(0.063)).toBe(6.3);
  });

  it('handles 0 CTR', () => {
    expect(formatGscCtr(0)).toBe(0);
  });

  it('handles perfect CTR (1.0 = 100%)', () => {
    expect(formatGscCtr(1.0)).toBe(100.0);
  });

  it('documents floating-point behavior at .05 boundary', () => {
    // 0.1055 * 100 = 10.549999... (IEEE 754) → toFixed(1) rounds to 10.5, not 10.6
    expect(formatGscCtr(0.1055)).toBe(10.5);
  });

  it('returns a number, not a string', () => {
    expect(typeof formatGscCtr(0.05)).toBe('number');
  });

  it('handles very small CTR (below 0.1%)', () => {
    // 0.0009 * 100 = 0.09 → rounds to 0.1
    expect(formatGscCtr(0.0009)).toBe(0.1);
  });

  it('handles typical low CTR (0.5%)', () => {
    expect(formatGscCtr(0.005)).toBe(0.5);
  });

  it('handles 10% CTR', () => {
    expect(formatGscCtr(0.1)).toBe(10.0);
  });

  it('handles fractional that rounds cleanly', () => {
    // 0.033 * 100 = 3.3 → exactly 3.3
    expect(formatGscCtr(0.033)).toBe(3.3);
  });
});

// ─── formatGscPosition ──────────────────────────────────────────────────────

describe('formatGscPosition', () => {
  it('rounds position to 1 decimal place', () => {
    expect(formatGscPosition(3.456)).toBe(3.5);
  });

  it('handles integer positions', () => {
    expect(formatGscPosition(1)).toBe(1.0);
  });

  it('returns a number type', () => {
    expect(typeof formatGscPosition(5.5)).toBe('number');
  });

  it('handles position 1 (best rank)', () => {
    expect(formatGscPosition(1.0)).toBe(1.0);
  });

  it('handles high positions (100+)', () => {
    expect(formatGscPosition(100.456)).toBe(100.5);
  });

  it('rounds down at .04', () => {
    // 5.04 → 5.0
    expect(formatGscPosition(5.04)).toBe(5.0);
  });

  it('documents floating-point behavior at .05 boundary', () => {
    // 5.05.toFixed(1) = "5.0" due to IEEE 754 representation (5.05 is slightly below 5.05)
    expect(formatGscPosition(5.05)).toBe(5.0);
  });

  it('handles fractional position like GSC averages produce', () => {
    // Typical: 8.7328... → 8.7
    expect(formatGscPosition(8.7328)).toBe(8.7);
  });
});

// ─── computePercentChange ───────────────────────────────────────────────────

describe('computePercentChange', () => {
  it('returns 100 when previous is 0 and current > 0', () => {
    expect(computePercentChange(50, 0)).toBe(100);
  });

  it('returns 0 when both current and previous are 0', () => {
    expect(computePercentChange(0, 0)).toBe(0);
  });

  it('computes positive percent change correctly', () => {
    // (200 - 100) / 100 * 100 = 100%
    expect(computePercentChange(200, 100)).toBe(100.0);
  });

  it('computes negative percent change correctly', () => {
    // (50 - 100) / 100 * 100 = -50%
    expect(computePercentChange(50, 100)).toBe(-50.0);
  });

  it('rounds to 1 decimal place', () => {
    // (33 - 30) / 30 * 100 = 10.0%
    expect(computePercentChange(33, 30)).toBe(10.0);
  });

  it('handles fractional result rounding', () => {
    // (7 - 6) / 6 * 100 = 16.6667 → 16.7
    expect(computePercentChange(7, 6)).toBe(16.7);
  });

  it('handles large values', () => {
    // (1000000 - 500000) / 500000 * 100 = 100%
    expect(computePercentChange(1000000, 500000)).toBe(100.0);
  });

  it('returns a number type', () => {
    expect(typeof computePercentChange(10, 5)).toBe('number');
  });

  it('handles decrease to zero', () => {
    // (0 - 100) / 100 * 100 = -100%
    expect(computePercentChange(0, 100)).toBe(-100.0);
  });

  it('handles fractional previous value', () => {
    // (5.0 - 2.5) / 2.5 * 100 = 100%
    expect(computePercentChange(5.0, 2.5)).toBe(100.0);
  });
});

// ─── extractGscPagePathname ─────────────────────────────────────────────────

describe('extractGscPagePathname', () => {
  it('extracts pathname from a full URL', () => {
    expect(extractGscPagePathname('https://example.com/blog/post')).toBe('/blog/post');
  });

  it('extracts root pathname from domain URL', () => {
    expect(extractGscPagePathname('https://example.com/')).toBe('/');
  });

  it('extracts pathname from URL with query string', () => {
    expect(extractGscPagePathname('https://example.com/page?foo=bar')).toBe('/page');
  });

  it('extracts pathname from URL with fragment', () => {
    expect(extractGscPagePathname('https://example.com/page#section')).toBe('/page');
  });

  it('returns raw value when input starts with / (already a pathname)', () => {
    expect(extractGscPagePathname('/already/a/path')).toBe('/already/a/path');
  });

  it('returns null for invalid URL that does not start with /', () => {
    expect(extractGscPagePathname('not-a-url')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractGscPagePathname('')).toBeNull();
  });

  it('documents sc-domain: GSC property format behavior — URL constructor treats it as valid with pathname', () => {
    // 'sc-domain:example.com' is parsed by the URL constructor as protocol='sc-domain:' with
    // pathname='example.com'. The function returns 'example.com' (not null).
    // Callers that pass GSC property URLs (sc-domain:) should use extractGscPagePathname
    // only for page-level URLs, not property-level sc-domain: identifiers.
    expect(extractGscPagePathname('sc-domain:example.com')).toBe('example.com');
  });

  it('handles URL with trailing slash', () => {
    expect(extractGscPagePathname('https://example.com/category/')).toBe('/category/');
  });

  it('handles URL with subdirectory and query string', () => {
    expect(extractGscPagePathname('https://example.com/blog/post-slug?utm_source=google')).toBe('/blog/post-slug');
  });

  it('handles http (non-https) URLs', () => {
    expect(extractGscPagePathname('http://example.com/page')).toBe('/page');
  });

  it('handles URL with port', () => {
    expect(extractGscPagePathname('https://example.com:8080/page')).toBe('/page');
  });
});

// ─── findTopDroppedPage ─────────────────────────────────────────────────────

describe('findTopDroppedPage', () => {
  type Row = { keys: string[]; clicks: number };

  it('returns null when both arrays are empty', () => {
    expect(findTopDroppedPage([], [])).toBeNull();
  });

  it('returns null when no page had a drop', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    const prev: Row[] = [{ keys: ['https://a.com/p1'], clicks: 50 }];
    // current > prev: no drop
    expect(findTopDroppedPage(cur, prev)).toBeNull();
  });

  it('returns null when current equals previous (no change)', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    const prev: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    expect(findTopDroppedPage(cur, prev)).toBeNull();
  });

  it('identifies the page with the largest click drop', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 10 },
      { keys: ['https://a.com/p2'], clicks: 5 },
    ];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 100 }, // drop = 90
      { keys: ['https://a.com/p2'], clicks: 50 },  // drop = 45
    ];
    expect(findTopDroppedPage(cur, prev)).toBe('https://a.com/p1');
  });

  it('picks the second page when it has the larger drop', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 80 },
      { keys: ['https://a.com/p2'], clicks: 5 },
    ];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 100 }, // drop = 20
      { keys: ['https://a.com/p2'], clicks: 200 }, // drop = 195
    ];
    expect(findTopDroppedPage(cur, prev)).toBe('https://a.com/p2');
  });

  it('detects pages that vanished entirely from current period', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 10 }];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 10 },
      { keys: ['https://a.com/vanished'], clicks: 500 }, // not in cur
    ];
    // p1 drop = 0, vanished has prevClicks=500 which > maxDrop=0
    expect(findTopDroppedPage(cur, prev)).toBe('https://a.com/vanished');
  });

  it('vanished page vs inline drop — returns whichever is larger', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 50 }];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 100 },     // drop = 50
      { keys: ['https://a.com/vanished'], clicks: 200 }, // disappeared = 200
    ];
    expect(findTopDroppedPage(cur, prev)).toBe('https://a.com/vanished');
  });

  it('handles pages in current that have no previous data (treated as 0 prev → positive spike, not drop)', () => {
    const cur: Row[] = [{ keys: ['https://a.com/new'], clicks: 100 }];
    const prev: Row[] = [];
    // new page has prev=0, drop = 0 - 100 = -100 (negative, not a drop)
    expect(findTopDroppedPage(cur, prev)).toBeNull();
  });

  it('handles single-item arrays', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 50 }];
    const prev: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    expect(findTopDroppedPage(cur, prev)).toBe('https://a.com/p1');
  });

  it('treats pages only in prev with clicks > maxDrop as candidates', () => {
    // cur is empty, prev has pages — maxDrop starts at 0
    const cur: Row[] = [];
    const prev: Row[] = [
      { keys: ['https://a.com/gone1'], clicks: 50 },
      { keys: ['https://a.com/gone2'], clicks: 200 },
    ];
    // Both pages vanished; gone2 has more clicks → wins
    expect(findTopDroppedPage(cur, prev)).toBe('https://a.com/gone2');
  });
});

// ─── findTopSpikedPage ──────────────────────────────────────────────────────

describe('findTopSpikedPage', () => {
  type Row = { keys: string[]; clicks: number };

  it('returns null when current rows are empty', () => {
    const prev: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    expect(findTopSpikedPage([], prev)).toBeNull();
  });

  it('returns null when no page had an increase', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 50 }];
    const prev: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    // cur < prev: no spike
    expect(findTopSpikedPage(cur, prev)).toBeNull();
  });

  it('returns null when current equals previous', () => {
    const cur: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    const prev: Row[] = [{ keys: ['https://a.com/p1'], clicks: 100 }];
    expect(findTopSpikedPage(cur, prev)).toBeNull();
  });

  it('identifies the page with the largest click spike', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 200 },
      { keys: ['https://a.com/p2'], clicks: 50 },
    ];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 10 },  // spike = 190
      { keys: ['https://a.com/p2'], clicks: 30 },  // spike = 20
    ];
    expect(findTopSpikedPage(cur, prev)).toBe('https://a.com/p1');
  });

  it('picks the second page when it has the larger spike', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 120 },
      { keys: ['https://a.com/p2'], clicks: 500 },
    ];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 100 }, // spike = 20
      { keys: ['https://a.com/p2'], clicks: 100 }, // spike = 400
    ];
    expect(findTopSpikedPage(cur, prev)).toBe('https://a.com/p2');
  });

  it('treats new pages with no previous as having prev=0 (spike = current clicks)', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/new'], clicks: 300 }, // spike = 300 - 0
      { keys: ['https://a.com/old'], clicks: 50 },
    ];
    const prev: Row[] = [{ keys: ['https://a.com/old'], clicks: 10 }]; // spike = 40
    expect(findTopSpikedPage(cur, prev)).toBe('https://a.com/new');
  });

  it('handles single page with spike', () => {
    const cur: Row[] = [{ keys: ['https://a.com/viral'], clicks: 10000 }];
    const prev: Row[] = [{ keys: ['https://a.com/viral'], clicks: 100 }];
    expect(findTopSpikedPage(cur, prev)).toBe('https://a.com/viral');
  });

  it('returns null when both arrays are empty', () => {
    expect(findTopSpikedPage([], [])).toBeNull();
  });

  it('handles prev being empty (all current pages are new)', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 50 },
      { keys: ['https://a.com/p2'], clicks: 200 },
    ];
    // p2 has the higher spike (200 > 50)
    expect(findTopSpikedPage(cur, [])).toBe('https://a.com/p2');
  });
});

// ─── gscDateRange ───────────────────────────────────────────────────────────

describe('gscDateRange', () => {
  it('returns custom dateRange when provided', () => {
    const custom = { startDate: '2024-01-01', endDate: '2024-01-31' };
    const result = gscDateRange(28, custom);
    expect(result.startDate).toBe('2024-01-01');
    expect(result.endDate).toBe('2024-01-31');
  });

  it('returns ISO date strings when no custom range provided', () => {
    const result = gscDateRange(28);
    expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('endDate is approximately 3 days before today (GSC delay)', () => {
    const result = gscDateRange(28);
    const today = new Date();
    const endDate = new Date(result.endDate);
    const diff = Math.round((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
    // Should be 3 days (±1 for timezone boundary conditions)
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(4);
  });

  it('startDate and endDate cover an inclusive `days` window', () => {
    const result = gscDateRange(28);
    const startDate = new Date(result.startDate);
    const endDate = new Date(result.endDate);
    const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diff).toBe(27);
  });

  it('respects different day counts', () => {
    const result90 = gscDateRange(90);
    const startDate = new Date(result90.startDate);
    const endDate = new Date(result90.endDate);
    const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diff).toBe(89);
  });

  it('preserves exact day spans across DST boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));

    const result = gscDateRange(90);
    const startDate = new Date(`${result.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${result.endDate}T00:00:00.000Z`);
    const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    expect(diff).toBe(89);
  });

  it('startDate is before endDate', () => {
    const result = gscDateRange(28);
    expect(result.startDate < result.endDate).toBe(true);
  });

  it('ignores days parameter when custom dateRange is provided', () => {
    const custom = { startDate: '2020-01-01', endDate: '2020-12-31' };
    const result = gscDateRange(7, custom);
    // Should use custom range, not 7-day range
    expect(result.startDate).toBe('2020-01-01');
    expect(result.endDate).toBe('2020-12-31');
  });
});

// ─── paginateGscQuery — additional edge cases ────────────────────────────────

describe('paginateGscQuery — additional edge cases', () => {
  it('trims results to exactly maxRows when full pages exceed limit', async () => {
    // Each page returns 500, maxRows = 750 → should return exactly 750
    const fetchPage = async (_startRow: number) =>
      Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const results = await paginateGscQuery(fetchPage, { maxRows: 750, pageSize: 500 });
    expect(results).toHaveLength(750);
  });

  it('handles pageSize larger than maxRows — fetches one page and slices', async () => {
    const fetchPage = async (_startRow: number) =>
      Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const results = await paginateGscQuery(fetchPage, { maxRows: 50, pageSize: 500 });
    expect(results).toHaveLength(50);
  });

  it('passes correct startRow and rowLimit to each page fetch', async () => {
    const calls: Array<{ startRow: number; rowLimit: number }> = [];
    const fetchPage = async (startRow: number, rowLimit: number) => {
      calls.push({ startRow, rowLimit });
      if (startRow === 0) return Array.from({ length: rowLimit }, (_, i) => ({ id: i }));
      return [];
    };
    await paginateGscQuery(fetchPage, { maxRows: 1000, pageSize: 500 });
    expect(calls[0]).toEqual({ startRow: 0, rowLimit: 500 });
    expect(calls[1]).toEqual({ startRow: 500, rowLimit: 500 });
  });

  it('stops early when a page returns fewer items than pageSize', async () => {
    let callCount = 0;
    const fetchPage = async (startRow: number) => {
      callCount++;
      if (startRow === 0) return Array.from({ length: 300 }, (_, i) => ({ id: i }));
      return [];
    };
    const results = await paginateGscQuery(fetchPage, { maxRows: 2000, pageSize: 500 });
    expect(results).toHaveLength(300);
    expect(callCount).toBe(1); // Stopped after first partial page
  });

  it('uses defaults (maxRows=2000, pageSize=500) when opts is undefined', async () => {
    const calls: number[] = [];
    const fetchPage = async (startRow: number) => {
      calls.push(startRow);
      // Return empty on second call to stop
      if (startRow === 0) return Array.from({ length: 500 }, (_, i) => ({ id: i }));
      return [];
    };
    await paginateGscQuery(fetchPage);
    expect(calls).toContain(0);
    expect(calls).toContain(500);
  });
});

// ─── CTR division-by-zero contract ──────────────────────────────────────────
// The source file computes CTR as: +(r.ctr * 100).toFixed(1)
// The raw GSC `ctr` field is already a ratio (e.g. 0 when impressions=0).
// Verify formatGscCtr handles the 0-impressions edge case safely.

describe('formatGscCtr — zero impressions contract', () => {
  it('formatGscCtr(0) returns 0, not NaN or Infinity', () => {
    const result = formatGscCtr(0);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(0);
  });

  it('formatGscCtr never returns NaN for any finite input', () => {
    [0, 0.001, 0.5, 1.0].forEach(input => {
      expect(Number.isNaN(formatGscCtr(input))).toBe(false);
    });
  });
});

// ─── computePercentChange — symmetry and edge cases ─────────────────────────

describe('computePercentChange — symmetry and boundary cases', () => {
  it('is asymmetric: gain from 100→200 is +100%, loss from 200→100 is -50%', () => {
    expect(computePercentChange(200, 100)).toBe(100.0);
    expect(computePercentChange(100, 200)).toBe(-50.0);
  });

  it('returns 100 (not Infinity) when previous=0 and current=1', () => {
    const result = computePercentChange(1, 0);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(100);
  });

  it('returns 0 (not NaN) when both are 0', () => {
    const result = computePercentChange(0, 0);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });

  it('handles decimal inputs correctly', () => {
    // (6.3 - 5.0) / 5.0 * 100 = 26.0
    expect(computePercentChange(6.3, 5.0)).toBe(26.0);
  });
});

// ─── extractGscPagePathname — URL edge cases ─────────────────────────────────

describe('extractGscPagePathname — URL edge cases', () => {
  it('handles URLs with encoded characters in the path', () => {
    // URL constructor decodes the path
    const result = extractGscPagePathname('https://example.com/blog/hello%20world');
    expect(result).toBe('/blog/hello%20world');
  });

  it('strips query string from URLs (only returns path)', () => {
    expect(extractGscPagePathname('https://example.com/page?a=1&b=2')).toBe('/page');
  });

  it('strips fragment from URLs', () => {
    expect(extractGscPagePathname('https://example.com/page#anchor')).toBe('/page');
  });

  it('handles deeply nested paths', () => {
    expect(extractGscPagePathname('https://example.com/a/b/c/d/e')).toBe('/a/b/c/d/e');
  });

  it('returns / for bare domain URL', () => {
    expect(extractGscPagePathname('https://example.com')).toBe('/');
  });

  it('handles path-only input with leading slash passthrough', () => {
    expect(extractGscPagePathname('/seo-services')).toBe('/seo-services');
  });

  it('returns null for plain word without slash (not a valid URL)', () => {
    expect(extractGscPagePathname('seo-services')).toBeNull();
  });
});

// ─── findTopDroppedPage — tie-breaking behavior ──────────────────────────────

describe('findTopDroppedPage — tie-breaking and ordering', () => {
  type Row = { keys: string[]; clicks: number };

  it('returns the first encountered page when two pages have the same drop (tie-break by order)', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 0 },
      { keys: ['https://a.com/p2'], clicks: 0 },
    ];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 100 }, // drop = 100
      { keys: ['https://a.com/p2'], clicks: 100 }, // drop = 100 (tied)
    ];
    // The loop uses strict >, so first occurrence wins when tied
    const result = findTopDroppedPage(cur, prev);
    expect(result).toBe('https://a.com/p1');
  });

  it('handles many pages efficiently', () => {
    const n = 1000;
    const cur: Row[] = Array.from({ length: n }, (_, i) => ({
      keys: [`https://a.com/p${i}`],
      clicks: i,
    }));
    const prev: Row[] = Array.from({ length: n }, (_, i) => ({
      keys: [`https://a.com/p${i}`],
      clicks: i * 2, // All pages dropped by 50%
    }));
    // p999 has the largest absolute drop: 999 - 1998 = -999 → drop = 999
    const result = findTopDroppedPage(cur, prev);
    expect(result).toBe('https://a.com/p999');
  });
});

// ─── findTopSpikedPage — tie-breaking behavior ───────────────────────────────

describe('findTopSpikedPage — tie-breaking and ordering', () => {
  type Row = { keys: string[]; clicks: number };

  it('returns the first encountered page when two pages have the same spike (tie-break by order)', () => {
    const cur: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 200 },
      { keys: ['https://a.com/p2'], clicks: 200 },
    ];
    const prev: Row[] = [
      { keys: ['https://a.com/p1'], clicks: 100 }, // spike = 100
      { keys: ['https://a.com/p2'], clicks: 100 }, // spike = 100 (tied)
    ];
    const result = findTopSpikedPage(cur, prev);
    expect(result).toBe('https://a.com/p1');
  });

  it('handles many pages efficiently', () => {
    const n = 500;
    const cur: Row[] = Array.from({ length: n }, (_, i) => ({
      keys: [`https://a.com/p${i}`],
      clicks: i * 3,
    }));
    const prev: Row[] = Array.from({ length: n }, (_, i) => ({
      keys: [`https://a.com/p${i}`],
      clicks: i,
    }));
    // p499 has the largest absolute spike: 499*3 - 499 = 998
    const result = findTopSpikedPage(cur, prev);
    expect(result).toBe('https://a.com/p499');
  });
});
