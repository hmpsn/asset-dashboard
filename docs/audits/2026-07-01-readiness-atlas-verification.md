# Readiness Atlas Verification Audit — 2026-07-01

**What this is.** A 22-agent adversarial audit of the "Readiness Atlas" document set (the 10-dimension sweep findings + the R1–R12 Reconcile Plan produced in the `hmpsn studio Design System/` artifact set), verified against `origin/staging` HEAD `e5745db2bfc795629385294b19f72f6e23c68d84`. Three layers: nine evidence agents (one per Atlas dimension, per the Atlas §3 dispatch), nine adversarial verdict agents (one per dimension, spot-checking the evidence and judging both findings and tickets), and four blind-spot hunters (coverage gaps, drift, plan-skeptic, platform-alignment).

**Evidence caveat.** All row counts come from the local dev DB (`~/.asset-dashboard/dashboard.db`, 13 workspaces, migrations through 173 applied 2026-06-30) — **not production**. Structural claims (file:line, schema, git history) are HEAD-verified. Where a prod count is load-bearing (R7 blob→rows state, orphan counts), re-verify against a fresh staging sync before cutting the ticket.

---

## Executive verdict

| Question | Answer |
|----------|--------|
| Are the **findings** sound? | Largely yes. Of 51 crack verdicts: **24 sound, 22 partially-sound, 3 stale, 2 unsound.** The diagnostic layer is good work — the structural theses (fragmented vocabularies, polymorphic string links, ungoverned enums, unfinished cutovers) survive adversarial review. |
| Are the **recommendations** (R1–R12) sound? | Mostly no, as written. Of 36 ticket judgments: **2 right-fix, 25 right-direction-wrong-shape, 7 wrong-fix, 2 unnecessary.** The plan was written without reading the repo's own contract docs, and its three most expensive tickets each collide with a governed, mechanically-enforced platform contract. |
| Is anything incorrect? | Yes — five premise failures (below), two findings false at authorship (T4, T6), one finding built partly on a fabricated code-comment quote (O5), and several stale claims. |
| What was missed? | Five consumer/operational layers no sweep covers: `server/state-machines.ts` itself, the `client_deliverable` dual-write spine, the MCP external contract (61 tools + persistent API keys), the WS-event/React-Query invalidation contract, and the intelligence-slice read layer. Plus migration/rollback safety, externally-mirrored vocabularies (Stripe/GBP/Webflow), `ActivityType`, and the redesign mockups' own new vocabulary. |

**The one-sentence summary:** the Atlas correctly diagnoses a platform whose discipline is applied unevenly, but the Reconcile Plan repeatedly proposes to *build* things the platform already has — and the correct plan is mostly to *extend the existing canon* (state-machines.ts, the flag/job registries, the single-writer lifecycle API, ui-vocabulary) rather than erect parallel authorities next to it.

---

## 1. The five premise failures (blocking)

These were independently confirmed by 2–4 agents each (dimension verdicts + hunters).

### 1.1 R3 — the barrier ticket rebuilds `server/state-machines.ts`

R3 ("a typed base Lifecycle with an explicit transition table — a state machine, not scattered if-chains") is the plan's Barrier 2; every lane serializes behind it. But `server/state-machines.ts` (405 lines) has existed since 2026-04-06, defines **16 explicit transition tables** (approval items, content requests, posts, work orders, content subs, client actions, recommendations ×2 axes, briefing drafts, background jobs, GBP review responses, client deliverables + per-type overrides, matrix cells, requests, schema plans, tracked keywords) with `validateTransition()` called at **36 sites across 24 files**, is mandated by CLAUDE.md, and is mechanically enforced by pr-check ("Unguarded SET status = ?", `scripts/pr-check.ts:2167-2178`). R3's exit criterion "≥3 domains share the base" is already exceeded 5×.

Also: of the "~40 ad-hoc status enums," **37 `*Status` unions exist in shared/types but many are classifications, not lifecycles** (`ContentTermCoverageStatus`, `IntegrationQuotaStatus`, `SchemaValidationStatus`…) — they cannot fold into a transition-table envelope.

**Correct shape:** reframe R3 as a *coverage + envelope* ticket over the existing module: (a) shared typed `Lifecycle` envelope layered over the 16 tables, (b) census splitting the 37 unions into lifecycle vs classification (only the former migrate), (c) route the remaining unguarded enums through `validateTransition`, (d) explicit decision on DB-layer triggers (SQLite CHECK can't see old values; BEFORE UPDATE triggers are a sizeable new surface — possibly deferred). Re-size L→M. This shortens the barrier and un-delays every lane.

### 1.2 R6 — the "shared node" fixes a link that already exists; the real link can't be a hard FK

R6 says "replace the (source_type, source_id) string with a foreign key from action → outcome." At HEAD, `action_outcomes.action_id` is **already a real FK with ON DELETE CASCADE** (migration 041), FK enforcement is on, and the dev DB shows 0 orphans out of 392. The Handoff Brief's worked-example query returns 0 by construction — R6 as written no-ops.

The *actual* string link is `tracked_actions.(source_type, source_id)` → **8 polymorphic source kinds** (dev DB: recommendation 76, approval 68, brief 22, internal_link 9, strategy/content_decay/brand_voice 3 each, post 1). A hard FK there is architecturally hostile:
- SQLite can't express one FK to 8 parents, and can't `ALTER TABLE ADD FOREIGN KEY` — it's a full table rebuild.
- The prime target (`recommendation_items`) is **deleted and reinserted on every save** (`server/domains/recommendations/storage.ts` `writeItems()`); CASCADE would delete outcome history on every regen, RESTRICT would block regens.
- Outcomes are *designed* to outlive their ephemeral sources — that's what the "honest generic label" fallback documents (`shared/types/outcome-tracking.ts:298`). In the dev DB, all 76 recommendation-sourced actions are unresolvable against `recommendation_items` (0 rows locally) — the entire ledger is an "orphan" by FK standards.
- R6 has an unstated hard dependency on R7 (the blob→rows fallback makes any FK into `recommendation_items` unenforceable until the cutover completes).

**Correct shape:** re-spec as the polymorphic-link ticket it is. Options: (a) soft integrity — typed source-ref union, an integrity-sweep job reporting dangling refs, snapshot-on-write of source title/context at `recordAction` time so the fallback becomes rare instead of deleted; or (b) an immutable `action_source_snapshot` table a hard FK can point at. Either way: depends on R7, re-size M→L, and the archive-boundary interaction with R11 must be resolved.

### 1.3 R4 — collapses the two-axis model that exists *because of* the footgun it cites

R4 wants to fold `status` / `clientStatus` / `lifecycle` into one lifecycle so "a struck rec reading as completed" becomes impossible by construction. It already is — by a different construction the plan doesn't acknowledge: the ratified Strategy v3 two-axis contract (`docs/rules/strategy-recommendations.md`: "The two axes (NEVER conflate them)"), enforced by (a) the frozen single-writer API in `server/recommendation-lifecycle.ts`, (b) separate transition maps (`RECOMMENDATION_TRANSITIONS`, `CLIENT_REC_TRANSITIONS`), (c) the `isActiveRec` 4-condition predicate, (d) `applyLifecycleCarryOver` through regens, (e) two mechanized pr-check rules (#21, #22), and (f) an exit-gate integration test ("strike-never-completed survives a real regen"). The Handoff Brief's own hard stop #4 ("Never write RecStatus from a strike/throttle path") *presumes the axes stay separate* — R4 deletes the separation its own hard stop protects.

**Correct shape:** owner decision required (see §5). Recommended: keep the two-axis model as the reconciled design and re-target R4 at the residual gaps — DB-level CHECK/trigger on the struck≠completed pair, cleanup of the third `lifecycle` sub-axis, any reader still filtering raw status outside pr-check's scope. A true collapse is a spec-level contract supersession, not a Reconcile ticket.

### 1.4 R9 — violates the plan's own hard stops and re-plans landed/reserved work

R9 ("stop shipping CPC-proxy as the headline dollar; surface the coverage funnel") directly contradicts the Handoff Brief's hard stops ("No new UI"; "Nothing a client sees or is billed on may change"). An agent following the preamble must refuse its own ticket. Separately, HEAD moved past the sweep: the `measured_action` rung is **code-complete behind default-false flags** (`the-issue-client-measured-capture`; producers in `server/the-issue-outcome.ts`, `roi.ts`, `webflow-form-poller.ts`, `return-hook-cron.ts`), and `actual_reconciled` is **explicitly reserved** for The Issue (Client) P3 under flag `the-issue-client-reconciliation` (`status: 'reserved'`), owner-sequenced per phase-per-PR.

**Correct shape:** cut R9 from Reconcile. Replace with a thin ticket: verify the P1a measured-capture path on staging + build the tracked→measured→reconciled **coverage metric** (the genuinely unbuilt piece). `actual_reconciled` stays where the platform already scheduled it.

### 1.5 R12 (first half) — the master-flag collapse breaks the live pilot's rollout controls

The Issue constellation is **7 flags, not ~5** (`strategy-the-issue` + six `the-issue-client-*`), each with its own `removalCondition` and heterogeneous `rolloutTarget`s, and they are exercised *independently* right now: the pilot workspace runs spine/measured-capture/return-hook ON with `strategy-trust-ladder-autosend` explicitly OFF — a safety flag whose OFF state is the only thing preventing unreviewed client auto-sends. One master flag: (a) can't express per-phase rollout, (b) is the composite-parent anti-pattern CLAUDE.md's toggle-scope-minimality rule forbids, (c) makes the documented client-side flag-resolution gap (client `useFeatureFlag` reads GLOBAL flags only) *worse*, and (d) would light unfinished phases together.

**Correct shape:** split R12. Keep the translation-map half (build on the already-enforced `docs/workflows/ui-vocabulary.md` layer). Replace the collapse with the plan's *own second half*: burn down each child flag via its `removalCondition` as its phase ships — which is the platform's existing lifecycle contract and achieves the collapse safely. Exempt `strategy-trust-ladder-autosend` from any consolidation. If a master flag survives at all, its client resolution semantics (global vs workspace-aware) must be specified in the ticket, with the mandated flag-ON browser smoke.

---

## 2. Other material corrections

- **R2 is a rename, not a merge.** The two `DeliverableStatus`/`DeliverableType` pairs are different bounded-context concepts sharing a name (brand-engine's 17 brand-artifact kinds + draft/approved vs the client-deliverable spine's 17 send-to-client kinds + 12-state lifecycle). "One imported type each" would legalize illegal states in both contexts. `DeliverableStatusAxis` is a derived operator read-model, not a duplicate at all. Fix: rename (`BrandDeliverableStatus/Type`), keep the spine canonical. This also fixes R1's pr-check shape: *name-collision* check (mechanizable as a customCheck), not semantic dedupe. Note a **fourth** shape exists: `DeliverableStateStatus` in `server/state-machines.ts:216` — the re-declaration is systemic.
- **R5 must not merge the unions.** The five taxonomies are semantically distinct dimensions across four bounded contexts; `ScoringConfig = Record<ActionType, …>` means folding MCP verbs/hub commands in forces nonsense scoring entries, and the platform's compile-checked seam (`recommendationOutcomeActionType`, exhaustive mapping) is the pattern to copy, not delete. Correct shape: one read-only action **catalog** (metadata registry keyed by context+action, modeled on `BACKGROUND_JOB_METADATA`) + typed unions + explicit seam mappings. Phantom-entry cleanup stays, but note the sweep's "vestigial" quote for the keep-markers **does not exist in the code** — the real comment says the opposite, and live producers exist (`ContentGaps.tsx`, `TopicClusters.tsx`).
- **T4 and T6 were false at authorship.** T4: the keyword-blob fork was closed 2026-06-04 (read-switch + blob-strip + provenance all ancestors of HEAD) — three weeks before the sweep cites migration 158. T6: migrations 029/049/019 all use the standard drop-or-rename rebuild pattern; zero `*_new` tables and exactly one `client_signals` exist. **Half of R11's scope is a no-op.** R11 re-scopes to: T5 snapshot envelope (13 tables, count verified) + T7 archive twins (real: `tracked_actions_archive`, `action_outcomes_archive` are hand-copied and drifting).
- **O2's defaults claim is inverted — and the truth is sharper.** The DDL default is `not_acted_on`, but the application default is `params.attribution ?? 'platform_executed'` (`server/outcome-tracking.ts:339`): an attribution-less call silently *claims platform execution*. Detection only scans `not_acted_on` rows, so the sweep's "inferred even for direct-execution jobs" inverts the code. R8 also re-scopes: 2 of the major seams already stamp attribution as fact (content publish, schema publish — the #1419 domain-service extraction is the worked example); remaining work is `playbooks.ts`, `webflow-seo-bulk-accept-fixes-job.ts`, `gbp-review-response-publish-job.ts`, plus the new inline MCP execution paths.
- **R10's throttledUntil conversion contradicts a twice-documented design decision** (`strategy-recommendations.md`: "auto-resurfaces on-read — no cron needed"), and the adjacent nudge-cron already exists dark-launched (`strategy-staleness-scan`). The "inverted cancellable default" doesn't match HEAD (`BACKGROUND_JOB_METADATA` has explicit per-type `cancellable`); the verified gap is that the job-cancel route doesn't consult it. R10's *registry half* (CRON_METADATA for the ~18–19 boot-wired schedulers, one execution surface) is right-fix.
- **Stale usability findings:** A3 (duplicate keyword-strategy tab) fixed by T4.1; C3 (charts-first overview) fixed twice over (derived plain-language verdict sentence + flag-ON verdict-first page); A01-3 (competitor alerts "never shown") stale — `CompetitorsPage` + `CompetitorAlertsPanel` shipped 2026-06-19, nav-hidden but URL-reachable. P2 must fold the *existing* panel into Signals, not rebuild it.
- **Sweep bookkeeping drift:** sweeps were authored at commit `40ef9579f` (2026-06-29) — only ~30 commits stale; nothing in the drift window touched the action/outcome/recommendation spine. But several headline counts were wrong *at authorship*: 26 nav entries (registry-anchored, contract-test-pinned), 29 flags not 28, MCP 61 tools not 45, ~18–19 boot-wired scheduler subsystems not ~12.

## 3. What survives intact (confirmed)

- **The core spine cracks are real at HEAD:** T1 (four-table smear, minus the "conflicting status" framing), T2/R7 (blob→rows fork still live: `loadRecommendationSet` falls back to the JSON blob; dev DB has 0 `recommendation_items` rows vs blobs up to ~428KB), T3 (the polymorphic string link — correctly identified, wrongly ticketed), T5 (no snapshot envelope; 13 snapshot tables, `audit_snapshots` even lacks `workspace_id`), T7 (archive drift), TX1–TX3 + the approved collision (now **19** vocabularies, grew via the GBP pair), O1 (CPC-proxy headline dollar — sound), O4 (learnings inherit weak inputs — sound), JB1/JB2 (two execution systems, no cron registry — sound), CL1 (flag load-bearing, *understated*: 3 hook reads + 5 further forks), CL4 (tab vocabulary), C2/C5 (unmeasured purchase mode; insight_acted_on catch-all).
- **R7 is the plan's one unambiguous right-fix** — finish the migration-158 cutover, drop the items-win fallback. It should move *earlier* (before R4, see §4).
- **The lexicon-first instinct (R1) is right** for this platform — it just needs three word classes (canonical / externally-mirrored / historical), a name-collision pr-check + machine-readable registry modeled on `FEATURE_FLAG_CATALOG` + `verify:feature-flags`, and an intake of the redesign mockups' new vocabulary (see §4).
- **The Atlas's method survives:** evidence-not-verdicts, one-owner-per-shared-crack, audit-wide-then-build-narrow all proved workable — this audit ran on exactly that protocol.

## 4. What no sweep covered (the blind spots)

1. **`server/state-machines.ts`** — see §1.1. The plan's "copy the template" list (flag registry, job registry, glossary) omits the two best precedents: state-machines.ts and the ClientDeliverable spine (`getDeliverableTransitions` — the "shared base + per-type overrides" shape R3 wants already shipped once).
2. **The `client_deliverable` unified store + dual-write mirrors** — a live **fifth** home of action state with a **second** string link (`source_ref` TEXT, unique-index dedupe, workspace-only FK). Every SENT recommendation dual-writes into it (best-effort, failures swallowed → silent divergence possible). R4/R6/R12 must scope it explicitly; R12's translation map should own the deliverable adapters.
3. **MCP as an external contract** — 61 tools whose descriptions/outputs/instructions embed every enum R3/R4/R5 rename; per-workspace **persistent API keys** landed 2026-06-29 (migration 163), so outside agents hold long-lived credentials against these schemas. Needs a tolerate-old/emit-new compatibility workstream or an explicit breaking-change window.
4. **WS events + React Query invalidation** — ~89 event constants, centralized invalidation registry, pinned by 4+ contract tests. R4/R6/R7/R10/R11 each need a "WS payload + invalidation handlers + contract tests updated in same PR" acceptance line. R10 specifically: converting crons to jobs makes system runs appear in the user-facing job feed — decide a system-jobs class/filter first.
5. **Intelligence slices (33 modules)** — the read layer for AdminChat/generation/MCP consumes the exact tables R7/R9/R11 reshape (`learnings-slice` reads `action_outcomes`; `client-signals-slice` reads `client_signals`). Add slice read-path acceptance lines; re-run AI-quality fixtures after R9-adjacent changes.
6. **Live-SQLite migration mechanics** — forward-only, no rollback, FK-add = table rebuild, backup retention defaults to **3 days**. Add **R0**: verify prod S3 backup, raise retention across the reconcile window, one restore drill; convert R7/R11 drops to rename-to-archive + delayed drop.
7. **Externally-mirrored vocabularies** — `ContentSubStatus` mirrors Stripe's words (`past_due`); GBP review states, Webflow publish states. R1's lexicon needs the three word classes; the enum census must tag each before any rename.
8. **`ActivityType`** — a ~150-member union where action words are actually minted freehand, plus an append-only log written in whatever vocabulary existed at write time. R1's pr-check should cover new additions; the log is historical vocabulary (renderer-tolerant).
9. **Client serialization allow-lists + test blast radius** — `recommendation-public-projection.ts` and public-portal field lists hard-code the vocabulary R4 touches; 135 contract tests + coverage ratchet pin the enums/event shapes. Budget it per ticket.
10. **The redesign's own vocabulary** — the real mockups (~7,100 lines in `hmpsn studio Design System/mockup/`) introduce concepts no R-ticket names: client thread `kind: 'request' | 'instruction' | 'approval'`, `promotable` (client→operator promotion), cockpit rail names. Without an R1 intake, the lexicon is obsolete the day P2 starts. Consider tracking the design-system folder in-repo.

## 5. Owner decisions needed (checkpoint)

1. **R4:** keep + harden the two-axis model (recommended), or ratify a contract supersession and collapse?
2. **R9:** cut from Reconcile; thin verify+coverage ticket now, `actual_reconciled` stays in The Issue (Client) P3 (recommended)?
3. **R12:** replace master-flag collapse with per-flag burn-down via removalConditions; exempt `strategy-trust-ladder-autosend` (recommended)?
4. **R6 shape:** soft integrity + snapshot-on-write (recommended) vs immutable `action_source_snapshot` + hard FK?
5. **R10:** drop the throttledUntil-to-cron conversion (recommended), or open a contract amendment against `strategy-recommendations.md`?
6. **R0:** add the backup/restore-drill safety ticket to Wave A (recommended — cheap)?
7. **Design system folder:** track in-repo so the P2 target is versioned with the contracts it must obey?

## 6. Revised sequencing (post-audit shape, pending sign-off)

- **Real dependency edges at HEAD:** R2 runs *with/immediately after* R1. R10 (registry half) and R11 gate only on R1 + the migration-merge gate — not R3. Only R4/R5/R6/R7 sit behind the (now smaller) R3. **Flip R7 before R4** (single source of truth first; halves R4's migration surface). Move the throttledUntil work into the R4 chain (same files) if it survives decision #5 at all.
- **"1 ticket = 1 PR" is structurally wrong** for the data tickets: expand→backfill→staging-verify→contract is ≥2 PRs by construction (matches house phase-per-PR + staging-first). Plan PR chains, and split the bundled tickets (R10 = 4 deliverables, R11 = 2, R12 = 2) into ordered sub-PRs. Elapsed-time estimate roughly 2× the plan's ticket-count accounting.
- **Lanes must be file-disjoint, not table-disjoint** (R10/R4 collide on `recommendation-predicates.ts` + `recommendation-lifecycle.ts` as originally scoped).

## 7. Provenance

- Run: workflow `wf_3b4f7a8b-6a4`, 22 agents, ~3.0M tokens, 1,070 tool calls, 2026-07-01.
- Full structured output: session task `w954j3xuc` (dimension evidence + verdicts + hunter findings, per-crack file:line evidence).
- Source artifacts audited: `hmpsn studio Design System/*.html` (Readiness Atlas, 10 sweeps, Migration Readiness Map, Reconcile Plan, Agent Handoff Brief, Parallelization Map), untracked, as of 2026-07-01.
