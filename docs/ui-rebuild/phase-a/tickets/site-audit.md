# Wave 5 BUILD TICKET - Site Audit (Page `seo-audit`)

> **Surface:** admin `Page 'seo-audit'` (`src/routes.ts:4`) in Site Health nav (`src/lib/navRegistry.tsx:123-125`, `needsSite: true`).
> **HEAD component + mount:** `SeoAudit` (`src/components/SeoAudit.tsx:52-76`, current `?sub=audit|history|aeo-review|content-decay|guide` receiver) mounted from `src/App.tsx:413`.
> **Wave:** W5 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **L** (`docs/ui-rebuild/phase-a/surfaces/site-audit.json:719-720`).
> **Read order for the builder:** `PHASE_A_DECISIONS.md` -> `CROSS_SURFACE_CONTRACTS.md` -> `BUILD_CONVENTIONS.md` -> `surfaces/site-audit.json` -> `owner-decisions.json` -> `server-backlog.json` -> this ticket -> Keywords pilot (`src/components/keywords-rebuilt/`).
> **Mount contract:** rebuilt surface mounts behind `ui-rebuild-shell` through `REBUILT_SURFACES['seo-audit']` in `src/components/layout/rebuiltSurfaces.ts:19-56`. This is a controller-applied seam for this fan-out; the Site Audit build lane lists it but does **not** edit `rebuiltSurfaces.ts`.
> **Frozen/domain law:** Frozen Contract #6 preserves `PUT /api/webflow/pages/:pageId/seo` and its SEO/OG write-through (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:68`; current Site Audit write at `src/components/SeoAudit.tsx:131-156`). All rebuilt `fixContext` receivers for `seo-editor`, `seo-schema`, `links`, briefs/content pipeline, and `performance` must re-accept the payload sent by audit issue rows (`src/components/audit/AuditIssueRow.tsx:186-203`; `src/components/audit/types.ts:94-111`).

## 1. ⚠ OWNER DELTAS

These four controller deltas override the surface JSON defaults. All other `openQuestions` adopt their `proposedDefault` or the already-shipped owner ticket called out below.

| Delta | Discovery item | Resolution for this build ticket | Backing evidence |
|---|---|---|---|
| **DELTA 1** | AeoReview relocation deferred | Keep `AeoReview` / "AI Search Ready" reachable inside Site Audit for parity. Do not retarget to AI Visibility because no `ai-visibility` `Page` id exists yet. Add `DEF-site-audit-001` (`class: "behavior"`) documenting the later owner-gated relocation. | Current lazy sub-tool import at `src/components/SeoAudit.tsx:41-43`; current sub-tab receiver/render at `src/components/SeoAudit.tsx:315-329,364-371`; missing `ai-visibility` from `src/routes.ts:1-22`; surface dependency at `docs/ui-rebuild/phase-a/surfaces/site-audit.json:709`. |
| **DELTA 2** | Q10 / `sn-site-audit-3` sitehealth.js roll-up | Defer the book-level roll-up and cross-client batch-fix work wholesale. This PR does not include the read-only client matrix. Add `DEF-site-audit-002` (`class: "data"`); route the work to W6 Global Ops after write-safety review. | Q10 default at `docs/ui-rebuild/phase-a/surfaces/site-audit.json:626-630`; verifier notes existing scalar `/api/workspace-overview` scaffold but missing issue-type matrix at `docs/ui-rebuild/phase-a/surfaces/site-audit.json:762-768`; current scalar audit block at `server/routes/workspaces.ts:107-124`; backlog split `SB-013` / `SB-060` at `docs/ui-rebuild/phase-a/server-backlog.json:157-173,775-785`. |
| **DELTA 3** | AD-013 / Q12 Content Health two-halves retarget | Treat this as a hard acceptance criterion. The rebuilt SEO Audit keeps a diagnostic `content-decay` receiver so old `?sub=content-decay` bookmarks still resolve, but acting-home senders must retarget to `content-pipeline?tab=content-health`. | AD-013 at `docs/ui-rebuild/phase-a/owner-decisions.json:186-196`; receiver exists in `src/components/content-pipeline-rebuilt/useContentPipelineSurfaceState.ts:5-14,38-42` and `src/components/content-pipeline-rebuilt/ContentPipelineLenses.tsx:323-331`; live senders to retarget: `src/components/ContentPipeline.tsx:217-221`, `src/components/WorkspaceHome.tsx:207-218`, `src/components/WorkspaceHome.tsx:501-508`. |
| **DELTA 4** | Q2 taxonomy / `sn-site-audit-2` | Ride `SB-010` with an additive `displayCategory` mapping. Persisted `check` and `category` keys stay unchanged; public/client read shape is additive and version-compatible. The implementation must include an integration test against `GET /api/public/audit-traffic/:workspaceId`, not only the admin route. | Existing 5-value `CheckCategory` in `server/audit-page.ts:11` and `src/components/audit/types.ts:8`; current assignment at `server/audit-page.ts:36-63,461-467`; public audit detail returns `audit: filtered` at `server/routes/public-portal.ts:273-317`; public audit traffic route at `server/routes/public-portal.ts:324-338`; current public route tests at `tests/integration/public-portal-audit-copy.test.ts:229-270`. |

| Open question / feature | Resolution adopted | Build implication |
|---|---|---|
| Q1 "Site Audit 3->1" | **Reading A ratified.** Audit absorbs Performance-triage and Links-triage as categories; out-moves land in their existing homes. | The rebuilt Audit view is the triage hub: score hero, six category cards, issue-first table, CWV strip, and links triage cross-links. No new page route. |
| Q2 taxonomy | **DELTA 4.** Server-side additive `displayCategory`. | `SB-010` rides; no persisted key rename, no client shape fork. |
| Q3 schedule config | Adopt default: Schedule button opens an F3 `Drawer`; reuse `/api/audit-schedules`. | Replace inline `ScheduledAuditSettings` panel (`src/components/audit/ScheduledAuditSettings.tsx:15-137`) with a drawer shell over the same read/write behavior. |
| Q4 action items / batch add-to-tasks | Adopt default: keep both in Site Audit. Action items stay inside History; batch add stays in the Audit toolbar. | Preserve snapshot action endpoints (`server/routes/reports.ts:278-310`) and batch request creation (`src/components/SeoAudit.tsx:210-232`; `src/components/audit/AuditBatchActions.tsx:77-123`). |
| Q5 severity filter + search | Adopt default: add both. | Use `SearchField`, `FilterChip`, and `Segmented`; current search/filter/sort logic lives at `src/components/SeoAudit.tsx:454-484,621-708`. |
| Q6 secondary keywords | Already owned by shipped SEO Editor ticket. | Site Audit owns only the audit-side sender into SEO Editor Research; do not create keyword editing UI here. |
| Q7 bulk page analysis | Already owned by shipped SEO Editor ticket. | Site Audit owns only the page deep-link / fixContext sender; no analysis job UI here. |
| Q8 page-scoped local visibility | Already owned by shipped SEO Editor ticket. | No Site Audit panel; route page-level context to SEO Editor Research if needed. |
| Q9 Guide pattern | Adopt default: keep per-surface Guide. | Keep `?sub=guide` receiver and `SeoAuditGuide` parity (`src/components/SeoAudit.tsx:331-351`). |
| Q10 sitehealth.js | **DELTA 2.** Defer all cross-client roll-up and batch-fix. | DEF row only; no read-only matrix in this PR. |
| Q11 P1-P18 ownership | Already owned by shipped SEO Editor ticket. | Site Audit owns only the audit-side sender to SEO Editor Research; do not re-own Page Intelligence internals. |
| Q12 Content Health senders | **DELTA 3.** Hard two-halves acceptance criterion. | Keep diagnostic receiver in Site Audit; retarget the three acting-home senders to Content Pipeline. |

## 2. Capability Checklist

Every `capabilityClassification` row in `surfaces/site-audit.json:4-560` is an acceptance criterion. The rebuilt table is issue-first and **self-carded**: use `DataTable` directly, never wrap it in `SectionCard` (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:159-163`).

### 2.1 Shell, job lifecycle, and saved reports

- [ ] **#1 Run audit as background job w/ live progress.** Preserve `useSeoAuditWorkflow` job start / progress / result flow (`src/hooks/admin/useSeoAuditWorkflow.ts:32-94,96-115`) and the current loading progress copy (`src/components/SeoAudit.tsx:410-435`). Primitive: `Toolbar` Run Audit/Re-scan action, `ProgressIndicator`/`Meter`, `InlineBanner` for stale cached data.
- [ ] **#2 skipLinkCheck opt-out checkbox.** Keep the "Include dead link scan" option in the run flow; it maps to `skipLinkCheck` (`src/hooks/admin/useSeoAuditWorkflow.ts:39,82-94`; UI at `src/components/SeoAudit.tsx:399-404`). Primitive: `Checkbox` inside run drawer/empty state.
- [ ] **#3 Auto-restore latest snapshot on mount.** Preserve latest snapshot query and hydration (`src/hooks/admin/useSeoAuditWorkflow.ts:58-67,130-138`) over `GET /api/reports/:siteId/latest` (`server/routes/reports.ts:251-260`).
- [ ] **#4 Attach to running/recent audit job on remount.** Preserve completed/running job reattach (`src/hooks/admin/useSeoAuditWorkflow.ts:69-76,117-128`).
- [ ] **#5 Empty state (never run) w/ CTA.** Replace the current custom first-run block (`src/components/SeoAudit.tsx:379-407`) with `EmptyState` plus Run Audit CTA and dead-link-scan option.
- [ ] **#6 Error state with retry.** Preserve `auditError` handling (`src/hooks/admin/useSeoAuditWorkflow.ts:40,90-93,110-113`) and current `ErrorState` retry (`src/components/SeoAudit.tsx:441-450`).
- [ ] **#7 Post-run NextSteps -> narrative headline.** Keep the post-run next step affordance, but headline/verdict copy must be server-derived or count-templated only; no client-side verdict math (`src/components/SeoAudit.tsx:491-505`; AD-002 in `PHASE_A_DECISIONS.md:11`).
- [ ] **#38 Scheduled audits config UI.** Adopt Q3: render schedule config in a `Drawer` opened from the toolbar, reusing `useAuditSchedule` (`src/hooks/admin/useAdminSeo.ts:45-55`) and current save behavior (`src/components/audit/ScheduledAuditSettings.tsx:31-45`).
- [ ] **#39 Scheduled-audit email alerts.** Preserve server behavior; UI only surfaces enabled/last-run/threshold state (`src/components/audit/ScheduledAuditSettings.tsx:47-68`).
- [ ] **#40 Post-audit side effects.** Keep `AUDIT_COMPLETE` invalidation semantics (`src/lib/wsInvalidation.ts:184-194`) and report-save broadcast side effect (`server/routes/reports.ts:240-244`). No manual broadcast from client code.
- [ ] **#41 Save & Share -> public `/report/:id`.** Preserve snapshot reuse + fallback save (`src/components/SeoAudit.tsx:248-270`) and public report route (`server/routes/reports.ts:312-324`).
- [ ] **#42 Export HTML report + CSV.** Preserve report modal/viewer and CSV/HTML export, including CWV rows (`src/components/audit/AuditReportExport.tsx:11-32,37-154,164-267`).
- [ ] **#43 History sub-tab.** Preserve score trend, snapshot list, refresh, latest-report link, copy-link, and per-snapshot actions (`src/components/SeoAudit.tsx:375-377`; `src/components/audit/AuditHistory.tsx:13-164`).
- [ ] **#44 Latest-report permalink `/report/audit/:siteId`.** Preserve current latest audit public report (`server/routes/reports.ts:336-343`; UI copy at `src/components/audit/AuditHistory.tsx:81-104`).
- [ ] **#45 Snapshot Action Items CRUD.** Adopt Q4: keep action items inside History (`src/components/audit/AuditHistory.tsx:78-80`; `src/components/audit/ActionItemsPanel.tsx:35-241`; endpoints at `server/routes/reports.ts:278-310`).
- [ ] **#46 Guide sub-tab.** Adopt Q9: keep `SeoAuditGuide` as a per-surface Guide (`src/components/SeoAudit.tsx:331-351`).
- [ ] **#47 `?sub=` deep-link receiver.** Preserve validated `sub` receiver for `audit|history|aeo-review|content-decay|guide` (`src/components/SeoAudit.tsx:52-76`). Add runtime receiver tests for each value and invalid fallback.

### 2.2 Score, taxonomy, filters, and issue-first triage

- [ ] **#8 Site Score + delta + score bar -> score ring hero.** Use `MetricRing`/`Meter` with server scores only (`src/components/SeoAudit.tsx:507-523`; `server/seo-audit.ts:222-273`). Score color goes through `scoreColor()` / `scoreColorClass()`.
- [ ] **#9 Severity stat pills + click-to-filter.** Preserve click-to-filter behavior from summary stats (`src/components/SeoAudit.tsx:523-526`) using `MetricTile` + `FilterChip`.
- [ ] **#10 Broken Links card -> Links deep-link.** Keep Frozen Contract #3: `links?tab=dead-links` sender and receiver (`src/components/SeoAudit.tsx:527-537`; `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:65`).
- [ ] **#11 Contextual Quick-fix chips by finding type.** Preserve quick-fix routing to SEO Editor, Links, Schema, and Performance (`src/components/SeoAudit.tsx:541-570`) and `ISSUE_FIX_MAP` (`src/components/audit/types.ts:94-111`).
- [ ] **#12 CWV summary.** Keep one field-data strip in Audit and route deeper mobile/desktop CWV detail to Performance (`src/components/SeoAudit.tsx:575-578`; `src/components/audit/CwvSummaryCard.tsx:66-81`).
- [ ] **#13 Site-wide issues section w/ AI suggestions.** Preserve site-wide issue rows, severity badges, and suggested fixes (`src/components/SeoAudit.tsx:580-610`; produced in `server/seo-audit.ts:147-200,228-256`).
- [ ] **#14 20+ per-page checks, weighted scoring, noindex exclusion.** Preserve audit runner checks, category assignment, and scoring (`server/audit-page.ts:36-63,461-469`; `server/seo-audit.ts:222-226`).
- [ ] **#15 noindex badge + inline explanation.** Keep badge and explanatory copy; noindex pages remain excluded from site health scoring (`src/components/SeoAudit.tsx:747,767-772`; `server/seo-audit.ts:222-226`).
- [ ] **#16 Search box over pages + issues.** Adopt Q5; current search filters page title, slug, issue message, and check (`src/components/SeoAudit.tsx:463-468`; current toolbar input at `src/components/audit/AuditFilters.tsx:39-50`).
- [ ] **#17 Category filter pills -> category cards.** Adopt `displayCategory` taxonomy from `SB-010`; current 5-category filter is at `src/components/audit/AuditFilters.tsx:120-141`.
- [ ] **#18 Per-category scores.** Ride `SB-010`; scores are server-side and suppression-aware across all effective read paths (`docs/ui-rebuild/phase-a/server-backlog.json:142-156`).
- [ ] **#19 Severity vs traffic-impact sort.** Preserve traffic map sort (`src/components/SeoAudit.tsx:469-484`; `src/components/audit/AuditBatchActions.tsx:55-75`) using `Segmented`.
- [ ] **#20 Showing X of Y + clear-filters.** Preserve row count, clear filters, and filtered/action result feedback (`src/components/audit/AuditBatchActions.tsx:34-54,77-123`).
- [ ] **#21 Per-issue rows -> issue-first pivot w/ affected pages.** Rebuild primary table as issue-first rows with affected pages, regrouping `PageSeoResult.issues[]` client-side without changing persisted shape (`src/components/SeoAudit.tsx:723-817`).
- [ ] **#22 Per-page traffic badges.** Preserve 28-day clicks/views badges from `useAuditTrafficMap` (`src/hooks/admin/useAdminSeo.ts:9-18`; `src/components/SeoAudit.tsx:729-756`).
- [ ] **#23 Editable AI suggested fix w/ char count.** Preserve editable suggested fixes (`src/components/audit/AuditIssueRow.tsx:90-148`) and add `CharacterCounter`.
- [ ] **#31 Suppress issue / suppress pattern.** Preserve exact and pattern suppression mutations (`src/components/SeoAudit.tsx:103-129`; row menu at `src/components/audit/AuditIssueRow.tsx:223-259,280-337`).
- [ ] **#32 Suppressed-count strip + clear-all.** Preserve suppression summary and clear behavior (`src/components/audit/AuditBatchActions.tsx:37-49`; clear loop at `src/components/SeoAudit.tsx:692-704`).
- [ ] **#33 Suppression-aware effective scores.** Preserve server effective views (`server/audit-suppression-projection.ts:17-25`; `server/audit-snapshot-views.ts:14-67`) and client application of suppressions (`src/components/SeoAudit.tsx:290-294`).
- [ ] **#50 Unified page edit-state badges.** Preserve six-state summary/badges from `usePageEditStates` (`src/hooks/usePageEditStates.ts:41-81`; summary bar at `src/components/SeoAudit.tsx:710-720`; per-row badge at `src/components/SeoAudit.tsx:730-753`).

### 2.3 Actions, write-through, tasks, and client review

- [ ] **#24 Apply AI fix -> Webflow SEO/OG write.** Frozen Contract #6: keep `PUT /api/webflow/pages/:pageId/seo` payload and side effects unchanged (`src/components/SeoAudit.tsx:131-156`; `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:68`).
- [ ] **#25 Bulk Accept All.** Preserve background bulk job, progress, cancellation, WebSocket progress/complete/failed events, and sessionStorage recovery (`src/components/SeoAudit.tsx:235-246,637-650`; `src/components/audit/BulkAcceptPanel.tsx:29-177`).
- [ ] **#26 Fix -> route to owning tool with `fixContext`.** Rebuilt senders must pass the existing `fixContext` payload and each receiving rebuilt surface must re-accept it (`src/components/audit/AuditIssueRow.tsx:186-203`).
- [ ] **#27 Page -> Page Intelligence deep-dive.** Do **not** re-retire `page-intelligence`; W4/D3 owns that. Rebuilt Site Audit must retarget its page deep-dive sender to SEO Editor Research (`seo-editor?tab=research` + page/fixContext) per Q11.
- [ ] **#28 Send to Client w/ optional note.** Preserve approval batch write and optional note behavior (`src/components/SeoAudit.tsx:164-196`; inline note at `src/components/audit/AuditIssueRow.tsx:150-180`). Canonical button copy is "Send to client".
- [ ] **#29 Add to Tasks (single issue).** Preserve `POST /api/requests` path (`src/components/SeoAudit.tsx:198-208`; menu at `src/components/audit/AuditIssueRow.tsx:309-319`).
- [ ] **#30 Batch add to tasks (All/Errors/Filtered).** Adopt Q4: keep toolbar batch actions (`src/components/SeoAudit.tsx:210-232`; `src/components/audit/AuditBatchActions.tsx:77-123`).
- [ ] **#34 Dead-link panel (status/type/found-on/anchor).** Preserve diagnostic dead-link rows where the audit snapshot has details (`src/components/SeoAudit.tsx:612-619`; `src/components/audit/DeadLinkPanel.tsx:54-205`).
- [ ] **#35 Dead link -> Fix in SEO Editor.** Preserve SEO Editor `fixContext` sender for internal broken links (`src/components/audit/DeadLinkPanel.tsx:129-142`).
- [ ] **#36 Inline redirect per dead link -> Links.** Do not build direct redirects here. Route redirect creation / CSV export to the shipped Links surface (`src/components/audit/DeadLinkPanel.tsx:144-189`; Links ticket AD-027 handling in `docs/ui-rebuild/phase-a/tickets/links.md:17-49`).
- [ ] **#37 Export dead links CSV -> Links.** Keep audit CSV/report export parity, but Links owns dead-link CSV as the deep workshop (`src/components/audit/DeadLinkPanel.tsx:21-44,69-91`).
- [ ] **#51 Audit graduation to Insights Engine.** Defer under AD-004; no Site Audit-only insight write. Add `DEF-site-audit-003`.
- [ ] **#52 Book-level cross-client Site Health roll-up.** Defer under DELTA 2; no read-only matrix and no batch fix in this PR.

### 2.4 Relocated or retained sub-tools and Page Intelligence rows

- [ ] **#48 Content Health sub-tool.** Keep a diagnostic `?sub=content-decay` receiver in Site Audit, but retarget acting-home senders to `content-pipeline?tab=content-health` per DELTA 3 (`src/components/SeoAudit.tsx:353-363`; `src/components/content-pipeline-rebuilt/useContentPipelineSurfaceState.ts:5-14`).
- [ ] **#49 AI Search Ready sub-tool.** Keep `AeoReview` in-surface for parity until `ai-visibility` exists; add `DEF-site-audit-001` per DELTA 1 (`src/components/SeoAudit.tsx:364-371`).
- [ ] **P1 PI tabs Pages/Architecture/Guide split.** Already owned by shipped SEO Editor/Links work. Site Audit owns only the audit-side page sender and D8 map notes.
- [ ] **P2 Unified page list w/ search + sort.** SEO Editor Research owns the receiving home; Site Audit sender must carry page identity.
- [ ] **P3 Stats header counts.** SEO Editor owns; no Site Audit implementation.
- [ ] **P4 Per-page AI analysis.** SEO Editor owns; no Site Audit analysis endpoint or job.
- [ ] **P5 Bulk Analyze All/Remaining background job.** SEO Editor owns; Site Audit does not add analysis controls.
- [ ] **P6 Persisted analyses hydrate from pageMap.** SEO Editor owns; no Site Audit storage/read change.
- [ ] **P7 Full analysis field set.** SEO Editor owns; no subset/fork in Site Audit.
- [ ] **P8 Content gaps / recommendations / trust signals.** SEO Editor owns; no Site Audit duplicate.
- [ ] **P9 Fix Queue score x traffic ranking.** Site Audit may show traffic-impact sorting for audit issues (#19) but not a second Page Intelligence fix queue.
- [ ] **P10 Edit primary + secondary keyword mapping.** SEO Editor/Keyword Hub owns; no Site Audit writer.
- [ ] **P11 Track keyword + WS live refresh.** SEO Editor/Keyword Hub owns; no Site Audit handler.
- [ ] **P12 Generate SEO copy.** SEO Editor owns; Site Audit only applies audit suggested fixes through Frozen Contract #6.
- [ ] **P13 Page-scoped local SEO visibility panel.** SEO Editor/Local Presence owns; no Site Audit panel.
- [ ] **P14 Hand-offs (Editor / Create Brief w/ payload / Schema).** Site Audit must keep `fixContext` payloads rich enough for receivers.
- [ ] **P15 `fixContext` receiver auto-expand.** Contract-test all receivers listed in §4.
- [ ] **P16 Loading/error states w/ retry.** Site Audit applies this to its own rebuilt surface; SEO Editor owns PI receiver states.
- [ ] **P17 Architecture tab.** Links owns Architecture as the receiving home; no Site Audit tab.
- [ ] **P18 Page Intelligence Guide.** Site Audit keeps only its own Guide (#46); SEO Editor owns Research help.

### 2.5 Adopted kit features and composition floor

- [ ] **Per-category scores on six category cards.** Adopt via `SB-010`; cards use `GroupBlock`/`MetricTile`/`Meter`, server score denominators explicit.
- [ ] **Issue-first primary pivot.** Adopt; main rows are issue types with affected pages, `DataTable` self-carded.
- [ ] **Narrative verdict headline.** Adopt only as count-templated/server-derived copy; no fabricated causality.
- [ ] **Audit graduation rule.** Defer to `DEF-site-audit-003`.
- [ ] **sitehealth.js roll-up + cross-client batch fix.** Defer to `DEF-site-audit-002`.
- [ ] **Primitive set.** Use `PageContainer`, `Toolbar`, `ToolbarSpacer`, `Segmented`, `SearchField`, `FilterChip`, `MetricTile`, `Meter`, `MetricRing`, `DataTable`, `GroupBlock`, `Drawer`, `Sparkline`, `Badge`, and `StatusBadge` exactly as the surface composition names them (`docs/ui-rebuild/phase-a/surfaces/site-audit.json:674-693`).

## 3. Server Tickets

Consume verifier-adjusted backlog IDs, not gatherer-only `sn-*` labels.

| SB / sn | Title | Effort | Disposition | Build instruction |
|---|---|---:|---|---|
| **SB-010** (`sn-site-audit-1` + `sn-site-audit-2`) | Per-category audit scores + six-category additive display taxonomy remap | M | **RIDE W5** | Compute category-level scores server-side, serialize them on audit result/snapshot, make them suppression-aware across `getEffectiveAudit`, `toEffectiveAuditSnapshot`, `applySuppressionsToAudit`, `/api/workspace-overview`, and public/client reads. Add `displayCategory` without renaming stored `check` or `category`. Integration test must exercise `GET /api/public/audit-traffic/:workspaceId` and public audit detail/client shape, not just `GET /api/audit-traffic/:siteId`. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:142-156`; current category source at `server/audit-page.ts:11,36-63,461-467`; public audit route at `server/routes/public-portal.ts:273-338`. |
| **SB-013** (`sn-site-audit-3` read-only half) | Cross-workspace site-health issue matrix | L | **DEFER -> `DEF-site-audit-002`** | Existing `/api/workspace-overview` only exposes scalar audit score/errors/warnings per workspace (`server/routes/workspaces.ts:107-124`). Do not add issue-type x client matrix in this PR, even read-only. |
| **SB-060** (`sn-site-audit-3` batch-fix half) | Cross-workspace site-health batch-fix background job | L | **DEFER -> `DEF-site-audit-002`** | Requires W6 Global Ops ownership and write-safety review. No cross-client write path rides W5. |
| **SB-001** / #51 | Insight-graduation write seam | L | **DEFER -> `DEF-site-audit-003`** | AD-004 defers all graduation bridges; no audit-only insight write, activity, or broadcast path ships here (`docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30`). |
| **SB-009** / AEO readiness projection | AI Search Ready readiness projection + schema coverage | M | **DO NOT RIDE LOCALLY** | Site Audit keeps the existing `AeoReview` carry-over for parity, but AI Visibility/Schema own the future projection. Covered by `DEF-site-audit-001` for relocation dependency; do not create an AI Visibility route or duplicate readiness computation here. |

**Net:** `SB-010` rides W5. `SB-013`, `SB-060`, and `SB-001` defer with DEF coverage; `SB-009` is non-local until the owner creates an AI Visibility home.

## 4. Deep-Link Receiver Matrix

The rebuilt surface must keep the two-halves deep-link contract. `?sub=` is Site Audit's local equivalent of `?tab=` and must be read, validated, and runtime-tested. Any `?tab=` sender retargeted to another surface must land on a receiver that reads the param (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:186-195`; static test header at `tests/contract/tab-deep-link-wiring.test.ts:1-16`).

| Link / sender | Receiver / target | Disposition | Acceptance test |
|---|---|---|---|
| `/ws/:workspaceId/seo-audit` and bad `?sub=` | Site Audit Audit lens | **KEEP.** Default/fallback is Audit. Current receiver validates `sub` at `src/components/SeoAudit.tsx:72-76`. | Runtime receiver test renders plain route and bad sub, asserts Audit lens. |
| `/ws/:workspaceId/seo-audit?sub=audit` | Site Audit Audit lens | **KEEP.** Explicit Audit URL remains valid. | Runtime receiver test asserts issue table/score hero mounts. |
| `/ws/:workspaceId/seo-audit?sub=history` | Site Audit History lens | **KEEP.** Current render at `src/components/SeoAudit.tsx:375-377`. | Runtime receiver test asserts History view and snapshot rows/empty state. |
| `/ws/:workspaceId/seo-audit?sub=guide` | Site Audit Guide lens | **KEEP.** Current render at `src/components/SeoAudit.tsx:351`. | Runtime receiver test asserts Guide view. |
| `/ws/:workspaceId/seo-audit?sub=aeo-review` | Site Audit AeoReview carry-over | **KEEP TEMPORARILY - DELTA 1.** Do not target missing `ai-visibility`. | Runtime receiver test asserts "AI Search Ready" sub-tool is reachable; DEF row documents later relocation. |
| `/ws/:workspaceId/seo-audit?sub=content-decay` | Site Audit diagnostic Content Health view | **KEEP DIAGNOSTIC - DELTA 3.** Old bookmarks resolve here, but acting-home senders move to Content Pipeline. | Runtime receiver test asserts diagnostic view loads or shows contextual carry-over state. |
| `src/components/ContentPipeline.tsx:220` | `content-pipeline?tab=content-health` | **RETARGET - DELTA 3.** Replace current `seo-audit?sub=content-decay` acting-home sender. | Static contract covers sender; runtime Content Pipeline receiver test proves tab active. |
| `src/components/WorkspaceHome.tsx:217` | `content-pipeline?tab=content-health` | **RETARGET - DELTA 3.** Attention item href moves to acting home. | Static sender test + runtime receiver test. |
| `src/components/WorkspaceHome.tsx:508` | `content-pipeline?tab=content-health` | **RETARGET - DELTA 3.** Content Decay stat card moves to acting home. | Static sender test + runtime receiver test. |
| Site Audit Broken Links card (`src/components/SeoAudit.tsx:536`) | `links?tab=dead-links` | **KEEP - Frozen Contract #3.** Links receiver already shipped (`docs/ui-rebuild/phase-a/tickets/links.md:152-162`). | Keep/extend static `?tab=` contract and runtime Links receiver coverage. |
| Site Audit issue row -> SEO Editor | `seo-editor?tab=research` or router-state `fixContext` | **RETARGET PAGE DEEP-DIVE + KEEP FIX.** Checks mapped to `seo-editor` remain; page deep-dive no longer targets `page-intelligence`. | Contract-test `fixContext` receiver and runtime row-focus behavior. |
| Site Audit issue row -> Schema | `seo-schema` + `fixContext` | **KEEP.** Schema receiver must accept audit issue context. | Contract-test receiver accepts `issueCheck`, page identity, and message. |
| Site Audit issue row -> Links | `links?tab=dead-links|redirects` + `fixContext` | **KEEP.** Broken/canonical/redirect issues route to Links. | Contract-test receiver and preserve `dead-links` alias. |
| Site Audit issue row -> briefs/content pipeline | `content-pipeline?tab=briefs` + `fixContext` | **RETARGET LEGACY BRIEFS IF NEEDED.** Existing `seo-briefs` map in `ISSUE_FIX_MAP` must land in Content Pipeline's briefs receiver. | Static contract for any `?tab=briefs` sender; runtime Content Pipeline receiver. |
| Site Audit issue row -> Performance | `performance` + `fixContext` | **KEEP.** Performance issues route to rebuilt Performance detail home. | Contract-test receiver accepts page/issue context. |
| Site Audit page deep-dive button | `seo-editor?tab=research&page=...` + `fixContext` | **RETARGET.** Do not touch Page `page-intelligence` retirement; only rebuilt Site Audit sender changes. | Runtime SEO Editor receiver test asserts Research mode and selected page/fallback. |

## 5. Flag Disposition

| Flag / mount | Required behavior |
|---|---|
| `ui-rebuild-shell` | This is the only feature flag. No surface-specific flag is introduced. |
| `REBUILT_SURFACES['seo-audit']` | Controller-applied one-line mount in `src/components/layout/rebuiltSurfaces.ts`; the build lane must not edit the registry file in this PR. |
| Flag-OFF behavior | Legacy `SeoAudit` remains byte-identical through the current `App.tsx` branch (`src/App.tsx:413`). Do not edit `src/components/SeoAudit.tsx` for flag-ON work. |
| Flag retirement | None in W5. Do not retire `ui-rebuild-shell`, and do not remove old sub-tool routes from legacy. |
| Real-render smoke | Required before merge: flag ON in browser with an audited workspace, click Audit / History / Guide / Content Health diagnostic / AI Search Ready, run Re-scan through job start, and verify Content Pipeline retargets. |

## 6. File Ownership

### Owned by the Site Audit build PR

- `src/components/site-audit-rebuilt/**` - rebuilt `@ds-rebuilt` surface. Suggested split: `SiteAuditSurface.tsx`, `AuditLens.tsx`, `HistoryLens.tsx`, `GuideLens.tsx`, `AeoReviewCarryover.tsx`, `ContentDecayDiagnostic.tsx`, `IssueFirstTable.tsx`, `IssueDetailDrawer.tsx`, `ScheduleDrawer.tsx`, `useSiteAuditSurfaceState.ts`, `siteAuditMutationFeedback.ts`, and formatters. Every file first line `// @ds-rebuilt`.
- `src/hooks/admin/useSiteAuditRebuilt*.ts` - React Query wrappers/adapters over existing report, audit traffic, suppression, schedule, and background-job flows. No raw `fetch()` in components.
- `tests/component/site-audit-rebuilt/**` - flag-ON mount, seeded real `useFeatureFlag`, a11y floor, empty/loading/error/job progress states, runtime `?sub=` receiver tests, Content Pipeline retarget tests, and DataTable overflow checks.
- `tests/contract/tab-deep-link-wiring.test.ts` or adjacent contract coverage - update for the three `content-pipeline?tab=content-health` senders and all rebuilt `fixContext` receiver expectations.
- `tests/integration/public-portal-audit-copy.test.ts` or a focused integration test - extend public read-path coverage for additive `displayCategory` / category-score shape and `GET /api/public/audit-traffic/:workspaceId`.
- `server/seo-audit.ts`, `server/audit-page.ts`, `server/audit-snapshot-views.ts`, `server/audit-suppression-projection.ts`, `server/seo-audit-suppressions.ts`, `server/routes/public-portal.ts`, and `server/routes/workspaces.ts` only for `SB-010` additive category scores / `displayCategory` serialization. Keep persisted keys unchanged.
- Shared/client type files needed for the additive `displayCategory` and category-score payload. Prefer shared contract types where the admin and public reads both consume the field.
- `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` - add the rows from §7 in the implementation PR.
- `data/ui-rebuild-deferred-ledger.json` - add the §7 DEF rows in the same PR as the surface implementation.
- `data/roadmap.json` / `FEATURE_AUDIT.md` - add/update W5 Site Audit implementation status per project completion rules.

### Reused, not rewritten

- `src/hooks/admin/useSeoAuditWorkflow.ts:32-154` - job start, latest snapshot restore, history reads, and remount recovery are the behavior source. Wrap or adapt; do not fork logic casually.
- Current report routes (`server/routes/reports.ts:251-343`) and action-item endpoints (`server/routes/reports.ts:278-310`).
- Existing schedule routes (`server/routes/audit-schedules.ts:17-36`) and `useAuditSchedule` (`src/hooks/admin/useAdminSeo.ts:45-55`).
- `BulkAcceptPanel` behavior contract (`src/components/audit/BulkAcceptPanel.tsx:29-177`) if carried over; restyle shell only.
- Existing `AeoReview` and `ContentDecay` sub-tools as T1 carry-over / diagnostic views; no redesign in Site Audit.
- Existing public/client HealthTab code may consume additive fields, but the Site Audit PR must not rewrite client UX beyond typed additive compatibility (`src/components/client/types.ts:35-46,167-171`; `src/components/client/health-tab/healthTabModel.ts:107-122`).

### Must not touch / other-owner constraints

- `src/components/layout/rebuiltSurfaces.ts` - mount is controller-applied for this fan-out, listed here only as a contract.
- `src/AppShell.tsx`, global shell primitives, and other lanes' rebuilt directories.
- Legacy `src/components/SeoAudit.tsx` flag-OFF path; it remains byte-identical.
- `src/components/content-pipeline-rebuilt/**`, except via tests or route sender retargets outside that directory. Content Pipeline already owns the `content-health` receiver.
- `src/components/seo-editor-rebuilt/**`, `src/components/links-rebuilt/**`, `src/components/performance-rebuilt/**`, and `src/components/schema-rebuilt/**`. Site Audit may only contract-test their receivers; do not implement their internals.
- Page `page-intelligence` route retirement. W4/D3 owns that route-removal/D8 lifecycle; this PR only retargets rebuilt Site Audit senders.
- Frozen Contract #6: no endpoint rename, payload reshape, or alternate SEO write route.
- Cross-workspace sitehealth.js roll-up or batch-fix code (`SB-013` / `SB-060`). W6 Global Ops owns after write-safety review.

## 7. D8 / DEF Entries

### D8 redirect-map rows to add

Add these rows to `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` in the Site Audit implementation PR. Rows marked "already shipped" are still listed so the consolidation map remains complete; do not re-retire those routes from this PR.

| Old surface / sender | New target | Owner PR | Added |
|---|---|---|---|
| `seo-audit` Performance-triage / CWV detail | `performance` | W3 performance (shipped) | 2026-07-07 |
| `seo-audit` Links-triage broken/dead-link workshop | `links?tab=dead-links` | W3 links (shipped) | 2026-07-07 |
| `seo-audit` redirect-chain / redirect action workshop | `links?tab=redirects` | W3 links (shipped) | 2026-07-07 |
| `seo-audit` dead-link CSV/export workshop | `links?tab=dead-links` | W3 links (shipped) | 2026-07-07 |
| `page-intelligence` Architecture tab | `links?tab=architecture` | W3/W4 D3 route-removal owner (shipped) | 2026-07-07 |
| `seo-audit?sub=content-decay` acting-home senders | `content-pipeline?tab=content-health` | W5 site-audit sender retarget + W4 content-pipeline receiver | 2026-07-07 |
| Site Audit page deep-dive / Page Intelligence sender | `seo-editor?tab=research` | W5 site-audit sender retarget + W4 seo-editor receiver | 2026-07-07 |
| `seo-audit?sub=aeo-review` planned out-move | `seo-audit?sub=aeo-review` until `ai-visibility` exists | W5 site-audit temporary hold (`DEF-site-audit-001`) | 2026-07-07 |

### Deferred-ledger rows to add in the surface PR

Each row uses the valid deferred-ledger class enum from `BUILD_CONVENTIONS.md`: `token`, `primitive`, `behavior`, `data`, `a11y`, `perf`, or `copy`.

```json
[
  {
    "id": "DEF-site-audit-001",
    "surface": "site-audit",
    "item": "AeoReview / AI Search Ready relocation to AI Visibility",
    "decision": "Keep AeoReview reachable inside Site Audit until an ai-visibility Page id and receiver exist; do not drop or retarget the sub-tool in W5.",
    "class": "behavior",
    "upgradeTrigger": "Owner creates the AI Visibility route/home and signs the AeoReview relocation contract, including D8 redirect and receiver tests.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "delta": "DELTA 1",
      "surface": "docs/ui-rebuild/phase-a/surfaces/site-audit.json:709",
      "currentSubtool": "src/components/SeoAudit.tsx:364-371",
      "backlog": "SB-009"
    }
  },
  {
    "id": "DEF-site-audit-002",
    "surface": "site-audit",
    "item": "sitehealth.js cross-client roll-up and batch-fix",
    "decision": "Defer the book-level site-health matrix and all cross-client batch-fix behavior to W6 Global Ops; W5 does not ship even the read-only matrix.",
    "class": "data",
    "upgradeTrigger": "W6 Global Ops signs the cross-client read/write safety review and implements SB-013/SB-060 with performance and activity-log coverage.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "delta": "DELTA 2",
      "surface": "docs/ui-rebuild/phase-a/surfaces/site-audit.json:626-630",
      "readBacklog": "SB-013",
      "jobBacklog": "SB-060",
      "existingScaffold": "server/routes/workspaces.ts:107-124"
    }
  },
  {
    "id": "DEF-site-audit-003",
    "surface": "site-audit",
    "item": "Audit findings graduation to Insights Engine",
    "decision": "Do not build a Site Audit-only graduation write; keep audit parity and wait for the C3 owner-signed cross-surface graduation seam.",
    "class": "behavior",
    "upgradeTrigger": "SB-001 lands a shared graduation endpoint with InsightType registration, source provenance, activity logging, broadcasts, and receiver UI.",
    "owner": "Joshua",
    "status": "open",
    "roadmapItemId": null,
    "createdAt": "2026-07-07",
    "reviewBy": "2026-08-18",
    "links": {
      "decision": "AD-004",
      "phaseA": "docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30",
      "surface": "docs/ui-rebuild/phase-a/surfaces/site-audit.json:212-215",
      "backlog": "SB-001"
    }
  }
]
```

### Gates before merge

`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger`. Add a seeded real-flag component test, runtime `?sub=` receiver tests, static + runtime Content Pipeline `?tab=content-health` retarget tests, all `fixContext` receiver tests, and a flag-ON browser smoke against a workspace with audit history, suppressions, traffic, dead links, AeoReview data, and content decay data.
