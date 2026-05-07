# Deep Bug Audit - 2026-05-04

Branch: `codex/deep-bug-audit`  
Base: `origin/staging` at `8591f762` (`harden bug sweep guardrails`, PR #440 merged)  
Mode: read-only multi-agent audit plus local verification

## Scope

This audit intentionally looked for systemic bug families rather than single-screen polish:

- Workspace/resource authorization gaps
- Data-flow broadcast and React Query invalidation gaps
- Public/admin serialization drift
- AI prompt/render/provenance mismatches
- Page identity/path normalization bugs
- Full-suite flake causes
- DB JSON validation/silent data-loss patterns
- Frontend stale state/deep-link/data-fetching drift

Prior audit items `594`, `595`, and `598` were already completed in PR #440 and are not repeated here. Several stale leads from earlier pre-#440 agents were rechecked and excluded, including keyword-strategy route access, client-signals scoping, jobs scoping, Google annotation scoping, Stripe payment list scoping, and client dashboard strategy/outcome/intelligence invalidation.

## Executive Summary

The audit found five high-leverage fix families:

1. **Resource ownership is not consistently bound to workspace access.** The biggest class is routes that validate a caller-supplied `workspaceId` but then operate on arbitrary Webflow/Google/report resources.
2. **Integration tests are not isolated enough for parallel full-suite runs.** Most spawned integration servers share the default SQLite DB, explaining the recent `SQLITE_BUSY` and ROI 404 flakes.
3. **Page identity joins still have fuzzy/shape mismatches.** Several page-profile/admin-chat consumers compare full URLs, bare slugs, and normalized paths directly.
4. **Client-facing API shapes drift from UI expectations.** Active trials, content-gap enrichment, delivered content links, and client business priorities each have mismatched producer/consumer contracts.
5. **AI review/provenance paths overstate confidence.** Some UI can send or auto-check AI-generated factual/citation claims without verified source evidence.

## Critical / Security Findings

### 1. Webflow resource routes do not bind `workspaceId` to `siteId` / collection / asset

Evidence:

- `server/app.ts:212-216` allows any valid internal JWT through the global API gate.
- `server/workspaces.ts:377` resolves tokens globally by `siteId`.
- `server/routes/webflow.ts:173` updates page SEO with no workspace middleware.
- `server/routes/webflow-cms.ts:61` updates CMS items without route middleware and only uses `req.body.workspaceId` for token lookup.
- `server/routes/webflow-schema.ts:382` and `:777` validate query workspace access but still operate on arbitrary `:siteId`.
- `server/routes/webflow-organize.ts:143` validates body workspace access but operates on caller-supplied Webflow resources.

Impact: a workspace-scoped JWT user can provide a workspace they can access plus another workspace's Webflow `siteId` / asset / collection IDs and read or mutate the other site.

Recommended fix: add a shared guard such as `requireWorkspaceOwnsSite({ workspaceId, siteId })`, derive token only after that guard passes, and require `siteId` on collection/item/asset routes where the resource ID alone cannot be trusted.

### 2. Integration servers share the same SQLite DB by default

Evidence:

- `tests/integration/helpers.ts:69` spawns `server/index.ts` with `...process.env` but no per-test `DATA_DIR`.
- `server/data-dir.ts:22` falls back to the default app data location when `DATA_DIR` / `DATA_BASE` are absent.
- `server/db/index.ts:16` opens the shared `dashboard.db`.

Impact: parallel Vitest workers and spawned servers write the same SQLite DB, producing `SQLITE_BUSY`, state bleed, and socket-close failures. This matches the PR #440 full-suite failure pattern.

Recommended fix: set deterministic per-worker/per-suite `DATA_DIR` before any DB import, and make spawned servers inherit it. As a short-term containment, run integration tests in an isolated Vitest project or single worker.

### 3. ROI 404 flake has a concrete migration race

Evidence:

- `tests/integration/roi-attribution.test.ts:65` seeds `keywordStrategy.pageMap` directly.
- `server/index.ts:45` runs `migrateFromJsonBlob()` at server startup.
- `server/page-keywords.ts:321` migrates `pageMap` into `page_keywords` and deletes it from the workspace JSON blob.
- `server/roi.ts:135` still reads only `ws.keywordStrategy.pageMap`.
- `server/routes/stripe.ts:249` maps missing ROI to 404.

Impact: any parallel integration server that starts after ROI seeds but before ROI requests can migrate away the data ROI still reads, causing intermittent 404s.

Recommended fix: make `computeROI()` read `page_keywords` as source of truth and fall back to the legacy blob. Update ROI tests to seed through `upsertPageKeywordsBatch()`.

## High Findings

### 4. Google Search Console / GA routes are not workspace-scoped

Evidence:

- `server/routes/google.ts:69`, `:109`, `:125`, `:135`, and `:189` expose global/property operations without `requireWorkspaceAccess`.
- `server/google-auth.ts:161` can fall back from a site token to the global token.

Impact: any valid internal JWT can query or disconnect Google resources if it knows/guesses `siteId` or `gscSiteUrl`.

Recommended fix: require `workspaceId`, verify workspace access, and assert `workspace.webflowSiteId === siteId` plus `workspace.gscPropertyUrl === gscSiteUrl` where applicable. Global OAuth/config routes should require admin auth.

### 5. Audit report/snapshot routes are not scoped to workspace access

Evidence:

- `server/routes/reports.ts:99`, `:154`, `:173`, `:184`, and `:197` lack workspace guards.
- `server/reports.ts:68` store updates key only by snapshot id.

Impact: a scoped JWT user can read snapshots or mutate action items for another workspace if they know `siteId` or snapshot id.

Recommended fix: add `workspace_id` to `audit_snapshots` or derive workspace from `site_id`, then enforce workspace access before reads/writes.

### 6. Workspace list/overview leaks all workspace metadata to scoped JWT users

Evidence:

- `server/routes/workspaces.ts:68` returns all workspaces.
- `server/routes/workspaces.ts:74` aggregates all workspace overview metrics.

Impact: any internal JWT user scoped to one workspace can enumerate all workspaces and operational counts.

Recommended fix: filter by `req.user.workspaceIds` for non-owner JWT users, or require HMAC/admin auth for global list/overview.

### 7. System-level settings writes accept any valid internal JWT

Evidence:

- `server/routes/settings.ts:20` writes Webflow token without `requireAdminAuth`.
- `server/routes/settings.ts:40` writes studio booking URL without `requireAdminAuth`.

Impact: a scoped JWT user can overwrite global integration/studio configuration.

Recommended fix: apply `requireAdminAuth` to global settings mutations.

### 8. Public billing management is too permissive for passwordless portals

Evidence:

- `server/routes/stripe.ts:258` billing portal route and `:277` cancellation route have no stricter billing auth.
- `server/app.ts:243-254` allows passwordless workspaces through public routes by URL alone.

Impact: for passwordless client portals, anyone with the workspace URL can create a Stripe billing portal session or cancel a subscription.

Recommended fix: add a billing-specific guard requiring client-user token, signed client session, or admin HMAC even when the portal is passwordless.

### 9. Page-profile and admin-chat joins still miss or overmatch page data

Evidence:

- `server/workspace-intelligence.ts:2593` checks `affectedPages?.includes(pagePath)` while producers store bare slugs.
- `server/workspace-intelligence.ts:2636` compares audit/CWV full URLs or bare slugs directly to paths.
- `server/workspace-intelligence.ts:2658` schema status falls back to CMS synthetic IDs for nested static pages.
- `server/admin-chat-context.ts:445` still uses bidirectional `endsWith` pageMap matching.
- `src/hooks/useRecommendations.ts:26` overmatches nested paths and drops homepage recommendations.

Impact: page profiles can miss recommendations, audit issues, CWV status, and schema validation; admin chat can attach the wrong keyword context to similarly named nested pages.

Recommended fix: use shared path helpers everywhere: normalize URL/path/slug before comparison, prefer `findPageMapEntry`, and add tests using `/seo`, `/services/seo`, `/blog/seo`, homepage, and full URLs.

### 10. Active Growth trials are serialized inconsistently

Evidence:

- `server/routes/public-portal.ts:71` returns `tier: computeEffectiveTier(ws)`.
- `server/routes/client-intelligence.ts:140`, `server/routes/public-analytics.ts:264`, and `server/routes/public-chat.ts:48` use raw `ws.tier`.

Impact: a free workspace on active Growth trial can show Growth UI while intelligence/chat endpoints still apply Free behavior/limits.

Recommended fix: use `computeEffectiveTier(ws)` in all tier-gated public routes; add a contract test across workspace, intelligence, chat usage, and search chat.

### 11. AI factual/provenance checks overstate certainty

Evidence:

- `server/routes/content-posts.ts:363-370` asks an LLM to judge factual accuracy and hallucinations from post text alone.
- `src/components/post-editor/ReviewChecklist.tsx:84-88` auto-checks passed items, including "Factual accuracy verified" and "No AI hallucinations or fabricated statistics".
- `server/aeo-page-review.ts:195-199` asks AI to recommend specific authoritative citations without a verified source corpus.
- `src/components/AeoReview.tsx:169` can send those recommendations to the client.

Impact: client-visible or pre-publish workflows can treat unsupported AI judgments as verified factual review.

Recommended fix: never auto-check provenance-sensitive checklist items from AI-only review. Return extracted claims and source evidence; mark factual/stat/citation items as human-review required unless grounded in verified sources.

## Medium Findings

### 12. Content planning, matrix, template, brief, and post mutations leave derived views stale

Evidence:

- `server/routes/content-plan-review.ts:121`, `:232`, and `:260` mutate review/flags/status but do not consistently broadcast or log activity.
- `server/routes/content-matrices.ts:46`, `:67`, `:79`, and `:164` mutate matrices without broadcast/activity.
- `server/routes/content-templates.ts:33`, `:60`, `:72`, and `:79` mutate templates without broadcast/activity.
- `server/routes/content-briefs.ts:74`, `:81`, `:219`, `:234`, and `:304` mutate briefs without broadcast.
- `server/routes/content-posts.ts:596` reverts a post without `POST_UPDATED`; `:627` deletes without broadcast/activity.
- `src/hooks/useWsInvalidation.ts:87` and `:265` invalidate only narrow caches, missing content pipeline/calendar/ROI.

Impact: content pipeline, calendar, client content plan, workspace home, and ROI can stay stale until manual refresh or staleTime expiry.

Recommended fix: introduce a content-planning event and central invalidation covering admin content pipeline/calendar, client content plan, workspace home, intelligence, and ROI where applicable. Add activity entries for user-visible lifecycle actions.

### 13. Public SEO strategy strips fields the client UI renders

Evidence:

- `server/routes/public-content.ts:109-118` omits content-gap enrichment fields.
- `src/components/client/types.ts:102` includes `opportunityScore`, `trendDirection`, `serpFeatures`, `competitorProof`, and `questionKeywords`.
- `src/components/client/StrategyTab.tsx:1483-1500` sorts/renders by these fields.

Impact: client strategy recommendations lose ranking and badges.

Recommended fix: align `/api/public/seo-strategy` with the richer projection already used by briefing routes.

### 14. Delivered content links are omitted from public request list

Evidence:

- `server/content-requests.ts:95` maps `deliveryUrl` / `deliveryNotes`.
- `shared/types/content.ts:145` and `src/components/client/types.ts:49` include them.
- `server/routes/public-content.ts:179-188` omits them from `/api/public/content-requests`.
- `src/components/client/ContentTab.tsx:561` renders the delivered-content CTA only when `deliveryUrl` exists.

Impact: delivered content may not show the "your content is ready" link in the client portal.

Recommended fix: include `deliveryUrl` / `deliveryNotes` for delivered/published requests and add an integration test.

### 15. Client business priorities are stored as objects but intelligence reads strings

Evidence:

- `server/routes/public-portal.ts:510-529` stores priorities as `{ text, category }[]`.
- `server/workspace-intelligence.ts:1168` parses `client_business_priorities.priorities` as `z.array(z.string())`.
- `shared/types/intelligence.ts:238` exposes `businessPriorities: string[]`.

Impact: valid client-submitted business priorities fall back to `[]` in `ClientSignalsSlice`, so prompts/briefings can miss them despite successful saves.

Recommended fix: introduce a shared `ClientBusinessPriority` type or map objects to formatted strings at read time; add a POST-to-intelligence integration test.

### 16. Raw spawned-server ports collide and are not covered by the meta-test

Evidence:

- `tests/integration/keyword-strategy-partial-state.test.ts:19` uses `13320`.
- `tests/integration/stripe-admin-auth.test.ts:38` also uses `13320`.
- `tests/integration/admin-auth-guard.test.ts:56` uses `13313`, colliding with `tests/integration/rewrite-chat-pages.test.ts:43`.
- `tests/integration/admin-auth-guard.test.ts:528` uses `13314`, colliding with `tests/integration/scheduled-audits-dedup.test.ts:16`.
- `tests/meta-port-uniqueness.test.ts:69-70` only parses `createTestContext()` callers.

Impact: full-suite runs can hit `EADDRINUSE`, socket closes, or the wrong server.

Recommended fix: route custom auth server tests through `createTestContext` with env overrides or extend the meta-test to parse raw spawned server `PORT` constants.

### 17. AEO JSON prompt enum does not match typed/UI enum

Evidence:

- `server/aeo-page-review.ts:36` defines `AeoEffort = 'quick' | 'moderate' | 'significant'`.
- `server/aeo-page-review.ts:186` tells the model to return `quick (< 15 min)|moderate (15-60 min)|significant (1+ hours)`.
- `src/components/AeoReview.tsx:241-243` filters by exact enum value.

Impact: valid-looking AI output can disappear under UI filters.

Recommended fix: prompt exact enum literals only and Zod-validate/normalize response before returning.

### 18. Rewrite assistant can insert rationale into live page content

Evidence:

- `server/routes/rewrite-chat.ts:224-226` asks for a rewrite label and rationale but does not require a hard delimiter.
- `src/components/PageRewriteChat.tsx:265-269` strips only a literal `Rationale:` section.
- `src/components/PageRewriteChat.tsx:373` applies the remaining text to the live document.

Impact: if the model uses "Why this works" or another rationale label, explanatory text can be inserted into the page.

Recommended fix: return structured JSON or require `BEGIN_REWRITE` / `END_REWRITE` delimiters and apply only that block.

### 19. Foreign-key-off test cleanup can leave child rows

Evidence:

- `tests/db-setup.ts:11` disables foreign keys.
- `server/workspaces.ts:513` deletes only the workspace row.
- `tests/fixtures/workspace-seed.ts:54` relies on deleting workspace rows.

Impact: child rows such as `page_keywords`, snapshots, and jobs can accumulate in shared DB tests, increasing state leakage and lock pressure.

Recommended fix: keep FKs enabled where possible or make cleanup helpers explicitly delete child rows before workspace deletion.

## Recommended PR Order

1. **Security scoping PR 1: Webflow/site ownership guard.** Add shared site ownership guard, then patch Webflow, Webflow CMS, schema publish/retract, and organize routes.
2. **Test isolation PR.** Per-worker/suite `DATA_DIR`, ROI reads from `page_keywords`, raw server port meta-test, awaited raw server shutdown.
3. **Security scoping PR 2: global/internal route hardening.** Google/GSC/GA routes, reports/snapshots, workspace list filtering, settings admin guard, billing auth guard, upload auth.
4. **Page identity PR.** Normalize page-profile/admin-chat/recommendation/schema joins with shared helpers and tests for nested/static/CMS/homepage/full-URL cases.
5. **Client contract drift PR.** Effective trial tier, public SEO strategy enrichment, delivered content link serialization, client business priorities shape.
6. **Content data-flow PR.** Content-plan/matrix/template/brief/post broadcasts, activity logging, and central invalidation coverage.
7. **AI provenance PR.** Disable AI-only auto-checking for factual/hallucination checklist items; constrain AEO citations to verified sources; fix AEO enum and rewrite delimiters.

## Suggested Roadmap Items

- `deep-audit-webflow-site-ownership-guard` - P0/P1
- `deep-audit-integration-test-db-isolation` - P0/P1
- `deep-audit-global-route-workspace-scoping` - P1
- `deep-audit-page-identity-joins` - P1
- `deep-audit-client-api-contract-drift` - P1/P2
- `deep-audit-content-data-flow-invalidation` - P2
- `deep-audit-ai-provenance-contracts` - P1

## Verification Notes

No implementation changes were made in this audit. Verification consisted of code inspection, multi-agent cross-checks, and targeted line-level reads on merged `origin/staging`. The next PRs should add integration/contract tests for each fix family before or alongside code changes.
