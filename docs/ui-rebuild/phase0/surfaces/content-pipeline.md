# Phase 0 Ledger — Content Pipeline (Strategy & Content zone)

**Auditor scope:** admin Pages `content-pipeline` + folded pages `content`, `calendar`, `seo-briefs`, `subscriptions` (all redirect into content-pipeline sub-tabs — `src/App.tsx:408-413`, `src/lib/navRegistry.tsx:99-103,155-156`, `src/routes.ts:7-8`).
**Prototype views read:** `hmpsn studio Design System/mockup/pipeline.js` (lifecycle board + calendar + matrix + published + content-health + subscription drawer + intake), `brief-workspace.js` (full-page brief workspace), `draft-workspace.js` (full-page draft workspace).
**Out of scope (adjacent surfaces):** `requests` (RequestManager — moved to Inbox per ledger), `content-perf` (ContentPerformance — prototype folds into Published tab; owned by that surface's auditor), `brief` Page (= MeetingBriefPage, `src/App.tsx:394` — NOT content), client-side ContentTab/purchase flows, PublishSettings (workspace settings owns the Webflow publish-target config that `usePublishTarget` reads — `src/hooks/admin/useAdminPosts.ts:62-71`).

**Statuses:** `preserved` = obvious same-or-better home in prototype · `improved` = prototype upgrades it · `new_proposed` = prototype-only, needs sign-off · `at_risk` = exists at HEAD, no visible home (uncertain ⇒ at_risk).

---

## A. Pipeline shell (`src/components/ContentPipeline.tsx`)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|------------|-----------------|--------|----------------|-------|
| 1 | 5 sub-tabs Planner/Calendar/Briefs/Posts/Publish via TabBar | ContentPipeline.tsx:42-48,265-291 | improved | Board / Calendar / Published / Content Health modes + Matrix mode | Prototype collapses lifecycle into one board; tabs become view modes |
| 2 | `?tab=` deep link init + external-sync effect + legacy alias `subscriptions→publish` | ContentPipeline.tsx:68-100,52-55 | preserved | mode routing | Two-halves contract MUST be re-wired (contract test `tests/contract/tab-deep-link-wiring.test.ts`); legacy aliases `seo-briefs→briefs`, `content→posts`, `calendar` redirects at App.tsx:411-413 must survive |
| 3 | `?post=<id>` deep link opens PostEditor | useAdminPostWorkflow.ts:81-82, ContentCalendar.tsx:117 | preserved | draft workspace open-by-id | Calendar→post open depends on it |
| 4 | Workflow stepper (Strategy→Briefs→Posts→Publish) | ContentPipeline.tsx:159-166,192 | improved | board columns ARE the stages | |
| 5 | Health summary bar (briefs/posts/matrices/cells/%published) | ContentPipeline.tsx:114,195-202; useContentPipeline.ts:25-59 | improved | mode-toggle counts + Published stats | pipeline.js:856-885 counts per mode |
| 6 | Decay alert band (critical/warning/avg decline) + dismiss + deep-link to seo-audit `?sub=content-decay` | ContentPipeline.tsx:103,174,218-246 | improved | Content Health mode | pipeline.js:809-853 folds decay in as a tab with queue-refresh (better). Cross-surface: ContentDecay also lives in seo-audit — dedupe decision needed (see Q6) |
| 7 | Cannibalization warnings (intel slice) — growth-tier-gated, honest badge count | ContentPipeline.tsx:121,169-180,250-255 | at_risk | — | No cannibalization surface anywhere in pipeline.js/brief/draft workspaces. Tier gate (`tierAtLeast(tier,'growth')`) also has no home |
| 8 | Alerts & suggestions Disclosure (collapse decay+cannibalization w/ count badge) | ContentPipeline.tsx:206-258 | improved | board card `attn` treatment / Content Health | |
| 9 | AI Suggested panel (insight-engine briefs: accept→prefill, dismiss, snooze 1w/1m, priority + Refresh/New badges, snoozed-until badge) | pipeline/AiSuggested.tsx:50-186; useAiSuggestedBriefs.ts; server/routes/suggested-briefs.ts:62-140 | improved/partial | Intake lane (`ai` + `decay` source cards) | pipeline.js:571-602 intake has Start/Dismiss/Send-to-client. **Snooze (1w/1m) has no intake affordance — at_risk sub-item.** Accept must still hit PATCH status=accepted (lifecycle + activity log, suggested-briefs.ts:90-115) |
| 10 | Export menu: 5 types (briefs/requests/matrices/templates/strategy) × CSV/JSON | ContentPipeline.tsx:57-63,140-143,274-290; server/routes/data-export.ts:73-135 | at_risk | — | No export affordance in pipeline.js at all |
| 11 | Content Pipeline Guide (floating help + slide-over) | ContentPipeline.tsx:324-359, ContentPipelineGuide.tsx | at_risk | Parity Ledger claims `at:'guide'` | No guide element found in pipeline.js — verify before build |
| 12 | fixContext prefill flow (Draft Brief from seo-editor/strategy/page-intel → briefs tab prefilled, incl. pageAnalysisContext, autoGenerate) | ContentPipeline.tsx:19-28,104-157; useAdminBriefWorkflow.ts:22-41,204-243,519-541 | preserved | `window.sendToPipeline(term)` (pipeline.js:1177-1185) queues a card | Prototype only carries the keyword — full FixContext payload (optimizationIssues, recommendations, contentGaps, rationale, volume, serpFeatures…) feeds brief generation and must survive |
| 13 | Pending-content-requests badge in app shell routes to pipeline | src/App.tsx:479-481 | preserved | intake count | |
| 14 | Workspace-tier awareness (free/growth/premium) from cached workspaces | ContentPipeline.tsx:117-118 | at_risk | — | Prototype has no tier concept on this surface |

## B. Briefs (`ContentBriefs.tsx`, `briefs/*`, `useAdminBriefWorkflow.ts`)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 15 | Generate brief (keyword, business context, page type select, generation style, reference URLs, advanced toggle) as background job w/ 409 single-flight toast | briefs/BriefGenerator.tsx:64-162; useAdminBriefWorkflow.ts:170-243; server/routes/content-briefs.ts:154 | improved/partial | Brief workspace "Generate brief" + context notes (brief-workspace.js:270,431-449) | Business notes preserved (ctxSaveNotes). **Reference URLs and page-type select have no visible field — at_risk sub-items.** Generation style: see #17 |
| 16 | Template crossref hint (keyword → matching template autofills pageType) | useAdminBriefWorkflow.ts:147,624-629; content-briefs.ts:119 | at_risk | — | No equivalent in brief workspace |
| 17 | Generation style selector (standard/concise/hybrid) on brief gen, brief edit, and post gen | useAdminBriefWorkflow.ts:119; BriefDetail.tsx:258; FEATURE_AUDIT.md:1231 | at_risk | — | Admin-only style control absent from prototype |
| 18 | Briefs list: search, sort (date/keyword A-Z/difficulty), expand/collapse | ContentBriefs.tsx:181-209; briefs/BriefList.tsx | at_risk | — | Board has no search/sort; fine at small N but capability must have a stated home |
| 19 | Brief detail: inline editable fields (exec summary, title, meta desc + regen buttons, word count, intent, audience, tone, content format select, generation style) with commit-on-blur PATCH | briefs/BriefDetail.tsx:172-276; content-briefs.ts:139 | improved/partial | Brief workspace spec editor w/ char-count validation (brief-workspace.js:244-262,310-333) | Workspace adds per-field AI assists + readiness checklist (new). Verify every HEAD-editable field exists (contentFormat, generationStyle, wordCountTarget, audience, tone) |
| 20 | Brief rich content display: secondary keywords, topical entities, PAA, outline w/ per-section words+keywords+notes, CTAs, competitor insights, internal links, SERP analysis (contentType/avgWordCount/gaps/commonElements), difficulty score | useAdminBriefWorkflow.ts:62-97 (markdown mirror); BriefDetail.tsx:278-400 | preserved | brief workspace spec sections (keywords/outline/meta/links/E-E-A-T) | |
| 21 | Regenerate brief with feedback (bg job) | useAdminBriefWorkflow.ts:261-275,584-604; content-briefs.ts:196 | at_risk | — | Workspace has one-shot "Generate brief"; no regenerate-with-feedback affordance |
| 22 | Regenerate outline only, with feedback (bg job) | useAdminBriefWorkflow.ts:245-259,606-622; content-briefs.ts:213 | at_risk | "Suggest outline" assist is adjacent | assist(outline) exists (brief-workspace.js:366) but semantics differ (suggest vs regenerate persisted outline) |
| 23 | Copy as Markdown ("Copy for AI Tool") + Copy JSON | useAdminBriefWorkflow.ts:330-332; BriefList.tsx:81-94 | at_risk | — | No copy/export in brief workspace |
| 24 | Export brief client-HTML/PDF (`GET /export`) | useAdminBriefWorkflow.ts:334-341; content-briefs.ts:229 | at_risk | — | |
| 25 | Send brief to client (creates client request + email) w/ optional note | useAdminBriefWorkflow.ts:343-356; content-briefs.ts:244; BriefList.tsx:105 | preserved | "Send brief to client" / sendBrief (pipeline.js:1152, brief-workspace.js:273) | Prototype adds awaiting-client state + Nudge (new) |
| 26 | Delete brief with confirm modal + 6s undo window (optimistic cache remove/restore) | useAdminBriefWorkflow.ts:400-512; ContentBriefs.tsx:120-160 | at_risk | — | Prototype has intake dismiss only; no delete/undo on board cards |
| 27 | Generate post from brief (bg job; opens editor skeleton) | useAdminBriefWorkflow.ts:378-398; content-posts.ts:194 | preserved | "Write draft" (brief-workspace.js:271, advance) | |
| 28 | Standalone brief-not-found recovery (fallback list fetch + error hint) | useAdminBriefWorkflow.ts:288-324 | preserved | error state per Build Conventions | Must keep an error state; exact copy free to improve |
| 29 | Loading / blocking-error states w/ Retry + Refresh | ContentBriefs.tsx:86-115 | preserved | 4-state contract | |
| 30 | Keyword validation endpoints (validate-keyword / validate-keywords) | content-briefs.ts:337,400; src/api/content.ts:65-73 | at_risk | — | API-only at HEAD (no src UI caller found); confirm consumer (MCP/server) before assuming droppable |

## C. Client requests inside Briefs (`briefs/RequestList.tsx`)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 31 | Request list w/ status lifecycle (requested→brief_generated→client_review→approved→in_progress→post_review→delivered / declined) driven by state machine | RequestList.tsx:124-260; server/routes/content-requests.ts:78; server/state-machines.ts | at_risk | Intake `client` cards + awaiting-client board states cover only entry + review | Full production lifecycle (approve, in-progress, resubmit-to-client, post_review, delivered) has no explicit prototype home. Parity Ledger moves the *Requests surface* to Inbox — but these per-request actions live HERE at HEAD |
| 32 | serviceType badge (brief_only vs full_post) + Upgraded badge + upgrade path | RequestList.tsx:145-146,209-216 | at_risk | — | Monetization-relevant; no home |
| 33 | Generate brief for request (bg job, style select) + Decline | RequestList.tsx:177-182; content-requests.ts:269; useAdminBriefWorkflow.ts:358-376,564-582 | preserved | intake Start / queued card "Generate brief" | |
| 34 | Deliver Brief / Deliver Content w/ deliveryUrl + deliveryNotes form | RequestList.tsx:209-210,259-260; useAdminBriefWorkflow.ts:42-50,188-202 | at_risk | — | Delivery-URL capture absent from prototype |
| 35 | Resubmit revised brief to client (client_review w/ cleared feedback); Send post to client (post_review) gated on post status review/approved | RequestList.tsx:232-256 | at_risk | drawer/board "Send to client" is adjacent | Status semantics must not change (CLAUDE rule); mapping needs sign-off |
| 36 | View linked brief inline (toggleRequestBrief w/ fetch-fallback), brief editing within request | RequestList.tsx + useAdminBriefWorkflow.ts:288-324 | preserved | drawer/brief workspace | |
| 37 | Delete request (confirm + undo) | useAdminBriefWorkflow.ts:326-328,413-420 | at_risk | — | Same as #26 |

## D. Posts (`ContentManager.tsx`, `useAdminPostWorkflow.ts`)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 38 | Posts list w/ status cards acting as filters (draft/review/approved/generating/error + counts) | ContentManager.tsx:117-140; useAdminPostWorkflow.ts:57-66 | improved | board columns + counts | `generating`/`error` states must render on board cards (prototype shows only happy path) |
| 39 | Search + sort (date/title/status/words, asc/desc) | ContentManager.tsx:143-172; useAdminPostWorkflow.ts:25-55 | at_risk | — | |
| 40 | Status progression: draft→review, review→approved, review→draft (validateTransition server-side) | ContentManager.tsx:280-320; content-posts.ts:277 | improved | advance()/board moves (pipeline.js:1132-1151) | **Stage-model mapping is a stop-and-ask (Q1)** |
| 41 | Send post to client (POST-C1: creates post_review content_request + email; teal CTA + optional note) | ContentManager.tsx:323-443; useAdminPosts.ts:47-60 | preserved | "Send to client" drawer/board action | Keep the optional-note Admin Send Convention |
| 42 | Publish to Webflow (gated on hasPublishTarget; Published badge after) | ContentManager.tsx:339-356; useAdminPostWorkflow.ts:123-137; server/routes/content-publish.ts:57 | preserved | scheduled→published advance / "Publish now" | hasPublishTarget empty/locked state needs a home (capacity meter ≠ publish target) |
| 43 | Publish w/ optional AI image generation (`generateImage`) + publish confirm + error surface | PostEditor.tsx:293-311 | at_risk | — | generateImage option not visible in prototype |
| 44 | Voice scoring (bg job) + voice MetricRing + expandable feedback + re-score | ContentManager.tsx:241-254,359-371,446-469; useAdminPostWorkflow.ts:180-192; content-posts.ts:540 | preserved (verify) | "Brand voice" gate in 6-gate AI review (pipeline.js:933) | Numeric 0-100 score + prose feedback + re-score must survive inside the gate UI |
| 45 | Outcome readback chip on published posts (90-day clicks/position delta + verdict) | ContentManager.tsx:256-264 (OutcomeReadbackChip) | improved | Published tab: verdict, sparkline, tiles, engagement (pipeline.js:765-807) | |
| 46 | Export post HTML from list; markdown/html/pdf from editor | ContentManager.tsx:373-384; PostEditor.tsx:349-362; content-posts.ts:424-455 | at_risk | — | No export in draft workspace |
| 47 | Delete post (inline confirm) | ContentManager.tsx:386-402; content-posts.ts:552 | at_risk | — | No delete affordance on board/drawer |
| 48 | Generating-state UX: per-section progress (x/y sections), 5s/3s poll refetch | ContentManager.tsx:188-234; useAdminPosts.ts:13-31 | preserved | draft % progress bar (pipeline.js:611-612) | |

## E. Post editor (`PostEditor.tsx`, 1109 lines)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 49 | Inline rich-text editing: title, intro, per-section, conclusion — autosave (2s) w/ error-capture retry binding | PostEditor.tsx:195-290 (useAutoSave ×3, sectionSaveErrorCapture) | preserved (verify) | draft workspace editable doc blocks (draft-workspace.js:249-454) | Autosave/retry contract (docs/rules/rich-text-content.md) must carry over |
| 50 | Regenerate single section | PostEditor.tsx:322-341; content-posts.ts:222 | at_risk | — | No per-block regenerate visible in draft workspace |
| 51 | AI review (6-item ReviewChecklist; persisted StoredAIReview verdicts seeded on open; provenance-sensitive items never auto-pass; SERP evidence pack from brief) | PostEditor.tsx:171-192,702,719; content-posts.ts:456; FEATURE_AUDIT.md:806 | improved | 6-gate AI review w/ provenance-safe note (pipeline.js:929-953) | Prototype's gates mirror HEAD's checklist 1:1 incl. human-flag semantics — good |
| 52 | AI fix: issue-key fix + "Generate With Feedback" (section/intro/conclusion/meta/whole-post), FixDiffModal apply/dismiss, JSON-payload guards | PostEditor.tsx:385-515; content-posts.ts:471 | at_risk | gate "Resolve" link is a toast stub (pipeline.js:947) | Apply-fix diff flow has no designed home |
| 53 | Version history + revert (versions list w/ trigger detail, revert endpoint) | PostEditor.tsx:195-199,371-383; content-posts.ts:496-538 | at_risk | — | Zero versioning UI in prototype |
| 54 | Preview mode, copy-to-clipboard, unification status badge (Unified/Unify Failed/Skipped + note) | PostEditor.tsx:204-205,596-628,695 | at_risk | — | Unification surfacing matters for failed generations |
| 55 | SEO title + meta description display w/ char counts (+ meta AI-fix) | PostEditor.tsx:474-483,1021-1024 | preserved | brief/draft meta fields w/ len validation (brief-workspace.js:313-314) | |
| 56 | Planned-publish-date (set/clear) PATCH `/planned-date` | content-posts.ts:397; ContentCalendar.tsx:128-154 | preserved | scheduled stage + calendar | |

## F. Calendar (`ContentCalendar.tsx`, `useContentCalendar.ts`)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 57 | Month grid of 4 item types (brief/post/request/matrix) w/ plotted-date derivation (published > planned > created) + planned dashed-teal treatment | useContentCalendar.ts:50-148; ContentCalendar.tsx:23-50,439-500 | improved/partial | Calendar mode (pipeline.js:656-681) | **Prototype plots only scheduled+published posts — briefs/requests/matrix items and 'created' plots are dropped: at_risk sub-item** |
| 58 | Type filter pills (all/brief/post/request/matrix) + month stats (5 counters) | ContentCalendar.tsx:315-348 | at_risk | — | |
| 59 | Day detail panel: items list, open underlying artifact (deep-links per type) | ContentCalendar.tsx:109-125,502-615 | preserved | calendar event → open drawer | |
| 60 | Schedule-a-draft picker on future days (unscheduled drafts list) + unschedule (clear planned date) | ContentCalendar.tsx:94-154,504-550,596-607 | at_risk | — | Prototype calendar is display-only; scheduling happens implicitly via advance() with a hardcoded date |
| 61 | AI "Suggest dates" for unscheduled drafts + apply-one/apply-all panel | ContentCalendar.tsx:156-188,303-401; content-posts.ts:147 (suggest-dates, content-calendar-intelligence) | at_risk | — | W6.6 AI scheduling has no prototype home |
| 62 | Month nav + Today button + today highlight | ContentCalendar.tsx:403-437 | preserved | calendar nav arrows | |

## G. Planner / Matrix (`ContentPlanner.tsx`, `matrix/*`)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 63 | Templates CRUD: create/edit (sections, variables, pageType), duplicate, delete | ContentPlanner.tsx:52-64,124-133; matrix/TemplateEditor.tsx; content-templates.ts:96-211 | at_risk (depth) | Templates strip (pipeline.js:684-706) is read-only rows + "New template" toast | Editor depth (sections/variables/duplicate) undesigned |
| 64 | Matrix builder: 4-step wizard, dimension values, url/keyword pattern cross-product preview | matrix/MatrixBuilder.tsx:28-167; content-matrices.ts:73 | at_risk (depth) | "Build a matrix" button (pipeline.js:716) | Wizard undesigned |
| 65 | Matrix grid: 2-D grid + list view, status filter (8 statuses), sort (status/volume/difficulty/alpha), completion count | matrix/MatrixGrid.tsx:29-88,195-234 | improved/partial | Matrix mode grid w/ 4 statuses (pipeline.js:707-754) | **HEAD's 8 cell statuses (planned/keyword_validated/brief_generated/review/flagged/approved/draft/published) collapse to 4 in prototype — status-meaning change needs sign-off (Q1)** |
| 66 | Cell detail panel: keyword candidates w/ authority assessment posture, recommended keyword + apply, keyword validation (volume/difficulty/CPC), custom keyword, status timeline, per-cell generate-brief/send-review | matrix/CellDetailPanel.tsx:42-261; MatrixGrid.tsx:380-381 | at_risk | prototype cells are toast stubs (pipeline.js:729) | Deep cell tooling has no home |
| 67 | Bulk actions menu: send_review (send samples → approval batch) + export CSV wired; optimize/generate_briefs/generate_posts/export_docx declared but **no-op at HEAD** | ContentPlanner.tsx:88-107; MatrixGrid.tsx:263-267; content-plan-review.ts:176 (send-samples), data-export.ts:127 | preserved/partial | "Send sample for approval" + "Generate briefs for planned" (pipeline.js:748-751) | Prototype's "Generate briefs for planned" would IMPLEMENT a HEAD stub (additive win). Export CSV at_risk (#10) |
| 68 | Cell update (custom keyword, status, notes) PATCH | ContentPlanner.tsx:109-120; content-matrices.ts:148 | at_risk | — | Depends on cell panel home |
| 69 | AI keyword recommendation for cell / seed (endpoints) | content-matrices.ts:203,226; api/content.ts:282-291 | at_risk | — | No src UI caller found at HEAD (API wrappers exist) — verify consumer before dropping |
| 70 | Cannibalization check endpoints for matrices | content-matrices.ts:244,255 | at_risk | — | Pairs with #7 |
| 71 | Matrix delete; matrix update (PUT) | content-matrices.ts:113,269 | at_risk | — | No delete/update affordance in prototype matrix mode |
| 72 | Client plan review flow: send-template-review, batch-approve, public content-plan read | content-plan-review.ts:80-196 | at_risk | — | Client-facing approval loop for matrix samples; only "Send sample" survives visibly |

## H. Subscriptions / Publish tab (`ContentSubscriptions.tsx`)

| # | Capability | Evidence | Status | Home | Notes |
|---|------------|----------|--------|------|-------|
| 73 | Create subscription: 3 plans (Starter/Growth/Scale) w/ prices, topic source (strategy_gaps/ai_recommended/manual), notes | ContentSubscriptions.tsx:47-61,106-187; content-subscriptions.ts:64 | preserved | subscription drawer (pipeline.js:519-569,1091-1107) | Drawer mirrors plan cards + topic-source select. **Notes field not editable in drawer — verify** |
| 74 | Active sub summary: status badge, price, posts/mo, delivered progress bar, period end | ContentSubscriptions.tsx:190-262 | improved | capacity meter + drawer progress | Capacity ring always visible (better) |
| 75 | Pause / Resume / Delete(cancel) / Mark post delivered | ContentSubscriptions.tsx:63-77,212-274; content-subscriptions.ts:93-176 | preserved | drawer actions (pipeline.js:547-549) | |
| 76 | 5 statuses incl. `pending` + `past_due` states | ContentSubscriptions.tsx:18-24 | at_risk (partial) | drawer shows active/paused only | past_due (Stripe) badge needs a home |
| 77 | Subscription history list | ContentSubscriptions.tsx:288-320 | preserved | drawer history (pipeline.js:554-555) | |
| 78 | No-plan empty state → create | ContentSubscriptions.tsx:279-285 | improved | dashed "No content plan / Set up plan" meter (pipeline.js:504-506) | |

## I. Cross-cutting contracts (server / WS / jobs)

| # | Capability | Evidence | Status | Notes |
|---|------------|----------|--------|-------|
| 79 | WS events + React Query invalidation registry: CONTENT_REQUEST_CREATED/UPDATE, BRIEF_UPDATED, CONTENT_UPDATED, POST_UPDATED, SUGGESTED_BRIEF_UPDATED, CONTENT_SUBSCRIPTION_* | server/ws-events.ts:24-59,94; src/hooks/useWsInvalidation.ts:28-31,58,94 | preserved | Data-flow rule #1/#2 — rebuild must keep both halves |
| 80 | Background jobs: CONTENT_BRIEF_GENERATION (409 single-flight), CONTENT_BRIEF_REGENERATE, CONTENT_POST_GENERATION, CONTENT_POST_VOICE_SCORE, ai-review/ai-fix jobs; NotificationBell tracking + terminal-job watchers | useAdminBriefWorkflow.ts:170-186,543-622; useAdminPostWorkflow.ts:97-111; PostEditor.tsx:145-170 | preserved | The awaitJobResult "synchronous-feeling" pattern is an implementation detail; job platform contract is not |
| 81 | Activity logging + intelligence-slice invalidation on mutations (e.g. suggested-brief accept/dismiss/snooze) | suggested-briefs.ts:104-113; FEATURE_AUDIT.md:1135 | preserved | |
| 82 | Recommendation↔pipeline reconciliation (in-flight keyword suppression, publish-time rec resolution, issue-lens `?tab=briefs|posts` deep-links) | FEATURE_AUDIT.md:820-828; useIssueLenses.ts:59 | preserved | Deep-link targets must keep resolving after IA change (see #2) |
| 83 | MCP content tools (list/save/update briefs+posts, advance status, publish, versions/revert, send_to_client) hit the same stores | server/mcp/tools/, MCP instructions | preserved | UI rebuild must not fork data paths |

## J. New functionality proposed by the prototype (needs owner sign-off)

| # | Proposal | Prototype evidence | Notes |
|---|----------|--------------------|-------|
| N1 | Lifecycle board w/ 6 stages (queued/brief/draft/review/scheduled/published) + advance() single-CTA per card | pipeline.js:400-410,1132-1151 | Introduces `queued` + `scheduled` as first-class stages that don't exist in HEAD status unions |
| N2 | Unified Intake lane: client requests + AI suggestions + strategy work orders + decay refreshes, w/ Start / Dismiss / Send-to-client-for-topic-approval | pipeline.js:458-472,571-602,1156-1169 | Strategy-source intake requires wiring to recommendations/issue-lenses |
| N3 | Capacity meter gating (subscription quota as always-visible ring; quota-used amber state) | pipeline.js:501-517 | |
| N4 | Published tab as results surface: verdict (win/early/flat), clicks sparkline, position/impressions tiles, engagement (time-on-page + lift) | pipeline.js:765-807 | Engagement read requires GA4 per-page data not currently in the post outcome payload — data ticket |
| N5 | "Graduate to Insights Engine" on wins | pipeline.js:1154 | New cross-surface write; contract undefined |
| N6 | Content Health tab inside pipeline w/ "Queue refresh" → creates decay-sourced board card carrying loss framing | pipeline.js:809-853,1108-1114 | Overlaps seo-audit ContentDecay — dedupe decision |
| N7 | Full-page Brief workspace: per-field AI assists (angle/keywords/outline/links/meta/eeat), readiness checklist, client questionnaire (5 Qs sent as form; answers fold into brief), business-context notes | brief-workspace.js:18,244-262,342-463 | Questionnaire = new client-facing flow + new AI ops |
| N8 | Full-page Draft workspace: block-based doc, side rail w/ Run-AI-review / reminders | draft-workspace.js:249-585 | |
| N9 | Inline keyword picker fed live from Keywords surface (primary + supporting selection w/ volume/opp) | pipeline.js:1042-1085,1131 | Requires keyword-hub data wiring |
| N10 | Nudge client (reminder) on awaiting-client briefs | pipeline.js:978,1153 | New notification write |

---

## Parity Ledger reconciliation (rows touching this surface)

| Ledger row | Ledger status | Audit verdict |
|------------|---------------|---------------|
| Pipeline (`ContentPipeline · content-pipeline`) → Content Pipeline, `improved` | tools all marked `present` | **Overstated.** Board/intake/workspaces/calendar/subscription/matrix homes are real, but the following HEAD functions have no visible home despite blanket `present` marks: exports (#10, #23-24, #46), cannibalization (#7), guide (#11 — claimed `at:'guide'`, not found in pipeline.js), versions/revert (#53), AI-fix apply (#52), section regenerate (#50), request delivery/upgrade lifecycle (#31-35), matrix cell tooling (#66,68), template/matrix editor depth (#63-64), calendar scheduling interactions (#57-61), snooze (#9), search/sort/filters (#18,39,58), generation styles (#17), delete+undo (#26,37,47) |
| `ContentSubscriptions` tool row (subscription drawer note) | present | **Mostly holds** — drawer demonstrates plan CRUD, pause/resume, mark-delivered, cancel, history. Gaps: notes editing, `past_due`/`pending` states (#73,76) |
| `ContentPlanner` tool row (Matrix mode + Templates) | present | **Partial** — grid + templates strip exist; builder wizard, cell detail, 8→4 status collapse, delete/update not represented (#63-68,71) |
| Content Perf → Published tab, `improved`, gap `Closed` | — | Belongs to content-perf auditor; from this side the Published tab covers the post-level outcome readback (#45). Engagement tile is NEW data (N4) |
| Content Manager / Calendar / Subscriptions (non-nav) → `moved`, note "Verify subscription plan management depth" | — | Verified here: depth largely present (H section); calendar interactivity is the bigger loss (#60-61) |
| Brief workspace (non-nav `brief` route) → `improved` | — | Ledger mislabels: HEAD `brief` Page = MeetingBriefPage (App.tsx:394), not a content-brief route. The brief *workspace* is genuinely new (N7); no HEAD full-page brief route existed to migrate |
| Requests → Inbox, `moved` | — | The RequestManager *surface* moves, but per-request production actions embedded in ContentBriefs (C section) are unaccounted for in either row |

**Unresolved Gap/Partial for this surface after reconciliation:** the at_risk items in the tables above (#7, 9-partial, 10, 11, 14, 16, 17, 18, 21, 22, 23, 24, 26, 30, 31, 32, 34, 35, 37, 39, 43, 46, 47, 50, 52, 53, 54, 57-partial, 58, 60, 61, 63, 64, 66, 68, 69, 70, 71, 72, 76).

---

## Trade-offs: quick win vs full implementation

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Lifecycle board | Derive board columns as a *view* over existing statuses (posts.status + request.status + brief-exists), no schema change; keep `?tab=` aliases resolving to modes | New unified `piece` model with `queued`/`scheduled` stages persisted, single advance() writer through state machines | Derived mapping can misplace edge states (`error`, `generating`, `changes_requested`, matrix cells); status meaning must not silently change |
| Brief workspace | Mount existing BriefDetail editing + BriefGenerator in a full-page shell; keep regenerate-with-feedback | Per-field AI assists + readiness model + client questionnaire (N7) | Assists/questionnaire need new AI operations + client flow; shipping shell-only first loses nothing |
| Draft workspace | Reuse PostEditor (sections, autosave, checklist, fixes, versions) inside the new chrome | Block-model doc + side-rail review + gate-driven fixes | Rebuilding the editor from scratch risks losing autosave-retry, versions, section regen, unification surfacing (#49-54) |
| 6-gate review | Current ReviewChecklist rendered in gate styling (data identical) | Gate "Resolve" wired to ai-fix diff apply per gate | Losing FixDiffModal apply path if Resolve ships as navigation-only |
| Calendar | Read-only calendar mode (prototype) + keep existing schedule/unschedule via day panel | Drag/schedule interactions + AI suggest-dates panel | Shipping prototype-as-is drops W6.6 scheduling + suggest-dates (#60-61) — must not |
| Subscription drawer | Wrap existing ContentSubscriptions component in a drawer, add capacity ring | Quota-aware Start gating in intake (N3) | Low — drawer is nearly 1:1 |
| Intake lane | AiSuggested + pending client requests rendered as intake cards (existing data) | + strategy work orders (issue-lenses) + decay refreshes with queue-refresh write-back (N2/N6) | Strategy/decay sources need new wiring; snooze must be added to intake or kept as menu |
| Exports | Keep the existing Export `<Menu>` (5×CSV/JSON) + per-item export endpoints behind an overflow menu on the new header | Redesigned export/reporting surface | None — endpoints already exist; omitting the menu = silent capability loss |
| Matrix mode | Keep MatrixGrid/CellDetailPanel/TemplateEditor/MatrixBuilder as-is behind the new Matrix mode entry | Prototype's simplified grid + "Generate briefs for planned" bulk (implements HEAD's stub) | Simplified grid loses 8-status detail + cell tooling (#65-66) |

---

## Open questions (stop-and-ask — owner sign-off required)

1. **Stage-model mapping (blocking):** prototype's 6-stage lifecycle (`queued`,`scheduled` are new) vs HEAD's separate status unions (posts `generating/error/draft/review/approved`; requests 8-state; matrix cells 8-state). CLAUDE.md forbids changing a status's meaning. Who defines the canonical mapping, and are `queued`/`scheduled` new persisted statuses or derived views?
2. **Where do exports live?** Pipeline export menu (briefs/requests/matrices/templates/strategy × CSV/JSON), brief PDF/Markdown-copy/JSON-copy, post markdown/html/pdf export. No home anywhere in the prototype.
3. **Client-request production lifecycle:** deliver-URL/notes capture, brief_only→full_post upgrade, resubmit-to-client, post_review handoff — do these move to the new Inbox surface, into the pipeline drawer, or both? (Parity Ledger's "Requests → Inbox, function intact" does not cover these embedded actions.)
4. **Matrix depth:** keep CellDetailPanel (keyword candidates + authority assessment + validation + apply-recommended) and the 8 cell statuses inside Matrix mode, or intentionally simplify? Also: matrix/template delete + edit + duplicate.
5. **Cannibalization warnings + growth-tier gate (#7):** where do they surface in the new IA (board attention state? Content Health?), and does tier gating survive on this surface?
6. **Content Health dedupe:** prototype folds decay into the pipeline while seo-audit's ContentDecay (`?sub=content-decay`) still exists. One home or two? The decay-alert deep-link currently targets seo-audit.
7. **Calendar interactivity:** confirm schedule-a-draft picker, unschedule, and AI suggest-dates carry into Calendar mode (prototype is display-only), and that briefs/requests/matrix items remain plottable (or explicitly drop 'created' plotting as an owner decision).
8. **Post-editor power features:** version history + revert, section regenerate, AI-fix diff apply, unification badge, publish-with-image — confirm homes inside the draft workspace.
9. **Voice score representation:** does the numeric voice score + feedback + re-score become the "Brand voice" gate's detail view?
10. **Suggested-brief snooze** (1w/1m) — add to intake card menu, or drop deliberately?
11. **Generation style (standard/concise/hybrid)** — keep as advanced control in brief/draft workspaces?
12. **API-only endpoints with no UI caller found** (validate-keyword(s) #30, recommend-keywords #69, matrix cannibalization #70): confirm actual consumers (server-internal/MCP) before treating as UI-droppable.
13. **New proposals N1-N10** — each needs explicit sign-off (esp. N4 engagement data availability, N5 graduate-to-Insights contract, N7 client questionnaire).

---

*Audit basis: branch `ui-rebuild-phase-0` @ HEAD (post-Reconcile staging). All file:line references verified by direct read on 2026-07-02. Read-only audit; no code changed.*
