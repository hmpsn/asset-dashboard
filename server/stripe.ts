import Stripe from 'stripe';
import { createPayment, updatePayment, getPaymentBySession, type ProductType } from './payments.js';
import { updateContentRequest } from './content-requests.js';
import { addActivity } from './activity-log.js';
import { getStripeSecretKey, getStripeWebhookSecret, getStripePriceId } from './stripe-config.js';
import { getWorkspace, updateWorkspace } from './workspaces.js';

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
  category: 'brief' | 'content' | 'schema' | 'strategy';
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
  schema_page:      { displayName: 'Schema — Per Page',       category: 'schema',   priceUsd: 35,   envKey: 'STRIPE_PRICE_SCHEMA_PAGE' },
  schema_site:      { displayName: 'Schema — Full Site',      category: 'schema',   priceUsd: 350,  envKey: 'STRIPE_PRICE_SCHEMA_SITE' },
  strategy:         { displayName: 'Keyword Strategy',        category: 'strategy', priceUsd: 400,  envKey: 'STRIPE_PRICE_STRATEGY' },
  strategy_refresh: { displayName: 'Strategy Refresh',        category: 'strategy', priceUsd: 200,  envKey: 'STRIPE_PRICE_STRATEGY_REFRESH' },
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

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: config.stripePriceId, quantity: 1 }],
    metadata,
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
        console.warn('[stripe] checkout.session.completed missing workspaceId in metadata');
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

      // Log activity
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '?';
      addActivity(
        workspaceId,
        'payment_received',
        `Payment received: $${amount} for ${productType.replace(/_/g, ' ')}`,
        contentRequestId ? `Content request: ${contentRequestId}` : '',
        { paymentId: payment?.id, productType, stripeSessionId: session.id }
      );

      console.log(`[stripe] Payment completed: workspace=${workspaceId} product=${productType} amount=$${amount}`);
      break;
    }

    case 'payment_intent.succeeded': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const workspaceId = intent.metadata?.workspaceId;
      if (!workspaceId) {
        console.warn('[stripe] payment_intent.succeeded missing workspaceId in metadata');
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

      // Log activity
      const amount = (intent.amount / 100).toFixed(2);
      addActivity(
        workspaceId,
        'payment_received',
        `Payment received: $${amount} for ${productType.replace(/_/g, ' ')}`,
        contentRequestId ? `Content request: ${contentRequestId}` : '',
        { paymentId: payment?.id, productType, stripePaymentIntentId: intent.id }
      );

      console.log(`[stripe] PaymentIntent succeeded: workspace=${workspaceId} product=${productType} amount=$${amount}`);
      break;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object as Stripe.PaymentIntent;
      const workspaceId = intent.metadata?.workspaceId;
      if (!workspaceId) return;

      // Try to find and update payment record
      // payment_intent doesn't have a session ID directly, so we search by payment intent ID
      // This is a fallback — most failures are caught at checkout level
      console.warn(`[stripe] Payment failed: workspace=${workspaceId} intent=${intent.id}`);

      addActivity(
        workspaceId,
        'payment_failed',
        'Payment failed — please retry or contact support',
        `Stripe PaymentIntent: ${intent.id}`,
        { stripePaymentIntentId: intent.id }
      );
      break;
    }

    default:
      // Unhandled event type — log but don't error
      console.log(`[stripe] Unhandled event type: ${event.type}`);
  }
}
