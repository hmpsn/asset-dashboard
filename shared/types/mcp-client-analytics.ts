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
  clicks: z.number().finite(),
  impressions: z.number().finite(),
  /** Already a percentage (e.g. 6.3 for 6.3%). Do NOT multiply by 100. */
  ctr: z.number().finite(),
  position: z.number().finite(),
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
  change: searchMetricRowSchema,
  changePercent: searchMetricRowSchema,
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
