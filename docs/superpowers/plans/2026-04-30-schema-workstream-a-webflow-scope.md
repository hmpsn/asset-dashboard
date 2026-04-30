# Schema Workstream A — Webflow Scope Widening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `contentScope($)` helper (article → .w-richtext → main, first match wins) and update all 7 PR1+PR2 extractors plus the `$listScope` line in the page-elements orchestrator to use it, so enrichments fire on Webflow `.w-richtext` pages.

**Architecture:** One new pure-function module (`content-scope.ts`) is committed first; the 7 extractor updates and the orchestrator update are then independent parallel changes with no file overlap. No new API routes, no DB changes, no frontend changes.

**Tech Stack:** TypeScript, cheerio, vitest

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-30-schema-webflow-scope-widening-design.md`
- [x] No pre-plan audit required — spec enumerates all 7 affected extractors from direct code reading

---

## Task Dependencies

```
Task 1 (content-scope.ts + tests)
  ↓
Tasks 2–8 can run in parallel (each owns one file, no overlap):
  Task 2 (citation.ts)
  Task 3 (testimonials.ts)
  Task 4 (howto.ts)
  Task 5 (images.ts)
  Task 6 (tables.ts)
  Task 7 (video.ts)
  Task 8 (page-elements.ts $listScope)
  ↓
Task 9 (verification)
```

---

## Task 1 — Create `content-scope.ts` helper + unit tests (Model: haiku)

**Owns:**
- Create: `server/schema/extractors/page-elements/content-scope.ts`
- Create: `tests/unit/schema/extractors/content-scope.test.ts`

**Must not touch:** any extractor file — those are Tasks 2–8.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schema/extractors/content-scope.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { contentScope } from '../../../../server/schema/extractors/page-elements/content-scope.js';

describe('contentScope', () => {
  it('returns <article> when present (priority 1)', () => {
    const $ = cheerio.load('<article><p>Content</p></article><main><p>Main</p></main>');
    const $scope = contentScope($);
    expect($scope.is('article')).toBe(true);
  });

  it('returns .w-richtext when no <article> present (priority 2)', () => {
    const $ = cheerio.load('<div class="w-richtext"><p>Content</p></div><main><p>Main</p></main>');
    const $scope = contentScope($);
    expect($scope.hasClass('w-richtext')).toBe(true);
  });

  it('returns <main> when neither <article> nor .w-richtext present (priority 3)', () => {
    const $ = cheerio.load('<main><p>Content</p></main>');
    const $scope = contentScope($);
    expect($scope.is('main')).toBe(true);
  });

  it('returns <main> when page has no recognised container', () => {
    const $ = cheerio.load('<body><p>Just a paragraph</p></body>');
    const $scope = contentScope($);
    expect($scope.is('main')).toBe(true);
  });

  it('<article> wins over .w-richtext when both present (no double-counting)', () => {
    const $ = cheerio.load('<article><div class="w-richtext"><p>Text</p></div></article>');
    const $scope = contentScope($);
    expect($scope.is('article')).toBe(true);
  });

  it('returned scope can .find() descendants', () => {
    const $ = cheerio.load('<div class="w-richtext"><a href="https://external.com">Link</a></div>');
    const $scope = contentScope($);
    expect($scope.find('a[href]').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard/.claude/worktrees/schema-v2-brainstorm
npx vitest run tests/unit/schema/extractors/content-scope.test.ts
```

Expected: FAIL — `contentScope` module not found.

- [ ] **Step 3: Create the helper**

Create `server/schema/extractors/page-elements/content-scope.ts`:

```typescript
import type * as cheerio from 'cheerio';

/**
 * Returns the best available content container in priority order:
 *   1. <article>       — semantic HTML content container
 *   2. .w-richtext     — Webflow rich-text div (most Webflow templates)
 *   3. <main>          — broad fallback for custom / non-Webflow templates
 *
 * Uses first-match-wins so containers don't nest and double-count.
 * All seven PR1+PR2 extractors and $listScope in page-elements.ts import
 * this helper to keep scope behaviour consistent across the pipeline.
 */
export function contentScope($: cheerio.CheerioAPI): cheerio.Cheerio<cheerio.Element> {
  if ($('article').length > 0) return $('article');
  if ($('.w-richtext').length > 0) return $('.w-richtext');
  return $('main');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/schema/extractors/content-scope.test.ts
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/schema/extractors/page-elements/content-scope.ts \
        tests/unit/schema/extractors/content-scope.test.ts
git commit -m "feat(schema): add contentScope helper — article→.w-richtext→main priority chain"
```

---

## Task 2 — Update `citation.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements/citation.ts`

**Must not touch:** any other extractor, content-scope.ts (created in Task 1), test files.

- [ ] **Step 1: Read the existing test to understand the fixture**

The existing test at `tests/unit/schema/extractors/page-elements-citation.test.ts` has two cases:
- `webflow-blog-with-citations.html` (article-scoped) — must still pass
- inline HTML with no `<article>` — currently expects empty `[]`; after this change it will fall back to `<main>` and may find links. **The test expects `[]` and must remain correct.** The inline HTML `<body><p>Just text. <a href="https://external.com">Link</a></p></body>` has no `<main>`, so `contentScope` returns `$('main')` which is empty — `find('a[href]')` on an empty set returns zero results. **The test passes unchanged.**

- [ ] **Step 2: Update `citation.ts`**

In `server/schema/extractors/page-elements/citation.ts`:

Replace the import block (top of file) — add the contentScope import after the existing imports:

```typescript
import type * as cheerio from 'cheerio';
import type { Citation } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';
```

Replace line 35:
```typescript
// OLD:
  $('article a[href]').each((_, el) => {
```
```typescript
// NEW:
  contentScope($).find('a[href]').each((_, el) => {
```

Also update the JSDoc comment on line 34 from `// Restrict to <article> scope` to:
```typescript
  // Restrict to content scope (article → .w-richtext → main)
```

- [ ] **Step 3: Run existing tests**

```bash
npx vitest run tests/unit/schema/extractors/page-elements-citation.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/schema/extractors/page-elements/citation.ts
git commit -m "feat(schema): citation extractor — use contentScope for .w-richtext support"
```

---

## Task 3 — Update `testimonials.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements/testimonials.ts`

**Must not touch:** any other extractor file.

- [ ] **Step 1: Update `testimonials.ts`**

Replace the import block — add contentScope after existing imports:

```typescript
import type * as cheerio from 'cheerio';
import type { Testimonial } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';
```

Replace line 38:
```typescript
// OLD:
  const $scope = $('article').length > 0 ? $('article blockquote') : $('blockquote');
```
```typescript
// NEW:
  const $scope = contentScope($).find('blockquote');
```

- [ ] **Step 2: Run existing tests**

```bash
npx vitest run tests/unit/schema/extractors/page-elements-testimonials.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/schema/extractors/page-elements/testimonials.ts
git commit -m "feat(schema): testimonials extractor — use contentScope for .w-richtext support"
```

---

## Task 4 — Update `howto.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements/howto.ts`

**Must not touch:** `page-elements.ts` — that is Task 8.

- [ ] **Step 1: Update `howto.ts`**

Add import after existing imports:

```typescript
import type * as cheerio from 'cheerio';
import type { PageList, HowToStep } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';
```

Replace line 47 in `extractLists`:
```typescript
// OLD:
  const $scope = $('article').length > 0 ? $('article ol, article ul') : $('ol, ul');
```
```typescript
// NEW:
  const $scope = contentScope($).find('ol, ul');
```

Also update the comment above (lines 43–46) from its `<article>` wording to:
```typescript
  // Scope to content container (article → .w-richtext → main) to keep
  // navigational/footer lists out of diagnostics and HowTo candidates.
```

- [ ] **Step 2: Run existing tests**

```bash
npx vitest run tests/unit/schema/extractors/page-elements-howto.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/schema/extractors/page-elements/howto.ts
git commit -m "feat(schema): howto extractor — use contentScope for .w-richtext support"
```

---

## Task 5 — Update `images.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements/images.ts`

**Must not touch:** any other extractor file.

**Note:** `images.ts` is slightly more complex. The private helper `isBeforeFirstTextBlock` takes `scopeSel: string` and uses it as `$(scopeSel).find(...)`. This must be updated to accept a Cheerio object instead, since `contentScope` returns a Cheerio object, not a CSS selector string.

- [ ] **Step 1: Update `images.ts`**

Add import after existing imports:

```typescript
import type * as cheerio from 'cheerio';
import type { PageImage } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';
```

Replace the `isBeforeFirstTextBlock` function signature and body (lines 62–75). Change from accepting `scopeSel: string` to accepting `$scopeEl: cheerio.Cheerio<cheerio.Element>`:

```typescript
function isBeforeFirstTextBlock(
  $scopeEl: cheerio.Cheerio<cheerio.Element>,
  imgEl: { tagName: string },
): boolean {
  const allTextBlocks = $scopeEl.find('h1,h2,h3,h4,h5,h6,p');
  if (allTextBlocks.length === 0) return true;
  let hitImage = false;
  let hitText = false;
  $scopeEl.find('*').each((_, el) => {
    if (hitImage || hitText) return false; // early exit
    if (el === imgEl) { hitImage = true; return false; }
    const tag = el.tagName?.toLowerCase() ?? '';
    if (/^h[1-6]$/.test(tag) || tag === 'p') { hitText = true; return false; }
  });
  return hitImage && !hitText;
}
```

Replace lines 78–81 in `extractImages`:
```typescript
// OLD:
  const hasArticle = $('article').length > 0;
  const scopeSel = hasArticle ? 'article' : 'body';
  const $scope = hasArticle ? $('article img') : $('img');
```
```typescript
// NEW:
  const $contentScope = contentScope($);
  const $scope = $contentScope.find('img');
```

Replace the call to `isBeforeFirstTextBlock` on line 103:
```typescript
// OLD:
    const isLeadPosition = images.length === 0 && isBeforeFirstTextBlock($, scopeSel, el);
```
```typescript
// NEW:
    const isLeadPosition = images.length === 0 && isBeforeFirstTextBlock($contentScope, el);
```

Also update the file-level JSDoc comment on line 16 from `Scoped to <article> with whole-document fallback` to:
```
 * Scoped to content container (article → .w-richtext → main, first match wins).
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. The `$` parameter is removed from `isBeforeFirstTextBlock`; TypeScript will catch any missed call sites.

- [ ] **Step 3: Run existing tests**

```bash
npx vitest run tests/unit/schema/extractors/page-elements-images.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/schema/extractors/page-elements/images.ts
git commit -m "feat(schema): images extractor — use contentScope, refactor isBeforeFirstTextBlock"
```

---

## Task 6 — Update `tables.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements/tables.ts`

**Must not touch:** any other extractor file.

- [ ] **Step 1: Update `tables.ts`**

Add import after existing imports:

```typescript
import type * as cheerio from 'cheerio';
import type { Table } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';
```

Replace line 23:
```typescript
// OLD:
  const $scope = $('article').length > 0 ? $('article table') : $('table');
```
```typescript
// NEW:
  const $scope = contentScope($).find('table');
```

Update the comment on line 22:
```typescript
  // Scope: content container first (article → .w-richtext → main); fall back to main.
```

- [ ] **Step 2: Run existing tests**

```bash
npx vitest run tests/unit/schema/extractors/page-elements-tables.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/schema/extractors/page-elements/tables.ts
git commit -m "feat(schema): tables extractor — use contentScope for .w-richtext support"
```

---

## Task 7 — Update `video.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements/video.ts`

**Must not touch:** any other extractor file.

**Note:** `video.ts` currently queries the whole document (`$('iframe[src]')`, `$('video')`). It has no existing `<article>` scoping — this task adds content scope for the first time.

- [ ] **Step 1: Update `video.ts`**

Add import after existing imports:

```typescript
import type * as cheerio from 'cheerio';
import type { Video } from '../../../../shared/types/page-elements.js';
import { contentScope } from './content-scope.js';
```

In `extractVideos`, add `const $scope = contentScope($);` as the first line of the function body, then replace the two `.each()` calls:

```typescript
export function extractVideos($: cheerio.CheerioAPI): Video[] {
  const videos: Video[] = [];
  const $scope = contentScope($);

  // iframe-based: YouTube + Vimeo
  $scope.find('iframe[src]').each((_, el) => {
    const $el = $(el);
    // ... rest of body unchanged
  });

  // Native <video>
  $scope.find('video').each((_, el) => {
    const $el = $(el);
    // ... rest of body unchanged
  });

  return videos;
}
```

The internals of each `.each()` callback are **unchanged** — only `$('iframe[src]')` → `$scope.find('iframe[src]')` and `$('video')` → `$scope.find('video')`.

- [ ] **Step 2: Run existing tests**

```bash
npx vitest run tests/unit/schema/extractors/page-elements-video.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/schema/extractors/page-elements/video.ts
git commit -m "feat(schema): video extractor — use contentScope for .w-richtext support"
```

---

## Task 8 — Update `$listScope` in `page-elements.ts` (Model: haiku)

**Owns:** `server/schema/extractors/page-elements.ts`

**Must not touch:** any extractor file under `page-elements/`.

**Critical:** The `$listScope` variable on line 90 must stay aligned with `extractLists()` from `howto.ts` (both now delegate to `contentScope`). The comment on lines 85–89 documents this contract. Do not remove or alter the comment.

- [ ] **Step 1: Update `page-elements.ts`**

Add import at the top of the file, with the other extractor imports:

```typescript
import { contentScope } from './page-elements/content-scope.js';
```

Replace lines 90:
```typescript
// OLD:
    const $listScope = $('article').length > 0 ? $('article ol, article ul') : $('ol, ul');
```
```typescript
// NEW:
    const $scope = contentScope($);
    const $listScope = $scope.find('ol, ul');
```

The comment block on lines 85–89 remains exactly as-is (it still correctly documents the alignment requirement; update only the last sentence to reflect that both now use `contentScope`):
```typescript
    // Capture parallel raw item text for AI disambiguation (PR2).
    // Scope must match extractLists EXACTLY — both now delegate to contentScope($)
    // so the resulting itemsByList[i] is aligned with lists[i] by DOM order.
    // The disambiguator slices itemsByList[i] per list — a flat concat would
    // silently send list-0's items as the prompt for every subsequent list
    // (review-caught data corruption bug).
```

- [ ] **Step 2: Run full extractor test suite**

```bash
npx vitest run tests/unit/schema/extractors/
```

Expected: all tests pass (including `page-elements-entry.test.ts`).

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add server/schema/extractors/page-elements.ts
git commit -m "feat(schema): page-elements $listScope — align with contentScope (howto.ts parity)"
```

---

## Task 9 — Verification (Model: haiku)

**Owns:** nothing — read-only verification pass.

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: zero failures. All pre-existing extractor tests must pass (`page-elements-citation`, `page-elements-testimonials`, `page-elements-howto`, `page-elements-images`, `page-elements-tables`, `page-elements-video`, `content-scope`).

- [ ] **Step 2: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 3: Confirm `$listScope` alignment in page-elements.ts**

```bash
grep -n "contentScope\|listScope\|extractLists" server/schema/extractors/page-elements.ts
```

Expected output should show:
- `contentScope` import at top
- `const $scope = contentScope($);` before `$listScope`
- `const $listScope = $scope.find('ol, ul');`
- `extractLists` still called with `$` (its own internal call to `contentScope` handles scope)

- [ ] **Step 4: Confirm all 7 extractors import contentScope**

```bash
grep -l "contentScope" server/schema/extractors/page-elements/*.ts
```

Expected: 7 files — `citation.ts`, `testimonials.ts`, `howto.ts`, `images.ts`, `tables.ts`, `video.ts`, `content-scope.ts` (the module itself, exporting).

- [ ] **Step 5: Confirm existing tests still pass with `<article>` fixtures**

The citation extractor test uses `webflow-blog-with-citations.html` which contains `<article>`. Verify `contentScope` returns `$('article')` for that fixture (covered by `content-scope.test.ts` priority-1 case). No new fixture needed — the priority chain guarantees backward compatibility.

---

## Systemic Improvements

- **Shared utility extracted:** `contentScope` is the shared utility this workstream introduces. All future extractors should import from `./content-scope.js` rather than inline scope logic.
- **pr-check rule to add:** After this PR, consider adding a pr-check rule that warns when a new extractor file in `page-elements/` uses `$('article')` directly without going through `contentScope`. This prevents regressions when new extractors are added. (Non-blocking — file as a roadmap item.)
- **New tests added:** `tests/unit/schema/extractors/content-scope.test.ts` — 6 cases covering all three priority branches.

## Verification Strategy

- `npx vitest run tests/unit/schema/extractors/` — all extractor tests green
- `npm run typecheck && npx vite build` — zero errors
- `npx tsx scripts/pr-check.ts` — zero violations
- Staging re-run of baseline audit: check `diagnostics.rawCounts` on at least one blog post page. If `.w-richtext` is present and contains images/links, expect non-zero counts.
