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

---

**Enforcement**: These rules are checked during code review. Violations must be fixed before merge.
