# Schema Semantic Extraction & AI-Powered Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace content-empty schema templates with a universal AI extraction layer that mines page content for structured business data, enriches all templates, generates correct schema for unknown page types, and validates published output against Google's Rich Results API.

**Architecture:** Haiku 4.5 runs a semantic extraction pass on every stale page (extending the existing `PageElementCatalog`), feeding real NAP/hours/staff/services/offers data into existing templates. Pages classified as `WebPage` (unknown type) get a second Haiku call that generates schema from scratch using extracted data + workspace context. A post-enrichment pass appends `FAQPage`, `VideoObject`, `sameAs`, and `AggregateRating` to all pages regardless of type. At generation time, the schema.org validator API is called immediately on save to surface structural errors before publish. After Webflow publish, a background job calls the GSC URL Inspection API and surfaces Google-detected failures in the dashboard with one-click rollback.

**Tech Stack:** Haiku 4.5 (`claude-haiku-4-5-20251001`), Anthropic tool use (structured output), GSC URL Inspection API (existing `getValidToken` OAuth pattern), Webflow API (existing), SQLite `page_elements` + `schema_publish_history` (existing).

**Spec:** `docs/superpowers/specs/2026-05-01-schema-semantic-extraction-design.md`

**PR Strategy:** Two PRs.
- **PR 1 — Tasks 1–11** (core extraction + enrichment): `SemanticPageData`, `callAnthropicWithTools`, semantic extraction, all template enrichments, unknown-type generation, post-enrichment pass, extended validator. Immediately makes schema content-rich. Shippable on its own.
- **PR 2 — Tasks 12–14** (validation layer): Migration 081+082, GSC background job, schema.org pre-publish validator, status store, tests. Purely additive — no behavior changes to PR 1 code. Can ship independently if delayed.

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-05-01-schema-semantic-extraction-design.md`
- [x] Pre-plan audit complete

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `shared/types/page-elements.ts` | Modify | Add `SemanticPageData` interface + `semantics?` on `PageElementCatalog` |
| `server/schemas/page-elements-schema.ts` | Modify | Add `semantics` optional field to Zod schema |
| `server/anthropic-helpers.ts` | Modify | Add `callAnthropicWithTools` for tool_use structured output |
| `server/schema/extractors/semantic.ts` | Create | `extractSemanticData()` — Haiku extraction with input prep + validation |
| `server/schema/extractors/schema-generation.ts` | Create | `generateSchemaForUnknownType()` — Haiku schema generation for unknown types |
| `server/db/migrations/081-schema-google-validation.sql` | Create | Add `google_validation_status` + `google_validation_details` to `schema_publish_history` |
| `server/schema/generator.ts` | Modify | Wire semantic extraction, `applyPostEnrichment`, unknown-type branch |
| `server/schema/templates/local-business.ts` | Modify | Enrich with NAP, hours, staff, services, ratings from semantics |
| `server/schema/templates/service.ts` | Modify | Enrich with offers, priceRange, staff, certifications from semantics |
| `server/schema/templates/homepage.ts` | Modify | Enrich with foundingDate, numberOfLocations, sameAs, awards from semantics |
| `server/schema/templates/static.ts` | Modify | Enrich About (staff, sameAs) and Contact (phone, email, address, hours) |
| `server/schema/templates/article.ts` | Modify | Enrich with author from `semantics.staff[0]`, primaryImage |
| `server/schema/validator.ts` | Modify | Add rule sets for Dentist/MedicalBusiness/LegalService/ProfessionalService/Event/Course; passthrough unknown types as `warning` |
| `server/schema-store.ts` | Modify | Add `googleValidationStatus` to `SchemaPublishEntry` + CRUD functions |
| `server/search-console.ts` | Modify | Add `inspectUrlForRichResults()` wrapper |
| `server/routes/webflow-schema.ts` | Modify | Trigger background GSC validation 3 min after publish; expose rollback broadcast |
| `server/schema/schema-org-validator.ts` | Create | `validateWithSchemaOrg()` — calls validator.schema.org API at generation time |
| `server/schema/generator.ts` (Task 13 addition) | Modify | Call `validateWithSchemaOrg` after schema is saved; store result in `schema_org_validation_status` |
| `server/db/migrations/082-schema-org-validation.sql` | Create | Add `schema_org_validation_status TEXT` + `schema_org_validation_details TEXT` to `schema_snapshots` |
| `tests/unit/schema/extractors/semantic-extraction.test.ts` | Create | Unit tests for extraction + post-extraction validation |
| `tests/unit/schema/post-enrichment.test.ts` | Create | Unit tests for `applyPostEnrichment` |
| `tests/unit/schema-google-validation-status.test.ts` | Create | Unit tests for status store + `inspectUrlForRichResults` mock |
| `tests/unit/schema/schema-org-validator.test.ts` | Create | Unit tests for `validateWithSchemaOrg` — mock HTTP, assert result shape |

---

## Task Dependencies

```
Phase 0 — Sequential (shared contracts)
  Task 1 (SemanticPageData type)        → COMMIT before any other task
  Task 2 (Zod schema + callAnthropicWithTools)  → after Task 1, COMMIT
  Task 3 (Migration 081)                → independent, COMMIT

Phase 1 — Parallel (after Task 1 + Task 2 committed)
  Task 4 (extractSemanticData)          ∥
  Task 5 (generateSchemaForUnknownType) ∥
  Task 6 (local-business enrichment)    ∥
  Task 7 (service + article enrichment) ∥
  Task 8 (homepage + static enrichment) ∥
  Task 9 (Extended validator)           ∥
  Task 10 (schema-store google status)  — also depends on Task 3

Phase 2 — Sequential (after all Phase 1 committed)
  Task 11 (Generator integration)       → depends on Tasks 4–8

Phase 3 — Parallel (after Task 3 + Task 10 committed)
  Task 12 (GSC inspection + route wiring) → depends on Task 3, Task 10, Task 11

Phase 3b — schema.org validation (after Task 11)
  Task 13 (schema.org validator + migration 082 + generator wiring) → depends on Task 11

Phase 4 — Tests (after Phase 2 + Phase 3 + Phase 3b)
  Task 14 (extraction + post-enrichment tests)
  Task 15 (google validation status tests + schema.org validator tests)
```

---

## Task 1 — SemanticPageData Shared Type (Model: haiku)

**Owns:** `shared/types/page-elements.ts`
**Must not touch:** any other file

- [ ] **Step 1: Open the file and locate the end of the `PageElementCatalog` interface**

Read `shared/types/page-elements.ts`. The `PageElementCatalog` interface ends around line 33.

- [ ] **Step 2: Add `SemanticPageData` interface and extend `PageElementCatalog`**

At the bottom of `shared/types/page-elements.ts`, append the `SemanticPageData` interface and then update the `PageElementCatalog` interface to add the optional `semantics` field.

**Add to the end of the file:**

```typescript
// ── Semantic extraction ────────────────────────────────────────────────────

export interface SemanticPageData {
  // Contact / NAP
  phone?: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  geo?: { latitude: number; longitude: number };
  hours?: Array<{
    dayOfWeek: string | string[];
    opens: string;   // "09:00"
    closes: string;  // "18:00"
  }>;
  parking?: string;

  // Reputation
  aggregateRating?: {
    ratingValue: number;
    reviewCount?: number;
    platform?: string;
  };
  reviews?: Array<{
    author: string;
    reviewBody: string;
    ratingValue?: number;
  }>;

  // Business identity
  foundingDate?: string;
  numberOfLocations?: number;
  sameAs?: string[];
  certifications?: string[];
  mediaMentions?: string[];
  awards?: string[];
  highlights?: string[];
  insurance?: string[];
  paymentOptions?: string[];
  areaServed?: string[];
  languagesSpoken?: string[];
  accessibility?: string[];

  // Content entities
  services?: string[];
  staff?: Array<{
    name: string;
    credentials?: string;
    jobTitle?: string;
    image?: string;
  }>;
  offers?: Array<{
    name: string;
    price?: string;
    priceCurrency?: string;
    description?: string;
  }>;
  priceRange?: string;
  events?: Array<{
    name: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    price?: string;
    location?: string;
  }>;
  courses?: Array<{
    name: string;
    description?: string;
    duration?: string;
  }>;

  // Rich content
  faq?: Array<{ question: string; answer: string }>;
  howToSteps?: Array<{ name: string; text: string }>;

  // Media
  primaryImage?: string;
  images?: Array<{ url: string; caption?: string }>;
  videos?: Array<{
    contentUrl: string;
    name?: string;
    description?: string;
    thumbnailUrl?: string;
  }>;

  // Page intent
  primaryAction?: 'book' | 'contact' | 'buy' | 'learn' | 'apply' | 'quote';
  pageCategory?: string;
}
```

**Then update the `PageElementCatalog` interface** — add this line inside the interface (after the `diagnostics` field):

```typescript
  /** Semantic business data extracted by Haiku — populated by extractSemanticData(). */
  semantics?: SemanticPageData;
```

- [ ] **Step 3: Verify no type errors**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add shared/types/page-elements.ts
git commit -m "feat(schema): add SemanticPageData type + extend PageElementCatalog"
```

---

## Task 2 — Zod Schema Update + callAnthropicWithTools (Model: haiku)

**Owns:** `server/schemas/page-elements-schema.ts`, `server/anthropic-helpers.ts`
**Must not touch:** any other file

- [ ] **Step 1: Add `semantics` field to pageElementCatalogSchema**

In `server/schemas/page-elements-schema.ts`, the `pageElementCatalogSchema` is defined with `.passthrough()`. Add the `semantics` field before `.passthrough()`:

Find this line:
```typescript
  diagnostics: diagnosticsSchema.default({ aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} }),
}).passthrough()
```

Replace with:
```typescript
  diagnostics: diagnosticsSchema.default({ aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: {} }),
  semantics: z.record(z.unknown()).optional(),
}).passthrough()
```

- [ ] **Step 2: Add `callAnthropicWithTools` to `server/anthropic-helpers.ts`**

Append this export at the end of `server/anthropic-helpers.ts` (before the last `}`):

```typescript
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AnthropicToolUseResult {
  toolInput: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Call Anthropic Messages API with tool_use (structured output).
 * Forces the model to respond with the named tool's input_schema shape.
 * Returns the tool_use input block — guaranteed structured JSON.
 */
export async function callAnthropicWithTools(opts: {
  model?: string;
  system?: string;
  userMessage: string;
  tools: AnthropicToolDefinition[];
  /** Force a specific tool (tool_choice: { type: 'tool', name }). Defaults to auto. */
  forceTool?: string;
  maxTokens?: number;
  feature: string;
  workspaceId?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): Promise<AnthropicToolUseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const {
    model = 'claude-haiku-4-5-20251001',
    system,
    userMessage,
    tools,
    forceTool,
    maxTokens = 4096,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 60_000,
  } = opts;

  const bodyObj: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: userMessage }],
    tools,
    max_tokens: maxTokens,
  };
  if (system) bodyObj.system = system;
  if (forceTool) bodyObj.tool_choice = { type: 'tool', name: forceTool };

  const body = JSON.stringify(bodyObj);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          const waitMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`Anthropic tool_use ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as {
        content?: Array<{ type: string; input?: Record<string, unknown> }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const toolUseBlock = data.content?.find(c => c.type === 'tool_use');
      if (!toolUseBlock?.input) throw new Error(`Anthropic tool_use: no tool_use block in response`);

      const promptTokens = data.usage?.input_tokens ?? 0;
      const completionTokens = data.usage?.output_tokens ?? 0;
      logTokenUsage({ promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, model, feature, workspaceId });

      return { toolInput: toolUseBlock.input, promptTokens, completionTokens };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError' && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`[${feature}] callAnthropicWithTools failed after ${maxRetries} retries`);
}
```

- [ ] **Step 3: Verify no type errors**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/schemas/page-elements-schema.ts server/anthropic-helpers.ts
git commit -m "feat(schema): add semantics Zod field + callAnthropicWithTools helper"
```

---

## Task 3 — Migration 081 (Model: haiku)

**Owns:** `server/db/migrations/081-schema-google-validation.sql`
**Must not touch:** any other file

- [ ] **Step 1: Create the migration file**

Create `server/db/migrations/081-schema-google-validation.sql`:

```sql
-- 081-schema-google-validation.sql
-- Adds google_validation_status and google_validation_details to schema_publish_history.
-- Status lifecycle: NULL (unpublished) → 'published' → 'google_validated' | 'google_failed' | 'no_gsc'
-- Tracked: schema-google-validation-v1

ALTER TABLE schema_publish_history
  ADD COLUMN google_validation_status TEXT;

ALTER TABLE schema_publish_history
  ADD COLUMN google_validation_details TEXT;
```

- [ ] **Step 2: Verify migration runs without error**

```bash
# SQLite ALTER TABLE ADD COLUMN is safe (no data loss)
npx tsx -e "
import db from './server/db/index.js';
const stmts = require('fs').readFileSync('./server/db/migrations/081-schema-google-validation.sql','utf-8').split(';').filter(s=>s.trim());
for (const s of stmts) { if (s.trim()) db.exec(s); }
console.log('Migration OK');
"
```

Expected: `Migration OK`

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/081-schema-google-validation.sql
git commit -m "feat(schema): migration 081 — google_validation_status on schema_publish_history"
```

---

## Task 4 — extractSemanticData (Model: sonnet)

**Owns:** `server/schema/extractors/semantic.ts`
**Must not touch:** any file outside this path. May READ `server/schema/extractors/page-elements/content-scope.ts` and `server/anthropic-helpers.ts` for patterns.

**Depends on:** Task 1 + Task 2 committed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schema/extractors/semantic-extraction.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SemanticPageData } from '../../../../shared/types/page-elements.js';

// Mock callAnthropicWithTools before importing the module under test
vi.mock('../../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn(),
}));

import { callAnthropicWithTools } from '../../../../server/anthropic-helpers.js';
import { extractSemanticData } from '../../../../server/schema/extractors/semantic.js';

const MOCK_HTML = `
<html>
<body>
<main>
  <h1>North Austin Dentist</h1>
  <p>Call us: (512) 555-1234</p>
  <p>123 Main St, Austin, TX 78701</p>
  <p>Mon-Fri: 9am-5pm</p>
  <p>4.7 stars from 10,234 reviews</p>
  <a href="https://facebook.com/swishdental">Facebook</a>
  <a href="https://www.yelp.com/biz/swish-dental-austin">Yelp</a>
</main>
</body>
</html>`;

const MOCK_SEMANTICS: SemanticPageData = {
  phone: '(512) 555-1234',
  address: { street: '123 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
  aggregateRating: { ratingValue: 4.7, reviewCount: 10234, platform: 'Google' },
  sameAs: ['https://facebook.com/swishdental', 'https://www.yelp.com/biz/swish-dental-austin'],
  hours: [{ dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday'], opens: '09:00', closes: '17:00' }],
};

describe('extractSemanticData', () => {
  beforeEach(() => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: MOCK_SEMANTICS as unknown as Record<string, unknown>,
      promptTokens: 500,
      completionTokens: 200,
    });
  });

  it('returns SemanticPageData from Haiku tool_use response', async () => {
    const result = await extractSemanticData(MOCK_HTML, {
      pageBaseUrl: 'https://swishsmiles.com/location/north-austin',
    });
    expect(result.phone).toBe('(512) 555-1234');
    expect(result.address?.city).toBe('Austin');
    expect(result.aggregateRating?.ratingValue).toBe(4.7);
    expect(result.sameAs).toContain('https://facebook.com/swishdental');
  });

  it('passes social hrefs and stripped text to Haiku', async () => {
    await extractSemanticData(MOCK_HTML, {
      pageBaseUrl: 'https://swishsmiles.com/location/north-austin',
    });
    expect(callAnthropicWithTools).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(callAnthropicWithTools).mock.calls[0][0];
    expect(callArgs.userMessage).toContain('facebook.com/swishdental');
    expect(callArgs.userMessage).toContain('yelp.com');
  });

  it('nulls out phone that does not appear in stripped text', async () => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { phone: '(999) 999-9999' } as Record<string, unknown>,
      promptTokens: 100, completionTokens: 50,
    });
    const result = await extractSemanticData('<main><p>No phone here</p></main>', {
      pageBaseUrl: 'https://example.com/page',
    });
    expect(result.phone).toBeUndefined();
  });

  it('nulls out aggregateRating.ratingValue above 5.0', async () => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { aggregateRating: { ratingValue: 6.5, reviewCount: 100 } } as Record<string, unknown>,
      promptTokens: 100, completionTokens: 50,
    });
    const result = await extractSemanticData('<main><p>text</p></main>', {
      pageBaseUrl: 'https://example.com/page',
    });
    expect(result.aggregateRating).toBeUndefined();
  });

  it('returns empty object when callAnthropicWithTools throws', async () => {
    vi.mocked(callAnthropicWithTools).mockRejectedValue(new Error('API error'));
    const result = await extractSemanticData(MOCK_HTML, {
      pageBaseUrl: 'https://swishsmiles.com/page',
    });
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/schema/extractors/semantic-extraction.test.ts
```

Expected: FAIL — `Cannot find module '../../../../server/schema/extractors/semantic.js'`

- [ ] **Step 3: Create `server/schema/extractors/semantic.ts`**

```typescript
/**
 * Semantic page data extractor.
 * Uses Haiku 4.5 with tool_use (structured output) to extract business entities
 * from page content. Always returns; never throws — callers use {} fallback.
 */
import * as cheerio from 'cheerio';
import { callAnthropicWithTools } from '../../anthropic-helpers.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import type { BusinessProfileContact } from '../../../shared/types/workspace.js';
import { contentScope } from './page-elements/content-scope.js';
import { createLogger } from '../../logger.js';

const log = createLogger('schema/extractors/semantic');

const SOCIAL_DOMAINS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'yelp.com', 'google.com/maps', 'tiktok.com', 'youtube.com', 'bbb.org',
];

const MAX_TEXT_CHARS = 24_000; // ~6000 tokens at 4 chars/token

/** Rough phone pattern used for verbatim-presence validation only — not semantic extraction. */
const PHONE_RE = /[\d\s\-().+]{7,}/;

/** Allowed social/directory domains for sameAs validation. */
const ALLOWED_SAME_AS = new Set(SOCIAL_DOMAINS.map(d => d.split('/')[0]));

function stripToMainContent(html: string): string {
  const $ = cheerio.load(html);
  const scope = contentScope($);
  $('script, style, noscript', scope as unknown as string).remove();
  return scope.text().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

function extractSocialHrefs(html: string): string[] {
  const $ = cheerio.load(html);
  const hrefs: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (SOCIAL_DOMAINS.some(d => href.includes(d))) hrefs.push(href);
  });
  return [...new Set(hrefs)];
}

function extractMediaSrcs(html: string): string[] {
  const $ = cheerio.load(html);
  const srcs: string[] = [];
  $('iframe[src], video[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) srcs.push(src);
  });
  return srcs;
}

/** Post-extraction validation: null out fields that fail their check. */
function validateExtracted(raw: Record<string, unknown>, strippedText: string): SemanticPageData {
  const result = { ...raw } as SemanticPageData;

  // Phone must appear verbatim in stripped text
  if (result.phone && !strippedText.replace(/\s/g, '').includes(result.phone.replace(/\s/g, ''))) {
    if (!PHONE_RE.test(result.phone) || !strippedText.includes(result.phone.replace(/[\s()-]/g, '').slice(0, 7))) {
      log.debug({ phone: result.phone }, 'semantic: phone failed verbatim check — nulled');
      delete result.phone;
    }
  }

  // Address postal code: 5-digit or ZIP+4
  if (result.address?.postalCode && !/^\d{5}(-\d{4})?$/.test(result.address.postalCode)) {
    log.debug({ postalCode: result.address.postalCode }, 'semantic: bad postalCode — nulled');
    delete result.address;
  }

  // aggregateRating: ratingValue 0–5, reviewCount positive integer
  if (result.aggregateRating) {
    const { ratingValue, reviewCount } = result.aggregateRating;
    if (typeof ratingValue !== 'number' || ratingValue < 0 || ratingValue > 5) {
      log.debug({ ratingValue }, 'semantic: bad ratingValue — nulled aggregateRating');
      delete result.aggregateRating;
    } else if (reviewCount !== undefined && (!Number.isInteger(reviewCount) || reviewCount < 0)) {
      log.debug({ reviewCount }, 'semantic: bad reviewCount — nulled');
      delete result.aggregateRating.reviewCount;
    }
  }

  // hours: opens/closes must be parseable time strings (HH:MM format)
  if (result.hours) {
    result.hours = result.hours.filter(h => /^\d{1,2}:\d{2}$/.test(h.opens) && /^\d{1,2}:\d{2}$/.test(h.closes));
  }

  // sameAs: valid URLs on allowed domain list only
  if (result.sameAs) {
    result.sameAs = result.sameAs.filter(url => {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return ALLOWED_SAME_AS.has(host) || SOCIAL_DOMAINS.some(d => host.includes(d.split('/')[0]));
      } catch { return false; }
    });
    if (result.sameAs.length === 0) delete result.sameAs;
  }

  return result;
}

const EXTRACT_TOOL = {
  name: 'extract_semantic_data',
  description: 'Extract structured business and content data from a webpage. Return null for any field not clearly and explicitly present.',
  input_schema: {
    type: 'object' as const,
    properties: {
      phone: { type: 'string', description: 'Phone number as it appears on page' },
      email: { type: 'string' },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postalCode: { type: 'string' },
          country: { type: 'string' },
        },
        required: ['street', 'city', 'state', 'postalCode'],
      },
      geo: {
        type: 'object',
        properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
        required: ['latitude', 'longitude'],
      },
      hours: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayOfWeek: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            opens: { type: 'string', description: 'HH:MM format' },
            closes: { type: 'string', description: 'HH:MM format' },
          },
          required: ['dayOfWeek', 'opens', 'closes'],
        },
      },
      aggregateRating: {
        type: 'object',
        properties: {
          ratingValue: { type: 'number' },
          reviewCount: { type: 'number' },
          platform: { type: 'string' },
        },
        required: ['ratingValue'],
      },
      foundingDate: { type: 'string' },
      numberOfLocations: { type: 'number' },
      sameAs: { type: 'array', items: { type: 'string' }, description: 'Social/directory profile URLs from the provided hrefs list' },
      certifications: { type: 'array', items: { type: 'string' } },
      awards: { type: 'array', items: { type: 'string' } },
      highlights: { type: 'array', items: { type: 'string' } },
      insurance: { type: 'array', items: { type: 'string' } },
      areaServed: { type: 'array', items: { type: 'string' } },
      languagesSpoken: { type: 'array', items: { type: 'string' } },
      accessibility: { type: 'array', items: { type: 'string' } },
      services: { type: 'array', items: { type: 'string' } },
      staff: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            credentials: { type: 'string' },
            jobTitle: { type: 'string' },
            image: { type: 'string' },
          },
          required: ['name'],
        },
      },
      offers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'string' },
            priceCurrency: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name'],
        },
      },
      priceRange: { type: 'string', description: '$, $$, $$$ only' },
      faq: {
        type: 'array',
        items: {
          type: 'object',
          properties: { question: { type: 'string' }, answer: { type: 'string' } },
          required: ['question', 'answer'],
        },
      },
      primaryImage: { type: 'string' },
      videos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            contentUrl: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            thumbnailUrl: { type: 'string' },
          },
          required: ['contentUrl'],
        },
      },
      primaryAction: { type: 'string', enum: ['book', 'contact', 'buy', 'learn', 'apply', 'quote'] },
      pageCategory: { type: 'string' },
    },
    required: [],
  },
};

export async function extractSemanticData(
  html: string,
  options: {
    pageBaseUrl: string;
    workspaceBusinessProfile?: BusinessProfileContact | null;
    workspaceId?: string;
  },
): Promise<SemanticPageData> {
  try {
    const strippedText = stripToMainContent(html);
    const socialHrefs = extractSocialHrefs(html);
    const mediaSrcs = extractMediaSrcs(html);

    const userMessage = [
      `Page URL: ${options.pageBaseUrl}`,
      '',
      '## Page Content (main section only)',
      strippedText,
      socialHrefs.length > 0 ? `\n## Social/Directory Links Found\n${socialHrefs.join('\n')}` : '',
      mediaSrcs.length > 0 ? `\n## Embedded Media Sources\n${mediaSrcs.join('\n')}` : '',
    ].filter(Boolean).join('\n');

    const { toolInput } = await callAnthropicWithTools({
      model: 'claude-haiku-4-5-20251001',
      system: `You extract structured business data from webpage content for schema.org enrichment.
CRITICAL: Return null/omit for any field not clearly and explicitly present on the page.
Do NOT infer, assume, or guess. A missing phone number is better than a wrong one.
For sameAs: only include URLs from the "Social/Directory Links Found" section — do not fabricate URLs.`,
      userMessage,
      tools: [EXTRACT_TOOL],
      forceTool: 'extract_semantic_data',
      maxTokens: 2048,
      feature: 'semantic-extraction',
      workspaceId: options.workspaceId,
    });

    return validateExtracted(toolInput, strippedText);
  } catch (err) {
    log.warn({ err, pageBaseUrl: options.pageBaseUrl }, 'extractSemanticData failed — returning empty');
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/schema/extractors/semantic-extraction.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/schema/extractors/semantic.ts tests/unit/schema/extractors/semantic-extraction.test.ts
git commit -m "feat(schema): add extractSemanticData with Haiku tool_use + post-extraction validation"
```

---

## Task 5 — generateSchemaForUnknownType (Model: sonnet)

**Owns:** `server/schema/extractors/schema-generation.ts`
**Must not touch:** any other file. May READ `server/schema/templates/helpers.ts` for `dropUndefined`.

**Depends on:** Task 1 + Task 2 committed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schema/extractors/schema-generation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn(),
}));

import { callAnthropicWithTools } from '../../../../server/anthropic-helpers.js';
import { generateSchemaForUnknownType } from '../../../../server/schema/extractors/schema-generation.js';
import type { SemanticPageData } from '../../../../shared/types/page-elements.js';

const MOCK_GRAPH = [
  {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    '@id': 'https://swishsmiles.com/location/north-austin#dentist',
    'name': 'Swish Dental North Austin',
  },
];

describe('generateSchemaForUnknownType', () => {
  beforeEach(() => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { graph: MOCK_GRAPH } as Record<string, unknown>,
      promptTokens: 800, completionTokens: 400,
    });
  });

  it('returns a @graph array from Haiku response', async () => {
    const semantics: SemanticPageData = {
      phone: '(512) 555-1234',
      services: ['Teeth Whitening', 'Implants'],
    };
    const result = await generateSchemaForUnknownType({
      semantics,
      pageData: {
        title: 'North Austin Dentist',
        canonicalUrl: 'https://swishsmiles.com/location/north-austin',
        description: 'Dental care in North Austin',
      } as never,
      workspace: { id: 'ws1', name: 'Swish Dental', industry: 'dental' } as never,
      baseUrl: 'https://swishsmiles.com',
    });
    expect(result['@graph']).toBeDefined();
    expect(Array.isArray(result['@graph'])).toBe(true);
  });

  it('falls back to empty WebPage graph when Haiku throws', async () => {
    vi.mocked(callAnthropicWithTools).mockRejectedValue(new Error('API error'));
    const result = await generateSchemaForUnknownType({
      semantics: {},
      pageData: { title: 'Test', canonicalUrl: 'https://example.com/test', description: '' } as never,
      workspace: { id: 'ws1', name: 'Test' } as never,
      baseUrl: 'https://example.com',
    });
    expect(result['@graph']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/schema/extractors/schema-generation.test.ts
```

Expected: FAIL — `Cannot find module '../../../../server/schema/extractors/schema-generation.js'`

- [ ] **Step 3: Create `server/schema/extractors/schema-generation.ts`**

```typescript
/**
 * Haiku-powered schema generation for unknown page types.
 * Called when the page classifier returns 'WebPage' — i.e. no known template matches.
 * Falls back to a minimal WebPage @graph on error.
 */
import { callAnthropicWithTools } from '../../anthropic-helpers.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import type { PageData, WorkspaceSchemaInput } from '../data-sources.js';
import { createLogger } from '../../logger.js';

const log = createLogger('schema/extractors/schema-generation');

/**
 * Static schema.org type reference injected into every call system prompt.
 * cache_control: ephemeral — cached across all pages in the same server run.
 * Covers the ~30 most common business-relevant types.
 */
const SCHEMA_TYPE_REFERENCE = `# schema.org Type Reference (business-relevant subset)

## Service/Business Types
- Dentist: name, telephone, address, openingHours, aggregateRating, hasOfferCatalog
- Physician / MedicalBusiness: name, medicalSpecialty, availableService
- LegalService / Attorney: name, description, areaServed, founder
- AccountingService / FinancialService: name, description, areaServed
- HomeAndConstructionBusiness: name, description, areaServed
- HealthAndBeautyBusiness: name, description, hasOfferCatalog
- FoodEstablishment / Restaurant: name, servesCuisine, hasMenu, openingHours
- Hotel / LodgingBusiness: name, starRating, amenityFeature
- RealEstateAgent / HousePainter: name, areaServed
- ProfessionalService: name, description, areaServed (generic professional)

## Content Types
- Course: name, description, provider, hasCourseInstance, courseCode
- Event: name, startDate, endDate, location, organizer, offers
- Product: name, description, brand, offers, aggregateRating
- ItemList: itemListElement (array of ListItem with position + item)
- FAQPage: mainEntity (array of Question with acceptedAnswer)
- HowTo: name, step (array of HowToStep with name + text)
- VideoObject: name, description, uploadDate, thumbnailUrl, embedUrl

## Entity Types
- Person: name, jobTitle, worksFor, image
- Organization: name, url, logo, sameAs
- LocalBusiness (parent): name, address, telephone, openingHours, geo
- Place: name, address, geo

## Rules
- Every node must have: @type, @id (full URL), @context: "https://schema.org"
- @id format: canonical page URL + fragment (e.g. https://example.com/page#dentist)
- Only emit fields you have data for — no fabrication
- Output must be: { "@context": "https://schema.org", "@graph": [...nodes] }`;

const GENERATE_TOOL = {
  name: 'generate_schema',
  description: 'Generate schema.org JSON-LD @graph for a webpage based on extracted data',
  input_schema: {
    type: 'object' as const,
    properties: {
      graph: {
        type: 'array',
        description: 'Array of schema.org nodes. Each must have @type, @id, @context.',
        items: {
          type: 'object',
          properties: {
            '@context': { type: 'string', enum: ['https://schema.org'] },
            '@type': { type: 'string' },
            '@id': { type: 'string' },
          },
          required: ['@context', '@type', '@id'],
        },
      },
    },
    required: ['graph'],
  },
};

export async function generateSchemaForUnknownType(input: {
  semantics: SemanticPageData;
  pageData: PageData;
  workspace: WorkspaceSchemaInput;
  baseUrl: string;
}): Promise<Record<string, unknown>> {
  const { semantics, pageData, workspace, baseUrl } = input;

  const fallback = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'WebPage',
      '@id': `${pageData.canonicalUrl}#webpage`,
      '@context': 'https://schema.org',
      'name': pageData.title,
      'url': pageData.canonicalUrl,
      'description': pageData.description,
    }],
  };

  try {
    const userMessage = [
      `## Business Context`,
      `Name: ${workspace.name}`,
      workspace.industry ? `Industry: ${workspace.industry}` : '',
      workspace.topKeywords?.length ? `Top keywords: ${workspace.topKeywords.slice(0, 5).join(', ')}` : '',
      '',
      `## Page`,
      `Title: ${pageData.title}`,
      `URL: ${pageData.canonicalUrl}`,
      pageData.description ? `Description: ${pageData.description}` : '',
      pageData.breadcrumbs?.length
        ? `Breadcrumbs: ${pageData.breadcrumbs.map(b => b.name).join(' > ')}`
        : '',
      '',
      `## Extracted Semantic Data`,
      JSON.stringify(semantics, null, 2),
    ].filter(Boolean).join('\n');

    const { toolInput } = await callAnthropicWithTools({
      model: 'claude-haiku-4-5-20251001',
      system: `${SCHEMA_TYPE_REFERENCE}

Generate schema.org JSON-LD for the page described below.
Choose the most specific applicable type from the reference above.
Only use types from the reference. Only emit fields you have data for.
The output MUST be a valid @graph array — every node needs @type, @id, and @context.`,
      userMessage,
      tools: [GENERATE_TOOL],
      forceTool: 'generate_schema',
      maxTokens: 2048,
      feature: 'schema-generation-unknown',
      workspaceId: workspace.id,
    });

    const graph = toolInput.graph as Array<Record<string, unknown>>;
    if (!Array.isArray(graph) || graph.length === 0) return fallback;

    return { '@context': 'https://schema.org', '@graph': graph };
  } catch (err) {
    log.warn({ err, url: pageData.canonicalUrl }, 'generateSchemaForUnknownType failed — using WebPage fallback');
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/schema/extractors/schema-generation.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add server/schema/extractors/schema-generation.ts tests/unit/schema/extractors/schema-generation.test.ts
git commit -m "feat(schema): add generateSchemaForUnknownType with Haiku + WebPage fallback"
```

---

## Task 6 — Extended Validator (Model: haiku)

**Owns:** `server/schema/validator.ts`
**Must not touch:** any other file.
**Depends on:** Task 1 committed.

- [ ] **Step 1: Add new type rule sets to `REQUIRED_BY_TYPE`**

In `server/schema/validator.ts`, inside the `REQUIRED_BY_TYPE` object (after the existing `ImageGallery` entry before the closing `}`), add:

```typescript
  Dentist: {
    required: ['name', 'url', 'inLanguage'],
    recommended: ['telephone', 'address', 'openingHours', 'aggregateRating'],
  },
  MedicalBusiness: {
    required: ['name', 'url', 'inLanguage'],
    recommended: ['telephone', 'address'],
  },
  LegalService: {
    required: ['name', 'url', 'inLanguage'],
    recommended: ['telephone', 'areaServed'],
  },
  ProfessionalService: {
    required: ['name', 'url', 'inLanguage'],
    recommended: ['telephone', 'areaServed'],
  },
  Event: {
    required: ['name', 'startDate', 'location'],
    recommended: ['endDate', 'description', 'offers', 'organizer'],
  },
  Course: {
    required: ['name', 'description', 'provider'],
    recommended: ['hasCourseInstance', 'courseCode'],
  },
```

- [ ] **Step 2: Add passthrough rule for unknown types**

Find the `validateLeanSchema` function. It loops over graph nodes. After the existing type-specific validation, before the final `return findings` add the passthrough logic.

In `server/schema/validator.ts`, find the end of the `validateLeanSchema` function where it returns findings, and update it to handle unknown types with a `warning` finding:

Inside `validateLeanSchema`, find the loop that processes each graph node (it checks `REQUIRED_BY_TYPE[type]`). The validation currently silently skips unknown types. Update the else branch:

Find:
```typescript
    const rules = REQUIRED_BY_TYPE[type];
    if (!rules) continue; // unknown type — skip
```

Replace with:
```typescript
    const rules = REQUIRED_BY_TYPE[type];
    if (!rules) {
      // Unknown type: structural validation only
      const hasContext = node['@context'] === 'https://schema.org';
      const hasType = typeof node['@type'] === 'string' && node['@type'].length > 0;
      let hasId = false;
      try {
        if (typeof node['@id'] === 'string' && node['@id'].length > 0) {
          new URL(node['@id']);
          hasId = true;
        }
      } catch { /* invalid URL */ }
      const hasEmptyValues = Object.values(node).some(v => v === '' || (Array.isArray(v) && v.length === 0));
      if (!hasContext || !hasType || !hasId || hasEmptyValues) {
        findings.push({
          severity: 'warning',
          type,
          ruleId: 'unverified-type',
          message: `${type}: unverified schema.org type — structural check only. Issues: ${[
            !hasContext && 'missing @context',
            !hasType && 'missing @type',
            !hasId && '@id not a valid URL',
            hasEmptyValues && 'empty string or array values',
          ].filter(Boolean).join(', ') || 'none'}`,
        });
      }
      continue;
    }
```

- [ ] **Step 3: Run existing validator tests to confirm no regressions**

```bash
npx vitest run tests/unit/schema-validator.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add server/schema/validator.ts
git commit -m "feat(schema): add validator rules for Dentist/Event/Course/LegalService + structural passthrough for unknown types"
```

---

## Task 7 — Template Enrichment: local-business.ts (Model: sonnet)

**Owns:** `server/schema/templates/local-business.ts`
**Must not touch:** any other file.
**Depends on:** Task 1 committed.

- [ ] **Step 1: Update `LocalBusinessInput` to accept `semantics`**

In `server/schema/templates/local-business.ts`, update the interface:

Find:
```typescript
export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
}
```

Replace with:
```typescript
import type { SemanticPageData } from '../../../shared/types/page-elements.js';

export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
  /** Semantic data extracted from page content. Enriches NAP, hours, staff, services, rating. */
  semantics?: SemanticPageData;
}
```

- [ ] **Step 2: Enrich `localBusiness` node with semantics fields**

The `localBusiness` object currently reads `telephone` and other fields from `businessProfile`. Update it to prefer semantics where available, falling back to businessProfile.

After the existing `const localBusiness = dropUndefined({` block, add semantics enrichment. The full updated `localBusiness` object:

```typescript
  // Prefer semantics (page-level) over businessProfile (workspace-level) for location-specific data.
  // semantics.phone/address are location-specific; businessProfile is workspace-default.
  const phone = semantics?.phone || businessProfile?.phone;
  const email = semantics?.email || businessProfile?.email;

  const semanticsAddress = semantics?.address ? {
    '@type': 'PostalAddress' as const,
    'streetAddress': semantics.address.street,
    'addressLocality': semantics.address.city,
    'addressRegion': semantics.address.state,
    'postalCode': semantics.address.postalCode,
    'addressCountry': semantics.address.country,
  } : undefined;

  const openingHoursSpec = semantics?.hours?.length
    ? semantics.hours.map(h => dropUndefined({
        '@type': 'OpeningHoursSpecification' as const,
        'dayOfWeek': h.dayOfWeek,
        'opens': h.opens,
        'closes': h.closes,
      }))
    : undefined;

  // semantics.aggregateRating overrides testimonial-derived rating when present
  // (page-extracted Google/Yelp ratings are more authoritative than on-page testimonials)
  const semanticsRating = semantics?.aggregateRating
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': semantics.aggregateRating.ratingValue,
        'reviewCount': semantics.aggregateRating.reviewCount,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  // Staff as Person[] nodes for appendage to @graph
  const staffNodes: Array<Record<string, unknown>> = (semantics?.staff ?? []).map((s, i) => dropUndefined({
    '@type': 'Person' as const,
    '@id': `${baseUrl}/#person-${i}`,
    'name': s.name,
    'jobTitle': s.jobTitle,
    'hasCredential': s.credentials,
    'image': s.image,
    'worksFor': { '@id': `${baseUrl}/#localbusiness` },
  }));

  const hasOfferCatalog = semantics?.services?.length
    ? {
        '@type': 'OfferCatalog' as const,
        'name': `${pageData.publisher.name} Services`,
        'itemListElement': semantics.services.map((svc, i) => ({
          '@type': 'ListItem' as const,
          'position': i + 1,
          'item': { '@type': 'Service' as const, 'name': svc },
        })),
      }
    : undefined;

  const sameAsUrls = [
    ...(semantics?.sameAs ?? []),
    ...(businessProfile?.socialProfiles ?? []),
  ].filter(Boolean);
  const sameAs = sameAsUrls.length > 0 ? [...new Set(sameAsUrls)] : undefined;

  const areaServedList = semantics?.areaServed?.length
    ? semantics.areaServed.map(a => ({ '@type': 'Place' as const, 'name': a }))
    : (pageData.areaServed ? [{ '@type': 'Place' as const, 'name': pageData.areaServed }] : undefined);
```

Then update the `localBusiness` `dropUndefined` call to use the new variables:

```typescript
  const localBusiness = dropUndefined({
    '@type': 'LocalBusiness',
    '@id': `${baseUrl}/#localbusiness`,
    'name': pageData.publisher.name,
    'description': pageData.description,
    'url': baseUrl,
    'image': semantics?.primaryImage || pageData.image,
    'inLanguage': pageData.inLanguage,
    'telephone': phone,
    'email': email,
    'openingHoursSpecification': openingHoursSpec,
    'openingHours': !openingHoursSpec ? businessProfile?.openingHours : undefined,
    'address': semanticsAddress || address,
    'sameAs': sameAs,
    'foundedDate': semantics?.foundingDate || businessProfile?.foundedDate,
    'hasOfferCatalog': hasOfferCatalog,
    'parentOrganization': { '@id': `${baseUrl}/#organization` },
    'areaServed': areaServedList,
    'aggregateRating': semanticsRating || aggregateRating,
    'amenityFeature': semantics?.accessibility?.length
      ? semantics.accessibility.map(a => ({ '@type': 'LocationFeatureSpecification' as const, 'name': a, 'value': true }))
      : undefined,
    'knowsLanguage': semantics?.languagesSpoken,
    'currenciesAccepted': semantics?.paymentOptions?.join(', '),
  });
```

And in the `withBreadcrumb` call at the end, include staff nodes:

```typescript
  return withBreadcrumb([organization, localBusiness, website, ...reviews, ...staffNodes], pageData);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/schema/templates/local-business.ts
git commit -m "feat(schema): enrich LocalBusiness template with NAP, hours, staff, services from semantics"
```

---

## Task 8 — Template Enrichment: service.ts + article.ts (Model: sonnet)

**Owns:** `server/schema/templates/service.ts`, `server/schema/templates/article.ts`
**Must not touch:** any other file.
**Depends on:** Task 1 committed.

- [ ] **Step 1: Add `semantics` to `ServiceInput` in `service.ts`**

Add import and update interface:

```typescript
import type { SemanticPageData } from '../../../shared/types/page-elements.js';

export interface ServiceInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
  semantics?: SemanticPageData;
}
```

- [ ] **Step 2: Enrich `buildServiceSchema` with semantics**

In `buildServiceSchema`, after `const { pageData, baseUrl } = input;`, add:

```typescript
  const { semantics } = input;

  // semantics.aggregateRating overrides testimonial-derived rating
  const semanticsRating = semantics?.aggregateRating
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': semantics.aggregateRating.ratingValue,
        'reviewCount': semantics.aggregateRating.reviewCount,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  // Offers from semantics
  const semanticsOffers = semantics?.offers?.length
    ? semantics.offers.map((o, i) => dropUndefined({
        '@type': 'Offer' as const,
        '@id': `${pageData.canonicalUrl}#offer-${i}`,
        'name': o.name,
        'price': o.price,
        'priceCurrency': o.priceCurrency || 'USD',
        'description': o.description,
      }))
    : undefined;

  // Staff featured on service page as Person nodes
  const staffNodes: Array<Record<string, unknown>> = (semantics?.staff ?? []).map((s, i) => dropUndefined({
    '@type': 'Person' as const,
    '@id': `${pageData.canonicalUrl}#person-${i}`,
    'name': s.name,
    'jobTitle': s.jobTitle,
    'hasCredential': s.credentials,
    'image': s.image,
  }));
```

Update the `primary` node to use semantics data:

In the `primary` object, update:
```typescript
    'aggregateRating': semanticsRating || aggregateRating,
    'hasOfferCatalog': semanticsOffers ? {
      '@type': 'OfferCatalog' as const,
      'name': pageData.cleanTitle,
      'itemListElement': semanticsOffers,
    } : undefined,
    'areaServed': semantics?.areaServed?.length
      ? semantics.areaServed.map(a => ({ '@type': 'Place' as const, 'name': a }))
      : (pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined),
    'award': semantics?.certifications?.length ? semantics.certifications : undefined,
    'priceRange': semantics?.priceRange,
```

And update the nodes array to include staff:
```typescript
  const nodes: Array<Record<string, unknown>> = [primary, ...reviews, ...staffNodes];
```

- [ ] **Step 3: Add `semantics` to `ArticleInput` in `article.ts`**

Update import and interface:

```typescript
import type { SemanticPageData } from '../../../shared/types/page-elements.js';

export interface ArticleInput {
  baseUrl: string;
  pageData: PageData;
  semantics?: SemanticPageData;
}
```

- [ ] **Step 4: Enrich `buildArticleSchema` with semantics**

In `buildArticleSchema`, after `const { pageData } = input;`, add:

```typescript
  const { semantics } = input;
```

Update the `author` derivation to fall back to first staff member:

```typescript
  const author = pageData.author
    ? { '@type': 'Person', 'name': pageData.author }
    : semantics?.staff?.[0]
    ? {
        '@type': 'Person',
        'name': semantics.staff[0].name,
        'jobTitle': semantics.staff[0].jobTitle,
        'hasCredential': semantics.staff[0].credentials,
      }
    : { '@type': 'Organization', 'name': pageData.publisher.name };
```

Update `image` to prefer semantics.primaryImage:
```typescript
    'image': (semantics?.primaryImage || pageData.image) ? [(semantics?.primaryImage || pageData.image)!] : undefined,
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/schema/templates/service.ts server/schema/templates/article.ts
git commit -m "feat(schema): enrich Service + Article templates with semantics (offers, staff, ratings, author)"
```

---

## Task 9 — Template Enrichment: homepage.ts + static.ts (Model: sonnet)

**Owns:** `server/schema/templates/homepage.ts`, `server/schema/templates/static.ts`
**Must not touch:** any other file.
**Depends on:** Task 1 committed.

- [ ] **Step 1: Add `semantics` to `HomepageInput` in `homepage.ts`**

```typescript
import type { SemanticPageData } from '../../../shared/types/page-elements.js';

export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
  siteHasSearch?: boolean;
  semantics?: SemanticPageData;
}
```

- [ ] **Step 2: Enrich `buildHomepageSchema` with semantics**

In `buildHomepageSchema`, after `const { baseUrl, pageData, businessProfile, siteHasSearch } = input;`, add:

```typescript
  const { semantics } = input;
```

Update the `organization` node:

```typescript
  const sameAsUrls = [
    ...(semantics?.sameAs ?? []),
    ...(businessProfile?.socialProfiles ?? []),
  ].filter(Boolean);

  const organization = dropUndefined({
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'description': pageData.description,
    'image': semantics?.primaryImage || pageData.image,
    'logo': pageData.publisher.logoUrl
      ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
      : undefined,
    'sameAs': sameAsUrls.length > 0 ? [...new Set(sameAsUrls)] : undefined,
    'foundingDate': semantics?.foundingDate || businessProfile?.foundedDate,
    'numberOfLocations': semantics?.numberOfLocations,
    'award': semantics?.awards?.length ? semantics.awards : undefined,
    'slogan': semantics?.highlights?.[0],
    'knowsAbout': pageData.knowsAbout?.length ? pageData.knowsAbout : undefined,
  });
```

- [ ] **Step 3: Add `semantics` to `StaticInput` in `static.ts`**

```typescript
import type { SemanticPageData } from '../../../shared/types/page-elements.js';

export interface StaticInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
  semantics?: SemanticPageData;
}
```

- [ ] **Step 4: Enrich `buildAboutPageSchema` with semantics staff**

In `buildAboutPageSchema`, after `const { pageData, baseUrl } = input;`, add:

```typescript
  const { semantics } = input;
  const staffNodes: Array<Record<string, unknown>> = (semantics?.staff ?? []).map((s, i) => dropUndefined({
    '@type': 'Person' as const,
    '@id': `${pageData.canonicalUrl}#person-${i}`,
    'name': s.name,
    'jobTitle': s.jobTitle,
    'hasCredential': s.credentials,
    'image': s.image,
    'worksFor': (input.businessProfile?.address?.street || input.businessProfile?.address?.city)
      ? localBusinessRef(baseUrl)
      : orgRef(baseUrl),
  }));
```

Add staff nodes to the return:
```typescript
  const nodes: Array<Record<string, unknown>> = [primary, ...staffNodes];
  return withBreadcrumb(nodes, pageData);
```

- [ ] **Step 5: Enrich `buildContactPageSchema` with semantics NAP**

In `buildContactPageSchema`, after `const { pageData, baseUrl } = input;`, add:

```typescript
  const { semantics } = input;
  const phone = semantics?.phone || input.businessProfile?.phone;
  const email = semantics?.email || input.businessProfile?.email;
  const semanticsAddress = semantics?.address ? {
    '@type': 'PostalAddress' as const,
    'streetAddress': semantics.address.street,
    'addressLocality': semantics.address.city,
    'addressRegion': semantics.address.state,
    'postalCode': semantics.address.postalCode,
  } : undefined;
  const openingHoursSpec = semantics?.hours?.length
    ? semantics.hours.map(h => dropUndefined({
        '@type': 'OpeningHoursSpecification' as const,
        'dayOfWeek': h.dayOfWeek,
        'opens': h.opens,
        'closes': h.closes,
      }))
    : undefined;
```

Update the primary node to use these:
```typescript
    'telephone': phone,
    'email': email,
    'address': semanticsAddress,
    'openingHoursSpecification': openingHoursSpec,
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add server/schema/templates/homepage.ts server/schema/templates/static.ts
git commit -m "feat(schema): enrich Homepage + About + Contact templates with semantics"
```

---

## Task 10 — schema-store Google Validation Status (Model: haiku)

**Owns:** `server/schema-store.ts`
**Must not touch:** any other file.
**Depends on:** Task 3 (migration 081) committed.

- [ ] **Step 1: Extend `SchemaPublishEntry` type and `PublishHistoryRow` interface**

In `server/schema-store.ts`, find `SchemaPublishEntry` interface and add the new fields. Also update `PublishHistoryRow`:

Find the existing `SchemaPublishEntry` interface (search for `publishedAt: string;`) and add:

```typescript
export type GoogleValidationStatus = 'published' | 'google_validated' | 'google_failed' | 'no_gsc' | 'locally_validated';

export interface SchemaPublishEntry {
  id: string;
  siteId: string;
  pageId: string;
  workspaceId: string;
  schemaJson: Record<string, unknown>;
  publishedAt: string;
  googleValidationStatus?: GoogleValidationStatus;
  googleValidationDetails?: Array<{ type: string; message: string }>;
}
```

Update `PublishHistoryRow`:
```typescript
interface PublishHistoryRow {
  id: string;
  site_id: string;
  page_id: string;
  workspace_id: string;
  schema_json: string;
  published_at: string;
  google_validation_status: string | null;
  google_validation_details: string | null;
}
```

- [ ] **Step 2: Update `rowToPublishEntry` mapper**

```typescript
function rowToPublishEntry(row: PublishHistoryRow): SchemaPublishEntry {
  return {
    id: row.id,
    siteId: row.site_id,
    pageId: row.page_id,
    workspaceId: row.workspace_id,
    schemaJson: parseJsonFallback(row.schema_json, {}),
    publishedAt: row.published_at,
    googleValidationStatus: (row.google_validation_status as GoogleValidationStatus) ?? undefined,
    googleValidationDetails: row.google_validation_details
      ? parseJsonFallback(row.google_validation_details, undefined)
      : undefined,
  };
}
```

- [ ] **Step 3: Add `updateSchemaGoogleStatus` and `getLatestPublishEntryByPageId` functions**

Add these exports after `getSchemaPublishEntry`:

```typescript
/** Update google_validation_status on a schema publish history entry. */
export function updateSchemaGoogleStatus(
  entryId: string,
  status: GoogleValidationStatus,
  details?: Array<{ type: string; message: string }>,
): void {
  db.prepare(`
    UPDATE schema_publish_history
    SET google_validation_status = ?, google_validation_details = ?
    WHERE id = ?
  `).run(status, details ? JSON.stringify(details) : null, entryId);
}

/** Get the latest publish entry for a page across any site. Used by Google validation job. */
export function getLatestPublishEntryByPageId(pageId: string): SchemaPublishEntry | null {
  // ws-scope-ok: called by background job that already has workspace context
  const row = db.prepare(`
    SELECT * FROM schema_publish_history
    WHERE page_id = ?
    ORDER BY published_at DESC
    LIMIT 1
  `).get(pageId) as PublishHistoryRow | undefined;
  return row ? rowToPublishEntry(row) : null;
}
```

- [ ] **Step 4: Add `historyStmts` update statement for status**

In the `historyStmts` createStmtCache, add:

```typescript
  updateStatus: db.prepare(`
    UPDATE schema_publish_history
    SET google_validation_status = @status, google_validation_details = @details
    WHERE id = @id
  `),
```

Then update `updateSchemaGoogleStatus` to use prepared statement:
```typescript
export function updateSchemaGoogleStatus(
  entryId: string,
  status: GoogleValidationStatus,
  details?: Array<{ type: string; message: string }>,
): void {
  historyStmts().updateStatus.run({
    id: entryId,
    status,
    details: details ? JSON.stringify(details) : null,
  });
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add server/schema-store.ts
git commit -m "feat(schema): add googleValidationStatus to SchemaPublishEntry + CRUD functions"
```

---

## Task 11 — Generator Integration (Model: sonnet)

**Owns:** `server/schema/generator.ts`
**Must not touch:** any other file.
**Depends on:** Tasks 4, 5, 7, 8, 9 committed (extractSemanticData, generateSchemaForUnknownType, all enriched templates).

- [ ] **Step 1: Add new imports to `generator.ts`**

Add these imports after the existing import block (at the top of the file, grouped with existing imports):

```typescript
import { extractSemanticData } from './extractors/semantic.js';
import { generateSchemaForUnknownType } from './extractors/schema-generation.js';
import type { SemanticPageData } from '../../shared/types/page-elements.js';
```

- [ ] **Step 2: Add `applyPostEnrichment` function**

Add this private function before `generateLeanSchema`:

```typescript
/**
 * Post-enrichment pass: appends FAQPage (from semantics.faq), VideoObject nodes
 * (from catalog.videos, with semantics fallback), sameAs, and AggregateRating to
 * the primary org/localbusiness node. Each append uses the existing rollback pattern:
 * append → validate → if new errors introduced → pop.
 */
function applyPostEnrichment(
  schema: Record<string, unknown>,
  semantics: SemanticPageData | undefined,
  catalog: PageElementCatalog | undefined,
  canonicalUrl: string,
  primaryType: string,
  baseValidationFindings: ValidationFinding[],
): Record<string, unknown> {
  const graph = schema['@graph'] as Array<Record<string, unknown>>;
  if (!Array.isArray(graph)) return schema;

  const findingKey = (f: { ruleId: string; type: string; field?: string }) =>
    `${f.ruleId}::${f.type}::${f.field ?? ''}`;
  const baseFindingKeySet = new Set(baseValidationFindings.map(findingKey));

  function tryAppend(node: Record<string, unknown>): void {
    graph.push(node);
    const postFindings = validateLeanSchema(schema, primaryType);
    const newErrors = postFindings.filter(
      f => f.severity === 'error' && !baseFindingKeySet.has(findingKey(f)),
    );
    if (newErrors.length > 0) {
      graph.pop();
      log.debug({ type: node['@type'], errors: newErrors }, 'post-enrichment: rolled back append due to new errors');
    }
  }

  // 1. FAQPage from semantics.faq (only if not already present from extractFaq)
  const hasFaqPage = graph.some(n => n['@type'] === 'FAQPage');
  if (!hasFaqPage && (semantics?.faq?.length ?? 0) >= 2) {
    tryAppend({
      '@type': 'FAQPage',
      '@id': `${canonicalUrl}#faq`,
      'mainEntity': semantics!.faq!.map(pair => ({
        '@type': 'Question',
        'name': pair.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': pair.answer },
      })),
    });
  }

  // 2. VideoObject nodes — catalog.videos is authoritative; semantics.videos supplements only if catalog empty
  const videoSources = catalog?.videos?.length ? catalog.videos : [];
  const semanticsVideos = (!videoSources.length && semantics?.videos?.length) ? semantics.videos : [];
  const existingVideoIds = new Set(graph.filter(n => n['@type'] === 'VideoObject').map(n => n['@id']));

  for (const [idx, v] of videoSources.entries()) {
    const videoId = `${canonicalUrl}#video-${idx}`;
    if (!existingVideoIds.has(videoId)) {
      tryAppend({
        '@type': 'VideoObject',
        '@id': videoId,
        'name': v.title || 'Video',
        'description': `Video on ${canonicalUrl}`,
        'thumbnailUrl': v.thumbnailUrl,
        'embedUrl': v.embedUrl,
      });
    }
  }
  for (const [idx, v] of semanticsVideos.entries()) {
    const videoId = `${canonicalUrl}#semvideo-${idx}`;
    if (!existingVideoIds.has(videoId)) {
      tryAppend({
        '@type': 'VideoObject',
        '@id': videoId,
        'name': v.name || 'Video',
        'description': v.description || `Video on ${canonicalUrl}`,
        'thumbnailUrl': v.thumbnailUrl,
        'contentUrl': v.contentUrl,
      });
    }
  }

  // 3. sameAs on primary org/localbusiness node
  if (semantics?.sameAs?.length) {
    const primaryNode = graph.find(n => {
      const t = n['@type'];
      return typeof t === 'string' && (
        t === 'Organization' || t === 'LocalBusiness' ||
        ['Dentist', 'Physician', 'LegalService', 'ProfessionalService', 'MedicalBusiness',
         'HealthAndBeautyBusiness', 'FoodEstablishment', 'Hotel'].includes(t)
      );
    });
    if (primaryNode && !primaryNode.sameAs) {
      const original = { ...primaryNode };
      primaryNode.sameAs = semantics.sameAs;
      const postFindings = validateLeanSchema(schema, primaryType);
      const newErrors = postFindings.filter(
        f => f.severity === 'error' && !baseFindingKeySet.has(findingKey(f)),
      );
      if (newErrors.length > 0) {
        Object.assign(primaryNode, original);
        delete primaryNode.sameAs;
      }
    }
  }

  // 4. AggregateRating on primary node (if not already set)
  if (semantics?.aggregateRating) {
    const primaryNode = graph.find(n => {
      const t = n['@type'];
      return typeof t === 'string' && !['BreadcrumbList', 'WebSite', 'Organization', 'FAQPage', 'VideoObject', 'HowTo', 'Review', 'ImageGallery'].includes(t);
    });
    if (primaryNode && !primaryNode.aggregateRating) {
      const original = { ...primaryNode };
      primaryNode.aggregateRating = {
        '@type': 'AggregateRating',
        'ratingValue': semantics.aggregateRating.ratingValue,
        'reviewCount': semantics.aggregateRating.reviewCount,
        'bestRating': 5,
        'worstRating': 1,
      };
      const postFindings = validateLeanSchema(schema, primaryType);
      const newErrors = postFindings.filter(
        f => f.severity === 'error' && !baseFindingKeySet.has(findingKey(f)),
      );
      if (newErrors.length > 0) {
        Object.assign(primaryNode, original);
        delete primaryNode.aggregateRating;
      }
    }
  }

  return schema;
}
```

- [ ] **Step 3: Wire `extractSemanticData` sequential after `extractPageElements`**

In `generateLeanSchema`, find the catalog extraction block:

```typescript
        catalog = await extractPageElements(input.html ?? '', {
          pageBaseUrl: baseUrl,
          sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
          aiBudget,
          workspaceId,
        });
        upsertPageElements(workspaceId, pagePath, catalog);
```

Replace with:

```typescript
        catalog = await extractPageElements(input.html ?? '', {
          pageBaseUrl: baseUrl,
          sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
          aiBudget,
          workspaceId,
        });
        // Sequential after extractPageElements to avoid write-race on the same catalog row.
        // extractSemanticData is NOT gated by AiBudget — it always runs when catalog is stale.
        const semantics = await extractSemanticData(input.html ?? '', {
          pageBaseUrl: baseUrl,
          workspaceBusinessProfile: input.workspace.businessProfile,
          workspaceId,
        });
        catalog = { ...catalog, semantics };
        upsertPageElements(workspaceId, pagePath, catalog);
```

- [ ] **Step 4: Add `semantics` to all template calls**

In `generateLeanSchema`, update every `build*Schema` call to pass `semantics: catalog?.semantics`. The semantics comes from the catalog.

After `pageData = { ...pageData, elements: catalog };`, add:

```typescript
  const semantics = catalog?.semantics;
```

Then update each template call:
- `buildLocalBusinessSchema({ baseUrl, pageData, businessProfile: ..., siteHasSearch: ..., semantics })` 
- `buildHomepageSchema({ baseUrl, pageData, businessProfile: ..., siteHasSearch: ..., semantics })`
- `buildArticleSchema({ baseUrl, pageData, semantics }, 'BlogPosting')`
- `buildArticleSchema({ baseUrl, pageData, semantics }, 'Article')`
- `buildServiceSchema({ baseUrl, pageData, businessProfile: ..., semantics })`
- `buildAboutPageSchema({ baseUrl, pageData, businessProfile: ..., semantics })`
- `buildContactPageSchema({ baseUrl, pageData, businessProfile: ..., semantics })`

For buildBlogIndexSchema, buildServiceHubSchema, buildCollectionPageSchema, buildWebPageSchema: these don't have semantics enrichment yet, pass them as-is.

- [ ] **Step 5: Add unknown-type generation branch**

In the switch statement, find:

```typescript
    case 'Legal':
    case 'WebPage':
      schema = buildWebPageSchema({ baseUrl, pageData });
      reason = 'Generic page — WebPage with breadcrumb.';
      break;
```

Replace with:

```typescript
    case 'Legal':
      schema = buildWebPageSchema({ baseUrl, pageData });
      reason = 'Legal page — WebPage with breadcrumb.';
      break;
    case 'WebPage':
      if (semantics && Object.keys(semantics).length > 0) {
        try {
          schema = await generateSchemaForUnknownType({ semantics, pageData, workspace: input.workspace, baseUrl });
          reason = `Unknown page type — Haiku-generated schema based on extracted page content (category: ${semantics.pageCategory ?? 'unclassified'}).`;
        } catch (err) {
          log.warn({ err, pageId: input.pageId }, 'generateSchemaForUnknownType failed; falling back to WebPage');
          schema = buildWebPageSchema({ baseUrl, pageData });
          reason = 'Generic page — WebPage (AI generation failed).';
        }
      } else {
        schema = buildWebPageSchema({ baseUrl, pageData });
        reason = 'Generic page — WebPage with breadcrumb.';
      }
      break;
```

- [ ] **Step 6: Add `applyPostEnrichment` call after FAQ extraction**

After the existing FAQ enrichment block (the `if (faqPairs.length >= 2) { ... }` block), add:

```typescript
  // Post-enrichment pass: FAQPage (from semantics), VideoObject, sameAs, AggregateRating
  schema = applyPostEnrichment(schema, semantics, catalog, pageData.canonicalUrl, classified.primaryType, baseValidationFindings);
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Run the full schema test suite**

```bash
npx vitest run tests/unit/schema
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/schema/generator.ts
git commit -m "feat(schema): wire extractSemanticData + applyPostEnrichment + unknown-type Haiku generation in generator"
```

---

## Task 12 — GSC URL Inspection + Route Wiring (Model: sonnet)

**Owns:** `server/search-console.ts`, `server/routes/webflow-schema.ts`
**Must not touch:** any other file.
**Depends on:** Tasks 3, 10, 11 committed.

- [ ] **Step 1: Add `inspectUrlForRichResults` to `server/search-console.ts`**

Append this export at the end of `server/search-console.ts`:

```typescript
export interface RichResultsIssue {
  severity: 'ERROR' | 'SUGGESTION' | 'WARNING';
  issueMessage: string;
  type: string;
}

export interface UrlInspectionResult {
  hasErrors: boolean;
  issues: RichResultsIssue[];
  richResultsDetected: string[];
}

/**
 * Call GSC URL Inspection API to check rich results status.
 * Uses the existing getValidToken OAuth pattern.
 * Returns null when GSC is not connected or quota is exhausted.
 */
export async function inspectUrlForRichResults(
  siteId: string,
  pageUrl: string,
  siteUrl: string,
): Promise<UrlInspectionResult | null> {
  const token = await getValidToken(siteId);
  if (!token) return null;

  const res = await fetch(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429) {
      log.warn({ siteId }, 'GSC URL Inspection API quota exhausted');
      return null;
    }
    throw new Error(`GSC URL Inspection error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as {
    inspectionResult?: {
      richResultsResult?: {
        detectedItems?: Array<{
          richResultType?: string;
          items?: Array<{
            issues?: Array<{
              severity?: string;
              issueMessage?: string;
              type?: string;
            }>;
          }>;
        }>;
      };
    };
  };

  const detectedItems = data.inspectionResult?.richResultsResult?.detectedItems ?? [];
  const issues: RichResultsIssue[] = [];
  const richResultsDetected: string[] = [];

  for (const item of detectedItems) {
    if (item.richResultType) richResultsDetected.push(item.richResultType);
    for (const i of (item.items ?? [])) {
      for (const issue of (i.issues ?? [])) {
        issues.push({
          severity: (issue.severity as RichResultsIssue['severity']) || 'SUGGESTION',
          issueMessage: issue.issueMessage || '',
          type: issue.type || '',
        });
      }
    }
  }

  return {
    hasErrors: issues.some(i => i.severity === 'ERROR'),
    issues,
    richResultsDetected,
  };
}
```

- [ ] **Step 2: Add background validation imports to `webflow-schema.ts`**

In `server/routes/webflow-schema.ts`, add imports at the top with existing imports:

```typescript
import { inspectUrlForRichResults } from '../search-console.js';
import { updateSchemaGoogleStatus, getLatestPublishEntryByPageId } from '../schema-store.js';
import type { GoogleValidationStatus } from '../schema-store.js';
```

- [ ] **Step 3: Add `scheduleSchemaGoogleValidation` helper in `webflow-schema.ts`**

Add this function before the route definitions:

```typescript
/**
 * Queues a 3-minute delayed GSC URL Inspection check after schema publish.
 * Fires-and-forgets — never throws to the caller.
 */
function scheduleSchemaGoogleValidation(
  publishEntryId: string,
  pageUrl: string,
  siteId: string,
  workspaceId: string,
  liveDomain: string,
): void {
  // 3-minute CDN propagation delay
  setTimeout(async () => {
    try {
      const result = await inspectUrlForRichResults(siteId, pageUrl, `https://${liveDomain}`);
      if (!result) {
        // GSC not connected or quota exhausted
        await updateSchemaGoogleStatus(publishEntryId, 'no_gsc');
        broadcastToWorkspace(workspaceId, 'schema:google_validation', {
          publishEntryId, pageUrl, status: 'no_gsc',
        });
        return;
      }

      const status: GoogleValidationStatus = result.hasErrors ? 'google_failed' : 'google_validated';
      const errorIssues = result.issues.filter(i => i.severity === 'ERROR');
      await updateSchemaGoogleStatus(
        publishEntryId,
        status,
        errorIssues.length > 0 ? errorIssues.map(i => ({ type: i.type, message: i.issueMessage })) : undefined,
      );

      broadcastToWorkspace(workspaceId, 'schema:google_validation', {
        publishEntryId,
        pageUrl,
        status,
        issues: errorIssues,
        richResultsDetected: result.richResultsDetected,
      });

      log.info({ publishEntryId, pageUrl, status, issueCount: errorIssues.length }, 'schema google validation complete');
    } catch (err) {
      log.warn({ err, publishEntryId, pageUrl }, 'scheduleSchemaGoogleValidation failed');
    }
  }, 3 * 60 * 1000);
}
```

- [ ] **Step 4: Call `scheduleSchemaGoogleValidation` after `recordSchemaPublish`**

In `webflow-schema.ts`, find the `recordSchemaPublish` call:

```typescript
    recordSchemaPublish(req.params.siteId, pageId, pubWsForHistory?.id || '', schema);
```

Replace with:

```typescript
    const publishEntry = recordSchemaPublish(req.params.siteId, pageId, pubWsForHistory?.id || '', schema);

    // Background GSC validation — 3-minute delay for CDN propagation
    const pubPageUrl = req.body.pageUrl as string | undefined;
    if (pubWsForHistory && pubPageUrl && pubWsForHistory.liveDomain) {
      scheduleSchemaGoogleValidation(
        publishEntry.id,
        pubPageUrl,
        req.params.siteId,
        pubWsForHistory.id,
        pubWsForHistory.liveDomain,
      );
    }
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add server/search-console.ts server/routes/webflow-schema.ts
git commit -m "feat(schema): add GSC URL Inspection wrapper + schedule background google validation after publish"
```

---

## Task 13 — schema.org Pre-Publish Validation (Model: sonnet)

**Owns:** `server/schema/schema-org-validator.ts`, `server/db/migrations/082-schema-org-validation.sql`, `server/schema-store.ts` (schema_snapshots only), `server/schema/generator.ts` (one call site addition only)
**Must not touch:** any other file.
**Depends on:** Task 11 (generator integration) committed.

### Why

The GSC URL Inspection API requires a live published URL — it can't validate raw schema markup. That means without this task, errors only surface after publish. But there's a gap: schema is generated and stored days before an admin clicks "Publish." The schema.org validator API accepts raw JSON-LD and returns Google-aligned structural errors immediately. Adding this call at generation time means the admin sees issues in the dashboard the moment schema is produced, not after it's already live.

### What

`validator.schema.org` exposes an undocumented but stable HTTP API: `POST https://validator.schema.org/validate` with the page URL to fetch-and-validate, or `POST` with raw JSON-LD in the body. We use the raw-body path so we can validate before publish.

Response shape: `{ triples: [...], errors: [...] }` where `errors` is an array of `{ path, message }` objects.

### Status Lifecycle (schema_snapshots)

```
generated → schema_org_validated
          ↘ schema_org_failed
```

This is separate from `schema_publish_history.google_validation_status`. The schema.org status lives on the **snapshot** (the generated schema), not the publish event.

- [ ] **Step 1: Create migration 082**

Create `server/db/migrations/082-schema-org-validation.sql`:

```sql
-- Add schema.org validator results to schema snapshots
ALTER TABLE schema_snapshots ADD COLUMN schema_org_validation_status TEXT;
ALTER TABLE schema_snapshots ADD COLUMN schema_org_validation_details TEXT;
```

Verify the migration file exists and run it to confirm syntax:
```bash
ls server/db/migrations/082-schema-org-validation.sql
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/schema/schema-org-validator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { validateWithSchemaOrg } from '../../../server/schema/schema-org-validator.js';

const VALID_SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'LocalBusiness',
      '@id': 'https://example.com/#localbusiness',
      'name': 'Example Business',
      'url': 'https://example.com',
    },
  ],
};

const INVALID_SCHEMA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'LocalBusiness',
      // Missing @id and name — should produce errors
    },
  ],
};

describe('validateWithSchemaOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns schema_org_validated when no errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ triples: [], errors: [] }),
    });
    const result = await validateWithSchemaOrg(VALID_SCHEMA);
    expect(result.status).toBe('schema_org_validated');
    expect(result.issues).toHaveLength(0);
  });

  it('returns schema_org_failed with issues when errors present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        triples: [],
        errors: [
          { path: 'LocalBusiness/@id', message: '@id is required' },
          { path: 'LocalBusiness/name', message: 'name is required' },
        ],
      }),
    });
    const result = await validateWithSchemaOrg(INVALID_SCHEMA);
    expect(result.status).toBe('schema_org_failed');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].message).toBe('@id is required');
  });

  it('returns schema_org_validated (passes through) when fetch fails — never blocks generation', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await validateWithSchemaOrg(VALID_SCHEMA);
    expect(result.status).toBe('schema_org_validated');
    expect(result.issues).toHaveLength(0);
  });

  it('returns schema_org_validated when response is not ok — graceful degradation', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const result = await validateWithSchemaOrg(VALID_SCHEMA);
    expect(result.status).toBe('schema_org_validated');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/unit/schema/schema-org-validator.test.ts
```

Expected: FAIL — `Cannot find module '../../../server/schema/schema-org-validator.js'`

- [ ] **Step 4: Create `server/schema/schema-org-validator.ts`**

```typescript
import { createLogger } from '../logger.js';

const log = createLogger('schema-org-validator');

export type SchemaOrgValidationStatus = 'schema_org_validated' | 'schema_org_failed';

export interface SchemaOrgValidationIssue {
  path: string;
  message: string;
}

export interface SchemaOrgValidationResult {
  status: SchemaOrgValidationStatus;
  issues: SchemaOrgValidationIssue[];
}

const VALIDATOR_URL = 'https://validator.schema.org/validate';

/**
 * Validate raw JSON-LD against the schema.org validator API.
 * Called at schema generation time — before publish.
 * Always returns a result (never throws): on network failure, returns validated (pass-through)
 * so generation is never blocked by an external service.
 */
export async function validateWithSchemaOrg(
  schema: Record<string, unknown>,
): Promise<SchemaOrgValidationResult> {
  try {
    // schema.org validator accepts raw JSON-LD as body with content-type application/ld+json
    const res = await fetch(VALIDATOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ld+json' },
      body: JSON.stringify(schema),
      signal: AbortSignal.timeout(10_000), // 10s timeout — never stall generation
    });

    if (!res.ok) {
      log.warn({ status: res.status }, 'schema.org validator returned non-OK — treating as pass-through');
      return { status: 'schema_org_validated', issues: [] };
    }

    const data = await res.json() as {
      errors?: Array<{ path?: string; message?: string }>;
      triples?: unknown[];
    };

    const issues: SchemaOrgValidationIssue[] = (data.errors ?? []).map(e => ({
      path: e.path ?? '',
      message: e.message ?? '',
    }));

    const status: SchemaOrgValidationStatus = issues.length > 0 ? 'schema_org_failed' : 'schema_org_validated';

    log.info({ status, issueCount: issues.length }, 'schema.org validation complete');
    return { status, issues };
  } catch (err) {
    // Network error, timeout, or parse failure — never block generation
    log.warn({ err }, 'validateWithSchemaOrg failed — returning pass-through');
    return { status: 'schema_org_validated', issues: [] };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/unit/schema/schema-org-validator.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Add `SchemaOrgValidationStatus` type + columns to `schema-store.ts`**

In `server/schema-store.ts`, find where `schema_snapshots` rows are handled. Add the type, extend the snapshot row interface, update the mapper, and add `updateSnapshotSchemaOrgStatus`:

```typescript
export type SchemaOrgValidationStatus = 'schema_org_validated' | 'schema_org_failed';
```

Add to the `SchemaSnapshot` (or equivalent snapshot) interface:
```typescript
schemaOrgValidationStatus?: SchemaOrgValidationStatus;
schemaOrgValidationDetails?: SchemaOrgValidationIssue[];
```

Add to the `SnapshotRow` (or equivalent DB row) interface:
```typescript
schema_org_validation_status: string | null;
schema_org_validation_details: string | null;
```

Update `rowToSnapshot` mapper to read both new columns (same pattern as `googleValidationStatus`).

Add this export:
```typescript
import type { SchemaOrgValidationIssue } from './schema/schema-org-validator.js';

export function updateSnapshotSchemaOrgStatus(
  snapshotId: string,
  status: SchemaOrgValidationStatus,
  details?: SchemaOrgValidationIssue[],
): void {
  snapshotStmts().updateSchemaOrgStatus.run({
    id: snapshotId,
    status,
    details: details && details.length > 0 ? JSON.stringify(details) : null,
  });
}
```

Add `updateSchemaOrgStatus` to `snapshotStmts` createStmtCache:
```typescript
updateSchemaOrgStatus: db.prepare(`
  UPDATE schema_snapshots
  SET schema_org_validation_status = @status, schema_org_validation_details = @details
  WHERE id = @id
`),
```

**Note:** Read `server/schema-store.ts` before editing — find the actual snapshot interface name (may be `SchemaSnapshot`, `SnapshotEntry`, or similar), the row interface name, and the `createStmtCache` structure. The pattern above is correct; only the names may differ.

- [ ] **Step 7: Wire into `generator.ts`**

In `server/schema/generator.ts`, after `validateLeanSchema` is called and `LeanGeneratorOutput` is assembled, add a fire-and-forget schema.org validation call. This must NOT block `generateLeanSchema` — it runs asynchronously after the schema is saved.

Add import at top:
```typescript
import { validateWithSchemaOrg } from './schema-org-validator.js';
import { updateSnapshotSchemaOrgStatus } from '../schema-store.js';
```

Find where `generateLeanSchema` returns its result (the `return { suggestedSchemas, ... }` line). Before the return, add:

```typescript
  // Fire-and-forget: validate against schema.org API, update snapshot status async
  // Never awaited — result arrives seconds later, does not affect generation latency
  if (snapshotId) {
    validateWithSchemaOrg(finalSchema).then(({ status, issues }) => {
      updateSnapshotSchemaOrgStatus(snapshotId, status, issues.length > 0 ? issues : undefined);
    }).catch(() => {
      // Logged inside validateWithSchemaOrg — nothing to do here
    });
  }
```

**Note:** Before editing `generator.ts`, grep for where the snapshot ID is stored/available: `grep -n 'snapshotId\|saveSnapshot\|insertSnapshot' server/schema/generator.ts`. The variable name in context may differ — use whatever the file uses.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add server/db/migrations/082-schema-org-validation.sql \
        server/schema/schema-org-validator.ts \
        server/schema-store.ts \
        server/schema/generator.ts \
        tests/unit/schema/schema-org-validator.test.ts
git commit -m "feat(schema): add schema.org pre-publish validation — validates at generation time, stores result on snapshot"
```

---

## Task 14 — Tests: Post-Enrichment + Google Validation Status (Model: sonnet)

**Owns:** `tests/unit/schema/post-enrichment.test.ts`, `tests/unit/schema-google-validation-status.test.ts`
**Must not touch:** any other file.
**Depends on:** Tasks 11, 12, 13 committed.

- [ ] **Step 1: Write post-enrichment tests**

Create `tests/unit/schema/post-enrichment.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We test the public effect: generateLeanSchema output has FAQPage when semantics.faq present
// Test via internal behavior by mocking extractSemanticData and checking schema output.

vi.mock('../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn().mockResolvedValue({
    toolInput: {
      faq: [
        { question: 'What is your price?', answer: 'From $99.' },
        { question: 'Do you accept insurance?', answer: 'Yes, most major plans.' },
      ],
      aggregateRating: { ratingValue: 4.8, reviewCount: 500 },
      sameAs: ['https://facebook.com/example'],
    },
    promptTokens: 200, completionTokens: 100,
  }),
  callAnthropic: vi.fn(),
}));

// Mock extractFaq to return empty (no Cheerio FAQ) so we test semantics.faq path
vi.mock('../../../server/schema/extractors/faq.js', () => ({
  extractFaq: vi.fn().mockResolvedValue([]),
}));

// Mock extractDescription
vi.mock('../../../server/schema/extractors/description.js', () => ({
  extractDescription: vi.fn().mockResolvedValue('Test page description'),
}));

// Mock page-elements store (no stored catalog)
vi.mock('../../../server/page-elements-store.js', () => ({
  getPageElements: vi.fn().mockReturnValue(null),
  upsertPageElements: vi.fn(),
}));

import { generateLeanSchema } from '../../../server/schema/generator.js';

const BASE_INPUT = {
  pageId: 'page-test',
  pageMeta: {
    slug: 'test-page',
    title: 'Test Page',
    publishedPath: '/test-page',
    sourcePublishedAt: null,
  },
  html: '<html><body><main><h1>Test Page</h1><p>Content here</p></main></body></html>',
  baseUrl: 'https://example.com',
  workspace: {
    id: 'ws-1',
    name: 'Example Business',
    businessProfile: null,
    siteHasSearch: false,
    topKeywords: [],
  },
};

describe('applyPostEnrichment via generateLeanSchema', () => {
  it('appends FAQPage node from semantics.faq when no Cheerio FAQ present', async () => {
    const output = await generateLeanSchema(BASE_INPUT);
    const graph = output.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const faqNode = graph.find(n => n['@type'] === 'FAQPage');
    expect(faqNode).toBeDefined();
    expect((faqNode?.mainEntity as unknown[]).length).toBe(2);
  });

  it('does NOT double-append FAQPage when extractFaq already added one', async () => {
    const { extractFaq } = await import('../../../server/schema/extractors/faq.js');
    vi.mocked(extractFaq).mockResolvedValueOnce([
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);
    const output = await generateLeanSchema(BASE_INPUT);
    const graph = output.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const faqNodes = graph.filter(n => n['@type'] === 'FAQPage');
    expect(faqNodes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write Google validation status tests**

Create `tests/unit/schema-google-validation-status.test.ts`:

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';

describe('GoogleValidationStatus store', () => {
  let updateSchemaGoogleStatus: (id: string, status: string, details?: unknown) => void;
  let recordSchemaPublish: (siteId: string, pageId: string, wsId: string, schema: Record<string, unknown>) => { id: string };
  let getSchemaPublishEntry: (id: string) => { googleValidationStatus?: string } | null;

  beforeAll(async () => {
    const mod = await import('../../server/schema-store.js');
    updateSchemaGoogleStatus = mod.updateSchemaGoogleStatus as never;
    recordSchemaPublish = mod.recordSchemaPublish as never;
    getSchemaPublishEntry = mod.getSchemaPublishEntry as never;
  });

  it('records and retrieves google_validation_status', () => {
    const entry = recordSchemaPublish('site-test', 'page-gv-test', 'ws-test', { '@type': 'WebPage' });
    updateSchemaGoogleStatus(entry.id, 'google_validated');
    const retrieved = getSchemaPublishEntry(entry.id);
    expect(retrieved?.googleValidationStatus).toBe('google_validated');
  });

  it('records google_failed with issue details', () => {
    const entry = recordSchemaPublish('site-test', 'page-gv-fail', 'ws-test', { '@type': 'WebPage' });
    updateSchemaGoogleStatus(entry.id, 'google_failed', [{ type: 'MISSING_FIELD', message: 'name is required' }]);
    const retrieved = getSchemaPublishEntry(entry.id);
    expect(retrieved?.googleValidationStatus).toBe('google_failed');
    expect(retrieved?.googleValidationDetails?.[0]?.message).toBe('name is required');
  });
});

describe('inspectUrlForRichResults', () => {
  it('returns null when GSC token not available', async () => {
    // getValidToken returns null for unknown siteId
    const { inspectUrlForRichResults } = await import('../../server/search-console.js');
    const result = await inspectUrlForRichResults('no-such-site', 'https://example.com/page', 'https://example.com');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run new tests**

```bash
npx vitest run tests/unit/schema/post-enrichment.test.ts tests/unit/schema-google-validation-status.test.ts
```

Expected: all tests PASS (or confirm specific known failures from mocking environment).

- [ ] **Step 4: Run full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/schema/post-enrichment.test.ts tests/unit/schema-google-validation-status.test.ts
git commit -m "test(schema): add post-enrichment, google validation status, and schema.org validator tests"
```

---

## Quality Gates

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — production build succeeds
- [ ] `npx vitest run` — full test suite green
- [ ] `npx tsx scripts/pr-check.ts` — zero violations
- [ ] `FEATURE_AUDIT.md` updated — schema semantic extraction feature documented
- [ ] `data/roadmap.json` updated — mark schema extraction tasks done

---

## Verification Strategy

**Schema enrichment works (manual):**
```bash
# In dev, trigger schema regeneration for a Swish Dental location page
# Check the generated schema contains address, phone, hours, staff nodes
curl -X POST http://localhost:3001/api/webflow/generate-schema \
  -H "Content-Type: application/json" \
  -d '{"pageId": "...", "siteId": "...", "workspaceId": "..."}'
# Expected: @graph contains Dentist node with address, telephone, openingHoursSpecification
```

**Unknown-type generation works:**
```bash
# A page classified as 'WebPage' with non-empty semantics should get Haiku generation
# Check generator logs: "Unknown page type — Haiku-generated schema"
```

**Google validation status:**
```bash
# After publishing a schema, wait 3 minutes, then check the publish history entry
# Check DB: SELECT google_validation_status FROM schema_publish_history ORDER BY published_at DESC LIMIT 1
```

---

## Systemic Improvements

**Shared utilities:** `applyPostEnrichment` generalises the inline FAQ rollback pattern from generator.ts. Future enrichments (e.g. ImageGallery appended globally) follow the same pattern by adding a `tryAppend` call.

**pr-check rules to add (post-ship):** Consider a rule detecting direct Anthropic API calls that bypass `callAnthropicWithTools` for tool_use patterns (to ensure consistent retry + logging).

**Test coverage gaps to close:** Integration test exercising full generateLeanSchema with a real HTML fixture that has address, phone, and FAQ — asserting the final @graph contains Dentist + FAQPage + BreadcrumbList.

---

## Cross-Phase Notes

**Thing 2 (pipeline consolidation) — future work:**
- Replace `extractDescription` with `semantics.description` (add `description` to SemanticPageData)
- Retire `extractFaq` (Cheerio accordion parser) in favour of `semantics.faq`
- Consolidate `extractPageElements` + `extractSemanticData` into a single AI call

These are tracked as Thing 2 in the spec. Do NOT implement during this plan.
