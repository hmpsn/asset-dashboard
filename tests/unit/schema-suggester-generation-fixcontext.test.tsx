// tests/unit/schema-suggester-generation-fixcontext.test.tsx
//
// W2.3 Bug #4 — the Page Intelligence "Add Schema" handoff sends pageSlug (not pageId).
// The single-page generation route requires a pageId, so the receiver must resolve
// the slug → pageId against the loaded page inventory before triggering generation.
// Without this the jump silently no-ops.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const getMock = vi.fn();
const postMock = vi.fn();
const getSafeMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  get: (...a: unknown[]) => getMock(...a),
  post: (...a: unknown[]) => postMock(...a),
  getSafe: (...a: unknown[]) => getSafeMock(...a),
}));

vi.mock('../../src/hooks/admin', () => ({
  useSchemaSnapshot: () => ({ data: null }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: vi.fn(), cancelJob: vi.fn() }),
}));

import { useSchemaSuggesterGeneration } from '../../src/components/schema/useSchemaSuggesterGeneration';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

const ALL_PAGES = [
  { _id: 'page-about-id', title: 'About', slug: 'about-us' },
  { _id: 'page-home-id', title: 'Home', slug: '/' },
];

beforeEach(() => {
  vi.useFakeTimers();
  getMock.mockReset().mockResolvedValue(ALL_PAGES);
  postMock.mockReset().mockResolvedValue({ pageId: 'page-about-id', pageTitle: 'About', slug: 'about-us', url: '', existingSchemas: [], suggestedSchemas: [] });
  getSafeMock.mockReset().mockResolvedValue({ pageTypes: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Bug #4 — fixContext pageSlug → pageId resolution', () => {
  it('resolves pageSlug to a pageId and triggers single-page generation', async () => {
    renderHook(
      () => useSchemaSuggesterGeneration({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        fixContext: { targetRoute: 'seo-schema', pageSlug: 'about-us', pageName: 'About' },
        onPageGenerated: vi.fn(),
      }),
      { wrapper },
    );

    // Let the async page-inventory load resolve (effect deps update), then advance
    // past the 600ms trigger delay so generateSinglePage fires.
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });

    const call = postMock.mock.calls.find(c => String(c[0]).includes('/schema-suggestions/site-1/page'));
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ pageId: 'page-about-id' });
  });

  it('does not trigger generation for a slug that matches no loaded page', async () => {
    renderHook(
      () => useSchemaSuggesterGeneration({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        fixContext: { targetRoute: 'seo-schema', pageSlug: 'nonexistent-page' },
        onPageGenerated: vi.fn(),
      }),
      { wrapper },
    );

    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    const genCall = postMock.mock.calls.find(c => String(c[0]).includes('/schema-suggestions/site-1/page'));
    expect(genCall).toBeUndefined();
  });

  it('ignores fixContext for a different targetRoute', async () => {
    renderHook(
      () => useSchemaSuggesterGeneration({
        siteId: 'site-1',
        workspaceId: 'ws-1',
        fixContext: { targetRoute: 'seo-editor', pageSlug: 'about-us' },
        onPageGenerated: vi.fn(),
      }),
      { wrapper },
    );

    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });

    const genCall = postMock.mock.calls.find(c => String(c[0]).includes('/schema-suggestions/site-1/page'));
    expect(genCall).toBeUndefined();
  });
});
