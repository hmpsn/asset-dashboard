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
  /** Whether this is a flat-rate (full-site) product */
  isFlat?: boolean;
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
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* quota exceeded, ignore */ }
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
        // For per-page items, increment quantity
        return prev.map(i =>
          i.productType === item.productType
            ? { ...i, quantity: i.quantity + (item.quantity || 1) }
            : i
        );
      }
      return [...prev, { ...item, quantity: item.quantity || 1 }];
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

export function useCart(): CartContextValue | null {
  return useContext(CartContext);
}
