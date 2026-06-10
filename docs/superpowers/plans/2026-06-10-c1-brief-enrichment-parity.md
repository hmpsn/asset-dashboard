# C1 — Request-driven brief enrichment parity (audit #3)
> Plan authored 2026-06-10 against `staging` head (`81349230`).
> Branch: `claude/core-c1-brief-enrichment-parity`

## Problem

`generateBriefForRequest` (`server/content-brief-generation-job.ts:203-309`) already does GSC / SEO-provider / GA4 / decay enrichment, but silently skips:

1. **SERP scraping + reference-URL scraping** — the standalone path does both at `lines 114-143` via `scrapeUrls` / `scrapeSerpData`.
2. **Outcome recording** — the standalone path records a `brief_created` action at `line 176` via `recordAction()`; the request path writes zero outcome rows.

This means client-PAID content requests receive the platform's weakest brief (no evidence context, no outcome traceability), while free standalone briefs receive the full enriched path.

## Scope

1. **Extract `collectBriefEnrichment`** from the standalone enrichment block — a shared helper that encapsulates ref scraping + SERP scraping + GA4 style-page derivation. The helper is exported so C4 can consume its output shape.
2. **Call `collectBriefEnrichment` from `generateBriefForRequest`** so the request path gets the same evidence.
3. **Add `recordAction` on the request path** mirroring the standalone call, using `sourceType: 'content_request'` to distinguish request-originated briefs.

All changes stay within `server/content-brief-generation-job.ts` plus the new helper module.

---

## C4 Contract (Rule 1 — pre-committed here, consumed by C4)

```typescript
// server/content-brief-scrape-enrichment.ts

export interface BriefScrapeEnrichmentInput {
  /** Target keyword used for SERP scraping */
  targetKeyword: string;
  /** HTTP-prefixed reference URLs to scrape (already validated); max 5 consumed */
  referenceUrls?: string[];
  /** Public GA4-derived top-page URLs to use as style examples; max 2 consumed */
  stylePageUrls?: string[];
}

export interface BriefScrapeEnrichment {
  /** Scraped content from reference URLs (empty if none provided or all fail) */
  scrapedRefs: import('./web-scraper.js').ScrapedPage[];
  /** Live SERP data for the keyword (null on failure — FM-2 degradation) */
  serpData: import('./web-scraper.js').SerpData | null;
  /** Scraped top-performing pages from GA4 for style examples (empty if none) */
  stylePages: import('./web-scraper.js').ScrapedPage[];
}

/**
 * Collect live web-scrape enrichment for a brief.
 * Never throws — degrades gracefully on scraper failure (FM-2 pattern).
 */
export async function collectBriefEnrichment(
  input: BriefScrapeEnrichmentInput,
): Promise<BriefScrapeEnrichment>;
```

The output shape maps directly to the `generateBrief()` call-site fields:
- `scrapedRefs` → `scrapedReferences`
- `serpData` → `serpData`
- `stylePages` → `styleExamples`

---

## File ownership

**OWNS:**
- `server/content-brief-generation-job.ts` (caller changes)
- `server/content-brief-scrape-enrichment.ts` (new helper)
- `tests/integration/content-brief-request-enrichment.test.ts` (new test file)

**READS (must NOT modify):**
- `server/web-scraper.ts`
- `server/outcome-tracking.ts`
- `server/routes/content*.ts`

---

## Test assertions (TDD gate — tests authored first, implementation second)

### Happy path: request path gets scraping parity
- Mock `scrapeUrls` to return a seeded `ScrapedPage` array and `scrapeSerpData` to return a seeded `SerpData` object.
- Run `runContentBriefGenerationJob(jobId, { source: 'request', ... })`.
- Assert: `job.result.brief.scrapedReferences` is non-empty (matches mock return).
- Assert: `job.result.brief.serpData` is populated (matches mock return).

### Happy path: request path records an action
- After the job completes, query `getActionByWorkspaceAndSource(workspaceId, 'content_request', brief.id)`.
- Assert: action exists with `actionType: 'brief_created'` and `sourceType: 'content_request'`.
- Assert: `targetKeyword` matches the request keyword.

### FM-2: scraper throws → brief still generates, evidence fields empty
- Mock `scrapeUrls` and `scrapeSerpData` to throw.
- Run the job.
- Assert: job status is `'done'` (not `'error'`).
- Assert: `brief.scrapedReferences` is undefined or empty (no fake success).
- Assert: `brief.serpData` is undefined.
- Assert: warn log captured (not error-level crash).

### FM-2: recordAction throws → job completes with warn, not crash
- Mock `recordAction` to throw.
- Run the job.
- Assert: job status is `'done'`.
- Assert: brief is created normally.

### Parity: standalone path behavior unchanged
- Run `runContentBriefGenerationJob(jobId, { source: 'standalone', ... })`.
- Assert: `scrapedReferences` populated (existing behavior preserved).
- Assert: `getActionByWorkspaceAndSource(workspaceId, 'brief', brief.id)` exists (existing outcome recording preserved).

---

## Implementation plan

### Step 1 — New module `server/content-brief-scrape-enrichment.ts`

Extract the scrape block from `generateStandaloneBrief` (lines 114-143) into `collectBriefEnrichment`. Key behaviors:
- Dynamic import of `web-scraper.js` (same pattern: `// dynamic-import-ok — lazy-loaded per job`).
- `Promise.all([scrapeUrls, scrapeSerpData, scrapeUrls])` with `.catch(() => null)` / empty fallback on scraper failure.
- Filters `referenceUrls` to valid HTTP URLs (max 5) — same as standalone path.
- Takes `stylePageUrls` already computed by the caller (keeps GA4 logic in the job file).
- Returns `{ scrapedRefs, serpData, stylePages }` typed as `BriefScrapeEnrichment`.

### Step 2 — Refactor `generateStandaloneBrief`

Replace the inline scrape block (lines 114-143) with a call to `collectBriefEnrichment`. Behavior identical; the `refUrlList` + `topPageUrls` computation stays in the standalone function as it depends on `referenceUrls` param / GA4 result which is standalone-specific.

### Step 3 — Add scraping to `generateBriefForRequest`

After the GA4 block:
1. Derive `refUrlList` from `request.referenceUrls` (same filter as standalone: HTTP-prefixed, max 5).
2. Derive `stylePageUrls` from GA4 `topPageUrls` (same GA4 quality-sort logic as standalone).
3. Call `collectBriefEnrichment({ targetKeyword: request.targetKeyword, referenceUrls: refUrlList, stylePageUrls })`.
4. Pass `enrichment.scrapedRefs`, `enrichment.serpData`, `enrichment.stylePages` to `generateBrief()` at the existing call site.

### Step 4 — Add `recordAction` on request path

After `updateContentRequest`, before `broadcastToWorkspace`:

```typescript
try {
  recordAction({ // recordAction-ok — workspaceId validated before job creation
    workspaceId,
    actionType: 'brief_created',
    sourceType: 'content_request',
    sourceId: brief.id,
    pageUrl: null,
    targetKeyword: request.targetKeyword,
    baselineSnapshot: {
      captured_at: new Date().toISOString(),
    },
    attribution: 'platform_executed',
  });
} catch (err) {
  log.warn({ err, keyword: request.targetKeyword }, 'Failed to record outcome action for request brief creation');
}
```

---

## pr-check considerations

- `recordAction()` is called in a `try/catch` with `workspaceId` from the outer scope (validated at job-creation time). The `// recordAction-ok` hatch satisfies the pr-check rule.
- No `JSON.parse` on DB columns introduced.
- No new AI calls — no AI-call-before-DB-write race applies.
- The new helper uses a dynamic import (`// dynamic-import-ok — lazy-loaded per job`).

---

## Verification commands

```sh
npm run typecheck
npx vite build
npx vitest run tests/integration/content-brief-request-enrichment.test.ts --reporter=verbose
npx vitest run
npm run pr-check
npm run verify:feature-flags
npm run verify:coverage-ratchet
```
