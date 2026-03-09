---
description: How to connect in-app features together. Follow when building new tools or modifying existing ones.
---

# Feature Integration Workflow

When building or modifying any tool/panel in this platform, follow these patterns to keep features connected and discoverable.

## 1. Contextual Cross-Linking

Every tool should include "Next steps" or "Tip" hints that guide users to related tools based on their current data. These are static text elements that appear conditionally.

### Pattern

```tsx
{/* Cross-link tip — only show when relevant data exists */}
{someCondition && (
  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/50 border border-zinc-800">
    <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mr-1">Next steps →</span>
    <span className="flex items-center gap-1 text-[11px] text-teal-400/80 bg-teal-500/5 px-2 py-1 rounded border border-teal-500/10">
      <IconName className="w-3 h-3" /> Action text with <strong className="text-teal-400">Tool Name</strong>
    </span>
  </div>
)}
```

### Existing cross-links (keep these updated)

| From | To | Condition | Action |
|------|----|-----------|--------|
| Site Audit Fix→ | → SEO Editor | Meta title/desc/H1/OG issues | Auto-expands + scrolls to target page |
| Site Audit Fix→ | → Schema Generator | Missing/invalid JSON-LD | Auto-generates schema for target page |
| Site Audit Fix→ | → Content Briefs | Thin content / low word count | Pre-fills keyword from page name |
| Site Audit Fix→ | → Redirects | Redirect chain issues | Navigates to tool |
| Site Audit Fix→ | → Performance | Speed / CWV issues | Navigates to tool |
| Site Audit Flag | → Client Requests | Any issue needing client sign-off | Creates request with issue context |
| Site Audit tips | → SEO Editor | Meta title/desc issues found | Static cross-link hint |
| Site Audit tips | → Redirects | Redirect chain issues found | Static cross-link hint |
| Site Audit tips | → Schema | Structured data gaps found | Static cross-link hint |
| Site Audit tips | → Performance | Speed issues found | Static cross-link hint |
| Search Console | → Keyword Strategy | Low-hanging fruit queries exist | Static cross-link hint |
| Search Console | → SEO Editor | CTR improvement opportunities | Static cross-link hint |
| Keyword Strategy gaps | → Content Briefs | Content gaps identified | Static cross-link hint |
| Rank Tracker empty | → Strategy | No keywords tracked yet | Static cross-link hint |
| Internal Links | → SEO Editor, Site Audit | After analysis | Static cross-link hint |
| Redirect Manager | → Site Audit, Dead Links | After adding redirects | Static cross-link hint |
| Anomaly Alerts | → Search Console, Analytics, Site Audit | Anomaly source matches tool | Click-through to relevant tool |
| AI Chat | → Rich blocks (metric/chart/datatable/sparkline) | AI includes structured data | Auto-rendered inline by RenderMarkdown |

### When to add a cross-link

- Tool A produces insights that Tool B can act on
- A user might not know Tool B exists
- The connection is data-driven (only show when relevant)

## 2. Navigation Integration

When adding a new tool/tab to the admin panel:

1. Add the `Page` union member in `App.tsx` (line ~54)
2. Add a lazy import for the component in `App.tsx`
3. Add an `if (tab === '...')` route in `renderContent()` with appropriate props
4. Add a sidebar nav item to the `navGroups` array in `App.tsx`
5. Each tool is a standalone lazy-loaded route — **do not** nest tools inside `SeoAudit.tsx` (split in #131)

## 3. Client Dashboard Integration

When a new admin tool produces data the client should see:

1. **Read `BRAND_DESIGN_LANGUAGE.md` first** — check the Per-Component Color Map (§ 4) and Color Decision Tree (§ 10) before choosing any colors
2. Add a summary card to `ClientDashboard.tsx` in the appropriate tab
3. Use shared primitives (`StatCard`, `MetricRing`, `SectionCard`) — see `use-primitives.md` workflow
4. Link to the relevant client tab from the overview cards
5. Ensure light mode CSS overrides exist for any new accent colors
6. **No purple in client views** — teal for actions, blue for data only
7. Update the Per-Component Color Map in `BRAND_DESIGN_LANGUAGE.md` with any new elements

## 4. Approval Workflow Integration

When a tool produces changes that need client sign-off:

1. Add "Send for Approval" batch action (see SeoEditor, SchemaSuggester, CmsEditor patterns)
2. Changes appear in the client's Approvals tab
3. Approved changes push to Webflow via API
4. Include before/after previews in the approval UI

## 5. Background Tasks

For long-running operations (audits, crawls, reports):

1. Use the `useBackgroundTasks` hook
2. Show progress in the admin panel
3. Store results server-side so they persist across refreshes
4. Add to history list if the tool supports re-running

## 6. Real-Time Updates Integration

When a feature produces data changes that should update the UI immediately:

1. **Server**: Broadcast the event via `broadcastToWorkspace(wsId, 'feature:event', data)` — see `wiring-patterns.md` §11
2. **Admin**: Add handler in `WorkspaceHome.tsx` `useWorkspaceEvents()` to refetch relevant data
3. **Client**: Add handler in `ClientDashboard.tsx` `useWorkspaceEvents()` or in the relevant tab component
4. **Existing pattern**: Activity logging auto-broadcasts via `initActivityBroadcast`; anomaly detection via `initAnomalyBroadcast`

## 7. Feature Documentation & Memory Updates

When adding or significantly modifying a feature:

1. Add/update entry in `FEATURE_AUDIT.md` with: what it does, agency value, client value, mutual value
2. Update `DESIGN_SYSTEM.md` if new UI patterns or primitives are introduced
3. Update `BRAND_DESIGN_LANGUAGE.md` Per-Component Color Map (§ 4) if any colors or UI elements changed
4. Note any new cross-links in this workflow file
4. **Update anomaly detection** — if new data source added, consider adding anomaly threshold in `anomaly-detection.ts`
5. **Update chat context** — if new data source added, wire into `buildChatContext()` (client) and admin chat context in `index.ts`
6. **Update global knowledge memories** — check the File → Memory Update Map (in memory rules) and update any affected memories. Key ones:
   - New/moved endpoints in `server/index.ts` → update **Server index.ts Section Map**
   - New server files → update **Server File Map**
   - New frontend components/tabs → update **Frontend Component Map**
   - New AI features or model changes → update **AI Feature Inventory**
   - New env vars → update **Environment Variables**
   - Changed data models → update **Workspace Interface**
