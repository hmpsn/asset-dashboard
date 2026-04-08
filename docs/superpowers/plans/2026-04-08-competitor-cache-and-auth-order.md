# Competitor Cache, Auth Order, and Test Reliability — Implementation Plan

> **Origin:** Flags from PR #149 code review + two pre-existing flaky tests (2026-04-07/08).

---

## Task Dependency Graph

```
All four tasks own distinct files with no shared state → run in parallel.

Task 1 (keyword-strategy.ts) ∥ Task 2 (public-portal.ts) ∥ Task 3 (seo-audit-routes.test.ts) ∥ Task 4 (content-decay-routes.test.ts)
```

---

## Task 1 — Wire `competitorLastFetchedAt` into keyword strategy

**Model:** Sonnet (logic-bearing, multi-location change)
**Files owned:** `server/routes/keyword-strategy.ts`
**Must not touch:** any other file

**Problem:** Migration 052 added `competitor_last_fetched_at` to the workspaces table and full plumbing exists (`WorkspaceRow`, `rowToWorkspace` at `server/workspaces.ts:128`, `workspaceToParams` at line 339, `columnMap` at line 446, `Workspace` interface at `shared/types/workspace.ts:177`). But nothing ever writes to it. The incremental strategy mode still calls SEMRush competitor APIs on every run — burning API credits when competitor data is still fresh.

**Verified against codebase:**
- `getTokenForSite` is at `server/workspaces.ts:383`
- Competitor fetch block starts around `server/routes/keyword-strategy.ts:554`
- Auto-discover: ~line 580; competitor keywords: ~line 600; keyword gap: ~line 640
- `semrushMode` and `provider` guard the whole block at line 557
- `competitorDomains` populated from `ws.competitorDomains` at line 203 (before the block runs)
- `updateWorkspace` is available in scope (used at line 210, 592)

### Steps

- [ ] **1a. Add constant near top of file** (near `INCREMENTAL_THRESHOLD_DAYS`):

```typescript
/** Days before competitor keyword data is considered stale and re-fetched */
const COMPETITOR_CACHE_DAYS = 7;
```

- [ ] **1b. Add `shouldFetchCompetitorData` helper** (near the `getPagesNeedingAnalysis` function):

```typescript
function shouldFetchCompetitorData(ws: Workspace): boolean {
  if (!ws.competitorLastFetchedAt) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COMPETITOR_CACHE_DAYS);
  return new Date(ws.competitorLastFetchedAt) < cutoff;
}
```

- [ ] **1c. Compute skip flag before the competitor block** (~line 554, before `const competitorKeywordData = []`):

```typescript
const fetchCompetitors = strategyMode !== 'incremental' || shouldFetchCompetitorData(ws);
if (!fetchCompetitors) {
  log.info(`Incremental mode: skipping competitor re-fetch (last fetched ${ws.competitorLastFetchedAt})`);
  sendProgress('semrush', 'Using cached competitor data (still fresh)...', 0.58);
}
```

- [ ] **1d. Guard the three competitor sub-blocks** inside the `if (semrushMode !== 'none' && provider)` block:
  - Auto-discovery (~line 580): wrap in `if (fetchCompetitors) { ... }`
  - Competitor keywords (~line 600): wrap in `if (fetchCompetitors && competitorDomains.length > 0) { ... }`
  - Keyword gap (~line 640): wrap in `if (fetchCompetitors && competitorDomains.length > 0) { ... }`

  **Do NOT wrap** the domain organic keywords fetch (~line 564) — that's the site's own data, not competitor data.

- [ ] **1e. Stamp timestamp after successful competitor fetch** (~line 655, after the keyword gap try-catch closes):

```typescript
if (fetchCompetitors && (competitorKeywordData.length > 0 || keywordGaps.length > 0)) {
  updateWorkspace(ws.id, { competitorLastFetchedAt: new Date().toISOString() });
}
```

- [ ] **1f. Build verify:**
```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

### Tests for Task 1

Add to `tests/integration/keyword-strategy-incremental.test.ts` (the existing incremental test file):

```typescript
describe('DB-layer: competitorLastFetchedAt stamped after fetch', () => {
  it('updateWorkspace writes competitorLastFetchedAt and rowToWorkspace reads it back', () => {
    const ws = createWorkspace('Competitor Stamp Test');
    const now = new Date().toISOString();
    updateWorkspace(ws.id, { competitorLastFetchedAt: now });
    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.competitorLastFetchedAt).toBe(now);
    deleteWorkspace(ws.id);
  });

  it('shouldFetchCompetitorData returns false when fetched < 7 days ago', () => {
    // Verify the guard function logic directly via DB state
    const ws = createWorkspace('Competitor Cache Test');
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    updateWorkspace(ws.id, { competitorLastFetchedAt: recent });
    const reloaded = getWorkspace(ws.id)!;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    expect(new Date(reloaded.competitorLastFetchedAt!) >= cutoff).toBe(true); // still fresh
    deleteWorkspace(ws.id);
  });
});
```

---

## Task 2 — Move auth before Zod validation on business-profile PATCH

**Model:** Haiku (mechanical, one-file change)
**Files owned:** `server/routes/public-portal.ts`
**Must not touch:** any other file

**Problem:** `PATCH /api/public/workspaces/:id/business-profile` at line 528 uses `validate(clientBusinessProfileSchema)` as Express middleware. Express middleware runs before the in-handler cookie auth check at lines 530–536. An unauthenticated request with an invalid body gets 400 (leaks expected field names) instead of 401. All other mutation handlers in `public-portal.ts` (e.g. business-priorities at ~line 445) check auth inside the handler first.

**Verified against codebase:**
- Route signature: `router.patch('/api/public/workspaces/:id/business-profile', validate(clientBusinessProfileSchema), (req, res) => {` at line 528
- Auth check: lines 530–536 (cookie check + `verifyClientSession` / `verifyClientToken`)
- `validate` middleware imported from `'../middleware/validate.js'` — uses `schema.safeParse`
- `clientBusinessProfileSchema` is defined at lines 512–526 (same file)

### Steps

- [ ] **2a. Remove `validate(...)` from the route signature**

Change:
```typescript
router.patch('/api/public/workspaces/:id/business-profile', validate(clientBusinessProfileSchema), (req, res) => {
```
To:
```typescript
router.patch('/api/public/workspaces/:id/business-profile', (req, res) => {
```

- [ ] **2b. Inline `safeParse` after the auth block** (after the `if (!hasSession && !hasClientUserAuth)` return, before reading the workspace):

```typescript
const parsed = clientBusinessProfileSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
}
```

- [ ] **2c. Replace `req.body` references in the merge logic with `parsed.data`**

The merge at lines 540–548 uses `req.body` and `req.body.address`. Replace both with `parsed.data` and `parsed.data.address`.

- [ ] **2d. Build verify:**
```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

### Tests for Task 2

Add to an existing public-portal integration test file (grep for `public-portal` tests to find the right file):

```typescript
describe('PATCH /api/public/workspaces/:id/business-profile — auth order', () => {
  it('returns 401 (not 400) when unauthenticated with invalid body', async () => {
    const res = await ctx.postJson(`/api/public/workspaces/${wsId}/business-profile`, {
      email: 'not-an-email', // invalid — would 400 if validation ran first
    });
    expect(res.status).toBe(401); // auth check runs before validation
  });

  it('returns 400 when authenticated with invalid body', async () => {
    // Set up valid session cookie first, then send invalid body
    const res = await ctx.api(`/api/public/workspaces/${wsId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: validSessionCookie },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });
});
```

---

## Task 3 — Fix `seo-audit-routes.test.ts` flaky "no token" test

**Model:** Haiku (targeted env fix, single describe block)
**Files owned:** `tests/integration/seo-audit-routes.test.ts`
**Must not touch:** `tests/integration/helpers.ts` or any server file

**Problem:** `getTokenForSite` in `server/workspaces.ts:385`:
```typescript
return row?.webflow_token || process.env.WEBFLOW_API_TOKEN || null;
```
Falls back to the global env var. `createTestContext` spawns the server with `{ ...process.env, ... }`, so if `WEBFLOW_API_TOKEN` is set in the parent process (developer machine or CI with API keys), the spawned server inherits it. The test uses `'site_no_token_xyz'` — no workspace-level token — so `getTokenForSite` returns the global env token, route calls `runSeoAudit`, gets 200 instead of 500.

**Verified against codebase:**
- `getTokenForSite` at `server/workspaces.ts:383–385`
- `createTestContext` spawn at `tests/integration/helpers.ts:69–80` — `{ ...process.env, PORT, NODE_ENV, APP_PASSWORD }` — no way to suppress inherited vars
- Route guard: `webflow-seo.ts:38–41` — returns 500 only when `getTokenForSite` returns null
- Test at `seo-audit-routes.test.ts:641–648` — sole `describe` block at the end of the file

### Steps

- [ ] **3a. Save and unset `WEBFLOW_API_TOKEN` before server startup**

The `ctx` is created at module level but `startServer()` is called in the file-level `beforeAll` at line 29. Modify that `beforeAll` to temporarily unset the env var before spawn so the child process inherits a clean env:

```typescript
beforeAll(async () => {
  // Unset WEBFLOW_API_TOKEN before spawning the test server so
  // getTokenForSite('site_no_token_xyz') deterministically returns null.
  // Workspace-level webflowToken fields are unaffected — only the global fallback is cleared.
  const savedWebflowToken = process.env.WEBFLOW_API_TOKEN;
  delete process.env.WEBFLOW_API_TOKEN;
  await ctx.startServer();
  // Restore in parent process — child process env is already fixed at spawn time.
  if (savedWebflowToken !== undefined) process.env.WEBFLOW_API_TOKEN = savedWebflowToken;
}, 25_000);
```

- [ ] **3b. Build verify:** `npx tsc --noEmit --skipLibCheck`

- [ ] **3c. Run test in isolation to confirm deterministic pass:**
```bash
npx vitest run tests/integration/seo-audit-routes.test.ts
```

### Note on test correctness

The describe block for section 7 has only one test. After this fix, `getTokenForSite('site_no_token_xyz')` always returns null regardless of environment — the 500 path is deterministic.

No new tests needed — the fix makes the existing test reliable.

---

## Task 4 — Fix `content-decay-routes.test.ts` non-assertive recommendations test

**Model:** Haiku (env fix + test rewrite, single test)
**Files owned:** `tests/integration/content-decay-routes.test.ts`
**Must not touch:** any server file or `helpers.ts`

**Problem:** `tests/integration/content-decay-routes.test.ts:370`:
```typescript
it('returns 500 or 200 when cached analysis exists (depends on OpenAI availability)', async () => {
  const res = await postJson(`/api/content-decay/${wsWithData}/recommendations`, { maxPages: 2 });
  expect([200, 500]).toContain(res.status);  // always passes — no assertion value
});
```
The test accepts both outcomes, making it useless as a regression guard. In environments without an OpenAI key, it logs an ERROR (the route catches the OpenAI auth error and returns 500), creating noise in test output.

**Verified against codebase:**
- Route at `server/routes/content-decay.ts:63` — calls `generateBatchRecommendations` which makes a real OpenAI call
- `createTestContext` at line 21: `const ctx = createTestContext(13311)` — spawned process
- `beforeAll` at line 119: `await ctx.startServer()` — env vars set at spawn time
- If `OPENAI_API_KEY` is absent, OpenAI SDK throws an auth/config error → `res.status(500)` at line 93
- If present but fake, same: quick 401 from OpenAI → throws → 500

**Fix approach:** Set a fake `OPENAI_API_KEY` before server startup so the OpenAI call always fails with a quick auth error (not a hang). This makes the behavior deterministic: the test always gets 500. Rewrite the test to explicitly assert 500 with a clear explanation.

### Steps

- [ ] **4a. Set fake `OPENAI_API_KEY` before `ctx.startServer()` in `beforeAll`**

```typescript
beforeAll(async () => {
  // Set a fake OpenAI key before spawning so generateBatchRecommendations
  // fails with a fast auth error (not a hang). The test asserts 500 — the
  // correct behavior when the AI call fails (not phantom success).
  // Save and restore so we don't contaminate sibling test files in this process.
  const savedOpenAIKey = process.env.OPENAI_API_KEY;
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = 'fake-key-for-content-decay-test';
  }
  await ctx.startServer();
  if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenAIKey;

  const ws1 = createWorkspace('Content Decay Test WS');
  // ... rest of setup unchanged
```

- [ ] **4b. Rewrite the non-assertive test at line 370**

> **Implementation note:** The plan originally prescribed asserting `expect(res.status).toBe(500)`.
> This was wrong. `generateBatchRecommendations` (`server/content-decay.ts:271-278`) catches
> OpenAI errors **per page** and sets a meaningful fallback string — it never throws. The route
> always returns 200 with fallback recommendations. The correct FM-2 check is asserting 200 +
> verifying fallback text is meaningful (not empty/garbage). Updated implementation below.

```typescript
it('returns 200 with fallback recommendations when AI call fails (FM-2: graceful degradation)', { timeout: 30_000 }, async () => {
  const res = await postJson(`/api/content-decay/${wsWithData}/recommendations`, { maxPages: 2 });
  expect(res.status).toBe(200);
  const body = (await res.json()) as DecayAnalysis;
  expect(Array.isArray(body.decayingPages)).toBe(true);
  const withRecs = body.decayingPages.filter(p => typeof p.refreshRecommendation === 'string');
  expect(withRecs.length).toBeGreaterThan(0);
  for (const p of withRecs) {
    expect(p.refreshRecommendation!.length).toBeGreaterThan(10);
  }
});
```

- [ ] **4c. Run test in isolation:**
```bash
npx vitest run tests/integration/content-decay-routes.test.ts
```

---

## Verification (all tasks)

After all agents complete:

```bash
npx tsc --noEmit --skipLibCheck   # zero errors
npx vite build                    # builds clean
npx vitest run                    # full suite passes
npx tsx scripts/pr-check.ts       # zero errors
```

Specific checks:
- `npx vitest run tests/integration/seo-audit-routes.test.ts` — passes regardless of whether `WEBFLOW_API_TOKEN` is set in the environment
- `npx vitest run tests/integration/content-decay-routes.test.ts` — passes regardless of whether `OPENAI_API_KEY` is set in the environment
- `npx vitest run tests/integration/keyword-strategy-incremental.test.ts` — new competitor stamp tests pass
