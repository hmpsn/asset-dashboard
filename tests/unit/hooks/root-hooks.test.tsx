/**
 * tests/unit/hooks/root-hooks.test.tsx
 *
 * Unit tests for root-level React hooks.
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Hooks covered:
 *   - useToggleSet         (pure state — no QueryClient needed)
 *   - useToast             (pure state — no QueryClient needed)
 *   - useFeatureFlag       (useQuery + FEATURE_FLAGS fallback)
 *   - usePayments          (pure state + callbacks — no QueryClient needed)
 *   - useContentRequests   (pure state + callbacks — no QueryClient needed)
 *   - useRecommendations   (useQuery — needs QueryClient)
 *   - usePageEditStates    (useQuery — needs QueryClient)
 *   - workspaceEventBus    (subscribe/emit utilities — no React needed)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';

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

import { get, getSafe, getOptional, post } from '../../../src/api/client';
const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockGetOptional = vi.mocked(getOptional);
const mockPost = vi.mocked(post);

// ── Imports ─────────────────────────────────────────────────────────────────

import { useToggleSet } from '../../../src/hooks/useToggleSet';
import { useToast } from '../../../src/hooks/useToast';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { FEATURE_FLAGS } from '../../../shared/types/feature-flags';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { usePayments } from '../../../src/hooks/usePayments';
import { useContentRequests } from '../../../src/hooks/useContentRequests';
import { useRecommendations, recommendationAppliesToPage } from '../../../src/hooks/useRecommendations';
import { usePageEditStates } from '../../../src/hooks/usePageEditStates';
import {
  subscribeWorkspaceEvents,
  sendWorkspaceEvent,
  __resetWorkspaceEventBusForTests,
} from '../../../src/hooks/workspaceEventBus';

// ══════════════════════════════════════════════════════════════════════════════
// useToggleSet
// ══════════════════════════════════════════════════════════════════════════════

describe('useToggleSet — initial state', () => {
  it('starts with the provided defaults active', () => {
    const { result } = renderHook(() => useToggleSet(['a', 'b']));
    const [active] = result.current;
    expect(active.has('a')).toBe(true);
    expect(active.has('b')).toBe(true);
  });

  it('starts with an empty set when no defaults are provided', () => {
    const { result } = renderHook(() => useToggleSet([]));
    const [active] = result.current;
    expect(active.size).toBe(0);
  });

  it('does not include items not in defaults', () => {
    const { result } = renderHook(() => useToggleSet(['a']));
    const [active] = result.current;
    expect(active.has('b')).toBe(false);
  });

  it('returns a Set instance', () => {
    const { result } = renderHook(() => useToggleSet(['x']));
    expect(result.current[0]).toBeInstanceOf(Set);
  });

  it('exposes a toggle function as the second element', () => {
    const { result } = renderHook(() => useToggleSet(['a']));
    expect(typeof result.current[1]).toBe('function');
  });
});

describe('useToggleSet — toggle behaviour', () => {
  it('toggles an active item off', () => {
    const { result } = renderHook(() => useToggleSet(['a', 'b']));
    act(() => { result.current[1]('a'); });
    expect(result.current[0].has('a')).toBe(false);
  });

  it('toggles an inactive item on when below max', () => {
    const { result } = renderHook(() => useToggleSet(['a'], { max: 3 }));
    act(() => { result.current[1]('b'); });
    expect(result.current[0].has('b')).toBe(true);
  });

  it('does not remove an item when it would violate min constraint', () => {
    // default min = 1: cannot remove the last active item
    const { result } = renderHook(() => useToggleSet(['a']));
    act(() => { result.current[1]('a'); });
    // 'a' should still be in the set (min constraint prevents removal)
    expect(result.current[0].has('a')).toBe(true);
  });

  it('does not add an item when it would exceed max constraint', () => {
    // max = 2, already have 2 items active
    const { result } = renderHook(() => useToggleSet(['a', 'b'], { max: 2 }));
    act(() => { result.current[1]('c'); });
    expect(result.current[0].has('c')).toBe(false);
    expect(result.current[0].size).toBe(2);
  });

  it('can toggle multiple distinct items', () => {
    const { result } = renderHook(() => useToggleSet(['a'], { max: 3 }));
    act(() => { result.current[1]('b'); });
    act(() => { result.current[1]('c'); });
    expect(result.current[0].has('a')).toBe(true);
    expect(result.current[0].has('b')).toBe(true);
    expect(result.current[0].has('c')).toBe(true);
  });

  it('allows toggling item back on after it was toggled off', () => {
    const { result } = renderHook(() => useToggleSet(['a', 'b']));
    act(() => { result.current[1]('a'); }); // off
    act(() => { result.current[1]('a'); }); // on again
    expect(result.current[0].has('a')).toBe(true);
  });

  it('respects custom min=0 allowing all items to be deactivated', () => {
    const { result } = renderHook(() => useToggleSet(['a'], { min: 0, max: 3 }));
    act(() => { result.current[1]('a'); });
    expect(result.current[0].has('a')).toBe(false);
    expect(result.current[0].size).toBe(0);
  });

  it('preserves other active items when toggling one off', () => {
    const { result } = renderHook(() => useToggleSet(['a', 'b', 'c'], { max: 5 }));
    act(() => { result.current[1]('b'); });
    expect(result.current[0].has('a')).toBe(true);
    expect(result.current[0].has('b')).toBe(false);
    expect(result.current[0].has('c')).toBe(true);
  });

  it('allows exactly max items to be active simultaneously', () => {
    const { result } = renderHook(() => useToggleSet(['a', 'b'], { max: 3 }));
    act(() => { result.current[1]('c'); });
    expect(result.current[0].size).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// useToast
// ══════════════════════════════════════════════════════════════════════════════

describe('useToast — initial state', () => {
  it('starts with no toast (null)', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it('exposes setToast function', () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.setToast).toBe('function');
  });

  it('exposes clearToast function', () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.clearToast).toBe('function');
  });
});

describe('useToast — setToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sets a success toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.setToast({ message: 'Saved!', type: 'success' });
    });
    expect(result.current.toast).toEqual({ message: 'Saved!', type: 'success' });
  });

  it('sets an error toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.setToast({ message: 'Something went wrong', type: 'error' });
    });
    expect(result.current.toast).toEqual({ message: 'Something went wrong', type: 'error' });
  });

  it('replaces the existing toast when called again', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.setToast({ message: 'First', type: 'success' });
    });
    act(() => {
      result.current.setToast({ message: 'Second', type: 'error' });
    });
    expect(result.current.toast?.message).toBe('Second');
    expect(result.current.toast?.type).toBe('error');
  });

  it('auto-dismisses after default duration (5000ms)', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.setToast({ message: 'Auto dismiss', type: 'success' });
    });
    expect(result.current.toast).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.toast).toBeNull();
  });

  it('auto-dismisses after custom duration', () => {
    const { result } = renderHook(() => useToast(2000));
    act(() => {
      result.current.setToast({ message: 'Short', type: 'success' });
    });
    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current.toast).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toast).toBeNull();
  });

  it('clears the toast immediately when setToast(null) is called', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.setToast({ message: 'Visible', type: 'success' });
    });
    act(() => {
      result.current.setToast(null);
    });
    expect(result.current.toast).toBeNull();
  });
});

describe('useToast — clearToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears the current toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.setToast({ message: 'Toast', type: 'success' });
    });
    act(() => {
      result.current.clearToast();
    });
    expect(result.current.toast).toBeNull();
  });

  it('is safe to call when no toast is active', () => {
    const { result } = renderHook(() => useToast());
    expect(() => {
      act(() => { result.current.clearToast(); });
    }).not.toThrow();
  });

  it('cancels the auto-dismiss timer so it does not fire after clear', () => {
    const { result } = renderHook(() => useToast(3000));
    act(() => {
      result.current.setToast({ message: 'T', type: 'success' });
    });
    act(() => { result.current.clearToast(); });
    // Advance past original timer — should not cause any state change
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.toast).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// useFeatureFlag
// ══════════════════════════════════════════════════════════════════════════════

describe('useFeatureFlag — static defaults (loading state)', () => {
  beforeEach(() => {
    // Simulate a pending fetch that never resolves so we test fallback defaults
    mockGet.mockReturnValue(new Promise(() => {}));
  });

  it('returns the static default (false) for a known flag while loading', () => {
    const { result } = renderHook(
      () => useFeatureFlag('copy-engine' as FeatureFlagKey),
      { wrapper: makeWrapper() },
    );
    expect(result.current).toBe(FEATURE_FLAGS['copy-engine']);
    expect(result.current).toBe(false);
  });

  it('returns false for "new-inbox-ia" while loading', () => {
    const { result } = renderHook(
      () => useFeatureFlag('new-inbox-ia' as FeatureFlagKey),
      { wrapper: makeWrapper() },
    );
    expect(result.current).toBe(false);
  });

  it('returns false for "white-label" while loading', () => {
    const { result } = renderHook(
      () => useFeatureFlag('white-label' as FeatureFlagKey),
      { wrapper: makeWrapper() },
    );
    expect(result.current).toBe(false);
  });
});

describe('useFeatureFlag — server response overrides defaults', () => {
  // useFeatureFlag uses raw fetch(), not the api/client wrapper
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true for a flag the server has enabled', async () => {
    const serverFlags = Object.fromEntries(
      Object.keys(FEATURE_FLAGS).map(k => [k, k === 'copy-engine']),
    ) as Record<FeatureFlagKey, boolean>;
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(serverFlags),
    });

    const { result } = renderHook(
      () => useFeatureFlag('copy-engine' as FeatureFlagKey),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false for a flag the server has disabled', async () => {
    const serverFlags = Object.fromEntries(
      Object.keys(FEATURE_FLAGS).map(k => [k, false]),
    ) as Record<FeatureFlagKey, boolean>;
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(serverFlags),
    });

    const { result } = renderHook(
      () => useFeatureFlag('new-inbox-ia' as FeatureFlagKey),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      // After loading completes, still false since server returned false
      expect(result.current).toBe(false);
    });
  });

  it('falls back to static default when fetch fails', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(
      () => useFeatureFlag('copy-engine' as FeatureFlagKey),
      { wrapper: makeWrapper() },
    );

    // Error path: no data → falls back to FEATURE_FLAGS default
    await waitFor(() => {
      expect(result.current).toBe(FEATURE_FLAGS['copy-engine']);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// usePayments
// ══════════════════════════════════════════════════════════════════════════════

function makePaymentsArgs() {
  const setContentRequests = vi.fn();
  const setToast = vi.fn();
  const setRequestedTopics = vi.fn();
  const setRequestingTopic = vi.fn();
  return { setContentRequests, setToast, setRequestedTopics, setRequestingTopic };
}

describe('usePayments — initial state', () => {
  it('starts with no pricingModal', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    expect(result.current.pricingModal).toBeNull();
  });

  it('starts with pricingConfirming = false', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    expect(result.current.pricingConfirming).toBe(false);
  });

  it('starts with pricingData = null', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    expect(result.current.pricingData).toBeNull();
  });

  it('starts with stripePayment = null', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    expect(result.current.stripePayment).toBeNull();
  });

  it('exposes setPricingModal', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    expect(typeof result.current.setPricingModal).toBe('function');
  });

  it('exposes confirmPricingAndSubmit', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    expect(typeof result.current.confirmPricingAndSubmit).toBe('function');
  });
});

describe('usePayments — state setters', () => {
  it('setPricingModal updates pricingModal', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    act(() => {
      result.current.setPricingModal({
        serviceType: 'brief_only',
        topic: 'SEO Basics',
        targetKeyword: 'seo guide',
        source: 'strategy',
      });
    });
    expect(result.current.pricingModal?.topic).toBe('SEO Basics');
    expect(result.current.pricingModal?.serviceType).toBe('brief_only');
  });

  it('setPricingConfirming updates pricingConfirming', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    act(() => { result.current.setPricingConfirming(true); });
    expect(result.current.pricingConfirming).toBe(true);
  });

  it('setPricingData updates pricingData', () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    const data = {
      products: {},
      bundles: [],
      currency: 'usd',
      stripeEnabled: false,
    };
    act(() => { result.current.setPricingData(data); });
    expect(result.current.pricingData?.currency).toBe('usd');
  });

  it('confirmPricingAndSubmit is a no-op when pricingModal is null', async () => {
    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', null, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );
    // Should not throw
    await act(async () => {
      await result.current.confirmPricingAndSubmit();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('usePayments — confirmPricingAndSubmit (strategy, no Stripe)', () => {
  it('posts content request and shows success toast on strategy source', async () => {
    mockPost.mockResolvedValueOnce({ id: 'req-1' });
    mockGetSafe.mockResolvedValueOnce([]);

    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', { stripeEnabled: false } as never, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );

    act(() => {
      result.current.setPricingModal({
        serviceType: 'brief_only',
        topic: 'Link Building',
        targetKeyword: 'link building',
        source: 'strategy',
      });
    });

    await act(async () => {
      await result.current.confirmPricingAndSubmit();
    });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/content-request/ws-1'),
      expect.objectContaining({ topic: 'Link Building' }),
    );
    expect(args.setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('shows error toast when post fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network fail'));

    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', { stripeEnabled: false } as never, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );

    act(() => {
      result.current.setPricingModal({
        serviceType: 'brief_only',
        topic: 'Fail test',
        targetKeyword: 'fail',
        source: 'strategy',
      });
    });

    await act(async () => {
      await result.current.confirmPricingAndSubmit();
    });

    expect(args.setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('resets pricingModal to null after submit', async () => {
    mockPost.mockResolvedValueOnce({ id: 'req-1' });
    mockGetSafe.mockResolvedValueOnce([]);

    const args = makePaymentsArgs();
    const { result } = renderHook(() =>
      usePayments('ws-1', { stripeEnabled: false } as never, args.setToast, args.setContentRequests, args.setRequestedTopics, args.setRequestingTopic),
    );

    act(() => {
      result.current.setPricingModal({
        serviceType: 'full_post',
        topic: 'Cleanup',
        targetKeyword: 'cleanup',
        source: 'strategy',
      });
    });

    await act(async () => {
      await result.current.confirmPricingAndSubmit();
    });

    expect(result.current.pricingModal).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// useContentRequests
// ══════════════════════════════════════════════════════════════════════════════

function makeContentRequestsArgs() {
  const setContentRequests = vi.fn();
  const setToast = vi.fn();
  return {
    workspaceId: 'ws-cr-1',
    setContentRequests,
    setToast,
  };
}

describe('useContentRequests — initial state', () => {
  it('expandedContentReq starts null', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.expandedContentReq).toBeNull();
  });

  it('contentComment starts empty', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.contentComment).toBe('');
  });

  it('sendingContentComment starts false', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.sendingContentComment).toBe(false);
  });

  it('declineReqId starts null', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.declineReqId).toBeNull();
  });

  it('declineReason starts empty', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.declineReason).toBe('');
  });

  it('feedbackReqId starts null', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.feedbackReqId).toBeNull();
  });

  it('feedbackText starts empty', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.feedbackText).toBe('');
  });

  it('briefPreviews starts empty object', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    expect(result.current.briefPreviews).toEqual({});
  });
});

describe('useContentRequests — state setters', () => {
  it('setExpandedContentReq updates expandedContentReq', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    act(() => { result.current.setExpandedContentReq('req-42'); });
    expect(result.current.expandedContentReq).toBe('req-42');
  });

  it('setContentComment updates contentComment', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    act(() => { result.current.setContentComment('Looks good!'); });
    expect(result.current.contentComment).toBe('Looks good!');
  });

  it('setDeclineReqId updates declineReqId', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    act(() => { result.current.setDeclineReqId('req-99'); });
    expect(result.current.declineReqId).toBe('req-99');
  });

  it('setDeclineReason updates declineReason', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    act(() => { result.current.setDeclineReason('Not relevant'); });
    expect(result.current.declineReason).toBe('Not relevant');
  });

  it('setFeedbackReqId updates feedbackReqId', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    act(() => { result.current.setFeedbackReqId('req-fb-1'); });
    expect(result.current.feedbackReqId).toBe('req-fb-1');
  });

  it('setFeedbackText updates feedbackText', () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    act(() => { result.current.setFeedbackText('Please revise the intro.'); });
    expect(result.current.feedbackText).toBe('Please revise the intro.');
  });
});

describe('useContentRequests — action callbacks', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('declineTopic calls POST and updates requests', async () => {
    const updated = { id: 'req-1', status: 'declined' };
    mockPost.mockResolvedValueOnce(updated);
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    await act(async () => {
      await result.current.declineTopic('req-1');
    });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/decline'),
      expect.any(Object),
    );
    expect(opts.setContentRequests).toHaveBeenCalled();
  });

  it('declineTopic shows error toast on failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    await act(async () => {
      await result.current.declineTopic('req-1');
    });

    expect(opts.setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('approveBrief calls POST and shows success toast', async () => {
    const updated = { id: 'req-2', status: 'approved' };
    mockPost.mockResolvedValueOnce(updated);
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    await act(async () => {
      await result.current.approveBrief('req-2');
    });

    expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/approve'));
    expect(opts.setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('approveBrief shows error toast on failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    await act(async () => {
      await result.current.approveBrief('req-2');
    });

    expect(opts.setToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('addContentComment does nothing when contentComment is empty', async () => {
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));
    // contentComment is '' by default

    await act(async () => {
      await result.current.addContentComment('req-1');
    });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('addContentComment calls POST when comment is non-empty', async () => {
    const updated = { id: 'req-1', status: 'in_review' };
    mockPost.mockResolvedValueOnce(updated);
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    act(() => { result.current.setContentComment('Great progress!'); });

    await act(async () => {
      await result.current.addContentComment('req-1');
    });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/comment'),
      expect.objectContaining({ content: 'Great progress!' }),
    );
  });

  it('loadBriefPreview calls getOptional and stores result', async () => {
    const preview = { id: 'brief-1', title: 'Brief Title' };
    mockGetOptional.mockResolvedValueOnce(preview);
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    await act(async () => {
      await result.current.loadBriefPreview('brief-1');
    });

    expect(mockGetOptional).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/content-brief/ws-cr-1/brief-1'),
    );
    expect(result.current.briefPreviews['brief-1']).toEqual(preview);
  });

  it('loadBriefPreview skips fetch if brief is already cached', async () => {
    const preview = { id: 'brief-2', title: 'Cached Brief' };
    mockGetOptional.mockResolvedValueOnce(preview);
    const opts = makeContentRequestsArgs();
    const { result } = renderHook(() => useContentRequests(opts));

    // Load once
    await act(async () => { await result.current.loadBriefPreview('brief-2'); });
    // Try to load again
    await act(async () => { await result.current.loadBriefPreview('brief-2'); });

    expect(mockGetOptional).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// useRecommendations
// ══════════════════════════════════════════════════════════════════════════════

describe('useRecommendations — disabled when workspaceId is undefined', () => {
  it('returns empty recs when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useRecommendations(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.recs).toEqual([]);
  });

  it('loaded is false when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useRecommendations(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.loaded).toBe(false);
  });

  it('does not call get() when workspaceId is undefined', () => {
    renderHook(() => useRecommendations(undefined), { wrapper: makeWrapper() });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useRecommendations — with workspaceId', () => {
  it('calls GET /api/public/recommendations/:workspaceId when enabled', async () => {
    mockGet.mockResolvedValueOnce({ recommendations: [] });
    renderHook(() => useRecommendations('ws-rec-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/public/recommendations/ws-rec-1'));
  });

  it('returns recs array from the set', async () => {
    const recs = [
      { id: 'r1', type: 'meta_title', affectedPages: ['/about'], priority: 'high', title: 'Fix title' },
    ];
    mockGet.mockResolvedValueOnce({ recommendations: recs });

    const { result } = renderHook(
      () => useRecommendations('ws-rec-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.recs).toHaveLength(1));
    expect(result.current.recs[0].id).toBe('r1');
  });

  it('loaded becomes true after fetch resolves', async () => {
    mockGet.mockResolvedValueOnce({ recommendations: [] });
    const { result } = renderHook(
      () => useRecommendations('ws-rec-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });

  it('forPage filters recommendations by page identity', async () => {
    const recs = [
      { id: 'r1', type: 'meta_title', affectedPages: ['/about'], priority: 'high', title: 'Fix about' },
      { id: 'r2', type: 'meta_desc', affectedPages: ['/contact'], priority: 'low', title: 'Fix contact' },
    ];
    mockGet.mockResolvedValueOnce({ recommendations: recs });

    const { result } = renderHook(
      () => useRecommendations('ws-rec-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.recs).toHaveLength(2));

    const aboutRecs = result.current.forPage('/about');
    expect(aboutRecs).toHaveLength(1);
    expect(aboutRecs[0].id).toBe('r1');
  });

  it('ofType filters recommendations by type', async () => {
    const recs = [
      { id: 'r1', type: 'meta_title', affectedPages: ['/a'], priority: 'high', title: 'Title fix' },
      { id: 'r2', type: 'meta_desc', affectedPages: ['/b'], priority: 'low', title: 'Desc fix' },
    ];
    mockGet.mockResolvedValueOnce({ recommendations: recs });

    const { result } = renderHook(
      () => useRecommendations('ws-rec-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.recs).toHaveLength(2));

    const titleRecs = result.current.ofType('meta_title' as never);
    expect(titleRecs).toHaveLength(1);
    expect(titleRecs[0].id).toBe('r1');
  });

  it('forPageAndType returns intersection of page and type filters', async () => {
    const recs = [
      { id: 'r1', type: 'meta_title', affectedPages: ['/about'], priority: 'high', title: 'About title' },
      { id: 'r2', type: 'meta_desc', affectedPages: ['/about'], priority: 'low', title: 'About desc' },
      { id: 'r3', type: 'meta_title', affectedPages: ['/contact'], priority: 'high', title: 'Contact title' },
    ];
    mockGet.mockResolvedValueOnce({ recommendations: recs });

    const { result } = renderHook(
      () => useRecommendations('ws-rec-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.recs).toHaveLength(3));

    const hits = result.current.forPageAndType('/about', 'meta_title' as never);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('r1');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// usePageEditStates
// ══════════════════════════════════════════════════════════════════════════════

describe('usePageEditStates — disabled when workspaceId is undefined', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns empty states object when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => usePageEditStates(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.states).toEqual({});
  });

  it('does not call getOptional when workspaceId is undefined', () => {
    renderHook(() => usePageEditStates(undefined), { wrapper: makeWrapper() });
    expect(mockGetOptional).not.toHaveBeenCalled();
  });

  it('loading starts true until data arrives', () => {
    mockGetOptional.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.loading).toBe(true);
  });
});

describe('usePageEditStates — with workspaceId', () => {
  it('calls admin endpoint for non-public use', async () => {
    mockGetOptional.mockResolvedValueOnce({});
    renderHook(
      () => usePageEditStates('ws-pes-1', false),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(mockGetOptional).toHaveBeenCalledWith(
        expect.stringContaining('/api/workspaces/ws-pes-1/page-states'),
      );
    });
  });

  it('calls public endpoint when isPublic=true', async () => {
    mockGetOptional.mockResolvedValueOnce({});
    renderHook(
      () => usePageEditStates('ws-pes-1', true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(mockGetOptional).toHaveBeenCalledWith(
        expect.stringContaining('/api/public/page-states/ws-pes-1'),
      );
    });
  });

  it('returns states from API response', async () => {
    const apiStates = {
      'page-1': { pageId: 'page-1', status: 'clean', updatedAt: '2024-01-01' },
      'page-2': { pageId: 'page-2', status: 'issue-detected', updatedAt: '2024-01-02' },
    };
    mockGetOptional.mockResolvedValueOnce(apiStates);

    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.states['page-1'].status).toBe('clean');
    expect(result.current.states['page-2'].status).toBe('issue-detected');
  });

  it('getState returns state for a known pageId', async () => {
    const apiStates = {
      'page-abc': { pageId: 'page-abc', status: 'approved', updatedAt: '2024-01-01' },
    };
    mockGetOptional.mockResolvedValueOnce(apiStates);

    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getState('page-abc')?.status).toBe('approved');
  });

  it('getState returns undefined for an unknown pageId', async () => {
    mockGetOptional.mockResolvedValueOnce({});
    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getState('no-such-page')).toBeUndefined();
  });

  it('summary counts statuses correctly', async () => {
    const apiStates = {
      'p1': { pageId: 'p1', status: 'clean', updatedAt: '' },
      'p2': { pageId: 'p2', status: 'clean', updatedAt: '' },
      'p3': { pageId: 'p3', status: 'issue-detected', updatedAt: '' },
      'p4': { pageId: 'p4', status: 'fix-proposed', updatedAt: '' },
      'p5': { pageId: 'p5', status: 'approved', updatedAt: '' },
      'p6': { pageId: 'p6', status: 'live', updatedAt: '' },
    };
    mockGetOptional.mockResolvedValueOnce(apiStates);

    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summary.clean).toBe(2);
    expect(result.current.summary.issueDetected).toBe(1);
    expect(result.current.summary.fixProposed).toBe(1);
    expect(result.current.summary.approved).toBe(1);
    expect(result.current.summary.live).toBe(1);
    expect(result.current.summary.total).toBe(6);
  });

  it('summary is all-zero when no states returned', async () => {
    mockGetOptional.mockResolvedValueOnce({});
    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summary.total).toBe(0);
    expect(result.current.summary.clean).toBe(0);
  });

  it('falls back to empty object when API returns null', async () => {
    mockGetOptional.mockResolvedValueOnce(null);
    const { result } = renderHook(
      () => usePageEditStates('ws-pes-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.states).toEqual({});
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// workspaceEventBus (non-React utilities)
// All event-bus describes are nested inside a single outer describe so the
// beforeEach/afterEach lifecycle hooks (which stub globals) only apply to
// those tests and do not pollute the jsdom container for other suites.
// ══════════════════════════════════════════════════════════════════════════════

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  closeCount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(payload: string) { this.sent.push(payload); }
  close() { this.closeCount += 1; }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function sentPayloads(ws: MockWebSocket) {
  return ws.sent.map(s => JSON.parse(s) as Record<string, unknown>);
}

describe('workspaceEventBus', () => {
  beforeEach(() => {
    __resetWorkspaceEventBusForTests();
    MockWebSocket.instances.length = 0;
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    __resetWorkspaceEventBusForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

describe('workspaceEventBus — subscribeWorkspaceEvents', () => {
  it('creates a WebSocket connection on first subscribe', () => {
    const unsub = subscribeWorkspaceEvents('ws-bus-1', { onMessage: () => {} });
    expect(MockWebSocket.instances).toHaveLength(1);
    unsub();
  });

  it('reuses the same socket for multiple subscribers on the same workspace', () => {
    const unsubA = subscribeWorkspaceEvents('ws-shared', { onMessage: () => {} });
    const unsubB = subscribeWorkspaceEvents('ws-shared', { onMessage: () => {} });
    expect(MockWebSocket.instances).toHaveLength(1);
    unsubA();
    unsubB();
  });

  it('creates separate sockets for different workspaces', () => {
    const unsubA = subscribeWorkspaceEvents('ws-a', { onMessage: () => {} });
    const unsubB = subscribeWorkspaceEvents('ws-b', { onMessage: () => {} });
    expect(MockWebSocket.instances).toHaveLength(2);
    unsubA();
    unsubB();
  });

  it('delivers messages to all listeners on the same workspace', () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubA = subscribeWorkspaceEvents('ws-multi', { onMessage: msg => receivedA.push(msg) });
    const unsubB = subscribeWorkspaceEvents('ws-multi', { onMessage: msg => receivedB.push(msg) });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'data:update', workspaceId: 'ws-multi' });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    unsubA();
    unsubB();
  });

  it('filters messages for wrong workspaceId', () => {
    const received: unknown[] = [];
    const unsub = subscribeWorkspaceEvents('ws-target', { onMessage: msg => received.push(msg) });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'data:update', workspaceId: 'ws-other' });
    ws.emitMessage({ event: 'data:update', workspaceId: 'ws-target' });

    expect(received).toHaveLength(1);
    unsub();
  });

  it('sends subscribe message on open (no auth token)', () => {
    const unsub = subscribeWorkspaceEvents('ws-sub', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    const payloads = sentPayloads(ws);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'subscribe', workspaceId: 'ws-sub' }),
      ]),
    );
    unsub();
  });

  it('sends authenticate first when auth token is present', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'mock-token') });

    const unsub = subscribeWorkspaceEvents('ws-auth', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    const payloads = sentPayloads(ws);
    expect(payloads[0]).toMatchObject({ action: 'authenticate', token: 'mock-token' });
    unsub();
  });

  it('closes and removes connection when last listener unsubscribes', () => {
    const unsub = subscribeWorkspaceEvents('ws-last', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    unsub();
    expect(ws.closeCount).toBeGreaterThanOrEqual(1);
  });

  it('returns unsubscribe function', () => {
    const unsub = subscribeWorkspaceEvents('ws-fn', { onMessage: () => {} });
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

describe('workspaceEventBus — sendWorkspaceEvent', () => {
  it('is a no-op when no connection exists for the workspace', () => {
    expect(() => sendWorkspaceEvent('no-such-ws', { action: 'ping' })).not.toThrow();
  });

  it('sends a message on an open connection', () => {
    const unsub = subscribeWorkspaceEvents('ws-send', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    sendWorkspaceEvent('ws-send', { action: 'custom', payload: 'hello' });

    const payloads = sentPayloads(ws);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'custom', payload: 'hello' }),
      ]),
    );
    unsub();
  });
});

describe('workspaceEventBus — __resetWorkspaceEventBusForTests', () => {
  it('closes all active connections', () => {
    subscribeWorkspaceEvents('ws-reset-1', { onMessage: () => {} });
    subscribeWorkspaceEvents('ws-reset-2', { onMessage: () => {} });

    __resetWorkspaceEventBusForTests();

    expect(MockWebSocket.instances[0].closeCount).toBeGreaterThanOrEqual(1);
    expect(MockWebSocket.instances[1].closeCount).toBeGreaterThanOrEqual(1);
  });

  it('allows fresh connections after reset', () => {
    subscribeWorkspaceEvents('ws-r', { onMessage: () => {} });
    __resetWorkspaceEventBusForTests();
    MockWebSocket.instances.length = 0;

    const unsub = subscribeWorkspaceEvents('ws-r', { onMessage: () => {} });
    expect(MockWebSocket.instances).toHaveLength(1);
    unsub();
  });
});

describe('workspaceEventBus — reconnect behaviour', () => {
  it('schedules reconnect after socket close while listeners remain', () => {
    vi.useFakeTimers();

    const unsub = subscribeWorkspaceEvents('ws-reconnect', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitClose();

    vi.advanceTimersByTime(2500);

    // A second socket should have been created
    expect(MockWebSocket.instances).toHaveLength(2);
    unsub();
  });

  it('does NOT reconnect when last listener has already unsubscribed', () => {
    vi.useFakeTimers();

    const unsub = subscribeWorkspaceEvents('ws-no-reconnect', { onMessage: () => {} });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    unsub(); // removes last listener, disposes connection
    ws.emitClose();

    vi.advanceTimersByTime(3000);

    // Still only 1 socket — no reconnect after disposal
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('workspaceEventBus — identity resolution', () => {
  it('sends identify on authenticated message when identity is available', () => {
    const unsub = subscribeWorkspaceEvents('ws-identity', {
      getIdentity: () => ({ userId: 'u-1', email: 'user@example.com', role: 'client' as const }),
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ action: 'authenticated', ok: true });

    const payloads = sentPayloads(ws);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'identify', userId: 'u-1' }),
      ]),
    );
    unsub();
  });

  it('messages with no workspaceId field reach all listeners', () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubA = subscribeWorkspaceEvents('ws-global', { onMessage: msg => receivedA.push(msg) });
    const unsubB = subscribeWorkspaceEvents('ws-global', { onMessage: msg => receivedB.push(msg) });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'presence:update', online: true });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    unsubA();
    unsubB();
  });
}); // describe workspaceEventBus — identity resolution

}); // describe workspaceEventBus (outer wrapper)
