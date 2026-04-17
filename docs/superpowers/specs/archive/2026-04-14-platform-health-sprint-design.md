# Platform Health Sprint — Design Spec

> Consolidated tech debt, bug fixes, and client experience improvements identified via full-platform audit (April 14, 2026). Prioritized by client impact first, error risk second, internal health third.

**Status:** Approved for planning
**Estimated effort:** 49-66h across 7 PRs
**Sprint type:** Sequential PRs, front-loaded with client-facing work

---

## Context

A full-platform audit on 2026-04-14 cross-referenced Devin's cleanup report, roadmap.json, intelligence-backlog.md, 6 pre-plan audit docs, and a deep sweep of server/, src/, and shared/ directories. Key findings:

- **12 items from Devin's report were already done** but not marked in roadmap
- **6 roadmap entries** need status updated to "done" (#583, #580, #581, #584, #574, #366)
- **20+ new tech debt items** discovered via platform audit (migration collisions, missing validation, unguarded AI calls, frontend mega-components)
- **9 shipped specs, 9 shipped plans, 6 completed audits** can be archived
- Light mode audit (148 instances) was already shipped — not debt

## Scope

### In scope
- Client-facing bug fixes and safety improvements
- Client experience features (compositeHealthScore, weCalledIt, cannibalizationWarnings)
- Error-producing code patterns (unvalidated endpoints, unguarded AI calls, missing ErrorBoundaries)
- Background job conversions (SEO Editor, SEO Audit)
- Intelligence wiring (portalUsage, actionBacklog, cannibalization prompt)
- Infrastructure plans already written (pre-commit hooks, CI coverage, pr-check audit)
- Test, doc, and roadmap cleanup

### Out of scope (Architecture Backlog — separate sprint)
- Server mega-file splitting (workspace-intelligence 2.5K, schema-suggester 2.5K, keyword-strategy 2.3K lines)
- Frontend mega-component splitting (SchemaSuggester 50 hooks, SeoAudit 44, ClientDashboardTab 38)
- useClientData retyping (28 `as unknown` casts)
- Cache consolidation (5 overlapping systems)
- React Query migration for 10 raw-fetch components
- Response format standardization
- Shared tab/filter hook extraction
- Cron scheduling cleanup
- Schema normalization (contentGaps, quickWins, keywordGaps, topicClusters, cannibalization into dedicated tables)

---

## PR 1: Client-Facing Fixes & Safety

**Goal:** Eliminate crash vectors and data integrity risks that clients can trigger or experience.

### 1.1 Public endpoint validation (2-3h)

`server/routes/public-content.ts` has 77 `req.body`/`req.params` references with zero `validate()` middleware calls. This is a client-facing route file — every endpoint is reachable by client portal users.

**Work:**
- Add Zod schemas for every POST/PATCH/DELETE endpoint in `public-content.ts`
- Use existing `validate()` middleware from `server/middleware/validate.ts`
- Follow existing patterns in `public-portal.ts` which already has validation

**Acceptance:** Every mutation endpoint in `public-content.ts` uses `validate()`. `npm run typecheck` passes.

### 1.2 Migration collision verification (1h)

Three migration number pairs have duplicates:
- `035-analytics-insights.sql` vs `035-schema-validations.sql`
- `036-analytics-annotations.sql` vs `036-llms-txt-cache.sql`
- `037-analytics-insights-fix-unique.sql` vs `037-llms-txt-freshness.sql`

**Work:**
- Check production DB schema to determine which file in each pair actually ran
- Renumber the un-run files to the next available migration numbers (061, 062, 063)
- Verify local dev DB matches production schema after fix
- Add a pr-check rule or migration naming convention to prevent future collisions

**Acceptance:** All 6 migrations have unique numbers. `server/db/migrations/` has no number collisions. Local schema matches production.

### 1.3 ErrorBoundary on page-level components (2-3h)

These page-level components lack ErrorBoundary wrapping — a single child component error takes down the entire page with a white screen:

**Admin pages:**
- `PageIntelligence.tsx` (1,292 lines)
- `SeoAudit.tsx` (1,273 lines)
- `AssetBrowser.tsx` (747 lines)
- `BrandHub.tsx` (557 lines)
- `Styleguide.tsx` (858 lines)

**Client portal pages:**
- `ClientDashboard.tsx`
- `ClientReports.tsx`
- Other client portal page-level components without ErrorBoundary (verify via grep)

**Work:**
- Wrap each component's render output in `<ErrorBoundary>` from `src/components/ui/`
- Use empathetic error messages with retry CTAs per CLAUDE.md UI/UX rules
- Client portal pages are higher priority — a crash here affects paying customers

**Acceptance:** All listed components have ErrorBoundary. A simulated child error shows recovery UI, not white screen.

### 1.4 Unguarded AI calls (1h)

`server/discovery-ingestion.ts` and `server/anomaly-detection.ts` call `callOpenAI()` without try-catch. Any OpenAI API failure becomes an unhandled promise rejection → 500 to the client.

**Work:**
- Wrap each bare `callOpenAI()` call in try-catch
- Log error with `createLogger()`, return graceful fallback (empty result or skip)
- Follow existing patterns in `schema-suggester.ts` and `internal-links.ts`

**Acceptance:** grep for bare `callOpenAI` outside try blocks returns zero hits in these files.

### 1.5 SEO Editor bulk analyze → background job (1h)

`SeoEditor.tsx` lines 390-397: sequential `for` loop calling `await analyzePage()`. Client navigates away = lost progress.

**Work:**
- Convert to server-side background job using existing job infrastructure
- Add progress tracking via WebSocket broadcast
- Frontend shows progress indicator that persists across navigation

**Acceptance:** Bulk analyze runs server-side. Navigation doesn't cancel the operation.

### 1.6 SEO Editor bulk rewrite apply → background job (1.5h)

`SeoEditor.tsx` lines 493-504: sequential `for` loop pushing to Webflow API.

**Work:** Same pattern as 1.5 — server-side job with WS progress.

**Acceptance:** Bulk apply runs server-side with progress tracking.

### 1.7 SEO Audit accept-all fixes → background job (1h)

`SeoAudit.tsx` lines 332-336: sequential `for` loop with `await acceptSuggestion()`.

**Work:** Same pattern as 1.5.

**Acceptance:** Accept-all runs server-side with progress tracking.

### 1.8 Stripe config endpoint authentication (1h)

`server/routes/stripe.ts` has 4 endpoints for managing Stripe configuration (`GET/POST/DELETE /api/stripe/config/*`) with **zero authentication middleware**. These endpoints can read and write Stripe secret keys, webhook secrets, and product configuration without any auth check.

**Work:**
- Add authentication middleware to all Stripe config CRUD endpoints
- Verify the global `APP_PASSWORD` gate in `app.ts` covers these routes, or add explicit auth checks
- Do NOT add `requireAuth` (admin routes use HMAC, per CLAUDE.md Auth Conventions)

**Acceptance:** All Stripe config endpoints require authentication. Unauthenticated requests return 401.

---

## PR 2: Client Experience Improvements

**Goal:** Surface intelligence data that already exists on the backend as client-facing UI.

### 2.1 compositeHealthScore dashboard (3-5h)

`clientSignals.compositeHealthScore` is already assembled by `buildWorkspaceIntelligence()` — weighted aggregate of 40% churn risk + 30% ROI trend + 30% engagement, normalized to 0-100.

**Work:**
- Admin dashboard: workspace list sorted by health score, at-risk clients highlighted
- Client dashboard: headline health metric (like a credit score for their SEO)
- Use `scoreColor()` / `scoreColorClass()` for color coding (blue for data, per Three Laws)
- Use `MetricRing` or `MetricRingSvg` for visual representation

**Acceptance:** Health score visible on both admin workspace list and client dashboard. Colors follow Three Laws. `<TierGate>` wrapping if premium-only.

### 2.2 weCalledIt prediction showcase card (2-4h)

`learnings.weCalledIt` is already assembled — packages predictions that came true with confidence scores.

**Work:**
- Client-facing card: "We predicted [keyword X] would reach page 1 within 45 days — it did in 38 days"
- Use narrative, outcome-oriented language (no admin jargon, no purple)
- Show top 3-5 strongest predictions
- Include confidence score and actual vs predicted timeline

**Acceptance:** Card renders on client dashboard when predictions exist. Empty state with CTA when none. No purple. No admin language.

### 2.3 cannibalizationWarnings frontend alerts (2-3h)

`contentPipeline.cannibalizationWarnings` is already assembled — detected keywords where multiple pages compete.

**Work:**
- Alert component in content pipeline dashboard
- Show affected keywords, competing pages, and estimated ranking dilution
- CTA to trigger keyword strategy review
- Wrap in `<TierGate>` for premium feature gating

**Acceptance:** Alerts appear when cannibalization data exists. Actionable CTAs. Premium-gated.

---

## PR 3: Bug Fixes & Correctness

**Goal:** Fix silent failures and incorrect data.

### 3.1 PageHealthData `as never` in reports.ts (0.5h)

One remaining type escape hatch in `server/reports.ts` at line 197.

**Work:** Properly type the value instead of casting.

### 3.2 Auto-resolve audit_finding insights when fixed (#4168, 2-3h)

Insights of type `audit_finding` stay open after the underlying issue is fixed.

**Work:**
- When an audit re-runs and the finding is no longer present, auto-resolve the insight
- Use `resolveInsight()` from existing infrastructure
- Log resolution via `addActivity()`

### 3.3 Bridge #12: refresh audit_finding data (#4178, 1-2h)

Audit finding data goes stale — bridge doesn't trigger refresh.

**Work:**
- Wire bridge trigger on audit completion
- Follow bridge authoring rules from `docs/rules/bridge-authoring.md`
- Pass `bridgeSource` for stale-cleanup immunity
- Return `{ modified: N }`, never manually broadcast

### 3.4 Anomaly boost reversal mechanism (#4188, 3-4h)

When anomalies resolve, the score boost they applied isn't reversed — scores inflate over time.

**Work:**
- Track which insights received anomaly boosts
- When anomaly resolves, reverse the boost via `applyScoreAdjustment()`
- Follow bridge authoring rules

### 3.5 Strategy cards: below-threshold volume (#4231, 1-2h)

Strategy cards display keywords with volume below the useful threshold.

**Work:**
- Add volume threshold filter before rendering strategy cards
- Threshold should be configurable or use a sensible default

---

## PR 4: Intelligence & Infrastructure

**Goal:** Improve data quality and close type system gaps.

### 4.1 Wire portalUsage (1-2h)

`clientSignals.portalUsage` is hardcoded `null` at workspace-intelligence.ts lines 1082 and 1110.

**Work:**
- Query activity log for client portal login/page-view events
- Count recent sessions and last-active timestamp
- Wire into `assembleClientSignals()` in workspace-intelligence.ts

**Acceptance:** `portalUsage` returns real data when portal activity exists.

### 4.2 actionBacklog escalation (1-2h)

No alerting when action backlog exceeds threshold.

**Work:**
- Add threshold check in outcome-crons
- Alert admin when backlog > N items or average age > M days
- Use existing notification infrastructure

### 4.3 SEO audit + cannibalization prompt (1h)

When auditing a page whose keyword is cannibalized, the AI just recommends meta tag fixes. Should recommend consolidation.

**Work:**
- In `server/seo-audit.ts` or equivalent, check cannibalization data from intelligence layer
- Add conditional prompt block: "This keyword is also targeted by [other pages]. Consider consolidation."

### 4.4 Barrel export completion (1h)

`shared/types/index.ts` is missing 9 type files: `brand-engine`, `outcome-tracking`, `copy-pipeline`, `diagnostics`, `page-strategy`, `feature-flags`, `features`, `narrative`, `cms-images`.

**Work:** Add re-exports for all 9 files.

### 4.5 Dead code removal (0.25h)

`server/test-deduplication.ts` — 71-line dead test script in production server directory.

**Work:** Delete it.

---

## PR 5: Infrastructure Plans

**Goal:** Execute three existing plans that improve platform reliability.

### 5.1 Pre-commit hooks (2h)

Plan exists at `docs/superpowers/plans/2026-04-11-pre-commit-hooks.md`. Husky v9 pre-commit gates: typecheck + pr-check + changed-files test pass.

### 5.2 CI coverage thresholds (3h)

Plan exists at `docs/superpowers/plans/2026-04-11-coverage-thresholds.md`. @vitest/coverage-v8 with ratcheting thresholds.

### 5.3 pr-check audit PR A (4-6h)

Plan exists at `docs/superpowers/plans/2026-04-10-pr-check-audit-and-backfill.md`. 11 new pr-check rules + nightly full-scan CI.

---

## PR 6: Test & Doc Cleanup

**Goal:** Close coverage gaps and reduce noise.

### 6.1 Fix 4 skipped tests (1h)

`tests/integration/health-routes.test.ts` has 4 `.skip()` tests (lines 45, 56, 64, 72). Comment references commit 365a02a1 requiring async storage refactor.

### 6.2 Audit docs/rules/*.md (#585, 2-3h)

Verify file paths, cross-check against CLAUDE.md, flag rules that could become pr-check rules.

### 6.3 Empty state CTAs — 25+ components (3-4h)

Per admin-ux-restructure audit, 25+ `EmptyState` usages lack CTAs (top 10 done, remainder deferred).

**Work:** Add action-oriented CTAs to remaining EmptyState usages following existing patterns.

### 6.4 Client portal error feedback (2-3h)

Multiple client portal components use `.catch(err => log.warn(...))` without updating UI state — the user sees an infinite spinner instead of an error message with retry. This affects the client portal experience for paying customers.

**Work:**
- Audit `src/components/client/` for `.catch()` handlers that only log without updating UI state
- Add user-facing error states: set loading to false, show inline error with retry CTA
- Follow existing error handling patterns from well-implemented components

**Acceptance:** No client portal component silently swallows errors with infinite spinners.

### 6.5 Archive shipped docs (1h)

Move to `docs/superpowers/archive/`:
- **9 shipped specs:** brandscript-engine-design, page-strategy-engine-design, copy-pipeline-design, analytics-hub-redesign, dashboard-visual-polish-design, light-mode-audit-design, admin-ux-restructure-design, deep-diagnostics-design, admin-ux-pr3-shared-ux-design
- **9 shipped plans:** brandscript-engine, page-strategy-engine, copy-pipeline, analytics-hub-redesign, dashboard-visual-polish, light-mode-audit, admin-ux-restructure, deep-diagnostics, admin-ux-pr3-shared-ux
- **6 completed audits:** light-mode-and-polish-audit, intelligence-phase2-bridge-audit, page-strategy-engine-audit, admin-ux-restructure-audit, copy-pipeline-audit, deep-diagnostics-audit

**Keep in place:** intelligence-backlog.md, MODULE_OWNERSHIP_MAP.md, COPY_ENGINE_GUARDRAILS.md, unified-workspace-intelligence.md, outcome-intelligence-engine-design, platform-intelligence-enhancements-design, pr-check-audit-and-backfill plan, coverage-thresholds plan, pre-commit-hooks plan, intelligence-phase2-context.md, copy-engine-future-phases, connected-intelligence-design.

---

## PR 7: Roadmap Housekeeping

**Goal:** Single source of truth for project status.

### 7.1 Mark 6 done items in roadmap (0.5h)

Update status to "done" with notes:
- #583 — email-throttle mapping (verified correct, not guessed)
- #580 — AnalyticsInsight.data typing (no `as never` remaining)
- #581 — KeywordStrategy schema drift (no `as unknown` remaining)
- #584 — applyScoreAdjustment escape hatches (no casts remaining)
- #574 — JSON validation follow-up (no bare JSON.parse in flagged files)
- #366 — pageEditStates normalization (dedicated table exists)

### 7.2 Consolidate scattered items into roadmap (0.5h)

Add roadmap entries for items currently tracked only in intelligence-backlog.md or audit docs:
- portalUsage wiring
- actionBacklog escalation
- Empty state CTAs (25+ remaining)
- Migration collision fix
- Public endpoint validation
- ErrorBoundary additions
- Unguarded AI call fixes

---

## Architecture Backlog (out of scope, tracked for future)

These items were surfaced by the platform audit but are each multi-session projects. Track in roadmap backlog:

| Item | Est. | Trigger |
|------|------|---------|
| Server mega-file splitting (workspace-intelligence 2.5K, schema-suggester 2.5K, keyword-strategy 2.3K) | 15-20h | When touching these files for features |
| Frontend mega-component splitting (SchemaSuggester 50 hooks, SeoAudit 44, ClientDashboardTab 38) | 20-30h | When next feature touches them |
| useClientData retyping (28 `as unknown`) | 3h | When client API contract changes |
| Cache consolidation (5 overlapping systems) | 4-6h | Dedicated session |
| React Query migration (10 raw-fetch components) | 5-8h | Dedicated session |
| Response format standardization (`success: true` vs `ok: true` vs raw) | 3-4h | When API versioning |
| Shared tab/filter hooks (14 tab impls, 7 filter impls) | 3-4h | Next UI feature sprint |
| Cron scheduling cleanup (11 jobs, startup collision) | 2h | Next infra session |
| Schema normalization (contentGaps, quickWins, keywordGaps, topicClusters, cannibalization) | 9.5h | When perf issues arise |
| Error handling standardization (303 catch blocks, 5 styles) | 4-6h | Dedicated session |
| API endpoint centralization (23+ hardcoded URLs in frontend) | 2h | Next frontend refactor |
| Hardcoded color extraction (30+ rgba values) | 2h | Next theme work |

---

## Success Criteria

- [ ] All PR 1 items shipped — zero unvalidated public endpoints, no migration collisions, ErrorBoundaries on all major pages
- [ ] compositeHealthScore, weCalledIt, and cannibalizationWarnings visible to clients
- [ ] All bug fixes from PR 3 verified — audit insights auto-resolve, anomaly boosts reverse, strategy cards filter low-volume
- [ ] Pre-commit hooks and CI coverage thresholds active
- [ ] Roadmap reflects ground truth — no stale "pending" items, no scattered tracking
- [ ] Shipped docs archived, active docs current
- [ ] `npm run typecheck && npx vite build && npx vitest run` all pass
- [ ] `npx tsx scripts/pr-check.ts` zero errors
