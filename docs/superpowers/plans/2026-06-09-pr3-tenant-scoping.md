# PR 3 — Tenant Scoping + Portal Posture — Implementation Plan

> **SCOPE SPLIT (2026-06-10, recorded per run protocol).** Task 3 (passwordless portal
> closed-until-configured) and Task 4 (insights endpoint hardening) both deny
> unauthenticated reads on passwordless workspaces, which broke ~100 integration files
> (683 failures) — far beyond the plan's estimate. Most failures are route-logic tests
> that create bare workspaces and read public endpoints; ~45 use bespoke fetch helpers
> that bypass the harness's `autoPublicAuth` injection. That is a focused test-harness
> migration deserving its own PR. **PR 3 ships Tasks 1, 2, and the SESSION_SECRET rider**
> (JWT member scoping + its pr-check rule + prod session-secret hard-fail). **Tasks 3 + 4
> move to a dedicated PR 3b** (`docs/superpowers/plans/2026-06-09-pr3b-portal-posture.md`,
> authored when reached) with the harness migration as explicit scope. The owner decision
> (closed-until-configured) stands — it is sequenced, not dropped. The 404→401 oracle rider
> is **skipped**: `deliverables-route.test.ts:81` and `public-portal-routes.test.ts:526`
> pin the 404 as deliberate fail-closed behavior; flipping it contradicts tested intent for
> a low-severity enumeration risk on unguessable `ws_<uuid>` ids.


> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, single-agent) + `requesting-code-review` before PR. Contract+test-centric per docs/PLAN_WRITING_GUIDE.md. Per task: READ real code → failing test (red for the right reason) → minimal implementation → green + typecheck → commit. STOP and record in the PR body if real code contradicts a contract.

**Goal:** Close the confirmed JWT-member cross-workspace hole (audit #2), flip passwordless workspaces to closed-until-configured (owner decision), harden the public insights endpoints, and mechanize the guard requirement in pr-check.

**Branch:** `claude/audit-pr3-tenant-scoping` off `origin/staging` (`235fbef6`). **Base PR:** `staging`.

**Owning bounded context:** auth/middleware (`server/auth.ts`, `server/middleware.ts`, `server/app.ts`); secondary: every admin route file in the guard sweep; pr-check.

**Verified facts (re-checked):**
- `requireWorkspaceAccessFromQuery` (server/auth.ts:123) has zero callers; `requestUserCanAccessWorkspace` passes through when no JWT user (HMAC admins unaffected); `requestUserCanOmitWorkspaceScope` allows missing-param for HMAC/owner only.
- Unguarded query-workspaceId reads: `ai.ts:118,132` (usage, time-saved), `activity.ts:28`, `requests.ts:163`, `jobs.ts:128,164`, `google.ts:74`, `debug.ts` (/api/debug/prompt — with a comment wrongly claiming no guard exists for query params), `webflow-seo-audit.ts:30-32`, `webflow-analysis.ts:250`, `webflow-schema.ts:357,649`. Body reads: `ai.ts:39` (admin-chat), `webflow-cms.ts:87` (PATCH item, optional enrichment field).
- Portal gates: `app.ts:262-283` global client-session gate passes passwordless through BEFORE the admin/JWT checks would matter; `middleware.ts:207-208` `requireClientPortalAuth` has the same `!ws.clientPassword → next()` passthrough. `hasClientUsers(workspaceId)` exists (server/client-users.ts:307). `seedWorkspace` defaults `clientPassword: 'test-password'`, so most integration fixtures already authenticate.

---

## Task Dependencies
```
Task 1 (guard sweep + tests)  →  Task 2 (pr-check rule + rules:generate; the sweep must be clean first)
Task 3 (portal closed-until-configured + tests + fixture fallout sweep)  — independent of 1/2
Task 4 (insights endpoint hardening)  — after Task 3 (gate semantics settle)
Task 5 (riders: 404/401 oracle, SESSION_SECRET prod hard-fail)  — any time
```
Model: orchestrator-inline; reviewer Opus-tier.

## Task 1 — Guard the query/body-workspaceId admin routes
**Files:** the 10 route files listed above + `tests/integration/admin-workspace-scope-guards.test.ts` (new).
**Contracts:**
1. Every admin route reading `workspaceId` from query gets `requireWorkspaceAccessFromQuery()` in its middleware chain; body reads get `requireWorkspaceAccessFromBody()`. Routes keyed on `:siteId` that ALSO read query workspaceId get the query guard in addition to any existing site guard.
2. HMAC-admin behavior is unchanged (no JWT user → pass-through) — pin with a test.
3. A member JWT scoped to workspace A calling with workspace B's id → 403 on every guarded route; missing param → pass for HMAC/owner, 403 for member (the existing middleware semantics — do not change them).
4. Fix the false comment in `debug.ts` ("requireWorkspaceAccess() cannot be used here…") and guard the route.
5. `webflow-cms.ts:87` body read: apply FromBody; if the admin UI omits workspaceId on that PATCH (check `src/api/` caller), note that members-without-body-param are now denied and verify the caller always sends it.
**Test assertions (new integration file, `createEphemeralTestContext`):** mint a member JWT scoped to ws A (follow `tests/fixtures/auth-seed.ts` / users.ts patterns); for a representative set (POST /api/admin-chat, GET /api/activity?workspaceId=B, GET /api/ai/usage?workspaceId=B, GET /api/debug/prompt?workspaceId=B): member→B = 403, member→A = non-403, HMAC admin→B = non-403.

## Task 2 — pr-check rule: unguarded request-derived workspace scope
**Files:** `scripts/pr-check.ts`, `docs/rules/automated-rules.md` (generated).
**Contract:** new rule (read `docs/rules/pr-check-rule-authoring.md` first) flagging route registrations in `server/routes/*.ts` whose handler reads `req.query.workspaceId` or `req.body.workspaceId` without `requireWorkspaceAccessFromQuery|requireWorkspaceAccessFromBody|requireWorkspaceSiteAccessFromQuery` in the chain. Escape hatch: `// workspace-scope-from-request-ok: <reason>`. Run `npm run rules:generate` in the same commit. The rule must pass on the post-Task-1 tree and FAIL if Task 1 is reverted (verify locally by stashing one guard).

## Task 3 — Passwordless workspaces closed until configured (owner decision)
**Files:** `server/app.ts` (client-session gate), `server/middleware.ts` (`requireClientPortalAuth`), tests.
**Contracts:**
1. Definition: a workspace "has a client credential" iff `!!ws.clientPassword || hasClientUsers(ws.id)`.
2. `app.ts` gate order becomes: portal-disabled check → admin HMAC → internal JWT → (no credential → 401 `'Client portal is not configured…'`) → session/user-token checks → 401. The current `!ws → next()` stays (routes own their 404s).
3. `requireClientPortalAuth` drops the passwordless passthrough with the same credential definition (admin/JWT/client checks already precede it).
4. `requireAuthenticatedClientPortalAuth` unchanged (already strict).
5. Fallout sweep: run the full integration lane; any test relying on passwordless-open reads must be updated to seed a password or send the admin token — fix all in this commit. seed:demo fixtures: verify they set client passwords (docs/workflows/local-dev-onboarding.md mentions demo passwords) — if not, add.
**Test assertions:** passwordless workspace: unauthenticated GET on a public read endpoint → 401; admin HMAC → 200; member JWT scoped to it → 200; workspace with client users but no shared password: valid client-user token → 200, unauthenticated → 401; password workspace behavior unchanged (existing tests).

## Task 4 — Public insights endpoint hardening
**Files:** `server/routes/public-analytics.ts` (+ wherever /narrative and /digest live), maybe a serializer.
**Contracts:**
1. `requireAuthenticatedClientPortalAuth()` on the raw `/api/public/insights/:workspaceId` and its `/narrative` + `/digest` siblings (matching the anomalies route precedent) — belt-and-braces on top of Task 3.
2. Strip internal bookkeeping from the raw payload (`_scoreAdjustments`, `_originalBaseScore`) UNLESS the admin feed reads them — grep `src/` first; anything the admin consumes stays. `bridgeSource` stays if the admin feed uses it; strip otherwise. Record the final field decision in the PR body.
3. Admin token continues to pass (the middleware admits it) — pin with a test since the admin insight feed consumes this endpoint.

## Task 5 — Riders
1. `requireAuthenticatedClientPortalAuth` 404-vs-401 oracle (middleware.ts:223): uniform 401 for missing workspace and unauthenticated. Check no test pins the 404.
2. `SESSION_SECRET` (middleware.ts:129): in production (`NODE_ENV === 'production'`), throw at startup when neither SESSION_SECRET nor APP_PASSWORD is set (mirroring `server/jwt-config.ts`); dev/test keep the random fallback.

## Systemic Improvements
- pr-check rule `workspace-scope-from-request` (Task 2) — closes the structural blind spot the audit verifier identified in the tenant-boundary audit script.
- New integration suite for cross-workspace member denial — the first test coverage of the JWT-member boundary.
- Feature-class gates: security fix class — full gates; no FEATURE_AUDIT/BRAND_DESIGN changes; consider a `docs/workflows/auth-system.md` note for the new portal posture (same commit as Task 3).

## Verification Strategy
- [ ] New integration suites green; full suite green; typecheck; build; pr-check (incl. the NEW rule); flags; ratchet
- [ ] Manual curl matrix on the dev server: member-JWT cross-workspace 403; passwordless workspace public GET 401 → with admin token 200
- [ ] `npm run rules:generate` diff committed
- [ ] `superpowers:requesting-code-review` — fix Important+ in-PR
