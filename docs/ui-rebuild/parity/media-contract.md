# Media / Asset Manager Prototype Parity Contract

Surface: `media` / Assets  
Owner: media optimization / Webflow asset workflow  
Status: `ODP-006 C` accepted 2026-07-09; phased single-workshop correction approved  
Primary route: `/ws/:workspaceId/media`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/assets.js`
- Parity ledger source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/Platform Parity Ledger.html`
- Existing rebuilt implementation: `src/components/asset-manager-rebuilt/AssetManagerSurface.tsx`
- Route-state hook: `src/components/asset-manager-rebuilt/useAssetManagerSurfaceState.ts`
- Browse grid/table: `src/components/asset-manager-rebuilt/AssetGrid.tsx`, `src/components/asset-manager-rebuilt/AssetTable.tsx`
- Asset detail: `src/components/asset-manager-rebuilt/AssetDrawer.tsx`
- Audit workflow: `src/components/asset-manager-rebuilt/AuditLens.tsx`
- Upload workflow: `src/components/asset-manager-rebuilt/UploadLens.tsx`
- Current component test: `tests/component/asset-manager-rebuilt/AssetManagerSurface.test.tsx`

## Required Interaction Model

The prototype is a single media workshop. Site Audit and Performance detect oversized images and missing alt text; Asset Manager fixes those issues at the source.

Prototype-critical capabilities:

1. Browse the Webflow asset library with counts for total weight, oversized images, potential savings, and missing alt text.
2. Filter to all, oversized, missing-alt, and unused assets without leaving the workshop.
3. Select one or many assets.
4. Compress images, generate alt text, smart-rename, and clean up unused files from the same work surface.
5. Treat compression as a source fix: optimized assets are written back to Webflow and CMS references are updated by the production workflow.
6. Accept deep links from Site Audit / Performance into the relevant repair filter.

## Current Parity Grade

Grade: `behavior mismatch`.

Why:

- The rebuilt surface preserves the key production capabilities: browse, filters, CMS image visibility, asset detail drawer, alt generation, compression, smart rename, bulk actions, audit, upload, organize, and delete.
- The rebuilt route state accepts the important handoffs: `?filter=oversized` on Browse and `?tab=audit&filter=oversized` for the current audit drill-in.
- The current Browse lens now carries the prototype's source-fix and measured-proof framing, so the split-lens implementation still explains why media repair belongs here and how measured wins graduate to Insights Engine.
- However, the prototype does not expose Browse / Audit / Upload as peer top-level lenses. It presents one Asset Manager workshop where filters and bulk actions are the navigation surface.
- The rebuilt `Audit` lens is a production capability, but exposing it as an equal peer to Browse changes the prototype IA. Matching the prototype would require deciding whether audit results become evidence/filter state inside Browse, or whether the current split is an intentional production divergence.
- The rebuilt `Upload` lens also differs from the prototype, which shows upload as a toolbar action rather than a peer mode.

Accepted direction:

- Phase Browse, Audit, and Upload into one prototype-style workshop: Browse becomes the default workspace, Upload becomes a toolbar action, and Audit becomes a compact repair-results area.
- Preserve `?tab=audit`, `?tab=upload`, `filter`, `search`, `view`, `sort`, and `asset` as compatibility open/focus state.
- Circle back after the Performance/Site Audit source-fix chain proves audit, upload, delete, and detail workflows remain obvious.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/media` opens Browse with no query string.
- `?tab=browse` remains accepted and opens Browse.
- Switching back to Browse clears the default `tab` and default `sort` query params.
- `?tab=audit` opens Audit.
- `?tab=upload` opens Upload.
- Browse filters use `?filter=` with values including `missing-alt`, `oversized`, `images`, `svg`, `unused`, `used`, `cms-images`, and `cms-missing-alt`.
- Audit filters use `?filter=` with values including `missing-alt`, `low-quality-alt`, `duplicate-alt`, `oversized`, `unoptimized-png`, `legacy-format`, `duplicate`, and `unused`.
- `?asset=:id` opens the asset detail drawer.
- Secondary params remain validated: `search`, `sort`, and `view`.

Compatibility requirements:

- Preserve current `?tab=`, `filter`, `search`, `view`, `sort`, and `asset` values until the IA decision is made.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags for visual alignment.
- Keep Performance's repair handoff working: heavy pages and image-heavy speed opportunities need to land operators in an asset-repair state.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Webflow asset list, image/SVG/CMS source filters, oversized/missing-alt/unused filters, search, sorting, grid/table views, and selected-asset bulk bar.
- Asset detail drawer with preview, CMS usage, alt text edit/generate, file rename/smart name, compression, open/copy URL, and delete.
- Asset audit run, audit filter chips, issue table, issue drawer, export CSV, generate all alt, compress all, and delete unused.
- Upload queue and image processing workflow.
- Organize preview and execution drawer.

## Safe Work Completed

- Default Browse now clears `?tab=browse` and default `?sort=createdOn` when returning from another lens.
- Audit score fallback copy no longer exposes rebuild/browser implementation language.
- PageHeader copy now matches the prototype's source-fix framing and wraps on mobile.
- Current toolbar controls wrap on mobile so the peer Browse / Audit / Upload lens control does not clip while the larger IA decision is pending.
- Audit repair filters now show source-fix context before and after an audit run. Deep links such as `?tab=audit&filter=oversized` explain that Asset Manager is the repair step for PageSpeed or Site Audit findings and point operators at the relevant bulk/row action.
- Browse now mirrors the prototype's "fixes the source, not the symptom" explanation and closes with a measured-proof frame for Core Web Vitals/page-speed improvements graduating into Insights Engine, using readable `.t-body` copy inside existing DS banners.
- Component tests assert default URL behavior, Browse source-fix/proof framing, audit drill-in source-fix context, exact-once asset drawer deep link, real feature-flag loading transition, absence of internal implementation language in the audit fallback, no-site state, CMS filter behavior, AI quota lock behavior, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture target: `ws_1772610244629` at `http://127.0.0.1:5174`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/media-swish-desktop-current.png`.
- Audit deep link: `/tmp/asset-dashboard-codex-parity-captures/media-swish-audit-current.png`.
- Asset detail drawer: `/tmp/asset-dashboard-codex-parity-captures/media-swish-asset-drawer-current.png`.
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/media-swish-mobile-current.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/media-swish-smoke-state.json`.

Result: pass for the current split-lens implementation. The smoke shows populated desktop and mobile Browse states, an Audit deep link, and an exact-one asset detail drawer with no internal implementation terms, no page-level horizontal overflow, no console errors, and no local HTTP 400/500 responses. The surface remains a behavior mismatch until the single-workshop IA decision is made.

Source-fix proof smoke:

- Desktop Browse after source-fix proof framing: `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-browse-desktop.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-smoke-state.json`.

Result: pass for the current Browse lens. The smoke verifies the new source-fix banner and measured-proof footer are visible in the rebuilt shell, important explanatory copy renders with `.t-body`, internal rebuild/migration labels are absent, and the page has no horizontal overflow. The approved phased workshop correction remains to be implemented.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Assets.
- Default Browse URL state is accepted and cleared when switching back to Browse.
- `?filter=oversized` initializes the Browse repair filter.
- Browse renders the prototype source-fix explanation and measured-proof footer with readable `.t-body` copy.
- `?tab=audit&filter=oversized` initializes the current audit drill-in and shows the source-fix handoff context before the audit is run.
- `?asset=` opens the asset detail drawer exactly once.
- CMS image filters reveal the CMS field selector.
- AI quota lock disables AI actions.
- Internal implementation terms are absent from the audit fallback.
- The rebuilt a11y floor passes.
