import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the API client
vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

import { get, post, patch, del } from '../../src/api/client';
import {
  useWorkspaces,
  useCreateWorkspace,
  useDeleteWorkspace,
  useLinkSite,
  useUnlinkSite,
} from '../../src/hooks/admin/useWorkspaces';

const mockGet = vi.mocked(get);
const mockPost = vi.mocked(post);
const mockPatch = vi.mocked(patch);
const mockDel = vi.mocked(del);

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const WORKSPACES = [
  { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com', folder: 'acme', createdAt: '2025-01-01' },
  { id: 'ws-2', name: 'Beta', folder: 'beta', createdAt: '2025-02-01' },
];

describe('useWorkspaces', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches workspaces from /api/workspaces', async () => {
    mockGet.mockResolvedValueOnce(WORKSPACES);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/workspaces');
    expect(result.current.data).toEqual(WORKSPACES);
  });

  it('returns error on API failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useWorkspaces(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});

describe('useCreateWorkspace', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('posts to /api/workspaces with name', async () => {
    const newWs = { id: 'ws-3', name: 'NewCo', folder: 'newco', createdAt: '2025-03-01' };
    mockPost.mockResolvedValueOnce(newWs);
    const { result } = renderHook(() => useCreateWorkspace(), { wrapper: createWrapper() });
    result.current.mutate({ name: 'NewCo' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/api/workspaces', { name: 'NewCo' });
  });
});

describe('useDeleteWorkspace', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes workspace by id', async () => {
    mockDel.mockResolvedValueOnce({});
    const { result } = renderHook(() => useDeleteWorkspace(), { wrapper: createWrapper() });
    result.current.mutate('ws-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDel).toHaveBeenCalledWith('/api/workspaces/ws-1');
  });
});

describe('useLinkSite', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('patches workspace with site info', async () => {
    mockPatch.mockResolvedValueOnce({ ...WORKSPACES[1], webflowSiteId: 'site-2', webflowSiteName: 'beta.com' });
    const { result } = renderHook(() => useLinkSite(), { wrapper: createWrapper() });
    result.current.mutate({ workspaceId: 'ws-2', siteId: 'site-2', siteName: 'beta.com' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/api/workspaces/ws-2', {
      webflowSiteId: 'site-2',
      webflowSiteName: 'beta.com',
      webflowToken: undefined,
    });
  });
});

describe('useUnlinkSite', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('patches workspace to clear site info', async () => {
    mockPatch.mockResolvedValueOnce({ ...WORKSPACES[0], webflowSiteId: '', webflowSiteName: '' });
    const { result } = renderHook(() => useUnlinkSite(), { wrapper: createWrapper() });
    result.current.mutate('ws-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/api/workspaces/ws-1', {
      webflowSiteId: '',
      webflowSiteName: '',
    });
  });
});
