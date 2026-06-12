import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlansTab } from '../../../src/components/client/PlansTab';
import { contentSubscriptions } from '../../../src/api/misc';
import type { WorkspaceInfo } from '../../../src/components/client/types';

vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

vi.mock('../../../src/api/client', () => ({
  post: vi.fn(),
}));

vi.mock('../../../src/api/misc', () => ({
  contentSubscriptions: {
    clientStatus: vi.fn(),
    subscribe: vi.fn(),
  },
}));

const mockClientStatus = vi.mocked(contentSubscriptions.clientStatus);
const mockSubscribe = vi.mocked(contentSubscriptions.subscribe);

const baseWorkspace: WorkspaceInfo = {
  id: 'ws-1',
  name: 'Acme Dental',
  tier: 'free',
  billingMode: 'platform',
};

function renderPlans(overrides: Partial<ComponentProps<typeof PlansTab>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/client/ws-1/plans']}>
        <PlansTab
          workspaceId="ws-1"
          ws={baseWorkspace}
          effectiveTier="free"
          briefPrice={175}
          fullPostPrice={575}
          fmtPrice={(n) => `$${n.toLocaleString()}`}
          setToast={vi.fn()}
          onOpenChat={vi.fn()}
          pricingData={{
            products: {
              plan_growth: { displayName: 'Growth Plan', price: 299, category: 'Dashboard Plans', enabled: true },
              plan_premium: { displayName: 'Premium Plan', price: 1099, category: 'Dashboard Plans', enabled: true },
            },
            bundles: [],
            currency: 'USD',
            stripeEnabled: true,
          }}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PlansTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientStatus.mockResolvedValue({
      subscription: null,
      plans: [
        {
          plan: 'content_starter',
          displayName: 'Starter Content',
          postsPerMonth: 2,
          priceUsd: 500,
          description: '2 SEO-optimized posts per month',
        },
      ],
    });
    mockSubscribe.mockResolvedValue({ sessionId: 'cs_test_123', url: 'https://checkout.example/session' });
  });

  it('shows upgrade and subscription prices directly on checkout CTAs', async () => {
    renderPlans();

    expect(screen.getByRole('button', { name: /Upgrade to Growth - \$299\/mo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upgrade to Premium - \$1,099\/mo/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Subscribe - \$500\/mo/i })).toBeInTheDocument();
    });
  });

  it('hides platform prices for external billing workspaces', async () => {
    const onOpenChat = vi.fn();
    renderPlans({
      ws: { ...baseWorkspace, billingMode: 'external' },
      hidePrices: true,
      onOpenChat,
    });

    const growthContactButton = screen.getByRole('button', { name: /^Contact us about Growth$/i });
    expect(screen.getByRole('button', { name: /^Contact us about Premium$/i })).toBeInTheDocument();
    fireEvent.click(growthContactButton);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Starter Content')).toBeInTheDocument();
    });
    const packageCard = screen.getByText('Starter Content').closest('div');
    expect(packageCard).not.toBeNull();
    fireEvent.click(within(packageCard as HTMLElement).getByRole('button', { name: /^Contact us about Starter Content$/i }));
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(onOpenChat).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });
});
