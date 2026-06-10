# E3 — Passwordless Portal Closure (absorbed old-run 3b)

**Branch:** `claude/core-e3-passwordless-closure`  
**Base:** `origin/staging` (includes E1 #1168, E2 #1174, and preceding merges through #1175)  
**Lane:** E (Client portal), after E2  
**Model:** Sonnet (orchestration); plan doc authored 2026-06-10  
**Reviewer gate:** `superpowers:requesting-code-review` before push  

---

## Problem statement (owner decision 2026-06-09: "closed until configured")

`requireClientPortalAuth` in `server/middleware.ts:219-220` currently contains:

```ts
// Passwordless workspaces are accessible by URL (the workspace ID is the credential)
if (!ws.clientPassword) return next();
```

This means any workspace without a `client_password` row is accessible by URL alone — the workspace ID *is* the credential. The owner decision is to flip this default: portals are **closed until configured**. A workspace without a client credential returns 401 on all `requireClientPortalAuth` endpoints.

`requireAuthenticatedClientPortalAuth` and `requireClientStrategyMutationAuth` already block passwordless workspaces (verified: `middleware.ts:231-253`, `public-portal.ts`) — no change needed there.

---

## Scope (one file per ownership boundary)

### 1. server/middleware.ts — remove the passwordless pass-through (the flip)

Delete lines `219-220`:
```ts
// Passwordless workspaces are accessible by URL (the workspace ID is the credential)
if (!ws.clientPassword) return next();
```

**After the flip:** passwordless workspace + no credential → `requireClientPortalAuth` reaches the `return res.status(401)` fallthrough. Admin HMAC pass-through (`middleware.ts:208-210`) and client JWT checks remain unchanged — admins continue to preview all portals.

### 2. tests/integration/helpers.ts — make autoPublicAuth the default for ephemeral contexts

Change `createEphemeralTestContext` to default `autoPublicAuth` to `true`. This means ALL ~275 ephemeral-context integration tests automatically get admin HMAC injected on `/api/public/` calls. No per-file changes needed for the common case.

Implementation: pass `autoPublicAuth: options?.autoPublicAuth ?? true` to `createTestContext` inside `createEphemeralTestContext`.

### 3. tests/integration — createTestContext callers hitting /api/public/ without autoPublicAuth

Files using `createTestContext(port)` directly (not ephemeral) that call `/api/public/` need `{ autoPublicAuth: true }` added to their `createTestContext` call. Inventory (grep-verified 2026-06-10):

**Fixture-prefixed files (16):**
- `fixture-client-intelligence-routes.test.ts`
- `fixture-content-decay-read-routes.test.ts`
- `fixture-demo-scenario-public-workspace.test.ts`
- `fixture-public-analytics-data-routes.test.ts`
- `fixture-public-analytics-edge-routes.test.ts`
- `fixture-public-approvals-routes.test.ts`
- `fixture-public-auth-routes.test.ts`
- `fixture-public-business-priorities-auth.test.ts`
- `fixture-public-chat-routes.test.ts`
- `fixture-public-chat-usage-edge-routes.test.ts`
- `fixture-public-insights-routes.test.ts`
- `fixture-public-requests-routes.test.ts`
- `fixture-public-tier-route.test.ts`
- `fixture-rank-tracking-edge-routes.test.ts`
- `fixture-reports-routes.test.ts`
- `fixture-work-orders-edge-routes.test.ts`

**Non-fixture files (72):**
activity, annotations-read-routes, annotations-routes, anomalies-routes, approvals-routes, billing-tier-downgrade, briefing-client-preview, briefing-public, business-profile-patch, client-auth, client-intelligence-endpoint, client-intelligence-routes, client-strategy, content-decay-read-routes, content-decay-routes, content-freshness, cross-workspace-isolation, e2e-approval-flow, e2e-client-auth-flow, e2e-content-flow, e2e-workspace-reports, feature-toggle-site-intelligence, feedback-retirement, insights-routes, keyword-strategy-admin-assembler, keyword-strategy-assembler-public-read, misc-endpoints, misc-public-routes, outcomes-client-routes, outcomes-routes-extended, public-analytics-data-routes, public-analytics-extended, public-analytics, public-auth-routes, public-business-priorities-routes, public-chat-routes, public-chat-usage-routes, public-client-me-logout, public-client-serialization-matrix, public-copy-review-routes, public-jobs-routes, public-onboarding-routes, public-portal-audit-copy, public-portal-audit-read, public-portal-feedback-read, public-portal-routes-extended, public-portal-routes, public-portal-workspace-read, public-pricing-routes, public-requests-routes, rank-tracking-read-routes, rank-tracking-routes, rate-limiting, recommendations-lifecycle, recommendations-public-get-cost-auth, reports-routes, requests-routes, sales-reports-read-routes, schema-plan-public-routes, seo-genquality-p2-backfilled-public-read, seo-genquality-p5-orphan-recs, seo-genquality-p7-1-local-recs, site-keyword-metrics-public-read, site-keyword-metrics-strip, tier-gate-enforcement, tracked-keywords-resolver-read, tracked-keywords-strip-table-only, wave2b-route-contracts, webflow-schema-routes-extended, work-orders-read-routes, work-orders-routes

**Special file — NOT given autoPublicAuth:**
- `public-endpoint-auth.test.ts` — deliberately tests raw unauthenticated calls; has `x-no-auto-public-auth` guards; see §4

**Total files needing `autoPublicAuth: true` added:** 88 (16 fixture + 72 non-fixture).

### 4. tests/integration/public-endpoint-auth.test.ts — flip "soft-gated passwordless passes through"

This file explicitly tests that `requireClientPortalAuth` lets passwordless workspaces through. After our flip, that assertion reverses. The describe block:

```
describe('Soft-gated endpoint auth — passwordless workspace passes through', ...)
  // Currently expects status ≠ 401
  // After flip: expects status === 401
```

Change: flip the assertion from `expect(res.status).not.toBe(401)` to `expect(res.status).toBe(401)`. Update the describe block label and `it` label/comment accordingly.

Do NOT add `autoPublicAuth: true` here — the file deliberately tests raw unauthenticated calls.

### 5. tests/integration/public-portal-get-auth.test.ts — flip case (d): E1 pin

Case (d) currently pins: `passwordless workspace + no credential → 200 (preserved)`.

After E3: flip to `→ 401`. Update the describe label, the `it` label, and the assertion.

### 6. tests/integration/public-portal-export-matrices.test.ts — flip case (e): E2 pin

Case (e) currently pins: `passwordless workspace + no credential → 200 (preserved)`.

After E3: flip to `→ 401`. Update the `it` label and assertion.

---

## Integration test matrix (new assertions)

| Scenario | After E3 |
|----------|----------|
| Passwordless workspace + no credential, `requireClientPortalAuth` | **401** (flipped from 200) |
| Passwordless workspace + no credential, `requireAuthenticatedClientPortalAuth` | 401 (unchanged) |
| Password-configured workspace + no credential | 401 (unchanged) |
| Admin HMAC token, any workspace | 200 (unchanged) |
| Valid client JWT for the workspace | 200 (unchanged) |
| Client JWT cross-workspace | 401 (unchanged) |

---

## Affected-file count (grep-verified 2026-06-10)

| Category | Count |
|----------|-------|
| Middleware flip | 1 (server/middleware.ts) |
| Helper default | 1 (tests/integration/helpers.ts) |
| createTestContext callers needing autoPublicAuth | 88 |
| Pinned-assertion flips (E1, E2) | 2 |
| Behavioral assertion flip (public-endpoint-auth) | 1 |
| **Total files touched** | **~93** |

---

## Seed / local dev

`seed:demo` already sets `clientPassword: DEMO_PASSWORD` (`'demo-client'`) on all demo workspaces. No change needed. `npm run seed:demo && npm run smoke:core` green confirmed at plan time (smoke tests don't hit `/api/public/`).

The `seedWorkspace()` fixture already defaults `clientPassword: 'test-password'` — this default is now load-bearing for all integration tests that don't explicitly pass `clientPassword: ''`. Clarifying comment added to `tests/fixtures/workspace-seed.ts`.

---

## Verification commands

```bash
npm run typecheck
npx vite build
npx vitest run tests/integration/public-portal-get-auth.test.ts
npx vitest run tests/integration/public-portal-export-matrices.test.ts
npx vitest run tests/integration/public-endpoint-auth.test.ts
npx vitest run    # full suite
npm run pr-check
```

---

## PR body key points

- `server/middleware.ts`: removed the `if (!ws.clientPassword) return next()` pass-through from `requireClientPortalAuth` — portals are now closed until configured
- `tests/integration/helpers.ts`: `createEphemeralTestContext` now defaults `autoPublicAuth: true` (injects admin HMAC on `/api/public/` calls), covering ~275 ephemeral-context tests transparently
- 88 `createTestContext` callers manually updated with `{ autoPublicAuth: true }`
- E1 assertion (d) and E2 assertion (e) **deliberately flipped** from 200 → 401 (they pinned the old passwordless-open behavior; E3 is the intended flip)
- `public-endpoint-auth.test.ts` "Soft-gated passwordless passes through" block flipped from `not.toBe(401)` → `toBe(401)`

---

## Ownership note

OWNS: `server/middleware.ts`, `tests/integration/*` (harness + affected files), `tests/fixtures/workspace-seed.ts` (comment only), `scripts/seed-demo*` (no change needed).  
DOES NOT MODIFY: `server/routes/public-portal.ts`, `server/app.ts`.
