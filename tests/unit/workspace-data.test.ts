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

import { getWorkspacePages, invalidatePageCache } from '../../server/workspace-data.js';
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

  it('returns empty array when workspace has no token', async () => {
    mockGetWorkspace.mockReturnValue({ id: 'ws-1', webflowToken: null } as any);
    const pages = await getWorkspacePages('ws-1', 'site-1');
    expect(pages).toEqual([]);
    expect(mockListPages).not.toHaveBeenCalled();
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
