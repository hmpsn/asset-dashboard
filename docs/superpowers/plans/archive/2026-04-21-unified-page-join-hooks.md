# Unified Page-Join Shared Client Hooks — Implementation Plan

## Overview

Ship one shared client hook (`usePageJoin(workspaceId)`) that returns a pre-joined `UnifiedPage[]` collection combining Webflow pages with keyword-strategy `pageMap` entries. Migrate the three current ad-hoc join sites (SeoEditor, PageIntelligence, ApprovalsTab) to consume the hook. Add a pr-check rule forbidding `pageMap.find` / `strategyByPath`-style manual pairing outside the hook so drift can't return.

This is **Option 1** from the post–slug-path-hardening scoping discussion. It is deliberately client-side only — the heavier Option 2 (server-side assembler) is tracked separately as roadmap item #594 (audit-only) and should not be attempted until that audit lands.

Related context:
- Slug-path hardening sprint (PRs #246, #248) fixed eight individual bugs but left the structural duplication in place.
- Audit findings confirm 3 independent matching implementations with divergent semantics:
  - **SeoEditor** (`src/components/SeoEditor.tsx:445, 461`) — `tryResolvePagePath(p) !== undefined && matchPagePath(entry.pagePath, path)` (case-insensitive, handles homepage `slug: ''`)
  - **PageIntelligence** (`src/components/PageIntelligence.tsx:284-331`) — `findPageMapEntryForPage` (case-insensitive + legacy `/${slug}` fallback, as of PR #248)
  - **ApprovalsTab** (`src/components/client/ApprovalsTab.tsx:166-174`) — custom `findPageKeywords(slug)` with lowercase + suffix-match fallback; does **not** use `matchPagePath` or `resolvePagePath`, does **not** handle the homepage empty-slug case
- Frontend/backend path helpers already exist and agree: `src/lib/pathUtils.ts` mirrors `server/helpers.ts`. The hook builds on top of these, it does not replace them.

## Pre-requisites

- [x] PR #248 merged to staging (`findPageMapEntryForPage` available in `src/lib/pathUtils.ts`)
- [ ] This plan committed
- [ ] `shared/types/page-join.ts` shared contract committed (see Task 1) — pre-committed before any parallel work

---

## Task List

### Task 1 — Shared types + barrel export (Model: haiku)

**Owns:**
- `shared/types/page-join.ts` (new)
- `shared/types/index.ts` (add re-export)

**Must not touch:** everything else.

Steps:
1. Create `shared/types/page-join.ts` exporting:
   ```ts
   import type { Page, SeoData } from './webflow.js';
   import type { PageKeywordMap } from './keywords.js';

   export interface UnifiedPage {
     id: string;                        // page.id for Webflow pages; `strategy-${pagePath}` for strategy-only
     title: string;                     // strategy.pageTitle || page.title || cleaned slug
     path: string;                      // resolvePagePath(page) for real pages; sp.pagePath for strategy-only
     slug?: string;                     // raw slug when available (Webflow pages only)
     source: 'static' | 'cms' | 'strategy-only';
     publishedPath?: string | null;
     seo?: SeoData;
     strategy?: PageKeywordMap;         // undefined when page has no matching strategy entry
     analyzed: boolean;                 // strategy?.analysisGeneratedAt != null
   }
   ```
2. Add re-export to `shared/types/index.ts`.
3. Run `npm run typecheck` to confirm clean.

---

### Task 2 — The hook (Model: sonnet)

**Owns:**
- `src/hooks/admin/usePageJoin.ts` (new)
- `src/hooks/admin/index.ts` (add re-export)

**Must not touch:** any component files, any other hook file.

Steps:
1. Create `src/hooks/admin/usePageJoin.ts`:
   - Signature: `usePageJoin(workspaceId: string): { pages: UnifiedPage[]; strategyPages: UnifiedPage[]; webflowPages: UnifiedPage[]; isLoading: boolean; error: Error | null }`
   - Internally calls existing `usePages(workspaceId)` + `useKeywordStrategy(workspaceId)` hooks. Do not duplicate their query keys — depend on them.
   - Builds the unified list inside `useMemo`, keyed on `[pagesData, strategyData]`:
     - For each Webflow page: look up strategy via `findPageMapEntryForPage(pageMap, page)` (not a new Map; reuse the shared helper so we inherit case-insensitivity + legacy fallback).
     - For each pageMap entry not matched to a Webflow page: emit a `source: 'strategy-only'` entry with `id: 'strategy-${pagePath}'`. Dedup against already-emitted pages by `normalizePath(path).toLowerCase()`.
     - `analyzed` is `strategy?.analysisGeneratedAt != null`.
   - `strategyPages` = filter to entries that have a `strategy` field set.
   - `webflowPages` = filter to entries that are not `source: 'strategy-only'`.
   - Loading and error state: `isLoading` when either underlying query is loading AND its data is undefined; `error` is first non-null of the two.
2. Export from the barrel file `src/hooks/admin/index.ts`.
3. Co-located tests: `tests/unit/use-page-join.test.ts`. Cover:
   - Empty pageMap → all pages `strategy: undefined`, `analyzed: false`
   - Exact match
   - Case-variant stored entry matches (`/Services/SEO` pageMap, `/services/seo` page)
   - Legacy `/${slug}` fallback matches (page with `publishedPath: '/services/seo'`, pageMap entry `pagePath: '/seo'`)
   - Homepage (`slug: ''`, `publishedPath: null`) matches pageMap entry `pagePath: '/'`
   - Strategy-only entry (no matching Webflow page) emitted with `source: 'strategy-only'`
   - `strategyPages` filter returns only pages with a strategy entry
   - Orphan page (no slug, no publishedPath) → present in result with `path: '/'` and `analyzed: false` (matching existing `resolvePagePath` contract)

---

### Task 3 — Migrate SeoEditor (Model: sonnet)

**Depends on:** Task 1, Task 2 committed.

**Owns:**
- `src/components/SeoEditor.tsx`

**Must not touch:** PageIntelligence, ApprovalsTab, the hook itself, shared types.

Steps:
1. Replace the inline `useEffect` building `analyzedPages` (lines ~440-453) with a derived value from `usePageJoin`: `const analyzedPages = useMemo(() => new Set(unified.pages.filter(p => p.analyzed).map(p => p.id)), [unified.pages])`.
2. Replace the `pageKeywordMap` `useMemo` (lines ~456-473) with a reduce over `unified.pages` that builds the same Map shape.
3. Remove now-unused imports (`tryResolvePagePath`, `matchPagePath` if no other usage remains — grep the file before deleting).
4. Keep the existing `resolvePagePath(page)` call in `analyzePage` (line ~481) — that is sending data to an API, not joining client collections, and is out of scope for this refactor.
5. Run the existing SeoEditor smoke tests. Ensure behavior parity.

---

### Task 4 — Migrate PageIntelligence (Model: sonnet) [parallel with Task 3]

**Depends on:** Task 1, Task 2 committed.

**Owns:**
- `src/components/PageIntelligence.tsx`

**Must not touch:** SeoEditor, ApprovalsTab, the hook itself, shared types.

Steps:
1. Replace the `unifiedPages` IIFE (lines ~283-331) with a direct consumption: `const { pages: unifiedPages } = usePageJoin(workspaceId)`.
2. Because the hook already returns the `source: 'strategy-only'` entries, the dedup loop inside the IIFE goes away entirely.
3. Remove now-unused imports (`normalizePath`, `resolvePagePath`, `findPageMapEntryForPage` — grep before deleting).
4. The `effectiveAnalyses` `useMemo` keeps its current shape — it consumes `unifiedPages` and that contract is preserved.

---

### Task 5 — Migrate ApprovalsTab (Model: sonnet) [parallel with Tasks 3–4]

**Depends on:** Task 1, Task 2 committed.

**Owns:**
- `src/components/client/ApprovalsTab.tsx`

**Must not touch:** SeoEditor, PageIntelligence, the hook itself, shared types.

Steps:
1. The current `findPageKeywords(pageSlug)` helper uses a different join input — it takes an already-resolved `pageSlug` string (from `ApprovalItem.pageSlug`), not a Page object. Before migrating, verify what `item.pageSlug` actually contains:
   - If it is a canonical resolved path (e.g. `/services/seo`), use `findPageMapEntry(pageMap, item.pageSlug)` — the case-insensitive single-argument helper from `src/lib/pathUtils.ts`.
   - If it is a bare slug (`seo`), pre-pend `/` and use the same helper. Document which case applies in a one-line comment at the call site.
2. Decision on the suffix-match fallback: **remove it**. The fallback currently matches `/services/seo` when the approval item says `pageSlug: 'seo'`. That was correct pre-hardening but is now a semantic ambiguity (multiple nested pages ending with the same bare slug would match arbitrarily). After slug-path hardening, approval items should carry full paths. If the grep in Step 1 shows bare slugs still flow through, open a follow-up task (roadmap) to harden the approval-item producer rather than preserving the ambiguous match here.
3. Replace `findPageKeywords` with direct use of `findPageMapEntry` from `src/lib/pathUtils.ts`. Do not introduce `usePageJoin` here — ApprovalsTab doesn't have a list of Webflow pages, it has a list of approval items, so the full hook is the wrong shape. The goal is using the same *matching primitive* as the hook.
4. Update both call sites (line ~341 and any other `findPageKeywords` reference).

**Note:** ApprovalsTab is NOT a `usePageJoin` consumer. It is migrated to the same primitive (`findPageMapEntry`) to unify matching semantics. The pr-check rule (Task 6) should tolerate direct calls to `findPageMapEntry`/`findPageMapEntryForPage` — it only forbids roll-your-own pagePath matching.

---

### Task 6 — pr-check drift-prevention rule (Model: sonnet)

**Depends on:** Tasks 3, 4, 5 merged (so the rule doesn't flag pre-migration code).

**Owns:**
- `scripts/pr-check.ts`
- `tests/pr-check.test.ts`
- `docs/rules/verified-clean-rules.md`

**Must not touch:** anything else.

Steps:
1. Add a custom pr-check rule: `'Manual pageMap pairing outside shared helpers — use findPageMapEntry(ForPage) or usePageJoin'`.
   - Pattern: regex matching `pageMap\s*\.find\s*\(` or `strategyByPath` variable declarations or `new Map<.*StrategyPage`-style indexers — file-scoped check.
   - Excludes: `src/hooks/admin/usePageJoin.ts`, `src/lib/pathUtils.ts`, `server/helpers.ts`, `tests/**`.
   - File-scope filter: `src/**/*.{ts,tsx}` excluding the allowlist above.
2. Add 5+ fixture tests to `tests/pr-check.test.ts` covering triggers and exclusions (follow the pattern from the `resolvePagePath` rule).
3. Register the rule in `EXPECTED_CUSTOM_CHECK_RULES`.
4. Add one row to `docs/rules/verified-clean-rules.md` with the rule name, regex summary, and justification.

---

## Task Dependencies

```
Task 1 (Shared types)  →  Task 2 (Hook + unit tests)

Parallel after Task 2 (exclusive file ownership — safe to dispatch together):
  Task 3 (SeoEditor)  ∥  Task 4 (PageIntelligence)  ∥  Task 5 (ApprovalsTab)

Sequential after parallel batch merged:
  Task 6 (pr-check rule)
```

Rationale for the ordering:
- Task 1 and Task 2 are sequential because Task 2 imports `UnifiedPage` from Task 1.
- Tasks 3, 4, 5 own three different files and consume only already-committed code. They are genuinely independent and parallel-safe.
- Task 6 runs last because the pr-check rule must not flag the pre-migration code during the PR that lands Tasks 3–5; running it earlier would cause a chicken-and-egg CI failure.

## Cross-Phase Contracts

This plan is single-phase. No downstream phase depends on it. If and when roadmap item #594 (server-side assembler audit) graduates into an implementation plan, the `UnifiedPage` shape defined here is the strong candidate for what the server endpoint returns — review this contract before designing that response.

## Systemic Improvements

**Shared utilities:**
- `src/hooks/admin/usePageJoin.ts` — the canonical page-join derivation. Single source of truth for UI consumers.

**pr-check rules:**
- Manual pageMap pairing outside shared helpers (Task 6).

**New tests:**
- `tests/unit/use-page-join.test.ts` — 8+ unit tests covering empty, exact match, case variance, legacy fallback, homepage, strategy-only emission, filter helpers, orphan pages.
- New fixtures in `tests/pr-check.test.ts` for Task 6.

**Documentation touch-ups (not a separate task — bundle with the relevant task):**
- `CLAUDE.md` — add one bullet under "UI/UX Rules" referencing `usePageJoin` for any component needing the joined page list.
- `docs/rules/development-patterns.md` — add `usePageJoin` to the React Query hooks section.

## Verification Strategy

Per task:
- **Task 1:** `npm run typecheck` clean.
- **Task 2:** `npx vitest run tests/unit/use-page-join.test.ts` — 8 passing.
- **Tasks 3–5 (behavior parity):**
  - `npx vitest run` — full suite, specifically the `nested-page-path.test.ts` integration tests must still pass unchanged.
  - Preview smoke: load SEO Editor, Page Intelligence, and the client Approvals tab on a workspace with a mixed analyzed/unanalyzed state. All three surfaces must show the same "Analyzed" count they did pre-refactor.
  - Screenshot each of the three surfaces before and after, diff the lists visually.
- **Task 6:** `npx tsx scripts/pr-check.ts` — zero errors on the current branch; intentionally add a `pageMap.find(...)` call in a throwaway component and confirm pr-check fails; remove.
- **Merge:** staging-only until verified on the deploy, per project staging gate.

Pre-merge checklist (all must pass):
- [ ] `npm run typecheck`
- [ ] `npx vite build`
- [ ] `npx vitest run`
- [ ] `npx tsx scripts/pr-check.ts`
- [ ] `FEATURE_AUDIT.md` updated (add entry for `usePageJoin`)
- [ ] `data/roadmap.json` — #593 `pending` → `done`
- [ ] `superpowers:scaled-code-review` invoked after Tasks 3–5 land (parallel work across multiple components)

## Out of Scope (explicit)

- Server-side page join (roadmap #594 — audit only first).
- Migrating `resolvePagePath(page)` calls inside API-request bodies (they are not client-join sites).
- Unifying GSC, insight, or content-pipeline joins to pages — each warrants its own hook and its own plan; those are roadmap items to consider after #594's audit lands.
- ApprovalsTab suffix-match fallback behavior preservation — if Task 5's grep shows bare slugs still flow through approval items, that is a producer-side bug and gets its own roadmap item, not a compatibility shim here.
