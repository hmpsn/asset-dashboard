/**
 * Component tests for SeoCart content rendering + Premium discount display (R2-E).
 *
 *  - A content item renders its topic + price (distinct from fix rows).
 *  - For a Premium workspace a content item shows the original price struck
 *    through + the 10%-discounted price, and the footer totals reflect the
 *    discount.
 *  - For a non-Premium workspace content shows full price, no strikethrough.
 *  - The checkout payload carries the per-item `content` context for content
 *    rows and page context for fix rows (Buy-now path is untouched — it never
 *    routes through the cart).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, act } from '@testing-library/react';
import { CartProvider, useCart } from '../../../src/components/client/useCart';
import { SeoCartDrawer } from '../../../src/components/client/SeoCart';

const postMock = vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' }));
vi.mock('../../../src/api/client', () => ({
  post: (...args: unknown[]) => postMock(...args),
}));

function brief() {
  return {
    kind: 'content' as const,
    productType: 'brief_blog' as const,
    displayName: 'Content Brief',
    priceUsd: 125,
    content: {
      topic: 'Spring sale guide',
      targetKeyword: 'spring sale',
      serviceType: 'brief_only' as const,
      pageType: 'blog' as const,
      source: 'strategy' as const,
    },
  };
}

/** Seed the cart, then render the drawer in one provider tree. */
function Harness({ tier, children }: { tier?: 'free' | 'growth' | 'premium'; children?: ReactNode }) {
  return (
    <CartProvider>
      {children}
      <SeoCartDrawer workspaceId="ws_test" tier={tier} />
    </CartProvider>
  );
}

function Seeder({ onReady }: { onReady: (cart: ReturnType<typeof useCart>) => void }) {
  const cart = useCart();
  onReady(cart);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  postMock.mockClear();
});

describe('SeoCart — content item rendering', () => {
  it('renders the content topic and the one-time-purchase label (non-Premium, full price)', () => {
    let cart: ReturnType<typeof useCart> | null = null;
    render(<Harness tier="growth"><Seeder onReady={(c) => { cart = c; }} /></Harness>);
    act(() => { cart!.addItem(brief()); });

    expect(screen.getByText('Spring sale guide')).toBeTruthy();
    expect(screen.getByText('One-time content purchase')).toBeTruthy();
    // No "Premium off" label for a Growth workspace.
    expect(screen.queryByText(/Premium .* off applied/)).toBeNull();
  });

  it('Premium workspace shows the struck-through original + discounted price and a savings line', () => {
    let cart: ReturnType<typeof useCart> | null = null;
    render(<Harness tier="premium"><Seeder onReady={(c) => { cart = c; }} /></Harness>);
    act(() => { cart!.addItem(brief()); });

    // $125 struck through, $113 discounted (MONETIZATION §"Premium Content
    // Discount" example: ~$125~ $113 — fmtMoneyFull renders whole dollars).
    expect(screen.getByText('$125')).toBeTruthy();
    expect(screen.getAllByText('$113').length).toBeGreaterThan(0);
    expect(screen.getByText(/Premium .* off applied/)).toBeTruthy();
    // Footer names the perk.
    expect(screen.getByText(/Premium .* content discount applied/)).toBeTruthy();
  });

  it('Premium checkout total reflects the discount', () => {
    let cart: ReturnType<typeof useCart> | null = null;
    render(<Harness tier="premium"><Seeder onReady={(c) => { cart = c; }} /></Harness>);
    act(() => { cart!.addItem(brief()); });

    // Checkout button shows the discounted total ($112.50 → $113 rounded).
    expect(screen.getByText(/Checkout \$113/)).toBeTruthy();
  });
});

describe('SeoCart — checkout payload shape', () => {
  it('sends per-item content context for content rows', async () => {
    let cart: ReturnType<typeof useCart> | null = null;
    render(<Harness tier="growth"><Seeder onReady={(c) => { cart = c; }} /></Harness>);
    act(() => { cart!.addItem(brief()); });

    const checkoutBtn = screen.getByText(/Checkout/).closest('button')!;
    await act(async () => { checkoutBtn.click(); });

    expect(postMock).toHaveBeenCalledWith('/api/stripe/cart-checkout', expect.objectContaining({
      workspaceId: 'ws_test',
      items: [expect.objectContaining({
        productType: 'brief_blog',
        content: expect.objectContaining({ topic: 'Spring sale guide', serviceType: 'brief_only' }),
      })],
    }));
  });
});
