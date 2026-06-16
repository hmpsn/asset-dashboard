import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyHeader } from '../../../src/components/strategy/StrategyHeader';

const baseProps = {
  isRealStrategy: false,
  generatedAt: null,
  pageCount: 0,
  generating: false,
  localSyncApplies: false,
  localNeedsRefresh: false,
  refreshPending: false,
  onIncremental: vi.fn(),
  onFullRefresh: vi.fn(),
  onGenerate: vi.fn(),
};

describe('StrategyHeader', () => {
  it('renders the "Keyword Strategy" title', () => {
    render(<StrategyHeader {...baseProps} />);
    expect(screen.getByText('Keyword Strategy')).toBeInTheDocument();
  });

  it('shows "Generate Strategy" when isRealStrategy is false', () => {
    render(<StrategyHeader {...baseProps} isRealStrategy={false} />);
    expect(screen.getByText('Generate Strategy')).toBeInTheDocument();
  });

  it('shows "Regenerate" when isRealStrategy is true', () => {
    render(
      <StrategyHeader
        {...baseProps}
        isRealStrategy={true}
        generatedAt="2026-01-15T00:00:00Z"
        pageCount={12}
      />,
    );
    expect(screen.getByText('Regenerate')).toBeInTheDocument();
  });

  it('clicking the primary button calls onGenerate', () => {
    const onGenerate = vi.fn();
    render(<StrategyHeader {...baseProps} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('shows the page count and formatted date in the subtitle when isRealStrategy is true', () => {
    render(
      <StrategyHeader
        {...baseProps}
        isRealStrategy={true}
        generatedAt="2026-01-15T00:00:00Z"
        pageCount={7}
      />,
    );
    expect(screen.getByText(/7 pages mapped/i)).toBeInTheDocument();
  });

  it('does not show "Update changed pages" when isRealStrategy is false', () => {
    render(<StrategyHeader {...baseProps} isRealStrategy={false} />);
    expect(screen.queryByText(/update changed pages/i)).not.toBeInTheDocument();
  });

  it('shows "Update changed pages" when isRealStrategy is true', () => {
    render(
      <StrategyHeader
        {...baseProps}
        isRealStrategy={true}
        generatedAt="2026-01-15T00:00:00Z"
        pageCount={5}
      />,
    );
    expect(screen.getByText(/update changed pages/i)).toBeInTheDocument();
  });

  it('shows "Full refresh" button only when localSyncApplies is true', () => {
    const { rerender } = render(<StrategyHeader {...baseProps} localSyncApplies={false} />);
    expect(screen.queryByText(/full refresh/i)).not.toBeInTheDocument();

    rerender(<StrategyHeader {...baseProps} localSyncApplies={true} />);
    expect(screen.getByText(/full refresh/i)).toBeInTheDocument();
  });

  it('calls onFullRefresh when "Full refresh" is clicked', () => {
    const onFullRefresh = vi.fn();
    render(<StrategyHeader {...baseProps} localSyncApplies={true} onFullRefresh={onFullRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /full refresh/i }));
    expect(onFullRefresh).toHaveBeenCalledOnce();
  });
});
