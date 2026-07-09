# Insights Engine Prototype Parity Contract

Surface: `seo-strategy` / Insights Engine  
Owner: `workspace-command-center` with strategy/recommendation context ownership  
Status: `ODP-001 A` accepted 2026-07-09; single-spine IA correction approved  
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
   - "What changed" diff from the prior run.

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

## Current Rebuilt Gap

The rebuilt surface has the right raw ingredients but uses a different IA:

- A top-level `LensSwitcher` splits the page into `spine`, `changes`, `signals`, `pov`, `moves`, and `operations`.
- The prototype puts those sections in one scrollable spine and reserves lens switching for the keyword-targets/content-work-orders projection.
- Operations currently contains many carry-over panels in one large disclosure, echoing the UX-review concern that the old admin cockpit had a "drawer of everything."
- The page has both a header Send Issue action and a docked send bar when staged moves exist. This is good directionally, but the correction should prove the send action stays close to the staged queue while avoiding duplicate-action confusion.
- The current spine lens now includes the prototype's client trust-spine preview, but the surrounding page still uses the split-lens IA until the accepted single-spine correction is implemented.

Initial grade: `behavior mismatch`, with the single-spine correction approved and queued.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/seo-strategy` opens the `spine` lens.
- `?lens=spine|changes|signals|pov|moves|operations` renders that lens.
- Invalid `?lens=` falls back to spine and shows a warning.
- Legacy `?tab=overview` redirects to `?lens=spine`.
- Legacy `?tab=content` redirects to `content-pipeline?tab=content-health`.
- Legacy `?tab=rankings` redirects to `seo-keywords?lens=rankings`.
- Legacy `?tab=competitive` redirects to `competitors`.

Recommended parity direction, if approved:

- Keep `?lens=` valid, but treat it as section-open/focus state inside the single spine instead of a top-level tab replacement.
- Preserve all legacy `?tab=` redirects exactly as they are.
- Use a secondary param such as `projection=keywords|content` only if the staged-move projection lens needs URL state.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- `DraftedPovEditor`: inline in the client-facing POV section.
- `BackingMovesQueue`: inline in the backing moves section.
- `EngineMoveDrawer`: opens from a move row as the recommendation detail workflow.
- `AddRecommendationModal`: opens from the backing moves queue action.
- `StrategyDiff`: "What changed" section/disclosure.
- `IntelligenceSignals`: strategy evidence section.
- `LostQueryRecoveryCard`: strategy evidence section.
- `ContentWorkOrderLens`: projection lens or operations disclosure, but not duplicated.
- `KeywordTargetsLens`: projection lens or operations disclosure, but not duplicated.
- `StrategyConfigPanel`, `IssueSetupReadiness`, `TrustLadderPanel`, `AdminLeadsReadout`: operational disclosure/readiness area.
- `LocalSeoMarketSetupDrawer`: operations action.

## Moved, Excluded, or Deferred

- Content execution belongs to `content-pipeline`; Engine should deep-link, not duplicate content management.
- Keyword execution belongs to `seo-keywords`; Engine should deep-link, not duplicate keyword table management.
- Competitor management belongs to `competitors`.
- Diagnostics belong to `diagnostics`.
- Do not add backend APIs, migrations, shared types, route ids, or new feature flags for this IA correction.
- Do not rewrite recommendation lifecycle behavior in this parity slice.

## Needs Owner Decision

Decision: should the rebuilt Engine collapse the top-level lens tabs into a prototype-style single spine now?

Options:

- Recommended: remove the visible top-level `LensSwitcher`, render the prototype sections in one scroll, and preserve `?lens=` as section focus/open state for compatibility.
- Conservative: keep the visible top-level lenses for now and only polish section styling, which preserves current behavior but leaves the largest prototype mismatch in place.

Risk if wrong:

- Removing top-level lenses without approval may disrupt operators who already rely on the current rebuilt split-view workflow.
- Keeping top-level lenses makes this surface visibly cleaner but still behaviorally off-prototype, repeating the Brand & AI mistake at a higher-risk strategy surface.

Safe work completed while awaiting decision:

- Component tests now cover legacy tab redirects, move drawer exact-once mounting, Add Recommendation modal mounting, send action state, no internal labels, and rebuilt a11y.
- The Engine header actions now stack on narrow viewports so the action row does not clip on mobile.
- The shared `CommandCenterVerdict` meta row now wraps on narrow viewports so Engine/Cockpit verdict badges do not squeeze against the eyebrow.
- The current spine lens now includes the prototype's "What the client sees - the trust spine" preview using existing strategy POV and money-frame data, with fallback copy when the POV or cached money frame is missing.
- Current-state browser smoke has been captured for desktop, mobile, deep link, legacy redirect, Add Recommendation modal, and move drawer states.

Safe work still available while awaiting decision:

- Do not collapse the lenses until the IA decision is accepted.

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
- The visible top-level lenses remain the primary parity mismatch and should not be treated as resolved by the responsive fixes.

Post-correction smoke, if the single-spine direction is approved:

- Desktop single spine, with no visible top-level lens tabs.
- Mobile single spine, with no clipped header/action row.
- `?lens=signals` opens/focuses the signals section without hiding the rest of the spine.
- Projection lens switches Keyword targets / Content work orders in place.
- Move drawer and Add Recommendation modal still open exactly once.

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

Required future coverage if the IA correction is approved:

- If the IA correction is approved, `?lens=` becomes section-open/focus state rather than exclusive top-level tab rendering.
