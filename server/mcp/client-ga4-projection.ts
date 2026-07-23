import {
  CLIENT_GA4_COMPARISON_MODES,
  MCP_CLIENT_ANALYTICS_LIMITS,
  type ClientGa4EventMapping,
} from '../../shared/types/mcp-client-analytics.js';

const MS_PER_UTC_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/gu;

export interface ClientGa4DateRange {
  start: string;
  end: string;
}

export interface ClientGa4DateRangeInput {
  days?: number;
  start_date?: string;
  end_date?: string;
}

export interface ClientGa4ComparisonInput extends ClientGa4DateRangeInput {
  comparison_mode?: typeof CLIENT_GA4_COMPARISON_MODES[number];
  comparison_start_date?: string;
  comparison_end_date?: string;
}

export interface ClientGa4EventConfigEntry {
  eventName: string;
  displayName: string;
  pinned: boolean;
}

export interface ClientGa4SamplingMetadata {
  samplesReadCount?: unknown;
  samplingSpaceSize?: unknown;
}

export interface ClientGa4ReportMetadata {
  subjectToThresholding?: unknown;
  dataLossFromOtherRow?: unknown;
  samplingMetadatas?: unknown;
}

export interface ClientGa4DataQualityInput {
  requestedRanges: readonly ClientGa4DateRange[];
  returnedRowCount: number;
  providerRowCount: number;
  requestedLimit: number;
  reportMetadata?: ClientGa4ReportMetadata | null;
  freshnessNote: string;
}

export interface ClientGa4DataQuality {
  requested_ranges: ClientGa4DateRange[];
  returned_rows: number;
  results_truncated: boolean;
  subject_to_thresholding: boolean | null;
  data_loss_from_other_row: boolean | null;
  sampling: Array<{
    samples_read_count: string;
    sampling_space_size: string;
  }>;
  freshness_note: string;
}

export type ClientGa4ProjectionErrorCode =
  | 'invalid_date_range'
  | 'invalid_comparison_range'
  | 'invalid_data_quality';

/** A deterministic, caller-safe error. MCP adapters must not expose its details verbatim. */
export class ClientGa4ProjectionError extends Error {
  readonly code: ClientGa4ProjectionErrorCode;

  constructor(
    code: ClientGa4ProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClientGa4ProjectionError';
    this.code = code;
  }
}

function projectionError(
  code: ClientGa4ProjectionErrorCode,
  message: string,
): never {
  throw new ClientGa4ProjectionError(code, message);
}

function parseExactUtcDate(value: string, code: ClientGa4ProjectionErrorCode): Date {
  if (!ISO_DATE.test(value)) {
    return projectionError(code, 'Dates must use valid YYYY-MM-DD calendar dates.');
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return projectionError(code, 'Dates must use valid YYYY-MM-DD calendar dates.');
  }
  return parsed;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_UTC_DAY);
}

function inclusiveDays(range: ClientGa4DateRange): number {
  const start = parseExactUtcDate(range.start, 'invalid_date_range');
  const end = parseExactUtcDate(range.end, 'invalid_date_range');
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_UTC_DAY) + 1;
}

function validateRange(
  startDate: string,
  endDate: string,
  code: ClientGa4ProjectionErrorCode,
): ClientGa4DateRange {
  const start = parseExactUtcDate(startDate, code);
  const end = parseExactUtcDate(endDate, code);
  if (end.getTime() < start.getTime()) {
    return projectionError(code, 'The end date must be on or after the start date.');
  }

  const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_UTC_DAY) + 1;
  if (days > MCP_CLIENT_ANALYTICS_LIMITS.maxDays) {
    return projectionError(code, 'Inclusive date ranges cannot exceed 366 days.');
  }
  return { start: startDate, end: endDate };
}

function utcYesterday(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    return projectionError('invalid_date_range', 'The supplied current time is invalid.');
  }
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
  ));
}

/**
 * Resolve a client GA4 range in UTC. A trailing-day range is inclusive and
 * ends yesterday, so `days: 1` means yesterday only.
 */
export function resolveClientGa4DateRange(
  input: ClientGa4DateRangeInput,
  now: Date = new Date(),
): ClientGa4DateRange {
  const hasStart = input.start_date !== undefined;
  const hasEnd = input.end_date !== undefined;
  const hasExactRange = hasStart || hasEnd;

  if (hasStart !== hasEnd) {
    return projectionError('invalid_date_range', 'start_date and end_date must be supplied together.');
  }
  if (input.days !== undefined && hasExactRange) {
    return projectionError('invalid_date_range', 'days cannot be combined with an exact date range.');
  }
  if (hasExactRange) {
    return validateRange(
      input.start_date as string,
      input.end_date as string,
      'invalid_date_range',
    );
  }

  const days = input.days ?? MCP_CLIENT_ANALYTICS_LIMITS.defaultDays;
  if (!Number.isInteger(days) || days < 1 || days > MCP_CLIENT_ANALYTICS_LIMITS.maxDays) {
    return projectionError('invalid_date_range', 'days must be an integer between 1 and 366.');
  }

  const end = utcYesterday(now);
  return {
    start: toIsoDate(addUtcDays(end, -(days - 1))),
    end: toIsoDate(end),
  };
}

function shiftUtcCalendarYear(date: Date, years: number): Date {
  const targetYear = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const daysInTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, month, Math.min(day, daysInTargetMonth)));
}

/** Resolve the exact range for a GA4 period-comparison request. */
export function resolveClientGa4ComparisonRange(
  input: Pick<
    ClientGa4ComparisonInput,
    'comparison_mode' | 'comparison_start_date' | 'comparison_end_date'
  >,
  currentRange: ClientGa4DateRange,
): {
  comparisonMode: typeof CLIENT_GA4_COMPARISON_MODES[number];
  comparisonRange: ClientGa4DateRange;
} {
  // Revalidate the supplied current range so this helper is safe when used on
  // a range constructed outside resolveClientGa4DateRange.
  const validatedCurrent = validateRange(
    currentRange.start,
    currentRange.end,
    'invalid_comparison_range',
  );
  const mode = input.comparison_mode ?? 'previous_period';
  if (!(CLIENT_GA4_COMPARISON_MODES as readonly string[]).includes(mode)) {
    return projectionError('invalid_comparison_range', 'comparison_mode is not supported.');
  }

  const hasStart = input.comparison_start_date !== undefined;
  const hasEnd = input.comparison_end_date !== undefined;
  if (hasStart !== hasEnd) {
    return projectionError(
      'invalid_comparison_range',
      'comparison_start_date and comparison_end_date must be supplied together.',
    );
  }

  if (mode !== 'custom' && (hasStart || hasEnd)) {
    return projectionError(
      'invalid_comparison_range',
      'Explicit comparison dates are only valid with comparison_mode custom.',
    );
  }

  if (mode === 'custom') {
    if (!hasStart || !hasEnd) {
      return projectionError(
        'invalid_comparison_range',
        'Custom comparisons require comparison_start_date and comparison_end_date.',
      );
    }
    const comparisonRange = validateRange(
      input.comparison_start_date as string,
      input.comparison_end_date as string,
      'invalid_comparison_range',
    );
    if (inclusiveDays(comparisonRange) !== inclusiveDays(validatedCurrent)) {
      return projectionError(
        'invalid_comparison_range',
        'Custom comparison ranges must have the same inclusive length as the current range.',
      );
    }
    return { comparisonMode: mode, comparisonRange };
  }

  const start = parseExactUtcDate(validatedCurrent.start, 'invalid_comparison_range');
  const end = parseExactUtcDate(validatedCurrent.end, 'invalid_comparison_range');
  if (mode === 'year_over_year') {
    return {
      comparisonMode: mode,
      comparisonRange: {
        start: toIsoDate(shiftUtcCalendarYear(start, -1)),
        end: toIsoDate(shiftUtcCalendarYear(end, -1)),
      },
    };
  }

  const length = inclusiveDays(validatedCurrent);
  const comparisonEnd = addUtcDays(start, -1);
  return {
    comparisonMode: mode,
    comparisonRange: {
      start: toIsoDate(addUtcDays(comparisonEnd, -(length - 1))),
      end: toIsoDate(comparisonEnd),
    },
  };
}

/** Return the relative percentage change, or null when the baseline is unusable. */
export function percentageDelta(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

/**
 * Remove unsafe URL components from provider page values without inventing a
 * host or a path. Relative paths remain relative.
 */
export function sanitizeClientGa4UrlOrPath(value: string): string {
  const cleaned = value.replace(CONTROL_CHARACTERS, '');
  if (cleaned.length === 0) return '';

  const isProtocolRelative = cleaned.startsWith('//');
  try {
    const url = isProtocolRelative ? new URL(`https:${cleaned}`) : new URL(cleaned);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    if (isProtocolRelative) return `//${url.host}${url.pathname}`;
    return url.toString();
  } catch (err) {
    void err;
    return cleaned.split(/[?#]/u, 1)[0] ?? '';
  }
}

/** Alias retained for call sites that deal only in GA4 page dimensions. */
export const sanitizeClientGa4PagePath = sanitizeClientGa4UrlOrPath;

/**
 * Map only an exact pinned configuration. Generic clicks remain deliberately
 * ambiguous until a destination-filter authority exists.
 */
export function mapClientGa4Event(
  eventName: string,
  eventConfig: readonly ClientGa4EventConfigEntry[],
): ClientGa4EventMapping {
  if (eventName === 'click') {
    return {
      event_name: 'click',
      display_name: null,
      mapping_status: 'needs_attention',
      attention: {
        code: 'generic_click_requires_url_filter',
        message: 'Generic click events require destination-filter authority before they can be mapped.',
      },
    };
  }

  const pinnedMatches = eventConfig.filter(config => (
    config.pinned && config.eventName === eventName
  ));
  if (pinnedMatches.length !== 1) {
    return { event_name: eventName, display_name: null, mapping_status: 'unmapped' };
  }

  const configured = pinnedMatches[0];
  if (!configured) {
    return { event_name: eventName, display_name: null, mapping_status: 'unmapped' };
  }
  return {
    event_name: eventName,
    display_name: configured.displayName,
    mapping_status: 'configured',
  };
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function samplingProjection(metadata: unknown): ClientGa4DataQuality['sampling'] {
  if (metadata === undefined || metadata === null) return [];
  if (!Array.isArray(metadata) || metadata.length > 2) {
    return projectionError('invalid_data_quality', 'GA4 sampling metadata has an invalid shape.');
  }

  return metadata.map((item) => {
    if (!item || typeof item !== 'object') {
      return projectionError('invalid_data_quality', 'GA4 sampling metadata has an invalid entry.');
    }
    const raw = item as ClientGa4SamplingMetadata;
    if (
      typeof raw.samplesReadCount !== 'string'
      || !/^\d+$/u.test(raw.samplesReadCount)
      || typeof raw.samplingSpaceSize !== 'string'
      || !/^\d+$/u.test(raw.samplingSpaceSize)
    ) {
      return projectionError('invalid_data_quality', 'GA4 sampling metadata contains invalid counts.');
    }
    return {
      samples_read_count: raw.samplesReadCount,
      sampling_space_size: raw.samplingSpaceSize,
    };
  });
}

/**
 * Project only bounded GA4 report metadata. A provider total row count is
 * required so `results_truncated` is a fact, never a guess from a full page.
 */
export function projectClientGa4DataQuality(
  input: ClientGa4DataQualityInput,
): ClientGa4DataQuality {
  if (input.requestedRanges.length < 1 || input.requestedRanges.length > 2) {
    return projectionError('invalid_data_quality', 'GA4 data quality needs one or two requested ranges.');
  }
  const requestedRanges = input.requestedRanges.map(range => validateRange(
    range.start,
    range.end,
    'invalid_data_quality',
  ));
  if (
    !Number.isInteger(input.returnedRowCount)
    || input.returnedRowCount < 0
    || !Number.isInteger(input.providerRowCount)
    || input.providerRowCount < 0
    || !Number.isInteger(input.requestedLimit)
    || input.requestedLimit < 1
    || input.requestedLimit > MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows
  ) {
    return projectionError('invalid_data_quality', 'GA4 report row counts or limit are invalid.');
  }
  if (
    input.returnedRowCount > input.requestedLimit
    || input.returnedRowCount > input.providerRowCount
  ) {
    return projectionError('invalid_data_quality', 'GA4 returned row count is inconsistent with report metadata.');
  }
  if (typeof input.freshnessNote !== 'string') {
    return projectionError('invalid_data_quality', 'GA4 freshness metadata is invalid.');
  }

  const metadata = input.reportMetadata ?? undefined;
  return {
    requested_ranges: requestedRanges,
    returned_rows: input.returnedRowCount,
    results_truncated: input.providerRowCount > input.returnedRowCount,
    subject_to_thresholding: optionalBoolean(metadata?.subjectToThresholding),
    data_loss_from_other_row: optionalBoolean(metadata?.dataLossFromOtherRow),
    sampling: samplingProjection(metadata?.samplingMetadatas),
    freshness_note: input.freshnessNote,
  };
}
