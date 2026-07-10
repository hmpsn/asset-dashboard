# Site Audit Prototype Parity Contract

Surface: `seo-audit` / Site Audit  
Owner: optimization / technical-health workflow  
Status: `ODP-004 A` diagnostic-lens demotion accepted; canonical Asset Manager repair handoff implemented and verified
Primary route: `/ws/:workspaceId/seo-audit`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/audit.js`
- Parity ledger source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/Platform Parity Ledger.html`
- Existing rebuilt implementation: `src/components/site-audit-rebuilt/SiteAuditSurface.tsx`
- Route-state hook: `src/components/site-audit-rebuilt/useSiteAuditSurfaceState.ts`
- Schedule drawer: `src/components/site-audit-rebuilt/ScheduleDrawer.tsx`
- Current component test: `tests/component/site-audit-rebuilt/SiteAuditSurface.test.tsx`

## Required Interaction Model

The prototype is a decision-first technical audit console:

1. Orient around a single site health score and the worst technical categories.
2. Inspect Core Web Vitals and issue groups without leaving the audit flow.
3. Open issue/page detail from the audit table, with affected pages visible.
4. Act on issues through fix, task, client-send, ignore/suppress, and dead-link handoff paths.
5. Re-run, schedule, export/share, and review audit history.

The prototype has two visible sub-tabs: `Site Audit` and `History`. Performance, links, content quality, and AI-readiness signals are evidence inside the audit workflow, not peer navigation destinations.

## Current Parity Grade

Initial grade: `behavior mismatch`.

Why:

- The rebuilt surface already preserves the core audit workflow: health score, category meters, Core Web Vitals, issue grouping, dead-link handoff, schedule drawer, export/share, history, and issue detail drawer.
- The default lens now matches the prototype label, `Site Audit`, and the default route is clean (`/seo-audit` rather than `?sub=audit`) while still accepting `?sub=audit`.
- The remaining mismatch is visible IA: the rebuilt surface exposes `AI Search Ready`, `Content Health`, and `Guide` as peer lenses. The prototype absorbs those signals into the audit surface or adjacent guidance instead of giving them equal top-level weight.

Accepted direction:

- Demote `AI Search Ready`, `Content Health`, and `Guide` out of the top peer lens strip into evidence/diagnostic sections or a related-work area, while preserving the existing `?sub=` deep links as compatibility open-state.
- Circle back if browser/operator review shows any demoted diagnostic is no longer discoverable.

Wave 2 correction implemented:

- The visible mode switcher now contains only `Site Audit` and `History`.
- `AI Search Ready`, `Content Health`, and `Audit Guide` live in one `Search readiness and guidance` evidence group after Core Web Vitals, each in the canonical `Disclosure` primitive.
- `?sub=aeo-review`, `?sub=content-decay`, and `?sub=guide` keep the full audit console rendered, mark Site Audit active, and open only the requested evidence disclosure.
- The same exact-once evidence group remains available alongside background-audit progress, so a valid compatibility URL does not disappear during a run.
- The three diagnostic workflows remain reachable exactly once; run, schedule, history, issue detail, dead-link handoff, export/share, suppression, and action-item capabilities are unchanged.
- The loaded audit now names Asset Manager as the source-image repair owner and offers truthful oversized and missing-alt handoffs without claiming the current audit found either issue or inventing counts.
- Current behavior grade: aligned for the accepted diagnostic-demotion slice. Discoverability remains the circle-back trigger.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/seo-audit` opens `Site Audit` with no query string.
- `?sub=audit` remains accepted and opens `Site Audit`.
- `?sub=history` opens History and is written by the lens switcher.
- `?sub=aeo-review`, `?sub=content-decay`, and `?sub=guide` remain accepted as compatibility receivers after their visible peer lenses are demoted.
- Invalid `?sub=` values fall back to `Site Audit`.
- Image source-repair actions navigate to `/ws/:workspaceId/media?filter=oversized` and `/ws/:workspaceId/media?filter=missing-alt`.

Compatibility requirements:

- Preserve existing `?sub=` values until a documented compatibility plan maps them to section-open/focus state.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags for visual alignment.
- Keep the current schedule drawer, issue drawer, export/share, and run-audit actions reachable exactly once.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Run Site Audit and display the latest result.
- Scheduled audit setup and cancellation.
- Audit history.
- Core Web Vitals strip with field-data/lab fallback.
- Issue grouping by severity/category and traffic sorting.
- Issue detail drawer with affected pages and suppress/restore.
- Dead-link handoff to Links.
- Filter-only oversized and missing-alt handoffs to Asset Manager.
- Report export/share.
- AI Search Ready diagnostic content until re-homed.
- Content Health diagnostic content until re-homed.
- Operator guide content until re-homed.

## Safe Work Completed

- The default lens label now matches the prototype: `Site Audit`.
- Choosing the default lens clears the `sub` query param; non-default lenses still write validated URL state.
- The loaded header wraps correctly on mobile with long site names.
- The audit decision console, schedule drawer guidance, and issue drawer sections now use styleguide typography roles: substantive audit context uses `.t-body`, work labels use `.t-ui`, and compact issue metadata stays caption-sized.
- Category accents for index/link findings now use the read-only data hue instead of action teal.
- The issue table now closes with a prototype-style proof footer that connects technical fixes to measured recovery without changing audit actions or route state.
- Added one compact image source-repair handoff after audit evidence. It states ownership without asserting fixture-dependent findings and emits only canonical Asset Manager filters, never the legacy `?tab=audit` sender state.
- Component tests now prove the default URL behavior, schedule drawer, issue detail drawer, absence of internal migration terms, real feature-flag transition, and rebuilt a11y floor.

## Browser Smoke Evidence

Clean fixture target: `ws_2ceaeb6c-0820-4da5-941e-ad9eae643993`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/site-audit-rinse-desktop-current.png`
- History deep link: `/tmp/asset-dashboard-codex-parity-captures/site-audit-rinse-history-current.png`
- Schedule drawer: `/tmp/asset-dashboard-codex-parity-captures/site-audit-rinse-schedule-current.png`
- Issue detail drawer: `/tmp/asset-dashboard-codex-parity-captures/site-audit-rinse-issue-current.png`
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/site-audit-rinse-mobile-current.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/site-audit-rinse-smoke-state.json`

Result: passed with local Playwright after the in-app browser connector timed out during page capture. Desktop overview, History deep link, schedule drawer, issue detail drawer, and mobile overview had no visible internal labels, no page-level horizontal overflow, no duplicate dialogs, no console errors, and no failed responses. The smoke temporarily seeded a disabled schedule for the fixture and deleted it afterward to avoid the API's intentional 404 response for "no schedule yet."

Wave 2 in-app browser result:

- `/ws/ws_2ceaeb6c-0820-4da5-941e-ad9eae643993/seo-audit` shows only Site Audit and History as peer radios, with AI Search Ready, Content Health, and Audit Guide discoverable as collapsed evidence disclosures.
- `?sub=aeo-review` keeps one audit body, leaves Site Audit selected, and opens only AI Search Ready.
- `?sub=history` selects History and renders the four saved audits without the evidence group.
- Schedule opens as exactly one `Scheduled Audits` dialog and was closed without saving or changing fixture data.
- All reviewed states have no page/main overflow, internal labels, duplicate dialogs, or new console warnings/errors. State evidence: `/tmp/asset-dashboard-codex-parity-captures/wave2-parity-browser-state.json`.

Canonical-handoff follow-up: `/tmp/asset-dashboard-codex-parity-captures/wave3-search-focus-smoke-state.json`. The loaded audit showed both source-repair actions; live clicks reached `/ws/ws_1772610244629/media?filter=oversized` and `/ws/ws_1772610244629/media?filter=missing-alt` with no fresh console errors.

Typography/proof-framing evidence:

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-overview-desktop.png`
- Schedule drawer: `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-schedule-desktop.png`
- Issue detail drawer: `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-issue-desktop.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-smoke-state.json`

Result: passed with local Playwright after the in-app browser connector timed out during page capture. The state file confirms no horizontal overflow, no visible internal labels, one issue dialog, and styleguide-computed sizes for the sampled audit copy: `.t-body` at `15.5px` / `23.25px` line-height and `.t-ui` at `13.5px` / `18.9px` line-height. Local preview noise was limited to Vite WebSocket disconnect warnings, a favicon/resource 404, and one route-change-aborted intelligence request.

## Automated Test Floor

Existing/current branch coverage proves:

- Every supported `?sub=` value mounts the intended panel.
- Invalid `?sub=` values fall back to `Site Audit`.
- Default `/seo-audit` renders Site Audit without a query string.
- Lens switching writes `?sub=history` and clears the default `sub`.
- Schedule drawer and issue detail drawer open exactly once.
- Important Site Audit, schedule, and issue-drawer copy uses the expected styleguide typography roles, including the "From fix to proof" footer.
- Internal migration/rebuild terms are absent from the visible Site Audit UI.
- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Site Audit.
- The rebuilt a11y floor passes.
- The visible mode switcher has exactly two radios.
- Every compatibility diagnostic URL keeps the audit body and opens its intended disclosure.
- AI Search Ready, Content Health, and Audit Guide each mount exactly once inside the Site Audit flow.
- Running-audit state preserves the requested open disclosure and all three exact-once diagnostic homes.
