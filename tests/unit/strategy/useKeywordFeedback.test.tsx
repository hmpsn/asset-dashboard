// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useKeywordFeedback } from '../../../src/components/strategy/hooks/useKeywordFeedback';
import { keywordCommandCenter } from '../../../src/api/keywordCommandCenter';

vi.mock('../../../src/api/seo', () => ({
  keywords: {
    feedback: vi.fn().mockResolvedValue([
      { keyword: 'dentist austin', status: 'requested', created_at: '2026-01-01T00:00:00Z', updated_at: null },
    ]),
  },
  rankTracking: {
    keywords: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../src/api/keywordCommandCenter', () => ({
  keywordCommandCenter: {
    action: vi.fn(),
  },
}));

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useKeywordFeedback', () => {
  beforeEach(() => {
    vi.mocked(keywordCommandCenter.action).mockReset();
  });

  it('calls the KCC ADD_TO_STRATEGY action when addRequestedKeyword is invoked', async () => {
    vi.mocked(keywordCommandCenter.action).mockResolvedValue({ ok: true } as any);

    const { result } = renderHook(() => useKeywordFeedback('ws1'), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.addRequestedKeyword('dentist austin');
    });

    await waitFor(() => {
      expect(keywordCommandCenter.action).toHaveBeenCalledWith('ws1', {
        action: 'add_to_strategy',
        keyword: 'dentist austin',
      });
    });
  });

  it('sets addError when the mutation fails', async () => {
    vi.mocked(keywordCommandCenter.action).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useKeywordFeedback('ws1'), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.addRequestedKeyword('some keyword');
    });

    await waitFor(() => {
      expect(result.current.addError).toBe(
        'Failed to add keyword to strategy. Please try again.',
      );
    });
  });

  it('exposes setAddError to clear the error', async () => {
    vi.mocked(keywordCommandCenter.action).mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useKeywordFeedback('ws1'), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      result.current.addRequestedKeyword('kw');
    });

    await waitFor(() => expect(result.current.addError).not.toBeNull());

    act(() => {
      result.current.setAddError(null);
    });

    expect(result.current.addError).toBeNull();
  });

  it('returns addPending false initially', () => {
    const { result } = renderHook(() => useKeywordFeedback('ws1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.addPending).toBe(false);
  });
});
