# Webflow Nested Page Path Hardening — Implementation Plan

## Overview

Webflow stores `slug` as only the final URL segment for nested pages (e.g., `slug: "seo"` for `/services/seo`). The full path lives in `publishedPath`. Across the codebase, 15+ locations construct `pagePaths` as `` `/${page.slug}` `` instead of calling `resolvePagePath()` (which prefers `publishedPath`). This causes nested pages to lose keyword analysis data, persist entries under wrong paths, and match GSC data incorrectly. Two additional bugs are bundled: (1) the webflow-seo.ts bulk analyze path never calls `applyBulkKeywordGuards`, persisting AI-hallucinated keyword metrics; (2) GSC query filtering uses `.includes(page.slug)` substring matching, producing false positives for pages whose slugs appear in unrelated paths.

**Bugs fixed:**
- BUG-0001: `matchPagePath(entry.pagePath, p.slug)` in SeoEditor fails for nested pages — keyword map data invisible
- BUG-0002: SeoEditor persist call stores `/seo` instead of `/services/seo` — DB fragmentation
- BUG-0003: `applyBulkKeywordGuards` not called in webflow-seo.ts bulk analyze — hallucinated metrics persisted
- BUG-0004: GSC `.includes(page.slug)` false-positive — wrong pages get GSC traffic data
- BUG-0005: `aeo-review.ts` issueMap keyed by `p.slug` without normalization — nested page issues silently missed
- BUG-0006: `SeoAudit.tsx` trafficMap lookup uses `` `/${page.slug}` `` — nested pages always show zero traffic
- BUG-0007: `KeywordAnalysis.tsx` persist path uses bare slug — same fragmentation as BUG-0002
- BUG-0008: Multiple server routes (webflow-seo.ts, jobs.ts, webflow-keywords.ts, schema-plan.ts, admin-chat-context.ts) construct pagePaths from bare slug

## Pre-requisites

- [ ] This plan committed to `docs/superpowers/plans/`
- [ ] Worktree created from `staging` (post-PR-#244 merge)
- [ ] No pre-plan audit needed — all affected sites identified in Explore agent run (2026-04-21)

---

## Task 1 — Move `applyBulkKeywordGuards` to shared helpers (Model: haiku)

**Sequential prerequisite — must complete and commit before Tasks 2–5 start.**

**Owns:**
- `server/helpers.ts`
- `server/routes/jobs.ts`

**Must not touch:** any other file.

**Steps:**

1. In `server/helpers.ts`, add the exported function after the existing `resolvePagePath` export:
   ```typescript
   /**
    * Zero out AI-hallucinated keyword metrics when no SEMRush data was available.
    * Call after JSON.parse of any AI keyword analysis response.
    */
   export function applyBulkKeywordGuards(
     analysis: Record<string, unknown>,
     semrushBlock: string,
   ): void {
     if (!semrushBlock) {
       analysis.keywordDifficulty = 0;
       analysis.monthlyVolume = 0;
     }
   }
   ```

2. In `server/routes/jobs.ts`, remove the local `applyBulkKeywordGuards` definition (lines 906–914) and add an import from `../helpers.js` alongside existing helpers imports. Verify the function is no longer exported from `jobs.ts` (no other file imports it from there).

3. Run `npm run typecheck` — zero errors expected.

---

## Task 2 — Fix `server/routes/webflow-seo.ts` (Model: sonnet)

**Parallel with Tasks 3 and 4. Start only after Task 1 is committed.**

**Owns:**
- `server/routes/webflow-seo.ts`

**Must not touch:** any other file.

**Steps:**

1. Add `applyBulkKeywordGuards` to the import from `../helpers.js` (already imports `resolvePagePath` — add alongside it).

2. **BUG-0003** — At the bulk analyze path (~line 1316), immediately after `analysis = JSON.parse(cleaned)`, add:
   ```typescript
   applyBulkKeywordGuards(analysis, ''); // no SEMRush data in bulk analyze path
   ```

3. **BUG-0008 — bare slug pagePath constructions** — Replace all occurrences of `` page.slug ? `/${page.slug}` : undefined `` and `` page.slug ? `/${page.slug}` : '/' `` with `resolvePagePath(page)`. Confirmed locations:
   - Line 562 (bulk SEO fix): `const bulkPagePath = page.slug ? \`/${page.slug}\` : undefined;`
   - Line 769 (rewrite chat): `const rwPagePath = page.slug ? \`/${page.slug}\` : undefined;`
   - Line 1336 (single page review): `const pagePath = page.slug ? \`/${page.slug}\` : '/';`
   - Line 1516 (second rewrite chat): `const rwPagePath = page.slug ? \`/${page.slug}\` : undefined;`

   Use `resolvePagePath(page) || undefined` where the original could be `undefined`, and plain `resolvePagePath(page)` where the original defaulted to `'/'`.

4. **BUG-0004 — GSC `.includes()` false-positive** — At lines 800–803 and 1542–1546, replace:
   ```typescript
   .filter(r => r.page.includes(page.slug!) || (page.slug === '' && r.page.endsWith('/')))
   ```
   with path-boundary-aware matching:
   ```typescript
   .filter(r => {
     const resolved = resolvePagePath(page);
     const rPath = r.page.startsWith('/') ? r.page : `/${r.page}`;
     return resolved === '/'
       ? rPath === '/' || rPath === ''
       : rPath === resolved || rPath.startsWith(resolved + '/');
   })
   ```

5. Run `npm run typecheck` on the file — zero errors.

---

## Task 3 — Fix frontend components (Model: sonnet)

**Parallel with Tasks 2 and 4. Start only after Task 1 is committed.**

**Owns:**
- `src/components/SeoEditor.tsx`
- `src/components/KeywordAnalysis.tsx`
- `src/components/SeoAudit.tsx`

**Must not touch:** any other file.

**Steps:**

### SeoEditor.tsx

1. Add `resolvePagePath` to imports from `'../lib/pathUtils'` (check existing imports first with `grep -n "^import" src/components/SeoEditor.tsx`).

2. **BUG-0001** — Lines 445 and 458: Replace `matchPagePath(entry.pagePath, p.slug)` with `matchPagePath(entry.pagePath, resolvePagePath(p))`. The `p` here is a Webflow page object with `publishedPath` and `slug`. `resolvePagePath` produces the correct full path to compare against the stored strategy `pagePath`.

3. **BUG-0002** — Line 489 (persist keyword analysis): Replace:
   ```typescript
   pagePath: `/${page.slug || ''}`,
   ```
   with:
   ```typescript
   pagePath: resolvePagePath(page),
   ```

4. **Line 407** (AI rewrite request pagePath): Replace `` pagePath: `/${page.slug || ''}` `` with `pagePath: resolvePagePath(page)`.

### KeywordAnalysis.tsx

5. **BUG-0007** — Line 139: Replace `` pagePath: `/${page.slug || ''}` `` with `pagePath: resolvePagePath(page)`. Add `resolvePagePath` import from `'../lib/pathUtils'` if not already present. (Line 108 already uses the inline fallback pattern — leave that as-is or replace with `resolvePagePath` for consistency.)

### SeoAudit.tsx

6. **BUG-0006** — Lines 598–601 (sort comparison) and 845 (render): Replace `` `/${a.slug}` ``, `` `/${b.slug}` ``, and `` `/${page.slug}` `` traffic map keys with `resolvePagePath(a)`, `resolvePagePath(b)`, `resolvePagePath(page)`. Add `resolvePagePath` import from `'../lib/pathUtils'`. The `a`, `b`, `page` objects here are Webflow page objects from the audit.

7. Run `npm run typecheck` — zero errors.

---

## Task 4 — Fix remaining server files (Model: haiku)

**Parallel with Tasks 2 and 3. Start only after Task 1 is committed.**

**Owns:**
- `server/routes/jobs.ts` (slug construction only — Task 1 already removed the guard function)
- `server/routes/webflow-keywords.ts`
- `server/routes/aeo-review.ts`
- `server/schema-plan.ts`
- `server/admin-chat-context.ts`

**Must not touch:** `server/helpers.ts` (owned by Task 1), `server/routes/webflow-seo.ts` (owned by Task 2).

**Steps:**

1. **`server/routes/jobs.ts:414`** — Replace `` pagePath: page.slug ? `/${page.slug}` : undefined `` with `pagePath: resolvePagePath(page) || undefined`. Import `resolvePagePath` from `'../helpers.js'` (check existing imports).

2. **`server/routes/webflow-keywords.ts:30`** — Replace `` pagePath: slug ? `/${slug}` : undefined `` with path resolution. Note: here `slug` is a string parameter, not a page object — use `` slug ? `/${slug}` : undefined `` ONLY if `slug` is already a full path (check the call context). If it's a bare segment, use `` slug ? (slug.startsWith('/') ? slug : `/${slug}`) : undefined `` as a minimal fix since there's no page object to call `resolvePagePath` on. Add a `// slug-is-full-path-ok` comment if confirmed, or file a TODO if uncertain.

3. **`server/routes/aeo-review.ts:119`** — **BUG-0005**: `issueMap.set(p.slug, p.issues)` keys by raw slug. Replace with a normalized key:
   ```typescript
   const slugKey = p.slug.startsWith('/') ? p.slug : `/${p.slug}`;
   issueMap.set(slugKey, p.issues);
   ```
   Then at the lookup sites (lines 163 and 177), normalize the lookup key the same way:
   ```typescript
   const lookupKey = p.slug.startsWith('/') ? p.slug : `/${p.slug}`;
   const aeoIssueCount = (issueMap.get(lookupKey) || [])...
   ```

4. **`server/schema-plan.ts:80`** — The fallback `` pm.pagePath === `/${p.slug}` `` is a dead-code path for nested pages. Replace the slug fallback with `resolvePagePath(p)`:
   ```typescript
   pm.pagePath === pagePath || pm.pagePath === resolvePagePath(p)
   ```
   Import `resolvePagePath` from `'../helpers.js'`.

5. **`server/admin-chat-context.ts:558–559`** — The dual-lookup `trafficMap[slug] || trafficMap[p.slug]` uses a slug that may be only the final segment. Replace with:
   ```typescript
   const resolvedPath = p.publishedPath || (p.slug?.startsWith('/') ? p.slug : `/${p.slug}`);
   const traffic = trafficMap[resolvedPath];
   ```
   (No `resolvePagePath` import needed — inline the logic to avoid import coupling if `admin-chat-context.ts` doesn't already import from helpers.)

6. Run `npm run typecheck` — zero errors.

---

## Task 5 — pr-check rule + integration test (Model: sonnet)

**Sequential — run after Tasks 2, 3, and 4 are all committed. Diff-review batch first.**

**Owns:**
- `scripts/pr-check.ts`
- `tests/integration/nested-page-path.test.ts` (new file)

**Must not touch:** any other file.

**Steps:**

### pr-check rule

1. Add a new rule to the `CHECKS` array in `scripts/pr-check.ts`:
   ```typescript
   {
     id: 'bare-slug-pagepath',
     description: 'Bare slug used in pagePath construction — use resolvePagePath(page) instead',
     pattern: /`\/\$\{(?:page|p)\.slug(?:\s*\|\|\s*['"].*?['"])?\}`/,
     message:
       'Use resolvePagePath(page) instead of `/${page.slug}` — slug is only the final URL segment for nested Webflow pages. resolvePagePath() prefers publishedPath.',
     files: { include: ['server/**/*.ts', 'src/**/*.ts'], exclude: ['server/helpers.ts', 'src/lib/pathUtils.ts'] },
   },
   ```
   Run `npm run rules:generate` to regenerate `docs/rules/automated-rules.md`.

### Integration test

2. Create `tests/integration/nested-page-path.test.ts` using port **13320** (verify with `grep -r 'createTestContext(' tests/` first):
   - Tests that keyword strategy entries stored for `/services/seo` are returned when looking up by a page with `slug: "seo"` and `publishedPath: "/services/seo"`
   - Tests that `matchPagePath("/services/seo", "/seo")` returns false (regression guard)
   - Tests that `matchPagePath("/services/seo", "/services/seo")` returns true
   - Tests that `resolvePagePath({ slug: "seo", publishedPath: "/services/seo" })` returns `"/services/seo"`
   - Tests that `resolvePagePath({ slug: "seo" })` returns `"/seo"` (fallback)
   These are unit-level tests on path utilities + the keyword store lookup, not full HTTP tests. Use `import { matchPagePath, resolvePagePath } from '../../src/lib/pathUtils.js'` — no `createTestContext` needed for the path utility tests. For the store test, test directly against `upsertPageKeyword` / `getPageKeyword`.

3. Run `npx vitest run tests/integration/nested-page-path.test.ts` — all pass.

---

## Task 6 — Quality gates + docs (Model: haiku)

**Sequential — run after Task 5 is committed.**

**Owns:**
- `FEATURE_AUDIT.md`
- `data/roadmap.json`

**Steps:**

1. `npm run typecheck` — zero errors.
2. `npx vite build` — clean build.
3. `npx vitest run` — full suite green.
4. `npx tsx scripts/pr-check.ts` — zero errors (the new `bare-slug-pagepath` rule should pass since we just fixed all instances).
5. Add entries to `FEATURE_AUDIT.md` for: Nested Page Path Hardening (resolvePagePath sweep), applyBulkKeywordGuards in webflow-seo.ts, GSC path-boundary matching.
6. Update `data/roadmap.json`: mark the corresponding roadmap item as done with notes. Run `npx tsx scripts/sort-roadmap.ts`.

---

## Task Dependencies

```
Task 1 (helpers.ts + jobs.ts — move guard)
  └── [commit] ──────────────────────────────────────┐
                                                      │
                 ┌────────────────────────────────────┼──────────────────────┐
                 ▼                                    ▼                      ▼
      Task 2 (webflow-seo.ts)          Task 3 (frontend components)   Task 4 (remaining server)
          [commit]                           [commit]                      [commit]
                 └────────────────────────────────────┴──────────────────────┘
                                             │
                                    diff review checkpoint
                                    (git diff, tsc, vitest)
                                             │
                                             ▼
                                   Task 5 (pr-check rule + tests)
                                           [commit]
                                             │
                                             ▼
                                   Task 6 (quality gates + docs)
                                           [commit]
```

**Sequential:** Task 1 → [parallel batch] → diff review → Task 5 → Task 6
**Parallel batch:** Tasks 2, 3, 4 (all start from Task 1's committed state, own different files)

---

## Systemic Improvements

**Shared utility confirmed:** `resolvePagePath()` already exists in `server/helpers.ts` and `src/lib/pathUtils.ts`. The fix is adoption, not creation. `applyBulkKeywordGuards` moves from `jobs.ts` to `server/helpers.ts`.

**pr-check rule:** `bare-slug-pagepath` (added in Task 5) — flags `` `/${page.slug}` `` and `` `/${p.slug}` `` constructions in all server/src files, excluding the `resolvePagePath` definition sites.

**New tests:** `tests/integration/nested-page-path.test.ts` covering path utility correctness and nested page keyword store round-trips.

---

## Verification Strategy

After Task 5:
- `npx vitest run tests/integration/nested-page-path.test.ts` — all pass
- `npx tsx scripts/pr-check.ts` — `bare-slug-pagepath` rule fires on zero files (all sites fixed)

After Task 6 (pre-PR):
- `npm run typecheck` — zero errors
- `npx vite build` — clean
- `npx vitest run` — full suite green
- `npx tsx scripts/pr-check.ts` — zero violations

**Manual staging verification:**
- Open SeoEditor on a nested Webflow page (e.g., a page with `publishedPath: "/services/seo"`) — confirm keyword map data appears (BUG-0001 regression)
- Run "Analyze All Pages" bulk action — verify keyword difficulty and monthly volume are 0 for pages without SEMRush data (BUG-0003)
- Check GSC queries displayed in SeoEditor for a page whose slug appears in other paths — verify no false-positive queries from unrelated pages (BUG-0004)
