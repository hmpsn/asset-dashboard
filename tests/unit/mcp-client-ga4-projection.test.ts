import { describe, expect, it } from 'vitest';
import { clientGa4CampaignPerformanceDataSchema } from '../../shared/types/mcp-client-analytics.js';
import {
  ClientGa4ProjectionError,
  mapClientGa4Event,
  percentageDelta,
  projectClientGa4DataQuality,
  resolveClientGa4ComparisonRange,
  resolveClientGa4DateRange,
  sanitizeClientGa4UrlOrPath,
} from '../../server/mcp/client-ga4-projection.js';

const NOW = new Date('2026-07-23T15:30:00.000Z');
const CURRENT = { start: '2026-07-01', end: '2026-07-28' };

function expectProjectionError(
  callback: () => unknown,
  code: ConstructorParameters<typeof ClientGa4ProjectionError>[0],
): void {
  expect(callback).toThrow(ClientGa4ProjectionError);
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('resolveClientGa4DateRange', () => {
  it('defaults to the inclusive 28 UTC days through yesterday', () => {
    expect(resolveClientGa4DateRange({}, NOW)).toEqual({
      start: '2026-06-25',
      end: '2026-07-22',
    });
  });

  it('uses UTC rather than the local timezone and makes a one-day range yesterday', () => {
    expect(resolveClientGa4DateRange({ days: 1 }, new Date('2026-01-01T00:30:00-07:00'))).toEqual({
      start: '2025-12-31',
      end: '2025-12-31',
    });
  });

  it('honors exact paired dates including leap day', () => {
    expect(resolveClientGa4DateRange({ start_date: '2024-02-29', end_date: '2024-03-01' }, NOW)).toEqual({
      start: '2024-02-29',
      end: '2024-03-01',
    });
  });

  it('accepts exactly 366 inclusive days', () => {
    expect(resolveClientGa4DateRange({ start_date: '2024-01-01', end_date: '2024-12-31' })).toEqual({
      start: '2024-01-01', end: '2024-12-31',
    });
  });

  it('rejects partial, mixed, invalid, inverted, overlong, and invalid day inputs', () => {
    expectProjectionError(() => resolveClientGa4DateRange({ start_date: '2026-01-01' }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ days: 7, start_date: '2026-01-01', end_date: '2026-01-07' }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ start_date: '2026-02-29', end_date: '2026-03-01' }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ start_date: '2026-03-02', end_date: '2026-03-01' }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ start_date: '2024-01-01', end_date: '2025-01-01' }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ days: 0 }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ days: 366.5 }), 'invalid_date_range');
    expectProjectionError(() => resolveClientGa4DateRange({ days: 367 }), 'invalid_date_range');
  });
});

describe('resolveClientGa4ComparisonRange', () => {
  it('defaults to the immediately preceding equal-length range', () => {
    expect(resolveClientGa4ComparisonRange({}, CURRENT)).toEqual({
      comparisonMode: 'previous_period',
      comparisonRange: { start: '2026-06-03', end: '2026-06-30' },
    });
  });

  it('shifts year-over-year dates by calendar year and clamps leap day', () => {
    expect(resolveClientGa4ComparisonRange({ comparison_mode: 'year_over_year' }, {
      start: '2024-02-29', end: '2024-03-02',
    })).toEqual({
      comparisonMode: 'year_over_year',
      comparisonRange: { start: '2023-02-28', end: '2023-03-02' },
    });
  });

  it('rejects a derived year-over-year range that expands beyond 366 inclusive days', () => {
    expectProjectionError(() => resolveClientGa4ComparisonRange(
      { comparison_mode: 'year_over_year' },
      { start: '2024-03-01', end: '2025-03-01' },
    ), 'invalid_comparison_range');
  });

  it('requires an equal-length bounded custom comparison', () => {
    expect(resolveClientGa4ComparisonRange({
      comparison_mode: 'custom',
      comparison_start_date: '2026-06-03',
      comparison_end_date: '2026-06-30',
    }, CURRENT)).toEqual({
      comparisonMode: 'custom',
      comparisonRange: { start: '2026-06-03', end: '2026-06-30' },
    });
  });

  it('rejects invalid current/custom ranges and custom dates for another mode', () => {
    expectProjectionError(() => resolveClientGa4ComparisonRange({ comparison_mode: 'custom' }, CURRENT), 'invalid_comparison_range');
    expectProjectionError(() => resolveClientGa4ComparisonRange({ comparison_mode: 'custom', comparison_start_date: '2026-06-01' }, CURRENT), 'invalid_comparison_range');
    expectProjectionError(() => resolveClientGa4ComparisonRange({ comparison_mode: 'custom', comparison_start_date: '2026-06-01', comparison_end_date: '2026-06-27' }, CURRENT), 'invalid_comparison_range');
    expectProjectionError(() => resolveClientGa4ComparisonRange({ comparison_start_date: '2026-06-03', comparison_end_date: '2026-06-30' }, CURRENT), 'invalid_comparison_range');
    expectProjectionError(() => resolveClientGa4ComparisonRange({}, { start: '2026-07-29', end: '2026-07-28' }), 'invalid_comparison_range');
  });
});

describe('percentageDelta', () => {
  it('computes relative changes and returns null for zero or non-finite baselines', () => {
    expect(percentageDelta(125, 100)).toBe(25);
    expect(percentageDelta(75, 100)).toBe(-25);
    expect(percentageDelta(4, 0)).toBeNull();
    expect(percentageDelta(Number.NaN, 4)).toBeNull();
    expect(percentageDelta(4, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('sanitizeClientGa4UrlOrPath', () => {
  it('removes credentials, query strings, fragments, and control characters from absolute URLs', () => {
    expect(sanitizeClientGa4UrlOrPath('https://user:password@example.com/path\u0000?q=private#fragment')).toBe('https://example.com/path');
  });

  it('sanitizes protocol-relative and ordinary path values without inventing an origin', () => {
    expect(sanitizeClientGa4UrlOrPath('//user:password@example.com/path?q=private#fragment')).toBe('//example.com/path');
    expect(sanitizeClientGa4UrlOrPath('/pricing\u0007?utm=private#section')).toBe('/pricing');
    expect(sanitizeClientGa4UrlOrPath('not a url?query#fragment')).toBe('not a url');
  });
});

describe('mapClientGa4Event', () => {
  const config = [
    { eventName: 'form_submit', displayName: 'Form submissions', pinned: true },
    { eventName: 'phone_call', displayName: 'Phone calls', pinned: false },
  ];

  it('maps only exact pinned event names', () => {
    expect(mapClientGa4Event('form_submit', config)).toEqual({
      event_name: 'form_submit', display_name: 'Form submissions', mapping_status: 'configured',
    });
    expect(mapClientGa4Event('FORM_SUBMIT', config)).toEqual({
      event_name: 'FORM_SUBMIT', display_name: null, mapping_status: 'unmapped',
    });
    expect(mapClientGa4Event('phone_call', config)).toEqual({
      event_name: 'phone_call', display_name: null, mapping_status: 'unmapped',
    });
  });

  it('always marks generic click as needing attention, even when it is pinned', () => {
    expect(mapClientGa4Event('click', [...config, {
      eventName: 'click', displayName: 'Outbound clicks', pinned: true,
    }])).toMatchObject({
      event_name: 'click',
      display_name: null,
      mapping_status: 'needs_attention',
      attention: { code: 'generic_click_requires_url_filter' },
    });
  });

  it('fails closed when duplicate pinned names carry conflicting labels', () => {
    expect(mapClientGa4Event('form_submit', [
      { eventName: 'form_submit', displayName: 'Form submissions', pinned: true },
      { eventName: 'form_submit', displayName: 'Leads', pinned: true },
    ])).toEqual({
      event_name: 'form_submit', display_name: null, mapping_status: 'unmapped',
    });
  });

  it('fails closed when duplicate pinned names happen to repeat the same label', () => {
    expect(mapClientGa4Event('form_submit', [
      { eventName: 'form_submit', displayName: 'Form submissions', pinned: true },
      { eventName: 'form_submit', displayName: 'Form submissions', pinned: true },
    ])).toEqual({
      event_name: 'form_submit', display_name: null, mapping_status: 'unmapped',
    });
  });
});

describe('projectClientGa4DataQuality', () => {
  const input = {
    requestedRanges: [CURRENT],
    returnedRowCount: 10,
    providerRowCount: 17,
    requestedLimit: 10,
    reportMetadata: {
      subjectToThresholding: true,
      dataLossFromOtherRow: false,
      samplingMetadatas: [{ samplesReadCount: '1000', samplingSpaceSize: '10000' }],
    },
    freshnessNote: 'GA4 data can be delayed.',
  };

  it('projects bounded, schema-compatible metadata and derives truncation from the provider total', () => {
    const dataQuality = projectClientGa4DataQuality(input);
    expect(dataQuality).toEqual({
      requested_ranges: [CURRENT],
      returned_rows: 10,
      results_truncated: true,
      subject_to_thresholding: true,
      data_loss_from_other_row: false,
      sampling: [{ samples_read_count: '1000', sampling_space_size: '10000' }],
      freshness_note: 'GA4 data can be delayed.',
    });
    expect(clientGa4CampaignPerformanceDataSchema.safeParse({
      source: 'google_analytics_4',
      attribution_scope: 'session_campaign',
      date_range: CURRENT,
      campaigns: [],
      data_quality: dataQuality,
    }).success).toBe(true);
  });

  it('uses null/empty safe defaults for absent provider metadata and does not infer truncation at the limit', () => {
    expect(projectClientGa4DataQuality({
      ...input,
      providerRowCount: 10,
      reportMetadata: undefined,
    })).toMatchObject({
      results_truncated: false,
      subject_to_thresholding: null,
      data_loss_from_other_row: null,
      sampling: [],
    });
  });

  it('rejects inconsistent or incompatible metadata rather than projecting plausible data', () => {
    expectProjectionError(() => projectClientGa4DataQuality({ ...input, returnedRowCount: 11 }), 'invalid_data_quality');
    expectProjectionError(() => projectClientGa4DataQuality({ ...input, providerRowCount: 9 }), 'invalid_data_quality');
    expectProjectionError(() => projectClientGa4DataQuality({ ...input, reportMetadata: { samplingMetadatas: [{}] } }), 'invalid_data_quality');
    expectProjectionError(() => projectClientGa4DataQuality({ ...input, requestedRanges: [] }), 'invalid_data_quality');
  });
});
