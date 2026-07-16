# Trust-Landmine Hotfix Sweep — Implementation Plan

> **For agentic workers:** This plan is written for a **single GPT-5.6 Sol implementation agent on Codex, reasoning effort HIGH for every task and for review** (never downgrade the reviewer). Execute task-by-task with the checkbox steps. Per `docs/PLAN_WRITING_GUIDE.md`, this plan locks **contracts + test assertions + constraints**, not implementation bodies: you READ the real code first, write the failing test, observe red, implement minimally, observe green, then commit. If real code contradicts a contract stated here, **STOP and report NEEDS_CONTEXT** — do not improvise around it.

**Goal:** Fix the 12 validated "truth-in-labels" defects from the 2026-07-16 admin-UI audit — numbers that lie (fabricated zeros, false window labels, mismatched denominators), sends that fail silently, and controls whose labels don't match their behavior.

**Architecture:** Three independent hotfix PRs to `staging`, one per defect family. All fixes are surface-local; one touches a server read-projection + shared type (Task A3) and one adds a server-side empty-result guard (Task A1). No new features, no flags, no migrations, no IA changes.

**Tech stack:** React 19 + TS strict, React Query, vitest component/unit tests, `useToast` from `src/components/Toast.tsx`, `ConfirmDialog`/`InlineBanner`/DS primitives from `src/components/ui/`.

**Spec / pre-plan audit:** `docs/superpowers/audits/2026-07-16-admin-ui-rebuild-vs-legacy-persona-audit.md` (§3 B1/B2, §6 items 1–3) + companion `.verdicts.json`. The exhaustive-findings requirement of `pre-plan-audit` is satisfied by that audit: 20 surface agents + 44 adversarially-validated claims with file:line evidence verified against `origin/staging @ 5a2641b21`. Every Evidence block below was independently re-verified by a refuter agent on that exact tree.

---

## Branch / PR model

| PR | Branch (fresh off `origin/staging`) | Tasks | Theme |
|----|--------------------------------------|-------|-------|
| PR-1 | `fix/trust-numbers` | A1–A5 | Numbers tell the truth |
| PR-2 | `fix/silent-send-failures` | B1–B3 | Failures surface where you stand |
| PR-3 | `fix/truth-in-labels` | C1–C4 | Labels mean what they say |

Sequential: PR-1 → PR-2 → PR-3 (open PR-N+1 only after PR-N is green; they touch disjoint files, but the repo's phase-per-PR discipline applies). Within a PR, tasks are sequential. **No parallel dispatch anywhere** — single agent. Each PR merges to `staging` only.

**Environment caution:** the primary checkout at `~/CascadeProjects/asset-dashboard` is shared by concurrent sessions and can be re-pointed under you. Work in a dedicated worktree (`git worktree add <dir> -b fix/trust-numbers origin/staging`), stage files explicitly, and re-check `git branch --show-current` before every commit.

## Bounded-context ownership

| Task | Owning context | Server touched | Shared types | React Query keys touched | WS events |
|------|----------------|----------------|--------------|--------------------------|-----------|
| A1 | Site Health / Performance | `server/routes/webflow-pagespeed.ts` (guard only) | none | existing pagespeed keys (no key changes) | none |
| A2 | Outcomes | none | none | none | none |
| A3 | Keyword Hub | `server/domains/keyword-command-center/read-projection.ts` | KCC summary type (one field `number` → `number \| null`) | none (payload shape only) | none |
| A4, C3, C4 | Site Health / Audit | none | none | none | none |
| A5 | Global Ops / Roadmap | none | none | none | none |
| B1 | SEO Editor | none | none | none | none |
| B2 | Schema | none | none | none | none |
| B3 | Links | none | none | none | none |
| C1 | Cockpit | none | none | none | none |
| C2 | Strategy / Engine | none | none | none | none |

All work is **behavior-correcting** (bug-fix class), not new behavior. No `broadcastToWorkspace` obligations arise (no new mutations); no activity-log obligations (no new significant operations). `FEATURE_AUDIT.md` / `roadmap.json` updates are NOT required (bug fixes, not features); `BRAND_DESIGN_LANGUAGE.md` untouched unless a label string it documents changes (it doesn't).

## Global constraints & gotchas (read before ANY task)

1. **Imports at top of file, grouped with existing imports.** Never mid-file. Check `grep -n '^import' <file>` first.
2. **Touched surface files carry `@ds-rebuilt`** — strict gates apply: tokens-only styling, `var(--dur-*)` motion, `<Icon name>` (no raw `fa-` classes, no emoji-as-icon, no new hues). New UI bits must use DS primitives (`InlineBanner`, `ConfirmDialog`, `Badge`) — never hand-roll.
3. **Mutation feedback = the existing `useToast`** (`src/components/Toast.tsx`). Do not build a second toast. Success toasts only after truthful completion (the `awaitSuccessfulRefetches` pattern where already used).
4. **Send vocabulary is enforced** (`docs/workflows/ui-vocabulary.md` + pr-check `send-for-review-anti-pattern`): the canonical send button is **"Send to client"**, loading **"Sending..."**, past-tense badge **"Sent"**. A control may say Send ONLY if it sends.
5. **Overlays**: use `ConfirmDialog` from `src/components/ui/` as-is; focus/scroll handling comes from `ui/overlay/overlayUtils.ts` — never hand-roll. Note: non-destructive ConfirmDialogs are Enter-to-confirm; destructive ones are Cancel-owns-Enter (fixed in `69a686583`, already on staging).
6. **Tests:** add to the existing per-surface test file (paths given per task). Component tests use the existing render helpers/mocks in each file — read the file's setup before writing. Never assert `.every()`/`.some()` on possibly-empty arrays without `length > 0` first.
7. **Never run two full `npx vitest run` concurrently** (port-collision flakes). If you hit `EADDRINUSE`, kill orphaned `tsx server/index.ts` processes and re-run.
8. **CT snapshot trap (Task A3):** `tests/ct/keywords-surface.story.tsx` may cover the Keywords KPI band. CT baselines are environment-sensitive (jammy vs ubuntu 1-px trap). If a CT diff triggers, do NOT regenerate baselines locally in Docker-jammy; flag it in the PR and let CI's environment decide — a purely-cosmetic CT failure here is a known non-blocking flake class, but say so explicitly in the PR body.
9. **pr-check hatches are inline-only** (same line), and only for pattern-based rules. You should not need any hatch in this sweep; if you think you do, STOP and report.
10. **Skinny-read contract (Task A3):** the Keyword Hub read path has a deliberate skinny/full model split (`docs/rules/keyword-hub.md`). Read that doc before touching the projection; the summary/KPI numbers must remain available on the skinny path.

---

# PR-1 — `fix/trust-numbers`

### Task A1 — Empty bulk PageSpeed run must be an error, not a fabricated red zero

**Files:**
- Modify: `server/routes/webflow-pagespeed.ts` (bulk route; persist/200 path at ~:39-42)
- Modify: `src/hooks/admin/useAdminPerformance.ts` (bulk mapper ~:121-123, `onSuccess` snapshot cache ~:192-198)
- Modify: `src/components/performance-rebuilt/PageSpeedLens.tsx` (success toast ~:445, bulk render ~:692-703, persisted-snapshot fallback ~:421)
- Test: `tests/component/performance-rebuilt/PerformanceSurface.test.tsx` + the route's existing integration/unit coverage (locate via `grep -rl "webflow-pagespeed\|runSiteSpeed" tests/`)

**Evidence (verified):** `server/pagespeed.ts:52-58` returns null per page on any non-OK PSI response (incl. 429); `runSiteSpeed` returns `{pages: [], averageScore: 0, averageVitals: all-null}` when every call fails (`:381-401`). The route persists that empty result (`savePageSpeed`, `performance-store.ts:186`, no guard) and 200s. Client: `useAdminPerformance.ts:192-198` caches the empty result as the strategy snapshot; `PageSpeedLens.tsx:445` fires an unconditional "bulk test complete" success toast; `:692-703` renders `ScoreSummary` for any truthy result — `MetricRing(0)` renders red per `MetricRing.tsx:17-22`, six "Unavailable" vitals. Legacy guard being restored: `PageSpeedPanel.tsx:185` — `pages?.length === 0` → error *"No pages could be tested. The Google PageSpeed API may be rate-limited. Add a GOOGLE_PSI_KEY env variable for higher limits."*; legacy `:432-443` renders a persisted-empty snapshot as `EmptyState` with Try Again.

**Contract (all four must hold):**
1. Server: a bulk run yielding `pages.length === 0` is **not persisted** and returns an error envelope `{ error: string }` (non-2xx) — the FM-2 pattern: an all-failed external run records failure, never success. Single-page route untouched.
2. Client: no success toast on an empty/failed bulk run; the error path shows the legacy rate-limit guidance (reuse the existing PSI-key hint helper `performanceFormatters.ts:121-123` — it is currently error-only; keep it that way).
3. An empty result is never written into the strategy snapshot cache.
4. Render: any **historical persisted** empty snapshot (rows saved before this fix) renders as an empty/error state with retry — never a `ScoreSummary` ring of 0.

**Test assertions (write first, observe red):**
- Route test: mock PSI to fail all pages (FM-2) → bulk endpoint responds with `{ error }` (assert non-2xx), and the store's saved result for the site is unchanged (assert prior snapshot survives).
- Component: render PageSpeedLens with a bulk result of `pages: []` (persisted-snapshot path) → no `ScoreSummary`/MetricRing; empty-state text matches the rate-limit guidance; a retry affordance exists.
- Component: drive the bulk mutation to the error path → toast is error-toned, message includes "rate-limited"; no "complete" success toast fired.

**Steps:**
- [ ] Read all four cited files end-to-end; confirm line anchors still match; locate the store's save call and the exact toast call sites.
- [ ] Write the three failing tests; run each (`npx vitest run tests/component/performance-rebuilt/PerformanceSurface.test.tsx` + the route test file) — confirm each fails for the right reason.
- [ ] Implement server guard → client cache guard → render/ toast guard, minimally.
- [ ] Green on the task's test files, then `npm run typecheck`.
- [ ] Commit: `fix(performance): empty bulk PageSpeed run reports failure, never a fabricated zero`

### Task A2 — Outcomes Book: remove the false "Rolling 90 days" window label

**Files:**
- Modify: `src/components/global-ops-rebuilt/OutcomesBookLens.tsx:43`, `src/components/global-ops-rebuilt/wave-c/outcomes/OutcomesBookTable.tsx:77` (+ column header labels in the same table)
- Test: `tests/component/global-ops-rebuilt/GlobalOpsOutcomesLens.test.tsx`

**Evidence (verified):** both "Rolling 90 days" strings exist at the cited lines. Actual windows: Value delivered/mo + Wins = **all-time** (last-100 wins, `outcome-tracking.ts:98-114`, no date predicate); Clicks = **28-day** GSC (`server/routes/workspaces.ts:133`); "Win rate" = **all-time** ratio display-gated on `scoredLast30d > 0` (`server/routes/outcomes.ts:216,249`); Trend = all-time split-half.

**Contract:** no surface copy claims a 90-day (or any untrue) window. Each aggregate visible in the collapsed table states its true window inline in its column header: Value delivered/mo `(all-time)`, Clicks `(28d)`, Wins `(all-time)`; the expansion's win-rate label says `(all-time)` (its existing "Scored in 30 days" row is separately accurate — keep). The two banner lines either state the mixed windows honestly (e.g. "All-time value · 28-day clicks") or are removed. This is the honest-label hotfix; real windowed data is the deferred GO-004 rollup — do NOT build it here.

**Test assertions:** render the lens with fixture rollups → `queryByText(/rolling 90/i)` is null; column headers contain `all-time` and `28d` markers; win-rate label contains `all-time`.

**Steps:**
- [ ] Read both files + the existing test's fixtures.
- [ ] Write failing assertions; run red (existing "Rolling 90 days" copy makes them fail).
- [ ] Implement label changes only (no data-path changes); green; typecheck.
- [ ] Commit: `fix(outcomes): truthful window labels on the Outcomes Book (was false "Rolling 90 days")`

### Task A3 — Keyword Hub "$0 Monthly value" → honest "— Unavailable" when provider evidence is absent

**Files:**
- Modify: `server/domains/keyword-command-center/read-projection.ts` (~:28-35 `trafficValueFromPages`)
- Modify: the KCC summary shared type that carries the monthly-value field (locate the exact interface via the projection's return type — it lives with the KCC types; field becomes `number | null` with a JSDoc stating null = no provider evidence)
- Modify: `src/components/keywords-rebuilt/KeywordsSurface.tsx` (KPI band render)
- Test: `tests/unit/keyword-command-center-v2-read-model.test.ts`, `tests/component/keywords-rebuilt/KeywordsSurface.test.tsx`

**Evidence (verified):** `trafficValueFromPages` (`read-projection.ts:28-35`) returns numeric `0` when no keyword has provider volume/value data, so the KPI band prints a hard "$0 Monthly value" for an unconfigured workspace while the Cockpit's organic-value tile honestly renders "— Unavailable" for the same absence. Cross-surface unknown-vs-zero inconsistency; seat-5 (numbers auditor) blocker family.

**Contract:**
1. The projection returns `null` (not `0`) when **zero contributing keywords carry provider value evidence**; returns a number (including a legitimate computed `0`... which in practice only occurs with evidence present) otherwise. Read the real accumulator to define "evidence present" precisely from what it already sums — do not invent a new provider-config lookup if the data already discriminates; if it cannot discriminate, STOP and report NEEDS_CONTEXT with what you found.
2. The shared type field is `number | null` with JSDoc: `/** null = no provider value evidence for this workspace — render as unavailable, never as $0 */`.
3. KPI band renders `—` with an "Unavailable" caption on null (match the Cockpit organic-value tile's convention — read `CockpitDecisionBand.tsx` first and reuse its wording); renders `$N` on number.
4. Both skinny and full read variants (docs/rules/keyword-hub.md) serialize the field identically — verify by reading both paths.

**Test assertions:**
- Unit (projection): pages/keywords fixture with no volume/value evidence → `monthlyValue === null`; fixture with evidence → the computed number. (Extend the existing read-model test file's fixtures.)
- Component: summary with `null` → KPI band shows `—` and no `$0` anywhere; with `1234` → `$1,234`-style render (match existing formatter).

**Steps:**
- [ ] Read `docs/rules/keyword-hub.md`, the projection, the type, both read variants, `KeywordsSurface.tsx` KPI band, and the Cockpit tile convention.
- [ ] Write failing unit + component tests; run red.
- [ ] Implement projection → type → render; green; `npm run typecheck` (the `number|null` widening will surface every consumer — fix each honestly, no `?? 0`).
- [ ] Run `npx vitest run tests/component/keywords-rebuilt tests/unit/keyword-command-center-v2-read-model.test.ts`; note gotcha #8 (CT story) in the PR body if CI's CT lane diffs.
- [ ] Commit: `fix(keywords): monthly value serializes null when unmeasured — render "—", never $0`

### Task A4 — Site Audit: one screen, one warning count

**Files:**
- Modify: `src/components/site-audit-rebuilt/SiteAuditSurface.tsx:346` (narrative copy; chips stay)
- Test: `tests/component/site-audit-rebuilt/SiteAuditSurface.test.tsx`

**Evidence (verified):** chip row shows warnings-only (e.g. "2215 warnings") while the hero copy at `:346` prints warnings + infos as one number ("4187 more warnings and notices") — two irreconcilable totals one paragraph apart (browser-walk + seat-5 confirmed).

**Contract:** the narrative states the same taxonomy the chips use, split explicitly: "N warnings and M notices" where N equals the chip count exactly (same source variable, not a re-computation — the repo's rate-display rule: displayed counts share a source).

**Test assertions:** render with fixture audit (w warnings, i infos) → narrative contains `${w} warnings` and `${i} notices`; the string `${w+i}` does not appear as a combined "warnings" figure.

**Steps:** read → failing test → red → copy fix → green → typecheck → commit `fix(site-audit): hero copy uses the chip taxonomy — warnings and notices split, one source`.

### Task A5 — Roadmap Completion % denominator = the adjacent Total tile

**Files:**
- Modify: `src/components/global-ops-rebuilt/RoadmapLens.tsx:103`
- Test: `tests/component/global-ops-rebuilt/GlobalOpsWaveA.test.tsx`

**Evidence (verified first-hand):** rebuilt computes `done / executableTotal` (excludes deferred/closed) at `RoadmapLens.tsx:103` while the adjacent Total tile shows the full count — 87% vs legacy's 59% on identical data (`Roadmap.tsx:142` = `done / total`). Direct violation of the repo's numerator/denominator-share-a-source rule.

**Contract:** Completion = `done / total` where `total` is the exact value the Total tile renders (legacy parity). If you believe executable-basis is the better metric, do NOT decide that here — implement legacy parity and note the alternative in the PR body for the owner.

**Test assertions:** fixture with done=148, total=250 (incl. deferred/closed) → Completion tile renders `59%`; Total tile renders `250`.

**Steps:** read → failing test → red → one-line denominator fix → green → typecheck → commit `fix(roadmap): completion % uses the Total tile's denominator (legacy parity)`.

**PR-1 close-out:** run the full gate block (see Verification Strategy), flag-ON browser smoke of Performance, Outcomes Book, Keywords, Site Audit, Roadmap, then open PR to `staging` with per-task summaries + the A5 owner note + the A3 CT note.

---

# PR-2 — `fix/silent-send-failures`

### Task B1 — SEO Editor: CMS "Send to client" surfaces success/failure at the toolbar

**Files:**
- Modify: `src/components/seo-editor-rebuilt/SeoEditorWorksheet.tsx` (~:497-500 toolbar send site)
- Read-only: `src/hooks/admin/useCmsEditorApprovalWorkflow.ts` (:49-51 auto-clear, :62-91 error set, :81 selection-clear-on-success) — extend only if the hook exposes no success signal
- Test: `tests/component/seo-editor-rebuilt/SeoEditorSurface.test.tsx`

**Evidence (verified):** `useCmsEditorApprovalWorkflow.ts:62-91` sets `approvalError` for validation ("No changes detected on selected items…") and network failures with a 5s auto-clear; the ONLY render site is inside the CMS Drawer (`SeoEditorPagePanel.tsx:525-529`) which isn't open when sending from the toolbar (`SeoEditorWorksheet.tsx:497-500` passes only `loading`). A client-facing send can fail with zero feedback. Legacy rendered the error directly under the send button (`CmsEditorShellPanels.tsx:134-140`).

**Contract:** sending from the toolbar yields, at the toolbar: an error toast (canonical error extraction, message = the hook's `approvalError` text) on failure — including the trivially-reachable validation case (rows selected, no edits) — and a success toast ("Sent" semantics per ui-vocabulary) on success. The Drawer's existing inline error stays. No second state machine: consume the hook's existing state/promise; if the hook cannot signal completion to the caller, extend the hook minimally (return the promise / expose a callback), don't duplicate its logic.

**Test assertions:**
- Select CMS rows without edits → click toolbar "Send to client" → an error toast fires containing "No changes detected".
- Mock the approval mutation to reject → error toast with extracted message.
- Mock success → success toast fires; selection clears (existing `:81` behavior preserved — assert it still happens).

**Steps:** read both files + the test file's mock setup → three failing tests → red → implement → green → typecheck → commit `fix(seo-editor): CMS send surfaces success/failure at the toolbar (was silent)`.

### Task B2 — Schema: "Add a page" failure renders instead of dead-clicking

**Files:**
- Modify: `src/components/schema-rebuilt/GeneratorLens.tsx` (~:390-392 button site)
- Read-only: `src/components/schema/useSchemaSuggesterGeneration.ts` (:166-181 — `fetchPagesError` already exposed; the hook contract expects the consumer to render it)
- Test: `tests/component/schema-rebuilt/SchemaSurface.test.tsx`

**Evidence (verified):** the hook catches the `/api/webflow/all-pages` failure into `fetchPagesError` and never opens the picker; rebuilt `GeneratorLens.tsx` has **zero** `fetchPagesError` reads — the button spinner just stops. Legacy rendered an `InlineBanner` next to the button (`SchemaSuggester.tsx:510-517`). The rebuilt lens already renders every sibling error (scanError :277-282, singlePageError :503-510, sendToClientError :491-499) — this is a specific omission.

**Contract:** on `fetchPagesError`, an `InlineBanner` (error severity, DS primitive) renders adjacent to the Add-page button with the hook's message and the action remains retryable. Follow the lens's own sibling-error patterns for tone/placement.

**Test assertions:** mock the pages fetch to reject → click Add a page → banner with the error text appears; picker drawer does not open; clicking again retries (fetch called twice).

**Steps:** read → failing test → red → implement → green → typecheck → commit `fix(schema): surface add-page fetch failure (was silent dead-click)`.

### Task B3 — Links: successful client-send latches to "Sent" for that snapshot

**Files:**
- Modify: `src/components/links-rebuilt/InternalLinksLens.tsx` (~:546-569 send GroupBlock), `src/components/links-rebuilt/RedirectsLens.tsx` (~:300-330 send GroupBlock)
- Test: `tests/component/links-rebuilt/LinksSurface.test.tsx`

**Evidence:** audit extensions lane (links agent): after a successful send there is no sent-state — the button stays fully active for the same analyzed snapshot, inviting duplicate client actions. (Thinnest-evidenced task in the sweep: READ the two send handlers first; if a latch already exists in some form, report what you found and adjust scope to whatever gap remains.)

**Contract:** after a successful send, the send control for the *same snapshot identity* (`analyzedAt`/`scannedAt`/sourceId — use whatever identity the send payload already carries) renders the canonical past-tense **"Sent"** badge state and is disabled until the snapshot changes. Session-local state is sufficient (no persistence, no server change) — this is a duplicate-click guard, not a delivery ledger; say exactly that in a code-adjacent comment only if the constraint is non-obvious from the code.

**Test assertions:** mock send success → button becomes disabled with "Sent"; simulate a new snapshot (different analyzedAt in props/fixture) → button re-enables. Mock send failure → button stays enabled (no false latch).

**Steps:** read both handlers → failing tests → red → implement (shared tiny hook/util ONLY if both lenses end up needing identical logic — two call sites = extract per UI/UX rule 9) → green → typecheck → commit `fix(links): latch client-send to Sent per snapshot (duplicate-send guard)`.

**PR-2 close-out:** full gates + flag-ON smoke of SEO Editor (toolbar send validation case), Schema (add-page with dev-tools offline to force failure), Links.

---

# PR-3 — `fix/truth-in-labels`

### Task C1 — Cockpit: queue actions say what they do

**Files:**
- Modify: `src/components/cockpit-rebuilt/CockpitWorkQueue.tsx` (+ `src/components/ui/co/WorkQueueRow.tsx` only if the label lives there — read first)
- Test: `tests/component/cockpit-rebuilt/CockpitSurface.test.tsx`

**Evidence:** work-queue rows in the send stream render a button labeled "Send" and the money stream "Propose", but both only **navigate** (persona seats 1/2/4 blocker family; the cockpit parity contract kept them unwired as an owner-approved exception — the exception covers *not simulating sends*, not the misleading label).

**Contract:** no navigating control is labeled "Send"/"Propose". Relabel with the queue's existing navigation vocabulary — the audit row already uses **"Open"**; review-bound items may use **"Review"**. Preserve navigation targets and every test-pinned behavior. Do NOT wire real sends here (that's the owner-approved exception's territory, out of scope).

**Test assertions:** render queue fixtures for all streams → no button/element with accessible name `Send` or `Propose` exists; the same rows expose `Open`/`Review` actions whose click navigates to the same targets as before (assert the navigate mock's args are unchanged vs current behavior — capture current targets in the red phase).

**Steps:** read (find every label source incl. any labels map) → failing test → red → relabel → green → typecheck → commit `fix(cockpit): queue actions labeled by what they do (navigate ≠ Send)`.

### Task C2 — Engine: send affordance exists at rest

**Files:**
- Modify: `src/components/engine-rebuilt/EngineSurface.tsx` (~:381, :407-417 — send button currently mounts only when `stagedCount > 0`)
- Test: `tests/component/engine-rebuilt/EngineSurface.test.tsx`

**Evidence (verified):** at `stagedCount === 0` the topbar has Update/Regenerate/Refresh and **no send affordance or hint**; legacy always showed the green "Send update" plus the teaching line "0 staged · stage moves below to send". Two personas independently called this their make-or-break moment.

**Contract:** the send action always renders in the topbar action portal: enabled with the current label/behavior when `stagedCount > 0`; **disabled** at zero with visible helper text "0 staged — stage moves below to send" (title/tooltip + accessible description; keep the exact-once topbar portal contract — read the V2 portal mechanism in the file before touching it). No behavior change when staged > 0.

**Test assertions:** stagedCount 0 fixture → send button present + disabled + helper text findable; stagedCount 2 → enabled, label matches current, click fires the existing handler (unchanged args). Exact-once: exactly one send button in the DOM in both states.

**Steps:** read portal mechanism → failing tests → red → implement → green → typecheck → commit `fix(engine): always-visible send with truthful 0-staged disabled state`.

### Task C3 — Site Audit issue drawer: actions state their real scope

**Files:**
- Modify: `src/components/site-audit-rebuilt/SiteAuditSurface.tsx` (:415-419 `firstPageInstance`, :432-447 footer actions, :461-515 suggestion/Accept/Send block, :555-558 instances note)
- Test: `tests/component/site-audit-rebuilt/SiteAuditSurface.test.tsx`

**Evidence (verified, OVERSTATED→major):** the drawer is titled/badged with the whole issue group ("N pages") while Accept/Send/Add-task at `:432-447`/`:461-515` bind to `firstPageInstance` only; instance rows at `:521-551` offer Hide/Hide-pattern only. An operator reads "fixed 14 pages," fixes one.

**Contract (label-truth hotfix — per-page action rows are an explicitly out-of-scope follow-up):** every first-page-bound action visibly states its scope: the suggestion/action block gets a persistent scope line naming the exact page path it applies to (e.g. `Applies to {firstPage.path} only`), and the `:555-558` note must accurately describe what batch actions include (read `useSiteAuditRebuilt.ts:403-411` — `batchCreateTasks('filtered')` is filter-selective — and make the sentence match reality). No action behavior changes.

**Test assertions:** open drawer fixture with a 3-page issue group → the scope line contains page 1's path; it is visible in the same container as the Accept/Send controls (not only in a tooltip); the instances note's text matches the filter-selective semantics (assert exact corrected string).

**Steps:** read (incl. the hook's batch semantics) → failing tests → red → implement copy/structure → green → typecheck → commit `fix(site-audit): issue-drawer actions state their single-page scope`.

### Task C4 — "Accept all N" gets a confirm-with-preview

**Files:**
- Modify: `src/components/site-audit-rebuilt/SiteAuditSurface.tsx` (bulk band; the Accept-all control)
- Test: `tests/component/site-audit-rebuilt/SiteAuditSurface.test.tsx`

**Evidence:** "Accept all 785" applies 785 AI suggestions in one click with no preview/undo affordance (browser walk; seats 1/3/4).

**Contract:** clicking Accept-all opens the existing `ConfirmDialog` stating precisely what will happen using real counts from the data the surface already holds (total suggestions; the field kinds affected — titles/metas/page fields; and that acceptance creates operator work items per the existing flow — derive the true consequence sentence from the accept handler, don't guess). Confirm proceeds exactly as today; cancel is a no-op. Non-destructive dialog semantics (Enter confirms).

**Test assertions:** click Accept-all → dialog visible, contains the N from fixtures; accept mutation NOT yet called; confirm → called exactly once with unchanged args; cancel path → never called.

**Steps:** read the accept handler + ConfirmDialog API → failing tests → red → implement → green → typecheck → commit `fix(site-audit): Accept-all requires an informed confirm`.

**PR-3 close-out:** full gates + flag-ON smoke of Cockpit, Engine (0-staged state on a workspace with nothing staged), Site Audit drawer + Accept-all dialog.

---

## Task Dependencies

```
PR-1 (sequential): A1 → A2 → A3 → A4 → A5 → gates → PR
PR-2 (sequential, after PR-1 merged): B1 → B2 → B3 → gates → PR
PR-3 (sequential, after PR-2 merged): C1 → C2 → C3 → C4 → gates → PR
```
No parallel dispatch. A3 is the only task with a shared-type change; nothing downstream in this plan imports it. C3 and C4 touch the same file — C3 commits before C4 starts.

## Model assignments

Platform: **Codex/OpenAI**. Implementation: **GPT-5.6 Sol, effort HIGH**, every task (owner-specified; overrides the least-capable-model default). Review: **cross-model adversarial review by the orchestrating Claude (Fable) agent** — contract re-verification against the actual diff, independent gate runs, and flag-ON browser smoke; findings return to Sol for fixes (reviewers are never downgraded; cross-family review supersedes the earlier Sol-reviews-Sol line). Single implementation agent, sequential.

## Systemic improvements

- **Shared utilities:** if Task B3 produces identical latch logic in two lenses, extract one small hook (UI/UX rule 9). Task A3's null-render should reuse/align with the Cockpit tile's unavailable-value convention — if that produces a third copy of the same "— Unavailable" rendering, extract a tiny helper into `src/components/ui/constants.ts`'s orbit and note it in the PR.
- **pr-check rules:** none of these defect classes is cleanly mechanizable (window-label truthfulness and success-toast honesty need semantics, not regex). Instead, the component tests added here are the regression guards. One candidate worth a follow-up ticket (not this sweep): a rule flagging `toast`-success calls inside `onSuccess` handlers of mutations whose result can be empty (`pages.length`) — needs design.
- **New tests required:** listed per task; net-new assertions ≈ 20 across 9 existing test files.
- **Feature-class gates:** bug-fix class — full suite + pr-check + lint:hooks + flag-ON real-render smoke of every touched surface (CLAUDE.md rule 13). No FEATURE_AUDIT/roadmap/BRAND_DESIGN_LANGUAGE obligations.

## Verification strategy (per PR, all must pass before opening the PR)

```
[ ] npm run typecheck
[ ] npx vite build
[ ] npx vitest run                       # full suite, single instance (gotcha 7)
[ ] npm run pr-check
[ ] npm run lint:hooks
[ ] npm run verify:coverage-ratchet
```
Flag-ON browser smoke (per close-out lists): backend `npm run dev:server` (port 3002) + `PORT=3002 npm run dev` (vite; 5173 may be taken — any port), live DB `~/.asset-dashboard/dashboard.db` already has `ui-rebuild-shell = 1` in `feature_flag_overrides`; use data-rich workspace `ws_1772638492564` (Expero). Verify each fix's visible state and console-clean, screenshot each changed surface for the PR body.

Then run `docs/workflows/pr-readiness-checklist.md`, request review (single-domain per PR → `superpowers:requesting-code-review` equivalent on your platform; reviewer = Sol HIGH), fix everything the review finds (never defer a fixable bug), and open the PR against `staging` with: per-task summary, the A5 owner note (executable-basis alternative), the A3 CT-lane note, and screenshots.

## Explicitly OUT of scope (do not do these here)

- Wiring Cockpit Send/Propose to real sends (owner-approved exception governs).
- Per-page action rows / page inventory in the Site Audit drawer (audit follow-up #13 territory).
- GO-004 server-owned Outcomes Book rollup (real windowed data), keywords trend read-models (DEF-kw-001..003).
- Platform-wide server-side unknown-vs-zero convention beyond the KCC monthly-value field (follow-up; A3 sets the pattern).
- Any nav/naming/IA change (that's the separate nav-coherence item in the audit queue).

---
*Plan authored 2026-07-16 from the validated findings in `docs/superpowers/audits/2026-07-16-admin-ui-rebuild-vs-legacy-persona-audit.md` (+`.verdicts.json`). Every Evidence block was adversarially re-verified against `origin/staging @ 5a2641b21` before planning; line anchors are approximate-stable — always re-read before editing.*
