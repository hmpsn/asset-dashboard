# Client Inbox / Send-to-Client Pipeline Audit — 2026-06-01

**Subject:** the end-to-end OPERATOR → CLIENT send / review / approve pipeline, and the inbox **experience** for both personas (client and admin/operator).
**Type:** read-only diagnosis. No code was changed; this is the only artifact.
**Repo root for all `file:line` citations:** `/Users/joshuahampson/CascadeProjects/asset-dashboard`.

## Method

Multi-agent workflow orchestration (125 agents): 5 parallel discovery agents (operator triggers · backend routes/MCP · client artifacts + status vocabularies · client-facing inbox surfaces · round-trip wiring) → a cartographer that merged them into the per-type map (Section A) → a per-work-type **correctness + consistency** pass → an **adversarial verification** pass where every finding faced a skeptic instructed to refute it from source (default-refuted) → two **experience** agents (client persona, admin persona) anchored to the platform's stated product goals → synthesis → a completeness critic. The critic's coverage gaps were then closed by hand (Weekly Briefing pipeline, voice-calibration scope, prior-audit cross-references, map reconciliations — see §A.4).

**Tally:** 16 work types traced. 100 candidate findings → **94 survived adversarial review, 6 refuted** (the refuted six are listed in §Refuted, not reported as gaps). Pipeline health of the 16 types: **5 working · 7 partial · 2 broken (schema-plan, copy) · 1 group of 9 analyzer surfaces with no send at all · 2 one-way notifications (work orders, weekly briefing)** (briefs #2 and client-requests #13 each carry one residual gap despite a "working" headline).

## The one-paragraph verdict

"Send to client" is not a pipeline — it is **five independent artifact models, each with its own state machine, status vocabulary, notification wiring, and client/admin surface** (`approval_batch`, `content_request`, `client_action`, `copy_section`, `schema_plan` — §A.0), plus two more client↔engine subsystems beside them (`requests` support tickets, `keyword_feedback`). Buttons that look identical fan out into incompatible plumbing. The consequences: one path performs a **destructive, client-triggered live write** (B1); two round-trips are **silent in both directions** (copy, schema-plan — B3/B9); the largest family (redirects/internal-links/AEO/decay) **cannot be pushed back on at all in the rolled-out new inbox** (B5); there is **no single admin surface** that spans the five, and **no `awaiting_client` / `stale` / `overdue` concept exists anywhere in the codebase** (E1/E6); and the client portal contains the right primitives for "one clear thing to do" — an Overview action banner, a `NormalizedDecision` model, a purpose-built `PriorityStrip` — but **`PriorityStrip` is mounted nowhere** and three counters disagree at the surfaces a client sees first (D1/D2). The platform already proves it knows the correct pattern: the **approval-batch family works end-to-end** (real send + client email + two-way surfaces + team email on both outcomes + a Remind button). The whole recommendation set in Section F is "generalize the one mechanism that works to the other four, behind one shared send service."

## Relationship to prior audits (this audit does not re-report them)

- **`docs/audits/2026-05-19-platform-ux-audit.md`** covers the same *Admin→Client Handoff* and *Client Dashboard UX* territory; its P0 handoff items are marked **Fixed**. Where the current report touches those surfaces it reports the **residual**, not the closed item:
  - **P0-1** (copy client suggestions invisible to admin — fixed for the CLIENT-side display inside `BlueprintDetail`) → the residual is **COPY-K3 / B3 / E1**: copy still appears on **no admin status surface** (absent from workspace-overview, the notification bell, and any unified inbox).
  - **P0-7** (inbox exposed raw `sourceType.replace(/_/g,' ')` enum names to clients — fixed) → the residual is **REDIR-K3 / AEO-K2**: a *different* defect — two unshared hard-coded label maps that name the same item differently to client vs operator.
  - **P1-7** (client keyword-decline never reached admin UI — fixed for the Strategy-tab SectionCard) → narrowed by **KWSTRAT-C2**: keyword feedback still reaches no notification bell/email.
- **`docs/audits/2026-05-31-foundational-integrity-audit.md`** (state-consistency / data-model) and **`docs/audits/2026-05-31-intelligence-quality-audit.md`** (recommendation methodology) — their territory is deferred. State-machine-guard findings here (SCHEMA-K1, CP-K4, REQ-C4) are reported **only** where they break the send/review round-trip or notification surfacing, not as generic data-model gaps.

---

## Top 5 Highest-Impact Issues (ranked by client impact)

1. **Client-approved non-meta audit issue silently overwrites the page's live Webflow meta description with recommendation prose** — A client approving a broken-link/H1/alt-text/schema audit item clobbers their real meta description with text like "Add an H1 heading to this page". A destructive live SEO regression executed by the client's own approval, invisible to the operator (round-trip just says "SEO change approved"). Root cause: audit send hardcodes `field` to `seoDescription` for ~44 of 46 check types. `src/components/SeoAudit.tsx:172`, `server/routes/approvals.ts:452-456`, `src/components/client/approvalApplyability.ts:3,14`. (AUDIT-C1/C2/C3) — **critical**

2. **Content-plan sample approval is a dead-end on both halves: approving never advances the matrix cell, and the batch can never be applied** — Client approves their content plan, but the cell stays `review` forever, downstream generation never unlocks, the operator's Content Planner shows "Client Review" indefinitely, and the approved batch can never reach `applied`. The approval is cosmetic. `server/routes/content-plan-review.ts:276`, `server/routes/approvals.ts:414-419`, no `updateMatrixCell` bridge from approval status. (CP-C1/CP-C2) — **critical**

3. **Copy and schema-plan round-trips are silent in BOTH directions; copy/schema status appears on no admin surface, bell, or overview** — Copy send fires no client email (review sits forever) and copy/schema client responses fire no team email + are absent from `/api/workspace-overview`, so the operator only learns of a decision if the buried `CopyReviewPanel` happens to be open. `server/routes/copy-pipeline.ts:285,304`, `server/routes/public-portal.ts:721,751`, `server/routes/webflow-schema.ts:874`, `server/routes/workspaces.ts:185-221`. (COPY-C1/C2, COPY-K3, SCHEMA-C1/C3, E5) — **critical**

4. **The client_action family (redirects, internal links, AEO, content-decay) cannot be pushed back on in the rolled-out new inbox, and changes-requested fires no team email** — In `new-inbox-ia` a client's only options for these four work types are approve-all or "save for later"; there is no reachable request-changes/decline affordance, and even when reachable (legacy), changes_requested sends no operator email and the client is falsely toasted "Feedback sent to your team." `src/lib/decision-adapters.ts:64`, `src/components/client/DecisionDetailModal.tsx:391`, `server/domains/inbox/client-actions-mutations.ts:179`, `src/components/client/InboxTab.tsx:232,987`. (REDIR-C1/C4, ILINK-C1/C2, AEO-C1/C2, DECAY-C1/C3) — **high**

5. **No single admin inbox spans the five send mechanisms; sent-state is fragmented across 3+ surfaces with two families having none, and there is no awaiting/stale/changes-requested axis** — The operator cannot answer "what did clients respond to?" in one place: `AdminInbox` shows only chat signals, `ClientActionsTab` only client_actions, approvals live embedded per-tool, and copy/schema-plan have no admin status surface at all. No time/age/staleness dimension exists anywhere; new-request and client-action notifications mis-route to the default Signals sub-tab. `src/components/admin/AdminInbox.tsx:138-139`, `src/components/admin/ClientActionsTab.tsx:37`, `server/routes/workspaces.ts:120-221`, `src/App.tsx:242,474-476`. (E1/E2/E5/E9, REDIR-C3, REQ-C2, AEO-C5) — **critical (admin)**

## Section A — Operator → Client Pipeline Map (merged)

This map merges five discovery inventories (triggers, backend-routes/MCP, artifacts/state-vocabulary, client-surfaces, round-trip). All `file:line` are repo-relative to `/Users/joshuahampson/CascadeProjects/asset-dashboard`. Where two inventories disagreed I re-read source; reconciliations are flagged inline. **Status** = overall pipeline health for that work type (working / partial / broken / missing).

## A.0 The structural fact that frames everything

There is **no single "send to client" mechanism and no single client artifact**. Operator "Send to client" buttons that look identical fan out into **five independent artifact models with five state machines and five round-trip behaviors**:

| Mechanism | Artifact | Send route | Work types using it |
|---|---|---|---|
| Approval batch | `approval_batch` (`server/approvals.ts:81`) | `POST /api/approvals/:ws` (`approvals.ts:114`) | SEO edits, audit issues, schema items, CMS edits, content-plan samples/template |
| Content request | `content_topic_request` (`content-requests.ts`) | `POST /api/content-briefs/.../send-to-client` (`content-briefs.ts:419`) / MCP | briefs, posts |
| Client action | `client_action` (`client-actions.ts:149`) | generic `POST /api/client-actions/:ws` (`client-actions.ts:49`) | redirects, internal links, content-decay, AEO |
| Copy section | `copy_section` (`copy-pipeline.ts`) | `POST /api/copy/.../send-to-client` (`copy-pipeline.ts:285`) | copy/brand sections |
| Schema plan | `schema_plan` (`schema-store.ts`) | `POST /api/webflow/schema-plan/:siteId/send-to-client` (`webflow-schema.ts:696`) | schema strategy plan |

Consequences proven below: (a) **no admin surface spans all five** (the misnamed `admin/AdminInbox.tsx:138-139` only shows chat-derived ClientSignals; `admin/ClientActionsTab.tsx:37` shows only `client_actions`); (b) **no shared status vocabulary** — grep for `awaiting_client` = 0 hits, `NormalizedDecision` (`shared/types/decision.ts:16`) deliberately omits `.status`; (c) the round-trip notification model is **inconsistent per mechanism** — three of five send paths have broken or silent operator round-trips.

## A.1 Per-work-type pipeline table

| # | Work type | Operator trigger (file:line) | Client artifact + send-side notify | Client surface(s) (file:line) | Round-trip (response -> operator visibility) | Status |
|---|---|---|---|---|---|---|
| 1 | **Posts** | NO real UI send. `ContentManager.tsx:329-339` "Send for review" (label "Review") & `post-editor/ReviewChecklist.tsx:279-290` "Send to Review" both = `updateStatus(post,'review')` internal bump. Real path: MCP `send_to_client` (`mcp/tools/content-actions.ts:1183`) -> `ensurePostRequest:888-909` -> `content_request 'post_review':905` | `content_topic_request 'post_review'` (MCP only). Post-level `'review'` is a disjoint dead-end (`state-machines.ts:41-47`); no `/api/public/*` reads it | `PostReviewCard.tsx:34` inside `ContentTab.tsx:609` (status==='post_review'): inline edit + Approve/Request-Changes | approve `public-content.ts:661` (guards :666) -> `delivered` + `notifyTeamActionApproved:682`; changes `:694` -> `notifyTeamChangesRequested:720`; CONTENT_REQUEST_UPDATE -> notif bell. **No decline** | partial |
| 2 | **Briefs** | `ContentBriefs.tsx:261-273` -> `POST /api/content-briefs/:ws/:id/send-to-client` (`content-briefs.ts:419`); also MCP brief branch (`content-actions.ts:1201-1251`) | `content_topic_request 'client_review'` (`content-briefs.ts:426-443`) + email `notifyClientBriefReady:459` | `ContentTab.tsx:48` (Inbox Reviews / legacy): Approve / Request Changes / **Decline** (`:139-141,594-602`) | approve `public-content.ts:371`->team email :386; changes `:398`->team email :417; **decline `:350` writes 'declined' but NO team email & not in any notif-bell bucket** (`workspaces.ts:134-138`) | working |
| 3 | **SEO edits (title/meta)** | `PageEditRow.tsx:376-386` single + `ApprovalPanel.tsx:28` bulk -> `useSeoEditorApprovalWorkflow.ts:60-127` -> `POST /api/approvals/:ws`; CMS variant `CmsEditorShellPanels.tsx:110-120` | `approval_batch 'pending'` (`approvals.ts:114`); pages->`in-review`; email `notifyApprovalReady:125` | `ApprovalsTab.tsx:26` (legacy IA) **AND** `ApprovalBatchCard.tsx:30` (new-inbox-ia) — duplicate renderers; bulk via `DecisionDetailModal.tsx` | approve `approvals.ts:238/288`->`notifyTeamActionApproved:275,336`; reject->`notifyTeamChangesRequested:357`; apply `:403` writes Webflow; APPROVAL_UPDATE->notif bell | working |
| 4 | **SEO audit issues** | `audit/AuditIssueRow.tsx:163,:306` "Send to Client" -> `SeoAudit.tsx:167-193 flagForClient` -> `POST /api/approvals/:ws` as batch `'[Review] …'` (`SeoAudit.tsx:170-188`) | `approval_batch` (piggybacks SEO model); one synthetic item carrying the recommendation | Same approval surfaces (#3). **`FixRecommendations.tsx` — the purpose-built audit-fix surface (`/api/public/recommendations/:ws`) — is ORPHANED, zero importers**, so the dedicated surface is dark | Same approval-batch round-trip (`approvals.ts:238/288/403`) — fully wired | working |
| 5 | **Schema items (per-page/bulk)** | `schema/BulkPublishPanel.tsx:79-87` + `schema/SchemaPageCard.tsx:434-445` -> `useSchemaSuggesterPublishingWorkflow.ts:55-77,162-187` -> `POST /api/approvals/:ws` (field 'schema') | `approval_batch 'pending'` ("Schema Review") | Same approval surfaces (#3) render JSON-LD diff | Same approval-batch round-trip — fully wired | working |
| 6 | **Schema PLAN (strategy)** | `schema/SchemaPlanPanel.tsx:311-320` -> `POST /api/webflow/schema-plan/:siteId/send-to-client` (`webflow-schema.ts:696`). **Separate mechanism — NO batch** (:704) | `schema_plan 'sent_to_client'` (`webflow-schema.ts:705`, raw `updateSchemaPlanStatus`, **no state-machine guard**); email points to Schema tab not Inbox (:710) | `SchemaReviewModal.tsx:18`->`SchemaReviewTab.tsx:58` + self-card `InboxTab.tsx:266-293`. **No decline.** Snapshot-only branch `SchemaReviewTab.tsx:334` is dead code (early-return :120) | **BROKEN**: `webflow-schema.ts:874` feedback writes status but (1) no team email; (2) no `SCHEMA_PLAN_SENT` handler in `useWsInvalidation.ts`; (3) absent from `/api/workspace-overview` -> never on notif bell; (4) **client note dropped** — `updateSchemaPlanStatus` (`schema-store.ts:370-381`) has no note param; (5) activity type hard-coded `'changes_requested'` even on approve (`:887`) | broken |
| 7 | **Copy / brand sections** | `brand/CopyReviewPanel.tsx:356-358` single + `:492-498` all-drafts -> `useCopyPipeline.ts:104-116` -> `POST /api/copy/:ws/:bp/:entry/send-to-client` (`copy-pipeline.ts:285`) | `copy_section client_review` (`copy-pipeline.ts:299`; private transition map `copy-review.ts:210-216`, NOT central). **NO client email on send** (only path that doesn't) | `ClientCopyReview.tsx:119` (Inbox Reviews / legacy): Approve / Suggest Changes. No decline | **BROKEN/SILENT**: approve `public-portal.ts:721` + suggest `:751` only broadcast COPY_SECTION_UPDATED + internal addActivity. No `notifyTeam*`; copy absent from `/api/workspace-overview` (`workspaces.ts:185-221`); `useWsInvalidation.ts:297-304` OMITS `admin.notifications()`. Operator only sees it if `CopyReviewPanel` (buried in `brand/BlueprintDetail.tsx`) already open | broken |
| 8 | **Redirects** | `RedirectManager.tsx:368-369` -> `:172-201` -> `clientActions.create` (`POST /api/client-actions/:ws`) `sourceType='redirect_proposal'`. **No dedicated route** | `client_action 'pending'` (`client-actions.ts:165`); email `notifyApprovalReady` (`mutations.ts:73`) | `ClientActionDetailModal.tsx:178` (legacy) / `DecisionDetailModal.tsx` (new, flag-then-approve) / `DecisionCard.tsx` | **PARTIAL**: respond `client-actions.ts:84`. approve->`notifyTeamActionApproved`+`enqueuePlaybook` (`mutations.ts:182,191`); **changes_requested fires NO email** (gated `status==='approved'`, `mutations.ts:158-192`); **no decline** (`publicRespondSchema` enum `['approved','changes_requested']`, `client-actions.ts:44`). Notif bell does surface. Admin `ClientActionsTab.tsx` shows changes badge but only Mark-complete (gated to approved, `:109`) — no resend | partial |
| 9 | **Internal links** | `InternalLinks.tsx:213-214` -> `:136-166` -> `clientActions.create` `sourceType='internal_link'`. Scan `webflow-analysis.ts:247` = snapshots only | `client_action 'pending'`; email `notifyApprovalReady` | `ClientActionDetailModal.tsx:178` (table) / `DecisionDetailModal.tsx` / `DecisionCard.tsx` | PARTIAL — identical to #8: changes_requested no email; no decline; notif bell surfaces | partial |
| 10 | **Content decay** | `ContentDecay.tsx:265-273` -> `:92-119` -> `clientActions.create` `sourceType='content_decay'` (also `content-decay.ts:112`) | `client_action 'pending'`; email `notifyApprovalReady` | `DecisionCard.tsx` inline + `InboxTab.tsx:228-239` + `DecisionDetailModal.tsx` | PARTIAL — same client_action round-trip; approve resolved by automated playbook (`ClientActionsTab.tsx:110` distinct badge); changes_requested no email; no decline | partial |
| 11 | **AEO recommendations** | `AeoReview.tsx:409-420` -> `:143-185` -> `clientActions.create` `sourceType='aeo_change'`. `aeo-review.ts` = analysis only | `client_action 'pending'`; email `notifyApprovalReady` | `ClientActionDetailModal.tsx:178` (diff) / `DecisionDetailModal.tsx` / `DecisionCard.tsx` | PARTIAL — same; feedback loop maps `aeo_change->content_refreshed` (`client-action-feedback-loop.ts:18-20`); changes_requested no email; no decline | partial |
| 12 | **Content plan samples/template/cells** | `matrix/MatrixGrid.tsx:265` + `matrix/CellDetailPanel.tsx:311-320` -> `ContentPlanner.tsx:95-104` -> `POST /api/content-plan/:ws/:matrix/send-samples` (`content-plan-review.ts:240`) / `/send-template-review` (`:174`) | `approval_batch` with **SYNTHETIC pageIds** (`content-plan-review.ts:199-211,267-277`, `pageId=matrix.id`); cells->`review` | `InboxTab.tsx:241-256` (Decisions, **flag-only**) **AND** standalone `ContentPlanTab.tsx:18` — same item, two tabs | **PARTIAL**: cell flag `content-plan-review.ts:126` writes `flagged` + CONTENT_UPDATED but **NO team email**. **Synthetic-pageId batches are rejected by the `/apply` Webflow guard** (`approvals.ts:431`) — apply can't complete. Flag-only (no approve) | partial |
| 13 | **Client requests (reverse)** | Client-initiated; not an operator send. `RequestList.tsx:178` bumps existing request to client_review (`content-requests.ts:84`) | `requests` table; **`toClientRequestStatus` (`requests.ts:22-31`) is the ONLY formal admin->client status reducer in the codebase** (reused by nothing else) | `RequestsTab.tsx:22` (Inbox Conversations / legacy): submit + reply threads | Client->operator thread; operator sees in admin requests view | working |
| 14 | **Work orders / fix orders** | `work-orders.ts:53` PATCH -> `notifyClientFixesApplied:87`. NOT a review send | `work_order`; client reads `GET /api/public/fix-orders/:ws` (`:20`), `/work-orders/:ws` (`:103`) — read-only | Read-only fix-order list (no approve/decline component) | None — one-way "fixes applied" notification, no round-trip | partial |
| 15 | **Link checker, page weight, pagespeed, site architecture, keyword strategy/analysis, rank tracker, page intelligence, llms.txt** | **NONE** — `LinkChecker.tsx`, `PageWeight.tsx`, `PageSpeedPanel.tsx`, `SiteArchitecture.tsx`, `KeywordStrategy.tsx`, `KeywordAnalysis.tsx`, `RankTracker.tsx`, `PageIntelligence.tsx`, `LlmsTxtGenerator.tsx` all have ZERO send/approval/clientActions refs | None | None (some strategy read-only in client tabs, no send-for-approval) | None | missing |

## A.2 Narrative — where each pipeline is whole vs broken

**Whole (working):** The **approval-batch family** (SEO edits #3, audit issues #4, schema items #5) is the one fully-wired pipeline: a real send route, a client email, two-way client surfaces (Approve/Reject/Edit/Apply), and a complete round-trip that emails the team on both approve and reject and lights the notification bell via `APPROVAL_UPDATE`. **Briefs #2** are whole on the happy path (approve/request-changes both notify), with one gap: client **decline** writes `'declined'` but produces no team email and maps to no notif-bell bucket (`workspaces.ts:134-138`). **Client requests #13** work for their reverse-direction purpose and uniquely possess the only formal admin->client status reducer.

**Partial:** **Posts #1** have exactly one working path (MCP `send_to_client`); the two UI buttons an operator would intuitively click are silent internal bumps, and the post-level `review` status is disjoint from the client-facing `post_review`. The **client-action family** (redirects #8, internal links #9, content-decay #10, AEO #11) shares one defect set: there is no per-work-type send route (all funnel through generic `POST /api/client-actions/:ws`, and the analysis/scan routes never auto-create actions), **client "request changes" sends no team email** (gated to approved only, `mutations.ts:158-192`), there is **no decline affordance** at all (schema enum is `['approved','changes_requested']`), and the admin `ClientActionsTab` offers no resend/nudge for a changes-requested item. **Content-plan #12** is flag-only (no approve), splits the same item across two tabs, sends no team email on flag, and its synthetic-pageId batches cannot complete the `/apply` path. **Work orders #14** are notification-only, never a true review round-trip.

**Broken:** **Schema plan #6** is the most disconnected round-trip in the system — no team email, no WS invalidation handler, absent from `/api/workspace-overview`, the client's change-request note is silently dropped (no persistence param), and approvals are mislogged as `changes_requested` activity. **Copy #7** is silent in both directions — no client email on send (so review can sit indefinitely) and no team email / no notif-bell / no `admin.notifications()` invalidation on response, so the operator only learns of a client decision if `CopyReviewPanel` (buried in `brand/BlueprintDetail.tsx`) happens to be open.

**Missing:** Nine analyzer surfaces (#15) can surface findings but have no send-to-client trigger at all.

## A.3 Cross-cutting reconciliations & verified live bugs

- **Reconciliation (audit issues):** the `triggers` inventory listed audit issues as a distinct work type; the `routes` inventory folded them into approvals. Re-read `SeoAudit.tsx:167-193` confirms `flagForClient` POSTs to `/api/approvals/:ws` as a synthetic `[Review] …` batch — so audit issues **are** a distinct operator trigger that **reuses** the approval-batch artifact and round-trip. Mapped as its own row (#4), status working, but the dedicated `FixRecommendations.tsx` surface is orphaned.
- **Reconciliation (client-action changes email):** `round-trip` inventory F1 claimed changes_requested fires no team email; verified at `client-actions-mutations.ts:158-192` — `notifyTeamActionApproved` is inside `if (response.status === 'approved')`; the changes_requested branch only does broadcast + addActivity. Confirmed.
- **Verified live bug (status vocabulary):** `server/workspace-data.ts:291` `inReview: seoMap['in_review'] ?? seoMap['dismissed'] ?? 0` — `seo_suggestions` permits only `pending|applied|dismissed` (migration 023), so `seoMap['in_review']` is always undefined and the client's surfaced "pendingApprovals" (`client-intelligence.ts:74`) actually counts **dismissed** suggestions.
- **Verified live bug (status vocabulary):** `server/routes/client-intelligence.ts:60` `inProgressPostStatuses = ['draft','in_review','scheduled']` — real post statuses are `generating|draft|review|approved|error`; `in_review`/`scheduled` match nothing, so posts in `review` are dropped from the client's "in progress" tally.
- **Admin single-pane miss (design judgment, code-anchored to the admin north-star):** no query/type/component spans all five artifact statuses. `admin/AdminInbox.tsx:138-139` shows only chat ClientSignals; `admin/ClientActionsTab.tsx:37` only `client_actions`; copy lives in `CopyReviewPanel` inside `BlueprintDetail.tsx`; schema-plan feedback only in `SchemaPlanPanel`. No `stale`/`overdue`/`awaiting_client` concept exists in any vocabulary.
- **Client fragmentation (design judgment, anchored to NORTH STAR):** new-inbox-ia vs legacy run two parallel renderers for SEO approvals (`ApprovalsTab` vs `ApprovalBatchCard`) and two divergent client_action modals (`ClientActionDetailModal` vs `DecisionDetailModal`); content-plan and schema-plan each appear in 2-3 surfaces; `approvalsForConversations` is counted (`InboxTab.tsx:185,210`) but never rendered (`:534-568`) — an approval batch sent with a note inflates the Conversations chip with no actionable card.

## A.4 Addendum — sixth send pipeline, reconciliations, and confirmed-out-of-scope (added in critic pass)

### A.4.1 Work type #16 — **Weekly Briefing** (one-way operator→client send, analogous to work orders #14)

The cartographer's five-mechanism map omitted a sixth real operator→client send: the **weekly briefing**. It is a *one-way* publish (a "your briefing is ready" notification), not a review round-trip — so it sits alongside work orders #14 rather than the five review mechanisms.

| Stage | Wiring (file:line) |
|---|---|
| Operator trigger | Admin `BriefingReviewQueue.tsx:152` (approve) / publish / skip → routes `server/routes/briefing.ts:91` (approve), `:124` (publish), `:193` (skip), `:231` (generate-now). Cron auto-publish: `server/briefing-cron.ts:549-560`. |
| Client artifact + state | Briefing status via `server/briefing-store.ts:121 setStatus` (guarded by `validateTransition` — note: briefing IS state-machine-guarded, unlike copy/schema-plan). Activity types `briefing_published` / `briefing_auto_published` (`server/activity-log.ts:38,40`, both flagged CLIENT-VISIBLE). |
| Send-side notify | Client email `notifyClientBriefingReady` (`server/email.ts:225`), called from both the manual publish route (`server/routes/briefing.ts`) and the cron (`server/briefing-cron.ts:560`); WS `BRIEFING_PUBLISHED` (`server/ws-events.ts:113`). **This is one of the few send paths that reliably emails the client** — copy (#7) and MCP posts (#1) should match it. |
| Client surface | `src/components/client/Briefing/*` (`InsightsBriefingPage`, `WeeklyOpener`, `ActionQueueStrip`, …) — a read-only "magazine" view. A grep of `Briefing/` for `approve\|respond\|decline\|decision` returns **no client decision affordance**. |
| Round-trip | **None — by design.** Like work orders #14, the briefing is a one-way notification; the client reads it and acts via the chips it embeds, there is nothing to approve/decline. Flagged for completeness, not as a defect. |

**B-add-1 (medium) — the weekly-briefing action chips reproduce the D.10 beta deep-link misroute on a third sender.** `ActionQueueStrip.tsx:156` deep-links each chip to `?tab=${chip.section}`, where the briefs and posts chips use `section: 'reviews'` (`ActionQueueStrip.tsx:112,119`). In beta mode `resolveInboxFilter` rewrites `reviews → decisions` and the Reviews chip/section is suppressed (D.10 / `inbox/inbox-filter.ts:26-34`, `InboxTab.tsx:215,260,494`), so a beta client clicking the briefing's "N briefs / N posts" chip lands on **Decisions**, not the briefs/posts they expected. Same root cause as D.10 and CP-K5, now on the briefing surface. (Code-verifiable.)

### A.4.2 Reconciliation — A.0 "five mechanisms" and A.1 row #15 vs the keyword subsystems

The "five mechanisms" framing (A.0) and the "missing / NONE" status on row #15 count only **operator→client send artifacts**. Two **client↔engine** subsystems sit beside them and are easy to misread from the table alone:
- **Keyword strategy is client-visible the instant it is generated, with NO operator release gate** (KWSTRAT-C1 / C.4). `seoClientView` hides only the paid Strategy tab, not the always-unlocked Overview / Insights / AI-chat consumption. So for keyword strategy/analysis, "missing send pipeline" understates the reality — it is better described as **"client-visible with no operator gate"** (a control gap, see F.1-P6), not "no client surface." Row #15's "missing" verdict is accurate for link-checker / page-weight / pagespeed / site-architecture / rank-tracker / page-intelligence / llms.txt.
- **Keyword feedback is an independent client→engine round-trip** (`keyword_feedback`; KWSTRAT-K1) that feeds the strategy generator but reaches no admin inbox/bell/email (KWSTRAT-C2). It is correctly **not** an inbox item (it never claims to be), so it is out of the send-to-client scope except for its admin-visibility gap.

### A.4.3 Confirmed out of scope

- **`server/routes/voice-calibration.ts`** (brand-voice calibration) has **no `/api/public/*` route and no client-portal consumer** — it is admin-only setup, correctly outside the send-to-client pipeline. (Verified per the critic's flag; the lone "client" reference at `voice-calibration.ts:125` is an HTTP-client comment, not a portal client.)

---

## Section B — Correctness Gaps

Grouped by severity. Each: title — [file:line] — what's broken/missing — client impact — rank.

### CRITICAL

**B1. Client approval of a mislabeled audit issue overwrites the live meta description**
[`src/components/SeoAudit.tsx:172`, `server/routes/approvals.ts:414-419,452-456`, `src/components/client/approvalApplyability.ts:3,14`]
`flagForClient` forces `field:'seoDescription'` for ~44 of 46 audit check types (H1, broken-links, schema, alt-text, og-tags, etc.). The client-side and server-side apply guards both accept `seoDescription`, so on approve+apply the apply handler writes the recommendation prose (`item.proposedValue`, e.g. "Add an H1 heading to this page") into the page's real Webflow meta description.
Client impact: a destructive, live SEO regression triggered by the client's own approval; the operator's round-trip just says "SEO change approved" and cannot easily detect it. The client also cannot tell what they are reviewing (mislabeled "Meta Description" body is unrelated prose). Rank: **#1** (merges AUDIT-C1, AUDIT-C2, AUDIT-C3).

**B2. Content-plan sample approval never advances the matrix cell and the batch can never be applied (dead-end both ways)**
[`server/routes/content-plan-review.ts:276`, `server/routes/approvals.ts:414-419`, `server/approvals.ts:131,157`, `src/components/client/approvalApplyability.ts:17`]
`send-samples` sets the cell to `review` AND creates an approval batch, but no code bridges approval-item status back to the matrix cell (`updateMatrixCell` is never called from any approval handler). The batch's `content_plan_sample` items are rejected by both the client `isClientApplyableBatch` gate and the server `/apply` guard, so the batch can never reach `applied` either.
Client impact: the client signs off and nothing moves; the operator's Content Planner shows the cell stuck at "Client Review" forever; downstream brief/post generation never unlocks. Rank: **#2** (merges CP-C1, CP-C2).

**B3. Copy review round-trip is silent in both directions**
[`server/routes/copy-pipeline.ts:285,304-306`, `server/routes/public-portal.ts:721,742,751,774`, `src/hooks/useWsInvalidation.ts:297`]
Copy send fires no client email (only intelligence-cache invalidation + WS broadcast), so a review can sit in `client_review` indefinitely. On the client's approve/suggest, no team email is sent, the `COPY_SECTION_UPDATED` handler omits `admin.notifications()`, and copy status is absent from `/api/workspace-overview` — so the operator only learns of a decision if the buried `CopyReviewPanel` inside `brand/BlueprintDetail.tsx` is already open.
Client impact: the agency↔client copy loop stalls invisibly to both sides; a client suggestion can sit unseen indefinitely. Rank: **#3** (merges COPY-C1, COPY-C2).

### HIGH

**B4. Client request-changes on ANY client_action (redirect / internal-link / AEO / content-decay) fires no team email**
[`server/domains/inbox/client-actions-mutations.ts:158-170,179-192`]
`notifyTeamActionApproved` is gated inside `if (response.status === 'approved')`; the `changes_requested` branch only writes activity + broadcasts. `notifyTeamChangesRequested` (which briefs and approvals both use) is never imported. The client UI also falsely toasts "Feedback sent to your team." (`InboxTab.tsx:232`).
Client impact: the client writes substantive feedback and is told it was sent, but no operator is notified; the request surfaces only if the operator happens to open `ClientActionsTab`. Rank: **#4** (single root cause; merges REDIR-C4, ILINK-C2, AEO-C1, DECAY-C1).

**B5. New-inbox-ia removes the request-changes/decline path for redirect / internal-link / AEO actions**
[`src/lib/decision-adapters.ts:64`, `src/components/client/DecisionDetailModal.tsx:391-406`, `src/components/client/InboxTab.tsx:353-358,987`]
Only `content_decay` is `isSingleAction`; the other three route to `DecisionDetailModal`, whose only footer actions are "Looks good — implement N" (always submits `'approved'`) and "Save for later". The renderers (`RedirectRenderer`/`InternalLinkRenderer`/`AeoRenderer`) carry no flag controls. The legacy `ClientActionDetailModal` with "Request changes" is unreachable when the flag (in active tiered rollout) is on.
Client impact: a client who disagrees with a proposed redirect/link/AEO set can only approve everything or defer; the operator can never receive a pushback signal. Rank: **#5** (merges REDIR-C1, ILINK-C1, AEO-C2; REDIR-C2/ILINK-K3 cosmetic "N of M" over-promise is a sub-symptom).

**B6. MCP `send_to_client` sends NO client notification for posts — the only working post→client path is silent**
[`server/mcp/tools/content-actions.ts:1253,1284`, `server/email.ts:206`, `server/routes/content-requests.ts:124`]
The MCP post branch creates the `post_review` request and logs activity but never emails the client; the file imports zero email helpers. `notifyClientPostReady` is called only by the PATCH route, which the MCP path never hits. No stale-content-request nudge cron exists.
Client impact: an operator who sends a post via chat/MCP (the documented working path) produces no client email; the post surfaces only if the client logs in and opens Inbox > Reviews. Rank: high (POST-C1).

**B7. Client post approve/request-changes never syncs `GeneratedPost.status`; ContentManager shows no signal**
[`server/routes/public-content.ts:661,694`, `src/components/ContentManager.tsx:341,73`]
Approve/request-changes mutate only the `content_request`; the post stays at whatever status it had when sent. `ContentManager` (the primary posts board) has zero content_request awareness and no WS subscription, so it still shows the post in `review` with an Approve button after the client responded.
Client impact: operator-facing — a teammate on the Content board sees no signal the client responded and can mistakenly re-bump/approve, diverging the two records. Rank: high (POST-C3).

**B8. SeoAudit "Flag for Client" always 400s — every audit-issue send silently fails**
[`src/components/SeoAudit.tsx:175,185,191`, `server/routes/approvals.ts:94,104`]
The item payload includes a `reason` key; the createBatch item schema is `.strict()`, so Zod rejects it (HTTP 400). The catch only `console.error`s — no toast, success state never reached.
Client impact: the operator believes the audit finding was sent for review; it never reaches the client and there is no error. (Note: this is the send-time gate; B1 is what happens for the issues that DO get through via other framing — both stem from the same bespoke audit payload.) Rank: high (SEO-C1; see also SEO-K3).

**B9. Schema-plan client feedback fires no team email and is absent from the notification bell/overview**
[`server/routes/webflow-schema.ts:874,887,888`, `server/routes/workspaces.ts:185`, `src/hooks/admin/useNotifications.ts:20-30`]
The public feedback handler updates status, writes one activity row, broadcasts `SCHEMA_PLAN_SENT`, but never calls `notifyTeam*`. Schema-plan status has no bucket in `/api/workspace-overview`, so it never produces a bell item. The admin `SchemaPlanPanel` uses local `useState` with no WS subscription, so it shows stale status until reload.
Client impact: when the client approves or requests changes on their schema strategy, no one is notified out-of-app; the decision sits silently. Rank: high (merges SCHEMA-C1, SCHEMA-C3; SCHEMA-C2 admin-panel staleness is the same root surface).

**B10. Schema-plan UI dead-ends on `client_changes_requested`: no resend button, client note never persisted**
[`src/components/schema/SchemaPlanPanel.tsx:309,323`, `server/schema-store.ts:370-381`]
The panel renders "Send to client" only for `draft` and "Activate" only for `draft`/`client_approved`; there is no control for `client_changes_requested` and no client-note display (note is written only to the activity log, never onto the plan). The server-side re-send route is unguarded, so this is a pure UI omission.
Client impact: a changes-requested schema strategy is stuck; the operator cannot edit-and-resend through the UI, so the review loop cannot complete a second iteration. Rank: high (SCHEMA-C4).

**B11. Schema approval items show "will be applied when you push changes live" but no Apply control ever renders**
[`src/components/client/ApprovalBatchCard.tsx:396,453`, `src/components/client/ApprovalsTab.tsx:494,561`, `src/components/client/approvalApplyability.ts:11`]
Schema items are sent with `field:'schema'`, which `isClientApplyableBatch` rejects, so the promised "push changes live" button never appears; schema is actually published server-side by the operator, independent of the client's approval. The fully-approved schema batch is also permanently mis-counted under "Ready to Apply" with no path to "Applied".
Client impact: the client approves, is told the next step exists, but no apply control appears — a named-but-missing next step; the inbox counter shows a permanent false backlog. Rank: high (merges SCHEMA-C1[apply], SCHEMA-C2).

**B12. Content-plan: two of three review tiers (template-review, batch-approve) have no production UI caller**
[`src/api/content.ts:262,268`, `server/routes/content-plan-review.ts:174,306`, `src/components/ContentPipelineGuide.tsx:39`]
The product advertises three tiers; only "send samples" is wired. `sendTemplateReview` and `batchApprove` have zero component callers, so the template-review tier and "batch-approve remaining" are dark — and the `content_plan_template` artifact can never be produced.
Client impact: the tiered content-plan review the platform describes cannot actually be run; the client never receives a template-structure review. Rank: high (CP-C4).

**B13. Approved content-decay action generates a brief targeting a garbage keyword**
[`server/playbooks.ts:33-41,56-72`, `src/components/ContentDecay.tsx:96-112`, `server/helpers.ts:236-244`]
The decay send payload never sets `targetKeyword`, and the fallback regex `^Refresh:\s*` does not match the no-colon title "Refresh recommendation for /blog/foo", so `generateBrief` runs with a sentence/URL as the keyword. The action auto-completes, masking the failure.
Client impact: the admin badge and client toast both promise an automatic brief, but it targets nonsense; the operator believes a real refresh brief was created. Rank: high (DECAY-C2).

**B14. Fix-order (work-order) pipeline has no client status view and no operator advance/complete UI**
[`src/components/client/OrderStatus.tsx:63,67`, `server/routes/work-orders.ts:20,53,103`, `src/api/misc.ts:207`, `src/components/WorkspaceSettings.tsx:81`]
The only client renderer (`OrderStatus.tsx`) and the `/api/public/fix-orders` route have zero production consumers. On the admin side, the API client exposes only `list()` (no update), no component calls the PATCH route, and both admin nudges deep-link to `workspace-settings`, which has no work-order control. So completion side-effects (page→live, "Fixes Applied" email, rec-resolve) are unreachable from any screen.
Client impact: a client who PAID for a fix/schema product has no in-app surface for the order, and pages purchased to go live never flip / the completion email never fires unless someone hits the API by hand. Rank: high (merges WO-C1, WO-C2; WO-C3/WO-K1 reinforce — no creation broadcast/email, no round-trip).

**B15. Client reply to an open request produces no admin push signal**
[`server/requests.ts:214`, `server/routes/public-requests.ts:109`, `server/routes/workspaces.ts:122`, `src/hooks/admin/useNotifications.ts:99`]
`addNote(author='client')` never mutates `request.status`; the overview/bell are status-derived only, so a reply on an `in_progress` request bumps no counter and lights no bell. There is no "unread client note" concept server-side; the only push is an email that early-returns when email isn't configured.
Client impact: a client who replies to clarify/escalate is silently dropped unless the operator is watching their inbox; the thread stalls. Rank: high (REQ-C1).

**B16. Admin RequestManager has no live-refresh, and the one WS handler invalidates a different request system**
[`src/components/RequestManager.tsx:105,111`, `src/hooks/useWsInvalidation.ts:38`, `server/routes/public-requests.ts:87`]
`RequestManager` loads via imperative `getSafe` into local state with no WS subscription/refetch. The `REQUEST_CREATED/UPDATE` handler invalidates `admin.requests`, whose only React Query consumer is the unrelated content-topic-request (brief) list. A request submitted/replied while the operator has the list open does not appear until manual reload.
Client impact: operator-facing — an operator actively triaging will not see new requests/replies in the list they are looking at. Rank: high (REQ-C3; see also REQ-K1 cache-key collision).

**B17. AEO/internal-link re-send after a change request silently returns the stale action**
[`src/components/AeoReview.tsx:155`, `src/components/InternalLinks.tsx:144`, `server/client-actions.ts:50-58,151-154`]
Dedup keys on `sourceId` against statuses including `changes_requested` and returns the existing row with HTTP 200; AeoReview marks the page "Sent". The revised payload is dropped, no re-notify fires. (Recoverable only via the admin PATCH route elsewhere, which has no UI — see B18.)
Client impact: the operator believes they re-sent revised recommendations; the client still sees the original stale diffs. Rank: medium (AEO-C3; REDIR-K2/REDIR-K4 are the same timestamp-sourceId duplicate/one-shot-button family).

**B18. Admin ClientActionsTab renders no control for a changes_requested / stale-pending action**
[`src/components/admin/ClientActionsTab.tsx:109-127,44-50`]
The only action button ("Mark complete") is gated to `status==='approved'`. A `changes_requested` action shows only an orange badge + note — no resend, revise, reopen, or acknowledge — despite the state machine allowing `changes_requested → pending/completed/archived` and the admin PATCH route supporting it.
Client impact: the operator sees the change request but cannot act on it from the only surface it routes to — a visible dead-end. Rank: high (merges AEO-C5, DECAY-C4; same surface as E7).

### MEDIUM

**B19. MCP `send_to_client` has no post-readiness guard** [`server/mcp/tools/content-actions.ts:1257`, `shared/types/mcp-action-schemas.ts:345`] — can ship a generating/draft/error/empty post for live client approval; the two other paths both guard. Client sees an unfinished post with live Approve/Request-Changes. (POST-C2)

**B20. No decline affordance on posts** [`src/components/client/PostReviewCard.tsx:453`, `server/state-machines.ts:32`, `src/components/client/ContentTab.tsx:600`] — the `post_review→declined` transition and `/decline` route are fully wired and briefs in the same tab get a Decline button, but PostReviewCard offers only Approve/Request-Changes. A client who fundamentally rejects a post has no exit. (POST-C4; broader decline inconsistency in C below)

**B21. Static-page SEO editor has no note field** [`src/components/editor/useSeoEditorApprovalWorkflow.ts:70,109`, `src/components/editor/PageEditRow.tsx:37`] — the most common SEO send structurally cannot carry a batch note, so it can never route to Conversations (CMS editor can). (SEO-C2)

**B22. Internal-links "Send to Client" ships only the active filter/search subset** [`src/components/InternalLinks.tsx:137,141,151,213`] — the dashboard counts/Send-button reflect the full set; if a priority filter or search is active, only that slice is delivered with no warning. Operator silently under-sends. (ILINK-C4)

**B23. No client-driven decline for any client_action** [`server/routes/client-actions.ts:44`, `shared/types/client-actions.ts:9`] — the respond enum is `['approved','changes_requested']` with no terminal `declined`; redirects/AEO/decay/internal-links disagreed-with by the client sit pending indefinitely, indistinguishable from "unseen". (REDIR-C5, DECAY-C3, AEO-C4 — single root cause)

**B24. Request status transitions have no state-machine guard** [`server/routes/requests.ts:188`, `server/requests.ts:151`, `server/state-machines.ts:24`] — any-to-any status mutation allowed (e.g. closed→new re-fires the client status email); the FM-5 pr-check rule misses it because `status` is not the first SET column. (REQ-C4)

**B25. Schema-plan approve activity is hard-coded to `'changes_requested'`** [`server/routes/webflow-schema.ts:882,887`] — on approve the row's machine type is wrong (title is correct). Latent data-hygiene defect for future analytics/export; no live consumer mis-tallies it today. (SCHEMA-C6)

**B26. Per-cell content-plan "Send to client" gates on `briefId` but delivers only keyword metadata, and panel vs grid disagree on eligibility** [`src/components/matrix/CellDetailPanel.tsx:311`, `src/components/matrix/MatrixGrid.tsx:381`, `server/routes/content-plan-review.ts:259`] — the briefId gate is meaningless to the delivered artifact, and a briefless cell is sendable via the grid but not the panel. (CP-C5)

**B27. AEO per-diff rationale dropped on the default inbox path** [`src/components/client/ClientActionDetailModal.tsx:135-174`, `src/components/AeoReview.tsx:172`] — legacy (default) `AeoChangeRenderer` omits `diff.rationale` that the new-IA renderer shows and AeoReview always sends; clients on the default layout never see the "why". (AEO-K1)

**B28. Schema bulk send maps every page unfiltered** [`src/components/schema/useSchemaSuggesterPublishingWorkflow.ts:55,59,66`] — sends empty `{}` and synthetic `cms-` schema items as review artifacts, padding the batch with non-actionable items. (SCHEMA-C3 [bulk])

**B29. Admin overview collapses content-plan `review` (awaiting client) + `flagged` (changes requested) into one count, and content-plan batches inflate the generic SEO-approvals tally** [`server/routes/workspaces.ts:146,213,128-130`] — operator cannot distinguish awaiting-client from changes-requested cells, and content-plan sign-offs are double-counted/mislabeled as SEO. (CP-C6; CP-K3 mislabels the approval email as "SEO batch approved")

### LOW (correctness-adjacent)

**B30. Content-plan flag fires no team email** [`server/routes/content-plan-review.ts:126,153`] — the bell still lights via the 5-min poll + WorkspaceHome `review`/`flagged` count, so the "never seen for days" framing is overstated, but the missing email is a real gap. (CP-C3, partial)

**B31. Brief decline sends no team email** [`server/routes/public-content.ts:350`] — approve and request-changes both notify the team; decline (a peer button on the same surface) writes activity only. Combined with B-consistency gap C-vocab below, a declined brief leaves no proactive operator signal. (BRIEF-C3)

## Section C — Consistency Gaps

### C.1 The framing fact: five send mechanisms, five state machines, five round-trips

There is no single "send to client" service or artifact. Operator buttons that look identical fan out into five independent models — `approval_batch`, `content_request`, `client_action`, `copy_section`, `schema_plan` — each with its own send route, status vocabulary, notification wiring, and client/admin surface (Section A.0). A sixth, client-initiated `requests` table (support tickets) shares the word "requests" but nothing else, and `keyword_feedback` is a seventh independent client→engine signal subsystem (REQ-K3, KWSTRAT-K1). Every consistency gap below is a symptom of this fan-out; the recommendations in F.1 attack the root.

### C.2 Status-vocabulary siloing (concrete enum mismatches)

No shared status vocabulary exists; `grep awaiting_client` = 0 hits, and `NormalizedDecision` deliberately omits `.status` (`shared/types/decision.ts`). The five families literally use different words for the same concepts:

| Concept | approval_batch | content_request | client_action | copy_section | schema_plan |
|---|---|---|---|---|---|
| awaiting client | `pending` | `client_review` | `pending` | `client_review` | `sent_to_client` |
| changes requested | `rejected` | `changes_requested` | `changes_requested` | **`revision_requested`** | `client_changes_requested` |
| approved | `approved` | `approved`/`delivered` | `approved` | `approved` | `client_approved` |
| declined | (item `rejected`) | `declined` | **(none)** | (none) | (none) |

Concrete divergences proven in code:
- **Copy alone uses `revision_requested`** for the changes-requested concept (`server/copy-review.ts:210`, `server/schemas/copy-pipeline.ts:37`) vs platform-wide `changes_requested`; and labels the shared `client_review` literal "In Review" vs the registry's "Needs Your Review" (`src/lib/copyStatusConfig.ts:15`, `src/components/ui/statusConfig.ts:55`). (COPY-K2)
- **Schema-plan is a fifth bespoke enum** (`sent_to_client|client_approved|client_changes_requested|active`) with no centralized `validateTransition` guard; send and activate routes carry zero status preconditions, so a draft can jump straight to `active` (`shared/types/schema-plan.ts:246`, `server/schema-store.ts:370`, `server/state-machines.ts:151`). (SCHEMA-K1)
- **Matrix cell status bypasses the state-machine guard** entirely (no transition map; `updateMatrixCell` writes `status` freely), while the approval_item half of the very same content-plan pipeline IS guarded — one work type, two artifacts, one guarded and one free-form. (CP-K4)
- **`client_action` has no `declined` member** in its enum or state machine (`server/state-machines.ts:76`), so redirects/internal-links/AEO/decay cannot be declined, while briefs (content_request) can. (REDIR-C5/DECAY-C3/AEO-C4)
- **`requests` (support tickets) has no transition map** at all (REQ-C4), making it the third status-bearing entity outside the central guard alongside copy and schema-plan.

Admin rollup consequence: `/api/workspaces` content-request summary omits a `declined` bucket and collapses `client_review` (awaiting client) into the generic `inProgress` count (`server/routes/workspaces.ts:134,137,204`); the approval family by contrast surfaces a distinct `pending` count (BRIEF-C2). Content-plan `review`+`flagged` are collapsed into one number (CP-C6). The net effect: no admin surface can group "changes requested" across families because the literal differs five ways, and "awaiting client / stale / overdue" is uncomputable (E2, E9).

### C.3 Label divergence

- **Send-button casing is split ~50/50 platform-wide**: capital-C "Send to Client" on ~7+ surfaces (RedirectManager, ContentDecay, InternalLinks, AuditIssueRow, BriefDetail, schema BulkPublishPanel, editor ApprovalPanel) vs canonical lowercase "Send to client" on AEO, CMS, schema-plan/SchemaPageCard, matrix, PageEditRow — and even within one work type (schema: `BulkPublishPanel.tsx:87` capital vs `SchemaPlanPanel.tsx:320` lowercase). `ui-vocabulary.md` itself prescribes BOTH (capital at line 15, lowercase at line 78). No shared label constant; the only pr-check rule blocks just the two retired phrases "Send for Review"/"Flag for Client" and does not normalize casing (`scripts/pr-check.ts:7016`). (SEO-K2, DECAY-K2 — single root cause; this is why the post-button refuted finding POST-K2 and audit-label refuted finding AUDIT-K2 are NOT separate gaps — the doc contradicts itself and capital-C is the dominant form.)
- **Cross-persona source-type labels diverge** from two unshared hard-coded maps: redirect = "Redirects" (client) vs "Redirect Proposal" (admin); AEO = "AEO" (client) vs "AEO Change" (admin) (`src/lib/decision-adapters.ts:10`, `src/components/admin/ClientActionsTab.tsx:30`). Operator and client name the same item differently. (REDIR-K3, AEO-K2)
- **CTA over-promises for manual work types**: the DecisionDetailModal CTA "Looks good — implement N →" is identical for `approval_batch` (team really applies to Webflow) and all client_action types (internal_link/aeo/redirect enqueue no automated playbook — `server/playbooks.ts:26` — they land in a manual admin queue). (ILINK-K3)
- **Copy panel intra-panel inconsistency**: "Send for Client Review" (`CopyReviewPanel.tsx:500`) vs "Send to Client Review" (`:358`). Cosmetic. (COPY-K4, low)
- **"Request Changes" verb is overloaded four ways** across surfaces (flag/hold vs freeform note vs suggest-edit vs full revision); on the post card, pressing it with no note only expands a textbox — reads as a broken button. (Client observation D7)

### C.4 Structural fragmentation / duplicate implementations

- **Two maintained approval-batch renderers** (`ApprovalsTab` legacy vs `ApprovalBatchCard` new-inbox-ia) reimplement all approve/edit/reject/apply/approve-all logic and have already diverged (partial-failure toast present in one, absent in the other). `DecisionDetailModal`'s `approval_batch` branch is unreachable dead code. (SEO-K1)
- **Two divergent client_action modals** (`DecisionDetailModal` new-IA vs `ClientActionDetailModal` legacy) for the identical artifact, gated on a feature flag the client doesn't control, with DIFFERENT response vocabularies — the new one cannot emit `changes_requested` for non-content_decay types. This is a cohort-dependent decision-contract change, not just visual drift. (REDIR-K1, ILINK-K1, AEO-K1, DECAY-K1)
- **Audit-issue send is a bespoke "Flag for Client" flow** that reuses the approval-batch transport/round-trip but hand-rolls its item payload inline (bypassing the typed `seoEditorDerived` builder), uses divergent note semantics (note folded into `proposedValue`, not the batch note), a non-canonical "[Review]…" batch name, and the unsupported `reason` field — the root of B1/B8. (SEO-K3, AUDIT-K1)
- **Three divergent operator paths to `post_review`** (UI/HTTP guards+emails, MCP guards-neither-nor-emails, ContentManager never-reaches-client) with no shared send service; the three also produce three different activity-log behaviors (`brief_generated` / none / `brief_sent_for_review`). (POST-K1, BRIEF-C1)
- **Copy bypasses the central `validateTransition`** (own `VALID_TRANSITIONS` map) and the shared email layer, though it does share the inbox Reviews surface. (COPY-K1)
- **Content-plan review has no shared renderer** across its three surfaces (hand-rolled inbox flag card duplicated verbatim between both layouts, `MatrixProgressView`, admin `MatrixGrid`); the Content-Plan tab deep-links "needs review" to `?tab=reviews` while the cells actually render in Decisions — sending the client to the wrong, empty section. (CP-K5)
- **One content-plan sample produces TWO contradictory client cards** — an approvable batch card (Approve) and a flag-only "Content Plan" card (Request Changes) — never reconciled; approving one leaves the other showing "Needs Review". (CP-K1, client observation D4b)
- **`requests` cache-key collision**: `REQUEST_CREATED/UPDATE` (support tickets) invalidate `admin.requests`, whose only React Query consumer is the unrelated content-brief list — a support-ticket reply spuriously refetches the briefs pipeline. (REQ-K1)
- **client_action sources have no dedicated send route** (all funnel through generic `POST /api/client-actions/:ws`), so redirect/internal-link/AEO/decay inherit the whole defect set (no decline, no changes-requested email, no admin resend) and cannot be fixed in isolation. Timestamp-keyed `sourceId` (redirect, internal-link) mints duplicate inbox items on re-send. (REDIR-K2, AEO-K4, DECAY-K3 — note: this is intentional shared-platform design for analyzer-generated proposals, so the fix is to harden the shared platform, not to split it.)
- **Work orders are a one-way fulfillment notification, not a review pipeline** — read-only client surface, no public respond route, not adaptable into `NormalizedDecision`, two near-identical public read endpoints (`fix-orders` vs `work-orders`) with divergent status sources, "Fixes Applied" email renders raw `product_type` slugs ("fix meta", "schema 10") despite a server-side displayName map existing in `stripe.ts`. (WO-K1, WO-K2, WO-K3)
- **Keyword strategy / keyword feedback are two more independent subsystems** outside the five: strategy becomes client-visible the instant it is generated with no operator send/release gate (and `seoClientView` only hides the paid Strategy tab, not the always-unlocked Overview/Insights/AI-chat consumption); client keyword feedback reaches no admin inbox/bell/email, only a SectionCard in the Keyword Strategy tab. (KWSTRAT-C1, KWSTRAT-C2)

## Section D — The Client Inbox as a Feature (Client's-Eye View)

**Persona:** the agency's customer — a busy, non-expert business owner who logs in occasionally to approve/reject SEO work and wants *one clear thing to do and to know what's next*. Frequently on mobile.

Anchored throughout to the stated **NORTH STAR** ("the client sees ONE clear thing to do and what to do next") and the Client-inbox sub-goals (obvious-on-login, ONE prioritized inbox, per-item clarity, approve/request-changes/decline ergonomics, notifications/nudges, empty states, mobile). Findings the merged Section A map already covered (silent round-trips, orphaned `FixRecommendations`, schema-plan brokenness, header/inbox count omissions of clientActions) are referenced only where they change the *client* experience; the focus here is what the client actually sees and can do.

### D.1 On login, the inbox is not what greets you — and the two "what needs you" surfaces disagree

The default landing tab is **Insights (Overview), not Inbox** (`src/components/client/client-dashboard/clientDashboardNav.ts:35`; `ClientDashboard.tsx:336` resolves the initial tab, Overview is first). So the very first answer to "what awaits me?" is an analytics dashboard, and the actionable queue is one tab away. Overview *does* synthesize an "N items need your attention" banner (`OverviewTab.tsx:230-264`) that deep-links into inbox sections — that is the strongest single expression of the north star in the product. But it is computed from a **different, narrower set of signals** than (a) the nav badge and (b) the inbox itself:

- **Overview banner** counts `pendingApprovals + briefReviews + postReviews + unreadTeamNotes + contentPlan.reviewCells` (`OverviewTab.tsx:232-239`). It has **no line for client_actions** (redirects/internal links/content-decay/AEO) and **none for copy review or schema plan**.
- **Nav "Inbox" badge** counts `pendingApprovals + pendingReviews(briefs+posts) + unreadTeamNotes + copyReviewCount` (`ClientHeader.tsx:216-220`). It **includes copy but omits client_actions and content-plan cells**.
- **Inbox tab** counts decisions+reviews+conversations including `pendingClientActions`, content-plan cells, schema plan, copy, etc. (`InboxTab.tsx:122-210`).

Three counters, three different formulas. A client with only a pending redirect/internal-link/AEO action sees **no Overview banner and no nav badge**, yet the Inbox holds a real decision — the north star ("obvious what awaits") fails for the entire client-action family at the two surfaces a client looks at first. (Code-verifiable; design impact is judgment.)

### D.2 The one component built to be "the single prioritized list" is dead code

`PriorityStrip.tsx` is purpose-built for exactly the north star — a cross-section "Needs your attention" list with per-item CTA and an "all caught up" state (`PriorityStrip.tsx:39-82`). It has **zero importers** anywhere in `src/` (grep: only its own definition). So the product *has* the right primitive and doesn't mount it. Instead the client gets the Overview banner (D.1, undercounts) plus a filtered, multi-section Inbox. The single-prioritized-inbox goal is unrealized despite the component existing. (Code-verifiable orphan; "this is the north-star surface" is design judgment.)

### D.3 The Inbox is fragmented by construction — two parallel layouts plus 3 sections plus an Active/Completed axis

Even within the Inbox, the client faces a matrix, not "one thing":

- **Two entire renderers** gated by the `new-inbox-ia` flag: `NewInboxLayout` (3 sections: Decisions / Reviews / Conversations) and `LegacyInboxLayout` (Needs Action & Requests / SEO Changes / Content) — `InboxTab.tsx:327-617` vs `:618-955`. They group the same artifacts under **different section names and different mental models**, so documentation, support, and the client's own memory of "where do I approve X" depend on an invisible flag.
- An orthogonal **Active / Completed toggle** (`InboxTab.tsx:303-320`) the client must also reason about.
- Filter chips (All / Decisions / Reviews / Conversations) on top (`InboxTab.tsx:212-225`).

For the persona, "what do I do" requires choosing the right chip *and* understanding which of two taxonomies they're in. This is the opposite of one clear thing. (Layouts/flag code-verifiable; experience cost is design judgment, anchored to NORTH STAR + "ONE prioritized inbox vs fragmented across tabs".)

### D.4 The same item appears in two places; an approval batch with a note shows a count but no card

- **Content-plan** cells render both inside the Inbox Decisions section (`InboxTab.tsx:379-459`) **and** as a standalone `ContentPlanTab` reachable from the nav with its own badge (`ClientHeader.tsx:241-249`). Same item, two homes.
- **Schema plan** appears as an Inbox Reviews card (`InboxTab.tsx:266-293`/`504`) and, in beta, again in Decisions (`:461-485`).
- **`approvalsForConversations`** (an approval batch the operator sent *with a note*) is counted into the Conversations chip (`InboxTab.tsx:185,210`) but the Conversations section only renders `conversationItems` (client_actions) + `RequestsTab` (`:542-567`) — **the batch itself is never rendered there**. So the chip says "1 active" but the client scrolls Conversations and finds no card to act on. A dead count with no actionable target directly violates "ONE clear thing to do." (Code-verifiable: count at `:210`, render set at `:542-567`.)

### D.5 Per-item clarity: no deadline / due-date anywhere, and `createdAt` is never shown

Every product goal lists "deadline" as part of per-item clarity. There is **no deadline/due-date/SLA field** on any client artifact: `NormalizedDecision` carries only `createdAt` and no due date (`shared/types/decision.ts:16-35`); grep for `deadline|dueDate|due_date|expiresAt` across `shared/types/decision.ts`, `client-actions.ts`, `approvals.ts`, `client/types.ts` returns nothing. Worse, `DecisionCard` doesn't even render the `createdAt` it has (`DecisionCard.tsx:37-92`) — so the client cannot tell whether a decision is hours or months old, nor whether anything is time-sensitive. "Why now / by when" is absent from the core card. (Code-verifiable.)

### D.6 Approve/request-changes/decline ergonomics are inconsistent per work type — and "decline" mostly doesn't exist

The verb set the client is offered changes per surface, which trains no reliable muscle memory:

| Surface | Approve | Push back | Reject/Decline |
|---|---|---|---|
| Briefs (`ContentTab.tsx:589-605`) | Approve Brief | Request Changes | **Decline** (full) |
| Posts (`PostReviewCard.tsx:453-471`) | Approve Post | Request Changes | none |
| SEO/audit/schema-item batch (`ApprovalBatchCard.tsx:351-364`) | Approve / Approve All | Edit | **Reject** (per item) |
| Bulk decision modal (`DecisionDetailModal.tsx:294-340`) | "Looks good — implement N of M" | per-item **Flag** | **none** (no whole-batch reject) |
| client_action inline (`DecisionCard.tsx:56-83`) | Approve | Request changes (note) | none |
| client_action modal (`ClientActionDetailModal.tsx:257-287`) | Approve | Request changes | none |
| Copy (`ClientCopyReview.tsx:519-541`) | Approve | Suggest Changes | none |
| Schema plan (`SchemaReviewTab.tsx:251-301`) | Approve Strategy | Request Changes | none |

Two specific client-facing hazards:
1. **`DecisionDetailModal` has no "reject everything" path.** A client who disagrees with a whole SEO/redirect/AEO batch can only Flag items one-by-one and then the only primary button still says *"Looks good — implement N of M →"* (`DecisionDetailModal.tsx:336-340`), which **approves** the unflagged remainder. There is no "I don't want any of this." For redirects/internal-links/AEO the underlying schema only accepts `approved|changes_requested` (per Section A #8-11), so decline is impossible by design — but the UI also doesn't even offer "request changes on all," only "implement."
2. **Decline asymmetry on content:** a brief can be declined outright but a *post* (the more expensive deliverable) cannot (`PostReviewCard.tsx` has only Approve/Request-Changes). A client who no longer wants a commissioned post has no terminal action.

(All rows code-verifiable; "inconsistency confuses the persona" is design judgment anchored to "approve/request-changes/decline ergonomics".)

### D.7 The "Request Changes" verb is overloaded and ambiguous, and one flow surprises the user

"Request Changes" means materially different things the client can't distinguish: hold-this-item-for-review (approval flag), send-freeform-note-to-team (client_action), suggest-a-rewrite (copy), or revise-the-whole-deliverable (brief/post). On the post card, clicking **Request Changes** with no note typed silently does nothing except expand a feedback box and show a warning (`PostReviewCard.tsx:176-180,462-474`) — the button looks like it failed. For a non-expert that reads as a broken button. (Code-verifiable; UX-cost judgment.)

### D.8 Empty states are per-section and inconsistent, so "all caught up" is never said once

There is no single inbox empty state. Instead the client may see several different "nothing here" messages depending on filter/section: Decisions → a bare line "All caught up — no decisions needed right now." (`InboxTab.tsx:487-488`); Completed → an `EmptyState` "No completed items yet" (`:608-614`); Copy → "No copy ready for review yet" (`ClientCopyReview.tsx:193-203`); Schema → "No schema strategy yet" (`SchemaReviewTab.tsx:120-123`); Content → "Your content pipeline is empty" (`ContentTab.tsx:250-261`); Requests → its own empty branch (`RequestsTab.tsx:180`). A truly-clear client with nothing pending in the **All** view sees a stack of section headers each with its own micro-empty-state rather than one reassuring "You're all caught up" — which is precisely what the orphaned `PriorityStrip` "all caught up" state (`PriorityStrip.tsx:42-49`) was built to provide. (Code-verifiable surfaces; cohesion judgment.)

### D.9 Mobile (known weak): wide tables, full-screen takeovers, and inline edit on phones

Several review surfaces are not phone-shaped:
- **Internal-link review renders a 5–6 column `<table>`** in both the bulk modal (`DecisionDetailModal.tsx:169-214`) and the detail modal (`ClientActionDetailModal.tsx:50-90`); on a phone this is a horizontal-scroll table inside a full-screen takeover — hard to read and approve confidently.
- **Approval batches use side-by-side Current/Proposed grids** (`ApprovalBatchCard.tsx:293-343`) and inline rich-text/`FormInput` editing of SEO titles/meta; editing copy in a cramped two-column grid on mobile is awkward.
- **Post review is a full inline TipTap editor** with multiple `RichTextEditor` instances and per-block Edit toggles (`PostReviewCard.tsx:278-430`) — heavy for a phone, and the approve/request-changes buttons sit far below a long scroll.
- The nav is a horizontal `overflow-x-auto` tab strip with a numeric Inbox badge (`ClientHeader.tsx:205,231-240`); the Inbox count badge can be off-screen on small viewports.

(Components/markup code-verifiable; "weak on a phone" is design judgment anchored to the MOBILE goal — and the brief itself flags mobile as known-weak.)

### D.10 Beta clients can be deep-linked to a Reviews section that silently doesn't exist

Overview and other senders build `?tab=reviews` deep links (`OverviewTab.tsx:236-237,349`), but in beta mode `resolveInboxFilter` rewrites `reviews → decisions` (`inbox/inbox-filter.ts:26-34`) and the Reviews section/chip is suppressed for beta (`InboxTab.tsx:215,260,494`). A beta client following a "content ready for review" link lands on Decisions, not the content they expected — a silent navigation mismatch for the exact items (briefs/posts/copy) that live only under Reviews. (Code-verifiable.)

### D.11 No notifications or nudges reach the client — the inbox only updates if they're already looking

Client-side freshness is entirely WebSocket-cache-invalidation while the dashboard is open (`ClientDashboard.tsx:370-472`). There is no client-facing email/nudge/"you have N pending" reminder in this codebase, and (per Section A) several send paths don't even email the client on send (copy #7), so an item can sit in the inbox indefinitely with the client never prompted to return. For the occasional-login persona this means "what awaits me" is only ever discovered by manually logging in. (Absence is code-verifiable for the client surfaces reviewed; "nudges are needed for this persona" is design judgment anchored to the notifications/nudges goal.)

### D.12 Net read against the north star

The portal contains the right *ingredients* for "one clear thing to do" — an Overview action banner, a normalized `NormalizedDecision`/`DecisionCard` model, and a purpose-built `PriorityStrip` — but they are not assembled into one trustworthy queue: the prioritized strip is unmounted (D.2), three counters disagree (D.1), the same items live in 2–3 places (D.4), a counted Conversations item renders nothing (D.4), the action verbs and decline availability differ per type (D.6–D.7), there is no deadline/recency cue (D.5), empty states are fragmented (D.8), mobile review is table/editor-heavy (D.9), beta deep-links misroute (D.10), and nothing nudges the client back (D.11). The experience asks the client to *assemble* their own to-do list across surfaces rather than being handed one.

## Section E — The Admin/Operator Inbox Experience

**Verdict against the admin north-star ("can the operator see, in ONE place, everything sent to clients + its live status, and nudge/resend what's stuck?"): the answer is no.** There is no admin inbox. The operator's view of "what I sent and what came back" is shattered across the same five artifact mechanisms the pipeline map (Section A.0) identified, and the two surfaces literally named "inbox" (`admin/AdminInbox.tsx`, `admin/ClientActionsTab.tsx`) each cover one sliver. Sent-state, where it surfaces at all, lives back inside the individual sending tool. There is no concept of *stale*, *overdue*, or *awaiting client* anywhere in the codebase (grep for `overdue|staleness|awaiting_client` across `src/components/admin/` and the notification layer returns zero hits), so the operator cannot answer "which client hasn't responded in two weeks?" at all.

### E.1 No single pane — the operator must hunt across five surfaces

The closest things to an operator inbox are three disjoint components, none spanning the five artifact families:

- **`admin/AdminInbox.tsx`** is misnamed: it renders only chat-derived `ClientSignal`s (`AdminInbox.tsx:138-139`, `useClientSignals`), with a `new/reviewed/actioned` status vocabulary unique to signals (`AdminInbox.tsx:23-27`). Nothing the operator *sent* appears here.
- **`admin/ClientActionsTab.tsx`** shows only `client_action`s (redirects, internal links, content-decay, AEO) for one workspace (`ClientActionsTab.tsx:135-138`).
- **`PendingApprovals.tsx`** shows only the `approval_batch` family (SEO edits / audit issues / schema items) (`PendingApprovals.tsx:36`, `approvals.list`).

Copy/brand sections (`copy_section`) and the schema strategy plan (`schema_plan`) have **no admin status surface at all** — consistent with Section A's finding that the operator only learns of a copy or schema-plan response if `CopyReviewPanel`/`SchemaPlanPanel` happens to be open. These three components are reached through three different navigation paths: AdminInbox and ClientActionsTab are sub-tabs of the `requests` tab (`App.tsx:474,476`), while PendingApprovals is embedded inside each sending tool (`SeoEditor`, `SchemaSuggester`, `CmsEditor`, `WorkspaceOverview` — its mount list). The operator who sent five different work types to one client must visit at least four different screens to learn what came back. *(Design judgment, anchored to the admin north-star and code-anchored to the three disjoint mount points.)*

### E.2 The "Command Center" rollup omits three of five send families and the entire "changes requested" axis

`WorkspaceOverview.tsx` ("Command Center", `WorkspaceOverview.tsx:95`) is the operator's cross-workspace home and its "Needs Attention" list (`WorkspaceOverview.tsx:76-90`) is the single best candidate for a one-pane status board. It aggregates new requests, pending approvals, content briefs awaiting review, pending work orders, rejected page-states, low health, and churn — but it has **no line for client actions (#8-11), copy sections (#7), or schema plans (#6)**, and **no line for any "changes requested" state** on any family. A client who requested changes on a redirect, a copy section, or a schema plan produces zero signal on the Command Center. The rollup also conflates inbound (client-initiated `requests.new`) with outbound-sent items under one "Needs Attention" heading, so the operator cannot distinguish "a client is waiting on me" from "I am waiting on a client." *(Code-verifiable omission + design judgment, anchored to the admin north-star.)*

### E.3 The notification bell — the only cross-workspace status feed — silently mis-buckets and mis-routes client-action responses

`useNotifications.ts` + `NotificationBell.tsx` is the one place that polls `/api/workspace-overview` across all workspaces (`useNotifications.ts:48-49`) and surfaces "X client action requesting revisions" / "X approved client action to execute" (`useNotifications.ts:219-242`). Two code-verifiable defects make these notifications nearly useless:

1. **Mis-bucketed into "System Events."** `notificationCategory()` (`NotificationBell.tsx:19-30`) classifies an ID as `actions` only if it starts with `requests-`, `approvals-`, `content-`, `content-plan-`, `orders-`, or `signals-`. The client-action notification IDs are `client-actions-approved-${ws.id}` and `client-actions-changes-${ws.id}` (`useNotifications.ts:221,233`) — none of those prefixes match, so they fall through to `system` and render under the de-emphasized "System Events" group (`NotificationBell.tsx:245-300`) beneath alerts and background jobs, rather than under "Actions Needed."
2. **Mis-routed on click.** Both notifications carry `tab: 'requests'` (`useNotifications.ts:228,240`) and navigate via `adminPath(item.workspaceId, item.tab)` (`NotificationBell.tsx:193`). But the `requests` tab's sub-tab state, `requestsSubTab`, is `useState('signals')` and is force-reset to `'signals'` on every workspace switch (`App.tsx:242,245`); it never reads the URL. So clicking "3 approved client actions to execute" lands the operator on the **Signals** sub-tab (chat signals — `App.tsx:474`), not the **Client Actions** sub-tab where the items live (`App.tsx:476`). This is the codebase's own `?tab=` two-halves contract (CLAUDE.md UI/UX rule #12) being violated at the admin layer: the notification implicitly wants `?tab=actions`, the receiver ignores it. Copy sections and schema plans never reach the bell at all, because `/api/workspace-overview` (`server/routes/workspaces.ts:101-224`) summarizes approvals, content requests, work orders, content-plan cells, client signals, and client actions — but never `copy_section` or `schema_plan`. *(Both code-verifiable.)*

### E.4 Nudge/resend exists for exactly one of five families

The operator can only chase a stalled client on approval batches: `PendingApprovals.tsx:59-66` calls `approvals.remind` → `POST /api/approvals/:ws/:batchId/remind` (`server/routes/approvals.ts:186`), which sends a reminder email. There is **no reminder route for any other family** — grep for `remind`/`reminder` in `server/routes/client-actions.ts`, `server/routes/copy-pipeline.ts`, and `server/routes/webflow-schema.ts` returns nothing. So for redirects, internal links, AEO, content-decay, copy sections, schema plans, content briefs, and posts, the operator has no in-product way to nudge a non-responsive client. `ClientActionsTab.tsx` offers a "Mark complete" button only for `approved` items (`ClientActionsTab.tsx:109-122`); a `pending` (awaiting-client) or `changes_requested` client action is a read-only dead end — the operator sees the orange "Changes Requested" badge and the client's note (`ClientActionsTab.tsx:84,100-104`) but has no button to revise, re-send, or even acknowledge it. *(Code-verifiable.)*

### E.5 Sending tools are write-only — the operator can't see the response where they sent from

For the client-action family, the four sending surfaces are pure fire-and-forget: `RedirectManager.tsx:177`, `InternalLinks.tsx:142`, `AeoReview.tsx:154`, and `ContentDecay.tsx:95` all call `clientActions.create(...)` and **none** of them ever calls `clientActions.list` to read the response back. After hitting "Send to client," the operator's redirect tool keeps showing HTTP-status badges (`RedirectManager.tsx:212-217`), with no indication the client approved or asked for changes. To find out, the operator must abandon the tool and navigate to the separate ClientActionsTab. Contrast the approval family, where `PendingApprovals` is embedded directly in the sending tool and shows live per-batch approved/rejected/pending counts (`PendingApprovals.tsx:96-98,124-126`) plus per-item status (`:186-194`) — that is the right pattern, and it exists for only one of five families. *(Code-verifiable.)*

### E.6 No time/age dimension anywhere — "stuck" is invisible

No admin surface records or displays *when* something was sent or *how long* it has been awaiting a client. `ClientActionsTab` shows only a formatted `updatedAt` calendar date (`ClientActionsTab.tsx:64-68`) — not relative age, not a "pending for N days" indicator, not a stale threshold. `PendingApprovals` shows `createdAt` as a short date (`PendingApprovals.tsx:122`) but applies no staleness styling. The notification bell counts *quantities* ("3 pending approvals") but never *durations*. Because the data model carries no `awaiting_client`/`stale`/`overdue` concept (Section A.0 confirms `awaiting_client` has zero grep hits), the operator literally cannot triage "which sends are stuck" — the only operations available are per-item, per-workspace, and ageless. This directly defeats the admin-inbox goal of "see what's stuck/overdue and track client responsiveness." *(Code-verifiable absence + design judgment, anchored to the admin north-star.)*

### E.7 Net effect on the operator

The operator suffers the *same fragmentation the client suffers*, mirrored. To answer "what's the status of everything I've sent this client?" they must: open Command Center (approvals/content/work-orders only), open the bell (mis-bucketed, mis-routed for client actions, blind to copy/schema-plan), open the `requests` tab's Client Actions sub-tab (client actions only, no age, no nudge), open each sending tool individually for copy and schema-plan responses, and accept that declines (briefs), changes-requested (copy, schema plan, client actions), and stale sends will reach them late or never (Section A's broken/silent round-trips). The one family that works end-to-end for the operator — approval batches — proves the platform *knows* the right pattern (embedded sent-state with counts + a Remind button + a Retract action); it simply hasn't been generalized to the other four mechanisms.

## Section F — Recommendations

Prioritized and decision-oriented. Each ties to the gaps that motivate it. Not a micro-ticket list.

### F.1 Pipeline fixes

**P1 — Fix the destructive audit-issue → approval path before anything else (motivated by B1/AUDIT-C1/C2/C3, B8/SEO-C1, SEO-K3, AUDIT-K1).** This is the only finding that performs a live, client-triggered destructive write. Decide one of: (a) make the audit path build typed approval items through the same `seoEditorDerived`-style builder the SEO editor uses, with a real per-check field mapping and an explicit "not auto-appliable" flag for non-meta checks; or (b) route audit findings through a non-applyable review artifact that cannot reach `updatePageSeo`. Either way, the bespoke inline payload (with the `reason` key that 400s every send, and the all-issues→`seoDescription` collapse) must be retired. This single fix closes the critical destructive write, the silent 400, and the "Meta Description" mislabel together.

**P2 — Establish ONE send-to-client service with a shared round-trip contract (motivated by the C.1 framing fact, POST-K1, COPY-K1, SCHEMA-K2, and the email-asymmetry cluster B4/B6/B9/B31).** The defining problem is five send mechanisms with five inconsistent round-trips. Introduce a single send abstraction that every work type calls, which guarantees four things on every send and every response: (1) a client notification on send, (2) a team notification on EVERY client outcome — approve, request-changes, AND decline (today `notifyTeamChangesRequested` exists but is simply not imported by the client_action, copy, and schema-plan paths, and decline is silent for briefs), (3) a `validateTransition` guard, (4) a record in the unified admin overview. This is the root fix for B3, B4, B6, B9, B31 and is the structural precondition for the admin inbox in F.3.

**P3 — Close the approval→artifact round-trip for content-plan and schema (motivated by B2/CP-C1/CP-C2, B7/POST-C3, B11/SCHEMA-C1/C2).** Several pipelines create a client-facing artifact whose approval never feeds back to the source-of-truth record: content-plan batch approval never advances the matrix cell; post approval never syncs `GeneratedPost.status`; schema approval has no apply path and strands the batch. Decide the canonical reconciliation: when a `content_plan_sample`/`content_plan_template`/`post`/`schema` approval reaches `approved`, a bridge must mutate the originating cell/post/plan and unlock downstream work — or these review types should not use the apply-gated approval_batch artifact at all. Until then, remove the "will be applied when you push changes live" / "Ready to Apply" copy that promises a step that cannot happen.

**P4 — Normalize status vocabulary and bring the three unguarded entities under the central state machine (motivated by C.2: COPY-K2, SCHEMA-K1, CP-K4, REQ-C4, BRIEF-C2).** Adopt one shared vocabulary for the four cross-family concepts (awaiting-client / changes-requested / approved / declined) with per-artifact transition maps registered in `server/state-machines.ts`. Specifically: rename copy's `revision_requested`→`changes_requested`; register schema-plan, matrix-cell, and `requests` transition maps; add a `declined` terminal to `client_action`; and add `declined`/`awaiting_client` buckets to the `/api/workspaces` rollup. This is what makes a single admin status pane (F.3) and cross-family grouping possible.

**P5 — Give the four client_action types a real, idempotent, decline-capable round-trip (motivated by B4, B5, B17, B18, B23; REDIR/ILINK/AEO/DECAY-C* cluster).** As one decision on the shared client_action platform (do NOT split into four routes): add `declined`; make the new-IA `DecisionDetailModal` expose request-changes/decline for all source types (not just `content_decay`); fix re-send to update-or-supersede the existing row instead of silently returning the stale one (stop keying `sourceId` on a re-analysis timestamp); and wire the changes-requested team email. This converts the largest "missing/partial" family in the map into a working pipeline.

**P6 — Decide what work orders and keyword strategy ARE (motivated by B14/WO-*, KWSTRAT-C1/C2).** Two revenue/visibility surfaces are structurally outside the model: fix orders have no client view and no operator advance UI (paid work can never be marked done in-product); keyword strategy goes live the instant it is generated with no release gate. Decide explicitly whether each is a review pipeline (then give it the F.2/F.3 surfaces) or a one-way notification (then remove the orphaned `OrderStatus.tsx` / dead routes and stop advertising tiers that have no UI — B12/CP-C4). A strategy "release to client" gate would restore operator control over an always-visible Overview/AI-chat surface.

### F.2 Client-inbox improvements

**C1 — Make the inbox the single prioritized queue the north star describes; mount the primitive that already exists (motivated by D1, D2, D4, D4b, D8).** `PriorityStrip` — a cross-section "Needs your attention" list with per-item CTA and a single "You're all caught up" empty state — is built and has zero importers. Adopt it (or its pattern) as the inbox landing, replacing: the three disagreeing counters (Overview banner, nav badge, Inbox tab each use a different formula and all omit client_actions at login — D1), the fragmented per-section empty states (D8), and the duplicate cards (content-plan/schema appearing in 2–3 surfaces, the Conversations chip that counts an approval batch but renders no card — D4/D4b). Consolidate the two flag-gated layouts onto one taxonomy (D3) and default the landing tab to the Inbox, not Insights (D12).

**C2 — Guarantee approve / request-changes / decline ergonomics uniformly across every work type (motivated by B5/B20/B23, D6, D7).** Today decline is available for briefs but not posts, copy, schema, or any client_action; the bulk modal has no whole-batch reject; "Request Changes" means four different things and on posts appears to no-op. Define one decision contract — Approve / Request changes (with note) / Decline — rendered identically for every reviewable item, and ensure the new-IA modal can actually emit all three for the client_action family (the capability silently disappears as clients migrate to the rolled-out flag — B5).

**C3 — Add per-item clarity: what am I reviewing, why, by when (motivated by D5, B27/AEO-K1, B1's mislabeling).** There is no deadline/SLA field on any artifact and `DecisionCard` never renders even `createdAt`, so "why now / by when" is absent. The default AEO renderer drops the per-diff rationale the operator wrote. Introduce a recency/age (and optional due-date) display on the core card and ensure context the operator attaches (rationale, the correct work-type label, the actual field being changed) survives to the client surface.

**C4 — Add a client notification/nudge channel (motivated by D11, B3/COPY-C2, B6/POST-C1).** Client-side freshness is WS cache-invalidation only — an item can sit forever if the client doesn't happen to be logged in, and several send paths (copy, MCP posts) never email at all. The shared send service (P2) should always notify the client on send, plus a periodic "you have N pending" reminder for items idle past a threshold.

**C5 — Fix the deep-link mismatches that strand clients (motivated by D10, CP-K5).** Beta clients deep-linked to `?tab=reviews` land on Decisions (Reviews is suppressed in beta); the Content-Plan tab links "needs review" to Reviews while the cells live in Decisions. Reconcile the `?tab=` contract with where each artifact actually renders.

**C6 — Make review surfaces usable on mobile (motivated by D9, the stated "MOBILE known weak" goal).** Internal-link review is a 5–6 column table in a full-screen modal; SEO approvals are side-by-side diff grids with inline editing; post review mounts multiple full TipTap editors below a long scroll. Prioritize responsive treatments for the highest-frequency review types (SEO approvals, client_action diffs, post review) since the client persona is phone-first.

### F.3 Admin-inbox improvements

**A1 — Build the single admin inbox that spans all send families with a live status axis (motivated by E1, E2, E5, E9; COPY-K3, SCHEMA-C3, ILINK-C3, BRIEF-C2).** This is the admin north-star gap. No query/type/component spans the five artifacts; copy and schema-plan appear on NO admin surface at all, and there is no time/age dimension anywhere so "stuck/overdue" is uncomputable. Add a `/api/workspace-overview` rollup (and a unified admin queue consuming it) that includes copy_section and schema_plan, exposes a per-family `awaiting_client / changes_requested / approved / stale` breakdown (enabled by P4's vocabulary normalization), and carries item age so the operator can triage what has been unanswered longest.

**A2 — Route and categorize notifications to the surface that can act on them (motivated by E3, E4, REDIR-C3, REQ-C2).** Client-action notifications fall through `notificationCategory()` into the de-emphasized "System Events" group (prefix mismatch) and, like new-request notifications, deep-link to `tab:'requests'` which lands on the default Signals sub-tab — not the surface that lists the item. Fix the category prefixes and make the admin `?tab=`/sub-tab navigation actually consume the sub-tab from the URL (the codebase's own two-halves contract is violated at the admin layer). Rename or repurpose `AdminInbox` (currently chat-signals-only) so the thing called "inbox" shows sent work, not lead signals (E10).

**A3 — Give every changes-requested/pending item an operator action, not a read-only badge (motivated by E7, B18/AEO-C5/DECAY-C4, B10/SCHEMA-C4).** `ClientActionsTab` offers a button only for `approved`; changes-requested and stale-pending items are read-only dead-ends, as is the schema panel's `client_changes_requested` state. The state machines and PATCH routes already support reopen/resend — add the revise / re-send / acknowledge controls so the operator can close the second iteration of the loop in-product.

**A4 — Generalize nudge/resend and inline response read-back across all families (motivated by E6, E8, B17).** Only the approval-batch family has a remind route (`PendingApprovals`) and embeds the client response read-back; redirects/internal-links/AEO/decay/copy/schema-plan/briefs/posts have no reminder path, and the four client_action sending tools are write-only (they never call `clientActions.list`, so after "Send to client" the operator must leave the tool to see the response). Make the shared send service (P2) expose a `remind` endpoint for every family and have each sending surface read its own responses back inline — the pattern already exists, it is just not generalized.

**A5 — Make the admin request list live and stop the cache-key collision (motivated by B16/REQ-C3, REQ-K1, B15/REQ-C1).** `RequestManager` has no WS subscription and the one handler invalidates the wrong (brief) cache; client replies bump no counter. Move it onto the standard React Query + `useWorkspaceEvents` pattern, give the support-ticket `requests` artifact its own cache key distinct from content-topic-requests, and add an "unread client note / client replied" concept so an in-progress reply produces a real operator signal.

## Refuted — claims that did NOT survive adversarial verification (not reported as gaps)

Six candidate findings were defeated by the skeptic pass and are excluded from the gaps above. Recorded here so they are not re-raised:

- **POST-K2 / AUDIT-K2 (send-button casing "violation").** There is **no canonical casing convention to violate**: `docs/workflows/ui-vocabulary.md` is internally inconsistent (title-case "Send to Client" at `:15`/`:66`, lowercase at `:78`), and title-case is the *dominant* real-send form (~7 surfaces each way). The `send-for-review-anti-pattern` pr-check rule (`scripts/pr-check.ts:7016`) blocks only the two retired phrases and does not enforce casing. The genuine residual — an even split with no shared label constant — is reported once as a consistency nit in **C.3 (SEO-K2/DECAY-K2)**, not as a per-surface bug.
- **POST-K3 (MCP post email "dead end").** The `/content` email URL is a working alias-redirect; the only residue (MCP send sends no client email) is already **B6**.
- **SCHEMA-C5 (schema client note "silently dropped").** The note **is persisted** (`server/activity-log.ts:273`) and **is rendered to the operator** in the WorkspaceHome Recent-Activity feed (`server/routes/workspace-home.ts:61` → `WorkspaceHome.tsx:615` → `ActivityFeed.tsx:55-61`). The real residual is UX *locality* (not co-located with the schema panel) — captured as design judgment under **B10/SCHEMA-C4**, not data loss.
- **SCHEMA-K3 (schema send "missing mandated note + raw fetch").** The inline note is **optional** by convention; copy/brief/schema sends all send no note (consistent, not divergent). `SchemaPlanPanel` uses the typed `schema.get` API wrapper, not raw fetch. The real consequence (no `SCHEMA_PLAN_SENT` reactivity) is **SCHEMA-C2's** territory (B9).
- **COPY-C4 (revision_requested "dead end, no resend").** A complete address-and-resend loop exists: Regenerate or manual edit returns the section to `draft` (`server/copy-review.ts:430-432,575-587`), then the draft re-send button routes the valid `draft→client_review` transition. The only residue (no lightweight nudge, no admin list of `revision_requested`) is already **B3/COPY-C2** and **F.3-A4**.
- **KWSTRAT-K2 (keyword feedback "private vocabulary").** Keyword feedback reuses the content-request verbs (`approved`/`declined`/`requested`, `shared/types/content.ts:235`), and is a client→engine signal out of the send-to-client scope; it correctly never enters `NormalizedDecision`.

---

## Dedup notes (merged root causes)

Many of the 94 surviving findings collapse to a smaller set of root causes; the Section B/C/F numbering reflects these merges:

- **B1** = AUDIT-C1/C2/C3 (one root: `flagForClient` hardcodes `field='seoDescription'` for ~44 of 46 check types) + the consistency framing AUDIT-K1/SEO-K3. **B8** (the `reason`-key 400 that fails *every* audit send) is kept distinct as the *send-time* gate vs B1's *apply-time* destructive write — they are two failure points of the same bespoke payload; **only one is live at a time** (B8 = current behavior, all sends 400; B1 = what happens if validation is relaxed).
- **B4** = REDIR-C4 + ILINK-C2 + AEO-C1 + DECAY-C1 — one bug in `client-actions-mutations.ts:179` (changes-requested fires no team email), aggravated by the false "Feedback sent to your team" toast (`InboxTab.tsx:232`).
- **B5** = REDIR-C1 + ILINK-C1 + AEO-C2 — one root (`isSingleAction` true only for `content_decay`, so the other three route to the approve-only `DecisionDetailModal`).
- **B9** = SCHEMA-C1(no-email) + SCHEMA-C3(absent from overview/bell) + SCHEMA-C2(stale admin panel). **B11** = the separate schema apply-dead-end + "Ready to Apply" miscount.
- **B2** = CP-C1 + CP-C2 (no bridge from approval status to the matrix cell + apply guard rejects `content_plan_*`).
- **B14** = WO-C1/C2/C3/K1 (work-order pipeline has no real round-trip and no operator advance UI).
- **B18** = AEO-C5 + DECAY-C4 (`ClientActionsTab` renders no control for changes_requested/pending) = admin observation E7.
- **B23** = REDIR-C5 + DECAY-C3 + AEO-C4 (one enum-level gap: `client_action` has no `declined`).
- **A2 (admin reco)** = REDIR-C3 + REQ-C2 + E4 (notifications carry `tab:'requests'` but the sub-tab defaults to Signals and never reads the URL); E3 (category-prefix mismatch) kept as a second, independent routing defect on the same bell.
- **Intentional, NOT fragmentation to split:** the shared generic `client-actions` route for analyzer-generated proposals (DECAY-K3/REDIR-K2/AEO-K4) is deliberate platform design — F.1-P5 hardens the shared platform rather than minting four dedicated routes. Only the timestamp-`sourceId` duplicate-on-resend behavior (B17) is a real defect within it.

---

## Unclear / Needs human (product decisions, not code fixes)

1. **Live cohort of `new-inbox-ia`.** Several client-side gaps (B5, B27, and the REDIR/ILINK/AEO/DECAY-K1 modal split) depend on how many real clients are on the new IA vs legacy today. If the new IA is widely rolled out, **B5 (no request-changes/decline for 3 of 4 client_action types) is hitting clients now**; if not, it is a forthcoming end-state regression. Confirm the rollout split to rank B5's urgency.
2. **Intended apply ownership for schema and content-plan (B2 / B11 / P3).** Is client approval meant to *trigger* an apply, or is operator-side server publish the only intended path? If the latter, the fix is to **remove** the "will be applied when you push changes live" / "Ready to Apply" copy, not to wire a client apply. Product decision.
3. **Work-order product intent (B14 / P6).** Are fix/schema orders meant to be a client review pipeline at all, or purely a fulfillment notification? The orphaned `OrderStatus.tsx` and dead `/api/public/fix-orders` route suggest an abandoned direction — confirm build-out vs removal.
4. **Keyword-strategy release gate (KWSTRAT-C1 / P6).** The public route comment says strategy data is needed unconditionally by Overview/Insights/AI-chat, so a "release to client" gate may conflict with intended always-on Insights behavior. Decide whether un-QA'd strategy exposure on the always-unlocked Overview tab is acceptable or must be gated.
5. **Should copy and schema-plan be first-class ADMIN-inbox citizens (A1 / E5)?** CLAUDE.md already calls copy a first-class inbox citizen on the *client* side, but neither copy nor schema-plan has any *admin* status surface. Confirm they should appear in the unified admin overview before building the rollup buckets (F.3-A1).

---

## Coverage & method — known limitations

- **Adversarial discipline:** every Section B/C finding was opened at its cited lines by an independent skeptic instructed to default to *refuted*; 6 of 100 were killed (above). Experience findings (D/E) are labeled **design judgment** wherever they are not strictly code-verifiable, and each is anchored to a specific view + one of the platform's stated product goals.
- **Synthesized verdicts** (the §D.12 net-read and §E.7 "operator suffers the same fragmentation, mirrored") are **design-judgment conclusions** aggregating their anchored sub-points, not independent code claims.
- **Absence-claims in the §C.2 vocabulary table and §D.6 ergonomics table** (e.g. "declined = none", "Decline: none") assert the *non-existence* of a control/enum member; the per-cell line is sometimes omitted from the table but the claim is backed by the underlying findings' citations (`server/state-machines.ts:76`, `server/routes/client-actions.ts:44`, `PostReviewCard.tsx:453`, `ClientActionDetailModal.tsx:257-287`). Treat the table as a summary of those findings.
- **Scope honesty:** this audit covered the send-to-client / client-inbox pipeline and its two-persona experience only. It deliberately did not re-audit data-model integrity, recommendation scoring, or the already-fixed 2026-05-19 handoff P0s (see header). Voice-calibration was checked and excluded (§A.4.3).
