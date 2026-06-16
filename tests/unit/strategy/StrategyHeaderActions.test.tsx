import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyHeaderActions } from '../../../src/components/strategy/StrategyHeaderActions';

const baseProps = {
  isRealStrategy: false,
  generating: false,
  localSyncApplies: false,
  localNeedsRefresh: false,
  refreshPending: false,
  onIncremental: vi.fn(),
  onFullRefresh: vi.fn(),
  onGenerate: vi.fn(),
};

describe('StrategyHeaderActions', () => {
  it('shows "Generate Strategy" when isRealStrategy is false', () => {
    render(<StrategyHeaderActions {...baseProps} isRealStrategy={false} />);
    expect(screen.getByText('Generate Strategy')).toBeInTheDocument();
  });

  it('shows "Regenerate" when isRealStrategy is true', () => {
    render(<StrategyHeaderActions {...baseProps} isRealStrategy={true} />);
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
  });

  it('clicking the primary button calls onGenerate', () => {
    const onGenerate = vi.fn();
    render(<StrategyHeaderActions {...baseProps} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('does not show "Update changed pages" when isRealStrategy is false', () => {
    render(<StrategyHeaderActions {...baseProps} isRealStrategy={false} />);
    expect(screen.queryByText(/update changed pages/i)).not.toBeInTheDocument();
  });

  it('shows "Update changed pages" (incremental) and calls onIncremental when isRealStrategy is true', () => {
    const onIncremental = vi.fn();
    render(<StrategyHeaderActions {...baseProps} isRealStrategy={true} onIncremental={onIncremental} />);
    const btn = screen.getByRole('button', { name: /update changed pages/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onIncremental).toHaveBeenCalledOnce();
  });

  it('shows "Full refresh" only when localSyncApplies is true, and calls onFullRefresh', () => {
    const onFullRefresh = vi.fn();
    const { rerender } = render(<StrategyHeaderActions {...baseProps} localSyncApplies={false} />);
    expect(screen.queryByText(/full refresh/i)).not.toBeInTheDocument();

    rerender(<StrategyHeaderActions {...baseProps} localSyncApplies={true} onFullRefresh={onFullRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /full refresh/i }));
    expect(onFullRefresh).toHaveBeenCalledOnce();
  });

  it('disables all buttons while generating', () => {
    render(<StrategyHeaderActions {...baseProps} isRealStrategy={true} localSyncApplies={true} generating={true} />);
    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /update changed pages/i })).toBeDisabled();
  });
});
