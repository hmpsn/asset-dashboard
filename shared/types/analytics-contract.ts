export interface AnalyticsDateRange {
  startDate: string;
  endDate: string;
}

export type AnalyticsComparisonWindow =
  | 'previous_period'
  | 'year_over_year';

export type AnalyticsMetricValueFormat =
  | 'count'
  | 'percentage'
  | 'decimal'
  | 'currency'
  | 'duration_seconds';

export interface AnalyticsMetricContract {
  label: string;
  valueFormat: AnalyticsMetricValueFormat;
  description: string;
}

/**
 * Shared analytics display semantics.
 *
 * IMPORTANT: fields marked `percentage` are already percentages (e.g., `6.3`
 * for 6.3%). Do NOT multiply/divide by 100 in renderers.
 */
export const ANALYTICS_METRIC_CONTRACT: Record<string, AnalyticsMetricContract> = {
  gsc_clicks: {
    label: 'Clicks',
    valueFormat: 'count',
    description: 'Raw click count from Search Console.',
  },
  gsc_impressions: {
    label: 'Impressions',
    valueFormat: 'count',
    description: 'Raw impression count from Search Console.',
  },
  gsc_ctr: {
    label: 'CTR',
    valueFormat: 'percentage',
    description: 'Already a percentage from Search Console after normalization.',
  },
  gsc_avg_position: {
    label: 'Average Position',
    valueFormat: 'decimal',
    description: 'Average SERP position; lower is better.',
  },
  ga4_bounce_rate: {
    label: 'Bounce Rate',
    valueFormat: 'percentage',
    description: 'Already a percentage from GA4.',
  },
  ga4_new_user_percentage: {
    label: 'New User Percentage',
    valueFormat: 'percentage',
    description: 'Already a percentage derived from new users / total users.',
  },
  ga4_avg_session_duration: {
    label: 'Average Session Duration',
    valueFormat: 'duration_seconds',
    description: 'Duration in seconds.',
  },
};
