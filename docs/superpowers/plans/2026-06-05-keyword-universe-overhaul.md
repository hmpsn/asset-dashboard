# Keyword Universe Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is contract + test-centric** (per `docs/PLAN_WRITING_GUIDE.md`): it locks in **contracts, test assertions, and constraints** — NOT pre-written implementation bodies. For each task the executor MUST: (1) READ the real current code at the cited file:line; (2) write the failing test from the assertions below and RUN it (confirm it fails for the right reason); (3) implement minimally against the **real** signatures; (4) RUN test (green) + `npm run typecheck`; (5) commit. Never transcribe; never skip the red. **If the real code contradicts a contract here, STOP and report.**

**Goal:** Make the Keyword Command Center surface the *complete, trustworthy* keyword universe — every keyword the client ranks for (GSC) **plus** every high-value not-yet-ranking opportunity (strategy, competitor gaps, research, client-recommended) — with junk stripped, honest metric windows, and sorts that actually sort.

**Architecture:** The row assembly (`server/keyword-command-center.ts`) already uses a **two-stage, page-bounded** pipeline: cheap *candidate keys* are gathered + sorted + paginated, then only the current page's keys are evaluated into full rows. The expensive work is therefore already O(page). This plan (a) widens the candidate universe (remove the row caps; include all GSC-clicked queries) — cheap because candidates are just strings+numbers and evaluation stays page-bounded; (b) adds a malformed-string junk gate + applies the existing relevance gate to discovery candidates only; (c) fixes the sort enum + direction + the two-sorter drift; (d) unifies + labels the 28-day metric window and restores the truncation-honesty banner; (e) stops the normalizer from collapsing symbol-distinct keywords.

**Tech Stack:** TypeScript (strict), Express + better-sqlite3 (SQLite, WAL), React 19 + React Query, Vite, Vitest. Agent platform: **Claude / Anthropic** (Haiku / Sonnet / Opus ladder).

---

## Pre-requisites

- [x] Exhaustive data audit complete (serves as the spec/scope): `tasks/w46wh93tb` — 7 confirmed findings, all 4 owner questions answered.
- [x] Owner direction: *"show ANY keyword that received clicks through GSC + strategy keywords + client-recommended; **also** identify NEW not-yet-ranking keywords (competitor gaps, research); strip the junk; paginate if slow; lose the cap."*
- [ ] Phase 0 shared contracts committed before any parallel work (this plan, Task 0).
- [ ] Feature flag `keyword-universe-full` added to `shared/types/feature-flags.ts` (Task 0).

---

## The Coverage Contract (the centerpiece — read before any task)

The keyword universe is the **union of three populations**, each kept **in full** (uncapped, paginated), with a **two-tier junk gate**:

| Population | Sources | Inclusion rule | Junk gating |
|---|---|---|---|
| **A. Ranking (empirical)** | GSC snapshot queries the site ranks for | **Every query with `clicks > 0` OR `impressions > 0`** (today: capped at top-50-by-impressions — REMOVE the cap) | **Tier-1 only** (malformed-string). These are real searches; never drop for low value. |
| **B. Curated (chosen)** | strategy keywords, tracked keywords, client feedback (approved/requested) | **All** (already uncapped) | **Tier-1 only.** Human/strategy-chosen; never relevance-gated. |
| **C. Discovery (opportunity, NOT-yet-ranking)** | competitor `keyword_gaps`, provider keyword research/ideas, AI `content_gaps` | **All that pass both gates** | **Tier-1 AND Tier-2** (relevance). This is where boolean-query junk + low-value noise lives. |

**Two-tier junk gate:**
- **Tier 1 — `isJunkKeywordString(keyword)` (NEW, ALL populations):** rejects malformed strings — boolean operators (` or `, ` and `, ` not `, quotes `"`/`'`, parentheses), research syntax (`site:`, `intitle:`, `inurl:`, `filetype:`), token-count or length outliers, sub-3-char normalized. This strips the owner's example `"teeth whitening" "new patient" discount or special or package or offer`.
- **Tier 2 — `isStrategyPoolEligibleKeyword(keyword, ctx)` (EXISTING, population C ONLY):** the relevance/low-actionability gate (`server/keyword-intelligence/rules.ts:318`). KEEPS high-value discovery, drops noise. **Never applied to A or B** — a clicked or client-chosen keyword stays even if it would fail this heuristic.

**Non-negotiable invariant (the owner's core requirement):** *a high-value, not-yet-ranking competitor-gap keyword (0 clicks, 0 impressions, real volume) is RETAINED; a malformed boolean-query string is DROPPED.* This is the headline test (Task 2).

---

## Bounded Context & Integration Surface

- **Owning bounded context:** `analytics-intelligence` (per `docs/rules/platform-organization.md`). Keyword work lives in `server/keyword-command-center.ts`, `server/keyword-intelligence/`, `server/keyword-gaps.ts`, `server/content-gaps.ts`, `server/rank-tracking*.ts`, `server/search-console.ts`; shared types in `shared/types/keyword-command-center.ts`; UI in `src/components/keyword-hub/`, `src/components/KeywordHub.tsx`, `src/components/shared/RankTable.tsx`.
- **Route/API surface:** `GET /api/webflow/keyword-command-center/:workspaceId/rows|summary` (no new routes). The rows query gains a `direction` field (backward-compatible optional).
- **Shared type contracts (changed):** `KeywordCommandCenterSort`, `KeywordCommandCenterRowsQuery` (`shared/types/keyword-command-center.ts:264,276`); `RowCandidateKey` (`server/keyword-command-center.ts:1713`); `FEATURE_FLAG_CATALOG` (`shared/types/feature-flags.ts`).
- **React Query keys / invalidation:** `queryKeys.admin.keywordCommandCenterRows|Summary` (`src/lib/queryKeys.ts:85`), invalidated on `WS_EVENTS.STRATEGY_UPDATED` + `RANK_TRACKING_UPDATED` (`server/ws-events.ts:133-134`). No change.
- **Work classification:** mostly **new behavior** (coverage + junk gate + sorts), with **behavior-preserving** flag-OFF parity for the coverage expansion (Task 3 gated behind `keyword-universe-full`).

### Grounded current-state facts (verified, do not re-derive)

- Entry: `buildKeywordCommandCenterRows(workspaceId, query, options)` (`keyword-command-center.ts:2190`) → SKINNY path (page-bounded eval) for all filters except `LOCAL_CANDIDATES` → MODEL path (full eval).
- `RowCandidateKey { key, keyword, sourcePriority(0-6), demand, rank?, searchText? }` (`:1713`). **No `clicks`, no `difficulty`.** `addCandidateKey(candidates, keyword, sourcePriority, demand=0, rank?, searchText?)` (`:1722`).
- Caps: `RANK_EVIDENCE_ROW_LIMIT=50` applied in `addCandidateKeysFromBundle` at `:1777-1779` (`.slice(0,50)` after sort-by-impressions); `RAW_EVIDENCE_ROW_LIMIT=75` in `finalizeDraftRows:1183`; `LOCAL_CANDIDATE_ROW_LIMIT=75` at `:1272-1286`.
- Sort: `KeywordCommandCenterSort = 'priority'|'keyword'|'demand'|'rank'` (`shared/types/...:264`) — NO clicks/difficulty/date. `KeywordCommandCenterRowsQuery` (`:276`) — NO direction. Two sorters: `candidateSortForQuery` (`keyword-command-center.ts:1792`, on candidates, pre-pagination, called `:1833`) + `sortRowsForQuery` (`:681`, on rows, called `:2089,2146`). Base `sortRows` (`:664`). Neither applies direction. Frontend `hubSortToKccSort` (`KeywordHub.tsx:80`) maps clicks/date→`priority`, change/position→`rank`, volume/difficulty→`demand`; `rowsQuery` useMemo (`:155`) omits `hub.sort.direction`.
- Window: `getSearchOverview`/`getSearchQueryObservations(days=28)` (`search-console.ts:193,299`), `endDate=today-3`, `startDate=endDate-28`. Scheduler passes 28 (`rank-tracking-scheduler.ts:44`). **Manual capture route passes 7** (`server/routes/rank-tracking.ts` — the collision). Snapshots upsert keyed `(workspace_id, date)` (`rank-tracking.ts:77-80`); `getLatestSnapshotRanks` (untracked-inclusive, used by KCC) vs `getLatestRanks` (`:412,416`).
- Honesty banner: legacy KCC renders "Showing X of Y raw-evidence-only terms" when `rawEvidenceTotal > rawEvidenceReturned` (`KeywordCommandCenter.tsx:581`); `KeywordHub`/`keyword-hub/*` do NOT. Summary type carries `rawEvidenceTotal`/`rawEvidenceReturned` (`shared/types/...:266`).
- Junk gate: `isStrategyPoolEligibleKeyword(kw, ctx={}) → { suppressed, reasons, scoreDelta }` (`keyword-intelligence/rules.ts:318`); applied only in strategy synthesis/sanitizer, **not** to KCC evidence rows. No boolean/quote/length gate anywhere.
- Normalizer: `normalizeKeywordForComparison` = lowercase + `[^a-z0-9\s]→space` + collapse + trim (`shared/keyword-normalization.ts:8`); `keywordComparisonKey`/`keywordTrackingKey` wrap it. Collapses `C#`/`C++`/`AT&T`. Dedup via `ensureRow` (`keyword-command-center.ts:229`).
- Tests: next free integration port **13902**. Existing: `tests/unit/keyword-command-center*.test.ts`, `tests/integration/keyword-command-center-routes.test.ts` (13360), `keyword-hub-list.test.ts` (13900), `rank-tracking-*.test.ts`.

---

## Task List

> Each phase = **one PR** (CLAUDE.md phase-per-PR). Merge to `staging`, CI green, owner-verify before the next. Platform: Claude/Anthropic.

### Task 0 — Shared contracts (Model: **Sonnet**) — SEQUENTIAL, FIRST, its own PR

**Owns:** `shared/types/keyword-command-center.ts`, `shared/types/feature-flags.ts`, `shared/keyword-normalization.ts`, `server/keyword-command-center.ts` (the `RowCandidateKey` type + `addCandidateKey` signature ONLY), `server/keyword-intelligence/keyword-window.ts` (Create).
**Must not touch:** sorter bodies, candidate-gathering caps (later tasks).

**Contracts to add:**
- `KeywordCommandCenterSort` → add `'clicks' | 'difficulty'` (union becomes `'priority'|'keyword'|'demand'|'rank'|'clicks'|'difficulty'`).
- `KeywordCommandCenterRowsQuery` → add `direction?: 'asc' | 'desc'` (optional; default behavior unchanged when absent).
- `RowCandidateKey` → add `clicks?: number` and `difficulty?: number`. `addCandidateKey` → add trailing optional params `clicks?: number, difficulty?: number` (keep positional back-comat: `(candidates, keyword, sourcePriority, demand?, rank?, searchText?, clicks?, difficulty?)`).
- `shared/keyword-normalization.ts` → add `export function isJunkKeywordString(keyword: string | null | undefined): { isJunk: boolean; reason?: string }` (PURE; the Tier-1 gate). Reason codes: `'boolean_operator' | 'research_syntax' | 'too_long' | 'too_short' | 'quoted_phrases'`.
- `shared/types/feature-flags.ts` → add `keyword-universe-full` to `FEATURE_FLAG_CATALOG` (lifecycle `owner: 'analytics-intelligence'`, `rolloutTarget: 'staging-validation'`, dark/OFF, `createdAt`/`lastReviewedAt` a fixed past date to satisfy the lifecycle test's `asOf`). Add the key to `FeatureFlagKey`.
- `server/keyword-intelligence/keyword-window.ts` (new) → `export const GSC_METRIC_WINDOW_DAYS = 28;` (single source of truth for the window) + `export const GSC_DATA_LAG_DAYS = 3;`.

**Test assertions** (`tests/unit/keyword-junk-string.test.ts`, NEW):
- `isJunkKeywordString('teeth whitening')` → `{ isJunk: false }`.
- `isJunkKeywordString('"teeth whitening" "new patient" discount or special or package or offer')` → `{ isJunk: true, reason: 'quoted_phrases' }` (or `'boolean_operator'`).
- `isJunkKeywordString('best dentist near me')` → `{ isJunk: false }` (the word "near"/"me" must NOT trip the ` or `/` and ` operator check — match operators as whole tokens with surrounding spaces, and only when ≥1 quote present OR ≥2 operator tokens).
- `isJunkKeywordString('site:example.com pricing')` → `{ isJunk: true, reason: 'research_syntax' }`.
- `isJunkKeywordString('a')` → `{ isJunk: true, reason: 'too_short' }`.
- `isJunkKeywordString(null)` → `{ isJunk: true }` (defensive).
- A 220-char string → `{ isJunk: true, reason: 'too_long' }`.
- **Constraint:** the operator check must not false-positive on legitimate keywords containing the substrings "or"/"and" inside words ("organic", "android") — tokenize, don't substring.

**Constraints:** pure functions only (no I/O); `isJunkKeywordString` operates on the RAW string (before normalization) so it can see quotes/operators that the normalizer would strip. Run `npm run verify:feature-flags` after the flag edit.

**Verify:** `npx vitest run tests/unit/keyword-junk-string.test.ts`; `npm run typecheck`; `npm run verify:feature-flags`.

---

### Task 1 — Sort correctness: clicks/difficulty + direction + unify the two sorters (Model: **Opus**) — depends on Task 0; own PR; UNFLAGGED

**Owns:** `server/keyword-command-center.ts` (the sorter functions + the candidate-gathering metric capture for clicks/difficulty), `src/components/KeywordHub.tsx` (`hubSortToKccSort` + `rowsQuery`).
**Must not touch:** the caps (Task 3), the junk gate (Task 2).

**Contracts:**
- Introduce ONE comparator source of truth: `keywordSortComparator(sort, direction)` returning a comparator usable by BOTH stages via field accessors, so `candidateSortForQuery` and `sortRowsForQuery` cannot drift. (Implementation may be a shared key→accessor map consumed by two thin adapters — executor decides against real code.)
- `addCandidateKey` calls in `addCandidateKeysFromBundle` must now pass `clicks` and `difficulty` where the source has them (GSC ranks carry clicks/impressions; strategy/gap candidates carry difficulty). RowCandidateKey gains populated `clicks`/`difficulty`.
- `hubSortToKccSort`: `keyword→keyword`, `position→rank`, `clicks→clicks`, `volume→demand`, `difficulty→difficulty`. (`change`/`date` are not rendered columns — leave mapped to a harmless default; do NOT expose them as sortable headers.)
- `rowsQuery` useMemo: add `direction: hub.sort.direction` to the payload AND to the dependency array.

**Test assertions:**
- *Unit* (`tests/unit/keyword-command-center-sort.test.ts`, NEW): given candidate/row fixtures with known clicks/difficulty/position/volume:
  - `sort='clicks'` orders by `metrics.clicks` desc; `direction:'asc'` reverses it.
  - `sort='difficulty'` orders by `metrics.difficulty` (NOT volume).
  - `sort='rank'` puts `currentPosition:1` before `:9`; missing position sorts last in BOTH directions (null is always last, not flipped).
  - **Drift guard:** for each sort, `candidateSortForQuery`-ordered keys === `sortRowsForQuery`-ordered keys for the same fixture set (page-1 == global-top-N).
- *Integration* (`tests/integration/keyword-universe-sort.test.ts`, NEW, port **13902**): seed a workspace with 3 tracked keywords of known clicks; `GET .../rows?sort=clicks&direction=desc` returns them clicks-descending; `&direction=asc` reverses; `sort=difficulty` orders by KD.
- *Component* (extend `tests/component/KeywordHub.test.tsx` or NEW): clicking the Clicks header twice flips `rowsQuery.direction` from `desc`→`asc` (assert the rows hook is called with the new direction).

**Constraints:** null/undefined metric → always sorts last regardless of direction (do not let `desc` float nulls to the top). Keep `priority` (default) behavior byte-identical when `sort` is absent. The frontend already toggles direction in `useKeywordHubState.setSort` — only the query wiring is missing.

**Verify:** the 3 test files above; `npm run typecheck`; `npx vite build`.

---

### Task 2 — Two-tier junk gate (Model: **Opus**) — depends on Task 0; own PR; UNFLAGGED

**Owns:** `server/keyword-command-center.ts` (apply gates at the candidate boundary in `addCandidateKeysFromBundle`), `server/keyword-gaps.ts` + `server/content-gaps.ts` (Tier-1 at ingestion write boundary — optional belt-and-suspenders).
**Must not touch:** sorters (Task 1), caps (Task 3).

**Contracts:**
- In `addCandidateKeysFromBundle`, before `addCandidateKey(...)`:
  - **All populations:** skip the candidate if `isJunkKeywordString(keyword).isJunk` (Tier 1).
  - **Population C only** (raw `keyword_gaps`, provider research, `content_gaps` — `sourcePriority` 1 for content gaps and 4 for raw gaps, per `:1769,:1782`): additionally skip if `isStrategyPoolEligibleKeyword(keyword, ctx).suppressed` (Tier 2). Populations A (GSC ranks, `sourcePriority 2` from `:1779,:1788`) and B (strategy `0`, tracked, feedback) get **Tier 1 only**.
- The relevance gate's `ctx` should mirror how strategy synthesis builds it (read `keyword-strategy-ai-synthesis.ts:462`) — do not invent a new context shape.

**Test assertions** (`tests/integration/keyword-universe-junk.test.ts`, NEW, port **13903**):
- **HEADLINE (the owner's invariant):** seed a competitor-gap keyword `{ keyword: 'invisalign cost', volume: 1900, difficulty: 40, competitorPosition: 4 }` with **0 clicks/0 impressions** → it **appears** in `GET .../rows?filter=all` (not-yet-ranking discovery is retained).
- Seed a `keyword_gaps`/content-gap row with `keyword: '"teeth whitening" "new patient" discount or special or package or offer'` → it is **absent** from rows (Tier-1 dropped).
- Seed a GSC ranking query `{ query: 'cosmetic dental specials', clicks: 12 }` that would FAIL the relevance heuristic → it **still appears** (Tier-2 NOT applied to ranking population).
- Seed a low-actionability provider gap matching `LOW_ACTIONABILITY_PHRASES` → **absent** (Tier-2 dropped).
- *Unit* (extend `tests/unit/keyword-command-center.test.ts` or NEW pure test): the per-population gating predicate returns the right keep/drop for one fixture of each population.

**Constraints:** Tier-2 must receive the SAME context strategy uses (else it over/under-suppresses). Do NOT relevance-gate populations A/B. Log (Pino `debug`) the count dropped per tier per workspace for observability (no PII).

**Verify:** the 2 test files; `npm run typecheck`; manual `curl` of `.../rows?filter=all` on a seeded workspace shows junk gone, discovery kept.

---

### Task 3 — Uncap the universe (Model: **Opus**) — depends on Task 2; own PR; **FLAG-GATED `keyword-universe-full`**

**Owns:** `server/keyword-command-center.ts` (the three caps + the GSC-rank candidate selection + summary honest counts).
**Must not touch:** sorters, junk gate internals.

**Contracts:**
- Gate the new behavior on `isFeatureEnabled(workspaceId, 'keyword-universe-full')` (read the real flag-read helper; do NOT hard-flip). Flag OFF → today's behavior byte-identical.
- Flag ON:
  - **GSC ranks (population A):** replace the `top-50-by-impressions` `.slice(0, RANK_EVIDENCE_ROW_LIMIT)` (`:1777-1779`) with: include **every** snapshot query with `clicks > 0 OR impressions > 0` (junk-gated by Task 2), up to a generous safety ceiling `UNIVERSE_SAFETY_CEILING = 2000`.
  - **Raw evidence (`RAW_EVIDENCE_ROW_LIMIT`, `:1183`) and local candidates (`:1272-1286`):** raise to the same safety ceiling (or remove the per-bucket cap and rely on the global ceiling).
  - **Honest count:** `rawEvidenceReturned`/the page total must reflect the true post-gate universe size; if the safety ceiling truncates, `rawEvidenceTotal > rawEvidenceReturned` so the banner (Task 4) fires.
- Performance guard: the candidate Map may now hold thousands of cheap `RowCandidateKey`s — that is fine (strings+numbers). Evaluation stays page-bounded (the skinny path). The MODEL path (`LOCAL_CANDIDATES` filter, full eval) keeps a cap to avoid OOM — document this exception inline.

**Test assertions** (`tests/integration/keyword-universe-coverage.test.ts`, NEW, port **13904**):
- Seed 60 GSC ranking queries with clicks (above the old 50-cap). Flag **ON** → all 60 appear across pages (`pageInfo.totalRows >= 60`). Flag **OFF** → ≤50 (old behavior preserved).
- Flag ON, a clicked query that was rank #80-by-impressions (previously dropped by the 50-cap) is present.
- Flag ON with >2000 candidates → `pageInfo.totalRows === 2000` and `rawEvidenceTotal > rawEvidenceReturned` (ceiling honestly disclosed).
- Performance smoke: seed ~1500 candidates, assert `GET .../rows?page=1&pageSize=50` returns within a generous time budget and evaluates only ~50 rows (assert via a row-count side-channel or that detail-only fields are absent on list rows).

**Constraints:** flag-OFF parity is the hard bar (a flag-OFF integration assertion proving identical output to pre-change). The safety ceiling is a backstop, not the product cap — log when hit.

**Verify:** the coverage test (both flag states); `npm run verify:feature-flags`; staging: flip flag, confirm coverage jump + page perf.

---

### Task 4 — Trust signals: unify window + label + honesty banner (Model: **Sonnet**) — depends on Task 0; own PR; UNFLAGGED

**Owns:** `server/routes/rank-tracking.ts` (manual capture days), `server/rank-tracking-scheduler.ts` + `server/search-console.ts` (consume `GSC_METRIC_WINDOW_DAYS`), `src/components/keyword-hub/HubKeywordList.tsx` or `src/components/KeywordHub.tsx` (window label + honesty banner).
**Must not touch:** assembly/sort/caps.

**Contracts:**
- Replace the literal `7` in the manual capture route and the `28` in the scheduler/search-console calls with `GSC_METRIC_WINDOW_DAYS` (Task 0) so manual + scheduled snapshots use the **same** window (kills the ~4× swing).
- Hub UI: render a window label "Clicks & impressions: last 28 days · rank: 28-day avg · volume: provider estimate" near the list header (use existing `t-caption`/muted-text tokens; Four Laws — blue for data context, no new hues). Surface it from `GSC_METRIC_WINDOW_DAYS` (don't hard-code "28" twice).
- Hub UI: render the truncation banner when `summary.rawEvidenceTotal > summary.rawEvidenceReturned` (mirror `KeywordCommandCenter.tsx:581` text), using a primitive (`SectionCard`/muted), in `src/components/keyword-hub/*`.

**Test assertions:**
- *Integration* (extend `tests/integration/rank-tracking-routes.test.ts`): the manual capture route invokes the GSC fetch with `days === GSC_METRIC_WINDOW_DAYS` (28), not 7. (Assert via the mocked `search-console` provider call args.)
- *Component* (extend `tests/component/KeywordHub.test.tsx`): with a summary where `rawEvidenceTotal(120) > rawEvidenceReturned(75)`, the banner text "Showing 75 of 120" renders; with equal values it does not. The "last 28 days" label renders whenever rows render.

**Constraints:** label copy follows `docs/workflows/ui-vocabulary.md`; no purple; banner uses a primitive, not hand-rolled card. Changing the manual-capture window is a behavior change to the live Rank Tracker — note it in the PR; it only makes manual snapshots consistent with the daily ones.

**Verify:** the 2 tests; `npx vite build`; staging: capture a manual snapshot, confirm clicks/impressions no longer swing vs the daily snapshot; confirm label + banner.

---

### Task 5 — Normalization symbol-preservation (Model: **Opus**) — depends on Task 0; own PR; UNFLAGGED; **RISKIEST — may be deferred**

**Owns:** `shared/keyword-normalization.ts`.
**Must not touch:** anything else.

**Contracts:**
- `normalizeKeywordForComparison` must NOT collapse meaning-distinct symbol keywords. Minimal, conservative approach: before stripping, map a small allowlist of symbol-bearing terms to distinct tokens (`c#→csharp`, `c++→cplusplus`, `f#→fsharp`, `.net→dotnet`, `&→ and ` only when flanked by word chars e.g. `at&t→at and t`). Preserve Unicode letters/numbers via `\p{L}\p{N}` (u flag) so diacritics aren't dropped to collisions. Do the MINIMUM that resolves real collisions; do not rewrite the normalizer wholesale.

**Test assertions** (`tests/unit/keyword-normalization.test.ts`, EXTEND):
- `normalizeKeywordForComparison('C#') !== normalizeKeywordForComparison('C')`.
- `normalizeKeywordForComparison('C++') !== normalizeKeywordForComparison('C')`.
- `normalizeKeywordForComparison('AT&T') !== normalizeKeywordForComparison('att')` (or documents the chosen mapping).
- Regression: existing assertions in this file still pass (lowercasing, whitespace collapse, plain-keyword identity) — run the WHOLE file.

**Constraints (READ BEFORE STARTING):** `keywordComparisonKey`/`keywordTrackingKey` wrap this normalizer and are used for **dedup, tracked-keyword identity, and `?q=` deep-links**. Changing normalization changes keyword IDENTITY across the system. Verify no stored key depends on the OLD normalization (tracked_keywords store the raw query and normalize at read — confirm by reading `rank-tracking.ts`). If any stored/compared key would shift, **STOP and report** — this may need a migration or to be deferred. Run the FULL `npx vitest run` (not just the normalizer file) because many surfaces consume this function. **If the blast radius is non-trivial, ship Tasks 0-4 and defer this task to a separate owner-approved PR.**

**Verify:** `npx vitest run` (FULL suite); `npm run typecheck`.

---

## Task Dependencies

```
Sequential (shared file server/keyword-command-center.ts + shared types):
  Task 0 (contracts)  →  Task 1 (sort)  →  Task 2 (junk gate)  →  Task 3 (uncap)

Parallel after Task 0 (different files):
  Task 4 (trust signals: routes/search-console/frontend)  ∥  Task 5 (normalizer)

Merge order (phase-per-PR, each verified on staging before next):
  0 → 1 → 2 → 3 → 4 → (5 optional/deferred)
```

Tasks 1, 2, 3 all modify `server/keyword-command-center.ts` → strictly sequential. Tasks 4 and 5 own disjoint files and may be built in parallel after 0, but still merge one-PR-at-a-time.

## Cross-Phase Contracts (Task 0 exports for downstream)

```
Shared types (Tasks 1-4 import):
  KeywordCommandCenterSort (+ 'clicks' | 'difficulty')        shared/types/keyword-command-center.ts
  KeywordCommandCenterRowsQuery.direction?: 'asc'|'desc'      shared/types/keyword-command-center.ts
  RowCandidateKey.clicks? / .difficulty?                      server/keyword-command-center.ts
  isJunkKeywordString(kw) → { isJunk, reason? }               shared/keyword-normalization.ts
  GSC_METRIC_WINDOW_DAYS = 28, GSC_DATA_LAG_DAYS = 3          server/keyword-intelligence/keyword-window.ts
  FEATURE_FLAG_CATALOG['keyword-universe-full']               shared/types/feature-flags.ts
```

## Systemic Improvements

- **Shared utilities extracted:** `isJunkKeywordString` (Tier-1 gate, reused by KCC + ingestion); `GSC_METRIC_WINDOW_DAYS` constant (kills the 7-vs-28 duplication); a single `keywordSortComparator` consumed by both sorters (kills the two-sorter drift class of bug — audit finding #3).
- **pr-check rule to add:** flag a literal day-count (`, 7,` / `, 28,`) passed to `getSearchOverview`/`getSearchQueryObservations` outside `keyword-window.ts` — forces the constant. (Author per `docs/rules/pr-check-rule-authoring.md`.)
- **New tests:** junk-string unit, sort unit + integration + component, junk-gate integration (headline invariant), coverage integration (flag both states + perf), window/banner integration + component, normalization collisions.
- **Feature-class gates** (`docs/workflows/feature-class-definition-of-done.md`): analytics/data feature → integration test exercises the real read path (the `rows` endpoint, not a helper); flag-OFF parity test; observability log lines for dropped/capped counts.

## Model Assignments (Claude / Anthropic ladder)

| Task | Model | Why |
|---|---|---|
| 0 Contracts | Sonnet | Typed contract edits + one pure function + flag entry |
| 1 Sort | **Opus** | Two-sorter unification + direction threading = broad blast radius, drift risk |
| 2 Junk gate | **Opus** | Per-population gating judgment; the headline correctness invariant |
| 3 Uncap | **Opus** | Flag-gated behavior change to the shared assembly + perf reasoning |
| 4 Trust signals | Sonnet | Constant swap + two UI elements with local patterns |
| 5 Normalizer | **Opus** | Core identity function; cross-system blast radius |
| Spec + code-quality reviewers | **Opus** | Never downgrade reviewers |

## Verification Strategy

- Per task: the exact `npx vitest run <file>` commands above + `npm run typecheck` + (UI tasks) `npx vite build`.
- Pre-PR each phase: `npx tsx scripts/pr-check.ts`, `npx tsx scripts/report-style-drift.ts` (UI), `npm run verify:feature-flags`, `npm run verify:coverage-ratchet`.
- Multi-agent batch (this plan uses parallel agents) → invoke `scaled-code-review` before merge; adversarially verify each finding (revert-and-confirm-red on every new test).
- Staging (per phase): Task 1 — sort each column both directions; Task 2 — confirm the boolean junk is gone and a known not-yet-ranking gap keyword is present; Task 3 — flip `keyword-universe-full`, confirm the coverage jump + page-load perf, flip OFF for parity; Task 4 — manual-capture-vs-daily click consistency + the window label/banner.
- **Staging gate:** all PRs → `staging` first; owner verifies the assembled behavior flag-ON; only then `staging` → `main`.

---

## Self-Review (run before handing off)

**Spec coverage:** Owner's 4 asks → (1) clicks sort = Task 1; (2) metric window labeled/unified = Task 4; coverage incl. branded/not-yet-ranking = Tasks 2+3 (Coverage Contract populations A+C); (3) strip junk = Task 2; (4) overall trust = all. The not-yet-ranking-discovery invariant = Task 2 HEADLINE test. ✅ no gaps.
**Placeholder scan:** no "TBD"/"add error handling"/vague steps — every task has concrete contracts + assertions. ✅
**Type consistency:** `keyword-universe-full` (flag), `isJunkKeywordString` (signature), `GSC_METRIC_WINDOW_DAYS`, `RowCandidateKey.clicks/difficulty`, `direction?` — names used identically across tasks. ✅
**Risk:** Task 5 (normalizer) flagged deferrable with a STOP-and-report blast-radius gate; Task 3 flag-gated with a flag-OFF parity bar. ✅
