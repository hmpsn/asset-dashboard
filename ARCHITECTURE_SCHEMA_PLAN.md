# Architecture → Schema Integration — Cascade Implementation Plan

> **Purpose:** Reference document for Cascade sessions implementing the architecture→schema bridge.
> **Created:** 2026-03-19
> **Status:** Active

---

## Overview

Site Architecture (`server/site-architecture.ts`) builds a rich URL tree with parent-child relationships, page types, planned pages, and gap analysis. The schema generation pipeline (`server/schema-suggester.ts`, `server/schema-plan.ts`) currently operates without any spatial awareness. This plan bridges the two systems.

**Devin handles:** D1–D7 (spec-driven, isolated tasks). See `DEVIN_SCHEMA_SPECS.md`.
**Cascade handles:** C1–C6 (interactive, multi-file, design-heavy tasks) documented below.

---

## Execution Order

```
Phase 1 (Foundation):     C1 + C2       ← Unlock everything else
Phase 2 (Coverage):       C3            ← Schema becomes trackable
Phase 3 (Prioritization): C4 + C5       ← Smart ordering + quick wins
Phase 4 (Intelligence):   C6            ← ROI tracking
```

Devin tasks D1–D7 can run in parallel starting after C1+C2 land.

---

## C1: Deterministic BreadcrumbList from Architecture Tree

**Goal:** Replace the naive URL-segment-guessing breadcrumb in `injectCrossReferences()` with exact breadcrumbs derived from the architecture tree.

**Why first:** BreadcrumbList is the most common schema type. Getting it right deterministically (no AI, no token cost) is a reliability + cost improvement.

### Key Files
- `server/site-architecture.ts` — add `getAncestorChain()` helper
- `server/helpers.ts` — extend `buildSchemaContext()` to optionally load + cache architecture data
- `server/schema-suggester.ts` — use ancestor chain in `injectCrossReferences()` (lines 382-413)

### Implementation Steps

1. **Add `getAncestorChain()` to `site-architecture.ts`:**
   ```typescript
   export function getAncestorChain(tree: SiteNode, targetPath: string): SiteNode[] {
     // Walk tree, return [root, ..., parent, target] or [] if not found
   }
   ```

2. **Add architecture caching to `buildSchemaContext()`:**
   - New optional field on `SchemaContext`: `_architectureTree?: SiteNode`
   - Load architecture result lazily (only when schema generation needs it)
   - Cache per workspace with 10-minute TTL to avoid rebuilding on every page

3. **Replace breadcrumb logic in `injectCrossReferences()`:**
   - Current (lines 382-413): Parses URL, creates 2-item breadcrumb (Home → Page)
   - New: If `ctx._architectureTree` is available, call `getAncestorChain()`, build full BreadcrumbList with correct names from tree nodes
   - Fallback: Keep existing URL-parsing logic when tree is unavailable

4. **Test:** Generate schema for a deep page (e.g., `/services/seo/local-seo`), verify breadcrumb has 4 items with correct names instead of 2.

### Gotchas
- Architecture tree is async (Webflow API + sitemap). Schema generation is also async. Need to ensure we don't add latency — cache the tree.
- CMS pages may not have human-readable names in the tree (derived from URL slugs). Accept this for now; D2 will improve it via templates.
- Don't break existing breadcrumb behavior when architecture data isn't available (new workspace, first run).

### Definition of Done
- [ ] `getAncestorChain()` exported from `site-architecture.ts`
- [ ] `SchemaContext` has optional `_architectureTree` field
- [ ] `buildSchemaContext()` loads architecture tree when available (cached)
- [ ] `injectCrossReferences()` uses tree for breadcrumbs when available, falls back to URL parsing
- [ ] Build passes, no new lint errors introduced
- [ ] FEATURE_AUDIT.md + roadmap updated

---

## C2: Unify Schema Plan with Architecture Tree

**Goal:** Refactor `generateSchemaPlan()` to consume the architecture tree instead of rebuilding its own page inventory.

**Why second:** This eliminates duplicate Webflow API + sitemap calls, includes planned pages in the schema plan, and enables parent-aware role assignment.

### Key Files
- `server/schema-plan.ts` — refactor `generateSchemaPlan()` to accept `SiteArchitectureResult`
- `server/site-architecture.ts` — may need a `flattenTree()` helper
- `server/routes/webflow-schema.ts` — update the schema plan generation endpoint

### Implementation Steps

1. **Add `flattenTree()` to `site-architecture.ts`:**
   ```typescript
   export function flattenTree(tree: SiteNode): SiteNode[] {
     // Returns all nodes as flat array (depth-first)
   }
   ```

2. **Refactor `generateSchemaPlan()` signature:**
   - Current: `generateSchemaPlan(ctx: PlanContext)` — builds its own page list internally
   - New: `generateSchemaPlan(ctx: PlanContext, architecture?: SiteArchitectureResult)`
   - When architecture is provided, skip the internal page discovery (lines 34-86) and use `flattenTree()` instead
   - Map `SiteNode` → `PageListItem` (the format the AI prompt already uses)
   - Enrich the AI prompt with hierarchy context: "Page /services/seo is a child of /services (hub page) and sibling of /services/web-design"

3. **Update the route endpoint:**
   - `server/routes/webflow-schema.ts` — the schema plan generation endpoint should load architecture first, pass it to `generateSchemaPlan()`

4. **Preserve backward compatibility:**
   - When `architecture` param is undefined, fall back to current behavior (rebuild page list internally)
   - This ensures existing schema plan generation works even if architecture hasn't been analyzed yet

### Gotchas
- Schema plan generation is triggered from the admin UI (Schema tab). Need to verify the UX flow still works.
- The AI prompt for schema plan is large. Adding hierarchy context should be concise — just parent/child/sibling paths, not full tree dumps.
- Planned pages (source: 'planned') should be included in the plan but marked as future — the AI should assign roles but note they're not yet published.

### Definition of Done
- [ ] `flattenTree()` exported from `site-architecture.ts`
- [ ] `generateSchemaPlan()` accepts optional `SiteArchitectureResult`
- [ ] When provided, uses tree data instead of re-fetching pages
- [ ] AI prompt includes hierarchy context for each page
- [ ] Planned pages included in plan with future-page annotation
- [ ] Schema plan route loads architecture and passes it through
- [ ] Build passes, existing schema plan generation still works without architecture
- [ ] FEATURE_AUDIT.md + roadmap updated

---

## C3: Schema Coverage Dashboard in SiteArchitecture UI

**Goal:** Add a "Schema Coverage" section to the Site Architecture view showing which pages have schema, which need it, and overall coverage percentage.

### Key Files
- `src/components/SiteArchitecture.tsx` — add coverage section
- `src/api/content.ts` — may need a new API call to get schema snapshot data
- `server/routes/webflow-schema.ts` — may need a lightweight coverage endpoint

### Implementation Steps

1. **Backend: Schema coverage endpoint:**
   ```
   GET /api/webflow/schema-coverage/:siteId
   → { total, withSchema, withoutSchema, coverage%, perPage: [{ path, hasSchema, schemaTypes[], pageType }] }
   ```
   Cross-reference architecture tree with schema snapshot.

2. **Frontend: Coverage section in SiteArchitecture.tsx:**
   - Summary bar: "68% Schema Coverage — 24 of 35 pages"
   - Color-coded badges on tree nodes: ✅ has schema, ⚠️ needs schema, 📋 planned
   - Filter: Show only pages missing schema
   - Stat cards: coverage by page type (services: 5/5, blog: 12/20, locations: 7/10)

3. **Use existing UI primitives:** `SectionCard`, `StatCard`, `Badge`, `EmptyState`

### Definition of Done
- [ ] Coverage endpoint returns per-page schema status
- [ ] SiteArchitecture shows coverage percentage + per-page badges
- [ ] Filter to show only uncovered pages
- [ ] Uses UI primitives (no hand-rolled cards)
- [ ] Build passes
- [ ] FEATURE_AUDIT.md + roadmap updated

---

## C4: Internal Link Health → Schema Priority Queue

**Goal:** Cross-reference internal link health data with schema coverage to create a prioritized "Schema TODO" list.

### Key Files
- `server/internal-links.ts` — read `PageLinkHealth` data
- `server/schema-store.ts` — read schema snapshot
- `server/site-architecture.ts` — read architecture tree
- New: `server/schema-priority.ts` or add to existing module
- UI: section in Schema tab or SiteArchitecture

### Implementation Steps

1. **Priority scoring function:**
   ```typescript
   function computeSchemaPriority(page: { 
     path: string; hasSchema: boolean; linkHealth?: PageLinkHealth; pageType?: string 
   }): { score: number; reason: string; priority: 'critical' | 'high' | 'normal' | 'done' }
   ```
   - Critical: orphan page + no schema
   - High: low inbound links + no schema
   - Normal: good link health + no schema
   - Done: has schema

2. **API endpoint:** `GET /api/schema-priority/:workspaceId`

3. **UI:** Priority queue card showing top 10 pages that need schema most urgently

### Definition of Done
- [ ] Priority scoring function considers link health + schema status
- [ ] API returns sorted priority queue
- [ ] UI surfaces top priorities
- [ ] Build passes
- [ ] FEATURE_AUDIT.md + roadmap updated

---

## C5: SiteNavigationElement Auto-Gen

**Goal:** Auto-generate `SiteNavigationElement` schema for the homepage using top-level children from the architecture tree.

### Key Files
- `server/schema-suggester.ts` — add to `injectCrossReferences()` or new post-processor
- `server/site-architecture.ts` — use depth-1 children

### Implementation Steps

1. **In `injectCrossReferences()`, when processing the homepage:**
   - If architecture tree is available, get depth-1 children
   - Generate `SiteNavigationElement` JSON-LD with `name` + `url` pairs
   - Only add if not already present in the schema

2. **Keep it small:** Just the top-level nav items, not the full tree

### Definition of Done
- [ ] Homepage schema includes `SiteNavigationElement` when tree is available
- [ ] Only top-level children included
- [ ] Doesn't duplicate if already present
- [ ] Build passes
- [ ] FEATURE_AUDIT.md + roadmap updated

---

## C6: Schema Impact Tracking via GSC

**Goal:** After schema is applied to a page, track GSC performance changes (clicks, impressions, CTR) and surface as "Schema ROI."

### Key Files
- `server/seo-change-tracker.ts` — already records schema changes with timestamps
- `server/routes/google.ts` — GSC data endpoints
- New: `server/schema-impact.ts` or section in existing module
- UI: new section in Schema tab

### Implementation Steps

1. **Data correlation:**
   - `recordSeoChange()` already stores: `{ workspaceId, pageId, slug, fields: ['schema'], timestamp }`
   - GSC data already fetched per page: clicks, impressions, CTR, position
   - New function: for each page with a schema change, compare 14-day windows before vs. after

2. **Impact calculation:**
   ```typescript
   interface SchemaImpact {
     pagePath: string;
     schemaTypesApplied: string[];
     appliedAt: string;
     before: { clicks: number; impressions: number; ctr: number; position: number };
     after: { clicks: number; impressions: number; ctr: number; position: number };
     ctrDelta: number;
     clicksDelta: number;
     daysElapsed: number;
   }
   ```

3. **UI:** Impact cards showing before/after comparison per page with trend indicators

### Definition of Done
- [ ] Schema change timestamps correlated with GSC data
- [ ] Before/after comparison for each schema deployment
- [ ] UI shows impact cards with trend indicators
- [ ] Graceful handling when insufficient data (< 14 days, no GSC)
- [ ] Build passes
- [ ] FEATURE_AUDIT.md + roadmap updated

---

## Cross-Cutting Concerns

### Architecture Tree Caching
Multiple features need the architecture tree. Implement a simple in-memory cache:
```typescript
// In site-architecture.ts
const archCache: Map<string, { result: SiteArchitectureResult; ts: number }> = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function getCachedArchitecture(workspaceId: string): Promise<SiteArchitectureResult> {
  const cached = archCache.get(workspaceId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;
  const result = await buildSiteArchitecture(workspaceId);
  archCache.set(workspaceId, { result, ts: Date.now() });
  return result;
}
```

### SchemaContext Extension
Add to `SchemaContext` interface in `schema-suggester.ts`:
```typescript
_architectureTree?: SiteNode;    // Full tree for breadcrumb + nav generation
_pageNode?: SiteNode;            // Current page's node (has parent/siblings)
_ancestors?: SiteNode[];         // Ancestor chain for breadcrumbs
```

### Session Protocol
Each Cascade session working on this plan should:
1. Read this file first
2. Check which tasks are marked done
3. Pick the next undone task in phase order
4. Update checkboxes as tasks complete
5. Update FEATURE_AUDIT.md + roadmap after each task
