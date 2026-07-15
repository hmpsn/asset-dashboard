# Wave 2 BUILD TICKET — Asset Manager (Page `media`)

> **Surface:** admin `Page 'media'` → HEAD `MediaTab` (`src/App.tsx:396`, nav `src/lib/navRegistry.tsx:131-132`, group `site-health`, label "Assets").
> **Wave:** W2 · **Lane:** A-lane (operator/admin surface) behind `ui-rebuild-shell`.
> **Effort:** **L** (43 carried capabilities across Browse/Audit/Upload; three lenses; CMS layer; AI actions with 429 state; new deep-link receiver).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` → `CROSS_SURFACE_CONTRACTS.md` → `BUILD_CONVENTIONS.md` (esp. §4 429, §7 structural template) → surface JSON (`surfaces/asset-manager.json`) → phase0 doc (`phase0/surfaces/asset-manager.md`) → this ticket. When this ticket and the Keywords pilot (`src/components/keywords-rebuilt/`, PR #1480/#1481) disagree, the pilot is right.

---

## 1. ⚠ OWNER DELTAS

**none — all per-surface-dispatch defaults adopted.** Every one of the ~7 needsOwner discovery questions (OQ1–OQ7 + the newly-found dimensions probe) resolves to its `proposedDefault`, and each is now covered by a ratified AD row or the W0.5 probe:

| Discovery OQ | Resolution (default adopted) | Backing |
|---|---|---|
| OQ1 — Audit-mode home | **Audit as a lens inside Asset Manager** (score `Meter` header + issue-class `FilterChip`s), keep all 8 issue classes | surface-doc default + AD-010 (T1 carry-over) + AD-011 (no capability drop) |
| OQ2 — Upload-pipeline home | **Upload as a lens** — both drop zones + processing queue + ⌘V hint, no behavior change | AD-010 T1 carry-over-then-reskin (list names asset Upload/Organize lenses explicitly) |
| OQ3 — Organize into Folders | **Keep** — Toolbar action opening the preview in a `Drawer`; retirement would need explicit sign-off | AD-010 + AD-011 (capability drop violates hard floor) |
| OQ4 — CMS field selector | **Ship the full selector at launch** (safety gate); if cut, CMS-aware compression defers WITH it | **AD-019** (verbatim) |
| OQ5 — Graduation → Insights Engine | **Defer to a C3-style follow-up** (SB-023); not a rebuild-parity item | **AD-004** (graduation bridges deferred wholesale) — DEF row below |
| OQ6 — Delete affordances | **Keep all three** (single, bulk, delete-all-unused); migrate `window.confirm` → `ConfirmDialog` | surface-doc default; no owner override needed |
| OQ7 — AI-quota 429 render | **Disabled AI actions + quota tooltip + first-429 dismissible banner + bulk partial-run tally** | **AD-020** → BUILD_CONVENTIONS §4 |
| NEW — Webflow list-assets dimensions? | **NO** — original payload carries no w×h; derive lazily/batched, never block list render | **probes.md Probe 1** → SB-022 rides at **M** |

None of these defaults is genuinely uncertain — each is either a ratified AD row or a probe-confirmed fact. No item goes back to the owner.

---

## 2. Capability checklist

All 43 HEAD capabilities carried. Grouped by the three lenses (Browse default, Audit, Upload) per the pilot structural template (BUILD_CONVENTIONS §7). Evidence file:lines are HEAD; the rebuild is UI-only unless a Server ticket (§3) is cited.

### 2a. Browse lens (default) — from `AssetBrowser`
- [ ] **1** List Webflow assets (name, alt, size, type, createdOn, thumbnail) — card grid via `GroupBlock`/`DataTable` (`useWebflowAssets` → `GET /api/webflow/assets/:siteId`, `server/routes/webflow.ts:60`).
- [ ] **2** Stat row → `MetricTile` grid: total, missing-alt, oversized, **unused**, **CMS count** (carry the unused+CMS counts the prototype drops) + new **total media weight** + **potential savings** tiles (§ new features, client-side estimate, labelled `estimate`).
- [ ] **3** Search by filename/alt → `SearchField` (prototype omits; **must be carried** — `AssetBrowser.tsx:170-175`).
- [ ] **4/5** Filter pills with counts → `FilterChip` bar; **keep HEAD multi-select OR** via `useToggleSet` (not prototype single-select); carry `images`/`svg`/`used` pills (`AssetBrowser.tsx:119-138`).
- [ ] **6** Sort newest/name/size → Toolbar sort control or `DataTable` header sort.
- [ ] **7** Multi-select + select-all-shown + **sticky bulk bar** (pilot pattern `KeywordsTable.tsx:511-548`, `z-[var(--z-dropdown)]`).
- [ ] **8** Inline manual alt-text edit — card/drawer affordance the prototype lacks; carry (`PATCH /api/webflow/assets/:assetId`, `webflow.ts:71`).
- [ ] **9** Single AI alt-text generation (vision + page-usage context; writes to Webflow) — quota-gated presentation is §4 429 pattern (`webflow-alt-text.ts:38-121`).
- [ ] **10** Bulk AI alt-text **NDJSON stream + live progress** — keep the stream; live progress UI must survive, toast-only is a regression (`webflow-alt-text.ts:139-213`).
- [ ] **11** Single compress with **CMS-ref patch**; SVG excluded (`webflow-alt-text.ts:274-325` route body).
- [ ] **12** Bulk compress **background job** — stays on `useBackgroundTasks` + `server/webflow-bulk-compress-background-job.ts`; do not resynchronize.
- [ ] **13/14** AI smart rename single + bulk — **keep the editable-draft confirm step** (`misc.ts:86`, `webflow-organize.ts:202`).
- [ ] **15/33** Delete single, bulk, **delete-all-unused** — keep all three, `window.confirm` → `ConfirmDialog variant="destructive"` (OQ6).
- [ ] **16** Unused-asset flag/badge from `useAssetAudit` unused-ID set (`useAdminAssets.ts:39`).
- [ ] **17** **Organize into Folders** (preview → execute) — Toolbar action opening preview in a `Drawer` (OQ3; `webflow-organize.ts:27,143`).
- [ ] **22** Open asset in new tab — card action.
- [ ] **23** Error banner + **per-item partial-failure tally** ("N saved, M failed") via `useToast` + `InlineBanner`.
- [ ] **24/35** Loading (`Skeleton` grid) / empty (dual `EmptyState`: no-assets vs filtered clear-filter CTA) / "showing X of Y".
- [ ] **25** "Link a Webflow site" **locked** state (no `siteId`) — new state-matrix locked branch.

### 2b. CMS layer (Browse-scoped) — from `AssetBrowser`
- [ ] **18** CMS image scan (`useCmsImages` → `GET /api/webflow/cms-images/:siteId`, `webflow-cms-images.ts:66`).
- [ ] **19** CMS filters ("CMS Images" / "CMS Missing Alt"), **mutually exclusive** with non-CMS filters — carry the mutual-exclusion logic.
- [ ] **20** **CMS field selector** — per-collection checkbox panel, smart defaults (meta/OG/thumbnail unchecked); gates CMS filter AND compression scope. **Ships at launch** (AD-019). If cut → defer CMS-aware compression with it.
- [ ] **21** CMS usage badges + RichText-only compress-disabled with explanation.

### 2c. Audit lens — from `AssetAudit`
- [ ] **26** On-demand audit scan (published pages + CMS + CSS + assets) — **all 8 issue classes** (missing-alt, low-quality-alt, duplicate-alt, oversized, unoptimized-png, legacy-format, duplicate, unused); explicit "Run Asset Audit" entry + re-scan (`webflow-audit.ts:20,76-115`). **Never drop the 5 secondary classes.**
- [ ] **27** Asset health score (0–100) → `Meter` header; color via `scoreColor()`/`scoreColorClass()` — **server-computed, never client-derived** (BUILD_CONVENTIONS §5, AD-016).
- [ ] **28** Summary + secondary issue-class cards → `FilterChip`s (all 8 classes preserved).
- [ ] **29** Used-on **page names** (not just count) — `usedIn` from audit endpoint; names survive in card/drawer.
- [ ] **30** Lightbox → recompose as `Drawer` asset-detail panel with inline actions (all existing endpoints).
- [ ] **31** Filter-aware one-click bulk category ops (Generate-all-alt / Compress-all / Delete-all-unused).
- [ ] **32** Audit search + sort (Most Issues / Largest / Name).
- [ ] **34** **CSV export of audit** — client-side today (`AssetAudit.tsx:127-148`); **hard-floor forbids export drops** (AD-011); Toolbar overflow.

### 2d. Upload lens + pipeline — from `MediaTab`/`ProcessingQueue`
- [ ] **36** Two drop zones — **Assets** (AVIF/SVG-minify) vs **Meta/OG** (JPEG, format kept); the split changes the server optimize profile (`moveUploadedFiles(files, ws, isMeta)`, `misc.ts:35,53`).
- [ ] **37** ⌘V clipboard paste upload (global listener, HDPI 2× downscale) — surfaced on this lens (`App.tsx:267-304`, `misc.ts:210-253`).
- [ ] **38** Processing queue (optimizing → generating-alt → uploading → done/error), live via WS `queue:update` + `files:uploaded`; keep `useQueue` + `server/processor.ts`. **T1 carry-over-then-reskin — no behavior change** (OQ2/AD-010).

### 2e. Cross-cutting
- [ ] **39** Auth unchanged — keep `requireWorkspaceSiteAccess*` / `requireWorkspaceAccess` param shapes exactly (UI-only rebuild).
- [ ] **40** **AI-quota 429 locked state** — §4 pattern (see §Flag / OQ7): disabled AI actions + quota tooltip + first-429 dismissible banner + bulk partial-run tally (`webflow-alt-text.ts:47-49,154,213`).
- [ ] **41** Workspace switch resets view — keep `key={siteId}` remount.
- [ ] **42** React Query discipline — carry the 8 optimistic `setQueryData` paths + job-completion invalidation.
- [ ] **43** **Deep-link receiver** on `media` (new frontend contract — §4 matrix).

### 2f. Adopted new features (from kit / prototype)
- [ ] Total media weight + potential-savings (~55% heuristic) `MetricTile`s — **client-side** from the fetched asset list; label `savings` as an **estimate** (no-fabricated-numbers floor). Full sharp dry-run = SB-059, **deferred**.
- [ ] Image dimensions (w×h) on cards — **SB-022** data ticket; **omit gracefully until the field lands** (probe: derived async, not payload-read).
- [ ] Site Audit → Asset Manager deep-link with pre-set filter — pure frontend two-halves contract (§4).
- [ ] Card-grid layout — fine *iff* every row affordance (manual alt edit, rename draft, CMS badges, open-in-new-tab, delete) gets a card/drawer home.
- [ ] Purple styling for AI actions — **admin-only surface**, consistent with Four Laws law 4 (never leaks client-side; this surface is admin `media`).

---

## 3. Server tickets [ride vs defer]

| SB | Title | Effort | Disposition | Rationale |
|---|---|---|---|---|
| **SB-022** (sn-asset-manager-1) | Asset dimensions (w×h) on Webflow asset rows | **M** (probe-adjusted from S) | **RIDES W2** — background-derivation design | probes.md Probe 1: Webflow v2 list-assets payload carries NO original w×h (only variant breakpoint `width`, `height:null`). **Derive lazily/batched** (fetch `hostedUrl` + parse image header, or `sharp` metadata), **persist on the asset row, NEVER block the list render** on dimension fetches. Cards omit dimensions gracefully until the field is populated. Home: `server/webflow-assets.ts` (listAssets mapping + `WebflowAsset`) + `src/hooks/admin/useAdminAssets.ts`. No DB migration (in-memory passthrough shape). Shared with site-audit, performance. |
| **SB-023** (sn-asset-manager-2) | Compression graduation insight (CWV-move on compress pass) | M | **DEFERS** → C3-later | **AD-004** defers all insight-graduation bridges wholesale to one owner-signed C3-era cross-surface contract; **OQ5** measurement-ownership unresolved. Ships a **DEF-\*** row (§7), not an ad-hoc graduation write. Could register through SB-001's seam once it lands. |
| **SB-059** (sn-asset-manager-3) | Optional server-side compression savings estimate (sharp dry-run) | M | **DEFERS** (conditional) | Ships **only if the client 55% heuristic is rejected**. Quick-win is client-side from the already-fetched asset list (adopted in §2f). Verifier correction: savings computed in `compressImageBuffer` (the webflow-alt-text **service** module), not route lines 274-325. |

**Net: 1 SB rides (SB-022 at M), 2 defer (SB-023 → C3; SB-059 conditional).**

No new Webflow **write** path is introduced by this ticket — export-only parity v1 per **AD-017**. Any future save-draft / publish-to-CMS / auto-redirect write is a flagged, owner-signed follow-up under the `seo-editor-write-targets` contract, NOT this PR.

---

## 4. Deep-link receiver matrix (Page `media` — NEW receiver + contract test)

**No `?tab=` deep link exists at HEAD** (`MediaTab.tsx:25`, sub-tab state is local `useState`; grep `useSearchParams` in MediaTab/AssetBrowser/AssetAudit is empty). The rebuild adds the receiver half of the two-halves contract (CLAUDE.md UI rule 12).

| Param | Values | Semantics | Sender(s) | Test |
|---|---|---|---|---|
| `?tab=` | `browse` \| `audit` \| `upload` | selects the lens (Browse default) | Site Audit (`AssetsView.open(filter)` prototype `assets.js:257-258`), Performance Page-Weight hand-off (`Performance.tsx:32`) | static + runtime |
| `?filter=` | `oversized` \| `missing-alt` \| `unused` (+ issue-class values when landing on `audit`) | pre-sets the FilterChip axis on arrival | Site Audit / Performance senders above | static + runtime |

**Receiver wiring (pilot template `useKeywordsSurfaceState.ts:58-104`):**
- Read + **validate each param through a type-guard with a default** — never trust a raw param.
- **Use a separate `lens` param for the surface's own sub-mode** if you keep an internal lens distinct from `?tab=`; do NOT overload `tab` for a private axis (pilot review finding PR #1480, lines 47-51). Here `?tab=` is the sanctioned lens deep-link, so map `tab → lens` at the receiver and reserve `?filter=` for the FilterChip axis.
- Writes through one `updateParams` helper (`replace: true`, deletes empty keys).

**Tests (both required, BUILD_CONVENTIONS §8):**
1. Static: keep `tests/contract/tab-deep-link-wiring.test.ts` green — register the new `media` sender↔receiver pair.
2. Runtime: render the surface at a fully-loaded deep-link URL (e.g. `/ws/ws-1/media?tab=audit&filter=oversized`) and assert every param landed (pilot `KeywordsSurface.test.tsx:516`).

**Sequencing note:** the Site Audit and Performance **sender** halves land at those surfaces' own ticket-cuts; this ticket owns only the `media` **receiver** half + its tests. A `?tab=`/`?filter=` URL whose target ignores the param is a silent navigation bug — the receiver must ship in this PR regardless of sender timing.

---

## 5. Flag disposition

| Flag | Kind | Disposition |
|---|---|---|
| `ui-rebuild-shell` | A-lane shell gate | **Gates this surface.** One-line `REBUILT_SURFACES['media']` entry mounts the rebuilt surface inside `RebuiltAppChrome` when ON; flag-OFF falls through to legacy `MediaTab` byte-identical (`rebuiltSurfaces.ts:5-16`). No new flag introduced by this surface. |
| AI-quota gate (server 429) | backend gate | **Not a UI flag** — `incrementIfAllowed(ws.id, ws.tier, 'alt_text_generations')` → 429 (`webflow-alt-text.ts:47-49`). Stays lifecycle-governed on the server; the UI adopts the **AD-020 / §4** 429 presentation only (disabled AI actions + quota tooltip via `ui/overlay/Tooltip.tsx` + first-429 dismissible `InlineBanner` + bulk partial-run tally). Detect via `ApiError.status === 429` — write the 429 twin of the pilot's `isLockedError` branch (`KeywordsSurface.tsx:53-55`).
| CMS-aware compression | scope gate | **No flag** — governed by the CMS field selector shipping at launch (AD-019). If the selector is cut, CMS-aware compression defers **with it** (not behind a separate flag). |

No surface retires a flag outside the AD-006 mapping. Per AD-006, `ui-rebuild-shell` is on the UI-shell rebuild-retirement track; no backend/phase/tier gate is touched here.

---

## 6. File ownership

Exclusive ownership for this ticket (no other Wave-2 surface writes these):

```
src/components/asset-manager-rebuilt/**          NEW — the rebuilt surface directory (@ds-rebuilt header on every file)
  AssetManagerSurface.tsx                        page skeleton (PageHeader → Toolbar → FilterChip → MetricTile grid → lens body)
  AssetGrid.tsx / AssetTable.tsx                 Browse grid (GroupBlock/DataTable, self-carded — no SectionCard double-wrap)
  AssetDrawer.tsx                                asset-detail Drawer (replaces lightbox; KeyValueRow metadata)
  AuditLens.tsx                                  Audit lens (Meter score header + issue-class FilterChips + CSV export)
  UploadLens.tsx                                 Upload lens (T1 carry-over: DropZone×2 + ProcessingQueue + ⌘V hint, reskinned)
  OrganizeDrawer.tsx                             Organize-into-Folders preview Drawer (T1 carry-over)
  useAssetManagerSurfaceState.ts                 URL/view state (lens, filter, search, sort, selection) — validated type-guards
  assetManagerMutationFeedback.ts                toast strings via useToast + mutationErrorMessage (no forked helper)

src/components/layout/rebuiltSurfaces.ts         ADD one line: 'media': lazyWithRetry(() => import('../asset-manager-rebuilt/AssetManagerSurface')...)
tests/component/asset-manager-rebuilt/**         NEW — flag-transition test (seeded QueryClient, real useFeatureFlag) + a11y floor
tests/contract/tab-deep-link-wiring.test.ts      EDIT — register media ?tab=/?filter= sender↔receiver pair
data/ui-rebuild-deferred-ledger.json             EDIT — add DEF rows (§7)
```

**Reused, NOT rewritten (T1 carry-over, AD-010 — restyle shell, never redesign):** the existing data hooks (`useWebflowAssets`/`useAssetAudit`/`useCmsImages`/`useQueue`/`useBackgroundTasks` in `src/hooks/admin/useAdminAssets.ts`, `useQueue.ts`), all existing endpoints (`server/routes/webflow*.ts`, `misc.ts`, `webflow-organize.ts`, `server/processor.ts`, `webflow-bulk-compress-background-job.ts`), `DropZone`/`ProcessingQueue`/`CmsFieldSelector`/`OrganizePreview` machinery (reskinned to tokens, not rebuilt — pilot shape is the `KeywordBulkConfirmDialog` reuse). Server is **UI-only untouched** except SB-022's additive dimension field.

**Do NOT touch:** any client-facing component (`src/components/client/**`) — this is an admin-only surface; any Frozen Contract (CROSS_SURFACE_CONTRACTS register 1-11); the Site Audit / Performance sender surfaces (their receiver senders land at their own tickets).

---

## 7. D8 / DEF entries

**D8 redirect map:** none. Page `media` is **not** renamed or removed — the route id survives; only the internal shell mount changes behind `ui-rebuild-shell`. No `D8_REDIRECT_MAP.md` entry required. (Contrast: the retired `brief` page needed one.)

**Deferred-ledger (`DEF-*`) rows — required in the SAME PR (`npm run verify:deferred-ledger`):**

| Proposed id | item | decision | class | upgradeTrigger | roadmapItemId |
|---|---|---|---|---|---|
| `DEF-asset-manager-001` | Compression graduation insight (CWV-move) | Defer the insight write to the owner-signed C3-era graduation contract (AD-004); ship parity without it | deferred-derivation | C3 graduation cross-surface contract lands (SB-023 / SB-001 seam) | *(link to the AD-004 / SB-023 roadmap item)* |
| `DEF-asset-manager-002` | Server-side savings estimate (sharp dry-run) | Ship the client 55% heuristic (labelled `estimate`); defer the server dry-run unless the heuristic is rejected | deferred-derivation | client heuristic rejected as inaccurate (SB-059) | *(link to SB-059 roadmap item)* |
| `DEF-asset-manager-003` | Asset dimensions (w×h) shown | Cards omit w×h until SB-022's background-derived field is populated; no N+1 fetch on list render | deferred-field | SB-022 background dimension-derivation lands and backfills | *(link to SB-022 roadmap item)* |

Copy field shapes from an existing entry (e.g. `DEF-foundation-001`): `id`, `surface: "asset-manager"`, `item`, `decision`, `class`, `upgradeTrigger`, `owner`, `status: "open"`, `roadmapItemId`, `createdAt`, `reviewBy`, `links`.

---

*Analysis + doc only; no code changes. Evidence grounded in file:line / JSON row above; effort numbers reflect the W0.5 probe adjustment (SB-022 S→M).*
