# D2 — Recs ↔ Content Reconciliation (audit #11) — JIT Plan

> Single-agent (Opus) execution on branch `claude/core-d2-recs-content-reconciliation` off
> `origin/staging` (HEAD = PR #1187 / C3 merge, verified). One PR. Master plan section: D2.

## Citation re-verification (drift check)

| Audit citation | Current state | Drift |
|---|---|---|
| `server/recommendations.ts:1085-1095` slices list drops `contentPipeline` | Verified — `slices: ['seoContext', 'clientSignals', 'learnings']` at `:1091` inside `generateRecommendations` | none (±3 lines) |
| `mapToProduct` returns `{}` for content recs at `:879-902` | Verified — `mapToProduct` at `:879`, `case 'content'` absent → `default: return {}` | none |
| C3 `publishPostToWebflow()` single publish site | Verified — `server/domains/content/publish-post-to-webflow.ts`; consumed by `routes/content-publish.ts` (manual) + `content-publish-job.ts` (auto). Both paths flow through it. | none |
| Content-gap recs carry no per-rec keyword | Verified — `Recommendation` (shared/types/recommendations.ts) has no `targetKeyword`; content-gap mint (`recommendations.ts:~1381-1443`) sets `affectedPages: []`, keyword only in prose | new finding — drives contract change below |
| `ContentPipelineSlice` carries no per-item keywords | Verified — counts only (`briefs.byStatus`, `posts.byStatus`, `coverageGaps`) | new finding — slice field addition required to honor "through the builder/slices list, not a new direct read" |

## Contracts (locked)

1. **`ContentPipelineSlice.inFlightTargetKeywords?: string[]`** (shared/types/intelligence.ts)
   — comparison-keyed (`keywordComparisonKey`) target keywords of all briefs + non-error posts
   in the pipeline. Populated in `assembleContentPipeline` via `readOptionalSlicePart`
   (degrades to `[]`; suppression fails OPEN — minting recs, never false-resolving).
2. **`Recommendation.targetKeyword?: string`** (shared/types/recommendations.ts +
   `recommendationSchema` `z.string().optional()`) — set on content-gap recs at mint so the
   publish hook can match. Schema is `.passthrough()` so legacy rows are unaffected.
3. **`mapToProduct(recType, pageCount, pageType?)`** — new optional third param
   (`ContentGap['suggestedPageType']`). `case 'content'` → brief product keyed by page type
   (`brief_blog` $125 default, `brief_landing|service|location|product|resource` $150,
   `brief_pillar` $200 — prices mirror `PRODUCT_MAP` in server/stripe.ts). All existing
   call sites unchanged.
4. **`resolveContentRecommendationsForPublishedPost(workspaceId, targetKeyword): number`**
   (new export, server/recommendations.ts) — completes active (`pending`/`in_progress`)
   `type === 'content'` recs whose `targetKeyword` comparison-key matches. Mirrors
   `resolveRecommendationsForChange`: `validateTransition` per rec, summary recompute,
   save, `invalidateIntelligenceCache`, broadcast `RECOMMENDATIONS_UPDATED` only when
   `resolved > 0`. Does NOT call `triggerOpportunityRegen` (publish service already
   enqueues `queueKeywordStrategyPostUpdateFollowOns` — avoid double regen).
5. **Publish hook** — ONE best-effort call inside `publishPostToWebflow` success tail
   (after broadcast, beside the existing follow-on try/catch): wrapped in try/catch +
   `log.warn`; a resolution throw never fails the publish; never fires on the
   create-failed / publish-failed paths (it sits after both throws).

## Behavior changes

- **Slices list** `recommendations.ts:1091` gains `'contentPipeline'` (via the shared
  builder — no new direct reads).
- **Suppression**: content-gap mint loop skips gaps whose `targetKeyword` comparison-key is
  in `inFlightTargetKeywords` (immediately after the declined-keyword skip). Merge tail
  then auto-resolves a previously-minted pending rec for that gap (intended: the pipeline
  is producing it; `completed → pending` revive on a later regen if the brief is deleted
  without publishing keeps it self-correcting).
- **CTA**: content-gap mint attaches `...mapToProduct('content', 1, cg.suggestedPageType)`
  + `targetKeyword: cg.targetKeyword`. Client purchase CTA in
  `src/components/client/InsightsEngine.tsx` already renders for `productType+productPrice`
  via the existing cart → `/api/stripe/cart-checkout` brief-purchase path (`brief_*` are
  valid `ProductType`s; `isProductType` passes). Client seam change: content recs label the
  CTA "Order Content Brief — $X" instead of "Let Us Fix This — $X". No purple; existing
  teal Button primitive.

## Both-halves check

`RECOMMENDATIONS_UPDATED` invalidation handlers already exist:
`src/components/ClientDashboard.tsx:359`, `src/hooks/useWsInvalidation.ts:74`,
`src/lib/wsInvalidation.ts:391,550`. No frontend wiring needed.

## Cycle check

`recommendations.ts` does not import (directly or via its import list) the publish service;
only `routes/content-publish.ts` + `content-publish-job.ts` consume it. Importing
`recommendations.js` from the domain service is acyclic.

## Tests (TDD — red first)

New file `tests/integration/recommendations-content-reconciliation.test.ts` — **in-process
`createApp()` + port 0** following `tests/integration/content-posts-workflow.test.ts`
(the publish pattern the master plan names). `createEphemeralTestContext` spawns a child
process where `vi.mock`/webflow fetch mocks cannot reach the publish path, so the
workflow-test pattern governs (deviation noted in PR report). Port 0 ⇒ no port collisions.

1. **Suppression** — seed two content gaps (`kw-a`, `kw-b`) + a brief targeting `kw-a`;
   `generateRecommendations(wsId)` yields no rec with `targetKeyword === 'kw-a'`, and a
   `kw-b` rec WITH `productType: 'brief_blog'`, `productPrice: 125`, `targetKeyword`.
2. **Publish resolves** — seed rec set with pending content rec (`targetKeyword: kw-x`) +
   approved post (`targetKeyword: kw-x`) + publish target + webflow mocks; POST
   `/api/content-posts/:wsId/:postId/publish-to-webflow` → 200; rec now `completed`;
   `RECOMMENDATIONS_UPDATED` broadcast observed; non-matching rec untouched.
3. **FM-2 resolution failure** — `vi.mock` recommendations.js (importOriginal spread) with
   a hoisted flag making `resolveContentRecommendationsForPublishedPost` throw → publish
   still 200, post stamped published.
4. **FM-2 publish failure** — webflow create error → publish 4xx/5xx, matching rec stays
   `pending` (resolution only after success).
5. **CTA mapping** — update `tests/unit/recommendations-pure-logic.test.ts` ('content →
   empty object' becomes brief-product assertions incl. pageType variants + default).

## Verification gates

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`, new test file,
plus shards: `npx vitest run tests/integration/recommendations-*.test.ts
tests/integration/content-posts-workflow.test.ts tests/integration/content-publish-*.test.ts
tests/unit/recommendations-pure-logic.test.ts` and the contract shard for intelligence
types if present. `FEATURE_AUDIT.md` updated. No full-suite manual run (CI owns it).
