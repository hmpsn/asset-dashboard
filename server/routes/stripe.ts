/**
 * stripe routes — extracted from server/index.ts
 */
import { Router, type Request, type Response } from 'express';

const router = Router();

import { sanitizeString } from '../helpers.js';
import { checkoutLimiter, requireAuthenticatedClientPortalAuth, requireClientPortalAuth } from '../middleware.js';
import { requireWorkspaceAccess, requireWorkspaceAccessFromBody } from '../auth.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
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
  createBillingPortalSession,
  cancelSubscription,
  getProductConfig,
  isProductType,
  listProducts,
} from '../stripe.js';
import { getWorkspace } from '../workspaces.js';
import { getContentRequest } from '../content-requests.js';
import { contentProductType } from '../../shared/types/payments.js';
import { createLogger } from '../logger.js';
import { validate, z } from '../middleware/validate.js';
import { sendSanitizedProviderError } from '../provider-error-sanitizer.js';
import type { Workspace } from '../workspaces.js';

const log = createLogger('stripe');

type CheckoutReturnTab = 'content' | 'health' | 'plans';

interface CheckoutPreflightContext {
  ws: Workspace;
  baseUrl: string;
  successUrl: string;
  cancelUrl: string;
}

export function buildCheckoutRedirectUrls(req: Pick<Request, 'protocol' | 'get'>, workspaceId: string, returnTab: CheckoutReturnTab): { baseUrl: string; successUrl: string; cancelUrl: string } {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return {
    baseUrl,
    successUrl: `${baseUrl}/client/${workspaceId}/${returnTab}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/client/${workspaceId}/${returnTab}?payment=cancelled`,
  };
}

function buildCheckoutContext(req: Request, res: Response, workspaceId: string, returnTab: CheckoutReturnTab): CheckoutPreflightContext | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: 'Workspace not found' });
    return null;
  }
  if (ws.billingMode === 'external') {
    res.status(403).json({ error: 'This workspace is billed externally — Stripe payments are disabled' });
    return null;
  }
  return { ws, ...buildCheckoutRedirectUrls(req, workspaceId, returnTab) };
}

function validateFullPostUpgradePayment(workspaceId: string, productType: string, contentRequestId: string | undefined, res: Response): boolean {
  if (productType !== 'post_polished') return true;
  if (!contentRequestId) {
    res.status(409).json({ error: 'Full-post upgrades require an approved brief request' });
    return false;
  }
  const request = getContentRequest(workspaceId, contentRequestId);
  if (!request) {
    res.status(404).json({ error: 'Content request not found' });
    return false;
  }
  if (request.serviceType !== 'brief_only' || request.status !== 'approved') {
    res.status(409).json({ error: 'Only approved brief requests can be upgraded to a full post' });
    return false;
  }
  return true;
}

const stripeProductPriceSchema = z.object({
  productType: z.string().min(1).max(80).refine(isProductType, 'Unknown product type'),
  stripePriceId: z.string().max(200),
  displayName: z.string().min(1).max(200),
  priceUsd: z.number().nonnegative(),
  enabled: z.boolean(),
});

const stripeProductsConfigSchema = z.object({
  products: z.array(stripeProductPriceSchema).max(100),
});

// Cart-checkout body caps. A fix cart is bounded — even a full-site audit yields
// far fewer than these limits — so generous caps keep honest callers unaffected
// while preventing an unbounded payload (which would also defeat §3's out-of-band
// persistence). pageIds/issueChecks are capped per item to bound the persisted blob.
const CART_MAX_ITEMS = 50;
const CART_MAX_PAGE_IDS = 500;
const CART_MAX_ISSUE_CHECKS = 100;
// Content cart context (briefs/posts). Mirrors the single-purchase content
// payload — server re-derives price + product from this, never trusts a
// client-supplied amount.
const cartContentContextSchema = z.object({
  topic: z.string().min(1).max(200),
  targetKeyword: z.string().min(1).max(200),
  serviceType: z.enum(['brief_only', 'full_post']),
  pageType: z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']),
  source: z.enum(['strategy', 'client']),
  intent: z.string().max(50).optional(),
  priority: z.string().max(20).optional(),
  rationale: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
  targetPageId: z.string().max(100).optional(),
  targetPageSlug: z.string().max(200).optional(),
});
const cartCheckoutSchema = z.object({
  workspaceId: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        productType: z.string().min(1).max(80),
        quantity: z.number().int().min(1).max(1000).optional(),
        pageIds: z.array(z.string().max(400)).max(CART_MAX_PAGE_IDS).optional(),
        issueChecks: z.array(z.string().max(120)).max(CART_MAX_ISSUE_CHECKS).optional(),
        content: cartContentContextSchema.optional(),
      }),
    )
    .min(1)
    .max(CART_MAX_ITEMS),
}).passthrough();

// NOTE: Stripe webhook is in server/index.ts — it must be registered before
// express.json() middleware to receive the raw body needed for signature verification.

// --- Stripe Config (admin) ---

// Get current Stripe config (keys masked)
// Admin-only: requires HMAC APP_PASSWORD token; JWT user tokens are rejected.
router.get('/api/stripe/config', requireAdminAuth, (_req, res) => {
  res.json(getStripeConfigSafe());
});

// Save Stripe API keys
// Admin-only: these write SYSTEM-level Stripe secrets. HMAC token only.
router.post('/api/stripe/config/keys', requireAdminAuth, (req, res) => {
  const { secretKey, webhookSecret, publishableKey } = req.body;
  if (!secretKey && !webhookSecret && !publishableKey) return res.status(400).json({ error: 'Provide secretKey, webhookSecret, and/or publishableKey' });
  saveStripeKeys(secretKey, webhookSecret, publishableKey);
  res.json({ ok: true, ...getStripeConfigSafe() });
});

// Save product price mappings
// Admin-only: product/price configuration is system-level. HMAC token only.
router.post('/api/stripe/config/products', requireAdminAuth, validate(stripeProductsConfigSchema), (req, res) => {
  const { products } = req.body;
  saveStripeProducts(products as StripeProductPrice[]);
  res.json({ ok: true, products });
});

// Clear all Stripe config
// Admin-only: nukes SYSTEM-level Stripe secrets. HMAC token only.
router.delete('/api/stripe/config', requireAdminAuth, (_req, res) => {
  clearStripeConfig();
  res.json({ ok: true });
});

// Publishable key (safe for frontend; retained for config/status compatibility)
router.get('/api/stripe/publishable-key', (_req, res) => {
  const pk = getStripePublishableKey();
  res.json({ publishableKey: pk || null });
});

// --- Stripe Payments ---

// Create a Stripe Checkout session
router.post('/api/stripe/create-checkout', checkoutLimiter, requireWorkspaceAccessFromBody(), async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const { workspaceId, productType, contentRequestId, topic, targetKeyword } = req.body;
  if (!workspaceId || !productType) return res.status(400).json({ error: 'workspaceId and productType are required' });
  const context = buildCheckoutContext(req, res, workspaceId, 'content');
  if (!context) return;
  const config = getProductConfig(productType);
  if (!config) return res.status(400).json({ error: `Unknown product type: ${productType}` });
  if (!validateFullPostUpgradePayment(workspaceId, productType, contentRequestId, res)) return;

  try {
    const { sessionId, url } = await createCheckoutSession({
      workspaceId,
      productType: sanitizeString(productType, 50) as import('../payments.js').ProductType,
      contentRequestId: contentRequestId ? sanitizeString(contentRequestId, 100) : undefined,
      topic: topic ? sanitizeString(topic, 200) : undefined,
      targetKeyword: targetKeyword ? sanitizeString(targetKeyword, 200) : undefined,
      successUrl: context.successUrl,
      cancelUrl: context.cancelUrl,
    });
    res.json({ sessionId, url });
  } catch (err) {
    log.error({ err: err }, 'Checkout error');
    sendSanitizedProviderError(res, {
      source: 'stripe',
      fallback: 'Unable to start checkout. Please try again or contact support.',
    });
  }
});

// Cart checkout: multiple SEO fix products in one Stripe session
// validate() runs before the workspace-access guard so an over-cap payload is
// rejected (400) regardless of auth, and bounds the persisted out-of-band cart.
router.post('/api/stripe/cart-checkout', checkoutLimiter, validate(cartCheckoutSchema), requireWorkspaceAccessFromBody(), async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const { workspaceId, items } = req.body;
  if (!workspaceId || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'workspaceId and items[] are required' });
  const context = buildCheckoutContext(req, res, workspaceId, 'health');
  if (!context) return;

  try {
    const { sessionId, url } = await createCartCheckoutSession({
      workspaceId,
      items: items.map((i: { productType: string; quantity: number; pageIds?: string[]; issueChecks?: string[]; content?: import('../../shared/types/payments.js').ContentCartContext }) => {
        // Content items: the server re-derives the productType from serviceType
        // (contentProductType) so a client can't pick a cheaper content product.
        const content = i.content
          ? {
              topic: sanitizeString(i.content.topic, 200),
              targetKeyword: sanitizeString(i.content.targetKeyword, 200),
              serviceType: i.content.serviceType,
              pageType: i.content.pageType,
              source: i.content.source,
              intent: i.content.intent ? sanitizeString(i.content.intent, 50) : undefined,
              priority: i.content.priority ? sanitizeString(i.content.priority, 20) : undefined,
              rationale: i.content.rationale ? sanitizeString(i.content.rationale, 1000) : undefined,
              notes: i.content.notes ? sanitizeString(i.content.notes, 1000) : undefined,
              targetPageId: i.content.targetPageId ? sanitizeString(i.content.targetPageId, 100) : undefined,
              targetPageSlug: i.content.targetPageSlug ? sanitizeString(i.content.targetPageSlug, 200) : undefined,
            }
          : undefined;
        return {
          productType: (content ? contentProductType(content.serviceType) : sanitizeString(i.productType, 50)) as import('../payments.js').ProductType,
          quantity: content ? 1 : Math.max(1, Math.min(100, Number(i.quantity) || 1)),
          pageIds: Array.isArray(i.pageIds) ? i.pageIds.map((p: string) => sanitizeString(p, 200)) : undefined,
          issueChecks: Array.isArray(i.issueChecks) ? i.issueChecks.map((c: string) => sanitizeString(c, 100)) : undefined,
          content,
        };
      }),
      successUrl: context.successUrl,
      cancelUrl: context.cancelUrl,
    });
    res.json({ sessionId, url });
  } catch (err) {
    log.error({ err: err }, 'Cart checkout error');
    sendSanitizedProviderError(res, {
      source: 'stripe',
      fallback: 'Unable to start cart checkout. Please try again or contact support.',
    });
  }
});

// Public: tier upgrade checkout (client-facing)
router.post('/api/public/upgrade-checkout/:workspaceId', checkoutLimiter, requireAuthenticatedClientPortalAuth(), async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const wsId = req.params.workspaceId;
  const context = buildCheckoutContext(req, res, wsId, 'plans');
  if (!context) return;

  const { planId } = req.body;
  const productType = planId === 'growth' ? 'plan_growth' : planId === 'premium' ? 'plan_premium' : null;
  if (!productType) return res.status(400).json({ error: 'Invalid plan' });

  const config = getProductConfig(productType);
  if (!config) return res.status(400).json({ error: `Product not configured: ${productType}` });

  try {
    const { sessionId, url } = await createCheckoutSession({
      workspaceId: wsId,
      productType,
      successUrl: context.successUrl,
      cancelUrl: context.cancelUrl,
    });
    res.json({ sessionId, url });
  } catch (err) {
    log.error({ err: err }, 'Tier upgrade checkout error');
    sendSanitizedProviderError(res, {
      source: 'stripe',
      fallback: 'Unable to start plan checkout. Please try again or contact support.',
    });
  }
});

// List payments for a workspace (admin)
router.get('/api/stripe/payments/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  res.json(listPayments(req.params.workspaceId));
});

// Client checks payment status after redirect
router.get('/api/public/stripe/status/:workspaceId/:sessionId', requireClientPortalAuth(), (req, res) => {
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
router.get('/api/stripe/payments/:workspaceId/:paymentId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const payment = getPayment(req.params.workspaceId, req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

// --- ROI Dashboard ---
router.get('/api/public/roi/:workspaceId', requireAuthenticatedClientPortalAuth(), (req, res) => {
  const roi = computeROI(req.params.workspaceId);
  if (!roi) return res.status(404).json({ error: 'ROI data not available — requires keyword strategy with CPC data' });
  res.json(roi);
});

// --- Subscription Management ---

// Create a Stripe Billing Portal session (client self-service: update payment, cancel)
router.post('/api/public/billing-portal/:workspaceId', checkoutLimiter, requireAuthenticatedClientPortalAuth(), async (req, res) => {
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
    log.error({ err: err }, 'Billing portal error');
    sendSanitizedProviderError(res, {
      source: 'stripe',
      fallback: 'Unable to open the billing portal. Please try again or contact support.',
    });
  }
});

// Cancel subscription (graceful — at period end)
router.post('/api/public/cancel-subscription/:workspaceId', checkoutLimiter, requireAuthenticatedClientPortalAuth(), async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ error: 'Stripe is not configured' });
  const wsId = req.params.workspaceId;
  const ws = getWorkspace(wsId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const result = await cancelSubscription(wsId);
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Cancel subscription error');
    sendSanitizedProviderError(res, {
      source: 'stripe',
      fallback: 'Unable to update the subscription. Please try again or contact support.',
    });
  }
});

export default router;
