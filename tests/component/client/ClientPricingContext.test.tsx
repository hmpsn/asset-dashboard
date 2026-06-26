import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientPricingProvider, useClientPricing, type ClientPricingContextValue } from '../../../src/components/client/ClientPricingContext';

function PricingProbe() {
  const pricing = useClientPricing();
  return (
    <button
      onClick={() => pricing.setPricingModal({
        serviceType: 'brief_only',
        topic: 'Local SEO',
        targetKeyword: 'local seo',
        source: 'client',
        pageType: 'blog',
      })}
    >
      {pricing.fmtPrice(pricing.briefPrice ?? 0)}
    </button>
  );
}

function renderWithProvider(value: Partial<ClientPricingContextValue> = {}) {
  const setPricingModal = vi.fn();
  const contextValue: ClientPricingContextValue = {
    briefPrice: 125,
    fullPostPrice: 450,
    fmtPrice: (n) => `$${n}`,
    setPricingModal,
    pricingConfirming: false,
    pricingData: null,
    hidePrices: false,
    ...value,
  };

  render(
    <ClientPricingProvider value={contextValue}>
      <PricingProbe />
    </ClientPricingProvider>,
  );

  return { setPricingModal };
}

describe('ClientPricingContext', () => {
  it('fails loudly when a strict pricing consumer is mounted without a provider', () => {
    expect(() => render(<PricingProbe />)).toThrow('useClientPricing must be used within ClientPricingProvider');
  });

  it('routes pricing actions through the provider value', async () => {
    const { setPricingModal } = renderWithProvider();

    await userEvent.click(screen.getByRole('button', { name: '$125' }));

    expect(setPricingModal).toHaveBeenCalledWith({
      serviceType: 'brief_only',
      topic: 'Local SEO',
      targetKeyword: 'local seo',
      source: 'client',
      pageType: 'blog',
    });
  });
});
