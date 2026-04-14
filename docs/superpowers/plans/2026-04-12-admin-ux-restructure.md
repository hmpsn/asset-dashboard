# Admin UX Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the admin dashboard navigation, per-page layouts, and interaction patterns to make the platform more intuitive as it has grown to 22+ pages. Five PR gates covering: nav restructure, per-page layout fixes, shared UX components, onboarding/guided flows, and client handoff.

**Spec:** `docs/superpowers/specs/2026-04-12-admin-ux-restructure-design.md`
**Pre-plan audit:** `docs/superpowers/audits/2026-04-12-admin-ux-restructure-audit.md`
**Validation pass:** 5 parallel agents verified every task against actual code (2026-04-12). Corrections below.

---

## Validation Corrections (Post-Audit)

These issues were found by validating the plan against the actual codebase. Each is incorporated into the tasks below.

### Critical Fixes Applied

1. **GLOBAL_TABS unification** — 3 separate definitions exist (routes.ts, Sidebar.tsx, App.tsx). Sidebar.tsx is missing `'features'`. Fixed: Task 1.1 adds `'features'` to Sidebar GLOBAL_TABS.
2. **PageIntelligence has no tab structure** — Plan assumed Architecture could be added as a subtab, but PageIntelligence is a single-view component. Fixed: Task 2.10 adds TabBar + tab state before Architecture tab.
3. **ContentPipelineGuide is NOT a first-visit dismissible pattern** — It's a permanent inline component. Fixed: Task 3.0 creates `useFirstVisit(key)` hook before any guide work.
4. **CopyReviewPanel uses status mutation, not endpoint** — Different from the other 4 approval patterns. Fixed: Task 5.1 ApprovalModal includes adapter mode for status-change patterns.
5. **No timeline/events in ApprovalBatch schema** — Fixed: Task 5.0 adds DB migration.

### Discrepancies Resolved

6. **Strategy page actual render order**: IntelSignals → StrategyDiff → LowHangingFruit → QuickWins → ContentGaps → SiteKeywords → Opportunities → Cannibalization → TopicClusters → KeywordGaps → Backlink → CompetitiveIntel. Task 2.5 updated with correct source order.
7. **SchemaSuggester progressMsg IS rendered** at lines 722, 776. Task 3.7 replaces existing renders instead of adding new ones.
8. **No completion state variables** in SeoAudit, KeywordStrategy, BrandHub, PageIntelligence, ContentPipeline for NextStepsCard triggers. Tasks 3.5-3.10 each add completion tracking.
9. **35+ EmptyState usages lack CTAs** — Task 3.11 scoped to top 10 highest-impact empty states; remainder deferred to follow-up.
10. **ClientDashboard has no `isAdminPreview` prop** — Task 5.3 scoped to banner + link-only preview (not full read-only mode), reducing blast radius.
11. **StatCard has no `lastUpdated` prop** — Task 5.7 adds it as optional prop.

### Pre-requisite Tasks Added

12. **Task 2.0: `useTabFromUrl(defaultTab)` hook** — needed by WorkspaceHome, Pipeline, Requests for URL-synced tabs.
13. **Task 3.0: `useFirstVisit(key)` hook** — ~~needed by all 4 guides + OnboardingChecklist~~ **REMOVED: guides use the permanent tab pattern (see PR 4 decision below); OnboardingChecklist uses localStorage directly.**
14. **Task 5.0: DB migration for approval events** — adds `events` JSON column to `approval_batches`.
15. **Workspace health metrics**: Task 4.10 composes from existing hooks (useAuditSummary, useWorkspaceHomeData) rather than new endpoint.

---

## Design Decisions (Resolved from Audit)

1. **Architecture + LLMs.txt location:** Move to SITE HEALTH group as standalone nav items (they're about site structure, not content creation). Architecture → `page-intelligence` subtab or standalone under Site Health. LLMs.txt → Workspace Settings (it's a config/deploy tool, not a daily workflow). **Decision: Architecture becomes a subtab in Page Intelligence. LLMs.txt moves to Workspace Settings.**
2. **Brief & Calendar deep links:** Redirect to parent page with correct tab selected (backward compat, no 404s).
3. **Route ID rename:** Keep `analytics-hub` as the route ID (avoids breaking bookmarks/deep links). Only rename the display label to "Search & Traffic" in Sidebar, Breadcrumbs, CommandPalette.

---

## PR 2 Lessons Learned (Apply to All Remaining PRs)

These patterns caused bugs in PR 2 and must be accounted for in PR 3–5.

### 1. Feature moves require help/guide content audit

Moving a tab or feature between components leaves stale references in guide components, tooltips, empty states, and onboarding flows. PR 2 moved Architecture and LLMs.txt out of ContentPipeline but left `ContentPipelineGuide` still documenting them — users clicking "?" saw instructions for features that no longer exist there.

**Rule for PR 3–5:** Any task that moves, renames, or removes a feature must include a grep step: `grep -rn '<feature-name>\|<tab-id>' src/components/` to find help text, guide content, tooltips, and empty state references. This is especially relevant for PR 4 (guides reference specific tab locations from PR 2).

### 2. `?tab=` deep-links are a two-halves contract

When navigating to a component with `?tab=X`, the receiving component MUST read `useSearchParams` and initialize tab state from the param. PR 2 had three components that were deep-link targets but silently ignored the param. The pattern:

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const [tab, setTab] = useState(() => {
  const param = searchParams.get('tab');
  return TABS.some(t => t.id === param) ? param : defaultTab;
});
const handleTabChange = (id: TabType) => {
  setTab(id);
  if (searchParams.has('tab')) {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }
};
```

**Rule for PR 3–5:** Any task that adds cross-tool navigation links (Task 5.6) or NextStepsCard onClick handlers (Tasks 3.5–3.10) that construct `?tab=X` URLs must verify the target component implements this pattern. The contract test at `tests/contract/tab-deep-link-wiring.test.ts` catches `adminPath(...)  + '?tab=...'` senders automatically.

### 3. pr-check escape hatches must be inline for pattern-based rules

Pattern-based rules (`excludeLines`) only check the matched line. Above-line comments are silently ignored. Only `customCheck` rules call `hasHatch()` which checks the preceding line. Always place hatches inline on the flagged line.

---

## Task Dependencies (All 5 PR Gates)

```
PR 1: Navigation Restructure
  Task 1.1 (Sidebar groups + labels) → Task 1.2 (Breadcrumbs labels) ∥ Task 1.3 (CommandPalette)
  Task 1.2 + 1.3 → Task 1.4 (App.tsx keyboard shortcuts + SEO_TABS)
  Task 1.4 → Task 1.5 (Verify + screenshot)

  ── PR 1 GATE: typecheck + build + screenshot comparison ──

PR 2: Per-Page Layout Improvements
  Task 2.1 (Meeting Brief → Home tab) ∥ Task 2.2 (Calendar → Pipeline tab) ∥ Task 2.3 (Dead Links → LinksPanel)
  Task 2.1 + 2.2 + 2.3 → Task 2.4 (App.tsx route cleanup + redirects)
  Task 2.4 → parallel batch:
    Task 2.5 (Strategy page reorder) ∥ Task 2.6 (Outcomes tab reorder) ∥ Task 2.7 (AnalyticsHub tab reorder) ∥ Task 2.8 (MediaTab tab reorder) ∥ Task 2.9 (Requests tab split)
  All 2.5-2.9 → Task 2.10 (Architecture → PageIntel subtab, LLMs.txt → WorkspaceSettings)
  Task 2.10 → Task 2.11 (Pipeline tab cleanup: remove Arch + LLMs tabs)
  Task 2.11 → Task 2.12 (Verify + test)

  ── PR 2 GATE: typecheck + build + full test suite + screenshot comparison ──

PR 3: Shared UX Components
  Task 3.1 (NextStepsCard component) ∥ Task 3.2 (ProgressIndicator component) ∥ Task 3.3 (ErrorRecoveryCard component)
  Task 3.1 + 3.2 + 3.3 → Task 3.4 (Barrel export from ui/)
  Task 3.4 → parallel integration batch:
    Task 3.5 (Integrate into SeoAudit) ∥ Task 3.6 (Integrate into KeywordStrategy) ∥ Task 3.7 (Integrate into SchemaSuggester) ∥ Task 3.8 (Integrate into ContentPipeline) ∥ Task 3.9 (Integrate into BrandHub) ∥ Task 3.10 (Integrate into PageIntelligence)
  Task 3.5-3.10 → Task 3.11 (Empty state audit: add CTAs to all empty states)
  Task 3.11 → Task 3.12 (Component tests + verify)

  ── PR 3 GATE: typecheck + build + full test suite + component tests ──

PR 4: Onboarding & Guided Flows
  Task 4.1 (OnboardingChecklist component) ∥ Task 4.2 (WorkflowStepper component) ∥ Task 4.3 (WorkspaceHealthBar component)
  Task 4.1 + 4.2 + 4.3 → Task 4.4 (Barrel export + integrate OnboardingChecklist into WorkspaceHome)
  Task 4.4 → parallel guide batch:
    Task 4.5 (SchemaWorkflowGuide) ∥ Task 4.6 (SeoAuditGuide) ∥ Task 4.7 (KeywordStrategyGuide) ∥ Task 4.8 (PageIntelligenceGuide)
  Task 4.5-4.8 → Task 4.9 (WorkflowStepper integration: content creation flow + schema deploy flow)
  Task 4.9 → Task 4.10 (WorkspaceHealthBar integration into WorkspaceHome)
  Task 4.10 → Task 4.11 (Verify + test)

  ── PR 4 GATE: typecheck + build + full test suite + visual verification ──

PR 5: Client Handoff & Platform Cohesion
  Task 5.1 (ApprovalModal component) → Task 5.2 (Wire ApprovalModal into 4+ editors)
  Task 5.1 ∥ Task 5.3 (ClientPreview read-only mode)
  Task 5.1 ∥ Task 5.4 (ApprovalTimeline component)
  Task 5.2 + 5.3 + 5.4 → Task 5.5 (App.tsx: add client-preview route)
  Task 5.5 → parallel cohesion batch:
    Task 5.6 (Cross-tool navigation links) ∥ Task 5.7 (Stale data indicators on stat cards) ∥ Task 5.8 (Command palette discoverability: Home search input + first-visit tooltip)
  Task 5.6-5.8 → Task 5.9 (Verify + test + scaled code review)

  ── PR 5 GATE: typecheck + build + full test suite + scaled-code-review ──
```

---

## PR 1 — Navigation Restructure

### Task 1.1 — Sidebar Group Restructure (Model: sonnet)

**Owns:**
- `src/components/layout/Sidebar.tsx`

**Must not touch:**
- `src/routes.ts` (no route ID changes — display-only rename)
- `src/App.tsx`

**Codebase conventions:**
- Three Laws of Color: group colors must stay consistent (blue=monitoring, emerald=health, teal=seo, amber=content)
- Read `BRAND_DESIGN_LANGUAGE.md` before writing JSX
- Check existing `ALL_GROUP_LABELS` export (used elsewhere)

- [ ] **Step 1: Rename ANALYTICS → MONITORING in `buildNavGroups()`**
  - Change `label: 'ANALYTICS'` → `label: 'MONITORING'`
  - Keep blue color scheme (Activity icon)
  - Rename `Analytics` nav label → `Search & Traffic` (keep `id: 'analytics-hub'` unchanged)
  - Rename `Outcomes` nav label → `Action Results` (keep `id: 'outcomes'`)

- [ ] **Step 2: Split SEO into SEO STRATEGY + OPTIMIZATION**
  - Create new group `SEO STRATEGY` with teal color, Target icon:
    - Strategy (`seo-strategy`)
    - Page Intelligence (`page-intelligence`)
  - Create new group `OPTIMIZATION` with teal color (slightly different shade or same), Sparkles icon:
    - SEO Editor (`seo-editor`)
    - Schema (`seo-schema`)
    - Brand & AI (`brand`, feature-flagged)
    - Page Rewriter (`rewrite`)

- [ ] **Step 3: Remove Meeting Brief and Calendar from visible nav**
  - Remove `{ id: 'brief', ... }` from the first (ungrouped) section
  - Remove `{ id: 'calendar', ... }` from CONTENT section
  - Home remains as the only ungrouped item

- [ ] **Step 4: Add ADMIN section**
  - New group at the bottom, above the utility bar
  - Label: `ADMIN`, zinc color, Settings icon
  - Items:
    - `{ id: 'outcomes-overview', label: 'Team Outcomes', icon: Trophy, needsSite: false }`
    - `{ id: 'prospect', label: 'Prospect', icon: Search, needsSite: false }`
    - `{ id: 'ai-usage', label: 'AI Usage', icon: Activity, needsSite: false }`
    - `{ id: 'roadmap', label: 'Roadmap', icon: LayoutDashboard, needsSite: false }`
    - `{ id: 'features', label: 'Features', icon: Zap, needsSite: false }`
  - These items navigate to global routes (no workspace prefix)
  - Update the onClick handler: for ADMIN items, use `navigate('/' + item.id)` instead of `adminPath(selected.id, item.id)`

- [ ] **Step 5: Update `ALL_GROUP_LABELS` export**
  - Current: `['ANALYTICS', 'SITE HEALTH', 'SEO', 'CONTENT']`
  - New: `['MONITORING', 'SITE HEALTH', 'SEO STRATEGY', 'OPTIMIZATION', 'CONTENT', 'ADMIN']`

---

### Task 1.2 — Breadcrumbs Label Update (Model: haiku)

**Owns:**
- `src/components/layout/Breadcrumbs.tsx`

**Must not touch:**
- `src/routes.ts`, `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update TAB_LABELS mapping**
  - `'analytics-hub'` → `'Search & Traffic'` (was `'Analytics'`)
  - `'outcomes'` → `'Action Results'` (was `'Outcomes'`)
  - Keep `'brief'` → `'Meeting Brief'` (for redirect support)
  - Keep `'calendar'` → `'Calendar'` (for redirect support)
  - Verify all other labels are still accurate

---

### Task 1.3 — CommandPalette Update (Model: sonnet)

**Owns:**
- `src/components/CommandPalette.tsx`

**Must not touch:**
- `src/routes.ts`, `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update NAV_ITEMS group labels**
  - `'Analytics'` → `'Monitoring'`
  - `'SEO'` items split: Strategy + Page Intelligence → `'SEO Strategy'`; Editor + Schema + Brand + Rewriter → `'Optimization'`

- [ ] **Step 2: Add ADMIN section items**
  - Add: Team Outcomes, Prospect, AI Usage, Roadmap, Features
  - Group: `'Admin'`
  - `needsSite: false` for all
  - Update navigation handler: these are global routes, use `navigate('/' + item.id)`

- [ ] **Step 3: Rename display labels**
  - Analytics Hub → Search & Traffic
  - Outcomes → Action Results
  - Remove Meeting Brief and Calendar from nav items (or mark hidden)

---

### Task 1.4 — App.tsx Navigation Updates (Model: sonnet)

**Owns:**
- `src/App.tsx`

**Must not touch:**
- `src/components/layout/Sidebar.tsx`, `src/components/layout/Breadcrumbs.tsx`

- [ ] **Step 1: Update keyboard shortcut mapping (line ~243)**
  - Keep `'1': 'home'`, `'2': 'seo-audit'`
  - Change `'3': 'analytics-hub'` → keep as `'analytics-hub'` (route ID unchanged)

- [ ] **Step 2: Update GLOBAL_TABS set (line ~159)**
  - Add `'features'` if not already present (should be)
  - Verify all ADMIN section IDs are in GLOBAL_TABS

- [ ] **Step 3: Verify SEO_TABS set (line ~344)**
  - Ensure all workspace-scoped tabs that need a linked site are listed
  - No changes needed if route IDs are unchanged

---

### Task 1.5 — PR 1 Verification (Model: sonnet)

- [ ] **Step 1: `npm run typecheck && npx vite build`**
- [ ] **Step 2: Visual verification — sidebar renders correctly with new groups**
- [ ] **Step 3: Verify ADMIN items navigate to correct global routes**
- [ ] **Step 4: Verify command palette shows new groups and items**
- [ ] **Step 5: Verify breadcrumbs show new labels**
- [ ] **Step 6: `npx tsx scripts/pr-check.ts`**
- [ ] **Step 7: Verify collapsed group localStorage still works (old group names in storage should degrade gracefully)**

---

## PR 2 — Per-Page Layout Improvements

### Task 2.1 — Meeting Brief → Home Tab (Model: sonnet)

**Owns:**
- `src/components/WorkspaceHome.tsx`

**Must not touch:**
- `src/components/admin/MeetingBrief/MeetingBriefPage.tsx` (import only)
- `src/App.tsx` (handled in Task 2.4)

- [ ] **Step 1: Add tab bar to WorkspaceHome**
  - Import `TabBar` from `src/components/ui/TabBar.tsx`
  - Add state: `const [activeTab, setActiveTab] = useState<'overview' | 'meeting-brief'>('overview')`
  - Add `<TabBar>` below the PageHeader with two tabs: "Overview" and "Meeting Brief"

- [ ] **Step 2: Conditionally render content**
  - `activeTab === 'overview'`: current WorkspaceHome content
  - `activeTab === 'meeting-brief'`: `<MeetingBriefPage workspaceId={workspaceId} />`
  - Import MeetingBriefPage lazily

- [ ] **Step 3: Handle deep link support**
  - Check URL query param `?tab=meeting-brief` on mount to set initial tab
  - This allows redirects from old `/ws/:id/brief` route

---

### Task 2.2 — Calendar → Pipeline Tab (Model: sonnet)

**Owns:**
- `src/components/ContentPipeline.tsx`

**Must not touch:**
- `src/components/ContentCalendar.tsx` (import only)
- `src/App.tsx` (handled in Task 2.4)

- [ ] **Step 1: Add 'calendar' to Pipeline TABS array**
  - Import `CalendarDays` icon from lucide-react
  - Add `{ id: 'calendar', label: 'Calendar', icon: CalendarDays }` after 'planner'
  - New order: planner → calendar → briefs → posts → subscriptions → architecture → llms-txt (Arch/LLMs removed later in Task 2.11)

- [ ] **Step 2: Update PipelineTab type**
  - Add `'calendar'` to the union

- [ ] **Step 3: Import and render ContentCalendar**
  - Lazy import: `const ContentCalendar = lazyWithRetry(() => import('./ContentCalendar').then(m => ({ default: m.ContentCalendar })))`
  - Add render case: `if (activeTab === 'calendar') return <ContentCalendar workspaceId={workspaceId} />`

- [ ] **Step 4: Remove conditional visibility**
  - Calendar was hidden when `hasContentItems === false` in Sidebar — now it's always visible as a Pipeline tab (no conditional)

---

### Task 2.3 — Dead Links → LinksPanel (Model: sonnet)

**Owns:**
- `src/components/SeoAudit.tsx` (remove Dead Links tab)
- `src/components/LinksPanel.tsx` (add Dead Links tab)

**Must not touch:**
- `src/components/LinkChecker.tsx` (import only, no changes to component itself)

- [ ] **Step 1: Remove Dead Links from SeoAudit**
  - Remove `'links'` from `AuditSubTab` type
  - Remove LinkChecker lazy import
  - Remove Dead Links entry from TABS array
  - Remove `activeTab === 'links'` render case

- [ ] **Step 2: Add Dead Links to LinksPanel**
  - Add `'dead-links'` to the TABS array as third tab (after redirects, internal)
  - Lazy import LinkChecker
  - Add render case for `activeTab === 'dead-links'`
  - Import appropriate icon (AlertTriangle or LinkIcon)

---

### Task 2.4 — App.tsx Route Cleanup + Redirects (Model: sonnet)

**Owns:**
- `src/App.tsx`

**Must not touch:**
- Components (import only)

- [ ] **Step 1: Update 'brief' route handler (line ~377)**
  - Change from rendering MeetingBriefPage to redirecting:
  - `if (tab === 'brief') return <Navigate to={adminPath(selected.id, 'home') + '?tab=meeting-brief'} replace />`
  - Or: keep rendering MeetingBriefPage inline for backward compat (simpler, less disruption)
  - **Decision: keep rendering MeetingBriefPage** — it's still a valid route, just not in the nav. The tab in WorkspaceHome is the primary discovery path.

- [ ] **Step 2: Update 'calendar' route handler (line ~388)**
  - Change from rendering ContentCalendar to redirecting:
  - `if (tab === 'calendar') return <Navigate to={adminPath(selected.id, 'content-pipeline') + '?tab=calendar'} replace />`
  - Or: keep rendering ContentCalendar for backward compat
  - **Decision: redirect** to pipeline with tab=calendar (calendar is now inside pipeline)

- [ ] **Step 3: Update 'requests' route handler (lines ~414-418)**
  - Currently renders AdminInbox + RequestManager stacked
  - Convert to a new `RequestsPage` wrapper component with tabs
  - Or: inline the tab logic directly in the renderContent function

---

### Task 2.5 — Strategy Page Reorder (Model: sonnet)

**Owns:**
- `src/components/KeywordStrategy.tsx`

**Must not touch:**
- Strategy sub-components (QuickWins, LowHangingFruit, etc.) — import only

- [ ] **Step 1: Expand Settings panel by default**
  - Change `const [settingsOpen, setSettingsOpen] = useState(false)` → `useState(true)`
  - Or: use localStorage to track first visit: `useState(() => !localStorage.getItem('strategy-settings-seen'))`

- [ ] **Step 2: Move Settings panel higher in render order**
  - Currently below Intelligence Signals — move above or immediately after the header/generate button

- [ ] **Step 3: Reorder insight sections**
  - New render order (after header + settings + progress + summary):
    1. IntelligenceSignals (alerts/context)
    2. QuickWins (highest ROI, easiest actions)
    3. LowHangingFruit (positions 4-20)
    4. ContentGaps (new content to create)
    5. KeywordGaps (competitor opportunities)
    6. TopicClusters
    7. CannibalizationAlert
    8. StrategyDiff
    9. BacklinkProfile (reference)
    10. CompetitiveIntel (reference)

- [ ] **Step 4: Add section divider between actionable and reference sections**
  - After KeywordGaps, add a subtle divider: `<div className="border-t border-zinc-800 my-6" />` with a label "Reference & Analysis"

---

### Task 2.6 — Outcomes Tab Reorder (Model: haiku)

**Owns:**
- `src/components/admin/outcomes/OutcomeDashboard.tsx`

- [ ] **Step 1: Reorder tabs array**
  - New order: wins → scorecard → playbooks → actions → learnings
  - Change default `activeTab` from `'scorecard'` to `'wins'`

---

### Task 2.7 — AnalyticsHub Tab Reorder (Model: haiku)

**Owns:**
- `src/components/AnalyticsHub.tsx`

- [ ] **Step 1: Reorder HUB_TABS array**
  - New order: overview → annotations → search-performance → site-traffic

---

### Task 2.8 — MediaTab Tab Reorder (Model: haiku)

**Owns:**
- `src/components/MediaTab.tsx`

- [ ] **Step 1: Reorder subTabs array**
  - New order: audit → upload → browse
  - Change default `activeTab` from `'upload'` to `'audit'`

---

### Task 2.9 — Requests Tab Split (Model: sonnet)

**Owns:**
- `src/App.tsx` (requests route handler only)

**Must not touch:**
- `src/components/admin/AdminInbox.tsx` (import only)
- `src/components/RequestManager.tsx` (import only)

- [ ] **Step 1: Create tabbed Requests interface in App.tsx renderContent**
  - Replace the stacked render with a tabbed view
  - Two tabs: "Signals" (AdminInbox) and "Requests" (RequestManager)
  - Use TabBar component
  - Default to "Signals" tab (most actionable)
  - Or: extract to new `src/components/admin/RequestsPage.tsx` wrapper component

- [ ] **Step 2: Pass through workspaceId to both sub-components**

---

### Task 2.10 — Architecture → Page Intelligence, LLMs.txt → Settings (Model: sonnet)

**Owns:**
- `src/components/PageIntelligence.tsx` (add Architecture subtab)
- `src/components/WorkspaceSettings.tsx` (add LLMs.txt section)

**Must not touch:**
- `src/components/ContentPipeline.tsx` (handled in Task 2.11)

- [ ] **Step 1: Add Architecture as subtab in PageIntelligence**
  - If PageIntelligence already has tabs, add "Architecture" tab
  - If not, add a TabBar with "Pages" (current content) + "Architecture"
  - Import SiteArchitecture component from wherever it currently lives

- [ ] **Step 2: Add LLMs.txt section in WorkspaceSettings**
  - Add a new section card "LLMs.txt Configuration"
  - Import LlmsTxtGenerator component
  - Render in a collapsible section at bottom of settings

---

### Task 2.11 — Pipeline Tab Cleanup (Model: haiku)

**Owns:**
- `src/components/ContentPipeline.tsx`

- [ ] **Step 1: Remove Architecture and LLMs.txt tabs**
  - Remove from TABS array
  - Remove lazy imports for SiteArchitecture and LlmsTxtGenerator
  - Remove render cases
  - Final tab order: planner → calendar → briefs → posts → subscriptions

---

### Task 2.12 — PR 2 Verification (Model: sonnet)

- [ ] **Step 1: `npm run typecheck && npx vite build`**
- [ ] **Step 2: Visual verification — all tab reorders render correctly**
- [ ] **Step 3: Verify Meeting Brief renders as Home tab**
- [ ] **Step 4: Verify Calendar renders inside Pipeline**
- [ ] **Step 5: Verify Dead Links renders inside LinksPanel**
- [ ] **Step 6: Verify Strategy page: Settings expanded, Quick Wins near top**
- [ ] **Step 7: Verify /ws/:id/brief and /ws/:id/calendar backward compat**
- [ ] **Step 8: Verify Requests shows Signals + Requests tabs**
- [ ] **Step 9: Verify Architecture in Page Intelligence, LLMs.txt in Settings**
- [ ] **Step 10: `npx vitest run` — full test suite**
- [ ] **Step 11: `npx tsx scripts/pr-check.ts`**

---

## PR 3 — Shared UX Components

### Task 3.1 — NextStepsCard Component (Model: sonnet)

**Owns:**
- `src/components/ui/NextStepsCard.tsx` (NEW)

**Must not touch:**
- Any page components (integration in later tasks)

**Codebase conventions:**
- Follow SectionCard.tsx pattern for structure
- Teal for action buttons (Three Laws of Color)
- Use lucide-react icons
- Export from barrel

- [ ] **Step 1: Create NextStepsCard component**
  ```tsx
  interface NextStep {
    label: string;
    description?: string;
    icon?: LucideIcon;
    onClick: () => void;
    estimatedTime?: string; // e.g., "2 min"
  }
  
  interface NextStepsCardProps {
    title: string; // e.g., "Audit complete: 24 issues found"
    icon?: LucideIcon;
    steps: NextStep[];
    onDismiss?: () => void;
    variant?: 'success' | 'info'; // green check vs blue info
  }
  ```
  - Renders a card with title, 2-3 action rows with → arrows, dismiss button
  - Animates in with a subtle slide-up
  - Teal CTA buttons, zinc background

---

### Task 3.2 — ProgressIndicator Component (Model: sonnet)

**Owns:**
- `src/components/ui/ProgressIndicator.tsx` (NEW)

- [ ] **Step 1: Create ProgressIndicator component**
  ```tsx
  interface ProgressIndicatorProps {
    status: 'idle' | 'running' | 'complete' | 'error';
    step?: string;        // e.g., "Crawling pages..."
    detail?: string;      // e.g., "42 of 120 pages scanned"
    percent?: number;     // 0-100
    onCancel?: () => void;
  }
  ```
  - Idle: hidden or minimal
  - Running: animated progress bar + step label + detail text + optional cancel
  - Complete: green check + "Complete" with fade-out
  - Error: red icon + error message
  - Blue progress bar (data color, not teal)

---

### Task 3.3 — ErrorRecoveryCard Component (Model: sonnet)

**Owns:**
- `src/components/ui/ErrorRecoveryCard.tsx` (NEW)

- [ ] **Step 1: Create ErrorRecoveryCard component**
  ```tsx
  interface RecoveryOption {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  }
  
  interface ErrorRecoveryCardProps {
    error: string;
    details?: string;
    options: RecoveryOption[];
    onDismiss?: () => void;
  }
  ```
  - Red/amber error styling (not teal — errors are not actions)
  - 2-3 recovery buttons (primary = retry, secondary = alternatives)
  - Collapsible details section for technical error info

---

### Task 3.4 — Barrel Export (Model: haiku)

**Owns:**
- `src/components/ui/index.ts` (if exists, add exports)

- [ ] **Step 1: Export new components from barrel**

---

### Tasks 3.5–3.10 — Integration into 6 Pages (Model: sonnet each, parallel)

Each task integrates NextStepsCard, ProgressIndicator, and/or ErrorRecoveryCard into one page.

> **PR 2 lesson:** NextStepsCard `onClick` handlers that navigate to other pages with `?tab=X` (e.g., "Go to SEO Editor" → `adminPath(wsId, 'seo-editor') + '?tab=...'`) create deep-link senders. The target component MUST implement the `useSearchParams` receiver pattern (see "PR 2 Lessons Learned" above). The contract test will catch missing receivers for `adminPath(...)` senders automatically, but verify manually for any non-standard URL construction.

**Task 3.5 — SeoAudit integration**
**Owns:** `src/components/SeoAudit.tsx`
- [ ] Add NextStepsCard after audit completes (fix critical errors → create tasks → share report)
- [ ] Replace spinner-only progress with ProgressIndicator
- [ ] Add ErrorRecoveryCard for audit errors

**Task 3.6 — KeywordStrategy integration**
**Owns:** `src/components/KeywordStrategy.tsx`
- [ ] Add NextStepsCard after strategy generates (review Quick Wins → go to Page Intelligence → set up rank tracking)
- [ ] ProgressIndicator already good (SSE streaming) — verify consistency
- [ ] Add ErrorRecoveryCard for generation errors

**Task 3.7 — SchemaSuggester integration**
**Owns:** `src/components/SchemaSuggester.tsx`
- [ ] Add NextStepsCard after scan completes (review suggestions → publish → validate with GSC)
- [ ] Add ProgressIndicator (currently `progressMsg` set but not rendered)
- [ ] Add ErrorRecoveryCard for scan errors

**Task 3.8 — ContentPipeline integration**
**Owns:** `src/components/ContentPipeline.tsx`
- [ ] Add NextStepsCard after brief creation (generate post → send for review → publish)
- [ ] Verify ProgressIndicator consistency

**Task 3.9 — BrandHub integration**
**Owns:** `src/components/BrandHub.tsx`
- [ ] Add NextStepsCard after brand voice generation (use in content pipeline → review knowledge base)
- [ ] Add ErrorRecoveryCard for generation errors

**Task 3.10 — PageIntelligence integration**
**Owns:** `src/components/PageIntelligence.tsx`
- [ ] Add NextStepsCard after page analysis (go to SEO Editor → generate brief → view in Strategy)
- [ ] Add ErrorRecoveryCard for analysis errors

---

### Task 3.11 — Empty State CTA Audit (Model: sonnet)

**Owns:** Multiple files (list each empty state found)

- [ ] **Step 1: Grep for EmptyState usage across codebase**
  - `grep -rn 'EmptyState\|emptyState\|No .* yet\|nothing here' src/components/`

- [ ] **Step 2: Add CTA buttons to every empty state that lacks one**
  - Pattern: icon + title + description + primary CTA button
  - Examples:
    - "No keywords tracked yet" → add "Start Tracking" button
    - "No activity recorded yet" → add "Run your first audit" button
    - RankingsSnapshot empty → add "Connect GSC to track rankings" button

---

### Task 3.12 — PR 3 Verification (Model: sonnet)

- [ ] **Step 1: `npm run typecheck && npx vite build`**
- [ ] **Step 2: Component tests for NextStepsCard, ProgressIndicator, ErrorRecoveryCard**
- [ ] **Step 3: Verify NextStepsCard appears after audit/strategy/schema completion**
- [ ] **Step 4: Verify ErrorRecoveryCard appears on errors (mock network failure)**
- [ ] **Step 5: Verify all empty states have CTAs**
- [ ] **Step 6: `npx vitest run` — full test suite**
- [ ] **Step 7: `npx tsx scripts/pr-check.ts`**

---

## PR 4 — Onboarding & Guided Flows

### Task 4.1 — OnboardingChecklist Component (Model: opus)

**Owns:**
- `src/components/ui/OnboardingChecklist.tsx` (NEW)

- [ ] **Step 1: Create OnboardingChecklist component**
  ```tsx
  interface OnboardingStep {
    id: string;
    label: string;
    description: string;
    completed: boolean;
    onClick: () => void;
    estimatedTime?: string;
  }
  
  interface OnboardingChecklistProps {
    steps: OnboardingStep[];
    onDismiss: () => void;
    onComplete?: () => void;
    title?: string;
  }
  ```
  - Modal-style overlay on first workspace visit
  - Checklist with checkmarks, progress bar at top
  - Steps: Link Webflow site → Connect GSC → Connect GA4 → Run first audit
  - Dismissable (stored in localStorage per workspace)
  - Celebrate on completion (confetti or green check animation)

---

### Task 4.2 — WorkflowStepper Component (Model: sonnet)

**Owns:**
- `src/components/ui/WorkflowStepper.tsx` (NEW)

- [ ] **Step 1: Create WorkflowStepper component**
  ```tsx
  interface WorkflowStep {
    number: number;
    label: string;
    completed: boolean;
    current?: boolean;
    onClick?: () => void;
  }
  
  interface WorkflowStepperProps {
    steps: WorkflowStep[];
    compact?: boolean; // horizontal inline vs. full-width bar
  }
  ```
  - Horizontal stepper bar with numbered circles
  - Green = completed, Teal = current, Zinc = future
  - Clickable steps navigate to the relevant page

---

### Task 4.3 — WorkspaceHealthBar Component (Model: sonnet)

**Owns:**
- `src/components/ui/WorkspaceHealthBar.tsx` (NEW)

- [ ] **Step 1: Create WorkspaceHealthBar component**
  ```tsx
  interface HealthMetric {
    label: string;       // e.g., "SEO Audit"
    percent: number;     // 0-100
    onClick?: () => void;
  }
  
  interface WorkspaceHealthBarProps {
    metrics: HealthMetric[];
    recommendations?: { label: string; onClick: () => void; estimatedTime?: string }[];
  }
  ```
  - Horizontal progress bars per tool area
  - "Recommended Next" section below with 2-3 action items
  - Blue progress bars (data color)

---

### Task 4.4 — Barrel Export + OnboardingChecklist Integration (Model: sonnet)

**Owns:**
- `src/components/ui/index.ts` (exports)
- `src/components/WorkspaceHome.tsx` (integrate OnboardingChecklist)

- [ ] **Step 1: Export new components**
- [ ] **Step 2: Add OnboardingChecklist to WorkspaceHome**
  - Show when workspace has no linked site AND no stored dismissal
  - Check: `!selected.webflowSiteId && !localStorage.getItem(\`onboarding-dismissed-${workspaceId}\`)`
  - Steps derive from workspace state (has site? has GSC? has GA4? has run audit?)

---

### Tasks 4.5–4.8 — Per-Tool Guides (Model: sonnet each, parallel)

**Pattern decision (2026-04-13):** All guides use the **permanent "Guide" tab pattern** — same as `SchemaWorkflowGuide.tsx` / `ContentPipelineGuide.tsx`. No first-visit overlays, no `useFirstVisit` hook. A "Guide" tab is always present in the host component's tab bar; users navigate to it explicitly. This eliminates Task 3.0 entirely.

> **PR 2 lesson:** Each guide's SECTIONS array must reference only features that actually exist as tabs/panels in its host component. Before writing any guide, read the host component's TABS array or render cases to verify current tab IDs and labels. After writing the guide, grep `src/components/` for the guide component name to ensure nothing else references stale content.

**Task 4.5 — SchemaWorkflowGuide — ✅ COMPLETE**
Already exists at `src/components/schema/SchemaWorkflowGuide.tsx` and is integrated as a "Guide" tab in SchemaSuggester (`schemaSubTab === 'guide'`). No work needed.

**Task 4.6 — SeoAuditGuide**
**Owns:** `src/components/audit/SeoAuditGuide.tsx` (NEW), modifies `src/components/SeoAudit.tsx`
- Actual SeoAudit tabs: `audit`, `history`, `aeo-review`, `content-decay`
- **CRITICAL — custom tab bar pattern:** SeoAudit does NOT use `TabBar` from `./ui`. It uses a hand-coded `auditTabBar` JSX variable (defined ~line 552) with manual `<button>` elements and a `<div>` divider. Add the "Guide" button following this same pattern at the end.
- [ ] Create guide component (follow `SchemaWorkflowGuide.tsx` structure): Issue severity levels → How to prioritize → Fix options (accept/task/review) → Suppression rules → AEO review → Content decay
- [ ] Add `'guide'` to `AuditSubTab` type definition (line 44) AND to the `valid` array at line 57 (`['audit', 'history', 'aeo-review', 'content-decay', 'guide']`)
- [ ] Add "Guide" button to `auditTabBar` variable (line ~552) — follow the existing hand-coded button pattern, NOT TabBar component
- [ ] Add `if (auditSubTab === 'guide') return <div>{auditTabBar}<SeoAuditGuide /></div>;` — place BEFORE the main render block, following the SchemaSuggester pattern at line 585

**Task 4.7 — KeywordStrategyGuide**
**Owns:** `src/components/strategy/KeywordStrategyGuide.tsx` (NEW), modifies `src/components/KeywordStrategy.tsx`
- KeywordStrategy is a single-view component (no sub-tabs, no existing TabBar). Adding requires building from scratch.
- **Use `TabBar` from `./ui`** (already exported, `TabBar` is available — PageIntelligence uses this pattern).
- [ ] Create guide component: Configure SEMRush mode → Set business context → Generate → Interpret rankings → Quick Wins → Next steps
- [ ] Add `import { TabBar } from './ui';` to KeywordStrategy imports
- [ ] Add `strategyTab` state: `const [strategyTab, setStrategyTab] = useState<'analysis' | 'guide'>('analysis');`
- [ ] Add `<TabBar tabs={[{ id: 'analysis', label: 'Analysis' }, { id: 'guide', label: 'Guide' }]} active={strategyTab} onChange={(id) => setStrategyTab(id as 'analysis' | 'guide')} />` at the top of the return JSX
- [ ] Wrap the existing content in `{strategyTab === 'analysis' && <...existing content...>}` and add `{strategyTab === 'guide' && <KeywordStrategyGuide />}`

**Task 4.8 — PageIntelligenceGuide**
**Owns:** `src/components/PageIntelligenceGuide.tsx` (NEW), modifies `src/components/PageIntelligence.tsx`
- Actual PageIntelligence tabs: `pages`, `architecture` — uses `TabBar` from `./ui` (line 597)
- [ ] Create guide component: How page analysis works → Reading optimization scores → Pages tab → Architecture tab → Taking action → Linking to SEO Editor
- [ ] Update tab type: `useState<'pages' | 'architecture' | 'guide'>('pages')`
- [ ] Add `{ id: 'guide', label: 'Guide' }` to the `tabs` array in `<TabBar>` (line 597–604)
- [ ] Update `onChange` cast: `id as 'pages' | 'architecture' | 'guide'`
- [ ] Add render block after existing architecture/pages blocks: `{activeTab === 'guide' && <PageIntelligenceGuide />}`

---

### Task 4.9 — WorkflowStepper Integration (Model: sonnet)

**Owns:**
- `src/components/ContentPipeline.tsx` (add stepper)
- `src/components/SchemaSuggester.tsx` (add stepper)

- [ ] **Step 1: Content creation workflow stepper**
  - Steps: Strategy → Content Gaps → Brief → Post → Publish (these are cross-page nav links, not Pipeline tab IDs)
  - ContentPipeline actual tabs: `planner | calendar | briefs | posts | subscriptions`
  - Each stepper step should call `navigate()` — add `import { useNavigate } from 'react-router-dom';` (currently only `useSearchParams` is imported from react-router-dom, line 2)
  - Show at top of ContentPipeline when in brief or post creation flow

- [ ] **Step 2: Schema deployment workflow stepper**
  - Steps: Scan → Review → Edit → Publish → Validate
  - SchemaSuggester already has `'generator' | 'guide'` as `SchemaSubTab` — place stepper inside the `generator` sub-tab view, above the main content
  - Show only when `schemaSubTab === 'generator'` and there is an active workflow

---

### Task 4.10 — WorkspaceHealthBar Integration (Model: sonnet)

**Owns:**
- `src/components/WorkspaceHome.tsx` (add health bar)

- [ ] **Step 1: Add WorkspaceHealthBar to WorkspaceHome**
  - All data is already available via existing hooks — do NOT add new API calls:
    - SEO Audit score/recency: `audit.siteScore` (from `useAuditSummary`)
    - Strategy generated: `homeData` from `useWorkspaceHomeData`
    - Schema / content pipeline: `intel?.contentPipeline` (from `useWorkspaceIntelligence`)
    - Content Pipeline publish rate: `contentPipeline.publishedCells / contentPipeline.totalCells`
    - Webflow linked: `webflowSiteId` prop (check `!webflowSiteId`)
  - localStorage key pattern for OnboardingChecklist: `onboarding_checklist_completed_${workspaceId}` (underscores, lowercase — matches `seo_tip_seen_${workspaceId}_${tab}` convention)
  - Show "Recommended Next" based on lowest-completion areas
  - Place above or below the existing stat cards

---

### Task 4.11 — PR 4 Verification (Model: sonnet)

- [ ] **Step 1: `npm run typecheck && npx vite build`**
- [ ] **Step 2: Verify OnboardingChecklist shows for new workspace**
- [ ] **Step 3: Verify Guide tab appears and renders in SeoAudit, KeywordStrategy, PageIntelligence**
- [ ] **Step 4: Verify WorkflowStepper renders in Pipeline + Schema flows**
- [ ] **Step 5: Verify WorkspaceHealthBar shows progress on Home**
- [ ] **Step 7: `npx vitest run` — full test suite**
- [ ] **Step 8: `npx tsx scripts/pr-check.ts`**

---

## PR 5 — Client Handoff & Platform Cohesion

### Task 5.1 — ApprovalModal Component (Model: opus)

**Owns:**
- `src/components/ui/ApprovalModal.tsx` (NEW)

- [ ] **Step 1: Create unified ApprovalModal**
  ```tsx
  interface ApprovalItem {
    id: string;
    label: string;
    preview?: string; // short description or thumbnail URL
    type: 'seo' | 'schema' | 'copy' | 'cms' | 'brief';
  }
  
  interface ApprovalModalProps {
    isOpen: boolean;
    onClose: () => void;
    workspaceId: string;
    items: ApprovalItem[];
    source: string; // e.g., "SEO Editor", "Schema Plan"
    onSend: (message?: string, deadline?: string) => Promise<void>;
  }
  ```
  - Preview grid of items being sent
  - Custom message textarea (with template suggestions)
  - Optional deadline picker
  - "Send to Client" teal CTA
  - Loading state during send

---

### Task 5.2 — Wire ApprovalModal into Editors (Model: sonnet)

**Owns:**
- `src/components/SeoEditor.tsx` (replace sendPageToClient with modal)
- `src/components/schema/SchemaPlanPanel.tsx` (replace sendToClient with modal)
- `src/components/brand/CopyReviewPanel.tsx` (replace send-to-client with modal)
- `src/components/ContentBriefs.tsx` (replace send-to-client with modal)
- `src/components/editor/ApprovalPanel.tsx` (delegate to modal)

- [ ] **Step 1: Replace each editor's ad-hoc "Send to Client" with ApprovalModal**
- [ ] **Step 2: Wire onSend callback to existing API endpoints (no backend changes needed)**
- [ ] **Step 3: Remove scattered sendingToClient/approvalSent state management from each editor**

---

### Task 5.3 — Client Preview Read-Only Mode (Model: sonnet)

**Owns:**
- `src/components/admin/ClientPreview.tsx` (NEW)

- [ ] **Step 1: Create ClientPreview wrapper component**
  - Renders ClientDashboard with `isAdminPreview={true}` prop
  - Adds a banner: "You're previewing the client portal. [Exit Preview]"
  - Read-only: disables all mutation buttons (requests, approvals, etc.)
  - Shows which client tab you're viewing

- [ ] **Step 2: Add "Preview as Client" button to workspace pages**
  - Add button in the breadcrumbs or workspace header area
  - Opens `/ws/:id/client-preview` route or a slide-over panel

---

### Task 5.4 — ApprovalTimeline Component (Model: sonnet)

**Owns:**
- `src/components/ui/ApprovalTimeline.tsx` (NEW)

- [ ] **Step 1: Create ApprovalTimeline component**
  ```tsx
  interface TimelineEvent {
    type: 'sent' | 'viewed' | 'approved' | 'rejected' | 'reminded';
    timestamp: string;
    user?: string;
    note?: string;
  }
  
  interface ApprovalTimelineProps {
    events: TimelineEvent[];
    batchId: string;
  }
  ```
  - Vertical timeline with icons per event type
  - Relative timestamps ("2 hours ago")
  - Show stale warning if pending > 3 days

---

### Task 5.5 — App.tsx Client Preview Route (Model: haiku)

**Owns:**
- `src/App.tsx` (add client-preview route handling)

- [ ] **Step 1: Add route handler for 'client-preview' tab**
  - Or: add as a separate route `/ws/:id/client-preview`

---

### Tasks 5.6–5.8 — Platform Cohesion (Model: sonnet each, parallel)

**Task 5.6 — Cross-tool navigation links**
**Owns:** Multiple page components (add contextual cross-references)

> **PR 2 lesson:** Every cross-tool link that includes `?tab=X` is a deep-link sender. Before adding a link, verify the target component reads `searchParams.get('tab')` in its `useState` initializer. Run `npx vitest run tests/contract/tab-deep-link-wiring.test.ts` after adding links to catch any broken wiring.
- [ ] Add "Related in Links panel: X broken redirects" to SeoAudit issue rows
- [ ] Add "Edit this post" button in ContentPerformance expanded rows
- [ ] Add "Related SEO issues" link in LinksPanel redirect rows

**Task 5.7 — Stale data indicators**
**Owns:** `src/components/ui/StatCard.tsx` or `src/components/workspace-home/` components
- [ ] Add `lastUpdated` prop to stat cards
- [ ] Show freshness badge: green (<15m), amber (15m-1h), red (>1h)
- [ ] Add "Refresh" button on stale metrics

**Task 5.8 — Command palette discoverability**
**Owns:** `src/components/WorkspaceHome.tsx`, `src/components/CommandPalette.tsx`
- [ ] Add "Search tools & actions" input on WorkspaceHome header
- [ ] First-visit tooltip: "Tip: Press ⌘K to quickly navigate anywhere"
- [ ] Surface top 3-4 quick actions as clickable cards on Home

---

### Task 5.9 — PR 5 Verification + Scaled Code Review (Model: opus)

- [ ] **Step 1: `npm run typecheck && npx vite build`**
- [ ] **Step 2: Verify ApprovalModal works from SEO Editor, Schema, Copy, Briefs**
- [ ] **Step 3: Verify Client Preview shows read-only client portal**
- [ ] **Step 4: Verify ApprovalTimeline renders events**
- [ ] **Step 5: Verify cross-tool navigation links work**
- [ ] **Step 6: Verify stale data indicators show on stat cards**
- [ ] **Step 7: Verify command palette discoverability on Home**
- [ ] **Step 8: `npx vitest run` — full test suite**
- [ ] **Step 9: `npx tsx scripts/pr-check.ts`**
- [ ] **Step 10: Invoke `superpowers:scaled-code-review`** (10+ files across multiple agents)

---

## Cross-Phase Contracts

### PR 1 → PR 2
- Sidebar group structure (MONITORING, SITE HEALTH, SEO STRATEGY, OPTIMIZATION, CONTENT, ADMIN)
- Route IDs unchanged (analytics-hub, seo-strategy, etc.) — only display labels changed
- GLOBAL_TABS set updated to include all ADMIN items

### PR 2 → PR 3
- WorkspaceHome has tab bar (PR 3 can add health bar to "overview" tab)
- ContentPipeline has calendar tab (PR 3 NextStepsCard can reference it)
- Strategy page has new section order (PR 3 NextStepsCard integrates after generation)

### PR 3 → PR 4
- NextStepsCard, ProgressIndicator, ErrorRecoveryCard exported from `src/components/ui/`
- Guides can import these shared components
- Empty state CTA patterns established

### PR 4 → PR 5
- OnboardingChecklist pattern can inform approval onboarding
- WorkflowStepper can be used in approval flow visualization
- WorkspaceHealthBar drives "what to do next" which links to client handoff

---

## Systemic Improvements

### Shared utilities to extract
- **`useFirstVisit(key: string)`** — hook wrapping localStorage check for first-visit detection (used by all guides + onboarding)
- **`useTabFromUrl(defaultTab: string)`** — hook to read `?tab=X` from URL and sync tab state (used by WorkspaceHome, Pipeline, Requests)

### pr-check rules to add
- **Empty states must have CTAs** — grep for `<EmptyState` without an `action` or `cta` prop
- **No orphaned routes** — every Page type value must appear in Sidebar.tsx or be in GLOBAL_TABS

### New tests required

See Testing Plan section below.

---

## Testing Plan

### PR 1: Navigation Tests

**Component tests (new file: `tests/components/sidebar-navigation.test.tsx`):**
- [ ] Sidebar renders 6 groups: (ungrouped), MONITORING, SITE HEALTH, SEO STRATEGY, OPTIMIZATION, CONTENT, ADMIN
- [ ] ADMIN items navigate to global routes (no workspace prefix)
- [ ] Meeting Brief NOT in sidebar nav
- [ ] Calendar NOT in sidebar nav
- [ ] SEO STRATEGY contains exactly: Strategy, Page Intelligence
- [ ] OPTIMIZATION contains exactly: SEO Editor, Schema, Brand & AI, Page Rewriter
- [ ] Group collapse/expand persists in localStorage
- [ ] Old localStorage collapsed groups degrade gracefully with new group names

**Component tests (new file: `tests/components/breadcrumbs-labels.test.tsx`):**
- [ ] analytics-hub → "Search & Traffic"
- [ ] outcomes → "Action Results"
- [ ] All Page type values have a label

**Component tests (new file: `tests/components/command-palette.test.tsx`):**
- [ ] All nav items present with correct groups
- [ ] ADMIN section items present
- [ ] Search finds items by new names ("Search & Traffic" finds analytics-hub)

### PR 2: Layout Tests

**Component tests (new file: `tests/components/page-layout-restructure.test.tsx`):**
- [ ] WorkspaceHome renders "Overview" and "Meeting Brief" tabs
- [ ] ContentPipeline renders Calendar tab
- [ ] LinksPanel renders Dead Links tab
- [ ] SeoAudit does NOT render Dead Links tab
- [ ] Strategy page: settings panel renders first (before insights)
- [ ] Outcomes tabs in correct order (wins first)
- [ ] AnalyticsHub tabs in correct order (annotations second)
- [ ] MediaTab tabs in correct order (audit first)
- [ ] Requests page renders Signals + Requests tabs

**Redirect tests:**
- [ ] `/ws/:id/calendar` redirects to `/ws/:id/content-pipeline`
- [ ] `/ws/:id/brief` still renders (backward compat)

### PR 3: Shared Component Tests

**Component tests (new file: `tests/components/shared-ux-components.test.tsx`):**
- [ ] NextStepsCard renders title, steps, dismiss button
- [ ] NextStepsCard dismiss calls onDismiss callback
- [ ] NextStepsCard step click calls onClick
- [ ] ProgressIndicator: idle shows nothing, running shows bar, complete shows check, error shows red
- [ ] ProgressIndicator cancel button calls onCancel
- [ ] ErrorRecoveryCard renders error message + recovery options
- [ ] ErrorRecoveryCard option click calls onClick

**Integration tests (per-page):**
- [ ] SeoAudit shows NextStepsCard after audit completion mock
- [ ] KeywordStrategy shows NextStepsCard after generation mock
- [ ] SchemaSuggester shows ProgressIndicator during scan
- [ ] Empty states across 6+ pages all have CTA buttons

### PR 4: Onboarding Tests

**Component tests (new file: `tests/components/onboarding-flows.test.tsx`):**
- [ ] OnboardingChecklist renders steps with correct completion state
- [ ] OnboardingChecklist dismiss stores in localStorage
- [ ] OnboardingChecklist does not appear on return visit (after dismiss)
- [ ] WorkflowStepper renders correct active/complete states
- [ ] WorkflowStepper click navigates to correct page
- [ ] WorkspaceHealthBar renders progress bars with correct percentages

**Guide tests:**
- [ ] SchemaWorkflowGuide renders on first visit to SchemaSuggester
- [ ] SeoAuditGuide renders on first visit to SeoAudit
- [ ] KeywordStrategyGuide renders on first visit to KeywordStrategy
- [ ] All guides hide after dismiss + localStorage set

### PR 5: Handoff Tests

**Component tests (new file: `tests/components/client-handoff.test.tsx`):**
- [ ] ApprovalModal renders item preview, message input, send button
- [ ] ApprovalModal onSend called with correct payload
- [ ] ApprovalTimeline renders events in chronological order
- [ ] ApprovalTimeline shows stale warning for pending > 3 days
- [ ] ClientPreview renders read-only banner

**Integration tests:**
- [ ] SEO Editor "Send to Client" opens ApprovalModal (not old inline button)
- [ ] Schema "Send to Client" opens ApprovalModal
- [ ] ContentBriefs "Send to Client" opens ApprovalModal
- [ ] Cross-tool links navigate to correct target page

### Test Infrastructure Additions

- [ ] **Port allocation**: Check existing range with `grep -r 'createTestContext(' tests/`. Allocate 5 new ports for integration test files.
- [ ] **Mock factories**: No new external API mocks needed (all changes are frontend)
- [ ] **Component test helpers**: May need a `renderWithRouter()` helper for navigation tests

---

## Verification Strategy

### Per-PR verification commands

```bash
# Every PR gate:
npm run typecheck && npx vite build
npx vitest run --reporter=verbose
npx tsx scripts/pr-check.ts

# PR 1 specific:
grep -c 'MONITORING\|SEO STRATEGY\|OPTIMIZATION\|ADMIN' src/components/layout/Sidebar.tsx  # should find all 4
grep 'Meeting Brief\|Calendar' src/components/layout/Sidebar.tsx  # should NOT appear as nav items

# PR 2 specific:
grep -c 'dead-links' src/components/LinksPanel.tsx   # should find 1+
grep -c 'calendar' src/components/ContentPipeline.tsx  # should find 1+
grep 'settingsOpen.*useState.*true' src/components/KeywordStrategy.tsx  # settings default open

# PR 3 specific:
grep -rn 'NextStepsCard' src/components/  # should find 6+ integrations
grep -rn 'EmptyState' src/components/ | grep -v 'action\|cta\|onClick'  # should find 0 (all have CTAs)

# PR 5 specific:
grep -rn 'ApprovalModal' src/components/  # should find 4+ wiring points
grep -c 'Send to Client' src/components/  # should find 0 inline implementations (all via modal)
```

### Visual verification (per PR)
- PR 1: Screenshot sidebar with new groups
- PR 2: Screenshot Strategy page (settings at top), Home with Meeting Brief tab, Pipeline with Calendar tab
- PR 3: Screenshot NextStepsCard after audit, ErrorRecoveryCard on error, empty states with CTAs
- PR 4: Screenshot OnboardingChecklist modal, WorkspaceHealthBar on Home, guides on first visit
- PR 5: Screenshot ApprovalModal, ClientPreview banner, cross-tool navigation links
