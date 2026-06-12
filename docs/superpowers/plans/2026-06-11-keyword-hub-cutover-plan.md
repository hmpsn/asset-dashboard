# Keyword Hub Cutover (W4) — Implementation Plan

> **Verified scope:** [2026-06-11-keyword-hub-cutover-audit.md](../audits/2026-06-11-keyword-hub-cutover-audit.md) (6-scan pre-plan audit; owner decisions O1–O5 recorded §6). Every file below appears in the audit with evidence.
> **Context that reshapes urgency:** `keyword-hub` is **globally ON in production** (DB override). The Hub is the live surface; Phase A items are live gaps. KCC/RankTracker are already dead paths in production.
> **Platform:** Claude/Anthropic ladder. **Bounded context:** analytics-intelligence (keyword surfaces).

## Phases

```
Phase A (1 PR, 4 parallel lanes — live-gap parity)   ← this PR
   ↓ merge + staging verify
Phase B (1 tiny PR — defaultValue true, aligns code with production)
   ↓ ~immediately (production soak already running since ~2026-06-10)
Phase C (1 PR — strip KCC/RankTracker/dead server path/docs/lifecycle)
   ↓ +2 weeks redirect soak
Phase D (trailing micro-PR — delete seo-ranks Page value + redirect + registry entry)
```

Rollback lever throughout A–B: DB override off (flag-OFF path stays intact until C).

## Phase A — Hub parity + live-gap fixes (4 parallel lanes)

### A1 — Local SEO panel + KPI summary port (Sonnet)
**Owns:** `src/components/KeywordHub.tsx` (layout regions only: summary cards, panel mount, summary error band), new Hub tests for these.
**Reads:** `KeywordCommandCenter.tsx` (:417-450 reference), `LocalSeoVisibilityPanel.tsx`, `SummaryMetric.tsx`.
**Contracts:**
- `LocalSeoVisibilityPanel` mounts in Hub with `mode="keywords"`, same idle-callback deferral pattern as KCC (mount after first rows render), `onOpenKeywords` wired to Hub's segment state. Market-setup drawer must be reachable from the Hub (it lives inside the panel).
- 5 KPI summary cards (In Strategy / Tracked / Local / Needs Review / Retired) from `useKeywordCommandCenterSummary` — reuse `SummaryMetric` (it will be KEPT, not deleted, if A1 imports it — update Phase C list accordingly) or an equivalent ui primitive.
- Summary-level fetch error renders a `role="status"` band (KCC :461-468 parity).
**Tests (write first):** panel renders in Hub (idle-callback flushed) with market-drawer trigger reachable; KPI cards render from summary fixture; summary error band on summary query failure.

### A2 — Hub drawer completeness (Opus)
**Owns:** `src/components/keyword-hub/*` (drawer call wiring), `src/components/keyword-command-center/KeywordDetailDrawer.tsx`, `src/components/shared/RankTable.tsx` (RankHistoryChart consumption only), drawer tests.
**Contracts:**
- Outcome chip: Hub's drawer invocation passes `outcome={detail.data?.outcome}` (KCC :622 parity).
- Pin toggle (O2): drawer exposes pin/unpin via the existing `PATCH /api/rank-tracking/:id/keywords/:keyword/pin` (RankTracker :231 reference); optimistic or invalidation-driven per existing mutation patterns; read-only Pinned badge (:401-402) becomes the toggle.
- "View replaced-by" button (:535-542) wired: navigates within Hub via `buildHubDeepLinkQuery(replacedBy)` (or `setSelectedKey` if in-Hub).
- `RankHistoryChart` (RankTable.tsx:21-57) folded into the drawer's national-rank section using the already-fetched `rankHistory` (:79) — multi-keyword trend parity so RankTracker can die.
**Tests:** outcome chip renders from detail fixture; pin toggle fires the PATCH with correct args and updates state; replaced-by navigates; history chart renders from rankHistory fixture.

### A3 — Hub UX blockers (Sonnet)
**Owns:** `src/components/keyword-hub/HubKeywordList.tsx`, `src/hooks/admin/useKeywordHubState.ts` (verify path), `src/hooks/admin/useKeywordCommandCenter.ts` (rows query option only), their tests.
**Contracts:**
- `setAdvancedFilter` resets page to 1 and clears selection (mirror `setSegment`).
- Rows query gets `placeholderData: keepPreviousData`.
- Mobile: header controls wrap below `sm`; list gets `overflow-x-auto` + min-width container (KCC parity).
- Empty states branch: unfiltered-and-empty → action-oriented EmptyState (add/import CTA); filtered → current "adjust filters" copy.
- Hub root gets bulk-bar clearance (`pb-24` KCC parity).
**Tests:** filter change resets page+selection; empty-state branches; (snapshot-free) class assertions for scroll container/clearance.

### A4 — Redirect + server repoint (Haiku)
**Owns:** `src/App.tsx` (line ~451 only), `server/keyword-command-center.ts` (targetTab literal only), `tests/component/seoRanksRedirect.test.tsx`.
**Contracts:** redirect preserves `location.search`; server action `targetTab: 'seo-ranks'` (:738) → `'seo-keywords'`. Extend redirect test with a `?q=&tab=` preservation assertion.

**Dependencies:** all four lanes parallel; A1 and A2/A3 own disjoint files (A1 = KeywordHub.tsx only; A3 = keyword-hub subdir + hooks; A2 = drawer + RankTable). No shared-contract pre-commit needed (all consumed types exist).

## Phase B — Code default flip (Haiku, 1-line + catalog note)
`shared/types/feature-flags.ts`: `keyword-hub` `defaultValue: true` + lifecycle note ("matches production override since 2026-06-10; override becomes redundant"). Run `npm run verify:feature-flags`. Flag-OFF code paths untouched (rollback lever).

## Phase C — Strip (after B merges; 2 lanes)
### C1 — Frontend deletions (Sonnet)
Delete: `KeywordCommandCenter.tsx`, `RankTracker.tsx`, `KeywordRow.tsx`, `KeywordSparkline.tsx`, `VariantSubRow.tsx`, `KeywordDetailPanel.tsx` (orphan), (`SummaryMetric.tsx` only if A1 didn't adopt it); tests `KeywordCommandCenter.test.tsx`, `KeywordCommandCenterDeepLink.test.tsx`, `KeywordActionMenu.b1.test.tsx`, `RankTracker.test.tsx`; App.tsx lazy imports + flag conditionals (:435-436 → unconditional Hub; :452 RankTracker case; flag read :260 if unused after); flag-OFF fallbacks in `WorkspaceHome.tsx:65`, `RankingsSnapshot.tsx:27`, `MeetingBriefPage.tsx:59`; rename `KeywordCommandCenter-ws-invalidation.test.tsx` → reflects registry contract; update `rank-tracking-key-collapse.test.ts:66-68`. **KEEP:** seo-ranks redirect (until D), shared drawer/menu/bulk components + helpers, all queryKeys/hooks/wsInvalidation (Hub uses them), statusConfig domain.
### C2 — Server + flag + docs (Opus)
Delete `buildKeywordCommandCenterModel()` + `buildKeywordCommandCenterRowsViaModel()` + `includeLocalSeoDetails` plumbing (~1,200 lines; verify zero callers first); RankTracker-only `DELETE /keywords/:keyword` rank-tracking endpoint (pin endpoint SURVIVES per O2); remove `keyword-hub` from catalog + groups + all `useFeatureFlag('keyword-hub')` reads + navRegistry flagBehavior (per flag lifecycle — only after B verified); docs: rename `docs/rules/keyword-command-center.md` → `keyword-hub.md` (+ CLAUDE.md doc-table anchor + grep all docs/rules for the old name per the retired-name rule), BRAND_DESIGN_LANGUAGE §rename, deprecation-lifecycle entries, route-removal-checklist refresh (registry-driven reality), roadmap + FEATURE_AUDIT notes. Coverage ratchet must stay green (`npm run verify:coverage-ratchet`).

## Phase D — Trailing deletion (Haiku, ~2026-06-25)
Delete `'seo-ranks'` from the Page union + App.tsx redirect line + navRegistry entry + contract-test expectations + `route-fold-in-seo-ranks.test.ts` conversion to "route retired" guard. One commit; typecheck enforces completeness.

## Systemic improvements
- pr-check: promote the `route-fold-in-seo-ranks` grep into a pr-check rule (C2).
- Keep anti-reintroduction rules (`summary/detail must not use full model`, Evaluated-candidates gating) — they survive deletion.
- Deprecation registry entries (KCC, RankTracker, seo-ranks) per docs/rules/deprecation-lifecycle.md.

## Verification strategy
- Per lane: targeted vitest + `npm run typecheck`; controller runs full component+unit + pr-check + build per phase.
- Phase A acceptance: with flag ON, the Hub offers everything production-KCC-users lost — panel (incl. market drawer), KPI cards, pin, outcome chips, history chart; mobile usable at 380px.
- Phase B: `npm run verify:feature-flags`; staging smoke.
- Phase C: typecheck proves no dangling imports; full suite; coverage ratchet; `grep -r "KeywordCommandCenter\b" src/` returns only the shared subdir; deploy staging → verify Hub unaffected.
- Phase D: typecheck + contract tests.

## Execution discipline
Per task: READ the real code first; write the failing test from the contracts above and RUN it (red); implement minimally; green + typecheck; report. Never transcribe plan text as code. If real code contradicts a contract here, STOP and report.
