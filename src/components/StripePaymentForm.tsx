import { useState, useMemo, useCallback } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, Lock, CheckCircle2, AlertTriangle, X, Shield, ArrowLeft } from 'lucide-react';
import { themeColor } from './ui/constants';

// --- Stripe singleton (loaded once per publishable key) ---

let _stripePromise: Promise<Stripe | null> | null = null;
let _lastPk = '';

function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  if (publishableKey !== _lastPk) {
    _stripePromise = loadStripe(publishableKey);
    _lastPk = publishableKey;
  }
  return _stripePromise!;
}

// --- Inner form (must be inside <Elements>) ---

interface PaymentFormInnerProps {
  amount: number;
  productName: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
  accentColor: 'teal' | 'blue';
}

function PaymentFormInner({ amount, productName, onSuccess, onCancel }: PaymentFormInnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const fmt = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (result.error) {
      setError(result.error.message || 'Payment failed. Please try again.');
      setProcessing(false);
    } else if (result.paymentIntent?.status === 'succeeded') {
      setSucceeded(true);
      setProcessing(false);
      setTimeout(() => onSuccess(result.paymentIntent!.id), 1500);
    } else {
      // Handle other statuses (requires_action, etc.)
      setError('Payment requires additional action. Please try again.');
      setProcessing(false);
    }
  }, [stripe, elements, onSuccess]);

  // Success state
  if (succeeded) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4 animate-[scaleIn_0.3s_ease-out]">
        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-teal-500/15 ring-1 ring-teal-500/30">
          <CheckCircle2 className="w-8 h-8 text-teal-400" />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-zinc-100">Payment Successful</div>
          <div className="text-[11px] text-zinc-500 mt-1">{fmt(amount)} paid for {productName}</div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Payment Element */}
      <div className="-mx-1">
        <PaymentElement
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400/80 mt-0.5 flex-shrink-0" />
          <span className="text-[11px] text-red-300 leading-relaxed">{error}</span>
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 shadow-lg active:scale-[0.98] bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 shadow-teal-900/40"
      >
        {processing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Processing…</span>
          </>
        ) : (
          <>
            <Lock className="w-3.5 h-3.5" />
            <span>Pay {fmt(amount)}</span>
          </>
        )}
      </button>

      {/* Cancel */}
      <button
        type="button"
        onClick={onCancel}
        disabled={processing}
        className="w-full px-4 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all flex items-center justify-center gap-1.5"
      >
        <ArrowLeft className="w-3 h-3" />
        Back
      </button>

      {/* Trust footer */}
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
    </form>
  );
}

// --- Outer wrapper (loads Stripe + creates Elements context) ---

export interface StripePaymentFormProps {
  clientSecret: string;
  publishableKey: string;
  amount: number;
  productName: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
  accentColor?: 'teal' | 'blue';
}

export function StripePaymentForm({
  clientSecret,
  publishableKey,
  amount,
  productName,
  onSuccess,
  onCancel,
  accentColor = 'teal',
}: StripePaymentFormProps) {
  const stripePromise = useMemo(
    () => (publishableKey ? getStripePromise(publishableKey) : null),
    [publishableKey],
  );

  if (!stripePromise || !clientSecret) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: accentColor === 'blue' ? '#3b82f6' : '#14b8a6',
            colorBackground: '#09090b',
            colorText: '#e4e4e7',
            colorTextSecondary: themeColor('#a1a1aa', '#334155'),
            colorTextPlaceholder: themeColor('#52525b', '#94a3b8'),
            colorDanger: '#ef4444',
            colorIcon: themeColor('#71717a', '#64748b'),
            colorIconTabSelected: accentColor === 'blue' ? '#3b82f6' : '#14b8a6',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSizeBase: '13px',
            fontSizeSm: '12px',
            fontSizeXs: '11px',
            borderRadius: '10px',
            spacingUnit: '4px',
            spacingGridRow: '14px',
            spacingTab: '10px',
          },
          rules: {
            '.Input': {
              backgroundColor: themeColor('rgba(24, 24, 27, 0.8)', 'rgba(241, 245, 249, 0.7)'),
              border: `1px solid ${themeColor('rgba(63, 63, 70, 0.6)', 'rgba(203, 213, 225, 0.5)')}`,
              boxShadow: 'none',
              padding: '10px 12px',
              transition: 'border-color 0.15s ease',
            },
            '.Input:focus': {
              border: `1px solid ${accentColor === 'blue' ? 'rgba(59, 130, 246, 0.5)' : 'rgba(20, 184, 166, 0.5)'}`,
              boxShadow: `0 0 0 1px ${accentColor === 'blue' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(20, 184, 166, 0.1)'}`,
            },
            '.Label': {
              color: themeColor('#71717a', '#64748b'),
              fontSize: '10px',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '6px',
            },
            '.Tab': {
              backgroundColor: 'transparent',
              border: `1px solid ${themeColor('rgba(63, 63, 70, 0.4)', 'rgba(203, 213, 225, 0.5)')}`,
              borderRadius: '8px',
              boxShadow: 'none',
              transition: 'all 0.15s ease',
            },
            '.Tab:hover': {
              backgroundColor: themeColor('rgba(39, 39, 42, 0.5)', 'rgba(241, 245, 249, 0.7)'),
              border: `1px solid ${themeColor('rgba(63, 63, 70, 0.7)', 'rgba(203, 213, 225, 0.7)')}`,
              color: '#e4e4e7',
            },
            '.Tab--selected': {
              backgroundColor: accentColor === 'blue' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(20, 184, 166, 0.08)',
              border: `1px solid ${accentColor === 'blue' ? 'rgba(59, 130, 246, 0.35)' : 'rgba(20, 184, 166, 0.35)'}`,
              boxShadow: `0 0 0 1px ${accentColor === 'blue' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(20, 184, 166, 0.08)'}`,
              color: '#e4e4e7',
            },
            '.Tab--selected:hover': {
              backgroundColor: accentColor === 'blue' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(20, 184, 166, 0.12)',
              border: `1px solid ${accentColor === 'blue' ? 'rgba(59, 130, 246, 0.45)' : 'rgba(20, 184, 166, 0.45)'}`,
            },
            '.TabLabel': {
              fontSize: '11px',
              fontWeight: '500',
            },
            '.TabIcon': {
              width: '16px',
              height: '16px',
            },
            '.Block': {
              backgroundColor: 'transparent',
              borderColor: themeColor('rgba(63, 63, 70, 0.4)', 'rgba(203, 213, 225, 0.5)'),
            },
            '.CheckboxInput': {
              backgroundColor: themeColor('rgba(24, 24, 27, 0.8)', 'rgba(241, 245, 249, 0.7)'),
              borderColor: themeColor('rgba(63, 63, 70, 0.6)', 'rgba(203, 213, 225, 0.5)'),
            },
            '.PickerItem': {
              backgroundColor: themeColor('rgba(24, 24, 27, 0.8)', 'rgba(241, 245, 249, 0.7)'),
              borderColor: themeColor('rgba(63, 63, 70, 0.4)', 'rgba(203, 213, 225, 0.5)'),
              padding: '10px 12px',
            },
            '.PickerItem--selected': {
              backgroundColor: accentColor === 'blue' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(20, 184, 166, 0.08)',
              borderColor: accentColor === 'blue' ? 'rgba(59, 130, 246, 0.35)' : 'rgba(20, 184, 166, 0.35)',
            },
          },
        },
      }}
    >
      <PaymentFormInner
        amount={amount}
        productName={productName}
        onSuccess={onSuccess}
        onCancel={onCancel}
        accentColor={accentColor}
      />
    </Elements>
  );
}

// --- Modal wrapper for use in ClientDashboard ---

export interface PaymentModalProps {
  clientSecret: string;
  publishableKey: string;
  amount: number;
  productName: string;
  topic: string;
  targetKeyword: string;
  isFull: boolean;
  onSuccess: (paymentIntentId: string) => void;
  onClose: () => void;
}

export function StripePaymentModal({
  clientSecret,
  publishableKey,
  amount,
  productName,
  topic,
  targetKeyword,
  isFull,
  onSuccess,
  onClose,
}: PaymentModalProps) {
  const accentColor = isFull ? 'blue' : 'teal';
  const fmt = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md overflow-hidden animate-[scaleIn_0.2s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 overflow-hidden bg-gradient-to-br from-teal-600/15 via-emerald-600/10 to-transparent">
          <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-20 bg-teal-500" />
          <div className="relative">
            <div className="text-sm font-semibold text-zinc-100 mb-1">{productName}</div>
            <div className="text-[11px] text-zinc-500">{topic}</div>
            <div className="text-[11px] mt-0.5 text-teal-400/80">
              Keyword: &ldquo;{targetKeyword}&rdquo;
            </div>
          </div>

          {/* Price badge */}
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg border bg-teal-500/5 border-teal-500/20">
            <span className="text-lg font-bold tracking-tight text-teal-300">
              {fmt(amount)}
            </span>
            <span className="text-[10px] text-zinc-500">one-time</span>
          </div>
        </div>

        {/* Payment form */}
        <div className="px-6 py-5">
          <StripePaymentForm
            clientSecret={clientSecret}
            publishableKey={publishableKey}
            amount={amount}
            productName={productName}
            onSuccess={onSuccess}
            onCancel={onClose}
            accentColor={accentColor}
          />
        </div>
      </div>
    </div>
  );
}
