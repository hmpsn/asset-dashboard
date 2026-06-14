import { describe, expect, it } from 'vitest';
import { buildCheckoutRedirectUrls } from '../../server/routes/stripe.js';

describe('Stripe checkout route preflight helpers', () => {
  const req = {
    protocol: 'https',
    get: (name: string) => (name === 'host' ? 'dashboard.example.test' : undefined),
  };

  it.each([
    ['content', '/client/ws_checkout/inbox?tab=reviews'],
    ['health', '/client/ws_checkout/health'],
    ['plans', '/client/ws_checkout/plans'],
  ] as const)('builds legacy %s checkout redirect URLs', (tab, path) => {
    const urls = buildCheckoutRedirectUrls(req, 'ws_checkout', tab);

    expect(urls.baseUrl).toBe('https://dashboard.example.test');
    const separator = path.includes('?') ? '&' : '?';
    expect(urls.successUrl).toBe(`https://dashboard.example.test${path}${separator}payment=success&session_id={CHECKOUT_SESSION_ID}`);
    expect(urls.cancelUrl).toBe(`https://dashboard.example.test${path}${separator}payment=cancelled`);
  });
});
