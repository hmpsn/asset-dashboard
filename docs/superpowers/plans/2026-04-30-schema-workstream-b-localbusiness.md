# Schema Workstream B — LocalBusiness Threading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread `businessProfile?.address` through three schema templates so that when a workspace has an address, `/about` and `/contact` emit a thin LocalBusiness `@id` reference as `mainEntity`, and `/services/*` emit `provider: { '@id': '/#localbusiness' }` instead of an inline Organization node. Add a dismissible callout to the schema dashboard when `businessProfile.address` is missing.

**Architecture:** Three independent backend changes (templates + one generator dispatch update) plus one frontend change. Templates are additive-only — `businessProfile` is optional on both `StaticInput` and `ServiceInput`, so all existing callers and tests continue to work without modification. Frontend callout reads `businessProfile` from a prop threaded down from `App.tsx`, which already has it from `useWorkspaces()`.

**Tech Stack:** TypeScript, React, vitest

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-30-schema-localbusiness-design.md`
- [x] No pre-plan audit required — 4 backend files + 2 frontend files, all enumerated from direct code reading

---

## Task Dependencies

```
Tasks 1 and 2 are independent and can run in parallel:
  Task 1 (static.ts — StaticInput + AboutPage + ContactPage)
  Task 2 (service.ts — ServiceInput + buildServiceSchema provider)

Task 3 depends on Tasks 1 + 2 (both template interfaces must accept businessProfile before generator can pass it):
  Task 3 (generator.ts — thread businessProfile into 3 dispatch calls)

Task 4 depends on Tasks 1 + 2 + 3 (tests exercise full stack):
  Task 4 (unit tests — localbusiness-threading.test.ts)

Task 5 is independent of Tasks 1–4 (frontend only, different files):
  Task 5 (SchemaSuggester.tsx callout + App.tsx prop)

Task 6 (verification) depends on all prior tasks.
```

---

## Task 1 — Extend `StaticInput` + update About/Contact templates (Model: haiku)

**Owns:**
- Modify: `server/schema/templates/static.ts`

**Must not touch:** `service.ts`, `generator.ts`, any test file, any frontend file.

**Context:**
- `StaticInput` is defined at `static.ts:8–11`. Currently: `{ baseUrl: string; pageData: PageData; }`
- `buildAboutPageSchema` at line 13 has `'mainEntity': orgRef(baseUrl)` (line 21)
- `buildContactPageSchema` at line 29 has no `mainEntity` field
- `BusinessProfile` type is in `server/schema/data-sources.ts` — import from there
- `orgRef` is already imported from `./helpers.js`

- [ ] **Step 1: Update `static.ts`**

Add `BusinessProfile` to the import at the top of the file. The current import line 5 is:
```typescript
import type { PageData } from '../data-sources.js';
```
Change to:
```typescript
import type { PageData, BusinessProfile } from '../data-sources.js';
```

Replace the `StaticInput` interface (lines 8–11):
```typescript
// OLD:
export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
}
```
```typescript
// NEW:
export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
}
```

In `buildAboutPageSchema`, replace line 21:
```typescript
// OLD:
    'mainEntity': orgRef(baseUrl),
```
```typescript
// NEW:
    'mainEntity': input.businessProfile?.address
      ? { '@id': `${baseUrl}/#localbusiness` }
      : orgRef(baseUrl),
```

In `buildContactPageSchema`, add `mainEntity` to the `primary` object. The current `primary` object (lines 31–40) has no `mainEntity`. Add it after `'url': pageData.canonicalUrl,`:
```typescript
    'url': pageData.canonicalUrl,
    'mainEntity': input.businessProfile?.address
      ? { '@id': `${baseUrl}/#localbusiness` }
      : undefined,
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/schema-v2-brainstorm
npm run typecheck
```

Expected: zero errors. Existing callers that pass only `{ baseUrl, pageData }` continue to compile because `businessProfile` is optional.

- [ ] **Step 3: Run existing template tests**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

Expected: all tests pass. The existing `buildAboutPageSchema` and `buildContactPageSchema` tests don't pass `businessProfile`, so they exercise the fallback path (orgRef / no mainEntity) — identical to current behavior.

- [ ] **Step 4: Commit**

```bash
git add server/schema/templates/static.ts
git commit -m "feat(schema): StaticInput gains businessProfile; About/Contact get LocalBusiness mainEntity"
```

---

## Task 2 — Extend `ServiceInput` + update `buildServiceSchema` provider (Model: haiku)

**Owns:**
- Modify: `server/schema/templates/service.ts`

**Must not touch:** `static.ts`, `generator.ts`, any test file, any frontend file.

**Context:**
- `ServiceInput` is defined at `service.ts:9–12`. Currently: `{ baseUrl: string; pageData: PageData; }`
- `buildServiceSchema` at line 14. The `provider` field is at lines 53–57:
  ```typescript
  'provider': dropUndefined({
    '@type': 'Organization',
    ...orgRef(baseUrl),
    'name': pageData.publisher.name,
  }),
  ```
- `BusinessProfile` type is in `server/schema/data-sources.ts`
- `orgRef` is already imported from `./helpers.js`

- [ ] **Step 1: Update `service.ts`**

Add `BusinessProfile` to the import at the top of the file. Current line 6:
```typescript
import type { PageData } from '../data-sources.js';
```
Change to:
```typescript
import type { PageData, BusinessProfile } from '../data-sources.js';
```

Replace the `ServiceInput` interface (lines 9–12):
```typescript
// OLD:
export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
}
```
```typescript
// NEW:
export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
}
```

Replace the `provider` field in `buildServiceSchema` (lines 53–57):
```typescript
// OLD:
    'provider': dropUndefined({
      '@type': 'Organization',
      ...orgRef(baseUrl),
      'name': pageData.publisher.name,
    }),
```
```typescript
// NEW:
    'provider': input.businessProfile?.address
      ? { '@id': `${baseUrl}/#localbusiness` }
      : dropUndefined({
          '@type': 'Organization',
          ...orgRef(baseUrl),
          'name': pageData.publisher.name,
        }),
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run existing template tests**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

Expected: all tests pass. Existing `buildServiceSchema` test calls don't pass `businessProfile`, so they exercise the Organization fallback path — identical to current behavior.

- [ ] **Step 4: Commit**

```bash
git add server/schema/templates/service.ts
git commit -m "feat(schema): ServiceInput gains businessProfile; provider switches to LocalBusiness @id ref"
```

---

## Task 3 — Thread `businessProfile` through `generator.ts` dispatch (Model: haiku)

**Depends on:** Tasks 1 and 2 (both template interfaces must accept `businessProfile` before this compiles).

**Owns:**
- Modify: `server/schema/generator.ts`

**Must not touch:** any template file, any test file, any frontend file.

**Context:**
- Three dispatch cases to update: `'Service'` (line 217–219), `'AboutPage'` (lines 221–223), `'ContactPage'` (lines 225–227)
- `input.workspace.businessProfile` is the correct path — confirmed in `LeanGeneratorInput` → `WorkspaceSchemaInput.businessProfile` in `server/schema/data-sources.ts`
- Line 123 already reads `input.workspace.businessProfile?.address` for `businessKind` — this line is **unchanged**

- [ ] **Step 1: Update the three dispatch cases in `generator.ts`**

Replace lines 217–219 (`'Service'` case):
```typescript
// OLD:
    case 'Service':
      schema = buildServiceSchema({ baseUrl, pageData });
      reason = 'Service detail page — Service with provider reference.';
```
```typescript
// NEW:
    case 'Service':
      schema = buildServiceSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
      reason = 'Service detail page — Service with provider reference.';
```

Replace lines 221–223 (`'AboutPage'` case):
```typescript
// OLD:
    case 'AboutPage':
      schema = buildAboutPageSchema({ baseUrl, pageData });
      reason = 'About page — AboutPage referencing Organization.';
```
```typescript
// NEW:
    case 'AboutPage':
      schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
      reason = 'About page — AboutPage with LocalBusiness mainEntity when address is set.';
```

Replace lines 225–227 (`'ContactPage'` case):
```typescript
// OLD:
    case 'ContactPage':
      schema = buildContactPageSchema({ baseUrl, pageData });
      reason = 'Contact page — ContactPage.';
```
```typescript
// NEW:
    case 'ContactPage':
      schema = buildContactPageSchema({ baseUrl, pageData, businessProfile: input.workspace.businessProfile });
      reason = 'Contact page — ContactPage with LocalBusiness mainEntity when address is set.';
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run generator tests**

```bash
npx vitest run tests/unit/schema/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/schema/generator.ts
git commit -m "feat(schema): thread businessProfile into About/Contact/Service generator dispatch"
```

---

## Task 4 — Unit tests for LocalBusiness threading (Model: haiku)

**Depends on:** Tasks 1, 2, and 3.

**Owns:**
- Create: `tests/unit/schema/localbusiness-threading.test.ts`

**Must not touch:** any source file.

**Context — test pattern:** Follow `tests/unit/schema/templates.test.ts` exactly:
- Import vitest `describe`, `it`, `expect`
- Import the template functions directly
- Build minimal `baseInput` objects; spread to create variants

- [ ] **Step 1: Write the test file**

Create `tests/unit/schema/localbusiness-threading.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAboutPageSchema, buildContactPageSchema } from '../../../server/schema/templates/static.js';
import { buildServiceSchema } from '../../../server/schema/templates/service.js';

const baseUrl = 'https://example.com';

const pageData = {
  title: 'Test Page',
  cleanTitle: 'Test Page',
  description: 'A test page',
  image: undefined,
  canonicalUrl: 'https://example.com/about',
  publisher: { name: 'Example Co', logoUrl: 'https://example.com/logo.png' },
  datePublished: undefined,
  dateModified: undefined,
  inLanguage: 'en',
  articleSection: undefined,
  breadcrumbs: [
    { name: 'Home', url: 'https://example.com' },
    { name: 'About', url: 'https://example.com/about' },
  ],
};

const withAddress = {
  phone: '512-555-0100',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
};

const withoutAddress = {
  phone: '512-555-0100',
  // address intentionally absent
};

describe('buildAboutPageSchema — businessProfile threading', () => {
  it('mainEntity points to /#localbusiness when businessProfile.address is set', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: withAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    expect(aboutNode).toBeDefined();
    expect(aboutNode['mainEntity']).toEqual({ '@id': 'https://example.com/#localbusiness' });
  });

  it('mainEntity falls back to Organization @id when businessProfile.address is absent', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: withoutAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });

  it('mainEntity falls back to Organization @id when businessProfile is null', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData, businessProfile: null });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });

  it('mainEntity falls back to Organization @id when businessProfile is undefined (no breaking change)', () => {
    const schema = buildAboutPageSchema({ baseUrl, pageData });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const aboutNode = graph.find((n) => n['@type'] === 'AboutPage') as Record<string, unknown>;
    const mainEntity = aboutNode['mainEntity'] as Record<string, unknown>;
    expect(mainEntity['@id']).toBe('https://example.com/#organization');
  });
});

describe('buildContactPageSchema — businessProfile threading', () => {
  it('mainEntity is LocalBusiness @id when businessProfile.address is set', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData, businessProfile: withAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    expect(contactNode).toBeDefined();
    expect(contactNode['mainEntity']).toEqual({ '@id': 'https://example.com/#localbusiness' });
  });

  it('mainEntity is absent when businessProfile.address is not set', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData, businessProfile: withoutAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    expect(contactNode['mainEntity']).toBeUndefined();
  });

  it('mainEntity is absent when businessProfile is undefined (no breaking change)', () => {
    const contactPageData = { ...pageData, canonicalUrl: 'https://example.com/contact' };
    const schema = buildContactPageSchema({ baseUrl, pageData: contactPageData });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const contactNode = graph.find((n) => n['@type'] === 'ContactPage') as Record<string, unknown>;
    expect(contactNode['mainEntity']).toBeUndefined();
  });
});

describe('buildServiceSchema — businessProfile threading', () => {
  const servicePageData = {
    ...pageData,
    canonicalUrl: 'https://example.com/services/design',
    elements: undefined,
  };

  it('provider is LocalBusiness @id when businessProfile.address is set', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData, businessProfile: withAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    expect(serviceNode).toBeDefined();
    expect(serviceNode['provider']).toEqual({ '@id': 'https://example.com/#localbusiness' });
  });

  it('provider is inline Organization when businessProfile.address is absent', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData, businessProfile: withoutAddress });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    const provider = serviceNode['provider'] as Record<string, unknown>;
    expect(provider['@type']).toBe('Organization');
    expect(provider['@id']).toBe('https://example.com/#organization');
  });

  it('provider is inline Organization when businessProfile is undefined (no breaking change)', () => {
    const schema = buildServiceSchema({ baseUrl, pageData: servicePageData });
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    const serviceNode = graph.find((n) => n['@type'] === 'Service') as Record<string, unknown>;
    const provider = serviceNode['provider'] as Record<string, unknown>;
    expect(provider['@type']).toBe('Organization');
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
npx vitest run tests/unit/schema/localbusiness-threading.test.ts
```

Expected: 10 tests passing.

- [ ] **Step 3: Run full schema test suite to verify no regressions**

```bash
npx vitest run tests/unit/schema/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/schema/localbusiness-threading.test.ts
git commit -m "test(schema): LocalBusiness threading — About/Contact/Service with and without businessProfile.address"
```

---

## Task 5 — `SchemaSuggester` callout + `App.tsx` prop (Model: haiku)

**Independent of Tasks 1–4.**

**Owns:**
- Modify: `src/components/SchemaSuggester.tsx`
- Modify: `src/App.tsx`

**Must not touch:** any backend file, any test file.

**Context:**
- `SchemaSuggester` `Props` interface is at `SchemaSuggester.tsx:75–79`. Currently: `{ siteId: string; workspaceId?: string; fixContext?: FixContext | null; }`
- `SchemaSuggester` is rendered at `App.tsx:414`: `<SchemaSuggester key={...} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} />`
- `selected` comes from `useWorkspaces()` which hits `GET /api/workspaces` — the full workspace object including `businessProfile` is included
- `BusinessProfile` shared type is in `shared/types/workspace.ts:290`
- Callout styling pattern: amber-bordered div from `src/components/settings/BusinessProfileTab.tsx:246–254`
- `adminPath` helper: `import { adminPath } from '../routes.js'` — already imported in `SchemaSuggester.tsx`
- Business profile settings tab deep-link: `adminPath(workspaceId, 'workspace-settings') + '?tab=business-profile'`
- `localStorage` key for dismissal: `schema-bp-callout-dismissed-${workspaceId}`
- Callout renders after `<SchemaPlanPanel>` (line 824) and before `<ProgressIndicator>` (line 827)

- [ ] **Step 1: Update `SchemaSuggester.tsx`**

Add `BusinessProfile` import. Find the existing imports at the top of the file. Add to the shared types import group:

```typescript
import type { BusinessProfile } from '../shared/types/workspace.js';
```

Update the `Props` interface:
```typescript
// OLD:
interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}
```
```typescript
// NEW:
interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
  businessProfile?: BusinessProfile | null;
}
```

Update the function signature destructuring:
```typescript
// OLD:
export function SchemaSuggester({ siteId, workspaceId, fixContext }: Props) {
```
```typescript
// NEW:
export function SchemaSuggester({ siteId, workspaceId, fixContext, businessProfile }: Props) {
```

Add the dismiss state inside the component body, after existing `useState` declarations:
```typescript
  const dismissedKey = workspaceId ? `schema-bp-callout-dismissed-${workspaceId}` : null;
  const [calloutDismissed, setCalloutDismissed] = useState(() =>
    dismissedKey ? localStorage.getItem(dismissedKey) === '1' : true,
  );

  const showBpCallout = !calloutDismissed
    && !!workspaceId
    && !businessProfile?.address?.street;

  function dismissBpCallout() {
    if (dismissedKey) localStorage.setItem(dismissedKey, '1');
    setCalloutDismissed(true);
  }
```

Find the return JSX and locate `<SchemaPlanPanel siteId={siteId} />` (line 824). Add the callout immediately after it:

```tsx
      <SchemaPlanPanel siteId={siteId} />

      {showBpCallout && (
        <div className="rounded-[var(--radius-lg)] border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <span className="t-body text-amber-400 mt-0.5">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="t-body text-amber-400 font-medium mb-1">Your business profile is incomplete</p>
            <p className="t-caption text-[var(--brand-text-muted)]">
              Add your address to unlock LocalBusiness schema on your homepage, /contact, and /about — the highest-value schema type for local businesses.
            </p>
            {workspaceId && (
              <a
                href={adminPath(workspaceId, 'workspace-settings') + '?tab=business-profile'}
                className="t-caption text-teal-400 hover:text-teal-300 mt-2 inline-block"
              >
                Complete business profile →
              </a>
            )}
          </div>
          <button
            onClick={dismissBpCallout}
            className="t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] flex-shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
```

- [ ] **Step 2: Update `App.tsx`**

Find line 414:
```tsx
// OLD:
    if (tab === 'seo-schema') return <SchemaSuggester key={`schema-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} />;
```
```tsx
// NEW:
    if (tab === 'seo-schema') return <SchemaSuggester key={`schema-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} businessProfile={selected.businessProfile} />;
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. `selected.businessProfile` is typed as `BusinessProfile | undefined` (matches `businessProfile?: BusinessProfile | null` on Props).

- [ ] **Step 4: Commit**

```bash
git add src/components/SchemaSuggester.tsx src/App.tsx
git commit -m "feat(schema): add business profile callout to schema dashboard when address is missing"
```

---

## Task 6 — Verification (Model: haiku)

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
```

Expected: zero failures. Specifically check `tests/unit/schema/localbusiness-threading.test.ts` (10 tests) and `tests/unit/schema/templates.test.ts` (all pre-existing tests still pass).

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] **Step 3: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero violations.

- [ ] **Step 4: Verify generator threading**

```bash
grep -n "businessProfile" server/schema/generator.ts
```

Expected: three lines (one per dispatch case: Service, AboutPage, ContactPage) each reading `input.workspace.businessProfile`.

- [ ] **Step 5: Verify callout is dismissible and scoped per workspace**

The localStorage key is `schema-bp-callout-dismissed-${workspaceId}`. Verify in the component that:
- The initial `useState` reads from localStorage on mount (not on every render)
- `dismissBpCallout` both sets localStorage and updates state
- The callout never shows when `workspaceId` is undefined

```bash
grep -n "dismissedKey\|calloutDismissed\|showBpCallout" src/components/SchemaSuggester.tsx
```

Expected: all three variables defined and used correctly.

- [ ] **Step 6: Verify callout does not show when address is present**

The condition `!businessProfile?.address?.street` checks for the street field specifically. Confirm this matches the spec's `businessProfile?.address` gate: if the address object exists at all (has a street), the callout is suppressed.

---

## Systemic Improvements

- **No new shared utilities needed** — `businessProfile` threading is a one-time parameter pass, not a recurring pattern that warrants a helper.
- **pr-check rule to consider:** After this PR, a rule that detects new `buildAboutPageSchema`/`buildContactPageSchema`/`buildServiceSchema` call sites that omit `businessProfile` would prevent regressions. (Non-blocking — file as a roadmap item.)
- **New tests added:** `tests/unit/schema/localbusiness-threading.test.ts` — 10 cases covering with/without/null/undefined businessProfile for all three templates.

## Verification Strategy

- `npx vitest run tests/unit/schema/localbusiness-threading.test.ts` — 10 tests green
- `npx vitest run tests/unit/schema/templates.test.ts` — existing tests unaffected
- `npm run typecheck && npx vite build` — zero errors
- `npx tsx scripts/pr-check.ts` — zero violations
- Staging: fill in `businessProfile.address` for hmpsn workspace via settings UI; re-run schema generation on `/about`, `/contact`, `/services/design`. Verify `mainEntity: { "@id": "https://hmpsn.studio/#localbusiness" }` on About/Contact and `provider: { "@id": "https://hmpsn.studio/#localbusiness" }` on Service.
- Staging: leave address empty; verify schema dashboard shows the amber callout; click ✕ to dismiss; reload and confirm it stays dismissed.
