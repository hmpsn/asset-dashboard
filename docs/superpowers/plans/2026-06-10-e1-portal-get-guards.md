# E1 — Guard the four public-portal GETs

> **PR:** `claude/core-e1-portal-get-guards`
> **Lane:** E (Client portal)
> **Parent plan:** [2026-06-10-core-features-remediation-master.md](./2026-06-10-core-features-remediation-master.md) §Wave 0 §E1
> **Audit item:** #2 — unguarded GETs in public-portal.ts

---

## Problem

Four `GET` routes in `server/routes/public-portal.ts` serve client-scoped data without authentication:

| Line | Route |
|------|-------|
| ~246 | `GET /api/public/audit-summary/:workspaceId` |
| ~331 | `GET /api/public/keyword-feedback/:workspaceId` |
| ~459 | `GET /api/public/business-priorities/:workspaceId` |
| ~622 | `GET /api/public/content-gap-votes/:workspaceId` |

Their POST/DELETE siblings already use `requireClientStrategyMutationAuth`. The sibling `GET /api/public/audit-detail/:workspaceId` (line ~265) already uses `requireClientPortalAuth()`. The pattern is established — these four GETs were simply never guarded.

---

## Contracts

No new contracts. This PR reuses the existing `requireClientPortalAuth('workspaceId')` middleware from `server/middleware.ts` (already imported at line 15 of public-portal.ts).

**Semantic preservation:**
- Admin HMAC token (`x-auth-token`) always passes through (middleware.ts:208-210)
- Passwordless workspaces (no `clientPassword` set) pass through (middleware.ts:220)
- `requireAuth` is NOT used — CLAUDE.md §Auth Conventions forbids it on public-portal routes

---

## Test assertions

Test file: `tests/integration/public-portal-get-auth.test.ts`

Uses `createEphemeralTestContext(import.meta.url)` (standard single-context file).

Fixtures:
- **wsPassword**: workspace with `clientPassword` set (from `seedWorkspace()` default)
- **wsPasswordless**: workspace with `clientPassword = null` (override)
- **wsB**: second password-protected workspace for cross-workspace isolation

Endpoints under test (all four guards):
1. `GET /api/public/audit-summary/:workspaceId`
2. `GET /api/public/keyword-feedback/:workspaceId`
3. `GET /api/public/business-priorities/:workspaceId`
4. `GET /api/public/content-gap-votes/:workspaceId`

**Matrix (a–e) for each of the four endpoints:**

| Case | Auth | wsPassword workspace | Expected |
|------|------|----------------------|----------|
| (a) | no credential | password-configured ws | 401 |
| (b) | admin HMAC `x-auth-token` | password-configured ws | 200 |
| (c) | client JWT cookie scoped to ws | password-configured ws | 200 |
| (d) | no credential | passwordless ws | 200 (default preserved) |
| (e) | client JWT scoped to wsB | wsPassword (wsA) | 401 (cross-workspace) |

---

## Implementation

**File to edit:** `server/routes/public-portal.ts`

Four surgical insertions — add `requireClientPortalAuth('workspaceId')` as middleware argument to each unguarded GET, exactly as audit-detail uses it at line ~265.

Pattern (before/after):
```ts
// BEFORE
router.get('/api/public/audit-summary/:workspaceId', (req, res) => {
// AFTER
router.get('/api/public/audit-summary/:workspaceId', requireClientPortalAuth('workspaceId'), (req, res) => {
```

**No other changes** to existing logic, no addActivity (GETs), no broadcast.

---

## pr-check rule

**Name:** `public-portal GET missing portal-auth middleware`

**Rationale:** Any new unguarded GET in public-portal.ts silently exposes workspace data to unauthenticated callers — TypeScript cannot detect missing middleware.

**Design:**
- `customCheck` (not regex) — needs to read the file, extract each `router.get(` call, and verify middleware presence, with exclusions for the three intentionally-public bootstrap endpoints.
- **Intentionally-public bootstrap endpoints** (serve the login screen itself):
  - `GET /api/public/workspace/:id` (~line 81)
  - `GET /api/public/tier/:id` (~line 203)
  - `GET /api/public/pricing/:id` (~line 220)
  - These get inline `// portal-auth-public-ok` escape hatch on the same line as `router.get`.
- **Escape hatch:** `// portal-auth-public-ok` (inline on the `router.get` line)
- **Severity:** `error` (zero unguarded GETs after this PR lands)
- **pathFilter / exclude:** `server/routes/public-portal.ts` only

---

## Verification commands

```bash
npm run typecheck
npx vite build
npx vitest run tests/integration/public-portal-get-auth.test.ts
npx vitest run
npm run pr-check
npm run verify:feature-flags
npm run verify:coverage-ratchet
```

---

## File ownership

OWNS: `server/routes/public-portal.ts`, `tests/integration/public-portal-get-auth.test.ts`, `scripts/pr-check.ts` (new rule only), `docs/rules/automated-rules.md` (generated), this plan file.
READS (must NOT modify): `server/middleware.ts`, `tests/integration/helpers.ts`, `tests/fixtures/`.
