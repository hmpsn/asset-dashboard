# Content Pipeline Prototype Parity Contract

Surface: `content-pipeline` / Content Pipeline  
Owner: content strategy / content production workflow  
Status: `owner-approved`; Joshua approved the corrected desktop/interior composition and documented exceptions on 2026-07-10
Primary route: `/ws/:workspaceId/content-pipeline`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/pipeline.js`
- Brief workspace source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/brief-workspace.js`
- Draft/review workspace source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/draft-workspace.js`
- Historical UX review: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/guidelines/ux-review-content-pipeline.html`
- Existing rebuilt implementation: `src/components/content-pipeline-rebuilt/ContentPipelineSurface.tsx`
- State hook: `src/components/content-pipeline-rebuilt/useContentPipelineSurfaceState.ts`
- Current component test: `tests/component/content-pipeline-rebuilt/ContentPipelineSurface.test.tsx`

## Required Interaction Model

The prototype is a lifecycle board, not a set of peer tabs. Its opening comment is explicit: the shipped product split one lifecycle across Planner, Calendar, Briefs, Posts, and Publish, while the prototype collapses that into a board whose columns are the content lifecycle.

The canonical prototype structure is:

1. Header
   - Title: Content Pipeline.
   - Short operator-facing subcopy.
   - Subscription/capacity meter.
   - Mode switcher for Board, Calendar, Published, Content Health, and Matrix-style work.

2. Intake lane
   - Collapsed by default.
   - Sources include client requests, AI suggestions, strategy work orders, decay refreshes, and matrix/planning items.
   - Each intake card can start work, send to client, or dismiss.

3. Lifecycle board
   - Active board columns are `queued`, `brief`, `draft`, and `review`.
   - Scheduled pieces move to Calendar mode.
   - Published pieces move to Published/results mode.
   - Cards expose the next action: Generate brief, Write draft, Run AI review, Approve.

4. Detail/workspace behavior
   - `queued` and `brief` pieces open the full-page Brief Workspace.
   - `draft` and `review` pieces open the Draft Workspace.
   - Published/result items open a right-side detail drawer.
   - The prototype detail drawer includes stage strip, brief details, six-gate AI review, published outcome readback, and footer actions.

5. Capacity/subscription behavior
   - The capacity meter opens a subscription drawer.
   - The subscription drawer owns recurring monthly package details, plan choice, topic source, pause/resume, and cancellation.

The source-led 2026-07-10 baseline uses the right production components but still has a different interaction model:

- It exposes the correct five visible modes, but in a separate full-width toolbar while four production actions occupy the page header.
- Five summary tiles take the opening viewport even though the prototype moves directly from compact controls to Intake and the lifecycle.
- Its four columns contain aggregate launchers rather than the seven real briefs and three real posts available in the owner fixture.
- Clicking an aggregate Brief or Draft launcher appends the legacy manager below the Board rather than opening an item-focused workspace.
- Content capacity opens the full inline subscription receiver rather than a Drawer.

Initial grade: `behavior mismatch` plus `capability risk`.

## Source-Led Desktop Discrepancy Matrix — 2026-07-10

| Area | Prototype | Rebuilt baseline | First-pass correction |
|---|---|---|---|
| Canvas | 1156px content at 1440; capped at 1188px at 1600 | 1156px at 1440; expands to 1316px at 1600 | Adopt the existing page-max boundary without changing shell geometry. |
| Opening hierarchy | 23px title, short context, capacity and compact modes in one composition | 22px `PageHeader`, four page-body actions, separate toolbar | Use the compact surface header; host Export/Refresh/Guide exact-once in rebuilt chrome with an isolated fallback; keep capacity and modes together. |
| First viewport | Intake at y≈245; item Board at y≈311 | Toolbar at y≈147, five summary tiles at y≈206, aggregate Board at y≈305 | Remove the opening KPI strip and give the same vertical budget to real work cards. |
| Intake | Compact collapsed lane; real source cards when expanded | Disclosure backed only by AI suggestions; fixture reads zero despite three requests | Compose truthful requests, suggestions, work orders, and decay/brief opportunities from existing reads; do not invent sources. |
| Board | Four item-backed columns with source, age, title, keyword, type, status, and next action | Four columns with one aggregate launcher per populated stage | Derive and deduplicate item stages frontend-only; render every real item once. |
| Brief | Full-screen queued/filled authoring workspace | Full Brief manager appended beneath Board | Open a local full-screen shell focused on one real brief, preserving the complete production editor and mutations. |
| Draft / review | Full-screen three-pane reading/review workspace | Full Post manager inline, with `?post=` opening the real editor | Open the real selected Post editor in a full-screen shell; preserve `?post=` and every production action. |
| Capacity | Compact meter opens a 440px subscription Drawer | Header button changes to an inline subscription page | Mount the existing `ContentSubscriptions` receiver exactly once inside the canonical 440px Drawer. |
| Calendar | Dense scheduled/live calendar | Rich production calendar with more artifact types and scheduling controls | Compact the outer composition while preserving the broader production capability set. |
| Published | Four summary stats, outcome cards, result detail | Five metrics, proof block, table, 760px detail Drawer | Recompose only from real readbacks; the owner fixture truthfully remains empty. |
| Content Health | Maintenance explanation, three stats, per-row refresh action | Five stats plus acting table | Match hierarchy/density; use the existing `Draft refresh brief` path until a queue endpoint exists. |
| Matrix | Source implements templates/matrix but does not render a mode button | Fifth visible mode with full production builder | Retain Matrix as a production exception; hide unsupported no-op controls and keep real builder/detail actions. |

Fixed-viewport measurement evidence: `/tmp/asset-dashboard-codex-visual-parity/content-pipeline/baseline/prototype-geometry.json` and `rebuilt-geometry.json`. Corrected evidence is under `/tmp/asset-dashboard-codex-visual-parity/content-pipeline/final-pass2/`, including `board-default-1440.png`, `board-default-1600.png`, `brief-workspace-1440-v2.png`, `draft-workspace-1440-v2.png`, `review-workspace-1440-v2.png`, capacity, Calendar, Published, Content Health, Matrix, and the 390px usability floor.

Real owner-workspace evidence is sufficient for honest frontend composition: three in-progress requests, seven rich draft briefs, and three posts (two Draft, one Review). The same workspace has zero subscriptions, matrices, suggestions/work orders, planned posts, or published readbacks; those states must remain truthful empties in owner screenshots while populated behavior stays under component fixtures.

Source-led correction implemented:

- Bare `/content-pipeline`, invalid-tab fallback, and `?tab=briefs` open the real four-column lifecycle Board with Intake collapsed by default.
- Board stages derive only from persisted requests, briefs, and posts. Linked artifacts are deduplicated, and Intake separately composes truthful requests, suggestions, work orders, and refresh opportunities.
- Seven owner-fixture work items render once across Brief, Draft, and Review; Queued truthfully remains empty.
- New piece opens one blank full-screen Brief generator. Persisted Brief cards open one filled three-rail Brief workspace with the real editor and each mutation/export action exactly once.
- Draft and Review cards open the selected real Post editor in three-rail workspaces. Embedded aggregate navigation is removed, the editor header reflows without crushing the title, and closing a Board-opened item returns to the Board.
- Content capacity mounts `ContentSubscriptions` exactly once in the canonical 440px Drawer. The direct `publish`/`subscriptions` compatibility receiver remains valid.
- Calendar, Published, Content Health, and Matrix use the compact prototype hierarchy while retaining broader truthful production controls and empty states.
- The 1440×900 and 1600×1000 canvases have no document overflow; the 390px floor contains horizontal scrolling inside the Board only. Fresh Sol review returned `PASS` with no safe-local defects.

## URL and Deep Links

Implemented route/state behavior:

- `/ws/:workspaceId/content-pipeline` and `?tab=briefs` open Board with Brief focused and no inline Briefs receiver until the operator launches it.
- Valid `?tab=` values are `planner`, `calendar`, `intake`, `briefs`, `posts`, `publish`, `content-health`, and `published`.
- Invalid `?tab=` values fall back to `briefs`.
- `?tab=subscriptions` is a legacy alias that resolves to `publish`.
- A Board card can open `?post=...` without changing its current lens, so closing returns to the Board.
- Explicit `?tab=posts&post=...` deep links retain the legacy Posts receiver and clear only `post` when its editor closes.
- Calendar can deep-link to `?tab=posts&post=<postId>`.
- Intake can route an AI-suggested opportunity into `?tab=briefs` with fix context intact.

Legacy route behavior outside this component:

- `/seo-briefs` redirects to `/content-pipeline?tab=briefs`.
- `/content` redirects to `/content-pipeline?tab=posts`.
- `/calendar` redirects to `/content-pipeline?tab=calendar`.
- `/subscriptions` still mounts `ContentSubscriptions` directly in the legacy admin route path and should be reviewed before any route retirement.

Implemented compatibility mapping:

- Existing `?tab=` values remain valid and map to prototype modes or focused/open states instead of eight peer receivers.
- Mapping:
  - no tab / `?tab=briefs` -> Board mode, brief stage focused.
  - `?tab=intake` -> Board mode with Intake expanded.
  - `?tab=posts&post=...` -> Board or Draft Workspace with the selected post opened.
  - `?tab=calendar` -> Calendar mode.
  - `?tab=published` -> Published mode.
  - `?tab=content-health` -> Content Health mode.
  - `?tab=planner` -> Matrix/planning mode or planning section.
  - `?tab=publish` / `?tab=subscriptions` -> Capacity/subscription drawer or capacity-focused mode.
- Preserve the legacy route redirects exactly unless a separate route-removal plan is approved.

## Carry-Over Homes

Keep these production capabilities reachable exactly once while the IA is corrected:

- `ContentPlanner`: planning/matrix mode or an overflow planning workspace.
- `ContentCalendar`: Calendar mode.
- `AiSuggested`: Intake lane or Intake expanded state.
- `ContentBriefs`: one blank or persisted item-backed Brief Workspace.
- `ContentManager`: one selected Draft/Review Workspace; the direct `?tab=posts` aggregate remains a compatibility receiver.
- `ContentSubscriptions`: subscription/capacity drawer or Publish/capacity workspace.
- `ContentHealthLens`: Content Health mode.
- `PublishedContentLens`: Published/results mode.
- `ContentPipelineGuide`: guide drawer, with user-facing workflow copy only.

These homes remain reachable while the corrected item workspaces await Joshua's visual approval.

## Moved, Excluded, or Deferred

- Published outcome readback belongs in Content Pipeline Published mode and should deep-link or graduate to Insights Engine where appropriate, not duplicate the Engine recommendation queue.
- Content execution stays in Content Pipeline; Insights Engine should link into it, not reimplement content management.
- Keyword targeting and ranking execution stay in Keyword Hub.
- Client requests and inbox decisions remain in their existing client/admin homes unless a separate content-intake contract moves them.
- Do not add backend APIs, migrations, shared types, route ids, or new feature flags for the parity pass unless the approved implementation proves a server-backed requirement.
- Do not delete or materially rewrite `ContentBriefs`, `ContentManager`, `ContentCalendar`, or `ContentSubscriptions` in the parity slice. Wrap or re-home them first.
- Do not simulate prototype-only per-field AI assistance, client questionnaire, granular generation theater, client reminder, `Add to Insights`, Matrix bulk generation, or per-row `Queue refresh`; each lacks a current production contract.
- Retain Matrix as the fifth production mode even though the prototype source describes and implements it but omits its mode button.
- Preserve the production Calendar's briefs, requests, matrices, scheduling, and unscheduling controls even though the prototype calendar visualizes only scheduled and published pieces.

## Implemented Owner Decision

Decision `ODP-002 C` remains the route/capability boundary; the separately reviewed visual pass now supplies the item-backed Brief, Draft, and Review workspaces. Joshua owner-approved this pass with its documented exceptions on 2026-07-10; the automated review remains supporting evidence only.

Options:

- Recommended: make Board the default visible model, remove the peer tab strip from the primary page, use prototype mode controls for Calendar/Published/Content Health/Matrix, and preserve current `?tab=` values as mode/focus/open-state compatibility.
- Conservative: keep the current receiver tabs for now, continue safe copy/style cleanup, and defer the board/workspace rewrite until the content production workflow has a dedicated implementation slice.

Risk if wrong:

- Collapsing the receivers without approval may disrupt existing production workflows for briefs, posts, subscriptions, calendar scheduling, and published readback.
- Keeping the receiver shell leaves the largest prototype mismatch unresolved and risks another page that looks cleaner but still behaves unlike the prototype.

Pre-decision safe work completed:

- Visible internal labels such as `?tab= receiver`, `subscriptions alias`, `mounted below`, `carried-over mode`, `shell owns`, and `Post receiver` were replaced with operator-facing language.
- The header now stacks actions and lets the subtitle wrap on narrow viewports so the page title and explanatory copy remain readable on mobile.
- Published mode now includes a prototype-style proof queue that summarizes readbacks and wins ready to graduate into Insights Engine, using existing content-performance readback data only.
- Component coverage now asserts that internal rebuild/migration terms are absent from the loaded shell.
- Existing tests still prove flag transition, deep links, legacy alias, exact-once mounted receivers, fix-context handoff, and a11y.

Later low-risk polish:

- Responsive and typography polish that does not change capability homes.
- Browser smoke of the current state for desktop, mobile, deep link, and guide drawer.
- Better prototype-like summaries using existing data, as long as they do not imply board/workspace behavior that is not implemented.

## Owner-Approved Content Performance Receiving Home — 2026-07-11

Final `ODP-012 B` makes Pipeline Published the Content Performance receiving home only while `ui-rebuild-shell` is on. `/content-perf?item=...` replace-navigates to `content-pipeline?tab=published&item=...`; the rebuilt sidebar and flag-aware command palette suppress the duplicate destination. With the flag off, legacy Content Performance and its nav entry remain intact. The `Page` and `NAV_REGISTRY` identities are intentionally retained.

Published now uses the authoritative shared content-performance read model: four compact summary cells, verdict-led result cards, keyword/page-type/publish-age context, filters/sort, stable item identity, and one production Drawer for paired clicks/impressions trend, GA4 evidence, brief execution, coverage, and outcome joinback. Daily trend loads only after deliberate Drawer open; Re-scan is a read refetch; missing matrix/request/provider evidence returns typed availability; public projections omit admin outcome internals. The owner workspace remains truthfully empty while populated composition is fixture-protected.

Joshua explicitly approved the Page Intelligence / Content Performance receiving-home bundle on 2026-07-11. Automated review and fixed-viewport evidence under `/tmp/asset-dashboard-codex-visual-parity/content-performance/` support but do not replace that approval.

Post-approval `AUD-D4` remains `awaiting owner approval`: add a compact impressions/sessions secondary summary row, or explicitly approve those metrics remaining on result cards and in the Drawer. This new circle-back does not silently modify the settled receiving-home approval.

## Browser Smoke Checklist

Final source-led browser result against the owner workspace at both fixed desktop viewports:

- Board geometry: heading x258/y80, Intake/Board y248, 1150px content at 1440 and capped 1180px content at 1600.
- Intake expands in place and renders its one real suggestion once; Queued remains truthfully empty.
- Blank New piece, filled Brief, Draft, and Review each open exactly one full-screen Drawer with one `main` landmark and no document overflow.
- Filled Brief actions audit: one Copy for AI Tool, one Export PDF, and one Delete brief.
- Draft/Review omit the embedded aggregate Back/Close controls; closing the outer workspace restores the Board rather than the legacy Posts manager.
- Capacity is one 440px Drawer. Calendar, Published, Content Health, and Matrix all initialize from their URL state and render without document overflow.
- Mobile 390×844 keeps document width at 390px and confines the lifecycle's horizontal movement to its internal Board scroller.
- Preview console contained no warnings/errors beyond Vite/React development messages.
- Evidence root: `/tmp/asset-dashboard-codex-visual-parity/content-pipeline/final-pass2/`.

## Registry Closeout Evidence

The measured registry archive adds exact 1440x900 and 1600x1000 prototype captures for Board, Brief, Draft, Review, capacity, Calendar, Published, and Content Health under `/tmp/asset-dashboard-codex-visual-parity/registry-final/prototype/`. Matching rebuilt 1600x1000 interiors are under `/tmp/asset-dashboard-codex-visual-parity/registry-final/rebuilt/`; the previously reviewed exact 1440x900 pass remains authoritative. The prototype's New Piece control has no implemented interior beyond its trigger, so the richer production intake/workspace flow remains an explicit capability exception rather than a missing pair.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Content Pipeline.
- `?tab=published` renders `PublishedContentLens`.
- Calendar -> `?tab=posts&post=...` mounts Posts and clears only `post` on close.
- Intake -> Briefs preserves fix context.
- Invalid `?tab=` falls back to Briefs.
- `?tab=subscriptions` aliases to Publish/Subscriptions.
- Each legacy receiver mounts without duplicating the page title and keeps embedded controls reachable.
- Published mode renders the proof queue, win-ready label, and Insights Engine graduation explanation with `.t-body` copy.
- Internal rebuild/migration language is absent from the visible shell.
- The rebuilt a11y floor passes.

The source-led pass additionally proves:

- Default and `?tab=briefs` render Board instead of the Briefs receiver.
- Intake expands from both the default Board and `?tab=intake`, with the existing workflow mounted exactly once.
- Item-backed Brief, Draft, and Review cards open the existing owning editor exactly once without duplicating actions or the page title.
- A Board-opened post preserves Board as its return lens, while explicit `?tab=posts&post=...` compatibility links retain their legacy receiver.
- Blank and persisted Brief workspaces, Draft/Review rails, and the capacity Drawer mount once and preserve their mutations.
- Board, Calendar, Published, Content Health, Matrix, Posts, capacity, and legacy aliases preserve their URL/open-state contracts.
- Existing legacy panels remain reachable exactly once while being re-homed.

No safe-local visual defects remain from fresh Sol review. Joshua explicitly owner-approved the surface with its documented exceptions on 2026-07-10.
