import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ProductType } from '../../../server/payments';

// --- Cart item types ---

export interface CartItem {
  productType: ProductType;
  displayName: string;
  priceUsd: number;
  quantity: number;
  /** Optional: pages selected for per-page products */
  pageIds?: string[];
  /** Optional: audit check types backing this fix (e.g. "title", "img-alt").
   *  Carried end-to-end so the server work order knows what to fix. */
  issueChecks?: string[];
  /** Whether this is a flat-rate (full-site) product */
  isFlat?: boolean;
}

/** Union two id lists preserving first-seen order, dropping duplicates. */
function mergeDedup(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export interface CartState {
  items: CartItem[];
  isOpen: boolean;
}

export interface CartActions {
  addItem: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void;
  removeItem: (productType: ProductType) => void;
  updateQuantity: (productType: ProductType, quantity: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  totalItems: number;
  totalPrice: number;
}

type CartContextValue = CartState & CartActions;

const CartContext = createContext<CartContextValue | null>(null);

// --- localStorage persistence ---

const STORAGE_KEY = 'seo-fix-cart';

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
      console.error('useCart operation failed:', err);
    return [];
  }
}

function saveCart(items: CartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) { console.error('useCart operation failed:', err); }
}

// --- Provider ---

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadCart);
  const [isOpen, setIsOpen] = useState(false);

  // Persist on change
  useEffect(() => { saveCart(items); }, [items]);

  const addItem = useCallback((item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
    setItems(prev => {
      const existing = prev.find(i => i.productType === item.productType);
      if (existing) {
        // For flat-rate items, don't stack
        if (item.isFlat) return prev;
        // For per-page items, MERGE pageIds (dedup) and recount quantity from
        // the merged set. Two rows for the same family (e.g. fix_meta from page
        // A then page B) must accumulate both pages or the work order silently
        // drops one. issueChecks merge the same way for end-to-end check context.
        return prev.map(i => {
          if (i.productType !== item.productType) return i;
          const hasPages = (item.pageIds?.length ?? 0) > 0 || (i.pageIds?.length ?? 0) > 0;
          if (hasPages) {
            const pageIds = mergeDedup(i.pageIds, item.pageIds);
            const issueChecks = mergeDedup(i.issueChecks, item.issueChecks);
            return {
              ...i,
              pageIds,
              ...(issueChecks.length ? { issueChecks } : {}),
              // quantity tracks the merged page count for per-page billing
              quantity: pageIds.length,
            };
          }
          // No page context on either side — fall back to a plain increment.
          return { ...i, quantity: i.quantity + (item.quantity || 1) };
        });
      }
      const pageIds = item.pageIds;
      const quantity = pageIds?.length ? pageIds.length : (item.quantity || 1);
      return [...prev, { ...item, quantity }];
    });
    setIsOpen(true);
  }, []);

  const removeItem = useCallback((productType: ProductType) => {
    setItems(prev => prev.filter(i => i.productType !== productType));
  }, []);

  const updateQuantity = useCallback((productType: ProductType, quantity: number) => {
    if (quantity <= 0) {
      setItems(prev => prev.filter(i => i.productType !== productType));
    } else {
      setItems(prev => prev.map(i =>
        i.productType === productType ? { ...i, quantity } : i
      ));
    }
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setIsOpen(false);
  }, []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.priceUsd * i.quantity, 0);

  const value: CartContextValue = {
    items,
    isOpen,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    openCart: () => setIsOpen(true),
    closeCart: () => setIsOpen(false),
    toggleCart: () => setIsOpen(p => !p),
    totalItems,
    totalPrice,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// --- Hook ---

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
