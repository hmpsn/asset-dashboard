import { useState } from 'react';
import { X, ShoppingCart, Minus, Plus, Trash2, Loader2, Lock, Sparkles, Crown } from 'lucide-react';
import { useCart } from './useCart';
import { post } from '../../api/client';
import { Button, IconButton } from '../ui';

const fmt = (usd: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(usd);

interface SeoCartProps {
  workspaceId: string;
  tier?: 'free' | 'growth' | 'premium';
}

export function SeoCartButton() {
  const { totalItems, toggleCart } = useCart();
  if (totalItems === 0) return null;
  return (
    <Button onClick={toggleCart} icon={ShoppingCart} size="sm" className="relative rounded-[var(--radius-lg)]">
      Cart
      <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white text-[var(--button-primary-text)] rounded-[var(--radius-pill)] t-micro font-bold flex items-center justify-center">
        {totalItems}
      </span>
    </Button>
  );
}

export function SeoCartDrawer({ workspaceId, tier }: SeoCartProps) {
  const { items, isOpen, closeCart, removeItem, updateQuantity, totalPrice, clearCart } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setCheckingOut(true);
    setError(null);
    try {
      const data = await post<{ url?: string; error?: string }>('/api/stripe/cart-checkout', { workspaceId, items: items.map(i => ({ productType: i.productType, quantity: i.quantity, pageIds: i.pageIds })) });
      if (data.url) {
        clearCart();
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to create checkout session');
      }
    } catch (err) {
      console.error('SeoCart operation failed:', err);
      setError('Network error. Please try again.');
    }
    setCheckingOut(false);
  };

  if (!isOpen) return null;

  const showPremiumNudge = totalPrice >= 500 && tier !== 'premium';

  return (
    <>
      {/* Backdrop */}
      {/* z-index-ok — cart backdrop must sit above modal scale */}
      <div
        className={
          'fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]' // fixed-inset-ok -- Cart uses a drawer backdrop paired with the right-side drawer, not a centered dialog.
        }
        onClick={closeCart}
      />

      {/* Drawer */}
      {/* z-index-ok — cart drawer 1 above its own backdrop */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-[var(--surface-2)] border-l border-[var(--brand-border)] z-[61] flex flex-col animate-[slideInRight_0.2s_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--brand-border)]">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-accent-brand" />
            <span className="t-body font-semibold text-[var(--brand-text-bright)]">SEO Fix Cart</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">({items.length} item{items.length !== 1 ? 's' : ''})</span>
          </div>
          <IconButton icon={X} label="Close cart" size="sm" onClick={closeCart} />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-8 h-8 text-[var(--brand-border)] mx-auto mb-3" />
              <p className="t-body text-[var(--brand-text-muted)]">Your cart is empty</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">Add fixes from the Site Health tab</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.productType} className="bg-[var(--surface-3)]/50 border border-[var(--brand-border)]/50 rounded-[var(--radius-xl)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="t-body font-medium text-[var(--brand-text-bright)]">{item.displayName}</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                      {item.isFlat ? 'Full site' : `${fmt(item.priceUsd)}/page`}
                    </div>
                  </div>
                  <div className="t-body font-semibold text-accent-brand">
                    {fmt(item.priceUsd * item.quantity)}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  {item.isFlat ? (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">Flat rate</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <IconButton
                        onClick={() => updateQuantity(item.productType, item.quantity - 1)}
                        icon={Minus}
                        label={`Decrease ${item.displayName} quantity`}
                        size="sm"
                        variant="solid"
                      />
                      <span className="w-8 text-center t-caption font-medium text-[var(--brand-text)]">{item.quantity}</span>
                      <IconButton
                        onClick={() => updateQuantity(item.productType, item.quantity + 1)}
                        icon={Plus}
                        label={`Increase ${item.displayName} quantity`}
                        size="sm"
                        variant="solid"
                      />
                      <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1">pages</span>
                    </div>
                  )}
                  <IconButton icon={Trash2} label={`Remove ${item.displayName}`} size="sm" onClick={() => removeItem(item.productType)} className="hover:text-[var(--red)]" />
                </div>

                {/* Pack upsell for per-page items */}
                {!item.isFlat && item.quantity >= 7 && item.quantity < 10 && (
                  <div className="mt-2 px-2.5 py-2 rounded-[var(--radius-lg)] bg-teal-500/5 border border-teal-500/20">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-accent-brand" />
                      <span className="t-caption-sm text-accent-brand">
                        {item.productType === 'fix_meta'
                          ? 'Get the 10-page pack for $179 (save $' + (item.quantity * 20 - 179) + ' more)'
                          : item.productType === 'schema_page'
                            ? 'Get the 10-page pack for $299 (save $' + (item.quantity * 39 - 299) + ' more)'
                            : `Buy ${10 - item.quantity} more for a pack discount`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-[var(--brand-border)] px-5 py-4 space-y-3">
            {/* Premium upgrade nudge */}
            {showPremiumNudge && (
              <div className="px-3 py-2.5 rounded-[var(--radius-xl)] bg-gradient-to-r from-amber-500/5 to-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <Crown className="w-4 h-4 text-accent-warning mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="t-caption-sm font-medium text-accent-warning">Premium includes all this</div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                      For $999/mo, all technical SEO fixes are included with 3 implementation hours.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between">
              <span className="t-body text-[var(--brand-text)]">Total</span>
              <span className="t-stat-sm text-[var(--brand-text-bright)]">{fmt(totalPrice)}</span>
            </div>

            {/* Error */}
            {error && (
              <div className="t-caption-sm text-accent-danger bg-red-500/10 border border-red-500/20 rounded-[var(--radius-lg)] px-3 py-2">
                {error}
              </div>
            )}

            {/* Checkout button */}
            <Button
              onClick={handleCheckout}
              disabled={checkingOut}
              size="lg"
              className="w-full rounded-[var(--radius-xl)] shadow-lg shadow-teal-900/30 active:scale-[0.98]"
            >
              {checkingOut ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating checkout...</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Checkout {fmt(totalPrice)}</span>
                </>
              )}
            </Button>

            <Button
              onClick={clearCart}
              variant="ghost"
              size="sm"
              className="w-full"
            >
              Clear cart
            </Button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
