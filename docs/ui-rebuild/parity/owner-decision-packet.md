# UI Rebuild Parity Owner Decision Packet

This packet records the owner choices that govern the rebuilt admin parity sweep.

The behavior and information-architecture recommendations below were accepted on 2026-07-09. They remain authoritative implementation guardrails, but they are not owner visual-parity approvals. Under the visual-parity goal started on 2026-07-10, a surface is complete only after Joshua explicitly approves its paired desktop comparison or explicitly approves a documented exception.

## Decision Protocol

Codex may proceed without owner feedback when the change is local, frontend-only, reversible, and clearly follows the prototype contract without changing route meaning or capability homes.

Codex must ask or defer when a parity correction would change IA, route contracts, legacy capability homes, backend requirements, shared types, feature flags, or a high-trust production workflow.

Use only these visual statuses: `behavior-safe / visual-unverified`, `visual revision in progress`, `awaiting owner approval`, and `owner-approved`.

When a surface reaches an owner decision, record the decision here and in its surface contract. Do not begin the next major surface until Joshua approves or explicitly defers the current one.

## Accepted Decision Log

| ID | Accepted direction | Circle-back trigger |
|---|---|---|
| `ODP-001` | **A** — render Insights Engine as one prototype strategy spine; keep `?lens=` as section focus/open state. | Revisit if operator smoke shows the single spine makes a required review or action materially harder to find. |
| `ODP-002` | **C** — phase Content Pipeline into the lifecycle board: ship the board overview first and keep legacy receivers reachable while Brief/Draft workspaces move later. | Revisit after the board fixture, deep-link compatibility, and every brief/post/subscription/calendar home pass browser review. |
| `ODP-003` | **C** — phase SEO Editor toward the workbench: source grouping and selected-row actions first; inline editing and the keyboard review queue in a dedicated write-workflow slice. | Revisit only after save, send, approve, and publish paths are mapped and tested end to end. |
| `ODP-004` | **A** — keep Site Audit and History as peer modes; demote AI Search Ready, Content Health, and Guide into evidence or guidance while preserving `?sub=` compatibility. | Revisit if browser/operator review shows a demoted diagnostic is no longer discoverable. |
| `ODP-005` | **A + C** — default Search & Traffic to Search performance, retain Site traffic and Annotations as peer reports, and place useful Overview content in a lower summary/handoff; preserve `?lens=overview`. | Revisit after Demand mix and Priority insights have explicit, tested homes. |
| `ODP-006` | **C** — phase Assets into one workshop: Browse is the default workspace, Upload becomes a toolbar action, and Audit becomes a compact repair-results area before full collapse. | Revisit after Performance and Site Audit source-fix handoffs prove Upload, repair, delete, and detail workflows remain obvious. |
| `ODP-007` | **A** — add one sanctioned rebuilt-shell focus-mode bridge for Page Rewriter; keep the page export-only until a real draft/publish backend exists. | Revisit Save draft / Publish only as a separately scoped backend lifecycle project. |
| `ODP-008` | **A** — ship Local Presence on current real data and manual refresh; backlog geo-grid and GBP Performance as explicit backend capability work. | Revisit when either data source is funded and has a server-owned contract. |
| `ODP-009` | **A** — keep Global Ops additive until every risky move has an approved home and backend contract; apply `GO-001` through `GO-008` below. | Revisit each route family independently when its receiving home is verified. |
| `ODP-010` | **C** — approve a rebuilt-admin `PageHeader` variant pilot using stronger styleguide roles; do not change the legacy/default primitive. | Compare a prototype and rebuilt screenshot before migration, then revisit if the larger hierarchy harms density or scan speed. |
| `ODP-011` | Accepted earlier — mirror prototype sidebar zones in the rebuilt shell while preserving route ids and global registry semantics. | Revisit only if staging shows a capability is harder to locate. |
| `ODP-012` | **B** — evaluate Page Intelligence inside SEO Editor / Insights Engine and Content Perf inside Content Pipeline Published / Analytics Hub; preserve old route ids as compatibility receivers. | Revisit the exact receiving homes during the parent-surface contracts before redirecting or removing any standalone UI. |

Global Ops sub-decisions accepted 2026-07-09:

| ID | Accepted direction | Circle-back trigger |
|---|---|---|
| `GO-001` | Keep the segmented Requests hybrid until lifecycle, bulk, and status operations have an explicit single-feed model. | Revisit when the feed can represent every current operation without hidden capability. |
| `GO-002` | Keep Promote to strategy signal unavailable; do not add a Global Ops-only endpoint. | Revisit only with a cross-surface, flag-backed contract and named receiving workflow. |
| `GO-003` | Keep Diagnostics read/run/review only. | Revisit stage/export as server-backed capabilities, not presentational controls. |
| `GO-004` | Require server-owned Outcomes value, click, issue-matrix, and attribution-honest win rollups; do not compute them in React. | Revisit exact prototype visuals when the read model exists. |
| `GO-005` | Keep Business route ids as aliases until parity is verified in staging. | Revisit redirects only after deep links and capability homes pass staging smoke. |
| `GO-006` | Keep dense Workspace Settings tabs until every moved capability has a named section or modal home. | Revisit grouping one capability cluster at a time. |
| `GO-007` | Keep client onboarding out of Global Ops; retain admin enable/reset only until the client-portal phase. | Revisit with the client-portal contract. |
| `GO-008` | Keep temporary LLMs.txt access in Workspace Settings until the AI Visibility receiver is verified. | Revisit after the receiving route, deep link, and capability smoke pass. |

Behavior-safe defaults also accepted: keep Schema detail in the Drawer, keep Links on copy/send until an insert target exists, keep the current Performance detail workflow until the Asset Manager handoff is proven, and defer Keyword Hub trend/KPI visuals until server-owned read models exist. These defaults remain `behavior-safe / visual-unverified` until their turn in the current visual-parity sequence.

## Accepted Behavior-Checkpoint Implementation Order

1. `ODP-001` Insights Engine single strategy spine.
2. `ODP-002` Content Pipeline lifecycle board.
3. `ODP-003` SEO Editor workbench and review queue.
4. `ODP-004` Site Audit diagnostic lens demotion.
5. `ODP-005` Analytics Hub default report.
6. `ODP-006` Media single workshop.
7. `ODP-007` Page Rewriter focus mode and write spine.
8. `ODP-008` Local Presence data-backed parity.
9. `ODP-009` Global Ops route-family decisions.
10. `ODP-010` Rebuilt page-header typography scale.
11. `ODP-011` Rebuilt sidebar prototype zone parity.
12. `ODP-012` Page Intelligence / Content Perf rebuilt coverage.

## Current Visual-Parity Order

1. Insights Engine.
2. Brand & AI.
3. Content Pipeline.
4. SEO Editor.
5. Search & Traffic.
6. Asset Manager, Performance, and Site Audit as one repair-flow cluster.
7. Schema, Links, Competitors, and Keyword Hub.
8. Cockpit final calibration, Local Presence, and Global Ops.
9. Page Intelligence and Content Performance receiving-home decisions.
10. Registry-wide final visual audit.

Do not start the next major surface until Joshua records `owner-approved` or explicitly defers the active surface.

## P1 Behavior Decisions

### ODP-001 Insights Engine Single Spine

Surface: `seo-strategy` / Insights Engine
Contract: `docs/ui-rebuild/parity/engine-contract.md`

Accepted decision: **A**, subject to the `ODP-001` circle-back trigger above.

Options:

- A. Recommended: remove the visible top-level `LensSwitcher`, render the prototype spine in one scroll, and preserve `?lens=` as section focus/open state.
- B. Keep the current split lenses as an intentional production divergence and only polish typography/spacing.
- C. Hybrid: keep a compact section-jump control, but render all sections in the same page body.

Recommendation: choose A unless operators depend on the current split-lens workflow. The prototype intent is clear, and the current lenses are the largest remaining mismatch on this surface.

Risk if wrong: choosing A too early could disrupt high-trust strategy review habits; choosing B leaves a page that may look cleaner but still behaves unlike the prototype.

Implementation guardrail: remove the visible lens split without rewriting the underlying strategy capabilities; preserve exact-once overlays, send behavior, deep links, and section focus.

Behavior-checkpoint log, 2026-07-09: Joshua found that the interaction model was corrected but the composition still did not mirror the prototype closely enough. The subsequent implementation and independent-review cycle corrected the recorded behavior, truthfulness, responsiveness, and capability-placement findings without changing decision A or its route/capability guardrails. The resulting reviewer `PASS` applies only to the accepted behavior checkpoint; it is not a visual approval and does not make Engine a visual rubric.

Visual-parity log, 2026-07-10 — status: `owner-approved`. A source-led desktop pass matched the prototype spine geometry, opening hierarchy, Signals and move density, projection framing, preview chrome, overlays, and mobile overflow floor. Joshua approved all six recommended directions; V1–V3 are implemented, and V4–V6 are explicit approved exceptions. Final paired/interior evidence at both required desktop viewports plus the mobile floor passed a fresh Sol rendered review with no safe-local defects.

| ID | Owner decision | Recommended direction | Why it is owner-gated |
|---|---|---|---|
| `ODP-001-V1` | Compact prototype POV or full structured production POV in the primary spine. | Keep a compact narrated POV in the spine and disclose the existing full editor in a Drawer. | This changes the hierarchy and editing workflow rather than local styling. |
| `ODP-001-V2` | Engine actions in the page body or the shared topbar. | Use the shared topbar as the single action home if its existing contract can preserve every action exactly once. | Moving controls changes the shell/action composition and can hide or duplicate capability. |
| `ODP-001-V3` | Placement of Curation / Needs Attention and disclosure of secondary move lifecycle controls. | Keep Stage inline; group Curation and Needs Attention beside the queue; disclose secondary lifecycle controls without removing them. | Two plausible prototype readings materially change operator scan and action flow. |
| `ODP-001-V4` | Exact prototype preview height or truthful live preview content. | Approve truthful live copy and metrics as a documented height/content exception. | Truncating or relabeling the live client story would change the content contract. |
| `ODP-001-V5` | Production-only provider evidence and Operations composition. | Approve both as documented production-capability exceptions. | The prototype has no equivalent home, and removal would hide production capabilities. |
| `ODP-001-V6` | Restore Lost visibility in this frontend goal or separate its read-contract repair. | Record a separate backend task; keep the frontend truthful until the admin-authorized read exists. | `/api/public/insights/:workspaceId` returns `401` in admin context, so this requires backend scope. |

Owner resolution, 2026-07-10: **“Approve Insights Engine with V1–V6 as recommended.”** V1–V3 are implemented exactly as recorded; V4–V6 remain explicit exceptions. Final status: `owner-approved`.

### ODP-002 Content Pipeline Lifecycle Board

Surface: `content-pipeline` / Content Pipeline
Contract: `docs/ui-rebuild/parity/content-pipeline-contract.md`

Accepted decision: **C**, subject to the `ODP-002` circle-back trigger above.

Options:

- A. Recommended: make Board the default, remove the peer tab strip from the primary body, map `?tab=` values into mode/focus/open-state compatibility, and use prototype mode controls for Calendar, Published, Content Health, and Matrix.
- B. Keep the current receiver shell as a production divergence and continue only safe cleanup.
- C. Phase it: first build the board overview while keeping legacy receivers reachable from overflow actions, then move Brief/Draft workspaces in a later slice.

Recommendation: choose C if operational risk is high, otherwise A. Content Pipeline is a large workflow surface, so a staged board correction may preserve trust while still moving toward the prototype.

Risk if wrong: choosing A without enough workflow proof could hide or confuse briefs, posts, subscriptions, calendar scheduling, and published readback; choosing B leaves the largest workflow mismatch unresolved.

Implementation guardrail: build the board overview first. Keep legacy receivers reachable and do not imply subscription-drawer or Brief/Draft behavior that is not wired in the current slice.

Implementation log, 2026-07-09: the first phase is complete. Bare/default and `briefs` now open the aggregate lifecycle Board; Intake expands in place; Calendar, Published, Content Health, and Matrix remain peer modes; existing Briefs/Posts/capacity workflows launch exact once. Browser smoke preserved aliases, post/fix-context behavior, Guide, and clean console/overflow. An independent review found that zero-count Brief/Draft columns could strand their workspaces and that some Board copy exposed implementation framing; persistent launch cards, one shared Briefs opener, and operator-facing copy corrected both findings. A fresh independent behavior-checkpoint review returned `PASS`. Full item workspaces and capacity Drawer remain deferred; visual status remains `behavior-safe / visual-unverified`.

### ODP-003 SEO Editor Workbench And Review Queue

Surface: `seo-editor` / SEO Editor
Contract: `docs/ui-rebuild/parity/seo-editor-contract.md`

Accepted decision: **C**, subject to the `ODP-003` circle-back trigger above.

Options:

- A. Recommended long-term: make the default surface a source-grouped spreadsheet workbench with inline title/meta editing, selected-row sticky actions, page-intelligence detail, and `Review pending` keyboard queue.
- B. Keep the current table + drawer shell as a production divergence for now.
- C. Phase it: add selected-row sticky actions and stronger source grouping first; add inline editing and keyboard queue in a dedicated workflow slice.

Recommendation: choose C unless the team is ready to review every save/send/publish path now. This surface touches high-trust write workflows.

Risk if wrong: implementing the full queue/workbench too quickly could change how operators save, send, approve, and publish SEO edits; keeping the current shell leaves the prototype's core operating model absent.

Implementation guardrail: limit the first slice to source grouping and selected-row actions. Do not add mock review queue affordances or change write semantics.

Implementation log, 2026-07-09: Static, CMS, and Manual targets now render in explicit groups while continuing to feed the existing single selected-action region. The 503-row fixture resolved to 21/217/265 rows, one Research Drawer, and clean console/overflow. No inline edit, Approve, Publish, AI-fix, or review-queue semantics were introduced; both independent behavior-checkpoint reviews found no SEO Editor defect, and the final reviewer returned `PASS`. Visual status remains `behavior-safe / visual-unverified`.

### ODP-004 Site Audit Diagnostic Lens Demotion

Surface: `seo-audit` / Site Audit
Contract: `docs/ui-rebuild/parity/site-audit-contract.md`

Accepted decision: **A**, subject to the `ODP-004` circle-back trigger above.

Options:

- A. Recommended: demote those diagnostics into evidence, related-work, or guide sections inside the Site Audit flow while preserving `?sub=` values as compatibility open-state.
- B. Keep peer lenses as an intentional production divergence.
- C. Move selected diagnostics to their owning surfaces and keep only cross-links in Site Audit.

Recommendation: choose A. The prototype has only Site Audit and History as peer modes, and the correction can preserve the current URLs.

Risk if wrong: choosing A could bury useful diagnostics if their new homes are too subtle; choosing B keeps the technical audit visibly out of prototype IA.

Implementation guardrail: preserve every diagnostic receiver and capability while demoting the visible peer modes; do not add new peer modes.

Implementation log, 2026-07-09: only Site Audit and History remain visible peers. AI Search Ready, Content Health, and Audit Guide are exact-once disclosures after Core Web Vitals, and their `?sub=` URLs open the intended evidence while retaining the audit body. The first independent review found that audit progress temporarily hid compatibility evidence; progress and evidence now render together, with a dedicated running-state regression test. The Rinse fixture passed overview, AEO receiver, History, and Schedule smoke without mutations, and a fresh independent behavior-checkpoint review returned `PASS`; visual status remains `behavior-safe / visual-unverified`.

### ODP-005 Analytics Hub Default Report

Surface: `analytics-hub` / Search & Traffic
Contract: `docs/ui-rebuild/parity/analytics-hub-contract.md`

Accepted decision: **A + C**, subject to the `ODP-005` circle-back trigger above.

Options:

- A. Recommended after Local Presence/Insights Engine decisions: default `/analytics-hub` to Search performance, keep Site traffic and Annotations as peer report modes, and preserve `?lens=overview` as a compatibility receiver.
- B. Keep Overview as a visible peer lens and current default.
- C. Demote Overview into a lower summary band inside Search performance or an Insights Engine handoff.

Recommendation: choose A with some of C's content placement. The prototype default is Search performance, but Demand mix and Priority insights should not be orphaned.

Risk if wrong: hiding Overview too aggressively can lose cross-source diagnostics; keeping it as default keeps the rebuilt route visibly out of prototype order.

Implementation guardrail: give Demand mix and Priority insights tested receiving homes in the same slice before removing Overview from visible peer navigation.

Final audit log, 2026-07-09: the first receiving-home implementation passed with populated GSC data but dropped the lower band in unconfigured and empty/error GSC states, and a surface-wide provider gate also hid provider-independent Annotations. The accepted correction handles availability per report, retains one truthful Demand mix / Priority insights band for degraded Search states, keeps Annotations available without analytics providers, and uses blue for branded read-only data. This resolves the `ODP-005` capability-home review without restoring Overview as a peer.

### ODP-006 Media Single Workshop

Surface: `media` / Assets
Contract: `docs/ui-rebuild/parity/media-contract.md`

Accepted decision: **C**, subject to the `ODP-006` circle-back trigger above.

Options:

- A. Collapse into one workshop, using filters and bulk actions as the navigation surface, while preserving `?tab=audit`, `?tab=upload`, filters, search, view, sort, and asset detail as compatibility state.
- B. Recommended for now: keep the current three-lens model until Media is reviewed with Performance and Site Audit repair handoffs.
- C. Phase it: make Browse the default workshop, move Upload to a toolbar action, and keep Audit as a compact repair-results section before fully collapsing.

Recommendation: choose B or C. Media has direct repair/upload/delete workflows, so the exact collapse should be coordinated with the source-fix handoff chain.

Risk if wrong: collapsing too early may obscure audit and upload workflows; keeping the split means the surface remains behaviorally off-prototype.

Implementation guardrail: phase the workshop and prove Upload, Audit, delete, detail, and repair handoffs before removing their compatibility receivers.

Final audit log, 2026-07-09: the `ODP-006` discoverability trigger fired because Repair results was appended after the complete asset grid. Owner judgment is now locked: Repair results stays above filters, metrics, and the grid as the first work area while Browse remains visible below. The same correction adds the prototype-visible All and Total media weight controls, uses blue for savings estimates, and gives a valid asset deep link precedence over Upload so combined params never mount two Drawers. Browser smoke proved the repair-first order and canonical close behavior; peer tabs remain removed.

## Capability Decisions

### ODP-007 Page Rewriter Focus Mode And Write Spine

Surface: `rewrite` / Page Rewriter
Contract: `docs/ui-rebuild/parity/page-rewriter-contract.md`

Accepted decision: **A**, subject to the `ODP-007` circle-back trigger above.

Options:

- A. Recommended: add a sanctioned shell focus-mode bridge, then let Page Rewriter consume it; keep the page export-only until the backend write spine exists.
- B. Keep no focus mode in the rebuilt shell and accept this as a known divergence.
- C. Approve a new draft/publish write-spine project with backend storage, lifecycle, activity, broadcast, and tests.

Recommendation: choose A. Focus mode is a shell concern and can be solved without pretending draft/publish exists.

Risk if wrong: adding Page Rewriter-only focus behavior forks shell UX; showing Save draft or Publish without backend support creates a trust problem.

Implementation guardrail: solve focus mode at the rebuilt shell boundary; keep the Page Rewriter export-only and do not introduce draft/publish controls.

### ODP-008 Local Presence Data-Backed Parity

Surface: `local-seo` / Local Presence
Contract: `docs/ui-rebuild/parity/local-seo-contract.md`

Accepted decision: **A**, subject to the `ODP-008` circle-back trigger above.

Options:

- A. Recommended: keep the current real-data Rank & profile v1, preserve manual refresh controls, and backlog geo-grid/GBP Performance as explicit backend capability work.
- B. Fund a 49-point geo-grid read model and build prototype map evidence.
- C. Fund GBP Performance ingestion for profile views, calls, directions, and richer profile-health fields.

Recommendation: choose A unless those data sources are now in scope. The visible interaction model already matches the prototype; remaining gaps are data-backed.

Risk if wrong: fabricating unavailable metrics would damage trust; blocking v1 on backend parity may slow the broader UI recovery.

Implementation guardrail: continue rank/profile and reviews polish using real data only. Do not synthesize the prototype grid or performance numbers client-side.

### ODP-009 Global Ops Route-Family Decisions

Surface family: `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests`
Contract: `docs/ui-rebuild/parity/global-ops-contract.md`

Accepted decision: **A**, with `GO-001` through `GO-008` recorded above.

Options:

- A. Recommended: keep the additive shell until each risky move has an approved home and backend contract.
- B. Collapse route families aggressively into the prototype hubs and preserve old route ids as redirects.
- C. Approve only selected collapses, such as Requests feed or Workspace Settings grouping, and leave the rest additive.

Recommendation: choose A, then answer the specific `GO-001` through `GO-008` decisions in the Global Ops contract.

Risk if wrong: aggressive collapse can hide billing, diagnostics, storage, request, roadmap, or outcome workflows; never collapsing leaves global IA less prototype-like.

Implementation guardrail: keep route receiver polish, operator copy cleanup, and smoke coverage additive. Destructive or billing workflows require their own explicit contract before moving.

Implementation log, 2026-07-09: the final calibrated-surface audit enforced the accepted boundary rather than expanding it. Requests no longer advertises a future strategy handoff; Outcomes Book removed React-created portfolio totals and keeps server-owned workspace rows/coverage only; global rebuilt routes now mount even when the account has zero workspaces. `GO-004` remains open only for a future server-owned portfolio rollup.

## Design System Decisions

### ODP-010 Rebuilt Page-Header Typography Scale

Surface family: all rebuilt admin surfaces
Contract: `DESIGN_SYSTEM.md` PageHeader, `docs/ui-rebuild/parity/README.md` Typography Calibration

Accepted decision: **C as a rebuilt-admin variant pilot**; the Performance pilot is implemented, and the side-by-side evidence gate remains required before broad migration.

Current finding: the compact default remains styleguide-compliant at `.t-h2` / 22px plus `.t-caption-sm` / 13.5px. The opt-in Performance pilot renders a semantic `h2` at `.t-h1` / 28px and its subtitle at `.t-body` / 15.5px with natural wrapping. In-browser computed evidence shows no horizontal overflow or fresh console errors; a visual side-by-side still decides whether other rebuilt surfaces adopt it.

Options:

- A. Keep the current compact `PageHeader` contract and continue promoting important explanatory copy from caption roles to `.t-body` / `.t-page` inside the page body.
- B. Change the default `PageHeader` title/subtitle scale app-wide to match the prototype more closely.
- C. Recommended if the prototype truly needs stronger hierarchy: add an approved rebuilt-admin/header variant that uses `.t-h1` for page titles and body-scale subtitle/context copy, then migrate rebuilt surfaces intentionally.

Recommendation: keep the Performance pilot, review it beside the prototype, and migrate no additional surfaces until that evidence confirms the stronger hierarchy improves orientation without harming density.

Risk if wrong: choosing B can make legacy admin pages unexpectedly oversized; choosing A may leave rebuilt pages technically compliant but still visually underpowered; one-off per-surface overrides would reintroduce typography drift.

Implementation guardrail: pilot a rebuilt-admin variant only, keep the token parity test and computed-size checks, and require side-by-side browser evidence before migrating surfaces. Do not change the default `PageHeader` primitive.

### ODP-011 Rebuilt Sidebar Prototype Zone Parity

Surface family: rebuilt admin shell / `RebuiltSidebar`
Contract: `docs/ui-rebuild/parity/coverage-audit.md`

Decision: accepted 2026-07-09. Mirror the prototype nav zones inside the rebuilt sidebar presentation while preserving route ids and global registry semantics.

Implementation choice:

- The rebuilt sidebar now renders top Cockpit/Insights, Strategy & Content, Search & Site Health, Optimization, Client-facing, and Admin zones.
- Sidebar-only label overrides are allowed for prototype parity: `home` -> Cockpit, `seo-strategy` -> Insights Engine, `seo-keywords` -> Keywords, `content-pipeline` -> Content Pipeline, and `media` -> Asset Manager.
- `competitors` is surfaced in the rebuilt sidebar's Strategy & Content zone as a local presentation item without adding it back to the global `NAV_REGISTRY`.
- Optimization stays on `var(--teal)`, not prototype purple, because the current design-system rule reserves purple for admin AI-only surfaces.
- Action Results, Requests, and Content Perf are mapped into Client-facing as the current production equivalents of the prototype's client-facing zone.

Residual risk: `page-intelligence` and `content-perf` remain non-rebuilt route-home questions, tracked by `ODP-012`. The rebuilt sidebar can present them in prototype-adjacent zones while their final homes are decided.

### ODP-012 Page Intelligence / Content Perf Rebuilt Coverage

Surface family: route coverage / admin nav
Contract: `docs/ui-rebuild/parity/coverage-audit.md`

Accepted decision: **B**, subject to the `ODP-012` receiving-home review above.

Current finding: both routes remain standalone `NAV_REGISTRY` entries and real `Page` values, and neither is mounted in `REBUILT_SURFACES`. Content Pipeline Published now consumes the existing content-performance readback and gives that evidence a prototype-aligned proof-queue home, so it is the proposed receiving surface for `content-perf`; the standalone route remains intact until a shipping slice proves every report and deep link. Page Intelligence remains standalone because the current SEO Editor Research Drawer has not yet proved every analyze, edit, job, and handoff capability.

Options:

- A. Build standalone rebuilt contracts/surfaces for both routes.
- B. Recommended for prototype parity review: decide whether Page Intelligence belongs inside SEO Editor / Insights Engine, and whether Content Perf belongs inside Content Pipeline Published / Analytics Hub, then preserve old route ids as compatibility receivers.
- C. Keep both legacy for now and mark them out of scope for the rebuilt parity sweep.

Recommendation rationale: the prototype consolidates published-content evidence into the lifecycle/readback workflow, and Content Pipeline now has that truthful home using existing data. Page Intelligence is a higher-risk fold because its analysis and handoff surface is broader than the current Research Drawer. Preserve both standalone routes while these receiving homes are proved rather than redirecting on visual similarity alone.

Risk if wrong: standalone rebuilds may perpetuate prototype drift; aggressive folding may bury workflows operators still use directly.

Implementation guardrail: do not build standalone visual rewrites or add redirects in this integration branch. Keep route/nav accounting explicit and preserve both route ids until a surface-scoped shipping PR proves exact capability and deep-link coverage on staging.

Implementation log, 2026-07-09: Content Pipeline Published is accepted as the proposed Content Performance receiver because its proof queue already reads the shared content-performance data; `/content-perf` remains a standalone production route. Page Intelligence remains standalone until a later SEO Editor Research/detail slice proves its complete workflow. No route id, registry entry, or redirect changed.

## Optional Later Decisions

These behavior-safe defaults were accepted on 2026-07-09. They remain `behavior-safe / visual-unverified` until their turn in the current sequence:

- Schema exact inline page cards versus the current detail Drawer.
- Links row-level Insert versus current copy/send until write target is explicit.
- Performance exact inline Page Weight expansion and side-by-side speed cards.
- Keyword Hub trend/KPI polish once server-owned read models exist.

## Next Implementation Slice

Begin Brand & AI source inventory and paired desktop comparison. Preserve the owner-approved Insights Engine commit as an atomic calibration surface; do not push, open a PR, or start staging extraction during this goal.
