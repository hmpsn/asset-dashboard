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

  afterAll(() => {
    if (insertedIds.length > 0) {
      db.prepare(
        `DELETE FROM content_briefs WHERE workspace_id = ?`,
      ).run(TEST_WORKSPACE);
    }
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
});
