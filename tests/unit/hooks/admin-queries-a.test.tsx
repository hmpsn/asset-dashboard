/**
 * tests/unit/hooks/admin-queries-a.test.tsx
 *
 * Smoke tests for a batch of simple useQuery admin hooks.
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Strategy:
 *  - Mock API modules so no real fetch calls fire.
 *  - Assert enabled/disabled behaviour, loading state, and data shape.
 *  - Keep tests shallow — surface behaviour only, not business logic.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// ── Standard wrapper ────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Mock: src/api/client ────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
}));

import { get } from '../../../src/api/client';
const mockGet = vi.mocked(get);

// ── Mock: src/api/content ───────────────────────────────────────────────────

vi.mock('../../../src/api/content', () => ({
  contentBriefs: {
    list: vi.fn(),
    templateCrossref: vi.fn(),
  },
  contentRequests: {
    list: vi.fn(),
  },
  contentPosts: {
    list: vi.fn(),
    getById: vi.fn(),
    versions: vi.fn(),
  },
}));

import { contentBriefs, contentRequests, contentPosts } from '../../../src/api/content';
const mockBriefsList = vi.mocked(contentBriefs.list);
const mockRequestsList = vi.mocked(contentRequests.list);
const mockPostsList = vi.mocked(contentPosts.list);
const mockPostGetById = vi.mocked(contentPosts.getById);

// ── Mock: src/api/workspaces ────────────────────────────────────────────────

vi.mock('../../../src/api/workspaces', () => ({
  workspaces: {
    getById: vi.fn(),
  },
  publicWorkspaces: {},
}));

// ── Mock: src/api/platform ──────────────────────────────────────────────────

vi.mock('../../../src/api/platform', () => ({
  workspaceHome: {
    get: vi.fn(),
  },
}));

import { workspaceHome } from '../../../src/api/platform';
const mockWorkspaceHomeGet = vi.mocked(workspaceHome.get);

// ── Mock: src/api/intelligence ──────────────────────────────────────────────

vi.mock('../../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: vi.fn(),
  },
}));

import { intelligenceApi } from '../../../src/api/intelligence';
const mockGetIntelligence = vi.mocked(intelligenceApi.getIntelligence);

// ── Mock: src/api/suggested-briefs ─────────────────────────────────────────

vi.mock('../../../src/api/suggested-briefs', () => ({
  suggestedBriefsApi: {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    snooze: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { suggestedBriefsApi as suggestedBriefsApiMock } from '../../../src/api/suggested-briefs';
const mockSuggestedBriefsList = vi.mocked(suggestedBriefsApiMock.list);

// ── Mock: src/api/brand-engine ──────────────────────────────────────────────

vi.mock('../../../src/api/brand-engine', () => ({
  blueprints: {
    list: vi.fn(),
    getById: vi.fn(),
  },
  blueprintVersions: {
    list: vi.fn(),
  },
}));

import { blueprints as blueprintsApi, blueprintVersions as blueprintVersionsApi } from '../../../src/api/brand-engine';
const mockBlueprintsList = vi.mocked(blueprintsApi.list);

// ── Hook imports ────────────────────────────────────────────────────────────

import { useAdminBriefsList, useAdminRequestsList } from '../../../src/hooks/admin/useAdminBriefs';
import { useAdminROI } from '../../../src/hooks/admin/useAdminROI';
import { useAdminPostsList, useAdminPost } from '../../../src/hooks/admin/useAdminPosts';
import { useWorkspaceHomeData } from '../../../src/hooks/admin/useWorkspaceHome';
import { useWorkspaceIntelligence } from '../../../src/hooks/admin/useWorkspaceIntelligence';
import { useAiSuggestedBriefs } from '../../../src/hooks/admin/useAiSuggestedBriefs';
import { useBlueprints } from '../../../src/hooks/admin/useBlueprints';
import { useHealthCheck } from '../../../src/hooks/admin/useHealthCheck';

// ── useAdminBriefsList ──────────────────────────────────────────────────────

describe('useAdminBriefsList', () => {
  beforeEach(() => { mockBriefsList.mockReset(); });

  it('always issues a request (no enabled guard)', () => {
    mockBriefsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminBriefsList('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns empty array data when API resolves with []', async () => {
    mockBriefsList.mockResolvedValue([]);
    const { result } = renderHook(() => useAdminBriefsList('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it('returns brief list data when API resolves', async () => {
    const briefs = [{ id: 'b1', title: 'Brief One' }];
    mockBriefsList.mockResolvedValue(briefs as never);
    const { result } = renderHook(() => useAdminBriefsList('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(briefs));
  });
});

// ── useAdminRequestsList ────────────────────────────────────────────────────

describe('useAdminRequestsList', () => {
  beforeEach(() => { mockRequestsList.mockReset(); });

  it('enters loading state when called with a workspaceId', () => {
    mockRequestsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminRequestsList('ws-2'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns requests data when API resolves', async () => {
    const requests = [{ id: 'r1', title: 'Fix nav' }];
    mockRequestsList.mockResolvedValue(requests as never);
    const { result } = renderHook(() => useAdminRequestsList('ws-2'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(requests));
  });
});

// ── useAdminROI ─────────────────────────────────────────────────────────────

describe('useAdminROI', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('is disabled when workspaceId is empty string', () => {
    const { result } = renderHook(() => useAdminROI(''), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with a valid workspaceId', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminROI('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns ROI data when API resolves', async () => {
    const roi = { totalValue: 5000, monthlyValue: 500 };
    mockGet.mockResolvedValue(roi);
    const { result } = renderHook(() => useAdminROI('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(roi));
  });
});

// ── useAdminPostsList ───────────────────────────────────────────────────────

describe('useAdminPostsList', () => {
  beforeEach(() => { mockPostsList.mockReset(); });

  it('enters loading state when called with a workspaceId', () => {
    mockPostsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminPostsList('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns empty array when API resolves with []', async () => {
    mockPostsList.mockResolvedValue([]);
    const { result } = renderHook(() => useAdminPostsList('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it('returns post list data when API resolves', async () => {
    const posts = [{ id: 'p1', title: 'Post One', status: 'published' }];
    mockPostsList.mockResolvedValue(posts as never);
    const { result } = renderHook(() => useAdminPostsList('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(posts));
  });
});

// ── useAdminPost ────────────────────────────────────────────────────────────

describe('useAdminPost', () => {
  beforeEach(() => { mockPostGetById.mockReset(); });

  it('is disabled when postId is empty string', () => {
    const { result } = renderHook(() => useAdminPost('ws-1', ''), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockPostGetById).not.toHaveBeenCalled();
  });

  it('enters loading state when both wsId and postId are provided', () => {
    mockPostGetById.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminPost('ws-1', 'post-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns post data when API resolves', async () => {
    const post = { id: 'post-1', title: 'My Post', status: 'draft' };
    mockPostGetById.mockResolvedValue(post as never);
    const { result } = renderHook(() => useAdminPost('ws-1', 'post-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(post));
  });
});

// ── useWorkspaceHomeData ────────────────────────────────────────────────────

describe('useWorkspaceHomeData', () => {
  beforeEach(() => { mockWorkspaceHomeGet.mockReset(); });

  it('is disabled when workspaceId is empty string', () => {
    const { result } = renderHook(() => useWorkspaceHomeData(''), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockWorkspaceHomeGet).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with a valid workspaceId', () => {
    mockWorkspaceHomeGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWorkspaceHomeData('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns home data when API resolves', async () => {
    const homeData = { ranks: [], requests: [], contentRequests: [], activity: [], annotations: [], churnSignals: [], workOrders: [], searchData: null, ga4Data: null, comparison: null };
    mockWorkspaceHomeGet.mockResolvedValue(homeData as never);
    const { result } = renderHook(() => useWorkspaceHomeData('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(homeData));
  });
});

// ── useWorkspaceIntelligence ────────────────────────────────────────────────

describe('useWorkspaceIntelligence', () => {
  beforeEach(() => { mockGetIntelligence.mockReset(); });

  it('is disabled when workspaceId is empty string', () => {
    const { result } = renderHook(() => useWorkspaceIntelligence(''), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with a valid workspaceId', () => {
    mockGetIntelligence.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWorkspaceIntelligence('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns intelligence data when API resolves', async () => {
    const intel = { workspaceId: 'ws-1', seo: {}, content: {} };
    mockGetIntelligence.mockResolvedValue(intel as never);
    const { result } = renderHook(() => useWorkspaceIntelligence('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(intel));
  });
});

// ── useAiSuggestedBriefs ────────────────────────────────────────────────────

describe('useAiSuggestedBriefs', () => {
  beforeEach(() => { mockSuggestedBriefsList.mockReset(); });

  it('is disabled when workspaceId is empty string', () => {
    const { result } = renderHook(() => useAiSuggestedBriefs(''), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockSuggestedBriefsList).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with a valid workspaceId', () => {
    mockSuggestedBriefsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAiSuggestedBriefs('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns store data when API resolves', async () => {
    const payload = [{ id: 'b1', workspaceId: 'ws-1', keyword: 'dentist near me', pageUrl: null, source: 'insight', reason: 'High volume gap', priority: 'high', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', resolvedAt: null, snoozedUntil: null, dismissedKeywordHash: null }];
    mockSuggestedBriefsList.mockResolvedValue(payload as never);
    const { result } = renderHook(() => useAiSuggestedBriefs('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(payload));
  });
});

// ── useBlueprints ───────────────────────────────────────────────────────────

describe('useBlueprints', () => {
  beforeEach(() => { mockBlueprintsList.mockReset(); });

  it('is disabled when wsId is empty string', () => {
    const { result } = renderHook(() => useBlueprints(''), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockBlueprintsList).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with a valid wsId', () => {
    mockBlueprintsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useBlueprints('ws-1'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns blueprints data when API resolves', async () => {
    const bps = [{ id: 'bp1', name: 'Homepage Blueprint' }];
    mockBlueprintsList.mockResolvedValue(bps as never);
    const { result } = renderHook(() => useBlueprints('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(bps));
  });
});

// ── useHealthCheck ──────────────────────────────────────────────────────────

describe('useHealthCheck', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('enters loading state on mount (no enabled guard)', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useHealthCheck(), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns health data when API resolves', async () => {
    const health = { hasOpenAIKey: true, hasWebflowToken: false };
    mockGet.mockResolvedValue(health);
    const { result } = renderHook(() => useHealthCheck(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(health));
  });

  it('data is undefined before fetch resolves', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useHealthCheck(), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
  });
});
