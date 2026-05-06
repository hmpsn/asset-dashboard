/**
 * Unit tests for the useStrategyKeywordFeedback hook
 * (src/components/client/strategy/useStrategyKeywordFeedback.ts).
 *
 * The hook owns the per-workspace map of keyword → feedback status, the
 * loading set, and the toasts/error handling around the keyword-feedback API.
 * The keys are normalized via `.toLowerCase().trim()` so this suite verifies
 * that normalization + the optimistic-update + the API failure paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../src/api', () => ({
  keywordFeedback: {
    get: vi.fn(),
    submit: vi.fn(),
    remove: vi.fn(),
  },
}));

import { keywordFeedback as kwFeedbackApi } from '../../src/api';
import { useStrategyKeywordFeedback } from '../../src/components/client/strategy/useStrategyKeywordFeedback';

const mockedApi = vi.mocked(kwFeedbackApi);

describe('useStrategyKeywordFeedback — initial load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with an empty feedback map and no error', async () => {
    mockedApi.get.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    expect(result.current.keywordFeedback.size).toBe(0);
    expect(result.current.feedbackLoadError).toBe(false);
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith('ws-1'));
  });

  it('does NOT call the API when workspaceId is undefined', () => {
    renderHook(() => useStrategyKeywordFeedback({}));
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('hydrates the map from the load response', async () => {
    mockedApi.get.mockResolvedValueOnce([
      { keyword: 'foo', status: 'approved' },
      { keyword: 'bar', status: 'declined' },
      { keyword: 'baz', status: 'requested' },
    ]);
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(3));
    expect(result.current.keywordFeedback.get('foo')).toBe('approved');
    expect(result.current.keywordFeedback.get('bar')).toBe('declined');
    expect(result.current.keywordFeedback.get('baz')).toBe('requested');
  });

  it('flips feedbackLoadError to true when the API rejects', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await waitFor(() => expect(result.current.feedbackLoadError).toBe(true));
    expect(result.current.keywordFeedback.size).toBe(0);
  });
});

describe('useStrategyKeywordFeedback — submitFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue([]);
  });

  it('normalizes keys to lowercase + trim before sending and storing', async () => {
    mockedApi.submit.mockResolvedValueOnce({});
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await act(async () => {
      await result.current.submitFeedback('  Pizza Delivery  ', 'approved', 'manual');
    });
    expect(mockedApi.submit).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ keyword: 'pizza delivery', status: 'approved', source: 'manual' }),
    );
    expect(result.current.keywordFeedback.get('pizza delivery')).toBe('approved');
  });

  it('updates state optimistically once the API resolves', async () => {
    mockedApi.submit.mockResolvedValueOnce({});
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await act(async () => {
      await result.current.submitFeedback('foo', 'declined', 'review');
    });
    expect(result.current.getFeedbackStatus('foo')).toBe('declined');
    expect(result.current.getFeedbackStatus('FOO')).toBe('declined');
  });

  it('emits the approved-style toast on approve', async () => {
    mockedApi.submit.mockResolvedValueOnce({});
    const setToast = vi.fn();
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1', setToast }),
    );
    await act(async () => {
      await result.current.submitFeedback('seo', 'approved', 'manual');
    });
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('marked relevant'));
  });

  it('emits the declined-style toast on decline', async () => {
    mockedApi.submit.mockResolvedValueOnce({});
    const setToast = vi.fn();
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1', setToast }),
    );
    await act(async () => {
      await result.current.submitFeedback('seo', 'declined', 'manual');
    });
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('marked not relevant'));
  });

  it('suppresses toasts when options.toast === false', async () => {
    mockedApi.submit.mockResolvedValueOnce({});
    const setToast = vi.fn();
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1', setToast }),
    );
    await act(async () => {
      await result.current.submitFeedback('seo', 'approved', 'manual', undefined, { toast: false });
    });
    expect(setToast).not.toHaveBeenCalled();
  });

  it('surfaces an error toast when the API rejects', async () => {
    mockedApi.submit.mockRejectedValueOnce(new Error('500'));
    const setToast = vi.fn();
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1', setToast }),
    );
    await act(async () => {
      await result.current.submitFeedback('seo', 'approved', 'manual');
    });
    expect(setToast).toHaveBeenCalledWith('Failed to save feedback');
    expect(result.current.getFeedbackStatus('seo')).toBeUndefined();
  });

  it('rethrows when options.rethrow is true and the API fails', async () => {
    mockedApi.submit.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await act(async () => {
      await expect(
        result.current.submitFeedback('seo', 'approved', 'manual', undefined, { rethrow: true }),
      ).rejects.toThrow('Failed to save feedback');
    });
  });

  it('clears the per-keyword loading flag after success', async () => {
    let resolveSubmit!: (v: unknown) => void;
    mockedApi.submit.mockReturnValueOnce(new Promise(r => { resolveSubmit = r; }));
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submitFeedback('seo', 'approved', 'manual');
    });
    // Loading flag flips on synchronously
    await waitFor(() => expect(result.current.isLoadingFeedback('seo')).toBe(true));

    await act(async () => {
      resolveSubmit({});
      await submitPromise;
    });
    expect(result.current.isLoadingFeedback('seo')).toBe(false);
  });

  it('does NOT call the API when workspaceId is undefined', async () => {
    const { result } = renderHook(() => useStrategyKeywordFeedback({}));
    await act(async () => {
      await result.current.submitFeedback('seo', 'approved', 'manual');
    });
    expect(mockedApi.submit).not.toHaveBeenCalled();
  });
});

describe('useStrategyKeywordFeedback — removeFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.get.mockResolvedValue([
      { keyword: 'foo', status: 'declined' },
      { keyword: 'bar', status: 'approved' },
    ]);
  });

  it('removes the keyword from the map and emits a restore toast', async () => {
    mockedApi.remove.mockResolvedValueOnce({ deleted: 'foo' });
    const setToast = vi.fn();
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1', setToast }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(2));

    await act(async () => {
      await result.current.removeFeedback('FOO');
    });
    expect(mockedApi.remove).toHaveBeenCalledWith('ws-1', 'foo');
    expect(result.current.getFeedbackStatus('foo')).toBeUndefined();
    expect(result.current.getFeedbackStatus('bar')).toBe('approved');
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining('restored'));
  });

  it('clears the local entry when options.clearOnError is set, even on API failure', async () => {
    mockedApi.remove.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(2));

    await act(async () => {
      await result.current.removeFeedback('foo', { clearOnError: true });
    });
    expect(result.current.getFeedbackStatus('foo')).toBeUndefined();
  });

  it('keeps the local entry on failure when clearOnError is unset', async () => {
    mockedApi.remove.mockRejectedValueOnce(new Error('500'));
    const setToast = vi.fn();
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1', setToast }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(2));

    await act(async () => {
      await result.current.removeFeedback('foo');
    });
    expect(result.current.getFeedbackStatus('foo')).toBe('declined');
    expect(setToast).toHaveBeenCalledWith('Failed to undo');
  });

  it('rethrows when options.rethrow is true and the API fails', async () => {
    mockedApi.remove.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(2));

    await act(async () => {
      await expect(
        result.current.removeFeedback('foo', { rethrow: true }),
      ).rejects.toThrow('Failed to undo keyword feedback');
    });
  });
});

describe('useStrategyKeywordFeedback — derived selectors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes only "requested" keywords through requestedKeywords', async () => {
    mockedApi.get.mockResolvedValueOnce([
      { keyword: 'a', status: 'approved' },
      { keyword: 'b', status: 'declined' },
      { keyword: 'c', status: 'requested' },
      { keyword: 'd', status: 'requested' },
    ]);
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(4));
    expect(new Set(result.current.requestedKeywords)).toEqual(new Set(['c', 'd']));
  });

  it('getFeedbackStatus normalizes the lookup key', async () => {
    mockedApi.get.mockResolvedValueOnce([{ keyword: 'pizza delivery', status: 'approved' }]);
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    await waitFor(() => expect(result.current.keywordFeedback.size).toBe(1));
    expect(result.current.getFeedbackStatus('  PIZZA Delivery  ')).toBe('approved');
    expect(result.current.getFeedbackStatus('not-tracked')).toBeUndefined();
  });

  it('exposes undoFeedback as an alias of removeFeedback', () => {
    mockedApi.get.mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useStrategyKeywordFeedback({ workspaceId: 'ws-1' }),
    );
    expect(result.current.undoFeedback).toBe(result.current.removeFeedback);
  });
});
