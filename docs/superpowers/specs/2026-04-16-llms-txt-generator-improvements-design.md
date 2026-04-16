# LLMs.txt Generator Improvements

**Date:** 2026-04-16
**Status:** Draft — pending user approval
**Owner:** Joshua
**Related:** [server/llms-txt-generator.ts](../../../server/llms-txt-generator.ts), [src/components/LlmsTxtGenerator.tsx](../../../src/components/LlmsTxtGenerator.tsx)

---

## 1. Context

The current LLMs.txt generator produces a technically valid file but falls short of the llms.txt spec and misses material site content. Review of the generator's output for a representative workspace (Faros AI) surfaced three classes of problem:

**Format/spec gaps:**
- No blockquote summary after the H1 (spec requires `> ...`).
- "Main Pages" auto-grouping is a weak section name; lacks `## Optional` bucket for low-priority links.
- Descriptions missing on most entries; AI summaries exist but only feed `llms-full.txt`, not the index.
- Error/auth pages (`/404`, `/401`, `/password`) flow through the generator as real content.
- H1 uses `workspace.name` which may not match canonical brand (e.g., "Faros" vs "Faros AI").

**Discovery gaps:**
- External pages (`jobs.ashbyhq.com`, `security.faros.ai`, `app.faros.ai`) are fundamentally unreachable — different domain.
- Query-param filter views (`/blog?type=guides`) are stripped by `resolvePagePath`.
- Footer/nav-only pages the Webflow API doesn't surface.

**Operational bug:**
- "Download" button 401s. Cause: `window.open(downloadUrl)` cannot send the `x-auth-token` header required by `requireWorkspaceAccess`.

## 2. Goals

- Produce a spec-conformant llms.txt (H1 + blockquote + categorized H2 sections including `## Optional`).
- Categorize pages into meaningful sections (Products / Solutions / Company / Resources / Blog / Changelog / Other / Optional) via hybrid heuristic + AI pass.
- Admin-curated additional URLs cover external/subdomain pages the crawler can't reach.
- Descriptions populated on every index entry (reuse cached summaries, no new AI volume).
- Fix download 401 with a client-side Blob download.
- Surface the new data (brand name, resolved site summary, page taxonomy, external URLs) on `SeoContextSlice` per CLAUDE.md rule #6 so admin-chat, brief generation, and copy pipeline can consume it.

## 3. Non-goals

- Consolidating the four existing sitemap-fetcher implementations (`discoverCmsUrls`, `discoverSitemapUrls`, `fetchSitemapUrls`, `parseSitemap`). Logged as a follow-up refactor.
- Fine-grained user-assignable tags per page (categorization stays on a fixed enum).
- Automatic re-classification when heuristics change. Adding a page uses current rules; existing categorizations stick until the cache is manually reset.
- Multi-language llms.txt output.
- Changing the existing `llms-full.txt` format or AI-summary generation flow.

## 4. High-level workstreams

The design is eight workstreams (A–H). See Section 5 for data model, Section 6 for intelligence wiring, Section 7 for testing, Section 8 for file ownership, Section 9 for dependencies.

### A. Bug fixes
- **A1.** Replace `window.open(downloadUrl)` in [LlmsTxtGenerator.tsx](../../../src/components/LlmsTxtGenerator.tsx) with a `new Blob()` + `URL.createObjectURL()` client-side download using the state already returned by `generate()`. Delete `llmsTxt.downloadUrl`, `llmsTxt.downloadFullUrl` in [src/api/content.ts](../../../src/api/content.ts). Delete the `/download` and `/download-full` server routes in [server/routes/llms-txt.ts](../../../server/routes/llms-txt.ts).
- **A2.** Filter out paths matching `/^\/(404|401|500|not-found|error|password|maintenance)(\/|$)/i` before categorization in `generateLlmsTxt`.
- **A3.** Guarantee a `>` blockquote always renders. Resolution order: `workspace.llms_txt_summary` (new column, workstream F1) → `keywordStrategy.businessContext` → AI synthesis via `callAnthropic` with Claude Sonnet 4.6. The synthesized value is cached in `workspace.llms_txt_summary` so regenerations are free. Never render the H1 with no blockquote following.

### B. Brand identity
- **B1.** Migration `064-llms-txt-brand-name.sql` — add `workspaces.brand_name TEXT` (nullable).
- **B2.** Resolve `siteName` in `generateLlmsTxt` as `ws.brandName || ws.name || domain || 'Website'`.
- **B3.** Add Brand Name field to Workspace Settings (workspace identity section). Standard text input; empty clears back to workspace name fallback.
- **B4.** Fire-and-forget homepage fetch during generation. Parse `<meta property="og:site_name">` or `<title>`. If differs from current `siteName`, surface a toast/banner in the UI: "We detected your site brands as 'Foo' — use that as brand name?" with one-click apply. Never auto-apply.

### C. Hybrid classifier
- **C1.** Migration `065-llms-txt-categorization.sql` — new table `llms_txt_categorization (workspace_id, page_path, category, source, generated_at, PRIMARY KEY(workspace_id, page_path))`. Foreign key to workspaces, ON DELETE CASCADE. Index on `workspace_id`.
- **C2.** New module `server/llms-txt-classifier.ts`:
  - Heuristic pass: path-pattern rules mapping common paths to categories (e.g., `/privacy|/terms|/cookies|/cla|/cookie-policy` → `Optional`, `/blog(\/|$|\?)` → `Blog`, `/changelog(\/|$)` → `Changelog`, `/about|/team|/careers|/partners|/contact` → `Company`, `/platform|/pricing|/product(\/|s)?` → `Products`, `/solutions?` → `Solutions`, `/research|/resources?|/guides?|/docs?` → `Resources`, and the error paths from A2 are `excluded`). Returns `heuristic` category + `unclassified` for pages no rule matched.
  - AI pass: one `gpt-4.1-mini` call with the full `unclassified` set + site context (brand name, business context) + the fixed category enum. System prompt stresses: fixed enum only, one category per page, no reasoning text. Returns `{ path: category }` map.
  - Merge: heuristic wins for known paths; AI fills the rest. Writes both sources to the cache table with `source = 'heuristic' | 'ai'`.
  - Exported helpers: `classifyPages(workspaceId, pages, context): Promise<Map<path, LlmsTxtCategory>>`, `resetClassification(workspaceId)`, `getClassification(workspaceId): Map<path, LlmsTxtCategory>`.
- **C3.** Per-workspace cache keyed on `workspace_id + path`. Invalidation on regeneration: remove rows whose `page_path` is no longer in the current page set. Stable labels between runs.
- **C4.** Rewrite `buildLlmsTxtIndex`: group by resolved category, emit sections in fixed order `Products → Solutions → Company → Resources → Blog → Changelog → Other → Optional`. Skip empty sections. Delete `groupBySection` + `sortedSections` + "Main Pages" label.

### D. Description backfill + blog display
- **D1.** In `buildLlmsTxtIndex` entry emission, fall back to `condenseSummary(page.summary)` when `page.description` is absent. `condenseSummary` takes the cached per-page summary and extracts the first sentence capped at ~140 chars. No new AI call — reuses the existing `llms_txt_cache` data.
- **D2.** Keep all blog posts in `## Blog` (per Opus's literal feedback). Move authors list + utility pages (legal, cookies, CLA) to `## Optional` via the classifier rules in C2. No blog-post capping.

### E. Page discovery
- **E1.** In `generateLlmsTxt`, after Webflow static + CMS pages are loaded, call existing `discoverSitemapUrls(baseUrl)` from [server/webflow-pages.ts](../../../server/webflow-pages.ts) (already supports sitemap-index). Filter to same root domain, strip URL fragments (`#foo`), preserve query strings, dedupe against known pages. Build page entries with title derived from path last-segment (same as existing `slugToTitle` helper).
- **E2.** Migration `066-llms-txt-additional-urls.sql` — new table `llms_txt_additional_urls (workspace_id, url, title, description, category, created_at, PRIMARY KEY(workspace_id, url))`. FK to workspaces, ON DELETE CASCADE. New module `server/llms-txt-additional-urls.ts` with CRUD helpers using `createStmtCache`. New API routes in [server/routes/llms-txt.ts](../../../server/routes/llms-txt.ts): `GET`, `POST`, `DELETE` under `/api/llms-txt/:workspaceId/additional-urls`. Workspace Settings UI section "External pages to include" with add/remove rows (URL / title / category select). No URL pre-validation on save — the existing `validateUrls` pipeline filters broken URLs at generation time.
- **E3.** New module `server/llms-txt-link-suggester.ts`. On generation, fetch workspace homepage HTML (with `STUDIO_BOT_UA`), extract anchor tags from `<nav>` and `<footer>` elements, dedupe against known + additional URLs. Pass unseen URLs to `gpt-4.1-mini` with a classification prompt: `internal-missed | external-hosted | social | ignore` + suggested category. Results are **suggestions**, not auto-merged. Expose via new route `GET /api/llms-txt/:workspaceId/suggestions` returning `LlmsTxtDiscoverySuggestion[]`. Frontend UI shows a "Suggested external pages" card with one-click add (creates an `llms_txt_additional_urls` row) or ignore (stored in a per-workspace ignore list — new column or a junction table; spec leaves the choice to the plan). Fire-and-forget at generation time; the UI polls/refreshes when the user opens the LlmsTxtGenerator page.
- **E4.** `LlmsTxtPage.path: string` stays; add `url: string` for the full URL including query string. Update `resolvePagePath` call sites to also produce full URL. Emitted markdown uses `url` when present, falls back to `baseUrl + path` as today. Covers `/blog?type=guides#gallery` (fragment stripped by E1/E3 normalization).
- **E5.** Add a note to `docs/superpowers/intelligence-backlog.md` (or equivalent) flagging the 4-way sitemap fetcher duplication (`discoverCmsUrls`, `discoverSitemapUrls`, `fetchSitemapUrls`, `parseSitemap`) as a follow-up refactor: extract canonical `server/sitemap-fetcher.ts`, migrate all callers.

### F. Intelligence engine wiring
- **F1.** Migration `067-llms-txt-summary-override.sql` — add `workspaces.llms_txt_summary TEXT` (nullable). Admin-editable; used by A3 as the highest-priority blockquote source and also the cache location for AI-synthesized value.
- **F2.** New shared types file `shared/types/llms-txt.ts`:
  ```ts
  export const LLMS_TXT_CATEGORIES = ['Products','Solutions','Company','Resources','Blog','Changelog','Other','Optional'] as const;
  export type LlmsTxtCategory = typeof LLMS_TXT_CATEGORIES[number];
  export interface LlmsTxtAdditionalUrl { workspaceId: string; url: string; title: string; description?: string; category: LlmsTxtCategory; createdAt: string; }
  export interface LlmsTxtDiscoverySuggestion { url: string; suggestedTitle: string; kind: 'internal-missed'|'external-hosted'|'social'|'ignore'; suggestedCategory: LlmsTxtCategory; }
  ```
  `LlmsTxtPage` stays server-only (not shared).
- **F3.** Extend `SeoContextSlice` in [shared/types/intelligence.ts](../../../shared/types/intelligence.ts):
  - `effectiveSiteName: string` — pre-resolved from `brand_name || name || domain`.
  - `effectiveSiteSummary: string` — pre-resolved from `llms_txt_summary || businessContext || ''`.
  - `pageTaxonomy?: Partial<Record<LlmsTxtCategory, Array<{ url: string; title: string }>>>`.
  - `additionalExternalUrls?: LlmsTxtAdditionalUrl[]`.
  Empty string for `effective*` means "nothing configured" (matches the existing `effectiveBrandVoiceBlock` convention in the same interface).
- **F4.** Update `assembleSeoContext` in [server/seo-context.ts](../../../server/seo-context.ts) to populate the four new fields from the new workspace columns + `llms_txt_categorization` + `llms_txt_additional_urls` tables.
- **F5.** Contract test in [tests/contract/intelligence-slice-population.test.ts](../../../tests/contract/intelligence-slice-population.test.ts) — passthrough sentinel checks for `effectiveSiteName`, `effectiveSiteSummary`, `pageTaxonomy`, `additionalExternalUrls`. Mirror the existing `effectiveBrandVoiceBlock passthrough` test structure.

### G. Model selection
- Per-page summaries (existing): `gpt-4.1-mini`. High volume, factual, cached per URL. No change.
- Category classification (new, C2 AI pass): `gpt-4.1-mini`. Fixed-enum, single call per regeneration. No upgrade justification.
- Homepage link classification (new, E3): `gpt-4.1-mini`. Fixed-enum, small input. No upgrade justification.
- Blockquote synthesis (new, A3): **Claude Sonnet 4.6 via `callAnthropic`**. Creative prose, once per workspace, brand voice matters. Aligns with the project's existing pattern ("Claude for creative prose", per CLAUDE.md).

### H. Testing & verification
- See Section 7.

## 5. Data model

Four migrations (ordering by number is not semantically meaningful; they may ship together):

| Migration | Change |
|-----------|--------|
| `064-llms-txt-brand-name.sql` | `ALTER TABLE workspaces ADD COLUMN brand_name TEXT;` |
| `065-llms-txt-categorization.sql` | `CREATE TABLE llms_txt_categorization (...)` per workstream C1 |
| `066-llms-txt-additional-urls.sql` | `CREATE TABLE llms_txt_additional_urls (...)` per workstream E2 |
| `067-llms-txt-summary-override.sql` | `ALTER TABLE workspaces ADD COLUMN llms_txt_summary TEXT;` |

All three new columns on `workspaces` are nullable with no default. Both new tables use `workspace_id` as FK ON DELETE CASCADE.

## 6. Intelligence engine integration

Per CLAUDE.md rule #6 (data surfaces wire into `server/workspace-intelligence.ts`) and the authority-layered-fields rule (single pre-resolved representation, never raw + helper), this feature is both a **consumer** and a **producer** of `SeoContextSlice`:

**Consumer (already):** `businessContext`, `knowledgeBase`, `strategy`, `brandVoice` (via `effectiveBrandVoiceBlock` for the new A3 synthesis prompt).

**Producer (new):** four fields in F3 — `effectiveSiteName`, `effectiveSiteSummary`, `pageTaxonomy`, `additionalExternalUrls`. Each is populated by `assembleSeoContext` reading the new columns/tables. Downstream consumers (admin-chat, brief generation, copy pipeline) get the data automatically via their existing slice reads. No changes required in those consumers as part of this PR.

## 7. Testing

- **Unit tests:**
  - `tests/unit/llms-txt-classifier.test.ts` (new): heuristic rules for all known path patterns → expected categories; AI pass mocked → assigns to correct category; merge order (heuristic wins over AI); cache hit skips both passes.
  - Extend `tests/unit/llms-txt-phase4.test.ts` / `llms-txt-phase5.test.ts`: blog posts stay in `## Blog`; legal/authors in `## Optional`; description fallback condenses summary; A1 Blob download helper produces correct MIME + filename.
- **Snapshot tests:** generator output against two fixture workspaces (one Faros-like multi-section, one small 5-page site). Snapshot covers H1 + blockquote + every `## Section`.
- **Integration tests:** POST generate → assert blockquote present, no `/404`/`/401` in output, `## Optional` populated when legal pages found, additional URL round-trips into the correct section.
- **Contract test:** F5 (SeoContextSlice passthrough for new fields).
- **Manual verification:** regenerate Faros workspace, diff output against Opus's 9-item spec feedback list (blockquote, H1 brand, Optional section, error-page filter, descriptions, section names, blog display, missing pages, download fix), test Blob download in browser end-to-end.

## 8. File ownership

| Area | Files |
|------|-------|
| Migrations | `server/db/migrations/06{4,5,6,7}-llms-txt-*.sql` |
| Shared types | `shared/types/llms-txt.ts` (new), `shared/types/intelligence.ts` (F3 edits) |
| Classifier | `server/llms-txt-classifier.ts` (new) |
| Additional URLs store | `server/llms-txt-additional-urls.ts` (new) |
| Homepage link suggester | `server/llms-txt-link-suggester.ts` (new) |
| Generator integration | `server/llms-txt-generator.ts` (edits), `server/routes/llms-txt.ts` (edits: delete download routes, add additional-URLs CRUD + suggestions route) |
| Intelligence assembly | `server/seo-context.ts` (F4 edits) |
| Frontend download fix | `src/components/LlmsTxtGenerator.tsx` (A1 + UI for suggestions) |
| Frontend settings | `src/components/WorkspaceSettings.tsx` (B3 brand name, E2 additional URLs section) |
| Frontend API | `src/api/content.ts` (delete download helpers, add additional-URLs + suggestions clients) |
| Tests | `tests/unit/llms-txt-classifier.test.ts` (new), existing phase-4/phase-5 extensions, `tests/contract/intelligence-slice-population.test.ts` (F5 edits), fixture updates |
| Docs | `docs/superpowers/intelligence-backlog.md` (E5 follow-up) |

## 9. Dependencies

```
A1, A2              — independent
B1 → B2 → B3        — column before resolution before UI
B4                  — depends on B1 (writes to brand_name)
F1 → A3             — summary override column must exist before fallback resolver
F2                  — prerequisite for C4 (renderer imports enum), E2 UI (additional URLs form)
C1 → C2 → C3 → C4   — table, classifier, cache, renderer
D1                  — depends on C4 (new renderer is where fallback lands)
D2                  — depends on C2 (heuristic rules route authors/legal to Optional)
E1, E4              — independent of each other
E2 → E3             — additional-URLs table before one-click-add from suggestions
F3 → F4 → F5        — shared type, assembly, contract test
F2 is prerequisite for E2 UI and C4 renderer (both import category enum)
```

Packaging into PRs (plan phase will finalize):
- Option X: single PR covering everything. Simple but large diff.
- Option Y: three PRs — (1) bug fixes + migrations A+B+F1 + brand UI, (2) classifier C + rendering + D, (3) discovery E + intelligence wiring F.
- Recommendation: **Option Y** — PR #1 unblocks the broken download immediately; PR #2 and #3 layer value without risking the fix.

## 10. Risks & open questions

- **AI classification drift across runs:** mitigated by fixed enum + per-workspace cache. New pages won't reshuffle existing categorizations. Accept — a hidden "force reclassify" admin button can reset the cache if needed. Not in initial scope.
- **Homepage scraping cost:** one extra `fetch()` per generation. Negligible. Fail-silent if homepage returns non-200; suggester just returns empty list.
- **Query-string pages and sitemap reality:** Webflow's sitemap rarely includes query-filtered views like `/blog?type=guides`. These will typically be discovered via E3 (homepage nav extraction), not E1 (sitemap). Design handles both paths.
- **Trust on admin-entered URLs:** no pre-save validation. Existing `validateUrls` pipeline filters broken URLs at generation. Simpler, matches project conventions for admin-authored fields.
- **`assembleSeoContext` read cost:** adding four new reads (one column for brand_name, one column for llms_txt_summary, one table scan for categorization, one table scan for additional URLs). Both new tables are workspace-scoped and small (< 500 rows typical). Negligible.
- **SeoContextSlice growth:** F3 adds four fields. Existing consumers of the slice should compile unchanged (new fields are additive, three are optional). Contract test F5 ensures the fields pass through.
- **Follow-up: sitemap fetcher consolidation.** Four implementations today (`discoverCmsUrls`, `discoverSitemapUrls`, `fetchSitemapUrls`, `parseSitemap`). Extracting a canonical `server/sitemap-fetcher.ts` is NOT in scope for this PR (per Section 3). Logged per E5.

## 11. Out of scope / future work

- Extract canonical `server/sitemap-fetcher.ts` and migrate all 4 call sites.
- AI-driven re-categorization when heuristic rules change.
- Per-page user-assignable tags/categories beyond the fixed enum.
- Scheduled regeneration (cron trigger).
- Public-portal version of the file (currently admin-only endpoint).
- robots.txt generation/validation.
- Multi-language variants (`llms.txt` in es/fr/etc.).
