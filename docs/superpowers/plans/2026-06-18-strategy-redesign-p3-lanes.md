# Strategy Redesign Phase 3 — Lane Plan (Managed Sets + Send Spine + Migration 139)

> **Phase:** P3 of the synthesized strategy-redesign plan (`docs/superpowers/plans/2026-06-18-strategy-redesign-synthesized-plan.md`)
> **Date:** 2026-06-18
> **Branch base:** `strategy-redesign-review-fixes` (continues the v3 line, P1+P2 merged to staging)
> **Cadence:** pre-commit shared contracts → parallel implementers → controller commits → two-stage review (scaled-code-review)
> **Umbrella flag:** `strategy-command-center` (existing, default `false`)
> **Child flag introduced this phase:** `strategy-keywords-managed-set` (default `false`)

---

## Phase 3 scope summary (from synthesized plan §7 P3)

- Migration 139 (`strategy_keyword_set` dedicated table) + `reconcileStrategyKeywordSet` wired into `persistKeywordStrategy`'s `writeKeywordStrategy` transaction (`server/keyword-strategy-persistence.ts:169`), after the existing sibling reconcilers (`:212-214`).
- `addStrategyKeyword` / `removeStrategyKeyword` / `keepStrategyKeyword` + auto-replenish + search-and-add + add-from-client-requests, all behind `strategy-keywords-managed-set`.
- Managed-set UI: add/remove/keep, three visual states, "Added from opportunities" annotation.
- Managed Topic Clusters + Content Gaps via `tracked_actions` keep (`topic_cluster_keep` / `content_gap_keep` enum values + cross-reference read).
- Send-to-client on Decaying Pages (`content_refresh` rec) + Keyword Opportunities (`keyword_gap` rec minted at regen) via `sendRecommendation()`.
- `WhyHowResult` presenter — shared component wired to every send-eligible surface.
- Brief pre-seed: extend the EXISTING `FixContext` (`src/App.tsx:77-98`) with 6 optional fields + all four receiver layers.
- New WS event `STRATEGY_KEYWORD_SET_UPDATED` + frontend handler + 3 `ActivityType` values.
- Two new pr-check rules: `incomplete-rec-filter` + `strategy-send-must-route-through-lifecycle`.

**What this phase does NOT touch:** signal-fold / mint-at-gen-time (`mintSignalRecs`) — that is P4. Competitor RecType lockstep — P4. Config consolidation / Local SEO dedup — P4.

---

## Pre-commit shared contracts (MUST be committed before lanes fan out)

All items below go in ONE pre-commit, merged to the branch before any parallel implementer starts. No agent starts work until this commit is green on CI.

### Contract C1 — Child feature flag (`shared/types/feature-flags.ts`)

Add `strategy-keywords-managed-set` to:
1. `FEATURE_FLAG_DEFAULTS` map (default `false`).
2. `FEATURE_FLAG_CATALOG` with `group: 'Strategy'`, `lifecycle.owner: 'analytics-intelligence'`, `lifecycle.createdAt: '2026-06-18'`, `lifecycle.rolloutTarget: 'staging-validation'`, `lifecycle.removalCondition` noting it gates the P3 managed-set write path, `lifecycle.staleAuditCadence: 'monthly'`.
3. `FEATURE_FLAG_GROUPS` — the `Strategy` group keys array (currently `['signal-auto-recompute', 'strategy-command-center', 'strategy-staleness-scan', 'strategy-paid-topics']`). Append `'strategy-keywords-managed-set'`.

**File owned:** `shared/types/feature-flags.ts`

### Contract C2 — `strategy_keyword_set` table types (`shared/types/strategy-keyword-set.ts`)

Create this NEW file. Define:

```ts
export type KeywordSetSource = 'regen_computed' | 'client_request' | 'manual_add';

export interface StrategyKeywordSetRow {
  id: number;
  workspaceId: string;
  keyword: string;          // normalized lowercase-trimmed
  source: KeywordSetSource;
  keptAt: string | null;    // ISO timestamp; set when operator explicitly keeps
  removedAt: string | null; // ISO timestamp; set when operator removes a slot
  slotOrder: number;
  createdAt: string;
}

/** A keyword is "in the managed set" iff removedAt IS NULL. */
export type ActiveStrategyKeyword = StrategyKeywordSetRow & { removedAt: null };
```

**File owned:** `shared/types/strategy-keyword-set.ts` (NET-NEW)

### Contract C3 — Migration 139 (`server/db/migrations/139-strategy-keyword-set.sql`)

```sql
-- Migration 139: Dedicated managed keyword set table.
-- The SOLE writer is reconcileStrategyKeywordSet() inside persistKeywordStrategy's
-- writeKeywordStrategy transaction (keyword-strategy-persistence.ts:169).
-- This table is NOT touched by replaceAllTrackedKeywordRows() (tracked-keywords-store.ts:282)
-- — the rank-tracking sync path that clobbered the unison "extend tracked_keywords" design.
CREATE TABLE IF NOT EXISTS strategy_keyword_set (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  keyword       TEXT NOT NULL,
  source        TEXT NOT NULL CHECK(source IN ('regen_computed','client_request','manual_add')),
  kept_at       TEXT,
  removed_at    TEXT,
  slot_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_strategy_keyword_set_ws ON strategy_keyword_set(workspace_id);
```

**File owned:** `server/db/migrations/139-strategy-keyword-set.sql` (NET-NEW)

### Contract C4 — `WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED` (`server/ws-events.ts`)

Add to the `WS_EVENTS` object (under the existing `STRATEGY_UPDATED` entry at line 139):

```ts
STRATEGY_KEYWORD_SET_UPDATED: 'strategy:keyword-set-updated',
```

**File owned:** `server/ws-events.ts`

### Contract C5 — `ActivityType` additions (`server/activity-log.ts`)

Append three values to the `ActivityType` union (after the existing `'post_voice_scored'` terminal at line 164). These are admin-only — NOT in `CLIENT_VISIBLE_TYPES`:

```ts
| 'strategy_keyword_kept'      // admin: operator pinned a keyword to the managed set
| 'strategy_keyword_removed'   // admin: operator removed a keyword from the managed set
| 'strategy_keyword_added'     // admin: operator manually added a keyword to the managed set
```

Note: `strategy_keyword_added` already appears at line 8 of `shared/types/outcome-tracking.ts` in `ActionType` (that union is separate — it tracks outcome intelligence actions). The `ActivityType` union in `server/activity-log.ts` is the activity-log type — a separate concern. Confirm no clash before the commit.

**File owned:** `server/activity-log.ts`

### Contract C6 — `ActionType` additions for tracked_actions keep (`shared/types/outcome-tracking.ts`)

Append two values to the `ActionType` union (after `'local_service_added'` at line 19):

```ts
| 'topic_cluster_keep'  // admin: operator marked a topic cluster as "keep" (survives regen)
| 'content_gap_keep'    // admin: operator marked a content gap as "keep" (survives regen)
```

**File owned:** `shared/types/outcome-tracking.ts`

### Contract C7 — `FixContext` extensions (`src/App.tsx`)

Extend the EXISTING `FixContext` interface at `src/App.tsx:77-98`. Add 6 optional fields after the existing `pageType` field:

```ts
// NET-NEW content-gap pre-seed fields (P3 brief pre-seed §5.5 — all optional so existing callers don't break)
rationale?: string;
competitorProof?: string;
volume?: number;
intent?: string;
questionKeywords?: string[];
serpFeatures?: string[];
```

**Invariant:** all fields `.optional()` — no existing caller breaks. The two ContentGaps senders (`ContentGaps.tsx:78` and `:86`) start passing these fields in Lane D.

**File owned:** `src/App.tsx` (type change only — one interface extension, no JSX change)

### Contract C8 — `queryKeys.admin.strategyKeywordSet` (`src/lib/queryKeys.ts`)

Add to the `admin` section of the `queryKeys` factory:

```ts
strategyKeywordSet: (wsId: string) => ['admin-strategy-keyword-set', wsId] as const,
```

**File owned:** `src/lib/queryKeys.ts`

### Contract C9 — pr-check rule stubs (`scripts/pr-check.ts`)

Add two new CHECKS entries. Both are mechanically simple pattern-based rules; they must be committed BEFORE parallel lanes so any lane that inadvertently violates them gets caught during the lane's own pr-check step.

**Rule 1 — `incomplete-rec-filter`:**
- Pattern: in files matching `src/components/strategy/**`, flag `status === 'dismissed'` or `status !== 'dismissed'` that does NOT appear alongside `isActiveRec` within 5 lines.
- Escape hatch: `// incomplete-rec-filter-ok`
- Message: "Strategy rec-listing filter uses status string directly without isActiveRec(). Route ALL rec visibility through isActiveRec() — see synthesized plan §3.5."

**Rule 2 — `strategy-send-must-route-through-lifecycle`:**
- Pattern: in files matching `src/components/strategy/**`, flag any call to `clientActions.create(` or any new string literal in the `ClientActionSourceType` union.
- Escape hatch: `// strategy-send-must-route-through-lifecycle-ok: <renderer name>`
- Message: "Strategy send path bypasses the rec lifecycle. Route through sendRecommendation() via the send spine — see synthesized plan §3.3. New ClientActionSourceType requires a bespoke client renderer; add the hatch if justified."

**File owned:** `scripts/pr-check.ts`

Run `npm run rules:generate` as part of the pre-commit to sync `docs/rules/automated-rules.md`.

---

## Intra-phase dependency ordering

```
Pre-commit contracts (C1–C9)
  ↓  (all merged before fan-out)
  ├── Lane A: Backend data model + reconciler (no frontend deps)
  ├── Lane B: pr-check rules + tests scaffold (no frontend deps, no Lane A dep)
  └── Lane C: WhyHowResult presenter + useShowMore extensions (no backend deps, needs shared type C2 only for type imports)
  │
  ↓  (wait for Lane A green before these two start — they call the new API endpoints and domain module)
  ├── Lane D: Managed-set UI + send wiring in Keywords & Rankings tab (depends on Lane A endpoints)
  └── Lane E: Content tab managed sets + brief pre-seed (depends on Lane A tracked_actions writes; brief layer depends on C7)
      │
      ↓  (Lane D + Lane E must both be green before this integration sweep)
      └── Lane F: Integration test suite (durability test, send-path public-read, fixContext both-halves)
```

Lane B can run in parallel with A and C from day 1. Lane C can run in parallel with A. Lanes D and E must wait for Lane A. Lane F is the final convergence point.

---

## Lane A — Backend data model, reconciler, domain module, and send-path wiring

**Model:** `claude-opus-4-5` (data-model + reconciler, transaction boundary, migration seam)

**Owns exclusively:**
- `server/db/migrations/139-strategy-keyword-set.sql` (pre-committed in C3; Lane A's job is the first `npm run db:migrate` run and any fixups)
- `server/domains/strategy/managed-keyword-set.ts` (NET-NEW domain module — create the `server/domains/strategy/` directory)
- `server/keyword-strategy-persistence.ts` (add `reconcileStrategyKeywordSet` call at line 215, after existing sibling reconcilers)
- `server/routes/keyword-strategy.ts` (add 4 new route handlers: `GET /api/keyword-strategy/:ws/keyword-set`, `POST /api/keyword-strategy/:ws/keyword-set/add`, `POST /api/keyword-strategy/:ws/keyword-set/remove`, `POST /api/keyword-strategy/:ws/keyword-set/keep`)
- `server/recommendation-lifecycle.ts` (add mint-at-regen step for `keyword_gap` + `content_refresh` recs — the send-spine wiring for Keyword Opportunities + Decaying Pages; these are existing RecTypes, no union change needed)

**Summary:** Creates the `server/domains/strategy/` directory and implements `managed-keyword-set.ts` with `createStmtCache()`/`stmts()` prepared statements, `rowToManagedKeyword()` mapper, and the five exported functions (`getStrategyKeywordSet`, `reconcileStrategyKeywordSet`, `addStrategyKeyword`, `removeStrategyKeyword`, `keepStrategyKeyword`). Grafts `reconcileStrategyKeywordSet(ws.id, strategy)` into `persistKeywordStrategy`'s `writeKeywordStrategy = db.transaction(...)` (`keyword-strategy-persistence.ts:169`) immediately after the existing three sibling reconciler calls (`:212-214`). Adds four HTTP route handlers in `server/routes/keyword-strategy.ts` with `broadcastToWorkspace(WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED)` on all mutations, calling `addActivity()` with the three new `ActivityType` values. The reconciler's auto-replenish step runs inside the same transaction: `SELECT` once to build a `Set`, diff against `strategy.siteKeywords`, insert net-new as `source:'regen_computed'`, then for each row with `removed_at` set fill from the opportunity pool ranked by `estimatedGain`/`opportunity_score`.

**Critical constraints:**
- NO AI calls inside `writeKeywordStrategy` transaction (pr-check `ai-call-before-db-write` rule — the reconciler is pure read-diff-insert).
- `removeStrategyKeyword` sets `removed_at`, NOT a hard delete (the row must persist for replenish-exclusion).
- All four route mutation handlers must call `db.transaction()` individually — do NOT rely on the enclosing `writeKeywordStrategy` txn for ad-hoc operator mutations.
- `addStrategyKeyword` must call the existing `assertKeywordNotAlreadyTargeted` guard before insert.
- `broadcastToWorkspace` uses `WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED` (pre-committed in C4) — never an inline string literal.
- Route handlers follow the platform pattern: `requireWorkspaceAccess`, Zod `validate()` middleware, `{ error: string }` on failure.
- The `server/domains/strategy/` directory follows platform-organization rules: no route-handler logic inside the domain module.

**Dependency note:** Lane A must be merged (or at minimum the endpoints must be stub-complete) before Lanes D and E can start their API integration work.

---

## Lane B — pr-check rules + test scaffolding

**Model:** `claude-sonnet-4-5` (mechanical rule authoring + test file scaffolding)

**Owns exclusively:**
- `scripts/pr-check.ts` (add the two rule implementations for `incomplete-rec-filter` and `strategy-send-must-route-through-lifecycle` that were stubbed in pre-commit C9 — flesh out the actual regex/customCheck bodies)
- `docs/rules/automated-rules.md` (regenerated by `npm run rules:generate` — do NOT hand-edit)
- `tests/integration/strategy-keyword-set-durability.test.ts` (NET-NEW — scaffold the durability integration test; can be stub with `test.todo` if Lane A is not yet merged)
- `tests/integration/strategy-send-path-public-read.test.ts` (NET-NEW — scaffold; asserts `GET /api/public/recommendations/:ws` reflects `clientStatus` after a `sendRecommendation()` call via the rec lifecycle, and that `RecStatus` is NOT modified)
- `tests/contract/fix-context-both-halves.test.ts` (NET-NEW — contract test asserting each of the 6 new `FixContext` fields is present in the assembled `pageAnalysisBlock` / prompt output from `content-brief.ts:1219-1230`, exercising all four receiver layers)

**Summary:** Implements the two new pr-check rules with correct regex patterns and escape-hatch strings, runs `npm run rules:generate` to sync the automated-rules doc, then scaffolds the three test files that represent the Phase 3 acceptance gates. The durability test (the CRITICAL P3 gate per synthesized plan §8) exercises `persistKeywordStrategy` (the wired reconciler seam) AND `replaceAllTrackedKeywordRows` (the `tracked-keywords-store.ts:184` deleteAll clobber path) and asserts active rows + `kept_at` survive both — this is the regression guard for the verified clobber. Lane B owns the test FILES; actual test bodies that call domain APIs must wait for Lane A's endpoints (can stub with `test.todo` and implement once Lane A is green).

**Critical constraints:**
- pr-check rule regex must handle template-literal classNames and conditional `as` props (per `feedback_audit_no_match_unknown.md` — "no match" is unknown/skip, never silent-pass).
- Inline hatch placement: same line as the flagged expression (pattern-based rule — `feedback_pr_check_hatch_placement.md`).
- The durability test MUST use `createEphemeralTestContext(import.meta.url)` — never fixed ports.
- The send-path test MUST exercise `GET /api/public/recommendations/:ws`, NOT the admin GET (synthesized plan §8 testing note).
- `docs/rules/automated-rules.md` is always the output of `npm run rules:generate` — the committed file must not drift from the `CHECKS` array.

---

## Lane C — `WhyHowResult` presenter + `useShowMore` extensions

**Model:** `claude-sonnet-4-5` (UI component authoring, no backend)

**Owns exclusively:**
- `src/components/strategy/shared/WhyHowResult.tsx` (NET-NEW directory + file)
- `src/hooks/useShowMore.ts` (this already should exist from P1; if P1 is fully merged verify it exists — if it exists this lane only EXTENDS usage to new P3 surfaces; if somehow missing from the merge, Lane C creates it)
- `src/components/strategy/SiteTargetKeywords.tsx` (extend to accept `managedKeyword?: ActiveStrategyKeyword | null` prop and render the three visual states: In Set teal dot/badge, Removed zinc, Candidate no dot — ONLY the display extension; mutation buttons are Lane D's concern)
- `src/components/strategy/DecayingPagesCard.tsx` (add the "Send to client — should we refresh?" teal `Send to client` button; button calls the `sendRecommendation` API wrapper from `src/api/misc.ts:191` using the `content_refresh` rec; renders muted-teal "Sent" pill + disables after send; shows `clientStatus` inline response — "Client approved" emerald / "Client declined" red / "Discussing" amber)
- `src/components/strategy/KeywordOpportunities.tsx` (add per-row "Interested in this one?" inline confirm → calls `sendRecommendation` for the `keyword_gap` rec minted at regen; "yes" also triggers managed-set add via the new API; renders send feedback states matching `DecayingPagesCard`)

**Summary:** Creates `src/components/strategy/shared/` directory and implements `WhyHowResult.tsx` — the shared presenter for why → how → projected result. Compact row shows Why only (one-line, data-anchored from `insight`/`description`/`rationale`/`competitorProof`); expanded shows all three (How = the primary action CTA label; Result = `estimatedGain` `+~340 clicks/mo` as a blue badge preferred, falling back to `impactBand` as emerald/amber only when the estimate is absent). Never renders an empty tier or "undefined est." The presenter enforces the `sendable` gate: the send button is enabled only when `insight` is non-empty AND `impactBand`/`estimatedGain` resolves. Applies `useShowMore` (from P1) to `KeywordOpportunities` and any P3 surface that renders unbounded lists. Adds send UX to `DecayingPagesCard` and `KeywordOpportunities` using the existing `sendRecommendation` API call at `src/api/misc.ts:191`.

**Critical constraints:**
- `WhyHowResult` must live in `src/components/strategy/shared/` — NOT in the flat strategy directory, which would eventually become cluttered.
- Result badge: blue badge for `estimatedGain` (data metric color law), emerald/amber for `impactBand` fallback (score color law). Never `text-green-400` — use `text-emerald-400`.
- Send button: one teal "Send to client" + optional inline note field — never "Send for Review" / "Flag for Client" (pr-check `send-for-review-anti-pattern`).
- All send calls route through `sendRecommendation` (the rec lifecycle API at `src/api/misc.ts:191`) — NEVER a `clientActions.create()` call (`strategy-send-must-route-through-lifecycle` pr-check, pre-committed in C9).
- `useShowMore` default cap is 5; "Show N more" is a teal text link with count — NOT a bordered button.
- The `SiteTargetKeywords` extension must be purely display (visual states from props); no mutation wiring — mutation is Lane D's exclusive file.
- Mobile-first: the why/how/result drawer must work at mobile breakpoints (synthesized plan §8 mobile gate).

**Dependency note:** Lane C can start immediately after the pre-commit. It only imports `ActiveStrategyKeyword` from the pre-committed `shared/types/strategy-keyword-set.ts` (C2).

---

## Lane D — Managed-set UI + send wiring (Keywords & Rankings tab)

**Model:** `claude-sonnet-4-5` (frontend, data-fetching hooks, mutation handlers)

**Owns exclusively:**
- `src/components/strategy/SiteTargetKeywords.tsx` (add managed-set mutation controls — add/remove/keep buttons, inline search-and-add input, "Added from opportunities" annotation on `source === 'regen_computed'` replenished rows; connects to the new API endpoints via a new React Query hook; conditionally rendered behind `strategy-keywords-managed-set` flag)
- `src/hooks/admin/useStrategyKeywordSet.ts` (NET-NEW — `useQuery` for `GET /api/keyword-strategy/:ws/keyword-set`, keyed by `queryKeys.admin.strategyKeywordSet(workspaceId)`; three `useMutation`s for add/remove/keep; `useWorkspaceEvents(workspaceId, WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED, ...)` handler that invalidates `queryKeys.admin.strategyKeywordSet`)
- `src/api/keyword-strategy.ts` (add 4 typed fetch wrappers for the new keyword-set endpoints — follow existing patterns in this file; no raw `fetch()`)

**Important shared-file note on `KeywordStrategy.tsx`:** The orchestrator `src/components/KeywordStrategy.tsx` is the most contested file across lanes. It is assigned to Lane D as the SOLE writer for P3. Lane D makes these orchestrator changes: pass the `strategy-keywords-managed-set` flag prop to `SiteTargetKeywords`; wire the `useStrategyKeywordSet` hook's `keywordSet` data down to `SiteTargetKeywords`; wire `ClientKeywordFeedback`'s `onApproveClientKeyword` handler to call `addStrategyKeyword(…, 'client_request')` (the §3.1 promote-client-keyword step via `feedback.addRequestedKeyword` → KCC `ADD_TO_STRATEGY` path at `useKeywordFeedback.ts:23-44`). NO OTHER LANE touches `KeywordStrategy.tsx` in P3.

**Summary:** Implements the full managed working-set UI in `SiteTargetKeywords.tsx` (owned jointly with Lane C, but Lane D owns mutation controls while Lane C owns visual state display — coordinate via props interface defined in pre-commit). Creates `useStrategyKeywordSet.ts` with full CRUD hooks and the `useWorkspaceEvents` invalidation handler (feedback-loop-completeness rule: both broadcast and handler are required). Adds 4 typed API wrappers in `src/api/keyword-strategy.ts`. Wires the three visual states (In Set / Removed / Candidate) from Lane C's display layer by passing the `keywordSet` data from the hook.

**Critical constraints:**
- `KeywordStrategy.tsx` exclusive ownership: NO other P3 lane may edit this file. Any cross-lane need that touches this file must be resolved by Lane D absorbing it.
- `useWorkspaceEvents` (NOT `useGlobalAdminEvents`) for `STRATEGY_KEYWORD_SET_UPDATED` invalidation (data-flow rule #2 — `useGlobalAdminEvents` does not send the `subscribe` action, so the server's workspace filter excludes the connection and the handler is dead code).
- All mutation hooks call `queryClient.invalidateQueries(queryKeys.admin.strategyKeywordSet(workspaceId))` on success.
- The `addStrategyKeyword` call for client-request promotion goes through the existing `useKeywordFeedback.ts:23-44` path; Lane D does NOT create a parallel promotion handler.
- Managed-set UI renders ONLY when `useFeatureFlag('strategy-keywords-managed-set')` is true (child flag gate inside `SiteTargetKeywords`). Flag-OFF must byte-identically preserve the existing `SiteTargetKeywords` passive-display behavior.
- Search-and-add reuses the existing `keyword-command-center.ts` search path — no hand-rolled query.

**Dependency:** Lane D starts after Lane A's API endpoints are stub-complete (can use mocked responses during development, switching to real endpoints once Lane A is merged).

---

## Lane E — Content tab managed sets + brief pre-seed

**Model:** `claude-sonnet-4-5` (frontend + server brief-layer plumbing)

**Owns exclusively:**
- `src/components/strategy/ContentGaps.tsx` (add `tracked_actions` keep UI: "Keep" button → writes `content_gap_keep` action via the existing tracked-actions API; cross-reference keep state on render; also add 6 new optional fields to the `navigate()` `fixContext` state object at `:78` and `:86`, passing `gap.rationale`, `gap.competitorProof`, `gap.volume`, `gap.intent`, `gap.questionKeywords`, `gap.serpFeatures` where available; resolve the sender field-name divergence: change `:86` to pass `primaryKeyword: gap.targetKeyword` instead of `pageName` so both senders align)
- `src/components/strategy/TopicClusters.tsx` (add `tracked_actions` keep UI: "Keep" button → writes `topic_cluster_keep` action; cross-reference keep state on render)
- `src/components/ContentBriefs.tsx` (extend `handleGenerate` at `:469-491` to fold the 6 new `FixContext` fields from `fixContextRef.current` into the `pageAnalysisContext` object passed to `startBriefGenerationJob`; receiver layer 2 of 4)
- `server/content-brief-generation-job.ts` (widen `StandaloneContentBriefGenerationParams.pageAnalysisContext` at `:29-42` to carry the 6 new fields; receiver layer 3 of 4)
- `server/routes/jobs.ts` (widen the `params.pageAnalysisContext` cast/validation at `:287-288` so the new fields are not stripped at the HTTP boundary; receiver layer 3b of 4)
- `server/content-brief.ts` (extend the `if (!pageAnalysisBlock && context.pageAnalysisContext)` branch at `:1219-1230` to emit the new fields into the brief prompt; resolve `serpFeatures` precedence: the existing `matchedPage?.serpFeatures` from `page_keywords` wins when present; `fixContext.serpFeatures` is the fallback when no matched page exists — emit as a separate directive block, clearly labelled, to avoid duplication; receiver layer 4 of 4)

**Summary:** Implements the `tracked_actions` durable-keep pattern for Topic Clusters and Content Gaps (the graft-4 pattern, reusing the verified `CannibalizationTriage.tsx:84-94` precedent). Each component queries the existing tracked-actions API for the workspace, filters to `sourceType === 'content_gap_keep'` or `'topic_cluster_keep'`, cross-references on render to determine keep state, and shows a "Keep" toggle. Regen clobbers the `content_gaps` and `topic_clusters` normalized tables; the `tracked_actions` rows survive. Also wires the full brief pre-seed pipeline: extends `ContentGaps.tsx` to pass 6 new optional fields through the `fixContext` carrier and follows all four receiver layers through to `content-brief.ts:1219-1230` where they reach the prompt assembly. Both halves (sender + all four receiver layers) ship in the same PR.

**Critical constraints:**
- DO NOT add a `keep_flag` column to `topic_clusters` or `content_gaps` (these tables are delete-then-reinsert on regen — the clobber-class verified in synthesized plan §3.2). The pr-check reviewer will block any such column.
- The `tracked_actions` filter must use `sourceType` scoping so rec-sourced actions don't collide with keep actions (the CannibalizationTriage filtering pattern at `CannibalizationTriage.tsx:84-94`).
- The sender field-name divergence fix (`:86` → `primaryKeyword`) must be applied in this lane; the two senders MUST align on one field name.
- `serpFeatures` precedence: `matchedPage?.serpFeatures` wins when present (already assembled from `page_keywords`); `fixContext.serpFeatures` is the fallback only when `matchedPage` is absent. Never duplicate the directive block.
- Receiver layer completeness: all four layers must ship together. A sender that passes fields the server never reads is the `fixContext` bug-class described in synthesized plan §5.5(e). Lane B's contract test verifies this.
- No imports added mid-file — all imports at the top with existing imports (code conventions, `feedback_imports_top_of_file.md`).

**Dependency:** Lane E starts after Lane A is complete (the tracked-actions write path uses the existing tracked-actions API, but the `content_gap_keep` / `topic_cluster_keep` enum values are pre-committed in C6; the brief layer has no Lane A dependency and can start immediately after pre-commit).

---

## Lane F — Integration test suite (convergence gate)

**Model:** `claude-sonnet-4-5` (test implementation; all dependencies resolved)

**Owns exclusively:**
- `tests/integration/strategy-keyword-set-durability.test.ts` (implement the full durability test scaffolded in Lane B: curate a set → run keyword-strategy regen via `persistKeywordStrategy` → run rank-tracking sync via `replaceAllTrackedKeywordRows` → assert active rows + `kept_at` survive both; this is the P3 acceptance gate per synthesized plan §8)
- `tests/integration/strategy-send-path-public-read.test.ts` (implement: send a `content_refresh` rec via `sendRecommendation()` → exercise `GET /api/public/recommendations/:ws` → assert `clientStatus` is set and `RecStatus` is untouched; extend the existing `strike-never-completed` guard)
- `tests/contract/fix-context-both-halves.test.ts` (implement: assert each of the 6 new `FixContext` fields is present in the assembled `pageAnalysisBlock` output from `content-brief.ts:1219-1230`; exercises all four receiver layers end-to-end)
- `tests/integration/managed-set-tracked-actions-keep.test.ts` (NET-NEW: mark a cluster "keep" via `topic_cluster_keep` → regen → assert keep state survives; mirrors the CannibalizationTriage durability pattern)

**Summary:** All four integration/contract test files are implemented (not just scaffolded). Lane F starts only after Lanes A, D, and E are all merged and green on the branch. The durability test is the hard P3 gate: it must pass before P3 can be merged to staging. Lane F does NOT touch any source file.

**Dependency:** Lane F is the final convergence — starts after A + D + E + C are all merged.

---

## Shared-file ownership table (no overlaps permitted)

| File | Owning Lane | Conflict resolution |
|---|---|---|
| `src/components/KeywordStrategy.tsx` | **Lane D exclusively** | All P3 orchestrator changes go through Lane D. Lanes C and E must NOT edit this file. |
| `src/components/strategy/SiteTargetKeywords.tsx` | **Lane C (display states) then Lane D (mutations)** | Lane C commits the visual-state display extension first; Lane D adds mutation wiring on top. Sequential, not parallel. If they need to run truly in parallel, SiteTargetKeywords is split by props contract: Lane C writes the display props interface in the pre-commit, Lane D implements the hook and passes props into the component. |
| `src/components/strategy/ContentGaps.tsx` | **Lane E exclusively** | |
| `src/components/strategy/TopicClusters.tsx` | **Lane E exclusively** | |
| `src/components/strategy/DecayingPagesCard.tsx` | **Lane C exclusively** | |
| `src/components/strategy/KeywordOpportunities.tsx` | **Lane C exclusively** | |
| `shared/types/strategy-keyword-set.ts` | **Pre-commit C2** | |
| `shared/types/feature-flags.ts` | **Pre-commit C1** | |
| `shared/types/outcome-tracking.ts` | **Pre-commit C6** | |
| `src/App.tsx` | **Pre-commit C7** (type only) | |
| `server/ws-events.ts` | **Pre-commit C4** | |
| `server/activity-log.ts` | **Pre-commit C5** | |
| `src/lib/queryKeys.ts` | **Pre-commit C8** | |
| `scripts/pr-check.ts` | **Lane B** (flesh out rule bodies after C9 stub) | |
| `server/domains/strategy/managed-keyword-set.ts` | **Lane A** | |
| `server/keyword-strategy-persistence.ts` | **Lane A** | |
| `server/routes/keyword-strategy.ts` | **Lane A** | |
| `server/recommendation-lifecycle.ts` | **Lane A** | |
| `src/hooks/admin/useStrategyKeywordSet.ts` | **Lane D** | |
| `src/api/keyword-strategy.ts` | **Lane D** | |
| `src/components/ContentBriefs.tsx` | **Lane E** | |
| `server/content-brief-generation-job.ts` | **Lane E** | |
| `server/routes/jobs.ts` | **Lane E** | |
| `server/content-brief.ts` | **Lane E** | |
| `src/components/strategy/shared/WhyHowResult.tsx` | **Lane C** | |
| `src/hooks/useShowMore.ts` | **Lane C** (verify from P1 merge; extend if needed) | |
| All `tests/**` files | **Lane B** (scaffolding) then **Lane F** (implementation) | |

---

## Dependency graph (machine-readable)

```
PRE-COMMIT (C1–C9)
│
├── LANE A (backend + reconciler + routes)
│     Unlocks: Lane D, Lane E (tracked-actions portion immediate; brief layer waits for A)
│
├── LANE B (pr-check rules + test scaffolding)
│     No deps — starts immediately after pre-commit
│
├── LANE C (WhyHowResult + send UX on DecayingPages/KeywordOpportunities)
│     No deps — starts immediately after pre-commit
│     Unlocks: Lane D SiteTargetKeywords mutation layer
│
├── LANE D (Managed-set UI + orchestrator wiring) — waits for Lane A + Lane C
│     Unlocks: Lane F
│
├── LANE E (Content tab keeps + brief pre-seed) — waits for Lane A
│     Unlocks: Lane F
│
└── LANE F (Full integration tests) — waits for Lanes A + C + D + E
```

---

## Phase 3 acceptance gate (must all pass before merge to staging)

1. `npm run typecheck` — zero errors.
2. `npx vite build` — builds successfully.
3. `npx vitest run` — full test suite passes including Lane F's durability test.
4. `npx tsx scripts/pr-check.ts` — zero errors (new rules must not fire on P3 code).
5. `npm run verify:feature-flags` — no orphaned or ungrouped flag keys (`strategy-keywords-managed-set` appears in the Strategy group).
6. `npm run verify:coverage-ratchet` — coverage not regressed.
7. **Durability gate (CRITICAL):** `strategy-keyword-set-durability.test.ts` passes — curated set rows + `kept_at` survive both `persistKeywordStrategy` regen AND `replaceAllTrackedKeywordRows` rank-tracking sync.
8. **Send-path public-read gate:** `strategy-send-path-public-read.test.ts` passes — `GET /api/public/recommendations/:ws` reflects `clientStatus`; `RecStatus` untouched.
9. **fixContext both-halves gate:** `fix-context-both-halves.test.ts` passes — all 6 new fields reach the assembled `pageAnalysisBlock` in `content-brief.ts:1219-1230`.
10. **Flag-OFF byte-identical:** flag-OFF snapshot on `recommendations-public-allowlist.test.ts` unchanged.
11. **Mobile pass:** cockpit bulk-select + managed-set add/remove/keep + why/how/result drawer verified at mobile breakpoints (real-browser DOM probe — 5-layer verification per `feedback_phase5_multilayer_verification.md`).
12. **Scaled-code-review** invoked (parallel multi-lane work requires `scaled-code-review`, not single-agent review).

---

## Post-merge checklist

- `FEATURE_AUDIT.md` — add/update entries for: managed keyword set, managed topic-cluster/content-gap keeps, send-to-client on decaying pages + keyword opportunities, brief pre-seed from content gaps.
- `data/roadmap.json` — mark P3 item done, add notes; `npx tsx scripts/sort-roadmap.ts`.
- `BRAND_DESIGN_LANGUAGE.md` — update if any new color patterns introduced (WhyHowResult result badges, "Added from opportunities" annotation style).
- `data/features.json` — add "Managed keyword working set" as a client-impactful feature entry.
- P4 can NOT start until P3 is merged AND green on staging AND operator-confirmed.
