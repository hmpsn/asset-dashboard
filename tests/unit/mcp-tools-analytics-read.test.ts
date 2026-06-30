import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/google-auth.js', () => ({
  isGlobalConnected: vi.fn(),
}));
vi.mock('../../server/analytics-data.js', () => ({
  fetchSearchOverview: vi.fn(),
  fetchPerformanceTrend: vi.fn(),
  fetchSearchComparison: vi.fn(),
}));

import { getWorkspace } from '../../server/workspaces.js';
import { isGlobalConnected } from '../../server/google-auth.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchComparison,
} from '../../server/analytics-data.js';
import {
  analyticsReadActionTools,
  handleAnalyticsReadActionTool,
} from '../../server/mcp/tools/analytics-read-actions.js';

type Mock = ReturnType<typeof vi.fn>;

const OVERVIEW = {
  totalClicks: 1200,
  totalImpressions: 50000,
  avgCtr: 2.4,
  avgPosition: 8.3,
  topQueries: [{ query: 'hvac repair', clicks: 100, impressions: 4000, ctr: 2.5, position: 6.1 }],
  topPages: [{ page: '/blog/hvac', clicks: 80, impressions: 3000, ctr: 2.7, position: 5.4 }],
  dateRange: { start: '2026-06-01', end: '2026-06-28' },
};

const TREND = [
  { date: '2026-06-01', clicks: 40, impressions: 1700, ctr: 2.4, position: 8.0 },
  { date: '2026-06-02', clicks: 45, impressions: 1800, ctr: 2.5, position: 7.9 },
];

const COMPARISON = {
  current: { clicks: 1200, impressions: 50000, ctr: 2.4, position: 8.3 },
  previous: { clicks: 1000, impressions: 46000, ctr: 2.2, position: 9.0 },
  change: { clicks: 200, impressions: 4000, ctr: 0.2, position: -0.7 },
  changePercent: { clicks: 20, impressions: 8.7, ctr: 9.1, position: -7.8 },
};

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('mcp analytics read action tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getWorkspace as Mock).mockReturnValue({
      id: 'ws-1',
      name: 'Workspace',
      webflowSiteId: 'site-123',
      gscPropertyUrl: 'sc-domain:example.com',
    });
    (isGlobalConnected as Mock).mockReturnValue(true);
    (fetchSearchOverview as Mock).mockResolvedValue(OVERVIEW);
    (fetchPerformanceTrend as Mock).mockResolvedValue(TREND);
    (fetchSearchComparison as Mock).mockResolvedValue(COMPARISON);
  });

  it('registers the get_search_performance tool', () => {
    expect(analyticsReadActionTools.map(t => t.name)).toEqual(['get_search_performance']);
  });

  it('returns Unknown tool for an unrecognized name', async () => {
    const result = await handleAnalyticsReadActionTool('nope', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('Unknown analytics read action tool');
  });

  it('reads with the default 28-day window when no range is given', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });

    expect(result.isError).toBeUndefined();
    // siteId + gscSiteUrl resolved from workspace; default window = 28; no dateRange.
    expect(fetchSearchOverview).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, undefined);
    expect(fetchPerformanceTrend).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, undefined);
    // compare_previous not set → comparison fetch is skipped.
    expect(fetchSearchComparison).not.toHaveBeenCalled();

    const payload = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(payload.totals).toEqual({ clicks: 1200, impressions: 50000, ctr: 2.4, position: 8.3 });
    expect(payload.daily_trend).toEqual(TREND);
    expect(payload.top_queries).toEqual(OVERVIEW.topQueries);
    expect(payload.period_comparison).toBeNull();
  });

  it('passes a custom days window through to the search-console reads', async () => {
    await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1', days: 90 });
    expect(fetchSearchOverview).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 90, undefined);
    expect(fetchPerformanceTrend).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 90, undefined);
  });

  it('passes an explicit start/end date range through as a dateRange', async () => {
    await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    });
    const expectedRange = { startDate: '2026-05-01', endDate: '2026-05-31' };
    expect(fetchSearchOverview).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, expectedRange);
    expect(fetchPerformanceTrend).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, expectedRange);
  });

  it('includes a period comparison when compare_previous is true', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      compare_previous: true,
    });
    expect(fetchSearchComparison).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, undefined);
    const payload = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(payload.period_comparison).toEqual(COMPARISON);
  });

  it('rejects a lone start_date without end_date', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      start_date: '2026-05-01',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('must be provided together');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('rejects an end_date earlier than start_date', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      start_date: '2026-05-31',
      end_date: '2026-05-01',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('on or after start_date');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('errors when the workspace has no GSC property configured', async () => {
    (getWorkspace as Mock).mockReturnValue({ id: 'ws-1', name: 'Workspace', webflowSiteId: 'site-123' });
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('No Google Search Console property is connected');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('errors when Google is not globally connected', async () => {
    (isGlobalConnected as Mock).mockReturnValue(false);
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('Google is not connected');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('errors when the workspace does not exist', async () => {
    (getWorkspace as Mock).mockReturnValue(undefined);
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ghost' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('Workspace not found');
  });

  it('surfaces a search-console failure as an mcpError', async () => {
    (fetchSearchOverview as Mock).mockRejectedValue(new Error('GSC API error (429)'));
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('Failed to read search performance');
  });
});
