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

Behavior-safe defaults also accepted: keep Schema detail in the Drawer, keep Links on copy/send until an insert target exists, keep the current Performance detail workflow until the Asset Manager handoff is proven, and defer Keyword Hub trend/KPI visuals until server-owned read models exist. Schema, Links, Performance, and Keyword Hub completed source-led correction and were owner-approved with those explicit exceptions on 2026-07-10.

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

### Brand & AI Visual Circle-Backs

Surface: `brand` / Brand & AI

Contract: `docs/ui-rebuild/parity/brand-ai-contract.md`

Current status: `owner-approved`

The prototype-led overview correction is rendered at both required desktop viewports. It matches the prototype's 1140px canvas, opening hierarchy, three-line lede, cockpit/body landmarks, compact group density, and first-viewport section order. Synthetic modal frames are removed, the real panels remain exact-once, and the Brandscript nested-button defect is fixed. The seven formerly owner-gated choices below are retained as the decision record.

| ID | Owner decision | Recommended direction | Why it is owner-gated |
|---|---|---|---|
| `ODP-BRAND-V1` | Keep the locally inferred `45% context complete` / readiness judgment or remove it until a server-backed score exists. | Remove the overall percentage and readiness badge; make `5/11 inputs configured` the primary truthful readout while retaining group-level configured evidence. | The current denominator and readiness thresholds are defined in React, despite the Brand contract forbidding an invented numeric score. Exact prototype geometry and data authority conflict. |
| `ODP-BRAND-V2` | Keep seven generators under Voice only or restore the prototype's 17 unique generators across all four context groups. | Restore all 17 once, assigned to their prototype groups, with one shared Identity capability home and no duplication. | This changes capability visibility and reverses the earlier Voice-only behavior checkpoint. |
| `ODP-BRAND-V3` | Open the full Identity library from every generator row or focus the clicked deliverable. | Keep plain `?tab=identity` as the full-library compatibility receiver; overview rows add a validated focus value and open one real deliverable editor. | Additive focus state changes the launch workflow and must preserve direct deep-link meaning. |
| `ODP-BRAND-V4` | Keep existing DS `lg` modal width (768px) or add a Brand-specific width matching the 640/680px prototype shells. | Approve one 680px Brand workflow size for this surface; use it for all Brand modals rather than adding two near-duplicate shared sizes. | A new shared Modal size or local width exception requires owner approval. |
| `ODP-BRAND-V5` | Recreate the prototype's curated modal interiors exactly or preserve truthful production editors and empty states. | Preserve real editors/data; match shell, section order, density, and focus where the contracts support it. Document founder Q&A, E-E-A-T pillar rollups, and confirmed-geo rollups as backend exceptions instead of inventing data. Auto-focus the real existing Brandscript when launched from its overview row, while the direct deep link retains the library. | Exact prototype content requires data the production contracts do not expose; simulating it would be misleading, while rehoming editors changes workflow. |
| `ODP-BRAND-V6` | Copy the prototype's visual-only Preview context / Generate from site topbar controls or retain truthful production actions. | Keep Refresh context exactly once in the topbar, keep the real Discovery launcher in the rail, and omit unsupported Preview context. Record the topbar composition as a production exception. | The prototype controls have no handlers; adding them would simulate unsupported actions, and moving Discovery would change its capability home. |
| `ODP-BRAND-V7` | Add a new 12.5px / 700 typography role for the two Brand rail titles or retain the closest existing DS role at 13.5px / 700. | Retain the existing `t-ui` token values and record the 1px title-size difference as an approved exception. | Exact computed parity would require a new shared type token, class, or local rule exception; the owner rules require an explicit decision before any of those are added. |

Owner resolution, 2026-07-10: **“Go for it.”** V1–V7 are approved exactly as recommended. This resolves the implementation choices only; it does not approve the final visual comparison.

Implementation/review log, 2026-07-10: V1–V7 are implemented. The 218-test Brand/receiver floor, hooks lint, typecheck, production build, and all automated PR rules pass. Browser captures at 1440×900, 1600×1000, and 390×844 are free of page overflow, nested buttons, console errors, and page errors. After correcting Markdown preview rendering and a 13px cockpit/body landmark drift, a fresh Sol reviewer returned `PASS`.

Owner visual resolution, 2026-07-10: Joshua reviewed the live surface and said, **“It looks great. I'd like you to continue rolling through our parity pass, and I'll provide the finer feedback once we've wrapped everything.”** Brand & AI is therefore `owner-approved`. V1–V7 remain the accepted decision and exception record; the later fine-feedback pass is a registry-wide circle-back, not a revocation.

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

Behavior-checkpoint log, 2026-07-09: the first phase opened the aggregate lifecycle Board, expanded Intake in place, preserved peer modes and exact-once receivers, and passed independent behavior review. Full item workspaces and the capacity Drawer were still deferred at that checkpoint; its status was `behavior-safe / visual-unverified`.

Source-led baseline, 2026-07-10 — starting status: `visual revision in progress`. Direct prototype/current measurement at 1440×900 and 1600×1000 confirmed the remaining mismatch was structural: the rebuilt 1600px canvas expanded to 1316px instead of the prototype's capped 1188px, five KPI tiles displaced item work, and the four columns showed aggregate launchers despite the real owner workspace having seven briefs and three posts.

Recommended visual/production resolutions for the registry-wide owner review:

| ID | Resolution used for this pass | Reason |
|---|---|---|
| `ODP-002-V1` | Compact the page header; host Export, Refresh, and Guide exact-once in rebuilt chrome with an isolated fallback; keep capacity and modes together. | Matches the prototype hierarchy without hiding actions. |
| `ODP-002-V2` | Derive item stages from existing requests, briefs, and posts, deduplicating linked artifacts; do not add a persisted lifecycle field. | Existing reads are sufficient and `DEF-content-pipeline-007` already records the backend limitation. |
| `ODP-002-V3` | Keep Brief focus local and open one real `ContentBriefs` editor in a full-screen shell; do not add `?brief=`. | Avoids a new route contract while making the Board item-backed. |
| `ODP-002-V4` | Preserve `?post=` and open the selected real `ContentManager`/Post editor in the full-screen Draft/Review shell. | Maintains the existing deep-link and production action contract. |
| `ODP-002-V5` | Retain Matrix as a fifth production mode and preserve the broader production Calendar controls. | The prototype source states Matrix belongs to the architecture but accidentally omits its button; removing either capability would be destructive. |
| `ODP-002-V6` | Omit or relabel unsupported prototype actions: no simulated Queue refresh, Add to Insights, per-field AI assists, questionnaire, generation theater, reminder, or Matrix bulk generation. | These require new backend/operation contracts and must remain honest exceptions. |

Joshua explicitly asked Codex to continue through the parity sequence and defer finer feedback until the registry-wide review. These are therefore implementation defaults for the current reversible frontend pass, not silent owner approval.

Implementation result, 2026-07-10 — status: `owner-approved`. ODP-002-V1 through V6 are implemented as recommended. The owner fixture now renders a capped item-backed Board with separate Intake, blank/filled Brief, Draft, and Review three-rail workspaces, compact secondary modes, and a 440px capacity Drawer. Board-opened posts return to the Board; explicit legacy post links retain their receiver. Corrected 1440×900, 1600×1000, overlay, and mobile evidence under `/tmp/asset-dashboard-codex-visual-parity/content-pipeline/final-pass2/` passed fresh Sol review with no safe-local defects. Joshua approved the surface with its documented exceptions.

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

Behavior-checkpoint log, 2026-07-09: Static, CMS, and Manual targets rendered in explicit groups while continuing to feed the existing selected-action region. That slice introduced no inline edit, Approve, Publish, AI-fix, or review-queue semantics and passed independent behavior review; its status was `behavior-safe / visual-unverified`.

Source-led visual result, 2026-07-10 — status: `owner-approved`. The actual mounted prototype uses its full-width worktable by default; the apparent Edit/Research lens is dead source and was not treated as visible authority. The corrected Estateably fixture resolves 25 Static, 217 CMS, and 265 Manual targets into one sheet with inline Static/CMS title/meta fields, amber read-only Manual rows, compact source/collection/quick filters, mutually exclusive missing/selected bands, truthful leading source checkboxes, and a Research Drawer at 600px/860px. Existing URL state, save/send/publish authority, Keyword Hub handoff, and Page Intelligence route are preserved. H1/slug remain read-only, and the unsupported keyboard review queue is explicitly deferred. Corrected evidence under `/tmp/asset-dashboard-codex-visual-parity/seo-editor/pass1/` passed fresh Sol review with no safe-local defects. Joshua approved the surface with that workflow exception.

Recommendations carried into the registry-wide owner review:

| ID | Resolution used for this pass | Reason |
|---|---|---|
| `ODP-003-V1` | Keep all existing URL aliases but show the mounted prototype's sheet as the sole default composition. | Preserves deep links without rendering dead prototype controls. |
| `ODP-003-V2` | Keep Save SEO and Publish Site as separate production capabilities. | They write at different scopes and cannot be visually merged without changing meaning. |
| `ODP-003-V3` | Keep H1/slug read-only until writable fields exist. | Avoids simulating unsupported writes. |
| `ODP-003-V4` | Keep keyword assignment in Keyword Hub and Page Intelligence standalone. | Avoids duplicate capability homes and premature route retirement. |
| `ODP-003-V5` | Defer the keyboard review queue. | Current callbacks do not support the prototype's Approve/Request changes workflow truthfully. |

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

Source-led visual result, 2026-07-10 — status: `owner-approved`. The 1120px console now matches the prototype's compact context/two-peer tray, horizontal score hero, 3x2 category order, single CWV strip, utility row, bulk repair, Broken Links, and dense issue hierarchy. Bare Audit preserves that first-viewport spine by keeping collapsed compatibility support below issues; `?sub=aeo-review|content-decay|guide` instead opens the same exact-once support group immediately after CWV, so deep-link meaning is unchanged. Compact History replaces the oversized legacy composition. Issue, schedule, export/share, and report workflows remain richer production overlays. Exact 1440x900 and 1600x1000 evidence under `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/site-audit/` passed fresh Sol review with `PASS`. Joshua approved the composition and production-overlay exceptions.

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

Source-led visual result, 2026-07-10 — status: `owner-approved`. The corrected report uses the prototype's 1120px border-box canvas, compact three-mode tray, compact primary ranges, narrative-first heading, and source-specific section order. Search now reads KPI evidence → trend → Movement → Detail → monitoring; Traffic reads KPI evidence → trend → Acquisition → Engagement → Conversion → monitoring; Annotations reads contextual trend → editable timeline. Extra production ranges remain under More, Re-scan remains exact-once, Breakdown detail remains in the shared Drawer, and annotation CRUD stays intact. The unsupported proof-stage action and unavailable live GSC/GA4 data were not simulated; truthful unavailable states and fixture-backed populated ordering are recorded instead. Corrected evidence under `/tmp/asset-dashboard-codex-visual-parity/search-traffic/pass1/` passed fresh Sol review with `PASS`. Joshua approved the composition and truthful unavailable states.

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

Final audit log, 2026-07-09: the `ODP-006` discoverability trigger fired because Repair results was appended after the complete asset grid. The behavior-checkpoint resolution moved Repair ahead of filters and the grid while Browse remained visible below. The later source-led visual pass refined that placement to follow the prototype summary/proof bands and precede Browse controls/grid, so repair remains discoverable without displacing first-viewport evidence. The correction also adds the prototype-visible All and Total media weight controls, uses blue for savings estimates, and gives a valid asset deep link precedence over Upload so combined params never mount two Drawers. Browser smoke proved the order and canonical close behavior; peer tabs remain removed.

Source-led visual result, 2026-07-10 — status: `owner-approved`. The final 1180px workshop restores the prototype's four-metric summary, source-proof band, compact controls, fixed 132px card previews, red No alt / neutral Unused semantics, and two labeled contextual card actions. The prior repair-first decision is preserved as the first actionable workspace after the summary/proof bands and before Browse controls/grid; this visual qualification keeps repair discoverable without displacing the prototype's orientation evidence. Upload, Asset Detail, organize, confirmation, and progress remain production Drawers with exact overlay precedence. Evidence under `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/` passed fresh Sol review with `PASS`. Joshua approved the composition and Drawer exceptions.

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

Source-led visual result, 2026-07-10 — status: `owner-approved`. The corrected capped workspace restores the prototype's compact context/picker, 44/56 chat-document split, fixed pane headers, seeded transcript, contained two-row playbooks, compact composer, `Live document` hierarchy, formatter/evidence order, independently scrolling document, and honest export-only footer. Loaded, empty, picker, export, Focus, and mobile evidence under `/tmp/asset-dashboard-codex-visual-parity/batch9/page-rewriter/` passed fresh Sol review with `PASS`; route/deep-link and exact-once homes remain intact. Joshua approved retaining the shared shell's 62px collapsed rail in Focus; Save draft / Publish remain deferred behind the separate backend write spine.

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

Implementation log, 2026-07-10: the source-led frontend pass retains `ODP-008 A` and replaces the nested legacy visibility wrapper with its full protected capability set exactly once. The corrected 1120px spine uses compact context/actions, the prototype's two-mode tray, one truthful profile hero, a 706/340 visibility/profile-health split, share-of-voice controls/table, one graduation note, and a 560px setup Drawer. Unknown posture is neutral, health icons use key-specific predicates, and the Drawer footer keeps its note above one desktop action row. No geo-grid nodes, GBP Performance metrics, profile completeness, rating, reviews, or review pipeline data are fabricated; live Reviews remains an honest unavailable-connection state while populated lifecycle coverage stays fixture-backed. Fresh Sol review returned `PASS` after both desktop viewports, setup, Reviews, computed overflow, and the mobile regression floor were inspected. Status is `owner-approved`; Joshua approved the truthful unavailable states and backend exceptions.

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

Visual completion log, 2026-07-10 — status: `owner-approved`. Fresh review returned `PASS` for Settings; Workspace Settings; Roadmap; Revenue / AI Usage / Features / Prospects; Outcomes Book and per-workspace Outcomes; Diagnostics; and Requests. Workspace Settings now restores the prototype identity header and compact rhythm around the preserved production tabs/operations. Roadmap now omits verbose nonnumeric capacity prose and restores a stable six-column Backlog scan. Final fixed-viewport evidence is under `/tmp/asset-dashboard-codex-visual-parity/batch8/global/`. Joshua approved all 11 route homes with `GO-001` through `GO-008` retained as explicit exceptions.

## Design System Decisions

### ODP-010 Rebuilt Page-Header Typography Scale

Surface family: all rebuilt admin surfaces
Contract: `DESIGN_SYSTEM.md` PageHeader, `docs/ui-rebuild/parity/README.md` Typography Calibration

Accepted decision: **C as a rebuilt-admin variant pilot**; the side-by-side evidence gate is now complete for Performance, and no broad migration is authorized.

Current finding: the source-led Performance comparison showed the 28px pilot was too tall for the prototype's 23px hierarchy and first-viewport density. Performance now uses the shared compact `.t-h2` / 22px header. The opt-in variant remains available but is not adopted by another surface.

Options:

- A. Keep the current compact `PageHeader` contract and continue promoting important explanatory copy from caption roles to `.t-body` / `.t-page` inside the page body.
- B. Change the default `PageHeader` title/subtitle scale app-wide to match the prototype more closely.
- C. Recommended if the prototype truly needs stronger hierarchy: add an approved rebuilt-admin/header variant that uses `.t-h1` for page titles and body-scale subtitle/context copy, then migrate rebuilt surfaces intentionally.

Recommendation: keep the shared compact header as the default, make no broader migration, and require a surface-specific prototype comparison before any future rebuilt-admin adoption.

Risk if wrong: choosing B can make legacy admin pages unexpectedly oversized; choosing A may leave rebuilt pages technically compliant but still visually underpowered; one-off per-surface overrides would reintroduce typography drift.

Implementation guardrail: pilot a rebuilt-admin variant only, keep the token parity test and computed-size checks, and require side-by-side browser evidence before migrating surfaces. Do not change the default `PageHeader` primitive.

Performance visual result, 2026-07-10 — status: `owner-approved`. The exact 1080px canvas uses the compact header, metrics-first Page Weight composition, dense non-duplicated rows, paired selected-page Mobile/Desktop PageSpeed cards, isolated Single/Bulk bodies, and Top-N only in Bulk. Weight and bulk detail Drawers, the secondary Bulk workflow, full provider evidence, and the no-fabricated-row-fix boundary remain explicit production exceptions. Swish provides real Page Weight evidence but no current PageSpeed snapshots; the empty state was captured truthfully and populated order remains fixture-covered. Evidence under `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/performance/` passed fresh Sol review with `PASS`. Joshua approved the composition and truthful empty state.

### Cockpit Visual Result

Source-led result, 2026-07-10 — status: `owner-approved`.

The corrected Cockpit uses the prototype's capped 1168px spine, compact workspace context and topbar actions, verdict-first hero, three-stream band, 702/434 work/evidence split, first-name client framing, and weekly evidence order. Activity opens as one 560px DS Drawer; seeded work orders continue to open the one production full-screen workflow. `stream=unclassified` remains the truthful Risk receiver, all outbound capability homes remain exact-once, and mobile has no page-level horizontal overflow.

Intentional exceptions: the prototype-only Send update action has no receiver and is omitted; Promote to signal remains deferred under `SB-002` / `DEF-cockpit-002`; production stream/source filters and truthful funnel stages remain available; sparse owner data is not padded; and the carried-over work-order workflow remains a legacy full-screen modal. Paired 1440x900 and 1600x1000 captures plus Activity, work-order, and mobile evidence under `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/` passed a fresh Sol rendered review with `PASS`. Joshua approved the composition and documented exceptions.

### ODP-011 Rebuilt Sidebar Prototype Zone Parity

Surface family: rebuilt admin shell / `RebuiltSidebar`
Contract: `docs/ui-rebuild/parity/coverage-audit.md`

Decision: accepted 2026-07-09. Mirror the prototype nav zones inside the rebuilt sidebar presentation while preserving route ids and global registry semantics.

Implementation choice:

- The rebuilt sidebar now renders top Cockpit/Insights, Strategy & Content, Search & Site Health, Optimization, Client-facing, and Admin zones.
- Sidebar-only label overrides are allowed for prototype parity: `home` -> Cockpit, `seo-strategy` -> Insights Engine, `seo-keywords` -> Keywords, `content-pipeline` -> Content Pipeline, and `media` -> Asset Manager.
- `competitors` is surfaced in the rebuilt sidebar's Strategy & Content zone as a local presentation item without adding it back to the global `NAV_REGISTRY`.
- Optimization stays on `var(--teal)`, not prototype purple, because the current design-system rule reserves purple for admin AI-only surfaces.
- Action Results and Requests are mapped into Client-facing as the current production equivalents of the prototype's client-facing zone. Content Performance is suppressed as a duplicate flag-on destination because Pipeline Published is its owner-approved receiving home; its registry identity remains for flag-off compatibility.

Final receiving-home decision: `page-intelligence` remains a standalone route and is now a direct rebuilt mount. `content-perf` remains a compatibility route and registry identity, but its flag-on presentation folds into Pipeline Published while flag-off retains the legacy page. Both are tracked by final `ODP-012`; the rebuilt sidebar presents Page Intelligence and suppresses the duplicate Content Performance destination.

### ODP-012 Page Intelligence / Content Perf Rebuilt Coverage

Surface family: route coverage / admin nav
Contract: `docs/ui-rebuild/parity/coverage-audit.md`

Accepted decision: **B**, subject to the `ODP-012` receiving-home review above.

Pre-implementation proof finding: both routes were standalone `NAV_REGISTRY` entries and real `Page` values, and neither was then mounted in `REBUILT_SURFACES`. Page Intelligence was not safe to fold: the Rinse fixture exposed 12 pages there but only 11 Manual/read-only SEO Editor rows, omitting the strategy-only `/`, and the Research Drawer did not receive its broader `PAGE_ANALYSIS` job, content/readability evidence, keyword edits, rank tracking, local visibility, fix queue, SEO-copy set, Guide, or handoffs. Content Pipeline Published was the right future `content-perf` compatibility receiver because it read the same report and improved item/outcome joinback, but the initial proof queue still hid aggregate impressions/sessions and daily impressions, lacked an item URL receiver, called an unsupported refresh POST, needed honest matrix-trend handling, and had to route only when the rebuilt flag was on. The implementation and owner-resolution logs below supersede those gaps without erasing why the conservative split was chosen.

Options:

- A. Build standalone rebuilt contracts/surfaces for both routes.
- B. Recommended for prototype parity review: decide whether Page Intelligence belongs inside SEO Editor / Insights Engine, and whether Content Perf belongs inside Content Pipeline Published / Analytics Hub, then preserve old route ids as compatibility receivers.
- C. Keep both legacy for now and mark them out of scope for the rebuilt parity sweep.

Recommendation rationale: the prototype consolidates published-content evidence into the lifecycle/readback workflow, and Content Pipeline now has that truthful home using existing data. Page Intelligence is a higher-risk fold because its analysis and handoff surface is broader than the current Research Drawer. Preserve both standalone routes while these receiving homes are proved rather than redirecting on visual similarity alone.

Risk if wrong: standalone rebuilds may perpetuate prototype drift; aggressive folding may bury workflows operators still use directly.

Final implementation guardrail: preserve Page Intelligence as a standalone direct mount with flag-off legacy rendering; preserve the `content-perf` Page and nav identity, and redirect it into Pipeline Published only when `ui-rebuild-shell` is on. Do not retire either route identity or begin staging extraction without a separately authorized, surface-scoped shipping PR and the route-removal checklist.

Initial implementation log, 2026-07-09: Content Pipeline Published was accepted as the proposed Content Performance receiver because its proof queue already read the shared content-performance data; `/content-perf` remained a standalone production route. Page Intelligence remained standalone until a later capability proof. No route id, registry entry, or redirect changed in that initial checkpoint.

Receiving-home implementation log, 2026-07-10/11: **Page Intelligence is preserved as the standalone `ODP-012 B` exception and added as the 27th direct rebuilt mount.** Its master/detail Research workbench preserves Pages, Architecture, Guide, single/bulk analysis, progress/cancel, keyword edit/tracking, local/rank evidence, SEO copy, and exact-once Brief/Schema/SEO Editor handoffs; validated `?tab=` and `?page=` initialization preserve refreshable identity while flag-off keeps the legacy component. **Content Performance now folds into Pipeline Published only when the rebuilt flag is on.** The receiver restores authoritative summary and item evidence, paired daily clicks/impressions trend, stable `?item=` initialization, typed matrix/request availability, bounded read refetch, and public scrubbing; flag-off retains legacy Content Performance and its nav entry. A durable refresh job, real matrix trend history, and prototype-only Add to Insights remain separate backend choices, not simulated controls.

Owner resolution, 2026-07-11: after reviewing the receiving-home TL;DR, Joshua explicitly replied **“Approved.”** Page Intelligence and the folded Content Performance receiving home are `owner-approved`. The rendered reviews and automated gates remain supporting evidence only.

## Post-Parity Audit Owner Circle-Backs — 2026-07-11

The independent functionality, runtime-wiring, AI-intelligence, and optimization audit found no P0 loss, and its safe repairs are implemented. It also surfaced seven material choices that were not part of the earlier visual approvals. Their decision status is `awaiting owner approval`; they must not be silently converted into approved exceptions.

| ID | Decision status | Recommended direction | Why it is owner-gated |
|---|---|---|---|
| `AUD-D1` | `awaiting owner approval` | Keep Insights Engine Backing Moves active-only, and add collapsed Operations groups for Weekly Briefing review, terminal recommendation history with un-dismiss/full OV-EMV review, and SEO Change Impact. | The current rebuilt queue receives all recommendation rows while only staging eligibility filters terminal states; restoring the legacy-only workflows changes Engine composition and capability grouping. |
| `AUD-D2` | `awaiting owner approval` | Keep Search/GA4 metrics in Search & Traffic, and add only a compact Cockpit secondary band for the unique organic traffic value, content velocity, and overall-health decisions. | Two plausible compositions either duplicate provider metrics or omit unique Cockpit decisions. |
| `AUD-D3` | `awaiting owner approval` | Add a compact rebuilt-shell connection-health strip/footer; otherwise approve the missing legacy StatusBar as an explicit exception. | The prior deferral's Phase A trigger has fired, and NotificationBell does not expose API/Webflow connection state. This changes the shared shell composition. |
| `AUD-D4` | `awaiting owner approval` | Add a compact impressions/sessions secondary row to Pipeline Published; otherwise explicitly approve their current card/Drawer-only home. | Both values remain reachable, but the first summary viewport differs materially from legacy Content Performance. |
| `AUD-D5` | `awaiting owner approval` | Keep operational monthly-digest generation current-month-only with honest no-data output; treat durable historical snapshots as a later backend project. | Changing the time authority affects what past reports claim and requires a durable storage contract for a stronger alternative. |
| `AUD-D6` | `awaiting owner approval` | Hash the POV's actually used evidence and effective voice, expose `refresh available`, never overwrite operator edits automatically, and remove unused prompt slices. | This changes AI cache/refresh semantics and requires a bounded backend follow-up. |
| `AUD-D7` | `awaiting owner approval` | Make shared Tooltip overlay-aware so Asset Manager help remains above an open Drawer. | The safe fix changes a shared design-system overlay rule rather than one local surface. |

## Optional Later Decisions

These behavior-safe defaults were accepted on 2026-07-09. Their source-led correction passes were owner-approved on 2026-07-10 and remain explicit exceptions:

- Schema exact inline page cards versus the current detail Drawer.
- Links row-level Insert versus current copy/send until write target is explicit.
- Performance exact inline Page Weight expansion and side-by-side speed cards.
- Keyword Hub trend/KPI polish once server-owned read models exist.

## Schema, Links, Competitors, and Keyword Hub Visual Result

Source-led result, 2026-07-10 — status: `owner-approved` for all four surfaces.

- Schema uses the prototype's 1080/1020 Generator geometry and first-viewport order plus a calibrated five-row Workflow Guide. Real schema counts stay truthful; the production page-detail Drawer remains the explicit inline-card exception.
- Links uses the prototype's 1120/1060 workshop, compact tray, 3/3/3/6 metric patterns, dense per-lens bodies, bounded Architecture tree, and collapsed evidence bands. Copy/send remains the honest alternative to unsupported direct Insert.
- Competitors uses the prototype's 1120/1060 single-stack hierarchy from Alerts through Backlinks and truthful provider/setup states. The full populated composition is protected by fixture-backed tests because local DataForSEO credentials are unavailable.
- Keyword Hub uses the prototype's left-aligned 1128px canvas, truthful four-KPI band, five-lens tray, dense tables/groups, bounded Lifecycle board, and 440px Drawer. Unsupported row trends and period deltas are not fabricated.

All four passed fresh Sol review with `PASS` after exact 1440x900 and 1600x1000 comparison, important-interior checks, computed geometry/overflow inspection, focused component coverage, hooks lint, typecheck, and parity checks. Joshua explicitly approved all four with their documented exceptions.

## Active Closure Slice

The registry-wide paired-evidence archive and consolidated decision record are complete at `docs/ui-rebuild/parity/registry-final-owner-review.md`. The original 26-route approval remains intact, and the later Page Intelligence / Content Performance receiving-home bundle is also owner-approved under final `ODP-012 B`. The post-parity functionality, wiring, AI-intelligence, and optimization audit has implemented its safe repairs, and the clean current all-project suite passed 2,061 files / 28,817 tests. `AUD-D1` through `AUD-D7` still await Joshua's decision, and the bundle ratchet still requires an explicit disposition. Commit each owner-approved surface family separately; do not push, open a PR, or start staging extraction during this goal.
