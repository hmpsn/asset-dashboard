// tests/unit/workspace-data.test.ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';

// Mock the Webflow API
vi.mock('../../server/webflow-pages.js', () => ({
  listPages: vi.fn(),
  filterPublishedPages: vi.fn((pages: unknown[]) => pages),
}));

// IMPORTANT: getWorkspace is in server/workspaces.ts, NOT server/db/workspaces.ts
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));

import { getWorkspacePages, getWorkspaceAllPages, invalidatePageCache, getContentPipelineSummary, invalidateContentPipelineCache } from '../../server/workspace-data.js';
import { listPages } from '../../server/webflow-pages.js';
import { getWorkspace } from '../../server/workspaces.js';

const mockListPages = vi.mocked(listPages);
const mockGetWorkspace = vi.mocked(getWorkspace);

describe('getWorkspacePages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePageCache('ws-1');
    invalidatePageCache('ws-2');
    mockGetWorkspace.mockReturnValue({ id: 'ws-1', webflowToken: 'token-123' } as any);
    mockListPages.mockResolvedValue([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'About', slug: 'about' },
    ] as any);
  });

  it('fetches pages from Webflow API on cache miss', async () => {
    const pages = await getWorkspacePages('ws-1', 'site-1');
    expect(pages).toHaveLength(2);
    expect(mockListPages).toHaveBeenCalledOnce();
    expect(mockListPages).toHaveBeenCalledWith('site-1', 'token-123');
  });

  it('returns cached pages on subsequent calls', async () => {
    await getWorkspacePages('ws-1', 'site-1');
    await getWorkspacePages('ws-1', 'site-1');
    expect(mockListPages).toHaveBeenCalledOnce();
  });

  it('falls through to listPages when workspace has no token (env var fallback)', async () => {
    mockGetWorkspace.mockReturnValue({ id: 'ws-1', webflowToken: null } as any);
    mockListPages.mockResolvedValue([]);
    const pages = await getWorkspacePages('ws-1', 'site-1');
    expect(pages).toEqual([]);
    // listPages IS called with undefined — webflowFetch falls back to WEBFLOW_API_TOKEN env var
    expect(mockListPages).toHaveBeenCalledWith('site-1', undefined);
  });

  it('returns fresh data after cache invalidation', async () => {
    await getWorkspacePages('ws-1', 'site-1');
    invalidatePageCache('ws-1');
    await getWorkspacePages('ws-1', 'site-1');
    expect(mockListPages).toHaveBeenCalledTimes(2);
  });

  it('maintains separate caches per workspace', async () => {
    mockGetWorkspace.mockImplementation((id: string) =>
      ({ id, webflowToken: `token-${id}` }) as any
    );
    await getWorkspacePages('ws-1', 'site-1');
    await getWorkspacePages('ws-2', 'site-2');
    expect(mockListPages).toHaveBeenCalledTimes(2);
    invalidatePageCache('ws-1');
    await getWorkspacePages('ws-2', 'site-2');
    expect(mockListPages).toHaveBeenCalledTimes(2); // ws-2 cache hit
  });

  it('returns stale cached pages when refresh fails after TTL expiry (regression)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

    mockListPages.mockResolvedValueOnce([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'About', slug: 'about' },
    ] as any);

    const first = await getWorkspacePages('ws-1', 'site-1');
    expect(first.map((p: any) => p.id)).toEqual(['p1', 'p2']);

    // Past PAGE_CACHE_TTL (10m) but within LRU max staleness (24h).
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    mockListPages.mockRejectedValueOnce(new Error('webflow transient outage'));

    const second = await getWorkspacePages('ws-1', 'site-1');
    expect(second.map((p: any) => p.id)).toEqual(['p1', 'p2']);
    expect(mockListPages).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('does not repopulate cache from an in-flight fetch invalidated mid-request', async () => {
    let resolveFetch: ((pages: any[]) => void) | null = null;
    mockListPages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as any,
    );

    const inflight = getWorkspacePages('ws-1', 'site-1');
    invalidatePageCache('ws-1');
    resolveFetch?.([{ id: 'p-stale', title: 'Stale', slug: 'stale' }]);
    const first = await inflight;
    expect(first).toEqual([{ id: 'p-stale', title: 'Stale', slug: 'stale' }]);

    mockListPages.mockResolvedValueOnce([{ id: 'p-fresh', title: 'Fresh', slug: 'fresh' }] as any);
    const second = await getWorkspacePages('ws-1', 'site-1');
    expect(second).toEqual([{ id: 'p-fresh', title: 'Fresh', slug: 'fresh' }]);
    expect(mockListPages).toHaveBeenCalledTimes(2);
  });
});

describe('getWorkspaceAllPages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePageCache('ws-1');
    mockGetWorkspace.mockReturnValue({ id: 'ws-1', webflowToken: 'token-123' } as any);
  });

  it('includes CMS template pages (pages with collectionId)', async () => {
    mockListPages.mockResolvedValue([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'Blog Posts', slug: 'blog', collectionId: 'coll-1' },
      { id: 'p3', title: 'About', slug: 'about' },
    ] as any);
    const pages = await getWorkspaceAllPages('ws-1', 'site-1');
    expect(pages).toHaveLength(3);
    expect(pages.some((p: any) => p.collectionId === 'coll-1')).toBe(true);
  });

  it('excludes draft pages', async () => {
    mockListPages.mockResolvedValue([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'Draft Page', slug: 'draft', draft: true },
      { id: 'p3', title: 'CMS Template', slug: 'blog', collectionId: 'coll-1' },
    ] as any);
    const pages = await getWorkspaceAllPages('ws-1', 'site-1');
    expect(pages).toHaveLength(2);
    expect(pages.length > 0 && pages.every((p: any) => p.draft !== true)).toBe(true);
  });

  it('excludes archived pages', async () => {
    mockListPages.mockResolvedValue([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'Old Page', slug: 'old', archived: true },
      { id: 'p3', title: 'CMS Draft', slug: 'products', collectionId: 'coll-2', draft: true },
    ] as any);
    const pages = await getWorkspaceAllPages('ws-1', 'site-1');
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe('p1');
  });

  it('shares cache with getWorkspacePages (single API call)', async () => {
    mockListPages.mockResolvedValue([
      { id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'Blog', slug: 'blog', collectionId: 'coll-1' },
    ] as any);
    await getWorkspaceAllPages('ws-1', 'site-1');
    await getWorkspacePages('ws-1', 'site-1');
    expect(mockListPages).toHaveBeenCalledOnce(); // shared cache
  });
});

describe('computeContentPipelineSummary — briefs.byStatus', () => {
  const TEST_WORKSPACE = 'brief-byStatus-test-ws';
  const insertedIds: string[] = [];

  function insertBrief(id: string, status: string): void {
    db.prepare(
      `INSERT OR IGNORE INTO content_briefs
         (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
          suggested_meta_desc, outline, word_count_target, intent, audience,
          competitor_insights, internal_link_suggestions, created_at, status)
       VALUES
         (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
          @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
          @competitor_insights, @internal_link_suggestions, @created_at, @status)`,
    ).run({
      id,
      workspace_id: TEST_WORKSPACE,
      target_keyword: 'test keyword',
      secondary_keywords: '[]',
      suggested_title: 'Test Title',
      suggested_meta_desc: 'Test meta description for brief',
      outline: '[]',
      word_count_target: 1200,
      intent: 'informational',
      audience: 'marketers',
      competitor_insights: 'none',
      internal_link_suggestions: '[]',
      created_at: new Date().toISOString(),
      status,
    });
    insertedIds.push(id);
  }

  function insertContentRequest(id: string, status: string): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO content_topic_requests
         (id, workspace_id, topic, target_keyword, intent, priority, rationale, status, requested_at, updated_at)
       VALUES
         (@id, @workspace_id, @topic, @target_keyword, @intent, @priority, @rationale, @status, @requested_at, @updated_at)`,
    ).run({
      id,
      workspace_id: TEST_WORKSPACE,
      topic: 'Pipeline status test',
      target_keyword: 'pipeline status',
      intent: 'informational',
      priority: 'medium',
      rationale: 'Test request status bucketing',
      status,
      requested_at: now,
      updated_at: now,
    });
  }

  function insertContentPost(id: string, status: string, publishedAt: string | null = null): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO content_posts (
         id, workspace_id, brief_id, target_keyword, title, meta_description,
         introduction, sections, conclusion, total_word_count, target_word_count,
         status, created_at, updated_at, published_at)
       VALUES (
         @id, @workspace_id, @brief_id, @target_keyword, @title, @meta_description,
         '', '[]', '', 0, 1000, @status, @created_at, @updated_at, @published_at)`,
    ).run({
      id,
      workspace_id: TEST_WORKSPACE,
      brief_id: `brief-${id}`,
      target_keyword: 'pipeline post',
      title: 'Pipeline Post',
      meta_description: 'Pipeline post meta',
      status,
      created_at: now,
      updated_at: now,
      published_at: publishedAt,
    });
  }

  function insertWorkOrder(id: string, status: string): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO work_orders
         (id, workspace_id, payment_id, product_type, status, page_ids, quantity, created_at, updated_at)
       VALUES
         (@id, @workspace_id, @payment_id, @product_type, @status, @page_ids, @quantity, @created_at, @updated_at)`,
    ).run({
      id,
      workspace_id: TEST_WORKSPACE,
      payment_id: `pay-${id}`,
      product_type: 'fix_meta',
      status,
      page_ids: '[]',
      quantity: 1,
      created_at: now,
      updated_at: now,
    });
  }

  afterAll(() => {
    if (insertedIds.length > 0) {
      db.prepare(
        `DELETE FROM content_briefs WHERE workspace_id = ?`,
      ).run(TEST_WORKSPACE);
    }
    db.prepare(`DELETE FROM content_topic_requests WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM content_posts WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM work_orders WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM content_pipeline_cache WHERE workspace_id = ?`).run(TEST_WORKSPACE);
  });

  it('returns {} byStatus for unknown workspace', () => {
    const summary = getContentPipelineSummary('workspace-does-not-exist-xyz');
    expect(summary.briefs.byStatus).toEqual({});
    expect(summary.briefs.total).toBe(0);
  });

  it('populates byStatus with counts grouped by status and non-zero inProgress sum', () => {
    insertBrief('brief-status-test-1', 'draft');
    insertBrief('brief-status-test-2', 'in_review');
    insertBrief('brief-status-test-3', 'in_review');

    // Invalidate cache so computeContentPipelineSummary runs fresh
    invalidateContentPipelineCache(TEST_WORKSPACE);

    const summary = getContentPipelineSummary(TEST_WORKSPACE);

    expect(summary.briefs.total).toBe(3);
    expect(summary.briefs.byStatus).toEqual({ draft: 1, in_review: 2 });

    const inProgressStatuses = ['in_review', 'ai_generated', 'draft'];
    const inProgress = inProgressStatuses.reduce(
      (sum, k) => sum + (summary.briefs.byStatus[k] ?? 0), 0,
    );
    expect(inProgress).toBeGreaterThan(0);
  });

  it('maps the full content request lifecycle into summary buckets', () => {
    db.prepare(`DELETE FROM content_topic_requests WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM content_pipeline_cache WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    insertContentRequest('request-status-pending-payment', 'pending_payment');
    insertContentRequest('request-status-requested', 'requested');
    insertContentRequest('request-status-brief-generated', 'brief_generated');
    insertContentRequest('request-status-client-review', 'client_review');
    insertContentRequest('request-status-approved', 'approved');
    insertContentRequest('request-status-changes-requested', 'changes_requested');
    insertContentRequest('request-status-in-progress', 'in_progress');
    insertContentRequest('request-status-post-review', 'post_review');
    insertContentRequest('request-status-delivered', 'delivered');
    insertContentRequest('request-status-published', 'published');
    insertContentRequest('request-status-declined', 'declined');

    invalidateContentPipelineCache(TEST_WORKSPACE);

    const summary = getContentPipelineSummary(TEST_WORKSPACE);
    expect(summary.requests).toEqual({ pending: 5, inProgress: 3, delivered: 2 });
  });

  it('maps each content request status to exactly one canonical summary bucket', () => {
    db.prepare(`DELETE FROM content_topic_requests WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM content_pipeline_cache WHERE workspace_id = ?`).run(TEST_WORKSPACE);

    const cases: Array<[string, keyof ReturnType<typeof getContentPipelineSummary>['requests'] | null]> = [
      ['pending_payment', 'pending'],
      ['requested', 'pending'],
      ['brief_generated', 'pending'],
      ['client_review', 'pending'],
      ['post_review', 'pending'],
      ['approved', 'inProgress'],
      ['changes_requested', 'inProgress'],
      ['in_progress', 'inProgress'],
      ['delivered', 'delivered'],
      ['published', 'delivered'],
      ['declined', null],
    ];

    for (const [status] of cases) insertContentRequest(`request-bucket-${status}`, status);

    invalidateContentPipelineCache(TEST_WORKSPACE);

    const summary = getContentPipelineSummary(TEST_WORKSPACE);
    const expected = cases.reduce(
      (acc, [, bucket]) => {
        if (bucket) acc[bucket]++;
        return acc;
      },
      { pending: 0, inProgress: 0, delivered: 0 },
    );
    expect(summary.requests).toEqual(expected);
  });

  it('derives published post lifecycle from published_at instead of raw post status', () => {
    db.prepare(`DELETE FROM content_posts WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM content_pipeline_cache WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    const publishedAt = '2026-05-26T12:00:00.000Z';
    insertContentPost('post-published-from-draft', 'draft', publishedAt);
    insertContentPost('post-published-from-review', 'review', publishedAt);
    insertContentPost('post-published-from-approved', 'approved', publishedAt);
    insertContentPost('post-active-draft', 'draft');

    invalidateContentPipelineCache(TEST_WORKSPACE);

    const summary = getContentPipelineSummary(TEST_WORKSPACE);
    expect(summary.posts.byStatus.published).toBe(3);
    expect(summary.posts.byStatus.draft).toBe(1);
    expect(summary.posts.byStatus.review ?? 0).toBe(0);
    expect(summary.posts.byStatus.approved ?? 0).toBe(0);
  });

  it('preserves active as outstanding work orders while exposing pending split', () => {
    db.prepare(`DELETE FROM work_orders WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    db.prepare(`DELETE FROM content_pipeline_cache WHERE workspace_id = ?`).run(TEST_WORKSPACE);
    insertWorkOrder('work-order-pending', 'pending');
    insertWorkOrder('work-order-in-progress', 'in_progress');
    insertWorkOrder('work-order-completed', 'completed');
    insertWorkOrder('work-order-cancelled', 'cancelled');

    invalidateContentPipelineCache(TEST_WORKSPACE);

    const summary = getContentPipelineSummary(TEST_WORKSPACE);
    expect(summary.workOrders.active).toBe(2);
    expect(summary.workOrders.pending).toBe(1);
  });
});
