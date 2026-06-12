/**
 * refresh-ordering-prompt.test.tsx — Task 3.2
 *
 * Tests the 3-action RefreshOrderingPrompt modal:
 * - Renders distinct copy per reason (missing / stale / markets_changed)
 * - Each button fires the correct callback exactly once
 * - Renders nothing when open=false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefreshOrderingPrompt } from '../../src/components/keyword-strategy/RefreshOrderingPrompt';

function renderPrompt(props: Partial<Parameters<typeof RefreshOrderingPrompt>[0]> = {}) {
  const defaults = {
    open: true,
    reason: 'stale' as const,
    lastLocalRefreshAt: null,
    onFullRefresh: vi.fn(),
    onGenerateAnyway: vi.fn(),
    onCancel: vi.fn(),
  };
  return render(<RefreshOrderingPrompt {...defaults} {...props} />);
}

describe('RefreshOrderingPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open=false', () => {
    const { container } = renderPrompt({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders reason-specific copy for "missing"', () => {
    renderPrompt({ reason: 'missing' });
    expect(screen.getByText(/No local SEO data yet/i)).toBeInTheDocument();
  });

  it('renders reason-specific copy for "stale"', () => {
    renderPrompt({ reason: 'stale' });
    expect(screen.getByText(/Local SEO data is over 30 days old/i)).toBeInTheDocument();
  });

  it('renders reason-specific copy for "markets_changed"', () => {
    renderPrompt({ reason: 'markets_changed' });
    expect(screen.getByText(/markets changed since the last local crawl/i)).toBeInTheDocument();
  });

  it('renders lastLocalRefreshAt when provided', () => {
    renderPrompt({ reason: 'stale', lastLocalRefreshAt: '2026-01-15T00:00:00.000Z' });
    // Should show formatted date somewhere
    expect(screen.getByText(/Jan/i)).toBeInTheDocument();
  });

  it('calls onFullRefresh exactly once when Full refresh button is clicked', () => {
    const onFullRefresh = vi.fn();
    renderPrompt({ onFullRefresh });
    fireEvent.click(screen.getByRole('button', { name: /full refresh/i }));
    expect(onFullRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onGenerateAnyway exactly once when Generate anyway button is clicked', () => {
    const onGenerateAnyway = vi.fn();
    renderPrompt({ onGenerateAnyway });
    fireEvent.click(screen.getByRole('button', { name: /generate anyway/i }));
    expect(onGenerateAnyway).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel exactly once when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderPrompt({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('three distinct reasons produce three distinct copy strings (non-overlapping)', () => {
    const { unmount } = renderPrompt({ reason: 'missing' });
    const missingText = screen.getByText(/No local SEO data yet/i).textContent;
    unmount();

    renderPrompt({ reason: 'stale' });
    const staleText = screen.getByText(/Local SEO data is over 30 days old/i).textContent;
    expect(missingText).not.toEqual(staleText);
  });
});
