# Unified Send-to-Client — Pre-Plan Audit

**Date:** 2026-06-01
**Spec:** [docs/designs/2026-06-01-unified-send-to-client-design.md](../../designs/2026-06-01-unified-send-to-client-design.md)
**Motivating audit:** [docs/audits/2026-06-01-client-inbox-pipeline-audit.md](../../audits/2026-06-01-client-inbox-pipeline-audit.md)
**Scope:** prove exhaustive coverage before the implementation plan — **118 distinct files** across the 4 phases.
**Method:** 9 parallel exhaustive-scan agents (grep over all of `server/` + `src/`) → synthesis. Each dimension was grounded in its governing **CLAUDE.md** rules per the owner's request; Section G ties those rules to the phase/file they govern.

**Verdict:** the migration surface is fully enumerated and parallelizable. Phase 0 (shared contracts) can start immediately. **9 open scope questions (Section H)** need owner sign-off — most are answerable *during* plan writing, but three are decisions the plan's shape depends on (per-consumer read strategy, the adapter-registry coupling tradeoff, and the `new-inbox-ia` rollout % that gates the Phase-3 `LegacyInboxLayout` delete).

**Hard rule honored:** no file enters the plan that isn't grep-verified here with a `file:line`. The strangler-fig seams (every dual-write target), the unguarded status mutators (`recalcBatchStatus`, `updateSchemaPlanStatus`, `updateMatrixCell`, copy's private map, the missing `REQUEST_TRANSITIONS`), the timestamp-keyed dedup producers, and the teardown-blocking soft-FKs are all located exactly.

---

## Section A — Per-Work-Type Matrix

One row per work type. All entries grep-verified `file:line`. Triggers/routes/writers/readers/client/admin/status per type.

### Physically-migrated types (the 6 stores)

| Type | Operator trigger (UI) | Artifact route (send) | Physical store writer (dual-write seam) | Key readers | Client surface | Admin surface | Status enum / machine |
|---|---|---|---|---|---|---|---|
| **seo_edit** (approval_batch) | `src/components/editor/useSeoEditorApprovalWorkflow.ts:70` (`sendPageToClient`), `:109` (`sendForApproval`); CMS `src/components/cms-editor/useCmsEditorApprovalWorkflow.ts:82`; API `src/api/misc.ts:60` | `POST /api/approvals/:workspaceId` → `server/routes/approvals.ts:114` | `createBatch()` `server/routes/approvals.ts:116` → INSERT `server/approvals.ts:31`; also `updatePageState({approvalBatchId})` `server/routes/approvals.ts:119` | `server/admin-chat-context.ts:696-710`; `server/monthly-digest.ts:93-100` (`item.field==='seoTitle'`); `src/components/PendingApprovals.tsx:33-42` | `src/components/client/ApprovalBatchCard.tsx:30`, `ApprovalsTab.tsx:26` | `src/components/SeoEditorWrapper.tsx:119`, `editor/SeoEditorWorkflowPanels.tsx:39` (embedded `PendingApprovals`) | item `APPROVAL_ITEM_TRANSITIONS` `state-machines.ts:11`; batch derived `recalcBatchStatus()` `approvals.ts:157` (UNGUARDED) |
| **audit_issue** (approval_batch) | `src/components/SeoAudit.tsx:175` (`flagForClient`, `[Review]` name); row `src/components/audit/AuditIssueRow.tsx:163` | same `POST /api/approvals/:workspaceId` `:114` | same `createBatch` `:116` → INSERT `approvals.ts:31`. **B1: `SeoAudit.tsx:172` collapses non-title checks to `field:'seoDescription'`** — adapter needs per-check `field` map + `applyable=false` | same as seo_edit | rendered as approval batch (Decisions) | `SeoAudit.tsx` "Flag for Client" (documented Purple exception, Four Laws law 4) | same item machine |
| **schema_item** (approval_batch) | `src/components/schema/useSchemaSuggesterPublishingWorkflow.ts:68` (`Schema Review`), `:175` | same `POST /api/approvals/:workspaceId` `:114` | same `createBatch` `:116` → INSERT `approvals.ts:31` | `src/lib/decision-adapters.ts:24-31` `badgeForBatch` (name-prefix sniff) | approval batch card | `src/components/SchemaSuggester.tsx:434` (embedded `PendingApprovals`) | same item machine |
| **content_plan_sample** (approval_batch) | `src/api/content.ts:239` (`sendSamples`) | `POST /api/content-plan/:workspaceId/:matrixId/send-samples` → `server/routes/content-plan-review.ts:240` | `createBatch` `content-plan-review.ts:267` (field `content_plan_sample`) → INSERT `approvals.ts:31`; **also `updateMatrixCell({status:'review'})` `content-plan-review.ts:276` (CP-K4 unguarded)** | `server/routes/workspaces.ts:145-146` (B29 collapses review+flagged); `workspace-data.ts` | `src/components/client/ContentPlanTab.tsx:18` (`?tab=reviews` sender `:161`) | content-plan admin send | item machine + `matrix_cell` (NO map) |
| **content_plan_template** (approval_batch) | `src/api/content.ts:263` (`sendTemplateReview`) | `POST /api/content-plan/:workspaceId/:matrixId/send-template-review` → `server/routes/content-plan-review.ts:174` | `createBatch` `content-plan-review.ts:199` (field `content_plan_template`) → INSERT `approvals.ts:31` | same content-plan readers | ContentPlanTab inline cells | content-plan admin | item machine |
| **redirect** (`redirect_proposal`, client_action) | `src/components/RedirectManager.tsx:178` (`sourceType:'redirect_proposal'`); API `src/api/clientActions.ts:17` | `POST /api/client-actions/:workspaceId` → `server/routes/client-actions.ts:49` | `createAdminClientAction()` `server/domains/inbox/client-actions-mutations.ts:45` → `createClientAction` `:58` → INSERT `server/client-actions.ts:28`. **M2: `sourceId` timestamp-keyed `RedirectManager.tsx:179` → must become `redirect:<siteId>`** | `src/lib/decision-adapters.ts:55-68`; `src/components/admin/ClientActionsTab.tsx:135-145` | `src/components/client/DecisionDetailModal.tsx:218` (`RedirectRenderer`), `ClientActionDetailModal.tsx:94` | `src/components/admin/ClientActionsTab.tsx:134` | `CLIENT_ACTION_TRANSITIONS` `state-machines.ts:76` (lacks `declined`) |
| **internal_link** (client_action) | `src/components/InternalLinks.tsx:143` (`sourceType:'internal_link'`) | same `POST /api/client-actions/:workspaceId` `:49` | same `:58` → INSERT `client-actions.ts:28`. **M2: `sourceId` timestamp-keyed `InternalLinks.tsx:144` → `internal_link:<siteId>`** | decision-adapters, ClientActionsTab | `DecisionDetailModal.tsx:160`, `ClientActionDetailModal.tsx:44` | ClientActionsTab | `CLIENT_ACTION_TRANSITIONS` |
| **aeo_change** (client_action) | `src/components/AeoReview.tsx:155` (`sourceType:'aeo_change'`) | same `:49` | same `:58` → INSERT `client-actions.ts:28`. `sourceId` stable `AeoReview.tsx:156` (`aeo:${page.pageUrl}`) — **DO NOT TOUCH** | decision-adapters | `DecisionDetailModal.tsx:120` (`AeoRenderer`), `ClientActionDetailModal.tsx:135` | ClientActionsTab | `CLIENT_ACTION_TRANSITIONS` |
| **content_decay** (client_action) | `src/components/ContentDecay.tsx:96` (`sourceType:'content_decay'`) | same `:49` | same `:58` → INSERT `client-actions.ts:28`. `sourceId` stable `ContentDecay.tsx:97` — **DO NOT TOUCH**. **Async worker writer: `server/playbooks.ts:75` (`status:'completed'`)**. B13: `validateSendable` needs non-empty `targetKeyword` | `server/playbooks.ts:56`; ClientActionsTab `:109,123` | `isSingleAction:true` inline card | ClientActionsTab | `CLIENT_ACTION_TRANSITIONS` |
| **schema_plan** | `src/components/schema/SchemaPlanPanel.tsx:173`; API `src/api/schema.ts:59` | `POST /api/webflow/schema-plan/:siteId/send-to-client` → `server/routes/webflow-schema.ts:696` (**admin guard only, no client-portal — bug to fix not replicate**) | `updateSchemaPlanStatus(...'sent_to_client')` `webflow-schema.ts:707` → `server/schema-store.ts:371` (UNGUARDED) → upsert `schema-store.ts:347` (SQL `:312`). `external_ref`=siteId; `client_preview_batch_id` `:304` → `parent_deliverable_id` | `server/intelligence/content-pipeline-slice.ts:93-100`; `InboxTab.tsx:106-111` | `src/components/client/SchemaReviewModal.tsx:18`, `SchemaReviewTab.tsx:34` | `SchemaPlanPanel.tsx` + embedded `PendingApprovals` (`SchemaSuggester.tsx:434`) | `draft\|sent_to_client\|client_approved\|client_changes_requested\|active` (`schema-plan.ts:246`); **NO map (gap)** |
| **work_order** (`kind:'order'`, net-new) | NONE for create (additive); admin advance UI is a **B14 gap** (route `work-orders.ts:53` unwired) | create via Stripe webhook; advance `PATCH /api/work-orders/:workspaceId/:orderId` → `server/routes/work-orders.ts:53` | `createWorkOrder()` `server/work-orders.ts:93` (INSERT `:39`) at `server/stripe.ts:489,508`; `updateWorkOrder()` `:140` (guard `:150`) at `work-orders.ts:63`. **Idempotent on `payment_id`** | `operational-slice.ts:190-195`; `workspaces.ts:141-142`; `workspace-data.ts:181` | `src/components/client/OrderStatus.tsx:65` (`GET /api/public/work-orders`) | NONE (B14 — net-new admin advance/complete) | `WORK_ORDER_TRANSITIONS` `state-machines.ts:52` (entry `pending`, design wants `ordered`) |
| **briefing** (`kind:'notification'`, one-way) | `src/components/admin/BriefingReviewQueue.tsx:163`; hook `src/hooks/admin/useBriefingDrafts.ts:37` | Admin `POST /api/briefing/:workspaceId/drafts/:draftId/publish` → `server/routes/briefing.ts:123`; Cron `server/briefing-cron.ts:541-560` | `markPublished()` `server/briefing-store.ts:268` → guarded `setStatusScoped` `:255` (`BRIEFING_DRAFT_TRANSITIONS`); INSERT `:90`. **Idempotent on briefing id** | `client-signals-slice.ts:298-307` (`getLatestPublishedBriefing`) | `GET /api/public/briefing/:workspaceId` → `server/routes/public-portal.ts:790` (NOT briefing.ts) | `BriefingReviewQueue.tsx` (mounted `WorkspaceHome.tsx:590`) | `BRIEFING_DRAFT_TRANSITIONS` `state-machines.ts:110` |

### Projected types (source table RETAINED; served via `projectFromSource()`)

| Type | Operator trigger | Artifact route | Status-write call site | Key readers | Client surface | Admin surface | Status enum / machine |
|---|---|---|---|---|---|---|---|
| **brief** (content_request, PROJECTED) | `src/components/ContentBriefs.tsx:264` | `POST /api/content-briefs/:workspaceId/:briefId/send-to-client` → `server/routes/content-briefs.ts:419` | `createContentRequest` `content-briefs.ts:425` (INSERT `content-requests.ts:44`) → `updateContentRequest(...'client_review')` `:440` (UPDATE `content-requests.ts:65`, guard `:189`). **MCP branch: `server/mcp/tools/content-actions.ts:1201` → `:1217`; `ensureBriefRequest()` `:866`** | `admin-chat-context.ts:645-650`; `roi.ts:192-193`; `workspace-data.ts:180` | `src/components/client/ContentTab.tsx:33` | `ContentBriefs.tsx` | `CONTENT_REQUEST_TRANSITIONS` `state-machines.ts:24` (11-state; has `declined`) |
| **post** (content_request, PROJECTED) | `src/components/ContentBriefs.tsx:315` (generic PATCH); API `src/api/content.ts:104` | `PATCH /api/content-requests/:workspaceId/:id` → `server/routes/content-requests.ts:84` | `updateContentRequest(...'post_review')` `content-requests.ts:103` (UPDATE `content-requests.ts:65`, guard `:189`); auto-populates `postId` `:89`. **MCP branch: `content-actions.ts:1253` → `:1269`; `ensurePostRequest()` `:888`** | `ContentManager.tsx:101-128` (post status; **B7 no WS read-back**) | `src/components/client/PostReviewCard.tsx:34` | `ContentManager.tsx` (mounted `App.tsx:435`) | `CONTENT_REQUEST_TRANSITIONS` + `POST_STATUS_TRANSITIONS` `state-machines.ts:41` |
| **copy** (copy_section, PROJECTED) | `src/components/brand/CopyReviewPanel.tsx:492` (hook `:409`); API `src/api/brand-engine.ts:209` | `POST /api/copy/:workspaceId/:blueprintId/:entryId/send-to-client` → `server/routes/copy-pipeline.ts:285` | `updateSectionStatus(...'client_review')` `copy-pipeline.ts:299` → `copy-review.ts:456` → UPDATE `copy-review.ts:116-136`. **B3: NO client email on send.** | `content-pipeline-slice.ts:22-31` (raw SQL, **`version` SUM**); `admin-chat-context.ts:794-795` | `src/components/client/ClientCopyReview.tsx:119` | `CopyReviewPanel.tsx` | **PRIVATE** `VALID_TRANSITIONS` `copy-review.ts:210` + `isValidTransition` `:218` (NOT central machine) |

**Cross-cutting per-type notes:** approval_batch is the "5-types-in-one-table" overload (`approvals.ts:31` single INSERT, discriminated by per-item `field` + `[Review]`/name prefix + classifier minor-9). `content_decay` and `work_order` have async/payment writers (the highest desync risk). MCP `send_to_client` is the only MCP send tool (`content-actions.ts:147` registered, `:1324` dispatched, `:1183` handler) and must delegate to `sendToClient()`.

## Section B — Cross-Cutting Inventories

### B.1 Full WRITER list per table (every dual-write target — each needs a dual-write test)

**`approval_batches` (`server/approvals.ts`; covers seo_edit, audit_issue, schema_item, content_plan_sample/template):**
- Store seam: `createBatch()` `:81` (INSERT `:31`); `updateItem()` `:131` (guard `:144`); `markBatchApplied()` `:177`; `recalcBatchStatus()` `:157` (UNGUARDED derive); `deleteBatch()` `:198`.
- Callers: admin send `server/routes/approvals.ts:116`; public bulk-approve `:238` (loops `updateItem` `:254`); public per-item respond `:288` (`:299`); public `/apply` `:403` (`markBatchApplied` `:466`, B1 destructive); admin delete `:152` (`:169`); content-plan template send `content-plan-review.ts:199`; content-plan sample send `content-plan-review.ts:267` (+ matrix-cell co-mutation `:276`).
- NOT a writer: `server/approval-reminders.ts` (read-only `:47,:52`).

**`client_actions` (`server/client-actions.ts`; redirect, internal_link, aeo_change, content_decay):**
- Store seam: `createClientAction()` `:149` (INSERT `:28`); `updateClientAction()` `:210` (guard `:218`; UPDATE `:77`).
- Callers: admin create `client-actions-mutations.ts:45→:58`; admin update `:88→:100`; public respond `:136→:151`; **content-decay playbook worker `server/playbooks.ts:75` (async, fire-and-forget via `enqueueContentDecayPlaybook:33`)**; feedback loop fired at `:131,:180`.

**`content_topic_requests` (`server/content-requests.ts`; brief+post, PROJECTED):**
- Store: `createContentRequest()` `:117` (INSERT `:43`); `updateContentRequest()` `:180` (guard `:190`; UPDATE `:64`); `addComment()` `:227`; `deleteContentRequest()` `:221`.
- Callers — public `public-content.ts`: create `:295,:336,:565`; update `:354,:375,:403,:432,:671,:706`; comment `:455`. Admin `content-requests.ts`: `:103,:364`; delete `:195`. Brief route `content-briefs.ts:426,:440`. **MCP `content-actions.ts`: create `:867,:889,:988`; update `:682,:824,:880,:902,:1215,:1266`.** **Stripe `applyContentRequestPayment()` `server/stripe.ts:116→:128,:137` (idempotent on `payment_id`).**

**`copy_sections` (`server/copy-review.ts`; copy, PROJECTED):**
- Store: `initializeSections()` `:355`; `saveGeneratedCopy()` `:419` (→draft); `updateSectionStatus()` `:456` (approve side-effects `:483-489`); `addSteeringEntry()` `:494`; `addClientSuggestion()` `:524`; `updateCopyText()` `:565`.
- Callers: admin status `copy-pipeline.ts:238`; admin send `:299`; admin edit `:257`; admin suggestion `:274`; public approve `public-portal.ts:737`; public suggest `:766`; producer `copy-generation.ts:135,:243,:181`. Sibling `copy_metadata` shares store (`upsertMetadata:150`, `saveMetadata:603`).

**`schema_site_plans` (`server/schema-store.ts`; schema_plan):**
- Store: `saveSchemaPlan()` `:347`; `updateSchemaPlanStatus()` `:370` (UNGUARDED); `updateSchemaPlanRoles()` `:417`; `deleteSchemaPlan()` `:383`.
- Callers: producer `schema-plan.ts:159`; admin roles `webflow-schema.ts:689`; admin send `:705`; activate `:733`; public feedback `:883`; delete `:745`.

**`work_orders` (`server/work-orders.ts`; net-new):** `createWorkOrder()` `:93` (INSERT `:39`); `updateWorkOrder()` `:140` (guard `:150`; completion side-effect `:183`). Callers: Stripe `stripe.ts:489,:508`; admin advance `work-orders.ts:63`.

**`briefing_drafts` (`server/briefing-store.ts`; one-way):** `upsertBriefingDraft()` `:178`; `markPublished()` `:268`; `markApproved()` `:272`; `markSkipped()` `:276`; `setBriefingAdminNote()` `:280`. Callers: cron `briefing-cron.ts:221,:497,:545`; admin `briefing.ts:72,:96,:137,:198`.

**ZERO direct-SQL bypass writers** — verified all INSERT/UPDATE/DELETE confined to the store modules. Risk is at the caller layer.

### B.2 READER / CONSUMER list (incl. fields to promote out of JSON)

**Intelligence slices:** `operational-slice.ts:112-133,:190-195` (approval pending count + age, client-action queue, work-order counts); `client-signals-slice.ts:95-128,:298-315` (approvalRate, avgResponseTime, latestBriefing, clientActions); `content-pipeline-slice.ts:22-31` (**raw SQL `SUM(CASE WHEN version=1)` → `firstTryApprovalRate`**), `:93-100` (`getSchemaPlan` keyed siteId), `:222-242` (copy status switch); `page-profile-slice.ts:133-136` (schema *snapshot* — confirm out-of-model boundary).

**Rollup `/api/workspace-overview` (`server/routes/workspaces.ts`):** `:127-131` approvals counts; `:133-138` contentRequests 9-state counts; `:141-142` workOrders; `:145-146` **B29 bug (review+flagged collapsed)**; `:178-180` clientActions. Backing `getContentPipelineSummary` (`workspace-data.ts:180-196`, raw SQL + status-bucket constants + own cache `:183-185,:239`).

**Client counters (D1 — 3 independent, must collapse to ONE `awaiting_client`):** `ClientHeader.tsx:216-220` (`inboxCount`); `OverviewTab.tsx:230-241` (banner `actions[]`); `InboxTab.tsx:118-130,:208-210,:809` (chip counts). Source hooks `useClientQueries.ts:66-102,:231,:262`; `ClientDashboard.tsx:262-275,:595-596`.

**NormalizedDecision adapters:** `decision-adapters.ts:55-68` (`normalizeClientAction`), `:76-89` (`normalizeApprovalBatch`), **`:24-31` `badgeForBatch` (TYPE inferred from batch-NAME prefix)**; `collaboration-artifacts.ts:13-15,:19-22,:35,:52`.

**Admin read-backs:** `PendingApprovals.tsx:33-42` (**filters by name prefix `:42`**, `:96-98` counts, `:62` remind); `ClientActionsTab.tsx:135-145`; `AdminInbox.tsx:16,143` (**misnamed — reads client_signals**); `ContentManager.tsx:101-128,:173`.

**Server AI-context/digest/report/ROI/MCP:** `admin-chat-context.ts:696-710` (**TASK 8 GUARD `:691-694` forbids reduced shape**), `:645-650`, `:794-795`; `monthly-digest.ts:93-100` (`field==='seoTitle'`); `monthly-report.ts:99,:109-110` (**`status==='partial'`**); `roi.ts:192-193`; `llms-txt-generator.ts:480`; `mcp/tools/clients.ts:84-86`, `workspaces.ts:76-90`, `content-actions.ts:316,920,951,985,1210,1261`. Lighter: `workspace-badges.ts:24-28`, `workspace-home.ts:60`, `data-export.ts:58`, `client-intelligence.ts:128,168`.

**Fields to PROMOTE out of JSON to typed columns:** `copy_sections.version` (`content-pipeline-slice.ts:23`); `copy_sections.status`; `client_deliverable_item.status` (counted everywhere); `client_deliverable_item.field` (`monthly-digest.ts:100`); `type` (currently name-sniffed at `decision-adapters.ts:24-31`, `PendingApprovals.tsx:42`); `partial` (`monthly-report.ts:110`); content_request 10-state `status`; client_action `sourceType`→`type`; schema_plan `status` + `external_ref`=siteId.

### B.3 Soft-FK columns BLOCKING teardown (M8 prereqs)
1. `page_edit_states.approval_batch_id` (`005-workspaces.sql:60`) + `content_request_id` `:61` + `work_order_id` `:62` + `recommendation_id` `:63`. **TWO mapper impls in lockstep:** `server/page-edit-states.ts:16-19,:39/:43,:78-81/:112-115,:134-137,:155-158` AND DUPLICATE `server/workspaces.ts:132-135,:241-244,:290/:294,:504-507`.
2. `payments.content_request_id` (`001-payments.sql:10`) — mapper `server/payments.ts:21,:38,:50/:52,:80,:117,:153`.
3. `schema_site_plans.client_preview_batch_id` (`013-schema-site-plan.sql:13` → `parent_deliverable_id` M3) — `schema-store.ts:304,:312/:313,:341,:356,:373/:378`; client-boundary serializer `server/serializers/client-safe.ts:262`.
- Legacy migrator lockstep: `server/db/migrate-json.ts:50/54/87,:1400/:1404/:1468-1471`.
- **Two "zero readers" gate targets (behavior-gating reads):** `server/routes/approvals.ts:163` (`state.approvalBatchId===batchId`); `server/routes/webflow-schema.ts:756-757` (cascade-delete linked batch on `clientPreviewBatchId`).
- **Cascade gap:** `019-cascade-workspace-delete.sql:434-456` does NOT list client_actions/copy_sections/schema_site_plans/payments — the new `client_deliverable`/`_item` cascade must be wired in migration 111/112 itself (019 is not re-run).

### B.4 Dedup producers + which are timestamp-keyed
- redirect `RedirectManager.tsx:179` → `redirects:${snapshotDate||scannedAt||now}` — **TIMESTAMP, MUST CHANGE → `redirect:<siteId>`** (`scannedAt` reassigned `redirect-scanner.ts:213,:399`).
- internal_link `InternalLinks.tsx:144` → `internal-links:${data.analyzedAt}` — **TIMESTAMP, MUST CHANGE → `internal_link:<siteId>`** (`analyzedAt` reassigned `internal-links.ts:179,:284,:431`).
- aeo_change `AeoReview.tsx:156` → `aeo:${page.pageUrl}` — **stable, DO NOT TOUCH** (`shared/types/aeo.ts:39`).
- content_decay `ContentDecay.tsx:97` → `content-decay:${page.page}` — **stable, DO NOT TOUCH** (`server/content-decay.ts:26` URL path).
- `siteId` already in scope at both broken sites (`RedirectManager.tsx:62-69`, `InternalLinks.tsx:43-56`) — no new wiring.
- Server dedup = **read-existing-then-skip** (NOT SQL upsert): `client-actions.ts:151-154` (`getActiveClientActionBySource` `:187-198`, stmt `:50-58`, active = `pending|approved|changes_requested`); domain layer `client-actions-mutations.ts:45-86` (`isDuplicate` early-returns email/activity/broadcast). New model: partial unique index `uq_cd_ws_type_sourceref`; **backfill must normalize legacy `redirects:`/`internal-links:` prefixes to `sourceRef()` form or the index treats legacy + fresh as distinct.** Plan must preserve "return existing active row" semantics, not just INSERT OR IGNORE.
- NOT client_action dedup (anti-confusion): `content-decay.ts:105-118`, `webflow-analysis.ts:256-269` write `tracked_actions` via `recordAction()` — separate keyspace. MCP is read-only for client_actions.

### B.5 Auth guards per route + the param bypass
- Guards: `requireClientPortalAuth` `middleware.ts:188` (passwordless-PERMISSIVE `:204-206`; unknown-ws → `next()` `:191`); `requireAuthenticatedClientPortalAuth` `middleware.ts:216` (DENIES passwordless; unknown-ws → 404 `:220`); `requireClientCopyReviewAuth` `public-portal.ts:650` (module-private); `requireClientStrategyMutationAuth` `public-portal.ts:62` (module-private).
- Response routes the `/respond` subsumes: approvals approve `approvals.ts:238`, per-item `:288`, apply `:403` (all `requireClientPortalAuth`); client-action respond `client-actions.ts:84` (`requireClientPortalAuth`, closest analog, param already `:workspaceId`); copy approve `public-portal.ts:721`/suggest `:751` (`requireClientCopyReviewAuth`); **schema feedback `webflow-schema.ts:874` (`requireClientPortalAuth` on a MUTATION — under-guarded, "fix not replicate")**; content_request decline/approve/request-changes/approve-post `public-content.ts:350,:371,:398,:661` (inherit `router.use:64`).
- **Param bypass (PREVENTIVE, no current `:ws` usage):** if route declares `:ws` but guard reads default `req.params.workspaceId`→undefined→`getWorkspace(undefined)` falsy→`requireClientPortalAuth` silent `next()`. Plan MUST declare `:workspaceId`. Mutating `/respond` MUST use `requireAuthenticatedClientPortalAuth` (fails closed 404).
- Global gate leak: `app.ts:257` (public skips admin gate), `:276` (`if (!ws || !ws.clientPassword) return next()`).

### B.6 The 5 state-machine maps + canonical mapping + missing REQUEST_TRANSITIONS + matrix-cell gap
- Maps (`server/state-machines.ts`): `APPROVAL_ITEM_TRANSITIONS:11`, `CONTENT_REQUEST_TRANSITIONS:24` (11-state, **HAS `declined` `:25-35`**), `POST_STATUS_TRANSITIONS:41`, `WORK_ORDER_TRANSITIONS:52` (**entry `pending`, design wants `ordered`**), `CLIENT_ACTION_TRANSITIONS:76` (**LACKS `declined` — B23**), `BRIEFING_DRAFT_TRANSITIONS:110`. Validator `validateTransition` `:151`; `InvalidTransitionError` `:133`.
- Copy PRIVATE map: `VALID_TRANSITIONS` `copy-review.ts:210` + `isValidTransition` `:218` (non-throwing, NOT central) — violates the law.
- **Canonical mapping (design §4.2):** `awaiting_client` ← {approval `pending`, client_action `pending`, copy `client_review`, schema `sent_to_client`, content_request `client_review`}; `changes_requested` ← {batch `rejected`, ca `changes_requested`, copy `revision_requested`, schema `client_changes_requested`, cr `changes_requested`}; `partial` ← approval batch only (`approvals.ts:164`); `approved` ← {item/batch `approved`, ca `approved`, copy `approved` TERMINAL, schema `client_approved`, cr `approved`}; `applied` ← {item `applied`, ca `completed`, schema `active`, cr `published`/`delivered`}; `declined` NEW (gap in CLIENT_ACTION); order `ordered/in_progress/completed`.
- **Missing `REQUEST_TRANSITIONS`:** grep returns ZERO defs. `RequestStatus` `requests.ts:4` (6 states). Unguarded mutator route `server/routes/requests.ts:188` (re-fires email `:202-207`), store `server/requests.ts:151` — M11 net-new.
- **Matrix-cell guard gap (CP-K4):** `updateMatrixCell` `content-matrices.ts:289` records `statusHistory:305-307` but applies any-to-any, NO `validateTransition`, NO `MATRIX_CELL_TRANSITIONS` map. Flips at `content-plan-review.ts:138-142,:276,:316`, `content-matrices.ts:141`. FM-5 pr-check cannot see it (JSON `cells` column, not `SET status`).
- Unguarded gaps total: batch-level recalc (`approvals.ts:157`), matrix_cell, schema_plan (`schema-store.ts:370`), request (`requests.ts:151`), copy (non-central private).

## Section C — Reusable Infra + Existing PR-Check Coverage

### C.1 Existing reusable infra to BUILD ON (do not re-implement)
- **`validateTransition` + state machines:** `server/state-machines.ts:151-165` (validator) + `InvalidTransitionError:133-144`. Base for `CLIENT_DELIVERABLE_TRANSITIONS` + `REQUEST_TRANSITIONS`. Import sites to touch in lockstep: `approvals.ts:10`, `briefing-store.ts:8`, `client-actions.ts:6`, `content-posts-db.ts:11`, `content-requests.ts:4`, `content-subscriptions.ts:13`, `jobs.ts:9`, `recommendations.ts:62`, `work-orders.ts:4`.
- **`createStmtCache`:** `server/db/stmt-cache.ts:13` — the lazy prepared-statement pattern the new `server/client-deliverables.ts` store MUST use (reference `server/feature-flags.ts:40-50`).
- **`parseJsonSafe` / `parseJsonSafeArray` / `parseJsonFallback`:** `server/db/json-validation.ts:12,:44,:90` — for the discriminated-union `payload`/`item_payload` columns + per-type round-trip assert-no-fallback (the `keywordStrategySchema.pageMap` scar). Reference array pattern: `approvals.ts` `rowToBatch`.
- **`NormalizedDecision` + decision-adapters:** `shared/types/decision.ts:14` (`DecisionSource`), `:16` (interface), `:31` (`isSingleAction`), `:38` (`FlaggedItem`). Only `.source` readers: `src/lib/decision-adapters.ts:55,:76` (+ helpers `:15,:24`). §5 widens `DecisionSource` and replaces `isSingleAction` with `kind`; blast radius confirmed small (`decision-adapters.ts` + `InboxTab.tsx` + `DecisionCard.tsx`).
- **`approval-reminders.ts` (prior art the nudge cron subsumes):** `server/approval-reminders.ts:31-90` (`checkStaleApprovals`, `STALE_DAYS=3:11`, 12h `:12`, throttle `canSend/recordSend:70,80`, dedup via `sent-reminders-db.ts:19-49`, key `approval:${batch.id}:45`); `startApprovalReminders/stop:92-115`. Reuse `server/email-throttle.ts`, `server/email-templates.ts` (`renderApprovalReminder`). New `server/deliverable-nudge-cron.ts` keys on `deliverable:${id}`.
- **`ws-events.ts`:** `server/ws-events.ts:14-136` (`WS_EVENTS` map, `WsEventName:138`, `ADMIN_EVENTS:142-153`). Existing events to route/retire: `APPROVAL_UPDATE/APPROVAL_APPLIED:25-26`, `CLIENT_ACTION_UPDATE:86`, `SCHEMA_PLAN_SENT:63`, `CONTENT_REQUEST_*:33-34`, `COPY_SECTION_UPDATED:104`, `WORK_ORDER_UPDATE:47`, `BRIEFING_GENERATED/PUBLISHED:112-113`, `REQUEST_UPDATE:30`. New `DELIVERABLE_SENT`/`DELIVERABLE_RESPONDED`/`DELIVERABLE_UPDATED` MUST be registered here (never inline literals) + paired `useWorkspaceEvents` handlers.
- **`buildWorkspaceIntelligence` facade:** `server/workspace-intelligence.ts:47` — route handlers call this, not slices directly (Data Flow Rule #6). New deliverable data surfaces via a slice; bridge `bridge-client-signal` owner `inbox` (`feature-flags.ts:610-622`).
- **`email.ts` notify\* helpers:** `server/email.ts:99-414` (21 helpers). Reusable for unified send/response: `notifyApprovalReady:242`, `notifyClientTeamResponse:116`, `notifyClientStatusChange:130`, `notifyTeamActionApproved:144`, `notifyTeamChangesRequested:178`, `notifyClientBriefReady/PostReady/BriefingReady:192,206,225`, `notifyTeamClientSignal:414`. Guard pattern `isEmailConfigured/sendEmail` (`approval-reminders.ts:25-28`).
- **Client inbox UI primitives (CLAUDE.md "UI Primitives — always check before hand-rolling"):** `DecisionDetailModal`, `DecisionCard`, `ApprovalBatchCard`, `PriorityStrip`, `SchemaReviewModal`. **`PriorityStrip.tsx:39` is orphaned (zero `src/` importers)** — the Pillar-2 landing mount target. `applyApplyability` helper `src/components/client/approvalApplyability.ts` (`isClientApplyableBatch`).
- **`StatusBadge` / `statusConfig`:** `src/components/ui/statusConfig.ts:42` (`STATUS_BADGE_REGISTRY`, 12 domains `:4-16`) — Pillar 2/3 render unified status through this, NOT new local color maps (pr-check `status-semantic-mapping-drift`).

### C.2 Existing PR-CHECK rules covering this area (canonical list `docs/rules/automated-rules.md`, count 158; sources in `scripts/pr-check.ts`)
- #135 Public-route client-portal auth `scripts/pr-check.ts:7217` (scans `server/routes/` ONLY; `claudeMdRef:#auth-conventions`; Pass-1 `router.use` detect `:7273-7284`, Pass-2 8-line window `:7287-7305`; recognizes ONLY the two middleware.ts guard names `:7302-7303`; allowlist `:7251-7260`; grandfathered `public-portal.ts`/`reports.ts`/`work-orders.ts` `:7228-7236`).
- #30 (FM-5) Unguarded `SET status=?` `scripts/pr-check.ts:1670` (regex `:1680`, hatch `// status-ok`/`validateTransition`). **TWO blind spots:** JSON-blob status (matrix `cells`, `recalcBatchStatus`); `SET <col>=…, status=@status` ordering (`approvals.ts:41`, `client-actions.ts:78-81`, requests store).
- #129 `send-for-review-anti-pattern` `:7015` (`src/*.tsx`, hatch `send-for-review-anti-pattern-ok`) — design EXTENDS to unified send.
- #126 `inbox-legacy-filter-literal` `:6912` (regex `:6925`); #131 `inbox-action-queue-strip` `:7076`.
- #132 `mcp-action-must-route-through-service` `:7088` (blocks direct `stmts().*.run()` in MCP — confirms MCP must delegate); #133 `mcp-action-must-tag-source` `:7098`; #134 `mcp-action-must-broadcast` `:7147`.
- #45 Public-portal mutation without `addActivity` `:2214` (**self-filters to `public-portal.ts` ONLY — the new `deliverables.ts` is NOT scanned; gap**); #10(warn) addActivity type in `CLIENT_VISIBLE_TYPES` `:3783`; #61 admin route mutation without `addActivity` `:3608`.
- #18(warn) Workspace mutation route missing `broadcastToWorkspace` `:7443` (`deliverables.ts` not excluded `:7446-7461`); #25 unguarded `recordAction()` `:1517`; #112 `status-semantic-mapping-drift` `:6228`.

### C.3 Feature-flag catalog CONSTRAINTS (B5 — per-type dynamic key is INEXPRESSIBLE)
- `FeatureFlagKey = keyof typeof FEATURE_FLAGS` (`shared/types/feature-flags.ts:92`) is a CLOSED union derived from the `const` literal `:12-90`. A runtime `` `unified-deliverables-${type}` `` is `string`, not assignable; silently dropped by `loadDbOverrides` `server/feature-flags.ts:55-62` (`if (row.key in FEATURE_FLAGS)`); never enumerated by env loop `:30-37`. Typed consumers: `isFeatureEnabled(flag:FeatureFlagKey)` `:87`, `useFeatureFlag` `src/hooks/useFeatureFlag.ts:21`, `<FeatureFlag flag>` `src/components/ui/FeatureFlag.tsx:5-6`.
- **Use 3 statically-enumerated phase-group flags** (`unified-deliverables-approval-family` / `-broken-family` / `-rest`) + a DB/env type-string read-routing table.
- Each new flag must populate: `FEATURE_FLAGS` `:12-90`; `FEATURE_FLAG_CATALOG` `:162` (Record over full union — 7 REQUIRED lifecycle fields `:110-118`: owner/createdAt/rolloutTarget/removalCondition/linkedRoadmapItemId/staleAuditCadence/lastReviewedAt); `FEATURE_FLAG_GROUPS` `:732-811`; possibly new `FEATURE_FLAG_GROUP_LABELS` `:120-135`. `assertFeatureFlagGroupingConsistency()` `:825-849` THROWS on orphan/mis-group. `rolloutTarget` ∈ `:96-104`; `linkedRoadmapItemId` must resolve in `data/roadmap.json` or be `legacy-*` `:143-158`. Verifier `npm run verify:feature-flags` (`package.json:46`, `scripts/feature-flag-lifecycle.ts`) hard-fails on invalid dates `:125-139` / broken roadmap link `:148-153`.
- Existing gate for Pillar-2 teardown: `'new-inbox-ia':false` `:86` (catalog `:691-703`, group `:801`); consumed `InboxTab.tsx:168,:328`. `LegacyInboxLayout` deletion gated on 100% rollout.

## Section D — Prevention Additions

### D.1 New PR-CHECK rules the plan must CREATE (design §4.5 / §8 mandate)
1. **`no-direct-insert-outside-service`** — deny direct `INSERT INTO client_deliverable`/`client_deliverable_item` outside `server/client-deliverables.ts` and `sendToClient()`. Models on FM-5 (`scripts/pr-check.ts:1670`) and `mcp-action-must-route-through-service` (`:7088`). Forces MCP `handleSendToClient` (`content-actions.ts:1183`) and all 5 send routes through the service. Hatch `// deliverable-write-ok` for the store itself.
2. **`every-type-has-adapter`** — assert every registered `ClientDeliverable.type` value has a complete adapter (sourceRef + validateSendable + projectFromSource + apply where applyable). Wired with the round-trip test (D.2 #1, minor-1).
3. **Extend `send-for-review-anti-pattern`** (`scripts/pr-check.ts:7015`) to the unified send — every adapter operator surface (SeoEditor, Brief, Copy, Schema, MCP) keeps the single "Send to client" button; SeoAudit "Flag for Client" stays the documented Purple exception.
4. **JSON-blob-status guard** (closes FM-5 blind spot #1) — covers `MATRIX_CELL_TRANSITIONS` and `recalcBatchStatus` (JSON-column status mutations FM-5 cannot see at `content-matrices.ts:66-69`, `approvals.ts:41`).
5. **Extend rule #45** (`Public-portal mutation without addActivity`, `:2214`) — it self-filters to `public-portal.ts` ONLY, so the new `server/routes/deliverables.ts` `/respond` is NOT scanned; either generalize the rule's target or deliberately add `addActivity` (with type in `CLIENT_VISIBLE_TYPES`, `server/activity-log.ts`) and a focused test.
- Authoring: `docs/rules/pr-check-rule-authoring.md`; after adding rules run `npm run rules:generate` (count moves off 158) or CI fails on `automated-rules.md` drift.

### D.2 New TEST CLASSES
1. **Per-type round-trip-no-fallback** — for each registered type: build payload → `upsertDeliverable` → read → assert `parseJsonSafe`/`parseJsonSafeArray` did NOT hit fallback (the `keywordStrategySchema.pageMap` scar). Wired into `every-type-has-adapter`.
2. **Per-type 401 (unauthenticated respond)** — for each type, `PATCH /api/public/deliverables/:workspaceId/:id/respond` without credential → 401 (proves `requireAuthenticatedClientPortalAuth`, closes the schema-feedback under-guard at `webflow-schema.ts:874` and the `:ws` param-bypass).
3. **Dedup-on-resend** — operator resend yields the SAME deliverable (preserves "return existing active row" `client-actions.ts:151-154`, not just INSERT OR IGNORE); covers the redirect/internal_link `sourceRef` prefix change + legacy-prefix backfill normalization. Update fixtures `tests/integration/client-actions-routes.test.ts:62,:111,:164,:382`, `tests/unit/ClientActionDetailModal.test.tsx:10`, `tests/unit/DecisionDetailModal.test.tsx:59`.
4. **Dual-write-per-writer** — one test per CALLER in Section B.1 (the design's "dual-write test per writer"), especially the async/payment writers: playbook worker (`playbooks.ts:75`), Stripe content_request (`stripe.ts:128,:137`) + work_order (`stripe.ts:489,:508`), and the content-plan matrix-cell co-mutation (`content-plan-review.ts:276`).
5. **Backfill-parity** — every legacy row projects to exactly one canonical type/status; assert non-client content_request states preserved (`workspace-data.ts:188-196` 10-state); assert `monthly-report.ts:110` `partial` represented; assert `external_ref`=siteId for schema_plan; assert legacy dedup prefixes normalized so `uq_cd_ws_type_sourceref` dedups.

### D.3 State-machine contract tests to EXTEND
- `tests/contract/state-machine-guard-coverage-contract.test.ts:15-23` must gain rows for `client_deliverable`, `request` (M11), `matrix_cell` (CP-K4), `schema_plan`.
- `tests/unit/state-machines.test.ts:8-15`, `state-machine-pure.test.ts:126-133`, `state-machine-graph-contract.test.ts:22-29` add the new maps; `tests/unit/client-actions-pure.test.ts:50` updates the `CLIENT_ACTION_TRANSITIONS` mock for `declined`.

### D.4 Read-path tests to UPDATE in the same cutover PR (CLAUDE.md "integration tests must cover the actual read path")
`tests/contract/workspace-overview-shape.test.ts`, `tests/integration/workspace-overview-counts.test.ts` (B29 fix), `tests/contract/public-client-read-contracts.test.ts`, `tests/integration/public-client-serialization-matrix.test.ts`, `public-portal-routes*.test.ts`, `public-copy-review-routes.test.ts`, `schema-plan-public-routes.test.ts`, `fixture-public-approvals-routes.test.ts`, `fixture-public-content-routes.test.ts`, `tests/components/client/inbox-components.test.tsx`, `tests/contract/tab-deep-link-wiring.test.ts` (extend to `requestsSubTab` once A2 fixed). Shadow-divergence (`deliverable-divergence.ts`) diffs at the public GET endpoints, NOT the admin GET.

## Section E — Per-Phase File Ownership + Parallelization Strategy

### Phase 0 — SHARED CONTRACTS (SEQUENTIAL, one PR, lands before any type PR)
No parallelism. Establishes the shared seams every Phase-1 type PR depends on:
- `shared/types/feature-flags.ts` — 3 phase-group flags + catalog/groups (per C.3).
- `server/state-machines.ts` — `CLIENT_DELIVERABLE_TRANSITIONS` (+ per-type overrides), `MATRIX_CELL_TRANSITIONS`, `REQUEST_TRANSITIONS`.
- `server/db/migrations/111-client-deliverable.sql` + `112-client-deliverable-item.sql` (cascade wired in-migration; 019 is not re-run).
- `server/client-deliverables.ts` (store: `createStmtCache`, `rowToDeliverable`, `upsertDeliverable`, `parseJsonSafe` payloads) + Zod + adapter registry interface.
- `server/ws-events.ts` (`DELIVERABLE_*`) + `useWorkspaceEvents` handler stubs.
- `server/routes/deliverables.ts` skeleton (`/respond` with `requireAuthenticatedClientPortalAuth`, `/remind`; path param `:workspaceId`; per-route not `router.use`).
- `shared/types/decision.ts` (`kind` replacing `isSingleAction`; widen `DecisionSource`).
- New pr-check rules (D.1) + round-trip/401/contract test scaffolds.

### Phase 1 — PER-TYPE CUTOVER PRs (dual-write → backfill → shadow-compare → flag-flip)

**EXCLUSIVE file ownership per PR (parallel-safe set):**

- **PR-1a approval_batch family (seo_edit/audit_issue/schema_item/content_plan_*)** — OWNS: `server/approvals.ts`, `server/routes/approvals.ts`, `server/routes/content-plan-review.ts`, `server/content-matrices.ts` (CP-K4 guard), `server/approval-reminders.ts` (retire→nudge cron), `server/deliverable-nudge-cron.ts` (new), `src/components/SeoAudit.tsx`, `src/components/audit/AuditIssueRow.tsx`, `src/components/editor/useSeoEditorApprovalWorkflow.ts`, `src/components/cms-editor/useCmsEditorApprovalWorkflow.ts`, `src/components/schema/useSchemaSuggesterPublishingWorkflow.ts`, `src/api/content.ts` (sendSamples/sendTemplateReview).
- **PR-1b client_action family (redirect/internal_link/aeo_change/content_decay)** — OWNS: `server/client-actions.ts`, `server/routes/client-actions.ts`, `server/domains/inbox/client-actions-mutations.ts`, `server/domains/inbox/client-action-feedback-loop.ts`, `server/playbooks.ts` (async worker dual-write), `src/components/RedirectManager.tsx` (sourceRef fix), `src/components/InternalLinks.tsx` (sourceRef fix), `src/components/AeoReview.tsx`, `src/components/ContentDecay.tsx`, `src/api/clientActions.ts`.
- **PR-1c schema_plan** — OWNS: `server/schema-store.ts`, `server/routes/webflow-schema.ts` (incl. the under-guarded feedback `:874`), `server/serializers/client-safe.ts:262` (parent_deliverable_id), `src/components/schema/SchemaPlanPanel.tsx`, `src/api/schema.ts`.
- **PR-1d copy (PROJECTED)** — OWNS: `server/copy-review.ts`, `server/routes/copy-pipeline.ts`, `server/copy-generation.ts`, `src/components/brand/CopyReviewPanel.tsx`, `src/api/brand-engine.ts`.
- **PR-1e brief+post (content_request PROJECTED)** — OWNS: `server/content-requests.ts`, `server/routes/content-requests.ts`, `server/routes/content-briefs.ts`, `server/routes/public-content.ts`, `server/stripe.ts` (content_request payment dual-write), `server/mcp/tools/content-actions.ts` (delegate to sendToClient), `src/components/ContentBriefs.tsx`, `src/components/ContentManager.tsx` (B7 WS read-back), `src/api/content.ts` (shares with 1a — see serialization note).
- **PR-1f work_order (net-new)** — OWNS: `server/work-orders.ts`, `server/routes/work-orders.ts`, `server/stripe.ts` (work_order create — shares stripe.ts with 1e), `src/components/client/OrderStatus.tsx`, net-new admin advance UI.
- **PR-1g briefing (one-way)** — OWNS: `server/briefing-store.ts`, `server/routes/briefing.ts`, `server/briefing-cron.ts`, `src/components/admin/BriefingReviewQueue.tsx`.

**SHARED FILES THAT FORCE SERIALIZATION (explicitly flagged):**
1. `server/state-machines.ts` — touched only in Phase 0; if any type PR needs a tweak, serialize behind Phase 0.
2. `server/client-deliverables.ts` (the deliverable store) — Phase 0 owns; each type PR ADDS an adapter file (`server/deliverables/adapters/<type>.ts`) registered via the registry to avoid editing the store. Adapters are exclusive-per-PR; the registry index file serializes (small append — coordinate or use one PR to add all registrations).
3. `server/routes/workspaces.ts` (workspace-overview rollup) + `server/workspace-data.ts` + the intelligence slices (`operational-slice.ts`, `client-signals-slice.ts`, `content-pipeline-slice.ts`) — read-path; cut over LAST in each type's read-path step. SERIALIZE: do all rollup/slice read-routing in a dedicated read-path PR after all types are dual-writing, OR gate each edit behind the type flag. The B29 fix (`workspaces.ts:145-146`) lands with the content_plan cutover.
4. `src/components/client/InboxTab.tsx` (1043-line monolith) — every client-surface change touches it. SERIALIZE all client-surface edits into Phase 2 (Pillar 2), NOT spread across Phase-1 type PRs.
5. `src/api/content.ts` — shared by PR-1a (sendSamples/sendTemplateReview `:239,:263`) and PR-1e (post PATCH `:104`). Split by function or serialize 1a before 1e.
6. `server/stripe.ts` — shared by PR-1e (content_request payment `:116-141`) and PR-1f (work_order `:489,:508`). Serialize 1f after 1e, or split by handler block.
7. `src/lib/decision-adapters.ts` + `src/lib/collaboration-artifacts.ts` — touched by the NormalizedDecision generalization; do in Phase 2, not per-type.

**Parallel-safe in Phase 1:** PR-1c (schema_plan), PR-1d (copy), PR-1g (briefing) own fully disjoint files and run in PARALLEL. PR-1a and PR-1e SERIALIZE on `src/api/content.ts`. PR-1e and PR-1f SERIALIZE on `server/stripe.ts`. PR-1b is disjoint and parallel-safe. **Design §7 ordering: approval-batch family first (PR-1a), since schema_plan's `parent_deliverable_id` backfill (PR-1c) depends on the migrated batch — so PR-1c serializes AFTER PR-1a's backfill despite disjoint files.**

### Phase 2 — INBOXES (Pillar 2 client + Pillar 3 admin), SEQUENTIAL after all types migrated
- Client: `src/components/client/InboxTab.tsx`, `inbox/InboxTabLayouts.tsx`, `inbox/useInboxTabShell.ts`, `inbox/inbox-filter.ts`, `PriorityStrip.tsx` (mount), the 3 counters (`ClientHeader.tsx`, `OverviewTab.tsx`), `DecisionCard.tsx`/`DecisionDetailModal.tsx`/`ClientActionDetailModal.tsx` (add Decline — B23), `decision-adapters.ts`, `collaboration-artifacts.ts`, `ClientDashboard.tsx`.
- Admin: `src/components/admin/AdminInbox.tsx` (repurpose E1/E2), `ClientActionsTab.tsx`, `PendingApprovals.tsx` (generalize), `NotificationBell.tsx` (E3 client-actions→actions), `useNotifications.ts`, `App.tsx` (A2 `requestsSubTab` reads `useSearchParams`), `WorkspaceOverview.tsx`.
- Gated on `new-inbox-ia` 100% rollout for `LegacyInboxLayout` deletion.

### Phase 3 — TEARDOWN, SEQUENTIAL last
- Soft-FK `deliverable_id` add+backfill+zero-readers gate: `005-workspaces.sql`/`001-payments.sql`/`013-schema-site-plan.sql`, `server/page-edit-states.ts` + DUPLICATE `server/workspaces.ts` (lockstep), `server/payments.ts`, `server/schema-store.ts`, `migrate-json.ts`, type mirrors (`shared/types/workspace.ts`, `payments.ts`, `schema-plan.ts`, `src/hooks/usePageEditStates.ts`, `server/routes/workspaces.ts:555-557`). Retire the 2 behavior-gating readers (`approvals.ts:163`, `webflow-schema.ts:756-757`). Migration 113. Delete `LegacyInboxLayout`.

## Section F — Model Assignments per Task Class

- **Haiku (mechanical, deterministic, low-judgment):**
  - sourceRef literal edits `RedirectManager.tsx:179`, `InternalLinks.tsx:144` (prop already in scope).
  - Feature-flag catalog/groups boilerplate in `shared/types/feature-flags.ts` (7 fields per flag, fixed shape).
  - `ws-events.ts` `DELIVERABLE_*` constant additions + paired `useWorkspaceEvents` handler stubs.
  - Test-fixture literal renames (`tests/integration/client-actions-routes.test.ts`, `tests/unit/*DetailModal.test.tsx`).
  - Soft-FK column-list lockstep edits across the 5 mapper sites once the pattern is fixed (`page-edit-states.ts`, the DUPLICATE `workspaces.ts`, `payments.ts`, `schema-store.ts`, `migrate-json.ts`).
  - `App.tsx:242,245` `requestsSubTab` → `useSearchParams` (A2, well-specified pattern).
  - Reason: bounded, single-correct-answer edits with verified file:line; cheap to run, easy to review.

- **Sonnet (logic, multi-file wiring, state-machine + adapter implementation):**
  - Per-type adapters (sourceRef + validateSendable + projectFromSource + apply), `server/client-deliverables.ts` store, Zod + round-trip-no-fallback.
  - `CLIENT_DELIVERABLE_TRANSITIONS` + per-type overrides + `MATRIX_CELL_TRANSITIONS` + `REQUEST_TRANSITIONS` and their guards.
  - Dual-write seam wiring per writer (incl. async playbook worker, Stripe handlers) + dual-write tests.
  - MCP `handleSendToClient` delegation refactor (`content-actions.ts`) preserving source-tag/broadcast/activity.
  - The new pr-check rules (D.1) following `docs/rules/pr-check-rule-authoring.md`.
  - Migrations 111/112/113 + backfill scripts + shadow-compare (`deliverable-divergence.ts`).
  - Reason: requires cross-file reasoning, contract preservation, and correct state-machine semantics.

- **Opus (judgment, ambiguity, cross-cutting design decisions):**
  - The per-consumer migration decision (read `client_deliverable` directly vs per-type backfilled projection) for each slice/rollup — constrained by the `admin-chat-context.ts` TASK 8 GUARD, the raw-SQL projected readers, and the page-profile-slice snapshot boundary.
  - The canonical 5-vocabulary→status mapping reconciliation (the `WORK_ORDER` `pending`→`ordered`, batch `partial`, `declined`-gap, copy-terminal divergences).
  - Pillar-2 InboxTab counter convergence (3→1 `awaiting_client`) and the NormalizedDecision `kind` generalization design.
  - Phase ordering/parallelization adjudication where shared files (`stripe.ts`, `src/api/content.ts`, the adapter registry index) force serialization vs split.
  - Reason: these are irreversible architecture calls where a wrong choice causes production desync or a reduced-shape regression.

## Section G — CLAUDE.md Grounding Checklist (rule → phase/file it governs)

1. **"Status transitions must use state machines"** (pr-check FM-5 `scripts/pr-check.ts:1670`) — Phase 0: add `CLIENT_DELIVERABLE_TRANSITIONS` (+overrides), `MATRIX_CELL_TRANSITIONS`, `REQUEST_TRANSITIONS` to `server/state-machines.ts`. Governs the 5 unguarded gaps: batch recalc (`approvals.ts:157`), matrix_cell (`content-matrices.ts:289`, CP-K4, PR-1a), schema_plan (`schema-store.ts:370`, PR-1c), request (`requests.ts:151`, M11), copy private map (`copy-review.ts:210`, PR-1d must fold into the copy override). Contract test `state-machine-guard-coverage-contract.test.ts:15-23` gains the 4 new rows.

2. **"DB column + mapper lockstep"** + JSON-column parsing helpers — Phase 0: `111/112` migration + `rowToDeliverable` + `upsertDeliverable` + Zod + `public-portal.ts` serialization ship in ONE commit; `payload`/`item_payload` via `parseJsonSafe`/`parseJsonSafeArray` (`server/db/json-validation.ts`). Phase 3: the `deliverable_id` soft-FK add touches BOTH `page-edit-states.ts` AND the DUPLICATE `workspaces.ts` mapper in lockstep, plus `payments.ts`, `schema-store.ts`, `migrate-json.ts`, and all type mirrors.

3. **Public-route client-portal auth** (pr-check #135 `scripts/pr-check.ts:7217`, `claudeMdRef:#auth-conventions`) — Phase 0: the new `/respond`+`/remind` route MUST live at `server/routes/deliverables.ts` (rule scans `server/routes/` ONLY), declare `:workspaceId` (NOT `:ws`), and surface a literal `requireAuthenticatedClientPortalAuth(` in-signature within the 8-line window (the rule recognizes only the two middleware.ts guard names). Governs the schema-feedback under-guard fix (`webflow-schema.ts:874`, PR-1c). "Never add `requireAuth` to admin routes"; admin `/remind` uses `requireWorkspaceAccess('workspaceId')`.

4. **"Broadcast after mutation" (Data Flow #1) + "useWorkspaceEvents two-halves" (#2)** — Phase 0: register `WS_EVENTS.DELIVERABLE_*` in `server/ws-events.ts` (never inline literals) + paired `useWorkspaceEvents` handlers. Every Phase-1 type PR's dual-write must keep emitting its existing event (`APPROVAL_UPDATE`, `CLIENT_ACTION_UPDATE`, `SCHEMA_PLAN_SENT`, `COPY_SECTION_UPDATED`, `CONTENT_REQUEST_*`, `WORK_ORDER_UPDATE`, `BRIEFING_PUBLISHED`) AND the new `DELIVERABLE_*` or a `useWorkspaceEvents` half goes dead. pr-check #18 enforces broadcast on `deliverables.ts`. B7 (`ContentManager.tsx` no WS read-back) fixed in PR-1e.

5. **"Activity logging" (Data Flow #4) + addActivity-on-public-mutation** — Phase 0/1: `/respond` must call `addActivity()` with a `deliverable_*` type added to `CLIENT_VISIBLE_TYPES` (`server/activity-log.ts`); pr-check #45 self-filters to `public-portal.ts` so `deliverables.ts` is NOT auto-covered — extend the rule (D.1 #5) or add deliberately. MCP delegate preserves `source:'mcp-chat'` (#133) + broadcast (#134).

6. **"Phase-per-PR"** — Phase 0: 3 phase-group flags in `shared/types/feature-flags.ts` BEFORE the first commit, each with all 7 lifecycle fields, valid ISO dates, resolvable `linkedRoadmapItemId`; `assertFeatureFlagGroupingConsistency()` and `verify:feature-flags` gate this. One phase per PR; per-type cutover serialized behind its flag.

7. **feature-flag-lifecycle** (`docs/rules/feature-flag-lifecycle.md`) — `shared/types/feature-flags.ts` is the ONLY source of labels/groups/lifecycle; Pillar 2/3 read flag state via `useFeatureFlag`, never re-declare labels. B5: per-type dynamic key is inexpressible — use static phase groups + DB/env read-routing.

8. **"Admin send convention"** (pr-check `send-for-review-anti-pattern` #129 `:7015`) — every Phase-1 adapter operator surface keeps the single "Send to client" button; extend the rule to the unified send (D.1 #3). SeoAudit "Flag for Client" stays the documented Purple exception (Four Laws law 4).

9. **"Inbox section routing"** (`docs/rules/inbox-section-routing.md`; pr-check `inbox-legacy-filter-literal` #126, `inbox-action-queue-strip` #131) — Phase 2: Decisions/Conversations note-based split via `collaboration-artifacts.ts:13`; `?tab=` must use `InboxFilter` values (`inbox-filter.ts:3`), no legacy literals; mount `PriorityStrip`, never re-add `ActionQueueStrip` to `InboxTab.tsx`.

10. **"`?tab=` deep-link two-halves contract"** (`tests/contract/tab-deep-link-wiring.test.ts`) — Phase 2: A2 fix — `App.tsx:242,245` `requestsSubTab` MUST read `useSearchParams`; sender halves (`OverviewTab.tsx:254,:349`, `ContentPlanTab.tsx:161`) and receiver (`inbox-filter.ts:21`) stay paired; extend the contract test to `requestsSubTab`.

11. **"Route removal checklist"** (`docs/rules/route-removal-checklist.md`) — Phase 3: if any `ClientTab`/`Page` value is removed at teardown, the 7 sites apply (`routes.ts:25-53` aliases, `App.tsx`, `Sidebar.tsx`, `Breadcrumbs.tsx`, `CommandPalette.tsx`, `adminPath`/`clientPath` greps, tests). `LegacyInboxLayout` delete (gated on `new-inbox-ia` 100%) is not itself a Page removal but must grep CLAUDE.md + `docs/rules/*.md` for stale flag/layout refs.

12. **"Wire new data sources into the intelligence engine" (Data Flow #6) + `buildWorkspaceIntelligence` facade** — Phase 1 read-path step / dedicated read-path PR: new deliverable data surfaces via a slice through `workspace-intelligence.ts:47`, not direct slice calls; the `admin-chat-context.ts` TASK 8 GUARD forbids collapsing to the reduced `operational.approvalQueue` shape.

13. **"String literal renames" / "Retiring or renaming a public function"** — any canonical-status rename updates all `statusConfig.ts` domain maps + the two duplicate `MatrixCellStatus` defs (`shared/types/content.ts:344`, `src/components/matrix/types.ts:61`) in one commit; the `approval-reminders.ts`→nudge-cron retirement greps CLAUDE.md + docs for stale refs.

## Section H — Open scope questions (owner sign-off)

A read-only scan cannot make product/coupling decisions. These surfaced from the grep and need an answer; most resolve *during* plan writing, but the three marked **(shapes the plan)** should be settled first.

**Decisions that shape the plan:**
1. **(shapes the plan) Per-consumer read strategy.** For each intelligence slice and the `/api/workspace-overview` rollup: read `client_deliverable` directly, or be fed a per-type backfilled projection? Hard constraints found: `admin-chat-context.ts:691-694` (TASK-8 guard forbids the reduced `operational.approvalQueue` shape); `content-pipeline-slice.ts` + `workspace-data.ts` run raw SQL over the **projected** `copy_sections`/`content_topic_requests` (source tables retained), so `version`/`status` must stay queryable. Needs a per-slice call.
2. **(shapes the plan) Adapter-registry coupling.** Do all per-type adapter registrations land in one Phase-0 PR (simpler, couples types) or does each type PR append its own registration (parallel-safe, but the registry index file collides)? Picks the Phase-1 parallelism model.
3. **(shapes the plan) `new-inbox-ia` rollout %.** The Phase-3 `LegacyInboxLayout` delete (`InboxTab.tsx:618-956`) is gated on this flag reaching 100%. The scan cannot read the live cohort — confirm before scheduling the delete (also sets B5 urgency).

**Decisions resolvable during plan writing (state them explicitly in the plan):**
4. **`work_order` entry-state rename.** `WORK_ORDER_TRANSITIONS` entry is `pending` (`state-machines.ts:52`); design §4.2 wants `ordered`. Absorb `pending→ordered` at projection time, or rename the enum (touches the `work_orders.status` column + tests)?
5. **`redirect_proposal` vs `redirect` naming.** `ClientActionSourceType` uses `'redirect_proposal'` (`shared/types/client-actions.ts:6`); design writes `'redirect'`. Migrate the stored value, or map only at the boundary?
6. **Dedup vs terminal status.** Does a `declined`/`expired` deliverable row block or allow a fresh send under `uq_cd_ws_type_sourceref`? The new `declined` status (B23) changes which statuses count as "active" for supersede-on-resend — the plan must state the rule.
7. **schema_plan send-route guard.** `webflow-schema.ts:696` is guarded only by `requireWorkspaceSiteAccessFromQuery` (site-scope, no client-portal); design treats the *response* under-guard as "fix not replicate" — confirm the unified **send** adopts the standard admin `requireWorkspaceAccess` pattern.
8. **schema snapshot boundary.** `page-profile-slice.ts:133-136` reads schema *snapshots* (`getSchemaSnapshot`), which are **not** the `schema_plan` deliverable — confirm the model boundary excludes snapshots so the schema_plan cutover doesn't over-reach.
9. **B15 stays deferred.** Client-reply visibility on `requests` is deferred-with-owner; confirm it stays out of scope while **M11** (the `REQUEST_TRANSITIONS` guard, B24) is in.

---

## Handoff

Scope is exhaustively verified (118 files, all grep-located). Next: **writing-plans** decomposes the blueprint into the phased plans using this audit as the verified scope — Phase 0 (shared contracts) → Phase 1 (the 7 per-type PRs, with the parallel/serialize map in Section E) → Phase 2 (the two inboxes) → Phase 3 (teardown) — each carrying the model assignments (Section F) and the CLAUDE.md grounding checklist (Section G).
