import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Default stub data
// ---------------------------------------------------------------------------

const DEFAULT_SESSION_ID = 'cs_test_abc123';
const DEFAULT_SESSION_URL = 'https://checkout.stripe.com/test_session';
const DEFAULT_PAYMENT_INTENT = 'pi_test_xyz789';
const DEFAULT_SUBSCRIPTION_ID = 'sub_test_def456';
const DEFAULT_PORTAL_URL = 'https://billing.stripe.com/test_portal';
const DEFAULT_CUSTOMER_ID = 'cus_test_ghi012';
const DEFAULT_CLIENT_SECRET = 'pi_test_xyz789_secret_abc';

// ---------------------------------------------------------------------------
// Mock Stripe SDK method stubs
// ---------------------------------------------------------------------------

export const mockCheckoutSessionsCreate = vi.fn();
export const mockBillingPortalSessionsCreate = vi.fn();
export const mockSubscriptionsUpdate = vi.fn();
export const mockCustomersCreate = vi.fn();
export const mockCustomersRetrieve = vi.fn();
export const mockPaymentIntentsCreate = vi.fn();
export const mockWebhooksConstructEvent = vi.fn();

/**
 * A mock Stripe instance with the same nested structure as the real SDK.
 * Each leaf method is a `vi.fn()` that can be configured per-test.
 */
export const mockStripeInstance = {
  checkout: {
    sessions: { create: mockCheckoutSessionsCreate },
  },
  billingPortal: {
    sessions: { create: mockBillingPortalSessionsCreate },
  },
  subscriptions: { update: mockSubscriptionsUpdate },
  customers: {
    create: mockCustomersCreate,
    retrieve: mockCustomersRetrieve,
  },
  paymentIntents: { create: mockPaymentIntentsCreate },
  webhooks: { constructEvent: mockWebhooksConstructEvent },
};

// ---------------------------------------------------------------------------
// Configuration helpers — call these in individual tests
// ---------------------------------------------------------------------------

/** Configure `stripe.checkout.sessions.create()` to resolve with session data. */
export function mockCheckoutSession(
  sessionData?: Partial<{ id: string; url: string; payment_intent: string }>,
): void {
  const data = {
    id: sessionData?.id ?? DEFAULT_SESSION_ID,
    url: sessionData?.url ?? DEFAULT_SESSION_URL,
    payment_intent: sessionData?.payment_intent ?? DEFAULT_PAYMENT_INTENT,
  };
  mockCheckoutSessionsCreate.mockResolvedValue(data);
}

/** Configure `stripe.checkout.sessions.create()` to reject with an error. */
export function mockCheckoutSessionError(errorMessage: string): void {
  mockCheckoutSessionsCreate.mockRejectedValue(new Error(errorMessage));
}

/** Configure `stripe.subscriptions.update()` to resolve with subscription data. */
export function mockSubscriptionUpdate(
  subscriptionData?: Partial<{ id: string; status: string }>,
): void {
  const data = {
    id: subscriptionData?.id ?? DEFAULT_SUBSCRIPTION_ID,
    status: subscriptionData?.status ?? 'active',
  };
  mockSubscriptionsUpdate.mockResolvedValue(data);
}

/** Configure `stripe.billingPortal.sessions.create()` to resolve with a portal URL. */
export function mockBillingPortalSession(url?: string): void {
  mockBillingPortalSessionsCreate.mockResolvedValue({
    url: url ?? DEFAULT_PORTAL_URL,
  });
}

/** Configure `stripe.customers.create()` with sensible defaults. */
export function mockCustomerCreate(
  customerData?: Partial<{ id: string; name: string }>,
): void {
  mockCustomersCreate.mockResolvedValue({
    id: customerData?.id ?? DEFAULT_CUSTOMER_ID,
    name: customerData?.name ?? 'Test Customer',
  });
}

/** Configure `stripe.customers.retrieve()` to resolve (customer exists). */
export function mockCustomerRetrieve(
  customerData?: Partial<{ id: string; name: string }>,
): void {
  mockCustomersRetrieve.mockResolvedValue({
    id: customerData?.id ?? DEFAULT_CUSTOMER_ID,
    name: customerData?.name ?? 'Test Customer',
  });
}

/** Configure `stripe.customers.retrieve()` to reject (customer deleted). */
export function mockCustomerRetrieveNotFound(): void {
  mockCustomersRetrieve.mockRejectedValue(new Error('No such customer'));
}

/** Configure `stripe.paymentIntents.create()` with sensible defaults. */
export function mockPaymentIntentCreate(
  intentData?: Partial<{ id: string; client_secret: string; amount: number }>,
): void {
  mockPaymentIntentsCreate.mockResolvedValue({
    id: intentData?.id ?? DEFAULT_PAYMENT_INTENT,
    client_secret: intentData?.client_secret ?? DEFAULT_CLIENT_SECRET,
    amount: intentData?.amount ?? 12500,
  });
}

// ---------------------------------------------------------------------------
// Webhook event helpers
// ---------------------------------------------------------------------------

let _webhookEventCounter = 0;

/** Create a Stripe webhook event object matching the `Stripe.Event` shape. */
export function createWebhookEvent(
  type: string,
  data: Record<string, unknown>,
): { id: string; type: string; data: { object: Record<string, unknown> } } {
  _webhookEventCounter++;
  return {
    id: `evt_test_${_webhookEventCounter}`,
    type,
    data: { object: data },
  };
}

/**
 * Return a duplicate of the given webhook event (same `id`).
 * Useful for testing idempotency — the handler should detect the repeated ID
 * and skip re-processing.
 */
export function createDuplicateWebhookEvent<
  T extends ReturnType<typeof createWebhookEvent>,
>(event: T): T {
  return { ...event, data: { ...event.data } };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

/** Reset every mock to its initial state. Call in `beforeEach` or `afterEach`. */
export function resetStripeMocks(): void {
  mockCheckoutSessionsCreate.mockReset();
  mockBillingPortalSessionsCreate.mockReset();
  mockSubscriptionsUpdate.mockReset();
  mockCustomersCreate.mockReset();
  mockCustomersRetrieve.mockReset();
  mockPaymentIntentsCreate.mockReset();
  mockWebhooksConstructEvent.mockReset();
  _webhookEventCounter = 0;
}

/**
 * Mock the `stripe` module so that `new Stripe(...)` returns `mockStripeInstance`.
 *
 * Call this at the **top level** of your test file (outside `describe`/`it`)
 * or inside `beforeAll`. Vitest hoists `vi.mock` calls automatically.
 *
 * Example:
 * ```ts
 * import { setupStripeMocks, mockCheckoutSession, resetStripeMocks } from '../mocks/stripe.js';
 *
 * setupStripeMocks();
 *
 * beforeEach(() => resetStripeMocks());
 *
 * it('creates a checkout session', async () => {
 *   mockCheckoutSession({ id: 'cs_custom' });
 *   // ... call the code under test ...
 * });
 * ```
 */
export function setupStripeMocks(): void {
  vi.mock('stripe', () => {
    // Must use a class (not arrow fn) so `new Stripe(...)` works as a constructor.
    class StripeMock {
      checkout = mockStripeInstance.checkout;
      billingPortal = mockStripeInstance.billingPortal;
      subscriptions = mockStripeInstance.subscriptions;
      customers = mockStripeInstance.customers;
      paymentIntents = mockStripeInstance.paymentIntents;
      webhooks = mockStripeInstance.webhooks;
    }
    return { default: StripeMock, Stripe: StripeMock };
  });
}
