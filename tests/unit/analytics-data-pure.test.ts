/**
 * Unit tests for server/analytics-data.ts (Wave 23)
 *
 * analytics-data.ts is a thin adapter layer — each exported async function
 * delegates to a search-console.ts counterpart. These tests verify that:
 *   1. Each wrapper passes all required arguments to the underlying function.
 *   2. The optional dateRange parameter is forwarded when provided.
 *   3. The return value from the underlying function is passed through unchanged.
 *   4. Functions work correctly when dateRange is omitted (undefined).
 *   5. The CustomDateRange re-export is available.
 *
 * All search-console.ts functions are mocked — no network, no auth, no DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks must be hoisted before the module under test is imported ──────────

const mocks = vi.hoisted(() => ({
  getSearchOverview: vi.fn(),
  getPerformanceTrend: vi.fn(),
  getSearchDeviceBreakdown: vi.fn(),
  getSearchCountryBreakdown: vi.fn(),
  getSearchTypeBreakdown: vi.fn(),
  getSearchPeriodComparison: vi.fn(),
}));

vi.mock('../../server/search-console.js', () => ({
  getSearchOverview: mocks.getSearchOverview,
  getPerformanceTrend: mocks.getPerformanceTrend,
  getSearchDeviceBreakdown: mocks.getSearchDeviceBreakdown,
  getSearchCountryBreakdown: mocks.getSearchCountryBreakdown,
  getSearchTypeBreakdown: mocks.getSearchTypeBreakdown,
  getSearchPeriodComparison: mocks.getSearchPeriodComparison,
}));

vi.mock('../../server/google-analytics.js', () => ({
  // CustomDateRange is a type alias — no runtime export needed
}));

import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchDevices,
  fetchSearchCountries,
  fetchSearchTypes,
  fetchSearchComparison,
} from '../../server/analytics-data.js';
import type { CustomDateRange } from '../../server/analytics-data.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SITE_ID = 'site-123';
const GSC_URL = 'https://example.com/';
const DAYS = 28;
const DATE_RANGE: CustomDateRange = { startDate: '2026-01-01', endDate: '2026-01-28' };

const OVERVIEW_STUB = {
  clicks: 500,
  impressions: 10000,
  ctr: 5.0,
  position: 12.3,
  queries: [],
  pages: [],
};

const TREND_STUB = [{ date: '2026-01-01', clicks: 50, impressions: 900 }];
const DEVICES_STUB = [{ device: 'desktop', clicks: 300, impressions: 6000, ctr: 5.0, position: 10.0 }];
const COUNTRIES_STUB = [{ country: 'US', clicks: 400, impressions: 8000, ctr: 5.0, position: 11.0 }];
const TYPES_STUB = [{ searchType: 'web', clicks: 500, impressions: 10000, ctr: 5.0, position: 12.3 }];
const COMPARISON_STUB = { currentClicks: 500, previousClicks: 400, clicksChange: 25 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSearchOverview.mockResolvedValue(OVERVIEW_STUB);
  mocks.getPerformanceTrend.mockResolvedValue(TREND_STUB);
  mocks.getSearchDeviceBreakdown.mockResolvedValue(DEVICES_STUB);
  mocks.getSearchCountryBreakdown.mockResolvedValue(COUNTRIES_STUB);
  mocks.getSearchTypeBreakdown.mockResolvedValue(TYPES_STUB);
  mocks.getSearchPeriodComparison.mockResolvedValue(COMPARISON_STUB);
});

// ── fetchSearchOverview ───────────────────────────────────────────────────────

describe('fetchSearchOverview', () => {
  it('calls getSearchOverview with siteId, gscUrl, days, empty filters object, and undefined dateRange', async () => {
    await fetchSearchOverview(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchOverview).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, {}, undefined);
  });

  it('forwards dateRange when provided', async () => {
    await fetchSearchOverview(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
    expect(mocks.getSearchOverview).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, {}, DATE_RANGE);
  });

  it('returns the value from getSearchOverview unchanged', async () => {
    const result = await fetchSearchOverview(SITE_ID, GSC_URL, DAYS);
    expect(result).toBe(OVERVIEW_STUB);
  });

  it('called exactly once per invocation', async () => {
    await fetchSearchOverview(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchOverview).toHaveBeenCalledTimes(1);
  });
});

// ── fetchPerformanceTrend ─────────────────────────────────────────────────────

describe('fetchPerformanceTrend', () => {
  it('calls getPerformanceTrend with siteId, gscUrl, days, and undefined dateRange', async () => {
    await fetchPerformanceTrend(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getPerformanceTrend).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, undefined);
  });

  it('forwards dateRange when provided', async () => {
    await fetchPerformanceTrend(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
    expect(mocks.getPerformanceTrend).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
  });

  it('returns the value from getPerformanceTrend unchanged', async () => {
    const result = await fetchPerformanceTrend(SITE_ID, GSC_URL, DAYS);
    expect(result).toBe(TREND_STUB);
  });

  it('passes through different days values', async () => {
    await fetchPerformanceTrend(SITE_ID, GSC_URL, 90);
    expect(mocks.getPerformanceTrend).toHaveBeenCalledWith(SITE_ID, GSC_URL, 90, undefined);
  });
});

// ── fetchSearchDevices ────────────────────────────────────────────────────────

describe('fetchSearchDevices', () => {
  it('calls getSearchDeviceBreakdown with siteId, gscUrl, days, and undefined dateRange', async () => {
    await fetchSearchDevices(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchDeviceBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, undefined);
  });

  it('forwards dateRange when provided', async () => {
    await fetchSearchDevices(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
    expect(mocks.getSearchDeviceBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
  });

  it('returns the value from getSearchDeviceBreakdown unchanged', async () => {
    const result = await fetchSearchDevices(SITE_ID, GSC_URL, DAYS);
    expect(result).toBe(DEVICES_STUB);
  });

  it('does not call any other search-console function', async () => {
    await fetchSearchDevices(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchOverview).not.toHaveBeenCalled();
    expect(mocks.getSearchCountryBreakdown).not.toHaveBeenCalled();
  });
});

// ── fetchSearchCountries ──────────────────────────────────────────────────────

describe('fetchSearchCountries', () => {
  it('calls getSearchCountryBreakdown with siteId, gscUrl, days, limit, and undefined dateRange', async () => {
    await fetchSearchCountries(SITE_ID, GSC_URL, DAYS, 10);
    expect(mocks.getSearchCountryBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, 10, undefined);
  });

  it('forwards dateRange when provided', async () => {
    await fetchSearchCountries(SITE_ID, GSC_URL, DAYS, 5, DATE_RANGE);
    expect(mocks.getSearchCountryBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, 5, DATE_RANGE);
  });

  it('returns the value from getSearchCountryBreakdown unchanged', async () => {
    const result = await fetchSearchCountries(SITE_ID, GSC_URL, DAYS, 10);
    expect(result).toBe(COUNTRIES_STUB);
  });

  it('passes through different limit values', async () => {
    await fetchSearchCountries(SITE_ID, GSC_URL, DAYS, 25);
    expect(mocks.getSearchCountryBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, 25, undefined);
  });
});

// ── fetchSearchTypes ──────────────────────────────────────────────────────────

describe('fetchSearchTypes', () => {
  it('calls getSearchTypeBreakdown with siteId, gscUrl, days, and undefined dateRange', async () => {
    await fetchSearchTypes(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchTypeBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, undefined);
  });

  it('forwards dateRange when provided', async () => {
    await fetchSearchTypes(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
    expect(mocks.getSearchTypeBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
  });

  it('returns the value from getSearchTypeBreakdown unchanged', async () => {
    const result = await fetchSearchTypes(SITE_ID, GSC_URL, DAYS);
    expect(result).toBe(TYPES_STUB);
  });

  it('does not call any other search-console function', async () => {
    await fetchSearchTypes(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchPeriodComparison).not.toHaveBeenCalled();
    expect(mocks.getSearchDeviceBreakdown).not.toHaveBeenCalled();
  });
});

// ── fetchSearchComparison ─────────────────────────────────────────────────────

describe('fetchSearchComparison', () => {
  it('calls getSearchPeriodComparison with siteId, gscUrl, days, and undefined dateRange', async () => {
    await fetchSearchComparison(SITE_ID, GSC_URL, DAYS);
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, undefined);
  });

  it('forwards dateRange when provided', async () => {
    await fetchSearchComparison(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, DATE_RANGE);
  });

  it('returns the value from getSearchPeriodComparison unchanged', async () => {
    const result = await fetchSearchComparison(SITE_ID, GSC_URL, DAYS);
    expect(result).toBe(COMPARISON_STUB);
  });

  it('passes through different siteId and gscUrl values', async () => {
    await fetchSearchComparison('other-site', 'https://other.com/', 14);
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith('other-site', 'https://other.com/', 14, undefined);
  });
});

// ── CustomDateRange re-export ─────────────────────────────────────────────────

describe('CustomDateRange type re-export', () => {
  it('CustomDateRange with startDate and endDate is accepted by all wrappers', async () => {
    const dateRange: CustomDateRange = { startDate: '2026-03-01', endDate: '2026-03-31' };
    // Just verifying TypeScript accepts the shape and forwarding works
    await fetchSearchOverview(SITE_ID, GSC_URL, DAYS, dateRange);
    await fetchPerformanceTrend(SITE_ID, GSC_URL, DAYS, dateRange);
    await fetchSearchDevices(SITE_ID, GSC_URL, DAYS, dateRange);
    await fetchSearchCountries(SITE_ID, GSC_URL, DAYS, 10, dateRange);
    await fetchSearchTypes(SITE_ID, GSC_URL, DAYS, dateRange);
    await fetchSearchComparison(SITE_ID, GSC_URL, DAYS, dateRange);
    // All six wrappers were called exactly once with the date range forwarded
    expect(mocks.getSearchOverview).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, {}, dateRange);
    expect(mocks.getPerformanceTrend).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, dateRange);
    expect(mocks.getSearchDeviceBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, dateRange);
    expect(mocks.getSearchCountryBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, 10, dateRange);
    expect(mocks.getSearchTypeBreakdown).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, dateRange);
    expect(mocks.getSearchPeriodComparison).toHaveBeenCalledWith(SITE_ID, GSC_URL, DAYS, dateRange);
  });
});
