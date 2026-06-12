import Stripe from 'stripe';
import {
  createPayment,
  updatePayment,
  getPaymentBySession,
  listPaymentsBySession,
  getPaymentByPaymentIntent,
  getCartItemsBySession,
  type PaymentRecord,
  type ProductType,
} from './payments.js';
import { getContentRequest, updateContentRequest, deleteContentRequest } from './content-requests.js';
import { addActivity } from './activity-log.js';
import { getStripeSecretKey, getStripeWebhookSecret, getStripePriceId } from './stripe-config.js';
import { getWorkspace, updateWorkspace, computeEffectiveTier } from './workspaces.js';
import { createContentRequest } from './content-requests.js';
import { type ContentCartContext } from '../shared/types/payments.js';
import { PREMIUM_CONTENT_DISCOUNT } from '../shared/pricing.js';
import { createWorkOrder } from './work-orders.js';
import { notifyTeamPaymentReceived } from './email.js';
import { createLogger } from './logger.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { cartItemSchema, stringArraySchema } from './schemas/payment-schemas.js';
import {
  createContentSubscription, getContentSubscriptionByStripeId,
  updateContentSubscription, resetPeriod,
} from './content-subscriptions.js';
import { CONTENT_SUB_PLANS, type ContentSubscription } from '../shared/types/content.js';
import { WS_EVENTS } from './ws-events.js';
import { isProgrammingError } from './errors.js';
import { normalizeFixCart } from './payments/fix-bundle-pricing.js';

const log = createLogger('stripe');

type WorkspaceBroadcastFn = (workspaceId: string, event: string, data: unknown) => void;
let _broadcastFn: WorkspaceBroadcastFn | null = null;

/** Register a workspace-scoped broadcast function (called from index.ts). */
export function initStripeBroadcast(fn: WorkspaceBroadcastFn) {
  _broadcastFn = fn;
}

// --- Stripe SDK (lazy init — picks up keys saved via admin UI or env vars) ---

let _stripe: Stripe | null = null;
let _lastKey = '';

function getStripe(): Stripe | null {
  const key = getStripeSecretKey();
  if (!key) { _stripe = null; _lastKey = ''; return null; }
  if (key !== _lastKey) {
    _stripe = new Stripe(key, { apiVersion: '2026-02-25.clover' });
    _lastKey = key;
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!getStripe();
}

// --- Product Configuration ---

export interface ProductConfig {
  type: ProductType;
  stripePriceId: string;
  displayName: string;
  priceUsd: number;       // display price in dollars (canonical price lives in Stripe)
  category: 'brief' | 'content' | 'schema' | 'strategy' | 'fix';
}

// Map env vars to product configs
const PRODUCT_MAP: Record<ProductType, { displayName: string; category: ProductConfig['category']; priceUsd: number; envKey: string }> = {
  brief_blog:       { displayName: 'Blog Post Brief',         category: 'brief',    priceUsd: 125,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_landing:    { displayName: 'Landing Page Brief',      category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_service:    { displayName: 'Service Page Brief',      category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_location:   { displayName: 'Location Page Brief',     category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_product:    { displayName: 'Product Page Brief',      category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_pillar:     { displayName: 'Pillar/Hub Page Brief',   category: 'brief',    priceUsd: 200,  envKey: 'STRIPE_PRICE_BRIEF' },
  brief_resource:   { displayName: 'Resource/Guide Brief',    category: 'brief',    priceUsd: 150,  envKey: 'STRIPE_PRICE_BRIEF' },
  post_draft:       { displayName: 'Blog Post — AI Draft',    category: 'content',  priceUsd: 350,  envKey: 'STRIPE_PRICE_POST_DRAFT' },
  post_polished:    { displayName: 'Blog Post — Polished',    category: 'content',  priceUsd: 500,  envKey: 'STRIPE_PRICE_POST_POLISHED' },
  post_premium:     { displayName: 'Blog Post — Premium',     category: 'content',  priceUsd: 1000, envKey: 'STRIPE_PRICE_POST_PREMIUM' },
  schema_page:      { displayName: 'Schema — Per Page',       category: 'schema',   priceUsd: 39,   envKey: 'STRIPE_PRICE_SCHEMA_PAGE' },
  schema_10:        { displayName: 'Schema Pack (10pg)',       category: 'schema',   priceUsd: 299,  envKey: 'STRIPE_PRICE_SCHEMA_10' },
  strategy:         { displayName: 'Keyword Strategy',        category: 'strategy', priceUsd: 400,  envKey: 'STRIPE_PRICE_STRATEGY' },
  strategy_refresh: { displayName: 'Strategy Refresh',        category: 'strategy', priceUsd: 200,  envKey: 'STRIPE_PRICE_STRATEGY_REFRESH' },
  fix_meta:         { displayName: 'Metadata Optimization',   category: 'fix',      priceUsd: 20,   envKey: 'STRIPE_PRICE_FIX_META' },
  fix_alt:          { displayName: 'Alt Text — Full Site',    category: 'fix',      priceUsd: 50,   envKey: 'STRIPE_PRICE_FIX_ALT' },
  fix_redirect:     { displayName: 'Redirect Fix',            category: 'fix',      priceUsd: 19,   envKey: 'STRIPE_PRICE_FIX_REDIRECT' },
  fix_meta_10:      { displayName: 'Metadata Pack (10pg)',     category: 'fix',      priceUsd: 179,  envKey: 'STRIPE_PRICE_FIX_META_10' },
  plan_growth:      { displayName: 'Growth Plan',              category: 'strategy', priceUsd: 249,  envKey: 'STRIPE_PRICE_PLAN_GROWTH' },
  plan_premium:     { displayName: 'Premium Plan',             category: 'strategy', priceUsd: 999,  envKey: 'STRIPE_PRICE_PLAN_PREMIUM' },
  content_starter:  { displayName: 'Starter Content (2 posts/mo)', category: 'content', priceUsd: 500,  envKey: 'STRIPE_PRICE_CONTENT_STARTER' },
  content_growth:   { displayName: 'Growth Content (4 posts/mo)',  category: 'content', priceUsd: 900,  envKey: 'STRIPE_PRICE_CONTENT_GROWTH' },
  content_scale:    { displayName: 'Scale Content (8 posts/mo)',   category: 'content', priceUsd: 1600, envKey: 'STRIPE_PRICE_CONTENT_SCALE' },
};

/** Discount-eligible content categories (briefs + full posts). */
function isDiscountableContent(category: ProductConfig['category']): boolean {
  return category === 'brief' || category === 'content';
}

/**
 * The discounted whole-cent unit price for a content product at a given tier.
 * Returns the full price for non-Premium tiers or non-content products. Rounded
 * to whole cents (Stripe charges integer cents) so display and charge agree.
 * The discount rate is the shared PREMIUM_CONTENT_DISCOUNT config constant — the
 * tier-model rediscussion (roadmap: tier-model-rediscussion) may re-map it.
 */
export function contentUnitAmountCents(config: ProductConfig, tier: string): number {
  const full = Math.round(config.priceUsd * 100);
  if (tier === 'premium' && isDiscountableContent(config.category)) {
    return Math.round(full * (1 - PREMIUM_CONTENT_DISCOUNT));
  }
  return full;
}

export const PRODUCT_TYPES = Object.freeze(Object.keys(PRODUCT_MAP)) as readonly ProductType[];

export function isProductType(value: string): value is ProductType {
  return PRODUCT_TYPES.includes(value as ProductType);
}

export function getProductConfig(type: ProductType): ProductConfig | null {
  const entry = PRODUCT_MAP[type];
  if (!entry) return null;
  const stripePriceId = getStripePriceId(type, entry.envKey);
  return {
    type,
    stripePriceId,
    displayName: entry.displayName,
    priceUsd: entry.priceUsd,
    category: entry.category,
  };
}

function validatePostPolishedUpgrade(workspaceId: string, contentRequestId: string | undefined): void {
  if (!contentRequestId) throw new Error('Full-post upgrades require an approved brief request');
  const request = getContentRequest(workspaceId, contentRequestId);
  if (!request) throw new Error('Content request not found');
  if (request.serviceType !== 'brief_only' || request.status !== 'approved') {
    throw new Error('Only approved brief requests can be upgraded to a full post');
  }
}

/**
 * Outcome of a cart content fulfillment attempt:
 *   - 'advanced' — request moved pending_payment → requested (broadcast CONTENT_REQUEST_UPDATE)
 *   - 'noop'     — already past pending_payment (webhook replay); nothing to do, no failure
 *   - 'missing'  — the referenced request no longer exists; the caller MUST record a
 *                  fulfillment failure so the paid-but-unfulfilled item is reconciled.
 */
type CartContentPaymentResult = 'advanced' | 'noop' | 'missing';

/**
 * Fulfill a CART content item (a fresh brief OR full-post purchase). Unlike the
 * single-purchase upgrade path (`applyContentRequestPayment` with post_polished),
 * a cart content request is brand-new in `pending_payment` regardless of service
 * type — it just needs to advance to `requested`. Throws on an unexpected DB
 * error so the webhook's per-family FM-2 handler records the failure; an
 * already-advanced request (replay) is a no-op.
 *
 * Returns a discriminated result so the webhook loop can (a) broadcast
 * CONTENT_REQUEST_UPDATE only when the request actually advanced, and (b) treat a
 * MISSING request as a fulfillment failure (paid but unfulfillable) rather than a
 * silent log.warn — the client paid, so the item must surface on reconciliation.
 */
function applyCartContentPayment(workspaceId: string, contentRequestId: string): CartContentPaymentResult {
  const request = getContentRequest(workspaceId, contentRequestId);
  if (!request) {
    log.warn({ workspaceId, contentRequestId }, 'Cart content payment references a missing content request');
    return 'missing';
  }
  if (request.status !== 'pending_payment') {
    // Already advanced (webhook replay) — nothing to do.
    log.info({ workspaceId, contentRequestId, status: request.status }, 'Cart content request already past pending_payment — skipping');
    return 'noop';
  }
  updateContentRequest(workspaceId, contentRequestId, { status: 'requested' });
  return 'advanced';
}

function applyContentRequestPayment(workspaceId: string, productType: string, contentRequestId: string | undefined): void {
  if (!contentRequestId) return;
  if (productType === 'post_polished') {
    const request = getContentRequest(workspaceId, contentRequestId);
    if (!request) {
      log.warn({ workspaceId, contentRequestId }, 'Paid full-post upgrade references a missing content request');
      return;
    }
    if (request.serviceType !== 'brief_only' || request.status !== 'approved') {
      log.warn({ workspaceId, contentRequestId, status: request.status, serviceType: request.serviceType }, 'Paid full-post upgrade cannot be applied to request state');
      return;
    }
    updateContentRequest(workspaceId, contentRequestId, {
      serviceType: 'full_post',
      upgradedAt: new Date().toISOString(),
      status: 'in_progress',
    });
    _broadcastFn?.(workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: contentRequestId, status: 'in_progress' });
    return;
  }
  try {
    updateContentRequest(workspaceId, contentRequestId, { status: 'requested' });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      log.info({ workspaceId, contentRequestId, error: err.message }, 'Content request already past requested — skipping status update');
    } else {
      throw err;
    }
  }
}

function checkoutPaymentIntentId(session: Stripe.Checkout.Session): string | undefined {
  return typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
}

function checkoutSubscriptionId(session: Stripe.Checkout.Session): string | undefined {
  return typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
}

function isFulfillmentProduct(productType: string): boolean {
  return productType.startsWith('fix_') || productType.startsWith('schema_');
}

type PlatformPlanTier = 'growth' | 'premium';

function platformPlanTier(productType: string | undefined): PlatformPlanTier | null {
  if (productType === 'plan_premium') return 'premium';
  if (productType === 'plan_growth') return 'growth';
  return null;
}

function isCurrentPlanSubscription(
  workspaceId: string,
  subscriptionId: string,
  opts: { allowMissingCurrent: boolean; eventType: string; status?: string },
): boolean {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    log.warn({ workspaceId, subscriptionId, eventType: opts.eventType }, 'Ignoring platform subscription event for missing workspace');
    return false;
  }
  if (!ws.stripeSubscriptionId) {
    if (opts.allowMissingCurrent) return true;
    log.warn({ workspaceId, subscriptionId, eventType: opts.eventType, status: opts.status }, 'Ignoring platform subscription event with no current workspace subscription');
    return false;
  }
  if (ws.stripeSubscriptionId !== subscriptionId) {
    log.warn({
      workspaceId,
      eventSubscriptionId: subscriptionId,
      currentSubscriptionId: ws.stripeSubscriptionId,
      eventType: opts.eventType,
      status: opts.status,
    }, 'Ignoring stale platform subscription event');
    return false;
  }
  return true;
}

function downgradePlatformPlan(workspaceId: string, subscriptionId: string, status: string, message: string): void {
  updateWorkspace(workspaceId, { tier: 'free', stripeSubscriptionId: undefined, trialEndsAt: undefined });
  _broadcastFn?.(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, { tier: 'free', subscriptionStatus: status });
  addActivity(workspaceId, 'subscription_cancelled', message, '', { subscriptionId, status });
  log.info({ workspaceId, subscriptionId, status }, 'Platform subscription downgraded workspace to free');
}

function paymentQueuesByProduct(payments: PaymentRecord[]): Map<ProductType, PaymentRecord[]> {
  const queues = new Map<ProductType, PaymentRecord[]>();
  for (const payment of payments) {
    const existing = queues.get(payment.productType) ?? [];
    existing.push(payment);
    queues.set(payment.productType, existing);
  }
  return queues;
}

function takePaymentForProduct(
  queues: Map<ProductType, PaymentRecord[]>,
  productType: ProductType,
  fallback: PaymentRecord | undefined,
): PaymentRecord | undefined {
  const queue = queues.get(productType);
  return queue?.shift() ?? fallback;
}

function paymentFailureMetadata(intent: Stripe.PaymentIntent): Record<string, string> {
  const failure = intent.last_payment_error;
  const metadata: Record<string, string> = {
    stripePaymentIntentId: intent.id,
    failureStatus: intent.status,
  };
  if (failure?.message) metadata.failureMessage = failure.message;
  if (failure?.code) metadata.failureCode = failure.code;
  if (failure?.decline_code) metadata.declineCode = failure.decline_code;
  if (failure?.payment_method?.type) metadata.paymentMethodType = failure.payment_method.type;
  return metadata;
}

export function listProducts(): ProductConfig[] {
  return (Object.keys(PRODUCT_MAP) as ProductType[]).map(type => getProductConfig(type)!);
}

// --- Checkout Session ---

export interface CheckoutParams {
  workspaceId: string;
  productType: ProductType;
  contentRequestId?: string;
  topic?: string;
  targetKeyword?: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(params: CheckoutParams): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured. Add your Secret Key in Command Center → Payments.');

  const config = getProductConfig(params.productType);
  if (!config) throw new Error(`Unknown product type: ${params.productType}`);
  if (!config.stripePriceId) throw new Error(`No Stripe Price ID configured for ${params.productType}. Configure it in Command Center → Payments.`);
  if (params.productType === 'post_polished') validatePostPolishedUpgrade(params.workspaceId, params.contentRequestId);

  const metadata: Record<string, string> = {
    workspaceId: params.workspaceId,
    productType: params.productType,
  };
  if (params.contentRequestId) metadata.contentRequestId = params.contentRequestId;
  if (params.topic) metadata.topic = params.topic;
  if (params.targetKeyword) metadata.targetKeyword = params.targetKeyword;

  const isSubscription = params.productType === 'plan_growth' || params.productType === 'plan_premium'
    || params.productType === 'content_starter' || params.productType === 'content_growth' || params.productType === 'content_scale';

  // Get or create a Stripe Customer for subscription mode (required) and useful for one-time too
  const customerId = await getOrCreateCustomer(stripe, params.workspaceId);

  const session = await stripe.checkout.sessions.create({
    mode: isSubscription ? 'subscription' : 'payment',
    customer: customerId,
    line_items: [{ price: config.stripePriceId, quantity: 1 }],
    metadata,
    ...(isSubscription ? { subscription_data: { metadata } } : {}),
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  // Create pending payment record
  createPayment(params.workspaceId, {
    workspaceId: params.workspaceId,
    stripeSessionId: session.id,
    productType: params.productType,
    amount: config.priceUsd * 100, // store in cents
    currency: 'usd',
    status: 'pending',
    contentRequestId: params.contentRequestId,
    metadata,
  });

  return { sessionId: session.id, url: session.url! };
}

// --- Cart Checkout (multiple products in one session) ---

export interface CartCheckoutParams {
  workspaceId: string;
  items: Array<{
    productType: ProductType;
    quantity: number;
    pageIds?: string[];
    issueChecks?: string[];
    /** Per-item content context (briefs/posts). */
    content?: ContentCartContext;
  }>;
  successUrl: string;
  cancelUrl: string;
}

export async function createCartCheckoutSession(params: CartCheckoutParams): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured. Add your Secret Key in Command Center → Payments.');
  if (!params.items.length) throw new Error('Cart is empty');

  // SERVER-AUTHORITATIVE bundle pricing: collapse any client pack/per-page split of
  // a fix family and re-derive the correct line items (pack(s) + per-page remainder;
  // alt-text flat). Content items (briefs/posts) are non-fix and pass through
  // normalization untouched — each content item stays its own distinct line. The
  // client cannot construct a cheaper-than-correct split — the server is the only
  // authority on totals (MONETIZATION.md §233).
  const normalizedItems = normalizeFixCart(params.items);
  if (!normalizedItems.length) throw new Error('Cart is empty');

  // Premium content discount is keyed off the SERVER's view of the tier, never a
  // client claim. Premium is a paid tier (trial promotes free→growth only), so the
  // effective tier is authoritative here.
  const ws = getWorkspace(params.workspaceId);
  const tier = ws ? computeEffectiveTier(ws) : 'free';

  // For each content item, create the backing content request NOW (pending_payment),
  // mirroring the single-purchase flow, and stamp its id back onto the normalized
  // item so the persisted cart can fulfill it in the webhook. dedupe:false — each
  // cart line is a distinct topic the client explicitly added.
  //
  // These requests are created BEFORE the Stripe session. If anything downstream
  // (line-item assembly, customer creation, or sessions.create) throws, these
  // pending_payment rows would be stranded as client-visible "Awaiting Payment"
  // items for a checkout that never started. Track their ids and clean them up on
  // any failure before re-throwing (item 5 — orphaned pending_payment guard).
  const createdContentRequestIds: string[] = [];
  for (const item of normalizedItems) {
    if (!item.content) continue;
    const c = item.content;
    const request = createContentRequest(params.workspaceId, {
      topic: c.topic,
      targetKeyword: c.targetKeyword,
      intent: c.intent || 'informational',
      priority: c.priority || 'medium',
      rationale: c.rationale || c.notes || `Cart content request: ${c.topic}`,
      clientNote: c.notes,
      source: c.source,
      serviceType: c.serviceType,
      pageType: c.pageType,
      initialStatus: 'pending_payment',
      targetPageId: c.targetPageId,
      targetPageSlug: c.targetPageSlug,
      dedupe: false,
    });
    item.contentRequestId = request.id;
    createdContentRequestIds.push(request.id);
  }

  try {
  // Stripe line items. Fix/full-price products use their fixed Stripe Price ID.
  // Premium content lines carry an inline `price_data` override so the 10% discount
  // is applied exactly per-line (the configured Price ID is a fixed amount and
  // cannot express the discount). Non-Premium content keeps the fixed Price ID.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const productTypes: string[] = [];

  for (const item of normalizedItems) {
    const config = getProductConfig(item.productType);
    if (!config) throw new Error(`Unknown product type: ${item.productType}`);
    if (!config.stripePriceId) throw new Error(`No Stripe Price ID configured for ${item.productType}. Configure it in Command Center → Payments.`);

    const isContent = !!item.content;
    const discounted = isContent && tier === 'premium' && isDiscountableContent(config.category);
    if (discounted) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: contentUnitAmountCents(config, tier),
          product_data: { name: `${config.displayName} (Premium −${Math.round(PREMIUM_CONTENT_DISCOUNT * 100)}%)` },
        },
        quantity: item.quantity,
      });
    } else {
      lineItems.push({ price: config.stripePriceId, quantity: item.quantity });
    }
    productTypes.push(item.productType);
  }

  // Stripe checkout-session metadata values cap at 500 chars. The full normalized
  // cart (with all merged pageIds) can blow past that for large carts, so we keep
  // metadata to a COMPACT reference and persist the authoritative cart out-of-band
  // on the payment records (cart_items column). The webhook reads the persisted
  // cart for work-order fulfillment instead of metadata.
  const metadata: Record<string, string> = {
    workspaceId: params.workspaceId,
    cartItemCount: String(normalizedItems.length),
    // productTypes is a short comma list (capped) — keep it for at-a-glance debugging.
    productTypes: productTypes.join(',').slice(0, 480),
  };

  const customerId = await getOrCreateCustomer(stripe, params.workspaceId);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: lineItems,
    metadata,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  // Create a pending payment record per normalized line item. PRODUCT_MAP already
  // carries pack prices ($179/$299), so priceUsd × quantity is the authoritative amount.
  // Content lines store the (possibly Premium-discounted) unit amount so the record
  // matches the Stripe charge. The full normalized cart is persisted on every record
  // (cart_items) so fulfillment can read it regardless of which record the webhook
  // reaches first. Content records carry their contentRequestId for fulfillment.
  for (const item of normalizedItems) {
    const config = getProductConfig(item.productType)!;
    const unitCents = item.content
      ? contentUnitAmountCents(config, tier)
      : config.priceUsd * 100;
    createPayment(params.workspaceId, {
      workspaceId: params.workspaceId,
      stripeSessionId: session.id,
      productType: item.productType,
      amount: unitCents * item.quantity,
      currency: 'usd',
      status: 'pending',
      contentRequestId: item.contentRequestId,
      metadata: { ...metadata, productType: item.productType, quantity: String(item.quantity) },
      cartItems: normalizedItems,
    });
  }

  return { sessionId: session.id, url: session.url! };
  } catch (err) {
    // Session creation (or any step after the content requests were created) failed.
    // Roll back the just-created pending_payment requests so the client never sees a
    // stranded "Awaiting Payment" row for a checkout that never started. These are
    // brand-new requests this call created, so deletion (not status revert) is the
    // honest cleanup — there is no prior state to revert to.
    for (const id of createdContentRequestIds) {
      try {
        deleteContentRequest(params.workspaceId, id);
      } catch (cleanupErr) {
        log.error({ cleanupErr, workspaceId: params.workspaceId, contentRequestId: id }, 'Failed to clean up orphaned cart content request after checkout-session failure');
      }
    }
    throw err;
  }
}

async function getOrCreateCustomer(stripe: Stripe, workspaceId: string): Promise<string> {
  const ws = getWorkspace(workspaceId);
  if (ws?.stripeCustomerId) {
    // Verify customer still exists in Stripe
    try {
      await stripe.customers.retrieve(ws.stripeCustomerId);
      return ws.stripeCustomerId;
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'stripe/getOrCreateCustomer: programming error');
      // Customer deleted in Stripe — create a new one
    }
  }

  const customer = await stripe.customers.create({
    name: ws?.name || workspaceId,
    metadata: { workspaceId },
    ...(ws?.clientEmail ? { email: ws.clientEmail } : {}),
  });

  // Persist the customer ID on the workspace
  updateWorkspace(workspaceId, { stripeCustomerId: customer.id });
  return customer.id;
}

// --- Startup: clear stale test-mode customer IDs when using live keys ---

// --- Billing Portal (self-service subscription management) ---

export async function createBillingPortalSession(workspaceId: string, returnUrl: string): Promise<{ url: string }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const ws = getWorkspace(workspaceId);
  if (!ws?.stripeCustomerId) throw new Error('No Stripe customer found for this workspace');

  const session = await stripe.billingPortal.sessions.create({
    customer: ws.stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

// --- Cancel subscription ---

export async function cancelSubscription(workspaceId: string): Promise<{ ok: boolean }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const ws = getWorkspace(workspaceId);
  if (!ws?.stripeSubscriptionId) throw new Error('No active subscription found');

  // Cancel at period end (graceful — user keeps access until billing period ends)
  await stripe.subscriptions.update(ws.stripeSubscriptionId, { cancel_at_period_end: true });
  return { ok: true };
}

export function clearTestModeCustomerIds(): number {
  const key = getStripeSecretKey();
  if (!key || !key.startsWith('sk_live_')) return 0;
  // Do not eagerly clear stored customer ids on startup.
  // getOrCreateCustomer already verifies each stored id against Stripe and
  // repairs stale/missing ids lazily without churning valid customer links.
  return 0;
}

// --- Webhook Handler ---

export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) throw new Error('Stripe webhook secret is not set');
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const workspaceId = session.metadata?.workspaceId;
      if (!workspaceId) {
        log.warn('checkout.session.completed missing workspaceId in metadata');
        return;
      }

      const sessionPayments = listPaymentsBySession(workspaceId, session.id);
      if (sessionPayments.length === 0) {
        log.error({ workspaceId, stripeSessionId: session.id }, 'checkout.session.completed missing pending payment records — skipping fulfillment for manual reconciliation');
        return;
      }
      const paidSessionPayments = sessionPayments.filter(payment => payment.status === 'paid');
      if (paidSessionPayments.length === sessionPayments.length) {
        log.info({ workspaceId, stripeSessionId: session.id }, 'checkout.session.completed replay ignored — session payments already paid');
        return;
      }
      if (paidSessionPayments.length > 0) {
        log.error({
          workspaceId,
          stripeSessionId: session.id,
          paidPaymentIds: paidSessionPayments.map(payment => payment.id),
          pendingPaymentIds: sessionPayments.filter(payment => payment.status !== 'paid').map(payment => payment.id),
        }, 'checkout.session.completed found partially-paid session — skipping fulfillment to avoid duplicate side effects');
        return;
      }

      const stripePaymentIntentId = checkoutPaymentIntentId(session);
      const paidAt = new Date().toISOString();
      const paidPayments = sessionPayments.map(payment => (
        updatePayment(workspaceId, payment.id, {
          status: 'paid',
          stripePaymentIntentId,
          paidAt,
        }) ?? payment
      ));
      const firstPayment = paidPayments[0];
      const productType = session.metadata?.productType || 'unknown';
      const contentRequestId = session.metadata?.contentRequestId;

      applyContentRequestPayment(workspaceId, productType, contentRequestId);

      // Handle tier upgrade
      if (productType === 'plan_growth' || productType === 'plan_premium') {
        const newTier = productType === 'plan_growth' ? 'growth' : 'premium';
        const stripeSubId = checkoutSubscriptionId(session);
        if (!stripeSubId) {
          log.error({ workspaceId, stripeSessionId: session.id, productType }, 'Platform plan checkout completed without a Stripe subscription id — skipping tier upgrade');
        } else {
          updateWorkspace(workspaceId, {
            tier: newTier,
            trialEndsAt: undefined,
            stripeSubscriptionId: stripeSubId,
          });
          _broadcastFn?.(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, { tier: newTier });
          log.info(`Tier upgraded: workspace=${workspaceId} → ${newTier}`);
        }
      }

      // Handle content subscription creation
      const contentSubPlan = CONTENT_SUB_PLANS.find(p => p.plan === productType);
      if (contentSubPlan && session.subscription) {
        const stripeSubId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

        // Retrieve actual billing period from Stripe
        const stripe = getStripe();
        let periodStart = new Date().toISOString();
        let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        if (stripe) {
          try {
            const subscription = await stripe.subscriptions.retrieve(stripeSubId);
            const item = subscription.items.data[0];
            if (item) {
              periodStart = new Date(item.current_period_start * 1000).toISOString();
              periodEnd = new Date(item.current_period_end * 1000).toISOString();
            }
          } catch (err) {
            log.warn({ err }, `Failed to retrieve subscription period for ${stripeSubId}, using 30-day fallback`);
          }
        }

        createContentSubscription(workspaceId, {
          plan: contentSubPlan.plan,
          postsPerMonth: contentSubPlan.postsPerMonth,
          priceUsd: contentSubPlan.priceUsd,
          stripeSubscriptionId: stripeSubId,
          status: 'active',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });
        _broadcastFn?.(workspaceId, WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED, { plan: contentSubPlan.plan });
        log.info(`Content subscription created: workspace=${workspaceId} plan=${contentSubPlan.plan}`);
      }

      // Log activity
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '?';
      addActivity(
        workspaceId,
        'payment_received',
        `Payment received: $${amount} for ${productType.replace(/_/g, ' ')}`,
        contentRequestId ? `Content request: ${contentRequestId}` : '',
        { paymentId: firstPayment?.id, paymentIds: paidPayments.map(payment => payment.id), productType, stripeSessionId: session.id }
      );

      // Create work orders for fix/schema products
      if (isFulfillmentProduct(productType)) {
        const pageIds = parseJsonSafe(session.metadata?.pageIds, stringArraySchema, [], { workspaceId, field: 'pageIds', table: 'stripe_session' });
        const issueChecks = session.metadata?.issueChecks
          ? parseJsonSafe(session.metadata.issueChecks, stringArraySchema, [], { workspaceId, field: 'issueChecks', table: 'stripe_session' })
          : undefined;
        const quantity = parseInt(session.metadata?.quantity || '1', 10);
        const payment = paidPayments.find(p => p.productType === productType) ?? firstPayment;
        createWorkOrder(workspaceId, {
          paymentId: payment?.id || session.id,
          productType: productType as ProductType,
          status: 'pending',
          pageIds,
          issueChecks,
          quantity,
        });
        log.info(`Work order created: workspace=${workspaceId} product=${productType} pages=${pageIds.length}`);
      }

      // Handle cart checkouts (multiple line items). The authoritative cart is
      // persisted out-of-band (cart_items column) because Stripe metadata caps at
      // 500 chars; read it from the payment record. Fall back to legacy in-metadata
      // carts for any session created before §3 (kept for in-flight replays).
      const persistedCart = getCartItemsBySession(workspaceId, session.id);
      const legacyCart = session.metadata?.cartItems
        ? parseJsonSafeArray(session.metadata.cartItems, cartItemSchema, { workspaceId, field: 'cartItems', table: 'stripe_session' })
        : null;
      const cartItems = persistedCart ?? legacyCart;
      if (cartItems) {
        const paymentQueues = paymentQueuesByProduct(paidPayments);
        // FM-2 per family: a session can mix fixes (work orders) and content
        // (content requests). Each item is fulfilled via its own existing path,
        // wrapped in its OWN try/catch so one family's failure can never swallow
        // the other's — a content-request error must not abort the fix work orders,
        // and vice versa. The payments are already marked paid (the charge cleared),
        // so we do NOT throw to force a retry (that would re-fulfill the already-
        // succeeded family and duplicate work orders). Instead each failure is
        // RECORDED on the activity log as a failure, not silently swallowed, so an
        // operator can reconcile the stuck item.
        const fulfillmentFailures: string[] = [];
        for (const item of cartItems) {
          try {
            if (isFulfillmentProduct(item.productType)) {
              const payment = takePaymentForProduct(paymentQueues, item.productType as ProductType, firstPayment);
              createWorkOrder(workspaceId, {
                paymentId: payment?.id || session.id,
                productType: item.productType as ProductType,
                status: 'pending',
                pageIds: item.pageIds || [],
                issueChecks: item.issueChecks,
                quantity: item.quantity || 1,
              });
            } else if (item.contentRequestId) {
              // Content item (fresh brief/post) — advance the pending_payment
              // request to requested. Cart content is always a NEW request, so it
              // uses the cart-specific fulfillment (NOT the single-purchase
              // post_polished upgrade path, which expects an approved brief).
              const result = applyCartContentPayment(workspaceId, item.contentRequestId);
              if (result === 'advanced') {
                // Data Flow Rule 1: a status-changing mutation must broadcast so the
                // client portal's content list / inbox refresh (mirrors the single-
                // purchase path's CONTENT_REQUEST_UPDATE at applyContentRequestPayment).
                _broadcastFn?.(workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: item.contentRequestId, status: 'requested' });
              } else if (result === 'missing') {
                // Paid but the request vanished — record as a fulfillment failure so
                // the paid-but-unfulfilled reconciliation activity fires (not a silent
                // log.warn). The client's money cleared; this item must be reconciled.
                fulfillmentFailures.push(item.contentRequestId);
              }
            }
          } catch (err) {
            log.error({ err, workspaceId, productType: item.productType, contentRequestId: item.contentRequestId }, 'Failed to fulfill cart item');
            fulfillmentFailures.push(item.contentRequestId ?? item.productType);
          }
        }
        if (fulfillmentFailures.length > 0) {
          addActivity(
            workspaceId,
            'payment_failed',
            `Fulfillment failed for ${fulfillmentFailures.length} paid cart item(s) — needs reconciliation`,
            `Session ${session.id} · items: ${fulfillmentFailures.join(', ')}`,
            { stripeSessionId: session.id, failedItems: fulfillmentFailures.join(',') },
          );
        }
      }

      // Notify team of payment
      const ws = getWorkspace(workspaceId);
      if (ws) {
        notifyTeamPaymentReceived({
          workspaceName: ws.name,
          workspaceId,
          productType,
          amount: `$${amount}`,
        });
      }

      log.info(`Payment completed: workspace=${workspaceId} product=${productType} amount=$${amount}`);
      break;
    }

    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const workspaceId = intent.metadata?.workspaceId;
      if (!workspaceId) {
        log.warn('payment_intent.succeeded missing workspaceId in metadata');
        return;
      }

      // Direct legacy PaymentIntent records used the PI id as stripeSessionId.
      // Checkout records keep the Checkout session id separately and store the
      // PI id once checkout.session.completed has reconciled the session.
      const payment = getPaymentBySession(workspaceId, intent.id) ?? getPaymentByPaymentIntent(workspaceId, intent.id);
      if (payment?.status === 'paid') {
        log.info({ workspaceId, stripePaymentIntentId: intent.id }, 'payment_intent.succeeded replay ignored — payment already paid');
        return;
      }
      if (!payment) {
        log.error({ workspaceId, stripePaymentIntentId: intent.id }, 'payment_intent.succeeded missing pending payment record — skipping fulfillment for manual reconciliation');
        return;
      }
      updatePayment(workspaceId, payment.id, {
        status: 'paid',
        stripePaymentIntentId: intent.id,
        paidAt: new Date().toISOString(),
      });

      const productType = intent.metadata?.productType || 'unknown';
      const contentRequestId = intent.metadata?.contentRequestId;

      applyContentRequestPayment(workspaceId, productType, contentRequestId);

      // Handle tier upgrade
      if (productType === 'plan_growth' || productType === 'plan_premium') {
        const newTier = productType === 'plan_growth' ? 'growth' : 'premium';
        updateWorkspace(workspaceId, { tier: newTier, trialEndsAt: undefined });
        _broadcastFn?.(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, { tier: newTier });
        log.info(`Tier upgraded: workspace=${workspaceId} → ${newTier}`);
      }

      // Log activity
      const amount = (intent.amount / 100).toFixed(2);
      addActivity(
        workspaceId,
        'payment_received',
        `Payment received: $${amount} for ${productType.replace(/_/g, ' ')}`,
        contentRequestId ? `Content request: ${contentRequestId}` : '',
        { paymentId: payment?.id, productType, stripePaymentIntentId: intent.id }
      );

      log.info(`PaymentIntent succeeded: workspace=${workspaceId} product=${productType} amount=$${amount}`);
      break;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const workspaceId = intent.metadata?.workspaceId;
      if (!workspaceId) return;

      const payment = getPaymentBySession(workspaceId, intent.id) ?? getPaymentByPaymentIntent(workspaceId, intent.id);
      if (payment) {
        updatePayment(workspaceId, payment.id, {
          status: 'failed',
          stripePaymentIntentId: intent.id,
          metadata: {
            ...(payment.metadata ?? {}),
            ...paymentFailureMetadata(intent),
          },
        });
      }

      log.warn(`Payment failed: workspace=${workspaceId} intent=${intent.id}`);

      addActivity(
        workspaceId,
        'payment_failed',
        'Payment failed — please retry or contact support',
        intent.last_payment_error?.message || `Stripe PaymentIntent: ${intent.id}`,
        { paymentId: payment?.id, ...paymentFailureMetadata(intent) }
      );
      break;
    }

    // --- Subscription lifecycle events ---

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;

      // Content package subscriptions are tracked in content_subscriptions and
      // must not overwrite the platform plan subscription stored on workspace.
      const contentSub = getContentSubscriptionByStripeId(subscription.id);
      if (contentSub) {
        const statusMap: Partial<Record<Stripe.Subscription.Status, ContentSubscription['status']>> = {
          active: 'active',
          trialing: 'active',
          past_due: 'past_due',
          unpaid: 'past_due',
          incomplete: 'pending',
          incomplete_expired: 'cancelled',
          canceled: 'cancelled',
          paused: 'paused',
        };
        const newStatus = statusMap[subscription.status];
        if (!newStatus) {
          log.warn({ workspaceId: contentSub.workspaceId, subscriptionId: subscription.id, status: subscription.status }, 'Unhandled content subscription Stripe status');
          break;
        }
        if (newStatus !== contentSub.status) {
          updateContentSubscription(contentSub.workspaceId, contentSub.id, { status: newStatus });
          _broadcastFn?.(contentSub.workspaceId, WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED, { id: contentSub.id, status: newStatus });
          addActivity(contentSub.workspaceId, 'content_subscription', `Content subscription status changed: ${contentSub.status} → ${newStatus}`, '', { subscriptionId: contentSub.id, stripeSubscriptionId: subscription.id });
        }
        break;
      }

      const workspaceId = subscription.metadata?.workspaceId;
      if (!workspaceId) return;

      const productType = subscription.metadata?.productType;
      const newTier = platformPlanTier(productType);
      if (!newTier) {
        log.info({ workspaceId, subscriptionId: subscription.id, status: subscription.status, productType }, 'Ignoring non-platform subscription event with no local content subscription');
        break;
      }

      if (subscription.status === 'active' || subscription.status === 'trialing') {
        const allowMissingCurrent = event.type === 'customer.subscription.created';
        if (!isCurrentPlanSubscription(workspaceId, subscription.id, { allowMissingCurrent, eventType: event.type, status: subscription.status })) break;
        updateWorkspace(workspaceId, {
          stripeSubscriptionId: subscription.id,
          tier: newTier,
          trialEndsAt: undefined,
        });
        _broadcastFn?.(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, { tier: newTier, subscriptionStatus: subscription.status });
        log.info(`Subscription ${event.type}: workspace=${workspaceId} status=${subscription.status} tier=${newTier}`);
      } else if (subscription.status === 'past_due') {
        if (!isCurrentPlanSubscription(workspaceId, subscription.id, { allowMissingCurrent: false, eventType: event.type, status: subscription.status })) break;
        log.warn(`Subscription ${subscription.status}: workspace=${workspaceId} sub=${subscription.id}`);
        addActivity(workspaceId, 'subscription_issue', `Subscription payment ${subscription.status} — please update billing`, '', { subscriptionId: subscription.id });
        _broadcastFn?.(workspaceId, WS_EVENTS.WORKSPACE_UPDATED, { subscriptionStatus: subscription.status });
      } else if (subscription.status === 'unpaid') {
        if (!isCurrentPlanSubscription(workspaceId, subscription.id, { allowMissingCurrent: false, eventType: event.type, status: subscription.status })) break;
        downgradePlatformPlan(workspaceId, subscription.id, subscription.status, 'Subscription unpaid — downgraded to Free tier');
      } else if (subscription.status === 'incomplete_expired') {
        if (!isCurrentPlanSubscription(workspaceId, subscription.id, { allowMissingCurrent: false, eventType: event.type, status: subscription.status })) break;
        downgradePlatformPlan(workspaceId, subscription.id, subscription.status, 'Subscription checkout expired — downgraded to Free tier');
      } else if (subscription.status === 'canceled') {
        if (!isCurrentPlanSubscription(workspaceId, subscription.id, { allowMissingCurrent: false, eventType: event.type, status: subscription.status })) break;
        downgradePlatformPlan(workspaceId, subscription.id, subscription.status, 'Subscription cancelled — downgraded to Free tier');
      } else {
        log.warn({ workspaceId, subscriptionId: subscription.id, status: subscription.status }, 'Unhandled platform subscription Stripe status');
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;

      // Check if this is a content subscription
      const contentSub = getContentSubscriptionByStripeId(subscription.id);
      if (contentSub) {
        updateContentSubscription(contentSub.workspaceId, contentSub.id, { status: 'cancelled' });
        _broadcastFn?.(contentSub.workspaceId, WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED, { id: contentSub.id, status: 'cancelled' });
        addActivity(contentSub.workspaceId, 'content_subscription', 'Content subscription cancelled', '', { subscriptionId: contentSub.id });
        log.info(`Content subscription cancelled: workspace=${contentSub.workspaceId} sub=${subscription.id}`);
      } else {
        const workspaceId = subscription.metadata?.workspaceId;
        if (!workspaceId) return;

        if (!isCurrentPlanSubscription(workspaceId, subscription.id, { allowMissingCurrent: false, eventType: event.type, status: subscription.status })) break;

        // Downgrade to free tier (platform plan)
        downgradePlatformPlan(workspaceId, subscription.id, 'canceled', 'Subscription cancelled — downgraded to Free tier');
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as unknown as Record<string, unknown>).subscription as string | undefined;
      if (!subId) return;

      // Reset content subscription period on renewal using actual invoice billing period
      const contentSub = getContentSubscriptionByStripeId(subId);
      const workspaceId = contentSub?.workspaceId ?? invoice.metadata?.workspaceId;
      if (!workspaceId) return;
      if (contentSub) {
        const periodStart = invoice.period_start
          ? new Date(invoice.period_start * 1000).toISOString()
          : new Date().toISOString();
        const periodEnd = invoice.period_end
          ? new Date(invoice.period_end * 1000).toISOString()
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        resetPeriod(contentSub.workspaceId, contentSub.id, periodStart, periodEnd);
        updateContentSubscription(contentSub.workspaceId, contentSub.id, { status: 'active' });
        _broadcastFn?.(contentSub.workspaceId, WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED, { id: contentSub.id });
        log.info(`Content subscription renewed: workspace=${contentSub.workspaceId} sub=${subId}`);
      }

      addActivity(workspaceId, 'invoice_paid', `Invoice paid: $${((invoice.amount_paid || 0) / 100).toFixed(2)}`, '', { invoiceId: invoice.id, subscriptionId: subId });
      log.info(`Invoice paid: workspace=${workspaceId} amount=$${((invoice.amount_paid || 0) / 100).toFixed(2)}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const workspaceId = invoice.metadata?.workspaceId;
      if (!workspaceId) return;
      addActivity(workspaceId, 'invoice_failed', 'Subscription payment failed — please update your payment method', '', { invoiceId: invoice.id });
      log.warn(`Invoice payment failed: workspace=${workspaceId} invoice=${invoice.id}`);
      break;
    }

    default:
      // Unhandled event type — log but don't error
      log.info(`Unhandled event type: ${event.type}`);
  }
}
