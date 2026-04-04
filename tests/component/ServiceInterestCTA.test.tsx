import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('ServiceInterestCTA', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders "Explore content recommendations" for content_interest type', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="content_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText(/Explore content recommendations/i)).toBeInTheDocument();
  });

  it('renders "Get in touch" for service_interest type', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText(/Get in touch/i)).toBeInTheDocument();
  });

  it('calls onAction immediately for content_interest without a fetch', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    const onAction = vi.fn();
    render(
      <ServiceInterestCTA type="content_interest" workspaceId="ws-1" onAction={onAction} />,
      { wrapper: makeWrapper() },
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onAction).toHaveBeenCalledWith('content_interest');
  });

  it('button is not disabled on initial render', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByRole('button', { name: /Get in touch/i })).not.toBeDisabled();
  });

  it('shows confirmed state after successful service_interest signal', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    fireEvent.click(screen.getByRole('button', { name: /Get in touch/i }));
    await waitFor(() => {
      expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument();
    });
  });

  it('shows rate-limited state with retry button on 429 response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ error: 'Too many requests' }),
    } as unknown as Response);

    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    fireEvent.click(screen.getByRole('button', { name: /Get in touch/i }));
    await waitFor(() => {
      expect(screen.getByText(/try again in a moment/i)).toBeInTheDocument();
    });
    // Retry button must exist so user can actually retry
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows error state with retry button on generic failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Internal server error' }),
    } as unknown as Response);

    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    fireEvent.click(screen.getByRole('button', { name: /Get in touch/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('retry button resets to idle state so user can try again', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Internal server error' }),
    } as unknown as Response);

    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />,
      { wrapper: makeWrapper() },
    );
    fireEvent.click(screen.getByRole('button', { name: /Get in touch/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    // After reset, main CTA button returns
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Get in touch/i })).toBeInTheDocument();
    });
  });
});
