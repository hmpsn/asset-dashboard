# Media / Asset Manager Prototype Parity Contract

Surface: `media` / Assets  
Owner: media optimization / Webflow asset workflow  
Status: `owner-approved`; Joshua approved the corrected workshop composition and documented exceptions on 2026-07-10
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

Visual status: `owner-approved`.

Why:

- Browse is always the workshop and no Browse / Audit / Upload peer selector remains.
- `?filter=oversized` and `?filter=missing-alt` are canonical source-repair states inside Browse; Performance and Site Audit now emit those filter-only URLs.
- `?tab=audit` opens the existing audit workflow exactly once as an in-flow Repair results section while Browse remains visible.
- `?tab=upload` opens the existing upload workflow exactly once in the shared Drawer while Browse remains visible; closing returns to bare Browse.
- Repair results is the first actionable work area after the prototype summary/proof bands and remains above Browse controls and the asset grid, so a deep link cannot strand the requested repair workflow below the full library.
- The visible All filter maps to canonical no-filter URL state; total media weight and potential savings are present as blue read-only metrics.
- Asset detail, CMS filters, search, sort, view, selection, bulk actions, organize, audit, upload queue, mutation feedback, and quota behavior remain reachable.

Accepted direction:

- Implemented: Browse is the workshop, Upload is a toolbar-opened Drawer, and Audit is an in-flow Repair results area.
- Preserve `?tab=audit`, `?tab=upload`, `filter`, `search`, `view`, `sort`, and `asset` as compatibility state.
- The discoverability circle-back triggered during the final Sol audit. Accepted resolution: keep Repair results above Browse as the first work area while leaving the workshop visible below; do not restore peer tabs.
- No safe-local visual defects remain from fresh Sol review. Joshua explicitly owner-approved the surface with its documented exceptions on 2026-07-10.

## Source-Led Visual Result, 2026-07-10

| Prototype seam | Corrected rebuilt composition | Retained production exception |
|---|---|---|
| 1180px workshop and four summary metrics | Exact 1180px border-box canvas at both desktop viewports; Total weight, Oversized, Potential savings, and Missing alt lead | DS blue/amber/red semantics replace prototype orange where required |
| Source-proof note then compact controls | Proof band precedes All/Oversized/Missing alt/Unused, truthful Select all shown, and Upload | Search, sort, view, refresh, organize, and Repair remain reachable under More |
| Dense 132px asset cards | Four-column auto-fill cards use fixed 132px previews, red No alt, zinc Unused, and two labeled contextual actions | Full alt/name/compress/open/copy/delete operations remain in Asset Detail |
| Single repair workshop | `?tab=audit` opens one compact Repair results area above controls/grid while Browse stays visible | Upload, Asset Detail, organize, confirmation, and progress remain production Drawers |

Fresh Sol review returned `PASS`. Joshua explicitly owner-approved this visual pass on 2026-07-10.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/media` opens Browse with no query string.
- `?tab=browse` remains accepted and opens Browse.
- Switching back to Browse clears the default `tab` and default `sort` query params.
- `?tab=audit` keeps Browse rendered and opens one in-flow Repair results section.
- `?tab=upload` keeps Browse rendered and opens one Upload Drawer; closing clears the tab back to Browse.
- Browse filters use `?filter=` with values including `missing-alt`, `oversized`, `images`, `svg`, `unused`, `used`, `cms-images`, and `cms-missing-alt`.
- Audit filters use `?filter=` with values including `missing-alt`, `low-quality-alt`, `duplicate-alt`, `oversized`, `unoptimized-png`, `legacy-format`, `duplicate`, and `unused`.
- `?asset=:id` opens the asset detail drawer.
- When a valid `?asset=:id` is combined with `?tab=upload`, asset detail takes precedence so only one Drawer is mounted. Closing clears both conflicting params and returns to bare Browse.
- Secondary params remain validated: `search`, `sort`, and `view`.

Compatibility requirements:

- Preserve current `?tab=`, `filter`, `search`, `view`, `sort`, and `asset` values through the single-workshop correction and any later shipping extraction.
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
- Toolbar controls wrap on narrow viewports so Search, sort, view, Organize, Repair results, and Upload remain usable.
- Audit repair filters now show source-fix context before and after an audit run. Deep links such as `?tab=audit&filter=oversized` explain that Asset Manager is the repair step for PageSpeed or Site Audit findings and point operators at the relevant bulk/row action.
- Browse now mirrors the prototype's "fixes the source, not the symptom" explanation and closes with a measured-proof frame for Core Web Vitals/page-speed improvements graduating into Insights Engine, using readable `.t-body` copy inside existing DS banners.
- Removed the visible Browse / Audit / Upload LensSwitcher. Browse now remains mounted for every route state.
- Added `Repair results` and `Upload` toolbar commands. Repair results mounts the existing Audit workflow once in-flow; Upload mounts the existing workflow once in the shared Drawer.
- Preserved `?tab=audit` and `?tab=upload` as compatibility open state while making filter-only repair URLs canonical for new cross-surface senders.
- Placed Repair results after the prototype summary/proof bands and before Browse controls and the asset grid, preserving discoverability without displacing the prototype's first-viewport evidence hierarchy.
- Added the prototype-visible All filter as the canonical no-filter control, plus Total media weight; Potential savings now uses the blue data token instead of success color.
- Defined deterministic overlay precedence for combined Upload and asset-detail deep links so exactly one Drawer is visible and close returns to canonical Browse.
- Component tests assert default URL behavior, Browse source-fix/proof framing, audit drill-in source-fix context, exact-once asset drawer deep link, real feature-flag loading transition, absence of internal implementation language in the audit fallback, no-site state, CMS filter behavior, AI quota lock behavior, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture target: `ws_1772610244629` at `http://127.0.0.1:5174`.

- Desktop overview: `/tmp/asset-dashboard-codex-parity-captures/media-swish-desktop-current.png`.
- Audit deep link: `/tmp/asset-dashboard-codex-parity-captures/media-swish-audit-current.png`.
- Asset detail drawer: `/tmp/asset-dashboard-codex-parity-captures/media-swish-asset-drawer-current.png`.
- Mobile overview: `/tmp/asset-dashboard-codex-parity-captures/media-swish-mobile-current.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/media-swish-smoke-state.json`.

Earlier result: the prior split-lens implementation passed its safety smoke with populated Browse, Audit, and exact-one asset detail states. That evidence remains useful for capability preservation but predates the single-workshop correction below.

Source-fix proof smoke:

- Desktop Browse after source-fix proof framing: `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-browse-desktop.png`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-smoke-state.json`.

Earlier source-fix result: Browse framing passed before the IA correction, with readable `.t-body` copy, no internal labels, and no horizontal overflow.

First single-workshop correction: `/tmp/asset-dashboard-codex-parity-captures/wave3-search-focus-smoke-state.json`. The populated Swish fixture proved zero peer radios, Browse on every state, canonical filters, one audit receiver, one Upload Drawer, and one asset-detail Drawer. The later Sol review correctly found that this first audit receiver was appended after the full grid, so its audit screenshot is historical exact-once evidence rather than final placement evidence; the repair-first artifacts below supersede it.

- Browse workshop: `/tmp/asset-dashboard-codex-parity-captures/asset-manager-workshop-default.png`.
- Repair results receiver: `/tmp/asset-dashboard-codex-parity-captures/asset-manager-workshop-audit-full.png`.
- Upload Drawer: `/tmp/asset-dashboard-codex-parity-captures/asset-manager-workshop-upload.png`.

Final repair-first audit evidence, 2026-07-09:

- Repair-first desktop state: `/tmp/asset-dashboard-codex-parity-captures/asset-manager-final-repair-first.png`.
- Final Search / Asset audit state: `/tmp/asset-dashboard-codex-parity-captures/final-search-asset-audit-state.json`.

The live Swish workspace placed Repair results at 206px and the asset grid at 900px, showed All, Total media weight, and blue Potential savings, and had no horizontal overflow. `?tab=upload&asset=6a105b9ad308bd9a3c7642c2` mounted one Asset detail Drawer, did not expose Upload, and closed to bare `/media`.

Final source-led evidence, 2026-07-10:

- Prototype references: `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/prototype/asset-manager-1440.png`, `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/prototype/asset-manager-1600.png`.
- Corrected Browse: `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/browse-1440-final.png`, `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/browse-1600.png`.
- Repair, bulk, and overlays: `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/repair-1440-stable.png`, `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/bulk-selection-1440.png`, `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/upload-drawer-1440.png`, `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/detail-drawer-1440.png`.
- Mobile floor: `/tmp/asset-dashboard-codex-visual-parity/repair-cluster/asset/browse-mobile-390.png`.

Measured canvas geometry is `x=243, w=1180` at 1440x900 and `x=323, w=1180` at 1600x1000, with no document overflow. The settled focused suite passes 20/20.

## Registry Closeout Evidence

The measured registry archive adds exact prototype repair-selection evidence at 1440x900 and 1600x1000 plus matching rebuilt 1600x1000 evidence under `/tmp/asset-dashboard-codex-visual-parity/registry-final/`; reviewed exact 1440x900 rebuilt evidence remains authoritative. The populated prototype versus zero truthful owner-workspace assets is an explicit data-state mismatch, while Upload, Asset Detail, Organize, confirmation, and progress Drawers remain production-only states.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Assets.
- Bare/default state renders Browse with no peer radios, audit section, or dialog.
- `?filter=oversized` and `?filter=missing-alt` initialize Browse repair filters without opening Audit.
- Repair results writes `?tab=audit`, mounts Audit exactly once in-flow, and closes back to Browse.
- `?tab=audit&filter=oversized` keeps Browse visible and opens the requested audit repair context exactly once.
- Upload writes/receives `?tab=upload`, opens exactly one Drawer, and closes back to bare Browse.
- Browse renders the prototype source-fix explanation and measured-proof footer with readable `.t-body` copy.
- `?tab=audit&filter=oversized` initializes the current audit drill-in and shows the source-fix handoff context before the audit is run.
- `?asset=` opens the asset detail drawer exactly once.
- Combined valid `?tab=upload&asset=` state gives asset detail precedence, mounts one Drawer, and closes to bare Browse.
- Repair results precedes the asset grid in document order.
- All clears the canonical filter state; Total media weight and blue Potential savings are rendered.
- CMS image filters reveal the CMS field selector.
- AI quota lock disables AI actions.
- Internal implementation terms are absent from the audit fallback.
- The rebuilt a11y floor passes.
