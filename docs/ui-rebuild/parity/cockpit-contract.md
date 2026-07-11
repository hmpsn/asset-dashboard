# Cockpit Prototype Parity Contract

Surface: `home` / Cockpit  
Owner: `workspace-command-center`  
Status: `owner-approved`; Joshua approved the corrected desktop composition and documented exceptions on 2026-07-10
Primary route: `/ws/:workspaceId`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/cockpit.js`
- Prototype screenshots: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/screenshots/01-cd-01-verdict.png` and adjacent Cockpit captures.
- Existing build ticket: `docs/ui-rebuild/phase-a/tickets/cockpit.md`
- Current rebuilt mount: `REBUILT_SURFACES['home']`

## Required Interaction Model

Cockpit is verdict-first: orient -> act -> evidence.

The top-level page must not read as a card wall. The required structure is:

1. Verdict and orientation
   - Page-level client context.
   - One primary state or verdict.
   - Freshness and refresh affordance in the shell toolbar area.

2. Act
   - Stream selector.
   - Work queue grouped by action type.
   - Queue rows open a drawer or detail workflow where the legacy behavior requires it.

3. Evidence
   - From-client rail.
   - Technical rail.
   - Compact metrics or proof, below the work-driving areas.

Typography calibration:

- Verdict headline uses the page heading scale; verdict narrative uses body scale.
- Work stream counts use `.t-h1` so they match the DS heading/stat hierarchy without a raw pixel class.
- Evidence rail labels use `.t-ui`; client-thread messages and explanatory rail copy use `.t-body`.
- Compact metadata, dates, counts, chips, and severity labels can stay `.t-caption-sm` / `.t-caption`.
- Raw arbitrary pixel text classes are not allowed in the rebuilt Cockpit path unless a future owner-approved prototype exception is documented here.

Prototype-critical overlays:

- Activity opens as a drawer, not a permanently mounted feed.
- Work order detail opens as a drawer/modal workflow, not a second full page.
- Technical/evidence details should expand from their originating rows or rails.

## URL and Deep Links

- `/ws/:workspaceId` opens the Cockpit default overview.
- `/ws/:workspaceId/home` remains a compatible route shape where the router produces it.
- Cockpit must not overload top-level `?tab=` for stream filters. Use a separate query param such as `stream=opt|send|money|unclassified` if stream state becomes URL-addressable.
- `stream=unclassified` is the Risk receiver: it filters the queue to Risk, presses the Risk chip, and leaves all three primary stream cards unselected. `stream=all` likewise leaves the primary cards unselected rather than falsely marking Optimizations active.
- Existing outbound links keep the two-halves contract:
  - Client requests: `requests?tab=requests`
  - Content decay: `content-pipeline?tab=content-health`
  - Briefs: `content-pipeline?tab=briefs`
  - Rank drops: `seo-keywords`
  - Site health: `seo-audit`

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- `WorkOrderPanel`: opens from a work-order queue row in a drawer/modal shell.
- `ActivityFeed`: opens from toolbar activity action in a drawer.
- Weekly accomplishments: evidence band below the verdict, not a hero.
- Ranking snapshot: compact evidence or hand-off, not duplicated as a full widget grid.

Excluded from the rebuilt Cockpit body:

- Actionable anomaly management, which belongs to Search & Traffic.
- Admin recommendation queue and briefing review queue, which belong to Recommendations.
- Content Pipeline detail management, which belongs to Content Pipeline.

## Browser Smoke

Local captures from this recovery branch:

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/cockpit-desktop-regenerated.png`
- Mobile overview, loaded viewport after shell/header fix: `/tmp/asset-dashboard-codex-parity-captures/cockpit-mobile-viewport-fixed.png`
- Activity drawer: `/tmp/asset-dashboard-codex-parity-captures/cockpit-activity-drawer.png`
- Work-order modal, using seeded `ws_demo_growth` work-order data: `/tmp/asset-dashboard-codex-parity-captures/cockpit-work-order-modal.png`
- Send stream deep link: `/tmp/asset-dashboard-codex-parity-captures/cockpit-send-stream-regenerated.png`
- Desktop overview after typography-role cleanup: `/tmp/asset-dashboard-codex-parity-captures/cockpit-typography-role-desktop.png`
- Desktop send-stream after typography-role cleanup: `/tmp/asset-dashboard-codex-parity-captures/cockpit-typography-role-send-stream-desktop.png`
- Typography smoke state: `/tmp/asset-dashboard-codex-parity-captures/cockpit-typography-role-smoke-state.json`
- Risk receiver after the final calibrated-surface audit: `/tmp/asset-dashboard-codex-parity-captures/cockpit-risk-stream-final.png`
- Corrected desktop overview at 1440x900: `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/cockpit-1440-final.png`
- Corrected desktop overview at 1600x1000: `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/cockpit-1600-final.png`
- Corrected mobile floor: `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/cockpit-mobile-390.png`
- Corrected activity Drawer: `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/activity-drawer-1440.png`
- Corrected work-order overlay: `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/work-order-overlay-1440.png`

Resolved smoke findings:

- The rebuilt shell now uses the compact icon rail on narrow viewports and opens full navigation in a left drawer while preserving the saved desktop sidebar preference.
- Mobile smoke then exposed a Cockpit orientation-row squeeze where the client context wrapped into vertical word fragments beside the toolbar. This branch stacks the client context and toolbar on narrow viewports while preserving the desktop row.
- Activity opens as exactly one DS `Drawer`.
- Work orders open as exactly one carried-over legacy full-screen modal. This is intentionally accepted as the current carry-over shell rather than wrapping `WorkOrderPanel` in a second drawer.
- Browser smoke found no horizontal overflow, blank loaded panel, duplicate overlay, internal migration labels, or console errors.
- Typography smoke found no horizontal overflow, no visible internal labels, no raw pixel text classes in the rebuilt Cockpit path, and sampled `.t-h1`, `.t-body`, `.t-ui`, and `.t-stat-sm` nodes computed at the expected styleguide sizes. Follow-up shell smoke also confirmed sidebar group headers use `.t-label`, breadcrumbs use `.t-ui`, stream-card descriptions use `.t-body`, and no substantive visible text below 13px remains outside true label/mono/initial cases. The local preview emitted websocket/auth notification noise while the backend stack was not attached; no Cockpit render failure was observed.
- Final Risk-receiver smoke confirms all three primary stream radios are unchecked, the Risk queue chip is pressed, only Risk rows remain, and the page has no horizontal overflow.

No open Cockpit smoke gaps remain for the current fixture set. The source-led correction now matches the prototype's capped spine, context line, verdict hero, stream band, 702/434 work/evidence split, and weekly evidence order at both required desktop viewports. A fresh Sol rendered review returned `PASS`; Joshua explicitly owner-approved this composition with its documented exceptions on 2026-07-10.

## Post-Approval KPI Circle-Back — 2026-07-11

The independent capability audit confirmed that Search/GA4 reporting already has an exact home in Search & Traffic, but the legacy workspace home also carried three distinct operator decisions not reproduced in the rebuilt Cockpit: organic traffic value, content velocity, and overall health. `AUD-D2` is `awaiting owner approval`. Recommended: do not duplicate Search/GA4 metrics; add one compact secondary band for those three unique decisions, or explicitly approve their omission. The existing Cockpit visual approval remains intact until Joshua resolves the new circle-back.

## Automated Test Floor

Required component coverage:

- `ui-rebuild-shell` real hook loading-to-loaded transition mounts Cockpit shell.
- Stream selector changes the active stream without losing the work queue.
- The Risk compatibility deep link keeps the primary selector truthful and the source-level `Client risk` filter distinct from the stream filter.
- Activity action opens the activity drawer.
- Work-order row opens the carried-over work-order modal exactly once.
- Key outbound deep links initialize their destination state.
- Cockpit calibration copy uses the intended styleguide typography roles.
- No internal rebuild terms appear in visible UI.
- Rebuilt a11y floor passes.

Current branch adds a shell regression test proving narrow viewports keep the compact rail, open mobile navigation on demand, and do not change the saved desktop preference.

Current branch also asserts that activity and work-order overlays mount exactly once and that internal rebuild/migration labels stay absent from the visible Cockpit UI.

Current branch also asserts that the verdict, narrative, technical rail title/meta, rank position, stream count, and shared client-thread message use styleguide type roles instead of raw pixel sizes.
