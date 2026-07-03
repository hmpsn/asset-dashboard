import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SearchField } from '../../../src/components/ui/forms/SearchField';

describe('SearchField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('typing fires onChange debounced — only one call after the delay', () => {
    const onChange = vi.fn();
    render(<SearchField value="" onChange={onChange} debounceMs={300} />);

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    // No commit yet — each keystroke resets the timer.
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('Escape clears the field and calls onChange with empty string', () => {
    const onChange = vi.fn();
    render(<SearchField value="hello" onChange={onChange} />);

    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onChange).toHaveBeenCalledWith('');
    expect(input).toHaveValue('');
  });

  it('clear button clears the value', () => {
    const onChange = vi.fn();
    render(<SearchField value="hello" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('fires onSubmit with the current value on Enter', () => {
    const onSubmit = vi.fn();
    render(<SearchField value="query" onChange={vi.fn()} onSubmit={onSubmit} />);

    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('query');
  });

  it('cleans up the debounce timer on unmount — no late onChange call', () => {
    const onChange = vi.fn();
    const { unmount } = render(<SearchField value="" onChange={onChange} debounceMs={300} />);

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'x' } });

    unmount();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
