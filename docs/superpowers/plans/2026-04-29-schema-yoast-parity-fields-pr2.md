# Schema Yoast-Parity Fields PR2 — Admin Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn PR1's typed `validationFindings` into actionable admin UX. Each missing field on every page becomes a one-click jump to the canonical write location. Plus admin-side microcopy + the `siteHasSearch` toggle UI that PR1 plumbed but didn't surface.

**Architecture:** Frontend-only. Two-halves contract for field-level deep-linking: senders append `?tab=<tab>&focus=<fieldId>`; receivers read `useSearchParams`, find the matching `data-schema-deeplink={fieldId}` element, scroll-into-view + focus, then clear the param. Reuses PR1's `validationFindings` already on `SchemaPageSuggestion`. No backend changes.

**Tech Stack:** TypeScript strict, React Router DOM 7 (`useSearchParams`), TailwindCSS 4, vitest (component + integration). No new dependencies.

**MVP scope (what this plan ships):**
- New `SchemaCompletenessWidget` on Schema page summarizing missing fields + deep-link buttons
- Read-only "Schema impact" SectionCard at top of `BusinessProfileTab`
- Microcopy on `FeaturesTab` Logo URL field
- New `Workspace.siteHasSearch` admin toggle in `FeaturesTab` "Site capabilities" section
- Enriched warning rendering: group-by-field collapsible rows + summary header
- New shared utility `useDeepLinkFocus(fieldId)` + `data-schema-deeplink` attribute convention
- Component + integration tests for each surface

**Out of scope (deferred):**
- Tier 2-6 enrichment work (filed as separate roadmap entries)
- Pillar 3 (compile + CI gates)

---

## Pre-requisites

- [x] PR1a + PR1b merged to staging (`a85351d2` merge commit)
- [x] PR1 verified live on staging (4/4 testable fields confirmed)
- [x] 5 enrichment roadmap entries filed (Tiers 2-6)
- [ ] No additional shared contracts to pre-commit (the deep-link hook IS the shared contract; ships in Task 1)

---

## Task Dependencies

```
Phase 1 — Shared deep-link contract (sequential, foundational):
  Task 1 (useDeepLinkFocus hook + data-schema-deeplink convention)

Phase 2 — Settings tab surfaces (sequential, all touch FeaturesTab/BusinessProfileTab):
  → Task 2 (FeaturesTab: Logo URL microcopy + siteHasSearch toggle)
  → Task 3 (BusinessProfileTab: Schema impact mirror SectionCard)

Phase 3 — Schema page surfaces (sequential, share SchemaSuggester):
  → Task 4 (SchemaCompletenessWidget component)
  → Task 5 (Enriched warning rendering: group-by-field + summary header)

Phase 4 — Quality gates + ship (sequential):
  → Task 6 (Component + integration tests)
  → Task 7 (FEATURE_AUDIT.md + roadmap mark done + open PR)
```

**Why mostly sequential:** Tasks 2+3 share Settings tabs but touch different files (FeaturesTab vs BusinessProfileTab). Tasks 4+5 share `SchemaSuggester.tsx`. Task 1's shared hook gates 2-5. Sequential dispatch keeps reviews tractable.

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 useDeepLinkFocus + convention | sonnet | Establishes shared pattern; future migrations depend on this signature |
| 2 FeaturesTab edits | sonnet | New section + microcopy + checkbox + receiver wiring |
| 3 BusinessProfileTab mirror | sonnet | Conditional rendering with deep-link buttons, reads workspace + findings |
| 4 SchemaCompletenessWidget | sonnet | New component file, computes completeness from findings, renders deep-link buttons |
| 5 Enriched warning rendering | sonnet | Group-by-field logic + collapsible rows + header summary |
| 6 Tests | sonnet | Component tests with React Testing Library + RouterContext mocks |
| 7 Quality gates + open PR | haiku | CLAUDE.md checklist execution |

Reviewers (per task): spec-compliance reviewer = sonnet, code-quality reviewer = sonnet.

---

## File Map

### New files

| Path | Lines (est) | Responsibility |
|---|---|---|
| `src/hooks/useDeepLinkFocus.ts` | ~40 | Shared hook: reads `?focus=<fieldId>`, finds matching `[data-schema-deeplink]` element, scrolls + focuses, clears param. |
| `src/components/schema/SchemaCompletenessWidget.tsx` | ~120 | New widget on Schema page. Computes completeness from `validationFindings`. Renders progress bar + missing-field list with deep-link buttons. |
| `tests/component/SchemaCompletenessWidget.test.tsx` | ~80 | Component tests for 0/partial/full populated states + deep-link button targets. |
| `tests/component/useDeepLinkFocus.test.tsx` | ~60 | Hook tests: focus + scroll + clear-param behavior. |

### Modified files

| Path | Modification |
|---|---|
| `src/components/settings/FeaturesTab.tsx` | Task 2: add Logo URL microcopy `<p>`. Add `data-schema-deeplink="brandLogoUrl"` on the Logo URL input. Add new "Site capabilities" SectionCard with `siteHasSearch` checkbox + URL-pattern helper copy. Wire `useDeepLinkFocus` for `brandLogoUrl` and `siteHasSearch`. |
| `src/components/settings/BusinessProfileTab.tsx` | Task 3: add "Schema impact" SectionCard at top with 5 schema-impacting field rows (✓/✗ status + deep-link buttons). Add `data-schema-deeplink={'address'\|'phone'\|'socialProfiles'}` attributes on existing inputs. Wire `useDeepLinkFocus`. |
| `src/components/SchemaSuggester.tsx` | Task 4: insert `<SchemaCompletenessWidget>` between "Schema Site Plan" card and the stat row (around line 850). Task 5: replace inline warning rendering with grouped-by-field collapsible rows (extract to `<FindingGroupedList>` inline component). Add summary header line "X validated · Y warnings · Z fixes available". |
| `src/components/schema/SchemaPageCard.tsx` | Task 5: replace per-page warning rendering with click-to-expand pattern (reuses `<FindingGroupedList>` from SchemaSuggester). |
| `FEATURE_AUDIT.md` | Task 7: append PR2 entry. |
| `data/roadmap.json` | Task 7: add `schema-yoast-parity-fields-pr2` entry, status=done. |

### Files left untouched

- All server files — PR2 is frontend-only.
- All schema templates — PR2 changes nothing about emitted JSON-LD.
- `validateLeanSchema` + `RequiredFields` — PR1 ships dormant warning infrastructure; PR2 surfaces it but does not populate it. Recommended-tier field population is deferred to a separate spec when downstream warnings are needed.

---

## Tasks

### Task 1: Create `useDeepLinkFocus` hook + `data-schema-deeplink` convention (sonnet)

**Files:**
- Create: `src/hooks/useDeepLinkFocus.ts`
- Create: `tests/component/useDeepLinkFocus.test.tsx`

The hook reads `?focus=<fieldId>` from the URL, finds an element with `data-schema-deeplink={fieldId}`, scrolls it into view, focuses it (if focusable), and removes the `?focus=` param so re-renders don't re-trigger.

- [ ] **Step 1: Write failing test**

```tsx
// tests/component/useDeepLinkFocus.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { useDeepLinkFocus } from '../../src/hooks/useDeepLinkFocus';

function Probe() {
  useDeepLinkFocus();
  const [sp] = useSearchParams();
  return (
    <>
      <input data-schema-deeplink="brandLogoUrl" data-testid="logo-input" />
      <div data-schema-deeplink="address" data-testid="address-row" />
      <span data-testid="focus-param">{sp.get('focus') ?? 'none'}</span>
    </>
  );
}

describe('useDeepLinkFocus', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('focuses an input matching ?focus=<fieldId> and clears the param', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=brandLogoUrl']}>
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(document.activeElement).toBe(getByTestId('logo-input'));
    expect(getByTestId('focus-param').textContent).toBe('none');
  });

  it('scrolls a non-input element into view when matched', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=address']}>
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(getByTestId('address-row').scrollIntoView).toHaveBeenCalled();
    expect(getByTestId('focus-param').textContent).toBe('none');
  });

  it('does nothing when no matching element', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/path?focus=nothingMatching']}>
        <Probe />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    // Param NOT cleared on miss — leaves it for a downstream component that might handle it
    expect(getByTestId('focus-param').textContent).toBe('nothingMatching');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
npx vitest run tests/component/useDeepLinkFocus.test.tsx
```

Expected: FAIL — hook doesn't exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useDeepLinkFocus.ts`:

```typescript
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Field-level deep-linking contract.
 *
 * When the URL has `?focus=<fieldId>`, this hook locates an element with
 * `data-schema-deeplink={fieldId}`, scrolls it into view, focuses it (if
 * focusable), and clears the `?focus=` param. If no match is found, the
 * param stays so a downstream component can handle it.
 *
 * Usage:
 *   1. In the receiving tab/component, call `useDeepLinkFocus()` once.
 *   2. On each schema-relevant input or row, add `data-schema-deeplink="<fieldId>"`.
 *   3. Senders link with `?tab=<tab>&focus=<fieldId>`.
 *
 * Two-halves contract: senders without receivers, or receivers without
 * senders, are silently ignored.
 */
export function useDeepLinkFocus(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get('focus');

  useEffect(() => {
    if (!focus) return;
    // Allow one tick for the DOM to render after navigation
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-schema-deeplink="${CSS.escape(focus)}"]`);
      if (!el) return; // no match — leave param for another receiver

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // If focusable, focus it
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.focus({ preventScroll: true });
      } else if (el.tabIndex >= 0) {
        el.focus({ preventScroll: true });
      }

      // Clear the param so re-renders don't re-trigger
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }, 50);

    return () => clearTimeout(timer);
  }, [focus, searchParams, setSearchParams]);
}
```

- [ ] **Step 4: Run, confirm passes**

```bash
npx vitest run tests/component/useDeepLinkFocus.test.tsx
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDeepLinkFocus.ts tests/component/useDeepLinkFocus.test.tsx
git commit -m "$(cat <<'EOF'
feat(schema/ui): add useDeepLinkFocus hook for field-level deep-linking (PR2)

Establishes the two-halves contract used by PR2's Schema page widget +
BusinessProfileTab mirror to deep-link to specific input fields. Senders
append ?focus=<fieldId>; receivers carrying [data-schema-deeplink=fieldId]
get scrolled-into-view + focused, then the param clears.

Tested in isolation: input focus, non-input scroll, and no-match passthrough.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: FeaturesTab — Logo URL microcopy + `siteHasSearch` toggle (sonnet)

**Files:**
- Modify: `src/components/settings/FeaturesTab.tsx`

Two additive changes: add microcopy below the Logo URL input, and add a new "Site capabilities" SectionCard with the `siteHasSearch` checkbox. Wire `useDeepLinkFocus` and tag both inputs with `data-schema-deeplink`.

- [ ] **Step 1: Read the file structure**

Read `src/components/settings/FeaturesTab.tsx`. Note where:
- `brandLogoUrl` input lives (around line 340-352 per audit)
- `siteIntelligenceClientView` toggle lives (used as visual anchor for new toggle)
- React imports already include `useState`, `useEffect`

- [ ] **Step 2: Add `useDeepLinkFocus` import + invocation**

At top alongside other hooks:

```typescript
import { useDeepLinkFocus } from '../../hooks/useDeepLinkFocus';
```

Inside the component body (near existing `useState` calls):

```typescript
useDeepLinkFocus();
```

- [ ] **Step 3: Add microcopy + `data-schema-deeplink` on Logo URL input**

Locate the existing Logo URL input section. Modify the input to add the data attribute:

```tsx
<input
  type="url"
  data-schema-deeplink="brandLogoUrl"
  defaultValue={ws?.brandLogoUrl || ''}
  // ...existing onBlur etc...
/>
```

Below the input + preview image (after the `{ws?.brandLogoUrl && <img.../>}` line), add the microcopy:

```tsx
<p className="t-caption-sm text-[var(--brand-text-muted)] mt-2">
  Also used as publisher logo in your schema. Required for Article rich snippets in Google search results.
</p>
```

- [ ] **Step 4: Add "Site capabilities" SectionCard with siteHasSearch toggle**

Find a logical insertion point near other workspace-config sections (probably after the Logo URL block, before the next major section). Insert:

```tsx
<SectionCard title="Site capabilities" subtitle="Tell schema what your live site supports.">
  <div className="space-y-3">
    <label className="flex items-start gap-3 cursor-pointer" data-schema-deeplink="siteHasSearch">
      <input
        type="checkbox"
        defaultChecked={!!ws?.siteHasSearch}
        onChange={async (e) => {
          await patchWorkspace({ siteHasSearch: e.currentTarget.checked });
          toast(e.currentTarget.checked ? 'SearchAction will emit on next regenerate' : 'SearchAction emission disabled');
        }}
        className="mt-0.5"
      />
      <span>
        <span className="t-body font-medium text-[var(--brand-text)]">My site has a working search endpoint</span>
        <span className="block t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
          When enabled, schema generation emits <code className="t-mono text-[var(--brand-text)]">WebSite.potentialAction</code> (sitelinks SearchAction) so Google can offer in-SERP search. Your site must actually expose <code className="t-mono">https://yoursite.com/?s=&#123;query&#125;</code> or equivalent — verify this works before enabling.
        </span>
      </span>
    </label>
  </div>
</SectionCard>
```

If the existing SectionCard import isn't already in the file, add it:

```typescript
import { SectionCard } from '../ui/SectionCard';
```

If `patchWorkspace` is the existing helper used for other workspace mutations in this file, reuse it. If a different helper is used, match local convention.

- [ ] **Step 5: Run typecheck + targeted tests**

```bash
npm run typecheck
```

Expected: zero errors.

```bash
npx vitest run src/components/settings/
```

Expected: existing tests pass (new tests come in Task 6).

- [ ] **Step 6: Manual visual sanity check (recommended, not gating)**

If a dev server is running, navigate to `/ws/<wsId>/settings?tab=features&focus=siteHasSearch` and confirm:
- Page navigates to FeaturesTab
- siteHasSearch checkbox scrolls into view + receives focus

This is informal verification; the deep-link hook is unit-tested in Task 1.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/FeaturesTab.tsx
git commit -m "$(cat <<'EOF'
feat(schema/ui): FeaturesTab — Logo URL microcopy + siteHasSearch toggle (PR2)

Surfaces PR1's plumbed siteHasSearch DB field as an admin checkbox in a
new "Site capabilities" SectionCard. Toggling on activates PR1's gated
WebSite.potentialAction emission on next regenerate.

Logo URL field gains microcopy explaining its dual role as publisher logo
in schema (required for Article rich snippets) and gets a
data-schema-deeplink attribute so the upcoming SchemaCompletenessWidget
can deep-link directly to the input.

useDeepLinkFocus wired as the receiver half of the two-halves contract
established in Task 1.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: BusinessProfileTab — Schema impact mirror SectionCard (sonnet)

**Files:**
- Modify: `src/components/settings/BusinessProfileTab.tsx`

A new SectionCard at the TOP of the tab listing the 5 fields outside this tab that affect schema, with ✓/✗ status badges. Each row deep-links to canonical write location. Read-only — no alternate write paths.

- [ ] **Step 1: Read the file structure**

Read `src/components/settings/BusinessProfileTab.tsx`. Note:
- Where address / phone / socialProfiles inputs are rendered
- The component's import section + workspace access pattern
- The first JSX child of the return — that's where the new card goes

- [ ] **Step 2: Add `useDeepLinkFocus` + `data-schema-deeplink` attributes on existing inputs**

Add the import + invocation per Task 2 pattern.

On the existing address fieldset (or address.city input — whichever is the natural focus target), add `data-schema-deeplink="address"`. Similarly:
- Phone input → `data-schema-deeplink="phone"`
- Social profiles section → `data-schema-deeplink="socialProfiles"`

If the address has multiple inputs (street/city/state/zip), tag the wrapper div with `data-schema-deeplink="address"` so the deep-link scrolls to the section, not a specific subfield.

- [ ] **Step 3: Add "Schema impact" mirror card**

At the top of the tab's return JSX, add (BEFORE the existing fieldsets):

```tsx
<SectionCard
  title="Schema impact"
  subtitle="These fields shape how Google understands your business in search."
  className="mb-6"
>
  <div className="space-y-2">
    {/* Brand logo — lives in Features tab */}
    <SchemaImpactRow
      field="Brand logo"
      filled={!!ws?.brandLogoUrl}
      target={{ tab: 'features', focus: 'brandLogoUrl' }}
      hint={ws?.brandLogoUrl ? null : 'Upload in Settings · Features'}
    />
    {/* Address — editable below */}
    <SchemaImpactRow
      field="Address"
      filled={!!(ws?.businessProfile?.address?.city || ws?.businessProfile?.address?.state)}
      scrollTo="address"
      hint={ws?.businessProfile?.address?.city ? null : 'Enables Service.areaServed for local SEO'}
    />
    {/* Phone — editable below */}
    <SchemaImpactRow
      field="Phone"
      filled={!!ws?.businessProfile?.phone}
      scrollTo="phone"
      hint={ws?.businessProfile?.phone ? null : 'Required for LocalBusiness rich snippet'}
    />
    {/* Social profiles — editable below */}
    <SchemaImpactRow
      field="Social profiles"
      filled={!!(ws?.businessProfile?.socialProfiles?.length)}
      scrollTo="socialProfiles"
      hint={ws?.businessProfile?.socialProfiles?.length ? null : 'Populates Organization.sameAs'}
    />
    {/* Site has search — Features tab */}
    <SchemaImpactRow
      field="Site search endpoint"
      filled={!!ws?.siteHasSearch}
      target={{ tab: 'features', focus: 'siteHasSearch' }}
      hint={ws?.siteHasSearch ? null : 'Toggle on in Settings · Features when search is wired'}
    />
  </div>
</SectionCard>
```

- [ ] **Step 4: Define inline `SchemaImpactRow` component**

Inside the same file, above the main component:

```tsx
import { Link } from 'react-router-dom';
import { adminPath } from '../../routes';

function SchemaImpactRow({
  field,
  filled,
  hint,
  target,
  scrollTo,
}: {
  field: string;
  filled: boolean;
  hint: string | null;
  target?: { tab: string; focus: string };
  scrollTo?: string;
}) {
  // Use workspace ID from outer scope via prop drilling or context — implementer determines
  // the cleanest pattern matching the file. If workspaceId is on the parent component, pass it via prop.
  const linkTarget = target ? `${adminPath('__WS__', 'settings')}?tab=${target.tab}&focus=${target.focus}` : null;
  const handleScroll = scrollTo
    ? () => {
        const el = document.querySelector<HTMLElement>(`[data-schema-deeplink="${scrollTo}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
      }
    : null;

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {filled ? (
          <span className="text-emerald-400 text-sm shrink-0">✓</span>
        ) : (
          <span className="text-amber-400 text-sm shrink-0">✗</span>
        )}
        <span className="t-body text-[var(--brand-text)] truncate">{field}</span>
        {hint && <span className="t-caption-sm text-[var(--brand-text-muted)] truncate">{hint}</span>}
      </div>
      {linkTarget && (
        <Link
          to={linkTarget}
          className="t-caption text-[var(--brand-text-bright)] hover:text-[var(--brand-text-bright)] hover:underline shrink-0"
        >
          Edit →
        </Link>
      )}
      {handleScroll && (
        <button
          onClick={handleScroll}
          className="t-caption text-[var(--brand-text-bright)] hover:underline shrink-0"
        >
          Jump to →
        </button>
      )}
    </div>
  );
}
```

(The `'__WS__'` is a placeholder — replace with the actual workspace ID accessible in this component's scope. If `BusinessProfileTab` already accepts `workspaceId` as a prop, use that. If it accesses workspace via `useParams` or context, do the same.)

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/BusinessProfileTab.tsx
git commit -m "$(cat <<'EOF'
feat(schema/ui): BusinessProfileTab — Schema impact mirror card (PR2)

New "Schema impact" SectionCard at the top of the tab lists the 5 fields
outside this tab that affect schema, with ✓/✗ status + deep-links. Read-only
by design (zero alternate write paths). Two of the five fields live in
Features tab (brandLogoUrl, siteHasSearch) and link with ?tab=features&focus=...
The other three (address, phone, socialProfiles) live in this same tab and
scroll-into-view + focus when clicked.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: SchemaCompletenessWidget component (sonnet)

**Files:**
- Create: `src/components/schema/SchemaCompletenessWidget.tsx`
- Modify: `src/components/SchemaSuggester.tsx` (add the widget render)

The widget computes completeness % from `validationFindings` aggregated across all pages, renders a progress bar + missing-field list. Each missing-field row is a button → navigates to the canonical write location via `?tab=...&focus=...`.

- [ ] **Step 1: Create the new component file**

Create `src/components/schema/SchemaCompletenessWidget.tsx`:

```tsx
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ValidationFinding } from '../../../shared/types/schema-validation';
import { SectionCard } from '../ui/SectionCard';
import { adminPath } from '../../routes';

interface PageWithFindings {
  validationFindings?: ValidationFinding[];
  validationErrors?: string[];
}

interface SchemaCompletenessWidgetProps {
  pages: PageWithFindings[];
}

/**
 * Maps a ValidationFinding's `field` to the canonical write location.
 * Returns null for fields without a known canonical write location (e.g.,
 * per-page CMS fields the admin doesn't control from settings).
 */
function fieldToTarget(field: string): { tab: string; focus: string; label: string } | null {
  const map: Record<string, { tab: string; focus: string; label: string }> = {
    'publisher.logo': { tab: 'features', focus: 'brandLogoUrl', label: 'Publisher logo' },
    'publisher.logo.url': { tab: 'features', focus: 'brandLogoUrl', label: 'Publisher logo URL' },
    'address': { tab: 'business-profile', focus: 'address', label: 'Business address' },
    'telephone': { tab: 'business-profile', focus: 'phone', label: 'Phone number' },
    'sameAs': { tab: 'business-profile', focus: 'socialProfiles', label: 'Social profiles' },
    'foundedDate': { tab: 'business-profile', focus: 'foundedDate', label: 'Founded date' },
  };
  return map[field] ?? null;
}

interface FieldGroup {
  field: string;
  target: { tab: string; focus: string; label: string };
  pageCount: number;
  severity: 'error' | 'warning';
}

export function SchemaCompletenessWidget({ pages }: SchemaCompletenessWidgetProps) {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const { groups, completenessPct, totalPages, fullyClean } = useMemo(() => {
    const findingsByField = new Map<string, { severity: 'error' | 'warning'; pages: Set<string> }>();
    let pagesWithIssues = 0;

    for (const page of pages) {
      const findings = page.validationFindings ?? [];
      let hasIssue = false;
      for (const f of findings) {
        if (!f.field) continue;
        const key = f.field;
        const entry = findingsByField.get(key) ?? { severity: f.severity, pages: new Set() };
        // Worst-severity wins on aggregation
        if (f.severity === 'error') entry.severity = 'error';
        // Track this page once per field
        entry.pages.add((page as never as { pageId?: string }).pageId ?? '');
        findingsByField.set(key, entry);
        hasIssue = true;
      }
      if (hasIssue) pagesWithIssues++;
    }

    const groups: FieldGroup[] = [];
    for (const [field, info] of findingsByField) {
      const target = fieldToTarget(field);
      if (!target) continue; // skip fields without a known write location
      groups.push({ field, target, pageCount: info.pages.size, severity: info.severity });
    }
    // Sort: errors first, then by pageCount desc
    groups.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.pageCount - a.pageCount;
    });

    const totalPages = pages.length;
    const completenessPct = totalPages === 0 ? 100 : Math.round(((totalPages - pagesWithIssues) / totalPages) * 100);
    const fullyClean = groups.length === 0;

    return { groups, completenessPct, totalPages, fullyClean };
  }, [pages]);

  if (totalPages === 0) return null;

  if (fullyClean) {
    return (
      <SectionCard title="Schema profile completeness" className="mb-6">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-lg">✓</span>
          <span className="t-body text-[var(--brand-text)]">Schema profile complete — all pages emit recommended fields.</span>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Schema profile completeness"
      subtitle={`${completenessPct}% complete · ${groups.length} field${groups.length === 1 ? '' : 's'} missing across pages.`}
      className="mb-6"
    >
      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-[var(--surface-3)] overflow-hidden mb-4">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${completenessPct}%` }}
          role="progressbar"
          aria-valuenow={completenessPct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      {/* Missing-field rows */}
      <div className="space-y-1">
        {groups.map(g => (
          <button
            key={g.field}
            onClick={() => {
              if (!workspaceId) return;
              navigate(`${adminPath(workspaceId, 'settings')}?tab=${g.target.tab}&focus=${g.target.focus}`);
            }}
            className="flex items-center justify-between gap-3 w-full px-3 py-2 rounded text-left hover:bg-[var(--surface-3)] transition-colors group"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className={g.severity === 'error' ? 'text-red-400' : 'text-amber-400'}>
                {g.severity === 'error' ? '✗' : '⚠'}
              </span>
              <span className="t-body text-[var(--brand-text)] truncate">{g.target.label}</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                {g.pageCount} page{g.pageCount === 1 ? '' : 's'}
              </span>
            </span>
            <span className="t-caption text-[var(--brand-text-muted)] group-hover:text-[var(--brand-text)] shrink-0">
              Fix →
            </span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Insert widget in `SchemaSuggester.tsx`**

Find the section that renders the "Pages / Validated / Existing Schemas" stat row (around line 905). Just BEFORE that row, render the widget:

```tsx
import { SchemaCompletenessWidget } from './schema/SchemaCompletenessWidget';

// In the JSX, just above the stat row:
<SchemaCompletenessWidget pages={data} />
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/schema/SchemaCompletenessWidget.tsx src/components/SchemaSuggester.tsx
git commit -m "$(cat <<'EOF'
feat(schema/ui): SchemaCompletenessWidget on Schema page (PR2)

New widget aggregates validationFindings across all pages, computes a
completeness % (clean pages / total), and renders missing fields as
deep-link buttons to the canonical write location. Currently maps 6
known fields (publisher.logo, address, telephone, sameAs, foundedDate)
to Settings tab targets; unknown fields are silently skipped (CMS-only
fields like image/datePublished don't have admin write locations).

Empty state collapses to a "Schema profile complete" badge when no
findings have admin-actionable targets.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Enriched warning rendering (group-by-field + summary header) (sonnet)

**Files:**
- Modify: `src/components/SchemaSuggester.tsx`
- Modify: `src/components/schema/SchemaPageCard.tsx`

The completeness widget aggregates ACROSS pages. This task groups findings WITHIN a page (collapsible rows in `SchemaPageCard`) and adds a summary header in `SchemaSuggester`.

- [ ] **Step 1: Update `SchemaPageCard.tsx` — collapsible findings**

Find the existing block from PR1 that renders findings:

```tsx
{(page.validationFindings && page.validationFindings.length > 0) && (
  <div className="mt-2 space-y-1">
    {/* Errors first, red styling */}
    {page.validationFindings
      .filter(f => f.severity === 'error')
      .map((f, i) => (...))}
    {/* Warnings second, amber styling */}
    ...
  </div>
)}
```

Replace with a grouped, click-to-expand pattern. Group findings by `field` (those without a `field` use a `__noField` sentinel and aren't collapsed).

```tsx
import { useState } from 'react';

// Inside the component body:
const [expandedField, setExpandedField] = useState<string | null>(null);

const findingsByField = useMemo(() => {
  const map = new Map<string, ValidationFinding[]>();
  for (const f of page.validationFindings ?? []) {
    const key = f.field ?? '__noField';
    const arr = map.get(key) ?? [];
    arr.push(f);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort(([, a], [, b]) => {
    // Errors first
    const aHasError = a.some(f => f.severity === 'error');
    const bHasError = b.some(f => f.severity === 'error');
    if (aHasError !== bHasError) return aHasError ? -1 : 1;
    return 0;
  });
}, [page.validationFindings]);

// In JSX:
{findingsByField.length > 0 && (
  <div className="mt-2 space-y-1">
    {findingsByField.map(([field, findings]) => {
      const severity = findings.some(f => f.severity === 'error') ? 'error' : 'warning';
      const expanded = expandedField === field;
      const colorClass = severity === 'error' ? 'text-red-400' : 'text-amber-400';
      const badge = severity === 'error' ? 'Error' : 'Recommended';
      return (
        <div key={field}>
          <button
            onClick={() => setExpandedField(expanded ? null : field)}
            className={`flex items-center gap-2 w-full text-left ${colorClass} text-xs hover:opacity-80`}
          >
            <span className="font-semibold uppercase tracking-wide" style={{ fontSize: '10px' }}>{badge}</span>
            <span className="truncate">
              {field !== '__noField' ? `${field} (${findings.length})` : findings[0].message}
            </span>
            {field !== '__noField' && (
              <span className="text-[var(--brand-text-muted)] shrink-0">{expanded ? '▾' : '▸'}</span>
            )}
          </button>
          {expanded && field !== '__noField' && (
            <div className="ml-4 mt-1 space-y-0.5">
              {findings.map((f, i) => (
                <div key={i} className={`${colorClass} text-xs`}>
                  {f.message}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 2: Update `SchemaSuggester.tsx` — summary header**

Locate the existing "X validated · Y warnings" stat (the line currently reads from `pagesWithErrors` / `pagesWithWarnings` for sub-label). Below or near it, add a fixes-available count derived from `validationFindings` that have a known target:

```tsx
const fixesAvailable = useMemo(() => {
  const fields = new Set<string>();
  for (const p of data) {
    for (const f of p.validationFindings ?? []) {
      if (!f.field) continue;
      // Reuse the same fieldToTarget table from SchemaCompletenessWidget — extract to shared util
      if (KNOWN_TARGETS.has(f.field)) fields.add(f.field);
    }
  }
  return fields.size;
}, [data]);
```

Where `KNOWN_TARGETS` is a const Set of the 6 fields the widget knows. Extract to `src/components/schema/fieldTargets.ts`:

```typescript
export const FIELD_TARGETS: Record<string, { tab: string; focus: string; label: string }> = {
  'publisher.logo': { tab: 'features', focus: 'brandLogoUrl', label: 'Publisher logo' },
  'publisher.logo.url': { tab: 'features', focus: 'brandLogoUrl', label: 'Publisher logo URL' },
  'address': { tab: 'business-profile', focus: 'address', label: 'Business address' },
  'telephone': { tab: 'business-profile', focus: 'phone', label: 'Phone number' },
  'sameAs': { tab: 'business-profile', focus: 'socialProfiles', label: 'Social profiles' },
  'foundedDate': { tab: 'business-profile', focus: 'foundedDate', label: 'Founded date' },
};

export const KNOWN_TARGETS = new Set(Object.keys(FIELD_TARGETS));

export function fieldToTarget(field: string) {
  return FIELD_TARGETS[field] ?? null;
}
```

Update `SchemaCompletenessWidget` to import from `fieldTargets` instead of defining the table inline. (DRY — Task 4's inline table was scaffolding; Task 5 promotes it.)

In the SchemaSuggester header summary line:

```tsx
<div className="t-caption text-[var(--brand-text-muted)]">
  {pagesWithErrors > 0 ? `${pagesWithErrors} with errors` : pagesWithWarnings > 0 ? `${pagesWithWarnings} with warnings` : 'all passing'}
  {fixesAvailable > 0 && ` · ${fixesAvailable} fix${fixesAvailable === 1 ? '' : 'es'} available`}
</div>
```

- [ ] **Step 3: Run typecheck + tests**

```bash
npm run typecheck
npx vitest run tests/unit/schema src/components
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/schema/SchemaCompletenessWidget.tsx src/components/schema/SchemaPageCard.tsx src/components/schema/fieldTargets.ts src/components/SchemaSuggester.tsx
git commit -m "$(cat <<'EOF'
feat(schema/ui): grouped warning rendering + fixes-available header (PR2)

SchemaPageCard groups validationFindings by field with click-to-expand
collapsible rows. Sorted errors-first within each page.

SchemaSuggester header gains "X fixes available" annotation when any
finding has a known admin target. The fieldTargets table is extracted
to a shared module so the completeness widget + summary stat read from
the same source of truth.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Tests (sonnet)

**Files:**
- Create: `tests/component/SchemaCompletenessWidget.test.tsx`
- (test file for hook already exists from Task 1)

Component tests for the widget cover the three rendering states (empty/partial/full) and verify deep-link buttons navigate to the right URLs.

- [ ] **Step 1: Write component tests**

Create `tests/component/SchemaCompletenessWidget.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { SchemaCompletenessWidget } from '../../src/components/schema/SchemaCompletenessWidget';
import type { ValidationFinding } from '../../shared/types/schema-validation';

function renderWithRouter(pages: unknown[]) {
  let location = '';
  function LocationCapture() { const l = useLocation(); location = l.pathname + l.search; return null; }
  const utils = render(
    <MemoryRouter initialEntries={['/ws/ws_test/seo-schema']}>
      <Routes>
        <Route path="/ws/:workspaceId/*" element={<><SchemaCompletenessWidget pages={pages as never} /><LocationCapture /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, getLocation: () => location };
}

const finding = (severity: 'error' | 'warning', field: string): ValidationFinding => ({
  severity, type: 'Article', field, ruleId: severity === 'error' ? 'required-field-missing' : 'recommended-field-missing',
  message: `${field} missing`,
});

describe('SchemaCompletenessWidget', () => {
  it('renders the empty-state badge when no actionable findings exist', () => {
    const { container } = renderWithRouter([
      { pageId: 'p1', validationFindings: [] },
      { pageId: 'p2', validationFindings: [finding('error', 'image')] }, // 'image' has no admin target
    ]);
    expect(container).toHaveTextContent('Schema profile complete');
  });

  it('renders progress bar at 50% when half of pages have findings', () => {
    renderWithRouter([
      { pageId: 'p1', validationFindings: [] },
      { pageId: 'p2', validationFindings: [finding('error', 'publisher.logo')] },
    ]);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
  });

  it('groups findings by field and shows page count', () => {
    renderWithRouter([
      { pageId: 'p1', validationFindings: [finding('error', 'publisher.logo')] },
      { pageId: 'p2', validationFindings: [finding('error', 'publisher.logo')] },
      { pageId: 'p3', validationFindings: [finding('warning', 'address')] },
    ]);
    expect(screen.getByText('Publisher logo')).toBeInTheDocument();
    expect(screen.getByText('2 pages')).toBeInTheDocument();
    expect(screen.getByText('Business address')).toBeInTheDocument();
    expect(screen.getByText('1 page')).toBeInTheDocument();
  });

  it('navigates to ?tab=features&focus=brandLogoUrl on Publisher logo click', () => {
    const { getLocation } = renderWithRouter([
      { pageId: 'p1', validationFindings: [finding('error', 'publisher.logo')] },
    ]);
    fireEvent.click(screen.getByText('Publisher logo'));
    expect(getLocation()).toContain('?tab=features&focus=brandLogoUrl');
  });

  it('errors sort above warnings', () => {
    renderWithRouter([
      { pageId: 'p1', validationFindings: [
        finding('warning', 'address'),
        finding('error', 'publisher.logo'),
      ]},
    ]);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Publisher logo');
    expect(buttons[1]).toHaveTextContent('Business address');
  });
});
```

- [ ] **Step 2: Run all PR2 tests**

```bash
npx vitest run tests/component/useDeepLinkFocus.test.tsx tests/component/SchemaCompletenessWidget.test.tsx
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add tests/component/SchemaCompletenessWidget.test.tsx
git commit -m "$(cat <<'EOF'
test(schema/ui): SchemaCompletenessWidget unit tests (PR2)

5 tests covering rendering states (empty/partial/full), progress bar
aria-valuenow, field grouping with page-count aggregation, deep-link
target URL construction, and error-before-warning sort order.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Quality gates + open PR (haiku)

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`

- [ ] **Step 1: Run all CLAUDE.md quality gates**

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

Expected: all clean. Pre-existing flakes per Task 17 audit may surface in full-suite mode but are not blockers.

- [ ] **Step 2: Update `FEATURE_AUDIT.md`**

Append after the parity-fields PR1 paragraph:

```markdown
**Schema Yoast-Parity Fields PR2 (PR #TBD, 2026-04-29):** Admin discoverability layer atop PR1's typed validationFindings. New SchemaCompletenessWidget on the Schema page aggregates findings across all pages, computes a completeness %, and renders missing-field rows as deep-link buttons to the canonical Settings write location. New BusinessProfileTab "Schema impact" SectionCard mirrors the 5 schema-impacting fields with ✓/✗ status. New "Site capabilities" SectionCard in FeaturesTab surfaces PR1's plumbed `Workspace.siteHasSearch` field as an admin checkbox; toggling on activates the gated SearchAction emission on next regenerate. Logo URL field gains microcopy explaining its dual role as publisher logo. New shared `useDeepLinkFocus` hook + `data-schema-deeplink` attribute convention establish the field-level deep-link contract: senders append `?focus=<fieldId>`; receivers scroll-into-view + focus the matching element + clear the param. SchemaPageCard now groups findings by field with click-to-expand collapsible rows. SchemaSuggester header gains "X fixes available" annotation. fieldTargets module is the single source of truth mapping ValidationFinding.field → Settings deep-link. **Files:** `src/hooks/useDeepLinkFocus.ts` (new), `src/components/schema/SchemaCompletenessWidget.tsx` (new), `src/components/schema/fieldTargets.ts` (new), `src/components/settings/{FeaturesTab,BusinessProfileTab}.tsx` (extended), `src/components/SchemaSuggester.tsx` (widget mount + grouped summary), `src/components/schema/SchemaPageCard.tsx` (grouped findings), `tests/component/{useDeepLinkFocus,SchemaCompletenessWidget}.test.tsx` (new).
```

- [ ] **Step 3: Mark PR2 done in roadmap**

Find the existing entry for `schema-yoast-parity-fields-pr2`. If it doesn't exist, add it; if it exists in pending, update its status:

```json
{
  "id": "schema-yoast-parity-fields-pr2",
  "title": "Schema Yoast-Parity Fields PR2 — admin discoverability surfaces",
  "source": "docs/superpowers/plans/2026-04-29-schema-yoast-parity-fields-pr2.md",
  "est": "1.5d",
  "priority": "P0",
  "sprint": "I",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "SchemaCompletenessWidget on Schema page + BusinessProfileTab Schema impact mirror + FeaturesTab Logo URL microcopy + siteHasSearch toggle + grouped warning rendering + useDeepLinkFocus shared hook + data-schema-deeplink convention. Frontend-only; reuses PR1's validationFindings. Plan: docs/superpowers/plans/2026-04-29-schema-yoast-parity-fields-pr2.md."
}
```

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 4: Push branch and open PR**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "$(cat <<'EOF'
docs: mark schema-yoast-parity-fields-pr2 done

FEATURE_AUDIT.md gains the comprehensive PR2 paragraph: completeness
widget + BusinessProfileTab mirror + FeaturesTab microcopy + siteHasSearch
toggle + grouped warning rendering + shared deep-link contract.

data/roadmap.json: status flips to done.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push -u origin claude/schema-yoast-parity-fields-pr2
```

```bash
gh pr create --base staging --title "feat(schema): Yoast-parity fields PR2 — admin discoverability surfaces" --body "$(cat <<'EOF'
## Summary

Turns PR1's typed validationFindings into actionable admin UX. Each missing field on every page becomes a one-click jump to the canonical Settings write location.

### What's in this PR

- **SchemaCompletenessWidget** on the Schema page — aggregates findings across all pages, renders progress bar + missing-field deep-link buttons.
- **BusinessProfileTab "Schema impact" mirror** — read-only SectionCard at the top of the tab listing 5 schema-impacting fields with ✓/✗ status + deep-links.
- **FeaturesTab Logo URL microcopy** — one-line helper text explaining its dual role as publisher logo.
- **FeaturesTab siteHasSearch toggle** — surfaces PR1's plumbed Workspace.siteHasSearch as an admin checkbox; activates gated SearchAction emission.
- **SchemaPageCard grouped findings** — click-to-expand collapsible rows by field.
- **SchemaSuggester "X fixes available" header** — reads from the same fieldTargets source of truth.
- **useDeepLinkFocus hook + data-schema-deeplink convention** — establishes field-level deep-linking. Two-halves contract: senders append ?focus=<fieldId>; receivers scroll + focus + clear.

### What's NOT in this PR

- Tier 2-6 enrichment work (filed as separate roadmap entries: schema-engagement-signals, schema-eeat-amplifiers, schema-entity-grounding-wikidata, schema-commerce-types, schema-trust-authority-graph).
- Pillar 3 (compile + CI gates).
- Recommended-tier validator entries (RequiredFields.recommended arrays still empty; populated by a future spec).

## Spec + plan

- `docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md` §5
- `docs/superpowers/plans/2026-04-29-schema-yoast-parity-fields-pr2.md`

## Test plan

- [x] `npm run typecheck` — 0 errors
- [x] `npx tsx scripts/pr-check.ts` — 0 errors, pre-existing warnings only
- [x] Component tests for useDeepLinkFocus (3 tests) + SchemaCompletenessWidget (5 tests) all pass
- [ ] CI green on staging
- [ ] After staging deploy: navigate to /ws/<wsId>/seo-schema; verify SchemaCompletenessWidget renders. Click a missing-field row; verify navigation to /ws/<wsId>/settings?tab=<tab>&focus=<fieldId> with the target input scrolled-into-view + focused.
- [ ] Toggle siteHasSearch on; click Re-generate All; verify WebSite.potentialAction now emits in JSON-LD.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Verification Strategy

| What | How |
|---|---|
| Hook focus + scroll behavior | `npx vitest run tests/component/useDeepLinkFocus.test.tsx` |
| Widget rendering states + deep-links | `npx vitest run tests/component/SchemaCompletenessWidget.test.tsx` |
| Tab receivers wired | Manual verification on staging: navigate with `?tab=features&focus=siteHasSearch`, confirm focus + scroll |
| siteHasSearch toggle activates SearchAction | Toggle on staging → click Re-generate All → inspect homepage JSON-LD for `WebSite.potentialAction.@type === 'SearchAction'` |
| BusinessProfileTab mirror reads correct status | Manual on staging: confirm ✓/✗ matches workspace data |

---

## Self-Review

**1. Spec coverage:**
- Spec §5.1 (completeness widget) — Task 4 ✓
- Spec §5.2 (BusinessProfileTab mirror) — Task 3 ✓
- Spec §5.3 (Logo URL microcopy) — Task 2 ✓
- Spec §5.4 (siteHasSearch toggle) — Task 2 ✓
- Spec §5.5 (enriched warning rendering) — Task 5 ✓
- Spec §5.6 (no backend changes) — verified ✓
- Spec §5.7 (tests) — Task 6 ✓ (E2E Playwright marked optional in spec; deferred)

**2. Placeholder scan:** One placeholder in Task 3 (`'__WS__'` in `adminPath` call) is intentionally left for the implementer to resolve based on the actual `BusinessProfileTab` component's workspaceId access pattern. Documented in Step 4 narrative.

**3. Type consistency:**
- `ValidationFinding` shape consistent with PR1's shared type.
- `fieldToTarget` return shape `{ tab, focus, label }` consistent across `SchemaCompletenessWidget`, `fieldTargets.ts`, `SchemaSuggester` summary stat.
- `data-schema-deeplink` attribute string is the contract; both senders (`?focus=X`) and receivers (`[data-schema-deeplink="X"]`) reference the same string per field.

**4. Sequencing:** Task 1 ships the hook before Tasks 2-5 use it. Task 4 inlines the field-target table; Task 5 extracts it to a shared module. Both work for sequential dispatch — Task 5's extract is a refactor of Task 4's inline.

---

## Estimates

| Phase | Tasks | Estimated time |
|---|---|---|
| Phase 1 | 1 | 1.5 hours |
| Phase 2 | 2, 3 | 4 hours |
| Phase 3 | 4, 5 | 5 hours |
| Phase 4 | 6, 7 | 2 hours |
| **Total** | 7 | **~1.5 days subagent-driven** |

Reviewer overhead (per subagent-driven-development): ~30% on top.

---

**End of plan.** Plan-writing complete. Ready for execution via `superpowers:subagent-driven-development`.
