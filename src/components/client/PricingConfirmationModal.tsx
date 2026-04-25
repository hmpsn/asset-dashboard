import { Suspense } from 'react';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import {
  Loader2, X, Target, Sparkles, FileText, Shield, Lock, Check,
} from 'lucide-react';
import { getSafe } from '../../api/client';
import { STUDIO_NAME } from '../../constants';
import type { PricingModalData, StripePaymentData } from '../../hooks/usePayments';
import type { WorkspaceInfo, ClientContentRequest } from './types';

const LazyStripePaymentModal = lazyWithRetry(() => import('../StripePaymentForm').then(m => ({ default: m.StripePaymentModal })));

interface Props {
  /** @deprecated Kept for call-site compat; no longer gates rendering. */
  betaMode?: boolean;
  billingMode?: 'platform' | 'external';
  pricingModal: PricingModalData | null;
  setPricingModal: React.Dispatch<React.SetStateAction<PricingModalData | null>>;
  pricingConfirming: boolean;
  confirmPricingAndSubmit: () => void;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  contentPricing: WorkspaceInfo['contentPricing'] | undefined;
  stripePayment: StripePaymentData | null;
  setStripePayment: React.Dispatch<React.SetStateAction<StripePaymentData | null>>;
  workspaceId: string;
  setContentRequests: React.Dispatch<React.SetStateAction<ClientContentRequest[]>>;
  setToast: (t: { message: string; type: 'success' | 'error' } | null) => void;
}

export function PricingConfirmationModal({
  // betaMode kept in props for prop-spread call sites; no longer gates rendering since
  // returning null here left the request stuck (setPricingModal was set, modal absent).
  billingMode,
  pricingModal,
  setPricingModal,
  pricingConfirming,
  confirmPricingAndSubmit,
  briefPrice,
  fullPostPrice,
  fmtPrice,
  contentPricing,
  stripePayment,
  setStripePayment,
  workspaceId,
  setContentRequests,
  setToast,
}: Props) {
  if (!pricingModal && !stripePayment) return null;
  const isExternal = billingMode === 'external';

  return (
    <>
      {/* Pricing confirmation modal */}
      {pricingModal && (() => {
        const pricing = contentPricing;
        const isUpgrade = pricingModal.source === 'upgrade';
        const isFull = pricingModal.serviceType === 'full_post';
        const price = isFull ? fullPostPrice : briefPrice;
        const upgradePrice = isUpgrade && briefPrice != null && fullPostPrice != null ? Math.max(0, fullPostPrice - briefPrice) : null;
        // External-billing workspaces don't show a price — they pay off-platform — so
        // we route through the existing "Confirm Request" branch by forcing displayPrice
        // to null. The CTA below picks the no-price branch automatically.
        const displayPrice = isExternal ? null : (isUpgrade ? upgradePrice : price);
        const fmt = fmtPrice;
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[70] flex items-center justify-center p-4" onClick={() => !pricingConfirming && setPricingModal(null)}>
            <div className="relative bg-zinc-900 border border-zinc-700/50 shadow-2xl shadow-black/50 w-full max-w-md overflow-hidden animate-[scaleIn_0.2s_ease-out]" style={{ borderRadius: '10px 24px 10px 24px' }} onClick={e => e.stopPropagation()}>
              {/* Close button */}
              <button
                onClick={() => !pricingConfirming && setPricingModal(null)}
                className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header with gradient */}
              <div className="relative px-6 pt-6 pb-5 overflow-hidden bg-gradient-to-br from-teal-600/15 via-emerald-600/10 to-transparent">
                {/* Decorative glow */}
                <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-20 bg-teal-500" />

                <div className="relative flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center ring-1 bg-gradient-to-br from-teal-500/25 to-emerald-500/25 ring-teal-500/20">
                      {isFull ? <Sparkles className="w-5 h-5 text-teal-400" /> : <FileText className="w-5 h-5 text-teal-400" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-zinc-100">
                        {isUpgrade ? 'Upgrade to Full Blog Post' : isFull ? (pricing?.fullPostLabel || 'Full Blog Post') : (pricing?.briefLabel || 'Content Brief')}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {isUpgrade ? 'Continue from your approved brief' : 'Confirm your content request'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Topic card */}
                <div className="px-3.5 py-3 border bg-teal-950/30 border-teal-500/10" style={{ borderRadius: '6px 12px 6px 12px' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-3 h-3 text-teal-400/70" />
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Topic</span>
                  </div>
                  <div className="text-xs text-zinc-200 font-medium leading-relaxed">{pricingModal.topic}</div>
                  <div className="text-[11px] mt-1 text-teal-400/80">Keyword: &ldquo;{pricingModal.targetKeyword}&rdquo;</div>
                </div>
              </div>

              {/* Price banner */}
              {displayPrice != null && (
                <div className="mx-6 flex items-center justify-between px-4 py-3 border bg-teal-500/5 border-teal-500/15" style={{ borderRadius: '6px 12px 6px 12px' }}>
                  <div>
                    <div className="text-2xl font-bold tracking-tight text-teal-300">{fmt(displayPrice)}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{isUpgrade ? 'Upgrade difference' : 'One-time payment'}</div>
                  </div>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-teal-500/10">
                    <Shield className="w-4 h-4 text-teal-400/60" />
                  </div>
                </div>
              )}
              {displayPrice == null && (
                <div className="mx-6 mt-0 mb-0 text-[11px] text-zinc-500 bg-zinc-800/40 px-4 py-3 border border-zinc-700/30" style={{ borderRadius: '6px 12px 6px 12px' }}>
                  <Lock className="w-3 h-3 inline mr-1.5 -mt-0.5" />
                  {isExternal
                    ? `Billing for this request is handled separately by ${STUDIO_NAME}.`
                    : `Pricing will be confirmed by ${STUDIO_NAME} after submission.`}
                </div>
              )}

              {/* Actions */}
              <div className="px-6 pb-5 space-y-3">
                <button
                  disabled={pricingConfirming}
                  onClick={confirmPricingAndSubmit}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 shadow-lg active:scale-[0.98] bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 shadow-teal-900/40"
                >
                  {pricingConfirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing…</span>
                    </>
                  ) : displayPrice != null ? (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Pay {fmt(displayPrice)} securely</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm Request</span>
                    </>
                  )}
                </button>
                <button
                  disabled={pricingConfirming}
                  onClick={() => setPricingModal(null)}
                  className="w-full px-4 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
                >
                  Cancel
                </button>

                {/* Trust footer — hidden for external billing (no Stripe path) */}
                {!isExternal && (
                  <div className="flex items-center justify-center gap-4 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-zinc-600" />
                      <span className="text-[10px] text-zinc-600">SSL Encrypted</span>
                    </div>
                    <div className="w-px h-3 bg-zinc-800" />
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3 h-3 text-zinc-600" viewBox="0 0 24 24" fill="currentColor"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/></svg>
                      <span className="text-[10px] text-zinc-600">Powered by Stripe</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stripe Elements inline payment modal (lazy-loaded — Stripe SDK only fetched on payment) */}
      {stripePayment && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-teal-400" /></div>}>
          <LazyStripePaymentModal
            clientSecret={stripePayment.clientSecret}
            publishableKey={stripePayment.publishableKey}
            amount={stripePayment.amount}
            productName={stripePayment.productName}
            topic={stripePayment.topic}
            targetKeyword={stripePayment.targetKeyword}
            isFull={stripePayment.isFull}
            onSuccess={() => {
              setStripePayment(null);
              setToast({ message: `Payment successful! Your ${stripePayment.productName.toLowerCase()} is being prepared.`, type: 'success' });
              // Refresh content requests
              getSafe<ClientContentRequest[]>(`/api/public/content-requests/${workspaceId}`, []).then(setContentRequests).catch((err) => { console.error('PricingConfirmationModal operation failed:', err); });
            }}
            onClose={() => setStripePayment(null)}
          />
        </Suspense>
      )}
    </>
  );
}
