import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ServiceInterestCTA', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders "Explore content recommendations" for content_interest type', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <Wrapper>
        <ServiceInterestCTA type="content_interest" workspaceId="ws-1" onAction={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByText(/Explore content recommendations/i)).toBeInTheDocument();
  });

  it('renders "Get in touch" for service_interest type', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByText(/Get in touch/i)).toBeInTheDocument();
  });

  it('calls onAction with the correct type when content_interest button is clicked', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    const onAction = vi.fn();
    render(
      <Wrapper>
        <ServiceInterestCTA type="content_interest" workspaceId="ws-1" onAction={onAction} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onAction).toHaveBeenCalledWith('content_interest');
  });

  it('button is not disabled on initial render', async () => {
    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('shows confirmed state after successful service_interest signal', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument();
    });
  });

  it('shows rate-limited message on 429 response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: (h: string) => h === 'Retry-After' ? '45' : null },
      json: async () => ({ error: 'Too many requests' }),
    } as unknown as Response);

    const { ServiceInterestCTA } = await import('../../src/components/client/ServiceInterestCTA.js');
    render(
      <Wrapper>
        <ServiceInterestCTA type="service_interest" workspaceId="ws-1" onAction={vi.fn()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText(/try again/i)).toBeInTheDocument();
    });
  });
});
