import { useState, useCallback } from 'react';
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
          const res = await fetch(`/api/public/content-request/${workspaceId}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', initialStatus: 'pending_payment', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
          });
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const created = await res.json();
          contentRequestId = created.id;
        } else {
          const res = await fetch(`/api/public/content-request/${workspaceId}/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', initialStatus: 'pending_payment', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
          });
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const created = await res.json();
          contentRequestId = created.id;
        }

        const productType = pricingModal.serviceType === 'full_post' ? 'post_polished' : 'brief_blog';

        const pkRes = await fetch('/api/stripe/publishable-key');
        const { publishableKey } = await pkRes.json();

        if (publishableKey) {
          const piRes = await fetch('/api/stripe/create-payment-intent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, productType, contentRequestId, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword }),
          });
          if (!piRes.ok) {
            const err = await piRes.json().catch(() => ({ error: 'Payment failed' }));
            throw new Error(err.error || 'Failed to create payment');
          }
          const { clientSecret, amount } = await piRes.json();
          const isFull = pricingModal.serviceType === 'full_post';
          const productName = isFull ? (ws?.contentPricing?.fullPostLabel || 'Full Blog Post') : (ws?.contentPricing?.briefLabel || 'Content Brief');

          setPricingModal(null);
          setPricingConfirming(false);
          setStripePayment({ clientSecret, publishableKey, amount, productName, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, isFull });
          return;
        }

        const checkoutRes = await fetch('/api/stripe/create-checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, productType, contentRequestId, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword }),
        });
        if (!checkoutRes.ok) {
          const err = await checkoutRes.json().catch(() => ({ error: 'Checkout failed' }));
          throw new Error(err.error || 'Failed to create checkout session');
        }
        const { url } = await checkoutRes.json();
        if (url) {
          window.location.href = url;
          return;
        }
      }

      // --- Fallback: direct submit (no Stripe) ---
      if (pricingModal.source === 'upgrade' && pricingModal.upgradeReqId) {
        const upRes = await fetch(`/api/public/content-request/${workspaceId}/${pricingModal.upgradeReqId}/upgrade`, { method: 'POST' });
        if (upRes.ok) {
          const updated = await upRes.json();
          setContentRequests(prev => prev.map(r => r.id === pricingModal.upgradeReqId ? updated : r));
          setToast({ message: `Upgraded to full blog post! ${STUDIO_NAME} will begin writing.`, type: 'success' });
        }
      } else if (pricingModal.source === 'strategy') {
        setRequestingTopic(pricingModal.targetKeyword);
        const res = await fetch(`/api/public/content-request/${workspaceId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        setRequestedTopics(prev => new Set(prev).add(pricingModal.targetKeyword));
        fetch(`/api/public/content-requests/${workspaceId}`).then(r => r.ok ? r.json() : []).then((reqs: ClientContentRequest[]) => {
          if (Array.isArray(reqs) && reqs.length > 0) setContentRequests(reqs);
        }).catch(() => {});
        const label = pricingModal.serviceType === 'full_post' ? 'Full blog post' : 'Brief';
        setToast({ message: `${label} requested for "${pricingModal.topic}"! Check the Content tab.`, type: 'success' });
        setRequestingTopic(null);
      } else {
        const res = await fetch(`/api/public/content-request/${workspaceId}/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
        });
        if (res.ok) {
          const created = await res.json();
          setContentRequests(prev => [created, ...prev]);
          setRequestedTopics(prev => new Set(prev).add(created.targetKeyword));
          setToast({ message: `Topic submitted! ${STUDIO_NAME} will review it.`, type: 'success' });
        }
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
