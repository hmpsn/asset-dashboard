import { z } from 'zod';

export const MCP_CLIENT_ANALYTICS_LIMITS = {
  defaultDays: 28,
  maxDays: 366,
  maxSearchRows: 50,
} as const;

const isoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * Client-profile inputs deliberately omit workspace identity. The authenticated
 * client credential is the sole workspace authority and the server injects it
 * only after rejecting caller-supplied workspace aliases.
 */
export const getClientSearchPerformanceInputSchema = z.object({
  days: z.number().int().positive().max(MCP_CLIENT_ANALYTICS_LIMITS.maxDays).optional()
    .describe('Trailing window in days. Defaults to 28 and caps at 366. Ignored when an exact date range is supplied.'),
  start_date: isoDateSchema.optional()
    .describe('Explicit inclusive start date. Must be paired with end_date.'),
  end_date: isoDateSchema.optional()
    .describe('Explicit inclusive end date. Must be paired with start_date.'),
  compare_previous: z.boolean().optional()
    .describe('Also return the immediately preceding equal-length comparison period.'),
}).strict();

const searchMetricRowSchema = z.object({
  clicks: z.number().finite()
    .describe('Google Search clicks as a count.'),
  impressions: z.number().finite()
    .describe('Google Search impressions as a count.'),
  /** Already a percentage (e.g. 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: z.number().finite()
    .describe('Click-through rate as percentage points (for example, 6.3 means 6.3%, not 0.063).'),
  position: z.number().finite()
    .describe('Average Google Search result position; a lower value is better.'),
}).strict();

const searchMetricAbsoluteChangeSchema = z.object({
  clicks: z.number().finite()
    .describe('Absolute change in click count: current minus previous.'),
  impressions: z.number().finite()
    .describe('Absolute change in impression count: current minus previous.'),
  ctr: z.number().finite()
    .describe('Absolute CTR change in percentage points: current minus previous.'),
  position: z.number().finite()
    .describe('Absolute average-position change: current minus previous; a negative value is improvement.'),
}).strict();

const searchMetricRelativeChangeSchema = z.object({
  clicks: z.number().finite()
    .describe('Relative change in clicks as a percentage (for example, 10 means 10%).'),
  impressions: z.number().finite()
    .describe('Relative change in impressions as a percentage (for example, 10 means 10%).'),
  ctr: z.number().finite()
    .describe('Relative change in CTR as a percentage, not percentage points.'),
  position: z.number().finite()
    .describe('Relative change in average position as a percentage; interpret with the absolute position change because lower position is better.'),
}).strict();

const searchQueryRowSchema = searchMetricRowSchema.extend({
  query: z.string(),
}).strict();

const searchPageRowSchema = searchMetricRowSchema.extend({
  /** Absolute URL or path with query and fragment components removed. */
  page: z.string(),
}).strict();

const searchTrendRowSchema = searchMetricRowSchema.extend({
  date: isoDateSchema,
}).strict();

const searchComparisonSchema = z.object({
  current: searchMetricRowSchema,
  previous: searchMetricRowSchema,
  change: searchMetricAbsoluteChangeSchema,
  changePercent: searchMetricRelativeChangeSchema,
}).strict();

export const clientSearchPerformanceDataSchema = z.object({
  source: z.literal('google_search_console'),
  date_range: z.object({
    start: isoDateSchema,
    end: isoDateSchema,
  }).strict(),
  totals: searchMetricRowSchema,
  top_queries: z.array(searchQueryRowSchema)
    .max(MCP_CLIENT_ANALYTICS_LIMITS.maxSearchRows),
  top_pages: z.array(searchPageRowSchema)
    .max(MCP_CLIENT_ANALYTICS_LIMITS.maxSearchRows),
  daily_trend: z.array(searchTrendRowSchema)
    .max(MCP_CLIENT_ANALYTICS_LIMITS.maxDays),
  period_comparison: searchComparisonSchema.nullable(),
  data_quality: z.object({
    returned_queries: z.number().int().nonnegative(),
    returned_pages: z.number().int().nonnegative(),
    query_results_truncated: z.boolean(),
    page_results_truncated: z.boolean(),
    freshness_note: z.string(),
  }).strict(),
}).strict();

export const clientSearchPerformanceOutputSchema = z.object({
  data: clientSearchPerformanceDataSchema,
}).strict();

export type GetClientSearchPerformanceInput =
  z.infer<typeof getClientSearchPerformanceInputSchema>;
export type ClientSearchPerformanceData =
  z.infer<typeof clientSearchPerformanceDataSchema>;
