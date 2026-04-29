# Schema Pillar 1 — Raise the Validator Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `validateLeanSchema` enforce **Google Rich Results eligibility**, not just "field is present." After Pillar 2 fills the data, this plan tightens `REQUIRED_BY_TYPE` per type AND adds shape validators so any future regression that drops a cross-ref, malforms `Article.author`/`publisher`, breaks date format, or shuffles breadcrumb positions surfaces as a build-time error rather than a silent rich-result-eligibility loss.

**Architecture:** Single-file change, no new modules. Extend `REQUIRED_BY_TYPE` in `server/schema/validator.ts` for required fields and add two layers of `custom` validators:
1. **Cross-reference validators** — `isPartOf` must be a `{@id}` ref; `breadcrumb` must reference a `BreadcrumbList` present in the same `@graph`; `mainEntityOfPage` must be a string URL or `{@id}` ref.
2. **Shape validators** — `Article.author` must have `@type ∈ {Person,Organization}` AND non-empty `name`; `Article.publisher` must have `@type` AND `name` AND `logo` (with `@type: ImageObject` and non-empty `url`); `Article.image` must be string|array|ImageObject; `datePublished`/`dateModified` must match ISO 8601; `BreadcrumbList.itemListElement` positions must start at 1 and be contiguous-ascending; every `url`-shaped field on a primary node must be absolute (start with `http`).

Update `tests/unit/schema/validator.test.ts` to assert all stricter rules. The generator and templates already emit shape-correct fields after Pillar 2 + Pillar 2.1 ship; this plan locks the bar.

**Tech Stack:** TypeScript strict, vitest. No new dependencies.

**MVP scope:** Tighten `REQUIRED_BY_TYPE` for the 8 lean templates, add 3 cross-reference validators + 6 shape validators, update tests. Validator still returns `string[]` of human-readable errors so the UI surface (`Validated 28/28`) keeps working.

**Out of scope:**
- Type-level enforcement (Pillar 3 — `schema-dts`).
- `schemarama` shape validation (Pillar 3).
- pr-check static rule for "every template emits cross-refs" (Pillar 3).
- Cross-page `@id` consistency (e.g. asserting that `/#organization` is identical across every page in a workspace) — would require comparing schemas across the snapshot, not within a single document.
- Field-completeness for `Service.areaServed` / `Organization.knowsAbout` / `Article.keywords` etc. — those are template-emission additions tracked under `schema-yoast-parity-fields` (next P0 after this PR). When parity-fields ships, this validator's required-set will be tightened again to mark those fields required.

---

## Pre-requisites

- [ ] **Pillars 2 + 2.1 must both be merged to staging first.** Pillar 2 fills the data the validator will require; Pillar 2.1 (PR #366) drops the `potentialAction` emission this plan once required (now omitted from the WebSite required set — see Task 2). Confirm `schema-pillar-2-data-wiring` and `schema-pillar-2-1-searchaction-correctness` are both `status: done` in `data/roadmap.json` before opening the Pillar 1 branch.
- [ ] Branch from latest staging: `git checkout staging && git pull && git checkout -b claude/schema-pillar-1`

---

## Task Dependencies

```
Sequential (single-file plan, single PR):
  Task 1 (Failing tests for stricter required-field rules)
  → Task 2 (Update REQUIRED_BY_TYPE per-type)
  → Task 3 (Add cross-reference shape validators: isPartOf, breadcrumb, mainEntityOfPage)
  → Task 4 (Add value-shape validators: Article author/publisher/image, ISO 8601 dates, breadcrumb ordering, absolute URLs)
  → Task 5 (Update existing template tests for new error counts)
  → Task 6 (Run integration tests; fix any template gaps)
  → Task 7 (Quality gates + docs)
```

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 Failing tests | sonnet | Test naming + fixture choices need judgment |
| 2 Update REQUIRED_BY_TYPE | sonnet | Per-type required-field decisions reference Yoast/Google docs |
| 3 Cross-ref shape validators | sonnet | `custom` validator functions with @graph traversal |
| 4 Value-shape validators | sonnet | Date regex + nested-object checks + array shape; needs judgment for edge cases |
| 5 Update existing tests | sonnet | Several `validationErrors).toEqual([])` assertions need updating |
| 6 Run integration; fix gaps | sonnet | Diagnostic — may surface a missed Pillar 2 field |
| 7 Quality gates + docs | haiku | Doc transcription |

Reviewers: spec-compliance reviewer = opus, code-quality reviewer = opus.

---

## File Map

### Modified files

| Path | Modification |
|---|---|
| `server/schema/validator.ts` | Tasks 2 + 3 + 4: extend `REQUIRED_BY_TYPE` per type; add `validateCrossRefs` for `isPartOf`/`breadcrumb`/`mainEntityOfPage`; add `validateArticleAuthor`, `validateArticlePublisher`, `validateImageField`, `validateISO8601Date`, `validateBreadcrumbOrdering`, `validateAbsoluteUrls`; refactor `validateLeanSchema` to invoke all of them per node. |
| `tests/unit/schema/validator.test.ts` | Tasks 1 + 5: extend with strict-rule assertions (required-fields, cross-ref shapes, value-shape rules) and update existing assertions where the old loose rules expected `[]` but now produce specific error strings. |
| `tests/unit/schema/templates.test.ts` | Task 5: where templates pass into the validator, fixtures may need new fields to keep `validateLeanSchema(...)).toEqual([])` assertions green. Pillar 2 fixtures already include `cleanTitle` + `inLanguage`; this task verifies and patches if needed. |
| `tests/integration/lean-schema-generator.test.ts` | Task 6: assert `validationErrors === undefined` for clean inputs; update the FAQ-on-BlogPosting test fixture if it now produces additional warnings. |
| `FEATURE_AUDIT.md` | Task 7: append Pillar 1 paragraph to entry #319. |
| `data/roadmap.json` | Task 7: mark `schema-pillar-1-validator-bar` as `done`. |

### Files left untouched

- `server/schema/templates/*.ts` — should already emit everything Pillar 1 requires after Pillar 2. Touch only if Task 5 surfaces a gap.
- `server/schema/data-sources.ts`, `server/schema/generator.ts`, `server/schema/extractors/*.ts` — no changes.

---

## Tasks

### Task 1: Failing tests for stricter rules (sonnet)

**Owns:** `tests/unit/schema/validator.test.ts`
**Must not touch:** `server/schema/validator.ts` (yet).

- [ ] **Step 1: Append a new describe block to `tests/unit/schema/validator.test.ts`.**

```typescript
describe('validateLeanSchema — Yoast-baseline required fields (Pillar 1)', () => {
  const cleanWebPage = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': 'https://x.com/p#webpage',
        'name': 'P',
        'url': 'https://x.com/p',
        'description': 'D',
        'isPartOf': { '@id': 'https://x.com/#website' },
        'breadcrumb': { '@id': 'https://x.com/p#breadcrumb' },
        'inLanguage': 'en',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://x.com/p#breadcrumb',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x.com' },
          { '@type': 'ListItem', 'position': 2, 'name': 'P', 'item': 'https://x.com/p' },
        ],
      },
    ],
  };

  it('passes a fully-populated WebPage', () => {
    expect(validateLeanSchema(cleanWebPage, 'WebPage')).toEqual([]);
  });

  it('flags WebPage missing isPartOf', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].isPartOf;
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage missing required field: isPartOf');
  });

  it('flags WebPage missing breadcrumb back-reference', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].breadcrumb;
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage missing required field: breadcrumb');
  });

  it('flags WebPage missing inLanguage', () => {
    const broken = JSON.parse(JSON.stringify(cleanWebPage));
    delete broken['@graph'][0].inLanguage;
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage missing required field: inLanguage');
  });

  it('flags Article missing image', () => {
    const article = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Article',
        '@id': 'https://x.com/a#article',
        'headline': 'H',
        'datePublished': '2026-01-01T00:00:00Z',
        'dateModified': '2026-01-02T00:00:00Z',
        'author': { '@type': 'Organization', 'name': 'X' },
        'publisher': { '@type': 'Organization', 'name': 'X' },
        'mainEntityOfPage': { '@id': 'https://x.com/a' },
        'isPartOf': { '@id': 'https://x.com/#website' },
        'breadcrumb': { '@id': 'https://x.com/a#breadcrumb' },
        'inLanguage': 'en',
      }],
    };
    expect(validateLeanSchema(article, 'Article')).toContain('Article missing required field: image');
  });

  it('flags Organization missing logo', () => {
    const org = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'Organization', '@id': 'https://x.com/#organization', 'name': 'X', 'url': 'https://x.com' }],
    };
    expect(validateLeanSchema(org, 'Organization')).toContain('Organization missing required field: logo');
  });

  // Pillar 2.1 dropped the unconditional SearchAction emission, so the WebSite
  // required-set no longer includes potentialAction. When schema-yoast-parity-fields
  // re-introduces SearchAction behind a workspace flag, add a conditional test here.

  it('flags LocalBusiness missing address', () => {
    const lb = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'LocalBusiness', '@id': 'https://x.com/#localbusiness', 'name': 'X', 'url': 'https://x.com', 'telephone': '+1-555-0100' }],
    };
    expect(validateLeanSchema(lb, 'LocalBusiness')).toContain('LocalBusiness missing required field: address');
  });

  it('flags LocalBusiness missing telephone', () => {
    const lb = {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'LocalBusiness', '@id': 'https://x.com/#localbusiness', 'name': 'X', 'url': 'https://x.com', 'address': { '@type': 'PostalAddress', 'streetAddress': '1 Main St' } }],
    };
    expect(validateLeanSchema(lb, 'LocalBusiness')).toContain('LocalBusiness missing required field: telephone');
  });
});

describe('validateLeanSchema — cross-reference shape (Pillar 1)', () => {
  it('flags isPartOf that is not an @id reference', () => {
    const broken = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'WebPage', '@id': 'https://x.com/p#webpage', 'name': 'P', 'url': 'https://x.com/p',
        'description': 'D', 'inLanguage': 'en',
        'isPartOf': 'https://x.com', // wrong shape — should be {@id: ...}
        'breadcrumb': { '@id': 'https://x.com/p#breadcrumb' },
      }],
    };
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage.isPartOf must be an @id reference (e.g. {"@id": "...#website"})');
  });

  it('flags breadcrumb that points to a missing BreadcrumbList', () => {
    const broken = {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'WebPage', '@id': 'https://x.com/p#webpage', 'name': 'P', 'url': 'https://x.com/p',
        'description': 'D', 'inLanguage': 'en',
        'isPartOf': { '@id': 'https://x.com/#website' },
        'breadcrumb': { '@id': 'https://x.com/p#breadcrumb' },
        // BreadcrumbList node intentionally omitted from the graph
      }],
    };
    expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage.breadcrumb references @id "https://x.com/p#breadcrumb" but no BreadcrumbList with that @id is in the @graph');
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail.**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t 'Pillar 1'`
Expected: FAIL — current `REQUIRED_BY_TYPE` and validator don't enforce these rules yet.

- [ ] **Step 3: Commit (red state).**

```bash
git add tests/unit/schema/validator.test.ts
git commit -m "test(schema): failing assertions for Pillar 1 strict validator rules

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Update REQUIRED_BY_TYPE (sonnet)

**Owns:** `server/schema/validator.ts` (the `REQUIRED_BY_TYPE` const only)
**Must not touch:** anything else.

- [ ] **Step 1: Replace `REQUIRED_BY_TYPE` in `server/schema/validator.ts`.**

```typescript
const REQUIRED_BY_TYPE: Record<string, RequiredFields> = {
  BlogPosting: {
    required: [
      'headline', 'description', 'image', 'datePublished', 'dateModified',
      'author', 'publisher', 'mainEntityOfPage',
      'isPartOf', 'breadcrumb', 'inLanguage', 'articleSection',
    ],
  },
  Article: {
    required: [
      'headline', 'description', 'image', 'datePublished', 'dateModified',
      'author', 'publisher', 'mainEntityOfPage',
      'isPartOf', 'breadcrumb', 'inLanguage',
    ],
  },
  Service: {
    required: ['name', 'description', 'provider', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  Product: {
    required: ['name', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  LocalBusiness: {
    required: ['name', 'url', 'address', 'telephone', 'inLanguage'],
  },
  Organization: {
    required: ['name', 'url', 'logo'],
  },
  WebSite: {
    // potentialAction (sitelinks SearchAction) was originally in this list, but
    // Pillar 2.1 dropped the unconditional emission because the site may not have
    // a search endpoint. schema-yoast-parity-fields will re-introduce SearchAction
    // behind a workspace flag (Workspace.siteHasSearch); when that ships, add
    // potentialAction back here as a conditional required field.
    required: ['name', 'url', 'publisher', 'inLanguage'],
  },
  AboutPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage', 'mainEntity'],
  },
  ContactPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  CollectionPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
  WebPage: {
    required: ['name', 'url', 'description', 'isPartOf', 'breadcrumb', 'inLanguage'],
  },
};
```

- [ ] **Step 2: Run the new field-presence tests, confirm they now pass.**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t 'Yoast-baseline required fields'`
Expected: PASS — all 9 field-presence assertions green.

- [ ] **Step 3: Cross-reference shape tests still fail (Task 3 fixes them).**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t 'cross-reference shape'`
Expected: FAIL on both shape tests.

- [ ] **Step 4: Commit.**

```bash
git add server/schema/validator.ts
git commit -m "feat(schema): tighten REQUIRED_BY_TYPE to Yoast-baseline (Pillar 1)

Article/BlogPosting now require image, dateModified, isPartOf, breadcrumb, inLanguage.
WebPage and variants require description, isPartOf, breadcrumb, inLanguage.
LocalBusiness requires address, telephone, inLanguage.
WebSite requires inLanguage (potentialAction conditional, deferred to parity-fields).
Organization requires logo.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Cross-reference shape validators (sonnet)

**Owns:** `server/schema/validator.ts` (additive — new helpers + extended main loop)
**Must not touch:** templates, tests.

- [ ] **Step 1: Add cross-ref helpers and wire into `validateLeanSchema`.**

In `server/schema/validator.ts`, add before `validateLeanSchema`:

```typescript
function isIdRef(v: unknown): v is { '@id': string } {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['@id'] === 'string';
}

function validateCrossRefs(node: Record<string, unknown>, allNodes: Record<string, unknown>[]): string[] {
  const errors: string[] = [];
  const t = node['@type'] as string;

  if (node.isPartOf !== undefined && !isIdRef(node.isPartOf)) {
    errors.push(`${t}.isPartOf must be an @id reference (e.g. {"@id": "...#website"})`);
  }

  if (node.breadcrumb !== undefined) {
    if (!isIdRef(node.breadcrumb)) {
      errors.push(`${t}.breadcrumb must be an @id reference (e.g. {"@id": "...#breadcrumb"})`);
    } else {
      const target = node.breadcrumb['@id'];
      const found = allNodes.some(n => n['@type'] === 'BreadcrumbList' && n['@id'] === target);
      if (!found) {
        errors.push(`${t}.breadcrumb references @id "${target}" but no BreadcrumbList with that @id is in the @graph`);
      }
    }
  }

  if (node.mainEntityOfPage !== undefined && !isIdRef(node.mainEntityOfPage) && typeof node.mainEntityOfPage !== 'string') {
    // mainEntityOfPage may be either a string URL or an @id-ref shape — both are accepted by Google.
    // Reject only objects that are neither.
    const v = node.mainEntityOfPage;
    if (typeof v === 'object' && v !== null && !('@id' in v) && !('@type' in v)) {
      errors.push(`${t}.mainEntityOfPage must be a URL string or {"@id": "..."} reference`);
    }
  }

  return errors;
}
```

Update the per-node loop in `validateLeanSchema`:

```typescript
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
    errors.push(...validateCrossRefs(node, graph));
  }
```

- [ ] **Step 2: Run cross-ref shape tests, confirm pass.**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t 'cross-reference shape'`
Expected: PASS — both shape tests green.

- [ ] **Step 3: Run the entire validator test file.**

Run: `npx vitest run tests/unit/schema/validator.test.ts`
Expected: PASS — including all pre-existing assertions.

- [ ] **Step 4: Commit.**

```bash
git add server/schema/validator.ts
git commit -m "feat(schema): cross-reference shape validators

isPartOf must be {@id}-shape; breadcrumb must reference a BreadcrumbList
actually present in the @graph; mainEntityOfPage accepts string or @id-ref.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Value-shape validators (sonnet)

**Owns:** `server/schema/validator.ts` (additive — six new helpers + extended main loop), `tests/unit/schema/validator.test.ts` (new test cases for each shape rule)
**Must not touch:** templates.

This task adds the shape-correctness validators that prevent silent regressions in the kinds of fields that matter for Google Rich Results eligibility but where the old "field is present" rule wouldn't catch malformations (e.g. `Article.author = "Jane Doe"` instead of `{ "@type": "Person", "name": "Jane Doe" }` would pass the existing required-fields rule but fail Google's Rich Results Test).

- [ ] **Step 1: Append failing shape-validator tests to `tests/unit/schema/validator.test.ts`.**

```typescript
describe('validateLeanSchema — value-shape validators (Pillar 1)', () => {
  const article = (overrides: Record<string, unknown> = {}) => ({
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Article', '@id': 'https://x.com/a#article', 'headline': 'H',
      'description': 'D', 'image': ['https://x.com/i.jpg'], 'url': 'https://x.com/a',
      'datePublished': '2026-01-01T00:00:00Z', 'dateModified': '2026-01-02T00:00:00Z',
      'mainEntityOfPage': { '@id': 'https://x.com/a' },
      'author': { '@type': 'Person', 'name': 'Jane Doe' },
      'publisher': { '@type': 'Organization', 'name': 'X', 'logo': { '@type': 'ImageObject', 'url': 'https://x.com/logo.png' } },
      'isPartOf': { '@id': 'https://x.com/#website' },
      'breadcrumb': { '@id': 'https://x.com/a#breadcrumb' },
      'inLanguage': 'en',
      ...overrides,
    }, {
      '@type': 'BreadcrumbList', '@id': 'https://x.com/a#breadcrumb',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://x.com' },
        { '@type': 'ListItem', 'position': 2, 'name': 'A', 'item': 'https://x.com/a' },
      ],
    }],
  });

  it('passes a fully shape-correct Article', () => {
    expect(validateLeanSchema(article(), 'Article')).toEqual([]);
  });

  it('flags Article.author missing @type', () => {
    const broken = article({ author: { name: 'Jane Doe' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.author must have @type ∈ {Person, Organization} and non-empty name');
  });

  it('flags Article.author missing name', () => {
    const broken = article({ author: { '@type': 'Person' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.author must have @type ∈ {Person, Organization} and non-empty name');
  });

  it('flags Article.author with bad @type', () => {
    const broken = article({ author: { '@type': 'CreativeWork', 'name': 'X' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.author must have @type ∈ {Person, Organization} and non-empty name');
  });

  it('flags Article.publisher missing logo (Google Rich Results requires it)', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'name': 'X' } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.publisher must have @type, name, and logo (ImageObject with url) — Google Article rich result requires the publisher logo');
  });

  it('flags Article.publisher.logo missing url', () => {
    const broken = article({ publisher: { '@type': 'Organization', 'name': 'X', 'logo': { '@type': 'ImageObject' } } });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.publisher must have @type, name, and logo (ImageObject with url) — Google Article rich result requires the publisher logo');
  });

  it('flags Article.image as non-string non-array non-ImageObject', () => {
    const broken = article({ image: 123 });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.image must be a string URL, an array of strings/ImageObjects, or an ImageObject');
  });

  it('flags Article.datePublished not in ISO 8601 format', () => {
    const broken = article({ datePublished: 'January 1, 2026' });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.datePublished must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")');
  });

  it('flags Article.dateModified not in ISO 8601 format', () => {
    const broken = article({ dateModified: '01/02/2026' });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.dateModified must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")');
  });

  it('flags BreadcrumbList positions not starting at 1', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    broken['@graph'][1].itemListElement[0].position = 0;
    broken['@graph'][1].itemListElement[1].position = 1;
    expect(validateLeanSchema(broken, 'Article')).toContain('BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending');
  });

  it('flags BreadcrumbList positions with gaps', () => {
    const broken = JSON.parse(JSON.stringify(article()));
    broken['@graph'][1].itemListElement[1].position = 3; // 1, 3 — gap
    expect(validateLeanSchema(broken, 'Article')).toContain('BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending');
  });

  it('flags primary-node url field that is not absolute', () => {
    const broken = article({ url: '/a' });
    expect(validateLeanSchema(broken, 'Article')).toContain('Article.url must be an absolute URL (start with http:// or https://)');
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail.**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t 'value-shape validators'`
Expected: every assertion FAILs except "passes a fully shape-correct Article" — the new validators don't exist yet.

- [ ] **Step 3: Add the shape validators to `server/schema/validator.ts`.**

Append before `validateLeanSchema`:

```typescript
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function validateArticleShape(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const t = node['@type'] as string;
  if (t !== 'Article' && t !== 'BlogPosting') return errors;

  // author: must have @type ∈ {Person, Organization} AND non-empty name.
  const author = node.author;
  if (author !== undefined) {
    const ok = typeof author === 'object' && author !== null
      && ((author as Record<string, unknown>)['@type'] === 'Person' || (author as Record<string, unknown>)['@type'] === 'Organization')
      && typeof (author as Record<string, unknown>).name === 'string'
      && ((author as Record<string, unknown>).name as string).trim().length > 0;
    if (!ok) errors.push(`${t}.author must have @type ∈ {Person, Organization} and non-empty name`);
  }

  // publisher: must have @type AND name AND logo (ImageObject with url).
  const publisher = node.publisher as Record<string, unknown> | undefined;
  if (publisher !== undefined) {
    const logo = publisher.logo as Record<string, unknown> | undefined;
    const ok = typeof publisher === 'object' && publisher !== null
      && typeof publisher['@type'] === 'string'
      && typeof publisher.name === 'string' && (publisher.name as string).trim().length > 0
      && logo !== undefined && typeof logo === 'object'
      && logo['@type'] === 'ImageObject'
      && typeof logo.url === 'string' && (logo.url as string).trim().length > 0;
    if (!ok) errors.push(`${t}.publisher must have @type, name, and logo (ImageObject with url) — Google Article rich result requires the publisher logo`);
  }

  // image: string | array | ImageObject.
  const image = node.image;
  if (image !== undefined) {
    const ok = typeof image === 'string'
      || Array.isArray(image)
      || (typeof image === 'object' && image !== null && (image as Record<string, unknown>)['@type'] === 'ImageObject');
    if (!ok) errors.push(`${t}.image must be a string URL, an array of strings/ImageObjects, or an ImageObject`);
  }

  // datePublished / dateModified: ISO 8601.
  for (const field of ['datePublished', 'dateModified'] as const) {
    const v = node[field];
    if (v !== undefined && (typeof v !== 'string' || !ISO_8601_RE.test(v))) {
      errors.push(`${t}.${field} must be ISO 8601 (e.g. "2026-01-15T00:00:00Z")`);
    }
  }

  return errors;
}

function validateBreadcrumbOrdering(node: Record<string, unknown>): string[] {
  if (node['@type'] !== 'BreadcrumbList') return [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) return []; // existing validateBreadcrumb catches missing array
  for (let i = 0; i < items.length; i++) {
    if (items[i].position !== i + 1) {
      return ['BreadcrumbList itemListElement positions must start at 1 and be contiguous-ascending'];
    }
  }
  return [];
}

function validateAbsoluteUrls(node: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const t = node['@type'] as string;
  // Only check primary nodes — BreadcrumbList's `item` URLs are inside ListItems and are
  // already required by validateBreadcrumb to be non-empty strings; skip them here.
  if (t === 'BreadcrumbList' || t === 'ListItem') return errors;
  const url = node.url;
  if (typeof url === 'string' && !/^https?:\/\//.test(url)) {
    errors.push(`${t}.url must be an absolute URL (start with http:// or https://)`);
  }
  return errors;
}
```

Then update the per-node loop in `validateLeanSchema` to invoke them (after the existing `validateCrossRefs` call):

```typescript
    errors.push(...validateCrossRefs(node, graph));
    errors.push(...validateArticleShape(node));
    errors.push(...validateBreadcrumbOrdering(node));
    errors.push(...validateAbsoluteUrls(node));
```

- [ ] **Step 4: Run, confirm all shape-validator tests pass.**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t 'value-shape validators'`
Expected: all 12 assertions PASS.

- [ ] **Step 5: Run the entire validator test file.**

Run: `npx vitest run tests/unit/schema/validator.test.ts`
Expected: PASS — Tasks 1, 3, 4 assertions all green.

- [ ] **Step 6: Commit.**

```bash
git add server/schema/validator.ts tests/unit/schema/validator.test.ts
git commit -m "feat(schema): value-shape validators (Pillar 1 Task 4)

Article author/publisher/image shape; ISO 8601 dates; BreadcrumbList
position ordering; absolute URLs on primary nodes. Catches the regression
class where a future template change passes required-field-present but
fails Google Rich Results due to malformed values.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Update existing template tests (sonnet)

**Owns:** `tests/unit/schema/templates.test.ts`, `tests/integration/lean-schema-generator.test.ts`
**Must not touch:** source files.

- [ ] **Step 1: Run all schema tests and capture the new failures.**

Run: `npx vitest run tests/unit/schema tests/integration/lean-schema-generator.test.ts`
Expected: failures in places where old fixtures pass into the validator and assert `[]` — the validator now rejects fixtures that lack `isPartOf`/`breadcrumb`/`inLanguage` or have malformed shapes.

- [ ] **Step 2: Patch fixtures in `tests/unit/schema/templates.test.ts`.**

Wherever a `validateLeanSchema(...)` call asserts `.toEqual([])`, ensure the fixture's `pageData` includes:
- `cleanTitle` (already added in Pillar 2)
- `inLanguage: 'en'` (already added in Pillar 2)
- `breadcrumbs` with at least 2 items so a BreadcrumbList is emitted alongside the primary node

Where the template's primary node now references a BreadcrumbList, the test must run the *full* `template['@graph']` through `validateLeanSchema`, not the primary node alone. Update such assertions accordingly. Example pattern:

```typescript
// Before
expect(validateLeanSchema(buildArticleSchema(baseInput, 'BlogPosting'), 'BlogPosting')).toEqual([]);

// After (no change needed — buildArticleSchema returns the {@context, @graph: [...]} shape already)
expect(validateLeanSchema(buildArticleSchema(baseInput, 'BlogPosting'), 'BlogPosting')).toEqual([]);
```

If a fixture lacks the now-required fields (e.g. `serviceInput` may not have `description`), add the field rather than relax the assertion.

- [ ] **Step 3: Patch the FAQ-on-BlogPosting fixture in `tests/integration/lean-schema-generator.test.ts`.**

The existing test deliberately omits `datePublished` so the validator surfaces "missing datePublished". After Pillar 1 the BlogPosting required-field set is much larger, so the same fixture will surface multiple errors (`missing image`, `missing articleSection`, `missing isPartOf`, etc.). Update the assertion from a contains-string test to a contains-substring test that targets the specific error of interest:

```typescript
// Was: out.validationErrors!.some(e => e.includes('datePublished'))
// Keep as-is — `some` + `includes` already tolerates the longer error list.
```

If the test fails because some of the errors weren't there before, that's correct — leave them; the test will still pass.

- [ ] **Step 4: Run all schema tests, confirm green.**

Run: `npx vitest run tests/unit/schema tests/integration/lean-schema-generator.test.ts`
Expected: PASS — every previously-green assertion plus the 9 new Pillar 1 assertions.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/schema/templates.test.ts tests/integration/lean-schema-generator.test.ts
git commit -m "test(schema): update fixtures to satisfy stricter validator rules

Fixtures now include description, inLanguage, breadcrumbs[2+] so primary nodes
keep validating clean against Yoast-baseline REQUIRED_BY_TYPE.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Run the full suite and patch any template gap (sonnet)

**Owns:** any `server/schema/templates/*.ts` file that surfaces a missing required field
**Must not touch:** validator.

- [ ] **Step 1: Run the entire test suite.**

Run: `npx vitest run`
Expected: PASS. If something fails, it means a Pillar 2 template missed a field the Pillar 1 validator now requires.

- [ ] **Step 2: For any failure, identify the offending template.**

Read the failure message. It will say something like `WebPage missing required field: <field>`. Open the relevant template file, add the field with appropriate fallback, commit. Example: if `Service.description` was missing and `pageData.description` may be undefined, drop `Service` from `Service`'s required-fields set — but only if the field is genuinely optional per Google. Otherwise add it to the template's `dropUndefined({...})` block from `pageData.description`.

- [ ] **Step 3: After all green, run typecheck + build.**

```bash
npm run typecheck
npx vite build
```

Expected: zero errors.

- [ ] **Step 4: Commit any template adjustments.**

```bash
git add server/schema/templates
git commit -m "fix(schema): patch templates surfaced by stricter Pillar 1 validator

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

(Skip this step if Step 1 was clean.)

---

### Task 7: Quality gates + docs (haiku)

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

Append a Pillar 1 paragraph noting the validator now enforces Yoast-baseline required-field set + cross-reference shape checks; link to the plan file.

- [ ] **Step 3: Update `data/roadmap.json`.**

Add inside Sprint H, after `schema-pillar-2-data-wiring`:

```json
{
  "id": "schema-pillar-1-validator-bar",
  "title": "Schema Pillar 1 — Raise the Validator Bar",
  "source": "docs/superpowers/plans/2026-04-29-schema-pillar-1-validator-bar.md",
  "est": "0.5d",
  "priority": "P0",
  "sprint": "H",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "REQUIRED_BY_TYPE in validator.ts now enforces Yoast-baseline completeness. Article/BlogPosting require image+dateModified+articleSection+isPartOf+breadcrumb+inLanguage. WebPage variants require description+isPartOf+breadcrumb+inLanguage. LocalBusiness requires address+telephone. WebSite requires potentialAction. Organization requires logo. Cross-ref validators reject malformed isPartOf/breadcrumb shapes and dangling BreadcrumbList @id pointers. Locks the bar Pillar 2 raised."
}
```

Run: `npx tsx scripts/sort-roadmap.ts`
Expected: file re-sorted.

- [ ] **Step 4: Open the PR.**

```bash
git push -u origin claude/schema-pillar-1
gh pr create --base staging --title "feat(schema): Pillar 1 — validator enforces Yoast-baseline completeness" --body "$(cat <<'EOF'
## Summary
- `validateLeanSchema` now fails the build on missing isPartOf, breadcrumb, inLanguage, image (Article), dateModified (Article), articleSection (BlogPosting), description (WebPage variants), address+telephone (LocalBusiness), potentialAction (WebSite), logo (Organization).
- New cross-reference shape validators reject malformed `isPartOf` (must be `{@id}` ref) and dangling `breadcrumb` pointers (must reference a BreadcrumbList present in the same @graph).
- Locks the Pillar 2 bar so no future regression silently drops cross-references or required fields.

## Test plan
- [ ] `npm run typecheck` clean
- [ ] `npx vite build` clean
- [ ] `npx vitest run` clean (11 new validator assertions; existing fixtures updated)
- [ ] `npx tsx scripts/pr-check.ts` clean
- [ ] After staging deploy: regenerate hmpsn studio schema; confirm `Validated 28/28 (0 with warnings)` (or close — any remaining warnings should be data gaps, not template gaps).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-Phase Contracts (Pillar 1 → Pillar 3)

### Exported from Pillar 1 (Pillar 3 will read)

- `REQUIRED_BY_TYPE` constant in `validator.ts` — Pillar 3's `schemarama` integration may consult this list to know what to validate; do not break the shape (`Record<string, { required: string[] }>`).
- `validateCrossRefs` helper — internal, not exported.

### Behavioural contract

After Pillar 1 ships, **every clean schema generated by the lean pipeline must validate with zero errors**. If you add a new template or modify an existing one and the validator returns errors, the template is wrong — do not loosen the validator.

---

## Systemic Improvements

### Shared utilities extracted
- `isIdRef(v)` — internal to validator.ts. Could be exported for tests, but not currently needed.

### pr-check rules to add (Pillar 3 owns)
- After Pillar 3, a pr-check rule will assert that every primary-node template imports `webSiteRef` and `breadcrumbRef` from helpers (catches future template authors who forget cross-refs at build time, before Pillar 1's validator catches them at runtime).

### New tests required
- Validator stricter rules: 9 field-presence assertions + 2 cross-reference shape assertions (this plan).

---

## Verification Strategy

| What | How |
|---|---|
| Stricter rules enforced | `npx vitest run tests/unit/schema/validator.test.ts -t 'Pillar 1'` |
| No false-positive failures on real templates | `npx vitest run tests/integration/lean-schema-generator.test.ts` |
| End-to-end on real workspace | After staging deploy: regenerate hmpsn studio schema in Chrome MCP; the "X of Y validated" stat should be near 100% (any remaining warnings are data gaps, e.g. workspaces that genuinely lack a logo, not template gaps) |

---

## Self-Review

1. **Spec coverage:** Pillar 1's job is to lock the Yoast/Google-baseline bar in code. Tasks 1–4 do that (required-fields per type, cross-ref shapes, value shapes). Tasks 5–6 absorb the test-fixture updates. Task 7 closes the loop with quality gates and docs.

2. **Placeholder scan:** Every task has explicit code or commands. Step 5 is conditional ("if Step 1 was clean") — the conditional path is documented.

3. **Type consistency:** `REQUIRED_BY_TYPE` keys match exact `@type` strings emitted by templates. `isIdRef`, `validateCrossRefs` used consistently within validator.ts. No drift between fixtures and the keys they hit.

4. **Order:** Test-first (Task 1 red for required fields, Task 4 red for shape rules), implementation (Tasks 2 + 3 + 4 green), fixture/template patching (Tasks 5 + 6), docs (Task 7).
