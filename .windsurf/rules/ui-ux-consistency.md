# UI/UX Consistency Rules

These rules MUST be followed when creating or modifying UI components to ensure consistent user experience across the platform.

## Rule 1: Use Shared UI Primitives

All UI components MUST use primitives from `src/components/ui/` instead of creating custom implementations.

**Required Primitives**:
- `EmptyState` - For all empty states with contextual icons and actions
- `LoadingState` - For loading with contextual messages and size variants  
- `ErrorState` - For errors with type-specific handling and recovery actions
- `StatCard` - For metric displays with consistent styling
- `SectionCard` - For all section containers
- `PageHeader` - For all page headers
- `Badge` - For status/category pills

**Why**: Ensures visual consistency, reduces code duplication, and provides a unified user experience.

**Pattern**:
```tsx
// ❌ WRONG - Custom empty state
<div className="text-center py-8">
  <p>No data</p>
</div>

// ✅ RIGHT - Use shared primitive
<EmptyState 
  icon={FileText} 
  title="No data available" 
  description="Connect your data sources to see insights here"
  action={{ label: 'Connect Google', onClick: handleConnect }}
/>
```

## Rule 2: Contextual Loading Messages

Loading states MUST explain what's happening instead of generic spinners.

**Pattern**:
```tsx
// ❌ WRONG - Generic spinner
<Loader2 className="animate-spin" />

// ✅ RIGHT - Contextual loading
<LoadingState 
  message="Calculating your traffic value..." 
  size="md" 
/>
```

**Good Examples**:
- "Calculating your traffic value..."
- "Loading approvals..."
- "Generating content brief..."
- "Running site audit..."

## Rule 3: Action-Oriented Empty States

Empty states MUST guide users to their next action with clear CTAs.

**Pattern**:
```tsx
// ❌ WRONG - Generic message
<EmptyState title="No data" />

// ✅ RIGHT - Action-oriented guidance
<EmptyState 
  title="Connect Google Search Console"
  description="See your search performance and keyword rankings"
  action={{ label: 'Connect GSC', onClick: handleConnect }}
/>
```

## Rule 4: Type-Specific Error Handling

Error states MUST categorize errors and provide appropriate recovery actions.

**Error Types**:
- `network` - Connection issues, retry button
- `data` - Data loading failures, retry button  
- `permission` - Access denied, no recovery action
- `general` - Catch-all with generic retry

**Pattern**:
```tsx
<ErrorState
  type="network"
  title="Connection error"
  message="Unable to connect to the server"
  action={{ label: 'Retry', onClick: handleRetry }}
/>
```

## Rule 5: Mobile-First Responsive Design

All components MUST be tested and work on mobile devices (320px minimum width).

**Requirements**:
- Use responsive Tailwind classes (`sm:`, `md:`, `lg:`)
- Test horizontal scrolling on mobile
- Ensure touch targets are at least 44px
- Avoid fixed widths that break mobile layout

## Rule 6: Consistent Color Coding

Use semantic color coding consistently across the platform:

**Color Meanings**:
- `teal` - Primary actions, success states, content creation
- `amber` - Warnings, attention needed, health issues
- `red` - Critical errors, urgent issues, negative sentiment
- `blue` - Information, growth opportunities, analytics
- `zinc` - Neutral text, borders, backgrounds

## Rule 7: Accessibility Standards

All interactive elements MUST meet WCAG AA standards:

**Requirements**:
- Minimum `text-[11px]` font size
- `aria-label` on icon-only buttons
- `aria-describedby` for form field descriptions
- Keyboard navigation support
- Focus indicators visible
- Sufficient color contrast ratios

## Rule 8: Loading Skeletons for Structured Data

When loading structured data (tables, lists), use skeleton components that match the final layout.

**Pattern**:
```tsx
// For data tables
<TableSkeleton rows={5} columns={4} />

// For card lists
<Skeleton lines={3} />
```

## Rule 9: Progressive Disclosure

Complex interfaces MUST use progressive disclosure to reduce cognitive load:

**Techniques**:
- Collapse advanced options by default
- Use "Show more" for long content
- Tab-based organization for complex features
- Contextual help tooltips
- Step-by-step wizards for multi-step processes

## Rule 10: Consistent Typography Hierarchy

Use the established typography scale consistently:

**Scale**:
- Page titles: `text-xl font-semibold text-zinc-100`
- Section headers: `text-sm font-semibold text-zinc-200`  
- Body text: `text-sm text-zinc-400`
- Small text: `text-[11px] text-zinc-500`

## Rule 11: Two-Column Table + Sidebar Layouts

When a data table and a sidebar of cards need to sit side-by-side with the table matching the sidebar's height:

**CSS cannot solve this alone.** CSS grid `stretch` and flex `stretch` make the shorter element match the taller one — but when the table has hundreds of rows, IT becomes the taller element and the sidebar stretches to match (useless). `max-height` with fixed values doesn't adapt to different sidebar content heights.

**Solution: measure the sidebar via `useRef` + `useEffect`, set the table's `maxHeight` to match.**

```tsx
const sidebarRef = useRef<HTMLDivElement>(null);
const [sidebarHeight, setSidebarHeight] = useState(0);

useEffect(() => {
  if (sidebarRef.current) {
    const h = sidebarRef.current.offsetHeight;
    if (h > 0 && h !== sidebarHeight) setSidebarHeight(h);
  }
});

// Layout:
<div className="flex flex-col lg:flex-row lg:items-start gap-3">
  {/* Table — height matches sidebar */}
  <div
    className="bg-zinc-900 rounded-xl border border-zinc-800 flex flex-col overflow-hidden min-w-0 lg:flex-[2]"
    style={{ maxHeight: sidebarHeight > 0 ? `${sidebarHeight}px` : undefined }}
  >
    <div className="... shrink-0">{/* header */}</div>
    <div className="overflow-y-auto flex-1 min-h-0">{/* scrollable content */}</div>
  </div>

  {/* Sidebar — ref measured, natural height */}
  <div ref={sidebarRef} className="lg:flex-1 space-y-3">
    <SectionCard>...</SectionCard>
    <SectionCard>...</SectionCard>
  </div>
</div>
```

**Key details:**
- Use `lg:items-start` on the flex container so the sidebar renders at its natural height (not stretched to match the table)
- The table container must be `flex flex-col overflow-hidden` — SectionCard's nested div structure breaks height propagation, so build the table container as a direct div
- The scroll area inside needs `flex-1 min-h-0 overflow-y-auto`
- Add `min-w-0` on the table container and row items to prevent long text from overflowing the grid width
- The `useEffect` runs on every render to catch sidebar height changes from data loading

**Anti-patterns:**
- ❌ `max-h-[500px]` — doesn't adapt to sidebar content
- ❌ CSS grid `row-span` with `auto` rows — table content determines row height, not sidebar
- ❌ SectionCard with `className="flex flex-col"` — the inner content div doesn't get `flex-1`
- ❌ `flex stretch` without `items-start` — sidebar stretches to match table, ref measures stretched height (circular)

---

**Enforcement**: These rules are checked during code review. Violations must be fixed before merge.
