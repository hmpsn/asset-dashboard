# Competitor Last-Fetched Cache + Public-Portal Auth Order — Implementation Plan

> **Origin:** Flags from PR #149 code review (2026-04-07).

**Goal:** Two small, independent fixes:
1. Wire `competitorLastFetchedAt` so incremental strategy skips SEMRush competitor re-fetch when data is still fresh
2. Move auth check before Zod validation on the business-profile PATCH endpoint

**Model:** Sonnet for both — mechanical, well-scoped changes.

---

## Task 1 — Wire `competitorLastFetchedAt` into keyword strategy

**Problem:** Migration 052 added `competitor_last_fetched_at` to the workspaces table and the full read/write plumbing exists, but no code writes to it. The incremental strategy mode still calls SEMRush competitor APIs on every run, burning API credits unnecessarily when competitor data hasn't changed.

**Files owned:** `server/routes/keyword-strategy.ts`

### Steps

- [ ] **1a. Add constants at file top**

```typescript
/** Days before competitor data is considered stale and re-fetched */
const COMPETITOR_CACHE_DAYS = 7;
```

- [ ] **1b. Add `shouldFetchCompetitorData` helper** (near `getPagesNeedingAnalysis`)

```typescript
function shouldFetchCompetitorData(ws: Workspace): boolean {
  if (!ws.competitorLastFetchedAt) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COMPETITOR_CACHE_DAYS);
  return new Date(ws.competitorLastFetchedAt) < cutoff;
}
```

- [ ] **1c. Guard the SEMRush competitor block**

The competitor fetch section (~lines 554–653) currently runs unconditionally when `semrushMode !== 'none' && provider`. Wrap the **competitor-specific** calls (auto-discovery ~580, competitor keywords ~600, keyword gap ~640) in:

```typescript
const fetchCompetitors = shouldFetchCompetitorData(ws);
if (!fetchCompetitors && strategyMode === 'incremental') {
  log.info(`Incremental mode: skipping competitor re-fetch (last fetched ${ws.competitorLastFetchedAt})`);
  sendProgress('semrush', 'Using cached competitor data (still fresh)', 0.58);
}
```

**Important:** Do NOT skip `getDomainKeywords(siteDomain, ...)` (line 566) — that's the site's own organic data, not competitor data. Only skip the three competitor blocks:
1. Auto-discover competitors (~580–597)
2. Fetch competitor keywords (~600–637)
3. Keyword gap analysis (~640–653)

When skipping, `competitorDomains` should still be populated from `ws.competitorDomains` (line 203 already does this) and `competitorKeywordData` stays empty — the AI just won't get fresh competitor proof in the prompt. The existing domain keywords and GSC data still feed the pool.

- [ ] **1d. Stamp `competitorLastFetchedAt` after successful fetch**

After the competitor blocks complete (approximately line 654, after the keyword-gap try-catch), if any competitor data was actually fetched:

```typescript
if (fetchCompetitors && (competitorKeywordData.length > 0 || keywordGaps.length > 0)) {
  updateWorkspace(ws.id, { competitorLastFetchedAt: new Date().toISOString() });
}
```

- [ ] **1e. Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

### Test plan

Add a test in `tests/integration/keyword-strategy-incremental.test.ts`:
- Seed a workspace with `competitorLastFetchedAt` set to today → verify incremental mode logs "skipping competitor re-fetch"
- Seed a workspace with `competitorLastFetchedAt` set to 14 days ago → verify it doesn't log the skip message

(Both would need a mocked SEMRush provider to fully test the fetch path, so the DB-layer verification that `updateWorkspace` writes the timestamp is the pragmatic test. The incremental test file already has the env var setup for HTTP calls.)

---

## Task 2 — Move auth before validation on business-profile PATCH

**Problem:** `PATCH /api/public/workspaces/:id/business-profile` uses `validate(clientBusinessProfileSchema)` as Express middleware, which runs before the in-handler cookie auth check. Unauthenticated requests with invalid bodies get 400 (leaking expected field names) instead of 401. All other mutation handlers in `public-portal.ts` check auth first.

**Files owned:** `server/routes/public-portal.ts`

### Steps

- [ ] **2a. Move validation into the handler body**

Change from:
```typescript
router.patch('/api/public/workspaces/:id/business-profile', validate(clientBusinessProfileSchema), (req, res) => {
  const wsId = req.params.id;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  // ... auth check ...
```

To:
```typescript
router.patch('/api/public/workspaces/:id/business-profile', (req, res) => {
  const wsId = req.params.id;
  const sessionToken = req.cookies?.[`client_session_${wsId}`];
  const clientUserToken = req.cookies?.[`client_user_token_${wsId}`];
  const hasSession = sessionToken && verifyClientSession(wsId, sessionToken);
  const hasClientUserAuth = clientUserToken && (verifyClientToken(clientUserToken)?.workspaceId === wsId);
  if (!hasSession && !hasClientUserAuth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Validate after auth — don't leak field names to unauthenticated callers
  const parsed = clientBusinessProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
  }

  const existing = getWorkspace(wsId);
  // ... rest unchanged, but use parsed.data instead of req.body ...
```

**Key change:** Replace `req.body` references in the merge logic with `parsed.data` so we use the Zod-validated output.

- [ ] **2b. Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

### Test plan

Quick integration test (or add to an existing public-portal test file):
- Send `PATCH /api/public/workspaces/:id/business-profile` with invalid body + no auth cookies → expect 401 (not 400)
- Send with valid auth + invalid body → expect 400

---

## Verification

- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — builds
- [ ] `npx vitest run` — full suite passes
- [ ] `npx tsx scripts/pr-check.ts` — zero errors

## Parallelization

Tasks 1 and 2 are fully independent — different files, no shared state. Can be dispatched as parallel agents.

```
Task 1 (keyword-strategy.ts) ∥ Task 2 (public-portal.ts)
```
