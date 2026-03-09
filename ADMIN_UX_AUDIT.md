# Admin Dashboard UX Audit

> Companion to the client-side UX audit (sprint-F, #126-#134). The client dashboard received a thorough overhaul — tab extraction, inbox unification, overview slimming, performance tab merge. **The admin side has not had an equivalent pass.**

## Current Architecture

| Component | Lines | Role |
|-----------|-------|------|
| `App.tsx` | 518 | Router, sidebar, workspace selector, lazy-loaded tabs |
| `WorkspaceOverview.tsx` | 528 | Command center (no workspace selected) — cross-workspace stats, workspace cards, roadmap, platform health |
| `WorkspaceHome.tsx` | 471 | Per-workspace home — metric cards, anomaly alerts, SEO status, action items, insights, activity, rankings, requests, annotations |
| `AdminChat.tsx` | 239 | Floating chat panel with context fetching, history |

**Total admin shell**: ~1,756 lines across 4 files (excluding the 15+ tool components).

---

## Issues & Proposed Changes

### P0 — High Impact, Should Do First

#### 1. Sidebar Navigation Overload
**Problem**: 17 nav items across 5 groups (Home, Analytics×3, Site Health×4, SEO×6, Manage×3). No collapse, no search. New users see everything at once with no hierarchy.

**Proposed Changes**:
- **Collapsible sidebar groups**: Click group header to expand/collapse. Persist state in localStorage. Default: only current group + Home expanded.
- **Active-group auto-expand**: When navigating to a tool, auto-expand its group and collapse others (accordion behavior, optional).
- **Badge aggregation on collapsed groups**: When Analytics is collapsed, show a combined badge if any child has alerts.
- **Keyboard nav**: Arrow keys to move between items, Enter to select, `/` to focus search.

**Files**: `App.tsx` (sidebar rendering, ~lines 290-434)
**Est**: 1.5-2h

#### 2. Cross-Workspace Command Center Enhancements
**Problem**: `WorkspaceOverview.tsx` shows per-workspace cards with audit scores, requests, and approvals — but **no cross-workspace anomaly aggregation, no churn signals, no global notification summary**. Admin has to click into each workspace to see anomalies.

**Proposed Changes**:
- **Global anomaly banner**: Fetch `/api/anomalies` (all workspaces) and show critical/warning count at top of command center with "View" links per workspace.
- **Global churn signals**: Aggregate churn signals across workspaces. Show count + severity breakdown.
- **"Needs Your Attention" priority sort**: Re-order attention items by severity (critical anomalies > new requests > pending approvals > low health). Currently just appended in order.
- **Workspace card anomaly indicator**: Add small anomaly badge (🔴/🟡) to workspace cards when unacknowledged anomalies exist.
- **Quick-action buttons on workspace cards**: "View Anomalies", "View Requests" — jump directly to the relevant section instead of always going to Home.

**Files**: `WorkspaceOverview.tsx` (~lines 117-360), new fetch for `/api/anomalies`
**Est**: 2-3h

#### 3. WorkspaceHome Section Extraction
**Problem**: `WorkspaceHome.tsx` (471 lines) renders 7+ sections in a single component. While not as extreme as the old ClientDashboard (3265 lines), it's still a monolith that's harder to maintain and test.

**Proposed Changes**:
- Extract into section components (same pattern as client tab extraction #127):
  - `WorkspaceMetrics.tsx` — GSC + GA4 stat cards with comparison deltas
  - `WorkspaceSeoStatus.tsx` — SEO edit tracking grid (issues/in-review/approved/rejected/live)
  - `WorkspaceActionItems.tsx` — "Needs Attention" list with navigation
  - `WorkspaceActivity.tsx` — Recent activity timeline + rankings sidebar
  - `WorkspaceRequests.tsx` — Active requests + annotations cards
- Keep `WorkspaceHome.tsx` as the orchestrator (data fetching + layout), pass data as props.
- Each section gets its own ErrorBoundary.

**Files**: `WorkspaceHome.tsx` → split into `src/components/admin/` directory
**Est**: 2-3h

---

### P1 — Medium Impact, Do After P0s

#### 4. Admin Notification Bell / Global Alert Badge
**Problem**: Admin has no persistent indicator of pending work. Content request badge on sidebar only shows for Content Briefs. Anomalies, churn signals, new requests across workspaces — all invisible until you navigate to them.

**Proposed Changes**:
- **Notification bell icon** in the sidebar bottom utility bar (next to Settings, Theme, Logout).
- **Dropdown panel**: Shows aggregated counts:
  - 🔴 X critical anomalies across Y workspaces
  - ⚠️ X churn signals
  - 📬 X new client requests
  - ✅ X pending approvals
  - 📦 X unfulfilled work orders
- Each item is clickable → navigates to the relevant workspace + tool.
- **Badge dot** on bell icon when unread items exist.
- Fetches on mount + every 5 min + on WebSocket events.

**Files**: New `NotificationBell.tsx` component, wire into `App.tsx` sidebar bottom bar
**Est**: 2-3h

#### 5. Spotlight / Command Palette (⌘K)
**Problem**: With 17 nav items + N workspaces + workspace settings + global settings, finding things requires knowing the sidebar structure. Power users want keyboard-first navigation.

**Proposed Changes**:
- **⌘K command palette**: Fuzzy search across:
  - Navigation items ("Site Audit", "Rank Tracker", etc.)
  - Workspaces by name
  - Recent activity entries
  - Quick actions ("Run audit", "Generate strategy", "Scan anomalies")
- **Recent items section**: Last 5 navigated tools/workspaces.
- **Keyboard-only operation**: Arrow keys, Enter, Escape.
- Use existing ⌘ keyboard shortcut infrastructure (`App.tsx` ~line 159).

**Files**: New `CommandPalette.tsx`, wire into `App.tsx`
**Est**: 2-3h

#### 6. Workspace Quick-Switch in Header
**Problem**: Switching workspaces requires using the small dropdown in the sidebar. When working across multiple clients, this is slow.

**Proposed Changes**:
- **Workspace breadcrumb** in the main content header area: `Command Center > [Workspace Name] > [Current Tool]`
- Click workspace name → dropdown of all workspaces for quick switch.
- Click "Command Center" → return to overview.
- Shows workspace tier badge + connection status (GSC ✓, GA4 ✓) inline.

**Files**: `App.tsx` (add breadcrumb above main content area, ~line 471)
**Est**: 1-2h

---

### P2 — Quality of Life, Lower Priority

#### 7. Admin Onboarding / First-Run Experience
**Problem**: Client has `OnboardingWizard` (3-step guided first-run). Admin has nothing — new users see an empty command center with no guidance.

**Proposed Changes**:
- **First-run checklist** on Command Center when 0 workspaces exist or all are unconfigured:
  1. Create your first workspace
  2. Link a Webflow site
  3. Connect Google Search Console
  4. Connect Google Analytics
  5. Run your first site audit
  6. Set up client portal password
  7. Configure email notifications
- Progress bar at top, dismiss-able after completion.
- Each step links to the relevant settings/tool.

**Files**: New `AdminOnboarding.tsx`, wire into `WorkspaceOverview.tsx`
**Est**: 2-3h

#### 8. Sidebar Tool Descriptions / Tooltips
**Problem**: Tool names like "Internal Links", "Schema", "Content Perf" may not be self-explanatory to new team members. No descriptions anywhere.

**Proposed Changes**:
- **Hover tooltips** on sidebar items: Brief description + keyboard shortcut hint.
  - e.g., "Site Audit — Crawl and score your site's SEO health (⌘2)"
  - e.g., "Content Perf — Track how published content performs in search"
- Use a simple tooltip component (no heavy library).
- Only show after 500ms hover delay to avoid clutter for experienced users.

**Files**: `App.tsx` sidebar rendering (~lines 400-430)
**Est**: 1h

#### 9. WorkspaceHome Data Freshness Indicators
**Problem**: Dashboard shows metric cards but no indication of data age. If GSC data is 3 days stale or an audit is from last month, the admin doesn't know.

**Proposed Changes**:
- **Last updated timestamps** on each metric section: "GSC data from 2h ago", "Audit from Mar 5".
- **Stale data warning**: If audit is >14 days old, show amber indicator. If GSC/GA4 data unavailable, show connection prompt.
- **Refresh button** per section to manually re-fetch.

**Files**: `WorkspaceHome.tsx` (or extracted section components after #3)
**Est**: 1-2h

#### 10. Consistent Navigation Patterns
**Problem**: Some tools have implicit workflows (Audit → find issue → fix in Editor → submit for Approval) but no breadcrumb trail or back navigation. Users lose context.

**Proposed Changes**:
- **Contextual back link** at top of tool pages when navigated from another tool:
  - "← Back to Site Audit" when opening SEO Editor from an audit fix
  - "← Back to Home" when opening a tool from WorkspaceHome action items
- Track navigation source in a lightweight stack (last 3 navigations).
- Already partially implemented via `fixContext` prop but not surfaced in UI.

**Files**: `App.tsx` (navigation tracking), individual tool components (back link rendering)
**Est**: 1-2h

#### 11. AdminChat Improvements
**Problem**: AdminChat is a floating panel at bottom-right — functional but minimal. No workspace-awareness in the UI (doesn't show which workspace context it's using), no ability to pin/dock it, no resize.

**Proposed Changes**:
- **Workspace label** in chat header: "Chatting about [Workspace Name]"
- **Resizable panel**: Drag top edge to resize height. Persist in localStorage.
- **Expand to sidebar mode**: Toggle to dock chat as a right sidebar panel (full height).
- **Quick context refresh button**: Re-fetch context without reopening.
- **Adopt ChatPanel.tsx** for consistency with client chat (#133 — incremental adoption noted in docs).

**Files**: `AdminChat.tsx`, potentially adopt `ChatPanel.tsx`
**Est**: 2-3h

#### 12. Dark/Light Mode Polish for Admin
**Problem**: Admin has a theme toggle but some components may not be fully styled for light mode. The client dashboard has explicit light-mode CSS overrides; admin may have gaps.

**Proposed Changes**:
- Audit all admin components for light-mode rendering.
- Ensure `WorkspaceOverview`, `WorkspaceHome`, sidebar, and all tool headers respect theme.
- Add `dashboard-light` class overrides where missing.

**Files**: Various admin components, `src/index.css` or component-level styles
**Est**: 1-2h

---

## Implementation Order

### Sprint G: Admin UX Overhaul (~16-22h)

| Phase | Tasks | Est | Notes |
|-------|-------|-----|-------|
| **Phase 1** | #1 Collapsible sidebar + #3 WorkspaceHome extraction | 3.5-5h | Foundational structure changes |
| **Phase 2** | #2 Command center enhancements + #4 Notification bell | 4-6h | Cross-workspace intelligence |
| **Phase 3** | #5 Command palette + #6 Workspace breadcrumb | 3-5h | Navigation speed |
| **Phase 4** | #7 Admin onboarding + #9 Data freshness + #10 Back nav | 4-7h | Polish & discoverability |
| **Stretch** | #8 Tooltips + #11 Chat improvements + #12 Light mode | 4-6h | Nice-to-have polish |

### Dependencies
- #3 (extraction) should happen before #9 (freshness indicators) — easier to add per-section timestamps to extracted components.
- #4 (notification bell) builds on #2 (command center) — same cross-workspace data fetching.
- #5 (command palette) is independent — can be done anytime.

### What NOT to Change
- **Admin chat position**: Floating bottom-right is fine for now. Full sidebar mode is P2.
- **Sidebar width**: 200px works. Don't add a resizable sidebar — adds complexity without proportional value.
- **Tool component internals**: This audit is about admin shell/navigation UX only. Individual tool UX (SeoAudit, SearchConsole, etc.) are separate audits.
- **Client dashboard**: Already overhauled in sprint-F. No changes needed.

---

## Comparison: Client vs Admin UX Status

| Aspect | Client Dashboard | Admin Dashboard |
|--------|-----------------|-----------------|
| Tab structure | ✅ 5 clean tabs (overview, performance, health, inbox, plans) | ⚠️ 17 nav items, no grouping collapse |
| Overview density | ✅ Slimmed in #129 | ⚠️ 7 sections stacked vertically |
| Component extraction | ✅ 8 tab components extracted (#127) | ❌ WorkspaceHome is monolith |
| Cross-entity view | ✅ N/A (single workspace) | ⚠️ WorkspaceOverview exists but lacks anomaly/churn aggregation |
| Onboarding | ✅ OnboardingWizard (3-step) | ❌ None |
| Notification system | ✅ Action banners on overview | ❌ No global notification center |
| Navigation speed | ✅ Tab bar is fast | ⚠️ No search/spotlight, no quick-switch |
| Data freshness | ✅ Date picker + period comparison | ❌ No staleness indicators |
