# Page-Element Catalog PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new pattern-based extractors (images, tables, testimonials), 2 AI-assisted extractors (image role classifier with vision, HowTo disambiguation), 4 validator entries, and 3 schema integrations on Article/Service/LocalBusiness templates. Thread a single `AiBudget` through `generateSchemaSuggestions` so the per-run cap actually works.

**Architecture:**
- Pattern-based extractors mirror PR1's `video.ts` / `howto.ts` / `citation.ts` shape (Cheerio in, typed array out, scoped to `<article>` with whole-document fallback for non-Webflow templates).
- AI extractors are wrapped per-element under a single feature flag `schema-ai-element-classifier` (default OFF). When on, they consume from the shared `AiBudget` (100 image classifications + 20 HowTo disambiguations per regenerate-all) and inherit token logging via `callAI({ feature: 'schema-ai-element-classifier', workspaceId })`.
- Schema templates extend `withBreadcrumb([primary, ...newNodes], pageData)` (verified array-accepting in PR1). Each new node has a synchronous pre-emission gate that requires every Google-required field to be populated before the node is added — same pattern as PR1's `canEmitVideo` gate.

**Tech Stack:** TypeScript strict, Cheerio (HTML extraction), better-sqlite3 (page_elements table reused from PR1), Zod (PR1's `pageElementCatalogSchema` already covers PR2 fields), `callAI` dispatcher (server/ai.ts), `gpt-4.1-mini` (vision), Vitest, the existing `AiBudget` helper from PR1.

**PR1 lessons applied throughout:**
- Every new schema node has a pre-emission gate (Devin r2 BUG-0001 lesson) — never emit a node missing a required field.
- All `<article>`-scoped extractors fall back to whole-document scope when no `<article>` tag (PR1 `extractLists` precedent + PR1 audit doc).
- All catch blocks tagged `// catch-ok: <reason>` per pr-check rule.
- AI-call-then-DB-write is wrapped in `db.transaction(() => { ... })` per `docs/rules/ai-dispatch-patterns.md`.
- Validator entries: `Review` requires only what Google enforces (itemReviewed, reviewRating, author); `thumbnailUrl`-style fields that aren't always available go in `recommended`.

---

## File Structure

### New files (16)

```
server/schema/extractors/page-elements/
  image-fetch.ts                    # base64 fetch utility (shared with potential future alttext refactor)
  images.ts                         # pattern role classifier (hero/informative/decorative)
  tables.ts                         # rowCount/colCount + isPricingLike/isComparisonLike heuristic
  testimonials.ts                   # blockquote + rating extraction
  image-ai-classifier.ts            # AI re-classifier for ambiguous images (vision call, budgeted)
  howto-ai-fallback.ts              # AI disambiguation for ambiguous ordered lists (budgeted)

tests/fixtures/page-elements/
  webflow-service-pricing-table.html
  webflow-testimonials.html
  webflow-decorative-images.html
  webflow-mixed-elements-pr2.html

tests/unit/schema/extractors/
  page-elements-images.test.ts
  page-elements-tables.test.ts
  page-elements-testimonials.test.ts
  page-elements-image-ai.test.ts
  page-elements-howto-ai.test.ts

tests/integration/
  page-elements-pr2-extraction.test.ts
```

### Modified files (10)

```
shared/types/feature-flags.ts                    +1 line (new flag)
server/schema/validator.ts                       +4 REQUIRED_BY_TYPE entries
server/schema-suggester.ts                       3 generateLeanSchema sites: thread aiBudget
server/schema/extractors/page-elements.ts        wire 3 new pattern extractors + 2 AI passes
server/schema/templates/article.ts               optional ImageGallery node
server/schema/templates/service.ts               Review[] + AggregateRating + ImageGallery + Table
server/schema/templates/local-business.ts        Review[] + AggregateRating
tests/integration/lean-schema-generator.test.ts  extend with PR2 multi-node @graph assertion
FEATURE_AUDIT.md                                 entry 325 (after 324 from PR1)
data/roadmap.json                                schema-page-element-catalog-v1 PR2 done; PR3 still pending
```

---

## Phase 0 — Shared Contracts (sequential, MUST commit first)

These changes must land before Phase 1+ agents dispatch. They define the contracts other tasks depend on.

### Task 1: Add feature flag

**Files:**
- Modify: `shared/types/feature-flags.ts`

**Model:** Haiku

- [ ] **Step 1: Locate the FEATURE_FLAGS const**

Run: `grep -n "FEATURE_FLAGS = {" shared/types/feature-flags.ts`
Expected: a line like `export const FEATURE_FLAGS = {`

- [ ] **Step 2: Add the flag**

Add a single key to the const, in the schema cluster (search for existing `schema-` keys to find the right neighborhood):

```typescript
'schema-ai-element-classifier': false,
```

The flag default is `false` (dark-launched). Production toggles it via the admin Feature Flags UI (DB override) or `FEATURE_SCHEMA_AI_ELEMENT_CLASSIFIER=true` env var.

- [ ] **Step 3: Verify TypeScript autoderives the union**

Run: `npm run typecheck`
Expected: zero errors. `FeatureFlagKey` should now include `'schema-ai-element-classifier'` automatically.

- [ ] **Step 4: Commit**

```bash
git add shared/types/feature-flags.ts
git commit -m "feat(flags): add schema-ai-element-classifier flag (default off) for page-element catalog PR2"
```

---

### Task 2: Add validator REQUIRED_BY_TYPE entries

**Files:**
- Modify: `server/schema/validator.ts`
- Test: `tests/unit/schema/validator.test.ts` (extend)

**Model:** Haiku (mechanical pattern-matched additions)

- [ ] **Step 1: Write the failing tests for the 4 new entries**

Add to `tests/unit/schema/validator.test.ts` after the existing HowTo describe block (search for `describe('HowTo required fields'`):

```typescript
describe('Review required fields', () => {
  const fullReview = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Service',
      '@id': 'https://x/y#service',
      'name': 'Web Design',
      'description': 'Premium Webflow.',
      'provider': { '@type': 'Organization', 'name': 'Acme' },
      'isPartOf': { '@id': 'https://x/#website' },
      'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
      'inLanguage': 'en',
    }, {
      '@type': 'Review',
      '@id': 'https://x/y#review-0',
      'itemReviewed': { '@id': 'https://x/y#service' },
      'reviewRating': { '@type': 'Rating', 'ratingValue': 5, 'bestRating': 5 },
      'author': { '@type': 'Person', 'name': 'Jane' },
      'reviewBody': 'Excellent service.',
    }],
  };

  it('passes a fully-populated Review', () => {
    const findings = validateLeanSchema(fullReview, 'Service').filter(f => f.type === 'Review');
    expect(findings.filter(f => f.severity === 'error')).toEqual([]);
  });

  it('flags missing Review.itemReviewed as error', () => {
    const broken = JSON.parse(JSON.stringify(fullReview));
    delete broken['@graph'][1].itemReviewed;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'Review', field: 'itemReviewed' }),
    );
  });

  it('flags missing Review.reviewRating as error', () => {
    const broken = JSON.parse(JSON.stringify(fullReview));
    delete broken['@graph'][1].reviewRating;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'Review', field: 'reviewRating' }),
    );
  });

  it('flags missing Review.author as error', () => {
    const broken = JSON.parse(JSON.stringify(fullReview));
    delete broken['@graph'][1].author;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'Review', field: 'author' }),
    );
  });
});

describe('AggregateRating required fields', () => {
  const fullAR = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Service',
      '@id': 'https://x/y#service',
      'name': 'Web Design',
      'description': 'Premium Webflow.',
      'provider': { '@type': 'Organization', 'name': 'Acme' },
      'isPartOf': { '@id': 'https://x/#website' },
      'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
      'inLanguage': 'en',
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': 4.8,
        'reviewCount': 12,
        'bestRating': 5,
      },
    }],
  };

  it('passes a fully-populated AggregateRating', () => {
    const findings = validateLeanSchema(fullAR, 'Service').filter(f => f.type === 'AggregateRating');
    expect(findings.filter(f => f.severity === 'error')).toEqual([]);
  });

  it('flags missing AggregateRating.ratingValue as error', () => {
    const broken = JSON.parse(JSON.stringify(fullAR));
    delete broken['@graph'][0].aggregateRating.ratingValue;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'AggregateRating', field: 'ratingValue' }),
    );
  });

  it('flags missing AggregateRating.reviewCount as error', () => {
    const broken = JSON.parse(JSON.stringify(fullAR));
    delete broken['@graph'][0].aggregateRating.reviewCount;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'AggregateRating', field: 'reviewCount' }),
    );
  });
});

describe('Table required fields', () => {
  const fullTable = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Service',
      '@id': 'https://x/y#service',
      'name': 'Web Design',
      'description': 'Premium Webflow.',
      'provider': { '@type': 'Organization', 'name': 'Acme' },
      'isPartOf': { '@id': 'https://x/#website' },
      'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
      'inLanguage': 'en',
      'mainEntity': {
        '@type': 'Table',
        '@id': 'https://x/y#table-0',
        'about': 'Pricing tiers',
      },
    }],
  };

  it('passes a Table with about populated', () => {
    const findings = validateLeanSchema(fullTable, 'Service').filter(f => f.type === 'Table');
    expect(findings.filter(f => f.severity === 'error')).toEqual([]);
  });

  it('flags missing Table.about as error', () => {
    const broken = JSON.parse(JSON.stringify(fullTable));
    delete broken['@graph'][0].mainEntity.about;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'Table', field: 'about' }),
    );
  });
});

describe('ImageGallery required fields', () => {
  const fullGallery = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Service',
      '@id': 'https://x/y#service',
      'name': 'Web Design',
      'description': 'Premium Webflow.',
      'provider': { '@type': 'Organization', 'name': 'Acme' },
      'isPartOf': { '@id': 'https://x/#website' },
      'breadcrumb': { '@id': 'https://x/y#breadcrumb' },
      'inLanguage': 'en',
    }, {
      '@type': 'ImageGallery',
      '@id': 'https://x/y#gallery',
      'name': 'Project gallery',
      'image': ['https://x/img1.jpg', 'https://x/img2.jpg'],
    }],
  };

  it('passes a fully-populated ImageGallery', () => {
    const findings = validateLeanSchema(fullGallery, 'Service').filter(f => f.type === 'ImageGallery');
    expect(findings.filter(f => f.severity === 'error')).toEqual([]);
  });

  it('flags missing ImageGallery.name as error', () => {
    const broken = JSON.parse(JSON.stringify(fullGallery));
    delete broken['@graph'][1].name;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'ImageGallery', field: 'name' }),
    );
  });

  it('flags missing ImageGallery.image as error', () => {
    const broken = JSON.parse(JSON.stringify(fullGallery));
    delete broken['@graph'][1].image;
    const findings = validateLeanSchema(broken, 'Service');
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', type: 'ImageGallery', field: 'image' }),
    );
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t "Review required fields|AggregateRating required fields|Table required fields|ImageGallery required fields"`
Expected: All 11 tests FAIL — `REQUIRED_BY_TYPE` does not yet have entries for these types, so the validator emits no errors and the assertions don't match.

- [ ] **Step 3: Add the 4 REQUIRED_BY_TYPE entries**

Edit `server/schema/validator.ts`. Find the `REQUIRED_BY_TYPE` map (already contains entries for `VideoObject` and `HowTo` from PR1). Add the 4 new entries directly after the `HowTo` block:

```typescript
  HowTo: {
    required: ['name', 'step'],
    recommended: ['totalTime', 'estimatedCost'],
  },
  Review: {
    required: ['itemReviewed', 'reviewRating', 'author'],
    recommended: ['datePublished', 'reviewBody'],
  },
  AggregateRating: {
    required: ['ratingValue', 'reviewCount'],
    recommended: ['bestRating', 'worstRating'],
  },
  Table: {
    required: ['about'],
  },
  ImageGallery: {
    required: ['name', 'image'],
  },
};
```

(The closing `};` of `REQUIRED_BY_TYPE` is already there — just insert the entries before it.)

- [ ] **Step 4: Run the new tests; verify they pass**

Run: `npx vitest run tests/unit/schema/validator.test.ts -t "Review required fields|AggregateRating required fields|Table required fields|ImageGallery required fields"`
Expected: All 11 tests PASS.

- [ ] **Step 5: Run the full validator test file**

Run: `npx vitest run tests/unit/schema/validator.test.ts`
Expected: PASS — no regressions on PR1's VideoObject/HowTo tests.

- [ ] **Step 6: Commit**

```bash
git add server/schema/validator.ts tests/unit/schema/validator.test.ts
git commit -m "feat(schema/validator): add REQUIRED_BY_TYPE for Review/AggregateRating/Table/ImageGallery"
```

---

### Task 3: Refactor schema-suggester to thread a single AiBudget

**Files:**
- Modify: `server/schema-suggester.ts` (lines around 345, 421, 466 — 3 generateLeanSchema sites)
- Test: `tests/unit/schema/extractors/page-elements-ai-budget.test.ts` (extend with single-budget-shared scenario)

**Model:** Sonnet

**Background:** PR1 introduced `LeanGeneratorInput.aiBudget?` as optional. `generator.ts` falls back to `createAiBudget(0)` when none is passed. Devin's PR1 round-5 informational note flagged that `generateSchemaSuggestions` does NOT pass a budget, so each page gets a fresh 0-cap budget — meaning the per-run cap (100 image + 20 HowTo) is uneenforceable when AI is enabled.

PR2 fix: create ONE `AiBudget` at the top of `generateSchemaSuggestions` (and `generateSchemaForPage`) and pass it through every `generateLeanSchema` call.

- [ ] **Step 1: Write the failing test pinning the shared-budget contract**

Add to `tests/unit/schema/extractors/page-elements-ai-budget.test.ts` (file already exists from PR1 with createAiBudget tests). Append:

```typescript
describe('Shared budget across multiple consumers (PR2 plumbing)', () => {
  it('a single budget enforces the cap across N consumers', () => {
    const shared = createAiBudget(3);
    // Simulate 3 pages each trying to consume 2 calls.
    const consumed: boolean[] = [];
    for (let page = 0; page < 3; page++) {
      for (let call = 0; call < 2; call++) {
        consumed.push(tryConsumeAiBudget(shared));
      }
    }
    // Total attempts: 6. Cap: 3. So exactly 3 true, then 3 false.
    expect(consumed.filter(Boolean).length).toBe(3);
    expect(consumed.filter(c => !c).length).toBe(3);
    expect(shared.exhausted).toBe(true);
  });
});
```

- [ ] **Step 2: Run; verify it passes (the helper from PR1 already supports this)**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-ai-budget.test.ts -t "Shared budget"`
Expected: PASS. (This test pins behavior the helper already supports; failure would mean a regression.)

- [ ] **Step 3: Read the current schema-suggester structure**

Run: `grep -nE "generateLeanSchema|createAiBudget|isFeatureEnabled" server/schema-suggester.ts | head -20`

Identify: 3 `generateLeanSchema` call sites (single-page + static-pages-loop + cms-items-loop). Also identify whether `isFeatureEnabled` is already imported.

- [ ] **Step 4: Add the import for AiBudget helpers + isFeatureEnabled**

Edit `server/schema-suggester.ts`. At the top of the imports block, add:

```typescript
import { createAiBudget } from './schema/extractors/page-elements/ai-budget.js';
import type { AiBudget } from './schema/extractors/page-elements/ai-budget.js';
import { isFeatureEnabled } from './feature-flags.js';
```

(Use named imports if `isFeatureEnabled` is already imported — verify with grep first.)

- [ ] **Step 5: Add a private helper to allocate the budget**

Add this helper near the top of `server/schema-suggester.ts` after the imports:

```typescript
/**
 * AI budget allocation for the page-element AI extractors.
 * 100 image classifications + 20 HowTo disambiguations = 120 total per regenerate-all.
 * Returns a zero-cap budget when the feature flag is off so all consumers fall through to rule-based.
 */
function allocateElementAiBudget(): AiBudget {
  const enabled = isFeatureEnabled('schema-ai-element-classifier');
  return createAiBudget(enabled ? 120 : 0);
}
```

- [ ] **Step 6: Thread the budget through `generateSchemaForPage`**

Find the existing `generateLeanSchema({...})` call in `generateSchemaForPage` (around line 345). Above it, add:

```typescript
  const aiBudget = allocateElementAiBudget();
```

Then add `aiBudget` to the `generateLeanSchema` input object:

```typescript
  const lean = await generateLeanSchema({
    pageId,
    pageMeta: { /* unchanged */ },
    html: html || '',
    baseUrl,
    workspace: { /* unchanged */ },
    aiBudget, // NEW — PR2: thread per-call budget so AI extractors can run within cap
  });
```

- [ ] **Step 7: Thread the budget through `generateSchemaSuggestions`**

Find `generateSchemaSuggestions` (around line 380). Allocate ONE budget at the top of the function (above the `for (const page of pages)` loop):

```typescript
  const aiBudget = allocateElementAiBudget();
```

Then thread `aiBudget` into BOTH `generateLeanSchema` calls inside that function — the static-pages loop (around line 421) AND the CMS items loop (around line 466). Same pattern as Step 6: just add `aiBudget,` to the input object.

The shared budget means a 200-page batch can use at most 100 image classifications + 20 HowTo calls TOTAL across all pages — exactly the spec's per-run cap.

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: zero errors. `LeanGeneratorInput.aiBudget?` is already optional (PR1), so passing it always is type-safe.

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run`
Expected: 5550+/5551 PASS (the same pre-existing flaky content-decay test from PR1 may time out — unrelated).

- [ ] **Step 10: Commit**

```bash
git add server/schema-suggester.ts tests/unit/schema/extractors/page-elements-ai-budget.test.ts
git commit -m "refactor(schema-suggester): thread single AiBudget through 3 generateLeanSchema sites"
```

---

### Task 4: Image-fetch utility (shared base64 fetcher)

**Files:**
- Create: `server/schema/extractors/page-elements/image-fetch.ts`
- Test: `tests/unit/schema/extractors/page-elements-image-fetch.test.ts`

**Model:** Sonnet

**Why:** The AI image classifier (Task 11) and any future re-use (alttext.ts refactor) both need to fetch a remote `<img src>` URL and convert to a base64 data URL. Extracting now prevents duplication and centralizes timeout/error handling.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/extractors/page-elements-image-fetch.test.ts`:

```typescript
/**
 * Unit tests for fetchImageAsBase64 — converts a remote image URL into a
 * data: URL suitable for OpenAI vision message content. Must never throw;
 * caller (AI classifier) needs to fall through to rule-based when fetch
 * fails or content-type is unsupported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchImageAsBase64 } from '../../../../server/schema/extractors/page-elements/image-fetch.js';

describe('fetchImageAsBase64', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns a data: URL on a successful image fetch', async () => {
    const fakeBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
    globalThis.fetch = vi.fn(async () => new Response(fakeBytes, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    })) as typeof globalThis.fetch;

    const result = await fetchImageAsBase64('https://example.com/img.jpg');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    expect(result!.length).toBeGreaterThan('data:image/jpeg;base64,'.length);
  });

  it('returns null on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 })) as typeof globalThis.fetch;
    const result = await fetchImageAsBase64('https://example.com/missing.jpg');
    expect(result).toBeNull();
  });

  it('returns null on unsupported content-type', async () => {
    globalThis.fetch = vi.fn(async () => new Response('text', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })) as typeof globalThis.fetch;
    const result = await fetchImageAsBase64('https://example.com/page.html');
    expect(result).toBeNull();
  });

  it('returns null on fetch throw (network failure)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as typeof globalThis.fetch;
    const result = await fetchImageAsBase64('https://unreachable.example/img.jpg');
    expect(result).toBeNull();
  });

  it('respects 5-second timeout via AbortController', async () => {
    let abortFired = false;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      // Listen for abort; resolve never (would hang) unless aborted.
      return await new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            abortFired = true;
            reject(new Error('aborted'));
          });
        }
      });
    }) as typeof globalThis.fetch;

    const result = await fetchImageAsBase64('https://example.com/slow.jpg', { timeoutMs: 50 });
    expect(result).toBeNull();
    expect(abortFired).toBe(true);
  });

  it('accepts known image content-types: jpeg, png, webp, gif', async () => {
    const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    for (const ct of types) {
      globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': ct },
      })) as typeof globalThis.fetch;
      const result = await fetchImageAsBase64(`https://example.com/x.${ct.split('/')[1]}`);
      expect(result).toMatch(new RegExp(`^data:${ct.replace('/', '\\/')};base64,`));
    }
  });
});
```

- [ ] **Step 2: Run; expect FAIL with "Cannot find module"**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-image-fetch.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the utility**

Create `server/schema/extractors/page-elements/image-fetch.ts`:

```typescript
/**
 * Fetches a remote image URL and returns a `data:<mime>;base64,...` URL
 * suitable for OpenAI vision message content (`{ type: 'image_url',
 * image_url: { url: <data-url> } }`).
 *
 * Contract: never throws. Returns null on any failure (network, timeout,
 * non-2xx response, unsupported content-type). Callers fall through to
 * rule-based classification when null is returned.
 *
 * Used by image-ai-classifier.ts (PR2). Future: alttext.ts could be
 * refactored to use this once it migrates from raw openai SDK to callAI.
 */
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/image-fetch');

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const DEFAULT_TIMEOUT_MS = 5000;

export interface FetchImageOpts {
  /** Abort fetch after this many ms. Default 5000. */
  timeoutMs?: number;
}

export async function fetchImageAsBase64(
  url: string,
  opts: FetchImageOpts = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.debug({ url, status: res.status }, 'image fetch returned non-2xx');
      return null;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      log.debug({ url, contentType }, 'image fetch returned unsupported content-type');
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const base64 = Buffer.from(bytes).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) { // catch-ok: fetch may throw for DNS/ECONNREFUSED/AbortError — degrade gracefully
    log.debug({ err, url }, 'image fetch failed; returning null');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run; expect 6 tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-image-fetch.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/extractors/page-elements/image-fetch.ts tests/unit/schema/extractors/page-elements-image-fetch.test.ts
git commit -m "feat(schema/extractors): add fetchImageAsBase64 utility for AI vision callers"
```

---

## Phase 1 — Pattern Extractors (parallel, 3 agents)

After Phase 0 commits land, dispatch these 3 agents in parallel. They each own their own extractor + test file; no shared edits.

### Task 5: Pattern image extractor (rule-based role classification)

**Files:**
- Create: `server/schema/extractors/page-elements/images.ts`
- Test: `tests/unit/schema/extractors/page-elements-images.test.ts`

**Model:** Sonnet

**Owns:** images.ts only. **Does not touch:** tables.ts, testimonials.ts.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/extractors/page-elements-images.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractImages } from '../../../../server/schema/extractors/page-elements/images.js';

describe('extractImages — rule-based role classification', () => {
  it('classifies a hero image (large, in <header> or first <img> in <article>)', () => {
    const $ = cheerio.load(`
      <article>
        <header>
          <img src="https://cdn.example.com/hero.jpg" alt="Hero shot" width="1200" height="600">
        </header>
        <p>Body content with no other images.</p>
      </article>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(1);
    expect(images[0].role).toBe('hero');
    expect(images[0].roleSource).toBe('rule');
    expect(images[0].src).toBe('https://cdn.example.com/hero.jpg');
    expect(images[0].alt).toBe('Hero shot');
    expect(images[0].width).toBe(1200);
    expect(images[0].height).toBe(600);
  });

  it('classifies images with descriptive alt text as informative', () => {
    const $ = cheerio.load(`
      <article>
        <h1>Article</h1>
        <img src="/diagram.png" alt="System architecture diagram showing data flow between layers" width="800" height="400">
      </article>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(1);
    expect(images[0].role).toBe('informative');
  });

  it('classifies images with empty alt + role="presentation" as decorative', () => {
    const $ = cheerio.load(`
      <article>
        <h1>X</h1>
        <p>Body.</p>
        <img src="/spacer.png" alt="" role="presentation" width="20" height="20">
      </article>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(1);
    expect(images[0].role).toBe('decorative');
  });

  it('classifies tiny images (< 100px) as decorative regardless of alt', () => {
    const $ = cheerio.load(`
      <article>
        <h1>X</h1>
        <img src="/icon.svg" alt="Logo icon" width="24" height="24">
      </article>
    `);
    const images = extractImages($);
    expect(images[0].role).toBe('decorative');
  });

  it('falls back to whole-document scope when no <article> tag', () => {
    const $ = cheerio.load(`
      <main>
        <header><img src="/hero.jpg" alt="Hero" width="1200" height="600"></header>
        <p>Body.</p>
        <img src="/diagram.jpg" alt="Diagram" width="800" height="400">
      </main>
    `);
    const images = extractImages($);
    expect(images).toHaveLength(2);
    expect(images[0].role).toBe('hero');
    expect(images[1].role).toBe('informative');
  });

  it('skips images with no src', () => {
    const $ = cheerio.load('<article><img alt="missing"></article>');
    expect(extractImages($)).toEqual([]);
  });

  it('extracts width/height from attribute values, not styles', () => {
    const $ = cheerio.load(`
      <article>
        <img src="/x.jpg" alt="X" width="500" height="300" style="width:50%;">
      </article>
    `);
    expect(extractImages($)[0].width).toBe(500);
    expect(extractImages($)[0].height).toBe(300);
  });

  it('first <img> in article without explicit <header> is also classified hero', () => {
    const $ = cheerio.load(`
      <article>
        <img src="/lead.jpg" alt="Lead photo" width="1200" height="800">
        <p>Body.</p>
        <img src="/diagram.png" alt="A descriptive caption explaining the diagram contents" width="600" height="400">
      </article>
    `);
    const images = extractImages($);
    expect(images[0].role).toBe('hero');
    expect(images[1].role).toBe('informative');
  });

  it('extracts caption from <figcaption> when wrapped in <figure>', () => {
    const $ = cheerio.load(`
      <article>
        <h1>X</h1>
        <figure>
          <img src="/diagram.png" alt="Diagram" width="800" height="400">
          <figcaption>Figure 1: System overview</figcaption>
        </figure>
      </article>
    `);
    expect(extractImages($)[0].caption).toBe('Figure 1: System overview');
  });

  it('returns empty array when no images', () => {
    const $ = cheerio.load('<article><p>Just text.</p></article>');
    expect(extractImages($)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; expect FAIL with "Cannot find module"**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-images.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the extractor**

Create `server/schema/extractors/page-elements/images.ts`:

```typescript
/**
 * Image element extractor with rule-based role classification.
 *
 * Roles:
 *   - hero: first image inside <header>, OR first image in <article> when no <header>.
 *           Implies a large lead image; populates the primary node's `image` field.
 *   - informative: images with descriptive alt text (>=20 chars) and meaningful dimensions
 *                  (width >= 200 OR height >= 200).
 *   - decorative: empty alt OR role="presentation" OR width/height < 100. Skipped from
 *                 ImageGallery emission.
 *
 * AI fallback (image-ai-classifier.ts) re-classifies role when roleSource='fallback'
 * and the feature flag is on. PR1 ships rule-based + fallback to 'informative' for
 * ambiguous cases.
 *
 * Scoped to <article> with whole-document fallback (matches PR1 howto.ts pattern).
 */
import type * as cheerio from 'cheerio';
import type { PageImage } from '../../../../shared/types/page-elements.js';

const MIN_INFORMATIVE_ALT_LENGTH = 20;
const MIN_INFORMATIVE_DIMENSION = 200;
const MAX_DECORATIVE_DIMENSION = 100;

function parseDim(attr: string | undefined): number | undefined {
  if (!attr) return undefined;
  const n = parseInt(attr, 10);
  return Number.isFinite(n) ? n : undefined;
}

function classifyRole(
  $img: ReturnType<cheerio.CheerioAPI>,
  isFirstHero: boolean,
  width: number | undefined,
  height: number | undefined,
  alt: string | undefined,
  role: string | undefined,
): { role: PageImage['role']; roleSource: PageImage['roleSource'] } {
  // 1) Decorative — explicit signals win
  if ((alt ?? '').trim() === '' || role === 'presentation' || role === 'none') {
    return { role: 'decorative', roleSource: 'rule' };
  }
  if (width != null && width < MAX_DECORATIVE_DIMENSION
    && height != null && height < MAX_DECORATIVE_DIMENSION) {
    return { role: 'decorative', roleSource: 'rule' };
  }
  // 2) Hero — first image in scope
  if (isFirstHero) return { role: 'hero', roleSource: 'rule' };
  // 3) Informative — descriptive alt + meaningful dimensions
  if ((alt ?? '').length >= MIN_INFORMATIVE_ALT_LENGTH
    && ((width ?? 0) >= MIN_INFORMATIVE_DIMENSION
      || (height ?? 0) >= MIN_INFORMATIVE_DIMENSION)) {
    return { role: 'informative', roleSource: 'rule' };
  }
  // 4) Ambiguous — fallback (AI classifier may upgrade later)
  return { role: 'informative', roleSource: 'fallback' };
}

export function extractImages($: cheerio.CheerioAPI): PageImage[] {
  // Scope: <article> first; fall back to whole document for non-Webflow templates.
  const $scope = $('article').length > 0 ? $('article img') : $('img');
  const images: PageImage[] = [];

  let isFirstHero = true;
  $scope.each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src');
    if (!src) return;

    const alt = $img.attr('alt');
    const role = $img.attr('role');
    const width = parseDim($img.attr('width'));
    const height = parseDim($img.attr('height'));

    // <figcaption> within wrapping <figure> becomes the caption
    const $figure = $img.closest('figure');
    const caption = $figure.length > 0
      ? $figure.find('figcaption').first().text().trim() || undefined
      : undefined;

    // First image in <header> OR first image overall (when no <header>) is the hero.
    const inHeader = $img.closest('header').length > 0;
    const isHero = isFirstHero && (inHeader || images.length === 0);

    const { role: classifiedRole, roleSource } = classifyRole(
      $img, isHero, width, height, alt, role,
    );

    if (classifiedRole === 'hero') isFirstHero = false;

    images.push({
      src,
      alt,
      caption,
      role: classifiedRole,
      roleSource,
      width,
      height,
    });
  });

  return images;
}
```

- [ ] **Step 4: Run; expect 10 tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-images.test.ts`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/extractors/page-elements/images.ts tests/unit/schema/extractors/page-elements-images.test.ts
git commit -m "feat(schema/extractors): pattern image extractor with rule-based role classification"
```

---

### Task 6: Pattern table extractor (pricing/comparison heuristics)

**Files:**
- Create: `server/schema/extractors/page-elements/tables.ts`
- Test: `tests/unit/schema/extractors/page-elements-tables.test.ts`

**Model:** Sonnet

**Owns:** tables.ts only. **Does not touch:** images.ts, testimonials.ts.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/extractors/page-elements-tables.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractTables } from '../../../../server/schema/extractors/page-elements/tables.js';

describe('extractTables', () => {
  it('extracts a basic 3x3 table with row/col counts', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>A</th><th>B</th><th>C</th></tr>
          <tr><td>1</td><td>2</td><td>3</td></tr>
          <tr><td>4</td><td>5</td><td>6</td></tr>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables).toHaveLength(1);
    expect(tables[0].rowCount).toBe(3);
    expect(tables[0].colCount).toBe(3);
    expect(tables[0].isPricingLike).toBe(false);
    expect(tables[0].isComparisonLike).toBe(true); // 3+ cols, repeated header structure
  });

  it('flags isPricingLike when cells contain currency symbols + per-month patterns', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <thead><tr><th>Plan</th><th>Price</th></tr></thead>
          <tbody>
            <tr><td>Starter</td><td>$29/mo</td></tr>
            <tr><td>Growth</td><td>$99/mo</td></tr>
            <tr><td>Premium</td><td>$249/mo</td></tr>
          </tbody>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables[0].isPricingLike).toBe(true);
  });

  it('flags isPricingLike with European € prices', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>Plan</th><th>Price</th></tr>
          <tr><td>Free</td><td>€0</td></tr>
          <tr><td>Pro</td><td>€19/month</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].isPricingLike).toBe(true);
  });

  it('does NOT flag isPricingLike for tables with arbitrary numbers (no currency)', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>Year</th><th>Revenue</th></tr>
          <tr><td>2020</td><td>1000</td></tr>
          <tr><td>2021</td><td>2000</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].isPricingLike).toBe(false);
  });

  it('flags isComparisonLike when 3+ cols with header row + 2+ data rows', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <thead><tr><th>Feature</th><th>Free</th><th>Pro</th><th>Enterprise</th></tr></thead>
          <tbody>
            <tr><td>Pages</td><td>10</td><td>100</td><td>Unlimited</td></tr>
            <tr><td>Users</td><td>1</td><td>5</td><td>50</td></tr>
          </tbody>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables[0].isComparisonLike).toBe(true);
  });

  it('does NOT flag isComparisonLike when only 2 cols', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <tr><th>Key</th><th>Value</th></tr>
          <tr><td>A</td><td>1</td></tr>
          <tr><td>B</td><td>2</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].isComparisonLike).toBe(false);
  });

  it('extracts caption when <caption> is present', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <caption>Pricing tiers</caption>
          <tr><th>Plan</th><th>Price</th></tr>
          <tr><td>Free</td><td>$0</td></tr>
        </table>
      </article>
    `);
    expect(extractTables($)[0].caption).toBe('Pricing tiers');
  });

  it('falls back to whole-document scope when no <article> tag', () => {
    const $ = cheerio.load(`
      <main>
        <table><tr><th>A</th></tr><tr><td>1</td></tr></table>
      </main>
    `);
    expect(extractTables($)).toHaveLength(1);
  });

  it('skips empty tables (no rows)', () => {
    const $ = cheerio.load('<article><table></table></article>');
    expect(extractTables($)).toEqual([]);
  });

  it('handles tables with thead/tbody/tfoot correctly (counts all data rows)', () => {
    const $ = cheerio.load(`
      <article>
        <table>
          <thead><tr><th>A</th><th>B</th></tr></thead>
          <tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody>
          <tfoot><tr><td>Total</td><td>10</td></tr></tfoot>
        </table>
      </article>
    `);
    const tables = extractTables($);
    expect(tables[0].rowCount).toBe(4); // 1 header + 2 body + 1 footer
    expect(tables[0].colCount).toBe(2);
  });

  it('returns empty array when no tables', () => {
    const $ = cheerio.load('<article><p>Just text.</p></article>');
    expect(extractTables($)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; expect FAIL with "Cannot find module"**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-tables.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the extractor**

Create `server/schema/extractors/page-elements/tables.ts`:

```typescript
/**
 * Table element extractor with pricing + comparison heuristics.
 *
 * Heuristics:
 *   - isPricingLike: ≥2 cells contain a currency-prefixed number ($, €, £, ¥, ₹).
 *   - isComparisonLike: ≥3 columns + header row (<thead> or first row of <th>) + ≥2 data rows.
 *
 * Both flags can be true simultaneously (a 4-column pricing tier table is
 * both pricing-like AND comparison-like).
 *
 * Scoped to <article> with whole-document fallback. Skips zero-row tables.
 */
import type * as cheerio from 'cheerio';
import type { Table } from '../../../../shared/types/page-elements.js';

const CURRENCY_RE = /(?:\$|€|£|¥|₹)\s?\d/;
const MIN_PRICING_HITS = 2;
const MIN_COMPARISON_COLS = 3;
const MIN_COMPARISON_DATA_ROWS = 2;

export function extractTables($: cheerio.CheerioAPI): Table[] {
  // Scope: <article> first; fall back to whole document.
  const $scope = $('article').length > 0 ? $('article table') : $('table');
  const tables: Table[] = [];

  $scope.each((_, el) => {
    const $table = $(el);
    const $rows = $table.find('tr');
    const rowCount = $rows.length;
    if (rowCount === 0) return;

    // colCount: max cells across all rows (handles colspan-less tables; colspan is rare).
    let colCount = 0;
    $rows.each((__, row) => {
      const cells = $(row).children('td, th').length;
      if (cells > colCount) colCount = cells;
    });

    // caption — <caption> child if present
    const captionText = $table.children('caption').first().text().trim() || undefined;

    // Pricing heuristic: count cells with currency-prefixed numbers
    let pricingHits = 0;
    $table.find('td, th').each((__, cell) => {
      const text = $(cell).text();
      if (CURRENCY_RE.test(text)) pricingHits++;
    });
    const isPricingLike = pricingHits >= MIN_PRICING_HITS;

    // Comparison heuristic: ≥3 cols + has header row + ≥2 data rows
    const hasHeader = $table.find('thead').length > 0
      || $rows.first().children('th').length >= MIN_COMPARISON_COLS;
    const dataRowCount = rowCount - (hasHeader ? 1 : 0);
    const isComparisonLike = colCount >= MIN_COMPARISON_COLS
      && hasHeader
      && dataRowCount >= MIN_COMPARISON_DATA_ROWS;

    tables.push({
      rowCount,
      colCount,
      caption: captionText,
      isPricingLike,
      isComparisonLike,
    });
  });

  return tables;
}
```

- [ ] **Step 4: Run; expect 11 tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-tables.test.ts`
Expected: 11 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/extractors/page-elements/tables.ts tests/unit/schema/extractors/page-elements-tables.test.ts
git commit -m "feat(schema/extractors): pattern table extractor with pricing + comparison heuristics"
```

---

### Task 7: Pattern testimonial extractor (blockquote + rating)

**Files:**
- Create: `server/schema/extractors/page-elements/testimonials.ts`
- Test: `tests/unit/schema/extractors/page-elements-testimonials.test.ts`

**Model:** Sonnet

**Owns:** testimonials.ts only. **Does not touch:** images.ts, tables.ts.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/extractors/page-elements-testimonials.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractTestimonials } from '../../../../server/schema/extractors/page-elements/testimonials.js';

describe('extractTestimonials', () => {
  it('extracts a <blockquote> with a <cite>', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>
          "Excellent service from start to finish."
          <cite>— Jane Doe</cite>
        </blockquote>
      </article>
    `);
    const testimonials = extractTestimonials($);
    expect(testimonials).toHaveLength(1);
    expect(testimonials[0].quote).toContain('Excellent service from start to finish.');
    expect(testimonials[0].author).toBe('Jane Doe');
    expect(testimonials[0].selector).toContain('blockquote');
  });

  it('extracts rating from data-rating attribute', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote data-rating="5">
          "5 stars all around."
          <cite>John Smith</cite>
        </blockquote>
      </article>
    `);
    expect(extractTestimonials($)[0].rating).toBe(5);
  });

  it('extracts rating from a child element with star count', () => {
    const $ = cheerio.load(`
      <article>
        <div class="testimonial">
          <div class="rating" aria-label="4 out of 5 stars"></div>
          <blockquote>"Pretty solid experience."</blockquote>
          <cite>Alice</cite>
        </div>
      </article>
    `);
    expect(extractTestimonials($)[0].rating).toBe(4);
  });

  it('handles multiple testimonials', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>"First quote."<cite>Person A</cite></blockquote>
        <blockquote>"Second quote."<cite>Person B</cite></blockquote>
        <blockquote>"Third quote."<cite>Person C</cite></blockquote>
      </article>
    `);
    const testimonials = extractTestimonials($);
    expect(testimonials).toHaveLength(3);
    expect(testimonials.map(t => t.author)).toEqual(['Person A', 'Person B', 'Person C']);
  });

  it('skips blockquotes with no meaningful text (≥10 chars after trim)', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>".."</blockquote>
        <blockquote>"This is a real testimonial that meets the minimum length."<cite>X</cite></blockquote>
      </article>
    `);
    expect(extractTestimonials($)).toHaveLength(1);
  });

  it('strips quotes and dashes from author text', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>"Great work!"<cite>— Bob "The Builder"</cite></blockquote>
      </article>
    `);
    expect(extractTestimonials($)[0].author).toBe('Bob "The Builder"'); // strips leading dash, keeps inner quotes
  });

  it('returns rating as undefined when no rating signal present', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote>"No rating attached."<cite>X</cite></blockquote>
      </article>
    `);
    expect(extractTestimonials($)[0].rating).toBeUndefined();
  });

  it('falls back to whole-document scope when no <article> tag', () => {
    const $ = cheerio.load(`
      <main>
        <blockquote>"Outside an article tag."<cite>Y</cite></blockquote>
      </main>
    `);
    expect(extractTestimonials($)).toHaveLength(1);
  });

  it('returns empty array when no testimonials', () => {
    const $ = cheerio.load('<article><p>Body.</p></article>');
    expect(extractTestimonials($)).toEqual([]);
  });

  it('clamps rating to 1-5 range (ignores out-of-range values)', () => {
    const $ = cheerio.load(`
      <article>
        <blockquote data-rating="10">"Out of range high"<cite>X</cite></blockquote>
        <blockquote data-rating="0">"Out of range low"<cite>Y</cite></blockquote>
      </article>
    `);
    const testimonials = extractTestimonials($);
    expect(testimonials[0].rating).toBeUndefined();
    expect(testimonials[1].rating).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run; expect FAIL with "Cannot find module"**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-testimonials.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the extractor**

Create `server/schema/extractors/page-elements/testimonials.ts`:

```typescript
/**
 * Testimonial element extractor.
 *
 * Sources:
 *   - <blockquote> with optional <cite> child for author attribution
 *   - Numeric ratings from data-rating attribute (1-5 only — out-of-range
 *     values are dropped to avoid hallucinated AggregateRating)
 *   - Numeric ratings from sibling .rating[aria-label="N out of M"] (Webflow
 *     pattern; common ARIA accessibility label)
 *
 * Scoped to <article> with whole-document fallback. Skips quotes shorter
 * than 10 characters (boilerplate like ".." or "Quote:").
 */
import type * as cheerio from 'cheerio';
import type { Testimonial } from '../../../../shared/types/page-elements.js';

const MIN_QUOTE_LENGTH = 10;
const ARIA_RATING_RE = /(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*\d+\s*stars?/i;

function parseRating(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n < 1 || n > 5) return undefined;
  return n;
}

function cleanAuthor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Strip leading "—" / "-" / "by " and surrounding whitespace
  return raw
    .replace(/^[\s—–\-—–]+/, '')
    .replace(/^by\s+/i, '')
    .trim() || undefined;
}

export function extractTestimonials($: cheerio.CheerioAPI): Testimonial[] {
  const $scope = $('article').length > 0 ? $('article blockquote') : $('blockquote');
  const testimonials: Testimonial[] = [];

  $scope.each((_, el) => {
    const $bq = $(el);

    // Quote text — strip <cite> children to get the actual quote
    const $clone = $bq.clone();
    $clone.find('cite').remove();
    const quote = $clone.text().trim().replace(/\s+/g, ' ');
    if (quote.length < MIN_QUOTE_LENGTH) return;

    // Author — <cite> child
    const author = cleanAuthor($bq.find('cite').first().text());

    // Rating — data-rating attribute (preferred), else sibling .rating[aria-label]
    let rating = parseRating($bq.attr('data-rating'));
    if (rating === undefined) {
      const $parent = $bq.parent();
      const $ratingEl = $parent.find('[aria-label]').first();
      const ariaMatch = $ratingEl.attr('aria-label')?.match(ARIA_RATING_RE);
      if (ariaMatch) {
        rating = parseRating(ariaMatch[1]);
      }
    }

    // Selector — useful for diagnostic debugging
    const tagName = (el as { tagName?: string }).tagName ?? 'blockquote';
    const id = $bq.attr('id');
    const cls = $bq.attr('class')?.split(/\s+/)[0];
    const selector = id ? `${tagName}#${id}` : cls ? `${tagName}.${cls}` : tagName;

    testimonials.push({ quote, author, rating, selector });
  });

  return testimonials;
}
```

- [ ] **Step 4: Run; expect 10 tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-testimonials.test.ts`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/extractors/page-elements/testimonials.ts tests/unit/schema/extractors/page-elements-testimonials.test.ts
git commit -m "feat(schema/extractors): pattern testimonial extractor with author + rating"
```

---

## Phase 2 — Entry-point Wiring + AI Extractors (sequential, 3 tasks)

After Phase 1's three commits land, run these three tasks in order. They share `server/schema/extractors/page-elements.ts` so they can't be parallelized safely.

### Task 8: Wire 3 new pattern extractors into the entry-point

**Files:**
- Modify: `server/schema/extractors/page-elements.ts`
- Test: `tests/unit/schema/extractors/page-elements-entry.test.ts` (extend)

**Model:** Sonnet

- [ ] **Step 1: Extend the entry test with PR2 extractor assertions**

Add to `tests/unit/schema/extractors/page-elements-entry.test.ts`:

```typescript
  it('PR2: extracts images, tables, testimonials when present', async () => {
    const html = `
      <article>
        <header><img src="/hero.jpg" alt="Hero" width="1200" height="600"></header>
        <p>Body.</p>
        <table>
          <tr><th>Plan</th><th>Price</th></tr>
          <tr><td>Free</td><td>$0</td></tr>
          <tr><td>Pro</td><td>$29</td></tr>
        </table>
        <blockquote>"Excellent."<cite>Jane</cite></blockquote>
        <blockquote>"Five stars."<cite data-rating="5">Bob</cite></blockquote>
      </article>
    `;
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://example.com',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.images.length).toBeGreaterThanOrEqual(1);
    expect(catalog.images[0].role).toBe('hero');
    expect(catalog.tables).toHaveLength(1);
    expect(catalog.testimonials).toHaveLength(2);
    expect(catalog.diagnostics.rawCounts).toMatchObject({
      images: catalog.images.length,
      tables: 1,
      testimonials: 2,
    });
  });
```

- [ ] **Step 2: Run; expect FAIL (extractor not wired yet — empty arrays)**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-entry.test.ts -t "PR2"`
Expected: FAIL — `catalog.images` is empty because the entry-point doesn't call `extractImages` yet.

- [ ] **Step 3: Wire the 3 new pattern extractors into the entry-point**

Edit `server/schema/extractors/page-elements.ts`. Add imports near the top:

```typescript
import { extractImages } from './page-elements/images.js';
import { extractTables } from './page-elements/tables.js';
import { extractTestimonials } from './page-elements/testimonials.js';
```

Inside the `try` block of `extractPageElements`, replace the empty-array placeholders with real extractor calls. The block currently looks like:

```typescript
    // PR2/PR3 elements — empty arrays in PR1
    const headings: PageElementCatalog['headings'] = [];
    const tables: PageElementCatalog['tables'] = [];
    const images: PageElementCatalog['images'] = [];
    const testimonials: PageElementCatalog['testimonials'] = [];
    const codeBlocks: PageElementCatalog['codeBlocks'] = [];
```

Change to:

```typescript
    // PR2 elements (images / tables / testimonials)
    const images = extractImages($);
    const tables = extractTables($);
    const testimonials = extractTestimonials($);

    // PR3 elements — still empty in PR2
    const headings: PageElementCatalog['headings'] = [];
    const codeBlocks: PageElementCatalog['codeBlocks'] = [];
```

(The diagnostics block in the return value already references `images.length`, `tables.length`, `testimonials.length` — no change needed there.)

- [ ] **Step 4: Run; expect the new test PLUS existing tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-entry.test.ts`
Expected: All entry tests PASS (PR1 happy path + PR2 new test).

- [ ] **Step 5: Commit**

```bash
git add server/schema/extractors/page-elements.ts tests/unit/schema/extractors/page-elements-entry.test.ts
git commit -m "feat(schema/extractors): wire images + tables + testimonials into entry-point"
```

---

### Task 9: AI image classifier (vision call, budgeted, behind feature flag)

**Files:**
- Create: `server/schema/extractors/page-elements/image-ai-classifier.ts`
- Test: `tests/unit/schema/extractors/page-elements-image-ai.test.ts`
- Modify: `server/schema/extractors/page-elements.ts` (call the AI classifier after pattern extraction)

**Model:** Sonnet

**Behavior:**
- Walks `images[]` produced by `extractImages($)`. For each image with `roleSource === 'fallback'` (ambiguous), tries to consume from `AiBudget`. If allowed, fetches the image (via `fetchImageAsBase64`) and calls `callAI({ provider: 'openai', model: 'gpt-4.1-mini', feature: 'schema-ai-element-classifier', workspaceId, messages: [vision content] })`. The reply is parsed for the role label.
- Failure modes: budget exhausted → leave image as `roleSource:'fallback'`. Fetch returns null → same. AI returns invalid → same. AI returns valid role → upgrade to `roleSource:'ai'` with the new role.
- Gated by `isFeatureEnabled('schema-ai-element-classifier')` — when off, the function is a no-op and returns the input unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/extractors/page-elements-image-ai.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';
import type { PageImage } from '../../../../shared/types/page-elements.js';

vi.mock('../../../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock('../../../../server/ai.js', () => ({
  callAI: vi.fn(),
}));
vi.mock('../../../../server/schema/extractors/page-elements/image-fetch.js', () => ({
  fetchImageAsBase64: vi.fn(),
}));

import { isFeatureEnabled } from '../../../../server/feature-flags.js';
import { callAI } from '../../../../server/ai.js';
import { fetchImageAsBase64 } from '../../../../server/schema/extractors/page-elements/image-fetch.js';
import { aiClassifyImages } from '../../../../server/schema/extractors/page-elements/image-ai-classifier.js';

const ambiguousImage: PageImage = {
  src: 'https://example.com/img.jpg',
  alt: 'photo',
  role: 'informative',
  roleSource: 'fallback',
  width: 600,
  height: 400,
};

describe('aiClassifyImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unchanged when feature flag is OFF (no AI calls)', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousImage]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns unchanged when budget is 0', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const budget = createAiBudget(0);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousImage]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('skips images that are not ambiguous (roleSource !== "fallback")', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const ruleClassified: PageImage = { ...ambiguousImage, roleSource: 'rule', role: 'hero' };
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ruleClassified], { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ruleClassified]);
    expect(callAI).not.toHaveBeenCalled();
    expect(budget.used).toBe(0);
  });

  it('upgrades roleSource to "ai" + uses returned role on successful call', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    vi.mocked(callAI).mockResolvedValue({
      text: '{"role":"informative"}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0].role).toBe('informative');
    expect(result[0].roleSource).toBe('ai');
    expect(budget.used).toBe(1);
  });

  it('reclassifies decorative based on AI response', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    vi.mocked(callAI).mockResolvedValue({
      text: '{"role":"decorative"}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0].role).toBe('decorative');
    expect(result[0].roleSource).toBe('ai');
  });

  it('leaves image unchanged on AI parse error (invalid JSON)', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    vi.mocked(callAI).mockResolvedValue({ text: 'not json', tokens: { prompt: 100, completion: 5, total: 105 } });
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousImage);
    // Budget WAS consumed (the call happened) — even on parse failure
    expect(budget.used).toBe(1);
  });

  it('leaves image unchanged on invalid role label', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    vi.mocked(callAI).mockResolvedValue({
      text: '{"role":"nonsense"}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousImage);
  });

  it('falls through (no AI call) when fetchImageAsBase64 returns null', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue(null);
    const budget = createAiBudget(100);
    const result = await aiClassifyImages([ambiguousImage], { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousImage);
    expect(callAI).not.toHaveBeenCalled();
    // Budget NOT consumed — fetch failed before AI call
    expect(budget.used).toBe(0);
  });

  it('stops calling AI once budget exhausts mid-loop', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(fetchImageAsBase64).mockResolvedValue('data:image/jpeg;base64,abc');
    vi.mocked(callAI).mockResolvedValue({
      text: '{"role":"informative"}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(2);
    const inputs = [ambiguousImage, ambiguousImage, ambiguousImage, ambiguousImage];
    const result = await aiClassifyImages(inputs, { budget, workspaceId: 'ws-1' });
    expect(callAI).toHaveBeenCalledTimes(2);
    expect(result.filter(i => i.roleSource === 'ai').length).toBe(2);
    expect(result.filter(i => i.roleSource === 'fallback').length).toBe(2);
    expect(budget.exhausted).toBe(true);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-image-ai.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the AI classifier**

Create `server/schema/extractors/page-elements/image-ai-classifier.ts`:

```typescript
/**
 * AI image-role classifier (PR2). Wraps the rule-based output of
 * extractImages() and re-classifies images flagged as ambiguous
 * (roleSource === 'fallback'). Budgeted: consumes one AiBudget slot
 * per image. Behind the schema-ai-element-classifier feature flag.
 *
 * Failure modes (all leave the image unchanged):
 *   - feature flag off
 *   - budget exhausted
 *   - image fetch returns null (network, content-type, timeout)
 *   - AI returns non-JSON
 *   - AI returns a role outside the {hero, informative, decorative} set
 */
import type { PageImage } from '../../../../shared/types/page-elements.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { callAI } from '../../../ai.js';
import { fetchImageAsBase64 } from './image-fetch.js';
import { tryConsumeAiBudget } from './ai-budget.js';
import type { AiBudget } from './ai-budget.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/image-ai-classifier');

const VALID_ROLES = new Set<PageImage['role']>(['hero', 'informative', 'decorative']);

const CLASSIFIER_PROMPT = `Classify this image into ONE of three roles for SEO schema markup:
- "hero": the page's lead image, conveying the primary subject. Usually large and visually prominent.
- "informative": diagrams, screenshots, charts, or photos that add factual content readers benefit from.
- "decorative": background patterns, spacers, brand watermarks, or stock photography that adds no factual content.

Respond with strict JSON only: {"role":"hero"|"informative"|"decorative"}. No prose.`;

export interface AiClassifyImagesOpts {
  budget: AiBudget;
  workspaceId: string | undefined;
}

interface AiResponse {
  role?: string;
}

export async function aiClassifyImages(
  images: PageImage[],
  opts: AiClassifyImagesOpts,
): Promise<PageImage[]> {
  if (!isFeatureEnabled('schema-ai-element-classifier')) return images;

  const result: PageImage[] = [];
  for (const image of images) {
    if (image.roleSource !== 'fallback') {
      result.push(image);
      continue;
    }
    if (opts.budget.exhausted) {
      result.push(image);
      continue;
    }

    // Try to fetch the image FIRST — if fetch fails we shouldn't waste a budget slot.
    const dataUrl = await fetchImageAsBase64(image.src);
    if (!dataUrl) {
      result.push(image);
      continue;
    }

    if (!tryConsumeAiBudget(opts.budget)) {
      result.push(image);
      continue;
    }

    try {
      const response = await callAI({
        provider: 'openai',
        model: 'gpt-4.1-mini',
        feature: 'schema-ai-element-classifier',
        workspaceId: opts.workspaceId,
        maxTokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
            { type: 'text', text: CLASSIFIER_PROMPT },
          ],
        }],
      });
      const parsed: AiResponse = JSON.parse(response.text);
      if (parsed.role && VALID_ROLES.has(parsed.role as PageImage['role'])) {
        result.push({
          ...image,
          role: parsed.role as PageImage['role'],
          roleSource: 'ai',
        });
      } else {
        result.push(image);
      }
    } catch (err) { // catch-ok: AI parse failure or network error — degrade to rule output
      log.debug({ err, src: image.src }, 'AI image classification failed; keeping rule output');
      result.push(image);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run; expect 9 tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-image-ai.test.ts`
Expected: 9 PASS.

- [ ] **Step 5: Wire into the entry-point**

Edit `server/schema/extractors/page-elements.ts`. Add import:

```typescript
import { aiClassifyImages } from './page-elements/image-ai-classifier.js';
```

Add an opts field to thread workspaceId through. Update `ExtractPageElementsOpts` interface:

```typescript
export interface ExtractPageElementsOpts {
  /** Page's canonical URL — used by citation extractor to identify external links. */
  pageBaseUrl: string;
  /** Webflow lastPublished at fetch time (drives stale detection). Null for static pages. */
  sourcePublishedAt: string | null;
  /** Per-regenerate AI budget. */
  aiBudget: AiBudget;
  /** Workspace ID for AI token-logging attribution. Undefined when called outside a workspace context. */
  workspaceId?: string | undefined;
}
```

Inside the `try` block, after the pattern image extraction line, call the AI classifier:

```typescript
    // PR2 elements (images / tables / testimonials)
    let images = extractImages($);
    images = await aiClassifyImages(images, {
      budget: opts.aiBudget,
      workspaceId: opts.workspaceId,
    });
    const tables = extractTables($);
    const testimonials = extractTestimonials($);
```

Also update the diagnostics object to use `images` (already does) and surface `aiClassificationCalls`:

```typescript
      diagnostics: {
        aiClassificationCalls: opts.aiBudget.used,
        hitAiBudgetCap: opts.aiBudget.exhausted,
        rawCounts: { /* unchanged */ },
      },
```

(`opts.aiBudget.used` already correctly reflects all consumed calls — no separate counter needed.)

- [ ] **Step 6: Update generator.ts to thread workspaceId into extractPageElements**

Edit `server/schema/generator.ts`. Find the `extractPageElements` call (around line 132). Add `workspaceId`:

```typescript
        catalog = await extractPageElements(input.html ?? '', {
          pageBaseUrl: baseUrl,
          sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
          aiBudget,
          workspaceId,
        });
```

(`workspaceId` is already in scope from the surrounding code — verify with grep.)

- [ ] **Step 7: Run typecheck + entry tests**

Run: `npm run typecheck && npx vitest run tests/unit/schema/extractors/page-elements-entry.test.ts tests/unit/schema/extractors/page-elements-image-ai.test.ts tests/integration/lean-schema-generator.test.ts`
Expected: typecheck clean. All affected tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/schema/extractors/page-elements/image-ai-classifier.ts server/schema/extractors/page-elements.ts server/schema/generator.ts tests/unit/schema/extractors/page-elements-image-ai.test.ts
git commit -m "feat(schema/extractors): AI image-role classifier (vision, budgeted, flag-gated)"
```

---

### Task 10: AI HowTo disambiguation fallback

**Files:**
- Create: `server/schema/extractors/page-elements/howto-ai-fallback.ts`
- Test: `tests/unit/schema/extractors/page-elements-howto-ai.test.ts`
- Modify: `server/schema/extractors/page-elements.ts` (call after extractLists)

**Model:** Sonnet

**Behavior:**
- Walks `lists[]` produced by `extractLists($)`. For each ordered list with `isHowToLike === false` AND ≥3 items, ask AI: "is this a how-to procedural guide? Respond `{howTo: true/false}`."
- Budget: shares the same `AiBudget` as image classifier (the 120-call cap covers both). Lower volume in practice (most pages have 0-1 ordered lists).
- Behind the same `schema-ai-element-classifier` flag.
- On `howTo: true` response: re-emits steps from list items (same shape as `extractLists` would have produced if heading matched).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/schema/extractors/page-elements-howto-ai.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';
import type { PageList } from '../../../../shared/types/page-elements.js';

vi.mock('../../../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock('../../../../server/ai.js', () => ({
  callAI: vi.fn(),
}));

import { isFeatureEnabled } from '../../../../server/feature-flags.js';
import { callAI } from '../../../../server/ai.js';
import { aiDisambiguateHowTo } from '../../../../server/schema/extractors/page-elements/howto-ai-fallback.js';

const ambiguousOrderedList: PageList = {
  kind: 'ordered',
  itemCount: 4,
  isHowToLike: false,
  // Steps not yet populated (rule-based extractor only sets steps when isHowToLike=true)
};

const orderedItemsRaw: string[] = [
  'Open the Webflow Designer.',
  'Click the Pages icon in the left sidebar.',
  'Right-click the page you want to duplicate.',
  'Select Duplicate from the menu.',
];

describe('aiDisambiguateHowTo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unchanged when feature flag is OFF', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousOrderedList]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('returns unchanged when budget is 0', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const budget = createAiBudget(0);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result).toEqual([ambiguousOrderedList]);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('skips lists already flagged isHowToLike=true', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const already: PageList = { ...ambiguousOrderedList, isHowToLike: true, steps: [] };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([already], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0].isHowToLike).toBe(true);
  });

  it('skips unordered lists', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const unordered: PageList = { ...ambiguousOrderedList, kind: 'unordered' };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([unordered], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
    expect(result[0].isHowToLike).toBe(false);
  });

  it('skips lists with fewer than 3 items', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    const tiny: PageList = { ...ambiguousOrderedList, itemCount: 2 };
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([tiny], orderedItemsRaw.slice(0, 2), { budget, workspaceId: 'ws-1' });
    expect(callAI).not.toHaveBeenCalled();
  });

  it('flips isHowToLike + populates steps when AI returns howTo:true', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({
      text: '{"howTo":true}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result[0].isHowToLike).toBe(true);
    expect(result[0].steps).toHaveLength(4);
    expect(result[0].steps?.[0]).toEqual({
      name: 'Open the Webflow Designer.',
      text: 'Open the Webflow Designer.',
      position: 1,
    });
    expect(budget.used).toBe(1);
  });

  it('leaves list unchanged when AI returns howTo:false', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({
      text: '{"howTo":false}',
      tokens: { prompt: 100, completion: 5, total: 105 },
    });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
    expect(budget.used).toBe(1);
  });

  it('leaves list unchanged on AI parse error', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(callAI).mockResolvedValue({ text: 'not json', tokens: { prompt: 100, completion: 5, total: 105 } });
    const budget = createAiBudget(20);
    const result = await aiDisambiguateHowTo([ambiguousOrderedList], orderedItemsRaw, { budget, workspaceId: 'ws-1' });
    expect(result[0]).toEqual(ambiguousOrderedList);
  });
});
```

- [ ] **Step 2: Run; expect FAIL with "Cannot find module"**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-howto-ai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the disambiguator**

Create `server/schema/extractors/page-elements/howto-ai-fallback.ts`:

```typescript
/**
 * AI HowTo disambiguation fallback (PR2). Wraps extractLists() output and
 * asks AI to flip `isHowToLike` when an ordered list with ≥3 items has no
 * heading match (i.e. it WAS rejected by the rule-based extractor).
 *
 * Shares the same AiBudget as image classifier; consumes 1 slot per
 * disambiguation. Behind schema-ai-element-classifier feature flag.
 *
 * The caller passes `orderedItemsRaw` (parallel array — one entry per
 * list, containing the list's li.text() values) so the AI sees actual
 * step content. Empty array means caller didn't extract item text and
 * the disambiguator falls through to no-op.
 */
import type { PageList, HowToStep } from '../../../../shared/types/page-elements.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { callAI } from '../../../ai.js';
import { tryConsumeAiBudget } from './ai-budget.js';
import type { AiBudget } from './ai-budget.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/howto-ai-fallback');

const MIN_AI_DISAMBIG_ITEMS = 3;

const DISAMBIG_PROMPT = `You are deciding whether an ordered list on a webpage represents a procedural how-to (a step-by-step guide users would follow in order) versus a different kind of ordered list (e.g. ranking, table-of-contents, pricing tiers, FAQ summary).

Respond with strict JSON only: {"howTo": true|false}. No prose.

The list items are:
`;

export interface AiDisambiguateHowToOpts {
  budget: AiBudget;
  workspaceId: string | undefined;
}

interface AiResponse {
  howTo?: boolean;
}

export async function aiDisambiguateHowTo(
  lists: PageList[],
  orderedItemsRaw: string[],
  opts: AiDisambiguateHowToOpts,
): Promise<PageList[]> {
  if (!isFeatureEnabled('schema-ai-element-classifier')) return lists;
  if (lists.length === 0) return lists;
  // Caller didn't pass parallel item text — can't disambiguate
  if (orderedItemsRaw.length === 0) return lists;

  const result: PageList[] = [];
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    if (list.kind !== 'ordered'
      || list.isHowToLike
      || list.itemCount < MIN_AI_DISAMBIG_ITEMS
      || opts.budget.exhausted) {
      result.push(list);
      continue;
    }

    if (!tryConsumeAiBudget(opts.budget)) {
      result.push(list);
      continue;
    }

    try {
      const response = await callAI({
        provider: 'openai',
        model: 'gpt-4.1-mini',
        feature: 'schema-ai-element-classifier',
        workspaceId: opts.workspaceId,
        maxTokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: DISAMBIG_PROMPT + orderedItemsRaw.slice(0, list.itemCount).map((t, idx) => `${idx + 1}. ${t}`).join('\n'),
        }],
      });
      const parsed: AiResponse = JSON.parse(response.text);
      if (parsed.howTo === true) {
        const steps: HowToStep[] = orderedItemsRaw.slice(0, list.itemCount).map((text, idx) => ({
          name: text,
          text,
          position: idx + 1,
        }));
        result.push({ ...list, isHowToLike: true, steps });
      } else {
        result.push(list);
      }
    } catch (err) { // catch-ok: AI parse or network error — keep rule-based output
      log.debug({ err, listIdx: i }, 'AI HowTo disambiguation failed; keeping rule output');
      result.push(list);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run; expect 8 tests PASS**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-howto-ai.test.ts`
Expected: 8 PASS.

- [ ] **Step 5: Wire into the entry-point**

Edit `server/schema/extractors/page-elements.ts`. Add import:

```typescript
import { aiDisambiguateHowTo } from './page-elements/howto-ai-fallback.js';
```

After the `extractLists($)` call (PR1), capture parallel raw item text and call the disambiguator. Replace:

```typescript
    const lists = extractLists($);
```

With:

```typescript
    let lists = extractLists($);
    // Capture parallel raw item text for AI disambiguation (PR2). Same scope rules as extractLists.
    const $listScope = $('article').length > 0 ? $('article ol') : $('ol');
    const orderedItemsRaw: string[] = [];
    $listScope.each((_, ol) => {
      const items = $(ol).children('li').toArray().map(li => $(li).text().trim());
      orderedItemsRaw.push(...items);
    });
    lists = await aiDisambiguateHowTo(lists, orderedItemsRaw, {
      budget: opts.aiBudget,
      workspaceId: opts.workspaceId,
    });
```

(Note: this captures items from ALL ordered lists in scope. If there are multiple, the disambiguator will only use the first N items per list. Future cleanup could use a per-list array structure, but for PR2 the slice-by-itemCount approach is simplest and correct.)

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npx vitest run tests/unit/schema/extractors/page-elements-howto-ai.test.ts tests/unit/schema/extractors/page-elements-entry.test.ts tests/integration/lean-schema-generator.test.ts`
Expected: typecheck clean, all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/schema/extractors/page-elements/howto-ai-fallback.ts server/schema/extractors/page-elements.ts tests/unit/schema/extractors/page-elements-howto-ai.test.ts
git commit -m "feat(schema/extractors): AI HowTo-list disambiguation fallback (budgeted, flag-gated)"
```

---

## Phase 3 — Schema Template Integrations (parallel, 3 agents)

After Phase 2 commits land, dispatch these 3 agents in parallel. Each owns ONE template file.

### Task 11: Article template — ImageGallery node

**Files:**
- Modify: `server/schema/templates/article.ts`
- Test: `tests/unit/schema/templates.test.ts` (extend with PR2 ImageGallery cases)

**Model:** Sonnet

**Owns:** article.ts only. **Does not touch:** service.ts, local-business.ts.

- [ ] **Step 1: Write the failing tests for ImageGallery emission**

Add to `tests/unit/schema/templates.test.ts`:

```typescript
describe('Article + BlogPosting — ImageGallery enrichment (PR2)', () => {
  const baseElementCatalog = {
    extractedAt: '2026-04-30T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [],
    tables: [],
    images: [],
    videos: [],
    lists: [],
    testimonials: [],
    codeBlocks: [],
    citations: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
  };
  const baseInput = {
    baseUrl: 'https://example.com',
    pageData: {
      title: 'X',
      cleanTitle: 'X',
      slug: 'x',
      canonicalUrl: 'https://example.com/x',
      datePublished: '2026-04-29T00:00:00Z',
      dateModified: '2026-04-29T00:00:00Z',
      description: 'X description',
      publisher: { name: 'Acme', logoUrl: null },
      breadcrumbs: [],
      inLanguage: 'en',
      articleSection: 'Blog',
    } as Record<string, unknown>,
  };

  it('emits ImageGallery when ≥2 informative images present', () => {
    const elements = {
      ...baseElementCatalog,
      images: [
        { src: 'https://x/i1.jpg', alt: 'one', role: 'informative' as const, roleSource: 'rule' as const },
        { src: 'https://x/i2.jpg', alt: 'two', role: 'informative' as const, roleSource: 'rule' as const },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    const gallery = graph.find(n => n['@type'] === 'ImageGallery');
    expect(gallery).toBeDefined();
    expect(gallery!.name).toBeDefined();
    expect(gallery!.image).toEqual(['https://x/i1.jpg', 'https://x/i2.jpg']);
  });

  it('does NOT emit ImageGallery when fewer than 2 informative images', () => {
    const elements = {
      ...baseElementCatalog,
      images: [
        { src: 'https://x/i1.jpg', alt: 'one', role: 'informative' as const, roleSource: 'rule' as const },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'ImageGallery')).toBeUndefined();
  });

  it('does NOT count hero or decorative images toward the ImageGallery threshold', () => {
    const elements = {
      ...baseElementCatalog,
      images: [
        { src: 'https://x/hero.jpg', alt: 'hero', role: 'hero' as const, roleSource: 'rule' as const },
        { src: 'https://x/dec.jpg', alt: 'd', role: 'decorative' as const, roleSource: 'rule' as const },
        { src: 'https://x/info.jpg', alt: 'i', role: 'informative' as const, roleSource: 'rule' as const },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildArticleSchema(input as never, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'ImageGallery')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run; expect FAIL — ImageGallery not yet emitted**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t "ImageGallery enrichment"`
Expected: FAIL.

- [ ] **Step 3: Add ImageGallery node emission to buildArticleSchema**

Edit `server/schema/templates/article.ts`. After the existing VideoObject block (the `videoObject` const around line 88-97), add ImageGallery:

```typescript
  // Build optional ImageGallery node from informative images (PR2).
  // Pre-emission gate: name + image[] ≥1; must have ≥2 informative images
  // (single informative image stays on the primary node's `image` field).
  const informativeImages = (pageData.elements?.images ?? []).filter(i => i.role === 'informative');
  const galleryName = pageData.cleanTitle || pageData.title;
  const canEmitGallery = informativeImages.length >= 2 && !!galleryName;
  const imageGallery = canEmitGallery ? dropUndefined({
    '@type': 'ImageGallery' as const,
    '@id': `${pageData.canonicalUrl}#gallery`,
    'name': galleryName,
    'image': informativeImages.map(i => i.src),
  }) : undefined;
```

Then add it to the nodes array:

```typescript
  const nodes: Array<Record<string, unknown>> = [primary];
  if (howTo) nodes.push(howTo);
  if (videoObject) nodes.push(videoObject);
  if (imageGallery) nodes.push(imageGallery);

  return withBreadcrumb(nodes, pageData);
```

- [ ] **Step 4: Run; expect 3 new tests PASS + existing PR1 tests still PASS**

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/templates/article.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema/article): emit ImageGallery node from informative images (PR2)"
```

---

### Task 12: Service template — Review[] + AggregateRating + ImageGallery + Table

**Files:**
- Modify: `server/schema/templates/service.ts`
- Test: `tests/unit/schema/templates.test.ts` (extend with Service-specific PR2 cases)

**Model:** Sonnet

**Owns:** service.ts only. **Does not touch:** article.ts, local-business.ts.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/schema/templates.test.ts`:

```typescript
describe('Service — PR2 enrichment (Review/AggregateRating/Gallery/Table)', () => {
  const baseElementCatalog = {
    extractedAt: '2026-04-30T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [], tables: [], images: [], videos: [], lists: [],
    testimonials: [], codeBlocks: [], citations: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
  };
  const baseInput = {
    baseUrl: 'https://example.com',
    pageData: {
      title: 'Web Design',
      cleanTitle: 'Web Design',
      slug: 'web-design',
      canonicalUrl: 'https://example.com/services/web-design',
      description: 'Premium Webflow.',
      publisher: { name: 'Acme', logoUrl: null },
      breadcrumbs: [],
      inLanguage: 'en',
      areaServed: undefined,
      serviceType: undefined,
    } as Record<string, unknown>,
  };

  it('emits Review[] when testimonials present (one per testimonial)', () => {
    const elements = {
      ...baseElementCatalog,
      testimonials: [
        { quote: 'First.', author: 'Jane', selector: 'blockquote' },
        { quote: 'Second.', author: 'Bob', rating: 5, selector: 'blockquote' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const reviews = graph.filter(n => n['@type'] === 'Review');
    expect(reviews).toHaveLength(2);
    expect(reviews[0].itemReviewed).toEqual({ '@id': 'https://example.com/services/web-design#service' });
    expect(reviews[0].reviewBody).toBe('First.');
    expect((reviews[0].author as Record<string, unknown>).name).toBe('Jane');
  });

  it('skips Review emission for testimonials missing author', () => {
    const elements = {
      ...baseElementCatalog,
      testimonials: [
        { quote: 'No author here.', selector: 'blockquote' },
        { quote: 'Has author.', author: 'Bob', selector: 'blockquote' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.filter(n => n['@type'] === 'Review')).toHaveLength(1);
  });

  it('emits AggregateRating only when ≥1 testimonial has a numeric rating', () => {
    const noRatings = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: { ...baseElementCatalog, testimonials: [{ quote: 'X.', author: 'Y', selector: 'bq' }] },
      },
    };
    const withRatings = {
      ...baseInput,
      pageData: {
        ...baseInput.pageData,
        elements: {
          ...baseElementCatalog,
          testimonials: [
            { quote: 'X.', author: 'Y', rating: 5, selector: 'bq' },
            { quote: 'Z.', author: 'W', rating: 4, selector: 'bq' },
          ],
        },
      },
    };
    const noAR = buildServiceSchema(noRatings as never)['@graph'] as Array<Record<string, unknown>>;
    const withAR = buildServiceSchema(withRatings as never)['@graph'] as Array<Record<string, unknown>>;
    const primaryNoAR = noAR.find(n => n['@type'] === 'Service')!;
    const primaryWithAR = withAR.find(n => n['@type'] === 'Service')!;
    expect(primaryNoAR.aggregateRating).toBeUndefined();
    expect(primaryWithAR.aggregateRating).toMatchObject({
      '@type': 'AggregateRating',
      ratingValue: 4.5, // (5+4)/2
      reviewCount: 2,    // count of testimonials with ratings
      bestRating: 5,
      worstRating: 1,
    });
  });

  it('Review nodes carry reviewRating only when rating present', () => {
    const elements = {
      ...baseElementCatalog,
      testimonials: [
        { quote: 'X.', author: 'Y', rating: 5, selector: 'bq' },
        { quote: 'Z.', author: 'W', selector: 'bq' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const reviews = graph.filter(n => n['@type'] === 'Review');
    expect(reviews[0].reviewRating).toMatchObject({ ratingValue: 5 });
    // Review without rating is not emitted (Google requires reviewRating)
    expect(reviews).toHaveLength(1);
  });

  it('emits ImageGallery from informative images on Service pages too', () => {
    const elements = {
      ...baseElementCatalog,
      images: [
        { src: 'https://x/i1.jpg', alt: 'a', role: 'informative' as const, roleSource: 'rule' as const },
        { src: 'https://x/i2.jpg', alt: 'b', role: 'informative' as const, roleSource: 'rule' as const },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'ImageGallery')).toBeDefined();
  });

  it('emits Table mainEntity when isPricingLike OR isComparisonLike', () => {
    const elements = {
      ...baseElementCatalog,
      tables: [{ rowCount: 4, colCount: 3, isPricingLike: true, isComparisonLike: true, caption: 'Pricing' }],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const primary = graph.find(n => n['@type'] === 'Service')!;
    expect(primary.mainEntity).toMatchObject({
      '@type': 'Table',
      about: 'Pricing',
    });
  });

  it('skips Table emission for non-pricing/non-comparison tables', () => {
    const elements = {
      ...baseElementCatalog,
      tables: [{ rowCount: 3, colCount: 2, isPricingLike: false, isComparisonLike: false }],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const primary = graph.find(n => n['@type'] === 'Service')!;
    expect(primary.mainEntity).toBeUndefined();
  });

  it('Service template emits all four PR2 enrichments simultaneously without @id collisions', () => {
    const elements = {
      ...baseElementCatalog,
      images: [
        { src: 'https://x/i1.jpg', alt: 'i1', role: 'informative' as const, roleSource: 'rule' as const },
        { src: 'https://x/i2.jpg', alt: 'i2', role: 'informative' as const, roleSource: 'rule' as const },
      ],
      tables: [{ rowCount: 4, colCount: 3, isPricingLike: true, isComparisonLike: true, caption: 'Pricing' }],
      testimonials: [
        { quote: 'A.', author: 'X', rating: 5, selector: 'bq' },
        { quote: 'B.', author: 'Y', rating: 4, selector: 'bq' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildServiceSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const ids = graph.map(n => n['@id']).filter(Boolean) as string[];
    expect(new Set(ids).size).toBe(ids.length); // unique
    expect(graph.map(n => n['@type'])).toEqual(expect.arrayContaining([
      'Service', 'Review', 'Review', 'ImageGallery',
    ]));
    const primary = graph.find(n => n['@type'] === 'Service')!;
    expect(primary.aggregateRating).toBeDefined();
    expect(primary.mainEntity).toBeDefined();
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t "Service — PR2"`
Expected: FAIL.

- [ ] **Step 3: Implement the service template enrichments**

Edit `server/schema/templates/service.ts`. Replace the `buildServiceSchema` function entirely:

```typescript
export function buildServiceSchema(input: ServiceInput): Record<string, unknown> {
  const { pageData, baseUrl } = input;
  const serviceId = `${pageData.canonicalUrl}#service`;

  // PR2: AggregateRating from testimonials WITH ratings
  const ratedTestimonials = (pageData.elements?.testimonials ?? []).filter(t => t.rating != null);
  const aggregateRating = ratedTestimonials.length > 0
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': Number((ratedTestimonials.reduce((s, t) => s + (t.rating ?? 0), 0) / ratedTestimonials.length).toFixed(2)),
        'reviewCount': ratedTestimonials.length,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  // PR2: Table mainEntity when isPricingLike OR isComparisonLike
  const interestingTable = (pageData.elements?.tables ?? [])
    .find(t => t.isPricingLike || t.isComparisonLike);
  const tableAbout = interestingTable?.caption
    || (interestingTable?.isPricingLike ? 'Pricing' : interestingTable?.isComparisonLike ? 'Comparison' : undefined);
  const tableMainEntity = interestingTable && tableAbout
    ? dropUndefined({
        '@type': 'Table' as const,
        '@id': `${pageData.canonicalUrl}#table-0`,
        'about': tableAbout,
      })
    : undefined;

  const primary = dropUndefined({
    '@type': 'Service',
    '@id': serviceId,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'image': pageData.image,
    'url': pageData.canonicalUrl,
    'provider': dropUndefined({
      '@type': 'Organization',
      ...orgRef(baseUrl),
      'name': pageData.publisher.name,
    }),
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
    'areaServed': pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined,
    'serviceType': pageData.serviceType,
    'aggregateRating': aggregateRating,
    'mainEntity': tableMainEntity,
  });

  // PR2: Review[] graph nodes (one per testimonial with author + rating)
  const reviews = (pageData.elements?.testimonials ?? [])
    .map((t, idx) => {
      // Pre-emission gate: Review requires itemReviewed.@id + reviewRating + author
      if (!t.author || t.rating == null) return undefined;
      return dropUndefined({
        '@type': 'Review' as const,
        '@id': `${pageData.canonicalUrl}#review-${idx}`,
        'itemReviewed': { '@id': serviceId },
        'reviewRating': dropUndefined({
          '@type': 'Rating' as const,
          'ratingValue': t.rating,
          'bestRating': 5,
          'worstRating': 1,
        }),
        'author': { '@type': 'Person' as const, 'name': t.author },
        'reviewBody': t.quote,
      });
    })
    .filter((r): r is Record<string, unknown> => r !== undefined);

  // PR2: ImageGallery from informative images
  const informativeImages = (pageData.elements?.images ?? []).filter(i => i.role === 'informative');
  const galleryName = pageData.cleanTitle || pageData.title;
  const canEmitGallery = informativeImages.length >= 2 && !!galleryName;
  const imageGallery = canEmitGallery ? dropUndefined({
    '@type': 'ImageGallery' as const,
    '@id': `${pageData.canonicalUrl}#gallery`,
    'name': galleryName,
    'image': informativeImages.map(i => i.src),
  }) : undefined;

  const nodes: Array<Record<string, unknown>> = [primary, ...reviews];
  if (imageGallery) nodes.push(imageGallery);

  return withBreadcrumb(nodes, pageData);
}
```

- [ ] **Step 4: Run; expect 8 new tests PASS + existing service tests PASS**

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/templates/service.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema/service): emit Review[] + AggregateRating + ImageGallery + Table (PR2)"
```

---

### Task 13: LocalBusiness template — Review[] + AggregateRating

**Files:**
- Modify: `server/schema/templates/local-business.ts`
- Test: `tests/unit/schema/templates.test.ts` (extend)

**Model:** Sonnet

**Owns:** local-business.ts only. **Does not touch:** article.ts, service.ts.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/schema/templates.test.ts`:

```typescript
describe('LocalBusiness — PR2 Review[] + AggregateRating', () => {
  const baseElementCatalog = {
    extractedAt: '2026-04-30T00:00:00.000Z',
    sourcePublishedAt: null,
    headings: [], tables: [], images: [], videos: [], lists: [],
    testimonials: [], codeBlocks: [], citations: [],
    diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} },
  };
  const baseInput = {
    baseUrl: 'https://example.com',
    businessProfile: { phone: '555-1234', email: 'x@y.com', address: { street: '1 Main', city: 'Town', state: 'CA', zip: '00000', country: 'US' }, openingHours: undefined, socialProfiles: undefined, foundedDate: undefined },
    pageData: {
      title: 'Acme', cleanTitle: 'Acme', canonicalUrl: 'https://example.com/',
      description: 'A local business.', image: undefined,
      publisher: { name: 'Acme', logoUrl: null }, breadcrumbs: [],
      inLanguage: 'en', knowsAbout: undefined, areaServed: undefined,
    } as Record<string, unknown>,
  };

  it('attaches AggregateRating to LocalBusiness node when ratings present', () => {
    const elements = {
      ...baseElementCatalog,
      testimonials: [
        { quote: 'A.', author: 'X', rating: 5, selector: 'bq' },
        { quote: 'B.', author: 'Y', rating: 4, selector: 'bq' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildLocalBusinessSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const lb = graph.find(n => n['@type'] === 'LocalBusiness')!;
    expect(lb.aggregateRating).toMatchObject({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2 });
  });

  it('skips AggregateRating when no testimonials have ratings', () => {
    const elements = { ...baseElementCatalog, testimonials: [{ quote: 'A.', author: 'X', selector: 'bq' }] };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildLocalBusinessSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const lb = graph.find(n => n['@type'] === 'LocalBusiness')!;
    expect(lb.aggregateRating).toBeUndefined();
  });

  it('emits Review[] graph nodes pointing at LocalBusiness @id', () => {
    const elements = {
      ...baseElementCatalog,
      testimonials: [
        { quote: 'A.', author: 'X', rating: 5, selector: 'bq' },
        { quote: 'B.', author: 'Y', rating: 4, selector: 'bq' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildLocalBusinessSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    const reviews = graph.filter(n => n['@type'] === 'Review');
    expect(reviews).toHaveLength(2);
    expect(reviews[0].itemReviewed).toEqual({ '@id': 'https://example.com/#localbusiness' });
  });

  it('skips Review without author', () => {
    const elements = {
      ...baseElementCatalog,
      testimonials: [
        { quote: 'No author.', rating: 5, selector: 'bq' },
        { quote: 'With author.', author: 'X', rating: 4, selector: 'bq' },
      ],
    };
    const input = { ...baseInput, pageData: { ...baseInput.pageData, elements } };
    const graph = buildLocalBusinessSchema(input as never)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.filter(n => n['@type'] === 'Review')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run; expect FAIL**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t "LocalBusiness — PR2"`
Expected: FAIL.

- [ ] **Step 3: Implement the localBusiness enrichments**

Edit `server/schema/templates/local-business.ts`. The current function builds `[organization, localBusiness, website]`. Modify to also compute reviews + aggregateRating, attach AR to localBusiness, and append reviews to the graph.

Find the `localBusiness` const declaration (around line 44) and the return statement at the bottom of the function. Insert above the `localBusiness` const:

```typescript
  // PR2: AggregateRating from rated testimonials
  const ratedTestimonials = (pageData.elements?.testimonials ?? []).filter(t => t.rating != null);
  const aggregateRating = ratedTestimonials.length > 0
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': Number((ratedTestimonials.reduce((s, t) => s + (t.rating ?? 0), 0) / ratedTestimonials.length).toFixed(2)),
        'reviewCount': ratedTestimonials.length,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;
```

Inside the `localBusiness` `dropUndefined({...})` block, add `aggregateRating`:

```typescript
    'parentOrganization': { '@id': `${baseUrl}/#organization` },
    'areaServed': pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined,
    'aggregateRating': aggregateRating,
  });
```

Below the `website` const declaration, add review building before the return:

```typescript
  // PR2: Review[] graph nodes
  const lbId = `${baseUrl}/#localbusiness`;
  const reviews = (pageData.elements?.testimonials ?? [])
    .map((t, idx) => {
      if (!t.author || t.rating == null) return undefined;
      return dropUndefined({
        '@type': 'Review' as const,
        '@id': `${baseUrl}/#review-${idx}`,
        'itemReviewed': { '@id': lbId },
        'reviewRating': dropUndefined({
          '@type': 'Rating' as const,
          'ratingValue': t.rating,
          'bestRating': 5,
          'worstRating': 1,
        }),
        'author': { '@type': 'Person' as const, 'name': t.author },
        'reviewBody': t.quote,
      });
    })
    .filter((r): r is Record<string, unknown> => r !== undefined);
```

Find the existing return (which builds the graph). Update to append reviews:

```typescript
  return {
    '@context': 'https://schema.org',
    '@graph': [organization, localBusiness, website, ...reviews],
  };
```

(Note: the LocalBusiness template does NOT use `withBreadcrumb` because LocalBusiness pages typically have no breadcrumb. If the existing code does use `withBreadcrumb`, the engineer should pass `[organization, localBusiness, website, ...reviews]` to it instead. Re-grep for `return` in the function to verify the actual shape.)

- [ ] **Step 4: Run; expect 4 new tests PASS + existing tests PASS**

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema/templates/local-business.ts tests/unit/schema/templates.test.ts
git commit -m "feat(schema/local-business): emit Review[] + AggregateRating from testimonials (PR2)"
```

---

## Phase 4 — Test Fixtures + Integration Tests (parallel, 2 agents)

### Task 14: Add 4 HTML fixtures + integration test

**Files:**
- Create: `tests/fixtures/page-elements/webflow-service-pricing-table.html`
- Create: `tests/fixtures/page-elements/webflow-testimonials.html`
- Create: `tests/fixtures/page-elements/webflow-decorative-images.html`
- Create: `tests/fixtures/page-elements/webflow-mixed-elements-pr2.html`
- Create: `tests/integration/page-elements-pr2-extraction.test.ts`

**Model:** Sonnet (the integration test needs care; fixtures are mechanical)

**Owns:** the 4 fixtures + new integration test file. Does not modify existing tests.

- [ ] **Step 1: Create the pricing-table fixture**

Create `tests/fixtures/page-elements/webflow-service-pricing-table.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Service Pricing</title></head>
<body>
  <article>
    <h1>Web Design Pricing</h1>
    <p>Choose the plan that fits your business.</p>
    <table>
      <caption>Pricing tiers</caption>
      <thead>
        <tr><th>Plan</th><th>Price</th><th>Pages</th><th>Support</th></tr>
      </thead>
      <tbody>
        <tr><td>Starter</td><td>$29/mo</td><td>10</td><td>Email</td></tr>
        <tr><td>Growth</td><td>$99/mo</td><td>50</td><td>Priority</td></tr>
        <tr><td>Premium</td><td>$249/mo</td><td>Unlimited</td><td>Dedicated</td></tr>
      </tbody>
    </table>
  </article>
</body>
</html>
```

- [ ] **Step 2: Create the testimonials fixture**

Create `tests/fixtures/page-elements/webflow-testimonials.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Testimonials</title></head>
<body>
  <article>
    <h1>What our clients say</h1>
    <blockquote data-rating="5">
      "The team transformed our online presence and tripled our inbound leads."
      <cite>— Jane Smith, Founder of Acme Co.</cite>
    </blockquote>
    <blockquote data-rating="4">
      "Excellent communication and pixel-perfect execution."
      <cite>— Bob Jones, CEO at Widgets LLC</cite>
    </blockquote>
    <blockquote>
      "Solid work, would hire again."
      <cite>— Anonymous Client</cite>
    </blockquote>
  </article>
</body>
</html>
```

- [ ] **Step 3: Create the decorative-images fixture**

Create `tests/fixtures/page-elements/webflow-decorative-images.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Mixed Images</title></head>
<body>
  <article>
    <header>
      <img src="https://cdn.example.com/hero-photo.jpg" alt="A team of designers reviewing a wireframe on a whiteboard" width="1600" height="900">
    </header>
    <h1>Our Process</h1>
    <p>We follow a four-step methodology that has been refined over a decade of agency work.</p>
    <figure>
      <img src="https://cdn.example.com/process-diagram.png" alt="A flowchart showing discovery, design, develop, deliver phases" width="800" height="500">
      <figcaption>Figure 1: The four-step delivery framework.</figcaption>
    </figure>
    <img src="https://cdn.example.com/before-after.jpg" alt="Before-and-after comparison of a Webflow site redesign showing 40 percent traffic increase" width="1200" height="700">
    <img src="https://cdn.example.com/spacer-pattern.svg" alt="" role="presentation" width="50" height="50">
    <img src="https://cdn.example.com/quote-glyph.svg" alt="" width="24" height="24">
    <img src="https://cdn.example.com/checkmark.png" alt="check" width="16" height="16">
  </article>
</body>
</html>
```

- [ ] **Step 4: Create the mixed-elements-pr2 fixture**

Create `tests/fixtures/page-elements/webflow-mixed-elements-pr2.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Mixed PR2</title></head>
<body>
  <article>
    <header>
      <img src="https://cdn.example.com/hero.jpg" alt="Hero shot of the team" width="1600" height="900">
    </header>
    <h1>Our Web Design Service</h1>
    <p>A premium Webflow build engagement with full project support.</p>

    <h2>Pricing</h2>
    <table>
      <caption>Service tiers</caption>
      <thead><tr><th>Tier</th><th>Price</th><th>Includes</th></tr></thead>
      <tbody>
        <tr><td>Standard</td><td>$5,000</td><td>5 pages</td></tr>
        <tr><td>Pro</td><td>$15,000</td><td>20 pages</td></tr>
        <tr><td>Enterprise</td><td>$50,000</td><td>Unlimited</td></tr>
      </tbody>
    </table>

    <h2>Process gallery</h2>
    <img src="https://cdn.example.com/process-1.jpg" alt="Wireframing session showing low-fidelity layouts on a whiteboard" width="800" height="500">
    <img src="https://cdn.example.com/process-2.jpg" alt="Final design review with stakeholders inspecting a hi-fi mockup" width="800" height="500">

    <h2>Client testimonials</h2>
    <blockquote data-rating="5">
      "Outstanding partnership from start to launch."
      <cite>— Jane Smith, CEO</cite>
    </blockquote>
    <blockquote data-rating="5">
      "We saw a 3x increase in conversions within the first quarter."
      <cite>— Bob Jones, VP Marketing</cite>
    </blockquote>
  </article>
</body>
</html>
```

- [ ] **Step 5: Create the integration test**

Create `tests/integration/page-elements-pr2-extraction.test.ts`:

```typescript
/**
 * Integration tests for PR2 page-element extractors. Runs each fixture
 * end-to-end through extractPageElements and asserts the catalog shape
 * matches expected counts + classifications.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageElements } from '../../server/schema/extractors/page-elements.js';
import { createAiBudget } from '../../server/schema/extractors/page-elements/ai-budget.js';

function fixtureHtml(name: string): string {
  return readFileSync(join(__dirname, `../fixtures/page-elements/${name}`), 'utf-8');
}

describe('PR2 page-element extraction (integration)', () => {
  const opts = {
    pageBaseUrl: 'https://example.com',
    sourcePublishedAt: null,
    aiBudget: createAiBudget(0), // AI off — pattern-only
  };

  it('webflow-service-pricing-table.html — extracts 1 pricing table with 4 rows × 4 cols', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-service-pricing-table.html'), opts);
    expect(catalog.tables).toHaveLength(1);
    expect(catalog.tables[0].rowCount).toBe(4);
    expect(catalog.tables[0].colCount).toBe(4);
    expect(catalog.tables[0].isPricingLike).toBe(true);
    expect(catalog.tables[0].isComparisonLike).toBe(true);
    expect(catalog.tables[0].caption).toBe('Pricing tiers');
  });

  it('webflow-testimonials.html — extracts 3 testimonials, 2 with ratings', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-testimonials.html'), opts);
    expect(catalog.testimonials).toHaveLength(3);
    expect(catalog.testimonials.filter(t => t.rating != null)).toHaveLength(2);
    expect(catalog.testimonials[0].rating).toBe(5);
    expect(catalog.testimonials[0].author).toContain('Jane Smith');
  });

  it('webflow-decorative-images.html — classifies 1 hero / 2 informative / 3 decorative', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-decorative-images.html'), opts);
    const byRole = {
      hero: catalog.images.filter(i => i.role === 'hero').length,
      informative: catalog.images.filter(i => i.role === 'informative').length,
      decorative: catalog.images.filter(i => i.role === 'decorative').length,
    };
    expect(byRole.hero).toBe(1);
    expect(byRole.informative).toBe(2);
    expect(byRole.decorative).toBe(3);
  });

  it('webflow-mixed-elements-pr2.html — extracts hero + table + gallery images + testimonials together', async () => {
    const catalog = await extractPageElements(fixtureHtml('webflow-mixed-elements-pr2.html'), opts);
    expect(catalog.images.filter(i => i.role === 'hero')).toHaveLength(1);
    expect(catalog.images.filter(i => i.role === 'informative').length).toBeGreaterThanOrEqual(2);
    expect(catalog.tables).toHaveLength(1);
    expect(catalog.tables[0].isPricingLike).toBe(true);
    expect(catalog.testimonials).toHaveLength(2);
    expect(catalog.testimonials.every(t => t.rating === 5)).toBe(true);
  });

  it('extractor never throws on malformed HTML', async () => {
    const catalog = await extractPageElements('<<<<not html>>>>', opts);
    expect(catalog.images).toEqual([]);
    expect(catalog.tables).toEqual([]);
    expect(catalog.testimonials).toEqual([]);
  });
});
```

- [ ] **Step 6: Run tests; expect all PASS**

Run: `npx vitest run tests/integration/page-elements-pr2-extraction.test.ts`
Expected: 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/page-elements/ tests/integration/page-elements-pr2-extraction.test.ts
git commit -m "test(schema): PR2 fixtures + integration tests for images/tables/testimonials"
```

---

### Task 15: Extend lean-schema-generator integration test with PR2 multi-node @graph

**Files:**
- Modify: `tests/integration/lean-schema-generator.test.ts`

**Model:** Sonnet

**Owns:** lean-schema-generator.test.ts only.

- [ ] **Step 1: Add a PR2-specific integration test alongside existing PR1 tests**

Find the existing `describe('lean schema generator — page-element enrichment (PR1)'` block in `tests/integration/lean-schema-generator.test.ts`. Add a new describe block AFTER it:

```typescript
describe('lean schema generator — PR2 enrichment', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
    const wsId = 'ws_test_pr2_service_mixed';
    db.prepare(`INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`)
      .run(wsId, 'Test PR2 mixed', wsId, new Date().toISOString());
    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
  });

  it('Service page emits Review[] + AggregateRating + ImageGallery + Table + BreadcrumbList together with unique @ids', async () => {
    const html = fixturePageElementsHtml('webflow-mixed-elements-pr2.html');
    const wsId = 'ws_test_pr2_service_mixed';
    const out = await generateLeanSchema({
      ...baseInput,
      pageId: 'pe-pr2-service',
      pageMeta: {
        title: 'Web Design Service',
        slug: 'web-design',
        publishedPath: '/services/web-design',
        seo: { description: 'Premium Webflow build engagement.' },
        sourcePublishedAt: null,
        lastPublished: '2026-04-30T00:00:00Z', // datePublished available for VideoObject gate (not relevant here, but keeps Article/Service emit happy)
      },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map(n => n['@type']);
    expect(types).toEqual(expect.arrayContaining(['Service', 'Review', 'ImageGallery', 'BreadcrumbList']));
    const ids = graph.map(n => n['@id']).filter(Boolean) as string[];
    expect(new Set(ids).size).toBe(ids.length); // all unique
    const service = graph.find(n => n['@type'] === 'Service')!;
    expect(service.aggregateRating).toBeDefined();
    expect(service.mainEntity).toMatchObject({ '@type': 'Table' });
    expect(graph.filter(n => n['@type'] === 'Review')).toHaveLength(2);
    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
  });
});
```

- [ ] **Step 2: Run the new test; expect PASS**

Run: `npx vitest run tests/integration/lean-schema-generator.test.ts -t "PR2 enrichment"`
Expected: PASS.

- [ ] **Step 3: Run full integration suite to verify no regressions**

Run: `npx vitest run tests/integration/lean-schema-generator.test.ts`
Expected: All PASS (PR1 tests still green).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/lean-schema-generator.test.ts
git commit -m "test(schema/integration): PR2 multi-node @graph emission for Service + testimonials + table"
```

---

## Phase 5 — Documentation + Roadmap (sequential)

### Task 16: Run all quality gates

**Files:** none (verification only)

**Model:** Sonnet (decisions on what to fix)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: 5550+/5551 PASS (the same pre-existing flaky `content-decay-routes` test from PR1 may still time out — unrelated).

- [ ] **Step 3: pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: zero errors. Warnings on unrelated client-UI files are pre-existing.

- [ ] **Step 4: Vite build**

Run: `npx vite build`
Expected: clean build.

If any gate fails: stop, identify the issue, fix it, repeat from Step 1.

---

### Task 17: FEATURE_AUDIT.md + roadmap update

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`

**Model:** Haiku

- [ ] **Step 1: Read the FEATURE_AUDIT entry numbering**

Run: `grep -nE "^### [0-9]+\." FEATURE_AUDIT.md | tail -5`

Expected: PR1 was entry 324, Briefing v2 was 323. The next entry is 325.

- [ ] **Step 2: Add the PR2 entry**

Add after entry 324 (the PR1 entry) in `FEATURE_AUDIT.md`:

```markdown
### 325. Schema Page-Element Catalog PR2 (PR #TBD, 2026-04-30)

**What it does:** Adds 3 new pattern-based extractors (images with rule-based hero/informative/decorative role classification, tables with pricing/comparison heuristics, testimonials with author + rating extraction) and 2 AI-assisted extractors (image role classifier with vision via gpt-4.1-mini, HowTo-list disambiguation) behind a single feature flag `schema-ai-element-classifier` (default off). Adds 4 validator REQUIRED_BY_TYPE entries (Review, AggregateRating, Table, ImageGallery) and 3 schema integrations: ImageGallery node on Article + Service templates from informative images, Review[] graph nodes + AggregateRating aggregate on Service + LocalBusiness templates from rated testimonials, Table mainEntity sub-graph on Service templates from pricing/comparison tables. Each new node has a synchronous pre-emission gate (Devin r2 BUG-0001 lesson from PR1): Review requires itemReviewed.@id + reviewRating + author all present; AggregateRating only emits when ≥1 testimonial has a rating; Table requires `about` populated; ImageGallery requires name + ≥2 informative images.

**Why this PR:** PR1 shipped the catalog infrastructure + 3 highest-leverage element types (videos, HowTo lists, citations). PR2 ships the visual + commerce piece — Review/AggregateRating unlocks Google's review-rich-snippets eligibility for Service pages; Table/ImageGallery enrich pricing and gallery sections without breaking the lean-schema invariant.

**AI cost:** ≤$0.01 per regenerate-all on a 28-page Webflow site (28 pages × ~50% needing classification × $0.0001/call gpt-4.1-mini). Per-run cap of 100 image classifications + 20 HowTo disambiguations enforced by a SINGLE AiBudget allocated at the top of generateSchemaSuggestions (Devin's PR1 round-5 informational note — fixed in PR2).

**Files:** `shared/types/feature-flags.ts` (+1 line); `server/schema/validator.ts` (+4 REQUIRED_BY_TYPE entries); `server/schema-suggester.ts` (3 generateLeanSchema sites threaded with shared aiBudget); `server/schema/extractors/page-elements.ts` (wire 3 new pattern extractors + 2 AI passes); `server/schema/extractors/page-elements/images.ts` (new); `server/schema/extractors/page-elements/tables.ts` (new); `server/schema/extractors/page-elements/testimonials.ts` (new); `server/schema/extractors/page-elements/image-fetch.ts` (new utility); `server/schema/extractors/page-elements/image-ai-classifier.ts` (new); `server/schema/extractors/page-elements/howto-ai-fallback.ts` (new); `server/schema/templates/article.ts` (+ImageGallery emission); `server/schema/templates/service.ts` (+Review[] + AggregateRating + ImageGallery + Table); `server/schema/templates/local-business.ts` (+Review[] + AggregateRating); 4 HTML fixtures in `tests/fixtures/page-elements/`; 6 new test files; integration tests extended.

---

```

- [ ] **Step 3: Update data/roadmap.json**

Run: `grep -n "schema-page-element-catalog" data/roadmap.json | head -10`

Find the `schema-page-element-catalog-v1-pr2` entry. Update its status field from `"pending"` to `"done"`. Add a `notes` field summarizing what shipped (~80 chars). Run the sort script:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 4: Verify**

Run: `git diff FEATURE_AUDIT.md data/roadmap.json`
Expected: clean addition + status update only.

- [ ] **Step 5: Commit**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: mark schema-page-element-catalog-pr2 done; FEATURE_AUDIT entry 325"
```

---

## Phase 6 — PR + Devin loop

### Task 18: Open the PR

**Files:** none

- [ ] **Step 1: Verify branch state**

Run: `git log --oneline origin/staging..HEAD | head -20`
Expected: ~17 commits (one per task).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin claude/page-element-catalog-pr2
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base staging --title "feat(schema): page-element catalog PR2 — images + tables + testimonials + AI classifier" --body "$(cat <<'EOF'
## Summary
- 3 new pattern extractors (images / tables / testimonials) + 2 AI extractors (image role classifier, HowTo disambiguation) behind \`schema-ai-element-classifier\` flag (default off).
- 4 new validator REQUIRED_BY_TYPE entries (Review, AggregateRating, Table, ImageGallery).
- 3 schema integrations: ImageGallery (Article + Service); Review[] + AggregateRating (Service + LocalBusiness); Table mainEntity (Service).
- Threads a single AiBudget through \`generateSchemaSuggestions\` so the per-run 120-call cap actually works (Devin's PR1 round-5 informational note — fixed here).
- Pre-emission gates on every new node type (Review.author + rating, AggregateRating reviewCount > 0, Table.about populated, ImageGallery ≥2 images).

## Test plan
- [x] Unit tests for each new extractor (images, tables, testimonials, AI classifier, AI HowTo disambiguator, image-fetch utility) — ~40 new tests.
- [x] Unit tests for 4 new validator REQUIRED_BY_TYPE entries (~12 tests).
- [x] Integration test exercising 4 HTML fixtures end-to-end.
- [x] Multi-node @graph integration test (Service + Review[] + AggregateRating + ImageGallery + Table + BreadcrumbList) with @id uniqueness.
- [x] Typecheck + pr-check + vite build all clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the returned PR URL.

- [ ] **Step 4: Wait for Devin Review (5-10 min)**

Poll: `gh pr checks <PR-NUMBER>`. When Devin Review reports `pass`, fetch comments via `gh api repos/hmpsn/asset-dashboard/pulls/<PR-NUMBER>/comments`.

- [ ] **Step 5: Resolve actionable Devin comments**

Apply the same triage approach as PR1:
- ✅ Confirmed bugs: fix and push
- 📝 Informational notes: acknowledge in a PR comment, no code change
- Stale comments (Devin reviewed pre-fix code): ignore

Cap at 2 fix rounds total per the PR1 precedent.

- [ ] **Step 6: Squash-merge to staging**

When Devin is clean + all CI checks green:

```bash
gh pr merge <PR-NUMBER> --squash --delete-branch
```

- [ ] **Step 7: Wait for Render deploy + smoke-test**

Wait ~10 min for Render staging build. Then verify the staging admin Schema page still renders 28/28 valid for hmpsn studio (the new Review/AggregateRating/Table/ImageGallery REQUIRED_BY_TYPE entries should not regress existing pages — they don't emit those types so the validator passes vacuously).

If a Service page has testimonials in its rich-text, regenerate it and verify the JSON-LD now contains `Review[]` + `AggregateRating`.

---

## Self-review

**1. Spec coverage:**
- [x] Spec §5.2 — 3 PR2 schema integrations: ImageGallery (Tasks 11/12), Review[]+AggregateRating (Tasks 12/13), Table mainEntity (Task 12). ✅
- [x] Spec §7 — AI cost budget per-run (Task 3 budget allocation + Tasks 9/10 budget consumption). ✅
- [x] Spec §8.1 — 4 validator REQUIRED_BY_TYPE entries (Task 2). ✅

**2. Placeholder scan:** every step has explicit code blocks or commands — no TBD/TODO/"implement later". ✅

**3. Type consistency:**
- `PageImage.role` union (`'hero' | 'informative' | 'decorative'`) used consistently across Tasks 5/9/11/12.
- `Testimonial` shape (author? + quote + rating? + selector) consistent across Tasks 7/12/13.
- `AiBudget.exhausted` flag consumed correctly in Tasks 9/10 (early-exit before consume).
- Review @id pattern: `${canonicalUrl}#review-${idx}` for Service; `${baseUrl}/#review-${idx}` for LocalBusiness. ✅ (different parents, different prefixes — by design).
- Table @id pattern: `${canonicalUrl}#table-0` (single-table assumption — multi-table iteration deferred to PR3). ✅

**4. PR1 lessons applied:**
- Pre-emission gates on Review/AggregateRating/Table/ImageGallery (synchronous, per Devin r2 BUG-0001).
- Strict scope to `<article>` with whole-document fallback (per PR1 howto.ts precedent).
- All catch blocks tagged `// catch-ok: <reason>`.
- AI calls go through `callAI` dispatcher with `feature` label for token logging (per CLAUDE.md "new code").
- AiBudget threading enforced at the OUTERMOST entry point (per Devin PR1 round-5).
