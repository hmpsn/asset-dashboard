# Page-Element Catalog — Pre-Plan Exhaustive Audit

**Date:** 2026-04-29
**Spec:** `docs/superpowers/specs/2026-04-29-page-element-catalog-design.md`
**Total findings:** 8 distinct conventions to mirror; 5 spec corrections needed; 10 pr-check rules to satisfy proactively; 3-PR decomposition validated

---

## 1. Spec corrections (apply before plan-writing)

These corrections should be patched into the spec before plan-writing — keeping the spec the single source of truth.

### Correction 1: Model name — `gpt-4.1-mini`, not `gpt-4o-mini`

Spec §4.3 + §7 reference `gpt-4o-mini`. Codebase standard (verified via 30+ existing `callOpenAI` invocations) is **`gpt-4.1-mini`** for cost-sensitive structural tasks. `gpt-4o-mini` does not appear anywhere in the codebase.

**Fix:** Replace `gpt-4o-mini` → `gpt-4.1-mini` in spec §4.3 + §7.

### Correction 2: Review schema required fields include `itemReviewed`

Spec §5.2 and §8.1 propose `Review` required = `[author, reviewRating]`. The codebase's `server/schema/rich-results.ts:31` already defines Review-required as `[itemReviewed, reviewRating, author]` per Google Search Central. The validator's new entry must include `itemReviewed`.

**Fix:** Update spec §8.1 to:
```typescript
'Review': { required: ['itemReviewed', 'reviewRating', 'author'], recommended: ['datePublished', 'reviewBody'] },
```

When emitting `Review[]` from testimonials, the template must populate `itemReviewed: { '@id': '...' }` pointing at the primary node (the Service or LocalBusiness being reviewed). Otherwise validation fails on every emission.

### Correction 3: Slice formatter is mandatory (pr-check enforced)

Spec §3.2 references the slice-dispatch pattern but does not call out the `Assembled-but-never-rendered slice fields` pr-check rule. This rule walks every `*Slice` interface in `shared/types/intelligence.ts` and confirms every field is referenced inside `format${SliceName}Section(slice)` in `workspace-intelligence.ts`.

**Fix:** Add to spec §4.1 (after the `PageElementCatalog` interface):
> Every field on `PageElementCatalog` must be referenced inside a new `formatPageElementsSection(slice: PageElementSlice)` function in `server/workspace-intelligence.ts` (mirrors `formatSeoContextSection` etc.). Fields used only for diagnostics (e.g. `extractedAt`, `diagnostics.aiClassificationCalls`) must be added to `KNOWN_UNRENDERED_FIELDS` in `scripts/pr-check.ts` with a justification comment. Failure to do this trips the `Assembled-but-never-rendered slice fields` pr-check rule.

### Correction 4: CMS HTML source clarification

Spec §4.2 implies the extractor accepts HTML from any source. Audit confirmed: **CMS items' body HTML is fetched via `fetchPublishedHtml(item.url)`, not from `fieldData`**. The published URL is authoritative; `fieldData` provides metadata only (author, dates, slug). No spec change needed — the extractor signature is already pure-HTML — but the implementation plan must call `fetchPublishedHtml(item.url)` for CMS items, not assume `fieldData` contains the body.

### Correction 5: Slice cache key shape

Spec §3.2 says the existing 5-min LRU + single-flight dedup applies. Audit confirmed key shape: `intelligence:${workspaceId}:${slices}:${pagePath}:${learningsDomain}${enrichWithBacklinks ? ':bl' : ''}`. The new `pageElements` slice automatically gets `pagePath` in the key when consumers pass `opts.pagePath` — no infrastructure changes needed.

---

## 2. Findings by category

### 2.1 Cheerio convention (3 files, 1 convention)

| File | Entry | Failure mode |
|---|---|---|
| `server/schema/extractors/faq.ts:16` | `extractFaq(html): Promise<FaqPair[]>` | Returns `[]` if <2 valid pairs; never throws |
| `server/schema/data-sources.ts:150` | `extractPageData(input): PageData` | Null-coalescing chain; tolerant of empty HTML |
| `server/schema/generator.ts:62` + `:82` | `detectExistingSchemas(html): string[]` + `plainText(html): string` | Silent ignore on malformed JSON-LD; `// catch-ok` comment |

**Convention:** `import * as cheerio from 'cheerio'` → inline `cheerio.load(html)` per extractor → fail gracefully (return empty / sentinel) → never throw.

**No shared utility.** Each extractor inlines its own load + traversal. Maintain this convention — don't introduce a wrapper.

**No pr-check constraint** specifically on Cheerio usage; it's server-only by directory placement (`server/schema/extractors/`).

### 2.2 Intelligence slice dispatch (8 existing slices)

| Slice | Per-page? | Per-page key |
|---|---|---|
| SeoContextSlice | ✓ | `opts.pagePath` (optional) |
| InsightsSlice | ✓ (forPage sub-object) | `opts.pagePath` (optional) |
| LearningsSlice | ✓ (forPage sub-object) | `opts.pagePath` (optional) |
| PageProfileSlice | ✓ (required) | `opts.pagePath` (required) |
| ContentPipelineSlice | ✗ | – |
| SiteHealthSlice | ✗ | – |
| ClientSignalsSlice | ✗ | – |
| OperationalSlice | ✗ | – |

**Dispatch:** `server/workspace-intelligence.ts:189-232` `assembleSlice()` switch.

**Per-page assembly precedent:**
- `assembleSeoContext` (line 234) reads `pagePath` from opts and populates `pageKeywords` via `pageMap.find(p => p.pagePath.toLowerCase() === pagePathLower)`.
- `assemblePageProfile` (line 228) requires `opts.pagePath` and throws if missing.

**LRU cache:** `server/intelligence-cache.ts` (LRUCache class, max 200 entries, 5-min TTL, 24h hard staleness). Single-flight via `singleFlight()` helper. Cache key auto-includes `pagePath`.

**`Assembled-but-never-rendered slice fields` pr-check rule** (`scripts/pr-check.ts:2070-2092`):
- Walks every `*Slice` interface
- Confirms every field referenced in `format${SliceName}Section()`
- Fields intentionally omitted go in `KNOWN_UNRENDERED_FIELDS` (lines 505-522) with a comment
- **PageElementSlice MUST add a formatter or extend KNOWN_UNRENDERED_FIELDS** — failure trips this rule on commit

**New PageElementSlice requirements:**
1. Add union entry to `IntelligenceSlice` (shared/types/intelligence.ts:22-29)
2. Add optional field to `WorkspaceIntelligence` (shared/types/intelligence.ts:52-65)
3. Add case in `assembleSlice()` switch
4. Implement `assemblePageElements(workspaceId, opts?)` with `log.warn` on failure
5. Implement `formatPageElementsSection(slice)` formatter referencing all fields (or add fields to KNOWN_UNRENDERED_FIELDS)

### 2.3 AI dispatch patterns (17 invocation sites)

**Canonical entry:** `callAI()` at `server/ai.ts:40` (provider-agnostic, dispatches to OpenAI or Anthropic).

**Reality:** Only 2 active `callAI()` invocations (description.ts, content-posts.ts). **30+ direct `callOpenAI` / `callAnthropic` calls** persist for legacy reasons.

**Cost tracking:** Automatic via `logTokenUsage()` in `server/openai-helpers.ts`. Persisted to `$DATA_DIR/ai-usage/{YYYY-MM-DD}.json`. Per-call rows include `feature`, `workspaceId`, `model`, `tokens`, `durationMs`. **No budget cap mechanism.** New code must implement its own per-call counter for the spec's 100-call cap.

**JSON mode:**
- OpenAI: `responseFormat: { type: 'json_object' }` + `parseJsonFallback<T>(result.text, fallback)` for parse + recovery
- Anthropic: prompt augmentation `"IMPORTANT: Return ONLY a single valid JSON object..."` + `stripCodeFence(result.text)` + `JSON.parse(cleaned)`

**Retry / timeout:**
- 3 retries default (configurable)
- Transient errors (429, 5xx) backoff exponentially, cap 30s
- `retry-after-ms` header (OpenAI) / `retry-after` (Anthropic) honored
- `insufficient_quota` 429 — fail fast (never retry)
- Timeout 60s (OpenAI) / 90s (Anthropic) via AbortSignal

**Provider routing:**
- Default: `provider: 'openai'`
- `callCreativeAI`: Claude-first, GPT fallback (creative/voice tasks)
- `gpt-4.1-mini` is the standard for cost-sensitive structural tasks (matches spec's intent — but spec said `gpt-4o-mini` which doesn't exist in the codebase; see Correction 1)

**Convention summary for new image-role classifier:**
```typescript
const result = await callAI({
  provider: 'openai',
  model: 'gpt-4.1-mini',
  feature: 'page-element-image-role',
  workspaceId,
  responseFormat: { type: 'json_object' },
  // ...messages...
});
const parsed = parseJsonFallback<ImageRoleResult>(result.text, { role: 'decorative' });
```

Wrap in try/catch; degrade to rule-based fallback on timeout/error. Track AI call count locally for budget cap.

### 2.4 Webflow HTML-fetch paths (5 categories)

| Category | Function | File:line | Notes |
|---|---|---|---|
| **PAGE_HTML_FETCH** | `fetchPublishedHtml(url)` | `server/helpers.ts:595` | Returns `Promise<string \| null>`; 5 callers |
| **SITEMAP_FETCH (CMS)** | `discoverCmsUrls(...)` | `server/webflow-pages.ts:361` | Returns CmsPageUrl[] (URLs only) |
| **SITEMAP_FETCH (static)** | `discoverSitemapUrls(baseUrl)` | `server/webflow-pages.ts:400` | Returns string[] |
| **CMS_ITEM_FETCH** | `discoverCmsItemsBySlug(...)` | `server/webflow-pages.ts:470` | Returns `CmsItemFull[]` (URL + fieldData metadata, NO body HTML) |
| **CMS_ITEM_FETCH (single)** | `listCollectionItems(...)` | `server/webflow-cms.ts:23` | API client; `fieldData` has metadata only |

**`generateLeanSchema` callers (3):** All in `server/schema-suggester.ts` (lines 345, 421, 466). All call `fetchPublishedHtml(url)` immediately before `generateLeanSchema(input)` and pass HTML via `input.html`.

**HTML caching:** Only `seo-audit.ts` has a per-batch in-memory `htmlCache: Map<string, string>` (cleared after audit). No persistent HTML cache. **The new `page_elements` table does NOT cache HTML — only the extracted catalog.**

**CMS body HTML:** Confirmed NOT in `fieldData`. Extractor must call `fetchPublishedHtml(item.url)` for CMS items (this is what the existing schema-suggester already does, so the integration is trivial).

### 2.5 `page_*` migration conventions (5 existing tables)

| Migration | Table | Primary key | FK | Notable |
|---|---|---|---|---|
| 024 | page_keywords | (workspace_id, page_path) | workspaces ON CASCADE | 9 JSON columns (TEXT) |
| 033 | schema_page_types | (site_id, page_id) | none ⚠ exception | No FK to workspaces |
| 057 | site_blueprints | id (TEXT) | workspaces ON CASCADE | 1 JSON column |
| 057 | blueprint_entries | id (TEXT) | site_blueprints ON CASCADE | 2 JSON columns |
| 057 | blueprint_versions | id (TEXT) | site_blueprints ON CASCADE | 1 JSON column |

**Convention:**
- `workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` (universal except `schema_page_types`, which is a known exception)
- JSON columns as TEXT (SQLite); validated at read with `parseJsonSafe(col, schema, fallback)` or `parseJsonFallback(col, fallback)`
- Timestamps as TEXT (ISO 8601 strings, set explicitly)
- Indexed on `workspace_id` at minimum
- Prepared statements wrapped in `createStmtCache(() => ({ ... }))`

**Latest migration:** 078 (`078-workspace-site-has-search.sql`). **Next available: 079.** Spec already targets 079 ✓.

**Mapper convention:** Every table has a `XxxRow` interface (typed for SQLite return shape) + `rowToCamelCase()` mapper that parses JSON columns + camelCases keys.

**JSON read pattern:**
```typescript
function rowToPageElements(row: PageElementsRow): PageElementsRecord {
  return {
    workspaceId: row.workspace_id,
    pagePath: row.page_path,
    catalog: parseJsonSafe(row.catalog_json, pageElementCatalogSchema, EMPTY_CATALOG),
    // ...
  };
}
```

### 2.6 `REQUIRED_BY_TYPE` validator entries (11 existing types)

`server/schema/validator.ts:14-69` defines `REQUIRED_BY_TYPE` for: BlogPosting, Article, Service, Product, LocalBusiness, Organization, WebSite, AboutPage, ContactPage, CollectionPage, WebPage.

PR1 added `recommended?: string[]` to `RequiredFields`; currently empty for all types.

**Helper validators** (lines 71-442):
- `validateBreadcrumb` (BreadcrumbList)
- `validateCrossRefs` (isPartOf / breadcrumb / mainEntityOfPage shape)
- `validateArticleShape` (Article + BlogPosting nested fields)
- `validateLocalBusinessShape` (LocalBusiness nested fields)
- `validateBreadcrumbOrdering` (BreadcrumbList position contiguity)
- `validateAbsoluteUrls` (URL field shape)

**Reference: `server/schema/rich-results.ts`** already encodes Google's per-type required fields (e.g. line 19: HowTo `[name, step]`; line 20: VideoObject `[name, uploadDate, thumbnailUrl]`; line 31: Review `[itemReviewed, reviewRating, author]`). Use this as the source of truth when proposing new entries.

**Test pattern:** `tests/unit/schema/validator.test.ts` uses one big `describe` block per Pillar / per validator family. New types should add a new `describe('validateLeanSchema — VideoObject/HowTo/Review (page-element catalog)', ...)` block at the appropriate location.

**Multi-node `@graph` append pattern** (FAQPage precedent):
- `server/schema/templates/helpers.ts:61` `withBreadcrumb(primary, pageData)` accepts `Record<string, unknown> | Array<Record<string, unknown>>` — array form pushes multiple nodes into `@graph`
- New templates emitting HowTo / VideoObject / Review will pass an array: `[primaryNode, howToNode, videoObjectNode]` to `withBreadcrumb`

### 2.7 pr-check rules touching this surface (10 directly relevant)

| # | Rule | Compliance for new code |
|---|---|---|
| 1 | **Bare JSON.parse on DB row column** | Use `parseJsonSafe(row.catalog_json, schema, EMPTY_CATALOG)` on every read |
| 2 | **Multi-step DB writes outside db.transaction()** | Wrap extractor + persist in `db.transaction(() => { ... })` if same function |
| 3 | **AI call before db.prepare without transaction guard** | Image classifier + INSERT must share a transaction; concurrent regenerates would race otherwise |
| 4 | **Record<string, unknown> in shared/types** | `PageElementCatalog` must be fully typed — every field named |
| 5 | **Local prepared statement caching** | Use `createStmtCache(() => ({ ... }))`; never `let stmt` |
| 6 | **UPDATE/DELETE missing workspace_id scope** | Every UPDATE/DELETE on `page_elements` must include `WHERE workspace_id = ?` |
| 7 | **buildWorkspaceIntelligence() without slices** | Consumers MUST pass `slices: ['pageElements']` (or a superset) |
| 8 | **Direct buildSeoContext() call** | Forbidden — use `buildWorkspaceIntelligence({ slices: ['seoContext', 'pageElements'] })` |
| 9 | **getOrCreate* function returns nullable** | If implementing `getOrCreatePageElements`, return type must NOT include `\| null` |
| 10 | **Silent bare catch in server files** | Every `try/catch` must use `} catch (err) { /* catch-ok: <reason> */ }` |

**Plus the `Assembled-but-never-rendered slice fields` rule** (covered in §2.2 above).

---

## 3. Existing infrastructure to reuse

| What | Where | Why it helps |
|---|---|---|
| `parseJsonSafe(text, zodSchema, fallback)` | `server/db/json-validation.ts` | Validates `catalog_json` on read |
| `parseJsonFallback<T>(text, fallback)` | `server/openai-helpers.ts` | Parses AI JSON-mode responses |
| `createStmtCache(() => ({...}))` | `server/db/stmt-cache.ts` | Lazy prepared-statement cache |
| `logTokenUsage(...)` | `server/openai-helpers.ts:15` | Auto cost tracking for `callAI` |
| `LRUCache<T>` + `singleFlight()` | `server/intelligence-cache.ts` | Existing slice cache infra |
| `withBreadcrumb(primary, pageData)` | `server/schema/templates/helpers.ts:61` | Multi-node @graph append |
| `dropUndefined({...})` | `server/schema/templates/helpers.ts` | Strips undefined fields |
| `fetchPublishedHtml(url)` | `server/helpers.ts:595` | The single-page HTML fetcher |
| Existing test fixture pattern | `tests/unit/schema/extractors.test.ts` | Mock-HTML fixture conventions |

**Net new code is small:** the catalog ships as 1 new extractor module + 1 new slice + 1 new migration + 1 new persistence file. Everything else extends existing modules.

---

## 4. Infrastructure recommendations

1. **Shared utility — none needed.** The Cheerio convention is "inline per extractor"; introducing a wrapper would conflict with the established pattern. Don't extract.
2. **Per-feature AI budget tracker** — small utility (`server/schema/extractors/ai-budget.ts`?) tracking AI call count within a single regenerate-all run. The 100-call cap is per-trigger, not per-workspace-per-day. Simple counter pattern; no DB persistence.
3. **pr-check rule: page-elements-extractor stays server-only** — optional defensive rule to lock the extractor in `server/schema/extractors/`. Probably overkill — directory placement + tsconfig-paths already enforce this.
4. **Test fixture corpus** — new `tests/fixtures/page-elements/` with 6+ HTML fixtures (called out in spec §8.2). Match existing fixture pattern: one HTML file per scenario, committed in plain text for diff readability.
5. **Documentation handoff** — `docs/rules/page-element-extraction.md` (new) documents the extractor architecture + how to add a new element type. Optional; can defer to PR3.

---

## 5. Parallelization Strategy

PR1 ships ~5 days. Decomposed into phased tasks below.

### Phase 0 — Shared contracts (sequential, must commit first)

These artifacts are imported by every later task; ship them in a single commit before parallel agent dispatch:

- `shared/types/page-elements.ts` — `PageElementCatalog`, all 8 element interfaces
- `shared/types/intelligence.ts` — extend `IntelligenceSlice` union; add `pageElements` to `WorkspaceIntelligence`
- `server/db/migrations/079-page-elements.sql` — table DDL
- `server/page-elements-store.ts` — typed CRUD with `createStmtCache`, `parseJsonSafe`, `db.transaction` wrap

Single sonnet task. ~1 day.

### Phase 1 — Extractor + 3 element types (parallel, 3 agents, sonnet)

Each agent owns one element type's extraction logic + tests. File ownership disjoint:

| Agent | Element type | Files owned |
|---|---|---|
| A | Videos (YouTube/Vimeo/native) | `server/schema/extractors/page-elements/video.ts` + `tests/unit/schema/extractors/video.test.ts` |
| B | HowTo lists (pattern-based, AI-fallback for ambiguity) | `server/schema/extractors/page-elements/howto.ts` + tests |
| C | Citations (outbound links to authoritative sources) | `server/schema/extractors/page-elements/citation.ts` + tests |

Each agent contributes:
1. The element-type extractor (single function, takes `$ = cheerio.load(html)`, returns typed array)
2. 2+ test fixtures under `tests/fixtures/page-elements/`
3. Unit test asserting extraction for fixture corpus

Parallel-safe: disjoint files, no shared state, no cross-imports.

### Phase 2 — Extractor entry-point + AI budget (sonnet, sequential after Phase 1)

Single sonnet task. ~0.5 day. Composes the 3 element-type extractors into `server/schema/extractors/page-elements.ts`:

```typescript
export async function extractPageElements(html, opts): Promise<PageElementCatalog> {
  const $ = cheerio.load(html);
  return {
    videos: extractVideos($),
    lists: await extractHowToLists($, opts),
    citations: extractCitations($),
    // ...other fields default to empty arrays for PR1
    extractedAt: new Date().toISOString(),
    sourcePublishedAt: opts.sourcePublishedAt ?? null,
    diagnostics: { aiClassificationCalls: opts.aiCallsUsed, hitAiBudgetCap: opts.aiCallsUsed >= opts.aiBudget, rawCounts: { ... } },
  };
}
```

Adds AI budget counter helper (`server/schema/extractors/ai-budget.ts`).

### Phase 3 — Slice integration (sonnet, sequential after Phase 2)

Single sonnet task. ~0.5 day:
- Add `'pageElements'` case to `assembleSlice()` switch
- Implement `assemblePageElements(workspaceId, opts)` reading from `page_elements` table; lazy-extract on miss
- Implement `formatPageElementsSection(slice)` formatter (or extend `KNOWN_UNRENDERED_FIELDS`)
- Wire stale-detection via `lastPublished` comparison

### Phase 4 — Schema integrations (parallel, 3 agents, sonnet)

Each agent owns one template's enrichment + the corresponding validator entry + tests:

| Agent | Schema | Files owned |
|---|---|---|
| D | VideoObject in Article + BlogPosting | `server/schema/templates/article.ts` (extend) + `tests/unit/schema/templates.test.ts` (new describe block) + `server/schema/validator.ts` (REQUIRED_BY_TYPE entry + helper if needed) |
| E | HowTo in Article + BlogPosting | Same pattern, distinct emit path |
| F | Article.citation[] | `server/schema/templates/article.ts` (extend) + tests |

Parallel-safe with one merge-conflict risk: all three modify `server/schema/templates/article.ts` and `server/schema/validator.ts`. Resolution: use exclusive section ownership within the file (each agent's edits go into a distinct dropUndefined block / a distinct REQUIRED_BY_TYPE entry / a distinct describe block). Ship in three sequential commits OR squash before push.

**Compromise:** dispatch sequentially — D → E → F — to avoid merge friction. Total ~1 day.

### Phase 5 — Generator integration + integration tests (sonnet, sequential)

Single sonnet task. ~1 day:
- `server/schema/generator.ts` — call `extractPageElements` lazily after page classification; pass catalog into the appropriate template
- `tests/integration/lean-schema-generator.test.ts` — extend with assertions that emitted JSON-LD includes VideoObject / HowTo / Article.citation[] for the appropriate fixtures

### Phase 6 — Quality gates + PR (haiku)

Single haiku task. ~0.5 day:
- Run typecheck / pr-check / vitest
- Update `FEATURE_AUDIT.md` + `data/roadmap.json`
- Open PR

**Total wall-clock:** ~5 days subagent-driven. Phase 1 + Phase 4 are the 2 parallel windows; everything else is sequential.

---

## 6. Model Assignments

| Task type | Recommended model | Reasoning |
|---|---|---|
| Phase 0 shared contracts | sonnet | Cross-file types must stay aligned; PR1 spec says ValidationFinding-type contracts pattern |
| Phase 1 element-type extractors (3 parallel) | sonnet | Cheerio + business logic; needs to read existing extractor conventions |
| Phase 2 extractor entry-point + AI budget | sonnet | Composes Phase 1 outputs + introduces AI budget pattern |
| Phase 3 slice integration | sonnet | Threading types through buildWorkspaceIntelligence + slice formatter — pr-check-sensitive |
| Phase 4 schema integrations (3 sequential) | sonnet | Template edits + REQUIRED_BY_TYPE + multi-node @graph append |
| Phase 5 generator integration + tests | sonnet | End-to-end wiring + integration tests |
| Phase 6 quality gates + PR | haiku | CLAUDE.md checklist execution |
| Reviewers (per task) | sonnet | spec-compliance + code-quality |

No opus tasks needed — the architecture is well-specified and the surface area is bounded.

---

## 7. Compliance gates from §2.7 — internalized into the plan

When writing the plan, every task's "Discipline" section must explicitly call out:

1. ✅ Use `parseJsonSafe(row.catalog_json, ...)` — never bare `JSON.parse`
2. ✅ Wrap extractor + persist in `db.transaction()` (Phase 3)
3. ✅ Wrap AI image classifier + DB write in same transaction (Phase 2 / Phase 3 boundary)
4. ✅ `PageElementCatalog` fully typed — no `Record<string, unknown>` (Phase 0)
5. ✅ `createStmtCache(() => ({ ... }))` for all prepared statements (Phase 0)
6. ✅ Every UPDATE/DELETE on `page_elements` has `WHERE workspace_id = ?` (Phase 0)
7. ✅ Slice consumers pass `slices: ['pageElements']` explicitly (Phases 3-5)
8. ✅ Every `try/catch` uses `} catch (err) { /* catch-ok: <reason> */ }` (everywhere)
9. ✅ `formatPageElementsSection` references every field, OR fields go into `KNOWN_UNRENDERED_FIELDS` (Phase 3)
10. ✅ Use `callAI({ provider: 'openai', model: 'gpt-4.1-mini', feature: 'page-element-image-role', workspaceId })` for AI calls

---

## 8. Roadmap entry update needed

The existing `schema-page-element-catalog-v1` entry in `data/roadmap.json` should split into 3 sub-entries (PR1 / PR2 / PR3) when PR1 ships, mirroring the `schema-yoast-parity-fields-pr1` / `-pr2` split pattern.

---

## 9. Handoff to writing-plans

**Audit complete.** 5 spec corrections, 7 conventions internalized, 10 pr-check rules to satisfy proactively, 6-phase parallelization with 2 parallel windows, all model assignments determined.

Next step: invoke `superpowers:writing-plans` with this audit doc + the spec as inputs to produce the PR1 implementation plan covering ~16 tasks across the 6 phases.
