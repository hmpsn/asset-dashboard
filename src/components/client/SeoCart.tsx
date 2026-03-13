import { useState } from 'react';
import { X, ShoppingCart, Minus, Plus, Trash2, Loader2, Lock, Sparkles, Crown } from 'lucide-react';
import { useCart } from './useCart';
import { post } from '../../api/client';

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
    <button
      onClick={toggleCart}
      className="relative flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors"
    >
      <ShoppingCart className="w-3.5 h-3.5" />
      <span>Cart</span>
      <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white text-zinc-900 rounded-full text-[10px] font-bold flex items-center justify-center">
        {totalItems}
      </span>
    </button>
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
    } catch {
      setError('Network error. Please try again.');
    }
    setCheckingOut(false);
  };

  if (!isOpen) return null;

  const showPremiumNudge = totalPrice >= 500 && tier !== 'premium';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]" onClick={closeCart} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-zinc-900 border-l border-zinc-800 z-[61] flex flex-col animate-[slideInRight_0.2s_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-teal-400" />
            <span className="text-sm font-semibold text-zinc-100">SEO Fix Cart</span>
            <span className="text-[11px] text-zinc-500">({items.length} item{items.length !== 1 ? 's' : ''})</span>
          </div>
          <button onClick={closeCart} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">Your cart is empty</p>
              <p className="text-[11px] text-zinc-600 mt-1">Add fixes from the Site Health tab</p>
            </div>
          ) : (
            items.map(item => (
              <div key={item.productType} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200">{item.displayName}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {item.isFlat ? 'Full site' : `${fmt(item.priceUsd)}/page`}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-teal-400">
                    {fmt(item.priceUsd * item.quantity)}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  {item.isFlat ? (
                    <span className="text-[11px] text-zinc-500">Flat rate</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateQuantity(item.productType, item.quantity - 1)}
                        className="w-6 h-6 rounded flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-8 text-center text-xs font-medium text-zinc-300">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.productType, item.quantity + 1)}
                        className="w-6 h-6 rounded flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-[11px] text-zinc-500 ml-1">pages</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeItem(item.productType)}
                    className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {/* Pack upsell for per-page items */}
                {!item.isFlat && item.quantity >= 7 && item.quantity < 10 && (
                  <div className="mt-2 px-2.5 py-2 rounded-lg bg-teal-500/5 border border-teal-500/20">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-teal-400" />
                      <span className="text-[11px] text-teal-400">
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
          <div className="border-t border-zinc-800 px-5 py-4 space-y-3">
            {/* Premium upgrade nudge */}
            {showPremiumNudge && (
              <div className="px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-500/5 to-orange-500/5 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <Crown className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-[11px] font-medium text-amber-300">Premium includes all this</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      For $999/mo, all technical SEO fixes are included with 3 implementation hours.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Total</span>
              <span className="text-lg font-bold text-zinc-100">{fmt(totalPrice)}</span>
            </div>

            {/* Error */}
            {error && (
              <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* Checkout button */}
            <button
              onClick={handleCheckout}
              disabled={checkingOut}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 shadow-lg shadow-teal-900/30 active:scale-[0.98]"
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
            </button>

            <button
              onClick={clearCart}
              className="w-full text-[11px] text-zinc-500 hover:text-zinc-300 py-1 transition-colors"
            >
              Clear cart
            </button>
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
