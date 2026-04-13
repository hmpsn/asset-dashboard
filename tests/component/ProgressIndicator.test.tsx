import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProgressIndicator } from '../../src/components/ui/ProgressIndicator';

describe('ProgressIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ProgressIndicator status="idle" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when error', () => {
    const { container } = render(<ProgressIndicator status="error" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders step label and detail when running', () => {
    render(<ProgressIndicator status="running" step="Crawling..." detail="42 of 120 pages" />);
    expect(screen.getByText('Crawling...')).toBeInTheDocument();
    expect(screen.getByText('42 of 120 pages')).toBeInTheDocument();
  });

  it('renders percent when provided', () => {
    render(<ProgressIndicator status="running" percent={35} />);
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('does not render percent label when indeterminate', () => {
    render(<ProgressIndicator status="running" step="Loading..." />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders cancel button when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<ProgressIndicator status="running" step="Working..." onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders complete state with green check', () => {
    render(<ProgressIndicator status="complete" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('fades out after 3s when complete', () => {
    vi.useFakeTimers();
    const { container } = render(<ProgressIndicator status="complete" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('opacity-100');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(wrapper.className).toContain('opacity-0');
    vi.useRealTimers();
  });

  it('has role=progressbar when running', () => {
    render(<ProgressIndicator status="running" step="Loading..." />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
