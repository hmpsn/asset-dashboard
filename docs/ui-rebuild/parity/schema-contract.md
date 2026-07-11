# Schema Prototype Parity Contract

Surface: `seo-schema` / Schema  
Owner: optimization / structured-data workflow  
Status: `owner-approved`; Joshua approved the corrected structured-data composition and documented Drawer exception on 2026-07-10
Primary route: `/ws/:workspaceId/seo-schema`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/schema.js`
- Parity ledger source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/Platform Parity Ledger.html`
- Existing rebuilt implementation: `src/components/schema-rebuilt/SchemaSurface.tsx`
- Generator workflow: `src/components/schema-rebuilt/GeneratorLens.tsx`
- Page detail drawer: `src/components/schema-rebuilt/SchemaPageDrawer.tsx`
- Workflow guide: `src/components/schema-rebuilt/WorkflowGuideLens.tsx`
- Current component test: `tests/component/schema-rebuilt/SchemaSurface.test.tsx`

## Required Interaction Model

The prototype is a structured-data generator workflow with five visible phases:

1. Scan the site and identify page/schema opportunities.
2. Review generated page-level JSON-LD.
3. Edit page type and schema output.
4. Publish to Webflow or send to client.
5. Validate the resulting graph and measure impact.

The prototype page body includes a coverage/readiness hero, a stepper, summary metrics, bulk publish/send actions, page cards with schema type/status controls, expandable JSON-LD review, and a Workflow Guide tab.

## Current Parity Grade

Visual status: `owner-approved`.

Source-led correction result, 2026-07-10:

- The Generator now uses the prototype's exact 1080px outer / 1020px content canvas, compact context strip, two-mode tray, 23px readiness hero, five-step workflow, four summary metrics, compact bulk band, and dense page rows in the same first-viewport order.
- The Workflow Guide now resolves to one 1020px card with an 18px display heading, two-line 13.5px introduction, and five evenly paced workflow rows rather than a second dashboard composition.
- Real Rinse data remains honest: 10 scanned pages, 51 detected types, 5 existing-schema pages, 1 page error, and 10 publishable rows. No unsupported coverage percentage or missing-schema count is invented.
- Page review/edit/publish/history remains in the production Drawer as an explicit capability-preserving exception to the prototype's inline expansion.
- Exact 1440x900, 1600x1000, guide, expanded site-plan, Drawer, and mobile evidence passed a fresh Sol review with `PASS`; Joshua explicitly owner-approved the composition and Drawer exception on 2026-07-10.

Why:

- The rebuilt surface preserves the Generator / Workflow Guide modes and validates `?tab=`.
- The five-step workflow is visible through the shared `WorkflowStepper`.
- Bulk publish, client send, page type selection, schema regeneration, graph validation, CMS mapping, manual fallback, page detail review, version history, and rollback remain reachable exactly once.
- Generated page detail opens in the shared `Drawer`; this differs from the prototype's inline expandable cards, but it preserves the same workflow and keeps the heavy review/edit/publish UI contained.
- Browser smoke proves desktop overview, guide deep link, mobile overview, and one open detail drawer without console errors, failed responses, page-level overflow, or internal labels.

Explicit exception carried into owner review:

- Keep the Drawer because it preserves the production publish/send/history surface safely. Replacing it with prototype-style expandable cards remains an owner-only workflow decision, not a safe-local visual correction.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/seo-schema` opens the Generator mode.
- `?tab=guide` opens the Workflow Guide mode.
- Invalid `?tab=` values fall back to Generator.
- Fix-context navigation still flows through route state into the generator hook.

Compatibility requirements:

- Keep the current `?tab=` contract.
- Do not reintroduce the retired client `schema-review` route; client review remains in Inbox > Reviews.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags for visual alignment.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Schema site plan, role assignment, canonical entity review, activation, send, and retraction.
- Full generation and single-page generation.
- Page type hints and saved page type changes.
- Whole-site graph validation before bulk publish.
- Static-page Webflow custom-code publish.
- CMS item mapped-field publish.
- Manual Webflow paste fallback and JSON-LD copy.
- Send to client for page and batch review.
- Pending schema approvals.
- Existing-schema comparison, effective schema editing, version history, and rollback.
- Schema profile completeness gaps back to Brand & AI / settings.
- Search Console impact readout after the measurement window.

## Safe Work Completed

- Visible internal migration terms were replaced with operator-facing language in the guide, site-plan bridge, inventory banner, publish section, and coverage metric.
- The rebuilt admin generator now reads schema recommendation context through the admin recommendations endpoint instead of the client-gated public route.
- The loaded header now wraps on mobile, and the Refresh action stacks cleanly.
- The Workflow Guide now presents the prototype's primary five-phase flow, Scan -> Review -> Edit -> Publish -> Validate, while keeping production safeguards such as schema-plan authority, client review, rollback, and measurement in supporting sections.
- The Workflow Guide and page-detail Drawer now map important structured-data workflow copy to the styleguide role hierarchy: phase descriptions, pipeline safeguards, client handoff, measurement explanation, drawer JSON-LD guidance, drawer publish/send guidance, and empty setup instructions use `.t-body`; guide action/safeguard rows use `.t-ui`.
- Component tests assert operator-facing copy, admin recommendation read path, guide/deep-link behavior, detail drawer affordances, real feature flag transition, workspace-event invalidation, and the rebuilt a11y floor.

## Browser Smoke Evidence

Clean fixture: `ws_2ceaeb6c-0820-4da5-941e-ad9eae643993`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/schema-rinse-desktop-current.png`
- Guide deep link: `/tmp/asset-dashboard-codex-parity-captures/schema-rinse-guide-deeplink-current.png`
- Detail drawer: `/tmp/asset-dashboard-codex-parity-captures/schema-rinse-drawer-current.png`
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/schema-rinse-mobile-current.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/schema-rinse-smoke-state.json`

Result: no internal labels, no page-level horizontal overflow, no duplicate drawer, no console errors, and no failed responses.

Guide workflow polish smoke:

- Desktop guide deep link with five-phase workflow: `/tmp/asset-dashboard-codex-parity-captures/schema-guide-five-phase-desktop.png`
- Mobile guide viewport with five-phase workflow: `/tmp/asset-dashboard-codex-parity-captures/schema-guide-five-phase-mobile-viewport.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/schema-guide-five-phase-smoke-state.json`

Result: desktop and mobile guide states show the five prototype phases, no old primary guide labels, no internal labels, no page-level horizontal overflow, and no console errors.

Typography role smoke:

- Guide deep link with workflow body copy: `/tmp/asset-dashboard-codex-parity-captures/schema-typography-guide-desktop.png`
- Detail Drawer with body-scale JSON-LD and publish guidance: `/tmp/asset-dashboard-codex-parity-captures/schema-typography-drawer-desktop.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/schema-typography-role-smoke-state.json`

Result: the guide renders phase descriptions and pipeline safeguards at `.t-body` / 15.5px, action/safeguard rows at `.t-ui` / 13.5px, the page-detail Drawer opens exactly once, desktop and light mobile guide checks show no horizontal overflow, and no internal rebuild/migration labels are visible. Local preview console noise was limited to the existing notification fetch failure with the backend stack not attached; no Schema request failures or render errors were observed.

Source-led final evidence:

- Prototype Generator: `/tmp/asset-dashboard-codex-visual-parity/batch7/prototype/schema-1440.png` and `schema-1600.png`.
- Corrected Generator: `/tmp/asset-dashboard-codex-visual-parity/batch7/schema/generator-1440-final.png` and `generator-1600-final.png`.
- Prototype / corrected Guide: `/tmp/asset-dashboard-codex-visual-parity/batch7/prototype/schema-guide-1440.png` and `/tmp/asset-dashboard-codex-visual-parity/batch7/schema/guide-1440-final.png`.
- Important interiors: `/tmp/asset-dashboard-codex-visual-parity/batch7/schema/page-drawer-1440.png` and `site-plan-expanded-1440.png`.
- Mobile floor: `/tmp/asset-dashboard-codex-visual-parity/batch7/schema/generator-mobile-390.png`.

Fresh Sol verdict: `PASS`. Desktop canvas and first-viewport hierarchy match the prototype, typography and row density are calibrated, real fixture metrics remain truthful, production support stays reachable, and no desktop/mobile surface overflow was found.

Fixture caveat:

- `ws_demo_premium` currently returns local 500s for schema plan / graph validation endpoints, so it is not a clean Schema smoke fixture.

## Registry Closeout Evidence

The measured registry archive adds exact 1600x1000 Generator and Workflow Guide prototype references plus matching rebuilt Guide evidence under `/tmp/asset-dashboard-codex-visual-parity/registry-final/`; reviewed exact 1440x900 and Generator evidence remain authoritative. Page review/edit/publish/history stays in the production Drawer as the documented inline-card exception.

## Automated Test Floor

Existing/current branch coverage proves:

- `?tab=guide` initializes the guide and invalid values fall back to Generator.
- The guide's primary workflow shows the prototype five phases: Scan, Review, Edit, Publish, Validate.
- The guide and Drawer keep substantive workflow guidance on `.t-body` and compact action/proof rows on `.t-ui`.
- Lens switching writes validated URL state.
- Detail drawer opens with review, edit, publish, send, and history affordances.
- Internal migration/rebuild terms are absent from the visible Schema UI.
- Admin recommendations are read through `useAdminRecommendationSet`.
- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Schema.
- Workspace events invalidate schema queries.
- The rebuilt a11y floor passes.
