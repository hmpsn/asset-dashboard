# Page-Element Catalog PR1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundational `PageElementSlice` on `buildWorkspaceIntelligence` plus three high-leverage element-type extractors (videos, HowTo lists, citations) and three corresponding schema integrations (`VideoObject`, `HowTo`, `Article.citation[]`).

**Architecture:** New typed slice in `shared/types/intelligence.ts`; per-page-keyed assembly via the existing `assembleSlice()` switch; persistence in a new `page_elements` DB table (migration 079) with hybrid 5-min in-memory cache; lazy extraction triggered on schema-generate, stale-detected via Webflow `lastPublished`; Cheerio-based extractors that mirror the existing `extractors/faq.ts` convention; rule-based detection only (AI image classifier deferred to PR2).

**Tech Stack:** TypeScript strict, Cheerio (existing dep), better-sqlite3 (one new migration: 079), `buildWorkspaceIntelligence({ slices: [...], pagePath })` from `server/workspace-intelligence.ts` (5-min LRU cache + single-flight dedup), vitest (unit + integration). No new dependencies.

**MVP scope (what this plan ships):**
- `shared/types/page-elements.ts` (new) — fully typed `PageElementCatalog` + 8 element interfaces
- Migration 079 + new `page_elements` table
- `server/page-elements-store.ts` (new) — typed CRUD
- `PageElementSlice` integrated into `buildWorkspaceIntelligence` dispatch
- `formatPageElementsSection` formatter (mandatory per slice-rendering pr-check rule)
- 3 element-type extractors (videos / HowTo lists / citations) — pattern-based, no AI
- AI-budget helper module (scaffolded for PR2 image classifier)
- `VideoObject` + `HowTo` REQUIRED_BY_TYPE entries on validator
- Article + BlogPosting templates conditionally emit VideoObject, HowTo, and `Article.citation[]`
- Generator lazily calls `extractPageElements` and threads catalog into templates
- 6 HTML fixture files + per-extractor unit tests + end-to-end integration test

**Out of scope (deferred to PR2 / PR3):** image-role classification (AI), tables/testimonials/code-blocks/ToC extraction, ImageGallery/Table/Review/AggregateRating schemas, admin reporting UI.

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-29-page-element-catalog-design.md`
- [x] Pre-plan audit committed: `docs/superpowers/audits/2026-04-29-page-element-catalog-audit.md`
- [x] Spec corrections applied (audit §1)
- [x] Branch `claude/page-element-catalog` already created from latest staging; spec + audit committed
- [ ] No additional shared contracts to pre-commit (the slice + types + migration ARE the shared contract; they ship in Phase 0 before any extractor needs them)

---

## Task Dependencies

```
Phase 0 — Shared contracts (sequential, foundational):
  Task 1 (PageElementCatalog typed interfaces in shared/types/page-elements.ts)
  → Task 2 (Migration 079 + page_elements DB table + Zod schema)
  → Task 3 (page-elements-store.ts CRUD)
  → Task 4 (Extend IntelligenceSlice union; add PageElementSlice + format function)

Phase 1 — Element-type extractors (3 PARALLEL agents share the new extractors/page-elements/ folder):
  → Task 5 (Video extractor: YouTube/Vimeo/native)
  → Task 6 (HowTo-list extractor: pattern-based)
  → Task 7 (Citation extractor: outbound authoritative links)

Phase 2 — Composition (sequential, depends on Phase 1):
  → Task 8 (Extractor entry-point + AI-budget helper)

Phase 3 — Slice integration (sequential):
  → Task 9 (assemblePageElements + lazy refresh + formatter; wire into assembleSlice)

Phase 4 — Schema integrations (sequential, all touch article.ts + validator.ts):
  → Task 10 (VideoObject in Article + BlogPosting + REQUIRED_BY_TYPE)
  → Task 11 (HowTo in Article + BlogPosting + REQUIRED_BY_TYPE)
  → Task 12 (Article.citation[] in Article + BlogPosting)

Phase 5 — Generator wiring + integration tests (sequential):
  → Task 13 (Generator lazy-extract + integration tests)

Phase 6 — Quality gates + ship (sequential):
  → Task 14 (FEATURE_AUDIT.md + roadmap + open PR)
```

**Why mostly sequential:** Phase 1's 3 extractors are parallel-safe (disjoint files, no cross-imports), but Phases 2-5 each have file-conflict risk on `article.ts` / `validator.ts` / `workspace-intelligence.ts` / `generator.ts`. Audit §5 explicitly recommends sequential dispatch for those.

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 PageElementCatalog types | sonnet | 8 typed interfaces + JSDoc; cross-file consistency-critical |
| 2 Migration + Zod schema | sonnet | Migration boilerplate + Zod schema mirroring the typed interface |
| 3 page-elements-store | sonnet | createStmtCache + parseJsonSafe + db.transaction patterns |
| 4 Slice union + formatter | sonnet | Cross-file types + formatter must reference every field (pr-check rule) |
| 5 Video extractor | sonnet | Cheerio + provider detection + URL parsing |
| 6 HowTo-list extractor | sonnet | Pattern matching + heuristic combination |
| 7 Citation extractor | sonnet | URL filtering + authoritative-source heuristic |
| 8 Entry-point + AI budget | sonnet | Composes Phase 1 outputs into the public API |
| 9 Slice integration | sonnet | Threads types through buildWorkspaceIntelligence; pr-check sensitive |
| 10 VideoObject schema integration | sonnet | Multi-node @graph append + REQUIRED_BY_TYPE |
| 11 HowTo schema integration | sonnet | Same pattern as Task 10 |
| 12 Article.citation schema integration | sonnet | Field-level addition (not a separate @graph node) |
| 13 Generator wiring + integration tests | sonnet | End-to-end wiring + JSON-LD assertions |
| 14 FEATURE_AUDIT + roadmap + PR | haiku | CLAUDE.md checklist execution |

Reviewers (per task): spec-compliance reviewer = sonnet, code-quality reviewer = sonnet.

---

## Compliance gates (every task must respect)

Internalized from audit §7. The plan's tasks each call out the relevant rules in their **Discipline** sections, but the global rules every task must satisfy:

1. Use `parseJsonSafe(row.catalog_json, schema, fallback)` — never bare `JSON.parse`
2. Wrap multi-step DB writes in `db.transaction(() => { ... })`
3. AI calls before DB writes inside the same transaction (or skip the AI call entirely in PR1 since the image classifier is deferred)
4. `PageElementCatalog` fully typed — never `Record<string, unknown>` in `shared/types/`
5. Use `createStmtCache(() => ({ ... }))` for prepared statements; never `let stmt`
6. Every UPDATE/DELETE on `page_elements` includes `WHERE workspace_id = ?`
7. Slice consumers pass `slices: ['pageElements']` explicitly
8. Every `try/catch` uses `} catch (err) { /* catch-ok: <reason> */ }` — silent bare catches forbidden
9. Every `PageElementSlice` field referenced in `formatPageElementsSection` OR added to `KNOWN_UNRENDERED_FIELDS`
10. Use `callAI({ provider: 'openai', model: 'gpt-4.1-mini', feature: 'page-element-image-role', workspaceId })` — but PR1 does NOT make AI calls, so this becomes relevant in PR2

---

## File Map

### New files

| Path | Lines (est) | Responsibility |
|---|---|---|
| `shared/types/page-elements.ts` | ~80 | `PageElementCatalog` + 8 typed element interfaces |
| `server/db/migrations/079-page-elements.sql` | ~12 | DDL for `page_elements` table |
| `server/schemas/page-elements-schema.ts` | ~50 | Zod schema mirroring `PageElementCatalog` (for parseJsonSafe validation) |
| `server/page-elements-store.ts` | ~120 | Typed CRUD: `getCatalog`, `upsertCatalog`, `deleteCatalog` |
| `server/schema/extractors/page-elements/video.ts` | ~70 | YouTube + Vimeo + native `<video>` detection |
| `server/schema/extractors/page-elements/howto.ts` | ~90 | Pattern-based ordered-list detection |
| `server/schema/extractors/page-elements/citation.ts` | ~60 | Outbound authoritative-source link extraction |
| `server/schema/extractors/page-elements/ai-budget.ts` | ~30 | AI call budget tracker (used in PR2) |
| `server/schema/extractors/page-elements.ts` | ~70 | Public entry-point: `extractPageElements(html, opts)` |
| `tests/fixtures/page-elements/webflow-blog-howto.html` | ~50 | Fixture: numbered how-to article |
| `tests/fixtures/page-elements/webflow-blog-with-youtube.html` | ~30 | Fixture: blog post with embedded YouTube |
| `tests/fixtures/page-elements/webflow-blog-with-vimeo.html` | ~25 | Fixture: blog post with Vimeo iframe |
| `tests/fixtures/page-elements/webflow-blog-with-citations.html` | ~40 | Fixture: blog post with outbound citations |
| `tests/fixtures/page-elements/webflow-no-elements.html` | ~20 | Fixture: minimal blog post (negative case) |
| `tests/fixtures/page-elements/webflow-mixed-elements.html` | ~80 | Fixture: HowTo + Video + citations on one page |
| `tests/unit/schema/extractors/page-elements-video.test.ts` | ~80 | Video extractor unit tests |
| `tests/unit/schema/extractors/page-elements-howto.test.ts` | ~100 | HowTo extractor unit tests |
| `tests/unit/schema/extractors/page-elements-citation.test.ts` | ~70 | Citation extractor unit tests |
| `tests/unit/schema/extractors/page-elements-entry.test.ts` | ~60 | Entry-point composition tests |

### Modified files

| Path | Modification |
|---|---|
| `shared/types/intelligence.ts` | Task 4: extend `IntelligenceSlice` union with `'pageElements'`; add `pageElements?: PageElementSlice` to `WorkspaceIntelligence`; add `PageElementSlice` interface |
| `server/workspace-intelligence.ts` | Task 4 + Task 9: add `'pageElements'` case to `assembleSlice` switch; implement `assemblePageElements`; add `formatPageElementsSection` formatter |
| `scripts/pr-check.ts` | Task 4 (and only if needed): add `extractedAt`, `sourcePublishedAt`, `diagnostics` to `KNOWN_UNRENDERED_FIELDS` since they're for diagnostics not prompt rendering |
| `server/schema/validator.ts` | Tasks 10 + 11: add `VideoObject` + `HowTo` to `REQUIRED_BY_TYPE` |
| `server/schema/templates/article.ts` | Tasks 10, 11, 12: conditionally emit `VideoObject` + `HowTo` graph nodes; add `keywords`/`citation` fields |
| `server/schema/generator.ts` | Task 13: lazy-call `extractPageElements`; pass catalog into article template inputs |
| `server/schema/data-sources.ts` | Task 13: extend `PageMetaInput` with `pageElements?: PageElementCatalog` (similar to PR1's `pageKeywords` extension) |
| `tests/integration/lean-schema-generator.test.ts` | Task 13: 3 new integration tests asserting JSON-LD includes VideoObject / HowTo / Article.citation when fixtures contain them |
| `FEATURE_AUDIT.md` | Task 14: append PR1 entry |
| `data/roadmap.json` | Task 14: split `schema-page-element-catalog-v1` into `-pr1` (done) + `-pr2` + `-pr3` entries (pending) |

### Files left untouched

- `server/schema/templates/{service,homepage,local-business,static}.ts` — PR1's element types only enrich Article + BlogPosting. Service/Product/LocalBusiness enrichment ships in PR2 (Image, Table, Review).
- `src/components/**` — frontend has no PR1 changes. Admin reporting UI is deferred.

---

## Tasks

### Task 1: `PageElementCatalog` typed interfaces (sonnet)

**Files:**
- Create: `shared/types/page-elements.ts`

The single typed source of truth for what the extractor returns. Every field must be explicitly named; no `Record<string, unknown>` (audit §2.7 rule #4).

- [ ] **Step 1: Create `shared/types/page-elements.ts`**

```typescript
/**
 * Typed catalog of structured content elements detected in a page's HTML.
 * Produced by `extractPageElements()` and stored in the `page_elements`
 * table (migration 079). Consumed by schema templates to conditionally
 * enrich JSON-LD with VideoObject, HowTo, Article.citation[], etc.
 *
 * Failure mode: extractor returns an empty catalog (every array empty);
 * schema templates fall back to current behavior. Never throws.
 */
export interface PageElementCatalog {
  /** ISO timestamp of catalog extraction. */
  extractedAt: string;
  /** Webflow lastPublished at extract time — drives stale detection. */
  sourcePublishedAt: string | null;
  /** Heading-tree summary for ToC + speakable cssSelector candidates (PR3). */
  headings: Heading[];
  /** Tables in main content area (PR2). */
  tables: Table[];
  /** Images with role classification (rule-based in PR1; AI in PR2). */
  images: PageImage[];
  /** Embedded videos — YouTube, Vimeo, native <video>. */
  videos: Video[];
  /** Lists; flagged with isHowToLike when matching HowTo heuristics. */
  lists: PageList[];
  /** Customer testimonials (PR2). */
  testimonials: Testimonial[];
  /** Code blocks (used for SoftwareSourceCode in future). */
  codeBlocks: CodeBlock[];
  /** Outbound links to authoritative sources (Article.citation[]). */
  citations: Citation[];
  /** Diagnostic counters — extractor confidence, AI calls used, fallbacks hit. */
  diagnostics: ExtractionDiagnostics;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** DOM element id if present; otherwise undefined. */
  id?: string;
}

export interface Table {
  rowCount: number;
  colCount: number;
  caption?: string;
  /** Heuristic flag: contains price-like cells (currency symbols, "$N", "from $N"). */
  isPricingLike: boolean;
  /** Heuristic flag: structured comparison (≥3 cols + repeated row labels). */
  isComparisonLike: boolean;
}

export interface PageImage {
  src: string;
  alt?: string;
  caption?: string;
  /** hero = lead image; informative = body diagram/screenshot; decorative = pattern/spacer. */
  role: 'hero' | 'informative' | 'decorative';
  /** How the role was determined; PR1 ships rule + fallback only. */
  roleSource: 'rule' | 'ai' | 'fallback';
  width?: number;
  height?: number;
}

export interface Video {
  provider: 'youtube' | 'vimeo' | 'native' | 'other';
  /** Iframe src for embed providers; <video src> for native. */
  embedUrl: string;
  /** Provider-derived thumbnail URL (e.g. img.youtube.com/vi/<id>/maxresdefault.jpg). */
  thumbnailUrl?: string;
  /** Duration in seconds when extractable from URL or inline metadata. */
  durationSec?: number;
  /** Title from iframe title attr, native poster, or alt heuristic. */
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

export interface HowToStep {
  name: string;
  text: string;
  position: number;
}

export interface Testimonial {
  author?: string;
  quote: string;
  rating?: number;
  /** CSS selector for the matched DOM element — useful for debugging. */
  selector: string;
}

export interface CodeBlock {
  language?: string;
  lineCount: number;
}

export interface Citation {
  url: string;
  /** Anchor text (or empty string if image-only link). */
  text: string;
  /** True when href hostname differs from page hostname. */
  isExternal: boolean;
}

export interface ExtractionDiagnostics {
  /** Number of AI image-role classifier calls made (always 0 in PR1). */
  aiClassificationCalls: number;
  /** True when AI calls hit the per-regenerate budget cap. */
  hitAiBudgetCap: boolean;
  /** Per-element-type detection counts before filtering. Keys: 'tables' | 'images' | 'videos' | 'lists' | 'testimonials' | 'codeBlocks' | 'citations' | 'headings'. */
  rawCounts: Record<string, number>;
}
```

- [ ] **Step 2: Verify typecheck passes project-wide**

Run: `npm run typecheck`
Expected: zero errors. (No consumer imports yet; types compile in isolation.)

- [ ] **Step 3: Commit**

```bash
git add shared/types/page-elements.ts
git commit -m "$(cat <<'EOF'
feat(schema): add PageElementCatalog typed interfaces

8 element-type interfaces (Heading, Table, PageImage, Video, PageList,
HowToStep, Testimonial, CodeBlock, Citation) plus the top-level catalog
contract. Fully typed — no Record<string, unknown> per shared/types pr-check
rule. Consumed by extractors (PR1+) and schema templates (PR1) to drive
VideoObject, HowTo, Article.citation[] enrichment.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration 079 + Zod schema (sonnet)

**Files:**
- Create: `server/db/migrations/079-page-elements.sql`
- Create: `server/schemas/page-elements-schema.ts`

The persistence DDL + the Zod validator mirroring the typed interface for `parseJsonSafe` reads.

- [ ] **Step 1: Create the migration file**

Create `server/db/migrations/079-page-elements.sql`:

```sql
-- 079-page-elements.sql
-- PageElementCatalog persistence. One row per (workspace, page).
-- catalog_json stores a typed PageElementCatalog blob (validated via Zod
-- on read). Stale-detection: source_published_at is compared against
-- Webflow's lastPublished timestamp at refresh time.
-- Tracked: schema-page-element-catalog-v1 PR1.

CREATE TABLE page_elements (
  workspace_id        TEXT NOT NULL,
  page_path           TEXT NOT NULL,
  catalog_json        TEXT NOT NULL,
  source_published_at TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, page_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_page_elements_workspace ON page_elements(workspace_id);
```

- [ ] **Step 2: Create the Zod schema**

Create `server/schemas/page-elements-schema.ts`:

```typescript
import { z } from 'zod';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';

/**
 * Zod schema mirroring PageElementCatalog. Used by parseJsonSafe to
 * validate `catalog_json` blobs read from the page_elements table.
 *
 * Permissive: extra fields are allowed (forward-compat for PR2/PR3).
 * Strict: required fields throw on parse failure (parseJsonSafe falls
 * back to EMPTY_CATALOG; never crashes).
 */
const headingSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  text: z.string(),
  id: z.string().optional(),
});

const tableSchema = z.object({
  rowCount: z.number(),
  colCount: z.number(),
  caption: z.string().optional(),
  isPricingLike: z.boolean(),
  isComparisonLike: z.boolean(),
});

const pageImageSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  role: z.enum(['hero', 'informative', 'decorative']),
  roleSource: z.enum(['rule', 'ai', 'fallback']),
  width: z.number().optional(),
  height: z.number().optional(),
});

const videoSchema = z.object({
  provider: z.enum(['youtube', 'vimeo', 'native', 'other']),
  embedUrl: z.string(),
  thumbnailUrl: z.string().optional(),
  durationSec: z.number().optional(),
  title: z.string().optional(),
});

const howToStepSchema = z.object({
  name: z.string(),
  text: z.string(),
  position: z.number(),
});

const pageListSchema = z.object({
  kind: z.enum(['ordered', 'unordered']),
  itemCount: z.number(),
  isHowToLike: z.boolean(),
  steps: z.array(howToStepSchema).optional(),
});

const testimonialSchema = z.object({
  author: z.string().optional(),
  quote: z.string(),
  rating: z.number().optional(),
  selector: z.string(),
});

const codeBlockSchema = z.object({
  language: z.string().optional(),
  lineCount: z.number(),
});

const citationSchema = z.object({
  url: z.string(),
  text: z.string(),
  isExternal: z.boolean(),
});

const diagnosticsSchema = z.object({
  aiClassificationCalls: z.number(),
  hitAiBudgetCap: z.boolean(),
  rawCounts: z.record(z.number()),
});

export const pageElementCatalogSchema: z.ZodType<PageElementCatalog> = z.object({
  extractedAt: z.string(),
  sourcePublishedAt: z.string().nullable(),
  headings: z.array(headingSchema),
  tables: z.array(tableSchema),
  images: z.array(pageImageSchema),
  videos: z.array(videoSchema),
  lists: z.array(pageListSchema),
  testimonials: z.array(testimonialSchema),
  codeBlocks: z.array(codeBlockSchema),
  citations: z.array(citationSchema),
  diagnostics: diagnosticsSchema,
}).passthrough();

/**
 * Sentinel empty catalog used as parseJsonSafe fallback when stored
 * blob is malformed or missing. Schema rendering falls through to
 * existing behavior when the catalog is empty.
 */
export const EMPTY_CATALOG: PageElementCatalog = {
  extractedAt: new Date(0).toISOString(),
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
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 4: Verify migration runs cleanly**

Migrations run automatically on dev-server start. Quick manual test (optional):

Run: `npx tsx -e "import('./server/db/index.js').then(m => { console.log('migrations OK'); })"`
Expected: log line + no error.

- [ ] **Step 5: Commit**

```bash
git add server/db/migrations/079-page-elements.sql server/schemas/page-elements-schema.ts
git commit -m "$(cat <<'EOF'
feat(schema): migration 079 page_elements table + Zod schema

Persistence for PageElementCatalog. Composite PK (workspace_id, page_path);
ON DELETE CASCADE from workspaces; idx_page_elements_workspace for the
common workspace-scoped scan. catalog_json stores PageElementCatalog blob
validated via pageElementCatalogSchema on read (parseJsonSafe with
EMPTY_CATALOG fallback). source_published_at drives stale detection
against Webflow lastPublished.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `page-elements-store.ts` — typed CRUD (sonnet)

**Files:**
- Create: `server/page-elements-store.ts`

Wraps prepared statements + Zod-validated reads. Mirrors `server/page-keywords.ts` conventions (audit §2.5).

- [ ] **Step 1: Write a failing unit test**

Create `tests/unit/page-elements-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../server/db/index.js';
import {
  upsertPageElements,
  getPageElements,
  deletePageElements,
} from '../../server/page-elements-store.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';

const sampleCatalog: PageElementCatalog = {
  extractedAt: '2026-04-29T00:00:00.000Z',
  sourcePublishedAt: '2026-04-29T00:00:00.000Z',
  headings: [{ level: 1, text: 'Hello' }],
  tables: [],
  images: [],
  videos: [{ provider: 'youtube', embedUrl: 'https://www.youtube.com/embed/abc' }],
  lists: [],
  testimonials: [],
  codeBlocks: [],
  citations: [],
  diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: { videos: 1 } },
};

describe('page-elements-store', () => {
  beforeEach(() => {
    // Clean any test rows
    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run('ws_test_pe_store');
  });

  it('upsertPageElements inserts a new row', () => {
    upsertPageElements('ws_test_pe_store', '/blog/foo', sampleCatalog);
    const row = getPageElements('ws_test_pe_store', '/blog/foo');
    expect(row).not.toBeNull();
    expect(row!.catalog.videos[0].embedUrl).toBe('https://www.youtube.com/embed/abc');
  });

  it('upsertPageElements replaces an existing row', () => {
    upsertPageElements('ws_test_pe_store', '/blog/foo', sampleCatalog);
    const updated: PageElementCatalog = { ...sampleCatalog, videos: [] };
    upsertPageElements('ws_test_pe_store', '/blog/foo', updated);
    const row = getPageElements('ws_test_pe_store', '/blog/foo');
    expect(row!.catalog.videos).toEqual([]);
  });

  it('getPageElements returns null for non-existent rows', () => {
    expect(getPageElements('ws_test_pe_store', '/no-such-page')).toBeNull();
  });

  it('deletePageElements only removes the targeted (workspace_id, page_path)', () => {
    upsertPageElements('ws_test_pe_store', '/blog/foo', sampleCatalog);
    upsertPageElements('ws_test_pe_store', '/blog/bar', sampleCatalog);
    deletePageElements('ws_test_pe_store', '/blog/foo');
    expect(getPageElements('ws_test_pe_store', '/blog/foo')).toBeNull();
    expect(getPageElements('ws_test_pe_store', '/blog/bar')).not.toBeNull();
  });

  it('getPageElements gracefully degrades on malformed catalog_json', () => {
    db.prepare(`
      INSERT INTO page_elements (workspace_id, page_path, catalog_json, source_published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('ws_test_pe_store', '/blog/malformed', '{not valid json', null, '2026-04-29T00:00:00.000Z', '2026-04-29T00:00:00.000Z');
    const row = getPageElements('ws_test_pe_store', '/blog/malformed');
    // Returns row with empty catalog rather than throwing
    expect(row).not.toBeNull();
    expect(row!.catalog.videos).toEqual([]);
    expect(row!.catalog.headings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

Run: `npx vitest run tests/unit/page-elements-store.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `page-elements-store.ts`**

Create `server/page-elements-store.ts`:

```typescript
/**
 * page_elements table CRUD. Per audit §2.5 (page_* migration conventions):
 * - createStmtCache for lazy prepared statements
 * - parseJsonSafe at the read boundary (with EMPTY_CATALOG fallback)
 * - workspace_id always in WHERE clause
 * - ISO 8601 timestamps as TEXT
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import { pageElementCatalogSchema, EMPTY_CATALOG } from './schemas/page-elements-schema.js';
import type { PageElementCatalog } from '../shared/types/page-elements.js';
import { createLogger } from './logger.js';

const log = createLogger('page-elements-store');

interface PageElementsRow {
  workspace_id: string;
  page_path: string;
  catalog_json: string;
  source_published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageElementsRecord {
  workspaceId: string;
  pagePath: string;
  catalog: PageElementCatalog;
  sourcePublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const stmts = createStmtCache(() => ({
  get: db.prepare<[workspaceId: string, pagePath: string]>(
    'SELECT * FROM page_elements WHERE workspace_id = ? AND page_path = ?',
  ),
  upsert: db.prepare(`
    INSERT INTO page_elements (workspace_id, page_path, catalog_json, source_published_at, created_at, updated_at)
    VALUES (@workspace_id, @page_path, @catalog_json, @source_published_at, @created_at, @updated_at)
    ON CONFLICT(workspace_id, page_path) DO UPDATE SET
      catalog_json = excluded.catalog_json,
      source_published_at = excluded.source_published_at,
      updated_at = excluded.updated_at
  `),
  deleteOne: db.prepare<[workspaceId: string, pagePath: string]>(
    'DELETE FROM page_elements WHERE workspace_id = ? AND page_path = ?',
  ),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM page_elements WHERE workspace_id = ?',
  ),
}));

function rowToRecord(row: PageElementsRow): PageElementsRecord {
  return {
    workspaceId: row.workspace_id,
    pagePath: row.page_path,
    // parseJsonSafe signature: (raw, schema, fallback, context?) — returns T | F.
    // EMPTY_CATALOG is the fallback so the function never returns null;
    // no `?? EMPTY_CATALOG` needed at the call site.
    catalog: parseJsonSafe(
      row.catalog_json,
      pageElementCatalogSchema,
      EMPTY_CATALOG,
      { workspaceId: row.workspace_id, field: 'catalog_json', table: 'page_elements' },
    ),
    sourcePublishedAt: row.source_published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPageElements(workspaceId: string, pagePath: string): PageElementsRecord | null {
  const row = stmts().get.get(workspaceId, pagePath) as PageElementsRow | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

export function upsertPageElements(
  workspaceId: string,
  pagePath: string,
  catalog: PageElementCatalog,
): void {
  const now = new Date().toISOString();
  try {
    stmts().upsert.run({
      workspace_id: workspaceId,
      page_path: pagePath,
      catalog_json: JSON.stringify(catalog),
      source_published_at: catalog.sourcePublishedAt,
      created_at: now,
      updated_at: now,
    });
  } catch (err) { /* catch-ok: log and re-throw — caller may roll back */
    log.error({ err, workspaceId, pagePath }, 'page-elements upsert failed');
    throw err;
  }
}

export function deletePageElements(workspaceId: string, pagePath: string): void {
  stmts().deleteOne.run(workspaceId, pagePath);
}

export function deleteAllPageElementsForWorkspace(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}
```

If `parseJsonSafe` doesn't accept the third options arg shape used above, read its actual signature in `server/db/json-validation.ts` and adjust the call.

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run tests/unit/page-elements-store.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/page-elements-store.ts tests/unit/page-elements-store.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): page-elements-store CRUD with parseJsonSafe boundary

Typed CRUD over the page_elements table. createStmtCache for lazy
prepared statements; parseJsonSafe with pageElementCatalogSchema
validates catalog_json on read; falls back to EMPTY_CATALOG on
malformed blobs (gracefully degrades — never crashes the
generator).

5 unit tests cover: insert, replace, missing-row, scoped delete,
malformed-json fallback.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `PageElementSlice` interface + format function (sonnet)

**Files:**
- Modify: `shared/types/intelligence.ts`
- Modify: `server/workspace-intelligence.ts`
- Modify: `scripts/pr-check.ts` (KNOWN_UNRENDERED_FIELDS extension if needed)

Wires the slice into the existing dispatch shape. The `formatPageElementsSection` function must reference every `PageElementSlice` field or trip the `Assembled-but-never-rendered slice fields` rule (audit §2.2).

- [ ] **Step 1: Add `PageElementSlice` to `shared/types/intelligence.ts`**

Find the `IntelligenceSlice` union (around line 22-29). Add `'pageElements'`:

```typescript
export type IntelligenceSlice =
  | 'seoContext'
  | 'insights'
  | 'learnings'
  | 'pageProfile'
  | 'contentPipeline'
  | 'siteHealth'
  | 'clientSignals'
  | 'operational'
  | 'pageElements';
```

Find the `WorkspaceIntelligence` interface (around line 52-65). Add the optional field:

```typescript
export interface WorkspaceIntelligence {
  // ...existing fields...
  /** Per-page structural element catalog (videos, HowTo lists, citations, etc.).
   *  Populated when buildWorkspaceIntelligence is called with opts.pagePath. */
  pageElements?: PageElementSlice;
}
```

After the existing slice interfaces, add `PageElementSlice`:

```typescript
import type { PageElementCatalog } from './page-elements.js';

/**
 * Per-page structural-element catalog. Populated by assemblePageElements
 * when buildWorkspaceIntelligence is called with opts.pagePath. Schema
 * templates conditionally enrich JSON-LD based on the catalog.
 *
 * Empty when no page-path provided OR when the page has no detected elements.
 */
export interface PageElementSlice {
  /** The page path this slice was assembled for. */
  pagePath: string;
  /** The catalog itself. EMPTY_CATALOG-shape when extraction yielded nothing. */
  catalog: PageElementCatalog;
}
```

- [ ] **Step 2: Add the `pageElements` case to `assembleSlice` switch**

In `server/workspace-intelligence.ts`, find the `assembleSlice` function (around line 189-232). Add the case alongside other per-page-keyed slices (after `'pageProfile'`):

```typescript
case 'pageElements':
  if (!opts?.pagePath) break; // pageElements is per-page; no-op without pagePath
  result.pageElements = await assemblePageElements(workspaceId, opts.pagePath);
  break;
```

- [ ] **Step 3: Implement `assemblePageElements` (skeleton; full body in Task 9)**

Add to `server/workspace-intelligence.ts` near other `assemble*` functions:

```typescript
import { getPageElements } from './page-elements-store.js';

async function assemblePageElements(
  workspaceId: string,
  pagePath: string,
): Promise<PageElementSlice | undefined> {
  try {
    const record = getPageElements(workspaceId, pagePath);
    if (!record) {
      // No catalog yet — return undefined; lazy extraction (Task 9) will
      // populate on next schema-generate. Slice consumers handle undefined.
      return undefined;
    }
    return {
      pagePath: record.pagePath,
      catalog: record.catalog,
    };
  } catch (err) { /* catch-ok: graceful degrade — slice stays undefined */
    log.warn({ err, workspaceId, pagePath }, 'assemblePageElements: store read failed, slice unavailable');
    return undefined;
  }
}
```

`PageElementSlice` is also imported alongside other slice types at the top of the file — add the import.

- [ ] **Step 4: Implement `formatPageElementsSection` formatter**

Find the formatter functions (`formatSeoContextSection`, `formatInsightsSection`, etc.). Add `formatPageElementsSection` mirroring the existing pattern (signature + early return on missing slice):

```typescript
function formatPageElementsSection(slice: PageElementSlice | undefined): string {
  if (!slice) return '';
  const c = slice.catalog;
  const summary: string[] = [];
  if (c.videos.length > 0) summary.push(`${c.videos.length} video${c.videos.length === 1 ? '' : 's'}`);
  if (c.lists.filter(l => l.isHowToLike).length > 0) {
    summary.push(`${c.lists.filter(l => l.isHowToLike).length} HowTo list${c.lists.filter(l => l.isHowToLike).length === 1 ? '' : 's'}`);
  }
  if (c.citations.length > 0) summary.push(`${c.citations.length} citation${c.citations.length === 1 ? '' : 's'}`);
  if (c.tables.length > 0) summary.push(`${c.tables.length} table${c.tables.length === 1 ? '' : 's'}`);
  if (c.images.length > 0) summary.push(`${c.images.length} image${c.images.length === 1 ? '' : 's'}`);
  if (c.testimonials.length > 0) summary.push(`${c.testimonials.length} testimonial${c.testimonials.length === 1 ? '' : 's'}`);
  if (c.headings.length > 0) summary.push(`${c.headings.length} heading${c.headings.length === 1 ? '' : 's'}`);
  if (c.codeBlocks.length > 0) summary.push(`${c.codeBlocks.length} code block${c.codeBlocks.length === 1 ? '' : 's'}`);
  if (summary.length === 0) return '';
  return `\n## Page elements (${slice.pagePath})\n${summary.join(' · ')}\n`;
}
```

This references `videos`, `lists`, `citations`, `tables`, `images`, `testimonials`, `headings`, `codeBlocks`, `pagePath`, AND implicitly `catalog` via the `c` alias. Fields NOT referenced — `extractedAt`, `sourcePublishedAt`, `diagnostics` — must be added to `KNOWN_UNRENDERED_FIELDS` in Step 5.

- [ ] **Step 5: Extend `KNOWN_UNRENDERED_FIELDS` in `scripts/pr-check.ts`**

Find `KNOWN_UNRENDERED_FIELDS` (lines 505-522 per audit). Add the diagnostic-only fields:

```typescript
const KNOWN_UNRENDERED_FIELDS = new Set([
  // ...existing entries...
  // PageElementSlice diagnostic fields — not in formatPageElementsSection by design.
  'extractedAt',
  'sourcePublishedAt',
  'diagnostics',
]);
```

The Set uses bare field names (verified: existing entries are `'forPage'`, `'bySeverity'`, `'searchIntent'` — not qualified by slice name). The rule's `customCheck` walks each slice's typed fields and checks each leaf name against this Set, so a single field-name entry covers all slices that have a field by that name. Note: existing `'forPage'` already covers PageElementCatalog if we ever add a forPage field (we don't in PR1).

- [ ] **Step 6: Wire `formatPageElementsSection` into the section assembler**

Find where format functions are dispatched (typically a `formatForPrompt` or `buildIntelPrompt` function). Add a section call:

```typescript
// after other format*Section calls
sections.push(formatPageElementsSection(intel.pageElements));
```

- [ ] **Step 7: Run typecheck + targeted tests + pr-check**

Run: `npm run typecheck`
Expected: zero errors.

Run: `npx tsx scripts/pr-check.ts`
Expected: zero errors. The `Assembled-but-never-rendered slice fields` rule should NOT fire because every PageElementSlice/PageElementCatalog field is either rendered in `formatPageElementsSection` or registered in `KNOWN_UNRENDERED_FIELDS`.

Run: `npx vitest run tests/unit/page-elements-store.test.ts`
Expected: still passes (Task 3 tests still green).

- [ ] **Step 8: Commit**

```bash
git add shared/types/intelligence.ts server/workspace-intelligence.ts scripts/pr-check.ts
git commit -m "$(cat <<'EOF'
feat(schema): PageElementSlice integrated into buildWorkspaceIntelligence

PageElementSlice typed interface in shared/types/intelligence.ts; new case
in assembleSlice() switch; assemblePageElements skeleton (returns undefined
when store has no row — lazy extraction in Task 9 populates on
schema-generate). formatPageElementsSection formatter references all
8 element-array fields plus pagePath; extractedAt/sourcePublishedAt/
diagnostics registered in KNOWN_UNRENDERED_FIELDS.

Per audit §2.2 — slice consumers must pass slices: ['pageElements']
explicitly to buildWorkspaceIntelligence (existing pr-check rule
enforces).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Video extractor (sonnet)

**Files:**
- Create: `server/schema/extractors/page-elements/video.ts`
- Create: `tests/fixtures/page-elements/webflow-blog-with-youtube.html`
- Create: `tests/fixtures/page-elements/webflow-blog-with-vimeo.html`
- Create: `tests/unit/schema/extractors/page-elements-video.test.ts`

Detects YouTube + Vimeo + native `<video>` embeds. Mirrors the inline-Cheerio convention from `extractors/faq.ts` (audit §2.1).

- [ ] **Step 1: Create the YouTube fixture**

Create `tests/fixtures/page-elements/webflow-blog-with-youtube.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Blog Post with YouTube</title></head>
<body>
  <article>
    <h1>How web vitals affect SEO</h1>
    <p>Watch this overview:</p>
    <iframe
      src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"
      title="Web Vitals 101"
      width="560"
      height="315"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen></iframe>
    <p>Above all, focus on user experience.</p>
  </article>
</body>
</html>
```

- [ ] **Step 2: Create the Vimeo fixture**

Create `tests/fixtures/page-elements/webflow-blog-with-vimeo.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Blog Post with Vimeo</title></head>
<body>
  <article>
    <h1>Studio walkthrough</h1>
    <iframe
      src="https://player.vimeo.com/video/123456789?h=abc123def"
      title="Studio Tour"
      width="640"
      height="360"
      allow="autoplay; fullscreen; picture-in-picture"
      allowfullscreen></iframe>
  </article>
</body>
</html>
```

- [ ] **Step 3: Write failing tests**

Create `tests/unit/schema/extractors/page-elements-video.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractVideos } from '../../../../server/schema/extractors/page-elements/video.js';

function fixture(name: string): cheerio.CheerioAPI {
  const html = readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
  return cheerio.load(html);
}

describe('extractVideos', () => {
  it('extracts a YouTube embed with provider, embedUrl, thumbnailUrl, and title', () => {
    const $ = fixture('webflow-blog-with-youtube.html');
    const videos = extractVideos($);
    expect(videos).toHaveLength(1);
    expect(videos[0].provider).toBe('youtube');
    expect(videos[0].embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0');
    expect(videos[0].thumbnailUrl).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    expect(videos[0].title).toBe('Web Vitals 101');
  });

  it('extracts a Vimeo embed with provider and embedUrl', () => {
    const $ = fixture('webflow-blog-with-vimeo.html');
    const videos = extractVideos($);
    expect(videos).toHaveLength(1);
    expect(videos[0].provider).toBe('vimeo');
    expect(videos[0].embedUrl).toBe('https://player.vimeo.com/video/123456789?h=abc123def');
    expect(videos[0].title).toBe('Studio Tour');
  });

  it('extracts a native <video> tag', () => {
    const $ = cheerio.load(`
      <article>
        <video src="https://example.com/intro.mp4" poster="https://example.com/intro.jpg" controls></video>
      </article>
    `);
    const videos = extractVideos($);
    expect(videos).toHaveLength(1);
    expect(videos[0].provider).toBe('native');
    expect(videos[0].embedUrl).toBe('https://example.com/intro.mp4');
    expect(videos[0].thumbnailUrl).toBe('https://example.com/intro.jpg');
  });

  it('returns empty array when no videos present', () => {
    const $ = cheerio.load('<article><p>Just text, no media.</p></article>');
    expect(extractVideos($)).toEqual([]);
  });

  it('skips iframes from unknown providers (provider=other not pushed)', () => {
    const $ = cheerio.load(`
      <article>
        <iframe src="https://www.example.com/embed/abc" title="Generic"></iframe>
      </article>
    `);
    const videos = extractVideos($);
    expect(videos).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-video.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement the extractor**

Create `server/schema/extractors/page-elements/video.ts`:

```typescript
/**
 * Video element extractor. Detects YouTube + Vimeo + native <video>.
 * Other iframe providers are skipped (we don't synthesize VideoObject
 * schema for unknown providers — too high false-positive rate).
 *
 * Per audit §2.1 — convention: inline `cheerio.load`, fail-soft (return
 * empty array on missing matches).
 */
import type * as cheerio from 'cheerio';
import type { Video } from '../../../../shared/types/page-elements.js';

const YOUTUBE_RE = /(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/i;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/i;

export function extractVideos($: cheerio.CheerioAPI): Video[] {
  const videos: Video[] = [];

  // iframe-based: YouTube + Vimeo
  $('iframe[src]').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src') ?? '';
    const title = $el.attr('title') ?? undefined;

    const yt = src.match(YOUTUBE_RE);
    if (yt) {
      videos.push({
        provider: 'youtube',
        embedUrl: src,
        thumbnailUrl: `https://img.youtube.com/vi/${yt[1]}/maxresdefault.jpg`,
        title,
      });
      return;
    }

    const vm = src.match(VIMEO_RE);
    if (vm) {
      videos.push({
        provider: 'vimeo',
        embedUrl: src,
        title,
      });
      return;
    }

    // Unknown providers — skip (don't emit VideoObject without enough metadata)
  });

  // Native <video>
  $('video').each((_, el) => {
    const $el = $(el);
    // <video src="..."> OR <video><source src="..."></video>
    const src = $el.attr('src') ?? $el.find('source[src]').first().attr('src');
    if (!src) return;
    const poster = $el.attr('poster') ?? undefined;
    const title = $el.attr('title') ?? undefined;
    videos.push({
      provider: 'native',
      embedUrl: src,
      thumbnailUrl: poster,
      title,
    });
  });

  return videos;
}
```

- [ ] **Step 6: Run tests, confirm pass**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-video.test.ts`
Expected: 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add server/schema/extractors/page-elements/video.ts tests/fixtures/page-elements/webflow-blog-with-youtube.html tests/fixtures/page-elements/webflow-blog-with-vimeo.html tests/unit/schema/extractors/page-elements-video.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): video extractor (YouTube + Vimeo + native)

Detects video embeds via iframe src regex (YouTube embed/share/watch
URLs; Vimeo player URLs) and native <video> tags. Builds the
provider/embedUrl/thumbnailUrl/title shape consumed by the VideoObject
schema integration (Task 10). Fail-soft: unknown providers skipped;
returns [] when no videos present.

5 unit tests + 2 fixture HTML files cover the convention.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: HowTo-list extractor (sonnet)

**Files:**
- Create: `server/schema/extractors/page-elements/howto.ts`
- Create: `tests/fixtures/page-elements/webflow-blog-howto.html`
- Create: `tests/unit/schema/extractors/page-elements-howto.test.ts`

Pattern-based detection: ordered list + heading nearby contains "how to" / "steps" / "guide" + items start with action verbs.

- [ ] **Step 1: Create the HowTo fixture**

Create `tests/fixtures/page-elements/webflow-blog-howto.html`:

```html
<!DOCTYPE html>
<html>
<head><title>How to Bake Sourdough</title></head>
<body>
  <article>
    <h1>How to bake sourdough at home</h1>
    <p>This guide walks through 5 steps of beginner-friendly bread-making.</p>
    <h2>Steps</h2>
    <ol>
      <li>Mix flour, water, and starter into a shaggy dough.</li>
      <li>Rest the dough for 30 minutes (autolyse).</li>
      <li>Knead and stretch every 30 minutes for 2 hours.</li>
      <li>Shape the dough and proof overnight in the fridge.</li>
      <li>Bake in a Dutch oven at 500°F for 25 minutes covered.</li>
    </ol>
    <p>Result: crusty, tangy sourdough.</p>
  </article>
</body>
</html>
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/schema/extractors/page-elements-howto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractLists } from '../../../../server/schema/extractors/page-elements/howto.js';

function fixture(name: string): cheerio.CheerioAPI {
  const html = readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
  return cheerio.load(html);
}

describe('extractLists (HowTo detection)', () => {
  it('flags an ordered list as HowTo when nearby heading is "Steps" and items start with action verbs', () => {
    const $ = fixture('webflow-blog-howto.html');
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('ordered');
    expect(lists[0].itemCount).toBe(5);
    expect(lists[0].isHowToLike).toBe(true);
    expect(lists[0].steps).toHaveLength(5);
    expect(lists[0].steps![0]).toEqual({ name: 'Mix flour, water, and starter into a shaggy dough.', text: 'Mix flour, water, and starter into a shaggy dough.', position: 1 });
  });

  it('does NOT flag an ordered list when no nearby HowTo signal', () => {
    const $ = cheerio.load(`
      <article>
        <h2>Top 5 reasons we love coffee</h2>
        <ol>
          <li>It's delicious.</li>
          <li>It wakes you up.</li>
          <li>It's a ritual.</li>
        </ol>
      </article>
    `);
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].isHowToLike).toBe(false);
    expect(lists[0].steps).toBeUndefined();
  });

  it('does NOT flag an unordered list as HowTo even if heading says "How to"', () => {
    const $ = cheerio.load(`
      <article>
        <h2>How to plan a trip</h2>
        <ul>
          <li>Pick destination</li>
          <li>Book flight</li>
          <li>Pack bags</li>
        </ul>
      </article>
    `);
    const lists = extractLists($);
    expect(lists).toHaveLength(1);
    expect(lists[0].kind).toBe('unordered');
    expect(lists[0].isHowToLike).toBe(false);
  });

  it('returns empty array when no <ol> or <ul>', () => {
    const $ = cheerio.load('<article><p>Just paragraphs.</p></article>');
    expect(extractLists($)).toEqual([]);
  });

  it('detects HowTo when the page <h1> contains "How to" even without nearby step heading', () => {
    const $ = cheerio.load(`
      <article>
        <h1>How to deploy a Webflow site</h1>
        <p>Follow these:</p>
        <ol>
          <li>Connect your domain.</li>
          <li>Configure DNS records.</li>
          <li>Publish the site.</li>
        </ol>
      </article>
    `);
    const lists = extractLists($);
    expect(lists[0].isHowToLike).toBe(true);
    expect(lists[0].itemCount).toBe(3);
  });

  it('requires at least 2 items to flag as HowTo (single-item ol is not a how-to)', () => {
    const $ = cheerio.load(`
      <article>
        <h1>How to fix it</h1>
        <ol><li>Restart.</li></ol>
      </article>
    `);
    expect(extractLists($)[0].isHowToLike).toBe(false);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-howto.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the extractor**

Create `server/schema/extractors/page-elements/howto.ts`:

```typescript
/**
 * List + HowTo detection. Pattern-first (no AI in PR1):
 *   - Ordered list (<ol>)
 *   - At least 2 items
 *   - Either: page <h1> contains "how to" / "guide" / "steps"
 *     OR a previous-sibling heading (h2-h4) contains the same
 *
 * AI-fallback for ambiguous cases is deferred to PR2 (callAI for
 * disambiguation per audit §2.3 conventions).
 */
import type * as cheerio from 'cheerio';
import type { PageList, HowToStep } from '../../../../shared/types/page-elements.js';

const HOWTO_RE = /\b(how\s+to|steps?|guide|tutorial|walkthrough)\b/i;

function findNearbyHowToHeading($: cheerio.CheerioAPI, $list: cheerio.Cheerio<cheerio.AnyNode>): boolean {
  // 1) Page <h1>
  const h1 = $('h1').first().text();
  if (HOWTO_RE.test(h1)) return true;
  // 2) Closest previous heading (h2-h4) before the list
  const $prev = $list.prevAll('h2, h3, h4').first();
  if ($prev.length > 0 && HOWTO_RE.test($prev.text())) return true;
  // 3) Nearest ancestor section's heading
  const $parentSection = $list.closest('section');
  if ($parentSection.length > 0) {
    const sectionHeading = $parentSection.find('h1, h2, h3, h4').first().text();
    if (HOWTO_RE.test(sectionHeading)) return true;
  }
  return false;
}

export function extractLists($: cheerio.CheerioAPI): PageList[] {
  const lists: PageList[] = [];

  $('ol, ul').each((_, el) => {
    const $list = $(el);
    const kind = el.tagName === 'ol' ? 'ordered' : 'unordered';
    const items = $list.children('li').toArray();
    const itemCount = items.length;

    let isHowToLike = false;
    let steps: HowToStep[] | undefined;

    // HowTo only applies to ordered lists with 2+ items
    if (kind === 'ordered' && itemCount >= 2) {
      if (findNearbyHowToHeading($, $list)) {
        isHowToLike = true;
        steps = items.map((li, i) => {
          const text = $(li).text().trim();
          return {
            name: text,
            text,
            position: i + 1,
          };
        });
      }
    }

    lists.push({ kind, itemCount, isHowToLike, steps });
  });

  return lists;
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-howto.test.ts`
Expected: 6 PASS.

- [ ] **Step 6: Commit**

```bash
git add server/schema/extractors/page-elements/howto.ts tests/fixtures/page-elements/webflow-blog-howto.html tests/unit/schema/extractors/page-elements-howto.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): HowTo-list extractor (pattern-based)

Detects ordered lists with HowTo-shaped context: nearby heading
matches /how to|steps|guide|tutorial|walkthrough/i, list has 2+
items, ordered (not unordered). Conservative defaults — false
positives are worse than negatives (incorrect schema vs. existing
behavior).

AI-fallback for ambiguous cases deferred to PR2.

6 unit tests + 1 fixture cover the heuristic.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Citation extractor (sonnet)

**Files:**
- Create: `server/schema/extractors/page-elements/citation.ts`
- Create: `tests/fixtures/page-elements/webflow-blog-with-citations.html`
- Create: `tests/unit/schema/extractors/page-elements-citation.test.ts`

Detects outbound `<a href>` links to authoritative sources (external domain, in main content area, not nav/footer).

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/page-elements/webflow-blog-with-citations.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Article with Citations</title></head>
<body>
  <header>
    <nav>
      <a href="https://www.hmpsn.studio/services">Services</a>
    </nav>
  </header>
  <article>
    <h1>The state of Core Web Vitals in 2026</h1>
    <p>According to <a href="https://web.dev/articles/vitals">Google's Web Vitals docs</a>,
       LCP under 2.5s is the recommended threshold. The
       <a href="https://developer.mozilla.org/en-US/docs/Web/API/Performance_API">
       MDN Performance API guide</a> covers measurement.</p>
    <p>Internal link: <a href="https://www.hmpsn.studio/blog/another-post">another post</a>.</p>
  </article>
  <footer>
    <a href="https://www.hmpsn.studio/about">About</a>
  </footer>
</body>
</html>
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/schema/extractors/page-elements-citation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCitations } from '../../../../server/schema/extractors/page-elements/citation.js';

function fixture(name: string): cheerio.CheerioAPI {
  const html = readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
  return cheerio.load(html);
}

describe('extractCitations', () => {
  it('extracts external citations from article body and skips nav/footer + internal links', () => {
    const $ = fixture('webflow-blog-with-citations.html');
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    // Should find 2 external citations from <article>; nav + footer + internal-link skipped
    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      url: 'https://web.dev/articles/vitals',
      text: "Google's Web Vitals docs",
      isExternal: true,
    });
    expect(citations[1]).toEqual({
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance_API',
      text: 'MDN Performance API guide',
      isExternal: true,
    });
  });

  it('returns empty array when no <article> on page', () => {
    const $ = cheerio.load('<body><p>Just text. <a href="https://external.com">Link</a></p></body>');
    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([]);
  });

  it('skips citations with empty href or javascript:/mailto:', () => {
    const $ = cheerio.load(`
      <article>
        <a href="">Empty</a>
        <a href="javascript:void(0)">JS</a>
        <a href="mailto:a@b.com">Email</a>
        <a href="https://example.com">Real external</a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].url).toBe('https://example.com');
  });

  it('skips relative-path links (treats them as internal)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="/about">Internal</a>
        <a href="../other">Internal too</a>
      </article>
    `);
    expect(extractCitations($, 'https://www.hmpsn.studio')).toEqual([]);
  });

  it('captures empty anchor text gracefully (image-only links)', () => {
    const $ = cheerio.load(`
      <article>
        <a href="https://example.com"><img src="/icon.png" alt="Logo"></a>
      </article>
    `);
    const citations = extractCitations($, 'https://www.hmpsn.studio');
    expect(citations).toHaveLength(1);
    expect(citations[0].text).toBe(''); // empty anchor text — image-only
    expect(citations[0].url).toBe('https://example.com');
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-citation.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the extractor**

Create `server/schema/extractors/page-elements/citation.ts`:

```typescript
/**
 * Citation extractor. Detects outbound <a href> in main content area
 * (inside <article>) pointing at external domains. Filters out internal
 * links (own domain), nav/footer links, javascript:/mailto: schemes,
 * empty hrefs, and relative paths.
 *
 * Used by Article.citation[] schema enrichment (Task 12).
 */
import type * as cheerio from 'cheerio';
import type { Citation } from '../../../../shared/types/page-elements.js';

function urlHostnameOrNull(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch { /* catch-ok: malformed URL — treat as internal/skipped */
    return null;
  }
}

export function extractCitations($: cheerio.CheerioAPI, pageBaseUrl: string): Citation[] {
  const ownHost = urlHostnameOrNull(pageBaseUrl);
  if (!ownHost) return []; // own URL malformed — skip rather than misclassify

  const citations: Citation[] = [];
  // Restrict to <article> scope — keeps nav/footer/sidebar out
  $('article a[href]').each((_, el) => {
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (!href) return;
    if (href.startsWith('javascript:')) return;
    if (href.startsWith('mailto:')) return;
    if (href.startsWith('tel:')) return;

    const linkHost = urlHostnameOrNull(href);
    if (!linkHost) return; // relative path or malformed — skip
    if (linkHost === ownHost) return; // internal — skip

    citations.push({
      url: href,
      text: $el.text().trim(),
      isExternal: true,
    });
  });

  return citations;
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-citation.test.ts`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add server/schema/extractors/page-elements/citation.ts tests/fixtures/page-elements/webflow-blog-with-citations.html tests/unit/schema/extractors/page-elements-citation.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): citation extractor (outbound authoritative-source links)

Walks <article> for outbound <a href>; filters internal links (matching
the page's own hostname), nav/footer (out of scope by selector), empty
hrefs, javascript:/mailto:/tel: schemes, and relative paths.

Used by Article.citation[] enrichment (Task 12). 5 unit tests + 1
fixture cover the convention.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extractor entry-point + AI-budget helper (sonnet)

**Files:**
- Create: `server/schema/extractors/page-elements/ai-budget.ts`
- Create: `server/schema/extractors/page-elements.ts`
- Create: `tests/fixtures/page-elements/webflow-no-elements.html`
- Create: `tests/fixtures/page-elements/webflow-mixed-elements.html`
- Create: `tests/unit/schema/extractors/page-elements-entry.test.ts`

Composes the 3 element extractors into the public `extractPageElements(html, opts)` API. AI-budget helper is scaffolded for PR2 (zero AI calls in PR1).

- [ ] **Step 1: Create the fixtures**

Create `tests/fixtures/page-elements/webflow-no-elements.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Plain Page</title></head>
<body>
  <article>
    <h1>Plain page</h1>
    <p>No structured elements here.</p>
  </article>
</body>
</html>
```

Create `tests/fixtures/page-elements/webflow-mixed-elements.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Mixed Elements</title></head>
<body>
  <article>
    <h1>How to set up Webflow + GSC</h1>
    <p>Watch the video first:</p>
    <iframe src="https://www.youtube.com/embed/abc12345678" title="GSC Setup"></iframe>
    <h2>Steps</h2>
    <ol>
      <li>Verify your domain in Google Search Console.</li>
      <li>Submit your sitemap URL.</li>
      <li>Wait 48 hours for crawl.</li>
    </ol>
    <p>For details, see the <a href="https://developers.google.com/search">Google Search Central docs</a>.</p>
  </article>
</body>
</html>
```

- [ ] **Step 2: Implement the AI budget helper (scaffold for PR2)**

Create `server/schema/extractors/page-elements/ai-budget.ts`:

```typescript
/**
 * Per-regenerate AI call budget tracker. Bounds the cost of AI-assisted
 * extractors (image role classifier in PR2; HowTo-list AI fallback in
 * PR2) so a single regenerate-all run can't blow up the OpenAI bill.
 *
 * Lifecycle: one budget per regenerate-all trigger. Created in
 * generator.ts (Task 13); passed through extractor opts.
 */
export interface AiBudget {
  /** Maximum AI calls allowed for this run. */
  max: number;
  /** Calls used so far. */
  used: number;
  /** True once max is hit (further requests fall through to rule-based). */
  exhausted: boolean;
}

export function createAiBudget(max: number): AiBudget {
  return { max, used: 0, exhausted: false };
}

/**
 * Try to consume one budget slot. Returns true when an AI call is
 * permitted; false when budget is exhausted (caller should fall back).
 */
export function tryConsumeAiBudget(budget: AiBudget): boolean {
  if (budget.used >= budget.max) {
    budget.exhausted = true;
    return false;
  }
  budget.used += 1;
  if (budget.used >= budget.max) budget.exhausted = true;
  return true;
}
```

- [ ] **Step 3: Write the entry-point tests**

Create `tests/unit/schema/extractors/page-elements-entry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPageElements } from '../../../../server/schema/extractors/page-elements.js';
import { createAiBudget } from '../../../../server/schema/extractors/page-elements/ai-budget.js';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, `../../../fixtures/page-elements/${name}`), 'utf-8');
}

describe('extractPageElements entry-point', () => {
  it('returns empty arrays + diagnostics for a page with no elements', async () => {
    const html = readFixture('webflow-no-elements.html');
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: '2026-04-29T00:00:00.000Z',
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toEqual([]);
    expect(catalog.lists).toEqual([]);
    expect(catalog.citations).toEqual([]);
    expect(catalog.diagnostics.aiClassificationCalls).toBe(0);
    expect(catalog.diagnostics.hitAiBudgetCap).toBe(false);
    expect(catalog.diagnostics.rawCounts).toMatchObject({ videos: 0, lists: 0, citations: 0 });
    expect(catalog.extractedAt).toBeTruthy();
    expect(catalog.sourcePublishedAt).toBe('2026-04-29T00:00:00.000Z');
  });

  it('extracts a YouTube + HowTo + citation from the mixed-elements fixture', async () => {
    const html = readFixture('webflow-mixed-elements.html');
    const catalog = await extractPageElements(html, {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toHaveLength(1);
    expect(catalog.videos[0].provider).toBe('youtube');
    expect(catalog.lists).toHaveLength(1);
    expect(catalog.lists[0].isHowToLike).toBe(true);
    expect(catalog.citations).toHaveLength(1);
    expect(catalog.citations[0].url).toBe('https://developers.google.com/search');
    expect(catalog.diagnostics.rawCounts).toMatchObject({ videos: 1, lists: 1, citations: 1 });
  });

  it('returns empty catalog when HTML is empty/missing', async () => {
    const catalog = await extractPageElements('', {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toEqual([]);
    expect(catalog.lists).toEqual([]);
    expect(catalog.citations).toEqual([]);
  });

  it('does not throw on malformed HTML', async () => {
    const catalog = await extractPageElements('<<<not valid', {
      pageBaseUrl: 'https://www.hmpsn.studio',
      sourcePublishedAt: null,
      aiBudget: createAiBudget(0),
    });
    expect(catalog.videos).toBeDefined();
    expect(catalog.lists).toBeDefined();
  });
});
```

- [ ] **Step 4: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-entry.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement the entry-point**

Create `server/schema/extractors/page-elements.ts`:

```typescript
/**
 * Public entry-point for page-element extraction.
 *
 * Composes the per-element extractors. Pure function of HTML — caller
 * decides where the HTML comes from (fetchPublishedHtml(url) for static
 * pages and CMS items per audit §2.4).
 *
 * Returns a typed PageElementCatalog. Always returns; never throws.
 */
import * as cheerio from 'cheerio';
import type { PageElementCatalog } from '../../../shared/types/page-elements.js';
import { extractVideos } from './page-elements/video.js';
import { extractLists } from './page-elements/howto.js';
import { extractCitations } from './page-elements/citation.js';
import type { AiBudget } from './page-elements/ai-budget.js';

export interface ExtractPageElementsOpts {
  /** Page's canonical URL — used by citation extractor to identify external links. */
  pageBaseUrl: string;
  /** Webflow lastPublished at fetch time (drives stale detection). Null for static pages. */
  sourcePublishedAt: string | null;
  /** Per-regenerate AI budget. Used by AI-assisted extractors in PR2; ignored in PR1. */
  aiBudget: AiBudget;
}

export async function extractPageElements(
  html: string,
  opts: ExtractPageElementsOpts,
): Promise<PageElementCatalog> {
  const $ = cheerio.load(html ?? '');

  // PR1 elements
  const videos = extractVideos($);
  const lists = extractLists($);
  const citations = extractCitations($, opts.pageBaseUrl);

  // PR2/PR3 elements — empty arrays in PR1
  const headings: PageElementCatalog['headings'] = [];
  const tables: PageElementCatalog['tables'] = [];
  const images: PageElementCatalog['images'] = [];
  const testimonials: PageElementCatalog['testimonials'] = [];
  const codeBlocks: PageElementCatalog['codeBlocks'] = [];

  return {
    extractedAt: new Date().toISOString(),
    sourcePublishedAt: opts.sourcePublishedAt,
    headings,
    tables,
    images,
    videos,
    lists,
    testimonials,
    codeBlocks,
    citations,
    diagnostics: {
      aiClassificationCalls: opts.aiBudget.used,
      hitAiBudgetCap: opts.aiBudget.exhausted,
      rawCounts: {
        headings: headings.length,
        tables: tables.length,
        images: images.length,
        videos: videos.length,
        lists: lists.length,
        testimonials: testimonials.length,
        codeBlocks: codeBlocks.length,
        citations: citations.length,
      },
    },
  };
}
```

- [ ] **Step 6: Run tests, confirm pass**

Run: `npx vitest run tests/unit/schema/extractors/page-elements-entry.test.ts`
Expected: 4 PASS.

Run: `npx vitest run tests/unit/schema/extractors/`
Expected: all extractor tests still pass (5 + 6 + 5 + 4 = 20).

- [ ] **Step 7: Commit**

```bash
git add server/schema/extractors/page-elements/ai-budget.ts server/schema/extractors/page-elements.ts tests/fixtures/page-elements/webflow-no-elements.html tests/fixtures/page-elements/webflow-mixed-elements.html tests/unit/schema/extractors/page-elements-entry.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): page-elements extractor entry-point + AI budget helper

Composes video/howto/citation extractors into extractPageElements(html,
opts). Returns a typed PageElementCatalog with diagnostics. Pure
function of HTML; never throws; missing/empty/malformed HTML returns
the empty catalog shape.

AI budget helper (createAiBudget + tryConsumeAiBudget) scaffolded for
PR2's image role classifier; PR1 makes zero AI calls.

4 entry-point tests + 2 fixtures (no-elements + mixed-elements)
complete the unit-test corpus.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `assemblePageElements` lazy refresh + slice integration (sonnet)

**Files:**
- Modify: `server/workspace-intelligence.ts`

Replaces the Task-4 skeleton `assemblePageElements` with the full lazy-refresh logic. Triggered on schema-generate via `buildWorkspaceIntelligence({ slices: ['pageElements'], pagePath })`.

This task does NOT call the extractor itself; it only reads the persisted catalog from `page_elements`. The extractor is wired into `generator.ts` in Task 13 — that's where lazy refresh actually fires. This separation keeps the slice consumer-side clean (it's just a typed read) and the producer-side (extract + persist) inside the schema generator's existing flow.

- [ ] **Step 1: Update `assemblePageElements` in `server/workspace-intelligence.ts`**

Find the Task-4 skeleton and replace with:

```typescript
async function assemblePageElements(
  workspaceId: string,
  pagePath: string,
): Promise<PageElementSlice | undefined> {
  try {
    const record = getPageElements(workspaceId, pagePath);
    if (!record) {
      // No persisted catalog — extraction will happen during the next
      // generator pass (Task 13 wires lazy refresh inside generator.ts).
      // Returning undefined here is correct; consumers gracefully
      // degrade (no schema enrichment until catalog exists).
      return undefined;
    }
    return {
      pagePath: record.pagePath,
      catalog: record.catalog,
    };
  } catch (err) { /* catch-ok: graceful degrade — slice stays undefined */
    log.warn({ err, workspaceId, pagePath }, 'assemblePageElements: store read failed, slice unavailable');
    return undefined;
  }
}
```

- [ ] **Step 2: Verify the assemblePageElements is identical to the Task-4 skeleton**

(It is. Task 4 already produced the right shape; Task 9 simply confirms it. The "lazy refresh" semantics are implemented on the **producer** side in Task 13, not the consumer side.)

- [ ] **Step 3: Run typecheck + slice tests**

Run: `npm run typecheck`
Expected: zero errors.

Run: `npx vitest run tests/unit/page-elements-store.test.ts tests/unit/schema/extractors/`
Expected: all green.

- [ ] **Step 4: Commit (no-op commit if Task 4 already locked the shape)**

If `git diff --stat` shows no changes since Task 4, skip the commit. Otherwise:

```bash
git add server/workspace-intelligence.ts
git commit -m "$(cat <<'EOF'
chore(schema): finalize assemblePageElements semantics

Confirms the Task 4 skeleton is the final shape: assembler reads from
page_elements store; missing row returns undefined (lazy refresh
happens producer-side in generator.ts, see Task 13). Graceful catch
+ log.warn on store read failure.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: VideoObject schema integration (sonnet)

**Files:**
- Modify: `server/schema/validator.ts`
- Modify: `server/schema/templates/article.ts`
- Modify: `tests/unit/schema/templates.test.ts`

Adds `VideoObject` to `REQUIRED_BY_TYPE` and emits a `VideoObject` graph node from Article + BlogPosting templates when `pageData.elements?.videos[0]` is present.

- [ ] **Step 1: Add `VideoObject` to `REQUIRED_BY_TYPE`**

In `server/schema/validator.ts`, find `REQUIRED_BY_TYPE` and add:

```typescript
'VideoObject': {
  required: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
  recommended: ['duration', 'embedUrl', 'contentUrl'],
},
```

- [ ] **Step 2: Write a failing template test**

Append to `tests/unit/schema/templates.test.ts`:

```typescript
describe('Article + BlogPosting — VideoObject enrichment (PR1)', () => {
  it('emits VideoObject graph node when pageData.elements.videos has 1+ entries', () => {
    const input = makeArticleInput({
      elements: {
        videos: [{
          provider: 'youtube',
          embedUrl: 'https://www.youtube.com/embed/abc12345678',
          thumbnailUrl: 'https://img.youtube.com/vi/abc12345678/maxresdefault.jpg',
          title: 'Web Vitals 101',
        }],
      },
    });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    const video = graph.find(n => n['@type'] === 'VideoObject');
    expect(video).toBeDefined();
    expect(video!.name).toBe('Web Vitals 101');
    expect(video!.embedUrl).toBe('https://www.youtube.com/embed/abc12345678');
    expect(video!.thumbnailUrl).toBe('https://img.youtube.com/vi/abc12345678/maxresdefault.jpg');
    expect(video!.uploadDate).toBeDefined(); // falls back to article.datePublished
    expect(video!.description).toBeDefined();
  });

  it('does NOT emit VideoObject when pageData.elements.videos is empty or missing', () => {
    const input = makeArticleInput({ elements: { videos: [] } });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'VideoObject')).toBeUndefined();
  });
});
```

If `makeArticleInput` doesn't accept an `elements` field yet, extend it in this same task or in Task 13 (see Step 4 below).

- [ ] **Step 3: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'VideoObject'`
Expected: FAIL — VideoObject not emitted.

- [ ] **Step 4: Extend `PageMetaInput` with `elements`**

In `server/schema/data-sources.ts`, find `PageMetaInput` and add:

```typescript
import type { PageElementCatalog } from '../../shared/types/page-elements.js';

export interface PageMetaInput {
  // ...existing fields...
  /** Per-page structural elements catalog. Populated by the generator
   *  via extractPageElements() before the template is built. Empty when
   *  the catalog has not been generated yet. */
  elements?: PageElementCatalog;
}
```

Also add `elements?: PageElementCatalog` to `PageData`:

```typescript
export interface PageData {
  // ...existing fields...
  /** Catalog of structural elements detected on the page (videos, HowTo
   *  lists, citations, etc.). Drives conditional schema enrichment. */
  elements?: PageElementCatalog;
}
```

In `extractPageData`, propagate it through:

```typescript
return {
  // ...existing fields...
  elements: input.pageMeta.elements,
};
```

- [ ] **Step 5: Update `buildArticleSchema` to emit VideoObject**

In `server/schema/templates/article.ts`, find the function (around `buildArticleSchema`). Just before the final `withBreadcrumb(primary, pageData)` call, build the optional VideoObject node:

```typescript
const video = pageData.elements?.videos?.[0];
const videoObject = video ? dropUndefined({
  '@type': 'VideoObject',
  '@id': `${baseUrl}#video-${0}`,
  'name': video.title ?? pageData.cleanTitle ?? pageData.title,
  'description': pageData.description ?? `Video embedded in ${pageData.title}.`,
  'thumbnailUrl': video.thumbnailUrl,
  'uploadDate': pageData.datePublished,
  'embedUrl': video.embedUrl,
  'duration': video.durationSec ? `PT${video.durationSec}S` : undefined,
}) : undefined;

const nodes: Array<Record<string, unknown>> = [primary];
if (videoObject) nodes.push(videoObject);

return withBreadcrumb(nodes, pageData);
```

If the existing template returns `withBreadcrumb(primary, pageData)` (single-node form), check that `withBreadcrumb` accepts arrays per audit §2.6. If it doesn't, extend `withBreadcrumb` to handle both shapes — but per audit it ALREADY accepts arrays.

The `dropUndefined` ensures missing `thumbnailUrl` / `duration` / `description` don't trigger validator failures (those become `recommended` warnings, not `required` errors).

- [ ] **Step 6: Run, confirm pass**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'VideoObject'`
Expected: 2 PASS.

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: all template tests green.

- [ ] **Step 7: Commit**

```bash
git add server/schema/validator.ts server/schema/data-sources.ts server/schema/templates/article.ts tests/unit/schema/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): emit VideoObject from pageData.elements.videos (Article + BlogPosting)

VideoObject added to REQUIRED_BY_TYPE (required: name, description,
thumbnailUrl, uploadDate; recommended: duration, embedUrl, contentUrl
per Schema.org Rich Results spec).

Article + BlogPosting templates now emit a VideoObject graph node when
pageData.elements.videos has 1+ entries. Pulls metadata from the catalog
(provider/embedUrl/thumbnailUrl/title) and falls back to article-level
fields (datePublished → uploadDate; description; cleanTitle → name).
ISO 8601 duration when durationSec is present.

PageMetaInput + PageData extended with optional `elements` field
(threaded by generator in Task 13; passes through extractPageData).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: HowTo schema integration (sonnet)

**Files:**
- Modify: `server/schema/validator.ts`
- Modify: `server/schema/templates/article.ts`
- Modify: `tests/unit/schema/templates.test.ts`

Adds `HowTo` to `REQUIRED_BY_TYPE` and emits a `HowTo` graph node from Article + BlogPosting when `pageData.elements?.lists.find(l => l.isHowToLike)` is present.

- [ ] **Step 1: Add `HowTo` to `REQUIRED_BY_TYPE`**

In `server/schema/validator.ts`:

```typescript
'HowTo': {
  required: ['name', 'step'],
  recommended: ['totalTime', 'estimatedCost'],
},
```

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/schema/templates.test.ts`:

```typescript
describe('Article + BlogPosting — HowTo enrichment (PR1)', () => {
  it('emits HowTo graph node when pageData.elements.lists has an isHowToLike entry', () => {
    const input = makeArticleInput({
      elements: {
        lists: [{
          kind: 'ordered',
          itemCount: 3,
          isHowToLike: true,
          steps: [
            { name: 'Mix flour, water, salt.', text: 'Mix flour, water, salt.', position: 1 },
            { name: 'Knead for 10 minutes.', text: 'Knead for 10 minutes.', position: 2 },
            { name: 'Bake at 450°F.', text: 'Bake at 450°F.', position: 3 },
          ],
        }],
      },
    });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    const howTo = graph.find(n => n['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect(howTo!.name).toBeDefined();
    expect(Array.isArray(howTo!.step)).toBe(true);
    expect((howTo!.step as Array<Record<string, unknown>>)).toHaveLength(3);
    expect((howTo!.step as Array<Record<string, unknown>>)[0]['@type']).toBe('HowToStep');
    expect((howTo!.step as Array<Record<string, unknown>>)[0].position).toBe(1);
    expect((howTo!.step as Array<Record<string, unknown>>)[0].text).toBe('Mix flour, water, salt.');
  });

  it('does NOT emit HowTo when no list has isHowToLike: true', () => {
    const input = makeArticleInput({
      elements: {
        lists: [{ kind: 'ordered', itemCount: 3, isHowToLike: false }],
      },
    });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'HowTo')).toBeUndefined();
  });

  it('does NOT emit HowTo when isHowToLike list has no steps', () => {
    const input = makeArticleInput({
      elements: {
        lists: [{ kind: 'ordered', itemCount: 3, isHowToLike: true /* no steps array */ }],
      },
    });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'HowTo')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'HowTo'`
Expected: FAIL.

- [ ] **Step 4: Update `buildArticleSchema` to emit HowTo**

In `server/schema/templates/article.ts`, just before the `withBreadcrumb(...)` return (and just before the VideoObject build from Task 10):

```typescript
const howToList = pageData.elements?.lists?.find(l => l.isHowToLike && l.steps && l.steps.length > 0);
const howTo = howToList ? dropUndefined({
  '@type': 'HowTo',
  '@id': `${baseUrl}#howto`,
  'name': pageData.cleanTitle ?? pageData.title,
  'step': howToList.steps!.map((s) => ({
    '@type': 'HowToStep' as const,
    'position': s.position,
    'name': s.name,
    'text': s.text,
  })),
}) : undefined;
```

Then in the `nodes` array build (extends Task 10's logic):

```typescript
const nodes: Array<Record<string, unknown>> = [primary];
if (howTo) nodes.push(howTo);
if (videoObject) nodes.push(videoObject);

return withBreadcrumb(nodes, pageData);
```

Order matters for `@id` references in cross-validation; the BreadcrumbList is appended by `withBreadcrumb` last.

- [ ] **Step 5: Run, confirm pass**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'HowTo'`
Expected: 3 PASS.

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: all template tests green.

- [ ] **Step 6: Commit**

```bash
git add server/schema/validator.ts server/schema/templates/article.ts tests/unit/schema/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): emit HowTo from pageData.elements.lists (Article + BlogPosting)

HowTo added to REQUIRED_BY_TYPE (required: name, step; recommended:
totalTime, estimatedCost per Google Search Central HowTo rich result
spec).

Article + BlogPosting templates now emit a HowTo graph node when
pageData.elements.lists includes an isHowToLike list with steps.
Each step becomes a HowToStep node (position + name + text). Title
falls back to cleanTitle.

Conservative: no emission when no list is flagged AS isHowToLike,
or when steps array is missing/empty.

3 unit tests cover: emit on isHowToLike+steps, no-emit on
non-howto, no-emit on missing steps.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `Article.citation[]` schema integration (sonnet)

**Files:**
- Modify: `server/schema/templates/article.ts`
- Modify: `tests/unit/schema/templates.test.ts`

Adds a `citation` FIELD to the primary Article/BlogPosting node (NOT a separate graph node — `citation` is a property of Article per Schema.org). No `REQUIRED_BY_TYPE` entry change (it's optional).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/schema/templates.test.ts`:

```typescript
describe('Article + BlogPosting — citation[] enrichment (PR1)', () => {
  it('adds citation[] field to primary node when pageData.elements.citations has entries', () => {
    const input = makeArticleInput({
      elements: {
        citations: [
          { url: 'https://web.dev/vitals', text: "Google Web Vitals docs", isExternal: true },
          { url: 'https://developer.mozilla.org/web/api', text: 'MDN guide', isExternal: true },
        ],
      },
    });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    const primary = graph[0];
    const citations = primary.citation as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(2);
    expect(citations[0]['@type']).toBe('WebPage');
    expect(citations[0].url).toBe('https://web.dev/vitals');
    expect(citations[0].name).toBe("Google Web Vitals docs");
  });

  it('does NOT add citation[] when no citations present', () => {
    const input = makeArticleInput({ elements: { citations: [] } });
    const graph = buildArticleSchema(input)['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0].citation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'citation'`
Expected: FAIL.

- [ ] **Step 3: Add `citation` to the primary Article node**

In `server/schema/templates/article.ts`, find the primary node construction. Add `citation` to the `dropUndefined({...})` payload:

```typescript
const primary = dropUndefined({
  // ...existing fields...
  'citation': pageData.elements?.citations && pageData.elements.citations.length > 0
    ? pageData.elements.citations.map(c => ({
        '@type': 'WebPage' as const,
        'url': c.url,
        'name': c.text || c.url, // empty anchor text falls back to URL
      }))
    : undefined,
});
```

`dropUndefined` strips the field when the array is empty/undefined.

- [ ] **Step 4: Run, confirm pass**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'citation'`
Expected: 2 PASS.

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: all template tests green.

- [ ] **Step 5: Commit**

```bash
git add server/schema/templates/article.ts tests/unit/schema/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): emit Article.citation[] from pageData.elements.citations

Article + BlogPosting primary nodes now carry a citation[] field
mapping pageData.elements.citations to { @type: WebPage, url, name }
entries. Per Schema.org spec, citation is a property of Article
(not a separate graph node). Empty arrays drop via dropUndefined.

E-E-A-T trust signal: outbound authoritative-source links surface
to Google as evidence of well-sourced content. Falls back to URL
as name when anchor text is empty (image-only links).

2 unit tests cover emit + no-emit cases.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Generator wiring + integration tests (sonnet)

**Files:**
- Modify: `server/schema/generator.ts`
- Modify: `server/schema-suggester.ts` (call site that builds `LeanGeneratorInput`)
- Modify: `tests/integration/lean-schema-generator.test.ts`

Wires lazy extraction inside `generateLeanSchema`: read store → if missing or stale (Webflow `lastPublished` > stored `source_published_at`), extract and persist. Threads catalog into `pageData.elements`.

- [ ] **Step 1: Add lazy refresh inside `generateLeanSchema`**

In `server/schema/generator.ts`, find the function signature. After `extractPageData(...)` returns, but before any template build, add the catalog refresh logic:

```typescript
import { extractPageElements } from './extractors/page-elements.js';
import { createAiBudget } from './extractors/page-elements/ai-budget.js';
import { getPageElements, upsertPageElements } from '../page-elements-store.js';

// ...inside generateLeanSchema after extractPageData...

// Lazy-refresh element catalog: read from store; if missing or
// stale-vs-Webflow-lastPublished, extract from current HTML + persist.
const workspaceId = input.workspace.id;
const pagePath = input.pageMeta.publishedPath;
let catalog: PageElementCatalog | undefined;
if (workspaceId && pagePath) {
  const stored = getPageElements(workspaceId, pagePath);
  const isStale =
    !stored ||
    (input.pageMeta.sourcePublishedAt
      && stored.sourcePublishedAt !== null
      && new Date(input.pageMeta.sourcePublishedAt) > new Date(stored.sourcePublishedAt));
  if (!stored || isStale) {
    try {
      const aiBudget = input.aiBudget ?? createAiBudget(0); // PR1: zero AI calls
      catalog = await extractPageElements(input.html ?? '', {
        pageBaseUrl: baseUrl,
        sourcePublishedAt: input.pageMeta.sourcePublishedAt ?? null,
        aiBudget,
      });
      upsertPageElements(workspaceId, pagePath, catalog);
    } catch (err) { /* catch-ok: extraction failure → schema falls back to current behavior */
      log.warn({ err, workspaceId, pagePath }, 'page-element extraction failed; schema enrichment skipped');
    }
  } else {
    catalog = stored.catalog;
  }
}

pageData.elements = catalog;
```

If `LeanGeneratorInput` doesn't already accept `aiBudget` or `workspace.id`, extend it:

```typescript
export interface LeanGeneratorInput {
  // ...existing fields...
  workspace: WorkspaceSchemaInput; // already typed; ensure id is included
  /** Per-regenerate AI budget passed by the schema-suggester orchestrator. PR1 always zero. */
  aiBudget?: AiBudget;
}
```

If `WorkspaceSchemaInput.id` doesn't exist, add it (the orchestrator in `schema-suggester.ts` already has the workspaceId from ctx).

If `PageMetaInput.sourcePublishedAt` doesn't exist, add it. The CMS-discovery loop in `schema-suggester.ts` already has `item.lastPublished`; thread it through.

- [ ] **Step 2: Update `schema-suggester.ts` call site to pass `workspace.id` + `pageMeta.sourcePublishedAt`**

In each `generateLeanSchema` call site (3 sites — single-page + per-page loop + CMS loop per audit §2.4), thread the new fields:

```typescript
workspace: {
  id: ctx.workspaceId,
  // ...existing fields (name, publisherLogoUrl, businessProfile, defaultLocale, siteKeywordsForKnowsAbout, siteHasSearch)...
},
pageMeta: {
  // ...existing fields...
  sourcePublishedAt: page.lastPublished ?? null, // CMS items have it; static pages null
},
```

For CMS items, `item.lastPublished` is the source. For static pages discovered via sitemap, the field is null (extraction will run on first generate; subsequent generates will use the stored catalog until the sitemap fetcher gains a published-at signal — out of scope for PR1).

- [ ] **Step 3: Add integration tests**

In `tests/integration/lean-schema-generator.test.ts`, append:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function fixturePageElementsHtml(name: string): string {
  return readFileSync(join(__dirname, `../fixtures/page-elements/${name}`), 'utf-8');
}

describe('lean schema generator — page-element enrichment (PR1)', () => {
  it('emits VideoObject in @graph when HTML contains a YouTube embed', async () => {
    const html = fixturePageElementsHtml('webflow-blog-with-youtube.html');
    const out = await generateLeanSchema({
      pageId: 'p1',
      pageMeta: makePageMetaInput({ publishedPath: '/blog/youtube-test', sourcePublishedAt: null }),
      html,
      baseUrl: 'https://www.hmpsn.studio',
      workspace: makeWorkspaceInput(),
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const video = graph.find(n => n['@type'] === 'VideoObject');
    expect(video).toBeDefined();
    expect(video!.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0');
  });

  it('emits HowTo in @graph when HTML contains a how-to ordered list', async () => {
    const html = fixturePageElementsHtml('webflow-blog-howto.html');
    const out = await generateLeanSchema({
      pageId: 'p2',
      pageMeta: makePageMetaInput({ publishedPath: '/blog/sourdough', sourcePublishedAt: null }),
      html,
      baseUrl: 'https://www.hmpsn.studio',
      workspace: makeWorkspaceInput(),
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const howTo = graph.find(n => n['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect((howTo!.step as Array<Record<string, unknown>>)).toHaveLength(5);
  });

  it('emits Article.citation[] when HTML contains outbound external links', async () => {
    const html = fixturePageElementsHtml('webflow-blog-with-citations.html');
    const out = await generateLeanSchema({
      pageId: 'p3',
      pageMeta: makePageMetaInput({ publishedPath: '/blog/cwv-2026', sourcePublishedAt: null }),
      html,
      baseUrl: 'https://www.hmpsn.studio',
      workspace: makeWorkspaceInput(),
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const primary = graph[0];
    const citations = primary.citation as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(2);
    expect(citations[0].url).toBe('https://web.dev/articles/vitals');
  });

  it('falls back to no-enrichment schema when HTML has no detectable elements', async () => {
    const html = fixturePageElementsHtml('webflow-no-elements.html');
    const out = await generateLeanSchema({
      pageId: 'p4',
      pageMeta: makePageMetaInput({ publishedPath: '/plain-page', sourcePublishedAt: null }),
      html,
      baseUrl: 'https://www.hmpsn.studio',
      workspace: makeWorkspaceInput(),
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'VideoObject')).toBeUndefined();
    expect(graph.find(n => n['@type'] === 'HowTo')).toBeUndefined();
    // primary node has no `citation` field
    expect(graph[0].citation).toBeUndefined();
  });
});
```

If `makePageMetaInput`/`makeWorkspaceInput` test helpers don't exist in this file, add them inline or extract to a shared helper. Pattern: factory functions with sensible defaults.

- [ ] **Step 4: Run all schema tests**

Run: `npx vitest run tests/unit/schema/ tests/integration/lean-schema-generator.test.ts tests/unit/page-elements-store.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/schema/generator.ts server/schema/data-sources.ts server/schema-suggester.ts tests/integration/lean-schema-generator.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): wire lazy page-element extraction into generator

generateLeanSchema now reads the persisted page-element catalog from
the page_elements store; on miss or stale (Webflow lastPublished >
stored source_published_at), runs extractPageElements on the current
HTML and persists. Catalog is threaded into pageData.elements so
templates conditionally enrich.

WorkspaceSchemaInput gains `id` (already in scope at ctx).
PageMetaInput gains `sourcePublishedAt` (already available from CMS
discovery — `item.lastPublished`). LeanGeneratorInput gains optional
`aiBudget` for the PR2 image classifier — PR1 always defaults to
zero.

Failure mode: extraction errors are caught + log.warn'd; schema
falls back to existing behavior. Schema is never blocked by
extractor failures.

4 integration tests assert end-to-end VideoObject + HowTo +
Article.citation[] emission for the appropriate fixtures, plus the
no-elements negative case.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Quality gates + open PR (haiku)

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`

- [ ] **Step 1: Run all CLAUDE.md quality gates**

```bash
npm run typecheck
```
Expected: zero errors.

```bash
npx vite build
```
Expected: builds successfully.

```bash
npx vitest run
```
Expected: all schema tests green; pre-existing flaky tests (`bulk-analysis-semrush-prefetch`, `tier-gate-enforcement`, `brandscript-hardening I14`, `deep-diagnostic-jobs`, `content-decay-routes`) may still fail in full-suite mode but pass in isolation — same baseline as Pillar 1 + parity-fields PR1+PR2.

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero errors. Pre-existing PageHeader warning + layout-state warning persist.

- [ ] **Step 2: Update `FEATURE_AUDIT.md`**

Append after the parity-fields PR2 paragraph:

```markdown
**Schema Page-Element Catalog PR1 (PR #TBD, 2026-04-29):** First half of the intelligence-phase schema enrichment. New `PageElementSlice` on `buildWorkspaceIntelligence` (the second migration anchor for the Trajectory 3 → 1 migration; born on Pattern B). Cheerio-based extractor at `server/schema/extractors/page-elements.ts` produces a typed `PageElementCatalog` (videos, lists, citations in PR1; tables/images/testimonials/code-blocks in PR2; headings/ToC in PR3). Persisted in new `page_elements` table (migration 079) with composite PK (workspace_id, page_path), JSON catalog blob validated via Zod on read (parseJsonSafe with EMPTY_CATALOG fallback). Lazy refresh: stale-detection via Webflow `lastPublished` vs stored `source_published_at`; extraction triggered inside `generateLeanSchema`. Three new schema integrations on Article + BlogPosting templates: `VideoObject` graph node when HTML contains YouTube/Vimeo/native video embeds; `HowTo` graph node when HTML contains a numbered list flagged as how-to-shaped; `Article.citation[]` field when HTML contains outbound authoritative-source links. New `REQUIRED_BY_TYPE` entries: `VideoObject` (name, description, thumbnailUrl, uploadDate); `HowTo` (name, step). PR1 ships zero AI calls — pattern-based detection only; AI image-role classifier deferred to PR2 with budget cap + feature flag. `formatPageElementsSection` formatter references all 8 element-array fields + pagePath; diagnostics fields registered in KNOWN_UNRENDERED_FIELDS. Failure mode is graceful — extractor never throws; schema falls back to existing behavior on extraction error. **Files:** `shared/types/page-elements.ts` (new), `shared/types/intelligence.ts` (extended), `server/db/migrations/079-page-elements.sql` (new), `server/schemas/page-elements-schema.ts` (new — Zod), `server/page-elements-store.ts` (new), `server/schema/extractors/page-elements.ts` (new), `server/schema/extractors/page-elements/{video,howto,citation,ai-budget}.ts` (new), `server/workspace-intelligence.ts` (slice integration), `server/schema/validator.ts` (REQUIRED_BY_TYPE), `server/schema/templates/article.ts` (3 enrichments), `server/schema/data-sources.ts` (PageMetaInput + PageData extensions), `server/schema/generator.ts` (lazy refresh), `server/schema-suggester.ts` (3 call sites threaded), `scripts/pr-check.ts` (KNOWN_UNRENDERED_FIELDS), `tests/unit/page-elements-store.test.ts` (new), `tests/unit/schema/extractors/page-elements-{video,howto,citation,entry}.test.ts` (new), `tests/integration/lean-schema-generator.test.ts` (extended), `tests/fixtures/page-elements/*.html` (6 new fixtures).
```

- [ ] **Step 3: Update `data/roadmap.json`**

Find the existing entry `schema-page-element-catalog-v1`. Split into PR1 (done) + PR2 (pending) + PR3 (pending) per audit §8:

```json
{
  "id": "schema-page-element-catalog-pr1",
  "title": "Schema Page-Element Catalog PR1 — slice + 3 element types + 3 schema integrations",
  "source": "docs/superpowers/plans/2026-04-29-page-element-catalog-pr1.md",
  "est": "5d",
  "priority": "P1",
  "sprint": "J",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "PageElementSlice + page_elements table + extractors for videos/HowTo/citations + VideoObject/HowTo/Article.citation[] schema integrations on Article + BlogPosting. No AI in PR1. Spec: docs/superpowers/specs/2026-04-29-page-element-catalog-design.md. Audit: docs/superpowers/audits/2026-04-29-page-element-catalog-audit.md."
},
{
  "id": "schema-page-element-catalog-pr2",
  "title": "Schema Page-Element Catalog PR2 — images + tables + testimonials",
  "source": "docs/superpowers/specs/2026-04-29-page-element-catalog-design.md §5.2 + §6",
  "est": "4d",
  "priority": "P1",
  "sprint": "J",
  "status": "pending",
  "notes": "Adds 3 element types (images with role classification, tables, testimonials) + 3 schema integrations (ImageGallery/role-classified image, Table mainEntity, Review+AggregateRating). Optional GPT-4.1-mini AI image classifier behind feature flag with 100-call budget per regenerate. Builds on PR1 foundation."
},
{
  "id": "schema-page-element-catalog-pr3",
  "title": "Schema Page-Element Catalog PR3 — polish (codeBlocks, headings/ToC, speakable)",
  "source": "docs/superpowers/specs/2026-04-29-page-element-catalog-design.md §5.3",
  "est": "2d",
  "priority": "P2",
  "sprint": "future",
  "status": "pending",
  "notes": "Optional polish: codeBlocks → CodeRepository/SoftwareSourceCode (low ROI for agency sites); headings → WebPage.speakable cssSelector (overlaps with schema-engagement-signals; whichever ships first wins). May be skipped if cycles are short."
}
```

Run `npx tsx scripts/sort-roadmap.ts` to re-sort.

- [ ] **Step 4: Push branch and open PR**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "$(cat <<'EOF'
docs: mark schema-page-element-catalog-pr1 done; split roadmap into PR1/PR2/PR3

FEATURE_AUDIT.md gains the comprehensive PR1 paragraph: PageElementSlice +
3 extractors (videos/HowTo/citations) + 3 schema integrations
(VideoObject/HowTo/Article.citation) on Article + BlogPosting templates.

data/roadmap.json: schema-page-element-catalog-v1 entry split into
schema-page-element-catalog-pr1 (done), -pr2 (pending), -pr3 (pending)
mirroring the parity-fields-pr1/-pr2 split pattern.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

git push -u origin claude/page-element-catalog
```

```bash
gh pr create --base staging --title "feat(schema): page-element catalog PR1 — slice + 3 element types + 3 schema integrations" --body "$(cat <<'EOF'
## Summary

First half of the intelligence-phase schema enrichment (post parity-fields PR1+PR2). Ships:

- **PageElementSlice** on `buildWorkspaceIntelligence` — second migration anchor for Trajectory 3 → 1; born on Pattern B
- **Cheerio extractor** at `server/schema/extractors/page-elements.ts` — pure function of HTML; never throws
- **Persistence** in new `page_elements` table (migration 079) with composite PK + Zod-validated JSON column
- **Lazy refresh** inside `generateLeanSchema` — stale-detection via Webflow `lastPublished`
- **Three element types** (PR1):
  - YouTube + Vimeo + native `<video>` detection
  - HowTo-shaped ordered lists (pattern-based: nearby heading + 2+ items + ordered)
  - Outbound citations (external links in `<article>` scope)
- **Three schema integrations** on Article + BlogPosting:
  - `VideoObject` graph node (when videos present)
  - `HowTo` graph node (when HowTo-list detected)
  - `Article.citation[]` field (when outbound external links present)
- **New REQUIRED_BY_TYPE entries**: `VideoObject` + `HowTo`
- **Zero AI calls in PR1** — pattern-based detection only. AI image-role classifier shipped in PR2 behind feature flag with budget cap.

## Spec + audit

- `docs/superpowers/specs/2026-04-29-page-element-catalog-design.md`
- `docs/superpowers/audits/2026-04-29-page-element-catalog-audit.md`
- `docs/superpowers/plans/2026-04-29-page-element-catalog-pr1.md`

## What's NOT in this PR

- PR2: ImageGallery + role-classified images (AI optional), Table mainEntity, Review + AggregateRating
- PR3: codeBlocks + headings/ToC + speakable cssSelector (overlaps with engagement-signals spec; may merge there)
- Admin "Page elements" reporting UI — deferred indefinitely

## Test plan

- [x] `npm run typecheck` — 0 errors
- [x] `npx tsx scripts/pr-check.ts` — 0 errors, only pre-existing warnings
- [x] Per-extractor unit tests: 5 (video) + 6 (HowTo) + 5 (citation) + 4 (entry) = 20 tests pass
- [x] page-elements-store CRUD: 5 tests pass (insert, replace, missing, scoped delete, malformed-json fallback)
- [x] Integration tests: 4 new assertions in `tests/integration/lean-schema-generator.test.ts` (VideoObject / HowTo / citation / no-enrichment fallback)
- [ ] CI green on staging
- [ ] After staging deploy: regenerate hmpsn studio schema in Chrome MCP. Verify:
  - [ ] Blog post with YouTube embed shows `VideoObject` in JSON-LD `@graph`
  - [ ] Blog post with how-to-shaped numbered list shows `HowTo` graph node with HowToStep children
  - [ ] Blog post with outbound external links shows `Article.citation[]`
  - [ ] Pages without elements emit existing schema unchanged
  - [ ] Validator stat shows `28/28` clean (no new errors from VideoObject/HowTo emissions)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Cross-Phase Contracts (PR1 → PR2)

### Exported from PR1 (PR2 will read)

- **`PageElementCatalog`** type at `shared/types/page-elements.ts` — PR2 extends with populated `images[]` + `tables[]` + `testimonials[]`
- **`PageElementSlice`** + `assemblePageElements` — PR2 reuses; no signature change
- **`extractPageElements`** entry-point + `AiBudget` helper — PR2 wires the AI image classifier into the existing budget tracker
- **`page_elements` table** + `page-elements-store.ts` CRUD — PR2 reuses verbatim
- **`pageData.elements`** field on PageData — PR2 templates read from it for image/table/testimonial enrichment
- **REQUIRED_BY_TYPE entries** — PR2 extends with `Review`, `AggregateRating`, `Table`, `ImageGallery`

### Not exported (internal to PR1)

- The 3 element-type extractors (`video.ts`, `howto.ts`, `citation.ts`) — internal to `extractors/page-elements/` directory
- The AI budget tracker — internal helper

---

## Systemic Improvements

### Shared utilities extracted

- `extractPageElements(html, opts)` — single entry-point composes per-element extractors; PR2 + PR3 add element types behind the same façade
- `AiBudget` + `tryConsumeAiBudget` — used by PR2 image classifier; pre-built so PR2's diff is element-type code only
- `pageElementCatalogSchema` (Zod) — single source of truth for catalog validation; reused by PR2/PR3 reads

### pr-check rules added

- None new in PR1. The plan extends `KNOWN_UNRENDERED_FIELDS` to register the 3 PageElementCatalog diagnostic-only fields, satisfying the existing `Assembled-but-never-rendered slice fields` rule.

### New tests required

- 4 unit-test files: `tests/unit/schema/extractors/page-elements-{video,howto,citation,entry}.test.ts` — 20 tests total
- 1 store test file: `tests/unit/page-elements-store.test.ts` — 5 tests
- 4 new integration assertions in `tests/integration/lean-schema-generator.test.ts`
- 6 HTML fixture files under `tests/fixtures/page-elements/`

---

## Verification Strategy

| What | How |
|---|---|
| Per-extractor unit tests pass | `npx vitest run tests/unit/schema/extractors/` |
| Store CRUD round-trips | `npx vitest run tests/unit/page-elements-store.test.ts` |
| End-to-end JSON-LD enrichment | `npx vitest run tests/integration/lean-schema-generator.test.ts` |
| Slice-rendering rule satisfied | `npx tsx scripts/pr-check.ts` (rule: Assembled-but-never-rendered slice fields) |
| Migration runs cleanly | Migration runner picks up 079 on dev-server start; check logs for errors |
| Live verification on hmpsn.studio | After staging deploy: regenerate schema in Chrome MCP; inspect a blog post for VideoObject + HowTo + citation enrichment |
| No false positives on no-elements pages | Inspect `/discovery` (Contact-page-equivalent): no VideoObject, no HowTo, no citation field |
| Snapshot storage compatibility | Existing snapshot `validationErrors: string[]` still works (carried over from PR1's parity-fields shipped previously) |

---

## Self-Review

**1. Spec coverage:**
- Spec §3.1 Pattern B from day one — Task 4 (slice integration) ✓
- Spec §3.2 Slice-dispatch + per-page invocation — Task 4 + Task 9 ✓
- Spec §3.3 Storage hybrid — Tasks 2 + 3 (migration + store) ✓
- Spec §3.4 Lazy refresh — Task 13 (generator wiring) ✓
- Spec §4.0 Slice rendering contract — Task 4 (formatPageElementsSection + KNOWN_UNRENDERED_FIELDS) ✓
- Spec §4.1 PageElementCatalog interface — Task 1 ✓
- Spec §4.2 Extractor module — Tasks 5, 6, 7, 8 ✓
- Spec §4.3 AI image classifier — DEFERRED to PR2; only AI-budget scaffold in Task 8 (sufficient for PR1 scope)
- Spec §4.4 Detection thresholds — Tasks 5, 6, 7 (per-element heuristics) ✓
- Spec §5.1 PR1 schema integrations (VideoObject + HowTo + Article.citation[]) — Tasks 10, 11, 12 ✓
- Spec §6 PR decomposition — this plan IS the PR1 decomposition ✓
- Spec §7 Cost & performance budget — `aiBudget = createAiBudget(0)` in PR1 (zero AI cost) ✓
- Spec §8.1 New REQUIRED_BY_TYPE entries — Tasks 10, 11 (VideoObject + HowTo) ✓
- Spec §8.2 Integration tests with HTML fixture corpus — Task 13 + Tasks 5–8 fixtures ✓
- Audit corrections all reflected in plan code blocks ✓

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" patterns. Each task contains complete code blocks. The few `if … doesn't exist, do …` notes (Task 4 KNOWN_UNRENDERED_FIELDS key shape; Task 13 LeanGeneratorInput.aiBudget) are explicit branch instructions, not vague placeholders.

**3. Type consistency:**
- `PageElementCatalog` shape (Task 1) matches its use in Tasks 2, 3, 8, 9, 10, 11, 12, 13.
- `PageElementSlice` shape (Task 4) matches Task 9 read + the Task 4 formatter signature.
- `Video.embedUrl` / `Video.thumbnailUrl` / `Video.title` (Task 1) match their use in Task 5 (extractor) + Task 10 (template emission).
- `PageList.isHowToLike` + `PageList.steps` + `HowToStep.{name, text, position}` consistent across Tasks 1, 6, 11.
- `Citation.url` + `Citation.text` + `Citation.isExternal` consistent across Tasks 1, 7, 12.
- `aiBudget` parameter on `extractPageElements` (Task 8) matches its use in Task 13 (`createAiBudget(0)`).
- All `parseJsonSafe(catalog_json, schema, {...context})` call shapes consistent — adjusts in Task 3 if real signature differs.

**4. Sequencing:**
- Task 1 (types) before Task 2 (Zod schema imports types) before Task 3 (store imports both) before Task 4 (slice imports types). ✓
- Task 4 (slice + format) before Tasks 5–7 (extractors don't need slice but no inverse dependency). ✓
- Task 8 (entry-point) imports Tasks 5–7. ✓
- Task 9 (slice-finalize) clarifies Task 4's shape; no consumer change. ✓
- Tasks 10, 11, 12 (schema integrations) all touch `article.ts` + `validator.ts` — sequential dispatch (audit §5 explicitly says no parallel here).
- Task 13 (generator) imports the entry-point from Task 8; threads catalog through PageData. ✓
- Task 14 (PR open) last. ✓

---

## Estimates

| Phase | Tasks | Estimated time |
|---|---|---|
| Phase 0 — shared contracts | 1, 2, 3, 4 | 6-7 hours |
| Phase 1 — element-type extractors (parallel) | 5, 6, 7 | ~3 hours wall-clock with 3 parallel agents (would be ~6h sequential) |
| Phase 2 — entry-point + AI budget | 8 | 2 hours |
| Phase 3 — slice integration finalize | 9 | 1 hour |
| Phase 4 — schema integrations | 10, 11, 12 | 4 hours |
| Phase 5 — generator wiring + integration tests | 13 | 4 hours |
| Phase 6 — quality gates + PR | 14 | 2 hours |
| **Total** | 14 | **~5 days subagent-driven** with 2 parallel windows (Phase 1) |

Reviewer overhead (per subagent-driven-development): ~30% on top, mostly absorbed by Phase 5 verification.

---

**End of plan.** Plan-writing complete. Ready for execution via `superpowers:subagent-driven-development`.
