# C2 — Sync AI Routes → Background Job Platform (Absorbed 4b)

**Branch:** `claude/core-c2-sync-ai-to-jobs`  
**Lane:** C (Content), before C3 (#12)  
**Model:** Sonnet. Reviewer: Opus.

---

## 1. Scope

Migrate 5 sync AI routes to the background job platform. Each returns `{ jobId }`, registers in `BACKGROUND_JOB_TYPES`, surfaces via `useBackgroundTasks` + TaskPanel.

| # | Route | File | Function | Current issue |
|---|-------|------|----------|---------------|
| 1 | `POST /api/copy/:wsId/:bpId/:entryId/generate` | `server/routes/copy-pipeline.ts:122-157` | `generateCopyForEntry` | Sync AI call inline in route handler |
| 2 | `POST /api/page-strategy/:wsId/generate` | `server/routes/page-strategy.ts:138-159` | `generateBlueprint` | Sync AI call inline in route handler |
| 3 | `GET /api/llms-txt/:wsId` | `server/routes/llms-txt.ts:16-25` | `generateLlmsTxt` | Sync AI + URL validation + CMS sitemap crawl |
| 4 | `GET /api/llms-txt/:wsId/download` | `server/routes/llms-txt.ts:27-38` | `generateLlmsTxt` | Same as #3 (duplicate) |
| 5 | `GET /api/llms-txt/:wsId/download-full` | `server/routes/llms-txt.ts:40-51` | `generateLlmsTxt` | Same as #3 (duplicate) |
| 6 | `POST /api/aeo-review/:wsId/site` | `server/routes/aeo-review.ts:108-218` | `reviewSitePages` | Multi-page crawl + batched AI |

**Note on llms-txt:** The 3 GET routes all call `generateLlmsTxt`. After migration, routes #3/#4/#5 become:
- `POST /api/llms-txt/:wsId/generate` — starts job, returns `{ jobId }` 
- `GET /api/llms-txt/:wsId` — returns last stored result (no-op if not yet generated); **read-only, no change**
- `GET /api/llms-txt/:wsId/download` and `/download-full` — stay as-is (serve stored result; the frontend already calls `llmsTxt.generate()` then shows download buttons after result is available)

**Note on LinkChecker / internal-links:** Verified at plan time:
- `GET /api/webflow/link-check/:siteId` in `webflow-analysis.ts:178` — calls `checkSiteLinks` (HTTP crawl, no AI). This is a crawl, but it's scoped to the plan-specified targets (llms-txt ×3, AEO site review, LinkChecker, internal-links). **Including it in scope as it's a slow crawl.**
- `GET /api/webflow/internal-links/:siteId` in `webflow-analysis.ts:247` — calls `analyzeInternalLinks` (reads Webflow pages + builds graph; calls `callAI` for suggestions). **Including it.**
- These two are in `webflow-analysis.ts`, NOT `copy-pipeline.ts` or `page-strategy.ts`. Lane C owns: `server/routes/copy-pipeline.ts`, `server/routes/page-strategy.ts`, `server/routes/llms-txt.ts`, `server/routes/aeo-review.ts`. The two webflow-analysis routes are adjacent but in a file NOT owned by Lane C in the master plan. 

**DECISION: Scope is the 6 routes above (copy generate, blueprint generate, llms-txt ×3, AEO site review).** The `link-check` and `internal-links` routes in `webflow-analysis.ts` are NOT in Lane C ownership; they are pre-existing with `// background-generation-ok` hatches and are out-of-scope for this PR. This is documented so the reviewer does not flag them as missed.

---

## 2. New BACKGROUND_JOB_TYPES entries

Add to `shared/types/background-jobs.ts`:

```typescript
COPY_ENTRY_GENERATION: 'copy-entry-generation',     // #1 — single entry
BLUEPRINT_GENERATION: 'blueprint-generation',        // #2
LLMS_TXT_GENERATION: 'llms-txt-generation',          // #3/#4/#5
AEO_SITE_REVIEW: 'aeo-site-review',                  // #6
```

Metadata:
```typescript
'copy-entry-generation': {
  label: 'Copy Entry Generation',
  description: 'Generates copy sections for a blueprint entry.',
  cancellable: false,
  resultBehavior: 'domain-store',
},
'blueprint-generation': {
  label: 'Blueprint Generation',
  description: 'Generates a blueprint from workspace intelligence.',
  cancellable: false,
  resultBehavior: 'domain-store-and-result',
},
'llms-txt-generation': {
  label: 'LLMs.txt Generation',
  description: 'Generates an LLMs.txt file with AI page summaries.',
  cancellable: false,
  resultBehavior: 'domain-store-and-result',
},
'aeo-site-review': {
  label: 'AEO Site Review',
  description: 'Runs an AI-powered AEO review across site pages.',
  cancellable: false,
  resultBehavior: 'domain-store-and-result',
},
```

---

## 3. New job runner modules

| Module | Pattern |
|--------|---------|
| `server/copy-entry-generation-job.ts` | Wraps `generateCopyForEntry`; updates job progress; calls `broadcastToWorkspace` + `addActivity` on completion |
| `server/blueprint-generation-job.ts` | Wraps `generateBlueprint`; stores result to domain; broadcasts |
| `server/llms-txt-generation-job.ts` | Wraps `generateLlmsTxt`; result stored in existing `llms_txt_cache` + `setLastGenerated`; broadcasts |
| `server/aeo-site-review-job.ts` | Wraps the crawl + `reviewSitePages`; calls `saveReview` (from existing route helper); broadcasts |

Each runner:
1. `updateJob(jobId, { status: 'running', message: '...' })`
2. Calls the domain function
3. On success: writes domain store, `addActivity`, `broadcastToWorkspace`, `updateJob({ status: 'done', result, ... })`
4. On failure: `updateJob({ status: 'error', error: err.message })`
5. `finally`: `unregisterAbort(jobId)`

---

## 4. Route changes

### copy-pipeline.ts — POST /:wsId/:bpId/:entryId/generate
Replace the inline `generateCopyForEntry` call with:
```typescript
const job = createJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, { workspaceId, message: `Generating copy for "${entry?.name ?? entryId}"` });
registerAbort(job.id); // job doesn't support cancellation but must call unregisterAbort in finally
setImmediate(() => runCopyEntryGenerationJob({ jobId: job.id, workspaceId, blueprintId, entryId, accumulatedSteering }));
return res.json({ jobId: job.id });
```

### page-strategy.ts — POST /:wsId/generate
Same pattern with `BACKGROUND_JOB_TYPES.BLUEPRINT_GENERATION`.

### llms-txt.ts
- `GET /:wsId` — change to `POST /:wsId/generate`, starts job, returns `{ jobId }`. Keep `GET /:wsId` returning last stored result (no-op, no generation).
- `GET /:wsId/download` and `/download-full` — no change (serve the stored file, no AI call).

**API client change:** `src/api/content.ts` `llmsTxt.generate` changes from `GET` to `POST` (already a function call, swap the method). `src/components/LlmsTxtGenerator.tsx` call-site swaps to use the job pattern via the shared hook.

### aeo-review.ts — POST /:wsId/site
Replace inline crawl + AI with job pattern.

---

## 5. Rule 1 contract: shared job-progress hook (C3 consumes)

**File:** `src/hooks/useJobProgress.ts`

```typescript
/** 
 * useJobProgress — shared hook for editor-adjacent AI generation jobs.
 * C2 defines this contract; C3 and all subsequent generation UI MUST consume it.
 * Never re-implement start→track→invalidate inline.
 *
 * @param jobType - The BACKGROUND_JOB_TYPES key
 * @param queryKeys - React Query keys to invalidate when job reaches 'done'
 * @param workspaceId - workspace scope
 */
export function useJobProgress(
  jobType: BackgroundJobType,
  queryKeys: QueryKey[],
  workspaceId: string,
): {
  startJob: (params: Record<string, unknown>) => Promise<string | null>;
  isRunning: boolean;
  jobId: string | null;
  error: string | null;
}
```

Internally:
1. Gets `BackgroundTaskContext` via `useBackgroundTasks()`
2. `startJob(params)` → calls `context.startJob(jobType, { workspaceId, ...params })` → returns `jobId`
3. Watches for terminal status via `findLatestTerminalJob({ type: jobType, workspaceId })`
4. On `'done'` → invalidates the provided `queryKeys` via `useQueryClient()`
5. Returns `isRunning = findActiveJob({ type: jobType, workspaceId }) !== undefined`

The hook returns `{ startJob, isRunning, jobId, error }`.

**Contract for C3 and later consumers:** import `useJobProgress` from `src/hooks/useJobProgress.ts`. Pass the job type + query keys + workspaceId. Never call `useBackgroundTasks().startJob` directly for generation flows that need query invalidation.

---

## 6. Frontend call-site changes

| Component / Hook | Change |
|---|---|
| `src/hooks/admin/useCopyPipeline.ts:useGenerateCopy` | Replace `useMutation(copyGeneration.generate(...))` with `useJobProgress(COPY_ENTRY_GENERATION, copySectionsKeys, wsId)` |
| `src/api/brand-engine.ts:blueprints.generate` | Update return type to `{ jobId: string }` |
| `src/hooks/admin/useBlueprints.ts` (if exists) or the call-site in `BlueprintDetail.tsx` | Swap to `useJobProgress(BLUEPRINT_GENERATION, ...)` |
| `src/components/LlmsTxtGenerator.tsx` | `generate()` callback becomes `useJobProgress(LLMS_TXT_GENERATION, [llmsTxtFreshnessKey], wsId).startJob({})` |
| `src/components/AeoReview.tsx:runSiteReview` | Swap to `useJobProgress(AEO_SITE_REVIEW, [], wsId).startJob({ maxPages })` |

---

## 7. WS events

Add to `server/ws-events.ts`:
```typescript
LLMS_TXT_GENERATED: 'llms_txt:generated',
AEO_SITE_REVIEW_COMPLETE: 'aeo_review:complete',
```

Copy pipeline already has `COPY_SECTION_UPDATED` / `COPY_METADATA_UPDATED` — use those. Blueprint already has `BLUEPRINT_GENERATED`.

---

## 8. Test assertions (TDD integration)

**Test file:** `tests/integration/c2-ai-to-jobs.test.ts` (port 13879)

For each migrated route:

**Happy path:**
- `POST` returns `200` with `{ jobId: string }`
- Poll `GET /api/jobs/:jobId` until terminal; assert `status === 'done'`
- For copy/blueprint/llms-txt/aeo: assert domain store contains the result (domain-specific read)

**FM-2 (provider failure → job failed):**
- Mock AI function to throw
- POST → `{ jobId }`
- Poll until terminal; assert `status === 'error'`
- Assert no partial-success data written

**Non-existent workspace:**
- POST with unknown workspaceId → `404`

**Schema validation:**
- Invalid body → `400` (Zod rejection BEFORE job creation)

---

## 9. Systemic improvement: pr-check rule

Extend the existing `background-generation-ok` hatch check to flag any route file in the Lane C owned set that still has a direct `await callAI(...)` or `await generateX(...)` inside a route handler without either returning `{ jobId }` or having `// background-generation-ok: <reason>`.

Authoring note: add to `scripts/pr-check.ts` CHECKS array after implementation.

---

## 10. Verification commands

```bash
npm run typecheck
npx vite build
npx vitest run tests/integration/c2-ai-to-jobs.test.ts
npx vitest run
npm run pr-check
npm run verify:feature-flags
npm run verify:coverage-ratchet
```

---

## 11. File ownership (Lane C exclusive while PR is open)

**OWNS:**
- `server/routes/copy-pipeline.ts` — generate endpoint only
- `server/routes/page-strategy.ts` — generate endpoint only
- `server/routes/llms-txt.ts`
- `server/routes/aeo-review.ts`
- `server/copy-entry-generation-job.ts` (new)
- `server/blueprint-generation-job.ts` (new)
- `server/llms-txt-generation-job.ts` (new)
- `server/aeo-site-review-job.ts` (new)
- `shared/types/background-jobs.ts` (add entries; no other lane modifies this file this PR)
- `server/ws-events.ts` (add 2 constants)
- `src/hooks/useJobProgress.ts` (new)
- `src/hooks/admin/useCopyPipeline.ts` (useGenerateCopy mutation swap)
- `src/api/brand-engine.ts` (blueprints.generate return type)
- `src/api/content.ts` (llmsTxt.generate method change)
- `src/components/LlmsTxtGenerator.tsx`
- `src/components/AeoReview.tsx`
- Blueprint call-site in `src/components/brand/BlueprintDetail.tsx`
- `tests/integration/c2-ai-to-jobs.test.ts` (new)
- `docs/superpowers/plans/2026-06-10-c2-sync-ai-to-jobs.md` (this file)

**READS (do not modify):**
- `server/jobs.ts` — pattern reference
- `server/copy-generation.ts` — called by the new job runner
- `server/blueprint-generator.ts` — called by the new job runner  
- `server/llms-txt-generator.ts` — called by the new job runner
- `server/aeo-page-review.ts` — called by the new job runner

---

## 12. Commit plan

1. **Shared contracts first:** `shared/types/background-jobs.ts` + `server/ws-events.ts` + `src/hooks/useJobProgress.ts` — types must exist before server or frontend imports them
2. **Job runners:** 4 new `server/*-job.ts` modules
3. **Route migration:** copy-pipeline, page-strategy, llms-txt, aeo-review
4. **Frontend call-site swaps:** api modules + hooks + components
5. **Tests**
6. **Plan doc update** with final SHAs
