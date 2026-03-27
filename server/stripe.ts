import Stripe from 'stripe';
import { createPayment, updatePayment, getPaymentBySession, type ProductType } from './payments.js';
import { updateContentRequest } from './content-requests.js';
import { addActivity } from './activity-log.js';
import { getStripeSecretKey, getStripeWebhookSecret, getStripePriceId } from './stripe-config.js';
import { getWorkspace, updateWorkspace, listWorkspaces } from './workspaces.js';
import { createWorkOrder } from './work-orders.js';
import { notifyTeamPaymentReceived } from './email.js';
import { createLogger } from './logger.js';
import { parseJsonSafe } from './db/json-validation.js';
import { cartItemsArraySchema, stringArraySchema } from './schemas/payment-schemas.js';
import {
  createContentSubscription, getContentSubscriptionByStripeId,
  updateContentSubscription, resetPeriod,
} from './content-subscriptions.js';
import { CONTENT_SUB_PLANS, type ContentSubscription } from '../shared/types/content.js';

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
  items: Array<{ productType: ProductType; quantity: number; pageIds?: string[] }>;
  successUrl: string;
  cancelUrl: string;
}

export async function createCartCheckoutSession(params: CartCheckoutParams): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured. Add your Secret Key in Command Center → Payments.');
  if (!params.items.length) throw new Error('Cart is empty');

  const lineItems: Array<{ price: string; quantity: number }> = [];
  const productTypes: string[] = [];

  for (const item of params.items) {
    const config = getProductConfig(item.productType);
    if (!config) throw new Error(`Unknown product type: ${item.productType}`);
    if (!config.stripePriceId) throw new Error(`No Stripe Price ID configured for ${item.productType}. Configure it in Command Center → Payments.`);
    lineItems.push({ price: config.stripePriceId, quantity: item.quantity });
    productTypes.push(item.productType);
  }

  const metadata: Record<string, string> = {
    workspaceId: params.workspaceId,
    cartItems: JSON.stringify(params.items),
    productTypes: productTypes.join(','),
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

  // Create a pending payment record per product
  for (const item of params.items) {
    const config = getProductConfig(item.productType)!;
    createPayment(params.workspaceId, {
      workspaceId: params.workspaceId,
      stripeSessionId: session.id,
      productType: item.productType,
      amount: config.priceUsd * item.quantity * 100,
      currency: 'usd',
      status: 'pending',
      metadata: { ...metadata, productType: item.productType, quantity: String(item.quantity) },
    });
  }

  return { sessionId: session.id, url: session.url! };
}

// --- Payment Intent (for Stripe Elements inline form) ---

export interface PaymentIntentParams {
  workspaceId: string;
  productType: ProductType;
  contentRequestId?: string;
  topic?: string;
  targetKeyword?: string;
}

async function getOrCreateCustomer(stripe: Stripe, workspaceId: string): Promise<string> {
  const ws = getWorkspace(workspaceId);
  if (ws?.stripeCustomerId) {
    // Verify customer still exists in Stripe
    try {
      await stripe.customers.retrieve(ws.stripeCustomerId);
      return ws.stripeCustomerId;
    } catch {
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

export async function createPaymentIntentForProduct(params: PaymentIntentParams): Promise<{ clientSecret: string; paymentIntentId: string; amount: number }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured. Add your Secret Key in Command Center → Payments.');

  const config = getProductConfig(params.productType);
  if (!config) throw new Error(`Unknown product type: ${params.productType}`);

  const amountCents = config.priceUsd * 100;

  // Get or create a Stripe Customer so payment methods are saved
  const customerId = await getOrCreateCustomer(stripe, params.workspaceId);

  const metadata: Record<string, string> = {
    workspaceId: params.workspaceId,
    productType: params.productType,
  };
  if (params.contentRequestId) metadata.contentRequestId = params.contentRequestId;
  if (params.topic) metadata.topic = params.topic;
  if (params.targetKeyword) metadata.targetKeyword = params.targetKeyword;

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customerId,
    setup_future_usage: 'off_session',
    metadata,
    automatic_payment_methods: { enabled: true },
  });

  // Create pending payment record
  createPayment(params.workspaceId, {
    workspaceId: params.workspaceId,
    stripeSessionId: intent.id, // store PI id in session field for lookup
    productType: params.productType,
    amount: amountCents,
    currency: 'usd',
    status: 'pending',
    contentRequestId: params.contentRequestId,
    metadata,
  });

  return { clientSecret: intent.client_secret!, paymentIntentId: intent.id, amount: amountCents };
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
  const workspaces = listWorkspaces();
  let cleared = 0;
  for (const ws of workspaces) {
    if (ws.stripeCustomerId) {
      // Clear any stored customer ID when switching to live mode.
      // The getOrCreateCustomer function will create a fresh live customer on next payment.
      updateWorkspace(ws.id, { stripeCustomerId: '' });
      cleared++;
    }
  }
  if (cleared > 0) log.info(`Cleared ${cleared} stale test-mode customer ID(s) — live customers will be created on next payment`);
  return cleared;
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

      // Find and update payment record
      const payment = getPaymentBySession(workspaceId, session.id);
      if (payment) {
        updatePayment(workspaceId, payment.id, {
          status: 'paid',
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
          paidAt: new Date().toISOString(),
        });
      }

      const productType = session.metadata?.productType || 'unknown';
      const contentRequestId = session.metadata?.contentRequestId;

      // Update content request status if linked
      if (contentRequestId) {
        updateContentRequest(workspaceId, contentRequestId, { status: 'requested' });
      }

      // Handle tier upgrade
      if (productType === 'plan_growth' || productType === 'plan_premium') {
        const newTier = productType === 'plan_growth' ? 'growth' : 'premium';
        updateWorkspace(workspaceId, { tier: newTier, trialEndsAt: undefined });
        _broadcastFn?.(workspaceId, 'workspace:updated', { tier: newTier });
        log.info(`Tier upgraded: workspace=${workspaceId} → ${newTier}`);
      }

      // Handle content subscription creation
      const contentSubPlan = CONTENT_SUB_PLANS.find(p => p.plan === productType);
      if (contentSubPlan && session.subscription) {
        const stripeSubId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
        createContentSubscription(workspaceId, {
          plan: contentSubPlan.plan,
          postsPerMonth: contentSubPlan.postsPerMonth,
          priceUsd: contentSubPlan.priceUsd,
          stripeSubscriptionId: stripeSubId,
          status: 'active',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        _broadcastFn?.(workspaceId, 'content-subscription:created', { plan: contentSubPlan.plan });
        log.info(`Content subscription created: workspace=${workspaceId} plan=${contentSubPlan.plan}`);
      }

      // Log activity
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '?';
      addActivity(
        workspaceId,
        'payment_received',
        `Payment received: $${amount} for ${productType.replace(/_/g, ' ')}`,
        contentRequestId ? `Content request: ${contentRequestId}` : '',
        { paymentId: payment?.id, productType, stripeSessionId: session.id }
      );

      // Create work orders for fix/schema products
      if (productType.startsWith('fix_') || productType.startsWith('schema_')) {
        const pageIds = parseJsonSafe(session.metadata?.pageIds, stringArraySchema, [], { workspaceId, field: 'pageIds', table: 'stripe_session' });
        const issueChecks = session.metadata?.issueChecks
          ? parseJsonSafe(session.metadata.issueChecks, stringArraySchema, [], { workspaceId, field: 'issueChecks', table: 'stripe_session' })
          : undefined;
        const quantity = parseInt(session.metadata?.quantity || '1', 10);
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

      // Handle cart checkouts (multiple line items)
      if (session.metadata?.cartItems) {
        const cartItems = parseJsonSafe(session.metadata.cartItems, cartItemsArraySchema, [], { workspaceId, field: 'cartItems', table: 'stripe_session' });
        for (const item of cartItems) {
          try {
            if (item.productType.startsWith('fix_') || item.productType.startsWith('schema_')) {
              createWorkOrder(workspaceId, {
                paymentId: payment?.id || session.id,
                productType: item.productType as ProductType,
                status: 'pending',
                pageIds: item.pageIds || [],
                issueChecks: item.issueChecks,
                quantity: item.quantity || 1,
              });
            }
          } catch (err) {
            log.error({ err, workspaceId, productType: item.productType }, 'Failed to create work order for cart item — skipping');
          }
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

      // Find payment record (we stored the PI id in stripeSessionId field)
      const payment = getPaymentBySession(workspaceId, intent.id);
      if (payment) {
        updatePayment(workspaceId, payment.id, {
          status: 'paid',
          stripePaymentIntentId: intent.id,
          paidAt: new Date().toISOString(),
        });
      }

      const productType = intent.metadata?.productType || 'unknown';
      const contentRequestId = intent.metadata?.contentRequestId;

      // Update content request status if linked
      if (contentRequestId) {
        updateContentRequest(workspaceId, contentRequestId, { status: 'requested' });
      }

      // Handle tier upgrade
      if (productType === 'plan_growth' || productType === 'plan_premium') {
        const newTier = productType === 'plan_growth' ? 'growth' : 'premium';
        updateWorkspace(workspaceId, { tier: newTier, trialEndsAt: undefined });
        _broadcastFn?.(workspaceId, 'workspace:updated', { tier: newTier });
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

      // Try to find and update payment record
      // payment_intent doesn't have a session ID directly, so we search by payment intent ID
      // This is a fallback — most failures are caught at checkout level
      log.warn(`Payment failed: workspace=${workspaceId} intent=${intent.id}`);

      addActivity(
        workspaceId,
        'payment_failed',
        'Payment failed — please retry or contact support',
        `Stripe PaymentIntent: ${intent.id}`,
        { stripePaymentIntentId: intent.id }
      );
      break;
    }

    // --- Subscription lifecycle events ---

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const workspaceId = subscription.metadata?.workspaceId;
      if (!workspaceId) return;

      const productType = subscription.metadata?.productType;
      const newTier = productType === 'plan_premium' ? 'premium' : productType === 'plan_growth' ? 'growth' : null;

      if (subscription.status === 'active' || subscription.status === 'trialing') {
        const updates: Record<string, unknown> = { stripeSubscriptionId: subscription.id };
        if (newTier) { updates.tier = newTier; updates.trialEndsAt = undefined; }
        updateWorkspace(workspaceId, updates as Parameters<typeof updateWorkspace>[1]);
        _broadcastFn?.(workspaceId, 'workspace:updated', { tier: newTier, subscriptionStatus: subscription.status });
        log.info(`Subscription ${event.type}: workspace=${workspaceId} status=${subscription.status} tier=${newTier}`);
      } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
        log.warn(`Subscription ${subscription.status}: workspace=${workspaceId} sub=${subscription.id}`);
        addActivity(workspaceId, 'subscription_issue', `Subscription payment ${subscription.status} — please update billing`, '', { subscriptionId: subscription.id });
      }

      // Sync content subscription status
      const contentSub = getContentSubscriptionByStripeId(subscription.id);
      if (contentSub) {
        const statusMap: Record<string, ContentSubscription['status']> = {
          active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'cancelled',
        };
        const newStatus = statusMap[subscription.status] || contentSub.status;
        if (newStatus !== contentSub.status) {
          updateContentSubscription(contentSub.id, { status: newStatus });
          _broadcastFn?.(workspaceId, 'content-subscription:updated', { id: contentSub.id, status: newStatus });
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const workspaceId = subscription.metadata?.workspaceId;
      if (!workspaceId) return;

      // Check if this is a content subscription
      const contentSub = getContentSubscriptionByStripeId(subscription.id);
      if (contentSub) {
        updateContentSubscription(contentSub.id, { status: 'cancelled' });
        _broadcastFn?.(workspaceId, 'content-subscription:updated', { id: contentSub.id, status: 'cancelled' });
        addActivity(workspaceId, 'content_subscription', 'Content subscription cancelled', '', { subscriptionId: contentSub.id });
        log.info(`Content subscription cancelled: workspace=${workspaceId} sub=${subscription.id}`);
      } else {
        // Downgrade to free tier (platform plan)
        updateWorkspace(workspaceId, { tier: 'free', stripeSubscriptionId: undefined, trialEndsAt: undefined });
        _broadcastFn?.(workspaceId, 'workspace:updated', { tier: 'free' });
        addActivity(workspaceId, 'subscription_cancelled', 'Subscription cancelled — downgraded to Free tier', '', { subscriptionId: subscription.id });
        log.info(`Subscription cancelled: workspace=${workspaceId} sub=${subscription.id} → free tier`);
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as unknown as Record<string, unknown>).subscription as string | undefined;
      if (!subId || !invoice.metadata?.workspaceId) return;
      const workspaceId = invoice.metadata.workspaceId;

      // Reset content subscription period on renewal
      const contentSub = getContentSubscriptionByStripeId(subId);
      if (contentSub) {
        const periodStart = new Date().toISOString();
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        resetPeriod(contentSub.id, periodStart, periodEnd);
        updateContentSubscription(contentSub.id, { status: 'active' });
        _broadcastFn?.(workspaceId, 'content-subscription:renewed', { id: contentSub.id });
        log.info(`Content subscription renewed: workspace=${workspaceId} sub=${subId}`);
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
