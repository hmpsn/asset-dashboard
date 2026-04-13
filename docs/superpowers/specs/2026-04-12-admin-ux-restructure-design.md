# Admin UX Restructure — Design Spec

> **Date:** 2026-04-12
> **Origin:** 8-agent UX audit of admin dashboard (navigation, per-group layout, workflow patterns, consistency, client handoff)
> **Scope:** Information architecture, sidebar navigation, per-page layout, shared UX components, onboarding, client handoff

---

## Problem Statement

The admin dashboard has grown organically to 22+ pages with 4 nav groups. Growth has introduced:
1. **Unclear taxonomy** — ANALYTICS vs SEO grouping is confusing (both feel analytical)
2. **Bloated groups** — SEO has 6 items at the cognitive load ceiling
3. **Buried actions** — Strategy page buries config below read-only data; similar pattern across other pages
4. **Hidden pages** — 6 global pages only reachable via URL or command palette
5. **Disconnected tools** — No "what to do next" after actions, no cross-tool navigation, no unified queue
6. **No onboarding** — New workspaces dump users on Home with empty metric cards
7. **Scattered handoff** — 4+ editors each implement their own "Send to Client" pattern
8. **Inconsistent patterns** — Progress indicators, empty states, error recovery all vary per page

---

## Design Decisions

### Navigation Restructure

**Current sidebar (per-workspace):**
```
[no group]: Home, Meeting Brief
ANALYTICS:  Analytics Hub, Rank Tracker, Outcomes
SITE HEALTH: Site Audit, Performance, Links, Assets
SEO:        Strategy, Page Intelligence, SEO Editor, Schema, Brand & AI, Page Rewriter
CONTENT:    Content Pipeline, Calendar, Requests, Content Perf
```

**Proposed sidebar:**
```
[no group]: Home  (Meeting Brief becomes a Home tab)

MONITORING:   Search & Traffic, Rank Tracker, Action Results
SITE HEALTH:  Site Audit, Performance, Links, Assets
SEO STRATEGY: Strategy, Page Intelligence
OPTIMIZATION: SEO Editor, Schema, Brand & AI, Page Rewriter
CONTENT:      Pipeline, Requests, Content Perf

ADMIN:        Command Center, Prospect, AI Usage, Roadmap
[bottom bar]:  Revenue, Settings, Theme, Logout
```

**Key changes:**
- ANALYTICS → MONITORING (clarity: observing results, not doing work)
- SEO split into SEO STRATEGY (3-4 items) + OPTIMIZATION (4 items)
- Meeting Brief → tab inside Home (doesn't earn its own nav slot)
- Calendar → tab inside Pipeline (reduces nav clutter, natural Planner → Calendar flow)
- Hidden global pages surfaced in new ADMIN section
- Architecture + LLMs.txt moved out of Pipeline into SEO STRATEGY or SITE HEALTH

### Per-Page Layout Changes

**Strategy page (user-requested priority):**
- Expand Settings panel by default on first visit
- Reorder insights: Quick Wins → Low-Hanging Fruit → Content Gaps → reference sections
- Settings visible upfront (prerequisite to generation)

**Outcomes → Action Results:**
- Reorder tabs: Wins → Scorecard → Playbooks → Actions → Learnings

**Analytics Hub → Search & Traffic:**
- Reorder tabs: Overview → Annotations → Search Performance → Site Traffic

**Site Audit:**
- Move Dead Links tab → LinksPanel (unify all link workflows)
- Add visual grouping headers in remaining subtabs

**Assets (MediaTab):**
- Reorder tabs: Audit → Upload → Browse (audit is primary workflow)

**Content Pipeline:**
- Absorb Calendar as internal tab
- Move Architecture + LLMs.txt out to SEO/SITE HEALTH
- New tab order: Planner → Calendar → Briefs → Posts → Subscriptions

**Requests:**
- Split into two tabs: Signals (AdminInbox) + Requests (RequestManager)

### Shared UX Components (New)

1. **`<NextStepsCard>`** — Post-action guidance shown after audit/generate/scan completes
2. **`<WorkflowStepper>`** — Multi-step progress indicator for cross-page workflows
3. **`<ProgressIndicator>`** — Standardized async progress (step + % + detail)
4. **`<ErrorRecoveryCard>`** — Guided error recovery with retry/alternatives
5. **`<OnboardingChecklist>`** — New workspace setup wizard (link site, connect GSC, connect GA4)
6. **`<WorkspaceHealthBar>`** — Overall progress bars per tool (audit %, strategy %, content %)

### Per-Tool Onboarding Guides

Following `ContentPipelineGuide.tsx` pattern, create guides for:
- Schema workflow (scan → review → edit → publish)
- SEO Audit (severity levels, fix options, suppression)
- Keyword Strategy (SEMRush modes, business context, interpreting results)
- Page Intelligence (how to read per-page analysis)

### Client Handoff

1. **"Preview as Client" button** in workspace header — opens read-only client portal view
2. **Unified `<ApprovalModal>`** — replaces 4+ scattered "Send to Client" implementations
3. **Client activity timeline** on approval batches — viewed/approved/reminded timestamps
4. **Request-to-delivery tracker** — lifecycle view with SLA highlighting

### Platform Cohesion

1. **Cross-tool navigation links** — contextual references between related findings
2. **Per-metric stale data indicators** — freshness badges on stat cards
3. **Command palette discoverability** — search input on Home, first-visit tooltip
4. **Workspace Health Dashboard** — progress bars per tool area on Home

---

## PR Gate Structure

### PR 1: Navigation Restructure (sidebar + routes)
- Rename groups, split SEO, add ADMIN section
- Meeting Brief → Home tab
- Calendar → Pipeline tab
- Update routes.ts, Sidebar.tsx, App.tsx, Breadcrumbs.tsx
- Move Architecture/LLMs.txt tabs

### PR 2: Per-Page Layout Improvements
- Strategy page reorder (settings up, Quick Wins first)
- Outcomes tab reorder (Wins first)
- Analytics Hub tab reorder (Annotations up)
- Dead Links → LinksPanel
- Assets tab reorder (Audit first)
- Requests → Signals + Requests tabs

### PR 3: Shared UX Components
- NextStepsCard, ProgressIndicator, ErrorRecoveryCard
- Integrate into 6+ pages (Audit, Strategy, Schema, Pipeline, BrandHub, PageIntelligence)
- Consistent empty states with CTAs

### PR 4: Onboarding & Guided Flows
- OnboardingChecklist for new workspaces
- Per-tool guides (Schema, Audit, Strategy, PageIntel)
- WorkflowStepper for multi-step flows
- WorkspaceHealthBar on Home

### PR 5: Client Handoff & Platform Cohesion
- Preview as Client button + read-only mode
- Unified ApprovalModal
- Client activity timeline
- Cross-tool navigation links
- Stale data indicators
- Command palette discoverability

---

## Testing Strategy

### Component Tests
- NextStepsCard renders with actions, dismiss works
- ProgressIndicator shows correct states (idle, running, complete)
- ErrorRecoveryCard renders error + recovery options
- OnboardingChecklist tracks step completion
- WorkflowStepper shows correct active/complete states
- ApprovalModal renders preview, sends correct payload

### Integration Tests
- Sidebar renders correct groups after restructure
- Routes resolve to correct components after rename
- Dead Links renders inside LinksPanel (not SeoAudit)
- Calendar renders inside Pipeline (not standalone)
- Meeting Brief renders inside Home (not standalone)
- Preview-as-Client route returns client portal in read-only mode
- Approval modal sends batch to correct endpoint

### Regression Tests
- All existing pages still render (no broken routes)
- Navigation between pages works (no dead links)
- Workspace switching preserves new structure
- Command palette finds pages by new names
- Breadcrumbs show correct path with new groupings

### Visual/UX Tests
- Screenshot comparisons for restructured sidebar
- Empty state CTA buttons are clickable
- Strategy page shows Settings expanded on first visit
- Onboarding wizard appears for fresh workspace

---

## Files Affected (Estimated)

### Core Navigation (PR 1)
- `src/routes.ts` — Page type updates
- `src/components/layout/Sidebar.tsx` — group restructure
- `src/App.tsx` — route/tab rendering changes
- `src/components/layout/Breadcrumbs.tsx` — label updates
- `src/components/CommandPalette.tsx` — search label updates
- `src/components/WorkspaceHome.tsx` — absorb Meeting Brief

### Per-Page Layout (PR 2)
- `src/components/KeywordStrategy.tsx` — reorder sections
- `src/components/admin/outcomes/OutcomeDashboard.tsx` — reorder tabs
- `src/components/AnalyticsHub.tsx` — reorder tabs
- `src/components/SeoAudit.tsx` — remove Dead Links tab
- `src/components/LinksPanel.tsx` — add Dead Links tab
- `src/components/MediaTab.tsx` — reorder tabs
- `src/components/ContentPipeline.tsx` — absorb Calendar, remove Arch/LLMs
- `src/components/admin/AdminInbox.tsx` + `src/components/RequestManager.tsx` — merge into tabbed view

### Shared Components (PR 3)
- `src/components/ui/NextStepsCard.tsx` — NEW
- `src/components/ui/ProgressIndicator.tsx` — NEW
- `src/components/ui/ErrorRecoveryCard.tsx` — NEW
- 6+ page components updated to use them

### Onboarding (PR 4)
- `src/components/ui/OnboardingChecklist.tsx` — NEW
- `src/components/ui/WorkflowStepper.tsx` — NEW
- `src/components/ui/WorkspaceHealthBar.tsx` — NEW
- `src/components/schema/SchemaWorkflowGuide.tsx` — NEW
- `src/components/audit/SeoAuditGuide.tsx` — NEW
- `src/components/strategy/KeywordStrategyGuide.tsx` — NEW

### Client Handoff (PR 5)
- `src/components/admin/ClientPreview.tsx` — NEW
- `src/components/ui/ApprovalModal.tsx` — NEW
- `src/components/ApprovalTimeline.tsx` — NEW
- `src/components/SeoEditorWrapper.tsx` — wire to ApprovalModal
- `src/components/schema/SchemaPlanPanel.tsx` — wire to ApprovalModal
- `src/components/brand/CopyReviewPanel.tsx` — wire to ApprovalModal
