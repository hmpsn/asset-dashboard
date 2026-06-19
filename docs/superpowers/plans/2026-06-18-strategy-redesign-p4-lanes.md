# Strategy Redesign Phase 4 — Execution-Ready Lane Plan

> **Phase:** P4 — Consolidation: signal-fold + config + competitor send + orphan cleanup
> **Parent plan:** `docs/superpowers/plans/2026-06-18-strategy-redesign-synthesized-plan.md` §7 Phase 4
> **Branch:** `strategy-redesign-review-fixes` (continues from P1/P2/P3 merged to staging)
> **Gate prerequisite:** P3 merged and green on staging, operator-confirmed. Do NOT start P4 until P3 gate is closed.
> **Dispatch model:** pre-commit shared contracts → parallel lane implementers → controller commits per lane → two-stage review (scaled-code-review).
> **Flag umbrella:** `strategy-command-center` (existing, unchanged). P4-specific child flags: `strategy-signal-fold`, `strategy-competitor-send` (both must be in the pre-commit contracts commit before lanes fan out).

---

## 0. What P4 delivers (and why it is hardest)

P4 has four loosely-coupled work streams that each touch a different part of the stack:

1. **Signal-fold** — mint `StrategySignal` objects as real `Recommendation` rows at `generateRecommendations()` time; delete the standalone `IntelligenceSignals` card. Backend-heavy, gated behind `strategy-signal-fold`.
2. **Config consolidation + Local SEO dedup** — collapse `StrategySettings` + Local SEO config into one disclosure toggle at the bottom of Overview; remove `LocalSeoVisibilityPanel` from `KeywordStrategy.tsx` (results go to Hub only); remove the dead `mode="strategy"` prop path. IA move, no data-model change.
3. **Competitor send** — add `competitor` RecType with the one-commit 5-map lockstep; wire per-row "Send to client" in `CompetitiveIntel`; gate client renderer behind `strategy-competitor-send`.
4. **Orphan cleanup** — cut `OpportunitiesList`, `RequestedKeywordTriage`, `DecisionQueue` files + exports; mark `LostQueryRecoveryCard` keep-reserved; remove the outside-tabs leak (`localSeoEl` / `clientFeedbackCombinedEl` / `settingsEl`).

**Flag-OFF invariant holds through all four streams.** Every change is behind `strategy-command-center`. Flag-OFF byte-identical snapshot must pass after each lane merges.

---

## 1. Pre-commit contracts (must land in ONE commit before any lane starts)

These are the shared type/flag/event/rule contracts parallel agents need to agree on. The orchestrating agent (controller) commits this block alone, then dispatches the lanes.

### 1a. Child feature flags — `shared/types/feature-flags.ts`

Add to `FEATURE_FLAGS` defaults map:
```ts
'strategy-signal-fold': false,
'strategy-competitor-send': false,
```

Add to `FEATURE_FLAG_CATALOG`:
```ts
'strategy-signal-fold': {
  lifecycle: 'active',
  group: 'Strategy',
  description: 'Folds IntelligenceSignals into the cockpit as real recs minted at generateRecommendations() time. Deletes the standalone IntelligenceSignals card.',
  removalCondition: 'Remove once fold ships and zero standalone signal cards are confirmed in production.',
  linkedRoadmapItemId: 'strategy-redesign-p4-signal-fold',
},
'strategy-competitor-send': {
  lifecycle: 'active',
  group: 'Strategy',
  description: 'Enables per-row Send-to-client on CompetitiveIntel rows via the competitor RecType + sendRecommendation(). Client renderer must exist before this flag is enabled in production.',
  removalCondition: 'Remove once competitor send + client renderer are on main and verified.',
  linkedRoadmapItemId: 'strategy-redesign-p4-competitor-send',
},
```

Add both keys to the `Strategy` group `keys` array (`:357`).

### 1b. `competitor` RecType pre-declaration — `shared/types/recommendations.ts`

Extend the `RecType` union:
```ts
export type RecType = 'technical' | 'content' | 'content_refresh' | 'schema' | 'metadata' | 'performance' | 'accessibility' | 'strategy' | 'aeo' | 'keyword_gap' | 'topic_cluster' | 'cannibalization' | 'local_visibility' | 'local_service_gap' | 'competitor';
```

This triggers compile errors in all four exhaustive `Record<RecType, …>` maps — the lane that owns each map must resolve them. The pre-commit is the union value ONLY; each exhaustive-map entry lives in its owning lane.

### 1c. WS event — `server/ws-events.ts`

Extend `WS_EVENTS`:
```ts
STRATEGY_SIGNAL_FOLD_UPDATED: 'strategy:signal-fold-updated',  // unused today; reserved for future signal-specific invalidation
```
(Signal-fold reuses the existing `RECOMMENDATIONS_UPDATED` broadcast — no new broadcast is strictly required. This constant is reserved for observability, not functional.)

### 1d. pr-check rules — `scripts/pr-check.ts`

Two rules that MUST exist before lane agents touch strategy files. Add to `CHECKS`:

**`incomplete-rec-filter`** — in `src/components/strategy/**`, a `status === 'dismissed'` or `status !== 'dismissed'` filter without an adjacent `isActiveRec` call on the same component is flagged. (Escape hatch: `// incomplete-rec-filter-ok` with justification.)

**`strategy-send-must-route-through-lifecycle`** — flag any new `clientActions.create(` call inside `src/components/strategy/**` OR any new string added to the `ClientActionSourceType` union in `shared/types/`, unless the same line carries `// strategy-send-lifecycle-ok: <renderer-name>`. (Inline hatch, same line — per `feedback_pr_check_hatch_placement`.)

Run `npm run rules:generate` after adding both rules to regenerate `docs/rules/automated-rules.md`.

---

## 2. Lane decomposition

Four lanes; all can start in parallel once the pre-commit contracts are merged.

---

### Lane A — Signal-fold (backend mint + frontend card deletion)

**Model:** claude-opus-4-5 (gen-time mutation inside `generateRecommendations`, carry-over audit, dedup logic)

**Owns (exclusive):**
- `server/recommendations.ts` — `mintSignalRecs()` helper + call site inside `generateRecommendations()` (`:1194`)
- `server/signal-story-registry.ts` — read only (signal type → RecType mapping)
- `src/components/strategy/IntelligenceSignals.tsx` — delete (or hollow into a `null` return behind the flag until the file is removed at cleanup)
- `src/hooks/admin/useIntelligenceSignals.ts` — delete once the card is gone
- `src/hooks/admin/useRecomputeSignals.ts` — delete once the card is gone
- `tests/integration/strategy-signal-fold.test.ts` — new integration test (create with `createEphemeralTestContext`)
- `server/__tests__/signal-fold-carry-over.test.ts` — carry-over unit test

**Task summary:**

Inside `generateRecommendations()` (`:1194`), after the existing `applyLifecycleCarryOver` step (`:2445`), add a `mintSignalRecs(signals, recs)` call that maps each `StrategySignal` (fetched via the existing intelligence signal path) to a `Recommendation` row. Dedup by `insightId` via `buildMergeKey`; source discriminator `source:'signal'` on the minted rec; RecType maps to `keyword_gap` or `topic_cluster` where a natural mapping exists, otherwise `strategy`. The fold is gated behind `useFeatureFlag('strategy-signal-fold')` checked at server call-time (pass `workspaceId` through the generation context). After the fold lands, `KeywordStrategy.tsx`'s `intelligenceSignalsEl` references (`:253`, `:422`) are removed and the `IntelligenceSignals` import (`:21`) is deleted. The double-"ago" bug (`IntelligenceSignals.tsx:49`) was already fixed in P1; this lane deletes the file.

**Carry-over audit (required before merge):** confirm `applyLifecycleCarryOver` (`recommendations.ts:598`) uses the `Map` at `:600` (already verified — `oldByKey` is a `Map<string, Recommendation>`). Assert no `.find()` on the old-recs array in any caller within `generateRecommendations`. Add a comment confirming the O(n) status if changed or already correct.

**Gate (before PR merge):** integration test asserts: (1) signals appear as active cockpit rec rows via `isActiveRec`; (2) zero standalone `IntelligenceSignals` card elements in rendered output; (3) carry-over preserves minted signal recs across a regen; (4) no "ago ago" substring in any rendered node (regression guard for the P1 fix). Flag-OFF snapshot byte-identical.

---

### Lane B — Config consolidation + Local SEO dedup

**Model:** claude-sonnet-4-5 (IA move, no data model change, mechanical JSX restructure)

**Owns (exclusive):**
- `src/components/KeywordStrategy.tsx` — removes `localSeoEl` (`:215-229`, `:388`), `settingsEl` (`:230-249`, `:396`), `clientFeedbackCombinedEl` (`:290-310`, `:395`) from the outside-tabs leak; collapses `StrategySettings` + Local SEO config into a new `StrategyConfigPanel` disclosure section at the bottom of the Overview render path (inside the `strategy-command-center` gate)
- `src/components/strategy/StrategyConfigPanel.tsx` — NEW (disclosure accordion wrapping `StrategySettings` and a new `LocalSeoConfigSection`)
- `src/components/local-seo/LocalSeoVisibilityPanel.tsx` — remove the `mode="strategy"` branch logic (`:194`, `:326`, `:417`) now that Strategy no longer mounts it; keep `mode="keywords"` (used by KeywordHub) and `mode="page"` paths untouched
- `src/components/KeywordHub.tsx` — unchanged (`:539` LocalSeoVisibilityPanel in Hub stays as-is; this lane does NOT touch KeywordHub)
- `tests/component/StrategyConfigPanel.test.tsx` — NEW snapshot test asserting collapsed state summary + expanded form renders; flag-OFF renders nothing (or previous inline layout)

**Task summary:**

Remove the three elements that currently render outside the tabs in `KeywordStrategy.tsx` (`:388,395,396`). Build a new `StrategyConfigPanel` disclosure component that wraps the existing `StrategySettings` fields plus the Local SEO market/location config (provider, local market, business context limit). Mount it at the bottom of the Overview tab render path, inside the `commandCenterEnabled` gate, as a collapsed disclosure that shows a one-line state summary in its header even when collapsed. Remove `localSeoEl` from `KeywordStrategy.tsx` entirely (`:215-229`); remove the dead `mode="strategy"` prop path from `LocalSeoVisibilityPanel`. `LocalSeoVisibilityPanel` continues to render in `KeywordHub.tsx` (Lane B must NOT touch that file — KeywordHub is owned by no lane in P4 and is read-only context).

**Shared file note:** `KeywordStrategy.tsx` is assigned exclusively to Lane B. Lane A (signal-fold) deletes `intelligenceSignalsEl` from `KeywordStrategy.tsx`. These are non-overlapping line regions. If both lanes are dispatched simultaneously, Lane A's `KeywordStrategy.tsx` edits (`import IntelligenceSignals` at `:21`, `const intelligenceSignalsEl` at `:253`, usage at `:422`) must be applied by the controller as a sequential patch after Lane B's diff is merged — OR Lane A delivers its `KeywordStrategy.tsx` changes as a separate atomic commit the controller applies after Lane B merges. Document the sequencing explicitly in the dispatch prompt.

**Gate:** flag-OFF snapshot byte-identical; Local SEO panel renders only in Hub (grep `LocalSeoVisibilityPanel` across all rendered output — zero strategy route hits); collapsed config header shows provider name + market when set; `mode="strategy"` dead code removed (`grep -n 'mode.*strategy\|strategy.*mode'` returns zero hits in `LocalSeoVisibilityPanel.tsx`).

---

### Lane C — Competitor send (RecType lockstep + CompetitiveIntel wiring)

**Model:** claude-sonnet-4-5 (mechanical 5-map lockstep + UI wiring, no novel algorithm)

**Owns (exclusive):**
- `server/recommendation-lifecycle.ts` — add `competitor` entry to `REC_POLICY_REGISTRY` (`:37`): `{ sendChannel: 'rec', cascadeOnStrike: false, monetizable: false }`
- `src/lib/recCategoryMap.ts` — add `competitor` to `REC_TYPE_ACT_CATEGORY` (`:12`): `'competitive'` (or nearest existing `ActCategory` value — read the `ActCategory` type before committing)
- `src/lib/recTypeTab.ts` — add `competitor` to `REC_TYPE_ADMIN_TAB` (`:15`): `'strategy'` (routes admin deep-link to Strategy page)
- `src/components/client/InsightsEngine.tsx` — add `competitor` to `REC_TYPE_TAB` (`:39`) and `TYPE_ICONS` (`:99`); client renderer for competitor rows gated behind `strategy-competitor-send` (`useFeatureFlag`)
- `src/components/strategy/CompetitiveIntel.tsx` — add per-row "Send to client" button + `WhyHowResult` compact presenter for each competitor gap row; button calls `sendRecommendation(recId)` via the existing API hook; button visible only inside `strategy-command-center` gate; entire send path additionally gated by `strategy-competitor-send`
- `src/components/strategy/StrategyCompetitiveTab.tsx` — pass the `navigate` prop through to `CompetitiveIntel` if not already present (read `:35` before touching)
- `tests/integration/competitor-send.test.ts` — NEW: assert `POST /api/recommendations/:ws/:recId/send` with a `competitor` rec sets `clientStatus` correctly and does NOT write `RecStatus`; assert `GET /api/public/recommendations/:ws` returns the sent competitor rec in the public payload

**Task summary:**

The `competitor` RecType union value is pre-committed in the shared contracts. This lane resolves the resulting compile errors by populating all five exhaustive maps in one commit. In `CompetitiveIntel.tsx`, each competitor gap row gets a teal "Send to client" button that mints a `competitor` rec (if one doesn't already exist for that gap) and calls `sendRecommendation()`. After send the row shows a muted-teal "Sent" pill; the button disables. The client-facing renderer in `InsightsEngine.tsx` is gated behind `strategy-competitor-send` so a sent competitor rec cannot surface to the client before its renderer is ready. The `WhyHowResult` presenter (built in P3 as `src/components/strategy/shared/WhyHowResult.tsx`) is used for the Why/How/Result display inside the CompetitiveIntel row expansion — Lane C consumes it but does not modify it.

**5-map lockstep checklist (Lane C agent must confirm all five in the same commit):**
1. `REC_POLICY_REGISTRY` in `server/recommendation-lifecycle.ts` — `competitor` entry added
2. `REC_TYPE_ACT_CATEGORY` in `src/lib/recCategoryMap.ts` — `competitor` entry added
3. `REC_TYPE_ADMIN_TAB` in `src/lib/recTypeTab.ts` — `competitor` entry added
4. `REC_TYPE_TAB` in `src/components/client/InsightsEngine.tsx` — `competitor` entry added
5. `TYPE_ICONS` in `src/components/client/InsightsEngine.tsx` — `competitor` icon assigned

TypeScript `tsc -b --noEmit` will fail if any of the five is missing (maps are exhaustive `Record<RecType, …>`). The PR cannot merge until `npm run typecheck` is clean.

**Gate:** `npm run typecheck` clean; integration test passes on `GET /api/public/recommendations/:ws`; flag-OFF snapshot byte-identical; `strategy-competitor-send` flag-OFF shows no "Send to client" on Competitive tab rows; PM-gate pr-check (`strategy-send-must-route-through-lifecycle`) passes with no new violations.

---

### Lane D — Orphan cleanup + outside-tabs leak removal

**Model:** claude-sonnet-4-5 (mechanical deletions and export pruning)

**Owns (exclusive):**
- `src/components/strategy/OpportunitiesList.tsx` — delete file
- `src/components/strategy/RequestedKeywordTriage.tsx` — delete file
- `src/components/strategy/DecisionQueue.tsx` — delete file
- `src/components/strategy/LostQueryRecoveryCard.tsx` — add `/* keep-reserved: lost-query recovery data path not yet specced — do NOT delete */` header comment; remove from "NOT yet wired" warning block in `index.ts`
- `src/components/strategy/index.ts` — remove exports for the three cut files; update the `LostQueryRecoveryCard` comment from "NOT yet wired / Do NOT delete" to "keep-reserved: data path unscoped, revisit when lost-query surface is specced"; after cleanup, the "do not delete" section contains only `LostQueryRecoveryCard`
- `tests/component/strategy-orphan-cuts.test.ts` — NEW: assert zero import of `OpportunitiesList`, `RequestedKeywordTriage`, `DecisionQueue` in any `src/` file (import-grep test, not a render test); assert `index.ts` re-exports only the named wired leaves

**Note on KeywordStrategy.tsx:** the outside-tabs leak (`localSeoEl`, `settingsEl`, `clientFeedbackCombinedEl`) is owned by Lane B. Lane D does NOT touch `KeywordStrategy.tsx`. Lane D's cleanup scope is strictly the orphaned component files and their `index.ts` exports.

**Task summary:**

Delete the three confirmed-orphan component files (`OpportunitiesList.tsx`, `RequestedKeywordTriage.tsx`, `DecisionQueue.tsx`) and remove their barrel exports from `src/components/strategy/index.ts`. Confirm zero import sites across `src/` before deleting (grep before cut). Annotate `LostQueryRecoveryCard.tsx` as keep-reserved with a dated comment explaining why it stays. After cleanup, `index.ts:28-42` (the former "NOT yet wired" block) is reduced to a single `LostQueryRecoveryCard` keep-reserved export. Verify `src/components/strategy/index.ts` final export list against the plan's expected "genuinely-wired leaves" (`DecayingPagesCard`, `CannibalizationTriage`, `NeedsAttentionStrip`, `CurationMeter`, `CurationBulkActionBar`, `LostQueryRecoveryCard`).

**Gate:** zero compile errors; grep `OpportunitiesList\|RequestedKeywordTriage\|DecisionQueue` in `src/` returns zero hits; `verify:feature-flags` passes (orphan cleanup does not touch flag catalog); coverage ratchet not regressed.

---

## 3. Sequencing + dependency graph

```
Pre-commit contracts (controller)
  │
  ├── Lane A (signal-fold)          ──── independent ──── merge A
  ├── Lane B (config + local SEO)   ──── independent ──── merge B
  │     └── KeywordStrategy.tsx edit ─── Lane A's KS.tsx edit must come AFTER B merges
  ├── Lane C (competitor send)      ──── independent ──── merge C
  └── Lane D (orphan cleanup)       ──── independent ──── merge D

All lanes complete → Integration sweep (controller) → scaled-code-review → P4 gate
```

**The one intra-lane sequencing constraint:** `KeywordStrategy.tsx` is assigned to Lane B. Lane A also needs to delete two lines from `KeywordStrategy.tsx` (`import IntelligenceSignals` at `:21` and `intelligenceSignalsEl` at `:253,422`). These are non-overlapping regions that cannot be edited simultaneously without a conflict. Resolution:

- Lane A delivers its `KeywordStrategy.tsx` deletions as a **separate diff/commit** in its PR, clearly labeled "KS.tsx cleanup — apply after Lane B merges."
- The controller applies Lane A's `KeywordStrategy.tsx` changes after Lane B's PR is merged and before Lane A's PR is reviewed.
- Alternatively: Lane A gates the `intelligenceSignalsEl` render with a `strategy-signal-fold` flag check (`commandCenterEnabled && signalFoldEnabled`) and leaves the JSX stub until the controller does a final cleanup commit after both lanes merge.

**No other cross-lane file conflicts exist.** Lane C's `InsightsEngine.tsx` (client component) is disjoint from all Lane B/A/D files. Lane D's deletions are leaf files with no dependents.

---

## 4. Shared file registry (P4 scope only)

| File | Lane | Access |
|---|---|---|
| `server/recommendations.ts` | A | Owned by A — no other lane touches |
| `server/signal-story-registry.ts` | A | Read-only by A |
| `src/components/strategy/IntelligenceSignals.tsx` | A | Delete by A |
| `src/hooks/admin/useIntelligenceSignals.ts` | A | Delete by A |
| `src/hooks/admin/useRecomputeSignals.ts` | A | Delete by A |
| `src/components/KeywordStrategy.tsx` | B (primary), A (sequenced cleanup) | Lane B owns; Lane A's deletions applied sequentially after B merges |
| `src/components/strategy/StrategyConfigPanel.tsx` | B | New file, created by B |
| `src/components/local-seo/LocalSeoVisibilityPanel.tsx` | B | Owned by B (mode="strategy" removal) |
| `src/components/KeywordHub.tsx` | NONE | Read-only reference context; no P4 lane touches this file |
| `server/recommendation-lifecycle.ts` | C | Owned by C |
| `src/lib/recCategoryMap.ts` | C | Owned by C |
| `src/lib/recTypeTab.ts` | C | Owned by C |
| `src/components/client/InsightsEngine.tsx` | C | Owned by C |
| `src/components/strategy/CompetitiveIntel.tsx` | C | Owned by C |
| `src/components/strategy/StrategyCompetitiveTab.tsx` | C | Owned by C (prop pass-through only) |
| `src/components/strategy/shared/WhyHowResult.tsx` | NONE (built in P3) | Read-only by C |
| `src/components/strategy/OpportunitiesList.tsx` | D | Delete by D |
| `src/components/strategy/RequestedKeywordTriage.tsx` | D | Delete by D |
| `src/components/strategy/DecisionQueue.tsx` | D | Delete by D |
| `src/components/strategy/LostQueryRecoveryCard.tsx` | D | Annotate by D |
| `src/components/strategy/index.ts` | D | Owned by D |
| `shared/types/recommendations.ts` | Pre-commit (controller) | RecType union extended in contracts commit |
| `shared/types/feature-flags.ts` | Pre-commit (controller) | Child flags added in contracts commit |
| `server/ws-events.ts` | Pre-commit (controller) | Reserved constant added in contracts commit |
| `scripts/pr-check.ts` | Pre-commit (controller) | Two new rules added in contracts commit |
| `docs/rules/automated-rules.md` | Pre-commit (controller) | Regenerated via `npm run rules:generate` |

---

## 5. P4 acceptance checklist

All items must pass before P4 is declared done and P5 is unblocked.

- [ ] `npm run typecheck` — zero errors across all four lanes merged
- [ ] `npx vite build` — clean build
- [ ] `npx vitest run` — full suite (not just new tests); use a single run, not concurrent (see `feedback_no_parallel_full_vitest`)
- [ ] `npm run pr-check:all` — zero violations; `incomplete-rec-filter` and `strategy-send-must-route-through-lifecycle` pass clean
- [ ] `npm run verify:feature-flags` — no orphaned or ungrouped keys; both `strategy-signal-fold` and `strategy-competitor-send` are in the Strategy group
- [ ] `npm run verify:coverage-ratchet` — coverage not regressed
- [ ] **Flag-OFF snapshot byte-identical** — `tests/integration/recommendations-public-allowlist.test.ts` passes with `strategy-command-center=false`
- [ ] **Signal-fold gate** — zero standalone `IntelligenceSignals` renders anywhere in the Strategy route with `strategy-signal-fold=true`; signals appear as cockpit rec rows; carry-over preserves minted signal recs across regen; no "ago ago" substring
- [ ] **Config consolidation gate** — `LocalSeoVisibilityPanel` renders in exactly one place (`KeywordHub`); `mode="strategy"` dead code removed; `StrategyConfigPanel` collapsed summary shows current state; outside-tabs leak (`localSeoEl`/`settingsEl`/`clientFeedbackCombinedEl`) is gone
- [ ] **Competitor send gate** — `competitor` RecType in all 5 maps; `PATCH …/send` on a competitor rec mutates `clientStatus` and NOT `RecStatus`; `GET /api/public/recommendations/:ws` returns sent competitor rec; `strategy-competitor-send=false` hides Send button on Competitive tab
- [ ] **Orphan cleanup gate** — zero imports of `OpportunitiesList`, `RequestedKeywordTriage`, `DecisionQueue` in `src/`; `index.ts` exports only wired leaves + `LostQueryRecoveryCard` (annotated keep-reserved)
- [ ] **5-layer design-system verification** (per `feedback_phase5_multilayer_verification`) for every JSX/CSS change in B and C: typecheck + build + pr-check + scaled-code-review + real-browser DOM probe
- [ ] Mobile breakpoint pass on `StrategyConfigPanel` (collapsed/expanded), competitor send button, signal recs in cockpit
- [ ] **scaled-code-review** invoked across the full P4 diff before final merge (multi-lane batch — `superpowers:scaled-code-review` required per CLAUDE.md quality gate)
- [ ] `FEATURE_AUDIT.md` updated for competitor send + config consolidation
- [ ] `data/roadmap.json` P4 items marked done

---

## 6. Post-P4: what this unblocks

- **P5/P6 (client-delivery track #12c)** — the admin competitor send spine is now live; the companion client-side 3-layer recommendation delivery surface can be built as the separate track defined in §1 Non-goals
- **`strategy-signal-fold` flag removal** — once fold is verified in production and zero standalone signal cards confirmed, remove the flag per `docs/rules/feature-flag-lifecycle.md`
- **`strategy-competitor-send` flag removal** — once client renderer ships in the companion track and is verified, enable + remove the flag

---

## 7. Dispatch prompt template (for each lane)

When dispatching a lane agent, include:

```
You are Lane <X> of Phase 4 (Strategy Redesign Consolidation). 

App context:
- React 19 + Vite 8 + TailwindCSS 4, Express + TypeScript, SQLite via better-sqlite3
- All data: React Query hooks (`useQuery`/`useMutation`), query keys `admin-*`/`client-*`
- Feature flags: `useFeatureFlag(key)` client-side; server-side flag reads via workspace settings
- WebSocket events: `broadcastToWorkspace()` + `useWorkspaceEvents()` — both halves required
- `strategy-command-center` umbrella flag gates all Strategy redesign surfaces (already wired in KeywordStrategy.tsx)
- Flag-OFF must remain byte-identical — every new JSX block must be inside the flag gate

Pre-commit contracts are already merged:
- `competitor` added to RecType union (`shared/types/recommendations.ts`)
- `strategy-signal-fold` and `strategy-competitor-send` flags in `shared/types/feature-flags.ts`
- `incomplete-rec-filter` and `strategy-send-must-route-through-lifecycle` pr-check rules in `scripts/pr-check.ts`

Your exclusive file ownership: [list from §4 above for this lane]
Files you must NOT touch: [all other lanes' files]

[Lane-specific task from §2 above]

Before declaring done: run `npm run typecheck && npx vite build && npm run pr-check`
```
