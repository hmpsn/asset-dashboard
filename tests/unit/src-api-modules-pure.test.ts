/**
 * Unit tests for src/api/* modules (excluding seo.ts which is covered by
 * src-api-seo.test.ts). Strategy: mock src/api/client so each wrapper is
 * tested for correct URL, HTTP verb, and body construction.
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

import { get, getSafe, getOptional, getText, post, patch, put, del } from '../../src/api/client';

const mockedGet = vi.mocked(get);
const mockedGetSafe = vi.mocked(getSafe);
const mockedGetOptional = vi.mocked(getOptional);
const mockedGetText = vi.mocked(getText);
const mockedPost = vi.mocked(post);
const mockedPatch = vi.mocked(patch);
const mockedPut = vi.mocked(put);
const mockedDel = vi.mocked(del);

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/client.ts — base HTTP helpers (tested via spied-on fetch)
// ═══════════════════════════════════════════════════════════════════════════

describe('src/api/client — ApiError', async () => {
  const { ApiError } = await import('../../src/api/client');

  it('constructs with status and message', () => {
    const err = new ApiError(404, 'Not Found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not Found');
    expect(err.name).toBe('ApiError');
  });

  it('stores optional body', () => {
    const err = new ApiError(422, 'Validation error', { field: 'email' });
    expect(err.body).toEqual({ field: 'email' });
  });

  it('is an instance of Error', () => {
    const err = new ApiError(500, 'Server error');
    expect(err).toBeInstanceOf(Error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/analytics.ts
// ═══════════════════════════════════════════════════════════════════════════

import { gsc, ga4, gscAdmin, fetchClientIntelligence } from '../../src/api/analytics';

describe('src/api/analytics — gsc (Search Console)', () => {
  it('gsc.overview includes days in query string', async () => {
    await gsc.overview('ws-1', 28);
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('/api/public/search-overview/ws-1');
    expect(url).toContain('days=28');
  });

  it('gsc.overview appends dateRange when provided', async () => {
    await gsc.overview('ws-1', 28, { startDate: '2024-01-01', endDate: '2024-01-28' });
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('startDate=2024-01-01');
    expect(url).toContain('endDate=2024-01-28');
  });

  it('gsc.trend uses get so provider failures surface', async () => {
    await gsc.trend('ws-2', 90);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/performance-trend/ws-2');
    expect(url).toContain('days=90');
  });

  it('gsc.comparison uses getOptional for nullable comparison data', async () => {
    await gsc.comparison('ws-1', 7);
    expect(mockedGetOptional).toHaveBeenCalled();
  });

  it('gsc.devices uses get so provider failures surface', async () => {
    await gsc.devices('ws-1', 30);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/search-devices/ws-1');
  });
});

describe('src/api/analytics — ga4 (Google Analytics 4)', () => {
  it('ga4.overview uses getOptional with days param', async () => {
    await ga4.overview('ws-1', 30);
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('/api/public/analytics-overview/ws-1');
    expect(url).toContain('days=30');
  });

  it('ga4.trend uses get so provider failures surface', async () => {
    await ga4.trend('ws-1', 28);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-trend/ws-1');
  });

  it('ga4.topPages uses get so provider failures surface', async () => {
    await ga4.topPages('ws-1', 14);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-top-pages/ws-1');
  });

  it('ga4.eventTrend URL-encodes the event name', async () => {
    await ga4.eventTrend('ws-1', 'click & convert', 30);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('event=click%20%26%20convert');
    expect(url).toContain('days=30');
  });

  it('ga4.eventPages URL-encodes event name', async () => {
    await ga4.eventPages('ws-1', 'form submit', 7);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/analytics-event-explorer/ws-1');
    expect(url).toContain('event=form%20submit');
  });

  it('ga4.landingPages includes optional organic and limit params', async () => {
    await ga4.landingPages('ws-1', 30, { organic: true, limit: 10 });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('organic=true');
    expect(url).toContain('limit=10');
  });

  it('ga4.landingPages omits organic and limit when not provided', async () => {
    await ga4.landingPages('ws-1', 30);
    const [url] = mockedGet.mock.calls[0];
    expect(url).not.toContain('organic=');
    expect(url).not.toContain('limit=');
  });
});

describe('src/api/analytics — gscAdmin', () => {
  it('gscAdmin.overview encodes workspaceId and gscSiteUrl', async () => {
    await gscAdmin.overview('ws-1', 'site-1', 'https://example.com/', 30);
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('/api/google/search-overview/site-1');
    expect(url).toContain('workspaceId=ws-1');
    expect(url).toContain('gscSiteUrl=');
    expect(url).toContain('days=30');
  });

  it('gscAdmin.trend uses get so provider failures surface', async () => {
    await gscAdmin.trend('ws-1', 'site-1', 'https://example.com/', 7);
    expect(mockedGet).toHaveBeenCalled();
  });

  it('gscAdmin.chat uses post with workspaceId merged into body', async () => {
    const body = { question: 'What is CTR?', context: { page: '/about' } };
    await gscAdmin.chat('ws-1', 'site-1', body);
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/google/search-chat/site-1',
      { ...body, workspaceId: 'ws-1' },
    );
  });
});

describe('src/api/analytics — fetchClientIntelligence', () => {
  it('calls get with correct url and returns the server intelligence payload', async () => {
    mockedGet.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      assembledAt: '2024-01-01',
      tier: 'free',
      insightsSummary: null,
      pipelineStatus: null,
    });
    const result = await fetchClientIntelligence('ws-1');
    expect(mockedGet).toHaveBeenCalled();
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/intelligence/ws-1');
    expect(result.workspaceId).toBe('ws-1');
  });

  it('does not return a fallback intelligence timestamp when the request fails', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchClientIntelligence('ws-1')).rejects.toThrow('network down');
    expect(mockedGetSafe).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/workspaces.ts
// ═══════════════════════════════════════════════════════════════════════════

import { workspaces, publicWorkspaces } from '../../src/api/workspaces';

describe('src/api/workspaces — workspaces', () => {
  it('workspaces.list calls GET /api/workspaces', async () => {
    await workspaces.list();
    expect(mockedGet).toHaveBeenCalledWith('/api/workspaces');
  });

  it('workspaces.getById calls GET with workspace id in path', async () => {
    await workspaces.getById('ws-abc');
    expect(mockedGet).toHaveBeenCalledWith('/api/workspaces/ws-abc');
  });

  it('workspaces.create calls post with name body', async () => {
    await workspaces.create({ name: 'Test Workspace' });
    expect(mockedPost).toHaveBeenCalledWith('/api/workspaces', { name: 'Test Workspace' });
  });

  it('workspaces.update calls patch with body', async () => {
    await workspaces.update('ws-1', { name: 'Updated' });
    expect(mockedPatch).toHaveBeenCalledWith('/api/workspaces/ws-1', { name: 'Updated' });
  });

  it('workspaces.remove calls del with correct path', async () => {
    await workspaces.remove('ws-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/workspaces/ws-1');
  });

  it('workspaces.getSuppressions calls GET with wsId in path', async () => {
    await workspaces.getSuppressions('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/workspaces/ws-1/audit-suppressions');
  });

  it('workspaces.addSuppression calls post with check in body', async () => {
    await workspaces.addSuppression('ws-1', 'missing-alt-text');
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/audit-suppressions',
      { check: 'missing-alt-text' },
    );
  });

  it('workspaces.removeSuppression calls del with check and pageSlug', async () => {
    await workspaces.removeSuppression('ws-1', 'missing-alt-text', '/about');
    expect(mockedDel).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/audit-suppressions',
      { check: 'missing-alt-text', pageSlug: '/about' },
    );
  });

  it('workspaces.updateClientUser calls patch with correct path and body', async () => {
    await workspaces.updateClientUser('ws-1', 'user-1', { name: 'Alice' });
    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/client-users/user-1',
      { name: 'Alice' },
    );
  });

  it('workspaces.removeClientUser calls del', async () => {
    await workspaces.removeClientUser('ws-1', 'user-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/workspaces/ws-1/client-users/user-1');
  });

  it('workspaces.deletePageState calls del with page state path', async () => {
    await workspaces.deletePageState('ws-1', 'page-xyz');
    expect(mockedDel).toHaveBeenCalledWith('/api/workspaces/ws-1/page-states/page-xyz');
  });
});

describe('src/api/workspaces — publicWorkspaces', () => {
  it('publicWorkspaces.getInfo uses getOptional', async () => {
    await publicWorkspaces.getInfo('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/workspace/ws-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/platform.ts
// ═══════════════════════════════════════════════════════════════════════════

import { jobs, roadmap, features, notifications, workspaceOverview, workspaceHome, workspaceBadges, integrationHealth, observability } from '../../src/api/platform';

describe('src/api/platform — jobs', () => {
  it('jobs.list calls GET /api/jobs', async () => {
    await jobs.list();
    expect(mockedGet).toHaveBeenCalledWith('/api/jobs');
  });

  it('jobs.get calls GET with jobId in path', async () => {
    await jobs.get('job-123');
    expect(mockedGet).toHaveBeenCalledWith('/api/jobs/job-123');
  });

  it('jobs.create calls post with body', async () => {
    await jobs.create({ type: 'audit' });
    expect(mockedPost).toHaveBeenCalledWith('/api/jobs', { type: 'audit' });
  });

  it('jobs.cancel calls del with jobId', async () => {
    await jobs.cancel('job-456');
    expect(mockedDel).toHaveBeenCalledWith('/api/jobs/job-456');
  });
});

describe('src/api/platform — roadmap', () => {
  it('roadmap.get calls GET /api/roadmap', async () => {
    await roadmap.get();
    expect(mockedGet).toHaveBeenCalledWith('/api/roadmap');
  });

  it('roadmap.updateItem URL-encodes itemId and sprintId', async () => {
    await roadmap.updateItem('item 1', 'sprint 1', { status: 'done' });
    const [url] = mockedPatch.mock.calls[0];
    expect(url).toContain('/api/roadmap/item/item%201');
    expect(url).toContain('sprintId=sprint%201');
  });

  it('roadmap.updateItem handles numeric itemId', async () => {
    await roadmap.updateItem(42, 'sprint-a', { status: 'in_progress' });
    const [url] = mockedPatch.mock.calls[0];
    expect(url).toContain('/api/roadmap/item/42');
  });
});

describe('src/api/platform — features', () => {
  it('features.get calls GET /api/features', async () => {
    await features.get();
    expect(mockedGet).toHaveBeenCalledWith('/api/features');
  });
});

describe('src/api/platform — notifications', () => {
  it('notifications.list calls getSafe with empty array fallback', async () => {
    await notifications.list();
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/notifications', []);
  });

  it('notifications.markRead calls patch with empty body', async () => {
    await notifications.markRead('notif-1');
    expect(mockedPatch).toHaveBeenCalledWith('/api/notifications/notif-1/read', {});
  });

  it('notifications.markAllRead calls post', async () => {
    await notifications.markAllRead();
    expect(mockedPost).toHaveBeenCalledWith('/api/notifications/mark-all-read');
  });
});

describe('src/api/platform — workspaceHome', () => {
  it('workspaceHome.get uses default days=28', async () => {
    await workspaceHome.get('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/workspace-home/ws-1?days=28');
  });

  it('workspaceHome.get uses custom days param', async () => {
    await workspaceHome.get('ws-1', 90);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/workspace-home/ws-1?days=90');
  });
});

describe('src/api/platform — workspaceBadges', () => {
  it('workspaceBadges.get calls GET with wsId', async () => {
    await workspaceBadges.get('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/workspace-badges/ws-1');
  });
});

describe('src/api/platform — integrationHealth', () => {
  it('integrationHealth.get calls GET with wsId', async () => {
    await integrationHealth.get('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/integrations/health/ws-1');
  });
});

describe('src/api/platform — observability', () => {
  it('observability.get uses default days=14', async () => {
    await observability.get('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/observability/ws-1?days=14');
  });

  it('observability.get uses custom days', async () => {
    await observability.get('ws-1', 30);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('days=30');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/misc.ts — selected exports
// ═══════════════════════════════════════════════════════════════════════════

import { requests, publicRequests, approvals, activity, annotations, anomalies, chat, recommendations, redirects, keywordFeedback, trackedKeywords, businessPriorities, auth, stripe, settings, salesReport } from '../../src/api/misc';

describe('src/api/misc — requests', () => {
  it('requests.list with no params calls GET /api/requests', async () => {
    await requests.list();
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/requests');
  });

  it('requests.list with workspaceId appends query', async () => {
    await requests.list({ workspaceId: 'ws-1' });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
  });

  it('requests.create calls post with body', async () => {
    await requests.create({ title: 'Fix SEO' });
    expect(mockedPost).toHaveBeenCalledWith('/api/requests', { title: 'Fix SEO' });
  });

  it('requests.update calls patch with id and body', async () => {
    await requests.update('req-1', { status: 'done' });
    expect(mockedPatch).toHaveBeenCalledWith('/api/requests/req-1', { status: 'done' });
  });

  it('requests.remove calls del', async () => {
    await requests.remove('req-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/requests/req-1');
  });

  it('requests.addNote calls post on notes subpath', async () => {
    await requests.addNote('req-1', { text: 'Note here' });
    expect(mockedPost).toHaveBeenCalledWith('/api/requests/req-1/notes', { text: 'Note here' });
  });
});

describe('src/api/misc — publicRequests', () => {
  it('publicRequests.list uses getSafe with empty array fallback', async () => {
    await publicRequests.list('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/public/requests/ws-1', []);
  });

  it('publicRequests.create calls post', async () => {
    await publicRequests.create('ws-1', { title: 'Topic idea' });
    expect(mockedPost).toHaveBeenCalledWith('/api/public/requests/ws-1', { title: 'Topic idea' });
  });

  it('publicRequests.addNote calls post on notes subpath', async () => {
    await publicRequests.addNote('ws-1', 'req-1', { text: 'Thanks' });
    expect(mockedPost).toHaveBeenCalledWith('/api/public/requests/ws-1/req-1/notes', { text: 'Thanks' });
  });
});

describe('src/api/misc — approvals', () => {
  it('approvals.list uses getSafe with empty array fallback', async () => {
    await approvals.list('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/approvals/ws-1', []);
  });

  it('approvals.create calls post with note in body', async () => {
    await approvals.create('ws-1', { type: 'content', note: 'Please review' });
    const [url, body] = mockedPost.mock.calls[0];
    expect(url).toBe('/api/approvals/ws-1');
    expect((body as Record<string, unknown>).note).toBe('Please review');
  });

  it('approvals.remove calls del', async () => {
    await approvals.remove('ws-1', 'batch-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/approvals/ws-1/batch-1');
  });

  it('approvals.remind calls post on remind subpath', async () => {
    await approvals.remind('ws-1', 'batch-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/approvals/ws-1/batch-1/remind');
  });

  it('approvals.publicUpdate calls patch', async () => {
    await approvals.publicUpdate('ws-1', 'batch-1', { status: 'approved' });
    expect(mockedPatch).toHaveBeenCalledWith('/api/public/approvals/ws-1/batch-1', { status: 'approved' });
  });
});

describe('src/api/misc — activity', () => {
  it('activity.list uses getSafe with limit in query', async () => {
    await activity.list('ws-1');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
    expect(url).toContain('limit=8');
  });

  it('activity.list with custom limit', async () => {
    await activity.list('ws-1', 50);
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('limit=50');
  });

  it('activity.publicList includes limit in query', async () => {
    await activity.publicList('ws-1');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/activity/ws-1');
    expect(url).toContain('limit=20');
  });
});

describe('src/api/misc — annotations', () => {
  it('annotations.list uses getSafe', async () => {
    await annotations.list('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/annotations/ws-1', []);
  });

  it('annotations.create calls post with body', async () => {
    await annotations.create('ws-1', { text: 'Published new post' });
    expect(mockedPost).toHaveBeenCalledWith('/api/annotations/ws-1', { text: 'Published new post' });
  });

  it('annotations.remove calls del', async () => {
    await annotations.remove('ws-1', 'ann-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/annotations/ws-1/ann-1');
  });

  it('annotations.publicList uses getSafe', async () => {
    await annotations.publicList('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/public/annotations/ws-1', []);
  });
});

describe('src/api/misc — anomalies', () => {
  it('anomalies.list uses getSafe', async () => {
    await anomalies.list('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/anomalies/ws-1', []);
  });

  it('anomalies.listAll uses getSafe', async () => {
    await anomalies.listAll();
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/anomalies', []);
  });

  it('anomalies.dismiss calls post on dismiss subpath', async () => {
    await anomalies.dismiss('anom-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/anomalies/anom-1/dismiss');
  });

  it('anomalies.acknowledge calls post on acknowledge subpath', async () => {
    await anomalies.acknowledge('anom-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/anomalies/anom-1/acknowledge');
  });

  it('anomalies.scan calls post on scan path', async () => {
    await anomalies.scan();
    expect(mockedPost).toHaveBeenCalledWith('/api/anomalies/scan');
  });
});

describe('src/api/misc — chat', () => {
  it('chat.adminAsk calls post with body', async () => {
    const body = { workspaceId: 'ws-1', question: 'How is SEO?', sessionId: 'sess-1' };
    await chat.adminAsk(body);
    expect(mockedPost).toHaveBeenCalledWith('/api/admin-chat', body);
  });

  it('chat.publicAsk calls post on public search-chat endpoint', async () => {
    const body = { question: 'What are my rankings?', context: {}, sessionId: 'sess-2' };
    await chat.publicAsk('ws-1', body);
    expect(mockedPost).toHaveBeenCalledWith('/api/public/search-chat/ws-1', body);
  });

  it('chat.sessions with channel appends query', async () => {
    await chat.sessions('ws-1', 'advisor');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('?channel=advisor');
  });

  it('chat.sessions without channel has no query param', async () => {
    await chat.sessions('ws-1');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).not.toContain('?channel=');
  });

  it('chat.session uses getOptional', async () => {
    await chat.session('ws-1', 'sess-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/chat-sessions/ws-1/sess-1');
  });
});

describe('src/api/misc — recommendations', () => {
  it('recommendations.list uses getOptional', async () => {
    await recommendations.list('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/recommendations/ws-1');
  });

  it('recommendations.generate calls post', async () => {
    await recommendations.generate('ws-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/public/recommendations/ws-1/generate');
  });

  it('recommendations.update calls patch', async () => {
    await recommendations.update('ws-1', 'rec-1', { dismissed: true });
    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/public/recommendations/ws-1/rec-1',
      { dismissed: true },
    );
  });

  it('recommendations.remove calls del', async () => {
    await recommendations.remove('ws-1', 'rec-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/public/recommendations/ws-1/rec-1');
  });
});

describe('src/api/misc — redirects', () => {
  it('does not expose list/save wrappers for nonexistent webflow redirect routes', () => {
    expect('list' in redirects).toBe(false);
    expect('save' in redirects).toBe(false);
  });

  it('redirects.scan appends workspaceId when provided', async () => {
    await redirects.scan('site-1', 'ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
  });

  it('redirects.scan omits workspaceId when not provided', async () => {
    await redirects.scan('site-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).not.toContain('workspaceId=');
  });

  it('redirects.snapshot uses getOptional', async () => {
    await redirects.snapshot('site-1');
    expect(mockedGetOptional).toHaveBeenCalled();
  });
});

describe('src/api/misc — keywordFeedback', () => {
  it('keywordFeedback.get uses getSafe', async () => {
    await keywordFeedback.get('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/public/keyword-feedback/ws-1', []);
  });

  it('keywordFeedback.submit calls post', async () => {
    await keywordFeedback.submit('ws-1', { keyword: 'seo tips', vote: 'up' });
    expect(mockedPost).toHaveBeenCalledWith('/api/public/keyword-feedback/ws-1', { keyword: 'seo tips', vote: 'up' });
  });

  it('keywordFeedback.remove URL-encodes keyword in query string', async () => {
    await keywordFeedback.remove('ws-1', 'seo tips & tricks');
    const [url] = mockedDel.mock.calls[0];
    expect(url).toContain('keyword=seo%20tips%20%26%20tricks');
  });
});

describe('src/api/misc — trackedKeywords', () => {
  it('trackedKeywords.get uses getSafe', async () => {
    await trackedKeywords.get('ws-1');
    const [url, fallback] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/tracked-keywords/ws-1');
    expect(fallback).toEqual({ keywords: [] });
  });

  it('trackedKeywords.add calls post with keyword body', async () => {
    await trackedKeywords.add('ws-1', 'local seo services');
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/public/tracked-keywords/ws-1',
      { keyword: 'local seo services' },
    );
  });

  it('trackedKeywords.remove calls del with keyword body', async () => {
    await trackedKeywords.remove('ws-1', 'local seo services');
    expect(mockedDel).toHaveBeenCalledWith(
      '/api/public/tracked-keywords/ws-1',
      { keyword: 'local seo services' },
    );
  });
});

describe('src/api/misc — businessPriorities', () => {
  it('businessPriorities.get uses get with the public route', async () => {
    await businessPriorities.get('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/public/business-priorities/ws-1');
  });

  it('businessPriorities.save posts priorities and expectedUpdatedAt', async () => {
    await businessPriorities.save('ws-1', {
      priorities: [{ text: 'Grow', category: 'growth' }],
      expectedUpdatedAt: null,
    });
    expect(mockedPost).toHaveBeenCalledWith('/api/public/business-priorities/ws-1', {
      priorities: [{ text: 'Grow', category: 'growth' }],
      expectedUpdatedAt: null,
    });
  });
});

describe('src/api/misc — auth', () => {
  it('auth.logout calls post on logout endpoint', async () => {
    await auth.logout();
    expect(mockedPost).toHaveBeenCalledWith('/api/auth/logout');
  });
});

describe('src/api/misc — stripe', () => {
  it('stripe.getConfig uses getOptional', async () => {
    await stripe.getConfig();
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/stripe/config');
  });

  it('stripe.saveKeys calls post with body', async () => {
    await stripe.saveKeys({ secretKey: 'sk_test_1', publishableKey: 'pk_test_1' });
    expect(mockedPost).toHaveBeenCalledWith('/api/stripe/config/keys', {
      secretKey: 'sk_test_1',
      publishableKey: 'pk_test_1',
    });
  });

  it('stripe.deleteConfig calls del', async () => {
    await stripe.deleteConfig();
    expect(mockedDel).toHaveBeenCalledWith('/api/stripe/config');
  });
});

describe('src/api/misc — settings', () => {
  it('settings.getFeatures uses getOptional', async () => {
    await settings.getFeatures('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/settings/ws-1/features');
  });

  it('settings.updateFeatures calls patch', async () => {
    await settings.updateFeatures('ws-1', { enableSchemaReview: true });
    expect(mockedPatch).toHaveBeenCalledWith('/api/settings/ws-1/features', { enableSchemaReview: true });
  });
});

describe('src/api/misc — salesReport', () => {
  it('salesReport.get calls GET /api/sales-report', async () => {
    await salesReport.get();
    expect(mockedGet).toHaveBeenCalledWith('/api/sales-report');
  });

  it('salesReport.refresh calls post', async () => {
    await salesReport.refresh();
    expect(mockedPost).toHaveBeenCalledWith('/api/sales-report/refresh');
  });

  it('salesReport.list uses getSafe', async () => {
    await salesReport.list();
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/sales-reports', []);
  });

  it('salesReport.getById uses getOptional', async () => {
    await salesReport.getById('report-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/sales-report/report-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/clientActions.ts
// ═══════════════════════════════════════════════════════════════════════════

import { clientActions } from '../../src/api/clientActions';

describe('src/api/clientActions', () => {
  it('clientActions.list calls GET with wsId in path', async () => {
    await clientActions.list('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/client-actions/ws-1');
  });

  it('clientActions.create calls post with body', async () => {
    const body = {
      sourceType: 'insight' as const,
      title: 'Fix title tag',
      summary: 'Your title tag is too long',
    };
    await clientActions.create('ws-1', body);
    expect(mockedPost).toHaveBeenCalledWith('/api/client-actions/ws-1', body);
  });

  it('clientActions.update calls patch with partial body', async () => {
    await clientActions.update('ws-1', 'action-1', { status: 'approved' });
    expect(mockedPatch).toHaveBeenCalledWith('/api/client-actions/ws-1/action-1', { status: 'approved' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/intelligence.ts
// ═══════════════════════════════════════════════════════════════════════════

import { intelligenceApi } from '../../src/api/intelligence';

describe('src/api/intelligence — intelligenceApi', () => {
  it('getIntelligence with no slices calls GET without qs', async () => {
    await intelligenceApi.getIntelligence('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/intelligence/ws-1');
  });

  it('getIntelligence with slices appends slices param', async () => {
    await intelligenceApi.getIntelligence('ws-1', ['seo', 'brand'] as const);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('slices=seo%2Cbrand');
  });

  it('getIntelligence with pagePath appends pagePath', async () => {
    await intelligenceApi.getIntelligence('ws-1', undefined, '/about');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('pagePath=%2Fabout');
  });

  it('getIntelligence with learningsDomain appends learningsDomain', async () => {
    await intelligenceApi.getIntelligence('ws-1', undefined, undefined, 'content');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('learningsDomain=content');
  });

  it('getHealth calls GET /api/intelligence/health', async () => {
    await intelligenceApi.getHealth();
    expect(mockedGet).toHaveBeenCalledWith('/api/intelligence/health', undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/diagnostics.ts
// ═══════════════════════════════════════════════════════════════════════════

import { diagnostics } from '../../src/api/diagnostics';

describe('src/api/diagnostics', () => {
  it('diagnostics.list calls GET with workspaceId in path', async () => {
    await diagnostics.list('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/workspaces/ws-1/diagnostics');
  });

  it('diagnostics.get calls GET with reportId in path', async () => {
    await diagnostics.get('ws-1', 'report-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/workspaces/ws-1/diagnostics/report-1');
  });

  it('diagnostics.getForInsight calls GET with by-insight subpath', async () => {
    await diagnostics.getForInsight('ws-1', 'insight-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/workspaces/ws-1/diagnostics/by-insight/insight-1');
  });

  it('diagnostics.run creates a job via POST to /api/jobs', async () => {
    await diagnostics.run('ws-1', 'insight-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/jobs', {
      type: 'deep-diagnostic',
      params: { workspaceId: 'ws-1', insightId: 'insight-1' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/outcomes.ts
// ═══════════════════════════════════════════════════════════════════════════

import { outcomesApi, clientOutcomesApi } from '../../src/api/outcomes';

describe('src/api/outcomes — outcomesApi', () => {
  it('getActions without filters calls getSafe with base URL', async () => {
    await outcomesApi.getActions('ws-1');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toBe('/api/outcomes/ws-1/actions');
  });

  it('getActions with type filter appends type param', async () => {
    await outcomesApi.getActions('ws-1', 'content_refreshed');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('type=content_refreshed');
  });

  it('getActions with type and score filter appends both params', async () => {
    await outcomesApi.getActions('ws-1', 'seo_edit', 'win');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('type=seo_edit');
    expect(url).toContain('score=win');
  });

  it('getScorecard uses getSafe with null fallback', async () => {
    await outcomesApi.getScorecard('ws-1');
    const [url, fallback] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/scorecard');
    expect(fallback).toBeNull();
  });

  it('getTopWins uses getSafe with empty array fallback', async () => {
    await outcomesApi.getTopWins('ws-1');
    const [url, fallback] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/outcomes/ws-1/top-wins');
    expect(fallback).toEqual([]);
  });

  it('getOverview uses getSafe', async () => {
    await outcomesApi.getOverview();
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toBe('/api/outcomes/overview');
  });

  it('addNote calls post with note body', async () => {
    await outcomesApi.addNote('ws-1', 'action-1', 'Great result!');
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/outcomes/ws-1/actions/action-1/note',
      { note: 'Great result!' },
    );
  });

  it('getPlaybooks uses getSafe with empty array fallback', async () => {
    await outcomesApi.getPlaybooks('ws-1');
    const [, fallback] = mockedGetSafe.mock.calls[0];
    expect(fallback).toEqual([]);
  });
});

describe('src/api/outcomes — clientOutcomesApi', () => {
  it('getSummary uses getSafe with null fallback', async () => {
    await clientOutcomesApi.getSummary('ws-1');
    const [url, fallback] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/outcomes/ws-1/summary');
    expect(fallback).toBeNull();
  });

  it('getWins uses getSafe with empty array fallback', async () => {
    await clientOutcomesApi.getWins('ws-1');
    const [url, fallback] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/public/outcomes/ws-1/wins');
    expect(fallback).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/localSeo.ts
// ═══════════════════════════════════════════════════════════════════════════

import { localSeo } from '../../src/api/localSeo';

describe('src/api/localSeo', () => {
  it('localSeo.get with default options has no query string', async () => {
    await localSeo.get('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/local-seo/ws-1');
  });

  it('localSeo.get with includeSnapshots=false appends query', async () => {
    await localSeo.get('ws-1', { includeSnapshots: false });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('includeSnapshots=false');
  });

  it('localSeo.getSummary calls get with includeSnapshots=false', async () => {
    await localSeo.getSummary('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('includeSnapshots=false');
  });

  it('localSeo.update calls put with body', async () => {
    await localSeo.update('ws-1', { primaryMarket: 'New York' } as never);
    expect(mockedPut).toHaveBeenCalledWith('/api/local-seo/ws-1', { primaryMarket: 'New York' });
  });

  it('localSeo.locationLookup builds query from city and country', async () => {
    await localSeo.locationLookup('ws-1', { city: 'Austin', country: 'US' });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('city=Austin');
    expect(url).toContain('country=US');
  });

  it('localSeo.locationLookup includes stateOrRegion when provided', async () => {
    await localSeo.locationLookup('ws-1', { city: 'Austin', country: 'US', stateOrRegion: 'TX' });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('stateOrRegion=TX');
  });

  it('localSeo.refresh calls post with empty body when no body provided', async () => {
    await localSeo.refresh('ws-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/local-seo/ws-1/refresh', {});
  });

  it('localSeo.setPrimaryMarket calls put with empty body', async () => {
    await localSeo.setPrimaryMarket('ws-1', 'market-1');
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/local-seo/ws-1/markets/market-1/set-primary',
      {},
    );
  });

  it('localSeo.createLocation calls post with body', async () => {
    await localSeo.createLocation('ws-1', { name: 'Downtown Office', city: 'Austin', country: 'US' });
    expect(mockedPost).toHaveBeenCalledWith('/api/local-seo/ws-1/locations', {
      name: 'Downtown Office',
      city: 'Austin',
      country: 'US',
    });
  });

  it('localSeo.deleteLocation calls del', async () => {
    await localSeo.deleteLocation('ws-1', 'loc-1');
    expect(mockedDel).toHaveBeenCalledWith('/api/local-seo/ws-1/locations/loc-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/keywordCommandCenter.ts
// ═══════════════════════════════════════════════════════════════════════════

import { keywordCommandCenter } from '../../src/api/keywordCommandCenter';

describe('src/api/keywordCommandCenter', () => {
  it('summary calls GET on summary subpath', async () => {
    await keywordCommandCenter.summary('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/webflow/keyword-command-center/ws-1/summary');
  });

  it('rows with no filters has no query string', async () => {
    await keywordCommandCenter.rows('ws-1', {});
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/webflow/keyword-command-center/ws-1/rows');
  });

  it('initial with no filters has no query string', async () => {
    await keywordCommandCenter.initial('ws-1', {});
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/webflow/keyword-command-center/ws-1/initial');
  });

  it('rows with filter appends filter param', async () => {
    await keywordCommandCenter.rows('ws-1', { filter: 'no_keyword', page: 2 });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('filter=no_keyword');
    expect(url).toContain('page=2');
  });

  it('rows with search param appends search', async () => {
    await keywordCommandCenter.rows('ws-1', { search: 'seo guide', pageSize: 50 });
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('search=seo+guide');
    expect(url).toContain('pageSize=50');
  });

  it('detail URL-encodes keyword', async () => {
    await keywordCommandCenter.detail('ws-1', 'local seo services');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('keyword=local+seo+services');
    expect(url).toContain('/api/webflow/keyword-command-center/ws-1/detail');
  });

  it('action calls post with body', async () => {
    const body = { action: 'assign', pageId: 'p1', keyword: 'seo' } as never;
    await keywordCommandCenter.action('ws-1', body);
    expect(mockedPost).toHaveBeenCalledWith('/api/webflow/keyword-command-center/ws-1/actions', body);
  });

  it('bulkAction calls post on bulk actions path', async () => {
    const body = { action: 'remove', pageIds: ['p1', 'p2'] } as never;
    await keywordCommandCenter.bulkAction('ws-1', body);
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/webflow/keyword-command-center/ws-1/actions/bulk',
      body,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/suggested-briefs.ts
// ═══════════════════════════════════════════════════════════════════════════

import { suggestedBriefsApi } from '../../src/api/suggested-briefs';

describe('src/api/suggested-briefs', () => {
  it('list without includeAll has no qs', async () => {
    await suggestedBriefsApi.list('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/suggested-briefs/ws-1');
  });

  it('list with includeAll=true appends all=true', async () => {
    await suggestedBriefsApi.list('ws-1', true);
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/suggested-briefs/ws-1?all=true');
  });

  it('get calls GET with briefId in path', async () => {
    await suggestedBriefsApi.get('ws-1', 'brief-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/suggested-briefs/ws-1/brief-1');
  });

  it('update calls patch with status', async () => {
    await suggestedBriefsApi.update('ws-1', 'brief-1', 'accepted');
    expect(mockedPatch).toHaveBeenCalledWith('/api/suggested-briefs/ws-1/brief-1', { status: 'accepted' });
  });

  it('snooze calls post with until body', async () => {
    await suggestedBriefsApi.snooze('ws-1', 'brief-1', '2024-06-01');
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/suggested-briefs/ws-1/brief-1/snooze',
      { until: '2024-06-01' },
    );
  });

  it('dismiss calls post with empty body', async () => {
    await suggestedBriefsApi.dismiss('ws-1', 'brief-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/suggested-briefs/ws-1/brief-1/dismiss', {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/api/briefing.ts — URL construction + response unwrapping
// ═══════════════════════════════════════════════════════════════════════════

import { briefingApi } from '../../src/api/briefing';

describe('src/api/briefing', () => {
  it('listDrafts calls GET on drafts subpath', async () => {
    mockedGet.mockResolvedValueOnce({ drafts: [] });
    await briefingApi.listDrafts('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/briefing/ws-1/drafts');
  });

  it('listDrafts unwraps the drafts array from response', async () => {
    const drafts = [{ id: 'd1' }];
    mockedGet.mockResolvedValueOnce({ drafts });
    const result = await briefingApi.listDrafts('ws-1');
    expect(result).toEqual(drafts);
  });

  it('updateStories calls patch with stories body', async () => {
    mockedPatch.mockResolvedValueOnce({ draft: { id: 'd1' } });
    const stories = [{ id: 's1', content: 'Hello' }] as never;
    await briefingApi.updateStories('ws-1', 'd1', stories);
    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/stories',
      { stories },
    );
  });

  it('approve calls post on approve subpath', async () => {
    mockedPost.mockResolvedValueOnce({ draft: { id: 'd1' } });
    await briefingApi.approve('ws-1', 'd1', 'LGTM');
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/approve',
      { adminNote: 'LGTM' },
    );
  });

  it('publish calls post on publish subpath', async () => {
    mockedPost.mockResolvedValueOnce({ draft: { id: 'd1' } });
    await briefingApi.publish('ws-1', 'd1');
    const [url] = mockedPost.mock.calls[0];
    expect(url).toBe('/api/briefing/ws-1/drafts/d1/publish');
  });

  it('skip calls post on skip subpath', async () => {
    mockedPost.mockResolvedValueOnce({ draft: { id: 'd1' } });
    await briefingApi.skip('ws-1', 'd1', 'Not relevant');
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/briefing/ws-1/drafts/d1/skip',
      { adminNote: 'Not relevant' },
    );
  });

  it('generateNow calls post on generate-now subpath', async () => {
    mockedPost.mockResolvedValueOnce({ accepted: true });
    await briefingApi.generateNow('ws-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/briefing/ws-1/generate-now', {});
  });

  it('getPublished calls GET on public briefing endpoint', async () => {
    mockedGet.mockResolvedValueOnce({ briefing: null });
    await briefingApi.getPublished('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/public/briefing/ws-1');
  });
});
