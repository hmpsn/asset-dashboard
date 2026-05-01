# Schema Wiring & Quality Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken wiring between the site plan, per-page type overrides, and the schema generator — so that page role assignments actually drive template selection — then improve schema output quality across all templates.

**Architecture:** Three independent layers need fixing: (1) the generator must accept a `pageKindOverride` so callers can bypass `classifyPage()`; (2) `generateSchemaForPage` and the bulk suggester must look up each page's role from the site plan and pass it as that override; (3) templates must emit a per-page `WebPage` node, correct per-location `@id`s, and richer `Organization` fields. These layers are independent — Task 1 (shared type) must land first, then Tasks 2–3 can run in parallel, then Task 4 (templates) can run independently.

**Tech Stack:** TypeScript, Express, schema.org JSON-LD, Vitest for tests

---

## Task Dependencies

```
Task 1 (pageKindOverride field + role→kind map)
  → Task 2 (generator uses override)          [depends on Task 1]
  → Task 3 (wiring: suggester + route)        [depends on Task 1]
  → Task 4 (template quality fixes)           [independent of Tasks 1–3, can run after Task 1 commits]
  → Task 5 (tests)                            [depends on Tasks 2–4]
```

Parallel after Task 1: Tasks 2 and 3 can run concurrently (different files).
Task 4 is fully independent — only touches template files.

---

## Model Assignments

| Task | Model | Reason |
|------|-------|--------|
| Task 1 — shared type + map | haiku | Pure type definition, transcription |
| Task 2 — generator override | sonnet | Reads generator internals, judgment on placement |
| Task 3 — suggester + route wiring | sonnet | Multi-file, needs to understand ctx flow |
| Task 4 — template quality | sonnet | Template patterns, cross-template consistency |
| Task 5 — tests | sonnet | Test design judgment |

---

## File Map

**Modified files:**
- `server/schema/generator.ts` — add `pageKindOverride?: PageKind` to `LeanGeneratorInput`; use it before `classifyPage()`
- `server/schema-suggester.ts` — add `SCHEMA_ROLE_TO_PAGE_KIND` map; look up site plan role per page and pass to `generateLeanSchema`
- `server/routes/webflow-schema.ts` — forward `resolvedPageType` to `generateSchemaForPage` (already resolved on line 163, just not passed)
- `server/schema/templates/local-business.ts` — per-location `@id` and `url`; `@type` subtype (`Dentist`, `FinancialService`); `WebPage` node
- `server/schema/data-sources.ts` — add `industrySubtype?: string` to `WorkspaceSchemaInput`
- `server/schema/templates/homepage.ts` — `WebPage` node; `contactPoint` and `description` on Organization
- `server/schema/templates/static.ts` — `WebPage` node consistency check (already has `isPartOf` — verify)
- `server/schema/templates/service.ts` — `WebPage` node
- `server/schema/templates/article.ts` — `WebPage` node

**New test file:**
- `tests/unit/schema/wiring.test.ts` — tests that override bypasses classifier, that location role maps to Location kind

---

## Task 1: Add `pageKindOverride` to `LeanGeneratorInput` + role→kind map

**Files:**
- Modify: `server/schema/generator.ts:62-78`
- Modify: `server/schema-suggester.ts` (add SCHEMA_ROLE_TO_PAGE_KIND constant near line 94)

**File ownership — Task 1:**
Owns: `server/schema/generator.ts` (interface only), `server/schema-suggester.ts` (constant only — do not touch function bodies).
Must not touch: template files, `server/schema/data-sources.ts`, `server/routes/webflow-schema.ts`.

### Context for the implementer

`LeanGeneratorInput` (generator.ts:62) has no field for a page kind override. `classifyPage()` is called unconditionally at line 299. The site plan stores `SchemaPageRole` values (e.g. `'location'`, `'service'`, `'blog'`) but `classifyPage()` returns `PageKind` values (e.g. `'Location'`, `'Service'`, `'BlogPosting'`). We need a mapping between them and a field to carry the override.

`SchemaPageRole` is defined in `shared/types/schema-plan.ts:3-27`.
`PageKind` is defined in `server/schema/classifier.ts:9-21`.

- [ ] **Step 1: Add `SCHEMA_ROLE_TO_PAGE_KIND` to `server/schema-suggester.ts`**

Add this constant after `PAGE_TYPE_SCHEMA_MAP` (around line 120):

```typescript
import type { PageKind } from './schema/classifier.js';
import type { SchemaPageRole } from '../shared/types/schema-plan.ts';

/**
 * Maps site plan roles to PageKind values used by the generator.
 * 'auto' is intentionally absent — callers check for undefined and skip the override.
 */
export const SCHEMA_ROLE_TO_PAGE_KIND: Partial<Record<SchemaPageRole, PageKind>> = {
  homepage:     'Homepage',
  blog:         'BlogPosting',
  service:      'Service',
  about:        'AboutPage',
  contact:      'ContactPage',
  location:     'Location',
  'case-study': 'CaseStudy',
  generic:      'WebPage',
};
```

- [ ] **Step 2: Add `pageKindOverride` to `LeanGeneratorInput` in `server/schema/generator.ts`**

Add one field to the interface at line 62:

```typescript
export interface LeanGeneratorInput {
  pageId: string;
  pageMeta: PageMetaInput;
  html: string;
  baseUrl: string;
  workspace: WorkspaceSchemaInput;
  existingSchemas?: string[];
  aiBudget?: AiBudget;
  siteContext?: SiteContext;
  /**
   * When set, bypasses classifyPage() and uses this kind directly.
   * Set by the schema suggester when a site plan role or persisted pageType
   * override is available for this page.
   */
  pageKindOverride?: PageKind;
}
```

- [ ] **Step 3: Run typecheck to confirm no breakage**

```bash
npm run typecheck
```

Expected: zero errors (this is additive only).

- [ ] **Step 4: Commit**

```bash
git add server/schema/generator.ts server/schema-suggester.ts
git commit -m "feat(schema): add pageKindOverride to LeanGeneratorInput + SCHEMA_ROLE_TO_PAGE_KIND map"
```

---

## Task 2: Generator uses `pageKindOverride`

**Files:**
- Modify: `server/schema/generator.ts:295-305`

**File ownership — Task 2:**
Owns: `server/schema/generator.ts` (function body changes only — interface already committed by Task 1).
Must not touch: `server/schema-suggester.ts`, template files, `server/schema/data-sources.ts`.

### Context for the implementer

Currently line 299 reads:
```typescript
const classified = classifyPage(`${baseUrl}${input.pageMeta.publishedPath}`, baseUrl, { businessKind });
```

This is unconditional. We need to check `input.pageKindOverride` first. When an override is present, we still need a `ClassifiedPage` shape (for `pagePath`). Use `normalizePath` approach: build a synthetic `ClassifiedPage` from the override kind + the URL's path. The `primaryType` can be derived from `PAGE_TYPE_SCHEMA_MAP` or mapped statically.

`ClassifiedPage` interface is in `server/schema/classifier.ts:30-36`:
```typescript
export interface ClassifiedPage {
  kind: PageKind;
  primaryType: string;
  pagePath: string;
}
```

`PageKind` → `primaryType` mapping already exists implicitly in the generator's switch statement. Add a small helper.

- [ ] **Step 1: Add `pageKindToPrimaryType` module-level helper in `server/schema/generator.ts`**

Add this as a module-level function (not inside `generateLeanSchema`) after the imports block, before `detectExistingSchemas`:

```typescript
function pageKindToPrimaryType(kind: PageKind): string {
  const map: Record<PageKind, string> = {
    Homepage:       'Organization',
    BlogPosting:    'BlogPosting',
    BlogIndex:      'CollectionPage',
    Service:        'Service',
    ServiceIndex:   'CollectionPage',
    CaseStudy:      'Article',
    CaseStudyIndex: 'CollectionPage',
    AboutPage:      'AboutPage',
    ContactPage:    'ContactPage',
    Location:       'LocalBusiness',
    Legal:          'WebPage',
    WebPage:        'WebPage',
  };
  return map[kind] ?? 'WebPage';
}
```

- [ ] **Step 2: Replace the unconditional `classifyPage` call**

Find line 299:
```typescript
const classified = classifyPage(`${baseUrl}${input.pageMeta.publishedPath}`, baseUrl, { businessKind });
```

Replace with:
```typescript
const classified: ClassifiedPage = input.pageKindOverride
  ? {
      kind: input.pageKindOverride,
      primaryType: pageKindToPrimaryType(input.pageKindOverride),
      pagePath: input.pageMeta.publishedPath,
    }
  : classifyPage(`${baseUrl}${input.pageMeta.publishedPath}`, baseUrl, { businessKind });
```

Add the import for `ClassifiedPage` at the top of the file with the existing `classifyPage` import:
```typescript
import { classifyPage } from './classifier.js';
import type { ClassifiedPage } from './classifier.js';
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/schema/generator.ts
git commit -m "fix(schema): generator respects pageKindOverride — bypasses classifyPage() when set"
```

---

## Task 3: Wire site plan roles through `generateSchemaForPage` and the single-page endpoint

**Files:**
- Modify: `server/schema-suggester.ts:307-406` (`generateSchemaForPage`)
- Modify: `server/schema-suggester.ts:408-500` (`generateSchemaSuggestions` bulk)
- Modify: `server/routes/webflow-schema.ts:156-190` (single-page endpoint)

**File ownership — Task 3:**
Owns: `server/schema-suggester.ts` (function bodies), `server/routes/webflow-schema.ts`.
Must not touch: `server/schema/generator.ts` (owned by Tasks 1+2), template files.

### Context for the implementer

**Problem 1 — `generateSchemaForPage`:** The function fetches the site plan at line 343 for `canonicalEntities` only. It never reads `pageRoles`. The site plan has a `pageRoles: PageRoleAssignment[]` array where each entry has `pagePath` and `role`. We need to look up the role for the current page and convert it to a `PageKind` via `SCHEMA_ROLE_TO_PAGE_KIND`.

**Problem 2 — persisted `pageType`:** `ctx.pageType` is set on the context by the route (webflow-schema.ts:164) but `generateSchemaForPage` never reads `ctx.pageType`. It needs to check `ctx.pageType` too — this is the UI-level per-page override.

**Problem 3 — `webflow-schema.ts` single-page route:** `resolvedPageType` is set at line 163 as `ctx.pageType` but never forwarded to `generateSchemaForPage` separately. This is fine once Problem 2 is fixed — `generateSchemaForPage` will read `ctx.pageType`.

**`SchemaPageType` → `PageKind` mapping:** `SchemaPageType` (from `ctx.pageType`) is similar to `SchemaPageRole` but includes `'auto'`. Same `SCHEMA_ROLE_TO_PAGE_KIND` map works since the string values are identical.

`getSchemaPlan` returns `SchemaSitePlan | undefined`. Import is already present at line 18.

- [ ] **Step 1: In `generateSchemaForPage`, resolve `pageKindOverride` before calling `generateLeanSchema`**

Find the block that assembles `siteContextForPage` (around line 332). After the `siteContextForPage` assignment, add:

```typescript
// Resolve pageKindOverride from (priority order):
// 1. ctx.pageType (UI per-page override, e.g. 'location')
// 2. site plan role for this pagePath
let pageKindOverride: import('./schema/classifier.js').PageKind | undefined;
const ctxPageType = ctx.pageType;
if (ctxPageType && ctxPageType !== 'auto') {
  pageKindOverride = SCHEMA_ROLE_TO_PAGE_KIND[ctxPageType as import('../shared/types/schema-plan.ts').SchemaPageRole];
}
if (!pageKindOverride) {
  const plan = getSchemaPlan(siteId);
  const planRole = plan?.pageRoles.find(
    pr => pr.pagePath === publishedPath || pr.pagePath === publishedPath.replace(/\/$/, ''),
  );
  if (planRole && planRole.role !== 'generic') {
    pageKindOverride = SCHEMA_ROLE_TO_PAGE_KIND[planRole.role];
  }
}
```

- [ ] **Step 2: Pass `pageKindOverride` to `generateLeanSchema`**

In the `generateLeanSchema` call (line 368), add the field:

```typescript
const lean = await generateLeanSchema({
  pageId,
  pageMeta: { ... },
  html: html || '',
  baseUrl,
  workspace: { ... },
  aiBudget,
  siteContext: siteContextForPage,
  pageKindOverride,  // ← add this line
});
```

- [ ] **Step 3: Do the same in `generateSchemaSuggestions` (bulk path)**

Find where `generateSchemaForPage` is called in the bulk loop (around line 450). The bulk path calls `generateSchemaForPage` with the same `ctx`. Confirm `ctx.pageType` is per-page or global — if global, the site plan lookup inside `generateSchemaForPage` handles per-page resolution correctly. No changes needed to the bulk loop itself — the fix in Step 1 fires for every page.

Verify by grepping:
```bash
grep -n "generateSchemaForPage" server/schema-suggester.ts
```

If the bulk path calls `generateSchemaForPage` in a loop, the per-page resolution in Step 1 runs for each page automatically.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add server/schema-suggester.ts server/routes/webflow-schema.ts
git commit -m "fix(schema): wire site plan roles + ctx.pageType override into generateSchemaForPage"
```

---

## Task 4: Template quality fixes

**Files:**
- Modify: `server/schema/templates/local-business.ts`
- Modify: `server/schema/templates/homepage.ts`
- Modify: `server/schema/templates/service.ts`
- Modify: `server/schema/templates/article.ts`
- Modify: `server/schema/data-sources.ts` (add `industrySubtype` to `WorkspaceSchemaInput`)

**Note:** `static.ts` (`AboutPage`, `ContactPage`) already has `isPartOf: webSiteRef(baseUrl)` on nodes that ARE `WebPage` subtypes — no change needed there.

**File ownership — Task 4:**
Owns: all files listed above.
Must not touch: `server/schema/generator.ts` (Task 2), `server/schema-suggester.ts` (Tasks 1 + 3), `server/routes/webflow-schema.ts` (Task 3).

### Context for the implementer

Four quality gaps to fix across templates:

**A. Per-location `@id`, `url`, and `@type` subtype in `local-business.ts`**

Currently line 131–134:
```typescript
'@id': `${baseUrl}/#localbusiness`,  // BUG: same for all locations
'url': baseUrl,                       // BUG: points to root, not page URL
```

For pages classified as `Location` (not `Homepage`), the `@id` must be page-specific and `url` must be the page URL. The `pageData.canonicalUrl` field carries the full page URL.

For `Homepage` kind using this template (i.e. `businessKind === 'local'`), keep `/#localbusiness` sitewide.

The template receives `pageData: PageData`. Check if `pageData.canonicalUrl === baseUrl` to distinguish homepage from location page.

**Industry subtype (`@type: Dentist` etc.):** `LocalBusinessInput` must accept an optional `industrySubtype` field sourced from the site plan's `PageRoleAssignment.industrySubtype`. The generator passes it through when present. Mapping:

```typescript
// shared/types/schema-plan.ts already defines:
// export type SchemaIndustrySubtype = 'medical' | 'financial' | null;

const INDUSTRY_SUBTYPE_TO_SCHEMA_TYPE: Record<string, string> = {
  medical:   'Dentist',      // MedicalBusiness → LocalBusiness subtype; Google local pack
  financial: 'FinancialService',
};
```

Fix — @id, url, and @type:
```typescript
const isHomepageUsage = pageData.canonicalUrl === baseUrl || pageData.canonicalUrl === `${baseUrl}/`;
const lbId = isHomepageUsage
  ? `${baseUrl}/#localbusiness`
  : `${pageData.canonicalUrl}#localbusiness`;

const localBusinessType = input.industrySubtype
  ? (INDUSTRY_SUBTYPE_TO_SCHEMA_TYPE[input.industrySubtype] ?? 'LocalBusiness')
  : 'LocalBusiness';

const localBusiness = dropUndefined({
  '@type': localBusinessType,
  '@id': lbId,
  ...
  'url': isHomepageUsage ? baseUrl : pageData.canonicalUrl,
  ...
});
```

Also update the `lbId` reference on line 176 (`const lbId = ...`) to use this same variable.

Also update all `staffNode.worksFor` references that hardcode `${baseUrl}/#localbusiness` (line 65) to use the same `lbId` variable.

**Wire `industrySubtype` through the generator:** In `generator.ts`, when building the `Location` case, look up the site plan role for `input.pageMeta.publishedPath` and pass its `industrySubtype` to `buildLocalBusinessSchema`. The site plan is available via `input.siteContext` (if we thread it) or via a direct `getSchemaPlan` call. Simplest: add `industrySubtype?: string` to `LocalBusinessInput` and pass it from the generator's `case 'Location'` branch:

```typescript
// In generator.ts, case 'Location':
import { getSchemaPlan } from '../schema-store.js';
const plan = input.workspace.id ? getSchemaPlan(/* siteId needed */) : undefined;
// NOTE: siteId is not on LeanGeneratorInput — pass industrySubtype via workspace instead.
```

Simpler alternative: add `industrySubtype?: string` to `WorkspaceSchemaInput` and populate it in `generateSchemaForPage` from the site plan role lookup (same place we resolve `pageKindOverride` in Task 3). This keeps the generator stateless.

```typescript
// In schema-suggester.ts generateSchemaForPage, after resolving pageKindOverride:
const industrySubtype = planRole?.industrySubtype ?? undefined;

// Then in generateLeanSchema call:
workspace: {
  ...
  industrySubtype,  // ← new field
},
```

Add `industrySubtype?: string` to `WorkspaceSchemaInput` in `server/schema/data-sources.ts`.

**B. `WebPage` node on location pages**

After fixing `localBusiness`, add a `WebPage` node when this is a location page (not homepage):

```typescript
const webPageNode = !isHomepageUsage ? dropUndefined({
  '@type': 'WebPage',
  '@id': `${pageData.canonicalUrl}#webpage`,
  'url': pageData.canonicalUrl,
  'name': pageData.cleanTitle,
  'description': pageData.description,
  'isPartOf': { '@id': `${baseUrl}/#website` },
  'about': { '@id': lbId },
  'inLanguage': pageData.inLanguage,
}) : undefined;
```

Add to the return array:
```typescript
const nodes = [organization, localBusiness, website, ...reviews, ...staffNodes];
if (webPageNode) nodes.splice(1, 0, webPageNode); // after org, before localBusiness
return withBreadcrumb(nodes, pageData);
```

**C. `WebPage` node on homepage + `contactPoint` + `description` on Organization**

In `homepage.ts`, the Organization node is missing `description` and `contactPoint`. The WebSite node is missing a sibling `WebPage` node.

In `buildHomepageSchema`, add `description` and `contactPoint` to `organization`:
```typescript
const organization = dropUndefined({
  ...
  'description': pageData.description,
  'contactPoint': pageData.canonicalUrl ? {
    '@type': 'ContactPoint',
    'contactType': 'customer service',
    'url': `${baseUrl}/contact`,
  } : undefined,
});
```

Add a `WebPage` node:
```typescript
const webPage = dropUndefined({
  '@type': 'WebPage',
  '@id': `${baseUrl}/#webpage`,
  'url': baseUrl,
  'name': pageData.cleanTitle,
  'description': pageData.description,
  'isPartOf': { '@id': `${baseUrl}/#website` },
  'about': { '@id': `${baseUrl}/#organization` },
  'inLanguage': pageData.inLanguage,
});

return { '@context': 'https://schema.org', '@graph': [organization, website, webPage] };
```

**D. `WebPage` node on service and article templates**

Verified via codebase read:
- `service.ts` line 94: has `isPartOf: webSiteRef(baseUrl)` on the `Service` node itself — incorrect, `Service` is not a `WebPage` subtype. Remove `isPartOf` from the `Service` node and add a sibling `WebPage` node instead.
- `article.ts` line 44: has `mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }` as an inline reference, not a full graph node. Replace with a proper sibling `WebPage` graph node.

Fix for `service.ts` — remove `isPartOf` from `primary` and add a `WebPage` node:
```typescript
// Remove this line from the primary Service node:
// 'isPartOf': webSiteRef(baseUrl),

// Add after primary is defined:
const webPageNode = dropUndefined({
  '@type': 'WebPage' as const,
  '@id': `${pageData.canonicalUrl}#webpage`,
  'url': pageData.canonicalUrl,
  'name': pageData.cleanTitle,
  'description': pageData.description,
  'isPartOf': webSiteRef(baseUrl),
  'about': { '@id': serviceId },
  'inLanguage': pageData.inLanguage,
});
```

Add `webPageNode` to the return array (before `withBreadcrumb` wraps it).

Fix for `article.ts` — remove `mainEntityOfPage` inline ref and add a `WebPage` node:
```typescript
// Remove from BlogPosting node:
// 'mainEntityOfPage': { '@type': 'WebPage', '@id': pageData.canonicalUrl },

// Add a sibling WebPage graph node:
const webPageNode = dropUndefined({
  '@type': 'WebPage' as const,
  '@id': `${pageData.canonicalUrl}#webpage`,
  'url': pageData.canonicalUrl,
  'name': pageData.cleanTitle,
  'isPartOf': webSiteRef(input.baseUrl),
  'about': { '@id': articleId },   // articleId is the BlogPosting @id
  'inLanguage': pageData.inLanguage,
});
```

Add `webPageNode` to the return graph array alongside the BlogPosting node.

- [ ] **Step 1: Fix `local-business.ts` — per-location @id, url, and WebPage node**

Apply fix A and fix B described above.

- [ ] **Step 2: Fix `homepage.ts` — WebPage node + Organization description + contactPoint**

Apply fix C described above.

- [ ] **Step 3: Check and fix `service.ts` and `article.ts`**

Run the grep above. Add `WebPage` nodes if absent.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Run vitest to confirm no existing tests broken**

```bash
npx vitest run tests/unit/schema/
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/schema/templates/local-business.ts server/schema/templates/homepage.ts \
        server/schema/templates/service.ts server/schema/templates/article.ts
git commit -m "fix(schema): per-location @id/url, WebPage node on all templates, Organization description+contactPoint"
```

---

## Task 5: Tests for wiring and template fixes

**Files:**
- Create: `tests/unit/schema/wiring.test.ts`

### Context for the implementer

Port: use 13320 (check with `grep -r 'createTestContext(' tests/` — 13320 is one above the current max of 13319).

These are unit tests — no server needed, no `createTestContext`. Import `generateLeanSchema` directly and mock the HTML fetch.

Actually these should be pure unit tests of `generateLeanSchema` with a fake HTML input and `pageKindOverride` set. Verify the correct template fires.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/wiring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateLeanSchema } from '../../../server/schema/generator.js';

const BASE = 'https://example.com';

const minimalWorkspace = {
  id: 'ws-test',
  name: 'Test Co',
  publisherLogoUrl: null,
  businessProfile: null,
  defaultLocale: 'en' as const,
  siteKeywordsForKnowsAbout: [],
  siteHasSearch: false,
};

const minimalHtml = `<html><head><title>Test</title></head><body><p>Content</p></body></html>`;

describe('pageKindOverride', () => {
  it('forces Location template when pageKindOverride is Location', async () => {
    const result = await generateLeanSchema({
      pageId: 'page-1',
      pageMeta: {
        title: 'Downtown',
        slug: 'location/downtown',
        publishedPath: '/location/downtown',
        seo: {},
        sourcePublishedAt: null,
      },
      html: minimalHtml,
      baseUrl: BASE,
      workspace: minimalWorkspace,
      pageKindOverride: 'Location',
    });
    const types = (result.suggestedSchemas[0]?.template['@graph'] as Array<{ '@type': string }>)
      ?.map(n => n['@type']) ?? [];
    expect(types).toContain('LocalBusiness');
  });

  it('auto-detects BlogPosting when no override', async () => {
    const result = await generateLeanSchema({
      pageId: 'page-2',
      pageMeta: {
        title: 'My Post',
        slug: 'blog/my-post',
        publishedPath: '/blog/my-post',
        seo: {},
        sourcePublishedAt: null,
      },
      html: minimalHtml,
      baseUrl: BASE,
      workspace: minimalWorkspace,
    });
    const types = (result.suggestedSchemas[0]?.template['@graph'] as Array<{ '@type': string }>)
      ?.map(n => n['@type']) ?? [];
    expect(types).toContain('BlogPosting');
  });

  it('override wins over URL pattern — Location on /blog/ path', async () => {
    const result = await generateLeanSchema({
      pageId: 'page-3',
      pageMeta: {
        title: 'Not a blog post',
        slug: 'blog/not-a-post',
        publishedPath: '/blog/not-a-post',
        seo: {},
        sourcePublishedAt: null,
      },
      html: minimalHtml,
      baseUrl: BASE,
      workspace: minimalWorkspace,
      pageKindOverride: 'Location',
    });
    const types = (result.suggestedSchemas[0]?.template['@graph'] as Array<{ '@type': string }>)
      ?.map(n => n['@type']) ?? [];
    expect(types).toContain('LocalBusiness');
    expect(types).not.toContain('BlogPosting');
  });
});

describe('industry subtype', () => {
  it('emits @type Dentist when industrySubtype is medical', async () => {
    const result = await generateLeanSchema({
      pageId: 'page-dental',
      pageMeta: {
        title: 'Downtown Dentist',
        slug: 'location/downtown',
        publishedPath: '/location/downtown',
        seo: {},
        sourcePublishedAt: null,
      },
      html: minimalHtml,
      baseUrl: BASE,
      workspace: { ...minimalWorkspace, industrySubtype: 'medical' },
      pageKindOverride: 'Location',
    });
    const graph = result.suggestedSchemas[0]?.template['@graph'] as Array<{ '@type': string }>;
    const lb = graph?.find(n => n['@type'] === 'Dentist' || n['@type'] === 'LocalBusiness');
    expect(lb?.['@type']).toBe('Dentist');
  });
});

describe('per-location @id uniqueness', () => {
  it('location page @id includes page path, not just /#localbusiness', async () => {
    const result = await generateLeanSchema({
      pageId: 'page-4',
      pageMeta: {
        title: 'Downtown',
        slug: 'location/downtown',
        publishedPath: '/location/downtown',
        seo: {},
        sourcePublishedAt: null,
      },
      html: minimalHtml,
      baseUrl: BASE,
      workspace: minimalWorkspace,
      pageKindOverride: 'Location',
    });
    const graph = result.suggestedSchemas[0]?.template['@graph'] as Array<{ '@type': string; '@id': string }>;
    const lb = graph?.find(n => n['@type'] === 'LocalBusiness');
    expect(lb?.['@id']).toBe(`${BASE}/location/downtown#localbusiness`);
    expect(lb?.['@id']).not.toBe(`${BASE}/#localbusiness`);
  });
});

describe('WebPage node on homepage', () => {
  it('homepage graph includes a WebPage node', async () => {
    const result = await generateLeanSchema({
      pageId: 'home',
      pageMeta: {
        title: 'Home',
        slug: '',
        publishedPath: '/',
        seo: {},
        sourcePublishedAt: null,
      },
      html: minimalHtml,
      baseUrl: BASE,
      workspace: minimalWorkspace,
    });
    const types = (result.suggestedSchemas[0]?.template['@graph'] as Array<{ '@type': string }>)
      ?.map(n => n['@type']) ?? [];
    expect(types).toContain('WebPage');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/schema/wiring.test.ts
```

Expected: fails (Tasks 2 and 4 not yet done — or run after Tasks 2+4 are done).

- [ ] **Step 3: Run tests to confirm they pass after Tasks 2+4**

```bash
npx vitest run tests/unit/schema/wiring.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Run quality gates**

```bash
npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/schema/wiring.test.ts
git commit -m "test(schema): wiring override + per-location @id + WebPage node assertions"
```

---

---

## Systemic Improvements

**Shared utilities:** No new shared utilities needed — `SCHEMA_ROLE_TO_PAGE_KIND` in `schema-suggester.ts` serves as the canonical mapping for both single-page and bulk paths.

**pr-check rules to add:** None for this batch — the bugs are structural wiring issues, not pattern violations catchable by regex.

**New tests required:** `tests/unit/schema/wiring.test.ts` (Task 5) — covers override bypass, per-location @id uniqueness, WebPage node presence, and Dentist subtype. These are regression guards for the exact bugs being fixed.

**Follow-up plans (not in scope here):**
- `businessType` workspace field → `SoftwareApplication` / `ProfessionalService` / `LegalService` on homepage for non-local businesses
- Webflow CMS API enrichment for JS-rendered location page NAP (address, phone, hours)
- Site plan AI prompt quality — fix GPT-4-mini misclassifying `/location/*` as `generic`

---

## Self-Review

**Spec coverage:**
- ✅ Site plan role → PageKind wiring (Tasks 1–3)
- ✅ UI pageType override wiring (Task 3)
- ✅ Per-location `@id` uniqueness (Task 4A)
- ✅ `LocalBusiness.url` per-page (Task 4A)
- ✅ `@type: Dentist` / industry subtype via `WorkspaceSchemaInput.industrySubtype` (Task 4A)
- ✅ `WebPage` node on location pages (Task 4B)
- ✅ `WebPage` node on homepage (Task 4C)
- ✅ Organization `description` + `contactPoint` (Task 4C)
- ✅ `WebPage` node on service/article (Task 4D)
- ✅ Tests for override + @id + WebPage (Task 5)

**What this does NOT include (follow-up work):**
- `businessType` taxonomy for SaaS/ProfessionalService/SoftwareApplication nodes — separate plan
- Webflow CMS API enrichment for JS-rendered location page NAP — separate plan
- Site plan AI (GPT-4-mini) classification quality — separate plan (fix prompt to correctly identify `/location/*` as `location` role)
