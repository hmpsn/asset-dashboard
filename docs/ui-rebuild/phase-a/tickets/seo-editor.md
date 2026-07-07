# Wave 4 BUILD TICKET - SEO Editor (Page `seo-editor`)

**Surface:** Admin SEO Editor (`Page` id `seo-editor`)
**HEAD component + mount:** `src/App.tsx:410` lazy-loads `SeoEditorWrapper`; `src/App.tsx:414` mounts it for `tab === 'seo-editor'`.
**Wave / lane / effort:** Wave 4, A-lane admin surface behind `ui-rebuild-shell`; XL/T1 carry-over-then-reskin (machinery-dense, zero-drop).
**Read order:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` -> `surfaces/seo-editor.json` -> `phase0/surfaces/seo-editor.md` -> `docs/rules/seo-editor-write-targets.md` -> `owner-decisions.json` -> `server-backlog.json`.
**Mount contract:** Add exactly one `REBUILT_SURFACES['seo-editor']` entry per `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:203`; do not add a new branch in `App.tsx`.
**Frozen/domain law:** Frozen Contract #6 preserves `PUT /api/webflow/pages/:pageId/seo` and its `{ seo, openGraph, title }` payload (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:68`); the live route is `server/routes/webflow.ts:257`. D3 write-target law is mandatory: static writes use page SEO APIs, CMS writes use real collection item APIs, and manual rows are visible-only (`docs/rules/seo-editor-write-targets.md:7`).

---

## 1. ⚠ OWNER DELTAS

**none - all documented defaults adopted.** Every SEO Editor discovery question resolves to a ratified owner decision, frozen contract, D3 write-target rule, or explicit DEF follow-up. No new owner decision is invented here.

| Discovery item | Resolution for Wave 4 | Backing evidence |
|---|---|---|
| Q1 / N3 H1 + slug editing | Render read-only/reference only in v1; no writable H1/slug controls. Defer to `SB-029` and redirect prerequisite `SB-026`. | Default says read-only v1 (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:327`); AD-017 makes new Webflow write paths follow-ups (`docs/ui-rebuild/phase-a/owner-decisions.json:233`); `SB-029` confirms no route is threaded and depends on redirects (`docs/ui-rebuild/phase-a/server-backlog.json:404`). |
| Q2 / N10 Research mode | Adopt Research mode as the Page Intelligence fold-in, but do not retire the standalone `Page` in this PR. If/when `page-intelligence` is removed, that separate change follows the route-removal checklist and D8. | Default says D3 is locked and APIs exist (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:333`); composition lists Research mode (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:450`); cross-surface dep names D8 only on route retirement (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:489`). |
| Q3 / N2 recommendations + optimization score | Preserve row recommendation flags and rec-first sort; show optimization score only from server-backed page keyword projection, never a client heuristic. | Q3 default (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:339`); AD-016 server score authority (`docs/ui-rebuild/phase-a/owner-decisions.json:219`); score convention names `sn-seo-editor-6` (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:99`); current rec-first sort exists at `src/components/SeoEditor.tsx:152`. |
| Q4 / N4 / N12 approval state | Keep HEAD seven-state client-approval state machine; reject admin bulk Approve. Reduced queue actions are Send / Publish / Skip only. | AD-018 accepts this default (`docs/ui-rebuild/phase-a/owner-decisions.json:247`); Q4 default matches (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:345`); `PageEditStatus` is seven-state in `src/components/ui/statusConfig.ts:3`. |
| Q5 Publish Site | Keep the site-wide Publish Site action in the editor topbar. | Q5 default (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:351`); current publish mutation is in `src/components/SeoEditor.tsx:131`; header action renders it at `src/components/editor/SeoEditorHeaderActions.tsx:95`; server endpoint is `server/routes/webflow.ts:315`. |
| Q6 drafts + suggestions | Carry existing local/session persistence and server suggestions panel as T1; defer server-persisted per-page drafts to `SB-030`. | Q6 default (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:357`); AD-010 applies T1 to SEO Editor (`docs/ui-rebuild/phase-a/owner-decisions.json:140`); draft persistence lives in `src/components/editor/seoEditorPersistence.ts:32`; `SB-030` is the server draft follow-up (`docs/ui-rebuild/phase-a/server-backlog.json:416`). |
| Q7 Sent-to-client panel | Keep the pending approvals / Retract panel as a collapsible editor panel in v1. | Q7 default (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:363`); current static wrapper mounts it at `src/components/SeoEditorWrapper.tsx:118`; CMS shell mounts it at `src/components/cms-editor/CmsEditorShellPanels.tsx:149`; retract behavior is in `src/components/PendingApprovals.tsx:46`. |
| Q8 / N5 Noindex chip | Adopt quick filters that derive from existing row data, but drop Noindex until `SB-028` serializes indexability. | Q8 default (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:369`); N5 excludes Noindex until data exists (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:409`); `SB-028` owns the field (`docs/ui-rebuild/phase-a/server-backlog.json:390`). |
| Q9 / N8 target keyword writes | No direct keyword assignment or tracking writes from SEO Editor v1. Display joined target keywords and deep-link to Keyword Hub as the single writer. | Q9 default (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:375`); cross-surface dep names Keyword Hub ownership (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:491`); current target keyword join is in `src/components/SeoEditor.tsx:53`. |
| NEW redirect wrappers / N9 Add redirect | Do not add an Add Redirect write in W4. Defer to `SB-026`; when built, adopt the wrapper shape rather than inventing a second client contract. | Newly found question (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:381`); AD-017 scopes new write paths as follow-up (`docs/ui-rebuild/phase-a/owner-decisions.json:233`); `SB-026` confirms the server route is missing (`docs/ui-rebuild/phase-a/server-backlog.json:364`). |
| N1 worksheet layout | Adopt as UI-only over existing data, using `DataTable` + roving tabindex. | Recommendation (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:389`); primitive list includes `DataTable` (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:456`). |
| N6 rank / traffic / last-edited | Consume server-backed row projection only. If fields are absent, render honest absence; do not fan out per row. | N6 requires projection (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:414`); `SB-005` owns primary keyword/rank/traffic/score projection (`docs/ui-rebuild/phase-a/server-backlog.json:71`); current all-pages route already joins keyword projection at `server/routes/webflow.ts:238`. |
| N7 inline title rename | Adopt as a thin UI interaction over the existing same-endpoint title write; do not create a second endpoint. | N7 rationale (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:419`); Frozen Contract #6 (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:68`); live route accepts `title` at `server/routes/webflow.ts:268`. |
| N11 graduation note | Defer. No SEO Editor-only insight graduation write is allowed. | N11 rationale (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:439`); AD-004 defers all graduation bridges to C3 (`docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13`); `SB-001` is the shared seam (`docs/ui-rebuild/phase-a/server-backlog.json:7`). |
| AD-030 redirect cleanup | Treat as C3-later unless the implementation PR actually builds `SB-026`; this ticket does not delete or reshape wrappers. | AD-030 urgency is C3-later (`docs/ui-rebuild/phase-a/owner-decisions.json:381`); `SB-026` is the named redirect-create home (`docs/ui-rebuild/phase-a/server-backlog.json:364`). |

---

## 2. Capability Checklist

Every checked row below is zero-drop per the additive parity floor. `AD-011` defines the carry-forward floor for dropped-in-prototype capabilities (`docs/ui-rebuild/phase-a/owner-decisions.json:159`); SEO Editor applies the same floor through the surface doc's `mountNote`: rebuild the `SeoEditorWrapper` subtree in place, behind flags, writing through the same endpoints so change tracking and approval wiring survive (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:487`).

### Shell, Page Picker, And Write Targets

| Capability | HEAD evidence | Rebuild primitive / placement | Zero-drop confirmation |
|---|---|---|---|
| Admin route remains `seo-editor` | `src/routes.ts:4` includes `seo-editor`; nav entry is `src/lib/navRegistry.tsx:143`; legacy mount is `src/App.tsx:414`. | `PageContainer` under `RebuiltAppChrome`; one `REBUILT_SURFACES['seo-editor']` mount. | Page id preserved; no route rename, no redirect map. |
| Source picker: All / Static / CMS / Manual | Wrapper derives counts at `src/components/SeoEditorWrapper.tsx:43` and renders source buttons at `src/components/SeoEditorWrapper.tsx:70`. | `Segmented` for source scope, `FilterChip` for quick filters, `SearchField` for page search. | All four scopes remain; manual rows stay visible. |
| Static / CMS / manual target resolution | Static target capabilities start at `src/components/editor/seoWriteTargetResolver.ts:39`; CMS at `src/components/editor/seoWriteTargetResolver.ts:69`; manual visible-only target starts at `src/components/editor/seoWriteTargetResolver.ts:114`. | `DataTable` rows carry resolved `targetType`; disabled actions use `IntentTag` / `Tooltip` reason. | D3 preserved: manual cannot save, publish, bulk rewrite, or send (`docs/rules/seo-editor-write-targets.md:9`). |
| Page picker and search | `useSeoEditor` reads static rows from `GET /api/webflow/all-pages/:siteId` at `src/hooks/admin/useSeoEditor.ts:29`; CMS read path is `src/hooks/admin/useCmsEditor.ts:63`; wrapper search/manual filters render at `src/components/SeoEditorWrapper.tsx:50`. | `Toolbar` with `SearchField`, `FilterChip`, `Segmented`, row count meta, manual Refresh. | No raw fetch in the surface; reuse admin hooks and query keys. |
| Loading, empty, error states per source | Static editor loading branch is `src/components/SeoEditor.tsx:235`; manual empty copy is `src/components/SeoEditorWrapper.tsx:165`; CMS loading/empty starts at `src/components/CmsEditor.tsx:147`. | `Skeleton`, `EmptyState`, `ErrorState`, contextual stale-data `InlineBanner`. | Preserve separate states for static, CMS, and manual, not one generic "empty". |
| Freshness and refresh | Header action exposes `Refresh` at `src/components/editor/SeoEditorHeaderActions.tsx:46`; build convention requires last-updated + manual refresh (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:21`). | `Toolbar` right slot with Refresh `IconButton`, stale banner, data-as-of caption. | Honest copy only; no implied scheduler unless separately built. |

### Static Page Editing

| Capability | HEAD evidence | Rebuild primitive / placement | Zero-drop confirmation |
|---|---|---|---|
| Worksheet row with status, missing fields, target keywords, rec flags | Row metadata starts at `src/components/editor/PageEditRow.tsx:68`; row header details run at `src/components/editor/PageEditRow.tsx:74`; rec banners at `src/components/editor/PageEditRow.tsx:156`. | `DataTable` row plus `Drawer` detail; `StatusBadge`, `IntentTag`, `MetricTile`, `KeyValueRow`. | N1 worksheet adopted; recommendation priority preserved, score not folded heuristically. |
| Title / meta description editing with counters | SEO title input begins at `src/components/editor/PageEditRow.tsx:273`; meta description input begins at `src/components/editor/PageEditRow.tsx:322`. | `FormInput`, `FormTextarea`, `CharacterCounter`, `Toolbar` row actions. | Same fields preserved; inline title rename only calls existing title write. |
| OpenGraph mirror and same-endpoint save | Save workflow builds `seo` + `openGraph` at `src/components/editor/useSeoEditorPageWorkflow.ts:96`; route destructures `{ seo, openGraph, title }` at `server/routes/webflow.ts:268`; server calls `updatePageSeo` at `server/routes/webflow.ts:274`. | Existing `useSeoEditorPageWorkflow`; `Button` / `IconButton` in drawer footer. | Frozen Contract #6: do not bypass, reshape, or fork `PUT /api/webflow/pages/:pageId/seo`. |
| Durable mutation side effects | Route computes changed fields and page state at `server/routes/webflow.ts:278`, records SEO change and broadcasts at `server/routes/webflow.ts:284`, invalidates intelligence at `server/routes/webflow.ts:289`. | Reuse mutation hook and query invalidations; no new data-flow path. | WorkspaceHome impact survives because all saves still flow through this route. |
| Draft save / dirty state / session restore | Per-page draft save is `src/components/editor/useSeoEditorPageWorkflow.ts:48`; persistence keys begin at `src/components/editor/seoEditorPersistence.ts:32`; cached edit restore is `src/components/editor/seoEditorPersistence.ts:183`. | `Drawer` footer dirty banner, `Toast` feedback, persisted local/session state. | Carry localStorage/session until `SB-030`; no server draft table in W4. |
| AI rewrite and paired variations | Rewrite call starts at `src/components/editor/useSeoEditorPageWorkflow.ts:166`; paired variation UI begins at `src/components/editor/PageEditRow.tsx:235`. | `Drawer` field actions, variation `DataList` / segmented preview. | Same AI rewrite payload and variation selection retained. |
| SERP and social previews | Preview panel starts at `src/components/editor/PageEditRow.tsx:424`. | Reuse `SerpPreview` and `SocialPreview`. | Preview stays live for title/meta/OG edits. |
| Analyze / Research handoff | Row Analyze / Re-analyze actions start at `src/components/editor/PageEditRow.tsx:196`; workflow calls analyze + persist at `src/components/editor/useSeoEditorPageWorkflow.ts:214`. | `LensSwitcher` `Edit` / `Research`, pinned `Drawer` for analysis-on-file. | Q2/N10 adopted; route retirement is separate D8 work only if `page-intelligence` is removed. |
| Send to client for static rows | Per-page send starts at `src/components/editor/useSeoEditorApprovalWorkflow.ts:57`; row CTA area begins at `src/components/editor/PageEditRow.tsx:371`. | `Button` with optional note, `StatusBadge`, `ConfirmDialog` where destructive. | Canonical wording remains "Send to client"; no admin Approve. |
| Tracking states and reset | `usePageEditStates` returns summary at `src/hooks/usePageEditStates.ts:41`; seven-state config is `src/components/ui/statusConfig.ts:3`; reset tracking starts at `src/components/SeoEditor.tsx:146`. | `StatusBadge`, `CompactStatBar`, `Toolbar` reset action. | Preserve HEAD seven-state semantics. |

### Bulk Static Workflows

| Capability | HEAD evidence | Rebuild primitive / placement | Zero-drop confirmation |
|---|---|---|---|
| Bulk selection and send | Approval workflow uses `useToggleSet` at `src/components/editor/useSeoEditorApprovalWorkflow.ts:46`; bulk send starts at `src/components/editor/useSeoEditorApprovalWorkflow.ts:96`. | `DataTable` bulk selection bar, `Toolbar`, `Button`. | Bulk send preserved; bulk admin Approve rejected. |
| Bulk missing-field fix | Bulk fix background job starts at `src/components/editor/useSeoEditorBulkWorkflow.ts:208`; header buttons are `src/components/editor/SeoEditorHeaderActions.tsx:69`. | `Toolbar` action group, `ProgressIndicator`, `Toast`. | Keep background job path; do not resurrect retired sync apply route. |
| Analyze All / Analyze Remaining | Bulk analyze begins at `src/components/editor/useSeoEditorBulkWorkflow.ts:183`; table controls render progress at `src/components/editor/SeoEditorTableControls.tsx:33`. | `Toolbar`, `ProgressIndicator`, cancel `IconButton`. | Existing job recovery and cancel survive. |
| Pattern apply | Pattern preview/apply begins at `src/components/editor/useSeoEditorBulkWorkflow.ts:249`; setup UI starts at `src/components/editor/BulkOperations.tsx:100`. | `Drawer` or `GroupBlock` in bulk panel, `DataTable` diff preview. | Same server route, preview, apply, cancel retained. |
| Bulk AI rewrite and sequential apply | Bulk rewrite job starts at `src/components/editor/useSeoEditorBulkWorkflow.ts:284`; sequential apply uses page PUTs at `src/components/editor/useSeoEditorBulkWorkflow.ts:310`. | `ProgressIndicator`, `DataTable` results, apply `Button`. | Sequential apply continues to use same write-through. |
| Server suggestions panel | Suggestions query starts at `src/components/SeoEditor.tsx:99`; panel handlers start at `src/components/editor/SeoSuggestionsPanel.tsx:23`; apply route starts at `server/routes/webflow-seo-suggestions.ts:76`. | Collapsible `GroupBlock`, `DataList`, `Button`, `Toast`. | Suggestions panel survives as Q6 T1 carry-over. |
| Site-wide Publish Site | Publish mutation starts at `src/components/SeoEditor.tsx:131`; header action renders at `src/components/editor/SeoEditorHeaderActions.tsx:95`; server route starts at `server/routes/webflow.ts:315`. | `Toolbar` right action, `ConfirmDialog` if needed. | Kept in editor topbar per Q5. |

### CMS And Manual Targets

| Capability | HEAD evidence | Rebuild primitive / placement | Zero-drop confirmation |
|---|---|---|---|
| CMS collection filter and counts | CMS editor reads collections at `src/components/CmsEditor.tsx:37`; collection counts start at `src/components/cms-editor/CmsEditorCollections.tsx:106`; wrapper collection dropdown starts at `src/components/SeoEditorWrapper.tsx:146`. | `Segmented` / `FormSelect`, `DataTable`, `FilterChip`. | CMS lens remains first-class. |
| CMS item editing and save draft | Item row fields start at `src/components/cms-editor/CmsEditorCollections.tsx:231`; save workflow patches collection item at `src/components/cms-editor/useCmsEditorSaveWorkflow.ts:29`; server PATCH route starts at `server/routes/webflow-cms.ts:75`. | `Drawer`, `FormInput`, `FormTextarea`, `CharacterCounter`, `Button`. | D3 CMS writes require real `collectionId` + real `itemId`. |
| CMS publish collection/items | Publish workflow starts at `src/components/cms-editor/useCmsEditorPublishBulkWorkflow.ts:54`; server publish route starts at `server/routes/webflow-cms.ts:235`. | `Toolbar` action, `ProgressIndicator`, `Toast`. | Publish stays CMS-only; manual rows never publish. |
| CMS AI rewrite modes | CMS bulk modes render at `src/components/cms-editor/CmsEditorShellPanels.tsx:71`; workflow handles modes at `src/components/cms-editor/useCmsEditorPublishBulkWorkflow.ts:87`; single/paired AI starts at `src/components/cms-editor/useCmsEditorAiWorkflow.ts:88`. | `Segmented`, `Toolbar`, `ProgressIndicator`, `Drawer`. | Names / titles / descriptions / all SEO modes preserved. |
| CMS approvals and history | CMS approval workflow starts at `src/components/cms-editor/useCmsEditorApprovalWorkflow.ts:57`; item history renders at `src/components/cms-editor/CmsEditorCollections.tsx:412`. | `StatusBadge`, `DataList`, `Button`, collapsible history. | Same client approval path; no admin Approve. |
| CMS previews and issue highlighting | Item preview starts at `src/components/cms-editor/CmsEditorCollections.tsx:469`; issue badges start at `src/components/cms-editor/CmsEditorCollections.tsx:170`; missing field tip renders at `src/components/CmsEditor.tsx:233`. | `SerpPreview`, `SocialPreview`, `IntentTag`, `EmptyState`. | Missing-field guidance and previews remain. |
| Manual sitemap-only rows | Manual awareness rows render at `src/components/SeoEditorWrapper.tsx:165`; manual target capabilities are false at `src/components/editor/seoWriteTargetResolver.ts:114`. | Read-only `DataTable` / `EmptyState`, disabled actions with reason tooltip. | D3 manual law enforced: visible only, no save/publish/bulk/send. |

### Cross-System Impact

| Capability | HEAD evidence | Rebuild primitive / placement | Zero-drop confirmation |
|---|---|---|---|
| Pending approvals panel with Retract / Remind | Static wrapper mounts panel at `src/components/SeoEditorWrapper.tsx:118`; panel retract mutation starts at `src/components/PendingApprovals.tsx:46`; reminder starts at `src/components/PendingApprovals.tsx:60`. | Collapsible `GroupBlock` or `Drawer` section using existing `PendingApprovals` mechanics. | Panel remains in editor v1; global approvals home is separate. |
| WorkspaceHome SEO impact dependency | `SeoChangeImpact` reads change APIs at `src/components/workspace-home/SeoChangeImpact.tsx:70`; WorkspaceHome mounts it at `src/components/WorkspaceHome.tsx:604`; server impact read starts at `server/routes/seo-change-tracker.ts:33`. | No SEO Editor UI primitive change; this is a write-through invariant. | Because saves still call `PUT /pages/:pageId/seo`, impact tracking remains intact. |
| Recommendation auto-resolution on save/publish | Page save resolves recs at `server/routes/webflow.ts:300`; CMS publish resolves recs at `server/routes/webflow-cms.ts:235`. | No new UI primitive; preserve existing side-effect route. | Do not build a second recommendation bridge inside the surface. |
| Query invalidation across static/CMS | CMS save invalidates both CMS and SEO editor query keys at `src/components/cms-editor/useCmsEditorSaveWorkflow.ts:29`; shared query keys are `src/lib/queryKeys.ts:94`. | Existing hooks and `useWorkspaceEvents`; no raw fetch. | D3 data-flow law requires both read paths stay fresh (`docs/rules/seo-editor-write-targets.md:15`). |

---

## 3. Server Tickets

| SB / need | Title | Effort | Backlog evidence | Disposition | Build instruction |
|---|---:|---:|---|---|---|
| `SB-005` / `sn-seo-editor-3` + `sn-seo-editor-6` | Per-page keyword / rank / traffic / optimization-score projection | M | `docs/ui-rebuild/phase-a/server-backlog.json:71` | **[ride]** | Consume server-backed projection where available; never derive score/rank/traffic client-side. `server/routes/webflow.ts:238` already joins page-keyword projection for all-pages; keep display honest if rank/traffic are absent. |
| `SB-026` / `sn-seo-editor-4` | Webflow redirect-create endpoint | M | `docs/ui-rebuild/phase-a/server-backlog.json:364` | **[defer -> DEF-seo-editor-004]** | No Add Redirect write in W4. Keep manual rows read-only and route redirect work through the SB-026 owner path. |
| `SB-028` / `sn-seo-editor-1` | Per-page index/noindex status | M | `docs/ui-rebuild/phase-a/server-backlog.json:390` | **[defer -> DEF-seo-editor-001]** | Drop Noindex quick filter until the field is serialized from audit/crawl data. |
| `SB-029` / `sn-seo-editor-2` | H1 + URL-slug write endpoints with auto-redirect | L | `docs/ui-rebuild/phase-a/server-backlog.json:404` | **[defer -> DEF-seo-editor-002]** | H1/slug are read-only/reference in v1; writable controls require SB-029 + SB-026. |
| `SB-030` / `sn-seo-editor-5` | Server-persisted per-page SEO drafts | M | `docs/ui-rebuild/phase-a/server-backlog.json:416` | **[defer -> DEF-seo-editor-003]** | Carry local/session drafts and server suggestions panel; no `seo_drafts` table in W4. |
| `SB-001` / N11 | Insight-graduation write seam | L | `docs/ui-rebuild/phase-a/server-backlog.json:7` | **[defer -> DEF-seo-editor-007]** | No surface-local graduation note. Shared C3 contract only per AD-004 (`docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13`). |
| `SB-032` | Page-rewriter save/publish spine sharing write-target contract | L | `docs/ui-rebuild/phase-a/server-backlog.json:440` | **[defer -> no local DEF]** | Not a SEO Editor v1 build item. Only preserve the D3 contract so Page Rewriter can reuse the same target law later. |

---

## 4. Deep-Link Receiver Matrix

| Source / URL | Sender evidence | Receiver requirement | Acceptance test |
|---|---|---|---|
| `/ws/:workspaceId/seo-editor` | `src/lib/navRegistry.tsx:143` and `src/App.tsx:414` mount the existing route. | Default to Edit mode, current source scope, no selected page. | Flag-OFF route remains byte-identical; flag-ON route mounts rebuilt surface. |
| `/ws/:workspaceId/seo-editor?tab=edit` | Surface composition names Edit mode (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:450`). | Read and validate `tab`; invalid values fall back to `edit`. | Runtime receiver test renders a loaded workspace at `?tab=edit`. |
| `/ws/:workspaceId/seo-editor?tab=research` | Q2/N10 adopts Research mode (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:333`). | Read and validate `tab=research`; open Research lens without losing selected source/page. | Runtime receiver test asserts Research lens active after data load. |
| `/ws/:workspaceId/seo-editor?page=<page-id-or-slug>` | Current router-state receiver expands by `fixContext` in `src/components/editor/useSeoEditorSessionState.ts:68`; rebuild adds URL receiver while preserving state receiver. | Validate page param against loaded static/CMS/manual rows; if missing, show default list and a non-blocking stale/missing target message. | Runtime receiver test asserts row focused/drawer opened after data resolves. |
| Site Audit issue row -> SEO Editor | `src/components/audit/types.ts:94` maps title/meta/H1/OG checks to `seo-editor`; `src/components/audit/AuditIssueRow.tsx:191` navigates with `fixContext`. | Preserve router-state `fixContext` receiver and optionally emit `?page=` in new senders; both halves must work. | Static tab-deep-link contract covers sender + receiver; runtime covers fixContext focus. |
| Site Audit dead-link panel -> SEO Editor | `src/components/audit/DeadLinkPanel.tsx:134` navigates to `seo-editor` with `fixContext`. | Manual rows must remain visible-only; no direct redirect write unless SB-026 lands. | Receiver test opens target row/manual awareness state. |
| Page Intelligence handoff -> SEO Editor | `src/components/PageIntelligence.tsx:160` opens SEO Editor for a page; Page Intelligence merge is D3-locked only when route-retirement work is scheduled (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:489`). | Preserve existing handoff; if standalone route later retires, add D8 redirect map in that separate PR. | No D8 in W4; add sender assertion if Page Intelligence emits `?tab=research&page=`. |
| Recommendations metadata CTA -> SEO Editor | `src/lib/recTypeTab.ts:15` maps metadata recommendations to `seo-editor`; `src/lib/recTypeTab.ts:41` builds `fixContext`. | Preserve fixContext fields (`pageSlug`, `pageName`, `primaryKeyword`) and row focus behavior. | Static receiver contract includes metadata sender. |
| WorkspaceHome SEO impact | WorkspaceHome mounts `SeoChangeImpact` at `src/components/WorkspaceHome.tsx:604`; impact reads change APIs at `src/components/workspace-home/SeoChangeImpact.tsx:70`. | Not a route sender. Dependency is the write-through invariant: save route must keep recording SEO changes. | Mutation test or integration smoke verifies save still records a change via same endpoint. |

URL-state note: `BUILD_CONVENTIONS.md` warns not to overload shared `tab` for arbitrary surface lenses (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:186`). This ticket uses `tab` only because the request explicitly requires the SEO Editor `?tab=` receiver. Keep non-tab state on explicit params (`page`, `source`, `collection`, `filter`, `search`) with validating type guards and defaults.

---

## 5. Flag Disposition

| Item | Disposition | Evidence |
|---|---|---|
| Gate | `ui-rebuild-shell` gates this admin rebuild. No new SEO Editor-specific flag. | AD-005 assigns admin halves to A-lane `ui-rebuild-shell` (`docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:14`); flag exists in `shared/types/feature-flags.ts:117`. |
| Mount | Add one lazy entry keyed by `seo-editor` in `REBUILT_SURFACES`. | Build convention says one-line mount in `rebuiltSurfaces.ts` (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:203`); current map contract lives in `src/components/layout/rebuiltSurfaces.ts:5`. |
| Flag-OFF | Byte-identical legacy path: `App.tsx` continues to render `SeoEditorWrapper` when shell flag is off. | Legacy route branch is `src/App.tsx:410`; rebuilt branch is `src/App.tsx:460`. |
| Flag retirement | None in Wave 4. Route id and feature flag remain; this is an additive shell-gated mount. | AD-006 forbids flag retirement outside plan mapping (`docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:15`). |

Verification required before merge: seeded real `useFeatureFlag` transition test, `npm run lint:hooks`, and a flag-ON real browser smoke with static, CMS, and manual rows (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:223`, `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:259`).

---

## 6. File Ownership

### Owned By This Build PR

- `src/components/seo-editor-rebuilt/**` - all new `@ds-rebuilt` files. Suggested split: `SeoEditorSurface.tsx`, `SeoEditorToolbar.tsx`, `SeoEditorWorksheet.tsx`, `SeoEditorRowDrawer.tsx`, `SeoEditorResearchLens.tsx`, `CmsTargetsLens.tsx`, `ManualTargetsPanel.tsx`, `BulkSeoToolbar.tsx`, `useSeoEditorSurfaceState.ts`.
- `src/components/layout/rebuiltSurfaces.ts` - one entry only: `seo-editor`.
- `tests/component/seo-editor-rebuilt/**` - flag-ON mount, URL receiver, static/CMS/manual states, mutation button disabled states, a11y floor.
- `tests/contract/tab-deep-link-wiring.test.ts` - add SEO Editor receiver and sender coverage for any new `?tab=` / `?page=` URLs.
- `data/ui-rebuild-deferred-ledger.json` - implementation PR adds the §7 `DEF-seo-editor-*` rows in the same PR that introduces the trade-offs.
- Optional local composition helpers inside `seo-editor-rebuilt/` only. Do not add raw `fetch`; use existing hooks / API clients.

### Reused, Not Rewritten

- Static data and workflow hooks: `useSeoEditor`, `usePageJoin`, `usePageEditStates`, `useSeoEditorPageWorkflow`, `useSeoEditorBulkWorkflow`, `useSeoEditorApprovalWorkflow`.
- CMS data and workflow hooks: `useCmsEditor`, `useCmsEditorSaveWorkflow`, `useCmsEditorPublishBulkWorkflow`, `useCmsEditorApprovalWorkflow`, `useCmsEditorAiWorkflow`.
- Persistence and suggestions: `src/components/editor/seoEditorPersistence.ts`, `src/components/editor/SeoSuggestionsPanel.tsx`, and server suggestion routes.
- The same-endpoint write-through: `PUT /api/webflow/pages/:pageId/seo` in `server/routes/webflow.ts:257`.
- D3 write-target resolver: `src/components/editor/seoWriteTargetResolver.ts` and `shared/types/seo-editor-write-target.ts`.
- `PendingApprovals` mechanics and approval API path; the rebuilt shell may restyle the container but must preserve behavior.

### Must Not Touch

- Frozen Contract #6: no endpoint rename, no payload reshape, no bypass of `useSeoEditorPageWorkflow`, no alternate save route.
- `docs/rules/seo-editor-write-targets.md` semantics: static/CMS/manual target modes remain authoritative.
- Client surfaces (`src/components/client/**`) and client Inbox routes.
- `Page` id `seo-editor` in `src/routes.ts`; no page rename/removal.
- `page-intelligence` route removal. That requires a separate D8 route-removal ticket if later approved.
- Keyword Hub write ownership. SEO Editor may show target keywords and deep-link; it must not become a second keyword writer.
- New H1/slug/redirect Webflow writes unless their named SB tickets land in the same approved server PR.

---

## 7. D8 / DEF Entries

### D8

No D8 redirect map applies to Wave 4 SEO Editor. The `seo-editor` `Page` id is preserved (`src/routes.ts:4`) and no route is renamed or removed. If `page-intelligence` is later retired into `seo-editor?tab=research`, that future PR must follow the route-removal checklist and add the D8 redirect map then (`docs/ui-rebuild/phase-a/surfaces/seo-editor.json:489`).

### DEF rows for the implementation PR

The classes below are verified against `scripts/verify-deferred-ledger.ts:27` (`token | primitive | behavior | data | a11y | perf | copy`) and the required field schema at `scripts/verify-deferred-ledger.ts:22`.

```jsonc
[
  {
    "id": "DEF-seo-editor-001",
    "surface": "seo-editor",
    "item": "Noindex quick-filter chip and per-row indexability status",
    "decision": "Drop the Noindex chip in W4 instead of deriving indexability in the client; add it after SB-028 serializes an audit/crawl-backed field.",
    "class": "data",
    "upgradeTrigger": "SB-028 lands per-page index/noindex status on the all-pages row payload.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "surface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:369",
      "serverBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:390"
    }
  },
  {
    "id": "DEF-seo-editor-002",
    "surface": "seo-editor",
    "item": "H1 and URL slug editing with automatic redirect",
    "decision": "Render H1 and slug as read-only/reference in W4; writable controls wait for SB-029 plus the redirect-create prerequisite in SB-026.",
    "class": "behavior",
    "upgradeTrigger": "SB-029 and SB-026 land behind an owner-approved Webflow write-path rollout.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "ownerDecision": "docs/ui-rebuild/phase-a/owner-decisions.json:233",
      "h1SlugBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:404",
      "redirectBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:364"
    }
  },
  {
    "id": "DEF-seo-editor-003",
    "surface": "seo-editor",
    "item": "Server-persisted per-page SEO drafts",
    "decision": "Carry localStorage/session drafts and the existing server suggestions panel in W4; defer the seo_drafts table and endpoints to SB-030.",
    "class": "data",
    "upgradeTrigger": "SB-030 adds the seo_drafts table and route contract for durable per-page draft storage.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "surface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:357",
      "serverBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:416",
      "headPersistence": "src/components/editor/seoEditorPersistence.ts:32"
    }
  },
  {
    "id": "DEF-seo-editor-004",
    "surface": "seo-editor",
    "item": "Manual-row Add Redirect CTA and redirect-create write path",
    "decision": "Keep manual sitemap-only rows read-only in W4; defer direct redirect creation because the Webflow redirect-create server route is missing.",
    "class": "behavior",
    "upgradeTrigger": "SB-026 lands a backed redirect-create endpoint and the D3 manual-row handoff copy is approved.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "writeTargets": "docs/rules/seo-editor-write-targets.md:9",
      "surface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:429",
      "serverBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:364"
    }
  },
  {
    "id": "DEF-seo-editor-005",
    "surface": "seo-editor",
    "item": "Direct target-keyword assignment from SEO Editor",
    "decision": "Show joined target keywords and deep-link to Keyword Hub; do not add a second keyword writer in the W4 SEO Editor rebuild.",
    "class": "behavior",
    "upgradeTrigger": "Owner signs a shared-writer keyword mutation contract or Keyword Hub exposes an explicit assignment deep-link API.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "surface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:375",
      "crossSurface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:491",
      "headJoin": "src/components/SeoEditor.tsx:53"
    }
  },
  {
    "id": "DEF-seo-editor-006",
    "surface": "seo-editor",
    "item": "Full keyboard review queue with admin approve/request triage",
    "decision": "Ship seven-state visibility and Send/Publish/Skip only; reject admin Approve in W4 so client approval states remain authoritative.",
    "class": "behavior",
    "upgradeTrigger": "Owner signs a state-machine change that allows admin triage without corrupting client approval semantics.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "ownerDecision": "docs/ui-rebuild/phase-a/owner-decisions.json:247",
      "surface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:404",
      "statusConfig": "src/components/ui/statusConfig.ts:3"
    }
  },
  {
    "id": "DEF-seo-editor-007",
    "surface": "seo-editor",
    "item": "SEO publish graduation note into Insights Engine",
    "decision": "Do not build a SEO Editor-only graduation note or insight write; defer the narrative to AD-004's shared C3 graduation seam.",
    "class": "behavior",
    "upgradeTrigger": "SB-001 or its C3 successor defines the shared insight-graduation write contract for SEO publish signals.",
    "owner": "josh",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "links": {
      "phaseDecision": "docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13",
      "surface": "docs/ui-rebuild/phase-a/surfaces/seo-editor.json:439",
      "serverBacklog": "docs/ui-rebuild/phase-a/server-backlog.json:7"
    }
  }
]
```

Build PR closeout gates:

- Re-open this ticket and confirm every §2 capability row still has a live file:line citation.
- Add the DEF rows above to `data/ui-rebuild-deferred-ledger.json` in the implementation PR and run `npm run verify:deferred-ledger`.
- Run standard gates from `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:269`.
- Run a flag-ON real browser smoke across static pages, CMS items, and manual sitemap-only rows; verify manual rows cannot save/publish/bulk-send.
