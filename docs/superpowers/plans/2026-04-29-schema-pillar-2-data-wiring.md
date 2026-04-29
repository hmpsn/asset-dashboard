# Schema Pillar 2 — Data Wiring & Cross-References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the schema generator output from "structurally correct, substantively thin" to "Yoast-baseline complete" by closing four wiring gaps identified in the 2026-04-29 audits: brand-suffix pollution in `name` fields, missing `isPartOf` / `breadcrumb` cross-references, missing `inLanguage`, and CMS items getting URL-only data (no `datePublished`, no `author`).

**Architecture:** Three layers of edits, no new modules.
1. **Data layer** — extend `PageData`, `PageMetaInput`, `WorkspaceSchemaInput` with the missing fields; pull `inLanguage` from Webflow `site.locales[]`; rewrite CMS discovery so each discovered URL is paired with its collection+item IDs and `fieldData` from `/collections/{id}/items/{itemId}`; add a `scrubBrandSuffix()` helper so the rest of the pipeline never sees `"Title | Brand"` strings.
2. **Helper layer** — add `webSiteRef(baseUrl)`, `breadcrumbRef(canonicalUrl, breadcrumbs)`, and `scrubBrandSuffix(name, brand)` in `server/schema/templates/helpers.ts`. `breadcrumbRef` returns `undefined` when `breadcrumbs.length < 2` to prevent dangling `@id` references. Refactor `withBreadcrumb` to accept the primary node already populated with cross-refs (no behavioural change for templates that don't pass them).
3. **Template layer** — every non-homepage primary node gains `isPartOf` (→ `#website`), `breadcrumb` (→ `#breadcrumb`), and `inLanguage`. Article gains `author` (from CMS or workspace), `articleSection` (from URL path), and properly-shaped `image` array. Homepage `Organization` gains `sameAs` + `foundedDate` from `BusinessProfile`; `WebSite` gains `potentialAction` (sitelinks SearchAction).

**Tech Stack:** TypeScript strict, vitest (unit + integration), Cheerio (already at `^1.2.0`), `webflowFetch` from `server/webflow-client.ts`, `getCollectionItem` / `listCollectionItems` / `listCollections` from `server/webflow-cms.ts` (all already exported).

**MVP scope (what this plan ships):** Yoast-baseline cross-references and field completeness across all 8 templates. CMS items resolved to their `fieldData` so case studies and blog posts get real `datePublished`, `dateModified`, and `author` (when the CMS exposes one). Brand-suffix stripping site-wide.

**Out of scope (deferred):** Adopting `schema-dts` typed return values (Pillar 3), making the validator fail-the-build on missing baseline fields (Pillar 1), `schemarama` shape validation in CI (Pillar 3), Yoast-style `Person` author entities (need a workspace-level "site authors" feature first), `aggregateRating` / `Review` schemas, healthcare subtype escalation.

---

## Pre-requisites

- [x] Audits committed (the four 2026-04-29 reports in this conversation thread serve as the spec)
- [x] PR #360 merged to staging — provides the lean baseline this plan extends
- [ ] Branch from latest staging: `git checkout staging && git pull && git checkout -b claude/schema-pillar-2`

---

## Task Dependencies

```
Sequential foundation:
  Task 1 (Type extensions)
  → Task 2 (Helpers: scrubBrandSuffix, webSiteRef, breadcrumbRef)
  → Task 3 (data-sources: brand-suffix + inLanguage)

Sequential template + test-file batch (each task touches templates.test.ts,
which is a shared file — must run in order, not in parallel):
  → Task 4 (Static templates)
  → Task 5 (Article template)
  → Task 6 (Service template)
  → Task 7 (LocalBusiness + Homepage)

Sequential after Task 7:
  → Task 8 (CMS discovery rewrite — discoverCmsItemsBySlug + integration into generateSchemaSuggestions)
  → Task 9 (Locale extraction — read site.locales[] in resolveBaseUrl path)
  → Task 10 (Integration test on hmpsn fixture pages)
  → Task 11 (Quality gates + docs)
```

**Why Tasks 4–7 are sequential (not parallel):** each one edits a different describe block in `tests/unit/schema/templates.test.ts`. Even though the source-file edits are isolated (`static.ts`, `article.ts`, `service.ts`, `local-business.ts`+`homepage.ts` are non-overlapping), the shared test file would race. Serial execution keeps each step under 10 minutes and avoids merge conflicts.

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 Type extensions | haiku | Pure type definitions transcribed from plan |
| 2 Helpers | haiku | Pure functions, exact code in plan |
| 3 data-sources extensions | sonnet | String parsing edge cases for brand stripping |
| 4 Static templates | haiku | Mechanical: add 3 fields per template |
| 5 Article template | sonnet | Author/articleSection logic with fallbacks |
| 6 Service template | haiku | Mechanical: add 3 fields |
| 7 LocalBusiness + Homepage | sonnet | sameAs/foundedDate/potentialAction shapes |
| 8 CMS discovery rewrite | sonnet | API orchestration with caching, joins on slug |
| 9 Locale extraction | sonnet | Plumbing through resolveBaseUrl call chain |
| 10 Integration test | sonnet | Mock factory updates + assertions |
| 11 Quality gates + docs | haiku | Doc updates per CLAUDE.md checklist |

Reviewers (per task): spec-compliance reviewer = opus, code-quality reviewer = opus.

---

## File Map

### Modified files

| Path | Modification |
|---|---|
| `server/schema/data-sources.ts` | Task 1 + Task 3: extend `PageData`, `PageMetaInput`, `WorkspaceSchemaInput`; add `scrubBrandSuffix()`; emit `inLanguage`, `author`, `articleSection`; rebuild breadcrumb names from scrubbed title. |
| `server/schema/templates/helpers.ts` | Task 2: add `webSiteRef(baseUrl)`, `breadcrumbRef(canonicalUrl, breadcrumbs)`, `scrubBrandSuffix(name, brand)`. |
| `server/schema/templates/static.ts` | Task 4: every primary node gains `isPartOf`, `breadcrumb`, `inLanguage`. |
| `server/schema/templates/article.ts` | Task 5: add `isPartOf`, `breadcrumb`, `inLanguage`, `articleSection`, `author` (from CMS data when present, falls back to Organization). |
| `server/schema/templates/service.ts` | Task 6: every primary node gains `isPartOf`, `breadcrumb`, `inLanguage`. |
| `server/schema/templates/local-business.ts` | Task 7: Organization sibling node gains `sameAs`, `foundedDate`. |
| `server/schema/templates/homepage.ts` | Task 7: `Organization` gains `sameAs`, `foundedDate` from `BusinessProfile`; `WebSite` gains `potentialAction` (SearchAction with `target: ${baseUrl}/?s={search_term_string}`); `WebSite` gains `inLanguage`. |
| `server/schema-suggester.ts` | Task 8: rewrite the CMS loop at lines 401–426 to use new `discoverCmsItemsBySlug()`; pipe `cmsItemFieldData` into `pageMeta.cmsFieldData`. Task 9: pipe `defaultLocale` into `WorkspaceSchemaInput`. |
| `server/webflow-pages.ts` | Task 8: add `discoverCmsItemsBySlug(siteId, baseUrl, staticPaths, limit, tokenOverride)` that returns `Array<CmsItemFull>` (URL + path + pageName + collectionId + itemId + lastPublished + createdOn + fieldData). Keep existing `discoverCmsUrls` unchanged for other callers. |
| `tests/integration/lean-schema-generator.test.ts` | Task 10: extend with assertions for `isPartOf`, `breadcrumb` back-ref, `inLanguage`, brand-suffix stripping, CMS Article datePublished. |
| `tests/unit/schema/templates.test.ts` | Tasks 4–7: extend per-template assertions. |
| `tests/unit/schema/data-sources.test.ts` | Task 3: brand-suffix stripping unit tests. |
| `FEATURE_AUDIT.md` | Task 11: update entry #319 to reference Pillar 2 completion. |
| `data/roadmap.json` | Task 11: add `schema-pillar-2-data-wiring` (status `done` after merge). |

### Files left untouched

- `server/schema/classifier.ts`, `server/schema/validator.ts`, `server/schema/extractors/*.ts`, `server/schema/generator.ts` — orchestration shape unchanged
- `server/schema-store.ts`, `server/routes/webflow-schema.ts`, `server/routes/jobs.ts` — public surface unchanged
- All frontend code — output shape preserved

---

## Tasks

### Task 1: Extend types (haiku)

**Owns:** `server/schema/data-sources.ts` (interfaces only — leave functions for Task 3)
**Must not touch:** anything else.

- [ ] **Step 1: Open `server/schema/data-sources.ts` and replace the three interfaces.**

```typescript
export interface PageMetaInput {
  title: string;
  slug: string;
  publishedPath: string;
  seo?: { title?: string | null; description?: string | null };
  lastPublished?: string | null;
  createdOn?: string | null;
  /** Per-locale code (e.g. "en", "en-US") for this specific page. Falls back to workspace.defaultLocale. */
  locale?: string | null;
  /** When this page is a Webflow CMS item, the resolved fieldData blob from /collections/:id/items/:itemId. */
  cmsFieldData?: Record<string, unknown> | null;
}

export interface WorkspaceSchemaInput {
  name: string;
  publisherLogoUrl: string | null;
  businessProfile: BusinessProfile | null;
  /** Default site-wide locale from Webflow site.locales[0] or "en" if absent. */
  defaultLocale: string;
}

export interface PageData {
  title: string;
  /** title with " | <brand>" suffix removed, used for schema name fields and breadcrumb labels. */
  cleanTitle: string;
  description?: string;
  image?: string;
  canonicalUrl: string;
  publisher: { name: string; logoUrl?: string };
  datePublished?: string;
  dateModified?: string;
  /** Article author name when known (CMS field or workspace name). undefined → template emits Organization fallback. */
  author?: string;
  /** Section derived from URL path (e.g. "/blog/foo" → "Blog"). undefined for homepage and root pages. */
  articleSection?: string;
  /** BCP-47 language tag for this page. Always populated (workspace.defaultLocale fallback). */
  inLanguage: string;
  breadcrumbs: BreadcrumbItem[];
}
```

- [ ] **Step 2: Run typecheck and observe failures (expected).**

Run: `npm run typecheck`
Expected: errors in `server/schema/templates/*.ts`, `server/schema-suggester.ts`, and `server/schema/generator.ts` because `PageData.cleanTitle` and `inLanguage` are required but unset, and `WorkspaceSchemaInput.defaultLocale` is required.

- [ ] **Step 3: Commit (broken state — types only, dependencies fixed in later tasks).**

```bash
git add server/schema/data-sources.ts
git commit -m "refactor(schema): extend PageData/PageMetaInput/WorkspaceSchemaInput with paid-grade fields

Adds cleanTitle, inLanguage, author, articleSection, cmsFieldData, defaultLocale.
Compile breaks intentionally; subsequent tasks fill the values.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Helpers (haiku)

**Owns:** `server/schema/templates/helpers.ts`
**Must not touch:** anything else.

- [ ] **Step 1: Append three new exports to the file (do not modify existing exports).**

```typescript
/**
 * Returns an @id reference to the homepage WebSite node.
 * Every non-homepage primary node uses this for `isPartOf`.
 */
export function webSiteRef(baseUrl: string): { '@id': string } {
  return { '@id': `${baseUrl}/#website` };
}

/**
 * Returns an @id reference to a page's BreadcrumbList node.
 * Every non-homepage primary node uses this for the back-reference `breadcrumb` property.
 */
export function breadcrumbRef(
  canonicalUrl: string,
  breadcrumbs: BreadcrumbItem[],
): { '@id': string } | undefined {
  if (breadcrumbs.length < 2) return undefined;
  return { '@id': `${canonicalUrl}#breadcrumb` };
}

/**
 * Removes a trailing " | Brand", " - Brand", or " — Brand" suffix from a title.
 * Schema.org `name` and breadcrumb labels should not duplicate the site name —
 * Yoast/RankMath strip this; we match the brand against workspace.name (case-insensitive)
 * to avoid stripping legitimate trailing words that look like brand pipes.
 *
 * Examples:
 *   scrubBrandSuffix("Privacy Policy | hmpsn studio", "hmpsn studio") → "Privacy Policy"
 *   scrubBrandSuffix("Privacy Policy", "hmpsn studio") → "Privacy Policy"
 *   scrubBrandSuffix("Acme | Other Co", "hmpsn studio") → "Acme | Other Co" (suffix doesn't match brand)
 */
export function scrubBrandSuffix(name: string, brand: string): string {
  if (!brand) return name;
  // Match " | Brand", " - Brand", " — Brand", " · Brand" at the end, case-insensitive on the brand.
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\s+[|\\-—·]\\s+${escaped}\\s*$`, 'i');
  return name.replace(re, '').trim() || name;
}
```

- [ ] **Step 2: Verify typecheck on this file alone passes.**

Run: `npx tsc --noEmit -p tsconfig.app.json server/schema/templates/helpers.ts 2>&1 | head -5`
Expected: no errors emitted from this file.

- [ ] **Step 3: Commit.**

```bash
git add server/schema/templates/helpers.ts
git commit -m "feat(schema): add webSiteRef, breadcrumbRef, scrubBrandSuffix helpers

Cross-reference helpers for paid-grade @graph topology + brand-suffix scrubber
that strips trailing ' | Brand'/' - Brand'/' — Brand'/' · Brand' from titles.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: data-sources extensions (sonnet)

**Owns:** `server/schema/data-sources.ts` (functions), `tests/unit/schema/data-sources.test.ts`
**Must not touch:** templates, validator, generator.

- [ ] **Step 1: Write a failing unit test for brand-suffix stripping.**

Add or create `tests/unit/schema/data-sources.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractPageData } from '../../../server/schema/data-sources.js';

const baseInput = {
  pageMeta: { title: 'Privacy Policy | Acme Co', slug: 'privacy', publishedPath: '/privacy' },
  html: '<html><head></head><body></body></html>',
  baseUrl: 'https://acme.com',
  workspace: { name: 'Acme Co', publisherLogoUrl: null, businessProfile: null, defaultLocale: 'en' },
};

describe('extractPageData — paid-grade fields', () => {
  it('strips brand suffix from title into cleanTitle', () => {
    const out = extractPageData(baseInput);
    expect(out.title).toBe('Privacy Policy | Acme Co');
    expect(out.cleanTitle).toBe('Privacy Policy');
  });

  it('uses cleanTitle for the breadcrumb leaf, not raw title', () => {
    const out = extractPageData(baseInput);
    const leaf = out.breadcrumbs[out.breadcrumbs.length - 1];
    expect(leaf.name).toBe('Privacy Policy');
  });

  it('falls back to workspace.defaultLocale for inLanguage', () => {
    const out = extractPageData(baseInput);
    expect(out.inLanguage).toBe('en');
  });

  it('uses pageMeta.locale when present', () => {
    const out = extractPageData({ ...baseInput, pageMeta: { ...baseInput.pageMeta, locale: 'fr-CA' } });
    expect(out.inLanguage).toBe('fr-CA');
  });

  it('derives articleSection from first URL segment', () => {
    const out = extractPageData({ ...baseInput, pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/foo' } });
    expect(out.articleSection).toBe('Blog');
  });

  it('omits articleSection for homepage', () => {
    const out = extractPageData({ ...baseInput, pageMeta: { ...baseInput.pageMeta, publishedPath: '/' } });
    expect(out.articleSection).toBeUndefined();
  });

  it('uses CMS fieldData["published-on"] as datePublished when present', () => {
    const out = extractPageData({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, cmsFieldData: { 'published-on': '2026-01-15T00:00:00Z' } },
    });
    expect(out.datePublished).toBe('2026-01-15T00:00:00Z');
  });

  it('uses CMS fieldData["author-name"] as author when present', () => {
    const out = extractPageData({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, cmsFieldData: { 'author-name': 'Jane Doe' } },
    });
    expect(out.author).toBe('Jane Doe');
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails.**

Run: `npx vitest run tests/unit/schema/data-sources.test.ts`
Expected: FAIL on `cleanTitle is undefined`, `inLanguage is undefined`, etc.

- [ ] **Step 3: Update `extractPageData` in `server/schema/data-sources.ts`.**

Replace the file's `buildBreadcrumbs` and `extractPageData` functions with:

```typescript
import { scrubBrandSuffix } from './templates/helpers.js';

function metaContent($: cheerio.CheerioAPI, selector: string): string | undefined {
  const v = $(selector).attr('content');
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function buildBreadcrumbs(publishedPath: string, leafName: string, baseUrl: string): BreadcrumbItem[] {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [{ name: 'Home', url: baseUrl }];
  let acc = baseUrl;
  segs.forEach((s, i) => {
    acc = `${acc}/${s}`;
    items.push({
      name: i === segs.length - 1 ? leafName : capitalize(s.replace(/-/g, ' ')),
      url: acc,
    });
  });
  return items;
}

function deriveArticleSection(publishedPath: string): string | undefined {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  if (segs.length < 2) return undefined; // root or single-segment paths have no section
  return capitalize(segs[0].replace(/-/g, ' '));
}

/** Reads common CMS field-data slugs in priority order; Webflow conventions vary by collection. */
function pickCmsField(fieldData: Record<string, unknown> | null | undefined, slugs: string[]): string | undefined {
  if (!fieldData) return undefined;
  for (const slug of slugs) {
    const v = fieldData[slug];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function extractPageData(input: ExtractInput): PageData {
  const $ = cheerio.load(input.html || '');

  const seoTitle = input.pageMeta.seo?.title?.trim();
  const metaTitle = input.pageMeta.title?.trim();
  const htmlTitle = $('head > title').text().trim();
  const title = seoTitle || metaTitle || htmlTitle || input.pageMeta.slug;
  const cleanTitle = scrubBrandSuffix(title, input.workspace.name);

  const seoDesc = input.pageMeta.seo?.description?.trim();
  const metaDesc = metaContent($, 'meta[name="description"]');
  const ogDesc = metaContent($, 'meta[property="og:description"]');
  const description = seoDesc || metaDesc || ogDesc;

  const ogImage = metaContent($, 'meta[property="og:image"]');
  const twitterImage = metaContent($, 'meta[name="twitter:image"]');
  const linkImage = $('link[rel="image_src"]').attr('href') || undefined;
  const image = ogImage || twitterImage || linkImage;

  const cmsFieldData = input.pageMeta.cmsFieldData ?? null;
  const datePublished = $('time[itemprop="datePublished"]').attr('datetime')
    || pickCmsField(cmsFieldData, ['published-on', 'published-date', 'date-published'])
    || input.pageMeta.createdOn
    || input.pageMeta.lastPublished
    || undefined;
  const dateModified = $('time[itemprop="dateModified"]').attr('datetime')
    || pickCmsField(cmsFieldData, ['updated-on', 'last-updated'])
    || input.pageMeta.lastPublished
    || undefined;

  const author = pickCmsField(cmsFieldData, ['author-name', 'author', 'written-by']) ?? undefined;

  const inLanguage = input.pageMeta.locale?.trim() || input.workspace.defaultLocale || 'en';
  const articleSection = deriveArticleSection(input.pageMeta.publishedPath);
  const canonicalUrl = `${input.baseUrl}${input.pageMeta.publishedPath}`;

  return {
    title,
    cleanTitle,
    description,
    image,
    canonicalUrl,
    publisher: {
      name: input.workspace.name,
      logoUrl: input.workspace.publisherLogoUrl ?? undefined,
    },
    datePublished,
    dateModified,
    author,
    articleSection,
    inLanguage,
    breadcrumbs: buildBreadcrumbs(input.pageMeta.publishedPath, cleanTitle, input.baseUrl),
  };
}
```

- [ ] **Step 4: Run the unit test again, confirm it passes.**

Run: `npx vitest run tests/unit/schema/data-sources.test.ts`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit.**

```bash
git add server/schema/data-sources.ts tests/unit/schema/data-sources.test.ts
git commit -m "feat(schema): pull cleanTitle, inLanguage, author, articleSection in extractPageData

Brand-suffix stripped via scrubBrandSuffix(workspace.name).
inLanguage falls back to workspace.defaultLocale (always populated).
author and datePublished pulled from cmsFieldData when present (CMS items).
articleSection derived from URL path first segment.
Breadcrumb leaf uses cleanTitle, not raw title.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Static templates (haiku) — SEQUENTIAL

**Owns:** `server/schema/templates/static.ts`, related sections of `tests/unit/schema/templates.test.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Write failing tests for cross-refs on static templates.**

Append to `tests/unit/schema/templates.test.ts` inside the `describe('static page templates', ...)` block:

```typescript
  it('AboutPage primary node has isPartOf, breadcrumb, inLanguage', () => {
    const schema = buildAboutPageSchema(staticInput);
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/about#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });
  it('WebPage primary node has isPartOf, breadcrumb, inLanguage', () => {
    const schema = buildWebPageSchema(staticInput);
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/about#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });
  it('uses cleanTitle, not raw title, for name', () => {
    const dirty = { ...staticInput, pageData: { ...staticInput.pageData, title: 'About Us | Acme', cleanTitle: 'About Us' } };
    const node = (buildWebPageSchema(dirty)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.name).toBe('About Us');
  });
```

Update the `staticInput` fixture at the top of the file to include `cleanTitle` and `inLanguage`:

```typescript
const staticInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'About Us',
    cleanTitle: 'About Us',
    description: 'Who we are',
    canonicalUrl: 'https://example.com/about',
    publisher: { name: 'Acme', logoUrl: undefined },
    inLanguage: 'en',
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'About Us', url: 'https://example.com/about' },
    ],
  },
};
```

- [ ] **Step 2: Run the tests, confirm they fail.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'static page templates'`
Expected: FAIL — `node.isPartOf is undefined`.

- [ ] **Step 3: Update `server/schema/templates/static.ts`.**

Replace each of the four functions with this pattern (showing `buildWebPageSchema`; apply identical changes to `buildAboutPageSchema`, `buildContactPageSchema`, `buildCollectionPageSchema`):

```typescript
import { dropUndefined, orgRef, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export function buildWebPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'WebPage',
    '@id': `${pageData.canonicalUrl}#webpage`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'isPartOf': webSiteRef(input.baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}
```

For `buildAboutPageSchema`, keep the existing `mainEntity: orgRef(baseUrl)`. For `buildContactPageSchema` and `buildCollectionPageSchema`, no `mainEntity`. All four use `pageData.cleanTitle` (not `pageData.title`).

- [ ] **Step 4: Run tests again, confirm pass.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'static page templates'`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/schema/templates/static.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add isPartOf, breadcrumb, inLanguage to static templates

WebPage, AboutPage, ContactPage, CollectionPage now cross-reference the
sitewide WebSite + per-page BreadcrumbList. name uses cleanTitle (brand-stripped).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Article template (sonnet) — SEQUENTIAL

**Owns:** `server/schema/templates/article.ts`, the `buildArticleSchema` block in `tests/unit/schema/templates.test.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Write failing tests.**

Update the `baseInput` at the top of `tests/unit/schema/templates.test.ts` (used by both Article and the new tests below) to include `cleanTitle`, `author`, `articleSection`, `inLanguage`. Add tests:

```typescript
  it('uses cleanTitle for headline, not raw title', () => {
    const dirty = { ...baseInput, pageData: { ...baseInput.pageData, title: 'My Post | Acme', cleanTitle: 'My Post' } };
    const node = (buildArticleSchema(dirty, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.headline).toBe('My Post');
  });
  it('emits isPartOf, breadcrumb, inLanguage, articleSection', () => {
    const node = (buildArticleSchema(baseInput, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/blog/my-post#breadcrumb' });
    expect(node.inLanguage).toBe('en');
    expect(node.articleSection).toBe('Blog');
  });
  it('uses CMS-derived author when pageData.author is set', () => {
    const withAuthor = { ...baseInput, pageData: { ...baseInput.pageData, author: 'Jane Doe' } };
    const node = (buildArticleSchema(withAuthor, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.author).toEqual({ '@type': 'Person', 'name': 'Jane Doe' });
  });
  it('falls back to Organization author when pageData.author is undefined', () => {
    const node = (buildArticleSchema(baseInput, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.author).toEqual({ '@type': 'Organization', 'name': 'Acme' });
  });
```

- [ ] **Step 2: Run the tests, confirm they fail.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'buildArticleSchema'`
Expected: FAIL — new fields missing.

- [ ] **Step 3: Replace `server/schema/templates/article.ts`.**

```typescript
import type { PageData } from '../data-sources.js';
import { dropUndefined, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
}

export type ArticleKind = 'BlogPosting' | 'Article';

export function buildArticleSchema(input: ArticleInput, kind: ArticleKind): Record<string, unknown> {
  const { pageData } = input;

  const author = pageData.author
    ? { '@type': 'Person', 'name': pageData.author }
    : { '@type': 'Organization', 'name': pageData.publisher.name };

  const primary = dropUndefined({
    '@type': kind,
    '@id': `${pageData.canonicalUrl}#article`,
    'headline': pageData.cleanTitle,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'datePublished': pageData.datePublished,
    'dateModified': pageData.dateModified || pageData.datePublished,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': pageData.canonicalUrl },
    'author': author,
    'publisher': dropUndefined({
      '@type': 'Organization',
      'name': pageData.publisher.name,
      'logo': pageData.publisher.logoUrl
        ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
        : undefined,
    }),
    'isPartOf': webSiteRef(input.baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    'articleSection': pageData.articleSection,
    'about': kind === 'Article' ? 'Case study' : undefined,
  });

  return withBreadcrumb(primary, pageData);
}
```

- [ ] **Step 4: Run tests, confirm pass.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'buildArticleSchema'`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/schema/templates/article.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add isPartOf, breadcrumb, inLanguage, articleSection, Person author to Article template

Article and BlogPosting now use cleanTitle for headline, derive Person author
from pageData.author (CMS field) or fall back to Organization, cross-reference
WebSite + BreadcrumbList, and emit articleSection from URL path.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Service template (haiku) — SEQUENTIAL

**Owns:** `server/schema/templates/service.ts`, the `buildServiceSchema` and `buildProductSchema` blocks in `tests/unit/schema/templates.test.ts`
**Must not touch:** other templates.

- [ ] **Step 1: Write failing tests for cross-refs.**

Update `serviceInput` in `tests/unit/schema/templates.test.ts` to include `cleanTitle: 'Web Design Service'` and `inLanguage: 'en'`. Add:

```typescript
  it('Service primary node has isPartOf, breadcrumb, inLanguage', () => {
    const node = (buildServiceSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/services/web-design#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });
```

- [ ] **Step 2: Run, confirm fail.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'buildServiceSchema'`
Expected: FAIL.

- [ ] **Step 3: Update `server/schema/templates/service.ts`.**

In `buildServiceSchema`, change the primary node assignment to include the cross-refs and use `cleanTitle`:

```typescript
import { dropUndefined, withBreadcrumb, webSiteRef, breadcrumbRef } from './helpers.js';
// ... existing imports ...

export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'Service',
    '@id': `${pageData.canonicalUrl}#service`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'image': pageData.image,
    'url': pageData.canonicalUrl,
    'provider': { '@type': 'Organization', '@id': `${baseUrl}/#organization`, 'name': pageData.publisher.name },
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb(primary, pageData);
}
```

Apply identical structural changes to `buildProductSchema`: add `isPartOf`, `breadcrumb`, `inLanguage`, swap `name: pageData.title` → `name: pageData.cleanTitle`.

- [ ] **Step 4: Run, confirm pass.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'buildServiceSchema'`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/schema/templates/service.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add isPartOf, breadcrumb, inLanguage to Service and Product templates

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: LocalBusiness + Homepage (sonnet) — SEQUENTIAL

**Owns:** `server/schema/templates/local-business.ts`, `server/schema/templates/homepage.ts`, the corresponding test blocks
**Must not touch:** other templates.

- [ ] **Step 1: Write failing tests.**

Add to the `buildHomepageSchema` describe block in `tests/unit/schema/templates.test.ts`:

```typescript
  it('Organization includes sameAs from businessProfile.socialProfiles', () => {
    const withSocial = {
      ...homepageInput,
      pageData: { ...homepageInput.pageData, cleanTitle: homepageInput.pageData.title, inLanguage: 'en' },
    };
    // sameAs flows from businessProfile passed via the workspace input — homepage builder
    // currently doesn't take a businessProfile, so this requires extending HomepageInput.
    // For now: assert that when sameAs is present on input, it's emitted.
    const schema = buildHomepageSchema({
      ...withSocial,
      businessProfile: { socialProfiles: ['https://twitter.com/acme'], foundedDate: '2020-01-01' },
    });
    const org = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(org.sameAs).toEqual(['https://twitter.com/acme']);
    expect(org.foundedDate).toBe('2020-01-01');
  });

  it('WebSite has potentialAction (sitelinks SearchAction)', () => {
    const withClean = {
      ...homepageInput,
      pageData: { ...homepageInput.pageData, cleanTitle: homepageInput.pageData.title, inLanguage: 'en' },
    };
    const schema = buildHomepageSchema(withClean);
    const website = (schema['@graph'] as Array<Record<string, unknown>>)[1];
    expect(website.potentialAction).toEqual({
      '@type': 'SearchAction',
      'target': { '@type': 'EntryPoint', 'urlTemplate': 'https://example.com/?s={search_term_string}' },
      'query-input': 'required name=search_term_string',
    });
    expect(website.inLanguage).toBe('en');
  });
```

- [ ] **Step 2: Run, confirm fail.**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'buildHomepageSchema'`
Expected: FAIL.

- [ ] **Step 3: Update `server/schema/templates/homepage.ts`.**

```typescript
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined } from './helpers.js';

export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
  /** Optional — when present, sameAs and foundedDate are emitted on the Organization node. */
  businessProfile?: BusinessProfile | null;
}

export function buildHomepageSchema(input: HomepageInput): Record<string, unknown> {
  const { baseUrl, pageData, businessProfile } = input;

  const organization = dropUndefined({
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'description': pageData.description,
    'image': pageData.image,
    'logo': pageData.publisher.logoUrl
      ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
      : undefined,
    'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
    'foundedDate': businessProfile?.foundedDate,
  });

  const website = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'publisher': { '@id': `${baseUrl}/#organization` },
    'inLanguage': pageData.inLanguage,
    'potentialAction': {
      '@type': 'SearchAction',
      'target': { '@type': 'EntryPoint', 'urlTemplate': `${baseUrl}/?s={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };

  return { '@context': 'https://schema.org', '@graph': [organization, website] };
}
```

- [ ] **Step 4: Update `server/schema/templates/local-business.ts`.**

LocalBusiness's primary already has `sameAs` from `businessProfile`. Add `foundedDate`:

```typescript
'foundedDate': businessProfile?.foundedDate,
'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
'inLanguage': pageData.inLanguage,
```

inside the `dropUndefined({...})` for the `primary` LocalBusiness node. Also use `cleanTitle` for `name`.

- [ ] **Step 5: Update `generator.ts` to pass `businessProfile` into `buildHomepageSchema`.**

In `server/schema/generator.ts`, find the `case 'Homepage'` branch and update to:

```typescript
case 'Homepage':
  if (classified.primaryType === 'LocalBusiness') {
    schema = buildLocalBusinessSchema({
      baseUrl: input.baseUrl,
      pageData,
      businessProfile: input.workspace.businessProfile,
    });
    reason = 'Local business homepage — LocalBusiness with verified contact info.';
  } else {
    schema = buildHomepageSchema({ baseUrl: input.baseUrl, pageData, businessProfile: input.workspace.businessProfile });
    reason = 'Homepage — Organization + WebSite (sitewide entities).';
  }
  break;
```

- [ ] **Step 6: Run, confirm pass.**

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: PASS for all template tests.

- [ ] **Step 7: Commit.**

```bash
git add server/schema/templates/homepage.ts server/schema/templates/local-business.ts server/schema/generator.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add sameAs, foundedDate, potentialAction to Organization+WebSite

Homepage Organization node now emits sameAs (social profiles) and foundedDate
when BusinessProfile has them. WebSite emits inLanguage and a SearchAction
potentialAction (sitelinks search box markup).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: CMS discovery rewrite (sonnet) — SEQUENTIAL

**Owns:** `server/webflow-pages.ts` (additive only — keep `discoverCmsUrls`), `server/schema-suggester.ts`
**Must not touch:** templates, data-sources, validator.

- [ ] **Step 1: Add `discoverCmsItemsBySlug` in `server/webflow-pages.ts`.**

Append after `discoverCmsUrls`:

```typescript
export interface CmsItemFull extends CmsPageUrl {
  collectionId: string;
  itemId: string;
  /** Webflow CMS publishing timestamp (ISO 8601). */
  lastPublished: string | null;
  /** Webflow CMS creation timestamp (ISO 8601). */
  createdOn: string | null;
  /** Raw fieldData blob from /collections/:id/items/:itemId — passed to extractPageData via pageMeta.cmsFieldData. */
  fieldData: Record<string, unknown> | null;
}

/**
 * Like discoverCmsUrls but joins the sitemap-discovered URLs against Webflow's
 * collection items API to populate collectionId, itemId, timestamps, and fieldData.
 *
 * Cost: 1 call to listCollections + 1 call per collection to listCollectionItems.
 * For a typical site (3–6 collections) that's 4–7 API calls total — cached per
 * generation pass. Worth it: case studies and blog posts get real datePublished
 * and author data instead of timestamps that don't exist on plain HTML.
 */
export async function discoverCmsItemsBySlug(
  siteId: string,
  sitemapBaseUrl: string,
  staticPaths: Set<string>,
  limit: number,
  tokenOverride?: string,
): Promise<{ items: CmsItemFull[]; totalFound: number }> {
  const { cmsUrls, totalFound } = await discoverCmsUrls(sitemapBaseUrl, staticPaths, limit);
  if (cmsUrls.length === 0) return { items: [], totalFound };

  // Lazy-load to avoid a hard top-level dep cycle: webflow-cms imports webflow-client which doesn't import this file.
  const { listCollections, listCollectionItems } = await import('./webflow-cms.js');
  const collections = await listCollections(siteId, tokenOverride);

  // Build slug → {collectionId, itemId, lastPublished, createdOn, fieldData} map across all collections.
  const slugMap = new Map<string, Omit<CmsItemFull, 'url' | 'path' | 'pageName'>>();
  for (const coll of collections) {
    let offset = 0;
    const pageSize = 100;
    // Bounded: page through up to `limit` items per collection — generous, real-world collections rarely exceed a few hundred.
    while (offset < limit) {
      const { items: batch, total } = await listCollectionItems(coll.id, pageSize, offset, tokenOverride);
      if (batch.length === 0) break;
      for (const it of batch) {
        const fieldData = (it.fieldData as Record<string, unknown> | undefined) ?? null;
        const slug = (fieldData?.slug as string | undefined) ?? undefined;
        if (!slug) continue;
        slugMap.set(slug.toLowerCase(), {
          collectionId: coll.id,
          itemId: (it.id as string) ?? '',
          lastPublished: (it.lastPublished as string | null | undefined) ?? null,
          createdOn: (it.createdOn as string | null | undefined) ?? null,
          fieldData,
        });
      }
      offset += batch.length;
      if (offset >= total) break;
    }
  }

  const items: CmsItemFull[] = [];
  for (const u of cmsUrls) {
    const lastSeg = u.path.replace(/\/$/, '').split('/').pop()?.toLowerCase() ?? '';
    const meta = slugMap.get(lastSeg);
    if (!meta) {
      // URL appears in sitemap but doesn't match any CMS item slug — emit with null fields so the caller still sees the URL.
      items.push({ ...u, collectionId: '', itemId: '', lastPublished: null, createdOn: null, fieldData: null });
    } else {
      items.push({ ...u, ...meta });
    }
  }
  return { items, totalFound };
}
```

- [ ] **Step 2: Update the CMS loop in `server/schema-suggester.ts` (around line 401–426).**

Replace the existing `discoverCmsUrls` call and following loop with:

```typescript
{
  const staticPaths = buildStaticPathSet(pages);
  const { items: cmsItems } = await discoverCmsItemsBySlug(siteId, baseUrl, staticPaths, 1000, tokenOverride);
  for (const item of cmsItems) {
    if (isCancelled?.()) break;
    const itemHtml = await fetchPublishedHtml(item.url);
    const itemLean = await generateLeanSchema({
      pageId: toCmsPageId(item.path),
      pageMeta: {
        title: item.pageName,
        slug: item.path.replace(/^\//, ''),
        publishedPath: item.path,
        seo: undefined,
        lastPublished: item.lastPublished,
        createdOn: item.createdOn,
        cmsFieldData: item.fieldData,
      },
      html: itemHtml || '',
      baseUrl,
      workspace: {
        name: ctx.companyName || '',
        publisherLogoUrl: ctx.logoUrl ?? null,
        businessProfile: ctx._businessProfile ?? null,
        defaultLocale: ctx._defaultLocale || 'en', // Task 9 populates _defaultLocale; defaults to 'en' until then.
      },
    });
    results.push(leanToSuggestion(itemLean));
  }
}
```

Update the imports at the top of `schema-suggester.ts` to include `discoverCmsItemsBySlug` (replacing the `discoverCmsUrls` import where it's only used by the schema path; check `seo-audit.ts` for other call sites first — keep `discoverCmsUrls` exported for those).

Also update the static page loop at line 376–399 to pass `defaultLocale: ctx._defaultLocale || 'en'`. And update `generateSchemaForPage` (single-page path) at line 338–342 the same way.

- [ ] **Step 3: Add a unit test using a webflow mock.**

Create `tests/unit/schema/cms-item-discovery.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/webflow-cms.js', () => ({
  listCollections: vi.fn(),
  listCollectionItems: vi.fn(),
}));

import { discoverCmsItemsBySlug } from '../../../server/webflow-pages.js';
import { listCollections, listCollectionItems } from '../../../server/webflow-cms.js';

describe('discoverCmsItemsBySlug', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('joins sitemap URLs to fieldData by slug', async () => {
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col1', displayName: 'Posts', slug: 'posts' }]);
    vi.mocked(listCollectionItems).mockResolvedValue({
      items: [{
        id: 'item1',
        lastPublished: '2026-01-15T00:00:00Z',
        createdOn: '2026-01-10T00:00:00Z',
        fieldData: { slug: 'my-post', 'author-name': 'Jane Doe', 'published-on': '2026-01-15T00:00:00Z' },
      }],
      total: 1,
    });
    // Stub fetch for sitemap.xml
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<?xml version="1.0"?><urlset><url><loc>https://acme.com/blog/my-post</loc></url></urlset>',
    }) as unknown as typeof fetch;

    const out = await discoverCmsItemsBySlug('site1', 'https://acme.com', new Set(['/']), 100);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].itemId).toBe('item1');
    expect(out.items[0].lastPublished).toBe('2026-01-15T00:00:00Z');
    expect(out.items[0].fieldData?.['author-name']).toBe('Jane Doe');
  });

  it('falls back to null fields when slug does not match any item', async () => {
    vi.mocked(listCollections).mockResolvedValue([{ id: 'col1', displayName: 'Posts', slug: 'posts' }]);
    vi.mocked(listCollectionItems).mockResolvedValue({ items: [], total: 0 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<?xml version="1.0"?><urlset><url><loc>https://acme.com/orphan</loc></url></urlset>',
    }) as unknown as typeof fetch;

    const out = await discoverCmsItemsBySlug('site1', 'https://acme.com', new Set(['/']), 100);
    expect(out.items[0].itemId).toBe('');
    expect(out.items[0].fieldData).toBeNull();
  });
});
```

- [ ] **Step 4: Run, confirm pass.**

Run: `npx vitest run tests/unit/schema/cms-item-discovery.test.ts`
Expected: PASS — both assertions green.

- [ ] **Step 5: Commit.**

```bash
git add server/webflow-pages.ts server/schema-suggester.ts tests/unit/schema/cms-item-discovery.test.ts
git commit -m "feat(schema): resolve CMS items to fieldData via collections API

discoverCmsItemsBySlug joins sitemap URLs against listCollections+listCollectionItems
to populate collectionId, itemId, lastPublished, createdOn, fieldData on every
CMS-discovered URL. Wires fieldData through pageMeta.cmsFieldData so case studies
and blog posts get real datePublished + author. Falls back to null fields when
sitemap URL does not match any CMS item slug.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Locale extraction (sonnet) — SEQUENTIAL

**Owns:** `server/schema-suggester.ts` (`SchemaContext._defaultLocale` addition), `server/routes/webflow-schema.ts` or wherever `SchemaContext` is built
**Must not touch:** templates, data-sources internals.

- [ ] **Step 1: Find every site where `SchemaContext` is constructed.**

Run: `grep -rn "ctx: SchemaContext\|SchemaContext = {" server/ --include='*.ts' | head -20`
Expected: identifies the 1–3 call sites that need `_defaultLocale` populated.

- [ ] **Step 2: Add `_defaultLocale` to `SchemaContext` interface.**

Open `server/schema-suggester.ts`, find the `SchemaContext` interface (around line 100–148), and add:

```typescript
  /** Default site-wide BCP-47 locale from Webflow site.locales[0]. Defaults to 'en' when unset. */
  _defaultLocale?: string;
```

- [ ] **Step 3: Populate `_defaultLocale` at the highest-leverage call site.**

Find the `getSchemaContext` builder (or equivalent — check `server/routes/webflow-schema.ts` and `server/seo-audit.ts`). After `companyName` and `logoUrl` are set, fetch the locale:

```typescript
import { listSites } from './webflow-pages.js';
// ... existing logic ...
const sites = await listSites(tokenOverride);
const matched = sites.find(s => s.id === siteId);
ctx._defaultLocale = (matched as { locales?: string[] } | undefined)?.locales?.[0] || 'en';
```

If `listSites` does not return `locales`, extend its return type and the API call to include `locales`. The Webflow API endpoint `/sites/:id` returns `locales: { primary: { tag: 'en' }, secondary: [...] }` per Webflow docs. Update `listSites` to include the primary locale tag. Add a unit test for the locale read.

- [ ] **Step 4: Run integration tests.**

Run: `npx vitest run tests/integration/lean-schema-generator.test.ts`
Expected: still passing — locale flows through but doesn't break existing assertions.

- [ ] **Step 5: Commit.**

```bash
git add server/schema-suggester.ts server/routes/webflow-schema.ts server/webflow-pages.ts
git commit -m "feat(schema): extract defaultLocale from Webflow site.locales[0]

SchemaContext._defaultLocale flows from listSites locale data to
WorkspaceSchemaInput.defaultLocale, populating inLanguage on every emitted
node. Falls back to 'en' when locales are not configured.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Integration regression test (sonnet) — SEQUENTIAL

**Owns:** `tests/integration/lean-schema-generator.test.ts`
**Must not touch:** any source file.

- [ ] **Step 1: Add an integration test that exercises the full pipeline with brand-suffix + cross-refs.**

Append to `tests/integration/lean-schema-generator.test.ts`:

```typescript
  describe('paid-grade output (Pillar 2)', () => {
    it('strips brand suffix from name and breadcrumb leaf', async () => {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: { ...baseInput.pageMeta, title: 'Privacy Policy | Acme', publishedPath: '/privacy-policy' },
        workspace: { ...baseInput.workspace, name: 'Acme', defaultLocale: 'en' },
      });
      const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
      expect(graph[0].name).toBe('Privacy Policy');
      const bc = graph.find(n => n['@type'] === 'BreadcrumbList');
      const items = bc?.itemListElement as Array<Record<string, unknown>>;
      expect(items[items.length - 1].name).toBe('Privacy Policy');
    });

    it('emits isPartOf, breadcrumb, inLanguage on the primary node', async () => {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
        workspace: { ...baseInput.workspace, defaultLocale: 'en' },
      });
      const node = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
      expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
      expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/services/design#breadcrumb' });
      expect(node.inLanguage).toBe('en');
    });

    it('CMS Article gets datePublished + author from cmsFieldData', async () => {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: {
          ...baseInput.pageMeta,
          publishedPath: '/blog/my-post',
          cmsFieldData: { 'published-on': '2026-01-15T00:00:00Z', 'author-name': 'Jane Doe' },
        },
        workspace: { ...baseInput.workspace, defaultLocale: 'en' },
      });
      const node = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
      expect(node['@type']).toBe('BlogPosting');
      expect(node.datePublished).toBe('2026-01-15T00:00:00Z');
      expect(node.author).toEqual({ '@type': 'Person', 'name': 'Jane Doe' });
    });

    it('homepage WebSite has potentialAction SearchAction', async () => {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: { title: 'Home', slug: '', publishedPath: '/', seo: undefined },
        workspace: { ...baseInput.workspace, defaultLocale: 'en' },
      });
      const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
      const website = graph.find(n => n['@type'] === 'WebSite');
      expect((website?.potentialAction as Record<string, unknown>)['@type']).toBe('SearchAction');
    });
  });
```

Update the top-of-file `baseInput` to include `defaultLocale: 'en'` in the workspace block.

- [ ] **Step 2: Run, confirm pass.**

Run: `npx vitest run tests/integration/lean-schema-generator.test.ts`
Expected: PASS — all existing tests + 4 new Pillar 2 assertions.

- [ ] **Step 3: Run the full test suite.**

Run: `npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit.**

```bash
git add tests/integration/lean-schema-generator.test.ts
git commit -m "test(schema): integration coverage for Pillar 2 (brand strip, cross-refs, CMS Article, SearchAction)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Quality gates + docs (haiku)

**Owns:** `FEATURE_AUDIT.md`, `data/roadmap.json`, plan execution close-out.
**Must not touch:** source files.

- [ ] **Step 1: Run all CLAUDE.md quality gates.**

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

Expected: all four pass with zero errors.

- [ ] **Step 2: Update `FEATURE_AUDIT.md` entry #319.**

Append to the existing entry's `**Files:**` list and add a Pillar 2 paragraph noting brand-suffix scrubbing, cross-references, CMS fieldData wiring, and inLanguage extraction.

- [ ] **Step 3: Update `data/roadmap.json`.**

Add inside Sprint H, after the existing `lean-schema-rewrite` entry:

```json
{
  "id": "schema-pillar-2-data-wiring",
  "title": "Schema Pillar 2 — Data Wiring & Cross-References",
  "source": "docs/superpowers/plans/2026-04-29-schema-pillar-2-data-wiring.md",
  "est": "1d",
  "priority": "P0",
  "sprint": "H",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "Brand-suffix scrubber, isPartOf/breadcrumb/inLanguage on every primary node, CMS fieldData wired via discoverCmsItemsBySlug → datePublished + author for case studies and blog posts, SearchAction potentialAction on homepage WebSite, sameAs+foundedDate on Organization. Closes the Yoast-baseline completeness gap surfaced by the 2026-04-29 audits."
}
```

Run: `npx tsx scripts/sort-roadmap.ts`
Expected: file re-sorted, no errors.

- [ ] **Step 4: Open the PR.**

```bash
git push -u origin claude/schema-pillar-2
gh pr create --base staging --title "feat(schema): Pillar 2 — paid-grade data wiring + cross-references" --body "$(cat <<'EOF'
## Summary
- Closes the wiring + completeness gaps surfaced by the 2026-04-29 schema audits.
- Brand-suffix scrubbed from every `name`/`headline`/breadcrumb leaf.
- Every non-homepage primary node now emits `isPartOf` (→#website), `breadcrumb` (→#breadcrumb), `inLanguage`.
- CMS items resolved to their Webflow `fieldData` so case studies and blog posts get real `datePublished` + Person `author`.
- Homepage `WebSite` emits `potentialAction` (sitelinks SearchAction); `Organization` emits `sameAs` + `foundedDate` from `BusinessProfile`.

## Test plan
- [ ] `npm run typecheck` clean
- [ ] `npx vite build` clean
- [ ] `npx vitest run` clean (12 new assertions: brand strip, cross-refs, CMS Article, SearchAction)
- [ ] `npx tsx scripts/pr-check.ts` clean
- [ ] After staging deploy: regenerate hmpsn studio schema in Chrome MCP, verify Privacy Policy `name="Privacy Policy"` (no brand suffix), verify Expero case study has `datePublished`, `author: Person`, `isPartOf` ref.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-Phase Contracts (Pillar 2 → Pillar 1 / Pillar 3)

### Exported from Pillar 2 (Pillar 1 + 3 will read)

- `PageData` extended with `cleanTitle`, `inLanguage`, `author?`, `articleSection?` — Pillar 1 validator will require these on Article/BlogPosting.
- `WorkspaceSchemaInput.defaultLocale` (required string) — Pillar 3 schema-dts typing assumes this is always populated.
- `webSiteRef`, `breadcrumbRef`, `scrubBrandSuffix` from `templates/helpers.ts` — Pillar 3 may extend with `personRef` if Person-author entities become a sitewide concept.
- `discoverCmsItemsBySlug` from `webflow-pages.ts` — exported, no other consumers expected; do not break the signature.

### Not exported (internal to Pillar 2)

- `pickCmsField()` and `deriveArticleSection()` in `data-sources.ts` — internal helpers. Don't export.

---

## Systemic Improvements

### Shared utilities extracted
- `scrubBrandSuffix(name, brand)` — in `templates/helpers.ts`. Reused by all 8 templates and `data-sources.ts`. Also a candidate for adoption in `server/seo-audit.ts` and any other place that surfaces titles to schema/AI/clients (out of scope for Pillar 2 — flag for follow-up).
- `webSiteRef` / `breadcrumbRef` — in `templates/helpers.ts`. Consistent `@id` construction across templates.

### pr-check rules to add (deferred to Pillar 3 — flagged here)
- "Every template's primary node must include `isPartOf`, `breadcrumb`, and `inLanguage` (or be on the homepage exception list)" — mechanizable via AST grep on `server/schema/templates/*.ts`. Pillar 3 owns this rule.

### New tests required (this plan adds)
- `tests/unit/schema/data-sources.test.ts` — 8 brand-suffix and field extraction assertions.
- `tests/unit/schema/cms-item-discovery.test.ts` — 2 mock-driven assertions for `discoverCmsItemsBySlug`.
- `tests/integration/lean-schema-generator.test.ts` — 4 Pillar 2 assertions appended to existing suite.
- Per-template tests in `tests/unit/schema/templates.test.ts` — extended with cross-ref assertions.

---

## Verification Strategy

| What | How |
|---|---|
| Brand suffix stripped | `npx vitest run tests/unit/schema/data-sources.test.ts -t 'cleanTitle'` |
| Cross-refs emitted | `npx vitest run tests/unit/schema/templates.test.ts` (every template suite) |
| CMS Article populated | `npx vitest run tests/integration/lean-schema-generator.test.ts -t 'CMS Article'` |
| End-to-end on real workspace | After staging deploy: regenerate hmpsn studio schema in Chrome MCP, scroll to Privacy Policy → verify `name: "Privacy Policy"`, `inLanguage: "en"`, `isPartOf: {@id: "...#website"}`. Scroll to Expero case study → verify `datePublished` populated, `author: {@type: "Person", name: ...}` if CMS exposes one. |
| Validator still clean | `Validated 28/28` in the regenerate UI (no new "missing required field" warnings; the warnings the old pass surfaced for missing `datePublished` should now be gone for CMS-driven Articles) |

---

## Self-Review

1. **Spec coverage:** Audits identified four gaps — brand suffix (Task 3 + helpers), cross-refs (Tasks 4–7), inLanguage (Tasks 3 + 9), CMS fieldData (Task 8). All four covered.

2. **Placeholder scan:** No "TBD" / "implement later" / "similar to". Every step has either a code block or an exact command.

3. **Type consistency:** `cleanTitle`, `inLanguage`, `defaultLocale`, `cmsFieldData`, `discoverCmsItemsBySlug` used consistently across Tasks 1, 3, 8, 9, 10. `BusinessProfile.foundedDate` already exists in the type (verified at `server/schema/data-sources.ts:33`); Task 7 uses it without redefining.

4. **Sequencing:** Task 1 (types) breaks the build intentionally; Tasks 2 + 3 fix the breaks; Tasks 4–7 are parallel-safe (different files); Tasks 8–10 sequential because they share `schema-suggester.ts`. Task 11 finalises.
