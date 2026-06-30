# Strategy Redesign — Consolidated Cross-Phase Execution Map

> **Role:** release-engineering lock for the 4-phase Strategy redesign (phase-per-PR off `staging`, all behind `strategy-command-center`).
> **Date:** 2026-06-18
> **Ground truth:** `docs/superpowers/plans/2026-06-18-strategy-redesign-synthesized-plan.md`
> **Phase lane plans:** `…-p2-lanes.md`, `…-p3-lanes.md`, `…-p4-lanes.md`
> **Branch:** `strategy-redesign-review-fixes` (continues the v3 cockpit line already on staging behind the flag)
> **Hard phasing rule:** never start phase N+1 until phase N is MERGED and GREEN on staging, with operator confirmation. P1 (trust-recovery gate) blocks P2/P3/P4 absolutely.

This map is the single authority for: (1) the cross-phase contract sheet, (2) the all-phase collision matrix, (3) the phase + lane dependency graph, and (4) the child-flag inventory. Where the three lane plans diverge, this map records the canonical decision the controller must enforce.

---

## 0. Phase summary + gating chain

| Phase | Theme | New child flag(s) | Pre-commits contracts for | Blocked by |
|---|---|---|---|---|
| **P1** | Trust-recovery visible wins (What Changed promote, `useShowMore`, CannibalizationTriage swap, `ago` fix) | none (uses `strategy-command-center`) | — | nothing (ships first) |
| **P2** | IA rename + move keyword surfaces + **pre-commit ALL P3 contracts** | declares `strategy-keywords-managed-set`, `strategy-competitor-send`, `strategy-signal-fold` (defaults only) | **P3 (entirely)** | **P1 merged + green + operator-confirmed** |
| **P3** | Managed sets + send spine + migration 139 (the money phase) | activates `strategy-keywords-managed-set` | — (consumes P2 pre-commits) | **P2 merged + green** |
| **P4** | Consolidation: signal-fold + config + competitor send + orphan cleanup | activates `strategy-signal-fold`, `strategy-competitor-send`; adds `competitor` RecType | — | **P3 merged + green + operator-confirmed** |

**The unusual structure:** P2 is a thin IA-move PR that *pre-commits the entire P3 contract surface* (migration 139, the domain stub, `shared/types/strategy-keyword-set.ts`, the `FixContext` extension, all three child flags, the `tracked_actions` enum values). This is deliberate — it lets P3's six parallel lanes start against an already-committed foundation. The contract sheet below tracks every one of these "pre-committed in an earlier phase, consumed in a later phase" handoffs.

---

## 1. CROSS-PHASE CONTRACT SHEET

Every shared type, migration, child flag, WS event, query key, enum value, and pr-check rule the redesign introduces — **which phase pre-commits it, and which later lanes consume it.** "Pre-commit (controller)" means it lands in a single dedicated commit at the HEAD of the phase branch before any lane fans out.

### 1.1 Migration

| Artifact | File | Pre-committed by | First run / wired by | Consumed by |
|---|---|---|---|---|
| **Migration 139** `strategy_keyword_set` table + `idx_strategy_keyword_set_ws` index, `UNIQUE(workspace_id, keyword)`, `CHECK(source IN …)` | `server/db/migrations/139-strategy-keyword-set.sql` | **P2 pre-commit** (table skeleton, available for typing/import) | **P3 Lane A** (first `npm run db:migrate` + fixups) | P3 Lane A reconciler, P3 Lane F durability test |

> **Verified:** highest existing migration is `138-rec-discussion.sql`. 139 is genuinely net-new — no collision.
> **Canonical DDL = the P3 lane-plan version** (`created_at … DEFAULT (datetime('now'))`, `CHECK(source IN ('regen_computed','client_request','manual_add'))`). The P2 plan's `strftime(...)` default is superseded — use `datetime('now')` to match sibling migrations. Controller must commit ONE file; do not let P2 and P3 ship two different DDLs.

### 1.2 Shared types

| Artifact | File | Pre-committed by | Consumed by |
|---|---|---|---|
| `KeywordSetSource` union + `StrategyKeywordSetRow` interface + `ActiveStrategyKeyword` alias | `shared/types/strategy-keyword-set.ts` (NET-NEW) | **P2 pre-commit** | P3 Lane A (server typing), P3 Lane C (`ActiveStrategyKeyword` prop on `SiteTargetKeywords`), P3 Lane D (`useStrategyKeywordSet` hook + API wrappers) |
| Domain stub: `getStrategyKeywordSet`, `reconcileStrategyKeywordSet`, `addStrategyKeyword`, `removeStrategyKeyword`, `keepStrategyKeyword` (typed signatures, throw `'not implemented'`) | `server/domains/strategy/managed-keyword-set.ts` (NET-NEW; creates `server/domains/strategy/` dir) | **P2 pre-commit** (stub) | P3 Lane A (fills bodies), P3 Lane B/F (tests written against the interface) |
| `FixContext` extension — 6 optional fields: `rationale?`, `competitorProof?`, `volume?`, `intent?`, `questionKeywords?`, `serpFeatures?` | `src/App.tsx` (existing interface @ `:77-98`, after `pageType?`) | **P2 pre-commit** | P3 Lane C/E (the 4 receiver layers), P3 Lane B/F (`fix-context-both-halves` test) |
| `competitor` added to `RecType` union (15th member) | `shared/types/recommendations.ts` (`:6`) | **P4 pre-commit** (union value ONLY) | P4 Lane C (resolves the 5 exhaustive-map compile errors) |

> **Verified:** `FixContext` exists at `src/App.tsx:77`, `pageType?` at `:97`. `RecType` has 14 members today (no `competitor`). Adding the union value alone will break all `Record<RecType, …>` maps at compile — that is the intended forcing function for P4 Lane C.

### 1.3 Child feature flags — see full inventory in §4. Summary of pre-commit ownership:

| Flag | Defaults map added by | Catalog + group-keys added by | Activated (gated UI/logic) by |
|---|---|---|---|
| `strategy-keywords-managed-set` | **P2 pre-commit** | **P2 pre-commit** | P3 Lane D (UI), P3 Lane A (write path) |
| `strategy-competitor-send` | **P2 pre-commit** | **P2 pre-commit** | P4 Lane C |
| `strategy-signal-fold` | **P2 pre-commit** | **P2 pre-commit** | P4 Lane A |

> **CANONICAL DECISION (resolves a P2↔P4 divergence):** All three child flags are added to `shared/types/feature-flags.ts` in the **P2 pre-commit** (P2-contract-1 adds all three to defaults map + `FEATURE_FLAG_CATALOG` + the Strategy group `keys` array). The **P4 pre-commit must NOT re-add** `strategy-signal-fold` / `strategy-competitor-send` — they already exist from P2. P4 §1a's "add to defaults map" instruction is **superseded**: P4 only *consumes* them. The P3 lane plan's C1 (which adds only `strategy-keywords-managed-set`) is the P3 view if P2 had not pre-committed; since P2 pre-commits all three, P3-C1 becomes a verify-only step. Controller enforces: **flags enter the catalog exactly once, in P2.** `npm run verify:feature-flags` must pass after the P2 pre-commit.

### 1.4 WS events

| Constant | File | Pre-committed by | Consumed by |
|---|---|---|---|
| `STRATEGY_KEYWORD_SET_UPDATED` | `server/ws-events.ts` (`WS_EVENTS`, after `STRATEGY_UPDATED` @ `:139`) | **P2 pre-commit** | P3 Lane A (`broadcastToWorkspace` on every keyword-set mutation), P3 Lane D (`useWorkspaceEvents` handler invalidating `queryKeys.admin.strategyKeywordSet`) |
| `STRATEGY_SIGNAL_FOLD_UPDATED` (reserved/observability only; fold reuses `RECOMMENDATIONS_UPDATED`) | `server/ws-events.ts` (`WS_EVENTS`) | **P4 pre-commit** | reserved — not functionally consumed in P4 |

> **CANONICAL DECISION (resolves a P2↔P3 string divergence):** the P2 lane plan writes the event value as `'strategy:keyword-set:updated'` (colon separator); the P3 lane plan writes `'strategy:keyword-set-updated'` (hyphen). **Canonical = `'strategy:keyword-set-updated'`** (hyphen in the segment, matching the P3 plan and the `STRATEGY_SIGNAL_FOLD_UPDATED: 'strategy:signal-fold-updated'` sibling pattern). The constant NAME (`STRATEGY_KEYWORD_SET_UPDATED`) is identical in both — only the string literal differs. Since the constant is referenced by name everywhere (data-flow rule forbids inline literals), a wrong literal would not break compilation but WOULD silently break the broadcast→handler round-trip if any test or external consumer hard-codes the string. Controller commits the hyphen form in P2; P3 Lane A/D reference by constant name only.

### 1.5 Query keys

| Artifact | File | Pre-committed by | Consumed by |
|---|---|---|---|
| `strategyKeywordSet: (wsId) => ['admin-strategy-keyword-set', wsId] as const` | `src/lib/queryKeys.ts` (admin group, after `strategyDiff` @ `:91`) | **P2 pre-commit** | P3 Lane D (`useStrategyKeywordSet` query + invalidation), P3 Lane D `useWorkspaceEvents` handler |

> **Verified:** `strategyDiff` factory is at `src/lib/queryKeys.ts:91`. Insert the new factory immediately after it under the `admin` group.

### 1.6 Enum value additions (two SEPARATE unions — do not conflate)

| Value(s) | Union | File | Pre-committed by | Consumed by |
|---|---|---|---|---|
| `topic_cluster_keep`, `content_gap_keep` | `ActionType` (outcome-tracking) | `shared/types/outcome-tracking.ts` (after `local_service_added` @ `:19`) | **P2 pre-commit** | P3 Lane E (`tracked_actions` keep UI for ContentGaps/TopicClusters), P3 Lane F keep-durability test |
| `strategy_keyword_kept`, `strategy_keyword_removed`, `strategy_keyword_added` | `ActivityType` (activity log) | `server/activity-log.ts` (after `post_voice_scored` @ `:164`) | **P2 pre-commit** | P3 Lane A (`addActivity()` on every keyword-set mutation) |

> **CANONICAL DECISION (resolves a P2↔P3 union-target divergence — IMPORTANT):** These are **two different unions in two different files**, and the lane plans disagree about where the `strategy_keyword_*` values live:
> - **`ActionType`** in `shared/types/outcome-tracking.ts` — outcome-intelligence tracking. **VERIFIED: `strategy_keyword_added` ALREADY EXISTS at `outcome-tracking.ts:8`.** Only `topic_cluster_keep` + `content_gap_keep` are net-new here.
> - **`ActivityType`** in `server/activity-log.ts` — activity-log entries. **VERIFIED: none of `strategy_keyword_kept/removed/added` exist there today** (terminal is `post_voice_scored` @ `:164`).
>
> The P2 plan (contract-6) wrongly proposes adding `strategy_keyword_kept`/`strategy_keyword_removed` to **`outcome-tracking.ts`**. The P3 plan (C5) correctly puts all three `strategy_keyword_*` activity types into **`server/activity-log.ts`** (`ActivityType`), and (C6) puts `topic_cluster_keep`/`content_gap_keep` into **`outcome-tracking.ts`** (`ActionType`). **Canonical = the P3 split.** The P2 pre-commit must implement BOTH files correctly:
> 1. `shared/types/outcome-tracking.ts` (`ActionType`): append `topic_cluster_keep`, `content_gap_keep` ONLY. Do NOT re-add `strategy_keyword_added` (it already exists @ `:8`) — a duplicate union member is a no-op but pollutes the diff; do NOT add `strategy_keyword_kept`/`removed` here.
> 2. `server/activity-log.ts` (`ActivityType`): append `strategy_keyword_kept`, `strategy_keyword_removed`, `strategy_keyword_added` — admin-only, NOT in `CLIENT_VISIBLE_TYPES`.
>
> Lane A's `addActivity()` calls reference the `ActivityType` values (from `activity-log.ts`). The `tracked_actions` keep writes reference the `ActionType` values (from `outcome-tracking.ts`). Mixing them up = silent `safeParse` fallback / wrong-table write. Controller must verify both files in the P2 pre-commit and confirm no duplicate `strategy_keyword_added` in `outcome-tracking.ts`.

### 1.7 pr-check rules

| Rule | File | Pre-committed by (stub) | Fleshed out by | Scope |
|---|---|---|---|---|
| `incomplete-rec-filter` | `scripts/pr-check.ts` + `docs/rules/automated-rules.md` | **P2 pre-commit** (stub) | **P2 Lane D** (full regex/body) | `src/components/strategy/**` |
| `strategy-send-must-route-through-lifecycle` | `scripts/pr-check.ts` + `docs/rules/automated-rules.md` | **P2 pre-commit** (stub) | **P2 Lane D** (full regex/body) | `src/components/strategy/**` |

> **CANONICAL DECISION (resolves a P2/P3/P4 triple-listing of the same two rules):** Both pr-check rules are introduced **once, in P2** (P2-contract-8 stubs them, P2 Lane D fleshes them out and runs `npm run rules:generate`). The P3 lane plan's C9 and P4 lane plan's §1d **both re-list these same two rules** — that is because each phase plan was written to be self-contained, but the rules physically land in P2. **Controller enforces:** the rules are committed in P2; P3 and P4 pre-commits do NOT re-add them (they already exist). If P3/P4 agents find the rules missing, that means P2 was not merged — a phasing-gate violation, stop and escalate. The escape-hatch strings are canonicalized below (the plans drift on the hatch token):
> - `incomplete-rec-filter` hatch: **`// incomplete-rec-filter-ok`** (consistent across all three plans).
> - `strategy-send-must-route-through-lifecycle` hatch: the P2/P3 plans use **`// strategy-send-must-route-through-lifecycle-ok`**; the P4 plan uses the shorter `// strategy-send-lifecycle-ok`. **Canonical = `// strategy-send-must-route-through-lifecycle-ok: <renderer-name>`** (the full form). P4 Lane C must use the full hatch token if it ever needs one (it should not — competitor send routes through `sendRecommendation()`).
> Both rules are pattern-based → inline hatch **on the same line** as the flagged code (per `feedback_pr_check_hatch_placement`).

### 1.8 Net-new components / hooks / helpers (not shared contracts, but cross-phase-referenced)

| Artifact | File | Built by | Consumed later by |
|---|---|---|---|
| `useShowMore<T>` hook | `src/hooks/useShowMore.ts` | **P1** | P2 (none new), P3 Lane C (extend to new surfaces) |
| `WhyHowResult` presenter | `src/components/strategy/shared/WhyHowResult.tsx` (NET-NEW dir) | **P3 Lane C** | **P4 Lane C** (read-only consume in `CompetitiveIntel` row expansion — must NOT modify) |
| `mintSignalRecs()` | `server/recommendations.ts` | **P4 Lane A** | — |
| `useStrategyKeywordSet` hook | `src/hooks/admin/useStrategyKeywordSet.ts` (NET-NEW) | **P3 Lane D** | — |
| 4 typed API wrappers (keyword-set CRUD) | `src/api/keyword-strategy.ts` | **P3 Lane D** | — |

---

## 2. COLLISION MATRIX — every file touched by >1 lane across ALL phases

A file is a **collision** if more than one lane (within or across phases) writes it. Cross-phase collisions are serialized by the phase-gate (phase N fully merges before N+1 starts), so the true parallel-conflict risk is **intra-phase**. This matrix lists every multi-writer file with its single-owner / sequencing rule.

### 2.1 `src/components/KeywordStrategy.tsx` — THE most contested file (touched in P1, P2, P3, P4)

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P1 | single agent | What Changed promote above cockpit, delete "Reference & Analysis" divider, demote `StrategyHowItWorks`, CannibalizationTriage swap | P1 is not lane-parallel here — sequential. |
| P2 | **Lane A ONLY** | rename Rankings label, move `siteKeywords`/`opportunities`/`clientFeedbackCombinedEl` into the rankings tab | **Lane A exclusive.** No other P2 lane touches it. |
| P3 | **Lane D ONLY** | pass `strategy-keywords-managed-set` flag prop, wire `useStrategyKeywordSet` data into `SiteTargetKeywords`, wire client-keyword promotion handler | **Lane D exclusive.** Lanes C and E MUST NOT edit it. Any cross-lane need that touches it → Lane D absorbs it. |
| P4 | **Lane B primary; Lane A sequenced** | Lane B removes `localSeoEl`/`settingsEl`/`clientFeedbackCombinedEl` leak + mounts `StrategyConfigPanel`. Lane A deletes `import IntelligenceSignals` (`:21`), `intelligenceSignalsEl` (`:253`, `:422`). | **Lane B owns the file.** Lane A's 3 deletions land as a SEPARATE labeled commit the controller applies AFTER Lane B merges. Alternative: Lane A gates `intelligenceSignalsEl` behind `strategy-signal-fold` and leaves a stub until a final controller cleanup commit. **Never edit simultaneously.** |

> **Single-owner rule across all phases:** exactly one lane owns `KeywordStrategy.tsx` per phase (P2→A, P3→D, P4→B). The only intra-phase sharing is P4 (B primary + A sequenced) — resolved by serialized commit, NOT parallel edit. The phase-gate serializes P1/P2/P3/P4 edits automatically.

### 2.2 `src/components/strategy/SiteTargetKeywords.tsx` — split-ownership inside P3

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P1 | single agent | `useShowMore` applied | sequential |
| P3 | **Lane C (display) THEN Lane D (mutations)** | Lane C: add `managedKeyword?: ActiveStrategyKeyword \| null` prop + 3 visual states (In Set / Removed / Candidate), display only. Lane D: add/remove/keep mutation controls + search-and-add + "Added from opportunities" annotation, behind `strategy-keywords-managed-set`. | **Sequential: Lane C commits the display extension first; Lane D layers mutations on top.** To allow true parallelism, the **props interface is fixed in the P3 pre-commit** so C and D code against the same contract. C owns visual-state props; D owns the hook + mutation wiring. |

### 2.3 `shared/types/feature-flags.ts` — touched in every phase's pre-commit (serialized by gate)

| Phase | Pre-commit change | Rule |
|---|---|---|
| P2 | adds all 3 child flags (defaults + catalog + Strategy group keys) | controller-only |
| P3 | **verify-only** (flags already present from P2) — do NOT re-add | controller-only; P3-C1 degrades to a verification step |
| P4 | **must NOT re-add** `signal-fold`/`competitor-send` (present from P2); P4 §1a is superseded | controller-only |

> Serialized by the phase-gate, so no parallel conflict — but the **canonical rule is "added once in P2."** Each later phase's pre-commit only verifies. This prevents duplicate-key `verify:feature-flags` failures.

### 2.4 `server/keyword-strategy-persistence.ts` — P2 Lane B stub vs P3 Lane A real wiring

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P2 | **Lane B** | wires `reconcileStrategyKeywordSet(ws.id, strategy)` call into `writeKeywordStrategy` txn (`:169`, after sibling reconcilers `:212-214`) — against the STUB domain module | Lane B exclusive in P2. |
| P3 | **Lane A** | the stub becomes real (Lane A implements the domain module + may adjust the call site) | Lane A exclusive in P3. |

> Serialized by gate (P2 merges before P3). No parallel conflict. **Note the seam is LOCKED:** `persistKeywordStrategy`'s `writeKeywordStrategy = db.transaction(...)` (`:169`), NOT `saveRecommendations()` (which has zero `db.transaction`). Review blocks any hook into `saveRecommendations`.

### 2.5 `server/domains/strategy/managed-keyword-set.ts` — P2 stub → P3 implementation

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P2 | **pre-commit (controller)** | NET-NEW stub: 5 typed signatures that throw `'not implemented'`; creates the `server/domains/strategy/` directory | controller-only |
| P3 | **Lane A** | fills the 5 function bodies (stmt cache, `rowToManagedKeyword()` mapper, reconciler algorithm, auto-replenish) | Lane A exclusive |

> Serialized by gate. No parallel conflict.

### 2.6 `scripts/pr-check.ts` + `docs/rules/automated-rules.md` — P2 stub vs P2 Lane D

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P2 | **pre-commit (controller)** stub, then **Lane D** fleshes bodies + `rules:generate` | both rules introduced here, once | The pre-commit stubs both rules; Lane D writes the real regex and regenerates the doc. P3-C9 and P4-§1d are NO-OPS (rules already exist). |

> `docs/rules/automated-rules.md` must be committed together with `scripts/pr-check.ts` (CI fails on drift from `npm run rules:generate`).

### 2.7 `src/App.tsx` — P2 pre-commit only

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P2 | **pre-commit (controller)** | extend `FixContext` with 6 optional fields (type-only, no JSX) | controller-only. P3 Lane C/E import the type; **must NOT re-extend** `FixContext`. |

### 2.8 `server/ws-events.ts` — P2 (`STRATEGY_KEYWORD_SET_UPDATED`) + P4 (`STRATEGY_SIGNAL_FOLD_UPDATED`)

| Phase | Pre-commit change | Rule |
|---|---|---|
| P2 | add `STRATEGY_KEYWORD_SET_UPDATED: 'strategy:keyword-set-updated'` (hyphen — §1.4) | controller-only |
| P4 | add `STRATEGY_SIGNAL_FOLD_UPDATED: 'strategy:signal-fold-updated'` (reserved) | controller-only |

> Serialized by gate; both are additive constant entries — no parallel conflict.

### 2.9 `src/components/strategy/index.ts` — P4 Lane D only (but referenced by P1/P3 reads)

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P4 | **Lane D ONLY** | remove exports for `OpportunitiesList`, `RequestedKeywordTriage`, `DecisionQueue`; re-annotate `LostQueryRecoveryCard` keep-reserved | Lane D exclusive. No other P4 lane touches it. |

### 2.10 `src/components/client/InsightsEngine.tsx` — P4 Lane C (two maps in one file)

| Phase | Who writes it | What changes | Rule |
|---|---|---|---|
| P4 | **Lane C ONLY** | add `competitor` to BOTH `REC_TYPE_TAB` (`:39`) and `TYPE_ICONS` (`:99`) + gate client competitor renderer behind `strategy-competitor-send` | Lane C exclusive. Two of the 5 lockstep maps live in this one file — both edited in Lane C's single commit. |

### 2.11 Test files — P3 Lane B scaffolds, P3 Lane F implements

| Files | Phase | Rule |
|---|---|---|
| `tests/integration/strategy-keyword-set-durability.test.ts`, `tests/integration/strategy-send-path-public-read.test.ts`, `tests/contract/fix-context-both-halves.test.ts` | P3 | **Lane B scaffolds (may `test.todo`), Lane F implements full bodies.** Sequential within P3: F waits for A+C+D+E. |
| `tests/integration/managed-set-tracked-actions-keep.test.ts` | P3 | Lane F net-new (full implementation) |

> All other test files are single-lane-owned (see each phase's ownership table). No test-file collisions outside the B→F scaffolding handoff.

### 2.12 Files single-owned per phase (no collision) — for completeness

The 5-map competitor lockstep (P4 Lane C): `server/recommendation-lifecycle.ts` (`REC_POLICY_REGISTRY:37`), `src/lib/recCategoryMap.ts` (`REC_TYPE_ACT_CATEGORY:12`), `src/lib/recTypeTab.ts` (`REC_TYPE_ADMIN_TAB:15`), `src/components/client/InsightsEngine.tsx` (two maps — §2.10), `src/components/strategy/CompetitiveIntel.tsx` — **all owned by P4 Lane C in one atomic commit.** `server/recommendation-lifecycle.ts` is also touched by P3 Lane A (mint-at-regen for `keyword_gap`/`content_refresh`) — but that is P3, serialized before P4 by the gate, so no parallel conflict; the P4 `REC_POLICY_REGISTRY` add is a disjoint line region.

> **Cross-phase note on `server/recommendation-lifecycle.ts`:** P3 Lane A adds mint-at-regen wiring; P4 Lane C adds the `competitor` `REC_POLICY_REGISTRY` entry. Same file, different phases → serialized by gate. No special handling needed beyond normal rebase.

---

## 3. PHASE + LANE DEPENDENCY GRAPH

### 3.1 Top-level phase chain (hard gates)

```
P1 (trust-recovery)  ──merged+green+operator-confirmed──▶  P2 (IA + P3 pre-commits)
P2  ──merged+green──▶  P3 (managed sets + send spine)
P3  ──merged+green+operator-confirmed──▶  P4 (consolidation)
```

P1 is an absolute block on P2/P3/P4 (graft 6 trust-recovery gate). No phase overlaps.

### 3.2 P2 intra-phase lanes (all parallel after pre-commit)

```
[P2 pre-commit controller commit: flags×3, migration 139, strategy-keyword-set.ts,
 managed-keyword-set.ts stub, ws-event (hyphen), queryKey, ActionType+ActivityType, FixContext, pr-check stubs]
        │
        ├──▶ Lane A — tab rename + IA move (KeywordStrategy.tsx)            [no lane deps]
        ├──▶ Lane B — domain stub wiring + reconciler call (persistence)   [needs pre-commit types/migration]
        ├──▶ Lane C — FixContext receiver wiring (brief 4-layer)           [needs pre-commit FixContext]
        └──▶ Lane D — flag verify + pr-check rule bodies                   [needs pre-commit only]
                        │
              [controller diff-review: git diff, grep dupes, tsc -b, vitest run]
              [scaled-code-review → merge to staging]
```

All four P2 lanes are independent. No lane consumes another lane's output.

### 3.3 P3 intra-phase lanes (two-wave: A/B/C parallel, then D/E, then F)

```
[P3 pre-commit: (mostly verify — contracts pre-landed in P2); activate strategy-keywords-managed-set]
        │
   WAVE 1 (parallel, no lane deps):
        ├──▶ Lane A — backend data model + reconciler + 4 routes + mint-at-regen     [unlocks D, E]
        ├──▶ Lane B — pr-check rule bodies + test SCAFFOLDS (test.todo ok)           [no deps]
        └──▶ Lane C — WhyHowResult + useShowMore ext + send UX on DecayingPages/      [no deps; unlocks D's
                       KeywordOpportunities + SiteTargetKeywords DISPLAY states         SiteTargetKeywords mutation layer]
        │
   WAVE 2 (after Lane A endpoints stub-complete; D also after C's SiteTargetKeywords display commit):
        ├──▶ Lane D — managed-set UI + orchestrator wiring (KeywordStrategy.tsx excl.) [needs A + C]
        └──▶ Lane E — Content keeps + brief pre-seed (tracked-actions immediate;        [tracked-actions: immediate;
                       brief layer immediate; sender field-name fix)                     brief layer: needs C7 only]
        │
   WAVE 3 (convergence gate):
        └──▶ Lane F — full integration tests                                            [needs A + C + D + E merged]
```

> **P3 nuance:** Lane E's `tracked_actions` keep portion and brief-pre-seed server layer have **no Lane A dependency** (they use the existing tracked-actions API + the pre-committed C6/C7 contracts) and can start in Wave 1. Only the parts of D/E that call the *new* keyword-set endpoints wait for Lane A. Lane F is the single convergence point.

### 3.4 P4 intra-phase lanes (all parallel; one sequenced KS.tsx cleanup)

```
[P4 pre-commit: activate strategy-signal-fold + strategy-competitor-send (VERIFY — present from P2),
 add competitor to RecType union, add STRATEGY_SIGNAL_FOLD_UPDATED reserved const,
 (pr-check rules already exist from P2 — verify only)]
        │
        ├──▶ Lane A — signal-fold (mintSignalRecs in recommendations.ts; delete IntelligenceSignals card + 2 hooks)
        │       └── KS.tsx deletions (:21/:253/:422) ── SEQUENCED: applied by controller AFTER Lane B merges
        ├──▶ Lane B — config consolidation + Local SEO dedup (KeywordStrategy.tsx PRIMARY owner)
        ├──▶ Lane C — competitor send (5-map lockstep + CompetitiveIntel; consumes WhyHowResult read-only)
        └──▶ Lane D — orphan cleanup (delete 3 files + index.ts prune; annotate LostQueryRecoveryCard)
        │
   Merge order recommendation: D first (pure deletions) → B and C in parallel → A's main work + the
   sequenced KS.tsx cleanup last.
        │
   [integration sweep → scaled-code-review → P4 gate]
```

> **P4's only intra-phase serialization:** `KeywordStrategy.tsx` is shared by Lane B (primary) and Lane A (3-line deletion). Resolved by applying Lane A's KS.tsx deletions as a separate commit AFTER Lane B merges (or gating `intelligenceSignalsEl` behind `strategy-signal-fold` until a final cleanup commit). All other P4 lane pairs are fully disjoint.

---

## 4. CHILD-FLAG INVENTORY

The redesign introduces **exactly three** child flags under the existing `strategy-command-center` umbrella (no new umbrella flag). All three are added in **one place** — the **P2 pre-commit** to `shared/types/feature-flags.ts` — in **three required locations within that file**, then activated in later phases.

| Child flag | Default | Added (defaults + catalog + group keys) | Gates (activated) | Group | Owner |
|---|---|---|---|---|---|
| `strategy-keywords-managed-set` | `false` | **P2 pre-commit** | **P3** — managed-set write path (Lane A) + add/remove/keep UI (Lane D, gated inside `SiteTargetKeywords`) | `Strategy` | analytics-intelligence |
| `strategy-signal-fold` | `false` | **P2 pre-commit** | **P4** — `mintSignalRecs` server-side fold (Lane A); also gates `intelligenceSignalsEl` render during the sequenced KS.tsx cleanup | `Strategy` | analytics-intelligence |
| `strategy-competitor-send` | `false` | **P2 pre-commit** | **P4** — `CompetitiveIntel` per-row send (Lane C) + client competitor renderer in `InsightsEngine.tsx` (Lane C) | `Strategy` | analytics-intelligence |

### 4.1 The three required locations in `shared/types/feature-flags.ts` (verified line anchors)

1. **`FEATURE_FLAG_DEFAULTS` map** (the defaults object; `strategy-command-center: false` is @ `:59`, siblings `:53/:62/:66`) — add the three keys `: false`.
2. **`FEATURE_FLAG_CATALOG`** (catalog entries; `strategy-command-center` block @ `:289`) — add three full entries with `group: 'Strategy'` + `lifecycle` block (`owner: 'analytics-intelligence'`, `createdAt: '2026-06-18'`, `rolloutTarget: 'staging-validation'`, `removalCondition`, `staleAuditCadence: 'monthly'`, `lastReviewedAt: '2026-06-18'`).
3. **Strategy group `keys` array** (`:356-357`) — currently `['signal-auto-recompute', 'strategy-command-center', 'strategy-staleness-scan', 'strategy-paid-topics']`. Append all three new keys → 7 total.

> `npm run verify:feature-flags` is the gate after the P2 pre-commit and must pass (no orphaned/ungrouped keys). **All three flags must appear in all three locations in the SAME commit** or the verifier fails.

### 4.2 Canonical anti-double-add rule (the cross-phase trap)

Because each phase lane plan was written self-contained, **P3-C1 and P4-§1a both also describe adding flags** to `feature-flags.ts`. This is the single most likely cross-phase mistake. **LOCKED:**
- The flags are physically added **once, in the P2 pre-commit.**
- P3's pre-commit treats `strategy-keywords-managed-set` as **already present** → verify-only.
- P4's pre-commit treats `strategy-signal-fold` + `strategy-competitor-send` as **already present** → verify-only; P4 §1a's "add to FEATURE_FLAGS defaults" is **superseded by this map.**
- If a later-phase agent finds a flag missing, P2 was not merged — that is a phasing-gate violation; stop and escalate, do not add the flag.

---

## 5. Release-engineering checklist (controller, per phase)

1. **Gate check:** prior phase merged + green on staging + (for P1→P2 and P3→P4) operator-confirmed. Do not branch otherwise.
2. **Pre-commit FIRST:** land all contracts for the phase in ONE commit at branch HEAD. Run `npm run typecheck && npm run verify:feature-flags` before dispatching lanes.
3. **Verify no double-add:** for P3/P4, confirm flags/rules from P2 are NOT re-added (§1.3, §1.7, §4.2).
4. **Dispatch lanes** per the dependency graph (§3). Respect exclusive file ownership; never two writers on one file simultaneously (§2).
5. **Diff-review checkpoint** after every parallel batch: `git diff`, grep for duplicate symbols, `tsc -b --noEmit`, single `npx vitest run` (never two concurrent — `feedback_no_parallel_full_vitest`).
6. **Sequenced patches:** apply P4 Lane A's `KeywordStrategy.tsx` deletions only AFTER P4 Lane B merges.
7. **`scaled-code-review`** before merge (multi-lane batch — required by CLAUDE.md quality gate).
8. **Flag-OFF byte-identical** snapshot (`recommendations-public-allowlist.test.ts`) in EVERY phase's gate.
9. **Phase-specific hard gates:** P3 durability test (the verified-clobber guard), P3 send-path public-read, P3 fixContext both-halves, P4 5-map typecheck, P4 zero-standalone-signal-card.

---

## 6. Top collision risks (ranked)

1. **`KeywordStrategy.tsx` simultaneous edit in P4** (Lane B primary + Lane A 3-line deletion). Highest concurrency risk. Mitigation: serialize — Lane A's KS.tsx deletions are a separate commit applied after Lane B merges, OR gate `intelligenceSignalsEl` behind `strategy-signal-fold`.
2. **Flag double-add across P2/P3/P4** (§4.2). Each phase plan self-describes adding flags; physically they land once in P2. Mitigation: P3/P4 pre-commits are verify-only.
3. **`strategy_keyword_*` enum landing in the wrong union** (§1.6). P2 plan points at `outcome-tracking.ts`; correct target for the activity types is `server/activity-log.ts`. `strategy_keyword_added` already exists in `outcome-tracking.ts`. Mitigation: P2 pre-commit splits correctly across both files; no duplicate.
4. **WS event string drift** `'…:updated'` vs `'…-updated'` (§1.4). Canonical = hyphen (`'strategy:keyword-set-updated'`). Mitigation: reference by constant name only; controller commits the hyphen form in P2.
5. **pr-check rule re-add / hatch-token drift** across P2/P3/P4 (§1.7). Rules land once in P2; hatch token canonical = full form `// strategy-send-must-route-through-lifecycle-ok`.
6. **`SiteTargetKeywords.tsx` C→D ordering in P3** (§2.2). Display states (C) then mutations (D). Mitigation: props interface fixed in P3 pre-commit so both code against one contract.
7. **Migration 139 DDL drift** between P2 skeleton and P3 (§1.1). Canonical = P3 version (`datetime('now')` default, `CHECK` constraint). Mitigation: commit ONE file in P2; P3 only runs/fixes-up.
```
