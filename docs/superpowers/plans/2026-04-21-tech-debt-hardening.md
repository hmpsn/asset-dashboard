# Tech Debt Hardening — Implementation Plan

## Overview

Deepwiki-powered tech debt scan across 5 domains identified 16 concrete issues spanning 4 areas (auth was clean). This plan addresses all of them in three parallel sprints:

- **Sprint A** — WebSocket handler gaps (3 missing handlers; UI goes stale after operations)
- **Sprint B** — Billing safeguards (6 AI-generation endpoints accessible to Free tier without usage tracking)
- **Sprint C** — Insight data validation (9 missing Zod schemas + `parseJsonFallback` → `parseJsonSafe` on DB read)
- **Sprint D** — Raw `fetch()` cleanup (6 components bypassing the typed API layer)

**Note on excluded item:** `POST /api/content-requests/:id/generate-brief` (content-requests.ts:184) is intentionally excluded. `usage-tracking.ts` documents that content briefs are Stripe-purchased add-ons, not covered by monthly tier limits. Confirm with product before adding a limit guard.

**Note on `AnalyticsInsight.data` type:** `data: InsightDataMap[T]` at `shared/types/analytics.ts:214` is correctly typed. The TypeScript-level concern from the scan was a false positive. The real issue is the missing runtime Zod validation, addressed by Sprint C.

---

## Pre-Requisites

- [x] Pre-plan audit complete — conducted via 5 parallel Deepwiki+grep agents (2026-04-21). Findings are the exhaustive input to this plan.
- [ ] No shared type changes required — all interfaces already exist in `shared/types/analytics.ts`
- [ ] No migrations required — no DB schema changes

---

## Task Dependency Graph

```
Phase 1 (all parallel — no shared file conflicts):
  Task 1 (Sprint A — WS handlers)
  Task 2 (Sprint B-workspaces — billing guards in workspaces.ts)
  Task 3 (Sprint B-other — billing guards in alt-text + brand-identity)
  Task 4 (Sprint C1 — 9 Zod schemas in insight-schemas.ts)
  Task 5 (Sprint D1 — API wrapper stubs in src/api/)

  ↓ Diff review checkpoint ↓

Phase 2 (after Phase 1 complete + diff review passes):
  Task 6 (Sprint C2 — update rowToInsight to use parseJsonSafe + schema map)
    depends on: Task 4 (schemas must exist)

  Task 7 (Sprint D2 — refactor streaming components: AssetBrowser, KeywordStrategy)
    depends on: Task 5 (API wrappers must exist)

  Task 8 (Sprint D3 — refactor export/upload components: DropZone, PostEditor, ContentBriefs, ContentTab)
    depends on: Task 5 (API wrappers must exist)

  ↓ Final diff review + quality gates ↓
```

Sequential shared-file tasks (must run after all parallel agents complete):
- `server/ws-events.ts` — owned by Task 1 only
- `src/lib/wsEvents.ts` — owned by Task 1 only
- `server/schemas/insight-schemas.ts` — owned by Task 4 only
- `server/analytics-insights-store.ts` — owned by Task 6 only (Phase 2)

---

## Phase 1 Tasks

---

### Task 1 — Sprint A: WebSocket Handler Gaps (Model: sonnet)

**Owns:**
- `server/ws-events.ts`
- `server/routes/content-posts.ts`
- `src/lib/wsEvents.ts`
- `src/hooks/useWsInvalidation.ts`

**Must not touch:** any other file

**Context:**
Three broadcast events have no frontend handler, meaning the UI goes stale after those operations:
1. `COPY_EXPORT_COMPLETE` (`copy:export_complete`) — broadcast at `copy-pipeline.ts:407,413,419`; already in both `ws-events.ts` files; missing handler in `useWsInvalidation.ts`
2. `SCHEMA_PLAN_SENT` (`schema:plan_sent`) — broadcast at `webflow-schema.ts:455`; already in both `ws-events.ts` files; missing handler in `useWsInvalidation.ts`
3. `post-updated` — broadcast at `content-posts.ts:401` as a **raw string literal** (violates pr-check rule); NOT in `WS_EVENTS`; missing handler

**Steps:**

1. **Add `POST_UPDATED` constant** to `server/ws-events.ts`:
   ```ts
   POST_UPDATED: 'post:updated',
   ```
   Place it in the content publishing section near `CONTENT_PUBLISHED`.

2. **Update the raw string broadcast** at `content-posts.ts:401`:
   ```ts
   // Before:
   broadcastToWorkspace(req.params.workspaceId, 'post-updated', { postId: req.params.postId });
   // After:
   broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
   ```
   Import `WS_EVENTS` from `'../ws-events.js'` if not already imported.

3. **Mirror `POST_UPDATED`** in `src/lib/wsEvents.ts` (the frontend copy of the constants):
   ```ts
   POST_UPDATED: 'post:updated',
   ```
   Same location (near `CONTENT_PUBLISHED`).

4. **Add 3 handlers** to `useWsInvalidation.ts` inside the `useWorkspaceEvents(workspaceId, { ... })` call:
   ```ts
   [WS_EVENTS.COPY_EXPORT_COMPLETE]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(workspaceId) });
     qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(workspaceId) });
   },
   [WS_EVENTS.SCHEMA_PLAN_SENT]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
   },
   [WS_EVENTS.POST_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
   },
   ```

5. Run `npm run typecheck` to verify no type errors.

**Return:** Summary confirming 4 files modified, 3 handlers added, raw string broadcast fixed.

---

### Task 2 — Sprint B: Billing Guards — workspaces.ts (Model: haiku)

**Owns:**
- `server/routes/workspaces.ts`

**Must not touch:** any other file

**Context:**
Three AI-generation endpoints in `workspaces.ts` call GPT-4.1 with no usage limit check. Free-tier workspaces can call these unlimited times. The pattern to follow is in `server/routes/keyword-strategy.ts:310-315` and `:2281`.

Import pattern (add to top of file if not present):
```ts
import { checkUsageLimit, incrementUsage } from '../usage-tracking.js';
```

The feature key to use is `'strategy_generations'` for all three. Tier is at `ws.tier` (or `ws.tier || 'free'`).

**Steps:**

For each of the three endpoints below, add a usage limit check immediately after loading the workspace and before the AI call, and an increment call after success:

1. **`POST /api/workspaces/:id/generate-knowledge-base`** (~line 395):
   ```ts
   const usage = checkUsageLimit(ws.id, ws.tier || 'free', 'strategy_generations');
   if (!usage.allowed) {
     return res.status(429).json({
       error: 'Monthly AI generation limit reached',
       used: usage.used,
       limit: usage.limit,
     });
   }
   ```
   After the AI call succeeds (before the `res.json(...)` response): `incrementUsage(ws.id, 'strategy_generations');`

2. **`POST /api/workspaces/:id/generate-brand-voice`** (~line 467):
   Same pattern as above.

3. **`POST /api/workspaces/:id/generate-personas`** (~line 549):
   Same pattern as above.

Important: Place `checkUsageLimit` BEFORE the AI call and `incrementUsage` AFTER success (not before). Match the pattern in `keyword-strategy.ts:310` exactly.

Run `npm run typecheck` after changes.

**Return:** Summary of 3 endpoints updated with file:line references.

---

### Task 3 — Sprint B: Billing Guards — alt-text + brand-identity (Model: haiku)

**Owns:**
- `server/routes/webflow-alt-text.ts`
- `server/routes/brand-identity.ts`

**Must not touch:** any other file

**Context:** Same billing bypass as Task 2 — AI generation endpoints without usage limit checks. Same pattern: `checkUsageLimit` before AI call, `incrementUsage` after success.

Import (add to top of each file if not present):
```ts
import { checkUsageLimit, incrementUsage } from '../usage-tracking.js';
```

Use `'strategy_generations'` as the feature key. Get workspace tier from the workspace record loaded at the top of each handler (look for `ws.tier || 'free'`).

**Steps:**

1. **`POST /api/webflow/generate-alt/:assetId`** (`webflow-alt-text.ts:34`):
   Load the workspace, get `ws.tier`, add limit check before the OpenAI call, add `incrementUsage` after the alt text is successfully generated.

2. **`POST /api/webflow/bulk-generate-alt`** (`webflow-alt-text.ts:124`):
   This generates alt text for multiple assets in a loop. Place `checkUsageLimit` once before the loop starts (guards the entire bulk operation). Place `incrementUsage` once after all assets are processed (count as one strategy generation, not N). If the check fails, return 429 immediately.

3. **`POST /api/brand-identity/:workspaceId/generate`** (`brand-identity.ts:80`):
   Same single-endpoint pattern as #1.

Run `npm run typecheck` after changes.

**Return:** Summary of 3 endpoints updated with file:line references.

---

### Task 4 — Sprint C1: Insight Zod Schemas (Model: haiku)

**Owns:**
- `server/schemas/insight-schemas.ts`

**Must not touch:** any other file

**Context:**
`server/schemas/insight-schemas.ts` currently has Zod schemas for 5 of the 14 insight types:
- ✅ `audit_finding` → `auditFindingDataSchema`
- ✅ `anomaly_digest` → `anomalyDigestDataSchema`
- ✅ `site_health` → `siteHealthInsightDataSchema`
- ✅ `page_health` → `auditPageHealthInsightDataSchema` + `pageHealthDataSchema`
- ✅ `strategy_alignment` → `strategyAlignmentDataSchema`

**Missing — add schemas for these 9 types.** All source interfaces are in `shared/types/analytics.ts`. Cross-reference field names exactly against the interface definition before writing — Zod won't catch name mismatches at compile time.

Field types to verify in `shared/types/analytics.ts`:
- `QuickWinData` → `ranking_opportunity`
- `ContentDecayData` → `content_decay`
- `CannibalizationData` → `cannibalization`
- `KeywordClusterData` → `keyword_cluster`
- `CompetitorGapData` → `competitor_gap`
- `ConversionAttributionData` → `conversion_attribution`
- `RankingMoverData` → `ranking_mover`
- `CtrOpportunityData` → `ctr_opportunity`
- `SerpOpportunityData` → `serp_opportunity`

**Rules:**
- Import `z` from `'../middleware/validate.js'` (already at top of the file)
- Required fields → `z.number()`, `z.string()`, etc.
- `T | null` fields → `z.number().nullable()`
- `'a' | 'b'` unions → `z.enum(['a', 'b'])`
- Optional fields (marked `?` in the interface) → `.optional()`
- Arrays → `z.array(z.string())`, etc.
- Export each schema as `export const xyzDataSchema = z.object({...})`
- Naming convention: camelCase interface name → `camelCaseDataSchema`
- Add a brief comment above each schema: `// --- XyzData (InsightDataMap['xyz_type']) ---`

Do NOT modify the existing schemas. Append the 9 new schemas after the last existing one.

Run `npm run typecheck` after writing.

**Return:** List of 9 schema names added with their InsightType keys.

---

### Task 5 — Sprint D1: API Wrapper Functions (Model: sonnet)

**Owns:**
- `src/api/seo.ts`
- `src/api/misc.ts`

**May read but must not modify:**
- `src/api/workspaces.ts` (for reference on patterns)
- `src/api/content.ts` (for reference on patterns)

**Must not touch:** any component files — those are Phase 2

**Context:**
6 components use raw `fetch()` directly. Before the component refactors (Phase 2), typed API wrapper functions need to exist in `src/api/`. Read the existing functions in `src/api/seo.ts` and `src/api/misc.ts` to match the pattern.

**Add the following functions:**

**In `src/api/seo.ts`:**

1. `generateAltText(assetId: string): Promise<{ altText: string }>` — wraps `POST /api/webflow/generate-alt/:assetId`

2. `bulkGenerateAltText(workspaceId: string, onProgress: (assetId: string, altText: string) => void): Promise<void>` — wraps `POST /api/webflow/bulk-generate-alt` with NDJSON streaming. This must handle the `ReadableStream` internally, call `onProgress` for each parsed line, and resolve when the stream ends. Use the existing implementation in `AssetBrowser.tsx:246` as reference for the stream parsing logic — extract it, don't reinvent it.

3. `streamKeywordStrategy(workspaceId: string, onChunk: (text: string) => void, onDone: () => void, onError: (err: Error) => void): Promise<() => void>` — wraps `POST /api/webflow/keyword-strategy/:workspaceId` SSE stream. Returns a cleanup function that aborts the fetch. Use the existing implementation in `KeywordStrategy.tsx:156` as reference.

**In `src/api/misc.ts`:**

4. `exportPostPdf(workspaceId: string, postId: string): Promise<Blob>` — wraps `GET /api/content-posts/:workspaceId/:postId/export/pdf`. Returns blob for download.

5. `exportBrief(workspaceId: string, briefId: string): Promise<Blob>` — wraps `GET /api/content-briefs/:workspaceId/:briefId/export`. Returns blob for download.

**In `src/api/workspaces.ts`:**

6. `uploadDropZoneFile(endpoint: string, formData: FormData): Promise<{ url: string }>` — wraps the generic `POST` file upload in `DropZone.tsx:34`. Check `DropZone.tsx` for the actual endpoint and response shape before writing.

For functions 4, 5, 6: the auth header pattern (`x-auth-token` from localStorage) should match the existing helpers in `src/api/misc.ts` or `src/api/workspaces.ts`.

Run `npm run typecheck` after writing.

**Return:** List of 6 functions added with their file locations and signatures.

---

## Phase 2 Tasks

> Only start Phase 2 after Phase 1 diff review passes (see Diff Review Checkpoint below).

---

### Task 6 — Sprint C2: Insight Store Validation (Model: sonnet)

**Owns:**
- `server/analytics-insights-store.ts`
- `server/schemas/insight-schemas.ts` (add schema map only — do not modify existing schemas)

**Must not touch:** any other file

**Context:**
`rowToInsight` at `analytics-insights-store.ts:104` uses:
```ts
data: parseJsonFallback(row.data, {} as InsightDataMap[InsightType]),
```
This casts without validating. Corrupt DB data silently becomes `{}`. The fix is a `INSIGHT_DATA_SCHEMA_MAP` that maps each `InsightType` to its Zod schema, then calls `parseJsonSafe` with the right schema.

**Steps:**

1. **Add `INSIGHT_DATA_SCHEMA_MAP`** to the bottom of `server/schemas/insight-schemas.ts`:
   ```ts
   import type { InsightType } from '../../shared/types/analytics.js';
   import type { ZodType } from 'zod';

   export const INSIGHT_DATA_SCHEMA_MAP: Record<InsightType, ZodType<unknown>> = {
     page_health: pageHealthDataSchema,
     ranking_opportunity: rankingOpportunityDataSchema,
     content_decay: contentDecayDataSchema,
     cannibalization: cannibalizationDataSchema,
     keyword_cluster: keywordClusterDataSchema,
     competitor_gap: competitorGapDataSchema,
     conversion_attribution: conversionAttributionDataSchema,
     ranking_mover: rankingMoverDataSchema,
     ctr_opportunity: ctrOpportunityDataSchema,
     serp_opportunity: serpOpportunityDataSchema,
     strategy_alignment: strategyAlignmentDataSchema,
     anomaly_digest: anomalyDigestDataSchema,
     audit_finding: auditFindingDataSchema,
     site_health: siteHealthInsightDataSchema,
   };
   ```
   Use `pageHealthDataSchema` (the `pageHealthDataSchema` variant, not `auditPageHealthInsightDataSchema`) for `page_health` — it's the read-path schema matching the stored data shape.

2. **Update `rowToInsight`** in `server/analytics-insights-store.ts`:
   - Import `INSIGHT_DATA_SCHEMA_MAP` from `'../schemas/insight-schemas.js'`
   - Import `parseJsonSafe` from `'../db/json-validation.js'`
   - Replace:
     ```ts
     data: parseJsonFallback(row.data, {} as InsightDataMap[InsightType]),
     ```
     With:
     ```ts
     data: parseJsonSafe(
       row.data,
       INSIGHT_DATA_SCHEMA_MAP[row.insight_type as InsightType],
       {} as InsightDataMap[InsightType],
       { table: 'analytics_insights', field: 'data', workspaceId: row.workspace_id },
     ),
     ```
   - Keep the `parseJsonFallback` import only if it's used elsewhere in the file; remove if `rowToInsight` was the only caller.

3. Run `npm run typecheck` to verify no type errors.

**Return:** Confirmation that `INSIGHT_DATA_SCHEMA_MAP` added and `rowToInsight` updated, with the specific line that changed.

---

### Task 7 — Sprint D2: Streaming Fetch Refactor (Model: sonnet)

**Owns:**
- `src/components/AssetBrowser.tsx`
- `src/components/KeywordStrategy.tsx`

**Must not touch:** `src/api/seo.ts` (owned by Phase 1 Task 5 — read it, don't modify)

**Context:**
Both components use raw `fetch()` for streaming responses. Phase 1 (Task 5) created typed wrappers in `src/api/seo.ts`. Replace the inline stream logic with calls to those wrappers.

**Steps:**

1. **`AssetBrowser.tsx:246`** — Replace the raw `fetch('/api/webflow/bulk-generate-alt', ...)` + NDJSON stream reading with a call to `bulkGenerateAltText(workspaceId, onProgress)` from `src/api/seo.ts`. The `onProgress` callback should update the same local state the current implementation uses.

2. **`KeywordStrategy.tsx:156`** — Replace the raw `fetch('/api/webflow/keyword-strategy/${workspaceId}', ...)` + SSE stream reading with a call to `streamKeywordStrategy(workspaceId, onChunk, onDone, onError)` from `src/api/seo.ts`. Ensure the cleanup function returned by `streamKeywordStrategy` is called in any `useEffect` cleanup or on component unmount.

For both: verify the component's loading/error/success states still work correctly after the refactor. Do not change the UX behavior — only replace the transport layer.

Run `npm run typecheck` after changes.

**Return:** Confirmation both files updated with before/after line count for the stream sections.

---

### Task 8 — Sprint D3: Export/Upload Fetch Refactor (Model: haiku)

**Owns:**
- `src/components/DropZone.tsx`
- `src/components/PostEditor.tsx`
- `src/components/ContentBriefs.tsx`
- `src/components/client/ContentTab.tsx`

**Must not touch:** `src/api/misc.ts`, `src/api/workspaces.ts` (owned by Phase 1 Task 5 — read them, don't modify)

**Context:**
Four components use raw `fetch()` for file upload or blob export. Phase 1 (Task 5) created typed wrappers. Replace each raw call.

**Steps:**

1. **`DropZone.tsx:34`** — Replace `fetch(endpoint, { method: 'POST', body: formData })` with `uploadDropZoneFile(endpoint, formData)` from `src/api/workspaces.ts`. Handle the response/error the same way the current code does.

2. **`PostEditor.tsx:211`** — Replace `fetch('/api/content-posts/${workspaceId}/${postId}/export/pdf')` with `exportPostPdf(workspaceId, postId)` from `src/api/misc.ts`. The download-to-browser pattern (creating a temporary `<a>` element) stays in the component — only the fetch call changes.

3. **`ContentBriefs.tsx:284`** — Replace `fetch('/api/content-briefs/${workspaceId}/${b.id}/export')` with `exportBrief(workspaceId, b.id)` from `src/api/misc.ts`. Same download-to-browser pattern.

4. **`ContentTab.tsx:485`** — Replace the inline `fetch('/api/content-briefs/${workspaceId}/${brief.id}/export').then(...).catch(...)` inside the `onClick` with `exportBrief(workspaceId, brief.id)`. Extract it from the inline arrow function — move to a handler function `handleExport(brief)` above the JSX return for readability.

Run `npm run typecheck` after changes.

**Return:** Confirmation of 4 files updated, noting any edge cases discovered.

---

## Diff Review Checkpoint (between Phase 1 and Phase 2)

Before dispatching Phase 2, run all of these:

```bash
git diff --stat                    # Verify only expected files changed
npm run typecheck                  # Zero errors
npx vite build                     # Build succeeds
npx vitest run                     # Full suite passes
npx tsx scripts/pr-check.ts       # Zero errors (raw string broadcast fixed by Task 1)
```

Check for:
- `server/routes/content-posts.ts:401` — should now use `WS_EVENTS.POST_UPDATED`, not `'post-updated'`
- `server/schemas/insight-schemas.ts` — 9 new schema exports present
- `src/api/seo.ts` — 3 new functions present, no TypeScript errors
- `src/api/misc.ts` — 2 new functions present
- `src/api/workspaces.ts` — 1 new function present

Only dispatch Phase 2 after all gates pass.

---

## Systemic Improvements

### pr-check rules to add (after this sprint merges)
- **Raw string broadcast** — already enforced by pr-check. Verify Task 1 clears the existing violation.
- **No raw `fetch()` in components** — consider adding a pr-check rule: grep for `await fetch(` in `src/components/` and fail if found. This prevents the pattern from reappearing.
- **AI endpoint without usage check** — consider a pr-check rule: grep `server/routes/` files that contain `callOpenAI\|callAnthropic\|callAI` but NOT `checkUsageLimit|incrementUsage`. Would need an escape hatch for intentional exceptions (e.g. admin-only tools).

### Shared utilities
- `INSIGHT_DATA_SCHEMA_MAP` (Task 6) is the canonical registry — any future insight type must add an entry here AND to `InsightDataMap`. Consider adding a pr-check rule that checks `InsightType` union length equals `Object.keys(INSIGHT_DATA_SCHEMA_MAP).length`.

### Tests to add (after Phase 2)
- **Insight schema coverage**: `tests/unit/insight-schemas.test.ts` — for each `InsightType`, parse a valid fixture through `INSIGHT_DATA_SCHEMA_MAP[type]` and assert it passes. Parse a corrupt string and assert it returns the fallback `{}`. This confirms schema completeness and `parseJsonSafe` integration.
- **Billing bypass guard**: add to each billing-guarded endpoint's integration test — call the endpoint with a Free-tier workspace that has `strategy_generations >= 0` (limit is 0 for Free), assert HTTP 429. Existing keyword-strategy tests demonstrate the pattern.
- **WS handler coverage**: add to `tests/contract/ws-handler-coverage.test.ts` (or create it) — enumerate all `WS_EVENTS` keys and assert each has a handler registered in `useWsInvalidation.ts`. Prevents this class of gap from recurring.

---

## Verification Strategy

**After Phase 1:**
```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```
- pr-check should show 0 violations on the raw string broadcast rule

**After Phase 2 (full quality gates):**
```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

**Manual spot-checks after deploy to staging:**
- Trigger a copy export (Webflow CMS or CSV) — verify the copy pipeline panel updates without a page refresh
- Send a schema plan from the Webflow schema screen — verify the blueprint panel refreshes
- Add voice feedback to a content post — verify the post card updates in real-time
- On a Free-tier workspace, attempt knowledge base generation — verify 429 response
- On a Growth-tier workspace, generate knowledge base 4 times (limit is 3) — verify 4th call returns 429
- Inspect corrupt insight data in DB directly (`UPDATE analytics_insights SET data = 'bad' WHERE ...`) — verify the insight still loads (returns `{}` fallback) and doesn't crash the insight feed

---

## File Ownership Summary

| Task | Phase | Files Owned |
|------|-------|-------------|
| Task 1 (WS handlers) | 1 | `server/ws-events.ts`, `server/routes/content-posts.ts`, `src/lib/wsEvents.ts`, `src/hooks/useWsInvalidation.ts` |
| Task 2 (billing workspaces) | 1 | `server/routes/workspaces.ts` |
| Task 3 (billing alt-text+brand) | 1 | `server/routes/webflow-alt-text.ts`, `server/routes/brand-identity.ts` |
| Task 4 (insight schemas) | 1 | `server/schemas/insight-schemas.ts` |
| Task 5 (API wrappers) | 1 | `src/api/seo.ts`, `src/api/misc.ts`, `src/api/workspaces.ts` |
| Task 6 (insight store) | 2 | `server/analytics-insights-store.ts`, adds to `server/schemas/insight-schemas.ts` |
| Task 7 (streaming refactor) | 2 | `src/components/AssetBrowser.tsx`, `src/components/KeywordStrategy.tsx` |
| Task 8 (export refactor) | 2 | `src/components/DropZone.tsx`, `src/components/PostEditor.tsx`, `src/components/ContentBriefs.tsx`, `src/components/client/ContentTab.tsx` |

No two tasks share an owned file. Tasks 4 and 6 both touch `insight-schemas.ts` but in sequential phases — Task 6 only appends the `INSIGHT_DATA_SCHEMA_MAP` after Task 4's schemas exist.
