---
description: Stripe payments for content deliverables — SHIPPED. Reference for architecture, admin setup, and future extensions.
---

# Stripe Integration Workflow

> **Status: ✅ SHIPPED** — Item #4 (Stripe integration) + admin settings UI. All code in place, zero env vars required.

## Setup (Admin — no code needed)

1. Open **Command Center** (click logo / deselect workspace)
2. Scroll to **Payments** section
3. Paste `sk_test_...` or `sk_live_...` key → **Save Keys**
4. Expand **Product Price IDs** → paste `price_...` IDs from Stripe Dashboard for each product
5. In Stripe Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://your-domain.com/api/stripe/webhook`
   - Events: `checkout.session.completed`, `payment_intent.payment_failed`
   - Copy `whsec_...` → paste in Webhook Secret field → **Save Keys**
6. Platform connections panel shows Stripe ✓ green

### Alternative: Env Vars (CI/Docker)
Env vars still work as fallback — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`. On-disk config (admin UI) takes precedence.

## Architecture (shipped)

### Prerequisites (already in place)
- **Security hardening** (Item #78): Helmet CSP whitelists Stripe domains, HTTPS enforcement, rate limiting (5/min checkout), input sanitization
- **Stripe SDK**: `stripe` v20.4.1 installed

---

### Server Modules

| File | Purpose |
|------|---------|
| `server/stripe-config.ts` | Encrypted on-disk persistence (AES-256-GCM) for Stripe keys + product Price IDs. `getStripeSecretKey()` / `getStripeWebhookSecret()` / `getStripePriceId()` — env vars as fallback. |
| `server/stripe.ts` | Lazy-init SDK (re-creates when keys change), 14-product PRODUCT_MAP, `createCheckoutSession()`, `constructWebhookEvent()`, `handleWebhookEvent()` |
| `server/payments.ts` | `PaymentRecord` CRUD — JSON on disk per workspace. `createPayment`, `updatePayment`, `getPayment`, `listPayments`, `getPaymentBySession` |

### Key Design Decisions
- **Lazy SDK init**: `getStripe()` checks config on each call, re-creates Stripe instance if key changes (supports saving keys via admin UI without restart)
- Checkout Sessions (not Payment Intents) — hosted Stripe page, PCI-free
- Products defined as a config map (not hardcoded per-call)
- Prices from admin UI config → env var fallback → empty (product disabled)
- Workspace ID + content request ID passed as `metadata` on every session

### Product Types (14)
```
brief_blog, brief_landing, brief_service, brief_location,
brief_product, brief_pillar, brief_resource,
post_draft, post_polished, post_premium,
schema_page, schema_site,
strategy, strategy_refresh
```

### Webhook Events Handled
- `checkout.session.completed` → marks payment paid, updates content request, logs activity
- `payment_intent.payment_failed` → logs failure activity

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/stripe/webhook` | POST | Raw body, mounted before `express.json()`. Signature verification. |
| `/api/stripe/create-checkout` | POST | Creates Checkout session. Rate limited (5/min). |
| `/api/stripe/payments/:wsId` | GET | Admin: list payments for workspace |
| `/api/stripe/payments/:wsId/:paymentId` | GET | Admin: single payment detail |
| `/api/public/stripe/status/:wsId/:sessionId` | GET | Client: check payment status after redirect |
| `/api/stripe/products` | GET | List all configured products with prices |
| `/api/stripe/config` | GET | Admin: masked config status |
| `/api/stripe/config/keys` | POST | Admin: save encrypted keys |
| `/api/stripe/config/products` | POST | Admin: save product Price ID mappings |
| `/api/stripe/config` | DELETE | Admin: clear all Stripe config |

### Frontend Components

| File | What |
|------|---------|
| `src/components/StripeSettings.tsx` | Admin settings in Command Center: masked key inputs, product Price ID mapping grid, enable/disable products, connection status, setup guide |
| `src/components/ClientDashboard.tsx` | `confirmPricingAndSubmit()` → Stripe Checkout redirect when enabled. Payment success/cancel detection via URL params + toast. |
| `src/components/WorkspaceOverview.tsx` | Stripe in Platform connections panel + `<StripeSettings />` section |

### Checkout Flow

```
1. Client clicks "Request Brief — $125" in Content Pipeline
2. Frontend POST /api/stripe/create-checkout { workspaceId, productType, contentRequestId }
3. Server creates Stripe Checkout Session (price from config, workspace metadata)
4. Server returns { url } → frontend redirects to Stripe
5. Client pays on Stripe's hosted page
6. Stripe sends webhook → server records payment, updates content request
7. Client redirected to success_url → sees confirmation toast
```

### Config Persistence

Stripe config stored encrypted on disk at `~/.asset-dashboard/config/stripe.json`:
- **Keys**: AES-256-GCM encrypted using key derived from `APP_PASSWORD` or `STRIPE_CONFIG_KEY` env
- **Products**: Array of `{ productType, stripePriceId, displayName, priceUsd, enabled }`
- Env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`) still work as fallback for CI/Docker
- `getStripeSecretKey()` checks env first, then on-disk config
- `getStripePriceId(type, envKey)` checks on-disk config first, then env var

### Workspace Fields (added to interface)
- `tier`: `'free' | 'growth' | 'premium'`
- `trialEndsAt`: ISO date string
- `stripeCustomerId`: Stripe customer ID

---

## File Reference

| File | Status | What |
|------|--------|------|
| `server/stripe-config.ts` | ✅ Created | Encrypted config persistence, AES-256-GCM |
| `server/stripe.ts` | ✅ Created | Lazy SDK init, 14 products, checkout, webhooks |
| `server/payments.ts` | ✅ Created | Payment record CRUD (JSON on disk) |
| `server/index.ts` | ✅ Edited | Webhook before `express.json()`, 10 routes, health check |
| `server/workspaces.ts` | ✅ Edited | `tier`, `trialEndsAt`, `stripeCustomerId` fields |
| `server/activity-log.ts` | ✅ Edited | `payment_received`, `payment_failed` types |
| `src/components/StripeSettings.tsx` | ✅ Created | Admin settings UI in Command Center |
| `src/components/ClientDashboard.tsx` | ✅ Edited | Checkout redirect + success/cancel detection |
| `src/components/WorkspaceOverview.tsx` | ✅ Edited | Platform connections + StripeSettings section |
| `src/components/client/types.ts` | ✅ Edited | `tier` + `stripeEnabled` on WorkspaceInfo |
| `.env.example` | ✅ Edited | Stripe env vars documented (optional) |

---

## Testing Checklist

- [ ] Save keys via Command Center → Payments → connection shows green
- [ ] `POST /api/stripe/create-checkout` returns valid session URL
- [ ] Redirect to Stripe Checkout works (use test card 4242 4242 4242 4242)
- [ ] Webhook receives `checkout.session.completed`
- [ ] Payment record created in `~/.asset-dashboard/payments/`
- [ ] Content request status updated after payment
- [ ] Activity log shows payment event
- [ ] Success redirect shows toast in client dashboard
- [ ] Cancel redirect returns to content tab cleanly
- [ ] Admin can view payment history via API
- [ ] Products can be enabled/disabled individually in admin UI

---

## Future Extensions

- **Per-workspace pricing overrides**: `contentPricing` field on Workspace already exists
- **Subscription billing**: Stripe subscription mode for tier-based access
- **Credits system**: Prepaid credit packs (MONETIZATION.md Sprint 5, Item #76)
- **Payment history UI**: Admin dashboard showing recent payments per workspace

---

*Created: March 7, 2026*
*Shipped: March 7, 2026*
*Sprint 2, Item #4: Stripe integration — content payments + admin settings*
*Reference: MONETIZATION.md § Stripe Integration Spec*
