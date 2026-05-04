# Platform Consolidation Audit - Verified Against Staging

Verified branch: `codex/verify-platform-consolidation-audit`
Verified base: `origin/staging` at `eb0a5832` (`Fix client legacy inbox route aliases (#455)`)
Verification date: 2026-05-04

## Result

The platform-consolidation audit still applies after the latest staging merges. Several staging updates improved adjacent areas, especially schema/page-elements and client-route aliases, but they did not resolve the main consolidation findings.

No stash contained the missing platform-consolidation audit/roadmap work. The newest stash only touches `src/components/client/StrategyTab.tsx`; the next newest broad stash touches schema/keyword files, not this audit.

## Still Valid

| Finding | Staging verification |
| --- | --- |
| Admin generation should run in background jobs | Partially covered. `server/routes/jobs.ts` supports `seo-audit`, `keyword-strategy`, `schema-generator`, `page-analysis`, `bulk-alt`, `bulk-seo-fix`, `compress`, `bulk-compress`, `sales-report`, and `deep-diagnostic`. Still valid because content brief generation, content post generation, post section regeneration, content-plan/matrix bulk actions, AEO/page rewrites, and brand/page deliverables are not consistently routed through the shared job system. |
| Billing split | Still valid. PaymentIntent/Stripe Elements still exists alongside Checkout in `server/routes/stripe.ts`, `server/stripe.ts`, `src/hooks/usePayments.ts`, `src/components/StripePaymentForm.tsx`, and Stripe tests. |
| Client data migration | Still valid. `src/hooks/useClientData.ts` remains a React Query compatibility facade with legacy local state, compatibility setters, no-op setters, and query-cache bridging. |
| Deep-link tab contract | Still valid. `InsightsBriefingPage.tsx` still sends `?tab=content-gaps`; `StrategyTab.tsx` still does not read `useSearchParams` or `searchParams.get('tab')`. |
| Keyword strategy SSE duplication | Still valid. `KeywordStrategy.tsx` still hand-parses the keyword strategy SSE stream while `src/api/seo.ts` exposes `streamKeywordStrategy()`. |
| AI dispatch migration | Still valid. `server/ai.ts` and `callAI()` exist, but many server modules and high-churn routes still import `callOpenAI` directly. |
| SEO provider boundary | Still valid. `SeoDataProvider` exists, but `server/routes/keyword-strategy.ts` still imports from `server/semrush.ts`, `semrushMode` remains feature-facing, and provider-specific naming leaks through UI/state. |
| Route/component monoliths | Still valid. Current line counts: `StrategyTab.tsx` 2,157; `server/routes/keyword-strategy.ts` 2,755; `server/workspace-intelligence.ts` 3,027; `server/routes/webflow-seo.ts` 1,910; `SchemaSuggester.tsx` 1,363; `PageIntelligence.tsx` 1,190; `SeoEditor.tsx` 1,066; `VoiceTab.tsx` 1,165. |

## Refined By Staging

- `workspace-intelligence.ts` now includes newer `pageElements` slice work, so any future slice split must preserve that behavior and its tests.
- `server/routes/jobs.ts` already has useful background job coverage. The roadmap should not describe this as missing wholesale; it should describe it as uneven coverage and drift prevention.
- The newest staging commit fixed client legacy route aliases, but it did not fix the `?tab=content-gaps` receiving-side contract.

## Roadmap Direction

Keep the consolidation sprint, but make background generation the first workstream:

1. Define the background-generation contract for all admin AI/generation flows.
2. Normalize the admin job UX so progress survives remounts and uses one surface.
3. Add guardrails so future long-running admin generation does not drift back into synchronous endpoints.
4. Continue the original consolidation items: billing, client data, deep links, SSE helper, AI dispatch, provider boundary, and monolith splits.

## Phase 0 Baseline - Background Generation

Phase 0 confirms that the platform does not need a new background-job concept. It needs one canonical contract around the infrastructure that already exists:

- `server/jobs.ts` and `server/routes/jobs.ts` as the durable job substrate.
- `src/hooks/useBackgroundTasks.tsx` as the admin job state hook.
- `src/components/TaskPanel.tsx` as the floating in-progress/queued/completed task surface.

The current drift is that long-running admin work is split across five execution styles:

1. Central `/api/jobs` jobs.
2. Feature-specific job endpoints, especially SEO bulk operations.
3. SSE/NDJSON streaming requests.
4. Custom domain batch tables.
5. Direct synchronous routes or anonymous fire-and-forget promises.

### Coverage Matrix

| Surface | Current mode | TaskPanel coverage | Phase 0 classification | Phase 1 action |
| --- | --- | --- | --- | --- |
| SEO audit | `/api/jobs` plus legacy sync audit route | Yes for job route | Partially job-backed | Consolidate to one job-backed audit path while preserving recommendations, snapshots, and insight bridges. |
| Schema all-site generation | `/api/jobs` plus sync schema routes | Yes for all-site job route | Partially job-backed | Prefer `/api/jobs` for all-site generation; keep single-page/template generation as explicit exceptions. |
| Page analysis | `/api/jobs` plus feature-specific SEO bulk job | Yes, but duplicate progress paths | Partially job-backed | Extract one reusable worker and one result handoff path. |
| Keyword strategy | `/api/jobs` wrapper plus canonical long-running SSE route | TaskPanel can show job wrapper, but UI uses SSE | Partially job-backed | Make keyword strategy a first-class job and remove the localhost self-call/SSE duplication. |
| SEO bulk analyze/rewrite/accept fixes | Feature-specific jobs with abort/progress | Partial labels/results in TaskPanel | Job-backed outside central UX | Keep the implementation pattern, then adapt it into the canonical job surface. |
| Content post generation | Custom fire-and-forget promise with persisted post skeleton | No | Background but not job-backed | First content migration target; return `{ jobId }` and surface post status/results through TaskPanel plus content broadcasts. |
| Content brief generation/regeneration | Synchronous route calls | No | Synchronous | Move full brief generation to jobs when enrichment/reference work can exceed an interactive request; keep small editor assists allowlisted. |
| Content request brief generation | Synchronous route call | No | Synchronous | Same treatment as content briefs; preserve request updates, activity, and broadcasts. |
| Post section regeneration/review/fix | Synchronous editor assists | No | Candidate exception | Keep single-section assists synchronous unless they become multi-step or crawl-heavy. |
| Content planner/matrix bulk actions | UI placeholders or parent callback actions | No | Not fully implemented | When implemented, start as job-backed bulk actions instead of adding another local progress path. |
| Workspace knowledge base / brand voice / personas | Synchronous crawl plus AI routes | No | Synchronous | Jobify crawl-heavy workspace setup generation; keep lightweight autofill synchronous. |
| Brand/page deliverables and voice calibration | Synchronous single deliverables | No | Candidate exception | Leave single deliverables synchronous with explicit timeout/usage/refund expectations. |
| Copy pipeline batch generation | Custom `copy_batch_jobs` domain system | No central TaskPanel visibility | Separate job system | Either bridge into `/api/jobs` or document as an intentional domain job system with parity requirements. |
| Alt text bulk generation | `/api/jobs` bulk path plus feature-specific NDJSON path | Partial | Partially job-backed | Pick one bulk path; prefer central jobs with per-asset progress and cancellation semantics. |
| Sales reports / deep diagnostic | `/api/jobs` | Yes | Job-backed | Keep job-backed; add richer progress/cancel only when user value justifies it. |

### Canonical UX Decision

Use the existing floating `TaskPanel` as the canonical global shell. Do not replace it in Phase 1.

Minimum UX work before migrations scale:

- Add complete labels for every job type, including SEO bulk jobs and any new content generation jobs.
- Persist or rediscover active jobs by `type + workspaceId + params`, not only by component-local job IDs.
- Let feature surfaces render inline progress from the same job object the `TaskPanel` uses.
- Define result adapters so completion can invalidate React Query caches, hydrate generated artifacts, or navigate the user to the finished item.
- Make cancellation honest: either register abort checks and expose cancel, or mark the job non-cancellable.
- Decide whether `useBackgroundTasks` should continue owning a raw WebSocket or move behind the shared workspace event bus.

### Draft Background Generation Contract

Long-running admin generation must follow this shape:

1. The route responds quickly with `{ jobId }` before expensive crawl, bulk, or AI work begins.
2. The job has a typed `type`, workspace id, human-readable label, optional entity metadata, and progress semantics.
3. The worker writes durable results to the owning domain store, not only to ephemeral `job.result`.
4. Progress updates include stable status, message, processed count, total count when known, and error details on failure.
5. Cancellation is implemented with a registered abort callback and checked inside loops, or the job is explicitly non-cancellable.
6. Completion performs activity logging, domain broadcasts, and React Query invalidation through documented result adapters.
7. Usage/rate-limit accounting happens before expensive work starts, with consistent refund or failure behavior.
8. Short interactive operations may stay synchronous only if they are allowlisted with a rationale.

### Guardrail Recommendation

Add a Phase 1 or Phase 2 pr-check rule plus contract test for long-running admin generation routes.

Recommended policy:

- Flag route handlers outside `/api/jobs` that contain long-running generation indicators such as `generateBrief`, `generatePost`, `generateSchemaSuggestions`, `runSeoAudit`, `scrapeWorkspaceSite`, `buildSiteInventory`, `discoverSitemapUrls`, or repeated AI calls in loops.
- Pass handlers that create a centralized job and respond with `{ jobId }` before the first long-running `await`.
- Maintain a top-level allowlist for intentional synchronous exceptions, with a required rationale.
- Add tests that prove known platform job types exist, all allowlist entries point to real routes, and frontend callers do not keep posting to legacy long-running endpoints after a job-backed replacement exists.

### Recommended Work Order

Phase 1 should stay limited to the background-generation foundation:

1. Canonical job contract and guardrail skeleton.
2. TaskPanel/useBackgroundTasks parity work, coordinated with the existing unified notification hub roadmap item.

Phase 2 should migrate the highest-risk long-running generation paths:

1. Content post generation job migration.
2. Keyword strategy job migration.
3. Schema/page-analysis duplicate worker consolidation.
4. Crawl-heavy workspace generation migration.

Later consolidation work should remain separate from the background-generation phases: billing, client data, deep links, SSE helper cleanup, AI dispatch, provider boundary, and monolith splits.

### Platform Value

These upgrades make the platform safer to scale. Admins can start expensive generation, leave the page, and come back without losing visibility. Support gets fewer "did it hang?" cases. Engineers get one lifecycle for progress, cancellation, completion, errors, and cache invalidation instead of rediscovering each feature's private pattern. The product also gains a cleaner foundation for queues, retries, notifications, and usage accounting as generation volume grows.
