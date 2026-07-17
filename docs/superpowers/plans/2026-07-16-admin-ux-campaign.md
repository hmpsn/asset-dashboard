# Admin UX Campaign — Implementation Plan (Waves 0–4)

> **For agentic workers:** implementation is a **GPT-5.6 Sol agent on Codex, effort HIGH per task**, dispatched via the codex-companion pipeline (standalone clone, Sol implements + tests, **never runs `git add`/`git commit`** — the orchestrating Claude cuts per-task commits and runs the husky hook unsandboxed). Cross-model adversarial review by Claude (diff-vs-contract re-verification, independent gate runs, flag-ON browser smoke) before every PR. Per `docs/PLAN_WRITING_GUIDE.md` this plan locks **contracts + test assertions + constraints**, never implementation bodies: READ the real code, write the failing test, observe red, implement minimally, observe green. If real code contradicts a contract, STOP and print `NEEDS_CONTEXT:` — the C4 stop in the trust-landmine sweep is the model to follow.

**Goal:** resolve every outstanding item from the 2026-07-16 rebuild audit and UX-flow audit — the `admin-ux-flow-2026-07` roadmap sprint (21 items) plus the bundled minor findings — leaving the admin UI flow-correct, convention-enforced, capability-complete, and **retirement-ready** (see Scope boundary).

**Owner decisions (locked 2026-07-16, recorded verbatim):**
| # | Decision | Answer |
|---|----------|--------|
| D1 | Engine action-inversion fix | **Option A reorder** (verdict-first opening preserved; work block to fold 1; POV+preview paired; evidence collapsed; Operations last) + jump-nav |
| D2 | Nav naming taxonomy | **Sidebar names win everywhere** (Insights Engine, Keywords, Asset Manager, Content Pipeline → canonical in registry, breadcrumbs, ⌘K, document titles) |
| D3 | Usability budgets | **Ratify all 8, enforced** (pr-check/contract-test where mechanizable; PR-readiness checklist otherwise) |
| D4 | ⌘K palette | **Honesty relabel + top-10 action verbs + hide debug workspaces** |
| D5 | Anomaly home | **Search & Traffic anomalies section is canonical + Cockpit risk-stream pointer with truthful count** |
| D6 | Big rocks | **Include both**: book-level Cockpit at `/` AND the backend read models (DEF-kw-001..003 + GO-004) |
| D7 | Execution mode | **Two parallel Sol lanes** for the medium waves (exclusive file ownership per lane; Claude reviews/ships sequentially) |
| D8 | Old-dashboard retirement | **OUT OF SCOPE.** Both UIs are kept. This campaign removes every technical blocker to retirement (AI-visibility home, anomaly home, `/` rebuild) but plans none of Phase Z; the retirement decision and schedule remain the owner's, separately. |

**Scope boundary (D8):** no task in this plan may delete legacy code paths, alter `ui-rebuild-shell` semantics, remove flag rows, or otherwise begin retirement. Where a task gives a legacy-only capability a rebuilt home (W3.1, W3.2, W4.1), the legacy home **stays mounted flag-OFF, byte-identical**.

**Evidence base (the pre-plan audit):** `docs/superpowers/audits/2026-07-16-admin-ui-rebuild-vs-legacy-persona-audit.md` + `.verdicts.json` (44 adversarially validated claims) and `docs/superpowers/audits/2026-07-16-admin-ux-flow-audit.md` + `.verdicts.json` (instrumented fold/action dataset + 4 judges with file-anchored recommendations). **Every task below cites its verdicts entry as REQUIRED READING — the judge/validator text contains the exact file anchors, option details, and tradeoffs; this plan deliberately does not duplicate them.**

**Roadmap linkage:** tasks map 1:1 to `admin-ux-flow-2026-07` item ids (given per task). Closing a task's PR = mark that item `done` with notes in the same PR.

---

## Global constraints (every task, every lane)

1. All the trust-landmine-sweep-era constraints hold: imports at top; `@ds-rebuilt` gates (tokens-only, `<Icon name>`, DS primitives, no new hues); `useToast` for mutation feedback; overlays via `ConfirmDialog`/`Drawer` + `overlayUtils`; send vocabulary per `docs/workflows/ui-vocabulary.md`; pr-check hatches inline-only (and: you should not need one).
2. **`?tab=`/`?lens=`/`?item=` two-halves contract** for every deep link a task adds — sender AND receiver, with the contract test updated.
3. Tests: extend the existing per-surface test files; real-hook flag-transition tests where a flag branch is touched; no fixed ports; no vacuous `.every()`.
4. **Never run two vitest instances at once; purge PPID-1 `tsx server/index.ts` orphans before full-suite runs** (environmental EADDRINUSE signature: N file-fails, 0 test-fails → re-prove at `--maxWorkers=2`).
5. Flag-ON browser smoke on every touched surface before its PR (live DB; after W0.1 lands, ALSO on the loaded demo workspace).
6. Nav/route changes follow `docs/rules/route-removal-checklist.md`; new WS events into `ws-events.ts` with both broadcast halves; new server reads through intelligence slices/builders where the rules require.
7. Every PR: one wave-task, full gate block (typecheck, build, full vitest, pr-check, lint:hooks, coverage-ratchet via CI), `FEATURE_AUDIT.md` entry if user-facing behavior changed, roadmap item(s) → `done`, staging-only merges.
8. Docs-sync: any label/vocabulary change registers in `ui-vocabulary.md` + `shared/types/lexicon.ts`/`GLOSSARY.md` in the same commit; any convention ratified lands in `docs/rules/` per `rules-lifecycle.md`.

## Model & dispatch assignments

| Role | Assignment |
|---|---|
| Implementation (all tasks) | Codex / **GPT-5.6 Sol, effort HIGH** (owner-specified; no downgrades) |
| Review (all PRs) | **Claude (orchestrator), cross-model adversarial** — never downgraded, never Sol-reviews-Sol |
| Backend read models (W4.2) & `/` rollup server work (W4.1a) | Same Sol HIGH; orchestrator runs the DB-migration + contract-test gates personally |
| Parallel lanes (D7) | Two standalone clones (`/private/tmp/adx-laneA`, `/private/tmp/adx-laneB`), one Sol job each, **exclusive file ownership per lane below**; orchestrator serializes commits/reviews/PRs |

---

# Wave 0 — Foundations (sequential; no owner gates)

### W0.1 — Loaded demo workspace (`loaded-demo-workspace`)
**Files:** `scripts/seed-demo.ts` (locate actual seed entrypoint via `package.json` `seed:demo`), `tests/fixtures/workspace-seed.ts` orbit; new fixture data only. **Must not touch:** production seed guards (keep the existing blocked-in-production check).
**Contract:** `npm run seed:demo` additionally creates ONE workspace (`ws_demo_loaded`) carrying volume: ≥50 content-pipeline items spread across board stages, ≥10 cockpit work-queue-classifiable items (mix of audit/risk/send/money producers), a persisted site-audit result (reuse a captured fixture payload), a persisted redirect-scan result, ≥500 page_keywords with mixed cpc (0 and >0), client requests incl. unanswered replies, and recorded outcomes/wins. Idempotent re-seed; live-DB safe; documented in `docs/workflows/local-dev-onboarding.md`.
**Tests:** seed unit test asserting the counts above post-seed; existing seed tests stay green.
**Why first:** every later wave's smoke gains an under-load measurement target (the UX-flow audit's stated coverage gap, §8).

### W0.2 — Usability budgets: rule doc + mechanizable enforcement (`usability-budgets-ratification`)
**Files:** new `docs/rules/usability-budgets.md`; `docs/workflows/pr-readiness-checklist.md` (add budget items); `scripts/pr-check.ts` + `docs/rules/automated-rules.md` regeneration; new contract test(s) under `tests/contract/`. **Required reading:** conventions judge in the UX-flow verdicts (full 8-budget definitions + proposed enforcement homes).
**Contract:** all 8 budgets documented with their D3-ratified status and per-budget enforcement home. Mechanized now (each with the 5 customCheck test obligations from the F2a lesson): (a) **actionless-EmptyState signal** — `<EmptyState` without an `action` prop outside an allowlist; (b) **nav-label override ban** — no hardcoded label overrides in `RebuiltSidebar` once W0.3 moves them to the registry (guards D2 permanently); (c) **windowed-aggregate reminder** — extend the existing rate-display manual-checklist item to name budget 5. Budgets 1–2 (fold/containment) are checklist + audit-probe enforced (document the probe snippet from the UX-flow dataset as the measurement method); do NOT attempt a fold-depth pr-check regex.
**Tests:** pr-check self-tests for each new rule (registry/describe/allowlist/rules-doc/governance — all five obligations).

### W0.3 — Nav naming closure per D2 (`nav-naming-closure`)
**Files:** `src/lib/navRegistry.tsx` (labels move here — sidebar names win: Insights Engine, Keywords, Asset Manager, Content Pipeline), `src/components/layout/RebuiltSidebar.tsx` (delete `GROUP_PRESENTATION` label overrides), CommandPalette group-source (palette groups read the registry zones, not legacy `NavGroupKey` labels), document-title source (title follows the active registry label — fixes the stuck-title fast-follow), breadcrumb inherits automatically. **Required reading:** conventions + journeys judges (exact override locations). **Legacy caution:** legacy Sidebar (flag-OFF) keeps its own labels — do not touch it (D8).
**Contract:** one name per destination across rebuilt sidebar = breadcrumb = ⌘K = `document.title`, sourced from the registry only; nav/deep-link contract tests updated; lexicon/ui-vocabulary registrations for any renamed label in the same commit.
**Also in this PR — the say-it-aloud vocabulary pass (`vocabulary-say-it-aloud-pass`):** apply the conventions judge's replacement list across the dense trio ("Backing moves live" → "Moves in progress", "unclassified" → operator wording, etc. — full list in the UX-flow verdicts), registering every changed term in `ui-vocabulary.md` + the lexicon per budget 8. Pure label work, same enforcement layer as the naming closure — one PR keeps the registrations atomic.
**Tests:** component assertions that sidebar label == registry label == palette row label for the three contested pairs; a title-follows-route test; renamed-string assertions in the affected surface tests (grep-based sweep to catch stragglers, per the string-literal-rename rule).

# Wave 1 — Quick wins (sequential; 3 PRs)

### W1.1 — Flow quick wins (`engine-jump-nav-senders`, `canyon-cap-search-traffic`, `outcomes-record-form-demotion`)
**Files:** `src/components/engine-rebuilt/EngineSurface.tsx` (+ its test) — jump-nav only in this PR; `src/components/search-traffic-rebuilt/SearchLens.tsx` (+ test); `src/components/global-ops-rebuilt/OutcomeWorkspaceLens.tsx` orbit (+ test). **Required reading:** engine judge quick-win + canyons judge S&T caliber + journeys J6.
**Contracts:** (a) Engine: sticky toolbar anchor row (Changes · Signals · POV · Moves · Operations) rendered from `ENGINE_LENSES`, each calling `state.setLens(id)`; the existing receiver does the scrolling; sticky must not stack with `CurationBulkActionBar`. (b) S&T Detail table: initial 25 rows + in-table text filter + truthful "Show all N" expander; lower Search band becomes reachable without a 30-fold scroll. (c) Outcomes: `RecordPublishedWorkCard` moves below the TabBar or behind a "Record published work" button→Drawer; readback first.
**Tests:** jump click scrolls/focuses target section (receiver already tested — add sender test); table caps at 25 with expander showing the real N; outcomes tab content renders above the form.

### W1.2 — Wayfinding: ⌘K + Cockpit handoffs (`command-palette-verbs`, `cockpit-handoff-item-identity`)
**Files:** CommandPalette component + its action-dispatch wiring; `src/components/cockpit-rebuilt/CockpitWorkQueue.tsx`/`CockpitSurface.tsx` handoff builders (+ receiving surfaces' existing `?lens=`/`?item=` receivers — verify, don't rebuild); tests for both. **Required reading:** journeys judge (verb dispatch list + the canonical Engine handler pattern).
**Contracts:** (a) palette navigate rows say "Open …"; debug workspaces (`cascade-debug*`, `dbg*`, `Trigger Check WS`, `Check Set WS`) excluded from the switcher via a fixture-name predicate or workspace flag — choose whichever the workspace model already supports, NEEDS_CONTEXT if neither cleanly exists; (b) the D4 top-10 verbs dispatch to their real handlers with workspace context and honest disabled states when context is missing; (c) **AMENDED during execution (Sol NEEDS_CONTEXT correct): the contract matches the journeys judge's actual recommendation — SECTION/LENS routing per sourceType, not per-item deep links.** The judge's own canonical examples are section-level (`rank_drop → seo-keywords?lens=rankings`, `setup_gap → workspace-settings?tab=connections`); the earlier "item identity / `?q=…` / `?issue=…`" wording over-promised beyond the data model (work-queue rows are aggregates — "31 SEO errors", "N rank drops" — with no retained per-item id, and the target receivers mostly lack `?issue=`/`?q=` params). Corrected contract: enumerate the classifier's sourceTypes (`request`, `work_order`, `content_request`, `content_pipeline`, `rank_drop`, `content_decay`, `audit_error`, `setup_gap`, `churn_signal`) and route EACH to the most specific EXISTING receiver — carrying a real param only where the classifier already holds a canonical id AND the receiver reads it (`content_decay → seo-audit?sub=content-decay`, `setup_gap → workspace-settings?tab=connections` fully qualify), else the correct surface+section/lens (`rank_drop → seo-keywords?lens=rankings`, `audit_error → seo-audit`, `churn_signal → requests?tab=…`). Never invent a receiver param; never parse display text out of `meta`. This still delivers the journey's re-find-tax reduction (land on the right surface+section, not the top of a 47-fold page). **Deferred to Wave 3 backlog (`cockpit-handoff-per-item-deeplink`, pairs with W3.3):** typed per-item identities on aggregate work-queue rows + new `?issue=`/`?item=` receivers on Site Audit / Requests / Content Pipeline — a real capability, out of quick-win scope.
**Tests:** palette verb fires its handler (mocked) exactly once; disabled without workspace; queue-row action navigates with the identity param; receiver initializes from it (two-halves test per pair).

### W1.3 — Empty states + global chrome (`empty-state-repair-sweep`, `global-tab-chrome-context`)
**Files:** the six dead-end connect/configure states (TrafficLens + the five siblings named in the conventions verdicts) + their tests; `src/App.tsx:280-284` chrome fallback + `RebuiltAppChrome`/`RebuiltSidebar`/`RebuiltBreadcrumb`/AdminChat context threading (+ `tests/component/App.test.tsx:626` — the pinned test changes deliberately). **Required reading:** conventions judge (d) + rebuild-audit #41 validator note.
**Contracts:** (a) each dead-end state links its named destination (Competitors teach-with-CTA pattern); (b) global tabs use the **last-visited workspace** (persisted, e.g. localStorage keyed like other shell prefs) instead of `workspaces[0]`, with an **honest no-workspace chrome state** (breadcrumb omits the workspace segment on `GLOBAL_TABS` — the audit's recommended `RebuiltBreadcrumb` fix; AdminChat binds to no workspace rather than a wrong one). This supersedes the `global-ops-contract.md` mechanism note — update that contract's consequence paragraph in the same PR (owner already directed the change via the roadmap item).
**Tests:** empty-state CTA navigates; bare `/settings` with no visit history renders no workspace segment and AdminChat has no workspace binding; after visiting Expero, `/settings` shows Expero as context.

# Wave 2 — Structural mediums (two parallel Sol lanes per D7)

**Lane ownership (exclusive):** Lane A owns `src/components/engine-rebuilt/**` + its tests. Lane B owns `src/components/ui/layout/WorkbenchFrame*` (new), `site-audit-rebuilt/**`, `schema-rebuilt/**`, `asset-manager-rebuilt/**` + tests. Neither touches shared barrels without an orchestrator-owned contracts commit first (`src/components/ui/layout/index` barrel export for WorkbenchFrame is pre-committed by the orchestrator before Lane B dispatch). Lane C tasks run on whichever lane frees first.

### W2.A — Engine Option A reorder per D1 (`engine-actions-forward-reorder`)
**Files:** `EngineSurface.tsx` (section order), the evidence-disclosure wrapper (reuse `Disclosure`/`GroupBlock` + the `?lens=` key-remount auto-open pattern Operations already uses), tests. **Required reading:** engine judge Option A in full (incl. tradeoffs + the duplicate-narrative finding).
**Contract:** opening cluster byte-identical (eyebrow → StrategyDiff → nudges → verdict hero → value frame); work block (CurationMeter + NeedsAttentionStrip + BackingMovesQueue + projections) immediately after; "compose the issue" band pairs the POV editor with `ClientTrustSpinePreview` (removing the duplicated verdict/value render); StanceBar + Signals + LostQuery fold into one collapsed "Evidence behind this issue" disclosure auto-opening on `?lens=signals`; Operations remains last (V5 exception intact); all `?lens=` anchors keep working post-reorder (jump-nav from W1.1 retargets automatically since it uses the same ids); measured outcome: first primary action within budget 1 (≤1 fold on the loaded demo workspace).
**Tests:** section-order assertion; `?lens=signals` opens the disclosure; exact-once send/POV/preview mounts; the W1.1 jump-nav test still passes; fold-budget probe documented in the PR body with before/after numbers.
**Contract-governance step:** update `docs/ui-rebuild/parity/engine-contract.md` — record the fired circle-back trigger, D1, and the new section order as the owner-approved composition (same PR).

### W2.B1 — WorkbenchFrame + Site Audit containment (`canyon-containment-site-audit`)
**Files:** new `src/components/ui/layout/WorkbenchFrame.tsx` (+ barrel, a11y-floor coverage, styleguide entry per DS gates); `SiteAuditSurface.tsx` (+ test). **Required reading:** canyons judge (frame spec + Site Audit caliber).
**Contract:** frame = pinned flex-none header region + exactly one `min-h-0 flex-1 overflow-auto` collection region, page bounded to viewport; Site Audit: pinned compact hero + category cards (they remain the working category filters) + utility/bulk band; issues list becomes the contained region; drawer/deep-links/bulk semantics unchanged; page ≤1.2 folds on the loaded demo workspace.
**Tests:** frame primitive unit tests (one-collection invariant, a11y); Site Audit renders bounded (probe-style assertion on container heights); existing 30+ surface tests stay green.

### W2.B2 — Schema containment + in-region search (`canyon-containment-schema`)
**Files:** `schema-rebuilt/GeneratorLens.tsx`, `SchemaPageTable.tsx` (+ tests). **Contract:** WorkbenchFrame adoption; pinned readiness strip + workflow strip + bulk band; 766-row table contained with an in-region `SearchField` filter + row cap/`Show all` consistent with W1.1's S&T pattern; resolves the drawer-per-page scale finding (finding a page no longer requires scrolling 38 folds); all generate/review/publish/send flows unchanged.

### W2.B3 — Media containment + DOM diet (`canyon-containment-media`)
**Files:** `asset-manager-rebuilt/AssetManagerSurface.tsx`, `AssetGrid.tsx` (+ tests). **Contract:** grid contained under the existing toolbar; load-more batching (~100/batch, truthful remaining count); card DOM diet per the judge (the 1,583-button page is also a perf item — record before/after DOM counts in the PR); Repair/Upload/detail overlay precedence unchanged.

### W2.C1 — Requests inbox spine (`requests-inbox-spine`)
**Files:** `global-ops-rebuilt/RequestsLens.tsx` orbit; `RebuiltSidebar`/`navRegistry` (labeled nav home + badge — registry-driven per W0.3); the pending-replies count source (verify an existing endpoint/slice serves it — NEEDS_CONTEXT if a new server read is required, then add it through the proper route+slice pattern with broadcast both-halves). **Required reading:** journeys judge (Requests spine rec).
**Contract:** Requests gets a labeled sidebar home (D2 taxonomy); a truthful pending-replies badge on the nav item (and Cockpit "From client" rail count stays consistent — same source); landing defaults to the section with the newest unanswered item (or a recency-ordered union list); `?tab=` receivers unchanged.
**Tests:** badge renders from fixture count; landing-tab selection logic; nav registry census tests updated.

### W2.C2 — Keywords lens diet (`keywords-lens-diet`)
**Files:** `keywords-rebuilt/KeywordsLenses.tsx`, `KeywordsTable.tsx`, `useKeywordsSurfaceState.ts` (+ tests, + CT story caution — the jammy/ubuntu baseline trap: flag any CT diff to CI, never regen locally). **Required reading:** conventions judge (b) — validated against the code.
**Contract:** 5 lenses → 2 (Rankings, Lifecycle); Opportunities becomes a "Columns: Full | Triage" Segmented in the table toolbar (it is already only a column swap at `KeywordsTable.tsx:480`); Pages/Clusters become a Group-by control over the same rows; **all removed lens ids stay as `?lens=` compatibility receivers** mapping to the equivalent state (two-halves contract — senders exist in the wild); client-feedback panel surfaces above the table or as a counted badge; filter-chip row and URL state otherwise unchanged; document the lens retirement in the keywords parity contract.
**Tests:** legacy `?lens=opportunities` lands on Rankings+Triage columns; group-by renders cluster grouping; feedback panel reachable without scrolling past the table.

# Wave 3 — Capability restorations (parallel where disjoint; 4 PRs)

### W3.1 — AI-visibility flag-ON home (`ai-visibility-flag-on-home`)
**Files:** new lightweight rebuilt surface per the prototype nav's Search & Site Health zone (phase-a spec exists: `docs/ui-rebuild/phase-a/surfaces/ai-visibility.json` + ticket) — mount via one `REBUILT_SURFACES` entry + registry; reuse `useAiVisibility` + `AiVisibilityPanel` logic (port, don't fork); legacy KeywordHub mount stays (D8). **Default embedded decision (owner may veto at PR review):** dedicated lightweight surface (prototype-faithful) rather than a temporary Keywords mount.
**Contract:** share-of-voice, mention trend, source domains, and Refresh all reachable flag-ON exactly once; parity contract packet added per the registry rule ("one contract per surface before mounting"); route-removal checklist N/A (addition), nav census tests updated.
**Tests:** flag-transition real-hook mount test; refresh fires the existing job; exact-once capability assertions.

### W3.2 — Anomaly home per D5 (`anomaly-stream-flag-on-home`)
**Files:** `search-traffic-rebuilt` anomalies section (verify current state — the contract says anomalies exist there; extend to full parity with legacy AnomalyAlerts: severity chips, narratives, dismiss) + `cockpit-rebuilt` risk-stream pointer with truthful count (+ the work-queue classifier if counts flow from it — rebuild-audit noted `severity='positive'` mis-bucketing: fix it here). **Required reading:** rebuild audit B4 + cockpit surface-audit churn findings.
**Contract:** every legacy alert class has a provable flag-ON home in S&T; dismissal round-trips; Cockpit shows "N anomalies" linking to `analytics-hub` with the anomalies section focused (two-halves); positive-severity signals stop rendering under "Risk".
**Tests:** legacy-fixture alert set renders fully in S&T; dismiss persists; Cockpit count == S&T count (shared source per the rate-display rule); positive signal excluded from Risk stream.

### W3.3 — Site Audit per-page repair rows (`site-audit-per-page-repair-rows`)
**Files:** `SiteAuditSurface.tsx` drawer + `useSiteAuditRebuilt.ts` (+ tests). **Required reading:** rebuild-audit #14 validator note (legacy per-page row anatomy) + journeys J2.
**Contract:** the issue drawer offers per-instance action rows (Accept / Send to client / Add task for THAT page) or an explicit "Apply to all N" with a preview list and per-page results — restoring legacy `AuditIssueRow` capability depth; the #1566 scope-truth labels evolve to match the new reality; batch semantics stay filter-truthful; the "Accept all" informed-confirm from #1566 remains the model for any new bulk affordance.
**Tests:** per-page accept fires with that page's id; apply-to-all previews N and reports per-page outcomes; scope copy matches behavior (no regression of the sweep's truth fixes).

### W3.4 — SEO Editor depth bundle (`seo-editor` minors + unified send)
**Files:** `seo-editor-rebuilt/**` + `useSeoEditorRebuilt.ts`/CMS workflow hooks (+ tests). Roadmap: fold into the sprint via notes on existing items (source: rebuild-audit minors #8-#13 family + journeys J4).
**Contract:** unified selection-bar send — one "Send N to client" submitting both target types with an "N static · M CMS" breakdown (or a single labeled group if the two payloads can't merge server-side — NEEDS_CONTEXT to the orchestrator if so); restore per-field AI rewrite, CMS slug editing, and per-item approval history surfacing (the validated-minor relocations become first-class again); missing-metadata banner counts and Fix buttons operate on the same scope (rebuild-audit #12).
**Tests:** unified send submits both types once each; per-field rewrite calls the single-field endpoint; banner count == fixable set.

# Wave 4 — Big rocks per D6 (owner-scheduled blocks; multi-PR each)

### W4.1 — Book-level Cockpit at `/` (`book-level-cockpit`) — 3 PRs
(a) **Server rollup** — cross-workspace endpoint aggregating each workspace's existing work-queue classification + verdict inputs (reuse `server/domains/work-queue.ts`; new route + slice wiring per intelligence rules; WS events registered; attribution rules identical to per-workspace reads). (b) **Surface** — rebuilt Command Center: per-workspace verdict/stream cards ranked by attention, presence indicators, book totals where honest (no fabricated aggregates — "not yet reconcilable" stays truthful until (a) serves it); mounts via the shell for `/` (this closes the flag-ON dual-shell seam **without** touching flag-OFF legacy `/` — D8). (c) **Nav/journey integration** — Command Center breadcrumb root becomes a real destination; ⌘K + sidebar entries; morning-triage journey (J1) re-measured in the PR body.
**Gates:** phase-per-PR; (b) requires (a) merged; contract packet before (b) mounts; flag-transition tests; loaded-demo + multi-workspace smoke.

### W4.2 — Backend read models (DEF-kw-001..003 + GO-004) — 3 PRs
(a) **Keywords history-by-keyword read model** (batched row trends + 7-day deltas) and (b) **server-owned summary rollups/deltas** — per the deferred-ledger entries' own exit criteria; skinny-read contract preserved; Keywords UI lights sparklines/deltas only when served (no client-side fabrication — the audit's core principle). (c) **GO-004 Outcomes Book rollup** — real windowed value/clicks/wins with the same attribution rules; replaces the "Book totals are not yet available" banner and retires the "(all-time)/(28d)" header annotations from #1564 in favor of one truthful window; ledger entries flipped `scheduled→done` with roadmap links (satisfies the verifier obligations for these entries — the rest of the 89-entry ledger triage stays out of scope per D8's spirit, EXCEPT the small bookkeeping below).

### W4.3 — Ledger bookkeeping (small, required regardless of D8)
Triage only the entries whose `reviewBy` wall (2026-08-18) would start failing `verify:deferred-ledger` in CI: extend/reschedule with real roadmap links or retire, per the verifier's schema. No code. (This is CI hygiene, not retirement work.)

---

## Task dependencies

```
Sequential: W0.1 → W0.2 → W0.3 → W1.1 → W1.2 → W1.3
Then parallel (D7):
  Lane A: W2.A
  Lane B: W2.B1 → W2.B2 → W2.B3     (B2/B3 depend on B1's WorkbenchFrame)
  Lane C (first free lane): W2.C1 → W2.C2
Wave 3 (after Wave 2 merges; parallel by surface): W3.1 ∥ W3.2 ∥ W3.3 ∥ W3.4
Wave 4 (owner-scheduled): W4.1a → W4.1b → W4.1c ; W4.2a → W4.2b → W4.2c (W4.2 may run parallel to W4.1 — disjoint contexts) ; W4.3 anytime
Cross-wave hard edges: W0.3 before W1.2 (palette reads registry labels) and before W2.C1 (nav home uses registry).
Orchestrator pre-commits: ui/layout barrel export for WorkbenchFrame before Lane B dispatch.
```

## Systemic improvements
- **Shared:** `WorkbenchFrame` (W2.B1) — candidate for Search & Traffic/Media reuse and any future collection surface; budget-2's enforcement narrative points at it.
- **pr-check rules added:** actionless-EmptyState signal; nav-label-override ban (each with the 5 customCheck test obligations).
- **Docs:** `docs/rules/usability-budgets.md` (new, ratified); engine + keywords parity contracts updated where compositions change; ui-vocabulary/lexicon registrations per rename.
- **Measurement:** the UX-flow probe snippet is documented in the budgets doc as the standard fold/action audit method; W2/W4 PRs carry before/after probe numbers.

## Verification strategy (every PR)
`npm run typecheck` · `npx vite build` · full `npx vitest run` (single instance, orphan-purged; environmental file-fails re-proven at low concurrency) · `npm run pr-check` · `npm run lint:hooks` · flag-ON browser smoke of touched surfaces on Expero **and** (post-W0.1) `ws_demo_loaded`, with probe numbers for flow-touching PRs · CI red-inspection discipline before every merge (known flake classes: component-lane OOM, changes-gate checkout) · cross-model review findings fixed before push, never deferred.

## Estimated shape
~19 PRs: W0 ×3 · W1 ×3 · W2 ×6 · W3 ×4 · W4 ×3–6 (multi-PR rocks) + W4.3. At the demonstrated pipeline cadence, Waves 0–3 ≈ 4–6 autonomous runs; Wave 4 = two focused blocks. Campaign end state: every `admin-ux-flow-2026-07` item `done`, budgets enforced, **retirement-ready and deliberately unretired** (D8).

---
*Plan authored 2026-07-16 from the two same-day audits (evidence base above) and eight recorded owner decisions. Execution follows the debugged Sol pipeline (memory: codex-sol-handoff-pipeline). Advisory boundary: W2.A's contract-governance step and W3.1's embedded home decision are flagged for owner veto at PR review; the production flag flip is not part of this plan (D8).*
