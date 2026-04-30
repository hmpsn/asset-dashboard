# Schema Generator — Workstream A: Webflow Scope Widening

**Date:** 2026-04-30
**Status:** Approved for implementation planning
**Depends on:** Nothing — fully independent
**Unlocks:** PR1 + PR2 enrichments (citation, video, HowTo, images, tables, testimonials) become observable on Webflow sites

---

## Problem

Every PR1 + PR2 extractor scopes to `$('article')`. Webflow's rich-text component renders page content into `<div class="w-richtext">`, not `<article>`. On hmpsn's 28 pages, zero enrichments fire because `$('article').length === 0` on every page.

From the baseline audit:
```
Article.citation[]   0 / 28 pages
VideoObject          0 / 28 pages
HowTo                0 / 28 pages
Review[]             0 / 28 pages
AggregateRating      0 / 28 pages
ImageGallery         0 / 28 pages
Table                0 / 28 pages
```

The PR1 + PR2 extraction code is correct. The scope is too narrow for the target audience's templates.

---

## Design

### Scope hierarchy (priority chain, first match wins)

```
article  →  .w-richtext  →  main
```

Pick the most specific content container present. Using a priority chain — not a union — avoids double-counting when containers nest (e.g. `.w-richtext` inside `<main>`). No deduplication logic needed.

Nav, header, and footer are outside all three containers in standard Webflow layout. No explicit carve-outs are needed for the initial PR.

---

### New shared helper: `server/schema/extractors/page-elements/content-scope.ts`

```typescript
import type * as cheerio from 'cheerio';

/**
 * Returns the best available content container in priority order:
 *   1. <article>       — semantic HTML content container
 *   2. .w-richtext     — Webflow rich-text div (most Webflow templates)
 *   3. <main>          — broad fallback for custom / non-Webflow templates
 *
 * All seven PR1+PR2 extractors import this helper so scope behaviour is
 * consistent. The $listScope in page-elements.ts MUST use the same function
 * to keep itemsByList[] aligned with extractLists() by DOM order.
 */
export function contentScope($: cheerio.CheerioAPI): cheerio.Cheerio<cheerio.Element> {
  if ($('article').length > 0) return $('article');
  if ($('.w-richtext').length > 0) return $('.w-richtext');
  return $('main');
}
```

---

### Per-extractor changes

Each extractor replaces its inline scope selection with `contentScope($)`:

| Extractor | Old scope | New scope |
|-----------|-----------|-----------|
| `citation.ts` | `$('article a[href]')` — no fallback | `contentScope($).find('a[href]')` |
| `testimonials.ts` | `$('article').length > 0 ? $('article blockquote') : $('blockquote')` | `contentScope($).find('blockquote')` |
| `howto.ts` | `$('article').length > 0 ? $('article ol, article ul') : $('ol, ul')` | `contentScope($).find('ol, ul')` |
| `images.ts` | (verify at implementation — expected same `article`-or-fallback pattern) | `contentScope($).find('img')` |
| `tables.ts` | (verify at implementation) | `contentScope($).find('table')` |
| `video.ts` | (verify at implementation) | `contentScope($).find('iframe[src], video')` |

**`citation.ts` specific note:** This is the only extractor with no existing fallback — it previously returned `[]` on any non-`<article>` page. With the helper it now falls back to `<main>` when neither `<article>` nor `.w-richtext` is found. The existing external-link filter (strips internal links, disallows non-http(s) schemes) is unchanged.

### `page-elements.ts` orchestrator

The `$listScope` variable used for AI HowTo disambiguation must stay aligned with `extractLists()` — the comment on line 88 documents this requirement explicitly. Update to use `contentScope`:

```typescript
// OLD (line 90):
const $listScope = $('article').length > 0 ? $('article ol, article ul') : $('ol, ul');

// NEW:
const $scope = contentScope($);
const $listScope = $scope.find('ol, ul');
```

The comment "Scope must match extractLists EXACTLY" remains valid — both now delegate to `contentScope`.

---

## PR scope

**One PR.**

| File | Change |
|------|--------|
| `server/schema/extractors/page-elements/content-scope.ts` | New — shared helper |
| `server/schema/extractors/page-elements/citation.ts` | `contentScope($).find('a[href]')` |
| `server/schema/extractors/page-elements/testimonials.ts` | `contentScope($).find('blockquote')` |
| `server/schema/extractors/page-elements/howto.ts` | `contentScope($).find('ol, ul')` |
| `server/schema/extractors/page-elements/images.ts` | `contentScope($).find('img')` |
| `server/schema/extractors/page-elements/tables.ts` | `contentScope($).find('table')` |
| `server/schema/extractors/page-elements/video.ts` | `contentScope($).find('iframe[src], video')` |
| `server/schema/extractors/page-elements.ts` | `contentScope($)` for `$listScope` |
| `tests/schema/content-scope.test.ts` | New — unit tests for all three scope branches |

Expected diff: ~80 lines. Smallest PR of the four workstreams.

---

## Verification gate

Re-run baseline audit on hmpsn staging after merge. The test is that the extractor scope now **reaches** `.w-richtext` content — not that hmpsn's pages happen to have structured elements inside it.

Verification method: after regenerating hmpsn's schema, check `diagnostics.rawCounts` on at least one blog post or case study page. If `rawCounts` shows non-zero counts for any element type (images, lists, etc.), the scope widening is working. If all counts are still zero, inspect the page HTML to confirm what container the content is actually in — it may be a custom class rather than `.w-richtext`.

Secondary check: `npm run typecheck && npx vite build && npx vitest run` — zero failures.

---

## Implementation planning notes

Follow `docs/PLAN_WRITING_GUIDE.md`. Key constraints from `CLAUDE.md`:

- **Phase-per-PR:** Single PR. No reason to split.
- **No dependencies:** This PR can be dispatched in parallel with C, B, or D-PR1 — it touches only extractor files and the new `content-scope.ts` module. Zero overlap with C (`site-context.ts`, `generator.ts`) or D (`schema-plan.ts`, `schema-suggester.ts`).
- **File ownership:** All files are within `server/schema/extractors/page-elements/`. Single agent, no parallelization needed.
- **Model assignment:** Haiku — mechanical scope substitution + unit tests. No architectural judgment required.
- **`$listScope` alignment:** The implementer must update both `howto.ts` AND the `$listScope` line in `page-elements.ts` in the same commit. A mismatch between the two causes silent data corruption in AI HowTo disambiguation (items from the wrong list get sent to the AI). This is explicitly documented in the `page-elements.ts` comment on line 88.
- **Verify existing tests still pass:** The existing extractor unit tests use HTML fixtures with `<article>` containers. They must continue to pass — `contentScope` must return `$('article')` when `<article>` is present (priority chain: article wins).

---

## What this does NOT include

- Detection of Webflow vs non-Webflow sites (not needed — the priority chain handles both)
- Carve-outs for nav/footer inside `<main>` (not needed for standard Webflow layout; add in a follow-up if false positives appear in practice)
- Widening the FAQ extractor (`extractFaq` in `server/schema/extractors/faq.ts`) — FAQ detection is accordion-based and already uses whole-document scope; no change needed
