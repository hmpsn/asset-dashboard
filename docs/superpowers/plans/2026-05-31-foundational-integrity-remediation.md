# Foundational Integrity Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source audit:** [docs/audits/2026-05-31-foundational-integrity-audit.md](../../audits/2026-05-31-foundational-integrity-audit.md) (39 adversarially-confirmed findings).
> **Granularity note:** This is a phase/task-level plan. Per-task TDD step expansion (write failing test → run → implement → run → commit) happens at execution time, where each executor reads its target file first (CLAUDE.md "read-before-write" law). Code sketches below are grounded in files read during the pre-plan audit; every cited signature was verified on this tree.

**Goal:** Wire the platform's existing-but-disconnected machinery so the three intended capabilities actually work end-to-end: (i) one reconciled ranked priority per client, (ii) a closed recommendation→action→outcome→ROI loop, (iii) a complete, fresh AI-advisor context.

**Architecture:** Almost entirely connective. The expensive subsystems (recommendation engine, live outcome-measurement engine, intelligence slices, ROI computation, publish paths) already exist. The work is: add the missing regen/resolve/invalidate/record calls at write sites, add one value column to the live outcome table, and reconcile four siloed priority stores into one resolved representation following the existing `effectiveBrandVoiceBlock` authority pattern.

**Tech Stack:** Express + TypeScript, SQLite (better-sqlite3, WAL, FKs ON), `server/intelligence/` slice facade, React 19 + React Query frontend. Claude/Anthropic agent platform (Haiku/Sonnet/Opus ladder).

---

## Pre-requisites

- [x] Source audit committed: `docs/audits/2026-05-31-foundational-integrity-audit.md`
- [x] Pre-plan audit complete (verified scope below)
- [x] Live state confirmed: `outcome-tracking` AND `outcome-ai-injection` flags are **ON** for both live clients → outcomes are recorded/scored and `action_outcomes` holds real data; the ROI work is *attribution-value*, not *enable + backfill the engine*.
- [ ] **Decision to confirm before Phase 2** (see Decision Point below): canonical ROI source = **extend `action_outcomes`** (recommended) vs resurrect `roi_attributions`.

## Decision Point — Canonical ROI source (confirm before Phase 2)

The audit found three disjoint value stores. The plan must pick one canonical home for "attributed dollar value of an action."

| Option | Evidence | Verdict |
|---|---|---|
| **A. Extend `action_outcomes` (RECOMMENDED)** | It is the LIVE table — `action_id → tracked_actions(id)` FK already links it to the recommendation/action chain (041-outcome-tracking.sql:31-45); the measurement engine populates it today (`outcome-engine-stubs.md`: shipped 2026-03-29); `computeROI` already proves the `clicks × cpc` value formula with per-page CPC from `page_keywords` (roi.ts:155-166). Adding one column reuses all of it. | **Do this.** |
| B. Resurrect `roi_attributions` | Table has zero writers, is NOT in the outcome-engine-stubs registry (orphaned), and its DDL has no `action_id`/`recommendation` link (040-insight-resolution-tracking.sql:8-29) — wiring it would duplicate the live engine and still not close the rec→ROI link. | Reject; retire the table instead. |

**This plan assumes Option A.** If the owner prefers B, Phase 2 tasks 2.1–2.4 change.

---

## Verified Scope (Pre-Plan Audit Results)

Every claim re-verified on `ultracode-audit` (== `origin/staging`, tip `480bdc01`).

| ID | Finding | Verified evidence (this tree) | Fix task |
|----|---------|-------------------------------|----------|
| A-1 | Applied changes never resolve/regen recs | `generateRecommendations` has exactly 4 callers (recommendations.ts:638; jobs.ts:237; keyword-strategy-follow-ons.ts:83; routes/recommendations.ts:29/42) — none in approvals/work-orders. `updateRecommendationStatus(ws,recId,status)` exists (recommendations.ts:286). Auto-resolve only on full regen (recommendations.ts:1368-1384). | 1.1 |
| A-2 | Strategy PATCH never regenerates recs | keyword-strategy.ts PATCH invalidates cache (:489/494/505) but never calls `queueKeywordStrategyPostUpdateFollowOns`; sibling does at keyword-strategy-generation.ts:319/470. | 1.2 |
| A-7/A-8 | Outcome/publish never regen recs | outcome-crons.ts:70/144 invalidate only; no regen. | 1.3 |
| (frontend) | WS events don't invalidate recs query | `RECOMMENDATIONS_UPDATED` broadcast exists (recommendations.ts:1468); confirm frontend handler invalidates the recs query key. | 1.4 |
| B-1 | `roi_attributions` dead | `recordOptimization`/`measureOutcome`/`getUnmeasuredOptimizations` = definitions only, **zero callers** repo-wide. | 2.4 |
| B-3 | `action_outcomes` has no value column | DDL confirmed: no monetary column (041:31-45). | 2.1/2.2 |
| B-4 | ROI dashboard + milestone bridge severed | `roi_snapshots` DDL has no action ref (003:168-174); `briefing-cron.ts:346-351` reads `contentRequestId`/`currentClicks`/`title` — absent from `ContentItemROI` (roi.ts:121-132), hidden by `as` cast → milestone story never fires. | 2.5 |
| A-3 | Digest can't prove work | `monthly-digest.ts:69` reads dead table; `:78` filters `resolutionStatus==='resolved'` but apply sets `'in_progress'` (outcome-tracking.ts:147-166). | 2.3/2.8 |
| A-4 | Manual content-publish records no action | content-publish.ts:34-165 has no `recordAction`; sibling content-posts.ts:411-428 does (guarded `getActionBySource` + `captureBaselineFromGsc`). | 2.6 |
| A-5 | Backfill safety-net unwired | `outcome-backfill.ts` fully built + idempotent (`runBackfill`/`backfillPublishedContent`/`backfillResolvedInsights`/`backfillCompletedRecommendations`) — **zero callers**. | 2.7 |
| A-6 | Schema CMS-field publish records no action | webflow-schema.ts:427-442 early-returns before the `recordAction` at :504-524. | 2.6 |
| B-2 | Four priority stores, no unifying rank | `recommendation_sets` (003:126), `client_business_priorities` (021:5), `workspaces.business_priorities` (048; comment: "Distinct from the client_business_priorities table"), `client_actions.priority` (083:12). Ranking (recommendations.ts:1414-1418) = tier+impactScore only. | 3.1/3.2 |
| B-6 | `businessPriorities` split table/column | client store → clientSignals slice; admin column → seoContext.businessProfile.goals. Same JS name, no precedence. | 3.1 |
| B-7 | No single-priority pointer | `topRecommendationId\|primaryFocus\|theOneMove` = **zero matches** repo-wide. `summary` built at recommendations.ts:1440-1449. | 3.3 |
| A-9/11/12/13 | Write sites don't invalidate intel cache | `invalidateIntelligenceCache` has 60+ callers but **none** in approvals.ts, webflow-schema.ts, outcomes.ts, webflow-analysis.ts, or seo-bulk paths. Sibling: client-actions-mutations.ts:42. | 4.1 |
| A-15/B-9/B-12 | Data in no intelligence slice | page_edit_states, workspace_metrics_snapshots (080), competitor_snapshots (070) read by routes/crons but no `assemble*` slice (Data-Flow rule #6). | 4.2 |
| A-10 | Advisor has no tier/usage | operational-slice.ts:66-86 reads usage, discards limit/remaining; no tier field. | 4.2 |
| B-10 | Admin-chat drops assembled slices | admin-chat-context-builder.ts assembles operational/siteHealth/clientSignals/insights but `formatForPrompt`s only `seoContext`+`learnings` (:71-89). | 4.3 |

---

## Phases (each phase = exactly one PR; phase N+1 not started until N is merged + green on staging)

```
Phase 1 (priority freshness wiring)   — highest impact / lowest effort
   ↓
Phase 2 (close ROI dollar loop)        — the one real structural build; gated on Decision Point
   ↓
Phase 3 (reconcile priority structure) — shares recommendations.ts with Phase 1 → sequence after it
   ↓
Phase 4 (advisor context completeness) — independent; can also run parallel to Phase 3 if recommendations.ts not touched
```

---

## Phase 1 — Priority Freshness Wiring (capability i)

**Owning context:** Recommendations engine (`server/recommendations.ts`) + Inbox/Approvals (`server/approvals.ts`, `server/routes/approvals.ts`, `server/work-orders.ts`). See `docs/rules/platform-organization.md` to confirm exact ownership.
**Shared type contracts:** none new (reuses `RecStatus`, `updateRecommendationStatus`).
**WS events:** reuse `WS_EVENTS.RECOMMENDATIONS_UPDATED` (recommendations.ts:1468). **Query keys:** the `recommendations` React Query key.
**Work class:** new behavior (wiring).

### Task 1.1 — Resolve matching recs in-place on apply/completion (Model: Opus — touches the ranking-critical engine)

**Files:**
- Modify: `server/recommendations.ts` (add exported helper `resolveRecommendationsForChange(workspaceId, { affectedPages, source })` that loads recs, marks matching non-completed recs `completed` via the existing merge-key/`affectedPages` logic, saves, invalidates cache, broadcasts `RECOMMENDATIONS_UPDATED`)
- Modify: `server/routes/approvals.ts:458-517` (apply path) and `:308-359` (per-item)
- Modify: `server/work-orders.ts` (completion path, near the existing `invalidateIntelligenceCache` at :169)
- Test: `server/__tests__/recommendations-resolve-on-apply.test.ts` (new) + an approvals integration test

**Approach (grounded):** Reuse `loadRecommendations`/`saveRecommendations` (recommendations.ts:260-284) and the `buildMergeKey`/`affectedPages` logic the auto-resolve branch already uses (recommendations.ts:1368-1410). Mark in-place (immediate, GSC-lag-free) rather than full regen — `updateRecommendationStatus` already exists for single-rec status changes. Use `validateTransition` from `server/state-machines.ts` before the status change (CLAUDE.md: status transitions must go through state machines).

- [ ] Write failing test: applying an approval whose `affectedPages` match a `pending` quick-win rec marks that rec `completed` and drops it from the active priority list.
- [ ] Run; confirm fail.
- [ ] Implement `resolveRecommendationsForChange`; call it from the three write sites after their existing DB writes.
- [ ] Run; confirm pass + `npm run typecheck`.
- [ ] Commit.

### Task 1.2 — Strategy PATCH triggers rec regen (Model: Sonnet)

**Files:**
- Modify: `server/routes/keyword-strategy.ts:413-534` (after the txn commits at ~:477, before/with the existing cache invalidation)
- Test: integration test on `PATCH /api/webflow/keyword-strategy/:workspaceId`

**Approach:** Add `queueKeywordStrategyPostUpdateFollowOns({ workspaceId: ws.id })` — copy the exact call from `keyword-strategy-generation.ts:319/470`. Verify its import is added at top-of-file (CLAUDE.md import rule). The follow-on queue already calls `generateRecommendations` (keyword-strategy-follow-ons.ts:83), so this reuses the regen path without inlining it.

- [ ] Failing test: PATCH then GET recommendations reflects the edited strategy (rec set `generatedAt` advances).
- [ ] Implement; typecheck; pr-check; commit.

### Task 1.3 — Outcome/publish debounced regen (Model: Sonnet)

**Files:** `server/outcome-crons.ts:40-152` (after measure/learnings), `server/routes/webflow-schema.ts` + `server/routes/content-publish.ts` (after publish).

**Approach:** Route these through the same `queueKeywordStrategyPostUpdateFollowOns`-style debounced queue used in 1.2 (avoid synchronous full regen on every publish). Confirm the queue debounces per-workspace; if not, add a debounce so a bulk publish doesn't trigger N regens.

- [ ] Failing test: a measured outcome enqueues a rec regen for the workspace.
- [ ] Implement; typecheck; commit.

### Task 1.4 — Frontend invalidation (Model: Haiku)

**Files:** `src/hooks/**/useWsInvalidation.ts` (the `RECOMMENDATIONS_UPDATED`, `STRATEGY_UPDATED`, `OUTCOME_*` cases).

**Approach:** Per CLAUDE.md Data-Flow rule #2 + "feedback loop completeness", each of these `useWorkspaceEvents` cases must `queryClient.invalidateQueries` the `recommendations` key. Read the file first to match existing key constants (`queryKeys.*`).

- [ ] Add/confirm invalidation for each event; verify with a component test or manual WS trace.

### Phase 1 Systemic Improvements
- **pr-check rule (warn) — DEFERRED to Phase 4's systemic batch:** "SEO-state write in `server/routes/` should resolve/regen recommendations or carry `// rec-refresh-ok`." Deferred deliberately: the write-then-refresh pattern is only complete once Phase 4 wires the remaining SEO-write paths, so authoring the rule now (against a half-covered surface) would either false-positive or bake in an incomplete allow-list. The `// rec-refresh-ok` annotations added in Phase 1 are intent markers the rule will recognize when authored. Model on rule #8 ("Missing broadcastToWorkspace after DB write", automated-rules.md:170).
- **Tests:** integration tests above; a contract test that `RECOMMENDATIONS_UPDATED` has a frontend handler (mirror the existing tab-deep-link contract test pattern).

### Phase 1 Scope Note & Deferrals (recorded after adversarial review, 2026-05-31)
- **In scope (done):** rec resolution on approval *apply* + work-order completion (with Webflow/CMS page-ID → slug resolution via `page_edit_states`); strategy-PATCH regen; outcome-cron + content/schema-publish regen; shared `computeRecommendationSummary` so in-place resolves keep headline counts honest. Frontend invalidation was already satisfied by the existing `RECOMMENDATIONS_UPDATED` handler.
- **Intentionally NOT in Phase 1:** the bulk admin SEO-write paths `webflow-seo-apply.ts`, `webflow-seo-suggestions.ts`, `webflow-cms.ts` also apply SEO changes but belong to the **Phase 4 / audit A-13 cache-invalidation cluster** (same files, same commit) — wiring rec-resolve there alongside cache invalidation is more efficient and avoids touching those files twice. Tracked for Phase 4.
- **Deliberate design note:** rec resolution fires on the *apply* path only, never on per-item *approve* (approve doesn't make the change live; a premature `completed` would be preserved by the regen merge and permanently hide a still-valid rec).

### Phase 1 Verification
- [ ] `npm run typecheck && npx vite build && npx vitest run`
- [ ] `npx tsx scripts/pr-check.ts`
- [ ] Manual: approve+apply a quick-win on a seeded workspace (`npm run seed:demo`), confirm it leaves the priority list and the advisor (AdminChat) no longer cites it.

---

## Phase 2 — Close the ROI Dollar Loop (capability ii)

**Owning context:** Outcome engine (`server/outcome-*.ts`, `server/roi*.ts`) + Content/Schema publish (`server/routes/content-publish.ts`, `webflow-schema.ts`). **Work class:** structural + wiring.
**Shared contracts (commit FIRST, Task 2.1):** the `action_outcomes` value column + `ActionOutcome` type + mapper.

### Task 2.1 — Migration + mapper lockstep for the value column (Model: Sonnet) — SEQUENTIAL, do first

**Files (CLAUDE.md "DB column + mapper lockstep", line 261 — all in one commit):**
- Create: `server/db/migrations/106-action-outcome-value.sql` → `ALTER TABLE action_outcomes ADD COLUMN attributed_value REAL; ALTER TABLE action_outcomes ADD COLUMN value_basis TEXT;` (mirror on `action_outcomes_archive`)
- Modify: the `action_outcomes` row interface + `rowToOutcome` mapper in `server/db/outcome-mappers.ts`
- Modify: write path `recordOutcome` in `server/outcome-tracking.ts:258-362`
- Modify: `shared/types/outcome-tracking.ts` (`OutcomeScore`/outcome shape) if value is surfaced in types
- Modify: `server/routes/public-portal.ts` serialization IF client-facing
- Test: `server/__tests__/outcome-value-column.test.ts`

- [ ] Failing test: `recordOutcome` persists and `rowToOutcome` round-trips `attributedValue`.
- [ ] Run migration locally (`npm run db:migrate`); implement; typecheck; commit (this is the shared contract for 2.2–2.4).

### Task 2.2 — Populate attributed value (Model: Sonnet)

**Files:** `server/outcome-tracking.ts` (`recordOutcome` / measurement path), reading per-page CPC.

**Approach (grounded):** `computeROI` already derives value as `clicks × cpc` from `listPageKeywords(workspaceId)` (roi.ts:143,155-166). Reuse that lookup: `attributed_value = clicks_delta × page.cpc`, `value_basis = 'clicks_delta_x_cpc'`. When no GSC baseline/CPC (the `inconclusive` path from outcome-engine-stubs §`fetchCurrentMetrics`), leave `attributed_value` NULL rather than fabricate 0.

- [ ] Failing test: an outcome with clicks_delta=10 and page cpc=2.5 records attributed_value=25.
- [ ] Implement; typecheck; commit.

### Task 2.3 — Re-point digest + learnings reads off the dead table (Model: Sonnet)

**Files:** `server/monthly-digest.ts:69` (`getROIHighlights`), `server/intelligence/learnings-slice.ts:48-49`.

**Approach:** Replace reads of `roi_attributions` with the live `action_outcomes` (use/extend `getTopWinsForWorkspace` to return `attributed_value`). Per "read-before-write" law, read each consumer's expected shape before swapping.

- [ ] Failing test: digest `roiHighlights` is non-empty for a workspace with a scored, valued outcome.
- [ ] Implement; typecheck; commit.

### Task 2.4 — Retire `roi_attributions` (Model: Haiku)

**Files:** `server/roi-attribution.ts` (now caller-less), and the deprecation tracker.

**Approach:** Per `docs/rules/deprecation-lifecycle.md`, mark `deprecated` → `removed` only after 2.3 confirms no readers remain. Record the state per the lifecycle contract. Do NOT drop the table in the same PR as the read migration (data-safety); mark deprecated, schedule removal.

- [ ] Confirm zero readers (grep), mark deprecated, commit.

### Task 2.5 — Fix the silent-fail milestone bridge (Model: Opus — field-semantics bug)

**Files:** `server/briefing-cron.ts:344-364`, `server/roi.ts:121-132` (`ContentItemROI`).

**Approach (grounded):** The bridge reads `contentRequestId`/`currentClicks`/`title`; the real fields are `requestId`/`clicks`/(no title) and the matcher should use `targetPageSlug`/`requestId`. Per CLAUDE.md "read-before-write" + "Field semantics changed": grep every reader of `ContentItemROI`, align the bridge to the actual field names (or add the missing fields to `ContentItemROI` and populate them in `computeROI`), and remove the `as {…}` cast that hid the mismatch.

- [ ] Failing test: a content item with clicks≥100 produces a `milestone_attribution` story (currently silently never fires).
- [ ] Implement; typecheck; commit.

### Task 2.6 — Record actions on the two un-instrumented publish paths (Model: Sonnet)

**Files:** `server/routes/content-publish.ts:34-165` (manual publish), `server/routes/webflow-schema.ts:427-442` (CMS-field branch, before the early return).

**Approach (grounded sibling):** Mirror `server/routes/content-posts.ts:411-428` exactly — guard with `getActionBySource(sourceType, sourceId)`, then `recordAction({ workspaceId, actionType, sourceType, sourceId, pageUrl, targetKeyword, baselineSnapshot, sourceFlag, baselineConfidence, attribution })`, then fire-and-forget `captureBaselineFromGsc`. Use `actionType: 'content_published'` / `'schema_deployed'`. Respect the pr-check "Unguarded recordAction() call" rule (the guard + `// recordAction-ok` comment pattern seen in outcome-backfill.ts:83).

- [ ] Failing tests (one per path): publishing records exactly one tracked action, idempotently.
- [ ] Implement both in one commit (cross-cutting: both publish paths); typecheck; pr-check; commit.

### Task 2.7 — Wire the backfill reconciler (Model: Haiku)

**Files:** `server/outcome-crons.ts` (add a cron), reusing `runBackfill` from `server/outcome-backfill.ts:237`.

**Approach:** Add `runBackfill()` as a staggered-startup + weekly cron, mirroring the existing cron registration in outcome-crons.ts (per outcome-engine-stubs §6, crons fire once at startup with 15-30s delay). `runBackfill` is idempotent (`getActionBySource` guards), so it safely recovers any publish that slipped through 2.6. Note in code that backfill sets only a minimal baseline (not GSC) — it's a net, not a substitute for 2.6.

- [ ] Failing test: a published post with no tracked action gets one after `runBackfill`.
- [ ] Implement; typecheck; commit.

### Task 2.8 — Digest counts applied work (Model: Sonnet)

**Files:** `server/monthly-digest.ts:77-85`, and/or `server/outcome-tracking.ts:147-166`.

**Approach:** Either (a) count applied approval items + completed work-orders into `issuesAddressed`, or (b) transition the matching insight to `'resolved'` on apply (via `validateTransition`). Prefer (b) if a legal `in_progress → resolved` transition exists in `state-machines.ts`; else (a). Read both before choosing.

- [ ] Failing test: a month with one applied approval reports `issuesAddressed ≥ 1` and not "0 measurable improvements".
- [ ] Implement; typecheck; commit.

### Phase 2 Systemic Improvements
- **pr-check rule (warn):** "publish/apply route that sets `published_at`/live state must `recordAction` (or `// recordAction-ok`)." Extend the existing "Unguarded recordAction() call" rule family.
- **Tests:** outcome-value round-trip, milestone-fires, publish-records-action (×2), backfill-idempotent, digest-non-zero.
- **Docs:** update `docs/rules/outcome-engine-stubs.md` (roi_attributions retired; value column added) and `FEATURE_AUDIT.md`.

### Phase 2 Verification
- [ ] Full gate (`typecheck && vite build && vitest run && pr-check`).
- [ ] Manual: on a seeded workspace with GSC-like fixtures, publish content → confirm a tracked action + a later outcome row carries `attributed_value` → confirm the client ROI/digest surfaces it.

---

## Phase 3 — Reconcile Priority Structure (capability i)

**Owning context:** Intelligence (`server/intelligence/`) + Recommendations engine. **Sequence after Phase 1** (shared file `recommendations.ts`). **Work class:** structural.

### Task 3.1 — `effectiveBusinessPriorities` resolved field (Model: Opus — authority-layer logic) — SEQUENTIAL, do first

**Files (authority-layered-fields law, CLAUDE.md:254):**
- Create: resolver `buildEffectiveBusinessPriorities(workspaceId)` next to its slice source — model EXACTLY on `buildEffectiveBrandVoiceBlock` (`server/intelligence/seo-context-source.ts:121`, consumed at `seo-context-slice.ts:70`).
- Modify: the owning slice (likely `client-signals-slice.ts` or `seo-context-slice.ts`) to expose one resolved `effectiveBusinessPriorities`
- Modify: `shared/types/intelligence.ts` (add the field to the slice interface)
- Delete (corollary): any `format*BusinessPriorities` helper that predates this layer
- Test: resolver merges admin `workspaces.business_priorities` (048) + client `client_business_priorities` (021) with explicit precedence.

**Decision within task:** precedence = client-entered priorities first (they are the customer's stated goals), admin priorities as supplement — confirm with owner; document the rule inline.

- [ ] Failing test: resolver returns merged, de-duplicated priorities with documented precedence.
- [ ] Implement; typecheck; commit (shared contract for 3.2/3.3).

### Task 3.2 — Feed intent into ranking (Model: Opus)

**Files:** `server/recommendations.ts` (ranking at :1413-1418 and/or `impactScore`), via `buildRecommendationGenerationContext` (`server/intelligence/generation-context-builders.ts`) per CLAUDE.md:271 (don't hand-roll direct reads).

**Approach:** Add an intent-alignment weight: recs whose `affectedPages`/topic match an `effectiveBusinessPriorities` entry get a ranking boost. Keep the existing tier→impactScore order; apply intent as a tiebreaker or impactScore multiplier so the change is explainable.

- [ ] Failing test: with a stated priority matching rec B, rec B outranks an equal-impact rec A.
- [ ] Implement; typecheck; commit.

### Task 3.3 — `summary.topRecommendationId` pointer (Model: Sonnet)

**Files:** `server/recommendations.ts:1440-1449` (summary build), `shared/types/recommendations.ts:37-46` (summary type), client Overview (`OverviewTab.tsx` / the InsightsDigest) to render the one move.

**Approach (grounded):** No migration — `summary` is JSON. After the sort (recommendations.ts:1414-1419), set `topRecommendationId = activeRecs[0]?.id`. Add the optional field to the summary type. Render the same reconciled #1 on the client Overview so it can't disagree with the Health tab.

```ts
// recommendations.ts, in the summary object (~line 1440)
const summary = {
  /* ...existing fields... */
  topRecommendationId: activeRecs.length > 0 ? activeRecs[0].id : null,
};
```

- [ ] Failing test: generated summary carries `topRecommendationId` = id of the highest-ranked active rec.
- [ ] Implement; typecheck; commit.

### Phase 3 Systemic Improvements
- **pr-check rule:** "`businessPriorities`/`business_priorities` raw read outside the resolver" — model on the existing `formatBrandVoiceForPrompt` reintroduction rule (authority-layer corollary).
- **Tests:** resolver precedence, ranking tiebreak, summary pointer.

### Phase 3 Verification
- [ ] Full gate. Manual: set a client priority + admin priority, regenerate recs, confirm the ranked #1 reflects intent and the Overview + Health tab show the same top item.

---

## Phase 4 — Advisor Context Completeness (capability iii)

**Owning context:** Intelligence (`server/intelligence/`). **Independent of Phases 1-3** (may run parallel to Phase 3 if `recommendations.ts` is untouched here — it is). **Work class:** wiring + structural (new slices).

### Task 4.1 — Cache-invalidation cluster (Model: Sonnet) — ONE commit (cross-cutting law)

**Files (add `invalidateIntelligenceCache(workspaceId)`; grounded sibling client-actions-mutations.ts:42):**
- `server/approvals.ts` service fns (createBatch/updateItem/markBatchApplied/deleteBatch — :80/129/174/194)
- `server/routes/webflow-schema.ts` (page-publish, CMS-field, rollback, plan endpoints)
- `server/routes/outcomes.ts:280/362`, `server/routes/webflow-analysis.ts:259`
- seo_changes writers: `server/routes/webflow.ts:221`, `server/jobs.ts:588`, `webflow-seo-bulk-accept-fixes-job.ts:72`, `webflow-seo-suggestions.ts:110`, `webflow-seo-apply.ts:93`

**Approach:** CLAUDE.md cross-cutting law — guard ALL sites in one commit, never one at a time. The exhaustive list above was produced by diffing the 60+ existing `invalidateIntelligenceCache` callers against all workspace-scoped write sites.

- [ ] Failing test: after `markBatchApplied`, `buildWorkspaceIntelligence` reflects the new approval state within the same tick (no 5-min lag).
- [ ] Implement all sites; typecheck; pr-check; commit.

### Task 4.2 — Wire orphaned data into slices (Model: Sonnet) — SEQUENTIAL types first

**Files (Data-Flow rule #6 — copy the `assemble*` pattern from `operational-slice.ts`):**
- `shared/types/intelligence.ts` (add fields: page-state summary, weekly-trend, competitor trend, tier/entitlement) — commit first
- New/modified slices: page_edit_states summary (operational or siteHealth slice), `workspace_metrics_snapshots` trend, `competitor_snapshots`, and tier/usage in `operational-slice.ts:66-86` (via `computeEffectiveTier`/`computeTrialState`/`getUsageSummary`)
- `server/intelligence/formatters.ts` (a formatter line per new field)

- [ ] Failing tests per slice: `buildWorkspaceIntelligence({slices:[...]})` returns the new field for a workspace with that data.
- [ ] Implement; typecheck; commit.

### Task 4.3 — Route admin-chat through canonical formatters (Model: Sonnet)

**Files:** `server/intelligence/admin-chat-context-builder.ts:71-89`.

**Approach (grounded):** The builder assembles operational/siteHealth/clientSignals/insights/contentPipeline/localSeo (selectAdminChatSlices :40-57) but only `formatForPrompt`s `seoContext`+`learnings`. Format the selected slices through `formatForPrompt` with their sections (or `formatOperationalSection`/`formatClientSignalsSection`/`formatSiteHealthSection` in formatters.ts:662-781) so assembled data actually reaches the model. Watch the token budget (workspace-intelligence.md).

- [ ] Failing test: admin-chat context block for an `approvals` question includes operational fields (currently dropped).
- [ ] Implement; typecheck; commit.

### Phase 4 Systemic Improvements
- **pr-check rule (warn):** "workspace-scoped DB write in `server/routes/` must call `invalidateIntelligenceCache` (or `// intel-cache-ok`)." Model directly on rule #8 (broadcastToWorkspace, automated-rules.md:170). This mechanizes the entire A-9/11/12/13 class so it can't recur.
- **Tests:** invalidation freshness test; one slice-read test per new field; admin-chat completeness test.

### Phase 4 Verification
- [ ] Full gate. Manual: clear an approval queue, immediately ask the AdminChat advisor about pending approvals — confirm fresh counts (no 5-min lag) and that tier/usage is available to the advisor.

---

## Task Dependency Graph

```
Sequential (phases are PR-gated, in order):
  Phase 1 → Phase 2 → Phase 3 → Phase 4
  (Phase 4 MAY run parallel to Phase 3 — disjoint files — if scheduling allows.)

Within Phase 1:  1.1 ∥ 1.2 ∥ 1.3 (own different write sites) → 1.4 (frontend, after events confirmed)
Within Phase 2:  2.1 (shared contract) → 2.2 ∥ 2.3 ∥ 2.5 ∥ 2.6 ∥ 2.7 ∥ 2.8 ; 2.4 last (after 2.3 proves no readers)
Within Phase 3:  3.1 (shared contract) → 3.2 ∥ 3.3
Within Phase 4:  4.2-types (shared contract) → 4.1 ∥ 4.2-slices ∥ 4.3
```

**File-ownership caution:** Phase 1 (1.1) and Phase 3 (3.2, 3.3) both edit `server/recommendations.ts` — never run them in parallel; the phase gate enforces this.

## Model Assignments (Claude/Anthropic ladder)

| Task type | Model | Tasks |
|---|---|---|
| Mechanical wiring, cron registration, deprecation marking, frontend invalidation | Haiku | 1.4, 2.4, 2.7 |
| Service/CRUD layers, migrations, slice additions, formatter routing | Sonnet | 1.2, 1.3, 2.1, 2.2, 2.3, 2.6, 2.8, 3.3, 4.1, 4.2, 4.3 |
| Ranking-critical engine, authority-layer resolution, field-semantics bug | Opus | 1.1, 2.5, 3.1, 3.2 |
| Code/spec reviewers (every phase) | Opus | — |

## Systemic Improvements (cross-plan)
- **Shared utilities:** `resolveRecommendationsForChange` (Phase 1), `buildEffectiveBusinessPriorities` (Phase 3) — both reused across ≥3 call sites.
- **New pr-check rules (4):** rec-refresh-on-write, recordAction-on-publish, businessPriorities-raw-read, invalidateIntelligenceCache-on-write. Author via `docs/rules/pr-check-rule-authoring.md`; run `npm run rules:generate`.
- **Tests:** ~15 new (integration + slice + contract), listed per phase.
- **Feature-class gates:** apply `docs/workflows/feature-class-definition-of-done.md` per phase.

## Verification Strategy (every phase)
- [ ] `npm run typecheck` (project-aware `tsc -b`)
- [ ] `npx vite build`
- [ ] `npx vitest run` (full suite)
- [ ] `npx tsx scripts/pr-check.ts`
- [ ] `npm run verify:feature-flags` && `npm run verify:coverage-ratchet`
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated; `docs/rules/outcome-engine-stubs.md` updated (Phase 2)
- [ ] Multi-agent batch → `superpowers:scaled-code-review`; single-task → `superpowers:requesting-code-review`
- [ ] Merge to `staging`, verify on staging deploy, then `staging` → `main`

## Self-Review (done)
- **Spec coverage:** all 39 confirmed findings map to a task (see Verified Scope table); the 4 "unclear" audit items are resolved by the live-flag confirmation (outcomes are live → folded into Phase 2/4).
- **Type consistency:** `attributedValue`/`attributed_value`, `topRecommendationId`, `effectiveBusinessPriorities`, `resolveRecommendationsForChange` used consistently across tasks.
- **No invented signatures:** every cited function (`updateRecommendationStatus`, `queueKeywordStrategyPostUpdateFollowOns`, `recordAction`/`getActionBySource`, `runBackfill`, `buildEffectiveBrandVoiceBlock`, `invalidateIntelligenceCache`, `loadRecommendations`/`saveRecommendations`) was verified on this tree during the pre-plan audit.
