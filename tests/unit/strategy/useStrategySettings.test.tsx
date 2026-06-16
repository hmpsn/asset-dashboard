// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStrategySettings } from '../../../src/components/strategy/hooks/useStrategySettings';

vi.mock('../../../src/api/seo', () => ({
  keywords: {
    discoverCompetitors: vi.fn().mockResolvedValue({ competitors: [{ domain: 'rival.com' }] }),
    saveCompetitors: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useStrategySettings', () => {
  it('builds generation params with current settings', () => {
    const { result } = renderHook(() => useStrategySettings({ seoDataAvailable: true } as any, null, 'ws1'));
    act(() => result.current.setMaxPages(200));
    const params = result.current.buildStrategyGenerationParams();
    expect(params.maxPages).toBe(200);
    expect(params.seoDataProvider).toBe('dataforseo');
  });

  it('discoverCompetitors populates the competitors field', async () => {
    const { result } = renderHook(() => useStrategySettings({ seoDataAvailable: true } as any, null, 'ws1'));
    await act(async () => { await result.current.discoverCompetitors(); });
    await waitFor(() => expect(result.current.competitors).toContain('rival.com'));
  });
});
