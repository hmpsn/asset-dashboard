// ── Payments API (Stripe, work orders, pricing) ───────────────────
import { get, post, del, getSafe, getOptional } from './client';

export const stripe = {
  config: () => get<unknown>('/api/stripe/config'),

  saveKeys: (body: Record<string, unknown>) =>
    post<unknown>('/api/stripe/config/keys', body),

  saveProducts: (body: Record<string, unknown>) =>
    post<unknown>('/api/stripe/config/products', body),

  clearConfig: () => del('/api/stripe/config'),

  createCheckout: (wsId: string, body: Record<string, unknown>) =>
    post<{ url: string }>(`/api/public/checkout/${wsId}`, body),

  publishableKey: () => get<{ publishableKey: string }>('/api/stripe/publishable-key'),

  createPaymentIntent: (body: Record<string, unknown>) =>
    post<{ clientSecret: string; amount: number }>('/api/stripe/create-payment-intent', body),

  createCheckoutSession: (body: Record<string, unknown>) =>
    post<{ url: string }>('/api/stripe/create-checkout', body),
};

export const payments = {
  history: (wsId: string) =>
    getSafe<unknown[]>(`/api/public/payments/${wsId}`, []),
};

export const workOrders = {
  list: (wsId: string) =>
    getSafe<unknown[]>(`/api/work-orders/${wsId}`, []),
};

export const pricing = {
  get: (wsId: string) =>
    getOptional<unknown>(`/api/public/pricing/${wsId}`),
};
