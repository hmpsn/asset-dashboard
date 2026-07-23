import { z } from 'zod';

export const MCP_CLIENT_ANALYTICS_LIMITS = {
  defaultDays: 28,
  maxDays: 366,
  maxSearchRows: 50,
  defaultGa4Rows: 10,
  maxGa4Rows: 50,
} as const;

const isoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

const clientGa4DateFields = {
  days: z.number().int().positive().max(MCP_CLIENT_ANALYTICS_LIMITS.maxDays).optional()
    .describe('Trailing reporting window in days. Defaults to 28 and caps at 366. Do not combine with start_date or end_date.'),
  start_date: isoDateSchema.optional()
    .describe('Explicit inclusive reporting start date. Must be paired with end_date.'),
  end_date: isoDateSchema.optional()
    .describe('Explicit inclusive reporting end date. Must be paired with start_date.'),
} as const;

const clientGa4LimitField = z.number()
  .int()
  .positive()
  .max(MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows)
  .optional()
  .describe('Maximum rows per returned ranking. Defaults to 10 and caps at 50.');

const mcpWorkspaceIdSchema = z.string()
  .min(1, 'workspace_id is required')
  .describe('The workspace ID this full-profile operation targets.');

export const getClientGa4CampaignPerformanceInputSchema = z.object({
  ...clientGa4DateFields,
  limit: clientGa4LimitField,
}).strict();

export const getClientGa4TrafficSourcesInputSchema = z.object({
  ...clientGa4DateFields,
  limit: clientGa4LimitField,
}).strict();

export const getClientGa4KeyEventsInputSchema = z.object({
  ...clientGa4DateFields,
  limit: clientGa4LimitField,
}).strict();

export const getClientGa4ContentPerformanceInputSchema = z.object({
  ...clientGa4DateFields,
  limit: clientGa4LimitField,
}).strict();

export const CLIENT_GA4_COMPARISON_MODES = [
  'previous_period',
  'year_over_year',
  'custom',
] as const;

export const getClientGa4PeriodComparisonInputSchema = z.object({
  ...clientGa4DateFields,
  comparison_mode: z.enum(CLIENT_GA4_COMPARISON_MODES).optional()
    .describe('Comparison authority. Defaults to previous_period. Use custom only with comparison_start_date and comparison_end_date.'),
  comparison_start_date: isoDateSchema.optional()
    .describe('Explicit inclusive comparison start date. Required only for custom comparison mode.'),
  comparison_end_date: isoDateSchema.optional()
    .describe('Explicit inclusive comparison end date. Required only for custom comparison mode.'),
}).strict();

export const getGa4CampaignPerformanceInputSchema =
  getClientGa4CampaignPerformanceInputSchema.extend({
    workspace_id: mcpWorkspaceIdSchema,
  }).strict();

export const getGa4PeriodComparisonInputSchema =
  getClientGa4PeriodComparisonInputSchema.extend({
    workspace_id: mcpWorkspaceIdSchema,
  }).strict();

export const getGa4TrafficSourcesInputSchema =
  getClientGa4TrafficSourcesInputSchema.extend({
    workspace_id: mcpWorkspaceIdSchema,
  }).strict();

export const getGa4KeyEventsInputSchema =
  getClientGa4KeyEventsInputSchema.extend({
    workspace_id: mcpWorkspaceIdSchema,
  }).strict();

export const getGa4ContentPerformanceInputSchema =
  getClientGa4ContentPerformanceInputSchema.extend({
    workspace_id: mcpWorkspaceIdSchema,
  }).strict();

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

const clientGa4DateRangeSchema = z.object({
  start: isoDateSchema,
  end: isoDateSchema,
}).strict();

const clientGa4SamplingSchema = z.object({
  samples_read_count: z.string()
    .regex(/^\d+$/u)
    .describe('GA4 sample numerator returned as a decimal integer string to preserve provider precision.'),
  sampling_space_size: z.string()
    .regex(/^\d+$/u)
    .describe('GA4 sampling-space denominator returned as a decimal integer string to preserve provider precision.'),
}).strict();

const clientGa4DataQualitySchema = z.object({
  requested_ranges: z.array(clientGa4DateRangeSchema).min(1).max(2),
  returned_rows: z.number().int().nonnegative(),
  results_truncated: z.boolean(),
  subject_to_thresholding: z.boolean().nullable()
    .describe('GA4 privacy-thresholding signal when the provider supplies it; null means unavailable.'),
  data_loss_from_other_row: z.boolean().nullable()
    .describe('GA4 high-cardinality data-loss signal when the provider supplies it; null means unavailable.'),
  sampling: z.array(clientGa4SamplingSchema).max(2)
    .describe('GA4 sampling metadata for the requested ranges; empty means no sampling metadata was returned.'),
  freshness_note: z.string(),
}).strict();

const clientGa4SessionMetricsSchema = z.object({
  sessions: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  engaged_sessions: z.number().int().nonnegative(),
  /** Already a percentage (e.g. 63.2 for 63.2%). Do NOT multiply by 100. */
  engagement_rate: z.number().finite()
    .describe('Engagement rate in percentage points; 63.2 means 63.2%.'),
  key_events: z.number().finite().nonnegative(),
}).strict();

const clientGa4OverviewMetricsSchema = z.object({
  users: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  page_views: z.number().int().nonnegative(),
  new_users: z.number().int().nonnegative(),
  avg_session_duration_seconds: z.number().finite().nonnegative(),
  /** Already a percentage (e.g. 32.1 for 32.1%). Do NOT multiply by 100. */
  bounce_rate: z.number().finite()
    .describe('Bounce rate in percentage points; 32.1 means 32.1%.'),
}).strict();

const clientGa4OverviewChangeSchema = z.object({
  users: z.number().finite(),
  sessions: z.number().finite(),
  page_views: z.number().finite(),
  new_users: z.number().finite(),
  avg_session_duration_seconds: z.number().finite(),
  bounce_rate_percentage_points: z.number().finite(),
}).strict();

const clientGa4OverviewRelativeChangeSchema = z.object({
  users: z.number().finite().nullable(),
  sessions: z.number().finite().nullable(),
  page_views: z.number().finite().nullable(),
  new_users: z.number().finite().nullable(),
  avg_session_duration_seconds: z.number().finite().nullable(),
  bounce_rate: z.number().finite().nullable(),
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

export const clientGa4CampaignPerformanceDataSchema = z.object({
  source: z.literal('google_analytics_4'),
  attribution_scope: z.literal('session_campaign'),
  date_range: clientGa4DateRangeSchema,
  campaigns: z.array(clientGa4SessionMetricsSchema.extend({
    campaign_name: z.string(),
  }).strict()).max(MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows),
  data_quality: clientGa4DataQualitySchema,
}).strict();

export const clientGa4CampaignPerformanceOutputSchema = z.object({
  data: clientGa4CampaignPerformanceDataSchema,
}).strict();

export const clientGa4TrafficSourcesDataSchema = z.object({
  source: z.literal('google_analytics_4'),
  attribution_scope: z.literal('session_source_medium'),
  date_range: clientGa4DateRangeSchema,
  traffic_sources: z.array(clientGa4SessionMetricsSchema.extend({
    source_name: z.string(),
    medium: z.string(),
  }).strict()).max(MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows),
  data_quality: clientGa4DataQualitySchema,
}).strict();

export const clientGa4TrafficSourcesOutputSchema = z.object({
  data: clientGa4TrafficSourcesDataSchema,
}).strict();

const configuredClientGa4EventSchema = z.object({
  event_name: z.string().refine(
    value => value !== 'click',
    'Generic click events require destination-filter authority.',
  ),
  display_name: z.string(),
  mapping_status: z.literal('configured'),
}).strict();

const unmappedClientGa4EventSchema = z.object({
  event_name: z.string(),
  display_name: z.null(),
  mapping_status: z.literal('unmapped'),
}).strict();

const attentionClientGa4EventSchema = z.object({
  event_name: z.literal('click'),
  display_name: z.null(),
  mapping_status: z.literal('needs_attention'),
  attention: z.object({
    code: z.literal('generic_click_requires_url_filter'),
    message: z.string(),
  }).strict(),
}).strict();

export const clientGa4EventMappingSchema = z.discriminatedUnion('mapping_status', [
  configuredClientGa4EventSchema,
  unmappedClientGa4EventSchema,
  attentionClientGa4EventSchema,
]);

export const clientGa4KeyEventsDataSchema = z.object({
  source: z.literal('google_analytics_4'),
  date_range: clientGa4DateRangeSchema,
  events: z.array(z.object({
    mapping: clientGa4EventMappingSchema,
    key_events: z.number().finite().nonnegative(),
    users: z.number().int().nonnegative(),
    /** Already a percentage (e.g. 4.2 for 4.2%). Do NOT multiply by 100. */
    user_rate: z.number().finite().min(0).max(100)
      .describe('Share of period users who triggered the key event, in percentage points.'),
  }).strict()).max(MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows),
  data_quality: clientGa4DataQualitySchema,
}).strict();

export const clientGa4KeyEventsOutputSchema = z.object({
  data: clientGa4KeyEventsDataSchema,
}).strict();

export const clientGa4ContentPerformanceDataSchema = z.object({
  source: z.literal('google_analytics_4'),
  date_range: clientGa4DateRangeSchema,
  pages_by_views: z.array(z.object({
    page_path: z.string()
      .describe('Page path with query and fragment components removed.'),
    views: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    avg_engagement_time_seconds: z.number().finite().nonnegative(),
  }).strict()).max(MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows),
  landing_pages_by_sessions: z.array(z.object({
    landing_page: z.string()
      .describe('Landing-page path with query and fragment components removed.'),
    sessions: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    engaged_sessions: z.number().int().nonnegative(),
    /** Already a percentage (e.g. 63.2 for 63.2%). Do NOT multiply by 100. */
    engagement_rate: z.number().finite()
      .describe('Engagement rate in percentage points; 63.2 means 63.2%.'),
    key_events: z.number().finite().nonnegative(),
  }).strict()).max(MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows),
  data_quality: z.object({
    pages_by_views: clientGa4DataQualitySchema,
    landing_pages_by_sessions: clientGa4DataQualitySchema,
  }).strict(),
}).strict();

export const clientGa4ContentPerformanceOutputSchema = z.object({
  data: clientGa4ContentPerformanceDataSchema,
}).strict();

export const clientGa4PeriodComparisonDataSchema = z.object({
  source: z.literal('google_analytics_4'),
  comparison_mode: z.enum(CLIENT_GA4_COMPARISON_MODES),
  current_range: clientGa4DateRangeSchema,
  comparison_range: clientGa4DateRangeSchema,
  current: clientGa4OverviewMetricsSchema,
  comparison: clientGa4OverviewMetricsSchema,
  change: clientGa4OverviewChangeSchema,
  change_percent: clientGa4OverviewRelativeChangeSchema,
  data_quality: clientGa4DataQualitySchema,
}).strict();

export const clientGa4PeriodComparisonOutputSchema = z.object({
  data: clientGa4PeriodComparisonDataSchema,
}).strict();

export type GetClientSearchPerformanceInput =
  z.infer<typeof getClientSearchPerformanceInputSchema>;
export type ClientSearchPerformanceData =
  z.infer<typeof clientSearchPerformanceDataSchema>;
export type GetClientGa4CampaignPerformanceInput =
  z.infer<typeof getClientGa4CampaignPerformanceInputSchema>;
export type GetClientGa4PeriodComparisonInput =
  z.infer<typeof getClientGa4PeriodComparisonInputSchema>;
export type GetClientGa4TrafficSourcesInput =
  z.infer<typeof getClientGa4TrafficSourcesInputSchema>;
export type GetClientGa4KeyEventsInput =
  z.infer<typeof getClientGa4KeyEventsInputSchema>;
export type GetClientGa4ContentPerformanceInput =
  z.infer<typeof getClientGa4ContentPerformanceInputSchema>;
export type ClientGa4EventMapping =
  z.infer<typeof clientGa4EventMappingSchema>;
