---
description: Implement Stripe payments for content deliverables — Phase 1 of monetization (Sprint 2, Item #4)
---

# Stripe Integration Workflow

## Prerequisites

0. **Security hardening is already in place** (Item #78, shipped):
   - Helmet with CSP whitelisting Stripe domains
   - HTTPS enforcement in production
   - Rate limiting: 60/min reads, 10/min writes, `checkoutLimiter` (5/min) pre-wired
   - Input sanitization helpers (`sanitizeString`, `validateEnum`) ready to use
   - Webhook raw body placeholder comment at correct mount point in `server/index.ts`
1. User must have a Stripe account and the following env vars ready:
```
STRIPE_SECRET_KEY=sk_test_...        # or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...      # from Stripe Dashboard → Webhooks
```
2. Install Stripe SDK:
// turbo
```bash
npm install stripe
```
3. Install Stripe types:
// turbo
```bash
npm install -D @types/stripe
```

---

## Step 1: Create `server/stripe.ts` — SDK Setup + Checkout Helpers

This module initializes Stripe and exports helpers for creating checkout sessions.

### Key Design Decisions
- Uses `stripe` Node SDK (not raw HTTP)
- Checkout Sessions (not Payment Intents) — hosted Stripe page, PCI-free
- Products defined as a config map (not hardcoded per-call)
- Prices stored as Stripe Price IDs in env vars (created in Stripe Dashboard first)
- Workspace ID passed as `metadata.workspaceId` on every session
- Content request ID passed as `metadata.contentRequestId` when applicable

### Product Config Map
```ts
export type ProductType =
  | 'brief_blog' | 'brief_landing' | 'brief_service' | 'brief_location'
  | 'brief_product' | 'brief_pillar' | 'brief_resource'
  | 'post_draft' | 'post_polished' | 'post_premium'
  | 'schema_page' | 'schema_site'
  | 'strategy' | 'strategy_refresh';

export interface ProductConfig {
  type: ProductType;
  stripePriceId: string;       // from env
  displayName: string;
  priceUsd: number;            // for inline display (canonical price lives in Stripe)
  category: 'brief' | 'content' | 'schema' | 'strategy';
}
```

### Functions to Export
- `createCheckoutSession(workspaceId, productType, metadata?)` → returns `{ sessionId, url }`
- `getProductConfig(productType)` → returns `ProductConfig`
- `listProducts()` → returns all configured products with prices
- `handleWebhook(rawBody, signature)` → parses + dispatches Stripe events

### Webhook Handler Events
- `checkout.session.completed` → call `recordPayment()` + update content request status if applicable
- `payment_intent.payment_failed` → flag in payment record, log activity

### Integration Points in Existing Code
- Import in `server/index.ts` alongside other module imports (line ~74)
- Mount webhook route BEFORE `express.json()` middleware (needs raw body)
- Mount checkout + payment routes after existing API routes

---

## Step 2: Create `server/payments.ts` — Payment Record Persistence

JSON-on-disk storage (consistent with rest of codebase — no database).

### Data Model
```ts
export interface PaymentRecord {
  id: string;                          // pay_<timestamp>_<rand>
  workspaceId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  productType: ProductType;
  amount: number;                      // cents
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  contentRequestId?: string;           // links to content-requests.ts
  metadata?: Record<string, string>;
  createdAt: string;
  paidAt?: string;
}
```

### Storage Location
- `getDataDir('payments')` → `~/.asset-dashboard/payments/` (dev) or `$DATA_DIR/payments/` (prod)
- One file per workspace: `<workspaceId>.json`
- Same pattern as `server/content-requests.ts`

### Functions to Export
- `createPayment(workspaceId, data)` → `PaymentRecord`
- `updatePayment(workspaceId, id, updates)` → `PaymentRecord | null`
- `getPayment(workspaceId, id)` → `PaymentRecord | undefined`
- `listPayments(workspaceId)` → `PaymentRecord[]`
- `getPaymentBySession(workspaceId, stripeSessionId)` → for webhook lookups

---

## Step 3: Mount Routes in `server/index.ts`

### New Endpoints (4 routes)

```
POST  /api/stripe/create-checkout     — Create Stripe Checkout session
POST  /api/stripe/webhook             — Stripe webhook (raw body, signature verification)
GET   /api/stripe/payments/:wsId      — Admin: list payments for workspace
GET   /api/public/stripe/status/:id   — Client: check payment status after redirect
```

### Critical: Webhook Raw Body

The Stripe webhook route MUST receive the raw request body (not JSON-parsed).
Mount it BEFORE `express.json()` middleware:

```ts
// In server/index.ts, BEFORE app.use(express.json()):
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // ... signature verification + handleWebhook()
});
```

Current middleware setup is at the top of index.ts. The `express.json()` call needs to be found and the webhook route mounted before it.

### Checkout Flow (Client-Side → Server → Stripe → Back)

```
1. Client clicks "Request Brief — $125" in Content Pipeline
2. Frontend POST /api/stripe/create-checkout { workspaceId, productType, contentRequestId? }
3. Server creates Stripe Checkout Session with:
   - price: from product config
   - success_url: /dashboard/{wsId}?tab=content&payment=success
   - cancel_url: /dashboard/{wsId}?tab=content&payment=cancelled
   - metadata: { workspaceId, productType, contentRequestId }
4. Server returns { url } → frontend redirects to Stripe
5. Client pays on Stripe's hosted page
6. Stripe sends webhook → server records payment, updates content request
7. Client redirected to success_url → sees confirmation toast
```

---

## Step 4: Wire Into Content Pipeline (Frontend)

### Files to Modify

**`src/components/ClientDashboard.tsx`**

The existing `confirmPricingAndSubmit()` function (line ~448) currently submits content requests directly. This needs to be modified:

1. **Before Stripe**: `confirmPricingAndSubmit()` → POST to content request API → done
2. **After Stripe**: `confirmPricingAndSubmit()` → POST to `/api/stripe/create-checkout` → redirect to Stripe → webhook creates request on payment

### Specific Changes in `confirmPricingAndSubmit()`

```
Current flow (line 448-494):
  pricingModal.source === 'upgrade'  → upgradeToFullPost()
  pricingModal.source === 'strategy' → POST /api/public/content-request/:wsId
  pricingModal.source === 'client'   → POST /api/public/content-request/:wsId/submit

New flow:
  ALL sources → POST /api/stripe/create-checkout → window.location.href = session.url
  Webhook handles content request creation after payment confirmed
```

### Payment Success Detection

On dashboard load, check URL params for `?payment=success`:
- Show success toast
- Refresh content requests list
- Clear the payment param from URL

### Existing Pricing Modal State (line 146-156)

```ts
const [pricingModal, setPricingModal] = useState<{
  serviceType: 'brief_only' | 'full_post';
  topic: string;
  targetKeyword: string;
  intent?: string;
  priority?: string;
  rationale?: string;
  notes?: string;
  source: 'strategy' | 'client' | 'upgrade';
  upgradeReqId?: string;
} | null>(null);
```

This already has all the data needed for checkout. Just add `productType` mapping.

---

## Step 5: Wire Into Strategy Tab

The Strategy tab has "Request This Topic" buttons on content gap cards.
These already trigger `setPricingModal()` with source='strategy'.
The pricing modal → `confirmPricingAndSubmit()` flow handles it.

No additional strategy tab changes needed — the pricing modal is the single funnel.

---

## Step 6: Wire Webhook → Content Request Creation

When `checkout.session.completed` fires:

1. Extract `metadata.workspaceId`, `metadata.productType`, `metadata.contentRequestId`
2. Call `recordPayment()` in `payments.ts`
3. If `contentRequestId` exists → `updateContentRequest(wsId, reqId, { status: 'requested' })`
4. If no `contentRequestId` (new request from checkout metadata) → `createContentRequest()` with topic/keyword from session metadata
5. `addActivity(wsId, 'payment_received', ...)` — log the payment

---

## Step 7: Admin Payment Visibility

### Workspace Settings (existing)
The `contentPricing` field on Workspace (line 104-113 in workspaces.ts) already exists:
```ts
contentPricing?: {
  briefPrice: number;
  fullPostPrice: number;
  currency: string;
  ...
};
```

This is already used by the frontend to show prices on upgrade CTAs.
Wire Stripe Price IDs to match these display prices.

### Admin Dashboard
Add a "Payments" section to the workspace home dashboard showing recent payment activity.
This can be a future enhancement — not blocking for Phase 1.

---

## File Reference: Key Integration Points

| File | What to Touch | Why |
|------|--------------|-----|
| `server/stripe.ts` | **CREATE** | Stripe SDK, checkout sessions, webhook handler |
| `server/payments.ts` | **CREATE** | Payment record CRUD (JSON on disk) |
| `server/index.ts` | **EDIT** lines ~74 (imports), before express.json() (webhook), after line ~5960 (routes) | Mount 4 new routes |
| `server/workspaces.ts` | **EDIT** line 78-116 | Add `tier`, `trialEndsAt`, `stripeCustomerId` to Workspace interface + updateWorkspace whitelist |
| `server/activity-log.ts` | **EDIT** | Add `payment_received`, `payment_failed` to ActivityType |
| `src/components/ClientDashboard.tsx` | **EDIT** lines ~448-494 | Redirect pricing modal to Stripe checkout |
| `src/components/client/types.ts` | **EDIT** line 12 | Add `tier`, `stripeCustomerId` to WorkspaceInfo |
| `package.json` | **EDIT** | Add `stripe` dependency |
| `.env` | **EDIT** | Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |

---

## Execution Order

```
1. npm install stripe @types/stripe
2. Create server/payments.ts (standalone, no dependencies)
3. Create server/stripe.ts (depends on payments.ts)
4. Add Stripe env vars to .env
5. Mount webhook route in server/index.ts (BEFORE express.json)
6. Mount checkout + payment routes in server/index.ts
7. Add tier + stripeCustomerId to Workspace interface
8. Update ClientDashboard.tsx confirmPricingAndSubmit() → Stripe redirect
9. Add payment success detection on dashboard load
10. Test: brief purchase → Stripe → webhook → payment recorded
```

---

## Testing Checklist

- [ ] Stripe test mode keys configured
- [ ] `POST /api/stripe/create-checkout` returns valid session URL
- [ ] Redirect to Stripe Checkout works
- [ ] Webhook receives `checkout.session.completed`
- [ ] Payment record created in `~/.asset-dashboard/payments/`
- [ ] Content request status updated after payment
- [ ] Activity log shows payment event
- [ ] Success redirect shows toast in dashboard
- [ ] Cancel redirect returns to content tab cleanly
- [ ] Admin can view payment history via API

---

## Existing Patterns to Follow

- **Storage**: JSON on disk via `getDataDir()` — see `server/content-requests.ts` for pattern
- **IDs**: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` — see content-requests.ts line 95
- **Activity logging**: `addActivity(wsId, type, title, detail, meta)` — see index.ts line 4256
- **WebSocket broadcast**: `broadcast('payment:received', { workspaceId, ... })` — see index.ts line 437
- **Error handling**: try/catch with `err instanceof Error ? err.message : 'Unknown error'` — see index.ts line 4436
- **Imports**: ESM with `.js` extensions — see all server imports

---

*Created: March 7, 2026*
*Sprint 2, Item #4: Stripe integration — content payments*
*Reference: MONETIZATION.md § Stripe Integration Spec*
