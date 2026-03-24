# Quick Wins + Roadmap Items — Implementation Notes

## Phase 1 — Quick Wins

### qw-1: #434 Command Palette content planner actions (30m)
- **File:** `src/components/CommandPalette.tsx`
- **What:** Add 3 actions: "Create Content Template", "Build Content Matrix", "View Content Plan"
- **How:** Each navigates to `adminPath(ws.id, 'content-pipeline')` — same pattern as existing actions

### qw-2: #428 Admin Chat content plan context (1h)
- **File:** `server/admin-chat-context.ts`
- **What:** Add template/matrix/cell counts + pipeline status to admin chat context
- **How:** Query content_templates, content_matrices, matrix_cells tables; append summary block

### qw-3: #429 Client Chat content plan context (1h)
- **File:** Find client chat context builder (likely in routes/public-chat.ts or similar)
- **What:** Add content plan summary so clients can ask "What's my content status?"
- **How:** Query published/approved matrix cells for workspace; append summary

### qw-4: #432 LLMs.txt include planned/approved content (1h)
- **File:** `server/routes/llms-txt.ts` or `server/llms-txt.ts`
- **What:** Include matrix cells with status >= approved as "upcoming content"
- **How:** Query matrix_cells WHERE status IN ('approved','published'), append section

### qw-5: #433 Move Guide tab to floating help button (1h)
- **File:** `src/components/ContentPipeline.tsx`
- **What:** Remove Guide from sub-tabs, add floating ? button that opens guide in modal/slide-over
- **How:** Reuse ContentPipelineGuide component, just change how it's triggered

## Phase 2 — Small Wins

### sw-1: #504 Churn Signals "At Risk" badge (1-2h)
- **Backend:** `server/churn-signals.ts` already computes risk
- **Endpoint:** Add churnRisk to workspace overview response
- **Frontend:** `src/components/WorkspaceOverview.tsx` — amber "At Risk" badge + filter pill

### sw-2: #508 Content Decay Prominence (1-2h)
- **Existing:** `src/components/ContentDecay.tsx` (buried sub-tab)
- **What:** Add compact alert card to ContentPipeline main view above sub-tabs
- **How:** Query decay data, show count + top 3 URLs + "View Details" link

### sw-3: #509 Approval Reminders UI (1-2h)
- **Backend:** `server/approval-reminders.ts` has send logic
- **What:** "Send Reminder" button on pending approval batches
- **How:** Add button + endpoint call + last-sent timestamp display

## Phase 3 — Bigger Items

### big-1: #500 Empty State Standardization (4-6h)
- **Step 1:** grep for empty-state patterns across 50+ files
- **Step 2:** Categorize: NoData / NoSearchResults / NeedsConnection / custom
- **Step 3:** Create 3 preset variants on existing EmptyState component
- **Step 4:** Migrate file by file (admin first, then client)

### big-2: #323 SearchTab Redesign (2h)
- **File:** `src/components/client/SearchTab.tsx`
- **What:** Insight cards at top, tables in collapsible section, 10-row default, annotations as timeline

## Phase 4 — Tests + Docs

### test-1: Tests for recent App.tsx refactor
- Hook tests: useWorkspaces, useHealthCheck, useQueue
- Component tests: Sidebar, Breadcrumbs

### docs: After each item
- FEATURE_AUDIT.md — add/update entries
- data/roadmap.json — mark items done
- .windsurfrules — update if structure changed
- Build verify: `npx tsc --noEmit --skipLibCheck && npx vite build`
