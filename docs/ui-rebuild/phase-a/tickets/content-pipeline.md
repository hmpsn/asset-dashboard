# Wave 4 BUILD TICKET - Content Pipeline (Page `content-pipeline`)

> **Surface:** Admin `Page 'content-pipeline'` (`src/routes.ts:7`) in the Content nav (`src/lib/navRegistry.tsx:153-155`, `needsSite: true`).
> **HEAD component + mount:** `ContentPipeline` (`src/components/ContentPipeline.tsx:65-74`, current `?tab=planner|calendar|briefs|posts|publish` receiver) mounted from `src/App.tsx:424`; legacy content aliases already redirect or mount nearby in `src/App.tsx:427-430`.
> **Wave:** W4 · **Lane:** A-lane (`ui-rebuild-shell`) · **Effort:** **XL** (`docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:708-709`).
> **Read first:** Phase A decisions (`docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:24-30`), cross-surface contracts (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,70,86-89`), build conventions (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:134-220`), Phase 0 inventory (`docs/ui-rebuild/phase0/surfaces/content-pipeline.md:3-5`), and this surface JSON (`docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:4-767`).
> **Mount/D8 contract:** Add one `REBUILT_SURFACES['content-pipeline']` mount (`src/components/layout/rebuiltSurfaces.ts:5-17`) and retire `content-perf` to `content-pipeline?tab=published` in the same consolidation PR. Current `content-perf` exists at `src/routes.ts:10`, `src/App.tsx:59,434`, and `src/lib/navRegistry.tsx:160-161`; the D8 row belongs in `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md:5-8`.
> **Cross-surface laws:** C-6 keeps the Brand & AI relocation payload out of this ticket (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86-89`). Frozen Contract #8 forbids forking the shared `getContentPerformance` admin/public/MCP handler (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:70`).

## 1. ⚠ OWNER DELTAS

| Discovery item | Resolution for this build ticket | Backing reference |
| --- | --- | --- |
| C-6 content/brand overlap | Exclude the Brand & AI-owned relocation payload from this W4 scope. This ticket may only rebuild the current Content Pipeline workflow plus the folded Content Performance group. | `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86-89`; `docs/ui-rebuild/phase-a/tickets/brand-ai.md` already shipped W3. |
| Content Performance consolidation / performance OQ9 | Build Content Performance inside this surface as `?tab=published` and retire Page `content-perf` to `content-pipeline?tab=published` in the same PR. | `docs/ui-rebuild/phase-a/tickets/performance.md:25-27,68-90,161-163`; `src/routes.ts:10`; `src/App.tsx:434`; `src/lib/navRegistry.tsx:160-161`. |
| Frozen Contract #8 | Reuse, do not fork, the shared content-performance domain handler and public scrub contract. | `docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:70`; `server/domains/content/content-performance.ts:184-198,200-327`; `server/mcp/tools/content.ts:58-63,135-144`. |
| Q1: workflow stage source | Adopt AD-012: stage labels are a derived view for W4; no schema migration unless later server backlog proves the need. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:505-510`; `docs/ui-rebuild/phase-a/owner-decisions.json:176-184`; `docs/ui-rebuild/phase-a/server-backlog.json:620-630`. |
| Q2: Published Post metrics sufficiency | Preserve current post workflow and fold true per-piece performance into the new Published tab. Do not invent missing metrics; defer deeper GeneratedPost readbacks to SB-007. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:512-516,721-724`; `server/routes/content-requests.ts:294-334`; `docs/ui-rebuild/phase-a/server-backlog.json:101-112`. |
| Q3: production action placement | Open owner delta. Default: keep production actions in the Draft/Post workspace with detail drawers and keep client-review decisions in request rows; do not scatter duplicate action bars across tabs. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:518-522`; current send/publish controls at `src/components/ContentManager.tsx:323-356,407-443`; request controls at `src/components/briefs/RequestList.tsx:185-317`. |
| Q4: T1 component carry-over | Adopt AD-010: carry over heavy editors and matrix internals, restyle their shell only. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:524-528`; `docs/ui-rebuild/phase-a/owner-decisions.json:140-157`; `src/components/PostEditor.tsx:628-670`; `src/components/matrix/MatrixGrid.tsx:286-382`; `src/components/matrix/CellDetailPanel.tsx:86-365`. |
| Q5: Content Health action intensity | Open owner delta. Default: Content Pipeline is the acting home, but advanced crawl/repair actions remain tier-aware and may defer behind explicit DEF rows rather than blocking the rebuild. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:530-534`; `docs/ui-rebuild/phase-a/owner-decisions.json:186-196`; current alert source at `src/components/ContentPipeline.tsx:204-258`. |
| Q6: duplicate Content Health surfacing | Adopt AD-013: SEO Audit stays diagnostic; Content Pipeline is the acting home and existing decay senders must retarget to the pipeline receiver. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:536-540`; `docs/ui-rebuild/phase-a/owner-decisions.json:186-196`; current senders at `src/components/ContentPipeline.tsx:217-221` and `src/components/WorkspaceHome.tsx:501-509`. |
| Q7: calendar scope | Open owner delta. Default: preserve all current item types and scheduling affordances because AD-011 requires zero-drop parity. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:542-546`; `docs/ui-rebuild/phase-a/owner-decisions.json:159-173`; `src/hooks/admin/useContentCalendar.ts:78-148`; `src/components/ContentCalendar.tsx:109-188,303-615`. |
| Q8: matrix rebuild depth | Adopt AD-010: carry over matrix internals and wrap them in rebuilt page chrome, filters, and drawers. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:548-552`; `docs/ui-rebuild/phase-a/owner-decisions.json:140-157`; `src/components/matrix/MatrixGrid.tsx:18-115,183-382`; `src/components/matrix/CellDetailPanel.tsx:21-365`. |
| Q9: analytics visualization depth | Open owner delta. Default: use concise metric tiles/rings and honest real-data sparklines only; do not add visualizations without real source data. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:554-558,584-588`; `docs/ui-rebuild/phase-a/owner-decisions.json:336-346`; current fabricated mini sparkline to replace/avoid at `src/components/ContentPerformance.tsx:312-319`. |
| Q10: snooze mechanics | Preserve current snooze/dismiss/accept semantics and present them through a rebuilt menu/card pattern. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:560-564`; `src/components/pipeline/AiSuggested.tsx:64-68,121-178`; `src/hooks/admin/useAiSuggestedBriefs.ts:17-55`; `server/routes/suggested-briefs.ts:62-152`. |
| Q11: advanced brief controls | Preserve keyword, page type, style, reference URLs, template cross-reference, and background-job progress. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:566-570`; `src/components/briefs/BriefGenerator.tsx:56-165`; `src/hooks/admin/useAdminBriefWorkflow.ts:170-243,543-622`. |
| Q12: API-only endpoint pruning | No pruning in this PR. Route retirement is limited to Page `content-perf`; API routes and MCP tools used by public/admin/MCP consumers stay intact. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:572-576`; `server/routes/content-requests.ts:294-334`; `server/mcp/tools/content.ts:58-63,135-144`. |
| Q13: new features disposition | Adopt only items already backed by current data or explicit server tickets. Every other requested behavior gets a DEF row instead of hidden scope creep. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:578-582`; backlog refs in `docs/ui-rebuild/phase-a/server-backlog.json:7-23,87-125,201-241,440-451,620-680`. |
| N1 lifecycle board | Adopt in rebuild as a derived six-stage view over existing statuses; do not change stored status semantics. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:591-595`; AD-012 at `docs/ui-rebuild/phase-a/owner-decisions.json:176-184`. |
| N2 unified intake lane | Adopt in rebuild using existing client request, AI suggestion, work-order, and decay sources; only the queue refresh wrapper may ride as a small server addition. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:596-600`; SB-047 at `docs/ui-rebuild/phase-a/server-backlog.json:632-643`; current AI intake at `src/components/pipeline/AiSuggested.tsx:50-178`. |
| N3 capacity meter | Adopt in rebuild from subscription quota/progress data; no new server work. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:601-605`; current subscription progress at `src/components/ContentSubscriptions.tsx:243-262`. |
| N4 Published results tab | Adopt in rebuild as `?tab=published`, backed by the existing Content Performance read path and verdict fields. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:606-610`; `server/domains/content/content-performance.ts:200-327`; `shared/types/content.ts:388-411`. |
| N4b Published engagement tile + clicks sparkline | Defer to `DEF-content-pipeline-001`; use only real trend data in W4 and never fabricate a series. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:611-615`; `docs/ui-rebuild/phase-a/server-backlog.json:101-112`; AD-026 at `docs/ui-rebuild/phase-a/owner-decisions.json:336-346`. |
| N5 graduate wins to Insights Engine | Defer to `DEF-content-pipeline-003`; this is a cross-surface write and not parity-critical. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:616-620`; AD-004 at `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30`; SB-001 at `docs/ui-rebuild/phase-a/server-backlog.json:7-23`. |
| N6 Content Health tab with queue refresh | Adopt in rebuild with SB-047 riding if needed; keep acting-home ownership in Content Pipeline per AD-013. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:621-625`; `docs/ui-rebuild/phase-a/owner-decisions.json:186-196`; `docs/ui-rebuild/phase-a/server-backlog.json:632-643`. |
| N7 full-page brief workspace | Adopt in rebuild by remounting existing brief generation/detail machinery inside rebuilt chrome. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:626-630`; `src/components/ContentBriefs.tsx:13-331`; `src/components/briefs/BriefGenerator.tsx:56-165`. |
| N7b per-field AI assists, readiness checklist, client questionnaire | Defer to `DEF-content-pipeline-009` and `DEF-content-pipeline-010`; these require new AI operations/client flow. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:631-635`; `docs/ui-rebuild/phase-a/server-backlog.json:657-680`. |
| N8 draft workspace | Adopt in rebuild via AD-010 carry-over of PostEditor machinery inside new chrome. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:636-640`; `docs/ui-rebuild/phase-a/owner-decisions.json:140-157`; `src/components/PostEditor.tsx:145-191,628-740`. |
| N9 inline keyword picker | Defer unless an implementation PR can wire it without new scope; existing fixContext keyword handoff remains the W4 parity path. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:641-645`; current fixContext handoff at `src/hooks/admin/useAdminBriefWorkflow.ts:519-541`; deferred ledger coverage via `DEF-content-pipeline-009` if coupled to brief assists. |
| N10 nudge client | Defer to `DEF-content-pipeline-004`; current awaiting-client controls stay intact. | `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:646-650`; `docs/ui-rebuild/phase-a/server-backlog.json:201-213`; `src/components/briefs/RequestList.tsx:185-241`. |
| AD-020 AI 429 handling | Any AI generation, rewrite, fix, or assist state rendered in the rebuild must use the standard constrained-copy pattern and preserve retry timing. | `docs/ui-rebuild/phase-a/owner-decisions.json:267-278`; `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:81-98`; current background job handling at `src/hooks/admin/useAdminBriefWorkflow.ts:170-186,543-622`. |
| AD-026 sparkline rule | Use real trend series or show an honest absent state; no synthetic bars from scalar totals. | `docs/ui-rebuild/phase-a/owner-decisions.json:336-346`; `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:117-132`; current real trend endpoint at `server/routes/content-requests.ts:304-334`. |

## 2. Capability Checklist

Every row is additive per AD-011 (`docs/ui-rebuild/phase-a/owner-decisions.json:159-173`): if a capability exists in HEAD, the rebuilt surface must preserve it or explicitly defer only the enhancement portion through §7.

| Capability group | HEAD evidence | Target primitive / mode | Zero-drop confirmation |
| --- | --- | --- | --- |
| A1-A5, A10, A12-A14: page shell, tabs, aliases, workflow status, export menu, health summary, fix-context intake | `src/components/ContentPipeline.tsx:40-74,85-166,194-201,263-322`; `src/hooks/admin/useContentPipeline.ts:25-58`; current mount at `src/App.tsx:424`. | `PageContainer`, `PageHeader`, `Toolbar`, `Segmented`/`LensSwitcher`, `MetricTile`, `BoardColumn`, `Drawer`. | Preserve all current tab receivers and aliases, workflow stepper/status counts, export menu combinations, generated fix-context tab switch, and the fallback URL sync. |
| A6-A8, N6: Content Health acting home for decay/cannibalization | Current alerts at `src/components/ContentPipeline.tsx:204-258`; decay-backed brief creation at `server/routes/content-decay.ts:21-82`; suggested brief persistence at `server/routes/suggested-briefs.ts:62-152`; AD-013 at `docs/ui-rebuild/phase-a/owner-decisions.json:186-196`. | Dedicated Content Health mode/drawer with `DataTable`, `IntentTag`, `Meter`, and tier-aware actions. | Retarget existing SEO Audit decay senders into this receiver, preserve alert counts/actions, and add only the SB-047 queue wrapper if it rides. Do not duplicate diagnostic ownership back into SEO Audit. |
| A9-A9a, Q10: AI suggested briefs intake, accept, snooze, dismiss | `src/components/pipeline/AiSuggested.tsx:50-178`; `src/hooks/admin/useAiSuggestedBriefs.ts:17-55`; `server/routes/suggested-briefs.ts:62-152`. | Intake `BoardColumn`/`BoardCard`, `Menu`, `IntentTag`, and concise loading/empty states. | Preserve source badges, priority, snoozed state, accept-to-create-brief, snooze menu durations, dismiss mutation, query invalidation, activity, and workspace broadcasts. |
| A11: workflow guide / assistant drawer | `src/components/ContentPipeline.tsx:323-359`. | `Drawer` with compact workflow guidance and one CTA per step. | Keep the floating guide trigger and close behavior; restyle only. |
| B15-B30: brief workspace, generation, requests, recovery, send-to-client, undo | `src/components/ContentBriefs.tsx:13-331`; `src/components/briefs/BriefGenerator.tsx:56-165`; `src/hooks/admin/useAdminBriefWorkflow.ts:170-398,400-541,543-701`; `src/components/briefs/RequestList.tsx:319-363`. | Brief workspace mode using `DataTable`, detail `Drawer`, `WorkflowStepper`, `StatusBadge`, `CharacterCounter`, and preserved T1 editor/detail components where needed. | Preserve search/sort/filter, generation payload fields, style/ref URL/template controls, 409 job recovery, regenerate outline/brief, field save, copy/export, send-to-client note, generate post, delete/undo, and fix-context recovery. |
| C31-C37: client content requests and lifecycle decisions | `src/components/briefs/RequestList.tsx:120-317,331-363`; status mutation paths at `src/hooks/admin/useAdminBriefWorkflow.ts:188-202,343-398`. | Request lane with `WorkflowStepper`, `StatusBadge`, `ConfirmDialog`, inline note fields, and detail drawer. | Preserve requested/declined/brief-generated/client-review/post-review/changes-requested/published flows, service type and upgrade badges, delivery notes, feedback, resubmit/requeue, delete, and embedded brief detail. |
| D38-D48, E49-E56: post board, draft workflow, PostEditor, publish/send, voice scoring, exports | `src/components/ContentManager.tsx:116-184,186-264,279-443,445-469`; `src/hooks/admin/useAdminPostWorkflow.ts:75-192`; `src/components/PostEditor.tsx:145-191,200-230,246-309,322-379,385-515,628-740,742-815,930-1004,1017-1035`. | Draft/Post workspace with `BoardColumn`, `DataTable`, PostEditor carried over per AD-010, `Drawer`, `Toolbar`, `ConfirmDialog`, and honest generation progress. | Preserve filters/sort/search, status progression, `?post=` deep-link open/close, send-to-client note, publish target, voice score/rescore/feedback, export/delete, section autosave/retry, AI fix, version history, image generation confirm, SEO metadata counters, and rich-text behavior. |
| F57-F62, Q7: editorial calendar and scheduling | `src/hooks/admin/useContentCalendar.ts:41-148`; `src/components/ContentCalendar.tsx:109-188,303-400,403-615,617-635`. | Calendar mode with month grid, selected-day side panel, `FilterChip`, `Toolbar`, `DataList`, and scheduling `Drawer`. | Preserve all four item types, derived plot dates, deep-links to post/brief/planner/request contexts, schedule/unschedule, suggested dates, month stats, type filters, day detail actions, and empty CTA. |
| G63-G72, Q8: content matrix/planner | `src/components/ContentPlanner.tsx:21-120,124-185,190-385`; `src/components/matrix/MatrixGrid.tsx:18-115,183-382`; `src/components/matrix/CellDetailPanel.tsx:21-365`. | Matrix mode with carried-over `MatrixGrid`/`CellDetailPanel`, rebuilt toolbar/filter chrome, `DataTable`, `IntentTag`, `Meter`, and detail drawers. | Preserve view modes, matrix/template queries, template save, matrix create, status map, multi-select/range selection, filter/sort, export/send-review bulk actions, grid/list views, legend, keyword candidate accept, schema/content links, timeline, and detail actions. |
| H73-H78: content subscriptions / recurring plans | `src/components/ContentSubscriptions.tsx:18-24,35-79,81-187,189-274,278-320`; current nearby route at `src/App.tsx:430`. | Subscription mode or drawer under Content Pipeline using `DataTable`, `Meter`, `ConfirmDialog`, and `StatusBadge`. | Preserve create/edit/delete, active subscription selection, plan/source/frequency/status fields, pause/resume, capacity/progress, mark delivered, empty state, and delivery history. |
| I79-I83: shared events, invalidation, jobs, MCP/public seams | Surface contract data hooks at `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:677-689`; suggested brief broadcasts at `server/routes/suggested-briefs.ts:103-106,129-131,149-151`; Content Performance API/MCP at `src/api/seo.ts:360-373`, `server/routes/content-requests.ts:294-334`, `server/mcp/tools/content.ts:58-63,135-144`. | Reuse current React Query hooks/mutations, `useWorkspaceEvents`, `useBackgroundTasks`, and existing API wrappers; no raw component fetches except through approved wrappers. | Preserve cache keys, background job status, workspace broadcasts, public/MCP handler shape, and do not introduce duplicate polling or a forked content performance client. |
| Published C1-C18: folded Content Performance tab | C1 GSC metrics: `src/components/ContentPerformance.tsx:282-300,327-351`, `server/domains/content/content-performance.ts:216-231,264-274`; C2 CTR/position: `src/components/ContentPerformance.tsx:342-345`; C3 GA4 metrics: `src/components/ContentPerformance.tsx:358-384`, `server/domains/content/content-performance.ts:233-249,273-274`; C4 totals: `src/components/ContentPerformance.tsx:155-217`; C5 sort: `src/components/ContentPerformance.tsx:145-153,219-237`; C6 trend: `src/components/ContentPerformance.tsx:132-143,422-429`, `server/routes/content-requests.ts:304-334`; C7 coverage/joinback: `src/components/ContentPerformance.tsx:388-420`, `server/domains/content/content-performance.ts:251-278`; C8 matrix source: `src/components/ContentPerformance.tsx:268-272`, `server/domains/content/content-performance.ts:282-308`; C9 badges/source/keyword/slug: `src/components/ContentPerformance.tsx:257-279`; C10 delivered/published filter: `server/domains/content/content-performance.ts:207-209`; C11 days since publish: `server/domains/content/content-performance.ts:271-272`, `src/components/ContentPerformance.tsx:305-309`; C12 states: `src/components/ContentPerformance.tsx:163-188`; C13 public scrub/wrapper: `server/domains/content/content-performance.ts:184-198,317-327`; C14 MCP: `server/mcp/tools/content.ts:58-63,135-144`; C15 verdict/outcome fields: `shared/types/content.ts:388-411`, `server/domains/content/content-performance.ts:162-181,251-278`; C16 graduation defer: `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30`; C17 live URL recipe: `server/routes/content-requests.ts:315-321`; C18 baseline lift defer: `docs/ui-rebuild/phase-a/server-backlog.json:114-125`. | New `?tab=published` receiver using `MetricTile`, `DataTable`, `Sparkline` only from real trend series, `Meter`, `DefinitionList`, and detail drawer. | Preserve every C1-C18 read/display behavior from the current Content Performance page, but mount it inside Content Pipeline. Replace the scalar-fabricated mini sparkline (`src/components/ContentPerformance.tsx:312-319`) with real trend data or an honest absent state per AD-026. Do not fork `getContentPerformance`. |

## 3. Server Tickets

| Backlog item | Ride or defer | Ticket handling |
| --- | --- | --- |
| SB-006 Content Performance verdicts | **Ride if not already satisfied.** | The Published tab consumes verdict fields from the existing handler; if the current rows lack the verdict, wire the shared handler once, not per surface. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:87-99`; `shared/types/content.ts:398-406`; `server/domains/content/content-performance.ts:162-181,251-278`. |
| SB-047 Content Health queue refresh wrapper | **Ride.** | This is the thin missing wrapper after verifier refuted the larger missing-writer claim. Use the existing decay writer and suggested-brief store. Backing: `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:733-736`; `docs/ui-rebuild/phase-a/server-backlog.json:632-643`; `server/routes/content-decay.ts:37-65`. |
| SB-001 Published wins graduation | **Defer -> `DEF-content-pipeline-003`.** | AD-004 keeps graduation non-critical unless it meets the later criteria. Backing: `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13,28-30`; `docs/ui-rebuild/phase-a/server-backlog.json:7-23`; current insights routes at `server/routes/insights.ts:13-51`. |
| SB-007 GeneratedPost engagement + time series | **Defer -> `DEF-content-pipeline-001`.** | Build the Published tab on current Content Performance + real trend endpoint; defer deeper GeneratedPost readbacks. Backing: `docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:721-724`; `docs/ui-rebuild/phase-a/server-backlog.json:101-112`. |
| SB-008 baseline lift | **Defer -> `DEF-content-pipeline-002`.** | Current 90-day metrics are sufficient for parity; pre/post baseline lift is additive. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:114-125`; current windows at `server/domains/content/content-performance.ts:216-249`. |
| SB-014 client nudge/reminder | **Defer -> `DEF-content-pipeline-004`.** | Keep current request lifecycle actions; add reminders only when rate-limited behavior is specified. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:201-213`; current client-review controls at `src/components/briefs/RequestList.tsx:185-241`. |
| SB-016 approved-rec progress join | **Defer -> `DEF-content-pipeline-005`.** | This is a cross-surface recommendations/client-portal join, not a blocker for the admin rebuild. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:230-241`. |
| SB-032 page rewriter writeback | **Defer -> `DEF-content-pipeline-006`.** | Preserve current editor export/publish behaviors; do not introduce CMS writeback without owner-backed write-target rules. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:440-451`; current exports/publish controls at `src/components/PostEditor.tsx:340-363,963-1004`. |
| SB-046 persisted lifecycleStage | **Defer -> `DEF-content-pipeline-007`.** | AD-012 explicitly says derived stage view is the W4 default. Backing: `docs/ui-rebuild/phase-a/owner-decisions.json:176-184`; `docs/ui-rebuild/phase-a/server-backlog.json:620-630`. |
| SB-048 matrix generate briefs job | **Defer -> `DEF-content-pipeline-008`.** | Preserve the existing menu item only if backed by a real path; the current planner marks the bulk variant non-live. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:645-655`; `src/components/ContentPlanner.tsx:88-107`; `src/components/matrix/MatrixGrid.tsx:244-280`. |
| SB-049 per-field brief AI assists | **Defer -> `DEF-content-pipeline-009`.** | Do not block rebuilt brief editing on new per-field assists. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:657-667`; current field save at `src/hooks/admin/useAdminBriefWorkflow.ts:277-283`. |
| SB-050 client questionnaire flow | **Defer -> `DEF-content-pipeline-010`.** | Current request intake/review stays intact; questionnaire scaffolding is a later behavior/data expansion. Backing: `docs/ui-rebuild/phase-a/server-backlog.json:669-680`; current request rows at `src/components/briefs/RequestList.tsx:120-317`. |

## 4. Deep-Link Receiver Matrix

The rebuilt surface must keep the two-halves `?tab=` contract: every sender listed here must land on a receiver that reads and validates the param (`docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:186-195`; current receiver at `src/components/ContentPipeline.tsx:65-100`; contract test at `tests/contract/tab-deep-link-wiring.test.ts:214-220,259-266,295-341`).

| URL / sender | Receiver requirement | Evidence |
| --- | --- | --- |
| `/ws/:workspaceId/content-pipeline?tab=planner` | Open the matrix/planner mode. Preserve existing `planner` id even if the rebuilt label says Matrix. | Sender in command palette at `src/components/CommandPalette.tsx:245-248`; calendar matrix link at `src/components/ContentCalendar.tsx:121`; current receiver/render at `src/components/ContentPipeline.tsx:65-74,293-296`. |
| `/ws/:workspaceId/content-pipeline?tab=calendar` and legacy `/calendar` redirect | Open calendar mode and preserve all event deep-links. | Legacy redirect at `src/App.tsx:429`; current render at `src/components/ContentPipeline.tsx:299-301`; calendar deep-link senders at `src/components/ContentCalendar.tsx:117-123`. |
| `/ws/:workspaceId/content-pipeline?tab=briefs` and legacy `/seo-briefs` redirect | Open brief/request workspace. | WorkspaceOverview sender at `src/components/WorkspaceOverview.tsx:117-123`; Issue lens sender at `src/components/strategy/issue/ContentWorkOrderLens.tsx:93-95`; legacy redirect at `src/App.tsx:427`; current render at `src/components/ContentPipeline.tsx:304-308`. |
| `/ws/:workspaceId/content-pipeline?tab=posts&post=:postId` | Open posts mode and then open the post editor by `?post=`. Closing the editor must remove only the `post` param. | ContentCalendar sender at `src/components/ContentCalendar.tsx:117`; current receiver sync at `src/components/ContentPipeline.tsx:85-100`; `?post` read/clear at `src/hooks/admin/useAdminPostWorkflow.ts:81-82,113-121`. |
| `/ws/:workspaceId/content-pipeline?tab=publish` and `?tab=subscriptions` alias | Preserve current publish/subscription mode while the rebuild decides the final label. | Current tab/alias at `src/components/ContentPipeline.tsx:46-55,320-322`; current subscription component at `src/components/ContentSubscriptions.tsx:81-320`; route proximity at `src/App.tsx:430`. |
| **NEW** `/ws/:workspaceId/content-pipeline?tab=published` | Open the folded Content Performance mode. This is the redirect target for retired `content-perf`. | W3 performance requirement at `docs/ui-rebuild/phase-a/tickets/performance.md:68-90,161-163`; current Content Performance page at `src/components/ContentPerformance.tsx:123-429`; shared handler at `server/domains/content/content-performance.ts:200-327`. |
| **ROUTE RETIREMENT** `/ws/:workspaceId/content-perf` | Redirect with replace to `/ws/:workspaceId/content-pipeline?tab=published`; no nav entry remains. | Current Page value at `src/routes.ts:10`; current mount at `src/App.tsx:434`; current nav entry at `src/lib/navRegistry.tsx:160-161`; route-removal checklist at `docs/rules/route-removal-checklist.md:9-13`. |
| `?tab=content-health` and decay/cannibalization acting-home links | Add a validated receiver for Content Health. Retarget existing `seo-audit?sub=content-decay` senders to this receiver in the implementation PR. | AD-013 at `docs/ui-rebuild/phase-a/owner-decisions.json:186-196`; current senders at `src/components/ContentPipeline.tsx:217-221` and `src/components/WorkspaceHome.tsx:501-509`. |
| Invalid or missing `tab` | Fall back to the default mode without crashing and keep URL/state sync stable. | Current fallback at `src/components/ContentPipeline.tsx:65-74,85-100`; test harness for tab receivers at `tests/contract/tab-deep-link-wiring.test.ts:311-341`. |

## 5. Flag Disposition

| Flag / mount | Required behavior |
| --- | --- |
| `ui-rebuild-shell` | This is the only feature flag for the rebuilt surface. It exists as the global shell flag (`shared/types/feature-flags.ts:117-120,440-466`) and must gate the rebuilt mount through `REBUILT_SURFACES`, not a new surface-specific flag. |
| One rebuilt mount | Add exactly one `REBUILT_SURFACES['content-pipeline']` entry in `src/components/layout/rebuiltSurfaces.ts:5-17`. The `App.tsx` rebuilt-shell path already consumes the registry (`src/App.tsx:460-478`). |
| Flag-OFF behavior | For the `content-pipeline` route itself, flag OFF must render the current `ContentPipeline` path byte-identically (`src/App.tsx:424`). The explicit exception is the D8 route retirement of `content-perf`, which ships with the new `?tab=published` receiver so the old standalone route does not remain a second home. |
| No flag retirement | Do not retire `ui-rebuild-shell` in this PR. Do not add a second dark-launch flag. |

## 6. File Ownership

### Owned by the Content Pipeline build PR

- `src/components/content-pipeline-rebuilt/**` - rebuilt surface implementation with `@ds-rebuilt` discipline.
- `src/components/layout/rebuiltSurfaces.ts` - one `content-pipeline` registry mount.
- `tests/contract/tab-deep-link-wiring.test.ts` - add/adjust receivers for `content-pipeline?tab=published`, `?tab=content-health`, existing `?tab=posts&post=`, and the `content-perf` redirect target.
- `data/ui-rebuild-deferred-ledger.json` - add the `DEF-content-pipeline-*` rows from §7 if the build PR defers those server/behavior items.
- `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` - add the `content-perf -> content-pipeline?tab=published` row.
- Route-removal sites for Page `content-perf`, explicitly following `docs/rules/route-removal-checklist.md:9-13`:
  - `src/routes.ts` - remove or retire the `Page` union value `content-perf` (`src/routes.ts:10`) once the redirect path is in place.
  - `src/App.tsx` - remove the standalone `ContentPerformance` route case/import (`src/App.tsx:59,434`), update SEO tab membership (`src/App.tsx:378`), and add the redirect during the soak/deletion step as required by the checklist.
  - `src/lib/navRegistry.tsx` - remove the `content-perf` nav registry entry (`src/lib/navRegistry.tsx:160-161`); do not leave it as a visible destination.
  - Navigation-literal call sites - grep for `content-perf` and update any sender to `content-pipeline?tab=published` (checklist requirement at `docs/rules/route-removal-checklist.md:12`).
  - Contract/nav tests - update `tests/contract/nav-registry-completeness.test.ts:47-64,72-77` and any zombie/redirect/deep-link tests that assert the old page id (checklist requirement at `docs/rules/route-removal-checklist.md:13`).

### Reused, not rewritten

- `server/domains/content/content-performance.ts:184-198,200-327`, `server/routes/content-requests.ts:294-334`, `src/api/seo.ts:360-373`, and `server/mcp/tools/content.ts:58-63,135-144` - shared Content Performance read path.
- `src/components/PostEditor.tsx`, `src/components/matrix/MatrixGrid.tsx`, and `src/components/matrix/CellDetailPanel.tsx` - AD-010 T1 carry-over components (`docs/ui-rebuild/phase-a/owner-decisions.json:140-157`).
- `server/routes/suggested-briefs.ts:62-152`, `src/hooks/admin/useAiSuggestedBriefs.ts:17-55`, and `server/routes/content-decay.ts:21-82` - suggested brief and decay-backed intake sources.
- Existing admin hooks for brief/post/calendar/subscription workflows unless a narrow adapter is needed; do not replace their API contracts just to satisfy layout changes.

### Must not touch

- C-6 Brand & AI relocation payload. It remains owned by the shipped Brand & AI work and is not a Content Pipeline capability in this ticket (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:41-45,86-89`).
- Frozen Contract #8: do not fork, rename, narrow, or change the public-audience scrub behavior of `getContentPerformance` (`docs/ui-rebuild/phase-a/CROSS_SURFACE_CONTRACTS.md:70`; `server/domains/content/content-performance.ts:184-198,200-327`).
- Client paths and client-facing public APIs. This is an admin surface rebuild; no `src/components/client/**` edits are in scope.
- Page `performance`; only Page `content-perf` is retired by this consolidation.

## 7. D8 / DEF Entries

### D8 redirect row to add

Add this row to `docs/ui-rebuild/phase-a/D8_REDIRECT_MAP.md` in the Content Pipeline consolidation PR:

| Old Page | New target | Owner PR | Added |
| --- | --- | --- | --- |
| `content-perf` | `content-pipeline?tab=published` | W4 content-pipeline | 2026-07-07 |

### Deferred-ledger rows to add if not built in the same PR

Each row below uses a valid deferred-ledger class from `docs/ui-rebuild/phase-a/BUILD_CONVENTIONS.md:216-219`: `token`, `primitive`, `behavior`, `data`, `a11y`, `perf`, or `copy`.

```json
[
  {
    "id": "DEF-content-pipeline-001",
    "class": "data",
    "item": "GeneratedPost engagement readbacks and per-post time-series cards",
    "decision": "Defer deeper GeneratedPost metrics beyond the shared Content Performance read path.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-007 lands engagement and time-series readback fields for GeneratedPost rows.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:101-112",
      "docs/ui-rebuild/phase-a/surfaces/content-pipeline.json:721-724"
    ]
  },
  {
    "id": "DEF-content-pipeline-002",
    "class": "data",
    "item": "Pre-post baseline lift for published content performance",
    "decision": "Use current trailing-window metrics for W4 and defer baseline lift modeling.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-008 provides baseline lift calculations and fixture-backed read tests.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:114-125",
      "server/domains/content/content-performance.ts:216-249"
    ]
  },
  {
    "id": "DEF-content-pipeline-003",
    "class": "behavior",
    "item": "Graduate qualifying published wins into the Insights Engine",
    "decision": "Keep graduation out of the W4 critical path per AD-004.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "Owner confirms win criteria and SB-001 ships a tested graduation endpoint.",
    "links": [
      "docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md:13",
      "docs/ui-rebuild/phase-a/server-backlog.json:7-23",
      "server/routes/insights.ts:13-51"
    ]
  },
  {
    "id": "DEF-content-pipeline-004",
    "class": "behavior",
    "item": "Client nudge and reminder actions for awaiting client review",
    "decision": "Preserve current request actions and defer rate-limited nudges.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-014 defines reminder cooldowns, activity logging, and broadcast behavior.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:201-213",
      "src/components/briefs/RequestList.tsx:185-241"
    ]
  },
  {
    "id": "DEF-content-pipeline-005",
    "class": "data",
    "item": "Approved recommendation progress join for public/client surfaces",
    "decision": "Do not block the admin rebuild on the cross-surface recommendation join.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-016 ships the recommendation progress join with public read-path coverage.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:230-241"
    ]
  },
  {
    "id": "DEF-content-pipeline-006",
    "class": "behavior",
    "item": "CMS draft and publish writeback from the rebuilt draft workspace",
    "decision": "Preserve current export and publish controls until write-target rules are owner-approved.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-032 lands Webflow writeback with route tests and write-target documentation.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:440-451",
      "src/components/PostEditor.tsx:340-363",
      "src/components/PostEditor.tsx:963-1004"
    ]
  },
  {
    "id": "DEF-content-pipeline-007",
    "class": "data",
    "item": "Persisted lifecycleStage model for content pipeline items",
    "decision": "Use AD-012 derived stage labels in W4 and defer a schema-backed model.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-046 proves derived stages are insufficient and ships a migration plus mappers.",
    "links": [
      "docs/ui-rebuild/phase-a/owner-decisions.json:176-184",
      "docs/ui-rebuild/phase-a/server-backlog.json:620-630"
    ]
  },
  {
    "id": "DEF-content-pipeline-008",
    "class": "behavior",
    "item": "Generate briefs for selected matrix cells as a bulk job",
    "decision": "Keep existing planner actions and defer the currently non-live bulk job.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-048 implements the matrix bulk brief job with background-task tracking.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:645-655",
      "src/components/ContentPlanner.tsx:88-107",
      "src/components/matrix/MatrixGrid.tsx:244-280"
    ]
  },
  {
    "id": "DEF-content-pipeline-009",
    "class": "behavior",
    "item": "Per-field AI assists inside the brief editing workflow",
    "decision": "Preserve current brief field editing and defer granular assist controls.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-049 ships per-field operations, 429 copy, and schema-validated outputs.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:657-667",
      "src/hooks/admin/useAdminBriefWorkflow.ts:277-283"
    ]
  },
  {
    "id": "DEF-content-pipeline-010",
    "class": "behavior",
    "item": "Client questionnaire intake flow for content requests",
    "decision": "Keep the current request lifecycle and defer questionnaire intake.",
    "createdAt": "2026-07-07",
    "reviewBy": "2026-09-15",
    "upgradeTrigger": "SB-050 ships questionnaire persistence, client/admin read paths, and tests.",
    "links": [
      "docs/ui-rebuild/phase-a/server-backlog.json:669-680",
      "src/components/briefs/RequestList.tsx:120-317"
    ]
  }
]
```
