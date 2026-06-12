/**
 * Unit tests for useCart — the client-side SEO fix cart.
 *
 * Money-path regression coverage (feat/client-revenue-r1 R1):
 *  - addItem MERGES pageIds (deduped) for per-page products and recounts
 *    quantity from the merged page set, so adding page A then page B never
 *    drops page B's id (the eventual work order must fulfil BOTH pages).
 *  - addItem merges issueChecks the same way so the server has the check
 *    context end-to-end.
 *  - flat-rate items still don't stack.
 *  - the by-type "add all pages at once" path stays correct.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { CartProvider, useCart } from '../../../src/components/client/useCart';

function wrapper({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}

beforeEach(() => {
  localStorage.clear();
});

describe('useCart.addItem — per-page page merge', () => {
  it('merges pageIds across sequential single-page adds and recounts quantity', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['page-a'] });
    });
    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['page-b'] });
    });

    expect(result.current.items).toHaveLength(1);
    const item = result.current.items[0];
    expect(item.pageIds).toEqual(['page-a', 'page-b']);
    // quantity must track the merged page count, not blind increments
    expect(item.quantity).toBe(2);
  });

  it('dedupes a page added twice (no double-count, no duplicate id)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['page-a'] });
    });
    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['page-a'] });
    });

    const item = result.current.items[0];
    expect(item.pageIds).toEqual(['page-a']);
    expect(item.quantity).toBe(1);
  });

  it('by-type bulk add (all pages at once) sets quantity to the page count', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        productType: 'fix_meta',
        displayName: 'Metadata',
        priceUsd: 20,
        pageIds: ['p1', 'p2', 'p3'],
      });
    });

    const item = result.current.items[0];
    expect(item.pageIds).toEqual(['p1', 'p2', 'p3']);
    expect(item.quantity).toBe(3);
  });

  it('merges a bulk add into an existing per-page item (union, deduped)', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['p1'] });
    });
    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['p1', 'p2', 'p3'] });
    });

    const item = result.current.items[0];
    expect(item.pageIds).toEqual(['p1', 'p2', 'p3']);
    expect(item.quantity).toBe(3);
  });

  it('merges issueChecks deduped alongside pageIds', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['page-a'], issueChecks: ['title'] });
    });
    act(() => {
      result.current.addItem({ productType: 'fix_meta', displayName: 'Metadata', priceUsd: 20, pageIds: ['page-b'], issueChecks: ['title', 'meta-description'] });
    });

    const item = result.current.items[0];
    expect(item.issueChecks).toEqual(['title', 'meta-description']);
  });
});

describe('useCart.addItem — flat-rate items', () => {
  it('does not stack flat items', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ productType: 'fix_alt', displayName: 'Alt text', priceUsd: 50, isFlat: true });
    });
    act(() => {
      result.current.addItem({ productType: 'fix_alt', displayName: 'Alt text', priceUsd: 50, isFlat: true });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].quantity).toBe(1);
  });
});

describe('useCart.addItem — per-page add without pageIds (fallback)', () => {
  it('falls back to quantity increment when no pageIds are supplied', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ productType: 'fix_redirect', displayName: 'Redirect', priceUsd: 19 });
    });
    act(() => {
      result.current.addItem({ productType: 'fix_redirect', displayName: 'Redirect', priceUsd: 19 });
    });

    expect(result.current.items[0].quantity).toBe(2);
  });
});
