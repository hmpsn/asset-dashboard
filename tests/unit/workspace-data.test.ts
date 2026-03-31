// tests/unit/workspace-data.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Webflow API
vi.mock('../../server/webflow-pages.js', () => ({
  listPages: vi.fn(),
  filterPublishedPages: vi.fn((pages: unknown[]) => pages),
}));

// IMPORTANT: getWorkspace is in server/workspaces.ts, NOT server/db/workspaces.ts
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));

import { getWorkspacePages, getWorkspaceAllPages, invalidatePageCache } from '../../server/workspace-data.js';
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
    expect(pages.every((p: any) => p.draft !== true)).toBe(true);
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
