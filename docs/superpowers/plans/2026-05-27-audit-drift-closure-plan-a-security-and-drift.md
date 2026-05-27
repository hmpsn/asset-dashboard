# Audit Drift Closure — Plan A: Security + Admin/Client Drift

> Source: Audit artifact [2026-05-27-audit-drift-closure.md](../audits/2026-05-27-audit-drift-closure.md) (four parallel Explore agents + verification pass)
> Sprint: `sprint-platform-health-wave8-audit-drift-closure`
> Platform: Claude/Anthropic
> Scope: P0 security + P1 admin/client drift + P2 parity tail. Ships as **one PR per item**, in the order below. Plan B and Plan C are independent and may run in parallel after Task 1 lands.

## Overview

Close the user-visible drift findings from the 2026-05-27 audit: two unauthenticated public endpoints, two conceptual fields (`isTrial`, workspace serialization) where admin and client compute different answers from the same row, a briefing payload admins cannot preview, and a P2 cluster of smaller parity bugs (insight shape, opportunity-score fallback, pending-approvals count, audit suppressions, brand-voice authority on onboarding writes).

## Pre-requisites

- [x] Audit findings committed (this plan)
- [x] Roadmap items added under `sprint-platform-health-wave8-audit-drift-closure`
- [ ] Branch: `audit-drift-closure-plan-a` cut from latest `staging`

## Bounded Context Ownership

| Concern | Owner | Secondary |
|---|---|---|
| Public auth middleware | `server/middleware/auth.ts` + `server/routes/rank-tracking.ts` + `server/routes/public-portal.ts` | None |
| Trial state | `server/billing/` (new `trial-state.ts`) | `server/routes/workspaces.ts`, `server/serializers/client-safe.ts` |
| Admin workspace view | `server/serializers/` + `shared/types/workspace.ts` | `server/routes/workspaces.ts` |
| Briefing projection | `server/briefing-client-projection.ts` (new) | `server/routes/briefing.ts`, `server/routes/public-portal.ts` |
| Insights/keyword/audit parity | `server/intelligence/` slices + `server/routes/public-*.ts` | Admin route counterparts |

Refer to [platform-organization.md](../../rules/platform-organization.md) for bounded-context conventions and [platform-integration-surfaces.md](../../rules/platform-integration-surfaces.md) for the auth, public-endpoint, and event surface mappings.

---

## Task List

### Task 1 — Public endpoint auth hardening (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/routes/rank-tracking.ts` (public handlers at lines 125, 133)
- `server/routes/public-portal.ts` (audit-traffic handler at line 310)
- `server/routes/anomalies.ts` (public GET at line 27; admin mutations at lines 34, 43)
- `tests/integration/public-endpoint-auth.test.ts` (new)
- `scripts/pr-check.ts` (add rule)
- `docs/rules/automated-rules.md` (regenerated via `npm run rules:generate`)

**Must not touch:** Admin route counterparts, slices, or any frontend file.

**Steps:**
1. Add `requireClientPortalAuth('workspaceId')` middleware to:
   - `GET /api/public/rank-tracking/:workspaceId/history` at `server/routes/rank-tracking.ts:125`
   - `GET /api/public/rank-tracking/:workspaceId/latest` at `server/routes/rank-tracking.ts:133`
   - `GET /api/public/audit-traffic/:workspaceId` at `server/routes/public-portal.ts:310`
   - `GET /api/public/anomalies/:workspaceId` at `server/routes/anomalies.ts:27` *(added during verification — also unauthenticated)*
2. Add **admin-scope auth** to `POST /api/anomalies/:anomalyId/dismiss` (line 34) and `POST /api/anomalies/:anomalyId/acknowledge` (line 43). These have no workspace guard at all. Either: (a) refactor to take `:workspaceId/:anomalyId` and add `requireWorkspaceAccess('workspaceId')`, or (b) load the anomaly inside the handler, derive its workspaceId, and call a manual `assertWorkspaceAccess(req, workspaceId)` helper. Option (a) is preferred — it's a route-shape break but only admin callers use it; grep the frontend for both URLs and update call sites in the same PR.
3. Integration test (port 13871): assert `401` when no portal JWT is presented to the four public endpoints, `200` with valid JWT, `403` with a JWT scoped to a different workspace. For the two admin mutations: assert `401` without `x-auth-token` (global gate), `403` when accessing an anomaly belonging to a workspace outside the admin's `WORKSPACE_ID_FILTER`. Use `seedWorkspace().cleanup()`.
4. Add pr-check rule: any handler mounted under `/api/public/` must have one of `requireClientPortalAuth`, `requireWorkspaceAccess`, or an inline `// public-no-auth-ok: <reason>` hatch. See [pr-check-rule-authoring.md](../../rules/pr-check-rule-authoring.md).
5. Run `npm run rules:generate` to refresh the generated rule doc.

**Verification:**
```
npx vitest run tests/integration/public-endpoint-auth.test.ts
npx tsx scripts/pr-check.ts
curl -i https://staging.../api/public/rank-tracking/<wsId>          # expect 401
curl -i -H "Authorization: Bearer <jwt>" ...                         # expect 200
```

---

### Task 2 — Canonical trial-state helper (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/billing/trial-state.ts` (new)
- `server/routes/workspaces.ts` (lines 182-183)
- `server/serializers/client-safe.ts` (lines 75-78)
- `tests/contract/trial-state-parity.test.ts` (new)

**Must not touch:** Any frontend file.

**Steps:**
1. Create `server/billing/trial-state.ts` exporting `computeTrialState(ws: WorkspaceRow): { isTrial: boolean; trialDaysRemaining: number | null }`. Internally route through existing `computeEffectiveTier()`. The function is the **single source of truth**; both call sites consume its output verbatim.
2. Replace inline computation at `workspaces.ts:182-183` with one call.
3. Replace inline computation at `client-safe.ts:75-78` with one call.
4. Contract test: feed 8 fixture workspace rows covering the cross-product of `{baseTier: free/growth/premium} × {trialEndsAt: past/future/null}`. Assert admin response field-by-field matches client response for `isTrial` and `trialDaysRemaining`.
5. Add pr-check rule flagging any new `trialEnd > new Date()` or `trialEndsAt ?` patterns outside `server/billing/trial-state.ts`.

**Verification:**
```
npx vitest run tests/contract/trial-state-parity.test.ts
npx tsx scripts/pr-check.ts
```

---

### Task 3 — AdminWorkspaceView serializer (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `shared/types/workspace.ts` (extend with `AdminWorkspaceView`)
- `server/serializers/admin-workspace-view.ts` (new)
- `server/routes/workspaces.ts` (`GET /:id` handler near line 94)
- `tests/contract/admin-workspace-view.test.ts` (new)

**Must not touch:** `server/serializers/client-safe.ts`.

**Steps:**
1. Define `AdminWorkspaceView` in `shared/types/workspace.ts` as an explicit allow-list interface mirroring the structure of `PublicWorkspaceView` plus admin-only fields (`webflowSiteId`, `gscPropertyUri`, `ga4PropertyId`, `auditSuppressions`, `subscriptionStatus`, etc.) — but never `webflowToken`, `clientPassword`, `stripeSecretKey`, or other secrets.
2. Build `toAdminWorkspaceView(row: WorkspaceRow): AdminWorkspaceView` in the new serializer file.
3. Replace `{ ...ws, webflowToken: undefined, clientPassword: undefined }` at `workspaces.ts:94` with `toAdminWorkspaceView(ws)`.
4. Contract test: assert the response contains the expected allow-list keys and none of the deny-list keys; add a regression assertion that exporting a new field on the DB row does NOT change the response shape until the serializer is updated.
5. Add pr-check rule flagging `{ ...ws,` or `{ ...workspace,` spreads inside Express route handlers under `server/routes/workspaces.ts` and `server/routes/public-portal.ts`.

**Verification:**
```
npx vitest run tests/contract/admin-workspace-view.test.ts
npx tsx scripts/pr-check.ts
curl -s -H "x-auth-token: ..." /api/workspaces/<id> | jq 'keys'   # diff against committed snapshot
```

---

### Task 4 — Briefing client-preview projection (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/briefing-client-projection.ts` (new, extracted from `public-portal.ts:781-873`)
- `server/routes/briefing.ts` (add `GET /:workspaceId/preview` handler)
- `server/routes/public-portal.ts` (refactor briefing handler to delegate)
- `tests/integration/briefing-client-preview.test.ts` (new)
- `src/api/briefing.ts` (add admin client used by admin Briefing UI — read-only)

**Must not touch:** Any frontend `.tsx` file other than imports.

**Steps:**
1. Extract the enrichment logic (`issueNumber`, `issueSummary`, top-5 `recommendations` via `computeOpportunityScore`, `weeklyOpener`) from `server/routes/public-portal.ts:781-873` into a pure function `buildBriefingClientView(workspaceId, opts?): BriefingClientView` in the new module. Use `buildWorkspaceIntelligence({ slices: [...] })` for any slice reads — do not direct-DB-read.
2. Refactor `public-portal.ts` briefing handler to call the projection.
3. Add `GET /api/workspaces/:workspaceId/briefing/preview` returning the same `BriefingClientView`, gated by `requireWorkspaceAccess`.
4. Integration test: same workspace seed; admin preview response must equal public response field-by-field (excluding any timestamps).
5. Update `src/api/briefing.ts` with a typed `fetchBriefingPreview(workspaceId)` wrapper (no UI changes in this PR).

**Verification:**
```
npx vitest run tests/integration/briefing-client-preview.test.ts
```

---

### Task 5 — P2 parity reconciliation cluster (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:** five small parity fixes, each with one contract test.

1. **Insight shape parallelism** — replace ad-hoc `buildClientInsights` projection at `server/routes/public-analytics.ts:131` (`/api/public/insights/:workspaceId/narrative`) with a single shared projection over slice output (`assembleInsights(workspaceId).insights`). Both admin (`server/routes/insights.ts:17`) and client read from the same slice; client adds a thin presenter that maps to `ClientInsight`.
2. **Content-gap `opportunityScore` fallback** — apply `gap.opportunityScore ?? computeOpportunityScore(gap)` consistently in `server/routes/keyword-strategy.ts:211` (admin) so admin sort order matches the client's briefing projection.
3. **`pendingApprovals` count** — change `workspaces.ts:126` to filter batches by the same status set the client uses (no `archived`, no unsent statuses).
4. **Brand-voice authority on onboarding** — `public-portal.ts:135,185` onboarding writes must route through the voice-profile authority chain (per CLAUDE.md authority-layered-fields rule) rather than writing raw `ws.brandVoice`. Use the existing voice-profile update path; verify the seoContext slice's `effectiveBrandVoiceBlock` reflects the new write.

Four contract tests, one per parity fix, all in `tests/contract/admin-client-parity-cluster.test.ts`.

> **Dropped during verification:** the originally-proposed "audit suppressions" parity fix (`webflow-audit.ts:20`) — that file does not exist, and `getLatestSnapshot` has zero callers outside `server/reports.ts` itself. See audit artifact "Corrections Applied During Verification" section.

**Verification:**
```
npx vitest run tests/contract/admin-client-parity-cluster.test.ts
```

---

## Task Dependencies

```
Task 1 (security)          — independent, ship first
Task 2 (trial-state)       — independent, can run parallel with Task 1
Task 3 (AdminWorkspaceView) — sequential after Task 2 (consumes WorkspaceRow type evolution if any)
Task 4 (briefing preview)   — independent of 1/2/3
Task 5 (P2 cluster)         — sequential last; touches files Tasks 2/3/4 modify

Parallel batches:
  Batch 1: Task 1 ∥ Task 2 ∥ Task 4
  Batch 2: Task 3
  Batch 3: Task 5
```

## Systemic Improvements

**Shared utilities to extract:**
- `server/billing/trial-state.ts` — canonical trial computation
- `server/serializers/admin-workspace-view.ts` — paired with existing `client-safe.ts`
- `server/briefing-client-projection.ts` — single projection used by both admin preview and client portal

**pr-check rules to add:**
- Routes under `/api/public/` must have explicit auth middleware or `// public-no-auth-ok` hatch
- Inline `trialEnd > new Date()` outside `server/billing/trial-state.ts`
- `{ ...ws, ... }` or `{ ...workspace, ... }` spreads in workspace route handlers

**New tests required:**
- `tests/integration/public-endpoint-auth.test.ts` (port 13871)
- `tests/contract/trial-state-parity.test.ts`
- `tests/contract/admin-workspace-view.test.ts`
- `tests/integration/briefing-client-preview.test.ts` (port 13872)
- `tests/contract/admin-client-parity-cluster.test.ts`

**Feature-class gates:** All five PRs are admin-facing or security-facing — apply the [admin CRUD / security definition-of-done](../../workflows/feature-class-definition-of-done.md) gates.

## Verification Strategy

Per PR:
- `npm run typecheck` (uses `tsc -b`)
- `npx vite build`
- `npx vitest run` — full suite
- `npx tsx scripts/pr-check.ts`
- For Task 1: manual `curl` against staging confirming 401 on both endpoints before merge.
- For Task 5: visual spot-check on staging that admin briefing preview matches client briefing.
