import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTrackKeyword } from '../../../src/components/strategy/hooks/useTrackKeyword';

vi.mock('../../../src/api/seo', () => ({
  rankTracking: { keywords: vi.fn().mockResolvedValue([]), addKeyword: vi.fn().mockRejectedValue(new Error('network down')) },
  keywords: {},
}));

const wrapper = ({ children }: any) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useTrackKeyword', () => {
  it('records a track error on real failure', async () => {
    const { result } = renderHook(() => useTrackKeyword('ws1'), { wrapper });
    await act(async () => { await result.current.trackKeyword('dentist austin'); });
    await waitFor(() => expect(result.current.trackingErrors.size).toBe(1));
  });
});
