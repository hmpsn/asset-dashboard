# Page-Element Catalog — Architectural Design

> **Status:** spec ready for review · **Author:** Claude Sonnet 4.6 + Joshua Hampson · **Date:** 2026-04-29

## 1. Background

Schema PR1 + PR2 (`schema-yoast-parity-fields`) raised the platform's schema correctness to Yoast Premium baseline parity: every page emits the right `@type`, all required cross-references and recommended-tier fields wire from existing workspace data, and the validator gates output against Google rich-result eligibility rules.

But schema correctness has a ceiling. Beyond it is the *content-shape* layer: the page actually contains a how-to walkthrough, a comparison table, a YouTube embed, customer testimonials, citations to authoritative sources. Yoast Premium can't see any of that; neither can the platform today. Each of those structural patterns maps to a Google rich-result type that the platform isn't competing for. Filing under `schema-page-element-catalog-v1` (Sprint J) — this is the move from "schema-correct" to "schema-rich."

The roadmap entry put it bluntly:

> Generally asking a strategic question that may come from clients in the future: are we wired to be able to report on specific blog or page elements, like tables, important images, etc.?

This spec is the answer: yes, after this work ships.

## 2. Goal

A typed `PageElementSlice` on `buildWorkspaceIntelligence` that, for any HTML the platform fetches, produces a structured catalog of the page's content elements (tables, images, videos, lists, testimonials, code blocks, citations, table-of-contents). Schema templates conditionally enrich based on the catalog: a HowTo-shaped numbered list emits `HowTo` schema; an embedded YouTube video emits `VideoObject`; outbound citations populate `Article.citation[]`; testimonials emit `Review` + `AggregateRating`; pricing tables emit `Table mainEntity`; image galleries emit role-classified `ImageObject[]`.

Every enrichment is **additive** and **degrades gracefully**. If extraction fails or finds nothing, schema falls back to current behavior — never blocks generation, never produces invalid output. If the AI image-role classifier is disabled, rule-based heuristics ship a usable result.

## 3. Architectural decisions

### 3.1 Trajectory: Pattern B from day one

PR1 (`schema-yoast-parity-fields`) planted the slice-consumption migration starter (`siteKeywords`, per-page `pageKeywords`). The remaining 5 legacy direct reads in `buildSchemaContext` are tracked under `schema-context-builder-pattern-b-migration` for opportunistic migration.

PageElementSlice is **born on Pattern B** — read via `buildWorkspaceIntelligence({ slices: ['pageElements'], pagePath })`, never via direct workspace reads. The pr-check rule `schema-context-direct-read-not-on-allowlist` (PR1) already catches violations. This is the second slice-migration anchor; combined with the first, the schema feature reaches Trajectory 1 alignment.

### 3.2 Slice-dispatch + per-page invocation

`PageElementSlice` follows the existing 8-slice pattern: typed interface in `shared/types/intelligence.ts`, dispatched from `assembleSlice` in `server/workspace-intelligence.ts`, populated by a new `assemblePageElements(workspaceId, opts)` function. Per-page extraction is keyed by `opts.pagePath` (mirrors the existing `pageKeywords` per-page slice fetch added in PR1).

The 5-min LRU cache + single-flight dedup of `buildWorkspaceIntelligence` dedups concurrent calls per `(workspaceId, pagePath)` key — the same reuse pattern PR1's per-page slice fetch relies on.

### 3.3 Storage: hybrid (DB + 5-min cache)

| Layer | Lifecycle | Purpose |
|---|---|---|
| **`page_elements` DB table** | Persists across server restarts; refreshed lazily | Survives cold starts; auditable; readable from non-schema features (admin reporting in a later phase) |
| **Slice in-memory cache** | 5-min TTL via existing `buildWorkspaceIntelligence` LRU | Avoids DB hits during a single regenerate-all run (28+ pages) |

DB schema (migration 079):

```sql
CREATE TABLE page_elements (
  workspace_id    TEXT NOT NULL,
  page_path       TEXT NOT NULL,                     -- canonical path; e.g. /services/web-design
  catalog_json    TEXT NOT NULL,                     -- typed PageElementCatalog blob
  source_html_at  TEXT NOT NULL,                     -- ISO timestamp of HTML fetch
  source_published_at TEXT,                          -- Webflow lastPublished at extract time (stale-detection key)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (workspace_id, page_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_page_elements_workspace ON page_elements(workspace_id);
```

`catalog_json` is a `PageElementCatalog` typed blob; `parseJsonSafe` validation at the read boundary enforces the shape (CLAUDE.md DB-pattern rule).

### 3.4 Refresh trigger: 100% lazy on schema-generate

No cron, no eager extract-on-page-fetch. Each `generateLeanSchema` call checks the cache → DB → if stale or missing, runs the extractor and persists. Stale = `Webflow lastPublished > stored source_published_at`. The check is cheap (one row read keyed on `(workspace_id, page_path)`).

This trigger model has three advantages:
1. **Reuses the existing trigger** the user already initiates ("Re-generate All"). No new orchestration, no background jobs, no failure modes.
2. **Naturally rate-limited** — extraction only runs for pages whose schema is being generated. A 200-page site that hasn't regenerated still costs zero.
3. **Trivial to test** — the schema integration test corpus already exercises this path; element-detection tests hook the same flow.

## 4. Element types and extraction strategy

### 4.1 PageElementCatalog interface (canonical typed blob)

```typescript
// shared/types/page-elements.ts
export interface PageElementCatalog {
  /** When the catalog was extracted. */
  extractedAt: string;
  /** Source HTML's published timestamp at extract time. */
  sourcePublishedAt: string | null;
  /** Heading-tree summary for ToC + speakable cssSelector candidates. */
  headings: Heading[];
  /** Tables detected in main content area (filters out nav/footer tables). */
  tables: Table[];
  /** Images with role classification. */
  images: PageImage[];
  /** Embedded videos (YouTube/Vimeo/native <video>). */
  videos: Video[];
  /** Lists; flagged with isHowToLike when matching HowTo heuristics. */
  lists: PageList[];
  /** Customer testimonials detected via class heuristics. */
  testimonials: Testimonial[];
  /** Code blocks (used for CodeRepository / SoftwareApplication enrichment in future). */
  codeBlocks: CodeBlock[];
  /** Outbound links to authoritative sources (Article.citation[]). */
  citations: Citation[];
  /** Diagnostic counters — extractor confidence, AI calls used, fallback paths hit. */
  diagnostics: ExtractionDiagnostics;
}

export interface Heading { level: 1|2|3|4|5|6; text: string; id?: string; }
export interface Table { rowCount: number; colCount: number; caption?: string; isPricingLike: boolean; isComparisonLike: boolean; }
export interface PageImage {
  src: string;
  alt?: string;
  caption?: string;
  /** AI-classified or rule-derived. hero = lead image; informative = body diagram/screenshot; decorative = pattern/spacer. */
  role: 'hero' | 'informative' | 'decorative';
  /** How the role was determined — for diagnostics + future tuning. */
  roleSource: 'rule' | 'ai' | 'fallback';
  width?: number;
  height?: number;
}
export interface Video {
  provider: 'youtube' | 'vimeo' | 'native' | 'other';
  embedUrl: string;
  thumbnailUrl?: string;
  durationSec?: number;
  title?: string;
}
export interface PageList {
  kind: 'ordered' | 'unordered';
  itemCount: number;
  /** True when ordered + items contain action verbs + nearby heading is "how to" / "steps". */
  isHowToLike: boolean;
  /** When isHowToLike, the parsed step text. */
  steps?: HowToStep[];
}
export interface HowToStep { name: string; text: string; position: number; }
export interface Testimonial { author?: string; quote: string; rating?: number; selector: string; }
export interface CodeBlock { language?: string; lineCount: number; }
export interface Citation { url: string; text: string; isExternal: boolean; }
export interface ExtractionDiagnostics {
  /** Number of AI image-role classifier calls made. */
  aiClassificationCalls: number;
  /** True when AI calls hit the per-regenerate budget cap and remaining images fell through to rule-based. */
  hitAiBudgetCap: boolean;
  /** Per-element-type detection counts before filtering. */
  rawCounts: Record<string, number>;
}
```

### 4.2 Extractor module — `server/schema/extractors/page-elements.ts`

Single entry point. Mirrors `extractors/faq.ts` conventions:

```typescript
import * as cheerio from 'cheerio';
import type { PageElementCatalog } from '../../../shared/types/page-elements.js';

export async function extractPageElements(
  html: string,
  opts: { workspaceId: string; pagePath: string; aiBudgetRemaining: number },
): Promise<PageElementCatalog> { /* … */ }
```

Extraction order matters for cost: cheap rule-based detection runs first (tables, lists, videos, citations), AI image classification runs last with budget tracking. If an early detector fails, downstream still works.

### 4.3 AI image-role classifier

**Default: rule-based, no AI calls.** Heuristic uses alt-text patterns + DOM position + size:
- `hero` → first image in `<main>`/article body, large width, no `decorative` aria attributes
- `decorative` → `aria-hidden="true"`, `role="presentation"`, alt empty, very small dimensions
- `informative` → everything else (the safe default)

**Optional: GPT-4o-mini behind feature flag `pageElementCatalog.aiImageClassification`.** When flag is on, sends `{alt, caption, position, srcUrlBasename}` (text only, no Vision API) to `callAI({ provider: 'openai', model: 'gpt-4o-mini', json: true, ... })` requesting role classification. Vision API is intentionally out of scope (cost ceiling).

**Cost ceiling: 100 AI classifications per regenerate-all run.** Budget tracked across the loop; once exhausted, remaining images fall through to rule-based. Diagnostics field `hitAiBudgetCap: true` exposes when this happened so admins can decide to upgrade.

### 4.4 Detection thresholds

| Element type | Default detector | AI fallback |
|---|---|---|
| **Tables** | Cheerio `<table>` selector + filter (must have ≥2 rows + located in `<main>`/article scope, not nav/footer) | None |
| **Lists (HowTo-like)** | Pattern: ordered list + items contain action verbs (regex over the first verb of each item) + nearby heading matches `/how to\|steps?\|guide/i` | When pattern is ambiguous (single signal matches), `callAI` classifies the list with `provider: 'openai', model: 'gpt-4o-mini', json: true` |
| **Videos** | `<iframe src*="youtube"\|"vimeo">`, `<video>`, common embed wrappers (`.video-embed`, `[data-video]`) | None |
| **Testimonials** | Class heuristics: `.testimonial`, `.review`, `[data-testimonial]`, `<blockquote>` with `<cite>` | Optional AI when class signals absent |
| **Code blocks** | `<pre><code>` + `<code>` elements with `language-X` class | None |
| **Citations** | Outbound `<a href>` to absolute URLs (filtered: not own domain, not nav, in body content) | None |
| **Images (role)** | Rule-based (alt + position + dimensions) | GPT-4o-mini behind feature flag |
| **Headings/ToC** | `h1-h6` walk; collects text + auto-generates `id` if missing | None |

**Multi-element precedence:** an article with a HowTo-like list AND an embedded video emits BOTH `HowTo` and `VideoObject` schema nodes (Schema.org explicitly allows multiple `@type`s in a `@graph`). Google handles this correctly.

## 5. Schema integrations (per template)

Every integration is gated on the catalog containing the relevant element. Empty catalog → no enrichment → existing template output.

### 5.1 PR1 schema integrations (the content-heavy MVP)

| Element | Schema emitted | Templates that consume |
|---|---|---|
| `videos[0]` (when present) | New `VideoObject` graph node referenced from primary node | `article`, `local-business` (homepage) |
| `lists[].isHowToLike === true` | New `HowTo` graph node with `step: HowToStep[]` | `article` only (BlogPosting + Article) |
| `citations[]` (when ≥1) | `Article.citation: [{ "@type": "WebPage", "url", "name" }]` (NOT a separate graph node) | `article` only |

These three unlock 3 Google rich results: **Video**, **HowTo**, and **E-E-A-T citation signal** (the latter is reputational rather than rich-result, but Google's documentation treats outbound `citation` as a freshness/authority signal).

### 5.2 PR2 schema integrations (product/service MVP)

| Element | Schema emitted | Templates |
|---|---|---|
| `images[]` with role-classification | `ImageGallery` for collections of `informative` images; primary node `image` field for `hero` | `article`, `service`, `homepage` |
| `tables[].isPricingLike` or `isComparisonLike` | `Table` mainEntity sub-graph | `article`, `service` (when page has a table) |
| `testimonials[]` (when ≥1) + optional `rating` | `Review[]` graph nodes + `AggregateRating` aggregate when ratings present | `service`, `local-business` |

### 5.3 Deferred to PR3 (cleanup + polish)

- `codeBlocks[]` → `CodeRepository` / `SoftwareSourceCode` schema (low ROI for agency sites; useful for SaaS clients)
- `headings[]` → `WebPage.speakable` cssSelector pointing at the lead paragraph (overlaps with `schema-engagement-signals`; either spec can ship it)
- `Article.mentions` from named-entity recognition over body content (overlaps with `schema-entity-grounding-wikidata`; that spec is the proper owner)

## 6. PR decomposition

| PR | Scope | Est | Independent? |
|---|---|---|---|
| **PR1** | `PageElementSlice` infrastructure: types in `shared/types/page-elements.ts`, migration 079, `assemblePageElements` dispatch in `workspace-intelligence.ts`, `extractors/page-elements.ts` extractor framework with **3 element types only** (videos, HowTo lists, citations), 3 schema integrations, validator entries for `VideoObject` + `HowTo`, integration tests with real-world HTML fixtures from hmpsn.studio + an open-source content site corpus | ~5 days subagent-driven | Yes — ships standalone |
| **PR2** | Adds 3 element types (images with role classification, tables, testimonials), 3 schema integrations (`ImageGallery`/role-classified `image`, `Table mainEntity`, `Review`+`AggregateRating`). Validator entries for `Review`, `Table`, `AggregateRating`. Optional GPT-4o-mini AI image classifier behind feature flag with budget tracking. | ~4 days | Depends on PR1 |
| **PR3** | Polish: `codeBlocks[]`, `headings[]` ToC + speakable cssSelector. PR3 is optional — ship if cycles allow; no client deliverables block on it. | ~2 days | Depends on PR1 |

PR1 ships the highest-leverage 3 elements (Video + HowTo + Citation) on the foundation. PR2 ships the visual + commerce piece. Total spec scope: ~11 days. Single-PR delivery would be too risky for code review and Devin throughput — three PRs is the right granularity.

## 7. Cost & performance budget

| Resource | Budget | Mitigation when exceeded |
|---|---|---|
| AI image classification calls | **100 per regenerate-all run** (per-workspace, per-trigger) | Remaining images use rule-based; `diagnostics.hitAiBudgetCap = true` surfaces in admin UI eventually (deferred — see PR3) |
| AI HowTo-list disambiguation calls | **20 per regenerate-all run** (rare; only fires when pattern signal is ambiguous) | Falls through to non-emission (no `HowTo` schema rather than wrong schema) |
| Cheerio parse latency | < 50ms per page on hmpsn.studio HTML (~150KB) | Parse cost is dominated by the existing `extractPageData` + `extractFaq` Cheerio passes; we add ~10-15ms per page |
| DB read on regenerate | 1 SELECT per page from `page_elements` keyed `(workspace_id, page_path)` | Indexed; sub-millisecond |
| 5-min slice cache hit rate | Target: ~90%+ within a single regenerate-all batch | Existing single-flight dedup |

**Per-workspace AI cost rough estimate (PR2 with feature flag on):**
- 28-page site: 28 × ~50% images-needing-classification × $0.0001/call ≈ **<$0.01 per regenerate**.
- 200-page site at the 100-image cap: ~$0.01 per regenerate.

Cost is materially below "free" tier expectations; flag default-on for paid tiers is reasonable (revisit when 100s of workspaces are active).

## 8. Validation strategy

### 8.1 New `REQUIRED_BY_TYPE` entries (validator, PR1)

Adding to `server/schema/validator.ts`:

```typescript
const REQUIRED_BY_TYPE: Record<string, RequiredFields> = {
  // ...existing...
  'VideoObject':   { required: ['name', 'description', 'thumbnailUrl', 'uploadDate'] },
  'HowTo':         { required: ['name', 'step'] },
};
```

PR2 adds:

```typescript
  'Review':           { required: ['author', 'reviewRating'], recommended: ['datePublished'] },
  'AggregateRating':  { required: ['ratingValue', 'reviewCount'] },
  'Table':            { required: ['about'] },
  'ImageGallery':     { required: ['name', 'image'] },
```

### 8.2 Integration tests (real-world HTML corpus)

`tests/integration/page-elements-extraction.test.ts` runs the extractor against a curated HTML corpus committed under `tests/fixtures/page-elements/`:

- `webflow-blog-howto.html` — known how-to-shaped post; expects `lists[0].isHowToLike === true` + 5 steps
- `webflow-service-pricing-table.html` — expects `tables[0].isPricingLike === true` + correct row/col counts
- `webflow-blog-with-youtube.html` — expects `videos[0].provider === 'youtube'`
- `webflow-testimonials.html` — expects 3 testimonials extracted
- `webflow-decorative-images.html` — expects role classification (1 hero, 2 informative, 4 decorative)
- `webflow-no-elements.html` — empty catalog, no false positives

End-to-end: `tests/integration/lean-schema-generator.test.ts` extends with assertions that emitted JSON-LD includes `VideoObject` + `HowTo` for the appropriate fixtures.

### 8.3 Detection accuracy without ground-truth labels

Element detection (especially HowTo-list, testimonial) is fundamentally heuristic. Three layers protect quality:

1. **Conservative defaults** — pattern thresholds default high (require 2+ signals, not 1). False positives are worse than false negatives because they emit incorrect schema; false negatives just leave PR existing-behavior unchanged.
2. **Diagnostic counters** — every catalog emits `diagnostics.rawCounts` so future tuning can A/B threshold values against an evolving fixture corpus.
3. **Feature flag escape valve** — `pageElementCatalog.disabled` workspace flag lets admins bypass the entire catalog if a workspace's HTML triggers known false positives. Default on for all tiers; disable per-workspace as needed.

## 9. Migration plan

PageElementSlice is the **second migration anchor** for `schema-context-builder-pattern-b-migration` (Trajectory 3 → 1). It's born on Pattern B; no legacy direct reads to port. Its existence accelerates the broader migration because it demonstrates a non-trivial slice (vs. PR1's `siteKeywords` which was a 1-line port).

Once PageElementSlice ships, the migration tracker reads:

> Trajectory 3 → 1 progress: 2 of 7 schema reads on Pattern B (`siteKeywords`, `pageElements`); 5 legacy direct reads remaining (`brandVoice`, `businessContext`, `knowledgeBase`, `_businessProfile`, `_personasBlock`).

## 10. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| HowTo false-positive emission for non-instructional ordered lists | Medium | Confusing rich results in SERP | Pattern requires 2+ signals; AI fallback only when ambiguous; never emit when uncertain |
| AI cost spike on a workspace with 500+ images | Low (most agency sites are <100 pages) | Bill surprise | Per-regenerate budget cap; rule-based fallback above the cap; diagnostics surface usage |
| Cheerio parse failure on malformed HTML | Low (existing Cheerio passes already handle this) | Catalog returns empty; schema falls back to current behavior | `try/catch` at extractor entry; empty catalog is the safe fallback |
| Testimonial extraction reads PII into AI calls | Low (testimonial detection is class-based; no AI by default) | Privacy concern | AI testimonial detection is opt-in; default class-only |
| Schema.org type proliferation in `@graph` | Medium | Larger payloads, slower validators | Validator already handles multi-type graphs; tested up to 6 types per page (homepage with Organization + WebSite + LocalBusiness + BreadcrumbList) |
| DB row growth | Low (1 row per workspace × page; ~28-200 rows per workspace) | Negligible | `ON DELETE CASCADE` keeps table tidy when workspaces are deleted |

## 11. Out of scope

- **Admin "Page elements" reporting UI** — surfacing the catalog to admins as a navigable view with filters, "what schema would emit if you added a HowTo to this page" suggestions, etc. Filed as a separate roadmap entry; this spec does not block on it.
- **Multi-language detection** — assumes English-language content. Korean/Japanese HowTo-list patterns would need new heuristics; out of scope.
- **Schema A/B testing** — the catalog enables it (extract once, emit different schema variants), but the A/B framework is a separate project.
- **Vision-based image classification** — only text-context (alt + caption + URL basename) is sent to AI; Vision API is excluded for cost reasons. Future spec can opt in.
- **Article.mentions named-entity recognition** — better fits `schema-entity-grounding-wikidata` (filed separately). Don't double-implement.
- **`speakable` cssSelector** — overlaps with `schema-engagement-signals` spec (filed separately). PR3 of THIS spec ships it OR engagement-signals spec ships it; whichever lands first wins.

## 12. Open questions / deferred decisions

1. **Should `pageElementCatalog.disabled` workspace flag be auto-opt-in for free tier?** Current default: enabled for all tiers because rule-based extraction is free. Revisit if false-positive rate causes support load.
2. **AI image classification flag default for paid tiers?** Current default: off. Revisit after PR2 ships and we have telemetry on classification accuracy + cost per regenerate.
3. **Should the catalog cache TTL be longer than 5 min when `Webflow lastPublished` hasn't changed?** Current model treats the cache as a same-regenerate-batch optimization only. A longer TTL (e.g. 1 hour) would help workspaces that regenerate twice in succession. Defer until usage patterns are clear.

---

**Spec status:** Ready for review at `docs/superpowers/specs/2026-04-29-page-element-catalog-design.md`. Once approved, the next step is `pre-plan-audit` (formal skill invocation) to enumerate file-by-file scope, then `writing-plans` for PR1 implementation plan.
