import { describe, expect, it } from 'vitest';
import {
  CLIENT_GA4_COMPARISON_MODES,
  MCP_CLIENT_ANALYTICS_LIMITS,
  clientGa4ContentPerformanceOutputSchema,
  clientGa4EventMappingSchema,
  getClientGa4CampaignPerformanceInputSchema,
  getClientGa4PeriodComparisonInputSchema,
} from '../../shared/types/mcp-client-analytics.js';

describe('client GA4 MCP contracts', () => {
  it('bounds every public reporting window and row request', () => {
    expect(getClientGa4CampaignPerformanceInputSchema.safeParse({
      days: MCP_CLIENT_ANALYTICS_LIMITS.maxDays,
      limit: MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows,
    }).success).toBe(true);
    expect(getClientGa4CampaignPerformanceInputSchema.safeParse({
      days: MCP_CLIENT_ANALYTICS_LIMITS.maxDays + 1,
    }).success).toBe(false);
    expect(getClientGa4CampaignPerformanceInputSchema.safeParse({
      limit: MCP_CLIENT_ANALYTICS_LIMITS.maxGa4Rows + 1,
    }).success).toBe(false);
    expect(getClientGa4CampaignPerformanceInputSchema.safeParse({
      workspace_id: 'ws-forbidden',
    }).success).toBe(false);
  });

  it('accepts only the three explicit comparison modes', () => {
    expect(CLIENT_GA4_COMPARISON_MODES).toEqual([
      'previous_period',
      'year_over_year',
      'custom',
    ]);
    for (const comparison_mode of CLIENT_GA4_COMPARISON_MODES) {
      expect(getClientGa4PeriodComparisonInputSchema.safeParse({
        comparison_mode,
      }).success).toBe(true);
    }
    expect(getClientGa4PeriodComparisonInputSchema.safeParse({
      comparison_mode: 'automatic',
    }).success).toBe(false);
  });

  it('never assigns a business label to an unverified or generic click event', () => {
    expect(clientGa4EventMappingSchema.parse({
      event_name: 'form_submit',
      display_name: null,
      mapping_status: 'unmapped',
    })).toMatchObject({ display_name: null });
    expect(clientGa4EventMappingSchema.parse({
      event_name: 'click',
      display_name: null,
      mapping_status: 'needs_attention',
      attention: {
        code: 'generic_click_requires_url_filter',
        message: 'Destination authority is required.',
      },
    })).toMatchObject({ mapping_status: 'needs_attention' });
    expect(clientGa4EventMappingSchema.safeParse({
      event_name: 'click',
      display_name: 'Application clicks',
      mapping_status: 'configured',
    }).success).toBe(false);
  });

  it('keeps page-view and landing-session rankings structurally separate', () => {
    const baseQuality = {
      requested_ranges: [{ start: '2026-06-01', end: '2026-06-28' }],
      returned_rows: 0,
      results_truncated: false,
      subject_to_thresholding: null,
      data_loss_from_other_row: null,
      sampling: [],
      freshness_note: 'GA4 freshness varies.',
    };
    expect(clientGa4ContentPerformanceOutputSchema.safeParse({
      data: {
        source: 'google_analytics_4',
        date_range: { start: '2026-06-01', end: '2026-06-28' },
        pages_by_views: [],
        landing_pages_by_sessions: [],
        data_quality: {
          pages_by_views: baseQuality,
          landing_pages_by_sessions: baseQuality,
        },
      },
    }).success).toBe(true);
  });
});
