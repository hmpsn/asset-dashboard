import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

// A component that throws on render
function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Test explosion');
  return <p>Working fine</p>;
}

describe('ErrorBoundary', () => {
  // Suppress console.error from React's error boundary logging
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <p>Hello</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows default error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test explosion')).toBeInTheDocument();
  });

  it('shows label-specific message when label is provided', () => {
    render(
      <ErrorBoundary label="Chart Widget">
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Chart Widget failed to load')).toBeInTheDocument();
  });

  it('shows Retry button in error state', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('resets error state when Retry is clicked (re-renders children)', () => {
    // Use a flag that we control externally to avoid React concurrent retry issues
    let shouldThrow = true;

    function ConditionalThrower() {
      if (shouldThrow) throw new Error('Boom');
      return <p>Recovered</p>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    );

    // Error caught — shows Retry
    expect(screen.getByText('Retry')).toBeInTheDocument();

    // Set flag so next render succeeds, then click Retry
    shouldThrow = false;
    fireEvent.click(screen.getByText('Retry'));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error View</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom Error View')).toBeInTheDocument();
    // Default error UI should NOT be rendered
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('logs error to console', () => {
    render(
      <ErrorBoundary label="TestLabel">
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(console.error).toHaveBeenCalled();
  });
});
