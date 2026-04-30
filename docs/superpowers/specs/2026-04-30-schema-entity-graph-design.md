# Schema Generator — Workstream C: Entity Graph

**Date:** 2026-04-30
**Status:** Approved for implementation planning
**Depends on:** Nothing — fully independent
**Unlocks:** Workstream D (Site Plan wiring) can extend `SiteContext` rather than thread a separate data structure

---

## Problem

Every page is generated in isolation. `generateLeanSchema` has no awareness of other pages on the site, so hub pages (`/services`, `/insights`, `/our-work`) cannot reference their children. Three CollectionPage emissions on hmpsn's site produce no entity cross-references and earn zero hub-specific rich-result eligibility.

From the baseline audit:
- `/services` emits CollectionPage + BreadcrumbList. No reference to `/services/design`, `/services/strategy`, or `/services/development`.
- `/our-work` emits CollectionPage + BreadcrumbList. No reference to 4 Article children.
- `/insights` emits CollectionPage + BreadcrumbList. No reference to 5 BlogPosting children.

---

## Architecture

### New module: `server/schema/site-context.ts`

Pure function module. No async, no DB calls, no AI. Takes the already-loaded page list from the orchestrator and produces a cross-page map.

```typescript
import type { WorkspacePage } from '../workspace-data.js';
import type { CanonicalEntity } from '../../shared/types/schema-plan.ts';
import { classifyPage } from './classifier.js';

export interface SiteContextPage {
  path: string;           // '/services/design'
  url: string;            // 'https://hmpsn.studio/services/design'
  kind: PageKind;         // 'Service'
  primaryType: string;    // 'Service'
  id: string;             // 'https://hmpsn.studio/services/design#service'
  parentPath: string | null;
  childPaths: string[];
}

export interface SiteContext {
  pages: SiteContextPage[];
  canonicalEntities: CanonicalEntity[];  // from Site Plan if present; [] otherwise
}

export function assembleSiteContext(
  pages: WorkspacePage[],
  baseUrl: string,
  canonicalEntities: CanonicalEntity[] = [],
): SiteContext { ... }
```

**`@id` suffix by kind:**

| Kind | `@id` suffix | Note |
|------|-------------|------|
| Service | `#service` | |
| BlogPosting | `#blogposting` | |
| Article | `#article` | |
| CaseStudy | `#article` | CaseStudy pages emit `Article` @type; suffix matches |
| BlogIndex | `#blog` | |
| ServiceIndex | `#service` | Hub is itself a Service node |
| CaseStudyIndex | `#webpage` | No dedicated portfolio @type in Schema.org |
| Everything else | `#webpage` | |

### Hub-detection rule

A page `P` is a hub if there exists at least one other page `C` such that:

1. `C.path.startsWith(P.path + '/')` — C is a URL-path child of P
2. `C.kind` is one of: `Service`, `BlogPosting`, `Article`, `CaseStudy` — C is content-rich

This derives entirely from the page list + classifier. No Site Plan required. Pages classified as `WebPage` (Calendly booking pages, error pages, privacy policy) are skipped as child candidates automatically — the classifier already returns `WebPage` for `/schedule/15min`, `/401`, `/404`, etc.

Workstream D will later extend this by reading `pageRoles` from the Site Plan and overriding or augmenting the URL-classifier-derived parent/child relationships.

### `LeanGeneratorInput` change

```typescript
export interface LeanGeneratorInput {
  // ... existing fields unchanged ...

  /**
   * Optional cross-page context assembled once per regenerate-all run.
   * When absent, generator behaves exactly as before (no hub enrichment).
   * Workstream D will extend SiteContext with role/exclusion fields.
   */
  siteContext?: SiteContext;
}
```

Optional so existing callers (unit tests, `generateCmsTemplateSchema`) require no changes.

---

## Template changes

### 1. `ServiceIndex` → `Service + OfferCatalog`

Replaces the `buildCollectionPageSchema` dispatch for `ServiceIndex` kind. The hub page becomes a `Service` node that wraps its child services via `hasOfferCatalog`.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": "https://hmpsn.studio/services#service",
      "name": "Web Design & Development Services",
      "url": "https://hmpsn.studio/services",
      "description": "...",
      "provider": { "@id": "https://hmpsn.studio/#organization" },
      "hasOfferCatalog": {
        "@type": "OfferCatalog",
        "name": "Services",
        "hasPart": [
          { "@id": "https://hmpsn.studio/services/design#service" },
          { "@id": "https://hmpsn.studio/services/strategy#service" },
          { "@id": "https://hmpsn.studio/services/development#service" }
        ]
      }
    },
    { "@type": "BreadcrumbList", ... }
  ]
}
```

When `siteContext` is absent, falls back to the existing `buildCollectionPageSchema` output (no child refs).

### 2. `BlogIndex` → `Blog + blogPost[]`

Replaces the `buildCollectionPageSchema` dispatch for `BlogIndex` kind.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Blog",
      "@id": "https://hmpsn.studio/insights#blog",
      "name": "Insights",
      "url": "https://hmpsn.studio/insights",
      "publisher": { "@id": "https://hmpsn.studio/#organization" },
      "inLanguage": "en",
      "numberOfItems": 5,
      "blogPost": [
        { "@id": "https://hmpsn.studio/insights/how-i-built-it#blogposting" },
        { "@id": "https://hmpsn.studio/insights/goodshuffle-pro#blogposting" },
        ...up to 10 most-recent
      ]
    },
    { "@type": "BreadcrumbList", ... }
  ]
}
```

**Child ordering:** sort by `lastPublished` desc (from `WorkspacePage`). Pages with null `lastPublished` sort after pages with a date; among null-date pages, sort by path alpha. Cap at 10. Emit `numberOfItems` with true total so Google knows the full count.

When `siteContext` is absent, falls back to existing `buildCollectionPageSchema` output.

### 3. `CaseStudyIndex` → `CollectionPage + ItemList`

Same `@type` (`CollectionPage`), enriched with `mainEntity: ItemList`. No cap needed — case study hubs are bounded at ≤10 on any real site.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": "https://hmpsn.studio/our-work#webpage",
      "url": "https://hmpsn.studio/our-work",
      "name": "Our Work",
      "mainEntity": {
        "@type": "ItemList",
        "numberOfItems": 4,
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "item": { "@id": "https://hmpsn.studio/our-work/expero#article" } },
          { "@type": "ListItem", "position": 2, "item": { "@id": "https://hmpsn.studio/our-work/swish-dental#article" } },
          { "@type": "ListItem", "position": 3, "item": { "@id": "https://hmpsn.studio/our-work/thumbtack-careers-site#article" } },
          { "@type": "ListItem", "position": 4, "item": { "@id": "https://hmpsn.studio/our-work/retirement-resources#article" } }
        ]
      }
    },
    { "@type": "BreadcrumbList", ... }
  ]
}
```

When `siteContext` is absent, falls back to existing `buildCollectionPageSchema` output.

---

## Orchestrator changes

### `generateSchemaSuggestions` (batch regeneration)

```typescript
// After: const pages = wsId ? await getWorkspacePages(wsId, siteId) : [];
// Add:
const siteContext = pages.length > 0
  ? assembleSiteContext(pages, baseUrl, getSchemaPlan(siteId)?.canonicalEntities ?? [])
  : undefined;

// Then thread into each generateLeanSchema call:
const lean = await generateLeanSchema({
  ...existingFields,
  siteContext,
});
```

`assembleSiteContext` is a pure synchronous function — one call per regenerate-all run, no performance cost.

### `generateSchemaForPage` (single-page regeneration)

`getWorkspacePages` is already called in this function for publishedPath resolution (Fix 6). Pass those pages into `assembleSiteContext` before the `generateLeanSchema` call. Single-page regeneration preserves hub refs and stays consistent with batch regeneration.

---

## Validator additions

Add to `REQUIRED_BY_TYPE` in `server/schema/validator.ts`:

| Type | Required fields |
|------|----------------|
| `Blog` | `name`, `url`, `publisher` |
| `OfferCatalog` | `name` |
| `ItemList` | `itemListElement` (when present, must be non-empty array) |

No breaking changes to existing validated types.

---

## PR scope

**One PR.** Touches:

| File | Change |
|------|--------|
| `server/schema/site-context.ts` | New — assembler + types (`SiteContext`, `SiteContextPage` live here; backend-only, not in `shared/types/`) |
| `server/schema/generator.ts` | Add `siteContext?: SiteContext` to `LeanGeneratorInput`; branch hub dispatch |
| `server/schema/templates/static.ts` | New `buildBlogSchema`, `buildServiceHubSchema` templates; enrich `buildCollectionPageSchema` |
| `server/schema/validator.ts` | Add `Blog`, `OfferCatalog`, `ItemList` entries |
| `server/schema-suggester.ts` | Thread `siteContext` in both `generateSchemaSuggestions` and `generateSchemaForPage` |
| `tests/schema/site-context.test.ts` | New — unit tests for `assembleSiteContext` hub detection |
| `tests/integration/schema-entity-graph.test.ts` | New — integration assertions on hmpsn's three hub pages |

Expected diff: ~400 lines.

---

## Verification gate

Re-run baseline audit against staging after merge. Pass criteria:

- `/services` snapshot emits `Service` with `hasOfferCatalog.hasPart` containing exactly 3 `@id` refs matching `/services/design`, `/services/strategy`, `/services/development`
- `/insights` snapshot emits `Blog` with `blogPost` array containing 5 `@id` refs (all current posts) + `numberOfItems: 5`
- `/our-work` snapshot emits `CollectionPage` with `mainEntity.itemListElement` containing 4 `ListItem` entries
- All 28 pages still pass validator (zero new errors introduced)
- `npm run typecheck && npx vite build && npx vitest run` — zero failures

---

## Implementation planning notes

The implementation plan for this spec must follow `docs/PLAN_WRITING_GUIDE.md`. Key constraints from `CLAUDE.md` that apply:

- **Phase-per-PR:** this spec is one PR. Do not split hub-detection from template changes.
- **Pre-commit shared contracts:** `SiteContext` / `SiteContextPage` types and `LeanGeneratorInput.siteContext` field must be committed before any parallel agent starts template work.
- **File ownership:** `site-context.ts` (new), `generator.ts` (threading), `templates/static.ts` (new templates), `validator.ts` (new entries), `schema-suggester.ts` (orchestrator wiring) — assign exclusive ownership per agent if parallelized.
- **Model assignments:** `assembleSiteContext` pure function + unit tests → Haiku; template branching + integration tests → Sonnet.
- **Verification:** `npm run typecheck && npx vite build && npx vitest run` must pass. Re-run baseline audit script against staging as the functional gate (not just type-checking).
- **Data flow rule:** after mutation, `broadcastToWorkspace` + `useWorkspaceEvents` cache invalidation are already handled by the existing schema snapshot save path — no new wiring needed.

---

## What this does NOT include

- Sub-service back-references to hub via `isPartOf` — deferred to Workstream D or a follow-up
- Role-driven hub detection (Site Plan as source of truth) — Workstream D
- Page exclusion filter (`/schedule/*`, error pages) — Workstream D
- LocalBusiness as `provider` on sub-service pages — Workstream B
