/**
 * Unit tests for src/api/* modules — file A
 * Covers: analytics, platform, outcomes, misc
 *
 * Strategy: mock src/api/client so each wrapper is tested for correct URL,
 * HTTP verb, and body construction without hitting the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the base API client ────────────────────────────────────────────────
vi.mock('../../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  },
  get: vi.fn().mockResolvedValue({}),
  getSafe: vi.fn().mockResolvedValue({}),
  getOptional: vi.fn().mockResolvedValue(null),
  getText: vi.fn().mockResolvedValue(''),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue(undefined),
  postForm: vi.fn().mockResolvedValue({}),
}));

import { get, getSafe, getOptional, post, patch, del } from '../../src/api/client';

const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockGetOptional = vi.mocked(getOptional);
const mockPost = vi.mocked(post);
const mockPatch = vi.mocked(patch);
const mockDel = vi.mocked(del);

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/analytics.ts — gsc
// ═══════════════════════════════════════════════════════════════════════════

import { gsc, ga4, ga4Admin, gscAdmin, fetchClientIntelligence } from '../../src/api/analytics';

describe('gsc.overview', () => {
  it('calls getOptional with correct URL including workspaceId', async () => {
    await gsc.overview('ws-42', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/public/search-overview/ws-42');
  });

  it('includes days in query string', async () => {
    await gsc.overview('ws-1', 14);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('days=14');
  });

  it('appends startDate and endDate when dateRange is provided', async () => {
    await gsc.overview('ws-1', 7, { startDate: '2025-01-01', endDate: '2025-01-07' });
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('startDate=2025-01-01');
    expect(url).toContain('endDate=2025-01-07');
  });

  it('returns data from getOptional', async () => {
    const fakeData = { totalClicks: 999, totalImpressions: 5000 };
    mockGetOptional.mockResolvedValueOnce(fakeData);
    const result = await gsc.overview('ws-1', 28);
    expect(result).toEqual(fakeData);
  });
});

describe('gsc.trend', () => {
  it('calls get with correct URL', async () => {
    await gsc.trend('ws-1', 30);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/performance-trend/ws-1');
    expect(url).toContain('days=30');
  });

  it('returns data from get', async () => {
    const trend = [{ date: '2025-01-01', clicks: 10 }];
    mockGet.mockResolvedValueOnce(trend);
    const result = await gsc.trend('ws-1', 7);
    expect(result).toEqual(trend);
  });
});

describe('gsc.comparison', () => {
  it('calls getOptional for nullable comparison data', async () => {
    await gsc.comparison('ws-1', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/public/search-comparison/ws-1');
  });

  it('includes days param', async () => {
    await gsc.comparison('ws-1', 90);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('days=90');
  });
});

describe('gsc.devices', () => {
  it('calls get with correct URL', async () => {
    await gsc.devices('ws-1', 14);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/search-devices/ws-1');
    expect(url).toContain('days=14');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/analytics.ts — ga4
// ═══════════════════════════════════════════════════════════════════════════

describe('ga4.overview', () => {
  it('calls getOptional with correct URL and days param', async () => {
    await ga4.overview('ws-1', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/public/analytics-overview/ws-1');
    expect(url).toContain('days=28');
  });

  it('appends dateRange params when provided', async () => {
    await ga4.overview('ws-1', 28, { startDate: '2025-01-01', endDate: '2025-01-28' });
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('startDate=2025-01-01');
  });

  it('returns null from getOptional when no data', async () => {
    mockGetOptional.mockResolvedValueOnce(null);
    const result = await ga4.overview('ws-1', 28);
    expect(result).toBeNull();
  });
});

describe('ga4.trend', () => {
  it('calls get with correct URL', async () => {
    await ga4.trend('ws-1', 30);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-trend/ws-1');
    expect(url).toContain('days=30');
  });
});

describe('ga4.sources', () => {
  it('calls get with sources endpoint', async () => {
    await ga4.sources('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-sources/ws-1');
  });
});

describe('ga4.devices', () => {
  it('calls get with devices endpoint', async () => {
    await ga4.devices('ws-1', 7);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-devices/ws-1');
    expect(url).toContain('days=7');
  });
});

describe('ga4.countries', () => {
  it('calls get with countries endpoint', async () => {
    await ga4.countries('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-countries/ws-1');
  });
});

describe('ga4.events', () => {
  it('calls get with events endpoint', async () => {
    await ga4.events('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-events/ws-1');
  });
});

describe('ga4.eventTrend', () => {
  it('URL-encodes the event name', async () => {
    await ga4.eventTrend('ws-1', 'click & buy', 30);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('event=click%20%26%20buy');
  });

  it('includes days param', async () => {
    await ga4.eventTrend('ws-1', 'purchase', 14);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('days=14');
  });

  it('appends dateRange params when provided', async () => {
    await ga4.eventTrend('ws-1', 'purchase', 14, { startDate: '2025-01-01', endDate: '2025-01-14' });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('startDate=2025-01-01');
    expect(url).toContain('endDate=2025-01-14');
  });
});

describe('ga4.eventPages', () => {
  it('URL-encodes event name in analytics-event-explorer endpoint', async () => {
    await ga4.eventPages('ws-1', 'form submit', 7);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-event-explorer/ws-1');
    expect(url).toContain('event=form%20submit');
  });

  it('appends dateRange params when provided', async () => {
    await ga4.eventPages('ws-1', 'form submit', 7, { startDate: '2025-02-01', endDate: '2025-02-07' });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('startDate=2025-02-01');
    expect(url).toContain('endDate=2025-02-07');
  });
});

describe('ga4.conversions', () => {
  it('calls get with conversions endpoint', async () => {
    await ga4.conversions('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-conversions/ws-1');
  });
});

describe('ga4.newVsReturning', () => {
  it('calls get with new-vs-returning endpoint', async () => {
    await ga4.newVsReturning('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-new-vs-returning/ws-1');
  });
});

describe('ga4.organic', () => {
  it('calls getOptional with organic endpoint', async () => {
    await ga4.organic('ws-1', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/public/analytics-organic/ws-1');
  });
});

describe('ga4.landingPages', () => {
  it('calls get with landing-pages endpoint', async () => {
    await ga4.landingPages('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-landing-pages/ws-1');
  });

  it('appends organic=true when opts.organic is set', async () => {
    await ga4.landingPages('ws-1', 28, { organic: true });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('organic=true');
  });

  it('appends limit param when opts.limit is set', async () => {
    await ga4.landingPages('ws-1', 28, { limit: 20 });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('limit=20');
  });

  it('omits organic and limit when options not provided', async () => {
    await ga4.landingPages('ws-1', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).not.toContain('organic=');
    expect(url).not.toContain('limit=');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/analytics.ts — ga4Admin
// ═══════════════════════════════════════════════════════════════════════════

describe('ga4Admin.overview', () => {
  it('calls admin analytics endpoint with workspaceId and days', async () => {
    await ga4Admin.overview('ws-1', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/google/analytics-overview/ws-1');
    expect(url).toContain('days=28');
  });
});

describe('ga4Admin.organic', () => {
  it('calls admin organic endpoint via getOptional', async () => {
    await ga4Admin.organic('ws-1', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/google/analytics-organic/ws-1');
  });
});

describe('ga4Admin.landingPages', () => {
  it('calls admin landing-pages endpoint with organic and limit params', async () => {
    await ga4Admin.landingPages('ws-1', 28, { organic: true, limit: 20 });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/google/analytics-landing-pages/ws-1');
    expect(url).toContain('organic=true');
    expect(url).toContain('limit=20');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/analytics.ts — gscAdmin
// ═══════════════════════════════════════════════════════════════════════════

describe('gscAdmin.overview', () => {
  it('calls getOptional with correct siteId in URL', async () => {
    await gscAdmin.overview('ws-1', 'site-99', 'https://example.com/', 30);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/google/search-overview/site-99');
  });

  it('encodes workspaceId and gscSiteUrl in query string', async () => {
    await gscAdmin.overview('ws-1', 'site-1', 'https://example.com/', 7);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
    expect(url).toContain('gscSiteUrl=');
    expect(url).toContain('days=7');
  });
});

describe('gscAdmin.trend', () => {
  it('calls get with trend endpoint', async () => {
    await gscAdmin.trend('ws-1', 'site-1', 'https://example.com/', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/google/performance-trend/site-1');
  });
});

describe('gscAdmin.devices', () => {
  it('calls get with devices endpoint', async () => {
    await gscAdmin.devices('ws-1', 'site-1', 'https://example.com/', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/google/search-devices/site-1');
  });
});

describe('gscAdmin.countries', () => {
  it('calls get with countries endpoint', async () => {
    await gscAdmin.countries('ws-1', 'site-1', 'https://example.com/', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/google/search-countries/site-1');
  });
});

describe('gscAdmin.searchTypes', () => {
  it('calls get with search-types endpoint', async () => {
    await gscAdmin.searchTypes('ws-1', 'site-1', 'https://example.com/', 28);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/google/search-types/site-1');
  });
});

describe('gscAdmin.comparison', () => {
  it('calls getOptional with comparison endpoint', async () => {
    await gscAdmin.comparison('ws-1', 'site-1', 'https://example.com/', 28);
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/google/search-comparison/site-1');
  });
});

describe('gscAdmin.chat', () => {
  it('calls post with merged workspaceId in body', async () => {
    const body = { question: 'What is CTR?', context: { page: '/about' } };
    await gscAdmin.chat('ws-1', 'site-1', body);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/google/search-chat/site-1',
      { ...body, workspaceId: 'ws-1' },
    );
  });

  it('returns data from post', async () => {
    const resp = { answer: 'CTR is click-through rate' };
    mockPost.mockResolvedValueOnce(resp);
    const result = await gscAdmin.chat('ws-1', 'site-1', { question: 'CTR?', context: {} });
    expect(result).toEqual(resp);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/analytics.ts — fetchClientIntelligence
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchClientIntelligence', () => {
  it('calls get with intelligence endpoint', async () => {
    mockGet.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      assembledAt: '2025-01-01T00:00:00Z',
      tier: 'free',
      insightsSummary: null,
      pipelineStatus: null,
    });
    await fetchClientIntelligence('ws-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/intelligence/ws-1');
  });

  it('returns the resolved data from get', async () => {
    const data = { workspaceId: 'ws-99', assembledAt: '2025-01-01T00:00:00Z', tier: 'growth' as const, insightsSummary: null, pipelineStatus: null };
    mockGet.mockResolvedValueOnce(data);
    const result = await fetchClientIntelligence('ws-99');
    expect(result.workspaceId).toBe('ws-99');
    expect(result.tier).toBe('growth');
  });

  it('surfaces provider failures instead of returning a synthetic timestamp fallback', async () => {
    const err = new Error('intelligence unavailable');
    mockGet.mockRejectedValueOnce(err);
    await expect(fetchClientIntelligence('ws-1')).rejects.toThrow('intelligence unavailable');
    expect(mockGetSafe).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — jobs
// ═══════════════════════════════════════════════════════════════════════════

import { jobs, roadmap, features, notifications, workspaceOverview, workspaceHome, workspaceBadges, integrationHealth, observability } from '../../src/api/platform';

describe('jobs.list', () => {
  it('calls GET /api/jobs', async () => {
    await jobs.list();
    expect(mockGet).toHaveBeenCalledWith('/api/jobs');
  });

  it('returns data from GET', async () => {
    const fakeJobs = [{ id: 'j1', status: 'running' }];
    mockGet.mockResolvedValueOnce(fakeJobs);
    const result = await jobs.list();
    expect(result).toEqual(fakeJobs);
  });
});

describe('jobs.get', () => {
  it('calls GET with jobId in path', async () => {
    await jobs.get('job-abc');
    expect(mockGet).toHaveBeenCalledWith('/api/jobs/job-abc');
  });
});

describe('jobs.create', () => {
  it('calls post with /api/jobs and body', async () => {
    await jobs.create({ type: 'seo-audit', workspaceId: 'ws-1' });
    expect(mockPost).toHaveBeenCalledWith('/api/jobs', { type: 'seo-audit', workspaceId: 'ws-1' });
  });
});

describe('jobs.cancel', () => {
  it('calls del with /api/jobs/:jobId', async () => {
    await jobs.cancel('job-123');
    expect(mockDel).toHaveBeenCalledWith('/api/jobs/job-123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — roadmap
// ═══════════════════════════════════════════════════════════════════════════

describe('roadmap.get', () => {
  it('calls GET /api/roadmap', async () => {
    await roadmap.get();
    expect(mockGet).toHaveBeenCalledWith('/api/roadmap');
  });
});

describe('roadmap.updateItem', () => {
  it('URL-encodes itemId', async () => {
    await roadmap.updateItem('item 1', 'sprint-a', { status: 'done' as const });
    const [url] = mockPatch.mock.calls[0];
    expect(url).toContain('/api/roadmap/item/item%201');
  });

  it('URL-encodes sprintId in query string', async () => {
    await roadmap.updateItem(5, 'sprint 2025-Q1', { status: 'pending' as const });
    const [url] = mockPatch.mock.calls[0];
    expect(url).toContain('sprintId=sprint%202025-Q1');
  });

  it('passes body to patch', async () => {
    mockPatch.mockResolvedValueOnce({ ok: true, item: { id: 1 } });
    await roadmap.updateItem(1, 'sprint-a', { status: 'done' as const });
    const [, body] = mockPatch.mock.calls[0];
    expect((body as Record<string, unknown>).status).toBe('done');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — features
// ═══════════════════════════════════════════════════════════════════════════

describe('features.get', () => {
  it('calls GET /api/features', async () => {
    await features.get();
    expect(mockGet).toHaveBeenCalledWith('/api/features');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — notifications
// ═══════════════════════════════════════════════════════════════════════════

describe('notifications.list', () => {
  it('calls getSafe with /api/notifications and empty array fallback', async () => {
    await notifications.list();
    expect(mockGetSafe).toHaveBeenCalledWith('/api/notifications', []);
  });
});

describe('notifications.markRead', () => {
  it('calls patch with correct path and empty body', async () => {
    await notifications.markRead('notif-42');
    expect(mockPatch).toHaveBeenCalledWith('/api/notifications/notif-42/read', {});
  });
});

describe('notifications.markAllRead', () => {
  it('calls post on mark-all-read endpoint', async () => {
    await notifications.markAllRead();
    expect(mockPost).toHaveBeenCalledWith('/api/notifications/mark-all-read');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — workspaceOverview
// ═══════════════════════════════════════════════════════════════════════════

describe('workspaceOverview.list', () => {
  it('calls getSafe with /api/workspace-overview and empty array fallback', async () => {
    await workspaceOverview.list();
    expect(mockGetSafe).toHaveBeenCalledWith('/api/workspace-overview', []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — workspaceHome
// ═══════════════════════════════════════════════════════════════════════════

describe('workspaceHome.get', () => {
  it('defaults to days=28 when not specified', async () => {
    await workspaceHome.get('ws-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).toBe('/api/workspace-home/ws-1?days=28');
  });

  it('uses custom days value when provided', async () => {
    await workspaceHome.get('ws-1', 90);
    const [url] = mockGet.mock.calls[0];
    expect(url).toBe('/api/workspace-home/ws-1?days=90');
  });

  it('returns data from GET', async () => {
    const homeData = { ranks: [], requests: [], contentRequests: [], activity: [], annotations: [], churnSignals: [], workOrders: [], searchData: null, ga4Data: null, comparison: null };
    mockGet.mockResolvedValueOnce(homeData);
    const result = await workspaceHome.get('ws-1');
    expect(result).toEqual(homeData);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — workspaceBadges
// ═══════════════════════════════════════════════════════════════════════════

describe('workspaceBadges.get', () => {
  it('calls GET with wsId in path', async () => {
    await workspaceBadges.get('ws-99');
    expect(mockGet).toHaveBeenCalledWith('/api/workspace-badges/ws-99');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — integrationHealth
// ═══════════════════════════════════════════════════════════════════════════

describe('integrationHealth.get', () => {
  it('calls GET /api/integrations/health/:wsId', async () => {
    await integrationHealth.get('ws-1');
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/health/ws-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts — observability
// ═══════════════════════════════════════════════════════════════════════════

describe('observability.get', () => {
  it('defaults to days=14', async () => {
    await observability.get('ws-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).toBe('/api/observability/ws-1?days=14');
  });

  it('accepts custom days param', async () => {
    await observability.get('ws-1', 30);
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('days=30');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/outcomes.ts — outcomesApi
// ═══════════════════════════════════════════════════════════════════════════

import { outcomesApi, clientOutcomesApi } from '../../src/api/outcomes';

describe('outcomesApi.getActions', () => {
  it('calls getSafe with base actions URL when no filters', async () => {
    await outcomesApi.getActions('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toBe('/api/outcomes/ws-1/actions');
  });

  it('appends type filter to query string', async () => {
    await outcomesApi.getActions('ws-1', 'content_refreshed');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('type=content_refreshed');
  });

  it('appends both type and score when provided', async () => {
    await outcomesApi.getActions('ws-1', 'seo_edit', 'win');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('type=seo_edit');
    expect(url).toContain('score=win');
  });

  it('uses empty array fallback', async () => {
    await outcomesApi.getActions('ws-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });

  it('returns data from getSafe', async () => {
    const actions = [{ id: 'act-1', type: 'seo_edit' }];
    mockGetSafe.mockResolvedValueOnce(actions);
    const result = await outcomesApi.getActions('ws-1');
    expect(result).toEqual(actions);
  });
});

describe('outcomesApi.getAction', () => {
  it('calls getSafe with action URL including actionId', async () => {
    await outcomesApi.getAction('ws-1', 'action-abc');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/actions/action-abc');
  });

  it('uses null fallback', async () => {
    await outcomesApi.getAction('ws-1', 'action-abc');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toBeNull();
  });
});

describe('outcomesApi.getScorecard', () => {
  it('calls getSafe with scorecard endpoint and null fallback', async () => {
    await outcomesApi.getScorecard('ws-1');
    const [url, fallback] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/scorecard');
    expect(fallback).toBeNull();
  });
});

describe('outcomesApi.getTopWins', () => {
  it('calls getSafe with top-wins endpoint', async () => {
    await outcomesApi.getTopWins('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/top-wins');
  });

  it('uses empty array fallback', async () => {
    await outcomesApi.getTopWins('ws-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

describe('outcomesApi.getTimeline', () => {
  it('calls getSafe with timeline endpoint', async () => {
    await outcomesApi.getTimeline('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/timeline');
  });

  it('uses empty array fallback', async () => {
    await outcomesApi.getTimeline('ws-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

describe('outcomesApi.getLearnings', () => {
  it('calls getSafe with learnings endpoint and null fallback', async () => {
    await outcomesApi.getLearnings('ws-1');
    const [url, fallback] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/learnings');
    expect(fallback).toBeNull();
  });
});

describe('outcomesApi.getOverview', () => {
  it('calls getSafe with global overview endpoint', async () => {
    await outcomesApi.getOverview();
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toBe('/api/outcomes/overview');
  });

  it('uses empty array fallback', async () => {
    await outcomesApi.getOverview();
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

describe('outcomesApi.addNote', () => {
  it('calls post with note body', async () => {
    await outcomesApi.addNote('ws-1', 'act-1', 'This worked well');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/outcomes/ws-1/actions/act-1/note',
      { note: 'This worked well' },
    );
  });
});

describe('outcomesApi.getPlaybooks', () => {
  it('calls getSafe with playbooks endpoint', async () => {
    await outcomesApi.getPlaybooks('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/playbooks');
  });

  it('uses empty array fallback', async () => {
    await outcomesApi.getPlaybooks('ws-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/outcomes.ts — clientOutcomesApi
// ═══════════════════════════════════════════════════════════════════════════

describe('clientOutcomesApi.getSummary', () => {
  it('calls getSafe with public outcomes summary endpoint', async () => {
    await clientOutcomesApi.getSummary('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/outcomes/ws-1/summary');
  });

  it('uses null fallback', async () => {
    await clientOutcomesApi.getSummary('ws-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toBeNull();
  });
});

describe('clientOutcomesApi.getWins', () => {
  it('calls getSafe with public outcomes wins endpoint', async () => {
    await clientOutcomesApi.getWins('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/outcomes/ws-1/wins');
  });

  it('uses empty array fallback', async () => {
    await clientOutcomesApi.getWins('ws-1');
    const [, fallback] = mockGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — requests
// ═══════════════════════════════════════════════════════════════════════════

import {
  requests, publicRequests, approvals, activity,
  analyticsAnnotations, annotations, anomalies,
  churnSignals, chat, recommendations, settings,
  salesReport, workOrders, redirects,
  contentSubscriptions, stripe, auth,
  keywordFeedback, trackedKeywords, businessPriorities, featureFlags,
} from '../../src/api/misc';

describe('requests.list', () => {
  it('calls GET /api/requests with no query when no params', async () => {
    await requests.list();
    const [url] = mockGet.mock.calls[0];
    expect(url).toBe('/api/requests');
  });

  it('appends workspaceId when provided', async () => {
    await requests.list({ workspaceId: 'ws-1' });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
  });
});

describe('requests.create', () => {
  it('calls post with body', async () => {
    await requests.create({ title: 'Fix page speed' });
    expect(mockPost).toHaveBeenCalledWith('/api/requests', { title: 'Fix page speed' });
  });
});

describe('requests.update', () => {
  it('calls patch with id in path and body', async () => {
    await requests.update('req-1', { status: 'done' });
    expect(mockPatch).toHaveBeenCalledWith('/api/requests/req-1', { status: 'done' });
  });
});

describe('requests.remove', () => {
  it('calls del with id in path', async () => {
    await requests.remove('req-42');
    expect(mockDel).toHaveBeenCalledWith('/api/requests/req-42');
  });
});

describe('requests.addNote', () => {
  it('calls post on notes subpath with body', async () => {
    await requests.addNote('req-1', { text: 'Progress update' });
    expect(mockPost).toHaveBeenCalledWith('/api/requests/req-1/notes', { text: 'Progress update' });
  });
});

describe('publicRequests.list', () => {
  it('calls getSafe with public requests endpoint', async () => {
    await publicRequests.list('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/public/requests/ws-1', []);
  });
});

describe('publicRequests.create', () => {
  it('calls post on public requests endpoint', async () => {
    await publicRequests.create('ws-1', { topic: 'Blog post' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/requests/ws-1', { topic: 'Blog post' });
  });
});

describe('publicRequests.addNote', () => {
  it('calls post on public notes subpath', async () => {
    await publicRequests.addNote('ws-1', 'req-1', { text: 'Thanks' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/requests/ws-1/req-1/notes', { text: 'Thanks' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — approvals
// ═══════════════════════════════════════════════════════════════════════════

describe('approvals.create', () => {
  it('calls post with wsId and body', async () => {
    await approvals.create('ws-1', { type: 'content', note: 'Review this' });
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/api/approvals/ws-1');
    expect((body as Record<string, unknown>).note).toBe('Review this');
  });
});

describe('approvals.list', () => {
  it('calls getSafe with approvals endpoint', async () => {
    await approvals.list('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/approvals/ws-1', []);
  });
});

describe('approvals.remove', () => {
  it('calls del with batchId in path', async () => {
    await approvals.remove('ws-1', 'batch-99');
    expect(mockDel).toHaveBeenCalledWith('/api/approvals/ws-1/batch-99');
  });
});

describe('approvals.remind', () => {
  it('calls post on remind subpath', async () => {
    await approvals.remind('ws-1', 'batch-1');
    expect(mockPost).toHaveBeenCalledWith('/api/approvals/ws-1/batch-1/remind');
  });
});

describe('approvals.publicList', () => {
  it('calls getSafe with public approvals endpoint', async () => {
    await approvals.publicList('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/public/approvals/ws-1', []);
  });
});

describe('approvals.publicUpdate', () => {
  it('calls patch with status body', async () => {
    await approvals.publicUpdate('ws-1', 'batch-1', { status: 'approved' });
    expect(mockPatch).toHaveBeenCalledWith('/api/public/approvals/ws-1/batch-1', { status: 'approved' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — activity
// ═══════════════════════════════════════════════════════════════════════════

describe('activity.list', () => {
  it('includes workspaceId and limit=8 by default', async () => {
    await activity.list('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
    expect(url).toContain('limit=8');
  });

  it('accepts custom limit', async () => {
    await activity.list('ws-1', 25);
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('limit=25');
  });
});

describe('activity.publicList', () => {
  it('includes wsId in URL path and limit=20 by default', async () => {
    await activity.publicList('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/activity/ws-1');
    expect(url).toContain('limit=20');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — analyticsAnnotations
// ═══════════════════════════════════════════════════════════════════════════

describe('analyticsAnnotations.list', () => {
  it('calls getSafe with annotations endpoint for no opts', async () => {
    await analyticsAnnotations.list('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/google/annotations/ws-1');
  });

  it('appends query params from opts', async () => {
    await analyticsAnnotations.list('ws-1', { category: 'launch', startDate: '2025-01-01' });
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('category=launch');
    expect(url).toContain('startDate=2025-01-01');
  });
});

describe('analyticsAnnotations.create', () => {
  it('calls post on annotations endpoint', async () => {
    await analyticsAnnotations.create('ws-1', { date: '2025-01-01', note: 'Launched new homepage' });
    expect(mockPost).toHaveBeenCalledWith('/api/google/annotations/ws-1', { date: '2025-01-01', note: 'Launched new homepage' });
  });
});

describe('analyticsAnnotations.update', () => {
  it('calls patch with annotation id in path', async () => {
    await analyticsAnnotations.update('ws-1', 'ann-1', { note: 'Updated note' });
    expect(mockPatch).toHaveBeenCalledWith('/api/google/annotations/ws-1/ann-1', { note: 'Updated note' });
  });
});

describe('analyticsAnnotations.remove', () => {
  it('calls del with annotation id in path', async () => {
    await analyticsAnnotations.remove('ws-1', 'ann-1');
    expect(mockDel).toHaveBeenCalledWith('/api/google/annotations/ws-1/ann-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — annotations
// ═══════════════════════════════════════════════════════════════════════════

describe('annotations.list', () => {
  it('calls getSafe with annotations endpoint', async () => {
    await annotations.list('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/annotations/ws-1', []);
  });
});

describe('annotations.create', () => {
  it('calls post with body', async () => {
    await annotations.create('ws-1', { text: 'New homepage launched' });
    expect(mockPost).toHaveBeenCalledWith('/api/annotations/ws-1', { text: 'New homepage launched' });
  });
});

describe('annotations.remove', () => {
  it('calls del with annotation id in path', async () => {
    await annotations.remove('ws-1', 'ann-2');
    expect(mockDel).toHaveBeenCalledWith('/api/annotations/ws-1/ann-2');
  });
});

describe('annotations.publicList', () => {
  it('calls getSafe with public annotations endpoint', async () => {
    await annotations.publicList('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/public/annotations/ws-1', []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — anomalies
// ═══════════════════════════════════════════════════════════════════════════

describe('anomalies.listAll', () => {
  it('calls getSafe with /api/anomalies', async () => {
    await anomalies.listAll();
    expect(mockGetSafe).toHaveBeenCalledWith('/api/anomalies', []);
  });
});

describe('anomalies.list', () => {
  it('calls getSafe with workspace-scoped anomalies endpoint', async () => {
    await anomalies.list('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/anomalies/ws-1', []);
  });
});

describe('anomalies.publicList', () => {
  it('calls getSafe with public anomalies endpoint', async () => {
    await anomalies.publicList('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/public/anomalies/ws-1', []);
  });
});

describe('anomalies.dismiss', () => {
  it('calls post on dismiss subpath', async () => {
    await anomalies.dismiss('anom-1');
    expect(mockPost).toHaveBeenCalledWith('/api/anomalies/anom-1/dismiss');
  });
});

describe('anomalies.acknowledge', () => {
  it('calls post on acknowledge subpath', async () => {
    await anomalies.acknowledge('anom-5');
    expect(mockPost).toHaveBeenCalledWith('/api/anomalies/anom-5/acknowledge');
  });
});

describe('anomalies.scan', () => {
  it('calls post on /api/anomalies/scan', async () => {
    await anomalies.scan();
    expect(mockPost).toHaveBeenCalledWith('/api/anomalies/scan');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — churnSignals
// ═══════════════════════════════════════════════════════════════════════════

describe('churnSignals.list', () => {
  it('calls getSafe with churn-signals endpoint', async () => {
    await churnSignals.list('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/churn-signals/ws-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — chat
// ═══════════════════════════════════════════════════════════════════════════

describe('chat.adminAsk', () => {
  it('calls post with admin-chat body', async () => {
    const body = { workspaceId: 'ws-1', question: 'How is performance?', sessionId: 'sess-1' };
    await chat.adminAsk(body);
    expect(mockPost).toHaveBeenCalledWith('/api/admin-chat', body);
  });
});

describe('chat.publicAsk', () => {
  it('calls post on workspace-scoped search-chat endpoint', async () => {
    const body = { question: 'What are my keywords?', context: {}, sessionId: 'sess-2' };
    await chat.publicAsk('ws-1', body);
    expect(mockPost).toHaveBeenCalledWith('/api/public/search-chat/ws-1', body);
  });
});

describe('chat.sessions', () => {
  it('appends channel query param when provided', async () => {
    await chat.sessions('ws-1', 'advisor');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('?channel=advisor');
  });

  it('omits channel param when not provided', async () => {
    await chat.sessions('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).not.toContain('?channel=');
  });
});

describe('chat.session', () => {
  it('calls getOptional with sessionId in path', async () => {
    await chat.session('ws-1', 'sess-abc');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/public/chat-sessions/ws-1/sess-abc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — recommendations
// ═══════════════════════════════════════════════════════════════════════════

describe('recommendations.list', () => {
  it('calls getOptional with public recommendations endpoint', async () => {
    await recommendations.list('ws-1');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/public/recommendations/ws-1');
  });
});

describe('recommendations.generate', () => {
  it('calls post on generate subpath', async () => {
    await recommendations.generate('ws-1');
    expect(mockPost).toHaveBeenCalledWith('/api/public/recommendations/ws-1/generate');
  });
});

describe('recommendations.update', () => {
  it('calls patch with body', async () => {
    await recommendations.update('ws-1', 'rec-1', { dismissed: true });
    expect(mockPatch).toHaveBeenCalledWith('/api/public/recommendations/ws-1/rec-1', { dismissed: true });
  });
});

describe('recommendations.remove', () => {
  it('calls del with recId in path', async () => {
    await recommendations.remove('ws-1', 'rec-1');
    expect(mockDel).toHaveBeenCalledWith('/api/public/recommendations/ws-1/rec-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — settings
// ═══════════════════════════════════════════════════════════════════════════

describe('settings.getFeatures', () => {
  it('calls getOptional with settings features endpoint', async () => {
    await settings.getFeatures('ws-1');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/settings/ws-1/features');
  });
});

describe('settings.updateFeatures', () => {
  it('calls patch with features body', async () => {
    await settings.updateFeatures('ws-1', { enableChat: true });
    expect(mockPatch).toHaveBeenCalledWith('/api/settings/ws-1/features', { enableChat: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — salesReport
// ═══════════════════════════════════════════════════════════════════════════

describe('salesReport.get', () => {
  it('calls GET /api/sales-report', async () => {
    await salesReport.get();
    expect(mockGet).toHaveBeenCalledWith('/api/sales-report');
  });
});

describe('salesReport.refresh', () => {
  it('calls post on refresh endpoint', async () => {
    await salesReport.refresh();
    expect(mockPost).toHaveBeenCalledWith('/api/sales-report/refresh');
  });
});

describe('salesReport.list', () => {
  it('calls getSafe with sales-reports endpoint', async () => {
    await salesReport.list();
    expect(mockGetSafe).toHaveBeenCalledWith('/api/sales-reports', []);
  });
});

describe('salesReport.getById', () => {
  it('calls getOptional with report id in path', async () => {
    await salesReport.getById('report-xyz');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/sales-report/report-xyz');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — workOrders
// ═══════════════════════════════════════════════════════════════════════════

describe('workOrders.list', () => {
  it('calls getSafe with work-orders endpoint', async () => {
    await workOrders.list('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/work-orders/ws-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — redirects
// ═══════════════════════════════════════════════════════════════════════════

describe('redirects.list', () => {
  it('calls getSafe with webflow redirects endpoint', async () => {
    await redirects.list('site-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/webflow/redirects/site-1', []);
  });
});

describe('redirects.save', () => {
  it('calls post with redirect body', async () => {
    await redirects.save('site-1', { from: '/old-path', to: '/new-path' });
    expect(mockPost).toHaveBeenCalledWith('/api/webflow/redirects/site-1', { from: '/old-path', to: '/new-path' });
  });
});

describe('redirects.scan', () => {
  it('calls GET on redirect-scan endpoint', async () => {
    await redirects.scan('site-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/webflow/redirect-scan/site-1');
  });

  it('appends workspaceId when provided', async () => {
    await redirects.scan('site-1', 'ws-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
  });

  it('omits workspaceId when not provided', async () => {
    await redirects.scan('site-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).not.toContain('workspaceId=');
  });
});

describe('redirects.snapshot', () => {
  it('calls getOptional with redirect-snapshot endpoint', async () => {
    await redirects.snapshot('site-1');
    const [url] = mockGetOptional.mock.calls[0];
    expect(url).toContain('/api/webflow/redirect-snapshot/site-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — contentSubscriptions
// ═══════════════════════════════════════════════════════════════════════════

describe('contentSubscriptions.list', () => {
  it('calls getSafe with content-subscriptions endpoint', async () => {
    await contentSubscriptions.list('ws-1');
    const [url] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/content-subscriptions/ws-1');
  });
});

describe('contentSubscriptions.get', () => {
  it('calls getOptional with subscription id in path', async () => {
    await contentSubscriptions.get('sub-1');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/content-subscription/sub-1');
  });
});

describe('contentSubscriptions.create', () => {
  it('calls post with plan body', async () => {
    await contentSubscriptions.create('ws-1', { plan: 'growth' });
    expect(mockPost).toHaveBeenCalledWith('/api/content-subscriptions/ws-1', { plan: 'growth' });
  });
});

describe('contentSubscriptions.update', () => {
  it('calls patch with subscription body', async () => {
    await contentSubscriptions.update('sub-1', { status: 'paused' });
    expect(mockPatch).toHaveBeenCalledWith('/api/content-subscription/sub-1', { status: 'paused' });
  });
});

describe('contentSubscriptions.remove', () => {
  it('calls del with subscription id path', async () => {
    await contentSubscriptions.remove('sub-1');
    expect(mockDel).toHaveBeenCalledWith('/api/content-subscription/sub-1');
  });
});

describe('contentSubscriptions.markDelivered', () => {
  it('calls post with count body', async () => {
    await contentSubscriptions.markDelivered('sub-1', 3);
    expect(mockPost).toHaveBeenCalledWith('/api/content-subscription/sub-1/delivered', { count: 3 });
  });

  it('defaults count to 1 when not provided', async () => {
    await contentSubscriptions.markDelivered('sub-1');
    const [, body] = mockPost.mock.calls[0];
    expect((body as Record<string, unknown>).count).toBe(1);
  });
});

describe('contentSubscriptions.plans', () => {
  it('calls getSafe on public content-plans endpoint', async () => {
    await contentSubscriptions.plans();
    expect(mockGetSafe).toHaveBeenCalledWith('/api/public/content-plans', []);
  });
});

describe('contentSubscriptions.clientStatus', () => {
  it('calls getOptional with workspace-scoped endpoint', async () => {
    await contentSubscriptions.clientStatus('ws-1');
    expect(mockGetOptional).toHaveBeenCalledWith('/api/public/content-subscription/ws-1');
  });
});

describe('contentSubscriptions.subscribe', () => {
  it('calls post with plan in body', async () => {
    await contentSubscriptions.subscribe('ws-1', 'growth');
    expect(mockPost).toHaveBeenCalledWith('/api/public/content-subscribe/ws-1', { plan: 'growth' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — stripe
// ═══════════════════════════════════════════════════════════════════════════

describe('stripe.getConfig', () => {
  it('calls getOptional with /api/stripe/config', async () => {
    await stripe.getConfig();
    expect(mockGetOptional).toHaveBeenCalledWith('/api/stripe/config');
  });
});

describe('stripe.saveKeys', () => {
  it('calls post with keys body', async () => {
    await stripe.saveKeys({ secretKey: 'sk_test_1', publishableKey: 'pk_test_1' });
    expect(mockPost).toHaveBeenCalledWith('/api/stripe/config/keys', {
      secretKey: 'sk_test_1',
      publishableKey: 'pk_test_1',
    });
  });
});

describe('stripe.saveProducts', () => {
  it('calls post on products config endpoint', async () => {
    await stripe.saveProducts({ growthPriceId: 'price_123' });
    expect(mockPost).toHaveBeenCalledWith('/api/stripe/config/products', { growthPriceId: 'price_123' });
  });
});

describe('stripe.deleteConfig', () => {
  it('calls del on stripe config endpoint', async () => {
    await stripe.deleteConfig();
    expect(mockDel).toHaveBeenCalledWith('/api/stripe/config');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — auth
// ═══════════════════════════════════════════════════════════════════════════

describe('auth.logout', () => {
  it('calls post on auth/logout endpoint', async () => {
    await auth.logout();
    expect(mockPost).toHaveBeenCalledWith('/api/auth/logout');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — keywordFeedback
// ═══════════════════════════════════════════════════════════════════════════

describe('keywordFeedback.get', () => {
  it('calls getSafe with public keyword-feedback endpoint', async () => {
    await keywordFeedback.get('ws-1');
    expect(mockGetSafe).toHaveBeenCalledWith('/api/public/keyword-feedback/ws-1', []);
  });
});

describe('keywordFeedback.submit', () => {
  it('calls post with keyword and vote body', async () => {
    await keywordFeedback.submit('ws-1', { keyword: 'seo tips', vote: 'up' });
    expect(mockPost).toHaveBeenCalledWith('/api/public/keyword-feedback/ws-1', { keyword: 'seo tips', vote: 'up' });
  });
});

describe('keywordFeedback.remove', () => {
  it('URL-encodes keyword in query string', async () => {
    await keywordFeedback.remove('ws-1', 'seo tips & tricks');
    const [url] = mockDel.mock.calls[0];
    expect(url).toContain('keyword=seo%20tips%20%26%20tricks');
  });

  it('calls del with public keyword-feedback endpoint', async () => {
    await keywordFeedback.remove('ws-1', 'keyword');
    const [url] = mockDel.mock.calls[0];
    expect(url).toContain('/api/public/keyword-feedback/ws-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — trackedKeywords
// ═══════════════════════════════════════════════════════════════════════════

describe('trackedKeywords.get', () => {
  it('calls getSafe with correct URL and keywords fallback', async () => {
    await trackedKeywords.get('ws-1');
    const [url, fallback] = mockGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/tracked-keywords/ws-1');
    expect(fallback).toEqual({ keywords: [] });
  });
});

describe('trackedKeywords.add', () => {
  it('calls post with keyword in body', async () => {
    await trackedKeywords.add('ws-1', 'local seo');
    expect(mockPost).toHaveBeenCalledWith('/api/public/tracked-keywords/ws-1', { keyword: 'local seo' });
  });
});

describe('trackedKeywords.remove', () => {
  it('calls del with keyword in body', async () => {
    await trackedKeywords.remove('ws-1', 'local seo');
    expect(mockDel).toHaveBeenCalledWith('/api/public/tracked-keywords/ws-1', { keyword: 'local seo' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — businessPriorities
// ═══════════════════════════════════════════════════════════════════════════

describe('businessPriorities.get', () => {
  it('calls get with correct URL', async () => {
    await businessPriorities.get('ws-1');
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain('/api/public/business-priorities/ws-1');
  });

  it('save posts priorities with the concurrency token', async () => {
    await businessPriorities.save('ws-1', {
      priorities: [{ text: 'Grow', category: 'growth' }],
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mockPost).toHaveBeenCalledWith('/api/public/business-priorities/ws-1', {
      priorities: [{ text: 'Grow', category: 'growth' }],
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — featureFlags
// ═══════════════════════════════════════════════════════════════════════════

describe('featureFlags.list', () => {
  it('calls get with the shared feature flags endpoint', async () => {
    await featureFlags.list();
    expect(mockGet).toHaveBeenCalledWith('/api/feature-flags');
  });
});
