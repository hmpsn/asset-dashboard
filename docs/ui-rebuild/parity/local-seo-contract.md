# Local Presence Prototype Parity Contract

Surface: `local-seo` / Local Presence  
Owner: local SEO / GBP operations  
Status: `ODP-008 A` accepted 2026-07-09; current real-data v1 retained  
Primary route: `/ws/:workspaceId/local-seo`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/local.js`
- Setup drawer source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/local-setup.js`
- Reviews workflow source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/local-reviews.js`
- Phase 0 surface ledger: `docs/ui-rebuild/phase0/surfaces/local-presence.md`
- Phase A build ticket: `docs/ui-rebuild/phase-a/tickets/local-presence.md`
- Existing rebuilt implementation: `src/components/local-presence-rebuilt/LocalPresenceSurface.tsx`
- Current component test: `tests/component/local-presence-rebuilt/LocalPresenceSurface.test.tsx`

## Required Interaction Model

The prototype is a local presence cockpit with two visible operator modes:

1. `Rank & profile` — GBP aggregate/profile health, market setup posture, local rank evidence, review summary, and map-pack share of voice.
2. `Reviews & replies` — authenticated GBP connection/mapping, review sync, governed response pipeline, client approval, publishing, retry, and closed states.

Setup is not a peer page mode in the prototype. `Configure market` opens the local market setup drawer from the connection chip or rank/profile body.

Prototype-critical structure:

- The top-level mode control shows `Rank & profile` and `Reviews & replies`, not four equal tabs.
- `Configure market` opens the setup drawer; it does not replace the page with an inline setup panel.
- The reviews workflow remains governed: AI/manual drafting, client approval, approve-and-publish, retry, and closed declined/cancelled states must stay visible.
- Local rank/profile evidence must use real stored local visibility and GBP data. Do not fabricate the prototype's 49-point grid or GBP performance metrics from unavailable data.

Production carry-over that intentionally exceeds or differs from the prototype:

- Existing `?lens=` and legacy `?tab=` values remain accepted: `overview`, `visibility`, `reviews`, and `setup`.
- `overview`, `visibility`, and invalid/default route state render the `Rank & profile` workspace.
- `setup` opens the setup drawer over `Rank & profile` and clears back to the default state when closed.
- The legacy `LocalSeoVisibilityPanel` remains mounted exactly once inside `Rank & profile` because it is the real current home for market posture, local-pack checks, and keyword-level evidence.
- Manual `Re-scan` and `Refresh GBP` controls stay visible because production currently uses explicit background jobs rather than the prototype's implied auto-sync.

## Current Parity Grade

Grade: `capability risk`.

Why:

- The safe correction now matches the prototype's visible interaction model: two modes plus setup drawer.
- Existing deep links and legacy aliases are preserved without keeping the old four-tab IA visible.
- The rebuilt page uses real current local SEO data for profile health, share of voice, trends, market posture, and reviews.
- The current real-data rank/profile workspace now maps important setup, GBP, empty-state, and trend explanations to readable styleguide body roles instead of caption-only treatment.
- Full prototype parity still depends on data that does not exist today: 49-point geo-grid scan nodes, GBP Performance API views/calls/directions, fuller GBP profile checklist fields, view-on-Google URLs, and approved-to-draft reopen transitions.

Accepted direction:

- Continue Local Presence v1 on the real single-point market posture model with current manual refresh controls.
- Backlog the 49-point geo-grid and GBP Performance metrics as explicit backend capability slices with their own data, storage, and UI contracts.
- Circle back when either backend slice is funded; do not synthesize the missing metrics in the frontend.
- Recommended default: keep the current real-data rank/profile workspace as the shipped v1 and backlog the geo-grid/performance work as explicit capability slices.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/local-seo` renders `Rank & profile`.
- `?lens=overview` and `?tab=overview` render `Rank & profile`.
- `?lens=visibility` and `?tab=visibility` render `Rank & profile` with the legacy visibility panel mounted exactly once.
- `?lens=reviews` and `?tab=reviews` render `Reviews & replies`.
- `?lens=setup` and `?tab=setup` render `Rank & profile` and open the setup drawer.
- Closing the setup drawer clears back to the default state.

Compatibility requirements:

- Preserve route id `local-seo`.
- Preserve validated `?lens=` and legacy `?tab=` receivers.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags in this parity slice.
- Keep inbound Brand & AI location handoff intact: `?tab=business-footprint&focus=locations-section`.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Local operating status, workspace posture, market chips, setup label/detail, and market setup drawer.
- GBP aggregate card, rating/review count, completeness Meter, and real available profile signals.
- Local visibility summary, setup-state callout, market trend sparklines, repeat competitor share of voice, Track keyword action, and legacy visibility panel.
- Manual local visibility re-scan and GBP/reviews refresh background-job triggers.
- Authenticated GBP connection/mapping status, review sync, per-location sync health, and copy-policy guidance.
- Review-response pipeline including draft, awaiting client, changes requested, approved, published, publish failed, declined, and cancelled states.

## Safe Work Completed

- Replaced the visible four-lens switcher with prototype modes: `Rank & profile` and `Reviews & replies`.
- Mapped `overview`, `visibility`, and `setup` URL states into the rank/profile workspace while preserving validated URL state.
- Kept `?tab=setup` / `?lens=setup` as drawer-open state and removed the inline setup receiver body.
- Composed the rank/profile workspace from the current status/profile card plus the real visibility evidence panel.
- Suppressed duplicate competitor tables when overview and visibility evidence appear together.
- Removed the second Markets / Checked / Visible / Local packs KPI row from the overview body; the page-level summary is the sole owner while the lower visibility band retains its distinct match-quality metrics.
- Replaced `Provider degraded` / setup-state implementation wording with operator-facing scan/setup copy.
- Aligned current rank/profile and visibility evidence copy to the styleguide type-role contract: explanatory setup/GBP/trend copy uses `.t-body`, compact competitor/market/action labels use `.t-ui`, and read-only snapshot counts use blue data color.
- Extended component tests for real feature-flag loading-to-loaded transition, prototype mode labels, setup drawer-only compatibility state, legacy visibility deep link, exact-once legacy panel mounting, reviews mode switching, no internal labels, and rebuilt a11y.

## Browser Smoke Evidence

Clean demo target: `/ws/ws_demo_premium/local-seo`.

- Desktop `Rank & profile`: `/tmp/asset-dashboard-codex-parity-captures/local-seo-smoke-desktop.png`.
- Legacy visibility deep link: `/tmp/asset-dashboard-codex-parity-captures/local-seo-smoke-visibility-deeplink.png`.
- Setup drawer state: `/tmp/asset-dashboard-codex-parity-captures/local-seo-smoke-setup-drawer.png`.
- Reviews state: `/tmp/asset-dashboard-codex-parity-captures/local-seo-smoke-reviews.png`.
- Mobile `Rank & profile`: `/tmp/asset-dashboard-codex-parity-captures/local-seo-smoke-mobile.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/local-seo-smoke-state.json`.

Result: clean against the sparse demo workspace. The smoke verifies the rebuilt shell, two visible modes, legacy visibility deep link, setup drawer without inline setup receiver, reviews mode, and mobile layout. It found one flag-off copy leak (`backend feature lifecycle`), which was fixed and covered by component test before the final smoke pass. Final checks show no forbidden terms, no horizontal overflow, no console errors, no local 400/500 responses, setup drawer opened, and inline setup receiver absent.

Typography-role smoke:

- Desktop `Rank & profile`: `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-rank-profile-desktop.png`.
- Visibility deep link: `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-visibility-deeplink.png`.
- Setup drawer state: `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-setup-drawer.png`.
- Light mobile regression floor: `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-rank-profile-mobile.png`.
- State sample: `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-smoke-state.json`.
- Single-summary desktop follow-up: `/tmp/asset-dashboard-codex-parity-captures/local-presence-single-summary-final.png`.

Result: the sparse demo workspace confirms live GBP guidance and empty visibility copy render at `.t-body` / 15.5px, compact labels remain `.t-ui` / 13.5px, no internal rebuild/migration labels are visible, and there is no horizontal overflow. Component fixtures cover the populated `Map Pack Rival`, `Austin, TX`, and `2/4 visible on 2026-07-06` cases that the sparse demo data does not expose. The light mobile capture showed expected narrow-shell clipping in the mode control, but no blank panel or blocking layout failure; mobile remains a regression floor only per parity process.

## Automated Test Floor

Current branch coverage proves:

- Default Local Presence renders the prototype `Rank & profile` and `Reviews & replies` modes, with no visible `Overview`, `Visibility`, or `Setup` peer tabs.
- `?tab=setup` opens the setup drawer and does not mount the inline setup receiver body.
- `?lens=visibility` initializes `Rank & profile` and mounts the legacy visibility panel exactly once.
- Switching to `Reviews & replies` mounts the review response pipeline and unmounts the visibility panel.
- Real `useFeatureFlag('local-gbp')` loading-to-loaded transition survives.
- Internal rebuild/migration/carry-over/provider/setup-state labels are absent from the loaded surface.
- Rank/profile and visibility evidence copy uses the intended styleguide typography roles, and snapshots are styled as read-only blue data instead of teal action state.
- Markets and Checked render once in the rank/profile page summary; Visible has only the page summary plus the distinct visibility-evidence metric.
- The rebuilt a11y floor passes.
