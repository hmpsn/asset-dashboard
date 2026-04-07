# hmpsn.studio — Platform-Wide Testing Plan

> **Status:** Complete. Delivered across 4 PRs — 216 test files, 3,609 tests, all passing.
> **Date:** 2026-04-06 (plan) → 2026-04-06 (completed)
> **Context:** Produced after multi-agent audit of 277 features, 73 route files, 20 shared type modules, 165+ existing test files (1860+ tests), and full-codebase grep for 6 failure patterns. Revised after owner review with 5 substantive corrections.
>
> **Delivery summary:**
> - PR1: Test infrastructure (mock factories, seed fixtures, JSON.parse safety migration) + 13 integration tests
> - PR2: State machine transition guards + 3 test files (155 tests)
> - PR3: Cross-layer contract tests — 6 files (168 tests)
> - PR4: Auth, AI, data integrity, client-facing, and coverage gap tests — 31 files
> - Production bugs found: schema validator crash on null @graph, reviewChecklist rejected by .strict() schema, missing COALESCE on SUM queries

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Failure Mode Catalog](#2-failure-mode-catalog)
3. [System Boundary Map](#3-system-boundary-map)
4. [Coverage Gap Audit](#4-coverage-gap-audit)
5. [Prioritized Test Backlog](#5-prioritized-test-backlog)
6. [Infrastructure Additions](#6-infrastructure-additions)
7. [CLAUDE.md Additions](#7-claudemd-additions)
8. [Implementation Strategy](#8-implementation-strategy)

---

## 1. Executive Summary

### What we have

| Category | Count | Description |
|----------|-------|-------------|
| Unit tests | 66 | Pure functions, utilities, data transformations |
| Component tests | 23 | React component rendering (23 of ~213 components) |
| Integration tests | 34 | HTTP endpoint testing via supertest |
| Contract tests | 2 | Cross-layer type compatibility |
| E2E tests | 3 | Playwright (smoke, approval workflow, client login) |
| Root-level tests | 37 | Complex logic: assemblers, bridges, intelligence |
| **Total** | **165** | **~1838 test cases** |

### What's missing

- **~50 route files** have zero test coverage (of 73 total)
- **Zero external API mock tests** — no shared mocks for Webflow, Stripe, Google, OpenAI, Anthropic
- **Zero state machine transition tests** — 9+ state machines with no guards or transition validation
- **2 contract tests** for a codebase with 20 shared type modules and 200+ cross-layer interfaces
- **92 bare `JSON.parse` calls** on server without `parseJsonSafe` wrappers (35 files)
- **No silent write failure tests** — external API error paths don't assert correct failure state recording
- **Zero multi-step journey tests** — no test exercises a full user workflow (pay → upgrade → access)
- **Zero tier-gate enforcement tests** — 13+ client-facing endpoints gated by tier with no verification
- **Zero webhook idempotency tests** — Stripe webhooks can be delivered multiple times, no dedup tests
- **Zero migration safety tests** — 21+ migrations run against empty DB only, never against existing data

### Why existing tests create false confidence

1. **Tests cover pure functions, not data flow** — 60% of tests validate utilities, formatters, and assemblers. Cross-layer data contracts (server→frontend field population) are almost entirely untested.
2. **Tests were written with the same blind spots as the code** — PR3 proved that tests written in the same session as implementation share the author's mental model. The first `seoEditorCmsFilter.test.ts` imported inline copies, not the real utility.
3. **TypeScript compiles ≠ feature works** — optional fields declared on shared types that the server never populates produce zero TypeScript errors and pass all tests.
4. **State machines have no guards** — any status can transition to any other status. A work order can go from `pending` directly to `completed` skipping `in_progress`. An approval item can jump to `applied` skipping `approved`.

---

## 2. Failure Mode Catalog

Each pattern below includes: what it is, why TypeScript/tests miss it, real examples from this codebase, and a grep command to detect future instances.

### FM-1: Cross-Layer Contract Mismatch

**What:** A field is declared on a shared type (e.g., `collectionId?: string` on `PageMeta`), used in a frontend component, but never populated by the server endpoint. The field is always `undefined` at runtime.

**Why tests miss it:** TypeScript allows optional fields to be absent. Unit tests mock the data shape they expect. Only an integration test that calls the real endpoint and asserts response shape catches this.

**Real examples:**
- `collectionId` on `PageMeta` — declared, used in SeoEditor, server never sent it (caught in PR3)
- `openGraph` fields — same pattern
- `AnalyticsInsight` has 13 optional fields — each is a candidate for "declared but never populated"
- `PageProfileSlice` has 16 optional/nullable fields — many enrichments may never fire
- `strategy_alignment` in `InsightDataMap` maps to `Record<string, unknown>` (opaque)

**Detection commands:**
```bash
# Find all optional fields on shared types
grep -rn '?:' shared/types/ --include='*.ts' | grep -v 'node_modules'

# Cross-reference: check if a specific field is ever set by the server
grep -rn 'collectionId' server/ --include='*.ts'
```

**Test shape:** Integration test → call endpoint → assert response contains the field with a non-undefined value.

---

### FM-2: Silent Write Failure (Phantom Success)

**What:** An external API call (Webflow, Stripe, Google) fails, but the catch block either swallows the error or records success anyway. The user sees "Applied" when the change never reached Webflow.

**Why tests miss it:** No tests mock external APIs to return errors. All tests only exercise the happy path.

**Real examples from audit:**
- `PATCH /api/webflow/assets/:assetId` — **no error handling at all** for Webflow API failures
- `DELETE /api/webflow/assets/:assetId` — **no error handling at all**
- Stripe cart checkout creates multiple payment records; if item 3/5 fails, partial state exists (phantom success risk: HIGH)
- Webflow CMS `updateCmsItem()` updates local DB `PageEditState` even if Webflow API returns error
- Approval execution in `approvals.ts` — originally marked items as `applied` when Webflow returned 404 (fixed in PR3, but pattern could recur)

**Detection command:**
```bash
# Find external write paths without error handling
grep -A5 'fetch(' server/webflow*.ts | grep -B2 -v 'catch\|error\|ok\|status'

# Find catch blocks that still record success
grep -A10 'catch' server/routes/approvals.ts | grep -i 'applied\|success\|completed'
```

**Test shape:** Mock external API → return error → assert operation records `failed`/`error`, NOT `applied`/`success`/`completed`.

---

### FM-3: Incomplete Constraint Application

**What:** A cross-cutting constraint (e.g., "never send CMS IDs to Webflow") is applied to 3 of 4 code paths. The 4th path is discovered later by review, not by tests.

**Why tests miss it:** Tests only cover the code paths the author was thinking about. Without grepping all call sites first, some paths are invisible.

**Real examples:**
- CMS filter guard was on `handleBulkFix` and `applyBulkRewrite` but missing from `previewPattern→applyPattern` until Devin's 3rd review (PR3)
- `recordAction()` requires a valid `workspaceId` FK, but some call sites pass a Webflow `siteId` instead — FK constraint fails silently

**Detection command:**
```bash
# Find all call sites of a constraint function
grep -rn 'filterWritableIds\|isWritablePage\|filterCmsPages' server/routes/ --include='*.ts'

# Find unguarded recordAction calls (pr-check already catches this)
npx tsx scripts/pr-check.ts --all
```

**Test shape:** Extract constraint as named utility → test utility exhaustively → wire all call sites to import it → integration test that each call site rejects invalid input.

---

### FM-4: Tests Validate Structure, Not Behavior

**What:** Test imports an inline copy of the logic instead of the real utility function. The test passes even when the real implementation is broken.

**Why tests miss it:** The test is technically correct — it validates the behavior of its own copy. But it's decoupled from the production code.

**Real examples:**
- First `seoEditorCmsFilter.test.ts` defined its own inline filter predicates instead of importing from `seoEditorFilters.ts`
- Source-sniffing tests (readFileSync on .ts source) break on refactors that preserve semantics

**Detection command:**
```bash
# Find tests that define their own utility functions instead of importing
grep -rn 'function filter\|const filter\|const predicate' tests/ --include='*.ts' | grep -v 'import'

# pr-check catches source-sniffing
npx tsx scripts/pr-check.ts --all
```

**Test shape:** Tests must import real utility functions. Never inline copies.

---

### FM-5: Unguarded State Machine Transitions

**What:** Status fields accept any value without validating the transition. A work order can go from `pending` → `completed` skipping `in_progress`. An approval item can jump to `applied` skipping `approved`.

**Why tests miss it:** No tests exercise invalid transitions. All tests follow the happy path.

**State machines identified in audit:**

| Entity | Valid States | Guards | Broadcasts |
|--------|-------------|--------|------------|
| Work Orders | pending → in_progress → completed / cancelled | **None** | None |
| Feedback | new → acknowledged → fixed / wontfix | **None** | Yes |
| Approval Batches | pending → partial → approved → rejected → applied | Derived via `recalcBatchStatus()` | Yes |
| Approval Items | pending → approved → rejected → applied | **None** | Yes (via batch) |
| Payments | pending → paid → failed → refunded | **None** | **None** |
| Content Subscriptions | pending → active → past_due → cancelled | **None** | **None** |
| Jobs | pending → running → completed → failed / interrupted | Implicit via lifecycle | Yes |
| Pending Schemas | pending → applied / stale | **None** | **None** |
| Tracked Actions | measurement_complete: 0→1, attribution: various | **None** | Partial |
| Client Signals | various | **None** | Yes |
| PageEditState | clean → issue-detected → fix-proposed → in-review → approved → rejected → live | **None** — any value accepted | Via approval system |

**Detection command:**
```bash
# Find SET status = @status without preceding validation
grep -n "SET status" server/*.ts server/routes/*.ts | grep -v 'WHERE\|CASE'
```

**Test shape:** Attempt invalid transition (e.g., `pending` → `applied` skipping approval) → assert 400 error or unchanged state.

---

### FM-6: Bare JSON.parse on DB Columns

**What:** `JSON.parse()` called on a SQLite TEXT column without `parseJsonSafe`/`parseJsonFallback`. If the column contains invalid JSON (corrupted data, migration artifact, NULL), the server crashes with an unhandled exception.

**Audit result: 92 instances across 35 files** (excluding already-excluded files in pr-check).

**High-risk files (DB column parsing):**
- `server/users.ts:37` — `workspaceIds: JSON.parse(row.workspace_ids)`
- `server/feedback.ts:86,88` — `context` and `replies` JSON columns
- `server/content-matrices.ts:105,111` — `cells` and `dimensions` arrays
- `server/content-subscriptions.ts:84` — `preferred_page_types`
- `server/payments.ts:38` — `metadata`
- `server/content-templates.ts:84-92` — 4 JSON columns
- `server/performance-store.ts:80,160,177` — 3 JSON columns
- `server/schema-queue.ts:242` — `schema_json`
- `server/schema-store.ts:58,199,200,227,297,298,527` — 7 JSON columns
- `server/seo-change-tracker.ts:82,115` — 2 JSON columns
- `server/requests.ts:48,49` — 2 JSON columns
- `server/redirect-store.ts:52` — `result` column
- `server/competitor-schema.ts:54,155` — 2 JSON columns
- `server/email-queue.ts:68` — event queue

**Acceptable (non-DB) JSON.parse:** `server/db/json-validation.ts` (the implementation itself), `server/db/json-column.ts` (generic helper), `server/db/migrate-json.ts` (one-time migration), `server/processor.ts` (file metadata), `server/stripe-config.ts` (encrypted config file with try-catch), AI response parsers (content-posts-ai, keyword-strategy, etc.).

**Detection command:**
```bash
npx tsx scripts/pr-check.ts --all  # Already catches new instances
```

**Test shape:** Insert malformed JSON into DB column → call the function that reads it → assert graceful fallback (empty array, default object), NOT crash.

---

### FM-7: Vacuous Assertions on Empty Collections

**What:** `expect(arr.every(fn)).toBe(true)` where `arr` is empty. `[].every(fn)` returns `true` for any `fn`, so the test passes vacuously — it proved nothing.

**Detection command:**
```bash
grep -n '\.every(' tests/ -r --include='*.ts' | head -30
grep -n '\.some(' tests/ -r --include='*.ts' | head -30
```

**Test shape:** Always assert `expect(arr.length).toBeGreaterThan(0)` before `.every()` or `.some()`.

---

### FM-8: Missing COALESCE on SUM() Aggregates

**What:** SQLite `SUM()` returns `NULL` (not `0`) when no rows match. Without `COALESCE(SUM(col), 0)`, the result flows to the frontend as `null`, silently breaking counters.

**Detection command:**
```bash
npx tsx scripts/pr-check.ts --all  # Already catches this
```

**Test shape:** Query with zero matching rows → assert result is `0`, not `null`.

---

### FM-9: Stale State Persistence Across Navigation

**What:** React component loads data on mount, user navigates away and back, component shows stale data from the previous mount instead of refetching. With React Query migration complete, this risk is lower but still exists for:
- Local `useState` that isn't cleared on workspace change
- `useRef` values that persist across renders
- WebSocket handlers that reference stale closure variables

**Detection command:**
```bash
# Find useState in components that don't clear on workspace change
grep -n 'useState' src/components/*.tsx | grep -v 'query\|Query'
```

---

### FM-10: Webhook Idempotency Violation

**What:** An external webhook (Stripe) is delivered more than once (Stripe guarantees at-least-once, not exactly-once). If the handler isn't idempotent, duplicate delivery creates duplicate payment records, double work orders, or double tier upgrades.

**Why tests miss it:** All webhook tests send each event exactly once. No test sends the same event twice.

**Real examples (potential):**
- `checkout.session.completed` → calls `createPayment()` + `updateWorkspace()` + potentially `createWorkOrder()`. A duplicate delivery could create a second payment record and a second work order for the same checkout.
- `customer.subscription.updated` → calls `updateWorkspace()` to change tier. Duplicate delivery is safe (idempotent SET), but if it races with a `customer.subscription.deleted`, final state is non-deterministic.

**Test shape:** Send same webhook event twice → assert only one payment/work-order/subscription record exists.

---

### FM-11: Tier-Gate Bypass

**What:** A client-facing endpoint is supposed to be restricted to Growth or Premium tier, but the `requireTier()` middleware is missing or the tier check is incorrect. Free clients access paid features without paying.

**Why tests miss it:** No tests exercise tier boundaries. All client tests use a single workspace at a single tier.

**Real examples (potential):**
- 13+ client-facing routes serve tier-gated data (monthly digests, advanced analytics, custom reports, content briefs)
- `<TierGate>` on the frontend is a UX hint, not enforcement — the real gate must be on the API route

**Detection command:**
```bash
# Find public routes that should be tier-gated
grep -rn 'requireTier\|tier.*check\|workspace\.tier' server/routes/public*.ts
```

**Test shape:** Create workspace at Free tier → call tier-gated endpoint → assert 403. Upgrade to Premium → assert 200.

---

### FM-12: Broken Async Pipeline Continuity

**What:** A multi-step async pipeline (strategy generation → insight computation → client dashboard) fails silently at an intermediate step. The first step succeeds, the last step shows empty data, and no error is surfaced.

**Why tests miss it:** Each endpoint is tested in isolation. No test exercises the full pipeline from trigger to final visibility.

**Real examples (potential):**
- Strategy generation completes → insight bridge should fire → client dashboard should show content gaps. If the bridge doesn't fire (missing broadcast, wrong event name), client sees empty strategy.
- Anomaly detection runs → should create notification → admin sees bell icon. If notification creation throws, admin never learns about the anomaly.

**Test shape:** Trigger start of pipeline → wait for async effects → assert final consumer sees the data.

---

### FM-13: Migration Data Loss

**What:** A database migration alters a column type, renames a column, or changes a JSON column's expected shape. Existing data doesn't conform to the new shape and is silently dropped or nulled by `parseJsonSafe` returning the fallback.

**Why tests miss it:** No tests run migrations against a database that already contains data. `tests/global-setup.ts` runs migrations on an empty database.

**Real examples (potential):**
- 21+ migrations in `server/db/migrations/`. Any migration that adds a NOT NULL column without a DEFAULT, or changes a JSON column schema, could silently break existing rows.
- `parseJsonSafe` returns empty fallback when schema doesn't match — a schema change in migration N+1 could make migration N's stored data unreadable.

**Test shape:** Seed database with known data at migration N → run migration N+1 → assert data is preserved and readable.

---

### FM-14: Semantic ID Mismatch

**What:** A field is populated with a value from the wrong source. The type is correct (`string`), the field exists, the value is non-null — but it refers to a different entity than the consumer expects. TypeScript is happy. Integration tests that only check "field is present" pass. The bug only surfaces when the value is used against an external API.

**Why tests miss it:** Type safety only validates shape, not semantics. A `collectionId: string` that contains a site-level collection list ID (Webflow "list of collections") vs. a specific CMS collection ID (Webflow "the collection to write items to") are both valid strings. Tests that assert `expect(result.collectionId).toBeDefined()` prove nothing.

**Real examples:**
- PR3: `collectionId` on `PageMeta` was populated with the Webflow site's collection list ID, not the CMS collection ID that Webflow's write API expects. The field existed, was populated, had the right type — but every CMS write silently failed because Webflow returned 404 for the wrong ID.
- Webflow has 5+ ID types (`siteId`, `collectionId`, `itemId`, `pageId`, `assetId`) that are all opaque strings. Confusing any two is undetectable by TypeScript.

**Detection command:**
```bash
# Find all places where Webflow IDs are passed between functions
grep -rn 'collectionId\|siteId\|itemId\|pageId\|assetId' server/webflow*.ts server/routes/webflow*.ts
```

**Test shape:** Seed a workspace with known Webflow IDs → call the write function → capture the outbound Webflow API request → assert the ID in the request URL matches the expected entity, not a same-typed-but-wrong ID from a different source.

---

### FM-15: AI Output Business Constraint Violation

**What:** AI-generated content passes structural validation (JSON parses, required fields exist, length is within bounds) but violates a business rule: recommends a competitor's brand keyword, generates content for the wrong tier, or uses language inappropriate for client-facing output.

**Why tests miss it:** Structural validation tests check shape, not semantics. The AI response is a valid JSON object with all required fields — but the `keyword` field contains "Comprehensive Guide to DX Integrations" where DX is the client's competitor.

**Real examples:**
- Brand keyword filter: AI recommended competitor brand terms (e.g., "DX" for a Faros client) in strategy content gaps. Fixed by `filterBrandedContentGaps()` — but edge cases remain (2-char tokens, SaaS prefixes like "try*", substring matches like "redux" ≠ "dx").
- Existing coverage: `tests/unit/competitor-brand-filter.test.ts` (23 tests) covers the filter itself, but no integration test verifies the filter is actually wired into every code path that generates keyword recommendations.

**Detection command:**
```bash
# Find all code paths that generate keyword/content recommendations
grep -rn 'contentGaps\|suggestedKeywords\|recommendedTopics' server/ --include='*.ts'
# Cross-reference with filter application
grep -rn 'filterBranded\|filterCompetitor' server/ --include='*.ts'
```

**Test shape:** Configure workspace with known competitor brands → trigger recommendation pipeline → assert zero output items contain competitor brand tokens (including edge cases: 2-char tokens, SaaS prefix variants, case-insensitive substring traps).

---

## 3. System Boundary Map

Every server→client data crossing, ranked by risk tier.

### Tier 1: Must Test (silent data loss, financial impact, auth bypass)

| Boundary | Route File(s) | External API | Risk |
|----------|---------------|-------------|------|
| **Webflow page SEO writes** | `webflow.ts`, `webflow-seo.ts` | Webflow PUT/POST | Phantom success: change marked "applied" when Webflow rejected it |
| **Webflow schema publish** | `webflow-schema.ts`, `webflow.ts` | Webflow PUT (custom code) | Schema applied locally but not on Webflow |
| **Webflow CMS item create/update** | `webflow-cms.ts` | Webflow POST/PATCH | CMS item created locally, Webflow API failed |
| **Webflow asset operations** | `webflow.ts`, `webflow-cms-images.ts` | Webflow PATCH/DELETE/POST | **NO ERROR HANDLING** on asset PATCH/DELETE |
| **Webflow site publish** | `webflow.ts` | Webflow POST | Publish silently fails |
| **Stripe checkout session** | `stripe.ts` | Stripe API | Payment record created before checkout succeeds |
| **Stripe cart checkout** | `stripe.ts` | Stripe API | Multiple payment records; partial failure = phantom success |
| **Stripe subscription lifecycle** | `stripe.ts` | Stripe webhooks | Webhook mishandle → wrong tier, lost cancellation |
| **Approval execution** | `approvals.ts` | Webflow API | Item marked "applied" when Webflow returned error |
| **Auth flows** | `auth.ts`, `users.ts`, `public-auth.ts` | None (internal) | JWT/HMAC confusion, token threading, password reset |
| **Client user auth** | `public-auth.ts` | None (internal) | Client JWT issuance, session persistence, role enforcement |
| **Content publish to Webflow** | `content-publish.ts` | Webflow CMS API | Post marked "published" when CMS create failed |
| **Work order completion** | `work-orders.ts` | None (state machine) | No transition guards; can skip steps |

### Tier 2: Should Test (incorrect data displayed, AI quality, intelligence)

| Boundary | Route File(s) | External API | Risk |
|----------|---------------|-------------|------|
| **Strategy generation** | `keyword-strategy.ts` | OpenAI + SEMRush | AI response parsing failure → empty strategy |
| **Content brief generation** | `content-briefs.ts` | OpenAI | Brief with missing sections, wrong field mapping |
| **Content post generation** | `content-posts.ts` | OpenAI | Section generation fails silently, partial post |
| **Admin chat context** | `ai.ts` | OpenAI | Wrong data sources loaded for question type |
| **Client chat** | `public-chat.ts` | OpenAI | Revenue hooks in wrong tier, stale context |
| **Intelligence assembly** | `intelligence.ts` | None | Slice assembly with missing data → empty AI context |
| **Insight computation** | `insights.ts` | None | Wrong enrichment, missing page titles, score bugs |
| **Anomaly detection** | `anomalies.ts` | None | False positives spam clients, dedup failures |
| **Schema generation** | `webflow-schema.ts` | OpenAI | Hallucinated properties, broken cross-references |
| **Schema validation** | `webflow-schema.ts` | None | Validator passes invalid schemas |
| **Content decay** | `content-decay.ts` | GSC data | Wrong severity classification, stale data |
| **SEO audit scoring** | `webflow-audit.ts` | None | Score calculation errors, weight mismatches |
| **Recommendations engine** | `recommendations.ts` | None | Wrong severity, missing affected pages |
| **Monthly reports** | `reports.ts` | None | Wrong data period, missing sections |
| **Client intelligence** | `client-intelligence.ts` | None | Tier-gated data leaking to wrong tier |
| **Public analytics** | `public-analytics.ts` | GSC/GA4 | Wrong workspace data, missing auth check |
| **ROI attribution** | `stripe.ts` (public ROI) | None | Wrong attribution, double-counting |

### Tier 3: Nice to Have (admin-only reads, cosmetic)

| Boundary | Route File(s) | Risk |
|----------|---------------|------|
| Activity log display | `activity.ts` | Stale entries, missing context |
| Rank tracking display | `rank-tracking.ts` | Wrong period, missing keywords |
| Site architecture | `site-architecture.ts` | Incomplete tree, wrong depth |
| Data export | `data-export.ts` | Missing columns, wrong format |
| Settings CRUD | `settings.ts` | Field mapping errors |
| Feature flags | `features.ts` | Flag state mismatch |
| Roadmap display | `roadmap.ts` | Stale status |
| LLMs.txt generation | `llms-txt.ts` | Broken URLs, stale cache |
| Debug endpoints | `debug.ts` | Information exposure |
| AI usage stats | `ai-stats.ts` | Wrong cost calculations |
| Workspace badges | `workspace-badges.ts` | Stale counts |
| Workspace home | `workspace-home.ts` | Aggregation errors |

---

## 4. Coverage Gap Audit

### Tested vs Untested Routes

**Routes WITH dedicated test files (20 of 73):**
- `auth.ts`, `approvals.ts`, `annotations.ts`, `anomalies.ts`, `churn-signals.ts`
- `client-signals.ts`, `content-matrices.ts`, `content-requests.ts`, `content-templates.ts`
- `feedback.ts`, `health.ts`, `insights.ts`, `jobs.ts`, `rank-tracking.ts`
- `recommendations.ts`, `reports.ts`, `stripe.ts`, `work-orders.ts`, `workspaces.ts`, `users.ts`

**Routes with PARTIAL coverage (via misc-endpoints.test.ts):**
- `requests.ts`, `google.ts` (status only), `semrush.ts` (status only), `settings.ts` (partial), `roadmap.ts` (partial)

**Routes with ZERO test coverage (48+):**

| Priority | Route File | Why Untested Is Dangerous |
|----------|-----------|--------------------------|
| **CRITICAL** | `webflow.ts` | All Webflow API writes — phantom success risk |
| **CRITICAL** | `webflow-seo.ts` | Bulk SEO operations, CMS filter bypass |
| **CRITICAL** | `webflow-schema.ts` | Schema publish, plan management |
| **CRITICAL** | `webflow-cms.ts` | CMS item CRUD via Webflow API |
| **CRITICAL** | `content-posts.ts` | Post generation, publish to Webflow |
| **CRITICAL** | `content-publish.ts` | Auto-publish pipeline |
| **CRITICAL** | `public-auth.ts` | Client login, password reset, Turnstile |
| **CRITICAL** | `public-portal.ts` | Client dashboard data, keyword feedback |
| **HIGH** | `keyword-strategy.ts` | Strategy generation, diff, cannibalization |
| **HIGH** | `content-briefs.ts` | Brief generation, regeneration, send-to-client |
| **HIGH** | `intelligence.ts` | Workspace intelligence assembly |
| **HIGH** | `ai.ts` | Admin chat, context assembly |
| **HIGH** | `public-chat.ts` | Client chatbot |
| **HIGH** | `public-content.ts` | Client content access, brief export |
| **HIGH** | `content-subscriptions.ts` | Recurring billing |
| **HIGH** | `seo-change-tracker.ts` | Change impact measurement |
| **HIGH** | `outcomes.ts` | Outcome tracking pipeline |
| **MEDIUM** | `client-intelligence.ts` | Client-facing intelligence |
| **MEDIUM** | `public-analytics.ts` | Client analytics access |
| **MEDIUM** | `public-requests.ts` | Client request submission |
| **MEDIUM** | `public-feedback.ts` | Client feedback widget |
| **MEDIUM** | `backlinks.ts` | Backlink data |
| **MEDIUM** | `semrush.ts` | SEMRush integration (beyond status) |
| **MEDIUM** | `content-decay.ts` | Decay detection |
| **MEDIUM** | `site-architecture.ts` | Architecture analysis |
| **MEDIUM** | `webflow-audit.ts` | Audit endpoints |
| **MEDIUM** | `webflow-alt-text.ts` | Alt text generation |
| **MEDIUM** | `webflow-pagespeed.ts` | PageSpeed analysis |
| **MEDIUM** | `webflow-keywords.ts` | Keyword extraction |
| **MEDIUM** | `aeo-review.ts` | AEO page review |
| **MEDIUM** | `competitor-schema.ts` | Competitor crawling |
| **MEDIUM** | `suggested-briefs.ts` | Brief suggestions |
| **MEDIUM** | `content-plan-review.ts` | Plan review flow |
| **MEDIUM** | `content-matrices.ts` *(routes)* | Matrix endpoints (store tested, routes not) |
| **LOW** | `data-export.ts` | Export functionality |
| **LOW** | `audit-schedules.ts` | Schedule management |
| **LOW** | `brand-docs.ts` | Document upload |
| **LOW** | `debug.ts` | Debug endpoints |
| **LOW** | `features.ts` | Feature management |
| **LOW** | `ai-stats.ts` | AI usage tracking |
| **LOW** | `llms-txt.ts` | LLMs.txt generation |
| **LOW** | `misc.ts` | Miscellaneous |
| **LOW** | `revenue.ts` | Revenue dashboard |
| **LOW** | `rewrite-chat.ts` | Rewrite chat |
| **LOW** | `webflow-analysis.ts` | Page analysis |
| **LOW** | `webflow-organize.ts` | Page organization |
| **LOW** | `workspace-badges.ts` | Badge counts |
| **LOW** | `workspace-home.ts` | Home aggregation |

### Untested Server Modules (significant logic, no tests)

| Module | Functions | Risk |
|--------|----------|------|
| `server/semrush.ts` | 13 public functions | SEMRush API integration, data parsing |
| `server/webflow-pages.ts` | SEO update, publish, schema apply | External write paths |
| `server/webflow-assets.ts` | Asset CRUD, compression, S3 upload | External write paths |
| `server/webflow-cms.ts` | CMS item create/update/publish | External write paths |
| `server/content-brief.ts` | Brief generation, regeneration | AI prompt construction |
| `server/content-posts-ai.ts` | Post generation, unification | AI prompt construction |
| `server/schema-suggester.ts` | Schema generation, validation, post-processing | AI + validation pipeline |
| `server/schema-plan.ts` | Plan generation, role assignment | AI + state management |
| `server/site-architecture.ts` | Tree building, gap detection | Complex data assembly |
| `server/seo-audit.ts` | Full audit pipeline | Scoring, check execution |
| `server/internal-links.ts` | Link analysis, orphan detection | HTML parsing |
| `server/monthly-report.ts` | Report generation, email templates | Data assembly |
| `server/email-queue.ts` | Email batching, queue persistence | Stateful queue |
| `server/chat-memory.ts` | Session persistence, summarization | AI + state |
| `server/admin-chat-context.ts` | Context assembly, question classification | AI prompt construction |
| `server/seo-context.ts` | SEO context building | Data assembly |
| `server/content-subscriptions.ts` | Subscription management | Billing state machine |
| `server/roi.ts` | ROI calculation, attribution | Complex computation |

### Contract Test Gaps

Only 2 contract test files exist:
- `tests/contract/enrichment-coverage.test.ts`
- `tests/contract/old-vs-new-output.test.ts`

**Missing contract tests for:**
- Every endpoint that returns data consumed by a shared type (200+ interfaces)
- `InsightDataMap` discriminated union — data shapes per insight type
- Intelligence slice interfaces — 8 slices with 100+ optional fields total
- Client intelligence tier gating — Growth vs Premium field availability
- Approval batch status derivation — `recalcBatchStatus()` logic vs client expectations
- WebSocket event payloads — broadcast event data shapes vs frontend handler expectations

---

## 5. Prioritized Test Backlog

### Batch 1: External Write Path Failure Tests (Tier 1 — highest ROI)

These tests mock external APIs to return errors and verify the system records failure correctly.

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 1 | `tests/integration/webflow-seo-writes.test.ts` | PUT /pages/:pageId/seo, bulk-fix, bulk-rewrite, pattern-apply with Webflow mock. **Must include per-site token threading test:** two workspaces with different Webflow tokens → verify workspace A's write uses workspace A's token, not B's or a global default. | FM-2, FM-3, FM-14 | L |
| 2 | `tests/integration/webflow-schema-writes.test.ts` | Schema publish, bulk publish, retract with Webflow mock | FM-2 | M |
| 3 | `tests/integration/webflow-cms-writes.test.ts` | CMS item create/update/publish, asset PATCH/DELETE with Webflow mock | FM-2 | M |
| 4 | `tests/integration/approval-execution.test.ts` | Execute approved changes → Webflow. Error → NOT marked "applied" | FM-2, FM-5 | M |
| 5 | `tests/integration/content-publish-writes.test.ts` | Auto-publish to Webflow CMS, DALL-E image gen failure path | FM-2 | M |
| 6 | `tests/integration/stripe-checkout-flow.test.ts` | Checkout creation, cart with multiple items, partial failure | FM-2 | L |
| 7 | `tests/integration/stripe-webhooks.test.ts` | Subscription lifecycle: created/updated/deleted, payment failed/paid | FM-2, FM-5 | L |
| 7b | `tests/integration/stripe-webhook-idempotency.test.ts` | Duplicate webhook delivery: same event twice → no duplicate records | FM-10 | M |

### Batch 1.5: Critical User Journey Tests (Tier 1 — cross-system workflows)

These test multi-step workflows end-to-end, catching failures at the seams between systems.

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| J1 | `tests/integration/journey-payment-tier-upgrade.test.ts` | Client checkout → Stripe webhook → tier upgrade → premium endpoint access | FM-10, FM-11, FM-12 | L |
| J2 | `tests/integration/journey-content-publish.test.ts` | Content request → brief generation → post creation → Webflow CMS publish → client visibility | FM-2, FM-12 | L |
| J3 | `tests/integration/journey-approval-to-webflow.test.ts` | SEO edit → approval batch → client approves → Webflow publish → change verified | FM-2, FM-5, FM-12 | L |
| J4 | `tests/integration/journey-strategy-to-client.test.ts` | Strategy generation → insight bridge → client dashboard shows content gaps | FM-1, FM-12 | M |
| J5 | `tests/integration/journey-schema-publish.test.ts` | Schema generation → approval → Webflow custom code publish → page has schema | FM-2, FM-12 | M |

### Batch 2: State Machine Transition Guards (Tier 1)

> **Rebalanced:** PageEditState transitions are covered implicitly by the approval flow tests in Batch 1.5 (J3). Subscription lifecycle moved to Batch 7 where it fits better as client-facing correctness. This batch focuses on the 3 state machines that have caused real bugs: approval items, work orders, and content pipeline.

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 8 | `tests/unit/state-machines.test.ts` | Work order, approval item, payment transitions — valid + invalid | FM-5 | L |
| 9 | `tests/integration/approval-state-flow.test.ts` | Full approval lifecycle: create batch → review → approve → execute → verify Webflow | FM-5, FM-2 | L |
| 10 | `tests/integration/content-lifecycle.test.ts` | Request → brief → post → review → approve → publish state flow | FM-5 | M |

### Batch 3: Cross-Layer Contract Tests (Tier 1–2)

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 13 | `tests/contract/insight-data-shapes.test.ts` | Each InsightType produces correct InsightDataMap shape | FM-1 | M |
| 14 | `tests/contract/intelligence-slice-population.test.ts` | Each slice interface field is populated by its assembler | FM-1 | L |
| 15 | `tests/contract/client-intelligence-tiers.test.ts` | Growth vs Premium fields, tier gating correctness | FM-1 | M |
| 16 | `tests/contract/workspace-overview-shape.test.ts` | /api/workspace-overview response matches WorkspaceSummary type | FM-1 | S |
| 17 | `tests/contract/approval-batch-status.test.ts` | recalcBatchStatus() derives correct status from all item combinations | FM-1, FM-5 | M |
| 18 | `tests/contract/websocket-event-shapes.test.ts` | Each broadcast event payload matches frontend handler expectations | FM-1 | M |

### Batch 4: Auth & Security (Tier 1)

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 19 | `tests/integration/client-auth-full.test.ts` | Client login, JWT issuance, session persistence, role enforcement, password reset | FM-1 | L |
| 20 | `tests/integration/admin-auth-guard.test.ts` | HMAC vs JWT confusion, requireAuth vs APP_PASSWORD gate | FM-3 | M |
| 21 | `tests/integration/rate-limiting.test.ts` | 3-tier rate limits, credential stuffing lockout, Turnstile bypass | FM-3 | M |
| 22 | `tests/integration/workspace-access-control.test.ts` | requireWorkspaceAccess with owner/admin/member/client roles | FM-3 | M |
| 22b | `tests/integration/tier-gate-enforcement.test.ts` | All tier-gated public endpoints: Free→403, Growth→partial, Premium→full access | FM-11 | L |
| 22c | `tests/integration/cross-workspace-isolation.test.ts` | Two workspaces: data from workspace A never leaks to workspace B queries | FM-3 | M |

### Batch 5: AI & Strategy Quality (Tier 2)

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 23 | `tests/unit/schema-validation-pipeline.test.ts` | 7-step post-processing: content verification, cross-ref injection, auto-fix | FM-2 | L |
| 24 | `tests/unit/strategy-enrichment.test.ts` | SERP features, trend direction, question keywords, cannibalization detection | FM-1 | M |
| 25 | `tests/unit/admin-chat-question-routing.test.ts` | Question classification routes to correct data sources | FM-1 | M |
| 26 | `tests/integration/content-brief-generation.test.ts` | Brief generation with all context sources, enrichment pipeline | FM-1, FM-2 | L |
| 27 | `tests/unit/content-quality-rules.test.ts` | WRITING_QUALITY_RULES enforcement in AI prompts | FM-4 | S |

### Batch 6: Data Integrity & JSON Safety (Tier 2)

> **Prerequisite:** The 92 bare `JSON.parse` calls must be migrated to `parseJsonSafe`/`parseJsonFallback` BEFORE these tests run. That migration is a mechanical code change done in Session 1 (Infrastructure). Testing bare `JSON.parse` for graceful fallback is testing code you know will crash — migrate first, test after.

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 28 | `tests/unit/json-parse-safety.test.ts` | All migrated parseJsonSafe/parseJsonFallback calls: malformed input → graceful fallback | FM-6 | L |
| 29 | `tests/unit/sum-coalesce.test.ts` | All SUM() queries with zero rows → returns 0, not null | FM-8 | M |
| 30 | `tests/unit/row-mapper-completeness.test.ts` | Every rowToX() mapper reads all columns from its table | FM-1 | M |
| 31 | `tests/integration/broadcast-handler-pairs.test.ts` | Every broadcastToWorkspace call has a matching frontend useWebSocket handler | FM-3 | M |
| 31b | `tests/unit/migration-data-preservation.test.ts` | Seed data at migration N, run N+1, assert data survives and is readable | FM-13 | L |

### Batch 7: Client-Facing Data Correctness (Tier 2)

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 32 | `tests/integration/public-portal-auth.test.ts` | All public endpoints require client auth, reject unauthenticated | FM-3 | M |
| 33 | `tests/integration/public-analytics.test.ts` | Client analytics returns correct workspace data, not cross-workspace | FM-1 | M |
| 34 | `tests/integration/client-strategy.test.ts` | Strategy view, keyword feedback, content gap voting | FM-1 | M |
| 35 | `tests/integration/monthly-report.test.ts` | Report generation with all data sources, email template rendering | FM-1, FM-2 | M |
| 36 | `tests/integration/roi-attribution.test.ts` | ROI calculation, traffic value attribution, double-counting prevention | FM-1 | M |
| 36b | `tests/integration/subscription-lifecycle.test.ts` | Subscription create → active → renew → cancel → expire (moved from Batch 2) | FM-5, FM-2 | M |

### Batch 7.5: Semantic Correctness (FM-14, FM-15)

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| S1 | `tests/integration/webflow-id-semantics.test.ts` | Webflow write APIs receive correct ID type (collectionId ≠ collection list ID, siteId ≠ pageId). Seed workspace with known IDs, capture outbound requests, assert URL contains expected entity ID. | FM-14 | M |
| S2 | `tests/integration/brand-filter-wiring.test.ts` | `filterBrandedContentGaps()` is wired into ALL code paths that generate keyword recommendations (strategy, briefs, suggested briefs). Trigger each pipeline with competitor brands configured, assert zero competitor tokens in output. | FM-15 | M |
| S3 | `tests/unit/brand-filter-edge-cases.test.ts` | Edge cases: 2-char tokens (dx), SaaS prefixes (trylinear→linear), substring non-matches (redux ≠ dx), case-insensitive matching. Extends existing `competitor-brand-filter.test.ts`. | FM-15 | S |

### Batch 8: Remaining Coverage Gaps (Tier 2–3)

| # | File Path | What It Tests | Failure Modes | Size |
|---|-----------|---------------|---------------|------|
| 37 | `tests/integration/content-decay-routes.test.ts` | Decay detection, severity classification, AI recommendations | FM-1 | M |
| 38 | `tests/integration/site-architecture-routes.test.ts` | Tree building, gap detection, schema coverage | FM-1 | M |
| 39 | `tests/integration/seo-audit-routes.test.ts` | Audit endpoints, scoring, suppression, traffic intelligence | FM-1 | L |
| 40 | `tests/integration/data-export-routes.test.ts` | All export formats, column completeness | FM-1 | S |
| 41 | `tests/integration/backlinks-routes.test.ts` | Backlink overview, referring domains | FM-1 | S |
| 42 | `tests/integration/semrush-routes.test.ts` | Full SEMRush integration, circuit breaker, credit exhaustion | FM-2 | M |

---

## 6. Infrastructure Additions

### 6.1 Shared External API Mocks

Create `tests/mocks/` with reusable mock factories:

```
tests/mocks/
├── webflow.ts        # Mock Webflow API responses (success + error variants)
├── stripe.ts         # Mock Stripe SDK (checkout, webhooks, subscriptions)
├── google.ts         # Mock GSC + GA4 API responses
├── openai.ts         # Mock callOpenAI with configurable responses
├── anthropic.ts      # Mock callAnthropic
└── semrush.ts        # Mock SEMRush API responses
```

Each mock should export:
- `mockSuccess(data)` — returns a successful response with given data
- `mockError(status, message)` — returns an error response
- `mockTimeout()` — simulates a timeout
- `createMockServer()` — creates a disposable HTTP server for integration tests

### 6.2 Contract Test Generator

Create `tests/utils/contract-test-helper.ts`:

```typescript
/**
 * Given a route path and expected type, calls the endpoint
 * and asserts the response shape matches the TypeScript interface.
 * Uses runtime type checking (Zod schemas derived from shared types).
 */
export function assertResponseShape<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  setup?: () => Promise<void>
): void;
```

### 6.3 State Machine Test Utility

Create `tests/utils/state-machine-helper.ts`:

```typescript
/**
 * Tests all possible state transitions for an entity.
 * Valid transitions succeed. Invalid transitions are rejected.
 */
export function testStateMachine(config: {
  entity: string;
  validTransitions: Array<[from: string, to: string]>;
  updateFn: (id: string, status: string) => Promise<void>;
  getFn: (id: string) => Promise<{ status: string }>;
  seedFn: (status: string) => Promise<string>;
}): void;
```

### 6.4 New pr-check.ts Rules

Add to the existing pr-check script:

| Rule | Pattern | Severity | Purpose |
|------|---------|----------|---------|
| Vacuous `.every()` in tests | `.every(` without preceding `length` check | error | FM-7: prevents assertions on empty arrays |
| Untyped dynamic import | `await import(` without `import type` in same file | warn | FM-4: prevents `as any` on dynamic imports |
| broadcastToWorkspace without WS_EVENTS constant | Already exists (upgraded to error when cleanup done) | warn→error | FM-3: prevents event name drift |
| New state transition without guard | `SET status =` without validation function | warn | FM-5: catches unguarded transitions |
| Missing `parseJsonSafe` on new DB column read | `JSON.parse(row.` | error | FM-6: prevents crash on malformed data |

### 6.5 Bare JSON.parse Migration (Session 1 prerequisite)

Migrate all 92 bare `JSON.parse` calls on DB columns to `parseJsonSafe`/`parseJsonFallback`/`parseJsonSafeArray`. This is a **code change**, not a test — it's the prerequisite for Batch 6 tests to be meaningful. Testing bare `JSON.parse` for graceful fallback is testing code you know will crash.

**Scope:** 35 files (see FM-6 list above). Exclude already-safe files: `json-validation.ts`, `json-column.ts`, `migrate-json.ts`, `stripe-config.ts`, AI response parsers.

**Model assignment:** Haiku — this is mechanical find-and-replace with type awareness. Each file: read the `JSON.parse(row.X)` call, determine the fallback type (empty array, empty object, null), replace with `parseJsonSafe(row.X, schema, context)` or `parseJsonFallback(row.X, fallback)`.

**Risk:** Low per-file, but 35 files means review matters. Run full test suite after migration.

### 6.6 Test Global Setup Update

Update `tests/global-setup.ts` to support the new seed utilities. Currently it only runs migrations on an empty database. Add:
- A `cleanSeedData()` function that truncates seed-populated tables between test suites
- Ensure FK constraints are re-enabled for seed validation (seeds should respect FKs even if individual tests disable them)

### 6.7 Test Database Seed Utilities

Expand `tests/fixtures/` with:

```
tests/fixtures/
├── intelligence-seed.ts   # (exists) workspace with insights + actions
├── rich-intelligence.ts   # (exists) full intelligence data
├── seo-context-mock.ts    # (exists) SEO context mock
├── workspace-seed.ts      # NEW: creates workspace with all related data
├── approval-seed.ts       # NEW: creates workspace + approval batches + items
├── content-seed.ts        # NEW: creates briefs + posts + requests + matrices
├── strategy-seed.ts       # NEW: creates keyword strategy + content gaps
└── auth-seed.ts           # NEW: creates admin user + client users + tokens
```

---

## 7. CLAUDE.md Additions

The following rules should be added to CLAUDE.md to prevent pattern recurrence in future AI-generated code.

### Testing Protocol (new section)

```markdown
## Testing Protocol (mandatory for feature work)

### Before marking a feature done
1. **Data path trace** — for every field consumed by the frontend, verify the server endpoint actually populates it. Not "the type declares it" — run the endpoint and check.
2. **Error path test** — for any external API write, the feature must include a test that mocks the API to return an error and asserts the system records failure, not success.
3. **State transition test** — for any status field change, verify invalid transitions are rejected. Don't assume the happy path is the only path.
4. **Cross-cutting constraint check** — before writing fix #1 for a constraint, grep ALL call sites. Guard them all in one commit.

### Test quality rules
- **Never assert `.every()` or `.some()` on a potentially empty array** without first asserting `length > 0`. `[].every(fn)` returns `true` vacuously.
- **Tests must import real utility functions**, never inline copies. If the test defines its own version of the logic, it's testing itself, not the code.
- **Integration tests must call real endpoints** and assert response shapes match shared types. Don't mock the entire server — mock only external APIs.
- **State machine tests must attempt invalid transitions** and assert rejection. Happy-path-only tests prove nothing about guards.
```

### Additional Code Convention Rules

```markdown
### State machine transitions must use a validated update function
Every entity with a status field must have a `validateTransition(from, to)` function that rejects
invalid transitions with a 400 error. Direct `UPDATE ... SET status = ?` without validation is
forbidden for: work orders, approval items, payments, content subscriptions, PageEditState.

### External API write paths must have paired error tests
Any route that calls an external API (Webflow, Stripe, Google, OpenAI, Anthropic) must have
a test in `tests/integration/` that mocks the API to fail and asserts:
- The operation records `failed`/`error` status, not `success`/`applied`/`completed`
- Activity log entries reflect the failure
- No partial state corruption (use transactions for multi-step operations)

### New shared type fields must have a contract test
Adding a field to any interface in `shared/types/` requires a corresponding assertion in
`tests/contract/` that the server endpoint actually sends the field. Optional fields must
include JSDoc: `/** Populated by [endpoint]. Undefined until [condition]. */`

### JSON column reads must use parseJsonSafe
All 92 existing bare `JSON.parse` calls on DB columns are tracked debt. New code must use
`parseJsonSafe`/`parseJsonFallback`/`parseJsonSafeArray` from `server/db/json-validation.ts`.
The pr-check rule already enforces this for new files.
```

---

## 8. Implementation Strategy

### 8.1 PR Workflow

Work is consolidated into **4 PRs** (down from 10) so each PR is self-contained — no
temporary annotations or suppressions that depend on a future PR to resolve.

1. **Build** — write tests + any prerequisite code changes within the PR scope
2. **Verify** — `npx tsc --noEmit --skipLibCheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts`
3. **Review** — scaled code review for each PR (10+ files)
4. **PR** — merge to `staging`, verify on staging deploy
5. **Gate** — PR N+1 does not start until PR N is merged and CI green

**PR 1 (Infrastructure):** Mocks, utilities, fixtures, pr-check rules, JSON.parse migration — **already shipped** (PR #141).

**PR 2 (External Writes + Journeys):** Batches 1 + 1.5. Mock-based failure tests for all external write paths, plus end-to-end journey tests that exercise full workflows. Ships together because journey tests depend on patterns established by Batch 1.

**PR 3 (State Machines + Contracts):** Batches 2 + 3. State machine `validateTransition()` guards AND their tests in the same PR — no `status-ok` annotations needed. Contract tests validate cross-layer type shapes. Ships together because state machine guards are preconditions for contract tests (contract tests assert that invalid transitions return errors, not silent success).

**PR 4 (Auth, AI, Data Integrity, Remaining):** Batches 4 + 5 + 6 + 7 + 7.5 + 8. Auth/security, AI quality, JSON safety, migration preservation, client-facing correctness, and remaining coverage gaps. These batches are independent of each other (all depend only on PR 1 infrastructure) so they can be written in parallel within one PR.

### 8.2 Model Assignments

| Model | Task Type | Rationale |
|-------|-----------|-----------|
| **Sonnet** | Individual test files (Batches 1–8), state machine guard implementations | Standard test logic: setup → act → assert. Needs to read source modules and construct correct mocks, but patterns are established after first file in each batch. |
| **Opus** | PR orchestration, journey tests (Batch 1.5), contract tests (Batch 3), review passes | Cross-system reasoning, multi-module coordination, judgment about what constitutes correct behavior. Journey tests require understanding 3+ modules interacting. |

> **Note:** Session 1 (Infrastructure) is complete — mocks, fixtures, utils, pr-check rules, and JSON.parse migration shipped in PR #141.

### 8.3 Parallelization by PR

#### PR 1: Infrastructure — COMPLETE

Shipped as PR #141. Includes: 6 mock factories, 5 seed fixtures, 2 test utilities,
`global-setup.ts` update, 5 pr-check rules, JSON.parse migration (17 server files).

#### PR 2: External Writes + Journeys (Batches 1 + 1.5)

**Phase A — Batch 1 (fully parallel):**

```
Parallel (each test file is independent):
  ├─ [Sonnet] #1  webflow-seo-writes.test.ts
  ├─ [Sonnet] #2  webflow-schema-writes.test.ts
  ├─ [Sonnet] #3  webflow-cms-writes.test.ts
  ├─ [Sonnet] #4  approval-execution.test.ts
  ├─ [Sonnet] #5  content-publish-writes.test.ts
  ├─ [Sonnet] #6  stripe-checkout-flow.test.ts
  ├─ [Sonnet] #7  stripe-webhooks.test.ts
  └─ [Sonnet] #7b stripe-webhook-idempotency.test.ts

Checkpoint: tsc + vitest + diff review
```

**Phase B — Batch 1.5 (limited parallelism, after Phase A checkpoint):**

```
Parallel (independent journeys):
  ├─ [Opus] J1  journey-payment-tier-upgrade.test.ts
  ├─ [Opus] J2  journey-content-publish.test.ts
  └─ [Opus] J5  journey-schema-publish.test.ts

Then parallel (read J1/J2 patterns first):
  ├─ [Opus] J3  journey-approval-to-webflow.test.ts
  └─ [Opus] J4  journey-strategy-to-client.test.ts

Checkpoint: full suite + scaled code review → PR
```

**Why together:** Journey tests validate the same write paths that Batch 1 mocks. Having both in one PR means the journey tests immediately exercise the mock infrastructure, catching any gaps before merge.

#### PR 3: State Machines + Contracts (Batches 2 + 3)

**Phase A — Batch 2: State Machine Guards (parallel):**

```
Sequential first:
  └─ [Sonnet] Implement validateTransition() functions for all 9+ entities
      (removes all status-ok annotations, replaces with real guards)

Then parallel:
  ├─ [Sonnet] #8   state-machines.test.ts (unit — uses state-machine-helper.ts)
  ├─ [Sonnet] #9   approval-state-flow.test.ts (integration)
  └─ [Sonnet] #10  content-lifecycle.test.ts (integration)

Checkpoint: tsc + vitest + diff review
```

**Phase B — Batch 3: Contracts (parallel, after Phase A checkpoint):**

```
Parallel:
  ├─ [Sonnet] #13  insight-data-shapes.test.ts
  ├─ [Sonnet] #14  intelligence-slice-population.test.ts
  ├─ [Sonnet] #15  client-intelligence-tiers.test.ts
  ├─ [Sonnet] #16  workspace-overview-shape.test.ts
  ├─ [Sonnet] #17  approval-batch-status.test.ts
  └─ [Sonnet] #18  websocket-event-shapes.test.ts

Checkpoint: full suite + scaled code review → PR
```

**Why together:** Contract tests that assert "invalid transition returns 400" need the `validateTransition()` guards to exist. Shipping both in one PR means no temporary suppressions.

#### PR 4: Auth, AI, Data Integrity, Remaining (Batches 4–8)

All batches in this PR are independent of each other — they only depend on PR 1 infrastructure. This allows maximum parallelism.

**Phase A — All batches in parallel:**

```
Parallel (organized by batch, each test file owns only itself):

  Batch 4 — Auth & Security:
  ├─ [Sonnet] #19  client-auth-full.test.ts
  ├─ [Sonnet] #20  admin-auth-guard.test.ts
  ├─ [Sonnet] #21  rate-limiting.test.ts
  ├─ [Sonnet] #22  workspace-access-control.test.ts
  ├─ [Opus]   #22b tier-gate-enforcement.test.ts
  └─ [Sonnet] #22c cross-workspace-isolation.test.ts

  Batch 5 — AI & Strategy Quality:
  ├─ [Sonnet] #23  strategy-generation.test.ts
  ├─ [Sonnet] #24  seo-audit-generation.test.ts
  ├─ [Sonnet] #25  brief-scoring.test.ts
  ├─ [Opus]   #26  content-brief-generation.test.ts
  └─ [Sonnet] #27  ai-token-tracking.test.ts

  Batch 6 — Data Integrity:
  ├─ [Sonnet] #28  json-column-corruption.test.ts
  ├─ [Sonnet] #29  parseJsonSafe-validation.test.ts
  ├─ [Sonnet] #30  migration-data-preservation.test.ts
  ├─ [Sonnet] #31  coalesce-sum-aggregates.test.ts
  └─ [Sonnet] #31b db-transaction-atomicity.test.ts

  Batch 7 + 7.5 — Client-Facing Correctness:
  ├─ [Sonnet] #32  client-dashboard-data.test.ts
  ├─ [Sonnet] #33  client-insights-rendering.test.ts
  ├─ [Sonnet] #34  client-activity-log.test.ts
  ├─ [Sonnet] #35  client-signals-flow.test.ts
  ├─ [Sonnet] #36  seo-score-display.test.ts
  ├─ [Sonnet] #36b client-copywriting-display.test.ts
  ├─ [Opus]   S1   webflow-id-semantics.test.ts
  ├─ [Sonnet] S2   brand-keyword-filter-wiring.test.ts
  └─ [Sonnet] S3   schema-site-template-merge.test.ts

  Batch 8 — Remaining Coverage:
  ├─ [Sonnet] #37  redirect-store-crud.test.ts
  ├─ [Sonnet] #38  analytics-annotations.test.ts
  ├─ [Sonnet] #39  gsc-data-freshness.test.ts
  ├─ [Sonnet] #40  seo-suggestions-lifecycle.test.ts
  ├─ [Sonnet] #41  performance-store-upsert.test.ts
  └─ [Sonnet] #42  rank-tracking-snapshots.test.ts

Checkpoint: full suite + scaled code review → PR
```

**Why together:** These batches share no file dependencies. Each test file owns only itself and reads from shared mocks/fixtures (read-only). Combining them reduces PR overhead and review cycles. The scaled code review handles the larger diff size.

### 8.4 Dependency Graph

```
PR 1: Infrastructure ──── COMPLETE (PR #141)
    │
    ├── Mocks, fixtures, utils, pr-check rules, JSON.parse migration
    │
    ▼
PR 2: External Writes + Journeys ──── requires: PR 1 mocks
    │
    │   Phase A: Batch 1 (8 parallel Sonnet agents)
    │   Phase B: Batch 1.5 (3+2 Opus agents, after Phase A checkpoint)
    │
    ▼
PR 3: State Machines + Contracts ──── requires: PR 1 helpers
    │
    │   Phase A: Batch 2 — implement validateTransition() + tests
    │   Phase B: Batch 3 — contract tests (after Phase A checkpoint)
    │
    ▼
PR 4: Auth, AI, Data, Remaining ──── requires: PR 1 infrastructure only
    │
    │   All batches (4–8) in parallel — no inter-batch dependencies
    │   ~35 test files across 6 batches
    │
    ▼
    DONE: ~305 tests across 54 test files
```

**Key constraint:** PRs 2-4 are strictly sequential because each PR's review findings may surface issues that affect later work. Within each PR, phases run sequentially (checkpoint between phases), but test files within a phase run in parallel.

**Self-contained principle:** Every PR resolves its own issues completely. No temporary annotations, no `status-ok` suppressions that depend on a future PR, no placeholder tests. If a guard function is needed, it ships in the same PR as the tests that exercise it.

### 8.5 Per-PR Effort Estimate

| PR | Phases | Parallel Agents | Est. Tests | Limiting Factor |
|----|--------|----------------|-----------|-----------------|
| 1 | 1 | 7 | 0 (infra only) | **COMPLETE** — PR #141 |
| 2 | A + B | 8 + 5 | ~90 | Journey test complexity (Opus), 2 checkpoints |
| 3 | A + B | 3 + 6 | ~65 | validateTransition() implementation before tests |
| 4 | 1 | ~35 | ~150 | Largest PR by file count; all batches independent |

---

## Appendix A: Risk-Weighted Priority Matrix

```
                    High Impact
                        │
    ┌───────────────────┼───────────────────┐
    │                   │                   │
    │  Batch 1          │  Batch 3          │
    │  External writes  │  Contract tests   │
    │  (phantom success)│  (type mismatch)  │
    │                   │                   │
    │  Batch 1.5        │  Batch 4          │
    │  User journeys    │  Tier-gate +      │
    │  (broken chains)  │  auth (revenue)   │
    │                   │                   │
High├───────────────────┼───────────────────┤Low
Like│                   │                   │Like
    │  Batch 2          │  Batch 5          │
    │  State machines   │  AI quality       │
    │  (invalid states) │  (prompt bugs)    │
    │                   │                   │
    │  Batch 6          │  Batch 8          │
    │  JSON safety +    │  Remaining gaps   │
    │  migrations       │  (display bugs)   │
    │                   │                   │
    └───────────────────┼───────────────────┘
                        │
                    Low Impact
```

## Appendix B: Existing Test Infrastructure Reference

| File | Purpose |
|------|---------|
| `tests/global-setup.ts` | Runs SQLite migrations once before parallel workers |
| `tests/db-setup.ts` | Disables FK constraints for test isolation |
| `tests/component/setup.ts` | @testing-library/jest-dom + cleanup |
| `tests/integration/helpers.ts` | `createTestContext(port)` — isolated server per test |
| `tests/fixtures/intelligence-seed.ts` | Workspace with insights + tracked actions |
| `tests/fixtures/rich-intelligence.ts` | Full intelligence data for prompt tests |
| `tests/fixtures/seo-context-mock.ts` | SEO context mock data |
| `tests/unit/competitor-brand-filter.test.ts` | 23 tests for brand keyword filtering (exists, not in original count) |
| `vite.config.ts` | Test config: jsdom env, setup files, include patterns |

## Appendix C: Implementation Schedule (4 PRs)

| PR | Batches | Est. Tests | Model Mix | Focus |
|----|---------|-----------|-----------|-------|
| 1 | Infrastructure | 0 | Sonnet | **COMPLETE** — mocks, utils, fixtures, pr-check, JSON.parse migration |
| 2 | 1 + 1.5 | ~90 | Sonnet (8) + Opus (5) | External write failures + journey workflows |
| 3 | 2 + 3 | ~65 | Sonnet (9) + Opus (review) | State machine guards + cross-layer contracts |
| 4 | 4 + 5 + 6 + 7 + 7.5 + 8 | ~150 | Sonnet (~30) + Opus (3) | Auth, AI quality, data integrity, client correctness, remaining |
| **Total** | | **~305** | | **54 test files across 4 PRs** |
| **Total** | | **~305** | | **10-11** | |
