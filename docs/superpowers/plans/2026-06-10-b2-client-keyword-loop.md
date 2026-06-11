# B2 — Close the Client Keyword Loop (audit #13)

> **Lane B, PR 2 of 2** — serial after B1 (#4 Hub blockers) merges.
> Branch: `claude/core-b2-client-keyword-loop` off `origin/staging`.
> Model: Sonnet. Reviewer: Opus.

---

## Scope

Four fixes, one PR, fully behind the existing `keyword-hub` feature flag for Hub UI (the nudge and decline note in `KeywordStrategy.tsx` are admin-side, always-visible).

1. **Requested-keyword list with one-click add (admin side)** — Show the `requestedFeedback` list in the "Client Keyword Feedback" `SectionCard` in `KeywordStrategy.tsx` with a one-click "Add to Strategy" button per entry. Calls `keywordCommandCenter.action(workspaceId, { action: 'add_to_strategy', keyword, ... })` via the existing API client. Does NOT re-implement the write logic.

2. **ADD_TO_STRATEGY phantom fix** — `keyword-command-center.ts` ADD_TO_STRATEGY case (line ~3287-3295) records `feedback.status = 'approved'` and a `tracked_keyword` row, which causes the UI to show "IN_STRATEGY" — but never writes to `page_keywords` (the actual strategy artifact). Fix: after the existing feedback/tracking writes, also call `upsertPageKeyword(workspaceId, ...)` inside the same transaction, using `request.pagePath` (or a `/planned/<slug>` fallback) as the pagePath and `displayKeyword` as the primaryKeyword.

3. **"Applies at next update" note on declined keywords (client side)** — Add a brief explanatory note to `StrategyDeclinedKeywordsSection.tsx` describing that declines are applied the next time the strategy is regenerated.

4. **"Feedback since last generation" nudge (admin side)** — In `KeywordStrategy.tsx` nudge region (~line 421-423), when there is `requestedFeedback.length > 0` or `declinedFeedback.length > 0` AND feedback items are newer than `strategy?.generatedAt`, surface a subtle nudge banner ("New client feedback since last strategy generation — regenerate to apply it").

---

## File ownership

**OWNS (write):**
- `server/keyword-command-center.ts` — ADD_TO_STRATEGY phantom fix (item 2)
- `server/routes/keyword-command-center.ts` — READ ONLY (no changes needed)
- `src/components/KeywordStrategy.tsx` — nudge (item 4) + requested-keyword add UI (item 1)
- `src/components/client/strategy/StrategyDeclinedKeywordsSection.tsx` — decline note (item 3)
- `tests/integration/b2-client-keyword-loop.test.ts` — new integration test
- `docs/superpowers/plans/2026-06-10-b2-client-keyword-loop.md` — this plan

**READS (no modification):**
- `server/page-keywords.ts` — `upsertPageKeyword`, `getPageKeyword` signatures
- `server/mcp/tools/keyword-actions.ts` — confirmed write path is `upsertPageKeyword`
- `shared/types/keyword-command-center.ts` — `KeywordCommandCenterActionRequest`
- `shared/types/workspace.ts` — `PageKeywordMap`
- `shared/types/keyword-feedback.ts` — `AdminKeywordFeedbackListRow`
- `src/api/keywordCommandCenter.ts` — `keywordCommandCenter.action`
- `server/ws-events.ts` — `WS_EVENTS.STRATEGY_UPDATED` (existing constant, reused)

---

## Contract verification (re-grep before commit)

**MCP tool write path:**
- `server/mcp/tools/keyword-actions.ts:handleAddKeywordToStrategy` calls `upsertPageKeyword(workspaceId, next)` at line ~200.
- The underlying service function is therefore: `upsertPageKeyword` from `server/page-keywords.ts`.
- B2 imports and calls `upsertPageKeyword` directly inside the ADD_TO_STRATEGY transaction (same function, same table).

**A4 contract out:**
After B2 merges, `applyKeywordCommandCenterAction(workspaceId, { action: 'add_to_strategy', keyword, pagePath? })` guarantees:
1. `keyword_feedback` row: `status = 'approved'`
2. `tracked_keyword` row: `source = STRATEGY_SITE_KEYWORD`, `status = ACTIVE`
3. `page_keywords` row: `primary_keyword = keyword`, `page_path = pagePath || /planned/<slug>` ← **NEW in B2**

A4 calls `applyKeywordCommandCenterAction` (already exported) — no new export needed. A4 should pass `pagePath` from the rank snapshot's `pagePath` field when available.

---

## Implementation plan

### Step 1 — ADD_TO_STRATEGY phantom fix (server)

In `server/keyword-command-center.ts`, within the `run = db.transaction(...)` block, add after line ~3294 (after the `upsertTrackedKeywordByKey` call):

```
// Write the strategy artifact (page_keywords) so ADD_TO_STRATEGY is honest:
// upsertFeedback marks it approved → IN_STRATEGY label appears. Without this
// upsertPageKeyword call the strategy file never reflects the keyword (phantom).
const strategyPath = request.pagePath ?? `/planned/${slugify(displayKeyword) || 'page'}`;
const existing = getPageKeyword(workspace.id, strategyPath);
if (existing) {
  const secondarySet = new Set(existing.secondaryKeywords.map(k => k.toLowerCase()));
  if (
    existing.primaryKeyword.toLowerCase() !== displayKeyword.toLowerCase()
    && !secondarySet.has(displayKeyword.toLowerCase())
  ) {
    existing.secondaryKeywords = [...existing.secondaryKeywords, displayKeyword];
  }
  upsertPageKeyword(workspace.id, existing);
} else {
  upsertPageKeyword(workspace.id, {
    pagePath: strategyPath,
    pageTitle: request.pagePath ? request.pagePath : displayKeyword,
    primaryKeyword: displayKeyword,
    secondaryKeywords: [],
  });
}
```

Imports to add (at top of file): `getPageKeyword`, `upsertPageKeyword` from `./page-keywords.js`; `slugify` from `./helpers.js` (already imported).

### Step 2 — Admin one-click add UI (KeywordStrategy.tsx)

In the "Client Keyword Feedback" `SectionCard`, render the `requestedFeedback` list above the `declinedFeedback` list. Each requested item gets an "Add to Strategy" `IconButton` that calls `keywordCommandCenter.action(workspaceId, { action: 'add_to_strategy', keyword: item.keyword })` via `useMutation`, then invalidates `queryKeys.admin.keywordFeedback(workspaceId)` and `queryKeys.admin.keywordStrategy(workspaceId)`.

### Step 3 — "Feedback since last generation" nudge (KeywordStrategy.tsx)

After deriving `requestedFeedback`, `declinedFeedback`, `approvedFeedback` at ~line 298-300, compute:

```ts
const latestFeedbackAt = keywordFeedbackRows.reduce<string | null>((max, r) => {
  const ts = r.updated_at ?? r.created_at;
  if (!ts) return max;
  return max && max > ts ? max : ts;
}, null);
const feedbackNewerThanStrategy = isRealStrategy
  && strategy?.generatedAt
  && latestFeedbackAt
  && latestFeedbackAt > strategy.generatedAt
  && (requestedFeedback.length > 0 || declinedFeedback.length > 0);
```

Render a subtle nudge banner in the JSX (after the feedback counts span, before the main content area) when `feedbackNewerThanStrategy` is truthy.

### Step 4 — "Applies at next update" note (StrategyDeclinedKeywordsSection.tsx)

Change line 44 (current text: "These keywords won't appear in future strategy recommendations. Click restore to bring them back.") to append: "Changes apply the next time the strategy is regenerated."

---

## Broadcast / invalidation wiring

ADD_TO_STRATEGY already calls `broadcastKeywordCommandCenterAction` (which uses `WS_EVENTS.STRATEGY_UPDATED`). No new WS event constant needed.

The existing `invalidateIntelligenceCache` call at line ~3354 covers the intelligence side.

Admin one-click add mutation: invalidates `queryKeys.admin.keywordFeedback` + `queryKeys.admin.keywordStrategy` on success.

No new `useWorkspaceEvents` handler needed because:
- Admin side: the `useMutation` onSuccess invalidation is sufficient for local cache sync.
- The ADD_TO_STRATEGY broadcast already exists and any listening client side hooks react to `STRATEGY_UPDATED`.

---

## Tests (TDD — write first, implement to make green)

**File:** `tests/integration/b2-client-keyword-loop.test.ts`
**Context:** `createEphemeralTestContext(import.meta.url)` — standard single-context.

### Test 1: ADD_TO_STRATEGY writes the page_keywords artifact

```
POST /api/webflow/keyword-command-center/:id/actions
  { action: 'add_to_strategy', keyword: 'seo audit tool', pagePath: '/services/seo-audit' }

→ response ok: true
→ page_keywords row exists: getPageKeyword(wsId, '/services/seo-audit')?.primaryKeyword === 'seo audit tool'
```

**Confirms:** the artifact is written, not just feedback+tracking.

### Test 2: ADD_TO_STRATEGY to a page that already has a primary keyword adds as secondary

```
Seed: upsertPageKeyword(wsId, { pagePath: '/services/seo-audit', pageTitle: 'SEO Audit', primaryKeyword: 'seo audit', secondaryKeywords: [] })
POST add_to_strategy { keyword: 'seo audit tool', pagePath: '/services/seo-audit' }
→ getPageKeyword(wsId, '/services/seo-audit')?.secondaryKeywords contains 'seo audit tool'
→ primaryKeyword still 'seo audit'
```

### Test 3: ADD_TO_STRATEGY without pagePath creates a planned page entry

```
POST add_to_strategy { keyword: 'local seo strategy' }
→ page_keywords row exists at pagePath '/planned/local-seo-strategy' (or similar slugified form)
→ primaryKeyword === 'local seo strategy'
```

### Test 4: Idempotent — re-adding same keyword to same page is a no-op (not a duplicate)

```
POST add_to_strategy { keyword: 'seo audit tool', pagePath: '/services/seo-audit' }
POST add_to_strategy { keyword: 'seo audit tool', pagePath: '/services/seo-audit' }
→ secondaryKeywords.filter(k => k === 'seo audit tool').length === 1 (no duplicate)
```

---

## Quality gates (per PR)

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full suite green
- [ ] `npm run pr-check` — zero errors
- [ ] `npm run verify:feature-flags` — clean
- [ ] `npm run verify:coverage-ratchet` — no regression
- [ ] `grep -r "purple-" src/components/client/` — clean
- [ ] `grep -r "violet\|indigo" src/components/` — clean

---

## Cross-PR contract out (to A4)

**A4 strategy-write function contract:**

```ts
// Exported from server/keyword-command-center.ts (unchanged signature, new guarantee):
export function applyKeywordCommandCenterAction(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,  // action: 'add_to_strategy', keyword, pagePath?
): KeywordCommandCenterActionResult

// POST B2: calling this with action='add_to_strategy' guarantees:
//   1. keyword_feedback.status = 'approved' (was already true)
//   2. tracked_keyword row with STRATEGY_SITE_KEYWORD source (was already true)
//   3. page_keywords row written: primaryKeyword=keyword (or secondaryKeywords appended) ← NEW
//
// A4 calls this with { action: 'add_to_strategy', keyword: trackedKeyword.query, pagePath: snapshot?.pagePath }
```

**Note:** A4 does NOT need to import `upsertPageKeyword` directly — it goes through `applyKeywordCommandCenterAction`, which now owns the page_keywords write.
