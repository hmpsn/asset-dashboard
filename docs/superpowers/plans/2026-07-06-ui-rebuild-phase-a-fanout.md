# UI Rebuild — Phase A Admin Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans).
> This is a **program-level plan**: it fixes the wave graph, contracts, conventions, and the per-surface
> ticket-cut protocol. Per-surface implementation detail is deliberately NOT pre-baked here — it is cut
> at dispatch time from `docs/ui-rebuild/phase-a/surfaces/<surface>.json` (see Ticket-Cut Protocol).
> Execution platform: **Codex/OpenAI** (GPT-5.4-Mini / GPT-5.4 / GPT-5.5 ladder), controller = Claude.

**Goal:** Rebuild all 18 A-lane admin surfaces on the new design system behind `ui-rebuild-shell`, one surface per PR, at additive parity, using the proven Keywords-pilot template.

**Architecture:** Each surface mounts via a one-line `REBUILT_SURFACES` registry entry (`src/components/layout/rebuiltSurfaces.ts`) inside `RebuiltAppChrome`; legacy shell stays byte-identical when the flag is OFF. Shared server spine (verdicts, money-frame, per-page projections) lands before the surfaces that consume it.

**Tech stack:** React 19 + DS primitives (F3/F4) + FA Sharp Regular icons + React Query; Express/SQLite server tickets from `server-backlog.json`.

**Authority chain:** `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md` (ratified, wins all conflicts) → `owner-decisions.json` (AD-008…030 defaults, resolved at ticket-cut) → `surfaces/*.json` (verifier-adjusted) → this plan.

---

## Scope

**In (A-lane, behind `ui-rebuild-shell`):** cockpit, global-ops, engine (incl. the operator Insights-Engine half), search-traffic, performance, competitors, links, local-presence, asset-manager, brand-ai, page-rewriter, schema, seo-editor, site-audit, ai-visibility, content-pipeline, plus the admin/operator halves of insights and recommendations.

**Out (C-lane, per AD-005):** the client-facing halves of insights and recommendations, all client-inbox renderers, client portal read paths. These ride D4's C1→C2→C3 sequence on `strategy-the-issue` / `client-ia-v2` / `the-issue-client-*` flags. **Hard rule:** no A-lane PR may fork a shared client read path (public audit shape, `getContentPerformance`, public rec projection A1, analytics annotations, `schema_item`/`schema_plan` deliverables — all frozen).

**Deferred wholesale (AD-004):** every "graduate to Insights Engine" write (SB-001, SB-002, SB-021, SB-023, SB-061, and the per-surface graduation halves). Surfaces ship parity + a `DEF-*` ledger row. No ad-hoc graduation writes.

---

## Wave Graph

```
W0 (pre-fan-out, mostly parallel)          W0.1 discovery landed ✔ → W0.2 conventions ∥ W0.3 meeting-brief cut
                                           ∥ W0.4 ledger rows ∥ W0.5 API probes ∥ W0.6 ownership sheet ∥ W0.7 shell hook
W1 (server spine, parallel disjoint files) SB-003 ∥ SB-006+SB-038 ∥ SB-005 ∥ SB-026
W2 (leaf surfaces, 5 ∥ lanes)              search-traffic ∥ competitors ∥ asset-manager ∥ local-presence ∥ page-rewriter
W3 (receivers + platforms, 5 ∥ lanes)      performance ∥ links ∥ ai-visibility ∥ brand-ai ∥ schema
W4 (XL workhorses, 2 ∥ lanes)              content-pipeline ∥ seo-editor (D3: absorbs Page Intelligence)
W5 (consolidation hub, solo)               site-audit (3→1 both-readings; out-moves land here)
W6 (command centers, 3 ∥ lanes + prelude)  W6.0 shared contracts (co-* primitives + SB-004) → engine ∥ cockpit ∥ global-ops
Z  (Phase A closeout)                      holistic review → flag-mapping reconciliation → parity-ledger walk
```

**Why this order:** W2 surfaces have no inbound moves and validate the ticket-cut protocol cheaply. W3/W4 build every *receiving home* for site-audit's redistribution (AeoReview→ai-visibility, ContentDecay→content-pipeline, dead-links/Architecture→links, CWV detail→performance, Page Intelligence→seo-editor) so W5 consolidates into homes that already exist. W6 command centers consume everything (SB-004 streams, verdicts, roll-ups) and coordinate the engine↔cockpit zone claims, so they go last.

**Wave discipline:** phase-per-PR — one surface = one PR to `staging`; wave N+1 does not dispatch until wave N's PRs are merged and staging is green. Within a wave, lanes are parallel with exclusive file ownership. Ticket-cuts for wave N+1 may run while wave N builds (they are read-only).

**Sequencing rules (hard):**
1. Site-audit (W5) dispatches only after ai-visibility Q4 and content-pipeline Q6 receiving homes are DECIDED at those surfaces' ticket-cuts and their PRs are merged (ratified blocking-hole #3).
2. `?sub=content-decay` deep-link retargets in the SAME PR as the decay move (AD-013, two-halves contract).
3. seo-editor's ticket adopts site-audit's Page-Intelligence rows P1–P18 as acceptance criteria (site-audit Q11); Page `page-intelligence` retires via the route-removal checklist in the seo-editor PR.
4. W6.0 shared contracts (co-* layout primitives extracted to `src/components/ui/`, SB-004 stream model types in `shared/types/`) are committed BEFORE engine/cockpit/global-ops dispatch.
5. Frozen contracts no lane may alter: links snapshot shapes (intelligence slices), `checkSiteLinks` signature + `?tab=dead-links` aliases, `LocalSeoVisibilityPanel` props, route id `local-seo`, SEO-editor same-endpoint write-through, all C-lane public read paths above.

---

## Wave 0 — Pre-fan-out (dispatch immediately, parallel)

### W0.1 — Land discovery *(DONE — commit `8fd7d5c8c` on this branch)*

### W0.2 — Build Conventions doc (Model: GPT-5.4)
**Owns:** `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md` (create)
One doc every ticket-cut cites. Contents, each with a code-level pattern reference:
- **Freshness + Refresh** (AD-001): "last updated" meta + manual Refresh with honest copy, uniform on cockpit, ai-visibility, competitors, links, local-presence, performance, site-audit, asset-manager. Scheduled/cron scanning = separate per-surface flagged follow-ups.
- **Verdict headlines** (AD-002): server-drafted fields only, never client-composed. Names the SB-006/SB-038 fields.
- **Money-frame + basis pill** (AD-003): cron-precomputed dollars, `estimate/measured/actual` pill, never compute-on-render.
- **429/quota state** (AD-020): disabled AI actions + quota tooltip + first-429 dismissible banner; bulk streams show partial-run tally.
- **Score authority** (AD-016): every displayed score/coverage/share metric is server-computed and shared; a second client heuristic is a trust landmine. Explicit denominators.
- **Honest-absence** (AD-026): sparklines/trends only from real sources; absent state otherwise, never fabricated series.
- **Structural template from the pilot:** KPI tiles above Toolbar, SectionCard wrapper around DataTable, PageHeader eyebrow, `overflow-x-auto` table container, sticky bulk-action bar at `--z-dropdown`, sidebar rail collapse, `?tab=` receiver + contract test, `@ds-rebuilt` marker, DEF-* ledger discipline, flag-transition component test with **seeded QueryClient** (`queryClient.setQueryData(queryKeys.shared.featureFlags(), …)` — the #1485 pattern), flag-ON real-render smoke recipe (env flag + live DB path).
- **T1 carry-over-then-reskin** (AD-010): machinery-dense subsystems mount as token-restyled Drawers/drill-ins; no redesigns in the rebuild.

### W0.3 — Meeting Brief cut-ticket PR (Model: GPT-5.4)
**Owns:** `src/routes.ts`, `src/App.tsx`, `src/lib/navRegistry.tsx`, deep-link sender call sites, `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` (create), Parity Ledger row
Owner-ratified retirement (2026-07-05). Follow `docs/rules/route-removal-checklist.md` for Page `brief`: routes.ts union, App.tsx mount, navRegistry entry, all navigation-literal senders (grep `'brief'` / `meeting-brief` — it was one of the 12+ keyword-hub senders), nav/deep-link contract tests, `?tab=meeting-brief` receiver (cockpit surface JSON row 4). Seed `D8_REDIRECT_MAP.md` with its first entry (`brief` → `home`). Correct the misattributed Parity Ledger row to "retired by owner 2026-07-05". Full gates + full vitest (route-census tests will assert).

### W0.4 — Missing Parity Ledger rows (Model: GPT-5.4-Mini; owner signs)
**Owns:** the Parity Ledger doc only
Add "Workspace Home → Cockpit (+Today)" + one row per Global-Ops page (12+ from the 9-lens composition; enumerate from `surfaces/global-ops.json`), each marked `build-or-cut: TBD@W6 ticket-cut`. Nothing silently dropped (AD-007).

### W0.5 — Provider payload probes (Model: GPT-5.4)
**Owns:** `docs/ui-rebuild/phase-a/probes.md` (create; results only, no code)
One live call each, recorded verbatim: (a) Webflow v2 list-assets — does the payload carry width/height? → commits SB-022/sn-asset-manager-1 effort (S if yes, M+ if N+1 probing needed); (b) DataForSEO — domain-rank + top-3 availability → commits SB-019/sn-competitors-1 effort. Use existing provider credentials via a scratch script; do NOT commit the script.

### W0.6 — Cross-surface ownership sheet (Model: GPT-5.5; owner walks once)
**Owns:** `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md` (create)
One page the owner ratifies in a single sitting, pre-filled with defaults:
| Contested item | Default to ratify |
|---|---|
| InsightsEngine rec-set mount (insights↔recommendations B1) | engine owns the operator mount; recommendations admin desk links to it |
| Branded-demand split (ai-visibility Q10 vs search-traffic) | ai-visibility owns; search-traffic links |
| AnomalyAlerts (search-traffic vs cockpit) | search-traffic keeps; cockpit consumes via hand-off card |
| Insight-feed home (insights Q6 / search-traffic I1–I6) | operator Insights Engine (engine surface) is the 21-type feed home |
| Competitor-set editing | Workspace Settings single home (AD-014 default) |
| Brand-AI Page Strategy / Copy Pipeline destination | stay as T1 drill-ins on brand-ai now; content-pipeline relocation = C3-later ticket |
| Diagnostics fate | keep nav entry + reports-list lens (AD-022 default) |
| Meeting Brief | retired (already ratified; listed for completeness) |
Also restates the frozen-contracts list (Sequencing rule 5) so every ticket-cut cites one source.

### W0.7 — AppShell focus-mode hook (Model: GPT-5.4)
**Owns:** `src/components/ui/layout/AppShell.tsx` (+ its tests)
page-rewriter (W2) needs rail-collapse + Esc focus mode; AppShell is frozen post-F3, so this is the one sanctioned extension: a controlled `focusMode` prop (rail collapses, Esc exits), additive and default-off, with component tests (a11y + keyboard). Because AppShell is shared, this is a SEQUENTIAL task — no other lane touches AppShell in W0–W2.

---

## Wave 1 — Server spine (parallel; disjoint files; server-only PRs)

All four land before W2 dispatch. Contracts (shared/types fields + Zod schemas) are committed by the controller FIRST, then lanes implement. Each PR: integration tests on the real read path, `broadcastToWorkspace` + `useWorkspaceEvents` wiring deferred to the consuming surface PR (no dark broadcasts), route read/write contract annotations.

| Task | Backlog | Model | Owns (primary) | Contract to pin |
|---|---|---|---|---|
| W1.1 Money-frame projection | SB-003 (M, AD-003) | GPT-5.5 (cross-context: cron + outcomes) | `server/outcome-tracking.ts` adjacents, new cron in `cron-registry.ts`, `shared/types/outcome-tracking.ts` | `valueAtStake` / `recoveredSoFar` + `basis: 'estimate'\|'measured'\|'actual'` — cron-precomputed, read-only at render |
| W1.2 Verdict fields | SB-006 (S) + SB-038 (S) (AD-002) | GPT-5.4 | performance/content verdict projections + strategy-POV payload | `verdict: 'win'\|'early'\|'flat'` from outcome vocab; `verdictHeadline: string` server-templated |
| W1.3 Per-page projection | SB-005 (M) | GPT-5.4 | page-row payload assemblers (`server/` page-intelligence/keyword joins) | keyword/rank/traffic/optimization-score fields on page rows — single query join, NO N-per-row fan-out |
| W1.4 Webflow redirect-create | SB-026 (M) | GPT-5.4 | Webflow provider + `server/routes/` links/seo-editor seam | fixes the orphaned `redirects.save` wrappers; FM-2 error test mandatory |

SB-004 (work-queue classification, L) deliberately rides W6.0, per the ratified note — its only consumers are cockpit + global-ops.

---

## Waves 2–6 — Surface fan-out

### The Ticket-Cut Protocol (applies to every surface)

For each surface, **before dispatch**, a ticket-cut task (Model: **GPT-5.5**) produces `docs/ui-rebuild/phase-a/tickets/<surface>.md`:

1. Read, in order: `PHASE_A_DECISIONS.md` → `CROSS_SURFACE_CONTRACTS.md` → `BUILD_CONVENTIONS.md` → `surfaces/<surface>.json` (**verifier-adjusted homes only** — standing instruction #1; the six known corrections are listed in PHASE_A_DECISIONS.md) → the surface's `owner-decisions.json` AD rows → its `server-backlog.json` rows.
2. Resolve every `per-surface-dispatch` decision by ADOPTING the proposedDefault. Any deviation, and any `needsOwner:true` question whose default feels wrong on the ground, goes in a **"⚠ Owner deltas"** section at the top of the ticket — the owner reviews only that section before dispatch.
3. Emit: capability checklist (every ui-only row = acceptance criterion), server tickets consumed (which SB-* rows ride in this PR vs are deferred with a DEF-* row), deep-link receiver matrix (`?tab=`/`?sub=`/fixContext senders that must survive — each becomes a contract-test assertion), flag disposition rows (from the mapping below), file-ownership block, and D8 redirect-map entries.
4. Ticket-cuts for a wave run in parallel while the previous wave builds.

### The Build Task template (applies to every surface)

Model: **GPT-5.4** (XL surfaces split into 2–3 sub-tasks with internal file ownership, still one PR). Each lane:

**Owns:** `src/components/<surface>-rebuilt/**` (create), `src/hooks/admin/use<Surface>Rebuilt*.ts` (create), its component tests, its ticket's server files (if any SB-* rides along), its D8/ledger/roadmap rows.
**Shared-file seam (controller-applied or last-commit-in-lane, one line each):** `rebuiltSurfaces.ts` registry entry (`lazyWithRetry`, uniform `{ workspaceId }` prop), `navRegistry.tsx` label changes, `data/ui-rebuild-deferred-ledger.json` rows.
**Must not touch:** other lanes' directories, `AppShell.tsx`, legacy surface components (flag-OFF path stays byte-identical), frozen contracts (rule 5), C-lane read paths.

Standard steps (each PR):
1. Read the real legacy component + ticket. 2. Write failing component tests from the ticket's acceptance criteria (incl. the flag-transition test with seeded QueryClient and the `?tab=` receiver contract test) and RUN them red. 3. Build with DS primitives (`@ds-rebuilt`), React Query hooks, `<Icon name>` FA keys. 4. Green + full local gates. 5. Flag-ON real-render smoke with realistic data (preview tools; pilot's env-flag mechanism) — **mandatory before PR** (CLAUDE.md UI rule 13). 6. PR to staging with the ticket linked; merge on full green.

### Wave-by-wave notes (beyond the template)

- **W2 search-traffic (L):** AnnotatedTrendChart is T1 carry-over-then-reskin — a static chart is a parity failure. SB-012 GSC prior-period series rides along (sn-search-traffic-1) for the comparison overlay; annotations bridge (`ANNOTATION_BRIDGE_CREATED`) untouched.
- **W2 competitors (M):** read-only FilterChips + Edit-set routing to Workspace Settings (AD-014); SB-019/SB-020 fields ride if W0.5 probe confirmed; keyword actions route through Keyword Hub single-writer.
- **W2 asset-manager (L):** SB-022 (w×h) rides per probe; CMS field selector ships at launch or CMS-aware compression defers with it (AD-019); compression graduation = DEF row (AD-004).
- **W2 local-presence (L):** geo-grid + GBP Performance deferred (AD-025, DEF rows); posture grid + map-pack SoV (SB-019 half) on real data; Verified badge suppressed; declined/cancelled rendered, reopen-for-edits deferred (AD-024 — approved→draft is illegal in state-machines.ts today); route id `local-seo` frozen; 4 GBP flags stay lifecycle-governed.
- **W2 page-rewriter (M):** export-only v1 (AD-017); SB-031/SB-032 deferred behind flag as owner-signed follow-up; uses W0.7 focusMode.
- **W3 performance (M):** consumes W1.2 verdicts + SB-024 (Lighthouse extra categories) + SB-008 lift if cut in; Content-Perf fold decision lands HERE but the Page `content-perf` retirement executes in the content-pipeline PR (W4) that absorbs the Published tab — coordinate via ticket cross-reference.
- **W3 links (L):** restore chains panel + all-pages status table as GroupBlocks (AD-027 — else SeoAudit's deep-link breaks); `bestScore` exposed as "match", never an AI-confidence %; SB-025/SB-027 ride; sync-scan→background-job (SB-045) = DEF row.
- **W3 ai-visibility (M):** single-engine honest aggregates (AD-009); SB-009 readiness projection + SB-051 composite score ride; Q4 AeoReview drill-in home DECIDED at this ticket-cut (gates W5).
- **W3 brand-ai (XL):** multi-script API behind single-script UI (AD-021); voice calibration / Page Strategy / Copy Pipeline as T1 drill-ins (AD-010 + W0.6); SB-017 rides; founder-interview/KB-regen/parsing (SB-034–036) deferred; 4 external `&focus=` senders must survive (contract-test each).
- **W3 schema (XL):** SB-009 coverage metric (single definition, AD-016) + SB-011 missing-schema producer ride (note: `missing_schema`/`schema_errors` check-ids have NO server producer today — sn-schema-2 fixes the wiring, detection only, no graduation per AD-004); Site Plan subsystem = T1 drill-in; client `schema_item`/`schema_plan` deliverables untouched.
- **W4 content-pipeline (XL):** stage model = derived view over existing statuses through `validateTransition` (AD-012 default) — the ONE textually-blocking question, resolved at ticket-cut; absorbs Content Perf Published tab (SB-007/SB-008 consumers); Content Health becomes the acting decay home with the `?sub=content-decay` retarget in the SAME PR (AD-013); SB-046–050 mostly DEF rows; legacy aliases (content/calendar/seo-briefs/subscriptions) resolve via D8 + contract test.
- **W4 seo-editor (XL):** D3 locked — Page Intelligence folds into Research mode; adopts P1–P18 as acceptance criteria; keeps HEAD 7-state client-approval machine, rejects admin bulk-Approve (AD-018); H1/slug writes read-only v1 (AD-017; SB-028 rides, SB-029/030 deferred); same-endpoint write-through frozen; route-removal checklist for `page-intelligence`.
- **W5 site-audit (L):** both-readings 3→1 (ratified): absorbs Performance-triage + Links-triage as categories AND ships the out-moves (AeoReview→ai-visibility, Content Health→pipeline) into the now-existing homes; SB-010 per-category scores + 6-cat taxonomy remap ride — taxonomy touches the client HealthTab read path, so the shared shape is versioned additively, never forked; every move gets a D8 entry; all fixContext receivers re-accept (contract tests).
- **W6.0 shared contracts (sequential, Model GPT-5.5):** extract cockpit/global-ops `co-*` layout primitives into `src/components/ui/` (port, don't copy), commit SB-004 stream-model types + server classification, SB-013 roll-up endpoint contracts. THEN dispatch:
- **W6 engine (XL):** money-frame (W1.1) + verdict headline (W1.2) consumers; owns the operator Insights Engine (feed home per W0.6); retires `strategy-command-center` (UI-shell flag) via the full retirement template; curation machinery = T1 drill-ins; SB-039 preview deferred.
- **W6 cockpit (XL):** Page `home` in place (navRegistry Home→Cockpit); claims OrientZone/QuickWins/NeedsAttention from engine per W6.0 contracts; SB-004 + verdict + money-frame consumers; health score KEPT with chip derived from it (AD-015); ~15-event wsInvalidation fan-out re-wired; promote-to-signal = DEF row (AD-004/AD-023).
- **W6 global-ops (XL):** 12+ pages per W0.4 ledger rows (build-or-cut resolved at ticket-cut); SB-013 roll-ups + attribution-honesty exclusions on every value read; workspace archive (SB-043) rides; tz/locale (SB-044) deferred; business 4→1 consolidation via D8.

---

## Flag Disposition Mapping (AD-006 — the authoritative enumeration)

| Flag | Disposition |
|---|---|
| `ui-rebuild-shell` | A-lane master gate. Retires at Z-phase only, after all 18 surfaces + legacy shell deletion. |
| `strategy-command-center` | UI-shell flag → **rebuild retirement track**; retired by the W6 engine PR (full template: OFF-branch delete → catalogs → RETIRED_FLAG_GROUPS → override-cleanup migration → test greps). |
| `strategy-divergence-sweep`, `strategy-keywords-managed-set`, `strategy-signal-fold` | Behavior/backend gates — lifecycle-governed; disposition reviewed at the engine ticket-cut, NOT auto-retired. |
| `strategy-the-issue`, `strategy-competitor-send`, `client-ia-v2`, `the-issue-client-spine`, `the-issue-client-measured-capture`, `the-issue-client-return-hook`, `the-issue-client-next-bets`, `client-briefing-v2`, `client-briefing-v2-ai-polish`, `client-work-feed` | C-lane / client gates — untouched by Phase A; lifecycle-governed. |
| `local-gbp`, `gbp-auth-connection`, `gbp-auth-reviews`, `gbp-review-responses` | Backend integration gates — lifecycle-governed; reviewed at the local-presence ticket-cut, not retired by the rebuild. |
| `national-serp-tracking` | Backend data gate — lifecycle-governed. |
| `strategy-trust-ladder-autosend` | PERMANENTLY_EXEMPT safety gate — never retired. |

No surface retires a flag outside this table.

---

## Bounded Context & Contracts (per PLAN_WRITING_GUIDE §2)

- **Owning contexts:** per surface, named in each ticket (from `docs/rules/platform-organization.md`); the fan-out itself owns `src/components/layout/rebuiltSurfaces.ts` + `docs/ui-rebuild/phase-a/**`.
- **Work class:** behavior-preserving re-render (additive parity) + scoped new server behavior (W1 + ride-along SB rows).
- **Route/API:** no route renames except the enumerated retirements (`brief` W0.3, `page-intelligence` W4, `content-perf` W4, business 4→1 W6) — each via route-removal checklist + D8.
- **React Query:** new hooks under `src/hooks/admin/`, keys via `queryKeys.*`; every consumed workspace-scoped WS event gets a `useWorkspaceEvents` invalidation in the same PR (both halves).
- **Cross-phase contracts doc:** `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md` (W0.6), updated as waves complete.

## Systemic Improvements

- **Shared utilities:** freshness/refresh Toolbar slot primitive (W0.2 → first consumer W2 extracts it into `ui/`), quota-429 banner pattern, verdict-headline renderer, co-* layout primitives (W6.0).
- **pr-check rules to add (W2, after first proof):** (a) `REBUILT_SURFACES` entries must use `lazyWithRetry`; (b) a `@ds-rebuilt` surface directory must have a matching flag-transition test file; (c) client read-path freeze grep for the shapes in rule 5 (custom check, warn-level).
- **New tests:** per-surface contract tests for every deep-link receiver row in the ticket matrix; REBUILT_SURFACES census test (every registry key is a valid `Page` with a mounted lazy import).
- **Feature-class DoD:** admin-CRUD/analytics golden paths per `docs/workflows/platform-golden-paths.md`; each PR walks `docs/workflows/pr-readiness-checklist.md`.

## Verification Strategy

Per PR: `npm run typecheck && npx vite build && npx vitest run` (FULL suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` (baseline updated surgically, never `--update` wholesale) + `npm run verify:deferred-ledger` + flag-ON preview smoke (screenshot in PR). CT baselines only where a surface adds a matrix spec — generate in jammy Docker (dimensions match ubuntu; the 0.03 maxDiffPixelRatio absorbs AA).
Per wave: controller diff review (duplicate imports, conflicting edits), `scaled-code-review` (multi-agent waves — mandatory per CLAUDE.md), fix all findings in-wave.
Phase end (Z): holistic end-to-end review across all 18 surfaces (the fixture-masked-bug catcher), flag-mapping reconciliation, parity-ledger walk (every row built/cut/deferred with a ticket), `npm run verify:feature-flags` + `verify:coverage-ratchet`.

## Docs & tracking (every PR)

FEATURE_AUDIT.md entry, `data/roadmap.json` note, BRAND_DESIGN_LANGUAGE.md if patterns changed, DEF-* rows in the same PR as their trade-off, D8_REDIRECT_MAP.md for any route/tab move.
