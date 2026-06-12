# C4 — Persist AI review results + scraped source text (audit #16)

> Lane C, 2026-06-10 core-features remediation run. Serialized after C3 (PR #1187, merged).
> Branch: `claude/core-c4-persist-review-results`. Single agent (Sonnet-class), single PR.

## Citation re-verification (post-C3 drift)

The audit cited `content-posts.ts:570-581` (pre-C3). After C3's rewrite of
`server/routes/content-posts.ts`:

| Audit citation | Current location | Verified |
|---|---|---|
| AI review route `content-posts.ts:570-581` | `server/routes/content-posts.ts:453-534` (`POST /api/content-posts/:workspaceId/:postId/ai-review`) — verdicts returned via `res.json({ review, evidence })`, never persisted | ✓ |
| C1 enrichment helper output shape | `server/content-brief-scrape-enrichment.ts:36-43` — `BriefScrapeEnrichment { scrapedRefs: ScrapedPage[]; serpData: SerpData \| null; stylePages: ScrapedPage[] }`. Header explicitly says "C4 (#16) will persist the output shape" | ✓ |
| Brief generation persistence seam | `server/content-brief-generation-job.ts:131` (standalone) and `:249` (request) — both call `collectBriefEnrichment` then `generateBrief` which drops `bodyText`/`snippet`/`fetchedAt` (only PAA strings + position/title/url survive as `realPeopleAlsoAsk`/`realTopResults`, `content-brief.ts:1503-1506`) | ✓ |
| `ScrapedPage` shape | `server/web-scraper.ts:14-22` — `bodyText` pre-truncated to 3000 chars (`:116`), so worst-case stored blob ≈ 5 refs + 2 style pages ≈ 25 KB | ✓ |

Additional discovery: **public passthrough leak risk.** `server/routes/public-content.ts`
returns full domain objects to clients (`res.json(brief)` at :506, `res.json(post)` at :695,
`res.json(updated)` at :853). New admin-internal columns must be stripped there, per the
DB-column-+-mapper-lockstep rule ("public endpoint serialization list if the field is
client-facing" — these fields are NOT client-facing, so the public boundary must omit them).

## Design

### Part 1 — Persist AI review verdicts (post)

- New shared type `StoredAIReview` in `shared/types/content.ts`:
  `{ review: AIReviewMap; evidence?: ContentReviewEvidence; reviewedAt: string; model?: string }`.
  `GeneratedPost.aiReview?: StoredAIReview`.
- New column `content_posts.ai_review TEXT` (migration 132). Row interface + `rowToPost` +
  `postToParams` + insert/update SQL in `server/content-posts-db.ts`, same commit (lockstep).
- Zod: `storedAiReviewSchema` in `server/schemas/content-schemas.ts`. `evidence`/`model`
  optional (write path omits evidence when the brief has no saved sources — schema-vs-stored-shape
  rule). Parsed via `parseJsonSafe` with table/field context, fallback `null` → `undefined`.
- Route seam (`server/routes/content-posts.ts` ai-review handler): persist the
  **post-provenance-marking** map (so `factual_accuracy`/`no_hallucinations` are stored as
  `pass: false` + `humanReviewRequired` — never raw AI passes; content-quality-grounding
  preserved). `updatePostField(wsId, postId, { aiReview })`, then `addActivity` (new
  `'post_ai_review'` ActivityType, admin-only — NOT added to CLIENT_VISIBLE_TYPES) and
  `notifyContentUpdated(wsId, { postId, action: 'ai_review_completed' })`.
  Response stays `{ review, evidence }` — frontend contract unchanged.
- Broadcast halves: `CONTENT_UPDATED` is an existing `ws-events.ts` constant with an existing
  frontend handler (`src/hooks/useWsInvalidation.ts:31` invalidation registry). No new event
  needed; both halves already wired.
- `researchMode: true` + `responseFormat: { type: 'json_object' }` on the review call are
  untouched.

### Part 2 — Persist scraped source text (brief)

- New shared types in `shared/types/content.ts`:
  - `BriefScrapedSource` — field-for-field mirror of server `ScrapedPage` (url, title,
    metaDescription, headings, bodyText, wordCount, fetchedAt). C1's contract comment pins this.
  - `BriefSourceEvidence` — `{ scrapedReferences?: BriefScrapedSource[]; serpResults?: { position; title; url; snippet }[]; serpFetchedAt?: string; styleExamples?: BriefScrapedSource[]; capturedAt: string }`.
    This is the first place SERP `snippet` text and `fetchedAt` are persisted (today dropped at
    the `generateBrief` boundary).
  - `ContentBrief.sourceEvidence?: BriefSourceEvidence`.
- New column `content_briefs.source_evidence TEXT` (same migration). Row interface +
  `rowToBrief` + `briefToParams` + insert/update SQL in `server/content-brief.ts`.
- `regenerateBrief` (content-brief.ts ~:918) carries `sourceEvidence` forward like
  `realPeopleAlsoAsk`/`realTopResults` (delete-then-reinsert metadata-preservation rule).
- Zod: `briefScrapedSourceSchema` + `briefSourceEvidenceSchema` (all evidence arrays
  `.optional()` — write path omits empties; schema-vs-stored-shape rule).
- Persistence seam in `server/content-brief-generation-job.ts`: one
  `buildBriefSourceEvidence(enrichment)` helper consuming C1's `BriefScrapeEnrichment`
  output directly (no re-derivation); after each `generateBrief` return, both paths call
  `updateBrief(wsId, brief.id, { sourceEvidence })` (before the existing
  `notifyContentUpdated` broadcast, so the existing event covers the write — no new event).
- `generateBrief` signature untouched (other callers: routes/content-briefs.ts, MCP).

### Public boundary (deliberate, justified scope addition)

`server/routes/public-content.ts` — destructure-omit `sourceEvidence` from the client brief
GET, and `aiReview` from the client post GET + client-edit response. Without this the new
columns silently ship ~25 KB of scraped competitor text and admin QA verdicts to clients.
Justification: lockstep rule half "public endpoint serialization"; the audit's bug-fix-now
policy. No other public passthroughs found (`grep getBrief\|getPost` over `server/routes/public-*`).

### Explicitly NOT in scope

- No evidence-ledger UI / claim-to-text matching (#27, parked).
- No frontend changes — PostEditor keeps using the live response; persisted verdicts become
  retrievable via existing admin GET post (rowToPost includes `aiReview`).
- No new WS event constants (existing `CONTENT_UPDATED` covers both writes).

## Tests (TDD) — `tests/integration/c4-persist-review-results.test.ts`

Architecture: in-process `createApp()` + `http.Server` + `tests/mocks/openai` +
mocked `web-scraper`, modeled on `tests/integration/content-posts-ai-fix.test.ts` (same
route family) and `tests/integration/content-brief-request-enrichment.test.ts` (C1's own
test). **Deviation from the dispatch note's `createEphemeralTestContext` default,
documented:** that helper spawns a child process, so `vi.mock` cannot intercept the AI
dispatch or scraper — the sibling tests for this exact seam already use and document the
in-process pattern.

1. ai-review run → 200, then fresh `getPost` (DB read, not in-memory) carries `aiReview`
   with `reviewedAt`, and provenance keys stored `pass:false` + `humanReviewRequired:true`
   even when the model tried `pass:true`.
2. FM-2: schema-invalid AI response → 500, `aiReview` NOT persisted.
3. Brief job (standalone + request paths) with mocked scraper → fresh `getBrief` carries
   `sourceEvidence` with scraped `bodyText`, SERP `snippet`, `serpFetchedAt`.
4. Scraper total failure (C1 FM-2 degradation: empty/null) → brief persists with NO
   `sourceEvidence` (column NULL), job still succeeds.
5. Schema-vs-stored-shape: blob with only `capturedAt` + one array parses (optionals);
   roundtrip through rowToBrief/rowToPost returns real data, not fallback.
6. Public boundary: client GET brief omits `sourceEvidence`; client GET post omits `aiReview`
   (exercises the actual public read path per the integration-test rule).

## File ownership (this PR only)

`server/db/migrations/132-c4-persist-review-results.sql` (new), `shared/types/content.ts`,
`server/schemas/content-schemas.ts`, `server/content-brief.ts` (store + regenerate carry),
`server/content-posts-db.ts`, `server/routes/content-posts.ts` (review seam),
`server/content-brief-generation-job.ts` (persistence seam), `server/activity-log.ts`
(one union member), `server/routes/public-content.ts` (boundary strips), the test file,
`FEATURE_AUDIT.md`, this plan.

## Gates

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`, new test file, and the
content integration shard (`npx vitest run tests/integration/content-*`). Push branch; no PR.
