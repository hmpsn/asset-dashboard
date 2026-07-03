# UI Rebuild — Implementation Strategy (Phase 0 closeout)

> Implementation Strategist output, branch `ui-rebuild-phase-0` (== post-Reconcile `origin/staging` HEAD), 2026-07-03.
> Inputs: 20 surface ledgers (`docs/ui-rebuild/phase0/surfaces/`), 4 cross-cutting audits (`cross-*.md`), design review (`design-review/`), the UI Rebuild Handoff Brief + kit `CLAUDE.md` sequence, and the Parallelization Map's governing principle ("parallelize the audit aggressively; parallelize execution conservatively").
> Evidence base: 396 at-risk claims verified, 0 refuted; ~700 capabilities cataloged across 20 surfaces; ~150 stop-and-ask questions raised.

> **Amendments since Phase 0 sign-off** (read these before building — they supersede the tables below):
> - **D5 REVERSED → Font Awesome Sharp Regular** (owner, 2026-07-03). The icon system of record is now self-hosted FA Sharp Regular (`public/vendor/fontawesome/` + `public/fonts/`). Use `<Icon name="…">` (semantic keys in `src/components/ui/iconNames.ts` → `fa-sharp fa-regular fa-…`); never hard-code `fa-` at call sites. **lucide-react is now only the `<Icon as={…}>` migration bridge** for not-yet-rebuilt surfaces (~381 sites migrate incrementally). The `ds-icon-discipline` gate now **allows** `fa-*` and flags only emoji-as-icon. This supersedes every "lucide" statement in the D5 rows and cross-doc icon sections below. Canonical: `PHASE_D_DECISIONS.md` D5 + PR #1475.
> - **Phase F3 shipped** — the 18 net-new primitives (Drawer, DataTable, MetricTile, Sparkline, Meter, KeyValueRow, BoardColumn, Avatar, IntentTag, Segmented, LensSwitcher, FilterChip, SearchField, RadioGroup, AppShell, PageContainer, Toolbar, GroupBlock) are in `src/components/ui/` (PR #1474; see the CLAUDE.md primitive list). `AppShell`'s `sidebar`/`topbar`/`rail` slots are the frozen F4 nav-wiring surface.
> - **DS harness** (`/__ds-harness`, dev-only) is the interaction **behavior bench** (overlays + form controls + nav) for hand-verifying real keyboard/focus behavior; the styleguide stays the **appearance** reference (PR #1476).

---

## 0. The shape of the problem (what the audits proved)

Three facts drive every choice below:

1. **The kit is a typed visual spec, not a drop-in library.** All 53 `.jsx` are inline-style, `className`-less prototypes mounted via a window-global Babel bundle; HEAD's same-named primitives are prop **supersets**; ~16 components are net-new construction; 21 referenced tokens don't exist at HEAD; kit overlays fail the kit's own a11y gates (`cross-design-system.md` §1–4). There is a real, unbudgeted construction phase before any surface can be assembled.
2. **The parity floor is enormous and concrete.** ~700 cataloged capabilities, 396 verified at-risk. The dominant quick-win pattern across all 20 ledgers is the same move: *mount the existing HEAD component wholesale inside the new shell, restyle later*. That pattern loses zero capability and is the mandate-safest default (e.g. Keywords drawer, InsightsEngine action plan, UnifiedInbox, SchemaPlanPanel, VoiceTab, PostEditor, MeetingBriefPage, RequestManager, OutcomeDashboard).
3. **A small set of unresolved owner decisions gates everything.** Page Intelligence has three conflicting homes inside the kit itself (`cross-platform.md` Q1); the client dashboard has four conflicting IAs plus the kit's own audit saying "don't redesign" (`cross-client-dashboard.md`); the rebuild root path gates the entire mechanized enforcement layer (`cross-consistency.md` §7 Q1). Building before these are answered is rework by construction.

---

## 1. Build sequence

Respects the kit sequence (Phase 0 gate → data-source ledgers → pilot Keywords → fan out → gate every surface), CLAUDE.md phase-per-PR + staging-first, and the dependency evidence. Model ladder per CLAUDE.md: Haiku for mechanical ports, Sonnet for implementation with local judgment, Opus for cross-context/review seats.

### Phase D — Decision batch (owner, ~1 sitting; blocks everything)

Consolidate the ~150 stop-and-asks into one triage doc with two tiers:

**Tier 1 — blocking (must be answered before Phase F):**
| # | Decision | Source | Default recommendation |
|---|---|---|---|
| D1 | Integration path = **Option C** (port/merge under HEAD conventions; kit `.d.ts` = prop floor, HEAD props always win) | cross-design-system §2, §6 Q1 | Approve C; A/B rejected |
| D2 | Rebuild root path (in-place-behind-flags vs new dir) — gates every scoped lint/pr-check rule | cross-consistency §7 Q1 | In-place per owner's incremental-behind-flags direction, with a per-file `@ds-rebuilt` marker (or file manifest) as the rule scope |
| D3 | Page Intelligence's single home (SEO Editor Research mode vs Keywords) | cross-platform Q1 | Ledger says SEO Editor; confirm — this is the pilot's scope boundary |
| D4 | Client dashboard gate = **Option C** (finish cutover → re-skin ratified 4-tab IA → additive portal ideas) + Q2–Q7 sign-offs | cross-client-dashboard §5 | Approve C |
| D5 | Icon system: lucide-react (HEAD, hundreds of call sites, kit leaf `.d.ts` already lucide-shaped) vs Font Awesome (kit readme, paid external script) | cross-design-system §6 Q3, cross-platform Q8 | ~~lucide; restyle kit `Icon`/`ICON_NAMES` onto lucide names~~ **REVERSED → Font Awesome Sharp Regular, self-hosted (see Amendments above + PHASE_D_DECISIONS D5).** |
| D6 | Canonical action-color word: "mint" vs "teal" (same hex) | cross-design-system §6 Q2 | Pick one; update CLAUDE.md/BRAND_DESIGN_LANGUAGE/pr-check messages in the tokens PR |
| D7 | Rule severity on rebuild-scoped code: error from day one | cross-consistency §7 Q3 | Approve error-severity (nothing exists to backfill) |
| D8 | URL scheme + redirect map policy for consolidated surfaces (`/business`, `aivis`, cockpit-vs-home, book views) | cross-platform Q5 | Redirect map is a required deliverable per consolidation, per route-removal checklist |

**Tier 2 — deferred to ticket-writing time:** everything else (per-surface stop-and-asks, Badge purple/tone, shadow dedup, mono font, noise overlay, theme-toggle unification, Diagnostics nav entry, Inbox scope, book-zone rail presence, new devDeps for axe). Each surface ticket lists its own unresolved questions as blockers-at-dispatch, not blockers-now.

### Phase F — Foundations (sequential spine, one owner; ~3 PRs)

Nothing surface-shaped lands before these. This is the construction cost the Handoff Brief understates ("the pieces are done" is true only as specs — cross-design-system §2 bottom line).

1. **F1 — Tokens PR** (one PR, single author): add the 21+ missing token families (`--font-*`, `--type-*`, `--space-*`, layout, motion, `--shadow-*`) to `src/tokens.css` in **both** `:root` and `.dashboard-light` scopes; keep HEAD-only tokens (`--z-commerce-*`, `--z-client-toast`, `--brand-shadow-*`); let `copyTokensPlugin()` mirror; update styleguide per pr-check parity rules; keep `.t-*` HEAD behavior (no baked colors, keep `tabular-nums`), add `.eyebrow`. (cross-design-system §3.3)
2. **F2 — Gates PR(s)**: seed the consistency machinery (§4 below) against the kit Reference Screen *before* real surfaces land, per kit CLAUDE.md Process. Includes the deferred-ledger file + verifier (§3).
3. **F3 — Net-new primitives** (parallelizable after F1; 2–3 agents, exclusive file ownership, pre-committed prop contracts): the ~16 files/19 names (Drawer, DataTable, LensSwitcher, MetricTile, Toast, AppShell, PageContainer, Toolbar, Segmented, FilterChip, SearchField, Avatar, Meter, Sparkline, KeyValueRow/DefinitionList, GroupBlock, IntentTag, BoardColumn, RadioGroup) built production-grade in `src/components/ui/`: TS + `className` + tokens, kit `.jsx` as pixel spec, kit `.d.ts` as prop floor, HEAD overlay focus-trap/portal/reduced-motion machinery, `var(--z-*)` only. (cross-design-system §4.3)
4. **F4 — Shell PR**: AppShell/PageContainer/Sidebar/NavItem/NavGroup/Breadcrumb/Toolbar wired to the existing `navRegistry.tsx` single source (port `needsSite` gating + `NavFlagBehavior`; the prototype has neither). No nav *content* changes yet — the redirect map (D8) lands with each consolidation, not here.
5. **F5 (rolling) — HEAD-primitive fold-in**: the ~27 uncovered HEAD primitives (ErrorState, TierGate, ConfirmDialog, DateRangeSelector, ChartCard, Menu, typography set, helper suites, client inbox set) get restyled on-system **demand-driven** as surfaces need them — each is a system addition PR, never a per-screen fork.

### Phase P — Pilot: Keywords end-to-end (sequential, one team)

Data-source ledger → build → every gate green → PR, exactly per the kit. The pilot deliberately carries the hard cases: the 2→1 merge, the D3 boundary, the LensSwitcher/Drawer/DataTable net-new primitives, the first deferred-ledger entries (2-of-5 lenses, drawer carry-over), and the first full run of the snapshot matrix + adherence lint. **Success criterion: every AUTO gate fired at least once and every ledger row for `surfaces/keywords.md` is marked.** Budget slack here — the pilot's job is to find the gaps in F1–F4 before 17 surfaces inherit them.

### Phase A — Admin fan-out (parallel lanes, phase-per-PR, staging-first)

Lane groupings chosen by coupling (deep-links, shared numbers, shared spines), not by rail group. Within a lane: sequential or tightly coordinated. Across lanes: parallel. **Shared "barrier files" (`src/routes.ts`, `src/lib/navRegistry.tsx`, `src/tokens.css`, `src/lib/wsInvalidation.ts`, `src/lib/queryKeys.ts`, `shared/types/*`) merge serially through one owner** — the Reconcile migration-gate pattern applied to the frontend (Parallelization Map C1/C2).

| Lane | Surfaces (order within lane) | Why grouped |
|---|---|---|
| **A1 — Analytics (read-mostly)** | Search & Traffic → Performance (+content-perf coordination) → Competitors → AI Visibility | Independent data reads; lowest coupling; good early throughput. S&T interactions (sortable tables, annotations, chart toggles) are parity, not polish — same phase. |
| **A2 — Site health cluster** | Site Audit → Links → Asset Manager → Schema | Coupled by deep-links (audit→links dead-links `?tab=`, audit→media `?filter=`), the shared coverage number (schema/audit — define once, server-side), and the SiteArchitecture route move. One lane owner holds the redirect map. |
| **A3 — Content cluster** | Content Pipeline → SEO Editor (incl. the D3 Page Intelligence merge) → Page Rewriter → Brand & AI | Coupled by pipeline hand-offs (brief/draft workspaces, rewrite→draft, blueprint/copy pipeline relocation). Heaviest carry-over lane (PostEditor, MatrixGrid, VoiceTab). |
| **A4 — Command spine** | Cockpit → Insights Engine → Recommendations (admin) → Insights delivery → Local Presence | Coupled by the graduation/curation model (streams, promote-to-signal, staged client story) and the strategy flag family. Resolve `strategy-signal-fold` before building the signals panel (build-once rule from the engine ledger). |
| **A5 — Global & ops** | Roadmap (near-1:1) → Settings → Business (4→1) → Workspace Settings (new shell + legacy route mounted for unported tabs) → Outcomes → Requests/Inbox → Diagnostics → Meeting Brief port → Onboard | Mostly self-contained; several near-parity ports make this the flexible-capacity lane. Requests scope change (cross-platform Q4) and Diagnostics home (Q2) are dispatch blockers for those two tickets only. |

Cadence: consistency sweep every 3 merged surfaces; phase-gate holistic review + flag-ON browser smoke when a lane completes (§4.2). Lane count sized to the real ceiling — the solo owner's review capacity (Parallelization Map C3) — start with 2 concurrent lanes, widen only if the review queue stays empty.

### Phase C — Client-facing (gated on D4; partially parallel with Phase A)

1. **C1 — Cutover (can start immediately after D4, independent of the DS work):** staging flag-ON validation → global flip of `client-ia-v2` + Issue flags → retire the legacy nav branch + the 3 flag-read forks (CL1) → ROI→Results merge (CL2, pending Q6) → orphan deletion (CL3–CL5). Mostly deletion; parity by construction. Doing this early means the re-skin targets ONE IA.
2. **C2 — Re-skin the ratified 4-tab shell** with the design system (1 of the 18 surfaces; wiring already exists). Client portal admin surface (`portal`) and client Recommendations feed build here, honoring the recommendations ledger's parity floor (keep InsightsEngine action plan mounted; keep TierGate mirror on the act-on path; Discuss stays a no-write advisor seed until the owner scopes the public write).
3. **C3 — Additive portal ideas**, each its own flagged phase-per-PR increment (return-hook on-dashboard band, operator-staged value band, send-boundary model **only if** owner scopes it in via Q4 — it is a product change, not a re-skin).

### Phase Z — Consolidation closeout

Per-surface retirement of the ~253-rule `.dashboard-light` compat layer; route/flag retirement per lifecycle docs; full deferred-ledger walk; final whole-arc holistic review + evaluative persona audits on client-facing surfaces; promote any remaining warn-level rules to error.

---

## 2. Top trade-offs (quick win now / upgrade later)

These feed the deferred ledger (§3): each carried decision becomes a `DEF-*` entry in the PR that ships it, with the upgrade trigger below as its `upgradeTrigger`. The full per-surface list lives in the ledgers + `gapfill-args-base.json`; these are the consequential ones.

| # | Item | Quick win (ship now) | Full version (later) | Recommendation | Upgrade trigger |
|---|---|---|---|---|---|
| T1 | **Carry-over-then-reskin** (the recurring pattern: UnifiedInbox, InsightsEngine action plan, KeywordDetailDrawer content, PostEditor, MatrixGrid, SchemaPlanPanel, VoiceTab, MeetingBriefPage, RequestManager, OutcomeDashboard, StrategyCockpit verbs) | Mount the HEAD component wholesale inside the new shell, tokens-only restyle where cheap | Native rebuild on the design system per component | **Adopt as the default policy** for machinery-dense components — zero capability loss, visual inconsistency only | Per-component: when its lane's consistency sweep schedules the re-skin AND the DS covers its primitives; ledger `reviewBy` forces the review |
| T2 | Keywords lens model | Rankings + Opportunities lenses only; HEAD segments as FilterChips | All 5 lenses incl. Pages/Clusters grouped reads + Lifecycle kanban | Quick win for the pilot | Owner approves the stage taxonomy (stop-and-ask) + the rows read-model extension ticket lands |
| T3 | Money/verdict figures (Cockpit provenance chips, Engine money frame, Performance win/early/flat, content-perf verdicts) | — | Server-computed fields with provenance pills (Reconcile already persists provenance) | **Take the full version — do NOT quick-win money.** Client-side heuristics violate the display-only law and are trust landmines | Blocking: no money/verdict number ships client-facing without a server field + basis pill |
| T4 | Search & Traffic interactivity (sortable tables, click-to-annotate, chart toggles, insight badges) | Static charts/tables | Full interaction set | **Not a valid quick win** — these are daily-use parity (the ledger marks static-only a regression). Date presets ship full sets day one | N/A — same phase as the surface |
| T5 | Schema publish safety | Keep HEAD's validation-gate + confirm + retract + history; mockup's one-click publish rejected | Add diff view, JSON editor, per-field findings on the new surface | Keep HEAD rails; CMS publish must ship in the same release train as static publish or CMS-page sites lose all publish capability | Diff/editor: schema lane's second pass. CMS: hard-coupled to the surface PR train |
| T6 | Site Audit issue-first pivot + 6-category model | Keep HEAD's page-first list + 5 categories, DS-restyled | Issue-type-first triage + server-side 6-category mapping | Quick win — the pivot is a data+UX ticket touching suppressions/exports/client HealthTab | Post-fan-out UX wave, after the category-mapping data ticket is scoped |
| T7 | Links/Asset scan execution | Keep synchronous scans + existing NDJSON/bulk-job wiring | Migrate scans + bulk alt-text to the background-job platform | Quick win | First operator-reported timeout/deploy-kill, or the A2 lane's perf pass — whichever first |
| T8 | Local Presence geo-grid | Presence tab on real single-point posture data (markets × keywords) | 49-point geo-grid scan job (per-node DataForSEO cost) behind a cost-gated flag | Quick win — the full version renders invented client-facing numbers until the pipeline exists | Owner funds the scan budget + approves the flag |
| T9 | Workspace Settings scope | New-shell `wsettings` scope + **legacy WorkspaceSettings route stays mounted** for unported tabs (tiers, publishing, client users, export, flags) | Full 7-tab parity in the new shell | Quick win WITH the legacy fallback (without it: hard operator breakage) | Per-tab: each ported tab retires its legacy tab in the same PR; ledger entry per remaining tab |
| T10 | Requests/Inbox | Prototype feed for signals + promote flow, **RequestManager retained** as an "All requests" management view | Unified request lifecycle (status workflow, bulk ops, deliverables) | Quick win with retention — dropping RequestManager loses the whole request lifecycle (hard stop) | Owner signs off the unified lifecycle design + the Q4 scope decision |
| T11 | Outcomes | Book-level Action Results wired to `useOutcomeOverview`; old OutcomeDashboard stays reachable via Cockpit link | Per-ws outcome tabs redesigned into cockpit/Insights Engine; metric framing reconciled | Quick win with retention (coverage funnel, learnings, playbooks, RecordPublishedWorkCard must stay reachable) | Cockpit absorption design signed off (cross-platform Q3 answer) |
| T12 | Client portal | C1 cutover ships alone (flag flip + deletion) | C2 re-skin + C3 portal ideas | Stage strictly C1→C2→C3 | C2: cutover merged + Keywords pilot validated the gates. C3: per-idea owner sign-off (Q4 for send-boundary) |
| T13 | E-E-A-T | Keep 8-type asset CRUD + autofill; pillar view as a read-only computed lens | Pillar-native data model + signal-level drafting + migration | Quick win — pillar-only orphans existing `eeat_assets` rows | Owner approves the pillar data model + migration plan |
| T14 | AI Visibility engine coverage | Single-engine real data (SoV, mentions, trend) + manual refresh + honest freshness stamp | Multi-engine monitor + tracked prompts + weekly cron | Quick win — engine chips must never fake 4-engine coverage over ChatGPT-only data | N1 tracked-prompts data pipeline funded; cron budget approved (Q8) |

Cross-cutting hard floors that are **not** trade-offs (rejected quick wins): treating kit `.d.ts` as authoritative (prop loss); shipping kit overlays without focus-trap/portal; dropping docx/pdf exports to match a mockup toast; editable H1/slug inputs with no write path; the mockup's fabricated confidence numbers ("AI 96%"); deleting flag-gated capability paths without a named home.

---

## 3. Deferred tracking — final design

Adopt `cross-consistency.md` §5 as specified, with these finalizations:

1. **File:** `data/ui-rebuild-deferred-ledger.json` (machine-checkable; follows the `data/style-exceptions.json` owner+expiry precedent). Pending owner confirm of location (§7 Q5 there) — default stands unless overruled in Phase D.
2. **Schema:** as drafted — `id` (`DEF-<surface>-<seq>`), `surface`, `item`, `decision` (what was traded and why), `class` (token|primitive|behavior|data|a11y|perf|copy), `upgradeTrigger` (mandatory; "someday" invalid), `owner`, `status` (open|scheduled|done|retired), `roadmapItemId` (required when scheduled), `createdAt`, `reviewBy` (hard expiry), `links`.
3. **Verifier:** new `verify:deferred-ledger` script as a CI quality-job step: Zod schema validation; open-past-`reviewBy` → CI failure naming id+owner; scheduled⇒roadmapItemId must exist in `data/roadmap.json`; done⇒roadmap item done; hatch reconciliation (every `// <rule>-ok` hatch under rebuild scope must be reachable from a ledger entry — warn-level initially).
4. **Discipline:** the PR that introduces a trade-off (a hatch, an unmet DoD box, a T1 carry-over) adds its ledger row **in the same PR** — enforced socially at the per-batch diff review. Table 2 above seeds the first entries as their PRs land.
5. **Cadence:** per-PR verifier → sweep lanes read their `class` slice and flip trigger-met entries to `scheduled` → phase gate does a full owner walk (no phase merges with unreviewed expired entries) → ledger size/age reported at the platform-health checkpoint → optional nightly expiry soft-gate.
6. **Non-goals:** not a bug tracker (bugs get fixed in-PR per CLAUDE.md); not a second roadmap (the moment work is real it becomes a roadmap item the entry points at).

---

## 4. Consistency auditor — final design

Adopt `cross-consistency.md` §3–§4 with these finalizations:

### 4.1 Mechanized layer

- **Runner decision:** consume `_adherence.oxlintrc.json` as a machine-readable contract behind an **ESLint flat-config wrapper** (reusing the `lint:hooks` focused-config pattern) unless a spike empirically validates oxlint's esquery-regex support — do not assume it. New lane `npm run lint:ds-adherence`, `--max-warnings=0`, scoped by the D2 rebuild-root decision, wired into CI quality after `lint:hooks`. Byte-identical drift-sync check against the kit copy (mirrors the automated-rules.md gate). Prop allow-lists regenerated from the **merged** TS prop types after the port — the kit's lists would flag HEAD's superset props as violations.
- **pr-check additions (8 rules):** `ds-raw-hex-anywhere`, `ds-tailwind-palette-bypass`, `ds-per-view-css-block`, `ds-token-theme-parity`, `ds-icon-discipline` (rewritten to the D5 icon decision), `ds-deep-import`, `ds-state-matrix-presence`, plus `ds-reinvented-primitive` implemented as **extensions to `scripts/report-style-drift.ts`** (new rebuild-root domain + `card-like-div` and `hand-rolled-modal` categories) — never a second scanner. Ship at **error** severity on rebuild-scoped code (pending D7), diverging deliberately from warn-first since nothing exists to backfill.
- **Snapshot matrix:** extend `playwright.visual.config.ts` to surface × {dark, `.dashboard-light`} × {loading, empty, error, locked, populated}; diff-scoped (changed surfaces) per PR, full ≈180-cell matrix nightly alongside `pr-check-nightly.yml`.
- **Budgets:** `verify:bundle-budget` ratchet from the vite manifest (no new dep); `@axe-core/playwright` in the state-matrix run **pending owner dep approval** — until approved, the a11y AUTO box is explicitly downgraded to REVIEW, never silently.
- **Seeding order:** all AUTO gates fire against the Reference Screen during the Keywords pilot, before fan-out (kit CLAUDE.md mandate).

### 4.2 Agentic layer (3 tiers, matching the ratified Reconcile cadence)

1. **Per-batch diff review** (existing mandate, extended): hatch-justification grep; cross-surface duplicate-interaction scan; prop-shape spot-check against `.d.ts`; punted items → ledger, never TODO.
2. **Consistency sweep every 3 merged surfaces** (or weekly): five lanes — visual drift vs Reference Screen, primitive divergence, prototype fidelity (IA/flows/URL state), behavior contract (mutation classing, state correctness), words & numbers (copy voice; every client figure display-only). Critical/Important fixed before the next batch dispatches; improvements → ledger.
3. **Phase-gate holistic review per lane/phase:** whole-arc end-to-end + flag-ON real-browser smoke of every surface in the phase (the fixture-masked-bug lesson: green gates missed a dead send spine) + evaluative `persona-audit` on client-facing surfaces + the full ledger walk.

Deliberately not mechanized (no grep-able symptom): mutation-contract classing, derived-vs-delivered numbers, copy voice — these live in sweep lanes 4–5 and the DoD review boxes.

---

## 5. Success recommendations (highest-leverage, this rebuild specifically)

1. **Run the Phase D decision batch as one sitting before any code.** Eight Tier-1 decisions gate the entire program; ~140 others defer cleanly to ticket time. The single most expensive failure mode visible in the evidence is building against one of the kit's three self-contradictory answers (Page Intelligence, client IA, Diagnostics).
2. **Budget the construction phase explicitly (F1–F4) — do not let the pilot absorb it.** The Handoff Brief's "the pieces are done" is false for production: 21 missing tokens, 16 net-new components, shell wiring. If Keywords starts before F1–F3, the pilot silently becomes a 4-week foundation project and the schedule loses its calibration point.
3. **Make each surface ledger the ticket's DoD checklist.** Every `docs/ui-rebuild/phase0/surfaces/*.md` row must be marked (preserved/improved/new/ledgered-deferral) before the surface PR merges. This converts 396 verified at-risk items from audit prose into a mechanical closeout — the only defense the mandate actually asks for.
4. **Default to carry-over-then-reskin (T1) for machinery-dense components.** Twenty independent auditors converged on the same quick win; treat visual inconsistency as scheduled debt (ledgered, expiring), and capability loss as the unacceptable alternative.
5. **Serialize barrier-file merges through one owner.** `routes.ts`, `navRegistry.tsx`, `tokens.css`, `wsInvalidation.ts`, `queryKeys.ts`, `shared/types/*` are the frontend's migration files: parallel authoring, serial merge, one staging dry-run at a time (the Reconcile pattern that worked).
6. **Ship the redirect map with every consolidation, and the `?tab=` two-halves contract with every tabbed surface.** The prototype has no URLs; HEAD's URL layer is spec the prototype is silent on. Field 6 of every ticket carries the URL-state answer; the route-removal checklist runs per demoted `Page` value.
7. **Never let the UI compute money or verdicts.** Where the mockup shows a number HEAD doesn't have (confidence %, engine coverage, win verdicts, savings estimates), the choices are: server field with provenance pill, honest "estimate" label, or don't ship the number. Fabricated numbers are the one regression class that damages the agency's product itself.
8. **Bake the data-layer checklist into template fields 6/7:** queryKeys factory entries, `src/api/*` wrappers, wsInvalidation registry coverage, carry-over of the 22 direct `useWorkspaceEvents` subscriptions, intelligence reads via the facade endpoints. A rebuilt surface that skips this regresses live updates invisibly — no gate catches it except the checklist.
9. **Flag-ON real-browser smoke per surface + phase-gate holistic review.** All technical gates were green while the client dashboard crashed on flag flip (memory) and while Strategy P3's send spine was dead (memory). Assume green gates prove correctness, not function.
10. **Size execution parallelism to the owner's review capacity, not to agent count.** Start at 2 concurrent lanes; widen only when the review queue is empty. More agents past the review ceiling deepens the queue without shipping faster (Parallelization Map C3).

---

## 6. Risk register (ranked)

| # | Risk | Likelihood/Impact | Mitigation |
|---|---|---|---|
| R1 | **Capability loss by omission** in consolidation merges (396 verified at-risk items; the mandate's hard-stop class) | High / Critical | Ledger-as-DoD-checklist (§5.3); carry-over default (T1); stop-and-ask discipline; phase-gate ledger walk |
| R2 | **Kit adopted as-is** — prop subsets, a11y-broken overlays, 21 missing tokens, purple Badge regression → silent functional+visual regression | High if D1 unratified / Critical | D1 ratifies Option C; F1 tokens-first; HEAD-props-win merge rule; adherence lint prop lists regenerated from merged types |
| R3 | **Decision debt** — building before D2/D3/D4 → pilot scope wrong, client work on a rejected IA, unscopeable lint rules | Medium / High | Phase D is a hard gate; Tier-2 questions attached to their tickets as dispatch blockers |
| R4 | **Third client-IA generation in code** while the second is still dark (worsens CL1 fork drift) | Medium / High | C1 cutover first — one IA before any re-skin; no new master client flag |
| R5 | **Barrier-file merge contention** across parallel lanes (routes/nav/tokens/types) — the Reconcile W1 git-contention lesson, frontend edition | High if unmanaged / Medium | Serialized merge gate (§5.5); pre-committed shared contracts before dispatch; exclusive file ownership |
| R6 | **Owner review-capacity ceiling** — parallel lanes deepen the queue; stale PRs rebase forever | High / Medium | 2-lane start; consistency-sweep cadence tied to merges not calendar; phase-per-PR keeps diffs reviewable |
| R7 | **Invented/fabricated numbers** shipped from mockup fixtures (AI 96%, 4-engine chips, heuristic verdicts, ~55% savings) | Medium / Critical (trust) | §5.7 hard floor; words-&-numbers sweep lane; T3 blocks client-side money |
| R8 | **Green-gates-but-broken** — fixture-masked dead features, flag-resolution surprises, rules-of-hooks crashes mocked tests can't see | Medium / High | Flag-ON smoke per surface; real loading→loaded transition tests; phase-gate holistic review |
| R9 | **Deferred-ledger rot** — quick wins (2-of-5 lenses, legacy fallbacks, carry-overs) quietly become permanent | Medium / Medium | `verify:deferred-ledger` expiry failures; mandatory upgrade triggers; phase-gate owner walk; health-checkpoint metrics |
| R10 | **CI cost/flake blowup** — 180 snapshot cells at 1 worker, component-lane OOM flakes, no required checks enforced | Medium / Medium | Diff-scoped snapshots per PR + nightly full; inspect red before merging (known flake-masking failure); fund workers only if nightly overruns |

---

*Single write of the Implementation Strategist. Companion evidence: `docs/ui-rebuild/phase0/cross-*.md`, `surfaces/*.md`, `checkpoints/gapfill-args-base.json` (wf1Compact), kit `CLAUDE.md` + `UI Rebuild Handoff Brief.html` + `Parallelization Map.html`.*
