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

| From | To | Condition |
|------|----|-----------|
| Site Audit errors | → SEO Editor | Meta title/desc issues found |
| Site Audit errors | → Redirects | Redirect chain issues found |
| Site Audit errors | → Schema | Structured data gaps found |
| Site Audit errors | → Performance | Speed issues found |
| Search Console | → Keyword Strategy | Low-hanging fruit queries exist |
| Search Console | → SEO Editor | CTR improvement opportunities |
| Keyword Strategy gaps | → Content Briefs | Content gaps identified |
| Rank Tracker empty | → Strategy | No keywords tracked yet |
| Internal Links | → SEO Editor, Site Audit | After analysis |
| Redirect Manager | → Site Audit, Dead Links | After adding redirects |

### When to add a cross-link

- Tool A produces insights that Tool B can act on
- A user might not know Tool B exists
- The connection is data-driven (only show when relevant)

## 2. Navigation Integration

When adding a new tool/tab to the admin panel:

1. Add the tab to `SeoAudit.tsx`'s tab system (it's the main admin panel host)
2. Use the shared `view` state pattern for tab switching
3. Ensure the sidebar nav item exists and highlights correctly

## 3. Client Dashboard Integration

When a new admin tool produces data the client should see:

1. Add a summary card to `ClientDashboard.tsx` in the appropriate tab
2. Use shared primitives (`StatCard`, `MetricRing`, `SectionCard`)
3. Link to the relevant client tab from the overview cards
4. Ensure light mode CSS overrides exist for any new accent colors

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

## 6. Feature Documentation

When adding or significantly modifying a feature:

1. Add/update entry in `FEATURE_AUDIT.md` with: what it does, agency value, client value, mutual value
2. Update `DESIGN_SYSTEM.md` if new UI patterns are introduced
3. Note any new cross-links in this workflow file
