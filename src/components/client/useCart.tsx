import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ProductType } from '../../../server/payments';
import type { ContentCartContext } from '../../../shared/types/payments';

// --- Cart item types ---

export interface CartItem {
  /** Stable per-row identity. Fix items reuse their productType (so R1 merge
   *  semantics hold); content items get a generated id because many distinct
   *  briefs/posts share one productType (e.g. brief_blog) and must NOT merge. */
  cartItemId: string;
  productType: ProductType;
  displayName: string;
  priceUsd: number;
  quantity: number;
  /** 'fix' (default) merges by productType; 'content' is always a distinct row. */
  kind?: 'fix' | 'content';
  /** Optional: pages selected for per-page products */
  pageIds?: string[];
  /** Optional: audit check types backing this fix (e.g. "title", "img-alt").
   *  Carried end-to-end so the server work order knows what to fix. */
  issueChecks?: string[];
  /** Whether this is a flat-rate (full-site) product */
  isFlat?: boolean;
  /** Content context (briefs/posts) — mirrors the single-purchase payload. */
  content?: ContentCartContext;
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

let _contentItemSeq = 0;
function nextContentItemId(): string {
  _contentItemSeq += 1;
  return `content_${Date.now()}_${_contentItemSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface CartState {
  items: CartItem[];
  isOpen: boolean;
}

export interface CartActions {
  /** Add an item. Fix items merge by productType (R1 semantics); content items
   *  are always added as a new distinct row. Callers may omit cartItemId for fix
   *  items (it defaults to the productType). */
  addItem: (item: Omit<CartItem, 'quantity' | 'cartItemId'> & { quantity?: number; cartItemId?: string }) => void;
  /** Remove by row identity (cartItemId). */
  removeItem: (cartItemId: string) => void;
  /** Update quantity by row identity (cartItemId). */
  updateQuantity: (cartItemId: string, quantity: number) => void;
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

/** Backfill cartItemId for any persisted item written before content-in-cart
 *  (those rows are fix items keyed by productType). */
function normalizePersisted(items: unknown): CartItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = raw as CartItem;
    if (item.cartItemId) return item;
    return { ...item, cartItemId: item.productType, kind: item.kind || 'fix' };
  });
}

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizePersisted(JSON.parse(raw));
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

  const addItem = useCallback((item: Omit<CartItem, 'quantity' | 'cartItemId'> & { quantity?: number; cartItemId?: string }) => {
    setItems(prev => {
      // Content items NEVER merge — each brief/post is a distinct topic. Always a
      // new row with a generated identity.
      if (item.kind === 'content') {
        const quantity = item.quantity || 1;
        return [...prev, { ...item, cartItemId: nextContentItemId(), kind: 'content', quantity }];
      }

      // Fix items: merge by productType (R1 semantics). cartItemId === productType.
      const existing = prev.find(i => i.kind !== 'content' && i.productType === item.productType);
      if (existing) {
        // For flat-rate items, don't stack
        if (item.isFlat) return prev;
        // For per-page items, MERGE pageIds (dedup) and recount quantity from
        // the merged set. Two rows for the same family (e.g. fix_meta from page
        // A then page B) must accumulate both pages or the work order silently
        // drops one. issueChecks merge the same way for end-to-end check context.
        return prev.map(i => {
          if (i.kind === 'content' || i.productType !== item.productType) return i;
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
      return [...prev, { ...item, cartItemId: item.cartItemId ?? item.productType, kind: 'fix', quantity }];
    });
    setIsOpen(true);
  }, []);

  const removeItem = useCallback((cartItemId: string) => {
    setItems(prev => prev.filter(i => i.cartItemId !== cartItemId));
  }, []);

  const updateQuantity = useCallback((cartItemId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems(prev => prev.filter(i => i.cartItemId !== cartItemId));
    } else {
      setItems(prev => prev.map(i =>
        i.cartItemId === cartItemId ? { ...i, quantity } : i
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
