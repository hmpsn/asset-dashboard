# Schema Pillar 3 — Compile-time + CI Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock in the Pillar 1 + Pillar 2 schema quality bar with three additional gates so future regressions can't ship: (a) `schema-dts` typed return values catch field-shape errors at TypeScript compile time, (b) `schemarama` validates schema.org shape correctness in CI on a fixture corpus, (c) a new pr-check rule asserts every primary-node template imports the cross-reference helpers (`webSiteRef`, `breadcrumbRef`) so authors can't forget them silently.

**Architecture:** Three independent gates layered on the existing pipeline.
1. **Compile-time (`schema-dts`).** Replace `Record<string, unknown>` return types in `server/schema/templates/*.ts` with `WithContext<Article>`, `WithContext<WebPage>`, etc. Templates keep returning the same shape; the type system now enforces required fields and correct nested shapes for `image: ImageObject | URL[]`, `author: Person | Organization`, etc. Costs ~60 LOC across 8 templates and `generator.ts`. Pure devDep, zero runtime cost.
2. **CI shape validation (`schemarama`).** Add a CI-only test `tests/integration/schemarama-corpus.test.ts` that runs the lean generator over a small fixture corpus (homepage, blog post, case study, service, privacy, contact) and pipes each `@graph` through `schemarama` for shape validation. Fail the build on schema.org spec violations (e.g. `author: { name: 'X' }` missing `@type`).
3. **pr-check rule.** New rule `every-primary-template-imports-cross-ref-helpers` asserts that any file matching `server/schema/templates/*.ts` (excluding `helpers.ts` itself and `homepage.ts`, which doesn't have a parent breadcrumb) imports both `webSiteRef` and `breadcrumbRef` from `./helpers.js`. Catches the regression class at PR time before any tests run.

**Tech Stack:** TypeScript strict (existing), `schema-dts` (new devDep — Google's official types, ~5MB, zero runtime), `schemarama` (new devDep — Google's structured-data validator, ~5MB), vitest (existing), `scripts/pr-check.ts` (existing, already 4965 lines with similar customCheck rules).

**MVP scope:** All three gates wired and green for the 8 lean templates. Fixture corpus with 6 representative pages.

**Out of scope:** Live "Google Rich Results Test" API integration (no public API exists per the 2026-04-29 audit), `schemarama` against arbitrary user-generated workspaces (CI-only fixture corpus is the bar).

---

## Pre-requisites

- [ ] **Pillar 2 + Pillar 1 must both be merged to staging first.** Pillar 3's typed return values assume Pillar 2's `cleanTitle`/`inLanguage`/etc. fields exist; the schemarama corpus assumes Pillar 1's clean validator output. Confirm both `schema-pillar-2-data-wiring` and `schema-pillar-1-validator-bar` are `done` in `data/roadmap.json`.
- [ ] Branch from latest staging: `git checkout staging && git pull && git checkout -b claude/schema-pillar-3`

---

## Task Dependencies

```
Sequential foundation:
  Task 1 (Add schema-dts + schemarama deps)
  → Task 2 (Type helpers.ts return types — refs and shape utilities)

Parallel after Task 2 (one template each — non-overlapping files):
  Task 3 (article.ts)  ∥  Task 4 (service.ts)  ∥
  Task 5 (local-business.ts + homepage.ts)  ∥  Task 6 (static.ts)

Sequential after Tasks 3–6:
  Task 7 (Type generator.ts + validator.ts surfaces)
  Task 8 (schemarama fixture corpus + integration test)
  Task 9 (pr-check rule for cross-ref helper imports)
  Task 10 (Quality gates + docs)
```

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 Add deps | haiku | `npm install` + package.json edit |
| 2 Type helpers | sonnet | `WithContext` and `WebSite` shape choices |
| 3 article.ts typing | sonnet | Article + BlogPosting union; author=Person\|Organization |
| 4 service.ts typing | sonnet | Service + Product types |
| 5 local-business + homepage typing | sonnet | LocalBusiness, Organization, WebSite, SearchAction shapes |
| 6 static.ts typing | sonnet | 4 page types; mainEntity reference shape |
| 7 generator + validator typing | sonnet | Aligns the orchestrator return type |
| 8 schemarama corpus | sonnet | Fixture authoring + library wiring |
| 9 pr-check rule | sonnet | customCheck pattern matches existing examples |
| 10 Quality gates + docs | haiku | Doc transcription |

Reviewers: spec-compliance reviewer = opus, code-quality reviewer = opus.

---

## File Map

### New files

| Path | Lines (est) | Responsibility |
|---|---|---|
| `tests/integration/schemarama-corpus.test.ts` | ~150 | Runs lean generator over 6 fixture pages, validates each via schemarama |
| `tests/fixtures/schema-corpus.ts` | ~120 | Six `LeanGeneratorInput` fixtures: homepage, blog, case study, service, privacy, contact. |

### Modified files

| Path | Modification |
|---|---|
| `package.json` | Add `schema-dts` and `schemarama` to `devDependencies`. |
| `server/schema/templates/helpers.ts` | Type `webSiteRef`, `breadcrumbRef`, `orgRef`, `imageNode` returns using `schema-dts` types. Type `withBreadcrumb` to accept the typed primary node. |
| `server/schema/templates/article.ts` | Typed `WithContext<{ '@graph': (Article \| BlogPosting \| BreadcrumbList)[] }>` return. |
| `server/schema/templates/service.ts` | Typed `WithContext<{ '@graph': (Service \| Product \| BreadcrumbList)[] }>` return. |
| `server/schema/templates/local-business.ts` | Typed `WithContext<{ '@graph': (LocalBusiness \| Organization \| WebSite \| BreadcrumbList)[] }>` return. |
| `server/schema/templates/homepage.ts` | Typed `WithContext<{ '@graph': (Organization \| WebSite)[] }>` return. |
| `server/schema/templates/static.ts` | Typed return per static page kind. |
| `server/schema/generator.ts` | `LeanGeneratorOutput.suggestedSchemas[].template` typed as `WithContext<unknown>` or a union of the template return types. |
| `server/schema/validator.ts` | Accept the typed schema input (no runtime change). |
| `scripts/pr-check.ts` | Task 9: append a new rule object to the `CHECKS` array. |
| `docs/rules/automated-rules.md` | Auto-regenerated by `npm run rules:generate`. |
| `FEATURE_AUDIT.md` | Task 10: append Pillar 3 paragraph. |
| `data/roadmap.json` | Task 10: add `schema-pillar-3-gates` (status `done`). |

### Files left untouched

- `server/schema/data-sources.ts`, `server/schema/extractors/*.ts`, `server/schema-suggester.ts` — no changes.

---

## Tasks

### Task 1: Add deps (haiku)

**Owns:** `package.json`, `package-lock.json`
**Must not touch:** any source file.

- [ ] **Step 1: Install both libraries as devDependencies.**

```bash
npm install --save-dev schema-dts schemarama
```

- [ ] **Step 2: Verify they appear in `package.json` `devDependencies`.**

```bash
grep -E '"schema-dts"|"schemarama"' package.json
```

Expected: both visible with version pins.

- [ ] **Step 3: Verify the install didn't break the existing build.**

```bash
npm run typecheck
npx vite build
```

Expected: zero errors. If `schemarama` ships an unexpected runtime side effect (e.g. requires `jsonld`), install it: `npm install --save-dev jsonld`.

- [ ] **Step 4: Commit.**

```bash
git add package.json package-lock.json
git commit -m "chore(schema): add schema-dts and schemarama devDependencies

schema-dts (Google's official Schema.org TypeScript types) — types-only, zero runtime.
schemarama (Google's structured-data shape validator) — used by the CI fixture corpus.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Type helpers.ts (sonnet)

**Owns:** `server/schema/templates/helpers.ts`
**Must not touch:** templates, generator.

- [ ] **Step 1: Replace return types with schema-dts equivalents.**

Update imports and signatures (no behaviour change):

```typescript
import type { Thing, WithContext, BreadcrumbList, ImageObject, Organization, WebSite } from 'schema-dts';
import type { BreadcrumbItem, PageData } from '../data-sources.js';

/**
 * Removes keys whose value is undefined. Generic over T so the typed return matches the input.
 */
export function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function buildBreadcrumb(items: BreadcrumbItem[], canonicalUrl: string): BreadcrumbList | undefined {
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonicalUrl}#breadcrumb`,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function orgRef(baseUrl: string): { '@id': string } {
  return { '@id': `${baseUrl}/#organization` };
}

export function webSiteRef(baseUrl: string): { '@id': string } {
  return { '@id': `${baseUrl}/#website` };
}

export function breadcrumbRef(canonicalUrl: string): { '@id': string } {
  return { '@id': `${canonicalUrl}#breadcrumb` };
}

export function imageNode(url: string | undefined): ImageObject | undefined {
  if (!url) return undefined;
  return { '@type': 'ImageObject', url };
}

export function scrubBrandSuffix(name: string, brand: string): string {
  if (!brand) return name;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\s+[|\\-—·]\\s+${escaped}\\s*$`, 'i');
  return name.replace(re, '').trim() || name;
}

/**
 * Wraps one or more primary nodes into a complete schema document.
 * Generic over the primary node's schema-dts type so the resulting @graph stays typed.
 */
export function withBreadcrumb<P extends Thing>(
  primary: P | P[],
  pageData: PageData,
): WithContext<{ '@graph': (P | BreadcrumbList)[] }> {
  const graph: (P | BreadcrumbList)[] = Array.isArray(primary) ? [...primary] : [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);
  return { '@context': 'https://schema.org', '@graph': graph } as WithContext<{ '@graph': (P | BreadcrumbList)[] }>;
}

// Keep these imports re-exported for convenience.
export type { Organization, WebSite };
```

- [ ] **Step 2: Run typecheck.**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: errors in templates that haven't yet been re-typed (Tasks 3–6 fix). Errors should NOT appear inside `helpers.ts` itself.

- [ ] **Step 3: Commit.**

```bash
git add server/schema/templates/helpers.ts
git commit -m "feat(schema): type helpers with schema-dts (Pillar 3)

withBreadcrumb is generic over the primary node so each template's @graph
stays typed end-to-end.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Type article.ts (sonnet) — PARALLEL

**Owns:** `server/schema/templates/article.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Replace the return type and inner node typing.**

```typescript
import type { Article, BlogPosting, BreadcrumbList, Person, Organization, WithContext } from 'schema-dts';
import type { PageData } from '../data-sources.js';
import { dropUndefined, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
}

export type ArticleKind = 'BlogPosting' | 'Article';

export function buildArticleSchema(
  input: ArticleInput,
  kind: ArticleKind,
): WithContext<{ '@graph': (Article | BlogPosting | BreadcrumbList)[] }> {
  const { pageData } = input;

  const author: Person | Organization = pageData.author
    ? { '@type': 'Person', name: pageData.author }
    : { '@type': 'Organization', name: pageData.publisher.name };

  const primary = dropUndefined({
    '@type': kind,
    '@id': `${pageData.canonicalUrl}#article`,
    headline: pageData.cleanTitle,
    description: pageData.description,
    image: pageData.image ? [pageData.image] : undefined,
    url: pageData.canonicalUrl,
    datePublished: pageData.datePublished,
    dateModified: pageData.dateModified || pageData.datePublished,
    mainEntityOfPage: { '@type': 'WebPage' as const, '@id': pageData.canonicalUrl },
    author,
    publisher: dropUndefined({
      '@type': 'Organization' as const,
      name: pageData.publisher.name,
      logo: pageData.publisher.logoUrl
        ? { '@type': 'ImageObject' as const, url: pageData.publisher.logoUrl }
        : undefined,
    }),
    isPartOf: webSiteRef(input.baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
    articleSection: pageData.articleSection,
    about: kind === 'Article' ? 'Case study' : undefined,
  }) as Article | BlogPosting;

  return withBreadcrumb(primary, pageData);
}
```

- [ ] **Step 2: Typecheck this file alone.**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep 'server/schema/templates/article.ts' | head -10
```

Expected: zero errors from this file. Other templates may still error — that's Tasks 4–6's job.

- [ ] **Step 3: Run article unit tests.**

```bash
npx vitest run tests/unit/schema/templates.test.ts -t 'buildArticleSchema'
```

Expected: PASS — typing change is non-behavioural.

- [ ] **Step 4: Commit.**

```bash
git add server/schema/templates/article.ts
git commit -m "feat(schema): type article template return with schema-dts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Type service.ts (sonnet) — PARALLEL

**Owns:** `server/schema/templates/service.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Apply the same pattern as article.ts.**

```typescript
import type { Service, Product, BreadcrumbList, WithContext } from 'schema-dts';
import type { PageData } from '../data-sources.js';
import { dropUndefined, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
}

export function buildServiceSchema(
  input: ServiceInput,
): WithContext<{ '@graph': (Service | BreadcrumbList)[] }> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'Service' as const,
    '@id': `${pageData.canonicalUrl}#service`,
    name: pageData.cleanTitle,
    description: pageData.description,
    image: pageData.image,
    url: pageData.canonicalUrl,
    provider: { '@type': 'Organization' as const, '@id': `${baseUrl}/#organization`, name: pageData.publisher.name },
    isPartOf: webSiteRef(baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
  }) as Service;
  return withBreadcrumb(primary, pageData);
}

export function buildProductSchema(
  input: ServiceInput,
): WithContext<{ '@graph': (Product | BreadcrumbList)[] }> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'Product' as const,
    '@id': `${pageData.canonicalUrl}#product`,
    name: pageData.cleanTitle,
    description: pageData.description,
    image: pageData.image,
    url: pageData.canonicalUrl,
    isPartOf: webSiteRef(baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
  }) as Product;
  return withBreadcrumb(primary, pageData);
}
```

- [ ] **Step 2: Typecheck + test.**

```bash
npm run typecheck 2>&1 | grep 'service.ts'
npx vitest run tests/unit/schema/templates.test.ts -t 'buildServiceSchema|buildProductSchema'
```

Expected: typecheck file-level clean; tests PASS.

- [ ] **Step 3: Commit.**

```bash
git add server/schema/templates/service.ts
git commit -m "feat(schema): type service+product templates with schema-dts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Type local-business.ts + homepage.ts (sonnet) — PARALLEL

**Owns:** `server/schema/templates/local-business.ts`, `server/schema/templates/homepage.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Update `homepage.ts`.**

```typescript
import type { Organization, WebSite, WithContext, SearchAction } from 'schema-dts';
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined } from './helpers.js';

export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
}

export function buildHomepageSchema(
  input: HomepageInput,
): WithContext<{ '@graph': (Organization | WebSite)[] }> {
  const { baseUrl, pageData, businessProfile } = input;

  const organization = dropUndefined({
    '@type': 'Organization' as const,
    '@id': `${baseUrl}/#organization`,
    name: pageData.publisher.name,
    url: baseUrl,
    description: pageData.description,
    image: pageData.image,
    logo: pageData.publisher.logoUrl
      ? { '@type': 'ImageObject' as const, url: pageData.publisher.logoUrl }
      : undefined,
    sameAs: businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
    foundedDate: businessProfile?.foundedDate,
  }) as Organization;

  const searchAction: SearchAction = {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${baseUrl}/?s={search_term_string}` },
    'query-input': 'required name=search_term_string',
  };

  const website: WebSite = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    name: pageData.publisher.name,
    url: baseUrl,
    publisher: { '@id': `${baseUrl}/#organization` },
    inLanguage: pageData.inLanguage,
    potentialAction: searchAction,
  };

  return { '@context': 'https://schema.org', '@graph': [organization, website] };
}
```

- [ ] **Step 2: Update `local-business.ts` similarly.**

Type the LocalBusiness primary node and the sibling Organization/WebSite emitted alongside it. Use `WithContext<{ '@graph': (LocalBusiness | Organization | WebSite | BreadcrumbList)[] }>`.

- [ ] **Step 3: Typecheck + test.**

```bash
npm run typecheck 2>&1 | grep -E 'homepage.ts|local-business.ts'
npx vitest run tests/unit/schema/templates.test.ts -t 'buildHomepageSchema|buildLocalBusinessSchema'
```

Expected: file-level clean, tests PASS.

- [ ] **Step 4: Commit.**

```bash
git add server/schema/templates/homepage.ts server/schema/templates/local-business.ts
git commit -m "feat(schema): type homepage+local-business templates with schema-dts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Type static.ts (sonnet) — PARALLEL

**Owns:** `server/schema/templates/static.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Type each of the 4 page builders.**

```typescript
import type { AboutPage, ContactPage, CollectionPage, WebPage, BreadcrumbList, WithContext } from 'schema-dts';
import type { PageData } from '../data-sources.js';
import { dropUndefined, orgRef, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
}

export function buildAboutPageSchema(
  input: StaticInput,
): WithContext<{ '@graph': (AboutPage | BreadcrumbList)[] }> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'AboutPage' as const,
    '@id': `${pageData.canonicalUrl}#aboutpage`,
    name: pageData.cleanTitle,
    description: pageData.description,
    url: pageData.canonicalUrl,
    mainEntity: orgRef(baseUrl),
    isPartOf: webSiteRef(baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
  }) as AboutPage;
  return withBreadcrumb(primary, pageData);
}

export function buildContactPageSchema(
  input: StaticInput,
): WithContext<{ '@graph': (ContactPage | BreadcrumbList)[] }> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'ContactPage' as const,
    '@id': `${pageData.canonicalUrl}#contactpage`,
    name: pageData.cleanTitle,
    description: pageData.description,
    url: pageData.canonicalUrl,
    isPartOf: webSiteRef(baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
  }) as ContactPage;
  return withBreadcrumb(primary, pageData);
}

export function buildCollectionPageSchema(
  input: StaticInput,
): WithContext<{ '@graph': (CollectionPage | BreadcrumbList)[] }> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'CollectionPage' as const,
    '@id': `${pageData.canonicalUrl}#collection`,
    name: pageData.cleanTitle,
    description: pageData.description,
    url: pageData.canonicalUrl,
    isPartOf: webSiteRef(baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
  }) as CollectionPage;
  return withBreadcrumb(primary, pageData);
}

export function buildWebPageSchema(
  input: StaticInput,
): WithContext<{ '@graph': (WebPage | BreadcrumbList)[] }> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'WebPage' as const,
    '@id': `${pageData.canonicalUrl}#webpage`,
    name: pageData.cleanTitle,
    description: pageData.description,
    url: pageData.canonicalUrl,
    isPartOf: webSiteRef(baseUrl),
    breadcrumb: breadcrumbRef(pageData.canonicalUrl),
    inLanguage: pageData.inLanguage,
  }) as WebPage;
  return withBreadcrumb(primary, pageData);
}
```

- [ ] **Step 2: Typecheck + test.**

```bash
npm run typecheck 2>&1 | grep 'static.ts'
npx vitest run tests/unit/schema/templates.test.ts -t 'static page templates'
```

Expected: file-level clean, tests PASS.

- [ ] **Step 3: Commit.**

```bash
git add server/schema/templates/static.ts
git commit -m "feat(schema): type static page templates with schema-dts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Type generator.ts + validator.ts surfaces (sonnet)

**Owns:** `server/schema/generator.ts`, `server/schema/validator.ts`
**Must not touch:** templates.

- [ ] **Step 1: Update `generator.ts` `LeanGeneratorOutput`.**

```typescript
import type { Thing, WithContext } from 'schema-dts';

export interface LeanGeneratorOutput {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: Array<{
    type: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
    template: WithContext<{ '@graph': Thing[] }>;
  }>;
  validationErrors?: string[];
}
```

In the orchestrator body, the local `let schema` becomes `WithContext<{ '@graph': Thing[] }>` once narrowed.

- [ ] **Step 2: Update `validator.ts` to accept the typed shape.**

```typescript
import type { Thing, WithContext } from 'schema-dts';

export function validateLeanSchema(
  schema: WithContext<{ '@graph': Thing[] }> | Record<string, unknown>,
  _primaryType: string,
): string[] {
  // ... existing body unchanged — runtime still treats unknown shapes defensively ...
}
```

The dual signature (typed OR unknown) lets call sites that read schemas from JSON columns (where the type is genuinely unknown) keep working without casts.

- [ ] **Step 3: Typecheck the whole project.**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Run the full schema test suite.**

```bash
npx vitest run tests/unit/schema tests/integration/lean-schema-generator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/schema/generator.ts server/schema/validator.ts
git commit -m "feat(schema): type generator output + validator input with schema-dts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: schemarama fixture corpus + integration test (sonnet)

**Owns:** `tests/integration/schemarama-corpus.test.ts`, `tests/fixtures/schema-corpus.ts`
**Must not touch:** source files.

- [ ] **Step 1: Create the fixture corpus.**

```typescript
// tests/fixtures/schema-corpus.ts
import type { LeanGeneratorInput } from '../../server/schema/generator.js';

const baseWorkspace = { name: 'Acme Co', publisherLogoUrl: 'https://acme.com/logo.png', businessProfile: null, defaultLocale: 'en' };

export const corpus: Array<{ kind: string; input: LeanGeneratorInput }> = [
  {
    kind: 'homepage',
    input: {
      pageId: 'home',
      pageMeta: { title: 'Acme Co — Home', slug: '', publishedPath: '/' },
      html: '<html><head><meta name="description" content="A studio."/></head><body>About us.</body></html>',
      baseUrl: 'https://acme.com',
      workspace: baseWorkspace,
    },
  },
  {
    kind: 'blog',
    input: {
      pageId: 'blog-1',
      pageMeta: {
        title: 'How we ship | Acme Co', slug: 'how-we-ship', publishedPath: '/blog/how-we-ship',
        cmsFieldData: { 'published-on': '2026-01-15T00:00:00Z', 'author-name': 'Jane Doe' },
      },
      html: '<html><head><meta name="description" content="Our approach to shipping."/></head><body>Body.</body></html>',
      baseUrl: 'https://acme.com',
      workspace: baseWorkspace,
    },
  },
  {
    kind: 'case-study',
    input: {
      pageId: 'cs-1',
      pageMeta: {
        title: 'Expero | Acme Co', slug: 'expero', publishedPath: '/our-work/expero',
        cmsFieldData: { 'published-on': '2025-10-01T00:00:00Z' },
      },
      html: '<html><head><meta name="description" content="Expero project."/></head><body>Case body.</body></html>',
      baseUrl: 'https://acme.com',
      workspace: baseWorkspace,
    },
  },
  {
    kind: 'service',
    input: {
      pageId: 'svc-1',
      pageMeta: { title: 'Web Design | Acme Co', slug: 'web-design', publishedPath: '/services/web-design' },
      html: '<html><head><meta name="description" content="Custom web design."/></head><body></body></html>',
      baseUrl: 'https://acme.com',
      workspace: baseWorkspace,
    },
  },
  {
    kind: 'privacy',
    input: {
      pageId: 'pp-1',
      pageMeta: { title: 'Privacy Policy | Acme Co', slug: 'privacy-policy', publishedPath: '/privacy-policy' },
      html: '<html><head><meta name="description" content="GDPR policy."/></head><body></body></html>',
      baseUrl: 'https://acme.com',
      workspace: baseWorkspace,
    },
  },
  {
    kind: 'contact',
    input: {
      pageId: 'c-1',
      pageMeta: { title: 'Contact us | Acme Co', slug: 'contact', publishedPath: '/contact' },
      html: '<html><head><meta name="description" content="Get in touch."/></head><body></body></html>',
      baseUrl: 'https://acme.com',
      workspace: baseWorkspace,
    },
  },
];
```

- [ ] **Step 2: Write the integration test.**

```typescript
// tests/integration/schemarama-corpus.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({ text: 'A clean description.', tokens: { prompt: 100, completion: 20, total: 120 } }),
}));

import { generateLeanSchema } from '../../server/schema/generator.js';
// schemarama is published as a CommonJS module — adjust the import per its actual API.
// As of v0.0.4 the package surface exposes `validate` for ShEx-based shape validation.
// If the API differs, follow https://github.com/google/schemarama and adapt the call.
import * as schemarama from 'schemarama';
import { corpus } from '../fixtures/schema-corpus.js';

describe('schemarama shape validation across fixture corpus (Pillar 3)', () => {
  for (const { kind, input } of corpus) {
    it(`${kind}: shape passes schemarama`, async () => {
      const out = await generateLeanSchema(input);
      const schema = out.suggestedSchemas[0].template;

      // Convert to a JSON-LD string for schemarama. The library accepts either
      // an object or a string per its README; using the string form is the
      // most stable contract across versions.
      const jsonLd = JSON.stringify(schema);

      // schemarama returns an object with `failures` and `warnings`. The exact
      // shape depends on the validator strategy; we check `failures.length === 0`.
      const result = await (schemarama as unknown as {
        validate: (input: string) => Promise<{ failures: unknown[]; warnings?: unknown[] }>;
      }).validate(jsonLd);

      expect(result.failures, `${kind} fixture produced shape failures: ${JSON.stringify(result.failures)}`).toEqual([]);
    });
  }
});
```

- [ ] **Step 3: Run the test, confirm pass.**

```bash
npx vitest run tests/integration/schemarama-corpus.test.ts
```

Expected: PASS — all 6 fixtures clean. If a failure surfaces, the failure message points at the specific schema-org rule violation. Fix the offending template (do NOT loosen the test).

If schemarama's API surface differs from the assumption above, the failure will be a TypeError before any fixture runs. In that case, read `node_modules/schemarama/README.md`, adjust the import + call, and re-run. Common alternative APIs: `new ShExValidator()`, `validateMicrodata`, etc.

- [ ] **Step 4: Commit.**

```bash
git add tests/fixtures/schema-corpus.ts tests/integration/schemarama-corpus.test.ts
git commit -m "test(schema): schemarama shape validation across 6-fixture corpus (Pillar 3)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: pr-check rule for cross-ref helper imports (sonnet)

**Owns:** `scripts/pr-check.ts` (new rule appended to `CHECKS`)
**Must not touch:** anything else.

- [ ] **Step 1: Append the rule to `scripts/pr-check.ts`.**

Find the end of the `CHECKS` array and add a new entry following the customCheck pattern at lines 2070+ (multiple existing examples). Insert:

```typescript
  {
    name: 'every primary-template imports webSiteRef + breadcrumbRef',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/schema/templates/',
    message: 'Templates must import webSiteRef and breadcrumbRef from ./helpers.js so primary nodes emit isPartOf and breadcrumb cross-references. See docs/superpowers/plans/2026-04-29-schema-pillar-2-data-wiring.md.',
    severity: 'error',
    rationale: 'Without these helpers, a primary node will silently ship without isPartOf/breadcrumb cross-refs — Pillar 1 validator will reject the output, but only after generation runs. This rule fails fast at PR time.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // helpers.ts defines them; homepage.ts emits Organization+WebSite (the targets of the refs)
      // and so does not import them itself.
      const EXCLUSIONS = new Set([
        path.join(ROOT, 'server/schema/templates/helpers.ts'),
        path.join(ROOT, 'server/schema/templates/homepage.ts'),
      ]);
      for (const file of files) {
        if (EXCLUSIONS.has(file)) continue;
        if (!file.includes('server/schema/templates/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const importsHelpers = /from ['"]\.\/helpers\.js['"]/.test(content);
        if (!importsHelpers) {
          hits.push({ file, line: 1, snippet: '(no import from ./helpers.js)' });
          continue;
        }
        const hasWebSiteRef = /\bwebSiteRef\b/.test(content);
        const hasBreadcrumbRef = /\bbreadcrumbRef\b/.test(content);
        if (!hasWebSiteRef || !hasBreadcrumbRef) {
          // Find the helpers import line for the snippet
          const lines = content.split('\n');
          const importLineIdx = lines.findIndex(l => /from ['"]\.\/helpers\.js['"]/.test(l));
          hits.push({
            file,
            line: importLineIdx + 1,
            snippet: lines[importLineIdx],
          });
        }
      }
      return hits;
    },
  },
```

- [ ] **Step 2: Regenerate the rules doc.**

```bash
npm run rules:generate
```

Expected: `docs/rules/automated-rules.md` updated to include the new rule.

- [ ] **Step 3: Run pr-check on the current state, confirm zero violations.**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero violations — all templates already import both helpers after Pillar 2 + Pillar 3 typing tasks.

- [ ] **Step 4: Sanity-check that the rule fires when violated.**

Temporarily delete the `webSiteRef` import from `server/schema/templates/static.ts`, run pr-check, expect a violation, then restore the import.

```bash
# Manually edit static.ts to remove webSiteRef from the helpers import line
npx tsx scripts/pr-check.ts
# Expect: 1 error referencing static.ts
git checkout server/schema/templates/static.ts
npx tsx scripts/pr-check.ts
# Expect: 0 errors again
```

- [ ] **Step 5: Commit.**

```bash
git add scripts/pr-check.ts docs/rules/automated-rules.md
git commit -m "feat(pr-check): assert primary-template files import cross-ref helpers

Catches the regression class where a future template author forgets webSiteRef
or breadcrumbRef. helpers.ts and homepage.ts excluded.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Quality gates + docs (haiku)

**Owns:** `FEATURE_AUDIT.md`, `data/roadmap.json`
**Must not touch:** source files.

- [ ] **Step 1: Run all CLAUDE.md quality gates.**

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

Expected: all four pass.

- [ ] **Step 2: Update `FEATURE_AUDIT.md` entry #319.**

Append a Pillar 3 paragraph noting schema-dts compile-time typing across templates, schemarama CI corpus validation across 6 fixtures, and the new pr-check rule for cross-ref helper imports.

- [ ] **Step 3: Update `data/roadmap.json`.**

```json
{
  "id": "schema-pillar-3-gates",
  "title": "Schema Pillar 3 — Compile-time + CI Gates",
  "source": "docs/superpowers/plans/2026-04-29-schema-pillar-3-gates.md",
  "est": "1d",
  "priority": "P0",
  "sprint": "H",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "schema-dts typed return values across 8 templates + generator + validator (compile-time gate). schemarama shape validation across a 6-fixture corpus in CI (homepage, blog, case study, service, privacy, contact). New pr-check rule asserts every primary-template imports webSiteRef + breadcrumbRef from helpers (PR-time gate). Locks Pillar 1 + Pillar 2 quality bar against future regressions."
}
```

Run: `npx tsx scripts/sort-roadmap.ts`

- [ ] **Step 4: Open the PR.**

```bash
git push -u origin claude/schema-pillar-3
gh pr create --base staging --title "feat(schema): Pillar 3 — compile-time + CI gates" --body "$(cat <<'EOF'
## Summary
- `schema-dts` typed return values across all 8 templates, `generator.ts`, `validator.ts`. Compile-time gate against shape errors (e.g. `author: { name: 'X' }` missing `@type`).
- `schemarama` shape validation in CI on a 6-fixture corpus (homepage, blog, case study, service, privacy, contact).
- New pr-check rule fails the build if any `server/schema/templates/*.ts` file (excluding `helpers.ts` + `homepage.ts`) skips importing `webSiteRef` or `breadcrumbRef`.
- Together with Pillars 1 + 2: paid-grade output, locked at three layers — compile, runtime, PR.

## Test plan
- [ ] `npm run typecheck` clean
- [ ] `npx vite build` clean
- [ ] `npx vitest run` clean (6 schemarama corpus assertions + existing suite)
- [ ] `npx tsx scripts/pr-check.ts` clean
- [ ] Manual: delete `webSiteRef` import from one template, confirm pr-check fires; restore.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-Phase Contracts (Pillar 3 → Future)

### Exported from Pillar 3

- Typed template return signatures — future template authors get compile-time enforcement automatically.
- `tests/fixtures/schema-corpus.ts` — extension surface for new page kinds. Add a new `corpus` entry whenever a new template lands.
- pr-check rule — new templates added to `server/schema/templates/*.ts` automatically subject to the cross-ref helper-import check (no per-template setup).

### Behavioural contract

After Pillar 3, **every clean schema must (a) typecheck, (b) pass schemarama shape validation on the corpus, and (c) pass the pr-check helper-import rule**. Three independent gates means a regression has to slip past all three to ship.

---

## Systemic Improvements

### Shared utilities extracted
- Generic `withBreadcrumb<P extends Thing>` — reused by all 7 non-homepage templates.

### pr-check rules added
- `every primary-template imports webSiteRef + breadcrumbRef` — Task 9 above.

### New tests required
- `tests/integration/schemarama-corpus.test.ts` — 6 corpus assertions (this plan).

---

## Verification Strategy

| What | How |
|---|---|
| Compile-time typing | `npm run typecheck` (zero errors) — prove `WithContext<>` propagates through templates → generator → callers |
| schemarama corpus passes | `npx vitest run tests/integration/schemarama-corpus.test.ts` |
| pr-check rule fires correctly | Manual: delete a helper import, run pr-check, see the violation, restore |
| End-to-end on real workspace | After staging deploy: regenerate hmpsn studio schema; confirm Pillar 1 validator stat reads `28/28 (0 with warnings)` for templates that have full data; remaining warnings should map to data gaps (e.g. workspace without a `logo`), not template gaps |

---

## Self-Review

1. **Spec coverage:** Three independent gates — compile (Tasks 1–7), CI (Task 8), PR-time (Task 9). All three named in the goal, all three covered.

2. **Placeholder scan:** Task 8 Step 3 has a conditional ("if schemarama's API surface differs") with a documented fallback path (read README, adjust call, retry). This is acceptable because schemarama's API is the only Pillar 3 unknown — every other code change is mechanical.

3. **Type consistency:** `WithContext`, `Thing`, `BreadcrumbList`, etc. used consistently. Type names match `schema-dts` exports verbatim.

4. **Order:** deps first (Task 1) → helpers typed (Task 2) → templates typed in parallel (Tasks 3–6) → orchestrator typed (Task 7) → CI corpus (Task 8) → pr-check rule (Task 9) → docs (Task 10). No reverse dependency.
