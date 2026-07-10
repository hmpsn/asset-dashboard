# Content Pipeline Prototype Parity Contract

Surface: `content-pipeline` / Content Pipeline  
Owner: content strategy / content production workflow  
Status: `behavior-safe / visual-unverified`; `ODP-002 C` first behavior slice implemented, with full Brief/Draft workspaces deferred
Primary route: `/ws/:workspaceId/content-pipeline`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/pipeline.js`
- Brief workspace source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/brief-workspace.js`
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

The current rebuilt surface uses the right production components but a different interaction model:

- It exposes a top `LensSwitcher` with `planner`, `calendar`, `intake`, `briefs`, `posts`, `publish`, `content-health`, and `published`.
- It mounts one legacy/carry-forward receiver inline for the selected tab.
- It has a WorkflowStepper and capability grid, but the actual unit of work is still spread across tabs.
- It has no board-level card workflow, no prototype Brief Workspace/Draft Workspace opening model, and no subscription drawer attached to the capacity meter.

Initial grade: `behavior mismatch` plus `capability risk`.

Wave 2 correction implemented:

- Bare `/content-pipeline`, invalid-tab fallback, and `?tab=briefs` now open a real four-column lifecycle Board with Intake collapsed by default and Brief work focused.
- The visible mode control is reduced to Board, Calendar, Published, Content Health, and Matrix. Draft/Post and subscription/capacity receivers are treated as workflow-open state rather than peer modes.
- Board counts come only from the existing pipeline summary and intelligence slice. The aggregate cards launch the existing Intake, Briefs, or Posts workspace; no item-level data or mutation is fabricated.
- Intake can be expanded directly from the default Board without an empty body, and `?tab=intake` opens the same existing Intake workflow in place.
- Brief and Draft columns retain truthful launch cards when their counts are zero, so empty workspaces cannot strand either production capability.
- Board cards, AI-suggested creation, and Content Health's `Draft brief` action converge on one Briefs opener and mount the workspace exactly once.
- Content capacity is a dedicated header action. `?tab=publish` and the `subscriptions` alias still mount the existing subscription workflow exactly once.
- Calendar, Published, Content Health, Matrix, post deep links, fix-context handoff, Guide, and every legacy capability remain reachable exactly once.
- Full Brief Workspace, Draft Workspace, per-item board cards, and the prototype subscription drawer remain later slices under the accepted phased decision.

## URL and Deep Links

Implemented route/state behavior:

- `/ws/:workspaceId/content-pipeline` and `?tab=briefs` open Board with Brief focused and no inline Briefs receiver until the operator launches it.
- Valid `?tab=` values are `planner`, `calendar`, `intake`, `briefs`, `posts`, `publish`, `content-health`, and `published`.
- Invalid `?tab=` values fall back to `briefs`.
- `?tab=subscriptions` is a legacy alias that resolves to `publish`.
- `?post=...` is preserved only when `tab=posts`; changing to any other tab clears the post param.
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
- `ContentBriefs`: Brief Workspace or brief-stage overflow action until the full workspace exists.
- `ContentManager`: Draft/Draft Workspace or post-stage overflow action until the full workspace exists.
- `ContentSubscriptions`: subscription/capacity drawer or Publish/capacity workspace.
- `ContentHealthLens`: Content Health mode.
- `PublishedContentLens`: Published/results mode.
- `ContentPipelineGuide`: guide drawer, with user-facing workflow copy only.

The first approved slice keeps these homes reachable while the board overview is introduced; Brief and Draft workspaces move only after their compatibility receivers pass review.

## Moved, Excluded, or Deferred

- Published outcome readback belongs in Content Pipeline Published mode and should deep-link or graduate to Insights Engine where appropriate, not duplicate the Engine recommendation queue.
- Content execution stays in Content Pipeline; Insights Engine should link into it, not reimplement content management.
- Keyword targeting and ranking execution stay in Keyword Hub.
- Client requests and inbox decisions remain in their existing client/admin homes unless a separate content-intake contract moves them.
- Do not add backend APIs, migrations, shared types, route ids, or new feature flags for the parity pass unless the approved implementation proves a server-backed requirement.
- Do not delete or materially rewrite `ContentBriefs`, `ContentManager`, `ContentCalendar`, or `ContentSubscriptions` in the parity slice. Wrap or re-home them first.

## Implemented Owner Decision

Decision `ODP-002 C` is implemented for the Board-first slice. The risk boundary remains the same: existing receivers launch from the Board or mode control until dedicated Brief/Draft workspaces are separately reviewed.

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

## Browser Smoke Checklist

Pre-correction baseline smoke for the receiver shell:

- Desktop `/ws/ws_demo_premium/content-pipeline`.
- Mobile `/ws/ws_demo_premium/content-pipeline`.
- Deep link `/ws/ws_demo_premium/content-pipeline?tab=published`.
- Deep link `/ws/ws_demo_premium/content-pipeline?tab=posts&post=<seeded-post-id>` when seeded data exists.
- Legacy alias `/ws/ws_demo_premium/content-pipeline?tab=subscriptions`.
- Open the guide drawer.
- No blank receiver, duplicate legacy panel, text overlap, hidden capability, visible internal rebuild labels, or console errors.

Baseline evidence captured in this branch:

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-desktop-current.png`.
- Published deep link: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-published-deeplink-current.png`.
- Guide drawer: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-guide-drawer-current.png`.
- Mobile overview after safe header fixes: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-mobile-current.png`.
- State payload: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-current-smoke-state.json`.
- Published proof queue: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-published-proof-desktop.png`.
- Published proof state: `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-published-proof-state.json`.

Smoke findings:

- Desktop and mobile render the current receiver shell with no page-level horizontal overflow and no visible internal rebuild/migration labels.
- `?tab=published` initializes Published as the active lens.
- The guide opens as exactly one dialog/drawer.
- The Published proof queue renders on `/content-pipeline?tab=published`, with no horizontal overflow and no visible internal implementation labels. The local demo workspace had zero published readbacks, so the smoke confirms the empty/readback-pending state; component fixtures cover a populated one-win readback.
- Console errors were empty in the Playwright fallback smoke.
- The in-app browser connector timed out during the first Content Pipeline navigation, so these screenshots were captured with the project Playwright runtime against the same local Vite server.
- The in-app browser connector also timed out during the Published proof smoke, so the proof evidence was captured with bounded local Playwright. Local preview noise was limited to Vite WebSocket warnings and route-change-aborted intelligence requests.
- The visible peer tab/receiver model remains the primary parity mismatch and should not be treated as resolved by the safe language/responsive fixes.

Later full-workspace smoke, after item-backed workspaces are approved:

- Desktop Board overview with Intake collapsed and lifecycle columns visible.
- Mobile Board overview with no horizontal text clipping outside the intended board scroll.
- Intake expanded state.
- Brief Workspace open from queued/brief card.
- Draft Workspace open from draft/review card.
- Subscription drawer open from capacity meter.
- Published mode/result detail drawer.
- Deep links initialize the intended mode/focus/open state.

Wave 2 browser result:

- `/ws/ws_demo_premium/content-pipeline` renders one Board with Queued, Brief, Draft, and Review columns; Brief is focused and the legacy Briefs workspace is not mounted until launched.
- The default Intake disclosure opens the existing AI Suggested workflow instead of an empty body.
- `?tab=subscriptions` opens one Content capacity workflow and leaves all five primary mode radios unselected.
- Guide opens as exactly one dialog. The Board, capacity alias, and guide states have no page/main overflow, visible internal labels, or new console warnings/errors.
- State evidence: `/tmp/asset-dashboard-codex-parity-captures/wave2-parity-browser-state.json`.

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

Wave 2 coverage now additionally proves:

- Default and `?tab=briefs` render Board instead of the Briefs receiver.
- Intake expands from both the default Board and `?tab=intake`, with the existing workflow mounted exactly once.
- Aggregate Brief and Draft launchers open the existing owning workspace exactly once without duplicating the page title.
- Zero-count Brief and Draft columns retain their launch actions, and every Briefs intent uses the same exact-once opener.
- Board, Calendar, Published, Content Health, Matrix, Posts, capacity, and legacy aliases preserve their URL/open-state contracts.
- Existing legacy panels remain reachable exactly once while being re-homed.

Still required for later slices:

- Item-backed queued/brief cards opening the full Brief Workspace.
- Item-backed draft/review cards opening the full Draft Workspace.
- Capacity meter opening the prototype subscription drawer rather than the preserved subscription workspace.
