// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStrategyGeneration } from '../../../src/components/strategy/hooks/useStrategyGeneration';

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: vi.fn().mockResolvedValue('job1'), findActiveJob: () => undefined }),
}));
vi.mock('../../../src/hooks/admin', () => ({ useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false }) }));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useStrategyGeneration', () => {
  it('opens the ordering prompt for a full run when local data needs refresh', async () => {
    const { result } = renderHook(() => useStrategyGeneration({
      workspaceId: 'ws1',
      localSync: { localNeedsRefresh: true, applies: true },
      buildStrategyGenerationParams: () => ({} as any),
    } as any), { wrapper });
    await act(async () => { await result.current.generateStrategy('full'); });
    expect(result.current.refreshOrderingPromptOpen).toBe(true);
  });
});
