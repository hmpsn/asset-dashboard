# Feature-Flag Sunset — Implementation Plan (near-term waves)

> **For agentic workers:** Use subagent-driven or executing-plans, task-by-task. **Platform: Claude/Anthropic** (Haiku mechanical / Sonnet judgment / Opus review). Read `CLAUDE.md` + `docs/PLAN_WRITING_GUIDE.md` first. Audit this plan derives from: `docs/superpowers/audits/2026-07-02-flag-sunset-audit.md` (per-flag read-sites + strip scopes live there — do not duplicate; cite them).

**Goal:** Collapse "two paths behind a flag" into one clean unconditional path for every flag that's safe to retire *now*, so the P2 rebuild lands on cleaner ground.

**Architecture / the key decision:** The ~20 retireable flags split into two risk classes relative to the coming P2 UI rebuild:
- **Server/admin flags + phantoms** — their OFF branches are backend/admin code the rebuild will NOT replace. Retiring now = permanent cleanup. **This plan does these.**
- **Client-shell flags** (the-issue-client-*, client-ia-v2, strategy-the-issue client gate, strategy-command-center, competitor-send client gate, client-work-feed) — their OFF branches live in the *current client UI that P2 will tear down and rebuild*. Stripping them now is largely wasted work AND churns the exact files the rebuild rewrites (merge pain). **DEFER these to the rebuild** — making the new IA the default orphans the old branches, which get deleted as part of P2. (This is the "the rebuild is where UI-shell flags go to die" principle.)

So: **retire the server/admin + phantom flags now (this plan); fold the client-shell flags into P2.**

**Tech Stack:** TypeScript, better-sqlite3 migrations, Vitest, `scripts/pr-check.ts` (`RETIRED_FLAG_GROUPS`).

**Prod state overlay (critical):** every flag in Waves 1–2 below is **globally ON in prod already**, so unconditional-izing it is a **no-op for behavior** — pure code cleanup. (Verified via `GET /api/admin/feature-flags`.)

---

## The retirement template (each flag follows C3's proven pattern — PR #1463)
For each flag retired: (1) delete its read-sites' OFF branch / make ON unconditional; (2) remove it from `FEATURE_FLAGS`, `FEATURE_FLAG_CATALOG`, `FEATURE_FLAG_GROUPS` in `shared/types/feature-flags.ts`; (3) add it to `RETIRED_FLAG_GROUPS` in `scripts/pr-check.ts` (blocks re-introduction); (4) one migration `DELETE FROM feature_flag_overrides / feature_flag_workspace_overrides WHERE key = '<flag>'` (idempotent); (5) update the flag's tests (delete/rewrite the OFF-state assertions); (6) `npm run verify:feature-flags` clean. Next free migration number: **173**.

---

## Wave 1 — Delete phantoms (zero runtime readers, zero behavior change)  *(Model: Haiku; one PR)*
Flags: `strategy-paid-topics`, `the-issue-client-reconciliation`, `the-issue-client-segment-inserts`. All `status:'reserved'`, zero readers. Owner ruling: **delete now, re-add the key if/when the reserved feature is built.**

**Files:** `shared/types/feature-flags.ts`; `scripts/pr-check.ts` (`RETIRED_FLAG_GROUPS`); `server/db/migrations/173-retire-phantom-flags-overrides.sql` (new); `tests/unit/the-issue-client-flags.test.ts` + `tests/unit/feature-flags*.test.ts` (rewrite the reserved-status assertions); optional tidy of the stale comment at `server/routes/the-issue-admin.ts:8`.

- [ ] **Step 1:** remove the 3 keys from `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` + their `FEATURE_FLAG_GROUPS` slots.
- [ ] **Step 2:** add the 3 keys to `RETIRED_FLAG_GROUPS` in `scripts/pr-check.ts`.
- [ ] **Step 3:** migration 173 deleting override rows for the 3 keys (single-exec; no `ADD/RENAME COLUMN` text anywhere in the file).
- [ ] **Step 4:** rewrite the negative-space assertions in `the-issue-client-flags.test.ts` (they currently assert these flags exist-and-are-reserved — assert they're *absent* now, and that the P1b surfaces they guarded remain correctly ungated).
- [ ] **Step 5:** gates — `npm run typecheck`, `npx vitest run tests/unit/the-issue-client-flags.test.ts tests/unit/feature-flags*.test.ts`, `npx tsx scripts/pr-check.ts`, `npm run verify:feature-flags`. Commit. PR → staging.

## Wave 2 — Unconditional-ize server/admin flags (ON in prod = no-op)  *(Model: Sonnet; group into 2 PRs)*
Each flag: remove the `isFeatureEnabled(...)` gate so the ON path is the sole path, delete the now-dead OFF-branch code, then apply the retirement template. Per-flag read-sites + strip scopes are in the audit (§B). **Verify each flag's per-flag caveat before stripping.**

**PR 2a — server crons/pipeline:**
- [ ] `strategy-staleness-scan` — remove the guard at `server/recommendation-staleness.ts:151`; cron always runs. Update its 2 tests.
- [ ] `strategy-signal-fold` — remove the guard at `server/domains/recommendations/finalization.ts:329`. **Caveat: confirm the standalone `IntelligenceSignals` card is already deleted** (its removalCondition) — if a live `IntelligenceSignals` component still renders, delete it in this PR to avoid a duplicate surface. Update its 3 tests.
- [ ] `signal-auto-recompute` — remove the 2 guards (`server/insight-recompute-cron.ts:30`, `server/intelligence-recompute-job.ts:26`); recompute always runs. Update `intelligence-recompute-job.test.ts:58`.
- [ ] `strategy-divergence-sweep` — **DECISION FIRST:** this is a read-only rec↔mirror drift *diagnostic*, and C4 found live mirror/respond gaps (Theme C). **Recommendation: hold it one more staging soak** (keep the diagnostic) rather than unconditional-ize now; re-audit after the C4 mirror fixes have soaked. If retiring: remove guard at `server/deliverable-divergence-sweep.ts:196`.

**PR 2b — admin/data-shaping flags:**
- [ ] `smart-placeholders` — remove the gate in `src/hooks/useSmartPlaceholder.ts`; also delete the unreachable `isAdminContext:false` client branch (dead code). Update `smart-placeholder.test.ts`.
- [ ] `keyword-universe-full` — remove the 3 `KEYWORD_UNIVERSE_FULL_FLAG` conditionals (`candidate-boundary.ts`, `read-model.ts`, `summary-service.ts`); keep the `UNIVERSE_SAFETY_CEILING` path as sole; delete the OFF-branch caps if unreferenced. Update `feature-flags-keyword-hub.test.ts` framing.
- [ ] `ai-visibility` — remove the 2 server gates (`seo-context-slice.ts`, `routes/rank-tracking.ts`) + the client `useFeatureFlag`/`<FeatureFlag>` wrapper in `AiVisibilityPanel.tsx` (render unconditionally). Rewrite the "flag off → 404" cases in `ai-visibility-routes.test.ts`. **Admin-only** — no client surface.
- [ ] `geo-targeting` — remove the gate at `server/seo-target-geo.ts:31` + the `<FeatureFlag>` wrapper in `BusinessFootprintTab.tsx`. Update 2 tests. (`national-serp-tracking` stays a KEEP toggle — do NOT bundle it.)

Each PR: full gates (`typecheck`, `vitest run`, `pr-check`, `verify:feature-flags`, `lint:hooks`) + the retirement-template migration (one migration per PR deleting that PR's flags' override rows). Merge to `staging`.

## In-flight cleanups (fold into the wave that touches the file, or a tiny standalone PR)
- `src/components/client/InsightsEngine.tsx:228` — add `competitorSendEnabled` to the `grouped` useMemo deps (stale-filter bug). *(Standalone-PR candidate — do soon; InsightsEngine is a client-shell file otherwise deferred.)*
- `server/strategy-issue-cron.ts:321` — `isFeatureEnabled('strategy-the-issue')` missing `workspaceId`; make it per-workspace like every sibling. *(Fold into the strategy-the-issue retirement in P2, OR fix standalone now since it's a latent scoping bug.)*
- `gbp-review-responses` inbox card — add a real flag-transition test + de-dupe the two `responseFeatureEnabled()` copies. *(KEEP flag; do as hygiene whenever GBP is next touched.)*

---

## DEFERRED to the P2 rebuild (do NOT strip now)
Client-shell flags whose OFF branches are in the UI P2 replaces: `client-ia-v2`, `the-issue-client-spine`, `the-issue-client-measured-capture`, `the-issue-client-return-hook`, `the-issue-client-next-bets`, `strategy-the-issue` (client gate), `strategy-command-center`, `strategy-keywords-managed-set`, `strategy-competitor-send`, `client-work-feed`. All are ON in prod (no client change pending), so nothing breaks by leaving them — the rebuild makes the new IA default and deletes the old branches + these flags together.

## DECISIONS (hold out of the waves)
- `client-briefing-v2` + `client-briefing-v2-ai-polish` — **hold as-is (off), decide during P2.** The client magazine UI is gone; the flag now gates only the weekly briefing **email** pipeline + the intelligence-slice briefing feed. Open question: keep the briefing email or is it superseded by the-issue-client-return-hook's email? Resolve when the rebuild settles the client email strategy. (Retiring the whole pipeline would also drop the `ClientSignalsSlice.latestBriefing` feed — don't do it blind.)

## KEEP (permanent / blocked — never in the sunset)
`strategy-trust-ladder-autosend` (safety, permanently exempt — owner-confirmed stays), `gbp-auth-connection` + `gbp-auth-reviews` + `gbp-review-responses` (hard chain, blocked on Google API access), `national-serp-tracking` + `local-gbp` (paid DataForSEO cost-control toggles — owner keeps).

## Verification strategy
- Per PR: the universal gates + the flag's targeted tests. `verify:feature-flags` must be clean (no orphaned/ungrouped keys).
- Because every Wave 1–2 flag is ON in prod, assert **no behavior change**: the OFF branch being deleted is unreachable in prod today. Where a client surface is even indirectly touched (none in Wave 2 except `ai-visibility`'s admin panel), a quick real-render smoke.
- Staging → main promotion for these waves is owner-gated (same as all releases).
