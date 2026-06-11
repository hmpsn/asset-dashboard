// tests/component/useSchemaSuggesterGeneration.fix-handoff.test.tsx
//
// Regression test for the PI "Add Schema" fix-handoff auto-trigger (W2 review).
//
// Bug: the fix-handoff effect schedules `generateSinglePage(pageId)` via setTimeout
// and returned that timer as the effect's cleanup. Because `generateSinglePage` is a
// useCallback that depends on the caller's `onPageGenerated` — which SchemaSuggester
// passed as an INLINE arrow (new identity every render) — the effect re-ran on every
// render. After the first resolve set `fixConsumed.current = true`, each re-run's
// cleanup cancelled the pending timer and the consume-guard blocked rescheduling, so
// the handoff silently no-op'd: generation never fired.
//
// Fix: the trigger timer lives in a ref cleared only on unmount (not in the effect's
// returned cleanup), AND SchemaSuggester memoizes `onPageGenerated`. This test exercises
// re-render churn during the 600ms window with an *unstable* onPageGenerated and asserts
// the single-page generation endpoint is hit exactly once.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── API client mock ─────────────────────────────────────────────────────────────
const getMock = vi.fn();
const postMock = vi.fn();
const getSafeMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  getSafe: (...args: unknown[]) => getSafeMock(...args),
}));

// ── Background tasks mock (no jobs in play for the single-page handoff) ──────────
vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: vi.fn(), cancelJob: vi.fn() }),
}));

// ── Schema snapshot mock (no persisted snapshot) ─────────────────────────────────
vi.mock('../../src/hooks/admin', () => ({
  useSchemaSnapshot: () => ({ data: null }),
}));

import { useSchemaSuggesterGeneration } from '../../src/components/schema/useSchemaSuggesterGeneration';

const SITE_ID = 'site-1';
const TARGET_PAGE = { _id: 'page-abc', title: 'Pricing', slug: '/pricing' };

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  getMock.mockReset();
  postMock.mockReset();
  getSafeMock.mockReset();
  // Page inventory load (fetchAllPageOptions) resolves to the target page so the
  // slug → pageId resolution succeeds.
  getMock.mockResolvedValue([TARGET_PAGE]);
  // schema-page-types fetch
  getSafeMock.mockResolvedValue({ pageTypes: {} });
  // single-page generation
  postMock.mockResolvedValue({ pageId: TARGET_PAGE._id, slug: TARGET_PAGE.slug, results: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSchemaSuggesterGeneration — fix-handoff auto-trigger', () => {
  it('fires single-page generation exactly once despite onPageGenerated identity churn', async () => {
    const fixContext = { pageSlug: '/pricing', targetRoute: 'seo-schema' as const };

    // Each render passes a brand-new onPageGenerated arrow — reproducing the
    // SchemaSuggester inline-arrow churn that made generateSinglePage unstable.
    const { rerender, unmount } = renderHook(
      () =>
        useSchemaSuggesterGeneration({
          siteId: SITE_ID,
          workspaceId: 'ws-1',
          fixContext,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onPageGenerated: () => {},
        }),
      { wrapper },
    );

    // Let the async page-inventory load settle so availablePages is populated and
    // the slug resolves to a pageId. Flush microtasks between renders.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Churn: force several re-renders DURING the 600ms trigger window. With the bug,
    // each re-render's effect cleanup cancelled the pending timer.
    for (let i = 0; i < 5; i++) {
      rerender();
      await act(async () => {
        await Promise.resolve();
      });
    }

    // No generation should have fired yet (timer still pending).
    expect(postMock).not.toHaveBeenCalled();

    // Advance past the 600ms trigger delay.
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    const singlePageCalls = postMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/schema-suggestions/') && url.includes('/page'),
    );
    expect(singlePageCalls).toHaveLength(1);
    expect(singlePageCalls[0][1]).toMatchObject({ pageId: TARGET_PAGE._id });

    unmount();
  });

  it('does not re-fire generation on further re-renders after it has fired once', async () => {
    const fixContext = { pageSlug: '/pricing', targetRoute: 'seo-schema' as const };
    const { rerender, unmount } = renderHook(
      () =>
        useSchemaSuggesterGeneration({
          siteId: SITE_ID,
          workspaceId: 'ws-1',
          fixContext,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onPageGenerated: () => {},
        }),
      { wrapper },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    // Churn again post-fire — the consume guard must prevent any second trigger.
    for (let i = 0; i < 5; i++) {
      rerender();
      await act(async () => {
        vi.advanceTimersByTime(700);
        await Promise.resolve();
      });
    }

    const singlePageCalls = postMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/schema-suggestions/') && url.includes('/page'),
    );
    expect(singlePageCalls).toHaveLength(1);

    unmount();
  });
});
