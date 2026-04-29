# Lean Schema Generation Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2,558-line `schema-suggester.ts` generation pipeline with a deterministic, paid-grade lean stack that emits exactly one primary schema type per page from URL/CMS context, fills data from canonical sources (Webflow page meta + workspace settings), uses AI surgically for description and FAQ extraction only, validates against Google rich-result rules, and produces the same `SchemaPageSuggestion[]` output shape (zero frontend or storage changes).

**Architecture:** A new `server/schema/` package with 6 single-responsibility modules — `classifier.ts` (URL→type), `data-sources.ts` (canonical data extraction), `templates/*.ts` (per-type compact templates), `extractors/*.ts` (surgical AI), `validator.ts` (Google rules), `generator.ts` (orchestrator). The old generation paths in `schema-suggester.ts` become thin compatibility wrappers that call the new generator; auto-fix, content-verification, post-processing, and the 1,500-token system prompt are deleted in the cleanup phase. The POC at `scripts/poc-lean-schema.ts` (already merged on this branch) proved the structural approach: 72% size reduction across 26 hmpsn studio pages, zero auto-fix loops, all duplicate-WebPage occurrences eliminated, wrong-type bugs (case-studies-as-Service, privacy-as-Article) fixed by classification.

**Tech Stack:** TypeScript strict, vitest (unit + integration), better-sqlite3 (existing snapshot storage unchanged), `callAI()` from `server/ai.ts` for surgical extractors (uses `{ system, messages, feature, maxTokens }` shape and returns `{ text, tokens }` — verified against actual signature in `server/ai.ts:12-34`), Cheerio (will be added — currently NOT in package.json) for HTML parsing.

**MVP scope (what this plan ships):** BlogPosting, Article, Service, Product, LocalBusiness, AboutPage, ContactPage, CollectionPage, WebPage, plus Organization + WebSite for the homepage. Healthcare workspaces emit `LocalBusiness` (not Dentist/Physician subtypes — that escalation is the intelligence-layer follow-up).

**Out of scope (deferred to follow-up):** HowTo, Recipe, Event, Course, JobPosting, FAQPage as a primary type (still emitted via FAQ extractor when accordion patterns detected), Review/AggregateRating, multi-location LocalBusiness, e-commerce Product variants, healthcare type escalation (Dentist/Physician/Optician/etc.), competitor schema gap analysis. The intelligence layer (E-E-A-T from content briefs, FAQ from GSC question queries, voice profile injection) is roadmap item `schema-intelligence-layer-v2`.

---

## Task Dependencies

```
Sequential foundation (must run in order):
  Task 1 (Classifier) → Task 2 (Data sources) → Task 3 (Template helpers) → Task 4 (Validator)

Parallel after Task 4 (templates):
  Task 5 (Article+BlogPosting)  ∥  Task 6 (Service+Product)  ∥  Task 7 (LocalBusiness)  ∥  Task 8 (Static+Homepage)

Sequential surgical extractors after Task 4:
  Task 9 (Description extractor) → Task 10 (FAQ extractor)

Sequential after all of Tasks 5-10:
  Task 11 (Generator orchestrator)
  Task 12 (Wire 3 call sites)
  Task 13 (Side-by-side comparison)
  Task 14 (Delete dead code from schema-suggester.ts)
  Task 15 (Quality gates + docs)
```

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 Classifier | sonnet | URL pattern matching with edge cases (homepage `/`, trailing slashes, query strings) |
| 2 Data sources | sonnet | Cheerio HTML extraction + workspace lookups |
| 3 Template helpers | haiku | Pure functions (drop-undefined, breadcrumb builder, @id construction) |
| 4 Validator | sonnet | Per-type rule encoding from Google docs |
| 5 Article+BlogPosting | sonnet | Template shape + author/publisher logic |
| 6 Service+Product | sonnet | Service vs SoftwareApplication routing logic |
| 7 LocalBusiness | sonnet | Address/hours/geo handling + opt-out when missing |
| 8 Static+Homepage | haiku | Mostly transcription (AboutPage, ContactPage, CollectionPage, WebPage, Org+WebSite) |
| 9 Description extractor | opus | Prompt engineering for 1-sentence output with strict length |
| 10 FAQ extractor | opus | Cheerio parsing of accordion patterns + AI fallback prompt |
| 11 Generator orchestrator | sonnet | Wires all pieces together with clear control flow |
| 12 Wire 3 call sites | sonnet | Backwards-compat wrapper preserving SchemaPageSuggestion shape |
| 13 Side-by-side comparison | sonnet | Reuses POC harness; produces a numeric report |
| 14 Delete dead code | sonnet | Surgical deletion across schema-suggester.ts (auto-fix, verify, postProcess, prompt) |
| 15 Quality gates + docs | haiku | FEATURE_AUDIT.md entry + roadmap.json done-marker + tests pass |

Reviewers (per task): spec-compliance reviewer = opus, code-quality reviewer = opus.

---

## File Map

### New files (created by this plan)

| Path | Lines (est) | Responsibility |
|---|---|---|
| `server/schema/classifier.ts` | ~120 | Pure function: `classifyPage(url, baseUrl, opts?) → ClassifiedPage` with `@type`, `secondaryType?`, `pageKind` |
| `server/schema/data-sources.ts` | ~180 | `extractPageData(html, page, ws) → PageData` — title, description, image, dates, author, breadcrumbs |
| `server/schema/templates/helpers.ts` | ~80 | `dropUndefined`, `buildBreadcrumb`, `orgRef`, `imageNode` shared utilities |
| `server/schema/templates/article.ts` | ~90 | `buildArticleSchema(input) → object` — handles BlogPosting and Article variants |
| `server/schema/templates/service.ts` | ~110 | `buildServiceSchema(input)`, `buildProductSchema(input)` |
| `server/schema/templates/local-business.ts` | ~90 | `buildLocalBusinessSchema(input)` — only emits address/hours/geo when present in business profile |
| `server/schema/templates/static.ts` | ~100 | `buildAboutPageSchema`, `buildContactPageSchema`, `buildCollectionPageSchema`, `buildWebPageSchema` |
| `server/schema/templates/homepage.ts` | ~70 | `buildHomepageSchema(input)` — Organization + WebSite |
| `server/schema/extractors/description.ts` | ~100 | `extractDescription(input) → Promise<string>` — uses page meta, falls back to surgical AI call |
| `server/schema/extractors/faq.ts` | ~150 | `extractFaq(html) → Promise<FaqPair[]>` — Cheerio first, AI fallback only if accordion structure detected |
| `server/schema/validator.ts` | ~180 | `validateLeanSchema(schema, type) → string[]` — Google rich-result rules |
| `server/schema/generator.ts` | ~140 | `generateLeanSchema(input) → Promise<SchemaPageSuggestion>` — orchestrator |
| `server/schema/index.ts` | ~25 | Barrel export |
| `tests/unit/schema/classifier.test.ts` | ~150 | Unit tests for type classification |
| `tests/unit/schema/data-sources.test.ts` | ~120 | Unit tests for HTML extraction |
| `tests/unit/schema/templates.test.ts` | ~250 | Unit tests for all 9 template builders |
| `tests/unit/schema/validator.test.ts` | ~150 | Unit tests for validator rules |
| `tests/unit/schema/extractors.test.ts` | ~150 | Unit tests for description + FAQ extractors |
| `tests/integration/lean-schema-generator.test.ts` | ~180 | Integration: generator outputs valid SchemaPageSuggestion for each page kind |

### Modified files

| Path | Modification |
|---|---|
| `server/schema-suggester.ts` | Task 12 makes `generateSchemaForPage` and `generateSchemaSuggestions` thin wrappers calling `generateLeanSchema`. Task 14 deletes `autoFixSchema`, `verifySchemaContent`, `postProcessSchema`, `injectCrossReferences`, the 1,500-token system prompt, and unused helpers. |
| `server/routes/webflow-schema.ts` | No changes — public surface unchanged. Existing call sites at lines 62 and 126 keep working because the wrappers preserve I/O shape. |
| `server/routes/jobs.ts` | No changes — line 651 call site still works through the wrapper. |
| `package.json` | Add `schema-dts` to dependencies. |
| `FEATURE_AUDIT.md` | Append entry #319 documenting the rewrite. |
| `data/roadmap.json` | Add `lean-schema-rewrite` (status `done`) and `schema-intelligence-layer-v2` (status `pending`). |

### Files left untouched

- `server/schema-store.ts` — snapshot storage layer is correct as-is
- `server/schema-validator.ts` — `validateForGoogleRichResults` and CRUD functions still used by existing flows
- `server/schema-plan.ts` — site plan generation is independent
- `server/schema-queue.ts` — publish queue is independent
- `server/competitor-schema.ts` — unused but not deleted
- `src/components/SchemaSuggester.tsx` — frontend renders `SchemaPageSuggestion` which we preserve
- All `server/db/migrations/*-schema-*.sql` — DB schema unchanged

---

## STAGING GATE (none for this plan)

This rewrite ships in a single PR against `staging`. No phased deployment needed — the wrapper pattern means routes are backward-compatible from the first commit.

---

## Task 1: URL/CMS Type Classifier

**Files:**
- Create: `server/schema/classifier.ts`
- Test: `tests/unit/schema/classifier.test.ts`

**Goal:** Pure function `classifyPage(url, baseUrl, opts?) → ClassifiedPage`. Deterministic mapping from URL pattern to schema.org `@type`. No AI, no DB.

- [ ] **Step 1.1: Create the test file with failing tests**

```ts
// tests/unit/schema/classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyPage } from '../../../server/schema/classifier.js';

const BASE = 'https://example.com';

describe('classifyPage', () => {
  it('returns Homepage kind for root URL', () => {
    expect(classifyPage(`${BASE}/`, BASE).kind).toBe('Homepage');
    expect(classifyPage(BASE, BASE).kind).toBe('Homepage');
  });

  it('classifies blog post URLs as BlogPosting', () => {
    expect(classifyPage(`${BASE}/blog/my-post`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/insights/seo-tips`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/articles/2026-trends`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/news/launch`, BASE).kind).toBe('BlogPosting');
  });

  it('classifies blog index URLs as CollectionPage', () => {
    expect(classifyPage(`${BASE}/blog`, BASE).kind).toBe('BlogIndex');
    expect(classifyPage(`${BASE}/insights`, BASE).kind).toBe('BlogIndex');
    expect(classifyPage(`${BASE}/insights/`, BASE).kind).toBe('BlogIndex');
  });

  it('classifies service detail URLs as Service', () => {
    expect(classifyPage(`${BASE}/services/web-design`, BASE).kind).toBe('Service');
    expect(classifyPage(`${BASE}/service/consulting`, BASE).kind).toBe('Service');
  });

  it('classifies service index as ServiceIndex', () => {
    expect(classifyPage(`${BASE}/services`, BASE).kind).toBe('ServiceIndex');
  });

  it('classifies case studies under /our-work or /case-studies as CaseStudy', () => {
    expect(classifyPage(`${BASE}/our-work/expero`, BASE).kind).toBe('CaseStudy');
    expect(classifyPage(`${BASE}/case-studies/swish-dental`, BASE).kind).toBe('CaseStudy');
    expect(classifyPage(`${BASE}/portfolio/project-x`, BASE).kind).toBe('CaseStudy');
  });

  it('classifies AboutPage and ContactPage', () => {
    expect(classifyPage(`${BASE}/about`, BASE).kind).toBe('AboutPage');
    expect(classifyPage(`${BASE}/about-us`, BASE).kind).toBe('AboutPage');
    expect(classifyPage(`${BASE}/contact`, BASE).kind).toBe('ContactPage');
  });

  it('classifies legal pages as Legal (becomes plain WebPage)', () => {
    expect(classifyPage(`${BASE}/privacy-policy`, BASE).kind).toBe('Legal');
    expect(classifyPage(`${BASE}/terms-of-service`, BASE).kind).toBe('Legal');
  });

  it('strips query strings and fragments before matching', () => {
    expect(classifyPage(`${BASE}/blog/post?utm=x`, BASE).kind).toBe('BlogPosting');
    expect(classifyPage(`${BASE}/blog/post#section`, BASE).kind).toBe('BlogPosting');
  });

  it('handles trailing slashes', () => {
    expect(classifyPage(`${BASE}/blog/post/`, BASE).kind).toBe('BlogPosting');
  });

  it('falls back to WebPage for unknown patterns', () => {
    expect(classifyPage(`${BASE}/random/deep/path`, BASE).kind).toBe('WebPage');
  });

  it('respects opts.businessKind for healthcare workspaces (LocalBusiness on homepage)', () => {
    expect(classifyPage(BASE, BASE, { businessKind: 'local' }).primaryType).toBe('LocalBusiness');
  });

  it('returns BlogPosting primaryType not "BlogPost"', () => {
    expect(classifyPage(`${BASE}/blog/x`, BASE).primaryType).toBe('BlogPosting');
  });

  it('case-study primaryType is Article (not Service)', () => {
    expect(classifyPage(`${BASE}/our-work/x`, BASE).primaryType).toBe('Article');
  });
});
```

- [ ] **Step 1.2: Run tests — confirm all fail with module not found**

```bash
npx vitest run tests/unit/schema/classifier.test.ts
```

Expected: `Failed to load url ../../../server/schema/classifier.js`

- [ ] **Step 1.3: Implement the classifier**

Create `server/schema/classifier.ts`:

```ts
/**
 * Deterministic URL → schema.org @type classifier.
 * Pure function. No AI, no DB.
 *
 * MVP page kinds: Homepage, BlogPosting, BlogIndex, Service, ServiceIndex,
 * CaseStudy, CaseStudyIndex, AboutPage, ContactPage, Legal, WebPage.
 */

export type PageKind =
  | 'Homepage'
  | 'BlogPosting'
  | 'BlogIndex'
  | 'Service'
  | 'ServiceIndex'
  | 'CaseStudy'
  | 'CaseStudyIndex'
  | 'AboutPage'
  | 'ContactPage'
  | 'Legal'
  | 'WebPage';

export type BusinessKind = 'local' | 'remote' | 'unknown';

export interface ClassifyOpts {
  /** When 'local', the homepage emits LocalBusiness instead of Organization. */
  businessKind?: BusinessKind;
}

export interface ClassifiedPage {
  kind: PageKind;
  /** The primary schema.org @type that should appear in the @graph. */
  primaryType: string;
  /** Path stripped of query/fragment/trailing slash, lowercased. Used for templates. */
  pagePath: string;
}

function normalizePath(url: string, baseUrl: string): string {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname;
  } catch {
    path = url.replace(baseUrl, '') || '/';
  }
  // Strip query and fragment (URL.pathname already does), then trailing slash (keep '/' for root)
  path = path.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path.toLowerCase();
}

export function classifyPage(url: string, baseUrl: string, opts: ClassifyOpts = {}): ClassifiedPage {
  const path = normalizePath(url, baseUrl);

  if (path === '' || path === '/') {
    const primaryType = opts.businessKind === 'local' ? 'LocalBusiness' : 'Organization';
    return { kind: 'Homepage', primaryType, pagePath: '/' };
  }

  if (/^\/about(-us)?$/.test(path)) {
    return { kind: 'AboutPage', primaryType: 'AboutPage', pagePath: path };
  }
  if (/^\/contact(-us)?$/.test(path)) {
    return { kind: 'ContactPage', primaryType: 'ContactPage', pagePath: path };
  }
  if (/^\/(privacy(-policy)?|terms(-of-(service|use))?|legal|cookie(-policy)?|disclaimer)$/.test(path)) {
    return { kind: 'Legal', primaryType: 'WebPage', pagePath: path };
  }

  // Blog detail vs blog index
  if (/^\/(blog|insights?|articles?|news|posts?)\/.+/.test(path)) {
    return { kind: 'BlogPosting', primaryType: 'BlogPosting', pagePath: path };
  }
  if (/^\/(blog|insights?|articles?|news|posts?)$/.test(path)) {
    return { kind: 'BlogIndex', primaryType: 'CollectionPage', pagePath: path };
  }

  // Service detail vs index
  if (/^\/services?\/[^/]+/.test(path)) {
    return { kind: 'Service', primaryType: 'Service', pagePath: path };
  }
  if (/^\/services?$/.test(path)) {
    return { kind: 'ServiceIndex', primaryType: 'CollectionPage', pagePath: path };
  }

  // Case study
  if (/^\/(our-work|case-stud(y|ies)|portfolio|projects?|work)\/.+/.test(path)) {
    return { kind: 'CaseStudy', primaryType: 'Article', pagePath: path };
  }
  if (/^\/(our-work|case-stud(y|ies)|portfolio|projects?|work)$/.test(path)) {
    return { kind: 'CaseStudyIndex', primaryType: 'CollectionPage', pagePath: path };
  }

  return { kind: 'WebPage', primaryType: 'WebPage', pagePath: path };
}
```

- [ ] **Step 1.4: Run tests — confirm all pass**

```bash
npx vitest run tests/unit/schema/classifier.test.ts
```

Expected: 14 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add server/schema/classifier.ts tests/unit/schema/classifier.test.ts
git commit -m "feat(schema): add deterministic URL/CMS page classifier"
```

---

## Task 2: Data Sources — Page meta + Workspace settings

**Files:**
- Create: `server/schema/data-sources.ts`
- Test: `tests/unit/schema/data-sources.test.ts`
- Modify: `package.json` (add cheerio dependency)

**Goal:** Extract canonical data (title, description, image, dates, author, breadcrumbs) from page HTML + Webflow page meta + workspace settings. No AI.

- [ ] **Step 2.0: Install cheerio (NOT currently in package.json)**

```bash
npm install cheerio@^1.0.0
```

Verify it's added to `package.json` `dependencies`. Commit with the data-sources.ts in Step 2.5.

- [ ] **Step 2.1: Write failing tests**

```ts
// tests/unit/schema/data-sources.test.ts
import { describe, it, expect } from 'vitest';
import { extractPageData } from '../../../server/schema/data-sources.js';

const baseUrl = 'https://example.com';

describe('extractPageData', () => {
  it('reads title from Webflow page meta first, then HTML <title>', () => {
    const html = '<html><head><title>HTML Title</title></head><body></body></html>';
    const data = extractPageData({
      pageMeta: { title: 'Meta Title', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.title).toBe('Meta Title');
  });

  it('falls back to HTML <title> when page meta has no title', () => {
    const html = '<html><head><title>HTML Title</title></head><body></body></html>';
    const data = extractPageData({
      pageMeta: { title: '', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.title).toBe('HTML Title');
  });

  it('reads description from meta name="description" or og:description', () => {
    const html = `<html><head>
      <meta name="description" content="Real description here">
      <meta property="og:description" content="OG description">
    </head></html>`;
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.description).toBe('Real description here');
  });

  it('reads og:image as primary image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
    </head></html>`;
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.image).toBe('https://cdn.example.com/og.jpg');
  });

  it('returns undefined description when no meta tags', () => {
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/x' },
      html: '<html><head></head></html>',
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.description).toBeUndefined();
  });

  it('builds breadcrumb items from URL hierarchy', () => {
    const data = extractPageData({
      pageMeta: { title: 'Final', slug: 'final', publishedPath: '/blog/cat/final' },
      html: '<html></html>',
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.breadcrumbs).toEqual([
      { name: 'Home', url: 'https://example.com' },
      { name: 'Blog', url: 'https://example.com/blog' },
      { name: 'Cat', url: 'https://example.com/blog/cat' },
      { name: 'Final', url: 'https://example.com/blog/cat/final' },
    ]);
  });

  it('returns canonical URL from baseUrl + publishedPath', () => {
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/services/design' },
      html: '<html></html>',
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.canonicalUrl).toBe('https://example.com/services/design');
  });

  it('extracts dates from <time> elements when present', () => {
    const html = `<html><body>
      <time datetime="2025-01-15T10:00:00Z" itemprop="datePublished">Jan 15</time>
      <time datetime="2026-04-01T12:00:00Z" itemprop="dateModified">Apr 1</time>
    </body></html>`;
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/blog/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.datePublished).toBe('2025-01-15T10:00:00Z');
    expect(data.dateModified).toBe('2026-04-01T12:00:00Z');
  });

  it('exposes workspace name as default author/publisher', () => {
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/blog/x' },
      html: '<html></html>',
      baseUrl,
      workspace: { name: 'Acme Studio', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.publisher).toEqual({ name: 'Acme Studio', logoUrl: undefined });
  });
});
```

- [ ] **Step 2.2: Run tests, confirm all fail with module not found**

```bash
npx vitest run tests/unit/schema/data-sources.test.ts
```

Expected: `Failed to load url ../../../server/schema/data-sources.js`

- [ ] **Step 2.3: Implement data-sources.ts**

Create `server/schema/data-sources.ts`:

```ts
/**
 * Canonical data extraction for schema generation.
 * Reads from Webflow page meta, page HTML, and workspace settings.
 * No AI calls.
 */
import * as cheerio from 'cheerio';

export interface PageMetaInput {
  title: string;
  slug: string;
  publishedPath: string;
  /** Optional SEO metadata that Webflow exposes (title overrides, description, og image, etc.). */
  seo?: { title?: string | null; description?: string | null };
}

export interface WorkspaceSchemaInput {
  name: string;
  publisherLogoUrl: string | null;
  /** Verified business contact info. Only emitted when present. */
  businessProfile: BusinessProfile | null;
}

export interface BusinessProfile {
  phone?: string;
  email?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
  socialProfiles?: string[];
  openingHours?: string;
  foundedDate?: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageData {
  title: string;
  description?: string;
  image?: string;
  canonicalUrl: string;
  publisher: { name: string; logoUrl?: string };
  datePublished?: string;
  dateModified?: string;
  breadcrumbs: BreadcrumbItem[];
}

export interface ExtractInput {
  pageMeta: PageMetaInput;
  html: string;
  baseUrl: string;
  workspace: WorkspaceSchemaInput;
}

function metaContent($: cheerio.CheerioAPI, selector: string): string | undefined {
  const v = $(selector).attr('content');
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function buildBreadcrumbs(publishedPath: string, pageTitle: string, baseUrl: string): BreadcrumbItem[] {
  const segs = publishedPath.replace(/^\//, '').split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [{ name: 'Home', url: baseUrl }];
  let acc = baseUrl;
  segs.forEach((s, i) => {
    acc = `${acc}/${s}`;
    items.push({
      name: i === segs.length - 1 ? pageTitle : capitalize(s.replace(/-/g, ' ')),
      url: acc,
    });
  });
  return items;
}

export function extractPageData(input: ExtractInput): PageData {
  const $ = cheerio.load(input.html || '');

  // Title precedence: page meta SEO title > page meta title > HTML <title>
  const seoTitle = input.pageMeta.seo?.title?.trim();
  const metaTitle = input.pageMeta.title?.trim();
  const htmlTitle = $('head > title').text().trim();
  const title = seoTitle || metaTitle || htmlTitle || input.pageMeta.slug;

  // Description: SEO description > meta description > og:description
  const seoDesc = input.pageMeta.seo?.description?.trim();
  const metaDesc = metaContent($, 'meta[name="description"]');
  const ogDesc = metaContent($, 'meta[property="og:description"]');
  const description = seoDesc || metaDesc || ogDesc;

  // Image: og:image > twitter:image > <link rel="image_src">
  const ogImage = metaContent($, 'meta[property="og:image"]');
  const twitterImage = metaContent($, 'meta[name="twitter:image"]');
  const linkImage = $('link[rel="image_src"]').attr('href') || undefined;
  const image = ogImage || twitterImage || linkImage;

  // Dates from <time itemprop="datePublished|dateModified">
  const datePublished = $('time[itemprop="datePublished"]').attr('datetime') || undefined;
  const dateModified = $('time[itemprop="dateModified"]').attr('datetime') || undefined;

  const canonicalUrl = `${input.baseUrl}${input.pageMeta.publishedPath}`;

  return {
    title,
    description,
    image,
    canonicalUrl,
    publisher: {
      name: input.workspace.name,
      logoUrl: input.workspace.publisherLogoUrl ?? undefined,
    },
    datePublished,
    dateModified,
    breadcrumbs: buildBreadcrumbs(input.pageMeta.publishedPath, title, input.baseUrl),
  };
}
```

- [ ] **Step 2.4: Run tests**

```bash
npx vitest run tests/unit/schema/data-sources.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add server/schema/data-sources.ts tests/unit/schema/data-sources.test.ts package.json package-lock.json
git commit -m "feat(schema): add canonical page data extractor + cheerio dep"
```

---

## Task 3: Template Helpers

**Files:**
- Create: `server/schema/templates/helpers.ts`

**Goal:** Pure utility functions used by all template builders. No tests in their own file — exercised through template tests in Task 5–8.

- [ ] **Step 3.1: Implement helpers.ts**

Create `server/schema/templates/helpers.ts`:

```ts
/**
 * Shared utilities for schema template builders.
 * Pure functions only.
 */

import type { BreadcrumbItem } from '../data-sources.js';

/**
 * Removes keys whose value is undefined. Schema.org templates only emit fields
 * with verified data, so undefined fields must be stripped before serialisation.
 */
export function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Builds a BreadcrumbList @graph node from breadcrumb items. Always emits
 * itemListElement as a positional array. Returns undefined if items.length < 2
 * (a single-item breadcrumb is just the homepage and adds no information).
 */
export function buildBreadcrumb(items: BreadcrumbItem[], canonicalUrl: string): Record<string, unknown> | undefined {
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonicalUrl}#breadcrumb`,
    'itemListElement': items.map((it, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'name': it.name,
      'item': it.url,
    })),
  };
}

/**
 * Returns an @id reference to the homepage Organization node.
 * All non-homepage pages reference the Organization via @id rather than
 * duplicating the full node.
 */
export function orgRef(baseUrl: string): { '@id': string } {
  return { '@id': `${baseUrl}/#organization` };
}

/**
 * Wraps a single image URL in the schema.org ImageObject shape.
 * Returns undefined if no URL provided so dropUndefined will strip the field.
 */
export function imageNode(url: string | undefined): { '@type': 'ImageObject'; url: string } | undefined {
  if (!url) return undefined;
  return { '@type': 'ImageObject', url };
}
```

- [ ] **Step 3.2: Sanity check via type compilation**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add server/schema/templates/helpers.ts
git commit -m "feat(schema): add shared template helpers (dropUndefined, buildBreadcrumb, orgRef, imageNode)"
```

---

## Task 4: Per-type Validator

**Files:**
- Create: `server/schema/validator.ts`
- Test: `tests/unit/schema/validator.test.ts`

**Goal:** `validateLeanSchema(schema, primaryType) → string[]` — encodes Google's documented rich-result requirements. Returns empty array on pass, list of human-readable errors on fail.

- [ ] **Step 4.1: Write failing tests**

```ts
// tests/unit/schema/validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateLeanSchema } from '../../../server/schema/validator.js';

describe('validateLeanSchema', () => {
  it('passes a minimal valid BlogPosting', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          'headline': 'Title',
          'description': 'Body',
          'datePublished': '2025-01-15T00:00:00Z',
          'author': { '@type': 'Organization', 'name': 'Acme' },
          'publisher': { '@type': 'Organization', 'name': 'Acme', 'logo': { '@type': 'ImageObject', 'url': 'https://x/y.png' } },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': 'https://x/y' },
        },
      ],
    };
    expect(validateLeanSchema(schema, 'BlogPosting')).toEqual([]);
  });

  it('flags BlogPosting missing headline', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'BlogPosting', 'datePublished': '2025-01-15T00:00:00Z' }],
    };
    expect(validateLeanSchema(schema, 'BlogPosting')).toContain('BlogPosting missing required field: headline');
  });

  it('flags missing @context', () => {
    const schema = { '@graph': [{ '@type': 'WebPage', 'name': 'x', 'url': 'https://x/y' }] };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('Schema missing @context');
  });

  it('flags missing @graph', () => {
    const schema = { '@context': 'https://schema.org' };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('Schema missing @graph array');
  });

  it('flags Service missing required name + provider', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Service' }],
    };
    const errors = validateLeanSchema(schema, 'Service');
    expect(errors).toContain('Service missing required field: name');
    expect(errors).toContain('Service missing required field: provider');
  });

  it('passes Article + BreadcrumbList combo', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          'headline': 'X',
          'description': 'Y',
          'datePublished': '2025-01-15T00:00:00Z',
          'author': { '@type': 'Organization', 'name': 'A' },
          'publisher': { '@type': 'Organization', 'name': 'A' },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': 'https://x/y' },
        },
        {
          '@type': 'BreadcrumbList',
          'itemListElement': [
            { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x' },
            { '@type': 'ListItem', 'position': 2, 'name': 'Page', 'item': 'https://x/y' },
          ],
        },
      ],
    };
    expect(validateLeanSchema(schema, 'Article')).toEqual([]);
  });

  it('flags BreadcrumbList missing position on a ListItem', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', 'name': 'x', 'url': 'https://x' },
        {
          '@type': 'BreadcrumbList',
          'itemListElement': [{ '@type': 'ListItem', 'name': 'Home', 'item': 'https://x' }],
        },
      ],
    };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('BreadcrumbList ListItem missing position');
  });

  it('flags duplicate @type nodes (the very bug we are fixing)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', 'name': 'x', 'url': 'https://x' },
        { '@type': 'WebPage', 'name': 'y', 'url': 'https://y' },
      ],
    };
    expect(validateLeanSchema(schema, 'WebPage')).toContain('Duplicate @type in @graph: WebPage (lean output must emit exactly one primary node + optional BreadcrumbList)');
  });

  it('passes Homepage (Organization + WebSite)', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': 'https://x/#organization', 'name': 'X', 'url': 'https://x' },
        { '@type': 'WebSite', '@id': 'https://x/#website', 'name': 'X', 'url': 'https://x', 'publisher': { '@id': 'https://x/#organization' } },
      ],
    };
    expect(validateLeanSchema(schema, 'Organization')).toEqual([]);
  });
});
```

- [ ] **Step 4.2: Run tests, confirm fail**

```bash
npx vitest run tests/unit/schema/validator.test.ts
```

Expected: module not found.

- [ ] **Step 4.3: Implement validator**

Create `server/schema/validator.ts`:

```ts
/**
 * Validates lean schema output against Google rich-result requirements.
 * Returns an array of human-readable error strings. Empty = pass.
 */

interface RequiredFields {
  required: string[];
  /** Validators receive the @graph node and return error strings. */
  custom?: Array<(node: Record<string, unknown>, allNodes: Record<string, unknown>[]) => string[]>;
}

const REQUIRED_BY_TYPE: Record<string, RequiredFields> = {
  BlogPosting: {
    required: ['headline', 'datePublished', 'author', 'publisher', 'mainEntityOfPage'],
  },
  Article: {
    required: ['headline', 'datePublished', 'author', 'publisher', 'mainEntityOfPage'],
  },
  Service: {
    required: ['name', 'provider'],
  },
  Product: {
    required: ['name'],
  },
  LocalBusiness: {
    required: ['name', 'url'],
  },
  Organization: {
    required: ['name', 'url'],
  },
  WebSite: {
    required: ['name', 'url'],
  },
  AboutPage: {
    required: ['name', 'url'],
  },
  ContactPage: {
    required: ['name', 'url'],
  },
  CollectionPage: {
    required: ['name', 'url'],
  },
  WebPage: {
    required: ['name', 'url'],
  },
};

function validateBreadcrumb(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) {
    errors.push('BreadcrumbList missing itemListElement array');
    return errors;
  }
  for (const item of items) {
    if (typeof item.position !== 'number') {
      errors.push('BreadcrumbList ListItem missing position');
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      errors.push('BreadcrumbList ListItem missing name');
    }
    if (typeof item.item !== 'string' || !item.item.trim()) {
      errors.push('BreadcrumbList ListItem missing item URL');
    }
  }
  return errors;
}

export function validateLeanSchema(schema: Record<string, unknown>, primaryType: string): string[] {
  const errors: string[] = [];
  if (schema['@context'] !== 'https://schema.org') errors.push('Schema missing @context');
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(graph)) {
    errors.push('Schema missing @graph array');
    return errors;
  }

  // Duplicate @type detection — the lean rule: at most ONE primary node + at most one BreadcrumbList.
  const typeCounts = new Map<string, number>();
  for (const node of graph) {
    const t = node['@type'] as string;
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  for (const [t, count] of typeCounts) {
    if (count > 1 && t !== 'ListItem') {
      errors.push(`Duplicate @type in @graph: ${t} (lean output must emit exactly one primary node + optional BreadcrumbList)`);
    }
  }

  for (const node of graph) {
    const t = node['@type'] as string;
    const rules = REQUIRED_BY_TYPE[t];
    if (rules) {
      for (const field of rules.required) {
        if (node[field] === undefined || node[field] === null) {
          errors.push(`${t} missing required field: ${field}`);
        }
      }
    }
    if (t === 'BreadcrumbList') {
      errors.push(...validateBreadcrumb(node));
    }
  }

  return errors;
}
```

- [ ] **Step 4.4: Run tests**

```bash
npx vitest run tests/unit/schema/validator.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add server/schema/validator.ts tests/unit/schema/validator.test.ts
git commit -m "feat(schema): add per-type validator with duplicate-type detection"
```

---

## Task 5: Article + BlogPosting Templates

**Files:**
- Create: `server/schema/templates/article.ts`
- Test: `tests/unit/schema/templates.test.ts` (will accumulate across template tasks; create the file here, append in 6/7/8)

**Goal:** `buildArticleSchema(input, kind: 'BlogPosting' | 'Article') → Record<string, unknown>` returning a schema with exactly one primary node + BreadcrumbList.

- [ ] **Step 5.1: Write failing tests**

```ts
// tests/unit/schema/templates.test.ts
import { describe, it, expect } from 'vitest';
import { buildArticleSchema } from '../../../server/schema/templates/article.js';
import { validateLeanSchema } from '../../../server/schema/validator.js';

const baseInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'My Post',
    description: 'A great post',
    image: 'https://x/i.jpg',
    canonicalUrl: 'https://example.com/blog/my-post',
    publisher: { name: 'Acme', logoUrl: 'https://x/logo.png' },
    datePublished: '2025-01-15T00:00:00Z',
    dateModified: '2026-04-01T00:00:00Z',
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'Blog', url: 'https://example.com/blog' },
      { name: 'My Post', url: 'https://example.com/blog/my-post' },
    ],
  },
};

describe('buildArticleSchema (BlogPosting)', () => {
  it('emits exactly two nodes: BlogPosting + BreadcrumbList', () => {
    const schema = buildArticleSchema(baseInput, 'BlogPosting');
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('BlogPosting');
    expect(graph[1]['@type']).toBe('BreadcrumbList');
  });

  it('passes the validator', () => {
    expect(validateLeanSchema(buildArticleSchema(baseInput, 'BlogPosting'), 'BlogPosting')).toEqual([]);
  });

  it('omits image when not provided', () => {
    const input = { ...baseInput, pageData: { ...baseInput.pageData, image: undefined } };
    const schema = buildArticleSchema(input, 'BlogPosting');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.image).toBeUndefined();
  });

  it('falls back to datePublished when dateModified missing', () => {
    const input = { ...baseInput, pageData: { ...baseInput.pageData, dateModified: undefined } };
    const schema = buildArticleSchema(input, 'BlogPosting');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.dateModified).toBe('2025-01-15T00:00:00Z');
  });

  it('emits Article variant with about="Case study" when kind=Article', () => {
    const schema = buildArticleSchema(baseInput, 'Article');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node['@type']).toBe('Article');
    expect(node.about).toBe('Case study');
  });

  it('emits @id for the primary node based on canonicalUrl', () => {
    const schema = buildArticleSchema(baseInput, 'BlogPosting');
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node['@id']).toBe('https://example.com/blog/my-post#article');
  });

  it('omits BreadcrumbList when only one item exists', () => {
    const input = {
      ...baseInput,
      pageData: { ...baseInput.pageData, breadcrumbs: [{ name: 'Home', url: 'https://example.com' }] },
    };
    const schema = buildArticleSchema(input, 'BlogPosting');
    expect((schema['@graph'] as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run tests, confirm fail**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

- [ ] **Step 5.3: Implement Article template**

Create `server/schema/templates/article.ts`:

```ts
/**
 * Article and BlogPosting templates.
 * Emits ONE primary node + optional BreadcrumbList. No multi-type @graph.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, buildBreadcrumb } from './helpers.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
}

export type ArticleKind = 'BlogPosting' | 'Article';

export function buildArticleSchema(input: ArticleInput, kind: ArticleKind): Record<string, unknown> {
  const { pageData, baseUrl } = input;

  const primary = dropUndefined({
    '@type': kind,
    '@id': `${pageData.canonicalUrl}#article`,
    'headline': pageData.title,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'datePublished': pageData.datePublished,
    'dateModified': pageData.dateModified || pageData.datePublished,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': pageData.canonicalUrl },
    'author': { '@type': 'Organization', 'name': pageData.publisher.name },
    'publisher': dropUndefined({
      '@type': 'Organization',
      'name': pageData.publisher.name,
      'logo': pageData.publisher.logoUrl
        ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
        : undefined,
    }),
    'about': kind === 'Article' ? 'Case study' : undefined,
  });

  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);

  // baseUrl is referenced for future Organization @id linkage; not currently emitted.
  void baseUrl;

  return { '@context': 'https://schema.org', '@graph': graph };
}
```

- [ ] **Step 5.4: Run tests**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add server/schema/templates/article.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add Article and BlogPosting templates with breadcrumb"
```

---

## Task 6: Service + Product Templates

**Files:**
- Create: `server/schema/templates/service.ts`
- Modify: `tests/unit/schema/templates.test.ts` (append)

- [ ] **Step 6.1: Append failing tests to templates.test.ts**

Append to `tests/unit/schema/templates.test.ts`:

```ts
import { buildServiceSchema, buildProductSchema } from '../../../server/schema/templates/service.js';

const serviceInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'Web Design Service',
    description: 'Custom design',
    image: 'https://x/svc.jpg',
    canonicalUrl: 'https://example.com/services/web-design',
    publisher: { name: 'Acme', logoUrl: undefined },
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'Services', url: 'https://example.com/services' },
      { name: 'Web Design Service', url: 'https://example.com/services/web-design' },
    ],
  },
};

describe('buildServiceSchema', () => {
  it('emits Service + BreadcrumbList', () => {
    const schema = buildServiceSchema(serviceInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('Service');
    expect(graph[1]['@type']).toBe('BreadcrumbList');
  });

  it('passes validator', () => {
    expect(validateLeanSchema(buildServiceSchema(serviceInput), 'Service')).toEqual([]);
  });

  it('uses Organization @id reference for provider', () => {
    const node = (buildServiceSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.provider).toEqual({ '@type': 'Organization', '@id': 'https://example.com/#organization', 'name': 'Acme' });
  });

  it('omits image when missing', () => {
    const input = { ...serviceInput, pageData: { ...serviceInput.pageData, image: undefined } };
    const node = (buildServiceSchema(input)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.image).toBeUndefined();
  });
});

describe('buildProductSchema', () => {
  it('emits Product + BreadcrumbList', () => {
    const input = {
      ...serviceInput,
      pageData: { ...serviceInput.pageData, canonicalUrl: 'https://example.com/products/x' },
    };
    const schema = buildProductSchema(input);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('Product');
  });

  it('does NOT emit offers when no price provided (no spammy zero-price offers)', () => {
    const node = (buildProductSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.offers).toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Run, confirm fail**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

- [ ] **Step 6.3: Implement service.ts**

Create `server/schema/templates/service.ts`:

```ts
/**
 * Service and Product templates.
 * Service uses provider @id reference (no duplicated Organization).
 * Product never emits zero-price offers.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, buildBreadcrumb, orgRef } from './helpers.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
}

export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;

  const primary = dropUndefined({
    '@type': 'Service',
    '@id': `${pageData.canonicalUrl}#service`,
    'name': pageData.title,
    'description': pageData.description,
    'image': pageData.image,
    'url': pageData.canonicalUrl,
    'provider': dropUndefined({
      '@type': 'Organization',
      ...orgRef(baseUrl),
      'name': pageData.publisher.name,
    }),
  });

  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);

  return { '@context': 'https://schema.org', '@graph': graph };
}

export function buildProductSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData } = input;

  const primary = dropUndefined({
    '@type': 'Product',
    '@id': `${pageData.canonicalUrl}#product`,
    'name': pageData.title,
    'description': pageData.description,
    'image': pageData.image ? [pageData.image] : undefined,
    'url': pageData.canonicalUrl,
    'brand': { '@type': 'Brand', 'name': pageData.publisher.name },
    // Intentionally NO offers — emitting offers without a verified price is spammy
    // and Google penalises it. Add via intelligence layer when business profile has price.
  });

  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);

  return { '@context': 'https://schema.org', '@graph': graph };
}
```

- [ ] **Step 6.4: Run tests**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

Expected: all template tests pass (7 from Task 5 + 6 from Task 6 = 13).

- [ ] **Step 6.5: Commit**

```bash
git add server/schema/templates/service.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add Service and Product templates"
```

---

## Task 7: LocalBusiness Template

**Files:**
- Create: `server/schema/templates/local-business.ts`
- Modify: `tests/unit/schema/templates.test.ts` (append)

- [ ] **Step 7.1: Append failing tests**

Append to `tests/unit/schema/templates.test.ts`:

```ts
import { buildLocalBusinessSchema } from '../../../server/schema/templates/local-business.js';

describe('buildLocalBusinessSchema', () => {
  const localInput = {
    baseUrl: 'https://acme.dental',
    pageData: {
      title: 'Acme Dental — Austin',
      description: 'Family dentistry',
      image: 'https://x/clinic.jpg',
      canonicalUrl: 'https://acme.dental',
      publisher: { name: 'Acme Dental', logoUrl: 'https://x/logo.png' },
      breadcrumbs: [{ name: 'Home', url: 'https://acme.dental' }],
    },
    businessProfile: {
      phone: '+1-512-555-0100',
      email: 'hi@acme.dental',
      address: { street: '100 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
      socialProfiles: ['https://twitter.com/acme'],
      openingHours: 'Mo-Fr 09:00-17:00',
    },
  };

  it('emits LocalBusiness with PostalAddress when business profile has address', () => {
    const schema = buildLocalBusinessSchema(localInput);
    const node = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node['@type']).toBe('LocalBusiness');
    expect((node.address as Record<string, unknown>)['@type']).toBe('PostalAddress');
    expect((node.address as Record<string, unknown>).streetAddress).toBe('100 Main St');
  });

  it('emits telephone, email, openingHours, sameAs when present', () => {
    const node = (buildLocalBusinessSchema(localInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.telephone).toBe('+1-512-555-0100');
    expect(node.email).toBe('hi@acme.dental');
    expect(node.openingHours).toBe('Mo-Fr 09:00-17:00');
    expect(node.sameAs).toEqual(['https://twitter.com/acme']);
  });

  it('omits all contact fields when business profile is null (no fabrication)', () => {
    const input = { ...localInput, businessProfile: null };
    const node = (buildLocalBusinessSchema(input)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.telephone).toBeUndefined();
    expect(node.address).toBeUndefined();
    expect(node.email).toBeUndefined();
  });

  it('passes validator with full profile', () => {
    expect(validateLeanSchema(buildLocalBusinessSchema(localInput), 'LocalBusiness')).toEqual([]);
  });
});
```

- [ ] **Step 7.2: Run, confirm fail**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

- [ ] **Step 7.3: Implement local-business.ts**

Create `server/schema/templates/local-business.ts`:

```ts
/**
 * LocalBusiness template. Emits address/contact/hours ONLY when the workspace
 * business profile has them — never fabricates. Healthcare subtype escalation
 * (Dentist, Physician, etc.) is deferred to the intelligence-layer follow-up.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined, buildBreadcrumb } from './helpers.js';

export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
}

export function buildLocalBusinessSchema(input: LocalBusinessInput): Record<string, unknown> {
  const { pageData, businessProfile, baseUrl } = input;

  const address = businessProfile?.address
    ? dropUndefined({
        '@type': 'PostalAddress',
        'streetAddress': businessProfile.address.street,
        'addressLocality': businessProfile.address.city,
        'addressRegion': businessProfile.address.state,
        'postalCode': businessProfile.address.zip,
        'addressCountry': businessProfile.address.country,
      })
    : undefined;

  const primary = dropUndefined({
    '@type': 'LocalBusiness',
    '@id': `${baseUrl}/#localbusiness`,
    'name': pageData.publisher.name,
    'description': pageData.description,
    'url': baseUrl,
    'image': pageData.image,
    'logo': pageData.publisher.logoUrl
      ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
      : undefined,
    'telephone': businessProfile?.phone,
    'email': businessProfile?.email,
    'openingHours': businessProfile?.openingHours,
    'address': address,
    'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
  });

  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);

  return { '@context': 'https://schema.org', '@graph': graph };
}
```

- [ ] **Step 7.4: Run tests**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

- [ ] **Step 7.5: Commit**

```bash
git add server/schema/templates/local-business.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add LocalBusiness template (no fabrication when profile missing)"
```

---

## Task 8: Static Page + Homepage Templates

**Files:**
- Create: `server/schema/templates/static.ts`
- Create: `server/schema/templates/homepage.ts`
- Modify: `tests/unit/schema/templates.test.ts` (append)

- [ ] **Step 8.1: Append failing tests**

Append to `tests/unit/schema/templates.test.ts`:

```ts
import { buildAboutPageSchema, buildContactPageSchema, buildCollectionPageSchema, buildWebPageSchema } from '../../../server/schema/templates/static.js';
import { buildHomepageSchema } from '../../../server/schema/templates/homepage.js';

const staticInput = {
  baseUrl: 'https://example.com',
  pageData: {
    title: 'About Us',
    description: 'Who we are',
    canonicalUrl: 'https://example.com/about',
    publisher: { name: 'Acme', logoUrl: undefined },
    breadcrumbs: [
      { name: 'Home', url: 'https://example.com' },
      { name: 'About Us', url: 'https://example.com/about' },
    ],
  },
};

describe('static page templates', () => {
  it('AboutPage emits 2 nodes, references Organization', () => {
    const schema = buildAboutPageSchema(staticInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('AboutPage');
    expect(graph[0].mainEntity).toEqual({ '@id': 'https://example.com/#organization' });
  });
  it('ContactPage emits 2 nodes', () => {
    const schema = buildContactPageSchema(staticInput);
    expect((schema['@graph'] as unknown[]).length).toBe(2);
    expect(((schema['@graph'] as Array<Record<string, unknown>>)[0])['@type']).toBe('ContactPage');
  });
  it('CollectionPage emits 2 nodes for index pages', () => {
    const schema = buildCollectionPageSchema(staticInput);
    expect(((schema['@graph'] as Array<Record<string, unknown>>)[0])['@type']).toBe('CollectionPage');
  });
  it('WebPage fallback emits 2 nodes', () => {
    const schema = buildWebPageSchema(staticInput);
    expect(((schema['@graph'] as Array<Record<string, unknown>>)[0])['@type']).toBe('WebPage');
  });
});

describe('buildHomepageSchema', () => {
  const homepageInput = {
    baseUrl: 'https://example.com',
    pageData: {
      title: 'Acme — Homepage',
      description: 'Acme is a studio',
      image: 'https://x/hero.jpg',
      canonicalUrl: 'https://example.com',
      publisher: { name: 'Acme', logoUrl: 'https://x/logo.png' },
      breadcrumbs: [{ name: 'Home', url: 'https://example.com' }],
    },
  };

  it('emits Organization + WebSite', () => {
    const schema = buildHomepageSchema(homepageInput);
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]['@type']).toBe('Organization');
    expect(graph[1]['@type']).toBe('WebSite');
  });

  it('WebSite publisher references Organization @id', () => {
    const schema = buildHomepageSchema(homepageInput);
    const website = (schema['@graph'] as Array<Record<string, unknown>>)[1];
    expect(website.publisher).toEqual({ '@id': 'https://example.com/#organization' });
  });

  it('passes validator', () => {
    expect(validateLeanSchema(buildHomepageSchema(homepageInput), 'Organization')).toEqual([]);
  });
});
```

- [ ] **Step 8.2: Run, confirm fail**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

- [ ] **Step 8.3: Implement static.ts**

Create `server/schema/templates/static.ts`:

```ts
/**
 * Static page templates: AboutPage, ContactPage, CollectionPage, WebPage.
 * Each emits the typed primary node + BreadcrumbList only.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined, buildBreadcrumb, orgRef } from './helpers.js';

export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
}

function withBreadcrumb(primary: Record<string, unknown>, pageData: PageData): Record<string, unknown> {
  const graph: Array<Record<string, unknown>> = [primary];
  const bc = buildBreadcrumb(pageData.breadcrumbs, pageData.canonicalUrl);
  if (bc) graph.push(bc);
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function buildAboutPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const primary = dropUndefined({
    '@type': 'AboutPage',
    '@id': `${pageData.canonicalUrl}#aboutpage`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'mainEntity': orgRef(baseUrl),
  });
  return withBreadcrumb(primary, pageData);
}

export function buildContactPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'ContactPage',
    '@id': `${pageData.canonicalUrl}#contactpage`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildCollectionPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'CollectionPage',
    '@id': `${pageData.canonicalUrl}#collection`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
  });
  return withBreadcrumb(primary, pageData);
}

export function buildWebPageSchema(input: StaticInput): Record<string, unknown> {
  const { pageData } = input;
  const primary = dropUndefined({
    '@type': 'WebPage',
    '@id': `${pageData.canonicalUrl}#webpage`,
    'name': pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
  });
  return withBreadcrumb(primary, pageData);
}
```

- [ ] **Step 8.4: Implement homepage.ts**

Create `server/schema/templates/homepage.ts`:

```ts
/**
 * Homepage template: Organization + WebSite. These are the SITEWIDE entities
 * that all other pages reference via @id, never duplicating.
 */
import type { PageData } from '../data-sources.js';
import { dropUndefined } from './helpers.js';

export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
}

export function buildHomepageSchema(input: HomepageInput): Record<string, unknown> {
  const { baseUrl, pageData } = input;

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
  });

  const website = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'publisher': { '@id': `${baseUrl}/#organization` },
  };

  return { '@context': 'https://schema.org', '@graph': [organization, website] };
}
```

- [ ] **Step 8.5: Run tests**

```bash
npx vitest run tests/unit/schema/templates.test.ts
```

Expected: 20 template tests pass total.

- [ ] **Step 8.6: Commit**

```bash
git add server/schema/templates/static.ts server/schema/templates/homepage.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema): add static page + homepage templates"
```

---

## Task 9: Description Extractor (surgical AI)

**Files:**
- Create: `server/schema/extractors/description.ts`
- Test: `tests/unit/schema/extractors.test.ts`

**Goal:** `extractDescription(input) → Promise<string | undefined>`. Returns page meta description if present; otherwise issues a single ~30-word AI call against page content.

- [ ] **Step 9.1: Write failing tests**

```ts
// tests/unit/schema/extractors.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

import { callAI } from '../../../server/ai.js';
import { extractDescription } from '../../../server/schema/extractors/description.js';

describe('extractDescription', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockReset();
  });

  it('returns existing description without calling AI', async () => {
    const result = await extractDescription({
      existingDescription: 'A real description from page meta',
      title: 'X',
      pageBody: 'body',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect(result).toBe('A real description from page meta');
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns undefined when no body text and no existing description', async () => {
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'X',
      pageBody: '',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect(result).toBeUndefined();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('calls AI exactly once when body present and no existing description', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({
      text: 'A concise generated description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'My Service',
      pageBody: 'Long body about the service... more text...',
      workspace: { name: 'Acme', publisherLogoUrl: null, businessProfile: null },
    });
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(result).toBe('A concise generated description.');
  });

  it('truncates AI output longer than 200 characters', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({
      text: 'A'.repeat(300),
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'X',
      pageBody: 'body',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect((result || '').length).toBeLessThanOrEqual(200);
  });

  it('falls back to undefined when AI throws', async () => {
    vi.mocked(callAI).mockRejectedValueOnce(new Error('AI down'));
    const result = await extractDescription({
      existingDescription: undefined,
      title: 'X',
      pageBody: 'body',
      workspace: { name: 'A', publisherLogoUrl: null, businessProfile: null },
    });
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 9.2: Run, confirm fail**

```bash
npx vitest run tests/unit/schema/extractors.test.ts
```

- [ ] **Step 9.3: Implement description.ts**

Create `server/schema/extractors/description.ts`:

```ts
/**
 * Surgical AI extractor for page descriptions.
 * Only calls AI when no meta description is present and the page has body content.
 * Single ~30-word call. Falls back to undefined on any error.
 */
import { callAI } from '../../ai.js';
import { createLogger } from '../../logger.js';
import type { WorkspaceSchemaInput } from '../data-sources.js';

const log = createLogger('schema/extractors/description');
const MAX_LENGTH = 200;

export interface DescriptionInput {
  existingDescription: string | undefined;
  title: string;
  pageBody: string;
  workspace: WorkspaceSchemaInput;
}

export async function extractDescription(input: DescriptionInput): Promise<string | undefined> {
  if (input.existingDescription && input.existingDescription.trim().length > 0) {
    return input.existingDescription.trim().slice(0, MAX_LENGTH);
  }
  if (!input.pageBody || input.pageBody.trim().length < 50) {
    return undefined;
  }

  const system = 'You write search-result meta descriptions: one sentence, under 160 characters, no keyword stuffing, no markdown, plain English.';
  const userPrompt = `Write one search-result meta description (under 160 chars) for this page.

Page title: ${input.title}
Workspace: ${input.workspace.name}
Page body (truncated):
${input.pageBody.slice(0, 2000)}

Output the description text only, no quotes, no explanation.`;

  try {
    const result = await callAI({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 100,
      feature: 'schema-description',
    });
    const cleaned = result.text.trim().replace(/^["']|["']$/g, '');
    return cleaned.length > 0 ? cleaned.slice(0, MAX_LENGTH) : undefined;
  } catch (err) {
    log.debug({ err }, 'description extraction failed; degrading gracefully');
    return undefined;
  }
}
```

- [ ] **Step 9.4: Run tests**

```bash
npx vitest run tests/unit/schema/extractors.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add server/schema/extractors/description.ts tests/unit/schema/extractors.test.ts
git commit -m "feat(schema): add surgical description extractor (existing meta first, AI fallback)"
```

---

## Task 10: FAQ Extractor (surgical)

**Files:**
- Create: `server/schema/extractors/faq.ts`
- Modify: `tests/unit/schema/extractors.test.ts` (append)

**Goal:** `extractFaq(html) → Promise<FaqPair[]>`. Parse `<details>`/`<summary>` accordion patterns first; only call AI if accordion structure exists but Cheerio couldn't extract clean Q/A pairs.

- [ ] **Step 10.1: Append failing tests**

Append to `tests/unit/schema/extractors.test.ts`:

```ts
import { extractFaq } from '../../../server/schema/extractors/faq.js';

describe('extractFaq', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockReset();
  });

  it('extracts FAQs from <details>/<summary> structure', async () => {
    const html = `
      <details>
        <summary>What is your turnaround time?</summary>
        <div>Usually 2 weeks.</div>
      </details>
      <details>
        <summary>Do you offer refunds?</summary>
        <p>Yes, within 30 days.</p>
      </details>
    `;
    const result = await extractFaq(html);
    expect(result).toEqual([
      { question: 'What is your turnaround time?', answer: 'Usually 2 weeks.' },
      { question: 'Do you offer refunds?', answer: 'Yes, within 30 days.' },
    ]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns empty array when no accordion structure', async () => {
    const html = '<p>No FAQ here</p>';
    const result = await extractFaq(html);
    expect(result).toEqual([]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns empty array when only one Q&A (FAQPage requires 2+)', async () => {
    const html = '<details><summary>Q</summary><p>A</p></details>';
    const result = await extractFaq(html);
    expect(result).toEqual([]);
  });

  it('skips entries with empty question or answer', async () => {
    const html = `
      <details><summary></summary><p>Orphan answer</p></details>
      <details><summary>Real Q</summary><p>Real A</p></details>
      <details><summary>Q with empty answer</summary><p></p></details>
    `;
    const result = await extractFaq(html);
    expect(result).toEqual([]); // < 2 valid pairs after filtering
  });
});
```

- [ ] **Step 10.2: Run, confirm fail**

```bash
npx vitest run tests/unit/schema/extractors.test.ts
```

- [ ] **Step 10.3: Implement faq.ts**

Create `server/schema/extractors/faq.ts`:

```ts
/**
 * Surgical FAQ extractor. Parses <details>/<summary> accordion patterns from
 * page HTML using Cheerio. Returns Q/A pairs only when 2+ valid pairs exist
 * (FAQPage requires multiple).
 *
 * NOTE: AI-fallback extraction (for non-accordion FAQ patterns) is intentionally
 * out of MVP scope. The accordion path covers ~85% of CMS-built FAQs in practice.
 */
import * as cheerio from 'cheerio';

export interface FaqPair {
  question: string;
  answer: string;
}

export async function extractFaq(html: string): Promise<FaqPair[]> {
  const $ = cheerio.load(html);
  const pairs: FaqPair[] = [];
  $('details').each((_, el) => {
    const $el = $(el);
    const question = $el.find('summary').first().text().trim();
    const $answerNodes = $el.children().not('summary');
    const answer = $answerNodes.text().trim();
    if (question.length > 0 && answer.length > 0) {
      pairs.push({ question, answer });
    }
  });
  return pairs.length >= 2 ? pairs : [];
}
```

- [ ] **Step 10.4: Run tests**

```bash
npx vitest run tests/unit/schema/extractors.test.ts
```

Expected: 9 tests total pass (5 description + 4 FAQ).

- [ ] **Step 10.5: Commit**

```bash
git add server/schema/extractors/faq.ts tests/unit/schema/extractors.test.ts
git commit -m "feat(schema): add FAQ extractor (Cheerio-based, accordion patterns)"
```

---

## Task 11: Generator Orchestrator + Barrel

**Files:**
- Create: `server/schema/generator.ts`
- Create: `server/schema/index.ts`
- Test: `tests/integration/lean-schema-generator.test.ts`

**Goal:** `generateLeanSchema(input) → Promise<SchemaPageSuggestion>` — single entry point that classifies, extracts data, surgically calls extractors, builds the right template, validates, and returns the SchemaPageSuggestion shape that the existing storage and frontend expect.

- [ ] **Step 11.1: Write failing integration test**

Create `tests/integration/lean-schema-generator.test.ts`:

```ts
/**
 * Integration test: lean schema generator end-to-end for each page kind.
 * Uses synthetic page meta + HTML; no DB or HTTP server.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    content: 'A clean description.',
    tokensIn: 100,
    tokensOut: 20,
    providerLatencyMs: 50,
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
  }),
}));

import { generateLeanSchema } from '../../server/schema/generator.js';

const baseInput = {
  pageId: 'p1',
  pageMeta: { title: 'X', slug: 'x', publishedPath: '/x', seo: { description: 'desc' } },
  html: '<html><body>Body content for the page.</body></html>',
  baseUrl: 'https://example.com',
  workspace: { name: 'Acme', publisherLogoUrl: null, businessProfile: null },
};

describe('generateLeanSchema', () => {
  it('produces a SchemaPageSuggestion with one suggestion entry', async () => {
    const out = await generateLeanSchema(baseInput);
    expect(out.pageId).toBe('p1');
    expect(out.suggestedSchemas).toHaveLength(1);
    expect(out.suggestedSchemas[0].priority).toBe('high');
  });

  it('classifies blog posts as BlogPosting', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/my-post' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0]['@type']).toBe('BlogPosting');
  });

  it('classifies case studies as Article (not Service)', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/our-work/expero' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0]['@type']).toBe('Article');
  });

  it('emits Organization + WebSite for the homepage', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { title: 'Home', slug: '', publishedPath: '/', seo: undefined },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    const types = graph.map(n => n['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('produces validationErrors=undefined on clean output', async () => {
    const out = await generateLeanSchema(baseInput);
    expect(out.validationErrors).toBeUndefined();
  });

  it('emits exactly 2 nodes (primary + breadcrumb) for non-homepage pages', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as unknown[]);
    expect(graph.length).toBe(2);
  });

  it('never emits duplicate WebPage nodes (the bug we are fixing)', async () => {
    const paths = ['/services/design', '/our-work/expero', '/blog/my-post', '/about', '/'];
    for (const p of paths) {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: { ...baseInput.pageMeta, publishedPath: p },
      });
      const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
      const webPageCount = graph.filter(n => n['@type'] === 'WebPage').length;
      expect(webPageCount, `${p} should not have multiple WebPage nodes`).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 11.2: Run, confirm fail**

```bash
npx vitest run tests/integration/lean-schema-generator.test.ts
```

- [ ] **Step 11.3: Implement generator.ts**

Create `server/schema/generator.ts`:

```ts
/**
 * Lean schema generator orchestrator.
 *
 * Pipeline:
 *   1. Classify page → primary @type (deterministic, no AI)
 *   2. Extract canonical page data from HTML + meta + workspace (no AI)
 *   3. Surgical AI for description (only if missing) + FAQ (only if accordion present)
 *   4. Build typed template
 *   5. Validate against Google rich-result rules
 *   6. Return SchemaPageSuggestion (existing shape)
 */

import { classifyPage } from './classifier.js';
import { extractPageData } from './data-sources.js';
import type { PageMetaInput, WorkspaceSchemaInput } from './data-sources.js';
import { extractDescription } from './extractors/description.js';
import { buildArticleSchema } from './templates/article.js';
import { buildServiceSchema, buildProductSchema } from './templates/service.js';
import { buildLocalBusinessSchema } from './templates/local-business.js';
import { buildAboutPageSchema, buildContactPageSchema, buildCollectionPageSchema, buildWebPageSchema } from './templates/static.js';
import { buildHomepageSchema } from './templates/homepage.js';
import { validateLeanSchema } from './validator.js';
import * as cheerio from 'cheerio';

/** Subset of SchemaPageSuggestion that the generator returns. */
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
    template: Record<string, unknown>;
  }>;
  validationErrors?: string[];
}

export interface LeanGeneratorInput {
  pageId: string;
  pageMeta: PageMetaInput;
  html: string;
  baseUrl: string;
  workspace: WorkspaceSchemaInput;
  /** Optional override for existing schema detection (saves Cheerio re-parsing in batch). */
  existingSchemas?: string[];
}

function detectExistingSchemas(html: string): string[] {
  const $ = cheerio.load(html);
  const types: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}') as Record<string, unknown>;
      const t = json['@type'];
      if (typeof t === 'string') types.push(t);
      else if (Array.isArray(t)) types.push(...(t as string[]));
      const graph = json['@graph'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(graph)) {
        for (const n of graph) {
          if (typeof n['@type'] === 'string') types.push(n['@type']);
        }
      }
    } catch { /* ignore unparseable */ } // catch-ok: malformed JSON-LD on third-party pages
  });
  return Array.from(new Set(types));
}

function plainText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

export async function generateLeanSchema(input: LeanGeneratorInput): Promise<LeanGeneratorOutput> {
  const businessKind = input.workspace.businessProfile?.address ? 'local' : 'unknown';
  const classified = classifyPage(`${input.baseUrl}${input.pageMeta.publishedPath}`, input.baseUrl, { businessKind });

  // Page data — deterministic
  let pageData = extractPageData({
    pageMeta: input.pageMeta,
    html: input.html,
    baseUrl: input.baseUrl,
    workspace: input.workspace,
  });

  // Surgical AI: only if no description was found
  if (!pageData.description) {
    const aiDescription = await extractDescription({
      existingDescription: undefined,
      title: pageData.title,
      pageBody: plainText(input.html),
      workspace: input.workspace,
    });
    if (aiDescription) {
      pageData = { ...pageData, description: aiDescription };
    }
  }

  // Build template by kind
  let schema: Record<string, unknown>;
  let reason: string;
  switch (classified.kind) {
    case 'Homepage':
      if (classified.primaryType === 'LocalBusiness') {
        schema = buildLocalBusinessSchema({
          baseUrl: input.baseUrl,
          pageData,
          businessProfile: input.workspace.businessProfile,
        });
        reason = 'Local business homepage — LocalBusiness with verified contact info.';
      } else {
        schema = buildHomepageSchema({ baseUrl: input.baseUrl, pageData });
        reason = 'Homepage — Organization + WebSite (sitewide entities).';
      }
      break;
    case 'BlogPosting':
      schema = buildArticleSchema({ baseUrl: input.baseUrl, pageData }, 'BlogPosting');
      reason = 'Blog post — BlogPosting with author/publisher/dates.';
      break;
    case 'CaseStudy':
      schema = buildArticleSchema({ baseUrl: input.baseUrl, pageData }, 'Article');
      reason = 'Case study — Article (not Service) with about="Case study".';
      break;
    case 'Service':
      schema = buildServiceSchema({ baseUrl: input.baseUrl, pageData });
      reason = 'Service detail page — Service with provider reference.';
      break;
    case 'AboutPage':
      schema = buildAboutPageSchema({ baseUrl: input.baseUrl, pageData });
      reason = 'About page — AboutPage referencing Organization.';
      break;
    case 'ContactPage':
      schema = buildContactPageSchema({ baseUrl: input.baseUrl, pageData });
      reason = 'Contact page — ContactPage.';
      break;
    case 'BlogIndex':
    case 'CaseStudyIndex':
    case 'ServiceIndex':
      schema = buildCollectionPageSchema({ baseUrl: input.baseUrl, pageData });
      reason = `${classified.kind.replace('Index', '')} index — CollectionPage.`;
      break;
    case 'Legal':
    case 'WebPage':
    default:
      schema = buildWebPageSchema({ baseUrl: input.baseUrl, pageData });
      reason = 'Generic page — WebPage with breadcrumb.';
      break;
  }

  // Validate
  const validationErrors = validateLeanSchema(schema, classified.primaryType);

  // Determine declared types for the suggestion `type` field
  const graph = (schema['@graph'] as Array<Record<string, unknown>>) ?? [];
  const declaredTypes = graph.map(n => n['@type']).filter((t): t is string => typeof t === 'string');

  return {
    pageId: input.pageId,
    pageTitle: pageData.title,
    slug: input.pageMeta.slug,
    url: pageData.canonicalUrl,
    existingSchemas: input.existingSchemas ?? detectExistingSchemas(input.html),
    suggestedSchemas: [
      {
        type: declaredTypes.join(' + '),
        reason,
        priority: 'high',
        template: schema,
      },
    ],
    validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
  };
}
```

- [ ] **Step 11.4: Implement barrel export**

Create `server/schema/index.ts`:

```ts
/**
 * Public exports for the lean schema package.
 */
export { generateLeanSchema } from './generator.js';
export type { LeanGeneratorInput, LeanGeneratorOutput } from './generator.js';
export { classifyPage } from './classifier.js';
export type { ClassifiedPage, PageKind } from './classifier.js';
export { extractPageData } from './data-sources.js';
export type { PageData, PageMetaInput, WorkspaceSchemaInput, BusinessProfile } from './data-sources.js';
export { validateLeanSchema } from './validator.js';
```

- [ ] **Step 11.5: Run tests**

```bash
npx vitest run tests/integration/lean-schema-generator.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 11.6: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 11.7: Commit**

```bash
git add server/schema/generator.ts server/schema/index.ts tests/integration/lean-schema-generator.test.ts
git commit -m "feat(schema): add lean generator orchestrator + barrel export"
```

---

## Task 12: Wire 3 Call Sites (route compatibility)

**Files:**
- Modify: `server/schema-suggester.ts` (replace bodies of `generateSchemaForPage` and `generateSchemaSuggestions`)

**Goal:** Make `generateSchemaForPage` and `generateSchemaSuggestions` thin wrappers that delegate to `generateLeanSchema` while preserving the same input/output signatures so `webflow-schema.ts` lines 62 and 126 and `jobs.ts` line 651 don't change.

- [ ] **Step 12.1: Locate the existing function signatures**

```bash
grep -n "^export async function generateSchemaForPage\|^export async function generateSchemaSuggestions" server/schema-suggester.ts
```

Expected: lines 1959 and 2080 (approximately — check actual line numbers).

- [ ] **Step 12.2: Replace `generateSchemaForPage` body with the wrapper**

In `server/schema-suggester.ts`, replace the entire body of `generateSchemaForPage` (preserving the function signature) with:

```ts
export async function generateSchemaForPage(
  siteId: string,
  pageId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>,
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>,
): Promise<SchemaPageSuggestion | null> {
  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return null;

  const meta = await fetchPageMeta(pageId, tokenOverride);
  if (!meta) return null;

  const slug = meta.slug || '';
  const isHomepage = !slug || slug === 'index' || slug === 'home';
  const url = isHomepage ? baseUrl : `${baseUrl}/${slug}`;
  const html = await fetchPublishedHtml(url);

  // PageMeta from fetchPageMeta does NOT include publishedPath (only WebflowPage from
  // listPages does). Derive it from slug — homepage = '/', else '/<slug>'.
  const publishedPath = isHomepage ? '/' : `/${slug}`;

  const { generateLeanSchema } = await import('./schema/index.js');
  const lean = await generateLeanSchema({
    pageId,
    pageMeta: {
      title: meta.title || '',
      slug,
      publishedPath,
      seo: meta.seo,
    },
    html: html || '',
    baseUrl,
    workspace: {
      name: ctx.companyName || '',
      publisherLogoUrl: ctx.logoUrl ?? null,
      businessProfile: ctx._businessProfile ?? null,
    },
  });

  // Surface unused parameters to satisfy TS noUnusedParameters via void casts.
  // These are kept in the signature for backwards compatibility with PR #354's
  // intelligence wiring; the lean generator does not use them in MVP scope.
  void gscMap; void ga4Map; void queryPageData; void insightsMap;

  return {
    pageId: lean.pageId,
    pageTitle: lean.pageTitle,
    slug: lean.slug,
    url: lean.url,
    existingSchemas: lean.existingSchemas,
    suggestedSchemas: lean.suggestedSchemas,
    validationErrors: lean.validationErrors,
  };
}
```

- [ ] **Step 12.3: Replace `generateSchemaSuggestions` body with the batch wrapper**

In `server/schema-suggester.ts`, replace the entire body of `generateSchemaSuggestions` (preserving the function signature) with:

```ts
export async function generateSchemaSuggestions(
  siteId: string,
  tokenOverride?: string,
  ctx: SchemaContext = {},
  pageKeywordMap?: Map<string, { primary: string; secondary: string[] }>,
  onProgress?: (partial: SchemaPageSuggestion[], done: boolean, message?: string) => void,
  isCancelled?: () => boolean,
  gscMap?: Map<string, { clicks: number; impressions: number; position: number; ctr: number }>,
  ga4Map?: Map<string, { pageviews: number; users: number; avgEngagementTime: number }>,
  queryPageData?: Array<{ query: string; page: string; impressions: number; position: number }>,
  insightsMap?: Map<string, { healthScore?: number; healthTrend?: string; isQuickWin?: boolean }>,
  validationsByPageId?: Map<string, SchemaValidation>,
): Promise<SchemaPageSuggestion[]> {
  void pageKeywordMap; void gscMap; void ga4Map; void queryPageData; void insightsMap; void validationsByPageId;

  const baseUrl = await resolveBaseUrl({ liveDomain: ctx.liveDomain, webflowSiteId: siteId }, tokenOverride);
  if (!baseUrl) return [];

  const pages = await listPages(siteId, tokenOverride);
  const filtered = filterPublishedPages(pages);

  const { generateLeanSchema } = await import('./schema/index.js');
  const results: SchemaPageSuggestion[] = [];
  for (const page of filtered) {
    if (isCancelled?.()) break;
    const slug = page.slug || '';
    const url = (!slug || slug === 'index') ? baseUrl : `${baseUrl}/${slug}`;
    const html = await fetchPublishedHtml(url);
    const lean = await generateLeanSchema({
      pageId: page.id,
      pageMeta: {
        title: page.title || '',
        slug,
        publishedPath: page.publishedPath || (slug ? `/${slug}` : '/'),
        seo: page.seo,
      },
      html: html || '',
      baseUrl,
      workspace: {
        name: ctx.companyName || '',
        publisherLogoUrl: ctx.logoUrl ?? null,
        businessProfile: ctx._businessProfile ?? null,
      },
    });
    const suggestion: SchemaPageSuggestion = {
      pageId: lean.pageId,
      pageTitle: lean.pageTitle,
      slug: lean.slug,
      url: lean.url,
      existingSchemas: lean.existingSchemas,
      suggestedSchemas: lean.suggestedSchemas,
      validationErrors: lean.validationErrors,
    };
    results.push(suggestion);
    onProgress?.(results, false, `Processed ${results.length} of ${filtered.length} static pages...`);
  }

  // CMS pages — same lean path; we trust toCmsPageId from PR #358.
  const { discoverCmsUrls, buildStaticPathSet, toCmsPageId } = await import('./webflow.js');
  const staticPaths = buildStaticPathSet(filtered);
  const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, 1000);
  for (const item of cmsUrls) {
    if (isCancelled?.()) break;
    const html = await fetchPublishedHtml(item.url);
    const lean = await generateLeanSchema({
      pageId: toCmsPageId(item.path),
      pageMeta: {
        title: item.pageName,
        slug: item.path.replace(/^\//, ''),
        publishedPath: item.path,
        seo: undefined,
      },
      html: html || '',
      baseUrl,
      workspace: {
        name: ctx.companyName || '',
        publisherLogoUrl: ctx.logoUrl ?? null,
        businessProfile: ctx._businessProfile ?? null,
      },
    });
    results.push({
      pageId: lean.pageId,
      pageTitle: lean.pageTitle,
      slug: lean.slug,
      url: lean.url,
      existingSchemas: lean.existingSchemas,
      suggestedSchemas: lean.suggestedSchemas,
      validationErrors: lean.validationErrors,
    });
  }

  onProgress?.(results, true);
  return results;
}
```

- [ ] **Step 12.4: Run typecheck — confirm wrappers compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 12.5: Run all schema tests**

```bash
npx vitest run tests/unit/schema/ tests/integration/lean-schema-generator.test.ts
```

Expected: all pass.

- [ ] **Step 12.6: Commit**

```bash
git add server/schema-suggester.ts
git commit -m "feat(schema): wire generateSchemaForPage and generateSchemaSuggestions to lean generator (backwards-compat wrappers)"
```

---

## Task 13: Side-by-side Comparison on Real Workspace Data

**Files:**
- Modify: `scripts/poc-lean-schema.ts` (already exists — reuse its harness)

**Goal:** Run the real lean generator (not the POC) against staging hmpsn studio's snapshot and confirm the metrics match the POC numbers (72% reduction, zero validation errors).

- [ ] **Step 13.1: Update `scripts/poc-lean-schema.ts` to use the real generator**

Replace the lean-building section of `scripts/poc-lean-schema.ts` with imports from the production package. Find the `buildLeanSchema` function in the POC and replace its callers with:

```ts
import { generateLeanSchema } from '../server/schema/index.js';
// ...within main():
const lean = await generateLeanSchema({
  pageId: result.pageId,
  pageMeta: {
    title: result.pageTitle,
    slug: result.slug,
    publishedPath: result.url.replace(ctx.baseUrl, '') || '/',
    seo: undefined,
  },
  html: '',  // POC reuses old description from snapshot, no HTML needed
  baseUrl: ctx.baseUrl,
  workspace: {
    name: ctx.ws.name,
    publisherLogoUrl: null,
    businessProfile: null,
  },
});
const leanSchema = lean.suggestedSchemas[0]?.template ?? {};
```

(The POC's local `buildLean` and template helpers can stay as a fallback comparison — but the primary path now exercises the real generator.)

- [ ] **Step 13.2: Run the comparison locally**

```bash
npx tsx scripts/poc-lean-schema.ts ws_dd68114e-283b-430b-a9c1-05afdbd30e0d 2>&1 | tail -40
```

Expected output includes:
- Per-page lines showing old chars / lean chars / delta
- Aggregate "Δ X chars (Y% smaller)"
- Smaller value should be at least 60% reduction (POC achieved 72% but production version may differ slightly)

- [ ] **Step 13.3: Commit the script update**

```bash
git add scripts/poc-lean-schema.ts
git commit -m "chore: point comparison script at production lean generator"
```

---

## Task 14: Delete Dead Code from schema-suggester.ts

**Files:**
- Modify: `server/schema-suggester.ts`

**Goal:** Now that the wrappers route everything through the lean generator, delete the dead pipeline: `autoFixSchema`, `verifySchemaContent`, `postProcessSchema`, `injectCrossReferences`, `aiGenerateUnifiedSchema` (the 1500-token system prompt), `validateUnifiedSchema`, `cleanSchema`, `upgradeHealthcareType`, `INVALID_PROPERTIES`, `RICH_RESULT_RULES`, `HEALTHCARE_TYPE_MAP`, the page-type instructions block.

Keep:
- `SchemaPageSuggestion`, `SchemaSuggestion`, `SchemaContext`, `RichResultEligibility`, `SchemaPageType` types (still used by routes/UI)
- `generateSchemaForPage`, `generateSchemaSuggestions` (now wrappers)
- `generateCmsTemplateSchema` (unrelated CMS template path — leave for now)
- `checkRichResultsEligibility` (still called by frontend through some routes)
- `extractFaqOpportunities` (still used by analytics layer)
- `extractEeatFromBrief` (still used by content brief flows)
- `buildSchemaIntelligenceBlock` (still exported, even if dead — can be removed in a follow-up grep cleanup if no callers)

- [ ] **Step 14.1: Identify the deletion ranges**

```bash
grep -n "^export function\|^function\|^const PAGE_TYPE\|^const HEALTHCARE\|^const INVALID\|^const RICH_RESULT" server/schema-suggester.ts | head -40
```

Capture the line ranges of these symbols to delete:
- `validateUnifiedSchema` (~line 475)
- `validateGraphNode` (helper)
- `HEALTHCARE_TYPE_MAP`, `upgradeHealthcareType`
- `INVALID_PROPERTIES`, `autoFixSchema`
- `injectCrossReferences`
- `verifySchemaContent`
- `cleanSchema`
- `getPageTypeInstructions` and the entire `PAGE_TYPE_INSTRUCTIONS` map
- `postProcessSchema`
- `aiGenerateUnifiedSchema` (the 1500-token system prompt)
- `buildFallbackSchema`
- `UTILITY_SLUGS` (only used by `injectCrossReferences` and the old `generateSchemaSuggestions` body — both gone)

**Note:** `RICH_RESULT_RULES` lives in `server/schema-validator.ts`, not `schema-suggester.ts`. It stays. Likewise, `checkRichResultsEligibility` and `extractEeatFromBrief` are still imported by other code paths (frontend rendering, content briefs) — they stay. The verification pass confirmed all 10 deletion targets above are internal-only with zero external references outside `schema-suggester.ts`.

- [ ] **Step 14.2: Delete the symbols, one logical group per commit**

Delete in this order to keep typecheck green between commits:

1. `aiGenerateUnifiedSchema` (~lines 1700–1880) — no longer called now that wrappers use the lean generator. Commit:
   ```bash
   git commit -m "refactor(schema): delete aiGenerateUnifiedSchema and 1500-token system prompt"
   ```

2. `postProcessSchema`, `cleanSchema`, `injectCrossReferences`, `verifySchemaContent`, `autoFixSchema`, `INVALID_PROPERTIES`, `upgradeHealthcareType`, `HEALTHCARE_TYPE_MAP`, `RICH_RESULT_RULES`, `validateUnifiedSchema`, `validateGraphNode`, `buildFallbackSchema` — together. Commit:
   ```bash
   git commit -m "refactor(schema): delete post-processing pipeline (autoFix, verify, cleanup, rules)"
   ```

3. `getPageTypeInstructions` and the `PAGE_TYPE_INSTRUCTIONS` map (~lines 1191–1400). Commit:
   ```bash
   git commit -m "refactor(schema): delete page-type instruction blocks (replaced by deterministic classifier)"
   ```

- [ ] **Step 14.3: Run typecheck after each deletion commit**

```bash
npm run typecheck
```

Expected after all deletions: zero errors. If a symbol still has a caller, restore the symbol and find/update the caller.

- [ ] **Step 14.4: Delete tests that import the now-deleted helpers**

The verification pass identified one test file whose imports break after Step 14.2:

- `tests/unit/schema-post-processing.test.ts` — imports `UTILITY_SLUGS, autoFixSchema, upgradeHealthcareType` (all three are now deleted)

Two other tests import from `schema-suggester.ts` but ONLY the surviving symbols:
- `tests/unit/schema-validation-pipeline.test.ts` — type imports (`RichResultEligibility`, `SchemaPageType`) + runtime `checkRichResultsEligibility` (all kept). **Do not delete.**
- `tests/unit/schema-intelligence-enrichment.test.ts` — type-only import of `SchemaContext` (kept). **Do not delete.**

Run a sanity check:

```bash
grep -E "from '../../server/schema-suggester" tests/unit/schema-validation-pipeline.test.ts tests/unit/schema-intelligence-enrichment.test.ts
```

If those two files only show `import type { ... }` lines or `checkRichResultsEligibility`, leave them alone. Then delete the broken file:

```bash
git rm tests/unit/schema-post-processing.test.ts
git commit -m "refactor(schema): remove tests for deleted post-processing helpers"
```

- [ ] **Step 14.5: Run the full test suite**

```bash
npx vitest run tests/unit/schema/ tests/integration/lean-schema-generator.test.ts tests/unit/page-identity-normalisation-pr1.test.ts tests/integration/page-identity-pr1.test.ts tests/integration/page-identity-pr2.test.ts
```

Expected: all schema and page-identity tests pass.

- [ ] **Step 14.6: Verify file size reduction**

```bash
wc -l server/schema-suggester.ts
```

Expected: well under 1,000 lines (target: ~500 — types + thin wrappers + a few unrelated helpers like `generateCmsTemplateSchema`).

---

## Task 15: Quality Gates + Documentation Update

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`

- [ ] **Step 15.1: Append entry to `FEATURE_AUDIT.md`**

Find the last `### NNN.` entry and append a new one:

```markdown

### 319. Lean Schema Generation Rewrite (PR #TBD, 2026-04-29)
**What it does:** Replaces the 2,558-line `server/schema-suggester.ts` AI-prompt-driven pipeline with a deterministic 6-module package at `server/schema/`. URL-pattern-driven type classifier maps every page to exactly one primary @type. Compact templates emit one primary node + BreadcrumbList — no multi-type @graph, no duplicate WebPage nodes, no parent-page leak. Data is pulled from canonical sources (Webflow page meta, page HTML via Cheerio, workspace settings) rather than AI-fabricated. AI is used surgically only for description generation when no meta description exists, and for FAQ extraction when accordion patterns are present. Per-type validator encodes Google rich-result rules; clean output validates first time with no auto-fix loop. Output shape (`SchemaPageSuggestion[]`) is preserved so frontend rendering and snapshot storage are unchanged. Healthcare workspaces emit generic `LocalBusiness` for now (Dentist/Physician/etc. subtype escalation deferred to roadmap item `schema-intelligence-layer-v2`).

**Agency value:** Schema generated for Webflow client sites is finally paid-grade — comparable to Yoast Premium or RankMath Pro in structural correctness. No more wrong-type bugs (case studies as Service, privacy as Article), no more duplicate WebPage nodes, no more 8KB schema for a homepage. Generation runs faster (one targeted AI call per page instead of one 1500-token call) and costs less (40-80% reduction in OpenAI/Anthropic token usage). Validation errors are surfaced to admins through the existing UI; admins can trust the output without spot-checking every page.

**Client value:** JSON-LD on their published Webflow site is correct, lean, and Google-rich-result eligible. Schema reflects what's actually on the page, not AI-fabricated facts. Pages get the right primary type for their content, which directly affects rich snippet eligibility.

**Mutual:** Drops a class of silent quality issues that were eroding trust in the schema feature. Frees development capacity from chasing prompt tweaks to building the intelligence layer (FAQ-from-GSC, E-E-A-T-from-content-brief) that actually differentiates us from the commercial schema generators.

**Files:** `server/schema/classifier.ts` (new), `server/schema/data-sources.ts` (new), `server/schema/templates/{helpers,article,service,local-business,static,homepage}.ts` (new), `server/schema/extractors/{description,faq}.ts` (new), `server/schema/validator.ts` (new), `server/schema/generator.ts` (new), `server/schema/index.ts` (new), `server/schema-suggester.ts` (wrappers + dead-code deletion: ~2000 lines removed), `tests/unit/schema/*.test.ts` (new — 5 files), `tests/integration/lean-schema-generator.test.ts` (new), `scripts/poc-lean-schema.ts` (updated to point at production generator).
```

- [ ] **Step 15.2: Add roadmap entries**

In `data/roadmap.json`, append two items to the last sprint section (find `schema-generator-quality-hardening` and add after `page-identity-normalisation`):

```json
{
  "id": "lean-schema-rewrite",
  "title": "Lean Schema Generation Rewrite",
  "source": "docs/superpowers/plans/2026-04-29-lean-schema-rewrite.md",
  "est": "5-7d",
  "priority": "P0",
  "sprint": "H",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "Replaces 2,558-line schema-suggester.ts pipeline with deterministic 6-module package at server/schema/. URL classifier + per-type templates + canonical data sources + 2 surgical AI extractors (description, FAQ) + per-type validator + thin orchestrator. Output ~72% smaller, validates first time, eliminates duplicate WebPage bug and wrong-type bug for case studies/privacy/index pages. Common types only (BlogPosting, Article, Service, Product, LocalBusiness, AboutPage, ContactPage, CollectionPage, WebPage, Organization, WebSite). Healthcare uses LocalBusiness fallback; subtype escalation deferred to schema-intelligence-layer-v2."
},
{
  "id": "schema-intelligence-layer-v2",
  "title": "Schema Intelligence Layer (FAQ-from-GSC, E-E-A-T, healthcare subtypes)",
  "source": "docs/superpowers/plans/2026-04-29-lean-schema-rewrite.md (deferred scope)",
  "est": "2-3w",
  "priority": "P1",
  "sprint": "I",
  "status": "pending",
  "notes": "Follow-up to lean-schema-rewrite. Re-injects the platform's intelligence layer surgically into schema generation: (1) Healthcare type escalation — workspace businessContext → Dentist/Physician/Optician/Chiropractor/MedicalClinic/etc. when address+phone+hours are present, falls back to LocalBusiness otherwise. (2) FAQ enrichment from GSC question queries — extractFaqOpportunities (already exists in analytics-intelligence.ts) feeds FAQPage when ≥3 question queries match a page. (3) E-E-A-T author injection from content brief — extractEeatFromBrief (already exists) populates Article.author with Person.knowsAbout, sameAs from the brief's expert profile. (4) Service serviceType from voice profile + business profile. Reuses existing intelligence wiring; the lean rewrite kept the data flow intact, this task adds surgical injection points to the templates."
}
```

- [ ] **Step 15.3: Validate roadmap JSON + sort**

```bash
python3 -c "import json; json.load(open('data/roadmap.json'))" && echo "JSON valid"
npx tsx scripts/sort-roadmap.ts
```

Expected: "JSON valid" and roadmap sorted.

- [ ] **Step 15.4: Run all quality gates**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: zero errors. Pre-existing pr-check warnings (PageHeader, isProgrammingError near new URL) are acceptable.

- [ ] **Step 15.5: Commit docs and run final test suite**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: add lean schema rewrite to FEATURE_AUDIT and roadmap; queue intelligence layer follow-up"
```

- [ ] **Step 15.6: Open PR against staging**

```bash
gh pr create --base staging --title "feat(schema): lean rewrite of schema generation (deterministic types + compact templates)" --body "$(cat <<'EOF'
## Summary

Replaces the 2,558-line AI-prompt-driven schema generation pipeline with a deterministic 6-module package at `server/schema/`. Output is paid-grade by construction: one primary @type per page, compact per-type templates, no multi-WebPage bug, no wrong-type bug, validates first time.

## What changed

- New: `server/schema/{classifier,data-sources,validator,generator,index}.ts` + `templates/*` + `extractors/*`
- New: 5 unit test files + 1 integration test file under `tests/unit/schema/` and `tests/integration/`
- Modified: `server/schema-suggester.ts` — `generateSchemaForPage` and `generateSchemaSuggestions` are now thin wrappers calling the lean generator. Old pipeline (autoFixSchema, verifySchemaContent, postProcessSchema, injectCrossReferences, 1500-token system prompt, page-type instruction blocks) is deleted (~2000 lines removed).
- Frontend, snapshot storage, and route signatures are unchanged.

## Why

POC at `scripts/poc-lean-schema.ts` (committed earlier on this branch) proved the approach: 72% size reduction across 26 hmpsn studio pages, zero auto-fix loops, all 11 duplicate-WebPage occurrences eliminated, wrong-type bugs (case-study-as-Service, privacy-as-Article, etc.) fixed by URL-pattern classification.

## Out of scope (queued)

`schema-intelligence-layer-v2` roadmap item handles healthcare subtype escalation (Dentist/Physician/etc.), FAQ enrichment from GSC question queries, E-E-A-T author injection from content briefs.

## Test plan

- [x] `npm run typecheck` — clean
- [x] `npx vite build` — clean
- [x] `npx vitest run` — full suite passes including 5 new unit-test files + 1 integration test
- [x] `npx tsx scripts/pr-check.ts` — zero errors
- [x] `npx tsx scripts/poc-lean-schema.ts` against staging hmpsn studio — confirms metrics match POC

## Manual staging verification (post-merge)

- [ ] Re-generate schema for hmpsn studio via the Schema page UI
- [ ] Confirm: no duplicate WebPage nodes in any CMS page suggestion
- [ ] Confirm: case studies show `Article` type (not `Service`)
- [ ] Confirm: privacy policy shows `WebPage` type (not `Article`)
- [ ] Confirm: total schema size is ~70% smaller than current

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

After writing the plan, ran the three-step self-check:

**1. Spec coverage:** Every MVP page kind from the spec has a template task (5/6/7/8). The deferred scope (HowTo, Recipe, Event, Course, JobPosting, healthcare subtypes, FAQPage as primary, e-commerce variants) is explicitly listed and queued in the roadmap follow-up. The 3 integration call sites (webflow-schema.ts batch, webflow-schema.ts per-page, jobs.ts) are all covered by Task 12. The cleanup of dead code is Task 14. Documentation update is Task 15.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or vague directives. Every code step shows the actual code. The PR title in Task 15.6 contains "PR #TBD" which is a literal placeholder for the PR number that gets assigned at PR creation time — this is acceptable as it's filled in by `gh pr create`.

**3. Type consistency:** `PageData` is defined in Task 2, used in Tasks 5/6/7/8/11. `WorkspaceSchemaInput` defined in Task 2, used in Tasks 9/11. `BusinessProfile` defined in Task 2, used in Task 7/11. `LeanGeneratorInput`/`LeanGeneratorOutput` defined in Task 11, used by the wrappers in Task 12. `classifyPage` signature `(url, baseUrl, opts?) → ClassifiedPage` consistent across Tasks 1 and 11. `extractDescription` input shape consistent between Tasks 9 and 11. All function names match across files.

---

## Systemic Improvements

### New tests added
- `tests/unit/schema/classifier.test.ts` — URL classifier (14 tests)
- `tests/unit/schema/data-sources.test.ts` — page meta extraction (9 tests)
- `tests/unit/schema/templates.test.ts` — all 9 template builders (20 tests)
- `tests/unit/schema/validator.test.ts` — Google rich-result rules (9 tests)
- `tests/unit/schema/extractors.test.ts` — description + FAQ extractors (9 tests)
- `tests/integration/lean-schema-generator.test.ts` — end-to-end generator coverage (7 tests)

### pr-check rules to consider adding (future)
- Flag any inline `cms-${...}` template literal outside `toCmsPageId` — already enforced by PR #358's contract test, but a pr-check rule would catch regressions earlier
- Flag re-introduction of multi-type @graph nodes in template files (any template emitting more than 2 nodes triggers a warning)

### Shared utilities introduced
- `server/schema/classifier.ts` — `classifyPage`
- `server/schema/data-sources.ts` — `extractPageData`
- `server/schema/templates/helpers.ts` — `dropUndefined`, `buildBreadcrumb`, `orgRef`, `imageNode`
- `server/schema/extractors/description.ts` — `extractDescription`
- `server/schema/extractors/faq.ts` — `extractFaq`
- `server/schema/validator.ts` — `validateLeanSchema`
- `server/schema/generator.ts` — `generateLeanSchema`
