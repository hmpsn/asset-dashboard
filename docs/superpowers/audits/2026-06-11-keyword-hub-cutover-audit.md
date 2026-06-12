# W4 Keyword Hub Cutover — Pre-Plan Audit

**Date:** 2026-06-11 · **Branch audited:** fix/admin-surfaces-w3-w5-batch (includes merged W1–W3+W5)
**Spec:** docs/audits/2026-06-11-admin-surface-remediation-plan.md §Wave 4 + audit report §7 (keyword triangle)
**Method:** 6 parallel exhaustive scans (flag ground-truth, KCC retirement surface, RankTracker/seo-ranks surface, blocker verification, Hub gap analysis, server/docs/prevention surface)

---

## 0. Ground truth — the flag is NOT flipped in code

The 2026-06-11 roadmap note "keyword-hub flag flipped" describes an **owner decision, not a code state**. All three flags (`keyword-hub`, `keyword-universe-full`, `keyword-value-scoring`) still `defaultValue: false` in `shared/types/feature-flags.ts:219-259`; no `FEATURE_KEYWORD_HUB` env var exists in the repo. Runtime truth lives in two DB tables (`feature_flag_overrides` global, `feature_flag_workspace_overrides` per-workspace — migrations 042/114), settable via the admin flag API. **Whether production currently serves Hub or KCC is knowable only from the production DB** — resolution chain: workspace override → global override → env → default(false).

→ **Open question O1 (owner):** check production (or state from memory): is there a global/workspace override turning `keyword-hub` on today? The plan's first phase changes shape accordingly (blockers are live bugs vs. pre-flip work).

Flag wiring (all verified):
- `keyword-hub` is **client-routing only** — zero server reads. `App.tsx:260` reads it; `:435-436` (seo-keywords → Hub vs KCC), `:451-452` (seo-ranks → redirect vs RankTracker). Five more client reads: Sidebar/CommandPalette/Breadcrumbs (all via the W3.4 nav registry `flagBehavior`), `WorkspaceHome.tsx:65`, `RankingsSnapshot.tsx:27`, `MeetingBriefPage.tsx:59`, `KeywordStrategy.tsx:471,1006` (destination only).
- `keyword-universe-full` — server-only, 3 reads in `server/keyword-command-center.ts` (:140 rank-evidence cap 50→2000, :1479 raw-evidence 75→2000, :1886 summary cap). Surface-agnostic — survives the cutover; retired separately per its own removalCondition.
- `keyword-value-scoring` — server-only, 3 reads (`keyword-command-center.ts:254`, `keyword-strategy-enrichment.ts:607`, `keyword-strategy-ux.ts:425`). Surface-agnostic — same.

---

## 1. Blocker verification (audit §2 list vs current code)

| # | Blocker | Verdict | Evidence / required work |
|---|---------|---------|--------------------------|
| 1 | Drawer silent force-bypass | **FIXED** (W2.2) | `KeywordHub.tsx:344-356` ConfirmDialog gate |
| 2 | Pin/unpin unreachable flag-ON | **PRESENT** | Pin lives only in `RankTracker.tsx:231-232` (`PATCH /api/rank-tracking/:id/keywords/:keyword/pin`); Hub drawer shows a read-only Pinned badge (`KeywordDetailDrawer.tsx:401-402`). → **Decision O2:** port a pin toggle into the Hub drawer, or consciously drop pinning. |
| 3 | Hub drops GSC variants KCC renders | **PRESENT** | KCC `KeywordRow.tsx:150-176` renders `variants[]`; `HubKeywordList` has no variant UI. → **Decision O3:** port variant expansion or consciously drop (gap analysis recommends DROP — drawer shows richer detail). |
| 4 | Filter changes don't reset pagination/selection | **PRESENT** | `useKeywordHubState.ts:174-179` `setAdvancedFilter` misses the reset that `setSegment`/search already do. Fix: 2 lines. |
| 5/6 | Dead "View in Hub"/"replaced-by" button | **PRESENT** | `KeywordDetailDrawer.tsx:535-542` Button with no onClick (TODO comment). Fix: wire to `buildHubDeepLinkQuery(replacedBy)`. |
| 7 | Redirect drops `location.search` | **PRESENT** | `App.tsx:451` Navigate without `+ location.search`. Fix: 1 line + extend `seoRanksRedirect.test.tsx`. |
| 8 | Hub header mobile overflow; no x-scroll | **PRESENT** | Fixed `w-[260px]` search in PageHeader row; `HubKeywordList.tsx:194` has overflow-y only (KCC has both). |
| 9 | Empty states filter-blind | **PRESENT** | `HubKeywordList.tsx:235-249` hardcodes "No keywords match your filters" even unfiltered. |
| 10 | Bulk bar overlaps pagination | **PRESENT** | `KeywordBulkActionBar` is `fixed bottom-4`; Hub root lacks KCC's `pb-24` clearance. |
| 11 | KCC placeholder counts page-local | **MOOT** | Dies with KCC; Hub segment pills use server counts. |
| 12 | VariantSubRow misaligned grid | **MOOT** | KCC-only (unless O3 = port). |
| 13 | No `keepPreviousData` on rows query | **PRESENT** | `useKeywordCommandCenter.ts:25-32`. One option. |
| 14 | **LocalSeoVisibilityPanel mounts only in KCC** | **PRESENT (hard precondition)** | KCC `:433-450` mounts mode="keywords" behind requestIdleCallback; Hub renders none. Panel now carries W3.3 Track buttons + W5.3 trend + the **only market-setup drawer entry on the keyword surface**. |
| NEW | W5.1 outcome chips missing from Hub drawer | **PRESENT** | KCC passes `outcome={detail.data?.outcome}` (:622); Hub call (:527) doesn't. 1-prop fix. |
| NEW | Server action `targetTab: 'seo-ranks'` | **PRESENT** | `server/keyword-command-center.ts:738` points at a route that redirects post-flip; repoint to `seo-keywords` (+ deep-link query). |

Also KCC-only and worth migrating per gap analysis: the 5 **summary metric cards** (In Strategy / Tracked / Local / Needs Review / Retired — Hub has no KPI overview) and the **summary-level error alert** (`role="status"`, KCC :461-468).

## 2. Retirement surface (verified, exhaustive)

**DELETE (11 files):** `KeywordCommandCenter.tsx`; KCC-only subcomponents `KeywordRow.tsx`, `KeywordSparkline.tsx`, `SummaryMetric.tsx`, `VariantSubRow.tsx` (unless O3=port), orphaned `KeywordDetailPanel.tsx`; `RankTracker.tsx`; tests `KeywordCommandCenter.test.tsx`, `KeywordCommandCenterDeepLink.test.tsx`, `KeywordActionMenu.b1.test.tsx`, `RankTracker.test.tsx`.

**KEEP (shared with Hub):** `KeywordActionMenu`, `KeywordBulkActionBar`, `KeywordBulkConfirmDialog`, `KeywordDetailDrawer`, `kccActionHelpers`, `kccDisplayHelpers` + their non-b1 tests; the entire server module + all 6 routes (Hub consumes them); all server unit/integration tests; `statusConfig.ts` `keyword-command-center` domain (Hub uses it).

**UPDATE:** `App.tsx` (lazy import :49, render :436, RankTracker :452, redirect :451), `routes.ts:7` (Page union — see O4), `navRegistry.tsx:118-121` (seo-ranks entry), `queryKeys.ts` (keep — Hub uses the same keys; nothing to delete contrary to first-pass scan: hooks are SHARED), `wsInvalidation.ts` (keep — Hub depends on the same invalidations), `WorkspaceHome.tsx:65` / `RankingsSnapshot.tsx:27` / `MeetingBriefPage.tsx:59` flag-OFF fallbacks, `KeywordCommandCenter-ws-invalidation.test.tsx` (registry test survives — it pins the central mapping the Hub relies on; rename), `rank-tracking-key-collapse.test.ts:66-68`.

**MIGRATE before seo-ranks dies:** `RankHistoryChart` (`shared/RankTable.tsx:21-57`, multi-keyword trend) → Hub drawer's national-rank section (drawer already fetches `rankHistory` :79 but renders only a sparkline). `RankTable`/`KeywordTable` themselves stay (SearchTab consumes them).

**Server dead code after KCC dies:** `buildKeywordCommandCenterModel()` + `buildKeywordCommandCenterRowsViaModel()` (~1,200 lines, the LOCAL_CANDIDATES/`includeLocalSeoDetails` full-model path — routes never call it post-cutover); the RankTracker-only `DELETE keywords` + `pin` endpoints (pin depends on O2).

**Route-removal reality check:** the W3.4 nav registry eliminated checklist sites 3–5 (Sidebar/Breadcrumbs/Palette are registry-driven — registry entry deletion covers all three). `docs/rules/route-removal-checklist.md` is now stale and should be updated in this effort. Remaining literal sites: routes.ts union, App.tsx cases, navRegistry entry, contract test expectations, `route-fold-in-seo-ranks.test.ts` allowlist.

**Alias precedent (O4):** `CLIENT_INBOX_ALIASES` exists for *client-facing* URLs; the `schema-review` admin retirement used a redirect window then deletion. Recommendation: keep the seo-ranks→seo-keywords redirect through a soak window, then delete the Page value entirely (no permanent alias).

## 3. Docs / prevention / lifecycle surface

- **Docs:** rename `docs/rules/keyword-command-center.md` → `keyword-hub.md` (+ CLAUDE.md anchor at the doc table); BRAND_DESIGN_LANGUAGE.md §"Keyword Command Center" → "Keyword Hub" (keep affordance tone table); `docs/rules/route-removal-checklist.md` refresh (registry-driven now); deprecation-lifecycle entries for KCC/RankTracker/seo-ranks (`deprecated → hidden → removed`); GLOSSARY/platform-organization/platform-integration-surfaces mentions; FEATURE_AUDIT historical entries stay as-is.
- **pr-check:** keep `Keyword Command Center summary/detail must not use full model` (anti-reintroduction) and `Local SEO Evaluated candidates gated`; the PageHeader check stops matching RankTracker automatically on deletion. New rule candidates: promote `route-fold-in-seo-ranks` grep to pr-check; (deferred) rank-color authority rule.
- **Flag lifecycle:** `keyword-hub` removalCondition explicitly requires: validated on staging → flipped → only surface → THEN delete flag + both legacy components + catalog/group entries. `keyword-universe-full`/`keyword-value-scoring` have their own removalConditions — **separate retirements**, not part of W4 (their flag-OFF code paths die when each is defaulted, independent of the Hub flip).
- **Coverage ratchet:** deleting KCC tests is safe only with equivalent Hub coverage for migrated features (panel mount, summary cards, drawer outcome, pin if ported); `verify:coverage-ratchet` gates each PR.
- **MCP:** zero contract changes (tools read data-model queries, not KCC routes).

## 4. Phasing & parallelization strategy

**Phase A — Hub parity + blockers (1 PR, parallel lanes; flag still OFF, zero user-visible change):**
- A1: Port LocalSeoVisibilityPanel (mode="keywords", idle-callback mount, market-drawer entry) + 5 summary metric cards + summary error band into Hub. *(sonnet)*
- A2: Hub drawer — outcome prop, wire "View replaced-by", pin toggle (per O2), RankHistoryChart fold into national-rank section. *(sonnet/opus)*
- A3: Hub UX blockers — filter reset, keepPreviousData, mobile overflow + x-scroll, filter-aware empty states, bulk-bar clearance. *(sonnet)*
- A4: redirect `+ location.search` (1 line + test), server `targetTab` repoint, variants per O3. *(haiku/sonnet)*
- File ownership is clean: A1 KeywordHub.tsx layout region; A2 drawer + RankTable; A3 HubKeywordList + useKeywordHubState; A4 App.tsx + server one-liner.

**Phase B — Flip (no PR or tiny PR):** staging validation pass (manual + e2e) → flip per O5 (recommend: change `defaultValue` to `true` in code so the state is versioned, rather than a DB override) → soak on staging → production.

**Phase C — Strip (1 PR after soak):** delete the 11 files + App.tsx/flag-fallback branches + dead server model path (~1,200 lines) + RankTracker-only endpoints (per O2) + flag catalog removal per lifecycle + docs renames + deprecation registry entries + checklist refresh. seo-ranks Page value: keep redirect through C; delete in a trailing commit/PR per O4 soak length.

**Hard sequencing:** A merges → B flips → soak → C strips. C must not start before B has soaked (the flag-OFF path is the rollback).

## 5. Model assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| A4 one-liners, C mechanical deletions | Haiku/Sonnet | Mechanical with verification |
| A1/A3 ports + UX fixes | Sonnet | Pattern-following, local judgment |
| A2 drawer + chart fold | Opus | Shared component, data-shape judgment |
| C dead-model-path excision | Opus | 1,200-line deletion needs blast-radius judgment |
| Reviews | Opus | Never downgrade reviewers |

## 6. Owner decisions (answered 2026-06-11)

- **O1 — ANSWERED: keyword-hub is GLOBALLY ON in production (DB override).** The Hub is the live surface; Phase A blockers are live bugs; production soak is already running; Phase B = align code default with production.
- **O2 — ANSWERED: port the pin toggle into the Hub drawer** (existing PATCH pin endpoint).
- **O3 — ANSWERED: drop variants.** VariantSubRow dies with KCC.
- **O4 — DEFAULT ADOPTED: redirect lives through Phase C + ~2 weeks, then a trailing deletion PR removes the Page value.**
- **O5 — ANSWERED: code default flip** (Phase B PR sets defaultValue true, matching the production override; rollback lever = DB override off).
