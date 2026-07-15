/**
 * Unit tests for src/api/seo.ts — typed HTTP wrappers.
 *
 * Strategy: mock the entire api/client module so we can assert that each
 * wrapper calls the right HTTP verb, constructs the correct URL (including
 * query params), and passes through the right body.
 *
 * We also test the two URL-builder helpers (workspaceQuery /
 * appendWorkspaceQuery) via the exported wrappers that exercise them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the api client ──────────────────────────────────────────────────────
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
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue(undefined),
}));

// Also mock the schema re-export so seo.ts loads cleanly
vi.mock('../../src/api/schema', () => ({
  schema: {},
  schemaValidation: {},
  schemaPlan: {},
  schemaImpact: {},
}));

// Mock stream utils (bulkGenerateAltText uses readNdjsonStream)
vi.mock('../../src/api/streamUtils', () => ({
  readNdjsonStream: vi.fn().mockResolvedValue(undefined),
}));

import {
  audit,
  auditSchedules,
  reports,
  keywords,
  rankTracking,
  backlinks,
  webflow,
  seoSuggestions,
  contentPerformance,
  aeoReview,
  competitor,
  seoBulkJobs,
  seoChangeTracker,
  pageWeight,
  generateAltText,
  bulkGenerateAltText,
} from '../../src/api/seo';
import { get, getSafe, getOptional, post, patch, put, del } from '../../src/api/client';

const mockedGet = vi.mocked(get);
const mockedGetSafe = vi.mocked(getSafe);
const mockedGetOptional = vi.mocked(getOptional);
const mockedPost = vi.mocked(post);
const mockedPatch = vi.mocked(patch);
const mockedPut = vi.mocked(put);
const mockedDel = vi.mocked(del);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── audit ────────────────────────────────────────────────────────────────────

describe('src/api/seo — audit', () => {
  it('audit.summary uses getOptional with correct url', async () => {
    await audit.summary('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/audit-summary/ws-1');
  });

  it('audit.detail uses getOptional with correct url', async () => {
    await audit.detail('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/audit-detail/ws-1');
  });

  it('audit.publicAudit uses getOptional with correct url', async () => {
    await audit.publicAudit('ws-2');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/audit/ws-2');
  });

  it('audit.traffic uses getSafe appending workspaceId query', async () => {
    await audit.traffic('ws-1', 'site-1');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/audit-traffic/site-1');
    expect(url).toContain('workspaceId=ws-1');
  });

  it('audit.traffic omits workspaceId when not provided but still has siteId in path', async () => {
    // called with empty-string workspaceId — appendWorkspaceQuery should omit query
    await audit.traffic('', 'site-2');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/audit-traffic/site-2');
    expect(url).not.toContain('workspaceId=');
  });
});

// ── auditSchedules ───────────────────────────────────────────────────────────

describe('src/api/seo — auditSchedules', () => {
  it('auditSchedules.get uses getOptional', async () => {
    await auditSchedules.get('ws-3');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/audit-schedules/ws-3');
  });

  it('auditSchedules.save uses post with body', async () => {
    const body = { interval: 'weekly' };
    await auditSchedules.save('ws-3', body);
    expect(mockedPost).toHaveBeenCalledWith('/api/audit-schedules/ws-3', body);
  });

  it('auditSchedules.enable uses put with enabled:true', async () => {
    await auditSchedules.enable('ws-3');
    expect(mockedPut).toHaveBeenCalledWith('/api/audit-schedules/ws-3', { enabled: true });
  });
});

// ── reports ──────────────────────────────────────────────────────────────────

describe('src/api/seo — reports', () => {
  it('reports.history appends workspaceId', async () => {
    await reports.history('ws-1', 'site-1');
    const [url] = mockedGetSafe.mock.calls[0];
    expect(url).toContain('/api/reports/site-1/history');
    expect(url).toContain('workspaceId=ws-1');
  });

  it('reports.latest uses getOptional', async () => {
    await reports.latest('ws-1', 'site-1');
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('/api/reports/site-1/latest');
  });

  it('reports.snapshot merges workspaceId into body', async () => {
    await reports.snapshot('ws-1', 'site-1', { foo: 'bar' });
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/reports/site-1/snapshot',
      { foo: 'bar', workspaceId: 'ws-1' },
    );
  });

  it('reports.updateAction uses patch', async () => {
    await reports.updateAction('snap-1', 'action-1', { done: true });
    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/reports/snapshot/snap-1/actions/action-1',
      { done: true },
    );
  });

  it('reports.removeAction uses del', async () => {
    await reports.removeAction('snap-1', 'action-1');
    expect(mockedDel).toHaveBeenCalledWith(
      '/api/reports/snapshot/snap-1/actions/action-1',
    );
  });
});

// ── keywords ─────────────────────────────────────────────────────────────────

describe('src/api/seo — keywords', () => {
  it('keywords.strategy uses getOptional', async () => {
    await keywords.strategy('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/seo-strategy/ws-1');
  });

  it('keywords.patchStrategy uses patch', async () => {
    await keywords.patchStrategy('ws-1', { pageMap: [] });
    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/webflow/keyword-strategy/ws-1',
      { pageMap: [] },
    );
  });

  it('keywords.strategyDiff uses getOptional', async () => {
    await keywords.strategyDiff('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith(
      '/api/webflow/keyword-strategy/ws-1/diff',
    );
  });

  it('keywords.seoStatus uses getOptional (no args)', async () => {
    await keywords.seoStatus();
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/seo/status');
  });

  it('keywords.providerStatus uses getOptional (no args)', async () => {
    await keywords.providerStatus();
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/seo/providers/status');
  });

  it('keywords.saveCompetitors uses post with domains', async () => {
    await keywords.saveCompetitors('ws-1', ['a.com', 'b.com']);
    expect(mockedPost).toHaveBeenCalledWith('/api/seo/competitors/ws-1', {
      domains: ['a.com', 'b.com'],
    });
  });
});

// ── rankTracking ─────────────────────────────────────────────────────────────

describe('src/api/seo — rankTracking', () => {
  it('rankTracking.keywords uses get', async () => {
    await rankTracking.keywords('ws-1');
    expect(mockedGet).toHaveBeenCalledWith('/api/rank-tracking/ws-1/keywords');
  });

  it('rankTracking.latest uses getSafe', async () => {
    await rankTracking.latest('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/rank-tracking/ws-1/latest', []);
  });

  it('rankTracking.history uses getSafe', async () => {
    await rankTracking.history('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith(
      '/api/public/rank-tracking/ws-1/history',
      [],
    );
  });

  it('rankTracking.removeKeyword URL-encodes the keyword', async () => {
    await rankTracking.removeKeyword('ws-1', 'best coffee shops');
    const [url] = mockedDel.mock.calls[0];
    expect(url).toContain('best%20coffee%20shops');
  });

  it('rankTracking.togglePin URL-encodes the keyword', async () => {
    await rankTracking.togglePin('ws-1', 'seo tips & tricks');
    const [url] = mockedPatch.mock.calls[0];
    expect(url).toContain('seo%20tips%20%26%20tricks');
    expect(url).toContain('/pin');
  });

  it('rankTracking.snapshot uses post (no body)', async () => {
    await rankTracking.snapshot('ws-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/rank-tracking/ws-1/snapshot');
  });

  it('rankTracking.publicLatest uses getSafe', async () => {
    await rankTracking.publicLatest('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith(
      '/api/public/rank-tracking/ws-1/latest',
      [],
    );
  });
});

// ── backlinks ────────────────────────────────────────────────────────────────

describe('src/api/seo — backlinks', () => {
  it('backlinks.get uses getOptional', async () => {
    await backlinks.get('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/backlinks/ws-1');
  });
});

// ── webflow ──────────────────────────────────────────────────────────────────

describe('src/api/seo — webflow', () => {
  it('webflow.sites encodes token', async () => {
    await webflow.sites('my-token');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/webflow/sites?token=my-token');
  });

  it('webflow.pages includes workspaceId query when provided', async () => {
    await webflow.pages('site-1', 'ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/webflow/pages/site-1');
    expect(url).toContain('workspaceId=ws-1');
  });

  it('webflow.pages omits workspaceId when not provided', async () => {
    await webflow.pages('site-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/webflow/pages/site-1');
    expect(url).not.toContain('workspaceId');
  });

  it('webflow.publish uses post', async () => {
    await webflow.publish('site-1', 'ws-1');
    expect(mockedPost).toHaveBeenCalled();
    const [url] = mockedPost.mock.calls[0];
    expect(url).toContain('/api/webflow/publish/site-1');
  });

  it('webflow.updatePageSeo uses put with body', async () => {
    await webflow.updatePageSeo('page-1', { title: 'New Title' });
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/webflow/pages/page-1/seo',
      { title: 'New Title' },
    );
  });

  it('webflow.removeAsset uses del with encoded siteId', async () => {
    await webflow.removeAsset('asset-1', 'site-1');
    const [url] = mockedDel.mock.calls[0];
    expect(url).toContain('/api/webflow/assets/asset-1');
    expect(url).toContain('siteId=site-1');
  });
});

// ── seoSuggestions ───────────────────────────────────────────────────────────

describe('src/api/seo — seoSuggestions', () => {
  it('seoSuggestions.list uses get without field param when omitted', async () => {
    await seoSuggestions.list('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/webflow/seo-suggestions/ws-1');
  });

  it('seoSuggestions.list includes field param when provided', async () => {
    await seoSuggestions.list('ws-1', 'title');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('field=title');
  });

  it('seoSuggestions.select uses patch with selectedIndex', async () => {
    await seoSuggestions.select('ws-1', 'sugg-1', 2);
    expect(mockedPatch).toHaveBeenCalledWith(
      '/api/webflow/seo-suggestions/ws-1/sugg-1',
      { selectedIndex: 2 },
    );
  });

  it('seoSuggestions.apply uses post', async () => {
    await seoSuggestions.apply('ws-1', ['s1', 's2']);
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/webflow/seo-suggestions/ws-1/apply',
      { suggestionIds: ['s1', 's2'] },
    );
  });

  it('seoSuggestions.dismiss uses del with body', async () => {
    await seoSuggestions.dismiss('ws-1', ['s1']);
    expect(mockedDel).toHaveBeenCalledWith(
      '/api/webflow/seo-suggestions/ws-1',
      { suggestionIds: ['s1'] },
    );
  });
});

// ── contentPerformance ───────────────────────────────────────────────────────

describe('src/api/seo — contentPerformance', () => {
  it('contentPerformance.get without days', async () => {
    await contentPerformance.get('ws-1');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toBe('/api/content-performance/ws-1');
  });

  it('contentPerformance.publicGet uses getOptional', async () => {
    await contentPerformance.publicGet('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/public/content-performance/ws-1');
  });

  it('does not expose the removed phantom refresh mutation', () => {
    expect(contentPerformance).not.toHaveProperty('refresh');
  });
});

// ── aeoReview ────────────────────────────────────────────────────────────────

describe('src/api/seo — aeoReview', () => {
  it('aeoReview.get uses getOptional', async () => {
    await aeoReview.get('ws-1');
    expect(mockedGetOptional).toHaveBeenCalledWith('/api/aeo-review/ws-1');
  });

  it('aeoReview.analyze uses post', async () => {
    await aeoReview.analyze('ws-1');
    expect(mockedPost).toHaveBeenCalledWith('/api/aeo-review/ws-1/analyze');
  });

  it('aeoReview.pageDetail URL-encodes path', async () => {
    await aeoReview.pageDetail('ws-1', '/about us');
    const [url] = mockedGet.mock.calls[0];
    expect(url).toContain('/api/aeo-review/ws-1/page?path=');
    expect(url).toContain('%2Fabout%20us');
  });
});

// ── competitor ───────────────────────────────────────────────────────────────

describe('src/api/seo — competitor', () => {
  it('competitor.compare uses post', async () => {
    await competitor.compare({ myUrl: 'a.com', competitorUrl: 'b.com' });
    expect(mockedPost).toHaveBeenCalledWith('/api/competitor-compare', {
      myUrl: 'a.com',
      competitorUrl: 'b.com',
    });
  });

  it('competitor.snapshot uses getOptional with encoded URLs', async () => {
    await competitor.snapshot('a.com', 'b.com');
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('/api/competitor-compare-snapshot');
    expect(url).toContain('myUrl=');
    expect(url).toContain('competitorUrl=');
  });
});

// ── seoBulkJobs ──────────────────────────────────────────────────────────────

describe('src/api/seo — seoBulkJobs', () => {
  it('seoBulkJobs.bulkAnalyze uses post with correct url', async () => {
    await seoBulkJobs.bulkAnalyze('ws-1', { pages: [{ pageId: 'p1', title: 'Page 1' }] });
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/seo/ws-1/bulk-analyze',
      { pages: [{ pageId: 'p1', title: 'Page 1' }] },
    );
  });

  it('seoBulkJobs.bulkRewrite uses post with correct url', async () => {
    const body = { siteId: 's1', pages: [{ pageId: 'p1', title: 'P' }], field: 'title' as const };
    await seoBulkJobs.bulkRewrite('ws-1', body);
    expect(mockedPost).toHaveBeenCalledWith('/api/seo/ws-1/bulk-rewrite', body);
  });

  it('seoBulkJobs.bulkAcceptFixes uses post with correct url', async () => {
    const body = {
      siteId: 's1',
      fixes: [{ pageId: 'p1', check: 'title-length', suggestedFix: 'New Title' }],
    };
    await seoBulkJobs.bulkAcceptFixes('ws-1', body);
    expect(mockedPost).toHaveBeenCalledWith('/api/seo/ws-1/bulk-accept-fixes', body);
  });
});

// ── seoChangeTracker ─────────────────────────────────────────────────────────

describe('src/api/seo — seoChangeTracker', () => {
  it('seoChangeTracker.get uses getSafe with empty array fallback', async () => {
    await seoChangeTracker.get('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/seo-changes/ws-1', []);
  });

  it('seoChangeTracker.impact uses getSafe with empty array fallback', async () => {
    await seoChangeTracker.impact('ws-1');
    expect(mockedGetSafe).toHaveBeenCalledWith('/api/seo-change-impact/ws-1', []);
  });
});

// ── pageWeight ───────────────────────────────────────────────────────────────

describe('src/api/seo — pageWeight', () => {
  it('pageWeight.pagespeedSnapshot defaults to mobile strategy', async () => {
    await pageWeight.pagespeedSnapshot('site-1', 'ws-1');
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('strategy=mobile');
  });

  it('pageWeight.pagespeedSnapshot uses desktop strategy when specified', async () => {
    await pageWeight.pagespeedSnapshot('site-1', 'ws-1', 'desktop');
    const [url] = mockedGetOptional.mock.calls[0];
    expect(url).toContain('strategy=desktop');
  });
});

// ── generateAltText ──────────────────────────────────────────────────────────

describe('src/api/seo — generateAltText', () => {
  it('calls post with correct workspace/asset URL', async () => {
    mockedPost.mockResolvedValueOnce({ altText: 'A dog', updated: true });
    const result = await generateAltText('ws-1', 'asset-1', { imageUrl: 'https://img.com/x.jpg' });
    expect(mockedPost).toHaveBeenCalledWith(
      '/api/webflow/ws-1/generate-alt/asset-1',
      { imageUrl: 'https://img.com/x.jpg' },
    );
    expect(result).toEqual({ altText: 'A dog', updated: true });
  });
});

// ── bulkGenerateAltText ──────────────────────────────────────────────────────

describe('src/api/seo — bulkGenerateAltText', () => {
  it('throws ApiError on non-ok HTTP response', async () => {
    // bulkGenerateAltText calls fetch directly (not the client wrappers)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({ error: 'Server error' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      bulkGenerateAltText('ws-1', { siteId: 's1', assets: [] }, vi.fn()),
    ).rejects.toThrow('Server error');

    vi.unstubAllGlobals();
  });

  it('throws ApiError when response has no body (streaming not supported)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      bulkGenerateAltText('ws-1', { siteId: 's1', assets: [] }, vi.fn()),
    ).rejects.toThrow('Streaming not supported');

    vi.unstubAllGlobals();
  });
});
