import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../../src/components/Toast';

// Helper component that triggers toasts via the useToast hook
function ToastTrigger({ message, type }: { message: string; type?: 'success' | 'error' | 'info' }) {
  const { toast } = useToast();
  return <button onClick={() => toast(message, type)}>Show Toast</button>;
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without showing any toasts initially', () => {
    render(
      <ToastProvider>
        <p>App Content</p>
      </ToastProvider>
    );
    expect(screen.getByText('App Content')).toBeInTheDocument();
  });

  it('shows toast message when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Saved!" />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show Toast').click();
    });

    // Advance past requestAnimationFrame
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('auto-dismisses toast after 3 seconds', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Temp message" />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show Toast').click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByText('Temp message')).toBeInTheDocument();

    // Advance past 3000ms timeout + 200ms fade out
    act(() => {
      vi.advanceTimersByTime(3200);
    });

    expect(screen.queryByText('Temp message')).toBeNull();
  });

  it('shows multiple toasts', () => {
    function MultiTrigger() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast('First')}>Toast 1</button>
          <button onClick={() => toast('Second')}>Toast 2</button>
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Toast 1').click();
      screen.getByText('Toast 2').click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('defaults to success type', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Success toast" />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show Toast').click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Success toast should have emerald border class
    const toastEl = screen.getByText('Success toast').closest('div');
    expect(toastEl!.className).toContain('border-emerald-500/20');
  });

  it('renders error type with red border', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error toast" type="error" />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show Toast').click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const toastEl = screen.getByText('Error toast').closest('div');
    expect(toastEl!.className).toContain('border-red-500/20');
  });

  it('renders info type with blue border', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Info toast" type="info" />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show Toast').click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    const toastEl = screen.getByText('Info toast').closest('div');
    expect(toastEl!.className).toContain('border-blue-500/20');
  });

  it('has a close button on each toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Closeable" />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Show Toast').click();
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // The X button is inside the toast
    const toastContainer = screen.getByText('Closeable').closest('div')!;
    const closeBtn = toastContainer.querySelector('button');
    expect(closeBtn).not.toBeNull();
  });
});
