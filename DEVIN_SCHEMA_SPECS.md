# Architecture → Schema Integration — Devin Task Specs

> **Purpose:** Handover document for Devin to implement 7 isolated tasks that extend the architecture→schema bridge.
> **Created:** 2026-03-19
> **Depends on:** Cascade tasks C1 + C2 must land first (they add architecture tree caching + `SchemaContext` extensions). Tasks D1 can start immediately; D2–D7 should wait for C1+C2.

---

## Execution Process & Dependency Graph

Cascade (interactive pair-programming tool) is handling 6 tasks (C1–C6) in parallel with your work. Here's how the two tracks coordinate:

### Dependency Graph

```
D1 ──────────────────────────── no dependencies (START IMMEDIATELY)
    │
    ├── D2 depends on D1 (imports PAGE_TYPE_SCHEMA_MAP)
    │     │
    │     └── D7 depends on D1 + D2 (needs schema type binding)
    │
C1 + C2 ────────────────────── Cascade builds these first
    │
    ├── D3 depends on C1 + C2 (needs architecture tree in SchemaContext)
    ├── D5 depends on C1 + C2 (needs tree traversal helpers)
    └── D6 depends on C1 + C2 (needs SchemaContext._briefId extension)

D4 ──────────────────────────── no dependencies (can start anytime)
```

### Batch Schedule — You'll Receive Tasks in 3 Batches

**Batch 1 — COMPLETE:** `D1` ✅ Shipped #143
**Batch 2 — COMPLETE:** `D2` ✅ #144, `D3` ✅ #145, `D5` ✅ #146

**Batch 3 (NOW — ready to start):** `D4`, `D6`, `D7`
- Pull latest main before starting — it now contains ALL Cascade tasks (C1–C5) and Devin batch 1+2.
- Available in main since batch 2:
  - `getParentNode()`, `getSiblingNodes()`, `getChildNodes()` in `server/site-architecture.ts`
  - `getSchemaTypesForTemplate()` in `server/content-matrices.ts` (needed by D7)
  - `expectedSchemaTypes` on `MatrixCell` (from D2)
  - CollectionPage injection (D3) and relationship enrichment (D5) in `injectCrossReferences()`
- **D4** (competitor schema intel) has zero dependencies — can start first.
- **D6** (brief E-E-A-T enrichment) depends on C1+C2 (available).
- **D7** (planned page pre-generation) depends on D1+D2 (available).
- These are independent of each other — work in any order or in parallel.
- Cascade is working on C6 (schema impact tracking) in parallel with this batch.

### Sync Points

| Sync | What must be merged | What it unlocks |
|------|-------------------|-----------------|
| **Sync 1** | C1 + C2 + D1 | Batch 2 (D2, D3, D5) + Cascade C3/C4/C5 |
| **Sync 2** | Batch 2 (D2, D3, D5) | Batch 3 (D4, D6, D7) + Cascade C6 |
| **Final** | Everything | Integration verification |

### Important: What Cascade's C1 + C2 Add (You'll Import These)

After C1 + C2 land, these will be available in main:

**`server/site-architecture.ts` — new exports:**
```typescript
// Returns [root, ..., parent, target] ancestor chain for a path
export function getAncestorChain(tree: SiteNode, targetPath: string): SiteNode[];

// Returns all nodes as flat array (depth-first)
export function flattenTree(tree: SiteNode): SiteNode[];

// Cached architecture loader (10-minute TTL, avoids duplicate API calls)
export async function getCachedArchitecture(workspaceId: string): Promise<SiteArchitectureResult>;
```

**`server/schema-suggester.ts` — `SchemaContext` extensions:**
```typescript
export interface SchemaContext {
  // ... existing fields ...
  _architectureTree?: SiteNode;    // Full tree for breadcrumb + nav generation
  _pageNode?: SiteNode;            // Current page's node (has parent/siblings)
  _ancestors?: SiteNode[];         // Ancestor chain for breadcrumbs
}
```

---

## Codebase Orientation

**Tech stack:** Express + TypeScript backend, React 19 + Vite 8 + TailwindCSS 4 frontend.

**Key files you'll touch:**

| File | What it does |
|------|-------------|
| `server/schema-suggester.ts` | AI-powered schema generation per page. Has `generateSchemaForPage()`, `generateSchemaSuggestions()`, validation, auto-fix, cross-reference injection. |
| `server/schema-plan.ts` | Site-wide schema strategy. Assigns roles (homepage, service, blog, etc.) to each page. |
| `server/schema-store.ts` | Persistence for schema snapshots, site templates, schema plans. |
| `server/site-architecture.ts` | Builds URL tree from Webflow pages + CMS + content matrices + keyword strategy. Exports `SiteNode`, `SiteArchitectureResult`, `buildSiteArchitecture()`. |
| `server/content-matrices.ts` | Content matrix CRUD. `MatrixCell` has `briefId`, `postId`, `status`, `statusHistory`. |
| `server/helpers.ts` | `buildSchemaContext()` — enriches schema generation with workspace metadata. |
| `shared/types/content.ts` | Shared TypeScript types for `ContentTemplate`, `ContentMatrix`, `MatrixCell`. |
| `src/components/matrix/types.ts` | Frontend mirror of content types. |
| `src/components/matrix/CellDetailPanel.tsx` | Cell detail slide-out panel in the matrix grid. |
| `server/routes/webflow-schema.ts` | Express routes for all schema endpoints. |

**Patterns to follow:**
- All server modules use `createLogger('module-name')` for Pino structured logging.
- API routes are in `server/routes/` as Express Router files.
- Frontend API calls go through typed wrappers in `src/api/`.
- Shared types between client/server live in `shared/types/`.
- Frontend types are mirrored in component-level `types.ts` files.
- UI primitives: `SectionCard`, `StatCard`, `Badge`, `EmptyState`, `PageHeader` from `src/components/ui/`.
- After completing each task: update `FEATURE_AUDIT.md` (add numbered entry) and `data/roadmap.json` (mark done or add new item).
- Build verify: `npx tsc --noEmit --skipLibCheck && npx vite build`

**Existing schema types used in the AI prompt (from `SchemaPageType`):**
```
'auto' | 'homepage' | 'pillar' | 'service' | 'audience' | 'lead-gen' | 'blog' | 'about' | 'contact' | 'location' | 'product' | 'partnership' | 'faq' | 'case-study' | 'comparison' | 'generic'
```

**Content template page types (from `ContentTemplate.pageType`):**
```
'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource' | 'provider-profile' | 'procedure-guide' | 'pricing-page'
```

---

## D1: Page Type → Schema Type Mapping + Prompt Injection

**Priority:** High — can start immediately, no dependencies
**Est:** 3h
**Branch name:** `feat/schema-page-type-mapping`

### What to build

A deterministic mapping from page type to recommended Schema.org types, injected into the AI prompt so the model focuses on property population rather than type selection.

### Files to modify

- `server/schema-suggester.ts`

### Spec

1. **Add constant after the existing `PAGE_TYPE_LABELS` (line ~36):**

```typescript
export const PAGE_TYPE_SCHEMA_MAP: Record<SchemaPageType, { primary: string[]; secondary: string[] }> = {
  auto: { primary: [], secondary: [] }, // AI decides
  homepage: { primary: ['Organization', 'WebSite'], secondary: ['SiteNavigationElement'] },
  pillar: { primary: ['Article', 'CollectionPage'], secondary: ['BreadcrumbList'] },
  service: { primary: ['Service'], secondary: ['Offer', 'BreadcrumbList'] },
  audience: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  'lead-gen': { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
  blog: { primary: ['BlogPosting'], secondary: ['BreadcrumbList', 'speakable'] },
  about: { primary: ['AboutPage', 'Organization'], secondary: ['Person', 'BreadcrumbList'] },
  contact: { primary: ['ContactPage'], secondary: ['Organization', 'BreadcrumbList'] },
  location: { primary: ['LocalBusiness'], secondary: ['Place', 'GeoCoordinates', 'BreadcrumbList'] },
  product: { primary: ['Product'], secondary: ['Offer', 'AggregateRating', 'BreadcrumbList'] },
  partnership: { primary: ['WebPage'], secondary: ['Organization', 'BreadcrumbList'] },
  faq: { primary: ['FAQPage'], secondary: ['BreadcrumbList'] },
  'case-study': { primary: ['Article'], secondary: ['CreativeWork', 'BreadcrumbList'] },
  comparison: { primary: ['WebPage'], secondary: ['ItemList', 'BreadcrumbList'] },
  generic: { primary: ['WebPage'], secondary: ['BreadcrumbList'] },
};
```

2. **Inject into AI prompt in `generateSchemaForPage()`:**

Find where the system prompt is built (search for `callOpenAI` in the function). When `ctx.pageType` is set and not `'auto'`, add this to the prompt:

```
Based on the page type "${ctx.pageType}", the recommended schema types are:
Primary: ${primary.join(', ')}
Secondary (if applicable): ${secondary.join(', ')}
Focus on populating these types with accurate properties from the page content.
Do not add other types unless the page content strongly warrants it.
```

3. **Don't break `auto` mode:** When `pageType` is `'auto'` or undefined, skip the injection — let the AI decide types as it currently does.

4. **Export the map** so other modules (D2, D3) can import it.

### Testing
- Generate schema for a page with `pageType: 'service'` — verify the AI output includes `Service` type.
- Generate schema with `pageType: 'auto'` — verify behavior is unchanged.
- Build: `npx tsc --noEmit --skipLibCheck && npx vite build`

---

## D2: Template → Schema Template Binding

**Priority:** High
**Est:** 3h
**Depends on:** D1 (uses `PAGE_TYPE_SCHEMA_MAP`)
**Branch name:** `feat/template-schema-binding`

### What to build

Content templates define page structure. Each template type has a natural schema mapping. Bind schema types to templates so matrix cells inherit expected schema types.

### Files to modify

- `shared/types/content.ts` — add field to `ContentTemplate`
- `src/components/matrix/types.ts` — mirror
- `server/content-matrices.ts` — inherit on cell creation (optional)
- `src/components/matrix/CellDetailPanel.tsx` — display expected schema badge

### Spec

1. **Add to `ContentTemplate` in `shared/types/content.ts`:**
```typescript
schemaTypes?: string[];  // e.g. ['BlogPosting', 'BreadcrumbList']
```

Mirror in `src/components/matrix/types.ts`.

2. **Create a mapping from template `pageType` to schema types:**

```typescript
// In server/content-matrices.ts or a new server/schema-template-map.ts
import { PAGE_TYPE_SCHEMA_MAP, SchemaPageType } from './schema-suggester.js';

export function getSchemaTypesForTemplate(templatePageType: string): string[] {
  const mapped = PAGE_TYPE_SCHEMA_MAP[templatePageType as SchemaPageType];
  if (!mapped) return [];
  return [...mapped.primary, ...mapped.secondary];
}
```

3. **Auto-populate on template creation:** When a template is created/updated and `schemaTypes` is not explicitly set, auto-populate from the mapping above.

4. **Display in CellDetailPanel.tsx:** In the Content section (after the brief/post buttons, around line 170), add:

```tsx
{/* Expected Schema */}
{cell.expectedSchemaTypes && cell.expectedSchemaTypes.length > 0 && (
  <div className="flex items-center gap-1 flex-wrap">
    <span className="text-[11px] text-zinc-500">Schema:</span>
    {cell.expectedSchemaTypes.map(t => (
      <Badge key={t} label={t} color="purple" />
    ))}
  </div>
)}
```

This requires adding `expectedSchemaTypes?: string[]` to `MatrixCell` in both type files — populated from the template's `schemaTypes` when cells are generated.

### Testing
- Create a template with `pageType: 'blog'` — verify `schemaTypes` auto-populates with `['BlogPosting', 'BreadcrumbList', 'speakable']`.
- Open a matrix cell detail panel — verify schema type badges appear.
- Build verify.

---

## D3: Hub Page → CollectionPage/ItemList Auto-Suggest

**Priority:** Medium
**Est:** 2h
**Depends on:** C1 + C2 (architecture tree in SchemaContext)
**Branch name:** `feat/schema-hub-page`

### What to build

When generating schema for a page that has 2+ children in the architecture tree, automatically suggest `CollectionPage` + `ItemList` schema referencing the children.

### Files to modify

- `server/site-architecture.ts` — add `getChildNodes()` helper
- `server/schema-suggester.ts` — add hub page detection + schema injection

### Spec

1. **Add to `site-architecture.ts`:**
```typescript
export function getChildNodes(tree: SiteNode, parentPath: string): SiteNode[] {
  // Find the node at parentPath, return its direct children that have content
  function find(node: SiteNode): SiteNode | null {
    if (node.path === parentPath) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }
  const parent = find(tree);
  return parent ? parent.children.filter(c => c.hasContent) : [];
}
```

2. **In `injectCrossReferences()` or as a new post-processor in `schema-suggester.ts`:**

After the existing cross-reference injection, if `ctx._architectureTree` and `ctx._pageNode` are available:

```typescript
const children = getChildNodes(ctx._architectureTree, pagePath);
if (children.length >= 2) {
  // Check if CollectionPage or ItemList already exists
  const hasCollection = graph.some(n => n['@type'] === 'CollectionPage' || n['@type'] === 'ItemList');
  if (!hasCollection) {
    graph.push({
      '@type': 'CollectionPage',
      '@id': `${pageUrl}/#collection`,
      'name': webPageNode?.name || 'Collection',
      'hasPart': children.map((child, i) => ({
        '@type': 'ListItem',
        'position': i + 1,
        'url': `${siteUrl}${child.path}`,
        'name': child.name,
      })),
    });
  }
}
```

3. **Only inject for existing pages** (source: 'existing'), not planned pages.

### Testing
- Generate schema for `/services` which has 3+ child service pages → verify `CollectionPage` is added.
- Generate schema for `/about` which has no children → verify no `CollectionPage` added.
- Build verify.

---

## D4: Competitor Schema Intelligence

**Priority:** Medium
**Est:** 4h
**Depends on:** None (can start anytime)
**Branch name:** `feat/competitor-schema-intel`

### What to build

Crawl competitor homepages, extract their JSON-LD schemas, compare against our site's schema coverage, and surface as competitive intelligence.

### Files to create/modify

- **New:** `server/competitor-schema.ts` — crawl + extract + compare logic
- **New:** `server/routes/competitor-schema.ts` — API endpoint
- `server/app.ts` — register new route file
- UI: New card/section in Schema tab or a dedicated sub-section

### Spec

1. **`server/competitor-schema.ts`:**

```typescript
export interface CompetitorSchemaResult {
  domain: string;
  crawledAt: string;
  pages: {
    url: string;
    schemaTypes: string[];
    schemaCount: number;
  }[];
  allTypes: string[];     // Deduplicated list of all schema types found
  typeFrequency: Record<string, number>;  // How many pages use each type
}

export interface SchemaComparison {
  competitorDomain: string;
  typesTheyHaveWeNot: string[];    // Types competitor uses that we don't
  typesWeHaveTheyNot: string[];    // Types we use that competitor doesn't
  sharedTypes: string[];
  ourCoverage: number;             // % of our pages with schema
  theirCoverage: number;           // % of their crawled pages with schema
}

export async function crawlCompetitorSchemas(domain: string, maxPages?: number): Promise<CompetitorSchemaResult>;
export function compareSchemas(ours: string[], theirs: CompetitorSchemaResult): SchemaComparison;
```

2. **Crawl logic:**
   - Fetch homepage + sitemap.xml → extract up to 10 page URLs
   - For each page, fetch HTML, extract JSON-LD using the same regex pattern from `schema-suggester.ts` `extractExistingSchemas()` (lines 584-600)
   - Rate limit: max 2 concurrent fetches, 500ms between requests
   - Timeout: 10s per page
   - Store results as snapshots in workspace data dir (existing snapshot pattern)
   - Cache: 24h TTL — don't re-crawl within 24 hours

3. **API endpoint:**
   ```
   GET /api/competitor-schema/:workspaceId
   → { competitors: CompetitorSchemaResult[], comparisons: SchemaComparison[] }
   ```
   Uses workspace's `competitorDomains` array from workspace config.

4. **Register route** in `server/app.ts` (follow existing pattern — import router, `app.use(router)`).

5. **UI:** A card in the Schema section showing:
   - Per-competitor: types they use, coverage comparison
   - "Opportunities": types competitors have that we don't
   - Use `SectionCard`, `Badge` components

### Testing
- Set a competitor domain in workspace config → verify crawl returns schema types.
- Verify 24h cache prevents re-crawl.
- Build verify.

---

## D5: Sibling/Parent-Child Relationship Enrichment

**Priority:** Medium
**Est:** 3h
**Depends on:** C1 + C2 (architecture tree in SchemaContext)
**Branch name:** `feat/schema-relationship-enrichment`

### What to build

When generating schema for a page, use the architecture tree to add `isPartOf` (→ parent), `relatedLink` (→ siblings), and `hasPart` (→ children) relationships.

### Files to modify

- `server/site-architecture.ts` — add `getParentNode()`, `getSiblingNodes()` helpers
- `server/schema-suggester.ts` — inject relationships in `injectCrossReferences()`

### Spec

1. **Add helpers to `site-architecture.ts`:**

```typescript
export function getParentNode(tree: SiteNode, targetPath: string): SiteNode | null {
  // Walk tree, find the parent of the node at targetPath
}

export function getSiblingNodes(tree: SiteNode, targetPath: string): SiteNode[] {
  // Find parent, return parent.children excluding the target itself
}
```

2. **In `injectCrossReferences()`, when architecture data is available:**

For WebPage nodes:
- Add `isPartOf` → parent page URL (not just WebSite, but the actual parent page)
- Add `relatedLink` → array of sibling page URLs (max 5 siblings to avoid bloat)

For pages with children:
- Add `hasPart` → array of child page references

3. **Only inject when tree data is available.** Graceful no-op otherwise.

4. **Don't override existing values** — only add if the property doesn't already exist on the node.

### Testing
- Generate schema for `/services/seo` → verify `isPartOf` points to `/services`, `relatedLink` includes `/services/web-design`.
- Generate schema for `/services` → verify `hasPart` references child services.
- Generate schema without architecture tree → verify no crash, no change.
- Build verify.

---

## D6: Brief E-E-A-T → Author/Publisher Schema Enrichment

**Priority:** Low
**Est:** 3h
**Depends on:** C1 + C2
**Branch name:** `feat/schema-eeat-enrichment`

### What to build

When a content brief exists for a page (linked via matrix cell `briefId`), extract E-E-A-T data from the brief and pre-populate `author` Person schema nodes.

### Files to modify

- `server/schema-suggester.ts` — add E-E-A-T extraction + injection
- `server/content-briefs.ts` — may need a lightweight brief loader

### Spec

1. **Brief data access:** Content briefs are stored and accessible via `server/content-briefs.ts`. Check the brief structure for E-E-A-T sections. Briefs contain sections like `expertiseSuggestions`, `authorGuidance`, or similar fields within the brief's `sections` array.

2. **Extract author/expertise data from brief:**
```typescript
function extractEeatFromBrief(brief: ContentBrief): {
  authorName?: string;
  authorTitle?: string;
  expertiseTopics?: string[];
} | null {
  // Parse brief sections for E-E-A-T content
  // Look for author recommendations, expertise signals
}
```

3. **Inject into schema generation:**
   - When `ctx._briefId` is set, load the brief
   - If E-E-A-T data extracted, add to the AI prompt: "The content brief recommends the following author credentials: [...]"
   - Also, in post-processing, if an `Article` or `BlogPosting` node exists and has no `author`, pre-populate with extracted data

4. **Add `_briefId?: string` to `SchemaContext`** so it can be passed through.

5. **Graceful degradation:** If no brief exists or no E-E-A-T data found, skip entirely.

### Testing
- Generate schema for a page with a linked brief containing E-E-A-T data → verify author Person node populated.
- Generate schema for a page without a brief → verify no change.
- Build verify.

---

## D7: Planned Page Schema Pre-Generation

**Priority:** Low
**Est:** 4h
**Depends on:** D1, D2 (needs schema type binding)
**Branch name:** `feat/schema-pre-generation`

### What to build

When a matrix cell transitions to `brief_generated` or `approved` status, auto-generate a lightweight schema skeleton (template-based, no AI) and store it. When the cell reaches `published`, the schema is ready to apply.

### Files to create/modify

- **New:** `server/schema-queue.ts` — pending schema storage + skeleton generator
- `server/content-matrices.ts` — trigger pre-generation on status transition
- `server/routes/webflow-schema.ts` — new endpoint for pending schemas
- DB migration if needed for `pending_schemas` table (or use JSON storage)

### Spec

1. **Skeleton generator (no AI needed):**
```typescript
export function generateSchemaSkeleton(cell: MatrixCell, template: ContentTemplate, siteUrl: string): Record<string, unknown> {
  const schemaTypes = cell.expectedSchemaTypes || getSchemaTypesForTemplate(template.pageType);
  // Build JSON-LD @graph with:
  // - WebPage node (url from cell.plannedUrl)
  // - BreadcrumbList (placeholder — will be replaced by C1's deterministic logic on publish)
  // - Primary type node (e.g., BlogPosting with headline from cell.targetKeyword)
  // - Organization reference
  return { '@context': 'https://schema.org', '@graph': [...] };
}
```

2. **Storage:** Create a `pending_schemas` SQLite table:
```sql
CREATE TABLE IF NOT EXISTS pending_schemas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  matrix_id TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'applied' | 'stale'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

3. **Trigger:** In `server/content-matrices.ts` `updateMatrixCell()`, after the status transition logic (where `statusHistory` is recorded), add:
```typescript
if (updates.status === 'brief_generated' || updates.status === 'approved') {
  // Queue schema pre-generation (async, non-blocking)
  void queueSchemaPreGeneration(workspaceId, matrixId, cellId);
}
```

4. **API endpoint:**
```
GET /api/pending-schemas/:workspaceId
→ { pendingSchemas: [{ cellId, plannedUrl, schemaTypes, status, createdAt }] }
```

5. **Mark as applied:** When schema is published to a page (in the existing publish endpoint), check if a pending schema exists for that URL and mark it `applied`.

6. **Mark as stale:** If the cell's keyword or URL changes after pre-generation, mark the pending schema `stale`.

### Testing
- Transition a matrix cell to `brief_generated` → verify pending schema created.
- Check the pending schemas endpoint → verify it returns the skeleton.
- Change the cell's keyword → verify pending schema marked stale.
- Build verify.

---

## General Notes for All Tasks

- **Don't break existing behavior.** Every feature should gracefully degrade when data isn't available (no architecture tree, no brief, no competitors configured).
- **Import paths:** Server imports use `.js` extension (e.g., `import { foo } from './bar.js'`). Shared type imports use `.ts` extension (e.g., `import type { Foo } from '../shared/types/content.ts'`).
- **Logging:** Use `createLogger('module-name')` pattern. Log at `info` level for successful operations, `warn` for recoverable issues, `error` for failures.
- **After each task:** Run `npx tsc --noEmit --skipLibCheck && npx vite build` to verify. Update `FEATURE_AUDIT.md` with a new numbered entry and `data/roadmap.json` with status changes.
- **PR naming:** `feat: D[N] [short description]` (e.g., `feat: D1 page type to schema type mapping`)
