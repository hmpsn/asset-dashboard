# Page-Element Catalog PR2 — Pre-Plan Audit

**Date:** 2026-04-30
**Spec:** `docs/superpowers/specs/2026-04-29-page-element-catalog-design.md` (sections 5.2 + 7 + 8.1)
**Builds on:** PR1 audit at `docs/superpowers/audits/2026-04-29-page-element-catalog-audit.md` (shared infra now landed on staging)
**PR1 reference commit:** `d479bc60` (squash-merged PR #385)

## 1. Existing image-extraction patterns

**Status: zero overlap.** Image metadata is currently extracted only via meta tags in `server/schema/data-sources.ts:164-167`:

```typescript
const ogImage = metaContent($, 'meta[property="og:image"]');
const twitterImage = metaContent($, 'meta[name="twitter:image"]');
const linkImage = $('link[rel="image_src"]').attr('href') || undefined;
const image = ogImage || twitterImage || linkImage;
```

This populates a single `pageData.image` (the SEO hero) — it does NOT iterate over body `<img>` tags. PR2's image extractor (with role classification: hero / informative / decorative) is net-new at the DOM level.

**Adjacent (alt-text) infrastructure** — `server/routes/webflow-alt-text.ts` + `server/alttext.ts` generate alt-text for Webflow asset library images via Claude/OpenAI vision. They do not iterate `<img>` on a page; they iterate workspace assets. PR2 can borrow the OpenAI vision call shape from `server/alttext.ts:120-136` (proven pattern with `gpt-4.1-nano` + base64 data URLs).

**Conclusion:** PR2 image extractor is greenfield. No shared "iterate images on a page" helper exists; each module rolls its own.

## 2. Existing table/pricing-detection patterns

**Status: zero overlap.** No existing `<table>` extractor, no `isPricingLike` heuristic, no pricing-table detection in any template. The platform stores pricing in Stripe (subscription tiers) and `Service.priceRange` (a string). Neither path overlaps with extracting a pricing table from rendered HTML.

| Search pattern | Hits in `server/` |
|---|---|
| `isPricingLike\|isComparisonLike` | 0 (defined in `shared/types/page-elements.ts` but no extractor reads it) |
| `$('table'\|<table` Cheerio | 0 |
| `Service.*price\|product.*price` template | only `Service.priceRange` (string) |

## 3. Existing testimonial / Review patterns

**Status: validator entries exist; zero extraction.**

- `server/schema-validator.ts:175-177` (legacy validator) defines `Review` rich-result requirements (`itemReviewed, reviewRating, author`).
- `server/schema-suggester.ts:71,100` lists `'Review'` as a candidate schema type for review-pattern URLs.
- `server/content-brief.ts:542-553` and `server/blueprint-generator.ts` mention testimonials in narrative content planning (NOT extraction).
- **No `testimonials` field** on `Workspace` or `BusinessProfile`.
- **No live `Review` schema emission** in any template.
- **No blockquote/testimonial extraction** in any module.

PR2 adds the first testimonial extractor + first live `Review[]` + `AggregateRating` template emission.

## 4. Feature flag patterns

**Canonical addition pattern** (per `shared/types/feature-flags.ts` + CLAUDE.md "Phase-per-PR"):

1. Add a single line to the `FEATURE_FLAGS` const: `'schema-ai-element-classifier': false,`.
2. TypeScript automatically derives `FeatureFlagKey` from the object keys (no separate union edit).
3. Guard each consumer with `if (!isFeatureEnabled('schema-ai-element-classifier')) return fallback;`.
4. No DB migration needed — the `feature_flag_overrides` table already exists.

**Resolution cascade** (`server/feature-flags.ts:80`):
- DB override (10s LRU; `feature_flag_overrides` table)
- Env var (`FEATURE_SCHEMA_AI_ELEMENT_CLASSIFIER=true`)
- Hardcoded default `false` (dark-launched)

**Existing flags inventory:** 50+ flags. Naming convention is kebab-case scoped by feature (`copy-engine`, `client-briefing-v2`, `outcome-ai-injection`, `schema-yoast-parity`). PR2 flag name: **`schema-ai-element-classifier`**.

## 5. AI dispatch + vision-capable models

**Provider routing** (`server/ai.ts:40` `callAI`):
- Default `provider: 'openai'`.
- Routes to `callAnthropic()` if explicitly set; otherwise `callOpenAI()`.
- Token logging is provider-agnostic via `logTokenUsage({ feature, workspaceId, ... })`.

**OpenAI vision support — verified working** in `server/alttext.ts:120-136`:

```typescript
const response = await callOpenAI({
  model: 'gpt-4.1-nano',
  messages: [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' } },
      { type: 'text', text: buildPrompt(context) },
    ],
  }],
});
```

`server/openai-helpers.ts:212-215` accepts `content: string | Array<{ type: string; ... }>`.

**Anthropic vision support** — NOT YET wired in `server/anthropic-helpers.ts:12-15` (typed as `content: string` only). PR2 image classifier uses **OpenAI exclusively** with model `gpt-4.1-mini` (per spec).

**Recommendation:** PR2 should use the unified `callAI({ provider: 'openai', model: 'gpt-4.1-mini', feature: 'schema-ai-element-classifier', workspaceId, messages: [...] })` rather than direct `callOpenAI()`, per CLAUDE.md "new code should use this" (the `callAI` dispatcher) and to inherit token logging automatically.

## 6. AiBudget threading

**PR1 left this in place but not threaded through generateSchemaSuggestions.** Devin's PR1 round-5 informational note flagged it. The fix path:

**Current state** (`server/schema/generator.ts`):
```typescript
const aiBudget = input.aiBudget ?? createAiBudget(0); // PR1: zero AI calls
```
A budget is created per `generateLeanSchema` call; `generateSchemaSuggestions` does NOT pass one in, so each page gets a fresh `0`-cap budget. With PR2 enabling AI classification, the per-run cap (100 image classifications + 20 HowTo disambiguations) only works when ONE budget is shared across the loop.

**Three call sites in `server/schema-suggester.ts` need the budget threaded:**

| Function | Line | Fix |
|---|---|---|
| `generateSchemaForPage` | 345 | Create one budget at function entry; pass via `aiBudget` |
| `generateSchemaSuggestions` static-pages loop | 421 | Create ONE budget at function entry; pass to every iteration |
| `generateSchemaSuggestions` CMS items loop | 466 | Re-use the same budget from previous loop |

**Refactor signature** — `LeanGeneratorInput.aiBudget` is already `optional` (PR1). PR2 keeps it optional and adds:

```typescript
// In generateSchemaSuggestions:
const aiBudget = createAiBudget(
  isFeatureEnabled('schema-ai-element-classifier') ? 100 : 0,
);
// Pass to all 3 generateLeanSchema sites in this function.
```

`extractDescription` and `extractFaq` (existing AI sites in generator.ts) already work without budget plumbing because they're surgical (one call per page max). PR2 does NOT need to thread the budget into them — only into the page-element extractors.

## 7. Validator existing entries

`REQUIRED_BY_TYPE` (`server/schema/validator.ts:14-77` after PR1):

```typescript
{
  BlogPosting:    { required: ['headline','description','image','datePublished','dateModified','author','publisher','mainEntityOfPage','isPartOf','breadcrumb','inLanguage','articleSection'] },
  Article:        { required: ['headline','description','image','datePublished','dateModified','author','publisher','mainEntityOfPage','isPartOf','breadcrumb','inLanguage'] },
  Service:        { required: ['name','description','provider','isPartOf','breadcrumb','inLanguage'] },
  Product:        { required: ['name','description','isPartOf','breadcrumb','inLanguage'] },
  LocalBusiness:  { required: ['name','url','inLanguage'] },
  Organization:   { required: ['name','url'] },
  WebSite:        { required: ['name','url','publisher','inLanguage'] },
  AboutPage:      { required: ['name','url','description','isPartOf','breadcrumb','inLanguage','mainEntity'] },
  ContactPage:    { required: ['name','url','description','isPartOf','breadcrumb','inLanguage'] },
  CollectionPage: { required: ['name','url','description','isPartOf','breadcrumb','inLanguage'] },
  WebPage:        { required: ['name','url','description','isPartOf','breadcrumb','inLanguage'] },
  VideoObject:    { required: ['name','description','uploadDate'], recommended: ['thumbnailUrl','duration','embedUrl','contentUrl'] },
  HowTo:          { required: ['name','step'], recommended: ['totalTime','estimatedCost'] },
}
```

**PR2 adds 4 new entries** (none currently present):
```typescript
Review:          { required: ['itemReviewed','reviewRating','author'], recommended: ['datePublished','reviewBody'] },
AggregateRating: { required: ['ratingValue','reviewCount'], recommended: ['bestRating','worstRating'] },
Table:           { required: ['about'] },
ImageGallery:    { required: ['name','image'] },
```

**`@id` patterns for parent references:**
- Article/BlogPosting: `${pageData.canonicalUrl}#article`
- Service: `${canonicalUrl}#service` (templates/service.ts:19)
- LocalBusiness: `${baseUrl}/#localbusiness` (templates/local-business.ts:46)
- AboutPage/ContactPage: inline (no `#anchor`; uses `mainEntity`)

`Review.itemReviewed.@id` must point at the parent (Service or LocalBusiness) — the validator checks for this presence.

## 8. Template extension points

**`buildArticleSchema`** (`server/schema/templates/article.ts`) — PR1 already extended for HowTo + VideoObject + citation. PR2 splice points:
- After the HowTo block, add: optional `ImageGallery` node from informative images, optional `Review[]` (less likely on Articles; defer)

**`buildServiceSchema`** (`server/schema/templates/service.ts:14-36`) — primary node has name, description, provider, etc. PR2 splice points:
- Add `aggregateRating` field to the primary node when testimonials with ratings exist
- Append `Review[]` graph nodes via `withBreadcrumb([primary, ...reviews], pageData)`
- Append `Table` mainEntity sub-graph when a pricing/comparison table is detected
- Add hero image to the primary `image` field (currently single string)

**`buildLocalBusinessSchema`** (`server/schema/templates/local-business.ts:17-80`) — emits `[organization, localBusiness, website]`. PR2 splice points:
- LocalBusiness node gains `aggregateRating` + `review[]` (similar to Service)

**`buildHomepageSchema`** (`server/schema/templates/homepage.ts:17-56`) — emits `[organization, website]`. PR2 splice points:
- Optional ImageGallery (low priority; defer unless trivial)

**`withBreadcrumb`** (`server/schema/templates/helpers.ts:61-69`) — already accepts arrays. PR1 verified. No changes needed.

## 9. pr-check rules PR2 might trigger

| Rule | PR2 trigger surface | Mitigation |
|---|---|---|
| **Assembled-but-never-rendered slice fields** | None. PR2 doesn't add fields to `PageElementSlice` — the catalog interface already includes images/tables/testimonials from PR1's type def. `formatPageElementsSection` already iterates them. | No action |
| **`parseJsonSafe` boundary** | None. PR2 reuses `page_elements.catalog_json` blob; new fields go into the same Zod schema. Existing `parseJsonSafe` boundary covers them. | Update Zod schema in `server/schemas/page-elements-schema.ts` to accept new image/table/testimonial fields |
| **AI-call-before-DB-write transactions** | YES — when AI image classifier completes, `upsertPageElements` writes the result. Per `docs/rules/ai-dispatch-patterns.md`, the AI call + the DB write must be inside `db.transaction(() => { ... })`. | Wrap the extractor → upsert path in a transaction |
| **Workspace-id scoping** | All `upsertPageElements` calls already include `workspace_id` (PR1). PR2 doesn't introduce new UPDATE/DELETE. | No action |
| **Silent bare catch** | PR2 extractors will have try/catch. Each needs `// catch-ok: <reason>` comment. | Add comments per the established PR1 pattern |
| **`createStmtCache`** | No new stores. PR2 reuses `page-elements-store.ts`. | No action |
| **`Record<string, unknown>` in shared/types** | None. Element types already typed in PR1's `shared/types/page-elements.ts`; PR2 fills in fields, no new untyped surfaces. | No action |
| **`buildWorkspaceIntelligence` without slices** | PR2 doesn't add `buildSchemaContext` reads. | No action |

## 10. Test fixture corpus

**Existing PR1 fixtures** (`tests/fixtures/page-elements/`):
- `webflow-blog-howto.html`
- `webflow-blog-with-youtube.html`
- `webflow-blog-with-vimeo.html`
- `webflow-blog-with-citations.html`
- `webflow-no-elements.html`
- `webflow-mixed-elements.html`

**PR2 must add** (none exist yet):
- `webflow-service-pricing-table.html` — Service page with `<table>` containing tier rows + price columns. Should trip `isPricingLike: true` and 4-row × 3-col counts.
- `webflow-testimonials.html` — Service or LocalBusiness page with 3 `<blockquote>` testimonials, two with star-rating widgets (numeric `data-rating="5"`), one without.
- `webflow-decorative-images.html` — Article page with a hero `<img>` (large, in `<header>`), 2 informative inline images (alt text describes content), and 4 decorative images (small, role="presentation" or empty alt).
- `webflow-mixed-elements-pr2.html` — Service page combining all three (table + testimonials + images) for the multi-node @graph integration test.

## Existing coverage summary

- **Extractors:** 3 of 7 element types implemented (videos, lists, citations from PR1). PR2 adds 3 more (images, tables, testimonials). Headings + codeBlocks reserved for PR3.
- **Validator REQUIRED_BY_TYPE:** 11 page types + 2 element types (VideoObject, HowTo). PR2 adds 4 more.
- **Templates extended:** article.ts (PR1 extended). PR2 extends article.ts further + service.ts + local-business.ts + (optionally) homepage.ts.
- **AI infrastructure:** `callAI` dispatcher + token logging + budget helper all exist. PR2 wires the budget through schema-suggester loops + adds the OpenAI vision call site for the image classifier.

## Infrastructure recommendations

1. **Shared utility — image base64 encoder.** Both alttext.ts and the new image classifier need to fetch a remote `<img src>` and convert to base64 data URL. Extract to `server/schema/extractors/page-elements/image-fetch.ts`. ~20 LOC; one place to handle timeouts, content-type detection, fallback.
2. **pr-check rule — AI-budget-required-on-classifier-paths.** A small lint rule asserting any new `callAI(...)` call inside `server/schema/extractors/page-elements/**` must be guarded by `tryConsumeAiBudget(opts.aiBudget)`. Prevents PR2/PR3 regressions where a future extractor calls AI without consuming budget.
3. **Test coverage rule** (already in PR1) — every new extractor needs a corresponding `tests/unit/schema/extractors/page-elements-<name>.test.ts` with at least one positive case + one no-elements case + one malformed-HTML case.
4. **Root cause for the AI budget plumbing gap** — PR1 introduced `LeanGeneratorInput.aiBudget?` as optional; the optionality + `??` fallback in generator.ts allowed schema-suggester to "forget" to pass one. PR2 fixes by creating the budget at the OUTERMOST entry point (generateSchemaSuggestions / generateSchemaForPage) and threading it down. Long-term, consider making it required so the type system enforces threading.

## Parallelization strategy

### Phase 0 — Shared contracts (sequential, must commit first)

| Task | Files | Model |
|---|---|---|
| 0.1 — Add feature flag | `shared/types/feature-flags.ts` (1 line) | Haiku |
| 0.2 — Extend Zod catalog schema for new fields | `server/schemas/page-elements-schema.ts` (already has Image/Table/Testimonial — verify, no changes likely needed) | Haiku |
| 0.3 — Add validator REQUIRED_BY_TYPE entries | `server/schema/validator.ts` (4 entries) | Haiku |
| 0.4 — Refactor schema-suggester to thread aiBudget | `server/schema-suggester.ts` (3 call sites + budget allocation) | Sonnet |
| 0.5 — Image base64 fetch utility | `server/schema/extractors/page-elements/image-fetch.ts` (new) | Sonnet |

After Phase 0 commits land, the rest can run in parallel.

### Phase 1 — Pattern extractors (parallel, 3 agents, Sonnet)

| Task | Owns | Doesn't touch |
|---|---|---|
| 1.1 — Image extractor (pattern-only, no AI yet) | `server/schema/extractors/page-elements/images.ts` + test | tables.ts, testimonials.ts |
| 1.2 — Table extractor + pricing/comparison heuristic | `server/schema/extractors/page-elements/tables.ts` + test | images.ts, testimonials.ts |
| 1.3 — Testimonial extractor + rating parsing | `server/schema/extractors/page-elements/testimonials.ts` + test | images.ts, tables.ts |

### Phase 2 — Entry-point + AI integration (sequential after Phase 1, Sonnet)

| Task | Owns |
|---|---|
| 2.1 — Wire 3 new extractors into `extractPageElements` entry-point | `server/schema/extractors/page-elements.ts` |
| 2.2 — AI image classifier (vision call + classifier) | `server/schema/extractors/page-elements/image-ai-classifier.ts` (new) — wraps `images.ts` output and re-classifies role with budget |
| 2.3 — AI HowTo disambiguation | `server/schema/extractors/page-elements/howto-ai-fallback.ts` (new) — wraps `howto.ts` output |

### Phase 3 — Schema integrations (parallel, 3 agents, Sonnet)

| Task | Owns | Doesn't touch |
|---|---|---|
| 3.1 — Article template: ImageGallery + (optional) Review | `server/schema/templates/article.ts` | service.ts, local-business.ts |
| 3.2 — Service template: AggregateRating + Review[] + ImageGallery + Table | `server/schema/templates/service.ts` | article.ts, local-business.ts |
| 3.3 — LocalBusiness template: AggregateRating + Review[] | `server/schema/templates/local-business.ts` | article.ts, service.ts |

### Phase 4 — Test fixtures + integration tests (parallel, 2 agents, Haiku for fixtures, Sonnet for integration tests)

| Task | Owns |
|---|---|
| 4.1 — HTML fixtures (4 new) | `tests/fixtures/page-elements/webflow-{service-pricing-table,testimonials,decorative-images,mixed-elements-pr2}.html` |
| 4.2 — Integration tests for new node types | `tests/integration/lean-schema-generator.test.ts` (extend) + new `tests/integration/page-elements-pr2-extraction.test.ts` |

### Phase 5 — Documentation + cleanup (sequential, Haiku)

| Task | Owns |
|---|---|
| 5.1 — FEATURE_AUDIT.md entry | `FEATURE_AUDIT.md` |
| 5.2 — Roadmap update | `data/roadmap.json` |
| 5.3 — pr-check rule for AI-budget-on-classifier-paths (optional) | `scripts/pr-check.ts` |

## Model assignments

| Task type | Model | Reasoning |
|---|---|---|
| Mechanical extractor scaffolds (images.ts, tables.ts, testimonials.ts) | **Sonnet** | Each needs DOM heuristic decisions (role classification, isPricingLike) — Haiku struggles with multi-condition logic |
| AI integration prompts + classifier orchestration | **Sonnet** | Needs careful prompt engineering, error fallbacks, integration with budget |
| AiBudget threading refactor (3 call sites, multi-file) | **Sonnet** | Mechanical but cross-cutting; needs to verify no regression |
| Multi-template edits (article, service, local-business) | **Sonnet** | Templates have implicit conventions (dropUndefined, withBreadcrumb, @id patterns) |
| Validator REQUIRED_BY_TYPE additions | **Haiku** | Pattern-matched additions to a single map |
| HTML fixture authoring | **Haiku** | Tag-shape assembly only |
| Feature flag + roadmap + FEATURE_AUDIT entries | **Haiku** | Single-line edits |

## Net-new files (PR2)

```
server/schema/extractors/page-elements/images.ts
server/schema/extractors/page-elements/tables.ts
server/schema/extractors/page-elements/testimonials.ts
server/schema/extractors/page-elements/image-ai-classifier.ts
server/schema/extractors/page-elements/howto-ai-fallback.ts
server/schema/extractors/page-elements/image-fetch.ts (utility)
tests/fixtures/page-elements/webflow-service-pricing-table.html
tests/fixtures/page-elements/webflow-testimonials.html
tests/fixtures/page-elements/webflow-decorative-images.html
tests/fixtures/page-elements/webflow-mixed-elements-pr2.html
tests/unit/schema/extractors/page-elements-images.test.ts
tests/unit/schema/extractors/page-elements-tables.test.ts
tests/unit/schema/extractors/page-elements-testimonials.test.ts
tests/unit/schema/extractors/page-elements-image-ai.test.ts
tests/unit/schema/extractors/page-elements-howto-ai.test.ts
tests/integration/page-elements-pr2-extraction.test.ts
```

## Modified files (PR2)

```
shared/types/feature-flags.ts                              (+1 line)
server/schema/validator.ts                                 (+4 entries)
server/schema/extractors/page-elements.ts                  (entry-point: wire 3 new extractors + AI passes)
server/schema-suggester.ts                                 (3 call sites: thread aiBudget)
server/schema/templates/article.ts                         (optional ImageGallery node)
server/schema/templates/service.ts                         (Review[] + AggregateRating + Table + image gallery)
server/schema/templates/local-business.ts                  (Review[] + AggregateRating)
tests/integration/lean-schema-generator.test.ts            (extend with new node-type assertions)
FEATURE_AUDIT.md                                           (entry 325)
data/roadmap.json                                          (PR2 → done; PR3 pending)
scripts/pr-check.ts                                        (optional new rule)
```

## Self-review

- ✅ Spec coverage: every section 5.2 element + section 8.1 validator entry is owned by a Phase-N task.
- ✅ Zero placeholders: every task names a specific file path + change type.
- ✅ Type consistency: PageElementCatalog already has Image/Table/Testimonial in PR1's `shared/types/page-elements.ts`; PR2 fills in extractors that produce these types.
- ✅ Parallelization explicit: 5 phases with file ownership boundaries that prevent conflicts.
- ✅ Test plan: 6 new test files committed alongside extractors; integration test exercises the multi-node @graph for the PR2 element types.
