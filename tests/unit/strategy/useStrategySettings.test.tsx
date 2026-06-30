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

  it('settingsOpen defaults to open (legacy flag-off parity)', () => {
    const { result } = renderHook(() => useStrategySettings(undefined, null, 'ws1'));
    expect(result.current.settingsOpen).toBe(true);
  });

  it('settingsOpen starts collapsed when collapsedByDefault is true (decision-bands layout)', () => {
    const { result } = renderHook(() => useStrategySettings(undefined, null, 'ws1', true));
    expect(result.current.settingsOpen).toBe(false);
  });

  it('collapses once when the bands flag resolves ON after mount, then respects manual re-open (async-flag cold-cache fix)', () => {
    // Cold flag cache: useFeatureFlag returns the static default (false) on first render, then resolves.
    const { result, rerender } = renderHook(
      ({ collapsed }) => useStrategySettings(undefined, null, 'ws1', collapsed),
      { initialProps: { collapsed: false } },
    );
    expect(result.current.settingsOpen).toBe(true); // flag still resolving → open
    act(() => rerender({ collapsed: true }));        // flag resolves true (bands) → force-collapse once
    expect(result.current.settingsOpen).toBe(false);
    // One-shot: a manual re-open must NOT be re-collapsed by a later re-render with the flag still true.
    act(() => result.current.setSettingsOpen(true));
    act(() => rerender({ collapsed: true }));
    expect(result.current.settingsOpen).toBe(true);
  });

  it('hydrates maxPages from strategy on mount', async () => {
    const strategy = { businessContext: '', seoDataMode: 'quick' as const, maxPages: 250 };
    const { result } = renderHook(() => useStrategySettings(undefined, strategy, 'ws1'));
    await waitFor(() => expect(result.current.maxPages).toBe(250));
  });

  it('does not clobber an in-session seoDataMode change on a background strategy refetch', async () => {
    const { result, rerender } = renderHook(
      ({ strategy }) => useStrategySettings(undefined, strategy, 'ws1'),
      { initialProps: { strategy: { seoDataMode: 'quick' as const } } },
    );
    await waitFor(() => expect(result.current.seoDataMode).toBe('quick'));
    act(() => result.current.setSeoDataMode('full'));
    // A background refetch returns a NEW strategy object identity still carrying 'quick'.
    rerender({ strategy: { seoDataMode: 'quick' as const } });
    expect(result.current.seoDataMode).toBe('full');
  });
});
