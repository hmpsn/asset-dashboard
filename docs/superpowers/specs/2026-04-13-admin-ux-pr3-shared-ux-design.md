# Admin UX PR3 — Shared UX Components Design

> **Addendum to:** `docs/superpowers/specs/2026-04-12-admin-ux-restructure-design.md`
> **Scope:** PR3 of the Admin UX Restructure — Shared UX Components
> **Parent plan:** `docs/superpowers/plans/2026-04-12-admin-ux-restructure.md`

---

## Design Philosophy

PR3 prioritizes reusing existing UI primitives over creating new components. The original plan specified 3 new components (NextStepsCard, ProgressIndicator, ErrorRecoveryCard). This design drops ErrorRecoveryCard — `ErrorState` already exists with retry support and zero adoption. The real work is migrating 6 pages to use existing primitives (`ErrorState`, `LoadingState`) and creating only 2 genuinely new components where no primitive exists.

---

## Component Inventory

### New Components (2)

| Component | Gap | Built on |
|-----------|-----|----------|
| `NextStepsCard` | Zero completion-state UI across all target pages. After an operation finishes, users get no guidance. | `SectionCard` shell |
| `ProgressIndicator` | `LoadingState` is a spinner — no step labels, detail text, percent bar, or cancel. 3 pages track `bulkProgress: {done, total}` with hand-rolled inline text. | Standalone |

### Existing Primitives to Adopt

| Primitive | Status | PR3 Action |
|-----------|--------|------------|
| `ErrorState` | Exists (4 type variants, optional retry action). Zero usage in target pages. | Extend with `actions[]` prop. Migrate 5 pages from inline error divs/toasts. |
| `LoadingState` | Exists (3 sizes, contextual message). Zero usage in target pages. | Replace full-section manual spinners in 4 pages. |

### Dropped

- ~~ErrorRecoveryCard~~ — `ErrorState` covers this. Extending `action` → `actions[]` handles multi-option recovery.

---

## NextStepsCard

### Purpose

Appears after an operation completes (audit finishes, strategy generates, schema scans). Shows 2–3 contextual follow-up actions. Dismissable.

### Interface

```typescript
interface NextStep {
  label: string;           // "Review Quick Wins"
  description?: string;    // "3 pages with easy ranking opportunities"
  icon?: LucideIcon;
  onClick: () => void;
  estimatedTime?: string;  // "2 min"
}

interface NextStepsCardProps {
  title: string;           // "Audit complete: 24 issues found"
  icon?: LucideIcon;       // defaults to CheckCircle2
  steps: NextStep[];       // 1–4 actions
  onDismiss?: () => void;  // X button, hides card
  variant?: 'success' | 'info';  // green check vs blue info icon
}
```

### Visual Spec

- Outer shell: `SectionCard` for visual consistency with the rest of the design system.
- Title row: variant icon (green `CheckCircle2` for success, blue `Info` for info) + title text + dismiss X button (zinc, hover → zinc-300).
- Step rows: optional icon + label + optional description + optional estimated time badge + `→` arrow. Each row is clickable.
- Step hover: teal highlight (action color per Three Laws).
- Mount animation: inherits `SectionCard`'s stagger-fade via `staggerIndex` passthrough prop (0.4s fade + 60ms delay per sibling). No custom animation — use the platform pattern.

### Integration Points

Each page adds a `showNextSteps: boolean` state. Set `true` when operation completes, `false` on dismiss or new operation start.

| Page | Trigger | Title | Steps |
|------|---------|-------|-------|
| SeoAudit | `data !== null && !loading` | "Audit complete: {errors + warnings} issues" | Apply top fixes → Export report → Share with client |
| KeywordStrategy | SSE `done` event + query invalidation | "Strategy ready" | Review Quick Wins → Set up rank tracking |
| SchemaSuggester | `data !== null && !loading` | "Scan complete: {n} pages with suggestions" | Review suggestions → Publish to Webflow |
| BrandHub | `generatingBrandVoice` flips false + `brandVoice` populated | "Brand voice generated" | Review knowledge base → Generate personas |
| PageIntelligence | `analyses[pageId]` populated (per-page) | "Analysis complete for {pagePath}" | Go to SEO Editor → Create brief |

**Not integrated:** ContentPipeline — container component with no standalone completion event. Brief creation happens in child (ContentBriefs).

---

## ProgressIndicator

### Purpose

Replaces hand-rolled bulk progress patterns (`{done}/{total}`) with a standardized component. Supports step labels, detail text, percent bar, and cancel.

### Interface

```typescript
interface ProgressIndicatorProps {
  status: 'idle' | 'running' | 'complete' | 'error';
  step?: string;           // "Crawling pages..."
  detail?: string;         // "42 of 120 pages scanned"
  percent?: number;        // 0–100 (if known)
  onCancel?: () => void;   // shows cancel button when provided
  className?: string;
}
```

### Visual Spec

- `idle`: renders nothing (null return).
- `running`: horizontal blue progress bar (data color, not teal). Indeterminate (animated pulse) when `percent` is undefined, determinate fill when provided. Step label in `text-zinc-300 text-xs font-medium`. Detail in `text-zinc-500 text-xs`. Optional cancel button (zinc, small).
- `complete`: green `CheckCircle2` + "Complete" label. Fades out after 3s via CSS transition.
- `error`: renders nothing — error display is `ErrorState`'s responsibility.

### Integration Points

| Page | Current Pattern | Replacement |
|------|----------------|-------------|
| SeoAudit | `bulkProgress: {done, total}` inline text | `<ProgressIndicator status={bulkProgress ? 'running' : 'idle'} detail={\`${done} of ${total} fixes applied\`} percent={done/total*100} />` |
| KeywordStrategy | SSE `progressStep` + `progressPct` + `progressDetail` state | `<ProgressIndicator status={generating ? 'running' : 'idle'} step={progressStep} detail={progressDetail} percent={progressPct} />` |
| SchemaSuggester | `bulkProgress: {done, total}` inline text | Same pattern as SeoAudit — detail shows pages published count. |
| BrandHub | Boolean flags (`generatingBrandVoice`) only | `<ProgressIndicator status={generating ? 'running' : 'idle'} step="Crawling site..." />` (indeterminate — no percent available) |
| PageIntelligence | `bulkProgress: {done, total}` + cancel button | `<ProgressIndicator status='running' detail={\`Analyzing ${done}/${total}...\`} percent={done/total*100} onCancel={cancelAnalysis} />` |

**Not integrated:** ContentPipeline — no bulk progress tracking.

---

## ErrorState Extension

### Change

Add optional `actions` (plural) prop, backward compatible with existing `action` (singular):

```typescript
interface ErrorStateProps {
  // ... all existing props unchanged ...
  action?: { label: string; onClick: () => void };
  actions?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }[];  // NEW
}
```

When `actions` is provided, it takes precedence over `action`. Renders a row of buttons — `primary` gets teal styling, `secondary` gets zinc. Existing single-`action` call sites are unaffected.

### Migration Points

| Page | Current Error Pattern | Replacement |
|------|----------------------|-------------|
| SeoAudit | Inline red box: `auditError` → `bg-red-500/10` div with AlertCircle + text. No retry. | `<ErrorState type="general" title="SEO Audit Failed" message={auditError} action={{ label: 'Run Again', onClick: runAudit }} />` |
| KeywordStrategy | Inline red box: `error` → AlertCircle + text. No retry. | `<ErrorState type="general" title="Strategy Generation Failed" message={error} action={{ label: 'Try Again', onClick: handleGenerate }} />` |
| SchemaSuggester | Full-screen center: `scanError` → AlertCircle + text. No retry. Per-page `publishError` inline. | Main: `<ErrorState type="general" title="Schema Scan Failed" message={scanError} action={{ label: 'Scan Again', onClick: handleScan }} />`. Per-page errors stay inline (too granular for ErrorState). |
| BrandHub | Toast-only errors. No persistent UI. | Add `<ErrorState>` below the action that failed, shown when error state is set. Toast remains as secondary notification. |
| PageIntelligence | Silent — errors logged to console only. | Add `<ErrorState>` when analysis fails, with retry action. |

**Not changed:** ContentPipeline — already uses ErrorBoundary with retry, no inline error patterns.

---

## LoadingState Migration

Replace full-section manual spinners with `LoadingState` using contextual messages.

**Scope rule:** Only replace full-section/full-page spinners. Button-inline spinners (small `Loader2` inside `<button>`) stay as-is — `LoadingState` is a centered block element, wrong for inline button context.

| Page | Current Spinner | Replacement |
|------|----------------|-------------|
| SeoAudit | `<Loader2 className="w-6 h-6 animate-spin" />` centered | `<LoadingState message="Analyzing site health..." />` |
| KeywordStrategy | `<Loader2 className="w-6 h-6 animate-spin text-teal-400" />` centered | `<LoadingState message="Loading keyword strategy..." />` |
| SchemaSuggester | `<Loader2 className="w-6 h-6 animate-spin" />` main load | `<LoadingState message="Scanning schema opportunities..." />`. Button-inline spinners stay. |
| ContentPipeline | CSS border spinners in Suspense fallbacks | `<LoadingState size="sm" message="Loading..." />` in Suspense fallbacks. |
| PageIntelligence | `<Loader2 className="w-6 h-6 animate-spin text-teal-400" />` centered | `<LoadingState message="Loading page analysis..." />` |

**Not changed:** BrandHub — all spinners are button-inline, no full-section loading pattern.

---

## Follow-up: Empty State CTA Audit

**Deferred to after PR3 merges.** ~151 `EmptyState` usages lack CTAs. Top 10 highest-impact candidates identified:

1. WorkspaceHome — no audit data → "Run your first audit"
2. WorkspaceHome — no strategy data → "Generate keyword strategy"
3. SeoAudit — no audit run → "Start audit"
4. KeywordStrategy — no strategy → "Configure & generate"
5. ContentBriefs — no briefs → "Create your first brief"
6. RankTracker — no keywords → "Add keywords to track"
7. LinksPanel (redirects) — no redirects → "Add a redirect"
8. SchemaSuggester — no scan → "Scan for schema opportunities"
9. ContentManager — no posts → "Generate a post from a brief"
10. PageIntelligence — no pages analyzed → "Analyze your first page"

Pattern: add `action` prop (teal CTA button) to existing `<EmptyState>` that triggers the page's primary action.

---

## Files Changed (Estimated)

| Category | Files |
|----------|-------|
| New | `src/components/ui/NextStepsCard.tsx`, `src/components/ui/ProgressIndicator.tsx` |
| Extended | `src/components/ui/ErrorState.tsx` (add `actions[]` prop) |
| Barrel | `src/components/ui/index.ts` (export new components) |
| Migrated | `src/components/SeoAudit.tsx`, `src/components/KeywordStrategy.tsx`, `src/components/SchemaSuggester.tsx`, `src/components/ContentPipeline.tsx`, `src/components/BrandHub.tsx`, `src/components/PageIntelligence.tsx` |

---

## PR 2 Lessons Applied

1. **Feature move audit:** N/A for PR3 (no features moving between components).
2. **`?tab=` deep-link contract:** NextStepsCard `onClick` handlers that navigate with `?tab=X` must verify the target reads `searchParams.get('tab')`. The contract test at `tests/contract/tab-deep-link-wiring.test.ts` catches `adminPath(...)` senders automatically.
3. **pr-check escape hatches:** Any new hatches must be inline on the flagged line for pattern-based rules.
