/**
 * stripe routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import { sanitizeString } from '../helpers.js';
import { checkoutLimiter } from '../middleware.js';
import { listPayments, getPayment } from '../payments.js';
import { computeROI } from '../roi.js';
import {
  getStripeConfigSafe,
  saveStripeKeys,
  saveStripeProducts,
  clearStripeConfig,
  getStripePublishableKey,
  type StripeProductPrice,
} from '../stripe-config.js';
import {
  isStripeConfigured,
  createCheckoutSession,
  createCartCheckoutSession,
  createPaymentIntentForProduct,
  createBillingPortalSession,
  cancelSubscription,
  getProductConfig,
  listProducts,
} from '../stripe.js';
import { getWorkspace } from '../workspaces.js';

// NOTE: Stripe webhook is in server/index.ts — it must be registered before
// express.json() middleware to receive the raw body needed for signature verification.

// --- Stripe Config (admin) ---

// Get current Stripe config (keys masked)
router.get('/api/stripe/config', (_req, res) => {
  res.json(getStripeConfigSafe());
});

// Save Stripe API keys
router.post('/api/stripe/config/keys', (req, res) => {
  const { secretKey, webhookSecret, publishableKey } = req.body;
  if (!secretKey && !webhookSecret && !publishableKey) return res.status(400).json({ error: 'Provide secretKey, webhookSecret, and/or publishableKey' });
  saveStripeKeys(secretKey, webhookSecret, publishableKey);
  res.json({ ok: true, ...getStripeConfigSafe() });
});

// Save product price mappings
router.post('/api/stripe/config/products', (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products)) return res.status(400).json({ error: 'products must be an array' });
  saveStripeProducts(products as StripeProductPrice[]);
  res.json({ ok: true, products });
});

// Clear all Stripe config
router.delete('/api/stripe/config', (_req, res) => {
  clearStripeConfig();
  res.json({ ok: true });
});

// Publishable key (safe for frontend — needed for Stripe Elements)
router.get('/api/stripe/publishable-key', (_req, res) => {
  const pk = getStripePublishableKey();
  res.json({ publishableKey: pk || null });
});

// Create a PaymentIntent (for Stripe Elements inline form)
router.post('/api/stripe/create-payment-intent', checkoutLimiter, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const { workspaceId, productType, contentRequestId, topic, targetKeyword } = req.body;
  if (!workspaceId || !productType) return res.status(400).json({ error: 'workspaceId and productType are required' });
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const result = await createPaymentIntentForProduct({
      workspaceId,
      productType: sanitizeString(productType, 50) as import('../payments.js').ProductType,
      contentRequestId: contentRequestId ? sanitizeString(contentRequestId, 100) : undefined,
      topic: topic ? sanitizeString(topic, 200) : undefined,
      targetKeyword: targetKeyword ? sanitizeString(targetKeyword, 200) : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('[stripe] PaymentIntent error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create payment intent' });
  }
});

// --- Stripe Payments ---

// Create a Stripe Checkout session
router.post('/api/stripe/create-checkout', checkoutLimiter, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const { workspaceId, productType, contentRequestId, topic, targetKeyword } = req.body;
  if (!workspaceId || !productType) return res.status(400).json({ error: 'workspaceId and productType are required' });
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const config = getProductConfig(productType);
  if (!config) return res.status(400).json({ error: `Unknown product type: ${productType}` });

  // Build redirect URLs
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const successUrl = `${baseUrl}/client/${workspaceId}/content?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/client/${workspaceId}/content?payment=cancelled`;

  try {
    const { sessionId, url } = await createCheckoutSession({
      workspaceId,
      productType: sanitizeString(productType, 50) as import('../payments.js').ProductType,
      contentRequestId: contentRequestId ? sanitizeString(contentRequestId, 100) : undefined,
      topic: topic ? sanitizeString(topic, 200) : undefined,
      targetKeyword: targetKeyword ? sanitizeString(targetKeyword, 200) : undefined,
      successUrl,
      cancelUrl,
    });
    res.json({ sessionId, url });
  } catch (err) {
    console.error('[stripe] Checkout error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create checkout session' });
  }
});

// Cart checkout: multiple SEO fix products in one Stripe session
router.post('/api/stripe/cart-checkout', checkoutLimiter, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const { workspaceId, items } = req.body;
  if (!workspaceId || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'workspaceId and items[] are required' });
  const ws = getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const successUrl = `${baseUrl}/client/${workspaceId}/health?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/client/${workspaceId}/health?payment=cancelled`;

  try {
    const { sessionId, url } = await createCartCheckoutSession({
      workspaceId,
      items: items.map((i: { productType: string; quantity: number; pageIds?: string[] }) => ({
        productType: sanitizeString(i.productType, 50) as import('../payments.js').ProductType,
        quantity: Math.max(1, Math.min(100, Number(i.quantity) || 1)),
        pageIds: Array.isArray(i.pageIds) ? i.pageIds.map((p: string) => sanitizeString(p, 200)) : undefined,
      })),
      successUrl,
      cancelUrl,
    });
    res.json({ sessionId, url });
  } catch (err) {
    console.error('[stripe] Cart checkout error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create cart checkout session' });
  }
});

// Public: tier upgrade checkout (client-facing)
router.post('/api/public/upgrade-checkout/:workspaceId', checkoutLimiter, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const { planId } = req.body;
  const productType = planId === 'growth' ? 'plan_growth' : planId === 'premium' ? 'plan_premium' : null;
  if (!productType) return res.status(400).json({ error: 'Invalid plan' });

  const config = getProductConfig(productType);
  if (!config) return res.status(400).json({ error: `Product not configured: ${productType}` });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const successUrl = `${baseUrl}/client/${wsId}/plans?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/client/${wsId}/plans?payment=cancelled`;

  try {
    const { sessionId, url } = await createCheckoutSession({
      workspaceId: wsId,
      productType,
      successUrl,
      cancelUrl,
    });
    res.json({ sessionId, url });
  } catch (err) {
    console.error('[stripe] Tier upgrade checkout error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create checkout session' });
  }
});

// List payments for a workspace (admin)
router.get('/api/stripe/payments/:workspaceId', (req, res) => {
  res.json(listPayments(req.params.workspaceId));
});

// Client checks payment status after redirect
router.get('/api/public/stripe/status/:workspaceId/:sessionId', (req, res) => {
  const payments = listPayments(req.params.workspaceId);
  const payment = payments.find(p => p.stripeSessionId === req.params.sessionId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json({ id: payment.id, status: payment.status, productType: payment.productType, paidAt: payment.paidAt });
});

// List available products with prices
router.get('/api/stripe/products', (_req, res) => {
  res.json({ configured: isStripeConfigured(), products: listProducts() });
});

// Get a single payment record (admin)
router.get('/api/stripe/payments/:workspaceId/:paymentId', (req, res) => {
  const payment = getPayment(req.params.workspaceId, req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

// --- ROI Dashboard ---
router.get('/api/public/roi/:workspaceId', (req, res) => {
  const roi = computeROI(req.params.workspaceId);
  if (!roi) return res.status(404).json({ error: 'ROI data not available — requires keyword strategy with CPC data' });
  res.json(roi);
});

// --- Subscription Management ---

// Create a Stripe Billing Portal session (client self-service: update payment, cancel)
router.post('/api/public/billing-portal/:workspaceId', checkoutLimiter, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const returnUrl = `${baseUrl}/client/${wsId}/plans`;

  try {
    const { url } = await createBillingPortalSession(wsId, returnUrl);
    res.json({ url });
  } catch (err) {
    console.error('[stripe] Billing portal error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create billing portal session' });
  }
});

// Cancel subscription (graceful — at period end)
router.post('/api/public/cancel-subscription/:workspaceId', checkoutLimiter, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const result = await cancelSubscription(wsId);
    res.json(result);
  } catch (err) {
    console.error('[stripe] Cancel subscription error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to cancel subscription' });
  }
});

export default router;
