# Phase 0 Additive-Parity Ledger — Asset Manager (zone: Search & Site Health)

- **Surface at HEAD:** admin `Page 'media'` → `MediaTab` (`src/App.tsx:396`, `src/routes.ts:4`, nav entry `src/lib/navRegistry.tsx:131-132`, group `site-health`, label "Assets").
- **Prototype view:** `hmpsn studio Design System/mockup/assets.js` (260 lines, "Asset Manager — Media Optimization").
- **Structure at HEAD:** three sub-tabs — **Audit** (default), **Upload**, **Browse** (`src/components/MediaTab.tsx:18-25`). Sub-tab state is local `useState` only — **no `?tab=` deep link exists at HEAD** (`MediaTab.tsx:25`).
- **Audited on branch:** `ui-rebuild-phase-0` (== post-Reconcile origin/staging HEAD).

Statuses: `preserved` = obvious home in new IA, same or better · `improved` = prototype upgrades it · `new_proposed` = prototype-only, needs sign-off · `at_risk` = exists at HEAD with no visible home in the prototype/ledger. Uncertain ⇒ `at_risk`.

---

## 1. Capability table

### 1a. Browse sub-tab (`AssetBrowser`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | List all Webflow site assets (name, alt, size, type, createdOn, thumbnail) | `src/components/AssetBrowser.tsx:50`, hook `src/hooks/admin/useAdminAssets.ts:23`, endpoint `server/routes/webflow.ts:60` | improved | Asset Manager grid | Prototype renders as card grid with thumbnail + size + dimensions + ext + used-in count (assets.js:166-176). Ledger row: "Browse Webflow assets → grid, present". |
| 2 | Stats bar: total assets, missing-alt count, oversized count, unused count, CMS image count | `AssetBrowser.tsx:494-540` | improved | 4 stat cards | Prototype stat row: total media weight, oversized, potential savings, missing alt (assets.js:212-217). Note: HEAD's *unused count* and *CMS count* stats have no stat-card slot in the prototype — covered by filters only. |
| 3 | Search assets by filename or alt text | `AssetBrowser.tsx:118,170-175`, `src/components/assets/AssetFilters.tsx` | at_risk | — | Prototype has NO search box; only filter pills. Must be carried. |
| 4 | Filter pills: Missing Alt / Oversized / Images / SVG / Unused / Used (multi-select OR logic) | `AssetBrowser.tsx:41-44,119-138,188-197`, `AssetFilters.tsx:11-18` | improved (partially) | filter bar (assets.js:189-194) | Prototype has all/over/noalt/unused **single-select** with counts. HEAD's `images`, `svg`, `used` pills and multi-filter OR combination are missing → see at-risk row 5. |
| 5 | Filters: `images` (raster only), `svg`, `used` + multi-select filter combination | `AssetBrowser.tsx:192-196,119` (`useToggleSet`) | at_risk | — | Prototype filter set is exactly all/over/noalt/unused, single-select (assets.js:94,143-148). |
| 6 | Sort: Newest (createdOn) / Name / Size | `AssetBrowser.tsx:139,199-203`, `AssetFilters.tsx:81-83` | at_risk | — | Prototype has no sort control. |
| 7 | Multi-select with select-all + sticky bulk bar | `AssetBrowser.tsx:140,205-211,729-738`, `src/components/assets/BulkActions.tsx` | preserved | bulk bar (assets.js:196-204,224) | Prototype adds "Select all shown" (respects filter) — HEAD's select-all also operates on `filtered` (AssetBrowser.tsx:205-211). Equivalent. |
| 8 | Inline alt-text edit (click to edit, save to Webflow) | `AssetBrowser.tsx:141-142,213-228`, `src/components/assets/AssetCard.tsx:184-210`, endpoint `server/routes/webflow.ts:71` | at_risk | — | Prototype only has AI generate; **no manual alt edit affordance** (assets.js:163-165). Manual correction of a bad AI alt is a real workflow. |
| 9 | AI alt-text generation, single asset (vision, page-usage context, writes to Webflow, partial-failure surfaced via `writeError`) | `AssetBrowser.tsx:230-255`, `server/routes/webflow-alt-text.ts:38-121`, model `server/alttext.ts:98` | preserved | per-card "Alt text" AI action (assets.js:164,248) | Tier-quota gated — see row 40. |
| 10 | Bulk AI alt-text generation with NDJSON streaming progress + per-item success/fail tally | `AssetBrowser.tsx:257-290`, `src/api/seo.ts` (`bulkGenerateAltText`), `server/routes/webflow-alt-text.ts:139-213` | preserved | bulk bar "Generate alt" (assets.js:200,254-255) | Prototype shows toast only; HEAD has live progress bar (AssetBrowser.tsx:564-579) — progress UI must survive. |
| 11 | Compress single image (fetch → sharp compress → re-upload → swap asset → CMS reference patch → savings % toast; skip-if-already-optimized) | `AssetBrowser.tsx:292-324`, `server/routes/webflow-alt-text.ts:274-325`, `replaceCompressedAsset` | preserved | per-card "Compress" (assets.js:162,245-247) | Prototype explicitly narrates CMS-refs-updated. SVG excluded in both (assets.js:161, AssetBrowser.tsx:392). |
| 12 | Bulk compress as **background job** (`bulk-compress` via `useBackgroundTasks`; progress from job status; total-saved result; auto-refresh of asset list) | `AssetBrowser.tsx:391-440`, `server/webflow-bulk-compress-background-job.ts:37-103` | preserved | bulk bar "Compress" (assets.js:199,251-253) | Prototype is synchronous fiction; real one must stay on the background-job platform (docs/rules/background-generation.md). |
| 13 | AI smart rename, single (AI vision + site/page context → SEO filename suggestion → editable draft → save) | `AssetBrowser.tsx:326-362`, `AssetCard.tsx:112-124,155-161`, endpoints `server/routes/misc.ts:86` + `server/routes/webflow-organize.ts:202` | preserved | per-card "Rename" (assets.js:165,249) | Prototype toast implies auto-apply; HEAD shows editable draft before save — keep the confirm step. |
| 14 | Bulk smart rename (sequential suggest+apply with progress bar) | `AssetBrowser.tsx:364-389,597-613` | preserved | bulk bar "Smart rename" (assets.js:201,256) | |
| 15 | Bulk delete selected assets (confirm dialog, permanent Webflow delete) | `AssetBrowser.tsx:485-492`, `server/routes/webflow.ts:116` | at_risk | — | Prototype has **no delete anywhere** (single or bulk). Also single delete via DELETE `/api/webflow/assets/:assetId` (webflow.ts:81) used by Audit tab. |
| 16 | Unused-asset detection flag on each card (site-wide usage scan) | `AssetBrowser.tsx:51,194-195,707`, hook `useAdminAssets.ts:39` | preserved | UNUSED badge + filter (assets.js:156,193) | |
| 17 | **Organize into Folders**: AI/rule preview (folders to create, per-asset moves, summary incl. unused/shared/OG counts) → execute → moved/failed result | `AssetBrowser.tsx:157-164,442-483,541-551,634-658`, `src/components/assets/OrganizePreview.tsx`, `server/routes/webflow-organize.ts:27,143` | at_risk | — | Completely absent from prototype and from the parity-ledger tool list for Assets. |
| 18 | **CMS image scan**: discover Image/MultiImage/RichText fields across collections; per-asset usage map; stats | hook `useAdminAssets.ts:57`, `server/routes/webflow-cms-images.ts:66` (245 lines), types `shared/types/cms-images.ts` | at_risk | — | Prototype has no CMS dimension at all. FEATURE_AUDIT.md:1678 documents it as a headline capability. |
| 19 | CMS filters ("CMS Images", "CMS Missing Alt") mutually exclusive with non-CMS filters | `AssetBrowser.tsx:41-44,121-138,167-187`, `AssetFilters.tsx:20-22` | at_risk | — | |
| 20 | **CMS field selector**: per-collection checkbox panel; smart defaults (meta/OG/thumbnail unchecked); selected fields gate CMS filter AND which CMS refs are patched on compress/bulk-compress | `AssetBrowser.tsx:87-99,302-304,404-406,672-678`, `src/components/assets/CmsFieldSelector.tsx:37,55` | at_risk | — | Protects intentionally-sized OG images from compression-triggered ref rewrites. |
| 21 | CMS usage badges on cards (collection → field tooltips); RichText-only assets get compress disabled with explanation | `AssetCard.tsx:145,243-252`, `AssetBrowser.tsx:79-85,709` | at_risk | — | |
| 22 | Per-card "Open in new tab" (view original asset) | `AssetCard.tsx:262` | at_risk | — | Trivial, but not in prototype card actions. |
| 23 | Error banner (dismissible) for alt/rename/compress/organize failures; partial-failure messaging ("N saved, M failed") | `AssetBrowser.tsx:154,284,554-561` | preserved | mutation feedback contract (Build Conventions) | New build's mutation contract must carry per-item partial failure, not just toasts. |
| 24 | Loading state ("Loading assets...") and empty states (no assets / no search match) | `AssetBrowser.tsx:500-507,721-723` | preserved | four-states rule | Prototype shows a "Nothing matches this filter" empty (assets.js:231). |
| 25 | "Link a Webflow site" empty state when no `siteId` (Browse + Audit) | `MediaTab.tsx:72-79,85-92` | preserved | locked/empty state | Maps to the required "locked" state in the new state matrix. |

### 1b. Audit sub-tab (`AssetAudit`) — default sub-tab at HEAD

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 26 | On-demand asset audit scan (published pages + CMS + CSS + assets), 30–60s, explicit "Run Asset Audit" entry state + re-scan | `src/components/AssetAudit.tsx:65-77,226-253,498-506`, `server/routes/webflow-audit.ts:20` | at_risk | Parity ledger says "AssetAudit (oversized · alt) → present, at: Asset Manager" but the prototype view has **no audit scan/score mode** — its filters are computed from live asset metadata only. | 8 issue classes at HEAD (webflow-audit.ts:76-115): missing-alt, low-quality-alt, duplicate-alt, oversized, unoptimized-png, legacy-format, duplicate (size-group heuristic), unused. Prototype covers only oversized/no-alt/unused. |
| 27 | Asset health score (0–100, issue ratio; ≥80 emerald / ≥50 amber / <50 red) | `AssetAudit.tsx:257-273` | at_risk | — | No score anywhere in prototype assets.js. |
| 28 | Summary cards as filters (score/all, missing alt, oversized, unused) + secondary pills (low-quality-alt, duplicate-alt, duplicates, unoptimized-png, legacy-format) | `AssetAudit.tsx:263-344` | at_risk | — | The 5 secondary issue classes have no prototype home. |
| 29 | Issue rows: thumbnail, issue badges, file size, **used-on pages list** (names, tooltip) | `AssetAudit.tsx:528-571`, `usedIn` from `webflow-audit.ts` | improved (partially) | Card "in N pages" (assets.js:172) | Prototype shows count only; HEAD lists *which* pages (title attr `AssetAudit.tsx:565`). Page names must survive. |
| 30 | Lightbox modal: full image preview + badges + used-on + inline actions (generate alt / compress / delete / copy URL) | `AssetAudit.tsx:626-721` | at_risk | — | No preview modal in prototype. |
| 31 | Filter-aware bulk quick actions: Generate All Alt Text (N) / Compress All (N incl. unoptimized-png) / Delete All Unused (N) | `AssetAudit.tsx:412-487` | improved (partially) | bulk bar | Prototype bulk ops operate on manual selection; HEAD also offers one-click whole-category ops without selecting. "Delete All Unused" has no prototype equivalent → at_risk (row 15/33). |
| 32 | Search issues by filename or page; sort by Most Issues / Largest / Name | `AssetAudit.tsx:210-221,384-409` | at_risk | — | |
| 33 | Delete single unused asset + Delete-all-unused (confirm) | `AssetAudit.tsx:172-208`, `server/routes/webflow.ts:81` | at_risk | — | See row 15 — no delete affordance in prototype. |
| 34 | **Export audit as CSV** (assetId, filename, size, issues, used-on, URL) | `AssetAudit.tsx:127-148,488-497` | at_risk | — | No export in prototype. |
| 35 | "Showing X of Y issues" + clear-filter, all-clear success state | `AssetAudit.tsx:510-526` | preserved | list header / empty state | |

### 1c. Upload sub-tab + pipeline

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 36 | DropZone × 2: **Assets** (→ AVIF conversion, SVG minify) and **Meta/OG** (→ optimized JPEG, format kept for social) — drag-drop or click-to-browse, multi-file | `MediaTab.tsx:51-60`, `src/components/DropZone.tsx:13-134`, endpoints `server/routes/misc.ts:35,53` | at_risk | Prototype "Upload" is a single toolbar button with a stub toast: "Drop images to add them to the Webflow library" (assets.js:225,250) — no asset/meta distinction, no pipeline. | The asset-vs-meta split changes the optimization profile server-side (`moveUploadedFiles(files, ws, isMeta)`). |
| 37 | **Clipboard paste upload (⌘V)** — global listener, HDPI 2x downscale via sharp, filename toast | `src/App.tsx:267-304,470-472`, `server/routes/misc.ts:210-253`, hint `MediaTab.tsx:57-60` | at_risk | — | Works app-wide for the selected workspace; surfaced/documented on this tab. |
| 38 | **Processing queue**: watcher pipeline optimizing → generating-alt → uploading (to Webflow) → done/error; per-item alt text shown; copy-filename; live via WS `queue:update` + `files:uploaded`; persisted metadata | `MediaTab.tsx:61-64`, `src/components/ProcessingQueue.tsx`, `src/hooks/admin/useQueue.ts:9`, `src/App.tsx:323,355-357`, `server/processor.ts:1-100`, `server/ws-events.ts:195,201` | at_risk | — | Entire local-upload optimization pipeline (chokidar watcher, AVIF/SVG/JPEG optimize, auto alt-text, auto Webflow upload, metadata.json) is invisible in the prototype and in the parity-ledger Assets row. |

### 1d. Cross-cutting

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 39 | Auth: all endpoints behind `requireWorkspaceSiteAccess*` / `requireWorkspaceAccess`; alt-gen routes carry workspaceId in path (security fix) | `server/routes/webflow.ts:60-116`, `webflow-alt-text.ts:38-39,139`, FEATURE_AUDIT.md:5475-5477 | preserved | server unchanged | Rebuild is UI-only; keep param shapes. |
| 40 | **Tier gate: monthly AI alt-text generation quota** (`incrementIfAllowed(ws.id, ws.tier, 'alt_text_generations')` → 429 "Monthly AI generation limit reached"; bulk stream stops mid-run with status message) | `server/routes/webflow-alt-text.ts:47-49,154,213` | at_risk (UI half) | — | Server gate survives by construction, but the new UI needs the 429/limit-reached presentation ("locked" state of the AI actions). Prototype never shows it. |
| 41 | Workspace switch resets view (remount via `key={siteId}` / `key={selected.folder}`; audit state cleared) | `src/App.tsx:396`, `MediaTab` keys `MediaTab.tsx:70,83`, `AssetAudit.tsx:74-77` | preserved | standard | |
| 42 | React Query cache discipline: optimistic `setQueryData` on all 8 mutation paths; invalidate on job completion | `AssetBrowser.tsx:101-117,434`, FEATURE_AUDIT.md:2697 | preserved | React Query hooks | |
| 43 | Adjacent-surface hand-offs INTO this surface: Performance Page Weight pairs with Asset Manager compression (detect → fix loop) | FEATURE_AUDIT.md:2131, `src/components/Performance.tsx:32` | improved | Prototype formalizes it: Site Audit deep-links in via `AssetsView.open(filter)` (assets.js:257-258); Performance surface hands heavy pages to Asset Manager (Parity Ledger, Performance row) | HEAD has **no deep-link receiver** on `media`; the prototype's `open(filter)` implies a new `?filter=`/`?tab=` contract — must follow the two-halves deep-link rule (CLAUDE.md UI/UX #12). |

Out of scope for this surface (verified owned elsewhere): Page Weight lives on `Performance` (`src/components/Performance.tsx:32`, endpoints `server/routes/webflow-audit.ts:148,208`); E-E-A-T assets live in Brand Hub/settings (`src/components/settings/EeatAssetsTab.tsx`, `server/routes/eeat-assets.ts:37-169`) — the parity ledger homes them at "trust assets", not Asset Manager.

---

## 2. Prototype coverage notes (`mockup/assets.js`)

**Demonstrates (10):** browse grid with per-asset cards; 4 stat cards (total weight / oversized / potential savings / missing alt); filter pills all/over/noalt/unused with counts; multi-select + select-all-shown; bulk bar (compress / generate alt / smart rename / clear); single compress with savings % + "CMS refs updated" toast; AI alt generation; smart rename; upload button (stub); SVG "Vector" no-compress state.

**Omits (the at-risk list):** search; sort; images/svg/used filters + multi-filter OR; manual alt edit; delete (single, bulk, all-unused); Organize into Folders; the entire CMS scan/filter/field-selector/badges layer; the entire Audit mode (score, 8 issue classes incl. low-quality-alt/duplicate-alt/duplicates/legacy-format/unoptimized-png, used-on page names, lightbox, CSV export, re-scan); the entire Upload pipeline (asset/meta drop zones, ⌘V clipboard, processing queue, AVIF pipeline); AI quota-limit UI; open-in-new-tab.

**Proposes NEW (needs sign-off):**
1. **Total media weight** + **potential savings (~55% heuristic)** stat cards (assets.js:181-186,213-215) — HEAD computes neither.
2. **Image dimensions (w×h)** on cards (assets.js:172) — not in HEAD's `Asset` shape (`AssetBrowser.tsx:23-33`); needs data ticket (Webflow API exposes it, but the current endpoint doesn't map it).
3. **Site Audit → Asset Manager deep-link with pre-set filter** (`AssetsView.open(f)`, assets.js:257-258) — new receiver contract on `media`.
4. **"Graduation" note → Insights Engine** ("cut page weight 62%, LCP now passing", assets.js:233) — implies a new outcome/insight write when a compression pass measurably moves CWV. Pure new functionality; no HEAD analogue.
5. **Card-grid layout** replacing HEAD's table-like rows — layout improvement, fine if all row affordances (manual alt edit, rename draft, CMS badges, open-in-new-tab) find card homes.
6. Purple styling for AI actions (assets.js:47,78) — admin-only surface, consistent with the Four Laws.

---

## 3. Parity Ledger reconciliation

The Platform Parity Ledger's **Assets** row (`comp:'AssetBrowser · media'`, → 'Asset Manager', status **improved**) lists 4 tools, all `present`: Browse Webflow assets → grid; Compress (single+bulk) → bulk ops; AI alt text + smart rename → per-asset; Unused/oversized flags → filters. The Site Audit row also homes "AssetAudit (oversized · alt) → present, at: Asset Manager".

- **No Gap/Partial rows exist for this surface in the ledger** — but the ledger's 4-function granularity is far coarser than HEAD (43 capabilities enumerated above). The ledger row being all-green does **not** resolve the omissions: the prototype demonstrably lacks the Audit mode it claims Asset Manager absorbs (row 26), plus the CMS layer, upload pipeline, organize, delete, search/sort, and manual alt edit.
- Resolution status: rows 1, 7, 9–14, 16, 23–25, 29(partial), 31(partial), 35, 39, 41–43 resolve as preserved/improved. Rows 3, 5, 6, 8, 15, 17–22, 26–28, 30, 32–34, 36–38, 40 remain **unresolved at-risk** and must be worked into the mockup or explicitly re-homed before build.

---

## 4. Quick-win vs full implementation trade-offs

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Audit mode | Fold HEAD's 8 issue classes into the browse grid as extra filter pills computed client-side from the existing audit endpoint; drop the score card initially | Dedicated Audit mode with health score, summary cards, CSV export, lightbox, re-scan | Loses the score trend narrative and the "run scan" moment; used-on page names need the audit endpoint anyway, so the client-side shortcut can't fake `usedIn` |
| CMS layer | Ship grid with CMS badges + "CMS Images / CMS Missing Alt" filters only; defer field selector (compress patches ALL usages) | Full field selector with smart defaults gating filter + compression scope | Compressing with all-fields default can rewrite intentionally-sized OG/meta images — the field selector exists specifically to prevent that (FEATURE_AUDIT.md:1678). Safer quick win: defer CMS-aware compression entirely until selector ships |
| Upload pipeline | Keep HEAD's Upload sub-tab (DropZone + ProcessingQueue) as-is inside the new shell, restyled with system primitives only | Redesign upload as a modal/drawer launched from the prototype's Upload button, queue as a toast-stack/jobs panel | None functionally — quick win is pure reskin; the full version risks losing ⌘V discoverability and the meta-vs-asset split |
| Deep-link receiver (new) | Support `?filter=oversized|missing-alt|unused` on `media` per the two-halves contract | Also accept `?tab=audit|browse|upload` + per-issue-class filters | Quick win covers the prototype's promised Site Audit hand-off; wire receiver test per `tests/contract/tab-deep-link-wiring.test.ts` pattern |
| New stat cards (weight/potential savings) | Compute both client-side from already-fetched asset list (sum sizes; 55% heuristic on oversized) | Server-computed savings estimate from actual sharp dry-run | Heuristic can over-promise savings %; label as estimate |
| Dimensions on cards | Omit initially (data not in endpoint) | Add w×h to `/api/webflow/assets/:siteId` mapping + `Asset` type | None — additive data ticket |
| Bulk ops | Keep HEAD wiring exactly (NDJSON alt stream, `bulk-compress` background job) behind new bulk-bar UI | Migrate bulk alt-text to the background-job platform too (parity with bulk-compress) | None for quick win; full version is a behavior improvement (survives tab close) but touches `docs/rules/background-generation.md` contract |

---

## 5. Open questions (stop-and-ask — owner sign-off needed)

1. **Where does Audit mode live in the new Asset Manager?** The parity ledger homes "AssetAudit" here, but the prototype has no scan/score/issue-class UI. Options: (a) third mode/tab inside Asset Manager mirroring HEAD; (b) merge into browse grid as filters + a score header; (c) relocate the audit-y parts (score, CSV, low-quality/duplicate-alt classes) into Site Audit. Never silently drop the 5 issue classes the prototype lacks.
2. **Upload pipeline home**: does the Upload sub-tab (asset/meta drop zones, ⌘V paste, processing queue, AVIF pipeline) stay a mode of Asset Manager, become a global affordance (queue already lives in `useBackgroundTasks`-adjacent territory), or get its own surface? Prototype's stub button implies uploading straight to the Webflow library — that is a *different behavior* than HEAD's local optimize-then-upload pipeline; changing it is not additive without sign-off.
3. **Organize into Folders**: keep (where?), or deliberately retire? It's a shipped, working feature (preview + execute, `server/routes/webflow-organize.ts:27,143`) absent from both prototype and ledger. Retirement requires explicit owner decision, not omission.
4. **CMS field selector scope**: is the quick-win path (defer selector, defer CMS-aware compression) acceptable, or is the full selector a launch requirement given the OG-image-clobbering risk?
5. **"Graduation" to Insights Engine** (new_proposed #4): define trigger + data contract (compression pass → CWV delta → insight write). Which system owns the measurement — Performance, insight bridges, or outcome tracking?
6. **Delete affordances**: prototype has zero delete. Confirm single delete, bulk delete, and Delete-All-Unused all return in the new UI (and whether they keep `window.confirm` or move to `ConfirmDialog`).
7. **AI quota "locked" state**: how should the 429 monthly-limit render in the new design system (disabled AI buttons with tooltip? banner?) — required by the four-states rule but undefined in the prototype.

---

*Read-only audit; evidence gathered at branch `ui-rebuild-phase-0`. This file is the only write.*
