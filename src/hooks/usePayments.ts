import { useState, useCallback } from 'react';
import { post, get, getSafe } from '../api/client';
import type { WorkspaceInfo, ClientContentRequest } from '../components/client/types';
import { STUDIO_NAME } from '../constants';

export interface PricingModalData {
  serviceType: 'brief_only' | 'full_post';
  topic: string;
  targetKeyword: string;
  intent?: string;
  priority?: string;
  rationale?: string;
  notes?: string;
  source: 'strategy' | 'client' | 'upgrade';
  upgradeReqId?: string;
  pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  targetPageId?: string;
  targetPageSlug?: string;
}

export interface StripePaymentData {
  clientSecret: string;
  publishableKey: string;
  amount: number;
  productName: string;
  topic: string;
  targetKeyword: string;
  isFull: boolean;
}

export interface PricingData {
  products: Record<string, { displayName: string; price: number; category: string; enabled: boolean }>;
  bundles: { id: string; name: string; monthlyPrice: number; includes: string[]; savings: string }[];
  currency: string;
  stripeEnabled: boolean;
}

export interface PaymentsState {
  pricingModal: PricingModalData | null;
  pricingConfirming: boolean;
  pricingData: PricingData | null;
  stripePayment: StripePaymentData | null;
}

export interface PaymentsActions {
  setPricingModal: React.Dispatch<React.SetStateAction<PricingModalData | null>>;
  setPricingConfirming: React.Dispatch<React.SetStateAction<boolean>>;
  setPricingData: React.Dispatch<React.SetStateAction<PricingData | null>>;
  setStripePayment: React.Dispatch<React.SetStateAction<StripePaymentData | null>>;
  confirmPricingAndSubmit: () => Promise<void>;
}

export function usePayments(
  workspaceId: string,
  ws: WorkspaceInfo | null,
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void,
  setContentRequests: React.Dispatch<React.SetStateAction<ClientContentRequest[]>>,
  setRequestedTopics: React.Dispatch<React.SetStateAction<Set<string>>>,
  setRequestingTopic: React.Dispatch<React.SetStateAction<string | null>>,
): PaymentsState & PaymentsActions {
  const [pricingModal, setPricingModal] = useState<PricingModalData | null>(null);
  const [pricingConfirming, setPricingConfirming] = useState(false);
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [stripePayment, setStripePayment] = useState<StripePaymentData | null>(null);

  const confirmPricingAndSubmit = useCallback(async () => {
    if (!pricingModal) return;
    setPricingConfirming(true);
    try {
      // --- Stripe Elements inline payment (when configured) ---
      if (ws?.stripeEnabled) {
        let contentRequestId: string | undefined;
        if (pricingModal.source === 'upgrade' && pricingModal.upgradeReqId) {
          contentRequestId = pricingModal.upgradeReqId;
        } else if (pricingModal.source === 'strategy') {
          const created = await post<{ id: string }>(`/api/public/content-request/${workspaceId}`, { topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', initialStatus: 'pending_payment', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug });
          contentRequestId = created.id;
        } else {
          const created = await post<{ id: string }>(`/api/public/content-request/${workspaceId}/submit`, { topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', initialStatus: 'pending_payment', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug });
          contentRequestId = created.id;
        }

        const productType = pricingModal.serviceType === 'full_post' ? 'post_polished' : 'brief_blog';

        const { publishableKey } = await get<{ publishableKey: string }>('/api/stripe/publishable-key');

        if (publishableKey) {
          const { clientSecret, amount } = await post<{ clientSecret: string; amount: number }>('/api/stripe/create-payment-intent', { workspaceId, productType, contentRequestId, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword });
          const isFull = pricingModal.serviceType === 'full_post';
          const productName = isFull ? (ws?.contentPricing?.fullPostLabel || 'Full Blog Post') : (ws?.contentPricing?.briefLabel || 'Content Brief');

          setPricingModal(null);
          setPricingConfirming(false);
          setStripePayment({ clientSecret, publishableKey, amount, productName, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, isFull });
          return;
        }

        const { url } = await post<{ url: string }>('/api/stripe/create-checkout', { workspaceId, productType, contentRequestId, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword });
        if (url) {
          window.location.href = url;
          return;
        }
      }

      // --- Fallback: direct submit (no Stripe) ---
      if (pricingModal.source === 'upgrade' && pricingModal.upgradeReqId) {
        const updated = await post<ClientContentRequest>(`/api/public/content-request/${workspaceId}/${pricingModal.upgradeReqId}/upgrade`);
        setContentRequests(prev => prev.map(r => r.id === pricingModal.upgradeReqId ? updated : r));
        setToast({ message: `Upgraded to full blog post! ${STUDIO_NAME} will begin writing.`, type: 'success' });
      } else if (pricingModal.source === 'strategy') {
        setRequestingTopic(pricingModal.targetKeyword);
        await post(`/api/public/content-request/${workspaceId}`, { topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug });
        setRequestedTopics(prev => new Set(prev).add(pricingModal.targetKeyword));
        getSafe<ClientContentRequest[]>(`/api/public/content-requests/${workspaceId}`, []).then((reqs) => {
          if (Array.isArray(reqs) && reqs.length > 0) setContentRequests(reqs);
        }).catch((err) => { console.error('usePayments operation failed:', err); });
        const label = pricingModal.serviceType === 'full_post' ? 'Full blog post' : 'Brief';
        setToast({ message: `${label} requested for "${pricingModal.topic}"! Check the Content tab.`, type: 'success' });
        setRequestingTopic(null);
      } else {
        const created = await post<ClientContentRequest>(`/api/public/content-request/${workspaceId}/submit`, { topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug });
        setContentRequests(prev => [created, ...prev]);
        setRequestedTopics(prev => new Set(prev).add(created.targetKeyword));
        setToast({ message: `Topic submitted! ${STUDIO_NAME} will review it.`, type: 'success' });
      }
    } catch (err) {
      console.error('Content request failed:', err);
      setToast({ message: err instanceof Error ? err.message : 'Failed to submit request. Please try again.', type: 'error' });
    }
    setPricingConfirming(false);
    setPricingModal(null);
  }, [pricingModal, ws, workspaceId, setToast, setContentRequests, setRequestedTopics, setRequestingTopic]);

  return {
    pricingModal, setPricingModal,
    pricingConfirming, setPricingConfirming,
    pricingData, setPricingData,
    stripePayment, setStripePayment,
    confirmPricingAndSubmit,
  };
}
