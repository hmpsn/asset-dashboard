# Schema Semantic Extraction & AI-Powered Generation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace empty-field schema templates with a universal AI extraction layer that mines page content for structured data, enriches all templates, generates correct schema for unknown page types, and validates published output against Google's Rich Results API.

**Architecture:** Haiku runs a semantic extraction pass on every page (extending the existing `PageElementCatalog`), feeding real NAP/hours/staff/services/offers data into existing templates. Pages that don't match a known template type get a second Haiku call that generates schema from scratch using the extracted data + workspace context. A post-enrichment pass appends `FAQPage`, `VideoObject`, and `sameAs` to all pages regardless of type. After Webflow publish, a background job calls the GSC URL Inspection API and surfaces any Google-detected failures in the dashboard with a one-click rollback.

**Tech Stack:** Haiku 4.5 (extraction + unknown-type generation), Anthropic tool use for structured output, GSC URL Inspection API (existing OAuth), Webflow API (existing), SQLite page_elements store (existing).

---

## Context

The current schema generator produces structurally correct but content-empty schema. A Swish Dental location page (`/location/domain-north-austin-dentist`) contains a complete address, phone, hours, 4.7-star Google rating, 10,000+ reviews, 15 services, 6 named dentists, and 15 FAQ pairs — none of which appear in the generated `WebPage + BreadcrumbList` output. The root cause is that templates are fed only from meta tags and workspace profile fields; no extraction reads the visible page content.

This design introduces a universal extraction layer that solves this for every page type — not just location pages, but service pages, pricing pages, team pages, and any one-off pages that don't fit existing templates.

---

## What We're NOT Doing (Thing 2)

This spec covers **Thing 1** only:
- Adding semantic extraction to the catalog
- Enriching existing templates with extracted data
- Haiku generation for unknown types
- Post-enrichment pass
- Google validation post-publish

**Thing 2** (pipeline consolidation) is a follow-on:
- Replacing `extractDescription` with `semantics.description`
- Replacing `extractFaq` (Cheerio accordion parser) with `semantics.faq`
- Consolidating `extractPageElements` + `extractSemanticData` into a single AI call

---

## Component 1: SemanticPageData Type

**File:** `shared/types/page-elements.ts` — extend `PageElementCatalog` with a `semantics` field.

```typescript
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
    platform?: string;  // "Google", "Yelp", etc.
  };
  reviews?: Array<{
    author: string;
    reviewBody: string;
    ratingValue?: number;
  }>;

  // Business identity
  foundingDate?: string;
  numberOfLocations?: number;
  sameAs?: string[];          // social + directory profile URLs
  certifications?: string[];  // "ADA member", "BBB Accredited"
  mediaMentions?: string[];   // "As seen in Forbes"
  awards?: string[];
  highlights?: string[];      // "10,000+ reviews", "Founded 2015", "18 locations"
  insurance?: string[];
  paymentOptions?: string[];  // financing partners, payment methods
  areaServed?: string[];      // page-level: "Serving Austin, Cedar Park"
  languagesSpoken?: string[];
  accessibility?: string[];   // "Wheelchair accessible", "Free parking"

  // Content entities
  services?: string[];
  staff?: Array<{
    name: string;
    credentials?: string;  // "DMD", "DDS"
    jobTitle?: string;
    image?: string;
  }>;
  offers?: Array<{
    name: string;
    price?: string;
    priceCurrency?: string;
    description?: string;
  }>;
  priceRange?: string;  // "$", "$$", "$$$"
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
  pageCategory?: string;  // Haiku's best-guess category for unknown-type generation
}
```

`PageElementCatalog` gets one new optional field:

```typescript
export interface PageElementCatalog {
  // ... existing fields unchanged ...
  semantics?: SemanticPageData;  // NEW — populated by extractSemanticData()
}
```

---

## Component 2: Semantic Extraction

**File:** `server/schema/extractors/semantic.ts`

**One exported function:**

```typescript
export async function extractSemanticData(
  html: string,
  options: {
    pageBaseUrl: string;
    workspaceBusinessProfile?: BusinessProfile | null;
  }
): Promise<SemanticPageData>
```

### Input Preparation

Before calling Haiku, pre-process the HTML:

1. **Main content only** — use existing `content-scope.ts` to strip nav/header/footer/sidebar. Reduces token count by 40–60% on typical pages.
2. **Social hrefs** — extract all `<a href>` values, filter to known social/directory domains (`linkedin.com`, `facebook.com`, `instagram.com`, `twitter.com`, `x.com`, `yelp.com`, `google.com/maps`, `tiktok.com`, `youtube.com`). Pass as a separate list — prevents noise from hundreds of internal links.
3. **Media srcs** — extract `<iframe src>` and `<video src>` values. Pass separately for video metadata extraction.
4. **Token ceiling** — if stripped text exceeds 6,000 tokens, truncate to the first 6,000. Most content-bearing sections appear early in the document.

### Haiku Call

Uses Anthropic tool use (structured output) to enforce the `SemanticPageData` shape. The tool definition mirrors the interface exactly — Haiku cannot return fields that aren't in the schema.

**Critical system prompt instruction:** *For every field, return `null` if the information is not clearly and explicitly present on the page. Do not infer, assume, or guess. A missing phone number is better than a wrong one.*

### Post-Extraction Validation

After the Haiku call, before storing:

| Field | Check |
|-------|-------|
| `phone` | Matches phone pattern AND appears verbatim in stripped text |
| `address.postalCode` | 5-digit or ZIP+4 format |
| `aggregateRating.ratingValue` | Between 0.0 and 5.0 |
| `aggregateRating.reviewCount` | Positive integer |
| `hours[].opens/closes` | Parseable time strings |
| `sameAs[]` | Valid URLs, on allowed domain list |
| `address` | If `workspace.businessProfile` also has an address and they conflict — log warning, keep page-level (it's location-specific) |

Fields that fail their check are nulled out. The rest of the extraction proceeds.

### Storage

`extractSemanticData` returns `SemanticPageData`. The caller (`generateLeanSchema`) merges it onto the catalog and calls `upsertPageElements` once — no separate write. Sequential, not parallel: `extractPageElements` runs first, then `extractSemanticData` adds to the same object, then a single `upsertPageElements` write. Eliminates write-race risk.

Stale-check reuses the existing `sourcePublishedAt` logic. One stale check refreshes both structural elements and semantics together.

---

## Component 3: Generation Flow

### Updated `generateLeanSchema` orchestration

```
1. Lazy-refresh catalog:
   a. extractPageElements (existing) — AI calls inside gated by AiBudget as before
   b. extractSemanticData (new) — sequential after a, merged into same catalog write
      NOTE: extractSemanticData is NOT gated by AiBudget. It always runs when the
      catalog is stale. It is the core enrichment call, not an optional enhancement.

2. extractDescription — only if pageData.description is still missing (unchanged behaviour)

3. Classify page → PageKind

4. If PageKind === 'WebPage' (unknown type):
     schema = await generateSchemaForUnknownType({ semantics, pageData, workspace })
   Else:
     schema = buildXxxSchema({ baseUrl, pageData, semantics, businessProfile, ... })

5. Post-enrichment pass (all pages, see Component 4)

6. validateLeanSchema (extended, see below)

7. Return LeanGeneratorOutput
```

### Template Enrichment

Every template receives `semantics?: SemanticPageData` as an optional parameter. Templates use what they recognise; absence of `semantics` is handled gracefully (existing behaviour unchanged).

Key enrichments per template:

| Template | New semantics fields consumed |
|----------|------------------------------|
| `local-business.ts` | `phone`, `address`, `hours`, `geo`, `parking`, `aggregateRating`, `staff`, `services`, `sameAs`, `insurance`, `areaServed`, `languagesSpoken`, `accessibility` |
| `service.ts` | `offers`, `priceRange`, `staff`, `aggregateRating`, `areaServed`, `certifications` |
| `article.ts` | `author` (from `staff[0]` if no existing author), `primaryImage` |
| `homepage.ts` | `foundingDate`, `numberOfLocations`, `sameAs`, `awards`, `mediaMentions` |
| `static.ts` (About) | `staff`, `foundingDate`, `sameAs`, `awards` |
| `static.ts` (Contact) | `phone`, `email`, `address`, `hours` |

### Unknown-Type Generation

**File:** `server/schema/extractors/schema-generation.ts`

```typescript
export async function generateSchemaForUnknownType(input: {
  semantics: SemanticPageData;
  pageData: PageData;
  workspace: WorkspaceSchemaInput;
  baseUrl: string;
}): Promise<Record<string, unknown>>
```

**System prompt includes:**
1. A compact schema.org type reference — static string constant covering ~30 business-relevant types (`Dentist`, `Attorney`, `LegalService`, `ProfessionalService`, `FinancialService`, `FoodEstablishment`, `Hotel`, `Product`, `Course`, `Event`, `MedicalBusiness`, `HealthAndBeautyBusiness`, etc.) with their key properties. Included with `cache_control: { type: 'ephemeral' }` — cached across all pages in the same run.
2. Workspace context: business name, industry, top keywords, `businessProfile` if set.
3. The extracted `SemanticPageData` as structured JSON.
4. Page meta: title, canonical URL, description, breadcrumbs.
5. Instruction: output must be a valid `@graph` array. Every node must have `@type`, `@id`, `@context`. Return only types from the provided reference — no invented types.

Output is parsed and passed directly to the post-enrichment pass and validator.

---

## Component 4: Post-Enrichment Pass

Runs for **all pages** after the base schema is assembled (whether from a template or Haiku generation). Generalises the existing FAQ-append pattern.

```typescript
function applyPostEnrichment(
  schema: Record<string, unknown>,
  semantics: SemanticPageData | undefined,
  catalog: PageElementCatalog | undefined,
  canonicalUrl: string,
  baseValidationFindings: ValidationFinding[]
): Record<string, unknown>
```

Each enrichment is guarded with the existing rollback pattern: append → validate → if new errors introduced → pop.

| Enrichment | Source | Guard |
|-----------|--------|-------|
| `FAQPage` node | `semantics.faq` (≥2 pairs) | Not already in @graph; rollback on new errors |
| `VideoObject` nodes | `catalog.videos` (authoritative) with `semantics.videos` as fallback for any missed | Not already in @graph for that URL |
| `sameAs` on primary org node | `semantics.sameAs` | Primary node is Organization/LocalBusiness/subtype |
| `AggregateRating` on primary node | `semantics.aggregateRating` | Primary node doesn't already have `aggregateRating` |

**Source priority for videos:** `catalog.videos` wins (structural extractor is more reliable for media). `semantics.videos` supplements only if `catalog.videos` is empty.

**FAQ deduplication:** the existing `extractFaq` (Cheerio accordion parser) also appends a `FAQPage` node. The guard `!graph.some(n => n['@type'] === 'FAQPage')` prevents double-append. In Thing 2, `extractFaq` is retired in favour of `semantics.faq`.

---

## Component 5: Extended Validator

**File:** `server/schema/validator.ts`

Two changes:

**1. New rule sets for common long-tail types:**

Add explicit required/recommended field rules for: `Dentist`, `MedicalBusiness`, `LegalService`, `ProfessionalService`, `Event`, `Course`, `Product`. These are the most predictable outputs of unknown-type generation and warrant proper validation.

**2. Passthrough for truly unknown types:**

For any `@type` not in the validator's rule set, run structural validation only:
- Has `@context: "https://schema.org"`
- Has non-empty `@type` string
- Has `@id` that is a valid URL
- No property values are empty strings or empty arrays

Return a `ValidationFinding` with `severity: 'warning'` and `ruleId: 'unverified-type'` rather than `severity: 'error'`. This surfaces the uncertainty without blocking publication.

---

## Component 6: Post-Publish Google Validation

### Schema Status Lifecycle

New `googleValidationStatus` field on the schema storage record:

```
generated → published → google_validated
                     ↘ google_failed
```

### Background Job

Triggered when schema is published to Webflow. Queued with a 3-minute delay for CDN propagation.

```typescript
async function validatePublishedSchema(workspaceId: string, pageUrl: string) {
  const gscClient = await getGscClient(workspaceId);
  if (!gscClient) {
    // No GSC connected — mark as locally_validated, skip Google check
    await updateSchemaGoogleStatus(workspaceId, pageUrl, 'no_gsc');
    return;
  }

  const result = await gscClient.urlInspection.index.inspect({
    inspectionUrl: pageUrl,
    siteUrl: workspace.liveDomain,
  });

  const items = result.inspectionResult?.richResultsResult?.detectedItems ?? [];
  const hasErrors = items.some(item =>
    item.items?.some(i =>
      i.issues?.some(issue => issue.severity === 'ERROR')
    )
  );

  const status = hasErrors ? 'google_failed' : 'google_validated';
  await updateSchemaGoogleStatus(workspaceId, pageUrl, status);

  if (hasErrors) {
    await createSchemaValidationAlert(workspaceId, pageUrl, items);
  }
}
```

**Rate limits:** URL Inspection API quota is 2,000 requests/day per verified property. Sufficient for schema publish operations.

**Fallback:** If GSC is not connected for a workspace, status is `locally_validated`. The UI badge reflects the difference clearly.

### UI Status Badges

| Status | Badge |
|--------|-------|
| `generated` | — |
| `published` | "Published · Google check pending" |
| `google_validated` | "Google validated ✅" |
| `google_failed` | "Google flagged issues ⚠️ [Review] [Rollback]" |
| `locally_validated` | "Locally validated" |
| `no_gsc` | "Connect GSC for Google validation" |

### Rollback

One-click rollback on `google_failed`:
1. Calls Webflow API to remove published JSON-LD from the page
2. Sets schema status back to `generated`
3. Shows in-app alert with the specific errors Google returned so the admin knows what to fix

Rollback is **operator-initiated only** — never automatic. A client may have already noticed rich results appearing.

---

## Error Handling & Fallbacks

| Failure | Behaviour |
|---------|-----------|
| `extractSemanticData` throws | Log warning; schema generation continues with `semantics: undefined` (existing template behaviour) |
| `extractSemanticData` succeeds but `upsertPageElements` throws | Semantics used in-memory for this run; persistence skipped; logged |
| `generateSchemaForUnknownType` throws | Fall back to `buildWebPageSchema` (existing generic fallback); logged |
| Post-enrichment append introduces validator errors | Roll back the append; log which enrichment was skipped |
| GSC URL Inspection API fails | Log error; schema remains in `published` status; retry on next publish event |
| GSC quota exhausted | Log warning; skip validation for the day; resume next day |

---

## What This Solves

**Before:** Swish `/location/domain-north-austin-dentist` → `WebPage + BreadcrumbList`. No address, phone, hours, rating, staff, services.

**After:** `Dentist + BreadcrumbList + FAQPage + VideoObject[]`. Full NAP, 4.7-star rating with review count, 6 dentists as Person entities, 15 services in `hasOfferCatalog`, hours per-day, sameAs links to social profiles, 15 FAQ pairs.

**Coverage:** Any page type a Webflow site might have — location variants, pricing pages, team pages, course pages, event pages, comparison pages — gets structurally correct, content-rich schema. Not just less-empty WebPage.
