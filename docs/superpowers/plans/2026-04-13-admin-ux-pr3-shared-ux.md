# Admin UX PR3 — Shared UX Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 2 new shared components (NextStepsCard, ProgressIndicator), extend ErrorState with `actions[]`, migrate 6 pages from inline spinners/errors to shared primitives, and integrate completion/progress UI into 5 pages.

**Architecture:** Two new leaf components in `src/components/ui/`. ErrorState gets a backward-compatible `actions[]` prop. Each target page gets three integration points (error, loading, progress/completion) swapped from inline patterns to shared primitives. No new backend work.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Lucide React icons, Vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-04-13-admin-ux-pr3-shared-ux-design.md`
**Parent plan:** `docs/superpowers/plans/2026-04-12-admin-ux-restructure.md`

---

## Files Changed

| Category | Files |
|----------|-------|
| New | `src/components/ui/NextStepsCard.tsx`, `src/components/ui/ProgressIndicator.tsx` |
| Extended | `src/components/ui/ErrorState.tsx` (add `actions[]` prop) |
| Barrel | `src/components/ui/index.ts` (export new components) |
| Migrated | `src/components/SeoAudit.tsx`, `src/components/KeywordStrategy.tsx`, `src/components/SchemaSuggester.tsx`, `src/components/ContentPipeline.tsx`, `src/components/BrandHub.tsx`, `src/components/PageIntelligence.tsx` |
| Tests | `tests/component/NextStepsCard.test.tsx`, `tests/component/ProgressIndicator.test.tsx`, `tests/component/ErrorState.test.tsx` |

---

## Task Dependencies

```
Sequential (shared components first):
  Task 3.1 (NextStepsCard) ∥ Task 3.2 (ProgressIndicator) ∥ Task 3.3 (ErrorState extension)
  Task 3.1 + 3.2 + 3.3 → Task 3.4 (Barrel exports + component tests)

Sequential (barrel must exist before page integrations):
  Task 3.4 → parallel integration batch:
    Task 3.5 (SeoAudit) ∥ Task 3.6 (KeywordStrategy) ∥ Task 3.7 (SchemaSuggester) ∥ Task 3.8 (ContentPipeline) ∥ Task 3.9 (BrandHub) ∥ Task 3.10 (PageIntelligence)

Sequential (all integrations done before verification):
  Task 3.5–3.10 → Task 3.11 (Verification + docs)
```

---

## Task 3.1 — NextStepsCard Component (Model: sonnet)

**Owns:**
- `src/components/ui/NextStepsCard.tsx` (create)

**Must not touch:**
- `src/components/ui/index.ts` (Task 3.4)
- `src/components/ui/SectionCard.tsx` (read only)
- Any page component (Tasks 3.5–3.10)

**Codebase conventions:**
- Teal for actions (hover highlight on step rows)
- Green `CheckCircle2` for success variant, blue `Info` for info variant
- Zinc for dismiss button
- Use `SectionCard` as the outer shell (import from `./SectionCard`)
- Stagger animation: pass `staggerIndex` through to `SectionCard` (it handles `staggerFadeIn 0.4s` + `60ms * index` delay)

- [ ] **Step 1: Create `src/components/ui/NextStepsCard.tsx`**

```tsx
import { type ReactNode } from 'react';
import { CheckCircle2, Info, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { SectionCard } from './SectionCard';

interface NextStep {
  label: string;
  description?: string;
  icon?: LucideIcon;
  onClick: () => void;
  estimatedTime?: string;
}

interface NextStepsCardProps {
  title: string;
  icon?: LucideIcon;
  steps: NextStep[];
  onDismiss?: () => void;
  variant?: 'success' | 'info';
  staggerIndex?: number;
}

export function NextStepsCard({
  title,
  icon,
  steps,
  onDismiss,
  variant = 'success',
  staggerIndex,
}: NextStepsCardProps) {
  const VariantIcon = icon ?? (variant === 'success' ? CheckCircle2 : Info);
  const iconColor = variant === 'success' ? 'text-emerald-400' : 'text-blue-400';

  return (
    <SectionCard staggerIndex={staggerIndex} noPadding>
      {/* Title row */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
        <VariantIcon className={`w-4.5 h-4.5 ${iconColor} flex-shrink-0`} />
        <span className="text-sm font-semibold text-zinc-200 flex-1">{title}</span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Step rows */}
      <div className="divide-y divide-zinc-800/50">
        {steps.map((step, i) => {
          const StepIcon = step.icon;
          return (
            <button
              key={i}
              onClick={step.onClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-teal-500/5 transition-colors group"
            >
              {StepIcon && <StepIcon className="w-4 h-4 text-zinc-500 group-hover:text-teal-400 flex-shrink-0 transition-colors" />}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-zinc-300 group-hover:text-teal-300 transition-colors">{step.label}</span>
                {step.description && (
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{step.description}</p>
                )}
              </div>
              {step.estimatedTime && (
                <span className="text-[11px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded flex-shrink-0">{step.estimatedTime}</span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-teal-400 flex-shrink-0 transition-colors" />
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Verify file created without syntax errors**

Run: `npx tsc --noEmit --skipLibCheck src/components/ui/NextStepsCard.tsx 2>&1 || true`

Note: This may show module resolution issues until barrel export is added in Task 3.4. The important thing is no syntax errors in the file itself. Full typecheck happens in Task 3.4.

---

## Task 3.2 — ProgressIndicator Component (Model: sonnet)

**Owns:**
- `src/components/ui/ProgressIndicator.tsx` (create)

**Must not touch:**
- `src/components/ui/index.ts` (Task 3.4)
- Any page component (Tasks 3.5–3.10)

**Codebase conventions:**
- Blue for data/progress bars (not teal — teal is actions)
- `text-zinc-300 text-xs font-medium` for step label
- `text-zinc-500 text-xs` for detail text
- Green `CheckCircle2` for complete state
- Complete state fades out after 3s via CSS transition

- [ ] **Step 1: Create `src/components/ui/ProgressIndicator.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ProgressIndicatorProps {
  status: 'idle' | 'running' | 'complete' | 'error';
  step?: string;
  detail?: string;
  percent?: number;
  onCancel?: () => void;
  className?: string;
}

export function ProgressIndicator({
  status,
  step,
  detail,
  percent,
  onCancel,
  className = '',
}: ProgressIndicatorProps) {
  const [visible, setVisible] = useState(true);

  // Fade out after 3s when complete
  useEffect(() => {
    if (status === 'complete') {
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    }
    setVisible(true);
  }, [status]);

  // idle and error render nothing (error is ErrorState's job)
  if (status === 'idle' || status === 'error') return null;

  if (status === 'complete') {
    return (
      <div
        className={`flex items-center gap-2 px-4 py-2.5 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="text-xs font-medium text-emerald-400">Complete</span>
      </div>
    );
  }

  // status === 'running'
  const isIndeterminate = percent === undefined;

  return (
    <div className={`space-y-2 px-4 py-3 bg-zinc-900 border border-blue-500/20 rounded-xl ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {step && <span className="text-xs font-medium text-zinc-300">{step}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isIndeterminate && (
            <span className="text-[11px] text-zinc-500 font-mono">{Math.round(percent)}%</span>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-0.5 rounded text-zinc-500 hover:text-red-400 transition-colors"
              aria-label="Cancel"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
        {isIndeterminate ? (
          <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
        ) : (
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        )}
      </div>

      {detail && <p className="text-xs text-zinc-500">{detail}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify file created without syntax errors**

Run: `npx tsc --noEmit --skipLibCheck src/components/ui/ProgressIndicator.tsx 2>&1 || true`

---

## Task 3.3 — ErrorState Extension (Model: haiku)

**Owns:**
- `src/components/ui/ErrorState.tsx` (modify)

**Must not touch:**
- `src/components/ui/index.ts` (Task 3.4)
- Any page component (Tasks 3.5–3.10)

**Current state:** `ErrorState` has a single `action?: { label: string; onClick: () => void }` prop. We add `actions?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }[]` as a plural form. When `actions` is provided it takes precedence over `action`. Backward-compatible — all existing call sites continue to work.

- [ ] **Step 1: Add `actions` prop to interface**

In `src/components/ui/ErrorState.tsx`, update the interface (around line 3):

```typescript
interface ErrorStateProps {
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  actions?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  }[];
  type?: 'network' | 'data' | 'permission' | 'general';
  className?: string;
}
```

- [ ] **Step 2: Destructure `actions` in the component**

Update the destructure at line 14 to include `actions`:

```tsx
export function ErrorState({ 
  title = 'Something went wrong', 
  message = 'Please try again or contact support if the issue persists.',
  action,
  actions,
  type = 'general',
  className = ''
}: ErrorStateProps) {
```

- [ ] **Step 3: Replace the single-action button rendering with multi-action support**

Replace the `{action && (` block (lines 43-51) with:

```tsx
      {(actions ?? (action ? [{ ...action, variant: 'primary' as const }] : [])).length > 0 && (
        <div className="flex items-center gap-2">
          {(actions ?? (action ? [{ ...action, variant: 'primary' as const }] : [])).map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                a.variant === 'secondary'
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  : 'bg-teal-600 hover:bg-teal-500 text-white'
              }`}
            >
              {a.variant !== 'secondary' && <RefreshCw className="w-3 h-3" />}
              {a.label}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Verify backward compatibility**

Existing callers pass `action={{ label: '...', onClick: fn }}` — the new code wraps it in an array with `variant: 'primary'`. No existing call sites break.

Run: `npx tsc --noEmit --skipLibCheck src/components/ui/ErrorState.tsx 2>&1 || true`

---

## Task 3.4 — Barrel Exports + Component Tests (Model: sonnet)

**Owns:**
- `src/components/ui/index.ts` (modify)
- `tests/component/NextStepsCard.test.tsx` (create)
- `tests/component/ProgressIndicator.test.tsx` (create)
- `tests/component/ErrorState.test.tsx` (create)

**Must not touch:**
- Any page component (Tasks 3.5–3.10)

**Depends on:** Tasks 3.1, 3.2, 3.3

- [ ] **Step 1: Add exports to barrel file**

In `src/components/ui/index.ts`, add after the `ErrorState` export line (line 15):

```typescript
export { NextStepsCard } from './NextStepsCard';
export { ProgressIndicator } from './ProgressIndicator';
```

- [ ] **Step 2: Write NextStepsCard tests**

Create `tests/component/NextStepsCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextStepsCard } from '../../src/components/ui/NextStepsCard';
import { Zap } from 'lucide-react';

describe('NextStepsCard', () => {
  const defaultSteps = [
    { label: 'Step 1', onClick: vi.fn() },
    { label: 'Step 2', description: 'Details here', onClick: vi.fn(), estimatedTime: '2 min' },
  ];

  it('renders title and steps', () => {
    render(<NextStepsCard title="Audit complete" steps={defaultSteps} />);
    expect(screen.getByText('Audit complete')).toBeInTheDocument();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });

  it('renders step description and estimated time', () => {
    render(<NextStepsCard title="Done" steps={defaultSteps} />);
    expect(screen.getByText('Details here')).toBeInTheDocument();
    expect(screen.getByText('2 min')).toBeInTheDocument();
  });

  it('calls onClick when step is clicked', () => {
    const onClick = vi.fn();
    render(<NextStepsCard title="Done" steps={[{ label: 'Go', onClick }]} />);
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<NextStepsCard title="Done" steps={defaultSteps} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not render dismiss button when onDismiss is not provided', () => {
    render(<NextStepsCard title="Done" steps={defaultSteps} />);
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
  });

  it('renders custom step icon', () => {
    render(
      <NextStepsCard
        title="Done"
        steps={[{ label: 'Quick', onClick: vi.fn(), icon: Zap }]}
      />
    );
    // Zap icon renders as an SVG — step still renders
    expect(screen.getByText('Quick')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write ProgressIndicator tests**

Create `tests/component/ProgressIndicator.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProgressIndicator } from '../../src/components/ui/ProgressIndicator';

describe('ProgressIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ProgressIndicator status="idle" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when error', () => {
    const { container } = render(<ProgressIndicator status="error" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders step label and detail when running', () => {
    render(<ProgressIndicator status="running" step="Crawling..." detail="42 of 120 pages" />);
    expect(screen.getByText('Crawling...')).toBeInTheDocument();
    expect(screen.getByText('42 of 120 pages')).toBeInTheDocument();
  });

  it('renders percent when provided', () => {
    render(<ProgressIndicator status="running" percent={35} />);
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('does not render percent when indeterminate', () => {
    render(<ProgressIndicator status="running" step="Loading..." />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders cancel button when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<ProgressIndicator status="running" step="Working..." onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders complete state with green check', () => {
    render(<ProgressIndicator status="complete" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('fades out after 3s when complete', () => {
    vi.useFakeTimers();
    const { container } = render(<ProgressIndicator status="complete" />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain('opacity-100');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(wrapper.className).toContain('opacity-0');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 4: Write ErrorState extension tests**

Create `tests/component/ErrorState.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '../../src/components/ui/ErrorState';

describe('ErrorState', () => {
  it('renders defaults', () => {
    render(<ErrorState />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders single action (backward compat)', () => {
    const onClick = vi.fn();
    render(<ErrorState action={{ label: 'Retry', onClick }} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders multiple actions', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    render(
      <ErrorState
        actions={[
          { label: 'Retry', onClick: primary, variant: 'primary' },
          { label: 'Go Back', onClick: secondary, variant: 'secondary' },
        ]}
      />
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(primary).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Go Back'));
    expect(secondary).toHaveBeenCalledOnce();
  });

  it('actions takes precedence over action', () => {
    const actionsClick = vi.fn();
    const actionClick = vi.fn();
    render(
      <ErrorState
        action={{ label: 'Single', onClick: actionClick }}
        actions={[{ label: 'Multi', onClick: actionsClick }]}
      />
    );
    expect(screen.queryByText('Single')).not.toBeInTheDocument();
    expect(screen.getByText('Multi')).toBeInTheDocument();
  });

  it('secondary actions have zinc styling (no RefreshCw icon)', () => {
    render(
      <ErrorState
        actions={[{ label: 'Back', onClick: vi.fn(), variant: 'secondary' }]}
      />
    );
    const btn = screen.getByText('Back').closest('button')!;
    expect(btn.className).toContain('bg-zinc-800');
  });
});
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run tests/component/NextStepsCard.test.tsx tests/component/ProgressIndicator.test.tsx tests/component/ErrorState.test.tsx --reporter=verbose`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/NextStepsCard.tsx src/components/ui/ProgressIndicator.tsx src/components/ui/ErrorState.tsx src/components/ui/index.ts tests/component/NextStepsCard.test.tsx tests/component/ProgressIndicator.test.tsx tests/component/ErrorState.test.tsx
git commit -m "feat(admin-ux-pr3): add NextStepsCard, ProgressIndicator, extend ErrorState actions[]"
```

---

## Task 3.5 — Integrate into SeoAudit (Model: sonnet)

**Owns:**
- `src/components/SeoAudit.tsx`

**Must not touch:**
- All other page components
- `src/components/ui/*` (read only)

**Depends on:** Task 3.4

**Current patterns to replace (from codebase scan):**
- **Loading** (lines 634-644): Full-section `<Loader2 className="w-6 h-6 animate-spin" />` centered with contextual text
- **Error** (lines 650-659): Inline `bg-red-500/10 border border-red-500/30` red box with "SEO Audit Failed" title, no retry in ErrorState format
- **NextStepsCard:** No completion state UI — add `showNextSteps` state
- **ProgressIndicator:** No `bulkProgress` in SeoAudit (spec mentions it but the actual component has none — it uses a simple boolean `loading` state). Skip ProgressIndicator for SeoAudit.

**PR2 lesson check:** NextStepsCard onClick handlers may construct `?tab=` URLs. Verify any target implements the receiver pattern or uses simple navigation without tabs.

- [ ] **Step 1: Add imports at top of file**

Add to the existing import section at the top of `src/components/SeoAudit.tsx`:

```typescript
import { ErrorState } from './ui/ErrorState';
import { LoadingState } from './ui/LoadingState';
import { NextStepsCard } from './ui/NextStepsCard';
```

- [ ] **Step 2: Add `showNextSteps` state**

After the existing state declarations (near line 72), add:

```typescript
const [showNextSteps, setShowNextSteps] = useState(false);
```

- [ ] **Step 3: Set `showNextSteps` on completion**

In the audit completion handler (where `setLoading(false)` is called after successful data, around line 375), add:

```typescript
setShowNextSteps(true);
```

Also reset on new audit start (where `setLoading(true)` is called):

```typescript
setShowNextSteps(false);
```

- [ ] **Step 4: Replace loading spinner (lines 634-644)**

Replace:
```tsx
if (loading) {
  return (
    <div>
      {auditTabBar}
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm">Scanning pages for SEO issues...</p>
        <p className="text-xs text-zinc-500">Fetching metadata and published HTML for each page</p>
      </div>
    </div>
  );
}
```

With:
```tsx
if (loading) {
  return (
    <div>
      {auditTabBar}
      <LoadingState message="Analyzing site health..." />
    </div>
  );
}
```

- [ ] **Step 5: Replace error display (lines 650-659)**

Replace the inline error div:
```tsx
{auditError && (
  <div className="flex flex-col items-center justify-center py-16 gap-4">
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md text-center">
      <p className="text-red-400 text-sm font-medium mb-1">SEO Audit Failed</p>
      <p className="text-xs text-red-400/70">{auditError}</p>
    </div>
    <button onClick={runAudit} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-400 text-[#0f1219]">
      Try Again
    </button>
  </div>
```

With:
```tsx
{auditError && (
  <ErrorState
    type="general"
    title="SEO Audit Failed"
    message={auditError}
    action={{ label: 'Run Again', onClick: runAudit }}
  />
```

- [ ] **Step 6: Add NextStepsCard after data loads**

After the error block (still inside the `!data` early return), or in the main data render section, add the NextStepsCard. Place it after the tab bar and before the main content sections when `data` is present:

```tsx
{showNextSteps && data && (
  <NextStepsCard
    title={`Audit complete: ${(data.errors?.length ?? 0) + (data.warnings?.length ?? 0)} issues found`}
    variant="success"
    onDismiss={() => setShowNextSteps(false)}
    staggerIndex={0}
    steps={[
      {
        label: 'Apply top fixes',
        description: `${data.errors?.length ?? 0} errors to resolve`,
        onClick: () => { /* scroll to errors section or switch tab */ },
        estimatedTime: '5 min',
      },
      {
        label: 'Export report',
        onClick: () => { /* trigger export if available */ },
      },
    ]}
  />
)}
```

Note: Adjust the onClick handlers based on what actions are actually available in SeoAudit. If export doesn't exist, use only the first step. The exact steps should match available functionality — check if `exportReport` or similar function exists in the component.

- [ ] **Step 7: Clean up unused imports**

If `Loader2` is no longer used in any full-section context (check if it's still used in button-inline spinners), keep it. Only remove if truly unused. `AlertCircle` may still be used elsewhere — check before removing.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npx vite build`

---

## Task 3.6 — Integrate into KeywordStrategy (Model: sonnet)

**Owns:**
- `src/components/KeywordStrategy.tsx`

**Must not touch:**
- All other page components
- `src/components/ui/*` (read only)

**Depends on:** Task 3.4

**Current patterns to replace (from codebase scan):**
- **Error** (lines 529-533): Inline `bg-red-500/10 border border-red-500/30` with AlertCircle + text. No retry.
- **Progress** (lines 510-527): Hand-rolled progress box with `Loader2`, `stepLabels`, percent, and progress bar. Uses `teal-500/20` border (should become blue per spec).
- **Loading:** Button-inline spinners only (line 300) — do NOT replace these, they're button context.
- **NextStepsCard:** Add `showNextSteps` state. Triggered when SSE `done` event fires.

**PR2 lesson check:** NextStepsCard "Review Quick Wins" step — verify this scrolls to a section, not a tab navigation. No `?tab=` URLs needed here.

- [ ] **Step 1: Add imports at top of file**

```typescript
import { ErrorState } from './ui/ErrorState';
import { ProgressIndicator } from './ui/ProgressIndicator';
import { NextStepsCard } from './ui/NextStepsCard';
```

- [ ] **Step 2: Add `showNextSteps` state**

After existing state declarations (near line 69):

```typescript
const [showNextSteps, setShowNextSteps] = useState(false);
```

- [ ] **Step 3: Set `showNextSteps` on SSE completion**

In the SSE handler where `evt.done && evt.strategy` is checked (around line 182):

```typescript
setShowNextSteps(true);
```

Reset when generation starts (where `setGenerating(true)` is called):

```typescript
setShowNextSteps(false);
```

- [ ] **Step 4: Replace hand-rolled progress indicator (lines 510-527)**

Replace:
```tsx
{generating && progressStep && (
  <div className="bg-zinc-900 border border-teal-500/20 p-4 space-y-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
        <span className="text-xs font-medium text-zinc-200">{stepLabels[progressStep] || progressStep}</span>
      </div>
      <span className="text-[11px] text-zinc-500 font-mono">{Math.round(progressPct * 100)}%</span>
    </div>
    <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-teal-500 to-teal-400 rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.round(progressPct * 100)}%` }}
      />
    </div>
    <p className="text-[11px] text-zinc-500">{progressDetail}</p>
  </div>
)}
```

With:
```tsx
<ProgressIndicator
  status={generating ? 'running' : 'idle'}
  step={stepLabels[progressStep] || progressStep}
  detail={progressDetail}
  percent={progressPct !== undefined ? Math.round(progressPct * 100) : undefined}
/>
```

Note: `progressPct` in KeywordStrategy is 0-1 (fractional), so multiply by 100 for percent. If `progressPct` is already 0 when idle, the `status='idle'` will hide the component.

- [ ] **Step 5: Replace error display (lines 529-533)**

Replace:
```tsx
{error && (
  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-xs text-red-400 flex items-center gap-2">
    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
  </div>
)}
```

With:
```tsx
{error && (
  <ErrorState
    type="general"
    title="Strategy Generation Failed"
    message={error}
    action={{ label: 'Try Again', onClick: handleGenerate }}
  />
)}
```

- [ ] **Step 6: Add NextStepsCard after strategy loads**

After the progress/error section, when strategy is populated:

```tsx
{showNextSteps && strategy && !generating && (
  <NextStepsCard
    title="Strategy ready"
    variant="success"
    onDismiss={() => setShowNextSteps(false)}
    staggerIndex={0}
    steps={[
      {
        label: 'Review Quick Wins',
        description: `${strategy.quickWins?.length ?? 0} opportunities identified`,
        onClick: () => {
          // Scroll to QuickWins section
          document.getElementById('quick-wins')?.scrollIntoView({ behavior: 'smooth' });
        },
        estimatedTime: '2 min',
      },
      {
        label: 'Set up rank tracking',
        onClick: () => navigate(adminPath(workspaceId, 'rank-tracker')),
      },
    ]}
  />
)}
```

Note: Verify that `navigate` and `adminPath` are already imported/available. Verify `strategy.quickWins` exists — check the actual property name on the strategy object.

- [ ] **Step 7: Clean up unused imports if applicable**

Check if `AlertCircle` is still used elsewhere in the file. If the progress indicator was the only use of `Loader2` in a non-button context, verify it's still needed for button spinners.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npx vite build`

---

## Task 3.7 — Integrate into SchemaSuggester (Model: sonnet)

**Owns:**
- `src/components/SchemaSuggester.tsx`

**Must not touch:**
- All other page components
- `src/components/ui/*` (read only)

**Depends on:** Task 3.4

**Current patterns to replace (from codebase scan):**
- **Loading** (lines 717-728): Full-section `<Loader2 className="w-6 h-6 animate-spin" />` centered with `progressMsg`
- **Error** (lines 731-742): Centered `AlertCircle` + red text + Retry button, no ErrorState usage
- **Progress** (lines 773-781): Inline banner with `Loader2` + `progressMsg` while streaming
- **NextStepsCard:** No completion UI. Triggered when `loading === false && data !== null`

- [ ] **Step 1: Add imports at top of file**

```typescript
import { ErrorState } from './ui/ErrorState';
import { LoadingState } from './ui/LoadingState';
import { ProgressIndicator } from './ui/ProgressIndicator';
import { NextStepsCard } from './ui/NextStepsCard';
```

- [ ] **Step 2: Add `showNextSteps` state**

After existing state declarations (near line 88):

```typescript
const [showNextSteps, setShowNextSteps] = useState(false);
```

- [ ] **Step 3: Set completion triggers**

When scan completes (where `setLoading(false)` + data is populated, around line 196):
```typescript
setShowNextSteps(true);
```

Reset on new scan start (where `setLoading(true)` is called):
```typescript
setShowNextSteps(false);
```

- [ ] **Step 4: Replace loading spinner (lines 717-728)**

Replace:
```tsx
if (loading && (!data || data.length === 0)) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
      {schemaTabBar}
      <Loader2 className="w-6 h-6 animate-spin" />
      <p className="text-sm">{progressMsg || 'Scanning pages for schema opportunities...'}</p>
      <p className="text-xs text-zinc-500">Results will appear as each batch completes</p>
      <button onClick={stopScan} className="...">Stop</button>
    </div>
  );
}
```

With:
```tsx
if (loading && (!data || data.length === 0)) {
  return (
    <div>
      {schemaTabBar}
      <LoadingState message="Scanning schema opportunities..." />
    </div>
  );
}
```

Note: The original had a Stop button — this is lost in the simple `LoadingState` replacement. If the stop button is important, keep it as a separate element below the `LoadingState`, or use `ProgressIndicator` with `onCancel={stopScan}` instead:

```tsx
if (loading && (!data || data.length === 0)) {
  return (
    <div>
      {schemaTabBar}
      <ProgressIndicator
        status="running"
        step="Scanning schema opportunities..."
        detail={progressMsg || undefined}
        onCancel={stopScan}
      />
    </div>
  );
}
```

Decision: Use `ProgressIndicator` here since it supports cancel and the original had a stop button.

- [ ] **Step 5: Replace error display (lines 731-742)**

Replace:
```tsx
if (scanError) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      {schemaTabBar}
      <AlertCircle className="w-8 h-8 text-red-400/80" />
      <p className="text-red-400/80 text-sm font-medium">Schema generation failed</p>
      <p className="text-zinc-500 text-xs max-w-md text-center">{scanError}</p>
      <button onClick={runScan} className="..."><RefreshCw ... /> Retry</button>
    </div>
  );
}
```

With:
```tsx
if (scanError) {
  return (
    <div>
      {schemaTabBar}
      <ErrorState
        type="general"
        title="Schema Scan Failed"
        message={scanError}
        action={{ label: 'Scan Again', onClick: runScan }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Replace progress banner (lines 773-781)**

Replace:
```tsx
{loading && (
  <div className="flex items-center gap-2.5 px-4 py-2.5 bg-teal-500/10 border border-teal-500/20 rounded-xl">
    <Loader2 className="w-4 h-4 animate-spin text-teal-400 flex-shrink-0" />
    <span className="text-xs text-teal-300 flex-1">{progressMsg || 'Generating schemas...'}</span>
    <button onClick={stopScan} ...>Stop</button>
  </div>
)}
```

With:
```tsx
{loading && data && data.length > 0 && (
  <ProgressIndicator
    status="running"
    step="Generating schemas..."
    detail={progressMsg || undefined}
    onCancel={stopScan}
  />
)}
```

(This banner only shows when data already exists — i.e., streaming additional results.)

- [ ] **Step 7: Add NextStepsCard**

After the progress/error section, when data is populated:

```tsx
{showNextSteps && data && data.length > 0 && !loading && (
  <NextStepsCard
    title={`Scan complete: ${data.length} pages with suggestions`}
    variant="success"
    onDismiss={() => setShowNextSteps(false)}
    staggerIndex={0}
    steps={[
      {
        label: 'Review suggestions',
        onClick: () => { /* scroll to first suggestion or focus list */ },
        estimatedTime: '3 min',
      },
    ]}
  />
)}
```

Note: Only include "Publish to Webflow" step if the workspace has a connected site and CMS publishing is available. Check what props/state are available.

- [ ] **Step 8: Clean up unused imports**

Check if `AlertCircle` and `RefreshCw` are still used. Remove if not.

- [ ] **Step 9: Verify**

Run: `npm run typecheck && npx vite build`

---

## Task 3.8 — Integrate into ContentPipeline (Model: haiku)

**Owns:**
- `src/components/ContentPipeline.tsx`

**Must not touch:**
- All other page components
- `src/components/ui/*` (read only)

**Depends on:** Task 3.4

**Current patterns to replace (from codebase scan):**
- **Loading only:** Three Suspense fallbacks (lines 204, 209, 243) use CSS border spinners: `<div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" />`
- **No error patterns** in the main component (delegated to sub-components)
- **No progress patterns** in the main component
- **No NextStepsCard** — ContentPipeline is a container component with no standalone completion event (per spec)

Scope: Replace Suspense fallback CSS spinners with `<LoadingState size="sm" message="Loading..." />`.

- [ ] **Step 1: Add import at top of file**

```typescript
import { LoadingState } from './ui/LoadingState';
```

- [ ] **Step 2: Replace Suspense fallbacks**

Replace each of the 3 CSS border spinners:

```tsx
<Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
```

With:
```tsx
<Suspense fallback={<LoadingState size="sm" message="Loading..." />}>
```

There are 3 instances — lines 204, 209, and 243. Replace all three.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vite build`

---

## Task 3.9 — Integrate into BrandHub (Model: sonnet)

**Owns:**
- `src/components/BrandHub.tsx`

**Must not touch:**
- All other page components
- `src/components/ui/*` (read only)

**Depends on:** Task 3.4

**Current patterns to replace (from codebase scan):**
- **Error:** Toast-only errors (no persistent UI). Add `<ErrorState>` below the action that failed.
- **Loading:** All spinners are button-inline (`<Loader2 className="w-3 h-3 animate-spin" />` inside buttons). Do NOT replace these — `LoadingState` is a centered block element, wrong for button context.
- **Progress:** No progress tracking. BrandHub uses boolean flags (`generatingBrandVoice`, etc.) — indeterminate progress.
- **NextStepsCard:** Triggered when `generatingBrandVoice` flips false + `brandVoice` populated.

BrandHub already imports from `./ui`: `PageHeader, SectionCard, TabBar`. Add to existing import.

- [ ] **Step 1: Add imports**

Update the existing import from `./ui` (line 8):

```typescript
import { PageHeader, SectionCard, TabBar, ErrorState } from './ui';
import { NextStepsCard } from './ui/NextStepsCard';
import { ProgressIndicator } from './ui/ProgressIndicator';
```

- [ ] **Step 2: Add state variables**

After existing state declarations (near line 89):

```typescript
const [showNextSteps, setShowNextSteps] = useState(false);
const [brandVoiceError, setBrandVoiceError] = useState<string | null>(null);
```

- [ ] **Step 3: Wire error state into brand voice generation**

In the `catch` blocks where `toast('...', 'error')` is called for brand voice operations (around line 165), add:

```typescript
setBrandVoiceError(err instanceof Error ? err.message : 'Brand voice generation failed');
```

Clear on retry/new generation start:
```typescript
setBrandVoiceError(null);
```

- [ ] **Step 4: Add ErrorState display**

Below the brand voice section's action area (where the generate button is):

```tsx
{brandVoiceError && (
  <ErrorState
    type="general"
    title="Brand Voice Generation Failed"
    message={brandVoiceError}
    action={{ label: 'Try Again', onClick: generateBrandVoice }}
  />
)}
```

Note: Verify `generateBrandVoice` is the correct function name — check the component.

- [ ] **Step 5: Add ProgressIndicator for brand voice generation**

Replace the button-inline spinner approach or add alongside it:

```tsx
<ProgressIndicator
  status={generatingBrandVoice ? 'running' : 'idle'}
  step="Analyzing brand voice..."
/>
```

Place this after the brand voice generation button area. This provides the indeterminate progress bar (no percent available).

- [ ] **Step 6: Wire NextStepsCard on completion**

When `generatingBrandVoice` flips false and `brandVoice` is populated, set `showNextSteps(true)`. This is in the finally/success block of the generation handler.

Then render:

```tsx
{showNextSteps && brandVoice && !generatingBrandVoice && (
  <NextStepsCard
    title="Brand voice generated"
    variant="success"
    onDismiss={() => setShowNextSteps(false)}
    staggerIndex={0}
    steps={[
      {
        label: 'Review knowledge base',
        onClick: () => { /* switch to knowledge base tab or scroll */ },
      },
      {
        label: 'Generate personas',
        onClick: () => { /* trigger persona generation if available */ },
      },
    ]}
  />
)}
```

Note: Verify what tabs/sections exist. Adjust onClick handlers to match actual available navigation.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vite build`

---

## Task 3.10 — Integrate into PageIntelligence (Model: sonnet)

**Owns:**
- `src/components/PageIntelligence.tsx`

**Must not touch:**
- All other page components
- `src/components/ui/*` (read only)

**Depends on:** Task 3.4

**Current patterns to replace (from codebase scan):**
- **Error:** Silent — errors logged to console only (line 428). Add `<ErrorState>` when analysis fails.
- **Loading:** No full-section spinner in main component
- **Progress** (lines 626-630): Inline `bulkProgress.done/bulkProgress.total` text + Loader2 + cancel button
- **NextStepsCard:** Per-page — triggered when `analyses[pageId]` is populated

PageIntelligence already imports from `./ui`: `scoreColorClass, scoreBgBarClass, MetricRing, TabBar`.

- [ ] **Step 1: Add imports**

Update the existing import from `./ui` (line 10):

```typescript
import { scoreColorClass, scoreBgBarClass, MetricRing, TabBar, ErrorState } from './ui';
import { ProgressIndicator } from './ui/ProgressIndicator';
import { NextStepsCard } from './ui/NextStepsCard';
```

- [ ] **Step 2: Add state variables**

After existing state declarations (near line 215):

```typescript
const [analysisError, setAnalysisError] = useState<string | null>(null);
const [showNextSteps, setShowNextSteps] = useState(false);
const [completedPagePath, setCompletedPagePath] = useState<string>('');
```

- [ ] **Step 3: Wire error state into analysis**

In the error handler where errors are currently logged to console (around line 428), add:

```typescript
setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
```

Clear on new analysis start:
```typescript
setAnalysisError(null);
```

- [ ] **Step 4: Add ErrorState display**

Where appropriate in the render:

```tsx
{analysisError && (
  <ErrorState
    type="general"
    title="Page Analysis Failed"
    message={analysisError}
    action={{ label: 'Try Again', onClick: () => { setAnalysisError(null); /* re-trigger analysis */ } }}
  />
)}
```

- [ ] **Step 5: Replace progress display (lines 626-630)**

Replace:
```tsx
{bulkProgress ? (
  <div className="flex items-center gap-2">
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
    <span className="text-xs text-zinc-300">Analyzing {bulkProgress.done}/{bulkProgress.total}...</span>
  </div>
)}
```

With:
```tsx
{bulkProgress && (
  <ProgressIndicator
    status="running"
    detail={`Analyzing ${bulkProgress.done}/${bulkProgress.total}...`}
    percent={(bulkProgress.done / bulkProgress.total) * 100}
    onCancel={() => { if (bulkJobIdRef.current) cancelBgJob(bulkJobIdRef.current); else cancelBulkRef.current = true; }}
  />
)}
```

Note: The cancel logic at line 630 is `if (bulkJobIdRef.current) cancelBgJob(bulkJobIdRef.current); else cancelBulkRef.current = true;`. Preserve this exact logic in the `onCancel` callback.

- [ ] **Step 6: Add NextStepsCard on completion**

When bulk analysis completes (where `setBulkProgress(null)` is called, around line 460), add:

```typescript
setShowNextSteps(true);
setCompletedPagePath(''); // for bulk, no specific page
```

Then render:

```tsx
{showNextSteps && !bulkProgress && (
  <NextStepsCard
    title={`Analysis complete${completedPagePath ? ` for ${completedPagePath}` : ''}`}
    variant="success"
    onDismiss={() => setShowNextSteps(false)}
    staggerIndex={0}
    steps={[
      {
        label: 'Go to SEO Editor',
        onClick: () => navigate(adminPath(workspaceId, 'seo-editor')),
      },
    ]}
  />
)}
```

Note: Verify `navigate` and `adminPath` are available. `adminPath` is imported from `../routes` in most components.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vite build`

---

## Task 3.11 — Verification + Docs (Model: sonnet)

**Owns:** All files (verification only), `FEATURE_AUDIT.md`, `BRAND_DESIGN_LANGUAGE.md`

**Depends on:** Tasks 3.5–3.10

- [ ] **Step 1: Full quality gate**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

All must pass.

- [ ] **Step 2: Verify color compliance**

```bash
grep -rn 'violet\|indigo' src/components/ui/NextStepsCard.tsx src/components/ui/ProgressIndicator.tsx src/components/ui/ErrorState.tsx
```

Expected: No matches.

```bash
grep -rn 'purple' src/components/ui/NextStepsCard.tsx src/components/ui/ProgressIndicator.tsx
```

Expected: No matches (purple is admin AI only).

- [ ] **Step 3: Verify ProgressIndicator uses blue (data color), not teal**

```bash
grep -n 'teal' src/components/ui/ProgressIndicator.tsx
```

Expected: No matches. Progress bars should use `blue-500`.

- [ ] **Step 4: Update FEATURE_AUDIT.md**

Add entries for NextStepsCard and ProgressIndicator as new shared UI primitives.

- [ ] **Step 5: Update BRAND_DESIGN_LANGUAGE.md**

Add NextStepsCard and ProgressIndicator to the UI primitives list. Document:
- NextStepsCard: success variant (green CheckCircle2), info variant (blue Info), step hover is teal
- ProgressIndicator: blue progress bar (data color), green complete state

- [ ] **Step 6: Update `data/roadmap.json`**

Mark PR3 shared UX components task as `"done"` with notes.

Run: `npx tsx scripts/sort-roadmap.ts`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(admin-ux-pr3): integrate shared UX into 6 pages + docs"
```

---

## Systemic Improvements

### Shared utilities extracted
- **NextStepsCard** — eliminates the need for per-page completion UI (was zero-coverage, now shared)
- **ProgressIndicator** — replaces 3 hand-rolled `{done}/{total}` patterns
- **ErrorState `actions[]`** — backward-compatible multi-action error recovery

### pr-check rules to add
- None needed for this PR. Existing color rules and component usage are sufficient.

### New tests required
- `tests/component/NextStepsCard.test.tsx` — 6 test cases covering render, clicks, dismiss, icons
- `tests/component/ProgressIndicator.test.tsx` — 8 test cases covering all 4 statuses, cancel, fade-out
- `tests/component/ErrorState.test.tsx` — 5 test cases covering backward compat, multi-action, precedence, styling

---

## Verification Strategy

| Check | Command |
|-------|---------|
| Types | `npm run typecheck` |
| Build | `npx vite build` |
| Tests | `npx vitest run --reporter=verbose` |
| pr-check | `npx tsx scripts/pr-check.ts` |
| Color compliance | `grep -rn 'violet\|indigo\|purple' src/components/ui/NextStepsCard.tsx src/components/ui/ProgressIndicator.tsx` |
| Blue for data | `grep -n 'blue' src/components/ui/ProgressIndicator.tsx` (confirm blue used) |
| No hand-rolled errors | `grep -rn 'bg-red-500/10' src/components/SeoAudit.tsx src/components/KeywordStrategy.tsx src/components/SchemaSuggester.tsx` (should be zero after migration) |
| Visual | Preview screenshot of each page showing new components |

---

## PR 2 Lessons Applied

1. **Feature move audit:** N/A for PR3 (no features moving between components).
2. **`?tab=` deep-link contract:** NextStepsCard `onClick` handlers that navigate with `?tab=X` must verify the target reads `searchParams.get('tab')`. None of the PR3 NextStepsCard steps use `?tab=` URLs — they use scroll-to-section or direct page navigation. If an implementer adds a `?tab=` URL, they must verify the contract test at `tests/contract/tab-deep-link-wiring.test.ts` passes.
3. **pr-check escape hatches:** Any new hatches must be inline on the flagged line for pattern-based rules.
