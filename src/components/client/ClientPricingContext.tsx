import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { PricingData, PricingModalData } from '../../hooks/usePayments';

export interface ClientPricingContextValue {
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setPricingModal: Dispatch<SetStateAction<PricingModalData | null>>;
  pricingConfirming: boolean;
  pricingData: PricingData | null;
  hidePrices: boolean;
}

const ClientPricingContext = createContext<ClientPricingContextValue | null>(null);

export function ClientPricingProvider({
  value,
  children,
}: {
  value: ClientPricingContextValue;
  children: ReactNode;
}) {
  return (
    <ClientPricingContext.Provider value={value}>
      {children}
    </ClientPricingContext.Provider>
  );
}

export function useClientPricing() {
  const value = useContext(ClientPricingContext);
  if (!value) {
    throw new Error('useClientPricing must be used within ClientPricingProvider');
  }
  return value;
}

export function useOptionalClientPricing() {
  return useContext(ClientPricingContext);
}
