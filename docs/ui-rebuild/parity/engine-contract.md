# Insights Engine Prototype Parity Contract

Surface: `seo-strategy` / Insights Engine  
Owner: `workspace-command-center` with strategy/recommendation context ownership  
Status: calibration accepted by final independent Sol Ultra review; owner visual re-review remains an open circle-back
Primary route: `/ws/:workspaceId/seo-strategy`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/strategy.js`
- Prototype screenshots: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/screenshots/strategy-signals.png` and `strategy-signals2.png`
- UX review source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/guidelines/ux-review-admin-cockpit.html`
- Existing rebuilt implementation: `src/components/engine-rebuilt/EngineSurface.tsx`
- State hook: `src/components/engine-rebuilt/useEngineSurfaceState.ts`
- Current component test: `tests/component/engine-rebuilt/EngineSurface.test.tsx`

## Required Interaction Model

The prototype is a single strategy spine, not a tabbed workspace. The operator should move down the page in this order:

1. Orientation and verdict
   - Client-scoped eyebrow: `Insights Engine · {client}`.
   - One verdict headline and short explanation.
   - Staleness and "what changed" nudges above the verdict when needed.

2. Value frame
   - Pipeline value at stake.
   - Recovered so far.
   - Backing moves live.
   - Average position or equivalent strategy momentum.

3. Client-facing point of view
   - The editable POV the client will see.
   - Send action remains attached to the staged set, not separated from the queue.

4. Stance allocation
   - Work allocation across demand, protect, technical, and local.

5. Strategy evidence
   - Intelligence signals.
   - Lost visibility / recovery content.

6. Backing moves
   - Grouped recommendations staged into the issue.
   - Stage/cut/edit lifecycle controls remain on the move rows.
   - Move details open a drawer from the row.

7. Projection lenses
   - The only prototype lens switcher is inside "What each staged move becomes".
   - It switches between Keyword targets and Content work orders.
   - Rows deep-link to Keyword Hub or Content Pipeline.

8. Client trust-spine preview
   - Shows what the client will see before send.

9. Operational disclosures
   - Setup/config/trust/readiness tools are reachable, but should not become the primary page structure.

## Implemented Correction And Review Status

The behavior mismatch is corrected:

- The visible top-level Engine `LensSwitcher` is removed; all strategy sections render in one ordered spine.
- Valid `?lens=` values focus their matching section without hiding the rest of the page.
- `What changed` precedes the verdict, while `signals` focuses the evidence section independently.
- The only visible lens control is inside `What each staged move becomes`, where Keyword targets and Content work orders switch inside one `SectionCard` shell.
- Both projections are filtered by the live staged-and-sendable recommendation set, so Stage and Unstage update the shell immediately while unstaged, already-sent, and otherwise unsendable recommendations cannot appear under a staged label.
- The backing queue exposes Stage only for sendable moves. Mixed bulk selections report and submit the sendable subset, so the displayed count, projection rows, and eventual send payload all share one authority.
- The canonical `BackingMovesQueue` owns recommendation detail entry; duplicate Fix-now and move-index queues were removed from the backing-moves section.
- Add Recommendation, move detail, local-market setup, lifecycle actions, and staged-set send behavior remain reachable exactly once.
- Cross-surface work and setup panels remain available under the canonical `Disclosure`; `?lens=operations` opens it automatically.
- The opening is constrained to the prototype's 1180px spine. A compact client-scoped eyebrow replaces the duplicate page header, and refresh/freshness controls remain in that top control cluster instead of interrupting the verdict-to-POV story.
- `?lens=changes` opens `StrategyDiff`, while move detail is read-only evidence so Stage/Fix/Park retain one lifecycle-control home in the backing queue.
- Cannibalization detail is also read-only. Its send, resolve, editor-fix, and keeper-write controls retain one writable home under Operations.
- A keeper write optimistically updates the workspace-scoped keyword-strategy query, rolls back on failure, and invalidates both recommendation and keyword-strategy reads without delaying the mutation callback. Operations renders that query authority directly, so no local overlay can shadow server state or bleed across workspaces.
- Read-only move and signal counts use blue data accents; teal remains reserved for actions and active state.
- The six recommendation archetypes roll into the prototype's four directly labeled 34px allocations: Win demand, Protect, Technical, and Local.
- The four stance groups use their actual move counts as flex proportions; a zero-count group occupies zero width when work exists.
- Backing-move details and lifecycle actions wrap below move copy at narrow widths instead of compressing or overflowing the row.
- The trust-spine preview uses the existing locally scoped light-theme tokens and one horizontal proof row, so it reads as client portal output instead of another admin panel.
- Setup and operator tools render independently of strategy generation, so `?lens=operations` remains a usable open receiver in a cold workspace.
- An explicitly requested Changes receiver shows an honest no-comparison/no-change state instead of focusing a blank wrapper. A failed comparison request renders a distinct retryable error state rather than masquerading as empty history.
- Discussion attention uses the honest `Review move` action and opens the canonical move evidence workflow; it does not promise a reply thread that the surface does not provide.

Joshua's first Wave 1 review returned `revise`: the initial single-spine build preserved too much production-panel composition and did not mirror the prototype closely enough. The corrective composition pass now moves change history above the verdict, uses the existing hero `StatCard` for value at stake, restores a four-cell value frame, applies prototype section labels/subtitles, limits Signals to four initial rows, limits Backing moves to one initial row per archetype with full expansion retained, and unifies the projection wrapper. Seven fresh Sol review rounds then found the wide shell, duplicate page header, collapsed Changes receiver, duplicate move lifecycle controls, hand-rolled operations disclosure, six-bucket micro stance, dark/vertical client preview, mount-only Changes state, transient screenshot references, strategy-gated Operations, blank deep-linked Changes state, cannibalization writes in the evidence Drawer, unstaged or unsendable rows under the staged projection label, stale and locally shadowed keeper state, geometrically false stance segments, non-wrapping move actions, a premature responsive row switch at `sm`, a misleading reply-thread CTA, and comparison failures presented as empty history. Every recorded finding is now corrected. Owner visual re-review remains the acceptance gate.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/seo-strategy` opens the `spine` lens.
- `?lens=spine|changes|signals|pov|moves|operations` keeps the full spine rendered and focuses the corresponding section.
- `?lens=changes` expands the change-history disclosure; `?lens=operations` expands operational tools.
- Invalid `?lens=` falls back to spine and shows a warning.
- Legacy `?tab=overview` redirects to `?lens=spine`.
- Legacy `?tab=content` redirects to `content-pipeline?tab=content-health`.
- Legacy `?tab=rankings` redirects to `seo-keywords?lens=rankings`.
- Legacy `?tab=competitive` redirects to `competitors`.

Implemented parity direction:

- Keep `?lens=` valid, but treat it as section-open/focus state inside the single spine instead of a top-level tab replacement.
- Preserve all legacy `?tab=` redirects exactly as they are.
- Use a secondary param such as `projection=keywords|content` only if the staged-move projection lens needs URL state.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- `DraftedPovEditor`: inline in the client-facing POV section.
- `BackingMovesQueue`: inline in the backing moves section.
- `EngineMoveDrawer`: opens from a move row as a read-only recommendation evidence workflow.
- `AddRecommendationModal`: opens from the backing moves queue action.
- `StrategyDiff`: "What changed" section/disclosure.
- `IntelligenceSignals`: strategy evidence section.
- `LostQueryRecoveryCard`: strategy evidence section.
- `ContentWorkOrderLens`: projection lens or operations disclosure, but not duplicated.
- `KeywordTargetsLens`: projection lens or operations disclosure, but not duplicated.
- `StrategyConfigPanel`, `IssueSetupReadiness`, `TrustLadderPanel`, `AdminLeadsReadout`: operational disclosure/readiness area.
- `CannibalizationTriage`, `KeeperSelector`: writable workflow under Operations only; the move Drawer shows the same issue as evidence only.
- `LocalSeoMarketSetupDrawer`: operations action.

## Moved, Excluded, or Deferred

- Content execution belongs to `content-pipeline`; Engine should deep-link, not duplicate content management.
- Keyword execution belongs to `seo-keywords`; Engine should deep-link, not duplicate keyword table management.
- Competitor management belongs to `competitors`.
- Diagnostics belong to `diagnostics`.
- Do not add backend APIs, migrations, shared types, route ids, or new feature flags for this IA correction.
- Do not rewrite recommendation lifecycle behavior in this parity slice.

## Owner Decision And Circle-Back

- `ODP-001 A` was accepted: collapse the top-level lenses and preserve `?lens=` as section focus/open state.
- Circle-back trigger: revisit if the single spine makes a required review/action materially harder to find, or if the integrated page still reads as stacked production panels rather than the prototype strategy story.
- Triggered 2026-07-09: Joshua found the first implementation visually too far from the prototype. Integration stopped before Wave 2, the first pass was graded `revise`, and the prototype-led composition corrections above were applied.
- Sol review round 2 also returned `revise`; it is resolved by the four-group stance, locally light horizontal trust preview, prop-responsive Changes disclosure, and reproducible browser artifacts listed below.
- Sol review round 4 also returned `revise`; it is resolved by moving cannibalization send/resolve/editor-fix and keeper selection out of the evidence Drawer and into Operations without dropping the capability.
- Sol review round 5 also returned `revise`; it is resolved by staged-set filtering in both projection lenses, immediate keeper propagation plus source-read invalidation, count-driven stance widths, and responsive move-action wrapping.
- Sol review round 6 also returned `revise`; it is resolved by keeping move copy and actions stacked until `xl`, after the rebuilt sidebar and page have enough horizontal room for the full action set.
- Sol review round 7 also returned `revise`; it is resolved by intersecting staging/projection with the sendable set, suppressing and filtering unavailable Stage actions, making keeper state optimistically query-authoritative with rollback, removing the local keeper overlay, replacing the dead-end reply CTA with `Review move`, distinguishing comparison errors from empty history, and strengthening the breakpoint regression assertions.
- Final acceptance review: a fresh Sol Ultra reviewer returned `PASS` after explicitly rechecking the raw `KeywordStrategyRead` React Query cache boundary used by optimistic keeper updates. No behavior, capability, route, responsive, or test defect remains that blocks Wave 2.
- Current owner question: does the revised opening, section framing, and calmer evidence/move density now clear the visual calibration bar? That visual re-review remains logged as a circle-back; the final independent pass and Joshua's instruction to continue clear Engine for use as the Wave 2 worker rubric without recording an owner visual sign-off that has not occurred.

## Browser Smoke Checklist

Baseline smoke before implementation:

- Desktop `/ws/ws_demo_premium/seo-strategy`.
- Mobile `/ws/ws_demo_premium/seo-strategy`.
- Deep link `?lens=signals`.
- Deep link `?tab=rankings` redirects to Keyword Hub rankings.
- Open move drawer from a recommendation row when seeded recommendations exist.
- Open Add Recommendation modal.
- No blank panels, duplicated send actions in the same viewport, hidden capability, internal rebuild labels, or console errors.

Baseline evidence captured in this branch:

- Empty premium desktop: `/tmp/asset-dashboard-codex-parity-captures/engine-desktop-baseline.png`.
- Seeded data desktop: `/tmp/asset-dashboard-codex-parity-captures/engine-desktop-data-baseline.png`.
- Signals deep link: `/tmp/asset-dashboard-codex-parity-captures/engine-signals-deeplink-baseline.png`.
- Legacy rankings redirect: `/tmp/asset-dashboard-codex-parity-captures/engine-legacy-rankings-redirect.png`.
- Add Recommendation modal: `/tmp/asset-dashboard-codex-parity-captures/engine-add-recommendation-modal-baseline.png`.
- Move drawer: `/tmp/asset-dashboard-codex-parity-captures/engine-move-drawer-baseline.png`.
- Mobile after safe responsive fixes: `/tmp/asset-dashboard-codex-parity-captures/engine-mobile-data-header-and-verdict-fixed.png`.
- State payloads: `/tmp/asset-dashboard-codex-parity-captures/engine-baseline-smoke-state.json` and `/tmp/asset-dashboard-codex-parity-captures/engine-mobile-header-and-verdict-fixed-state.json`.
- Trust-spine preview desktop: `/tmp/asset-dashboard-codex-parity-captures/engine-trust-spine-preview-desktop.png`.
- Trust-spine preview focused desktop: `/tmp/asset-dashboard-codex-parity-captures/engine-trust-spine-preview-scrolled-desktop.png`.
- Trust-spine preview state: `/tmp/asset-dashboard-codex-parity-captures/engine-trust-spine-preview-state.json`.

Smoke findings:

- `?lens=signals` renders the current signals lens state without duplicate dialogs, horizontal overflow, visible internal migration labels, or console errors.
- `?tab=rankings` redirects to `/seo-keywords?lens=rankings`, preserving the dissolved legacy tab contract.
- Add Recommendation and move detail still open as exactly one modal/drawer workflow in the current split-lens IA.
- The data workspace (`ws_1772610244629`) is more useful for Engine smoke than `ws_demo_premium`, whose default Engine state can be empty.
- The in-app browser connector timed out during the final refreshed mobile screenshot after the code edits; the final mobile image was captured with the project Playwright runtime against the same local Vite server after the in-app connector had already captured the pre-fix states. Console and DOM state were checked with Playwright for the fallback capture.
- The trust-spine preview smoke rendered on `/ws/ws_1772610244629/seo-strategy` with no horizontal overflow and no visible internal implementation labels. That local workspace had no cached money frame and no server verdict, so the browser evidence shows the preview's fallback state; the component fixture covers the populated value-frame state. The in-app browser connector timed out during this capture, so the preview evidence was captured with bounded local Playwright against the same running preview server.
- At baseline, the visible top-level lenses were the primary parity mismatch; the post-correction evidence below supersedes that finding.

Post-correction smoke:

- Desktop single spine, with no visible top-level lens tabs.
- Mobile single spine, with no clipped header/action row.
- `?lens=signals` opens/focuses the signals section without hiding the rest of the spine.
- Projection lens switches Keyword targets / Content work orders in place.
- Move drawer and Add Recommendation modal still open exactly once.

Latest local browser result:

- Desktop overview renders the POV-derived verdict, hero value-at-stake cell, four-cell value frame, and no top-level Engine lenses.
- `?lens=signals` focuses the evidence section with four initial signal rows and `Show all 44 signals` progressive disclosure in the populated fixture.
- `?lens=moves` focuses one canonical backing-moves queue with one row per archetype, full `Show N more` access, one detail drawer entry, and no duplicate Engine recommendation queue.
- Projection switching occurs inside one section shell.
- Staging the live `H1 — 46 pages` content move makes it appear immediately in Content work orders; Unstage returns the projection to its empty state.
- `?lens=operations` focuses and opens the operational tools; the default route keeps them collapsed.
- Move detail renders rationale and provenance without duplicating Stage/Fix/Park controls from the queue.
- Cannibalization detail renders competing-page and inferred-keeper evidence without write controls; the live populated fixture has no cannibalization issue, so exact-once Operations ownership is pinned by the component fixture.
- Browser console: no errors or warnings. Desktop horizontal overflow: none. Light narrow-width floor: no page-level horizontal overflow; backing-moves header actions stack below `sm`.
- Sol-review correction evidence: `/tmp/asset-dashboard-codex-parity-captures/engine-single-spine-overview-desktop-v2.png` and `/tmp/asset-dashboard-codex-parity-captures/engine-single-spine-move-detail-v2.png`. The overview measures `1180px`, Operations opens exactly once from its deep link, move detail contains no lifecycle buttons, and the browser log contains no application errors or warnings.
- Structural-review evidence: `/tmp/asset-dashboard-codex-parity-captures/engine-single-spine-stance-desktop-v2.png`, `/tmp/asset-dashboard-codex-parity-captures/engine-single-spine-client-preview-v2.png`, and `/tmp/asset-dashboard-codex-parity-captures/engine-single-spine-review-state-v2.json`. The live stance is 34px with four direct labels; the preview resolves to a light `rgb(248, 250, 252)` portal frame with three metrics sharing one row.
- Round-5 correction smoke measured the live stance at `42% / 46% / 12% / 0%` with widths `460 / 506 / 139 / 0px`, and confirmed no page or action overflow at a temporary 480px regression viewport. Narrow-row evidence: `/tmp/asset-dashboard-codex-parity-captures/engine-move-rows-narrow-after-review-v2.png`.
- Round-6 breakpoint smoke confirmed column layout with `394px` of action width at an 800px viewport and a safe row layout at 1280px with `517px` for copy plus `345px` for actions; neither state overflowed.
- Round-7 smoke staged `H1 — 46 pages`, observed the truthful `1 staged` count and Content work-order projection, then unstaged it and confirmed the empty projection returned. A timed clean reload produced no console warnings/errors, no internal migration labels, and no page, main-content, or move-row overflow. State evidence: `/tmp/asset-dashboard-codex-parity-captures/engine-round7-staging-and-console-state.json`.
- Post-capability-move opening evidence: `/tmp/asset-dashboard-codex-parity-captures/engine-post-capability-move-overview-viewport.png`.
- Cold-state evidence: `/tmp/asset-dashboard-codex-parity-captures/engine-cold-operations-deeplink-v2.png`. `ws_demo_premium` has no strategy, yet the deep link focuses one open Operations disclosure with one capability body, no overflow, and no internal labels. The populated workspace's `?lens=changes` renders one visible no-comparison receiver while retaining focus on `engine-what-changed`.

## Automated Test Floor

Existing test coverage already proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Engine.
- Valid `?lens=` values render their current receiver lens.
- Invalid `?lens=` falls back to spine.
- Legacy `?tab=` aliases redirect to the intended routes.

Current branch coverage added before implementation:

- Internal rebuild/migration labels are absent from visible UI.
- Move row opens `EngineMoveDrawer` exactly once.
- Add Recommendation opens `AddRecommendationModal` exactly once.
- Send action remains disabled until staged moves exist and docked send appears when staged.
- Header actions expose the responsive stackable layout required by mobile smoke.
- Spine lens renders the prototype trust-spine preview and asserts styleguide roles for preview eyebrow, client verdict, body copy, value/progress stats, and proof framing.
- Current rebuilt a11y floor passes.

Current correction coverage additionally proves:

- Every valid `?lens=` keeps the full spine visible and focuses its section.
- `changes` focuses the above-verdict change-history receiver; `operations` opens its disclosure.
- `StrategyDiff` honors its deep-link `defaultExpanded` contract in the real component.
- An already-mounted `StrategyDiff` responds when URL-derived open state changes.
- The move drawer is read-only evidence and does not duplicate backing-queue lifecycle controls.
- Cannibalization detail is read-only, while its write controls mount exactly once under Operations.
- `StanceBar` proves the six-to-four rollup, direct labels, percentages, and zero state.
- The trust preview proves locally light portal framing and a three-column proof row.
- A cold strategy fixture proves Operations remains reachable and opens from its deep link.
- Missing comparison history proves a requested Changes receiver renders honest feedback instead of blank space.
- Prototype opening order, hero stat hierarchy, section labels, calmer signal/move density, and exact-once recommendation drawer entry are pinned.
- Projection content mounts exactly once inside the only visible lens control.
- Projection rows are filtered by the staged-and-sendable recommendation set; unavailable rows cannot expose Stage, and mixed bulk Stage submits only the sendable subset.
- Keeper writes optimistically update the workspace query, roll back on failure, invalidate both source reads without delaying success callbacks, and render without a local shadow layer.
- Discussion attention opens the canonical move review with honest copy, comparison failures render a retryable error distinct from empty history, stance width follows count, and move action clusters stay stacked until `xl`.
