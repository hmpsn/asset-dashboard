# Reconcile Migration (R0–R12) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is contract + test-centric per docs/PLAN_WRITING_GUIDE.md — implementation bodies are written at execution time against real code, never transcribed from this document.

**Goal:** Close the verified data/type-layer cracks (honest Prove ledger, single-authority state, enforced vocabulary, observable execution, safe migrations) so the P2 UI rebuild lands on ground that doesn't move — with zero client-visible changes in this phase.

**Architecture:** Four parallel lanes over a Wave-A foundation, derived from the measured file-collision matrix in the pre-plan audit. The true critical path is the outcome-domain lane (R5→R11-T7→R6→R8+9 share `outcome-tracking` files), not the R3 barrier. Every fix extends an existing platform canon (state-machines.ts, flag/job registries, GLOSSARY, ui-vocabulary) — no parallel authorities.

**Tech Stack:** Express + TypeScript, SQLite (better-sqlite3, WAL, forward-only migrations), React 19 + React Query, vitest, pr-check mechanization.

**Platform: Claude/Anthropic** (Haiku / Sonnet / Opus ladder). Controller session: Opus.

---

## Overview

The Readiness Atlas verification audit (`docs/audits/2026-07-01-readiness-atlas-verification.md`) confirmed the diagnostic findings and reshaped the tickets per six ratified owner decisions. The pre-plan audit (`docs/superpowers/audits/2026-07-01-reconcile-plan-audit.md` + **canonical machine-readable scope** `2026-07-01-reconcile-plan-audit-inventories.json`) produced grep-verified file inventories (912 entries, 224 modify/create files) and the measured collision matrix this plan's lanes are built from. **Every file in this plan traces to the inventories JSON; if an executor finds it needs a file not in its ownership list, it STOPS and reports NEEDS_CONTEXT.**

Ratified decisions binding this plan: R4 keeps the two-axis model (harden, don't collapse) · R9 is cut to a coverage-funnel ticket · R12 does per-flag burn-down, never a master flag (`strategy-trust-ladder-autosend` permanently exempt) · R6 is snapshot-on-write, no hard FK · R10 drops the throttledUntil conversion, keeps the registry · R0 lands first · GBP mints a new ActionType (ships dark until Google API access opens) · R11 orphans are quarantined · R12a wording is an owner sign-off at PR time · R1 mockup intake is PROPOSED-class only.

## Pre-requisites

- [ ] Verification audit committed: `docs/audits/2026-07-01-readiness-atlas-verification.md` (3b1358af0) ✓
- [ ] Pre-plan audit committed: `docs/superpowers/audits/2026-07-01-reconcile-plan-audit.md` (3e3d07dcf) ✓
- [ ] Dedicated worktree created for the run (`superpowers:using-git-worktrees`) — the main checkout must stay free (shared-checkout hazard: another session can re-point it mid-run)
- [ ] `npm run seed:demo && npm run smoke:core` green in the worktree
- [ ] Fresh `npm run db:sync-staging` pulled before Lane R's R7 gate and before R11's migration PRs

---

## Execution Model (autonomous, subagent-driven)

**Controller (Opus, this plan's orchestrator):**
1. Owns ALL git operations. Worker subagents NEVER run `git add/commit/checkout/stash` — the controller stages **explicit file lists** and commits per task (index-contention destroyed work in a prior parallel run).
2. Dispatches one worker per task with: full task text, ownership list, cross-phase contracts, relevant CLAUDE.md conventions, gotchas, model assignment.
3. After every parallel batch: `git diff` review → duplicate-import grep on multi-agent files → `npm run typecheck` → **one** full `npx vitest run` (never two concurrently — deterministic-port EADDRINUSE flakes; kill orphaned `tsx server/index.ts` procs if a run was interrupted).
4. Runs the **merge queue**: one PR to `staging` at a time; migration-minting PRs renumber to the next free slot at merge (`164` is taken by whichever merges first; subsequent PRs bump). After each merge, all open lanes rebase.
5. Per-wave: `scaled-code-review` (Opus reviewers — never downgrade). After Wave B completes: one **holistic end-to-end review** (per-lane review + green gates have missed fixture-masked broken features before).
6. CI notes: the pr-test component lane OOM-flakes (process killed, no assertion — don't chase); a failed `changes` path-filter job can skip real lanes while aggregators pass — **inspect any red before merging**, don't trust `gh pr checks` exit code alone.
7. Autonomy contract: merge-on-green without owner input EXCEPT the three owner checkpoints in §Owner Checkpoints. If a task's real code contradicts a plan contract: STOP that lane, report, continue other lanes.

**Worker TDD discipline (state in every dispatch prompt):** (1) READ the real code first; (2) write the failing test from this plan's assertions and RUN it — confirm it fails for the right reason; (3) implement minimally against real signatures; (4) test green + `npm run typecheck`; (5) hand back a file manifest — controller commits. Never transcribe plan snippets; never skip the red.

**Universal per-PR gates:** `npm run typecheck` · `npx vite build` · `npx vitest run` (full) · `npm run pr-check` · `npm run lint:hooks` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet` · docs updated in the same commit (FEATURE_AUDIT.md / roadmap / rules docs per task).

---

## Task Dependencies

```
WAVE A (parallel — zero shared production files):
  A1 R0-PR1 (backup safety)      A2 R1-PR1 (lexicon registry)     A4 R7-PR1 (rec backfill, additive)
  A3 R1-PR2 (pr-check rules; after A2)                            A5 WS-parity contract test

BARRIER: A2+A3 merged (lexicon live) · A1 merged (gates every destructive PR from here on)

WAVE B — four lanes, file-disjoint per measured collision matrix:
  Lane V:  B1 R2 (renames) → B2 R3-PR1 (envelope+census) → B3 R3-PR2 (new transition maps)
  Lane R:  B4 R7-GATE (staging+prod counts) → B5 R7-PR2 (contract cutover) → B6 R4-PR1 (guards+sync) → B7 R4-PR2 (trigger migration)
  Lane O:  B8 R5-PR1 (catalog) → B9 R5-PR2 (consumer cutover) → B10 R11-T7 (archive-twin generator)
           → B11 R6-PR1 (snapshot expand) → B12 R6-PR2 (integrity sweep; needs B5) → B13 R89-PR1 (seams + gbp_review_reply)
           → B14 R89-PR2 (attribution required) → B15 R89-PR3 (provenance + coverage funnel)
  Lane I:  B16 R10-PR1 (cron registry + stop hooks) → B17 R10-PR2 (cancel route + job-feed class)
           [B16 adoption of strategy-issue-cron.ts + outcome-crons.ts is deferred to a follow-up commit after B6 lands — measured R4×R10 collision]

WAVE C/D (parallel once prerequisites land):
  C1 R11-T5 (snapshot registry + workspace_id retrofit; after A1)     C2 R12a (translation map; after B15 — routes/outcomes.ts clears)
  C3 R12b (per-flag burn-down; rolling, one PR per family)            C4 closeout (docs, roadmap, exit-criteria verification)

Cross-lane file coordination (from the collision matrix — merge-queue rebases, not blockers):
  routes/recommendations.ts: B5 → B6 → B12 order · outcome-crons.ts: B6 → B16-followup · server/index.ts: A4 → B16
  migrate-json.ts: B5 → C1 · backup.ts: A1 → B16 · feature-flags.ts: B6 → C3 · GLOSSARY.md: A2 → B8
```

## Bounded Context Ownership

| Lane | Primary context | Secondary | Work type |
|---|---|---|---|
| A1/R0, Lane I/R10 | platform-infrastructure (backup, crons, jobs) | — | behavior-preserving + new observability |
| A2–A3/R1, B1/R2 | platform-core shared contracts (lexicon); brand-engine (R2) | all contexts read | new contract + rename |
| Lane V/R3 | platform-core state machines | every status-writing context | behavior-preserving extension + new guards |
| Lane R/R7,R4 | strategy-recommendations | inbox (deliverable spine) | data cutover + hardening |
| Lane O/R5,R6,R8+9 | analytics-intelligence (outcomes/Prove) | inbox, content, schema, MCP | new columns + honest recording |
| C1/R11 | platform-data (snapshots/archives) | analytics-intelligence readers | schema alignment |
| C2–C3/R12 | client-portal vocabulary + feature-flag lifecycle | strategy/The Issue pilot | consolidation + burn-down |

## Cross-Phase Contracts (pre-committed before dependents dispatch)

| Contract | Created by | Consumed by |
|---|---|---|
| `shared/types/lexicon.ts` — `LexiconEntry { term; wordClass: 'canonical'\|'externally-mirrored'\|'historical'\|'proposed'; definition; canonicalType?; declarationSites?; externalSource?; resolvingTicket? }` + `LEXICON` registry + name-collision allowlist | A2 | A3, B1, B8, C2 |
| `shared/types/lifecycle.ts` — `LifecycleDefinition<S extends string> { entity; states: readonly S[]; transitions: Readonly<Record<S, readonly S[]>> }` + `LIFECYCLE_REGISTRY` over existing `*_TRANSITIONS` | B2 | B3, B7, B16 (census test) |
| `shared/types/action-catalog.ts` — `ACTION_CATALOG` keyed (context, action), entries `{ label; phase: 'detect'\|'decide'\|'do'\|'prove'; outcomeActionType?; clientVisible: boolean }`; **imports the five unions, never redefines** | B8 | B9, B13, C2 |
| `tracked_actions.source_label TEXT` + `source_snapshot TEXT` (live + archive twin, explicit column lists) + `recordAction(params: { …, source?: { label: string; snapshot?: TrackedActionSourceSnapshot } })` | B11 | B12, B13, B15 |
| `server/db/archive-twin.ts` — `assertArchiveTwinParity(liveTable, twinTable)` + generated column-list helper | B10 | B11, B15, C1 |
| `server/cron-registry.ts` — `CRON_METADATA: Record<CronId, { label; module; intervalMs; description; stopHook: boolean }>` (lazy construction — no timers at module load) | B16 | B17, C4 census |
| `shared/types/client-vocabulary.ts` — `CLIENT_VOCABULARY` satisfies per-context label maps | C2 | future P2 |
| Migration numbering: every migration file in this plan is authored as `164-*.sql` and **renumbered to the next free slot at merge** by the controller | all | merge queue |

---

## Task List — Wave A

### Task A1 — R0 Backup safety & destructive-migration contract (Model: Sonnet)
**Owns:** `server/backup.ts`, `server/storage-stats.ts`, `server/routes/health.ts`, `render.yaml`, `.env.example`, `scripts/restore-drill.ts` (create), `docs/rules/destructive-migrations.md` (create), `docs/workflows/data-integrity-recovery.md`, `docs/workflows/deploy.md`, `docs/workflows/release-safety.md`, `docs/workflows/staging-environment.md`, `tests/unit/backup.test.ts`, `tests/unit/storage-stats-prune.test.ts`, + pr-check trio (`scripts/pr-check.ts`, `tests/pr-check.test.ts`, `docs/rules/automated-rules.md`), `package.json`, `CLAUDE.md`, `FEATURE_AUDIT.md`.
**Must not touch:** anything under `server/db/migrations/` (contract doc only, no migrations here).

**Contracts:** split retention — `BACKUP_RETENTION_DAYS` (local, default stays 3) vs new `BACKUP_S3_RETENTION_DAYS` (default 30); both declared in `render.yaml` + `.env.example` (fix the existing "7" lie — code default is 3). `scripts/restore-drill.ts`: restores latest backup (local dir → S3 tar → `/api/admin/db-export` fallback) to a scratch path, runs `runDataIntegrityRecoveryReport` against it, diffs per-table counts vs the backup `_manifest.json`, exits non-zero on mismatch; wired as `npm run backup:restore-drill`. New pr-check customCheck: new migration containing `DROP TABLE` fails unless it follows rename-to-archive + delayed-drop or carries an inline hatch — baseline the 6 existing DROP migrations (019, 029, 037, 049, 091, 119). Contract doc defines: destructive step = RENAME/copy-to-archive in PR N, actual DROP in PR N+1 after staging verify + one retention window.

**Test assertions (write first):**
- `backup.test.ts`: S3 prune cutoff derives from `BACKUP_S3_RETENTION_DAYS`, local prune from `BACKUP_RETENTION_DAYS`; existing schedule/upload assertions still green.
- `pr-check.test.ts` fixtures (4-scenario harness per authoring doc): synthetic migration with bare `DROP TABLE` → error; with inline hatch → pass; baselined file → pass; negative control → pass.
- Restore-drill unit-testable core: manifest-vs-restored count diff returns mismatch list (assert on a fixture manifest).

- [ ] Read `server/backup.ts`, the authoring doc, and the fixture pattern at `tests/pr-check.test.ts:2929-3054`
- [ ] Write failing tests (retention split, pr-check fixtures) — run, confirm red
- [ ] Implement retention split + env/docs sync + drill script + contract doc + pr-check rule; `npm run rules:generate`
- [ ] Green + gates; run the drill once against a local backup and attach output to the PR body as evidence
- [ ] Controller: commit, PR → staging. **Owner-visible note:** verify `BACKUP_S3_BUCKET` is actually set in the Render dashboard (declared `sync:false`; script can't see it)

**Verify:** `npm run backup:restore-drill` exits 0 with a count-match report; `npx vitest run tests/unit/backup.test.ts --reporter=verbose`.

### Task A2 — R1-PR1 Lexicon registry + GLOSSARY restructure (Model: Opus — root contract design)
**Owns:** `shared/types/lexicon.ts` (create), `scripts/lexicon-registry.ts` (create), `tests/unit/lexicon-registry.test.ts` (create), `docs/rules/lexicon.md` (create), `GLOSSARY.md`, `shared/types/index.ts`, `package.json`, `.github/workflows/ci.yml`, `scripts/verify-platform.ts`, `scripts/report-verification-governance.ts`, `CLAUDE.md`, `FEATURE_AUDIT.md`, `data/roadmap.json`.
**Must not touch:** `scripts/pr-check.ts` (Task A3 owns the rules).

**Contracts:** `LexiconEntry` per Cross-Phase Contracts table; registry seeded from the audit's census — the **26 duplicate exported names** enter the allowlist each tagged with `resolvingTicket` (Deliverable* → R2; the 19-name GA4/GSC mirror block → documented-permanent with rationale). Word classes: externally-mirrored entries for Stripe `ContentSubStatus` words, GBP `GBP_REVIEW_RATINGS`, Webflow publish states; historical for `ActivityType` log vocabulary; **proposed** (owner decision) for redesign-mockup terms — read `hmpsn studio Design System/mockup/store.js` and intake thread kinds (`request`/`instruction`/`approval`), `promotable`, cockpit rail names as PROPOSED only, snapshotting the terms into GLOSSARY.md (sources are untracked). `verify:lexicon` = `tsx scripts/lexicon-registry.ts` modeled on `scripts/feature-flag-lifecycle.ts` (pure report functions + CLI + exit-1 on drift), wired into package.json, ci.yml (beside verify:feature-flags at :144), verify-platform.ts (:75 area). Barrel note: `shared/types/index.ts` gains `export * from './lexicon'` — do NOT add client-deliverable.ts or keyword-universe.ts to the barrel (TS2308 collisions, documented in the audit).

**Test assertions:** verifier flags an unregistered duplicate exported name; allowlisted entry with missing `resolvingTicket` fails; GLOSSARY entry ↔ registry parity both directions; word-class values constrained to the union.

- [ ] Read FEATURE_FLAG_CATALOG + feature-flag-lifecycle.ts as templates; read the census in the inventories JSON (R1 section)
- [ ] Failing tests → red → implement registry + verifier + GLOSSARY restructure + docs → green + gates
- [ ] Controller: commit, PR → staging (this is the root barrier — expedite through the merge queue)

**Verify:** `npm run verify:lexicon` exits 0; deliberately duplicate a type name in a scratch file → exits 1.

### Task A3 — R1-PR2 Lexicon pr-check rules (Model: Sonnet; after A2 merges)
**Owns:** `scripts/pr-check.ts`, `tests/pr-check.test.ts`, `docs/rules/automated-rules.md`.
**Must not touch:** `shared/types/lexicon.ts` (read-only import).

**Contracts:** two customChecks — (1) *duplicate exported domain type name* across `shared/types/` + `server/`: error when a newly-added `export type|interface` name already exists elsewhere and isn't in the lexicon allowlist (name-collision check + allowlist, NOT semantic dedupe); (2) *ActivityType minting guard*: a new member added to the `ActivityType` union in `server/activity-log.ts` without a lexicon registry entry → error. Both need the 4-scenario fixture harness; hatches are inline-only (above-line is silently ignored).

**Test assertions:** the 4-scenario block per rule (trigger / inline hatch / allowlisted / negative).

- [ ] Fixtures red → implement rules reading `LEXICON` → green → `npm run rules:generate` → gates → controller commits

### Task A4 — R7-PR1 Recommendation backfill sweep (Model: Opus — load-bearing data path)
**Owns:** `server/domains/recommendations/storage.ts` (additive only in this PR), `server/index.ts` (boot wiring), `tests/unit/recommendation-items-backfill.test.ts` (create).
**Must not touch:** `server/routes/recommendations.ts`, `server/db/migrate-json.ts` (B5 owns the cutover); the items-win fallback stays fully intact in this PR.

**Contracts:** `materializeAllRecommendationItems(): { workspaces: number; blobRecs: number; rowsWritten: number; dropped: Array<{workspaceId, recId, reason}> }` in storage.ts — idempotent (skips any workspace where `recommendation_items` already has rows: the count>0 guard is the mixed-prod-state safety and must be test-pinned), per-item Zod validation via `parseJsonSafeArray` (one bad item never drops the set; every drop logged with workspaceId+reason). Boot wiring in `server/index.ts` BEFORE `runOutcomeRemediation`, logging per-workspace blob-vs-rows counts at startup.

**Test assertions:** blob with N valid + 1 malformed rec → N rows + 1 dropped entry (not zero rows); second run writes 0 (idempotence); workspace with existing rows untouched; carry-over fields (`client_status`, `lifecycle`, `throttledUntil`, `sentAt`, `struckAt`) copied byte-for-byte from blob recs.

- [ ] Read storage.ts fork (`loadRecommendationSet` ~:183, `writeItems`), migration 158, and `docs/rules/strategy-recommendations.md`
- [ ] Failing tests → red → implement → green + gates → controller commits, PR → staging

**Verify:** `npx vitest run tests/unit/recommendation-items-backfill.test.ts --reporter=verbose`; startup log shows per-workspace counts locally (6 blobs → rows written).

### Task A5 — WS-mirror parity contract test (Model: Sonnet)
**Owns:** `tests/contract/ws-events-parity.test.ts` (create).
**Must not touch:** `server/ws-events.ts`, `src/lib/wsEvents.ts` (if they already disagree, report the diff — fixing is a separate commit the controller reviews).

**Contract:** parse both files' exported event-constant string values (reuse `scripts/ws-contract-parser.ts` where possible); assert set equality with a documented exceptions list (empty to start). This closes the audit's "server-only event slips both nets" gap.

**Test assertions:** current sets are equal (or the test fails and surfaces the real drift — that's a finding, not a test bug); adding a constant to a fixture-copy of one side fails the comparison.

- [ ] Write test → run → if red on real drift: STOP, report the diff to controller → else green → controller commits

---

## Task List — Wave B, Lane V (vocabulary)

### Task B1 — R2 Deliverable renames (Model: Haiku — mechanical with hard constraints)
**Owns:** `shared/types/brand-engine.ts`, `server/brand-identity.ts`, `server/brand-deliverable-read-model.ts`, `server/state-machines.ts` (DeliverableStateStatus removal ONLY), `src/components/brand/IdentityTab.tsx`, `tests/unit/brand-identity-deliverables.test.ts`, `tests/unit/brand-slice.test.ts`.
**Must not touch:** `shared/types/client-deliverable.ts` (spine keeps canonical names), `shared/types/admin-deliverable-view.ts` (DeliverableStatusAxis stays).

**Contracts:** `DeliverableType`→`BrandDeliverableType`, `DeliverableStatus`→`BrandDeliverableStatus` in brand-engine.ts + its 3 production consumers + 2 tests. Delete `DeliverableStateStatus` from state-machines.ts (verified value-identical to spine `DeliverableStatus`, zero importers). **HARD CONSTRAINT — whole-word type references only.** These 9 function names contain the substrings and must NOT change: `clientActionDeliverableType`, `syncApprovalBatchDeliverableStatus`, `setDeliverableStatus`, `mapWorkOrderStatusToDeliverableStatus`, `mapContentRequestStatusToDeliverableStatus`, `mapCopyStatusToDeliverableStatus`, `isClientFacingDeliverableStatus` (+2 more per inventory — grep before editing). Update lexicon allowlist: mark the Deliverable* entries resolved (remove or flip to historical). String-literal-rename rule: whole repo, one commit.

**Test assertions:** typecheck green; `grep -rn 'from.*brand-engine' | grep -E '\bDeliverable(Type|Status)\b'` → zero; the 9 protected names still exist verbatim.

- [ ] Grep census → rename → typecheck red→green loop → gates → controller commits

### Task B2 — R3-PR1 Lifecycle envelope + census (Model: Opus — canon design, zero behavior change)
**Owns:** `shared/types/lifecycle.ts` (create), `server/state-machines.ts` (retype over envelope, no vocabulary changes), `docs/rules/lifecycle-state-machines.md` (create), `docs/adr/` (DB-trigger deferral ADR), `docs/rules/development-patterns.md` + `CLAUDE.md` (fix the stale 2-arg `validateTransition` examples — both currently show a wrong API), `tests/contract/lifecycle-envelope.test.ts` (create), `tests/unit/state-machine-graph-contract.test.ts`.
**Must not touch:** the recommendation two-axis shape — `RECOMMENDATION_TRANSITIONS`/`CLIENT_REC_TRANSITIONS` vocabulary and `docs/rules/strategy-recommendations.md` are a hard boundary (R4 owner decision already made: keep).

**Contracts:** `LifecycleDefinition<S>` + `LIFECYCLE_REGISTRY` wrapping the existing 16 tables (17th arrives in B3); census doc classifies all ~37 exported + ~15 local Status unions into mapped-lifecycle / unmapped-lifecycle / classification with one-line evidence each — classifications are explicitly out of scope forever. ADR: DB-layer BEFORE-UPDATE triggers deferred (SQLite CHECK can't see old values; scope decision documented, revisit post-Reconcile).

**Test assertions:** envelope contract test — every `*_TRANSITIONS` export in state-machines.ts is registered in `LIFECYCLE_REGISTRY`; every registered definition's transition targets ⊆ its states; existing graph-contract test still green (proves zero behavior change).

- [ ] Read state-machines.ts fully + the census in inventories JSON → failing contract test → implement envelope + census doc + doc fixes → green + gates → controller commits

### Task B3 — R3-PR2 New transition maps + guard coverage (Model: Sonnet)
**Owns:** `server/copy-review.ts` (fold its parallel `VALID_TRANSITIONS` machine into state-machines.ts), `server/state-machines.ts` (new maps), the ~13 unmapped-lifecycle write-path files from the inventory (`analytics-insights-store.ts`, `seo-suggestions.ts`, `schema-queue.ts`, `page-edit-states.ts`, `suggested-briefs-store.ts`, `diagnostic-store.ts`, `client-signals-store.ts`, `discovery-ingestion.ts` + route, `client-locations.ts`, `client-discovered-queries.ts`, `page-strategy.ts`, `rank-tracking-reconciliation.ts`, `payments.ts`, `copy-batch-jobs.ts`, `voice-calibration.ts`, `server/mcp/tools/insights.ts`, `server/routes/insights.ts`), `tests/unit/copy-review-transitions.test.ts`, `tests/unit/state-machines.test.ts`, `tests/contract/state-machine-guard-coverage-contract.test.ts`, pr-check trio (transition-guard regex fix per inventory).
**Must not touch:** recommendation/deliverable maps (Lane R territory).

**Contracts:** each new map is derived from the store's **actual write call sites** (the TRACKED_KEYWORD comment block is the template), with deliberate idempotent self-edges for retry/no-op paths — the inventory warns that guarding previously-tolerated illegal moves (re-dismiss a dismissed suggestion, bulk MCP re-resolve, cron retries) throws `InvalidTransitionError` at runtime; every such site gets either a self-edge or route-level no-op handling, decided per site by reading the caller.

**Test assertions:** per new map — legal path passes, illegal path throws, retry self-edge no-ops (FM-2 style); coverage contract test count rises from 12 entities to the new total; copy-review imports from state-machines.ts (its local machine deleted).

- [ ] Per-enum batches (3–4 enums per red→green cycle), full suite between batches → gates → controller commits

---

## Task List — Wave B, Lane R (recommendations)

### Task B4 — R7-GATE Staging + prod count verification (Controller-run, Opus; no code)
After A4 deploys to staging: run blob-vs-rows counts on staging DB; pull prod backup via `scripts/pull-render-latest-backup.sh` and run the same counts. **PASS =** `recommendation_items` rows ≥ valid blob recs for every workspace with a non-empty blob, and every dropped item has a logged reason that is investigated (a missing RecType enum member would shed every rec of that type — that's a STOP, not a tolerance). Record the evidence table in the PR body of B5. FAIL → STOP lane, report.

### Task B5 — R7-PR2 Contract cutover (Model: Opus — destructive, follows R0 contract)
**Owns:** `server/domains/recommendations/storage.ts`, `server/db/migrate-json.ts` (rewrite `migrateRecommendations` to emit item rows — it's a second blob writer), `server/routes/recommendations.ts`, `server/rec-discussion.ts`, `server/rec-operator-overrides.ts`, `server/schemas/workspace-schemas.ts`, `server/db/migrations/164-retire-recommendation-sets-blob.sql` (blank blobs to `'[]'`), `server/db/migrations/1XX-drop-recommendation-sets-blob-column.sql` (delayed drop, merges one retention window later per R0 contract), `docs/rules/recommendation-storage.md`, `docs/rules/strategy-recommendations.md`, the 6 blob-pinning test files (`tests/unit/recommendations-extended.test.ts`, `tests/unit/db/migrate-json.test.ts`, `tests/unit/outcome-backfill-pure.test.ts`, `tests/integration/a1-outcome-remediation.test.ts`, `tests/integration/seo-genquality-p4-ov-coherence.test.ts`, `tests/integration/seo-genquality-p5-orphan-recs.test.ts`).
**Must not touch:** `recommendation-lifecycle.ts` single-writer, dual-write mirrors (B6 owns them).

**Contracts:** `loadRecommendationSet` reads rows only — fallback and lazy-materialize deleted; `saveRecommendationSet` writes `'[]'` to the blob (column becomes archive placeholder until the delayed drop); rows are the sole store. WS acceptance line: `RECOMMENDATIONS_UPDATED` payload shape unchanged (this is a storage cutover, not a shape change) — pinned invalidation tests must stay green untouched.

**Test assertions:** seeding only a blob (legacy shape) now yields empty set + loud log (fallback gone); migrate-json emits rows for a legacy JSON fixture; all 6 rewritten test files seed rows, not blobs; MCP `list_recommendations` integration path returns identical output before/after (snapshot in B4 evidence).

- [ ] Read every blob consumer (confined to storage.ts + migrate-json.ts + tests, per inventory) → rewrite tests red → cutover → green + gates → controller commits; delayed-drop migration opens as a SEPARATE draft PR scheduled +1 retention window

### Task B6 — R4-PR1 Verifiable dual-write + mirror sync (Model: Sonnet)
**Owns:** `server/domains/inbox/recommendation-dual-write.ts`, `server/domains/inbox/client-action-dual-write.ts`, `server/domains/inbox/client-actions-mutations.ts`, `server/domains/inbox/recommendation-mirror-sync.ts` (create), `server/domains/inbox/deliverable-adapters/recommendation.ts`, `server/domains/recommendations/status-service.ts`, `server/domains/recommendations/resolution-service.ts`, `server/routes/recommendations.ts`, `server/client-deliverables.ts`, `server/strategy-issue-cron.ts`, `server/outcome-crons.ts`, `server/deliverable-divergence-sweep.ts` (create), `docs/rules/strategy-recommendations.md`, `shared/types/feature-flags.ts` (if sweep ships flag-gated), tests: `client-action-dual-write`, `recommendation-lifecycle`, `recommendation-resolution`, `strategy-autosend-cron`, `strategy-the-issue-loop` integration files + `deliverable-divergence-sweep.test.ts` (create).
**Must not touch:** `server/recommendation-lifecycle.ts` internals (single-writer is frozen — call it, never re-implement); `CLIENT_REC_TRANSITIONS` vocabulary.

**Contracts:** dual-write returns a typed result `{ ok: boolean; deliverableId?: string; error?: string }`; all three callers observe it (failure → activity log entry + Pino error, never silent). `recommendation-mirror-sync.ts`: the client act-on path advances the rec-sourced deliverable mirror (`awaiting_client`→`approved` via the deliverable store — pr-check forbids direct inserts). Divergence sweep: read-only report job comparing rec clientStatus vs mirror status, surfacing pairs that disagree (the two divergence-by-construction paths from the inventory). WS acceptance: deliverable events (`DELIVERABLE_UPDATED`) + invalidation handlers + pinned contract tests updated in this PR.

**Test assertions:** act-on advances the mirror row (integration, real deliverable store); swallowed-failure path now produces an activity entry; sweep flags a hand-seeded divergent pair and touches nothing.

### Task B7 — R4-PR2 Struck≠completed DB constraint (Model: Sonnet; after B6 verified on staging)
**Owns:** `server/db/migrations/164-recommendation-items-struck-ne-completed.sql`, `tests/integration/recommendation-items-struck-constraint.test.ts` (create).
**Contracts:** INSERT+UPDATE **trigger pair** (not CHECK — SQLite can't add CHECK to an existing table) raising `ABORT` when `NEW.lifecycle='struck' AND NEW.status='completed'`. Ordering is load-bearing: app-level guards (B6) MUST be live first — `writeItems` is delete+reinsert inside one transaction, so one violating row aborts an entire regen save.

**Test assertions:** direct SQL violating write → SQLITE_CONSTRAINT abort; full regen save of a clean set unaffected; the guarded app path never reaches the trigger (guard fires first).

---

## Task List — Wave B, Lane O (outcomes — serialized within the lane)

### Task B8 — R5-PR1 Action catalog (Model: Sonnet)
**Owns:** `shared/types/action-catalog.ts` (create), `tests/contract/action-catalog.test.ts` (create), `docs/rules/action-catalog.md` (create), `shared/types/index.ts`, `GLOSSARY.md` (catalog terms), `CLAUDE.md`.
**Must not touch:** the five union definitions (import-only — `ScoringConfig = Record<ActionType,…>` breaks if any union is widened).

**Contracts:** `ACTION_CATALOG` per Cross-Phase Contracts; completeness via `satisfies` mapped types over each imported union (RecType, ActionType, ClientActionSourceType, KeywordCommandCenterActionType, and the MCP enums from `shared/types/mcp-action-schemas.ts` — NOT server/mcp/tools/*). Keep-markers (`topic_cluster_keep`, `content_gap_keep`) documented as live-producer entries, never dropped. Labels use R1 word classes + ui-vocabulary canonical wording.

**Test assertions:** contract test fails when any union member lacks a catalog entry (delete one from a fixture-copy → red); no catalog key exists outside its source union.

### Task B9 — R5-PR2 Consumer cutover (Model: Sonnet)
**Owns:** `server/routes/outcomes.ts` (labels read catalog), `src/components/admin/outcomes/outcomeConstants.ts`, `src/lib/decision-adapters.ts`, `scripts/seed-demo-workspaces.ts`, `docs/rules/seo-generation-quality.md`, phantom-entry cleanup per inventory.
**Must not touch:** `src/components/client/OutcomeSummary.tsx`, `WinsSurface.tsx` — client-visible label folding belongs to C2/R12a (owner wording sign-off), not here. Admin-side only.

**Test assertions:** admin outcome labels resolve through the catalog; behavior parity snapshot on the outcomes route response (labels unchanged where wording already agreed).

### Task B10 — R11-T7 Archive-twin generator (Model: Sonnet)
**Owns:** `server/db/archive-twin.ts` (create), `tests/unit/archive-twin-parity.test.ts` (create), `server/outcome-tracking.ts` (convert `archiveOld`/`archiveOldOutcomes` explicit column lists to generated), `server/db/migrations/164-archive-twin-rebuild.sql` (rename twins to `*_r11_old`, recreate in canonical live-column-order + trailing `archived_at`, copy with explicit lists), `server/__tests__/outcome-archive-round-trip.test.ts`, pr-check trio (live+twin ALTER lockstep rule), boot drift-assert wiring.
**Must not touch:** `recordAction` signature (B11).

**Contracts:** `assertArchiveTwinParity` compares live-table pragma to twin (twin = live columns in order + `archived_at`); runs at boot, throws on drift. pr-check rule: an ALTER on `tracked_actions`/`action_outcomes` in a migration without the twin ALTER in the same file → error. **Positional-INSERT hazard from the inventory: all copies use explicit column lists — never `SELECT *`.**

**Test assertions:** parity test fails when a fixture live table gains a column its twin lacks; round-trip archive→restore preserves every column byte-for-byte; rebuild migration on a seeded DB loses zero rows.

### Task B11 — R6-PR1 Snapshot-on-write expand (Model: Opus — 20 call sites, 14 files, archive hazard)
**Owns:** `server/db/migrations/164-tracked-action-source-snapshot.sql` (both tables), `shared/types/outcome-tracking.ts` (source-ref union as `KnownSourceType | (string & {})` — soft, no external break; `TrackedActionSourceSnapshot` type), `server/outcome-tracking.ts` (recordAction optional `source` param), `server/db/outcome-mappers.ts`, `server/schemas/outcome-schemas.ts`, the 20 recordAction call-site files (per inventories JSON R6 section: approval-batch-apply, client-action-feedback-loop, publish-post-to-webflow, publish-schema-to-live, content-brief-generation-job, workspace-context-generation-job, keyword-strategy-persistence, outcome-measurement-keywords, routes/{outcomes,recommendations,content-decay,webflow-analysis}, client-deliverables, deliverable-adapters/types, outcome-backfill, outcome-crons…), `docs/adr/0007-ephemeral-source-snapshot-ref.md` (create), `CLAUDE.md`, unit/integration tests per inventory.
**Must not touch:** `server/routes/recommendations.ts` until B5 has merged (measured collision); `client_deliverable.source_ref` consumers beyond the shared types (adapter changes ride B6's merged base).

**Contracts:** additive columns `source_label TEXT`, `source_snapshot TEXT` (JSON, `parseJsonSafe`-read) on live + twin in one migration (generated lists from B10); `recordAction` threads `source` through all 20 sites — each site snapshots the source's identity (title/type/page) **at write time**; `resolveWinTitle`/label resolution becomes snapshot-first with the existing live-lookup + generic fallback intact (fallback demotion happens in B12, not here). ADR names the "ephemeral-source snapshot ref" pattern and marks `client_deliverable.source_ref` as the second application site.

**Test assertions:** recordAction with `source` persists label+snapshot; archive round-trip preserves both new columns; win-title resolution order = snapshot → live → generic (three-fixture test); a call site passing no source still works (columns nullable).

### Task B12 — R6-PR2 Integrity sweep + backfill (Model: Sonnet; needs B5 merged)
**Owns:** `server/outcome-source-integrity-sweep-job.ts` (create), `tests/unit/outcome-source-integrity-sweep.test.ts` (create), `shared/types/background-jobs.ts` (job type + metadata), `server/outcome-backfill.ts` (best-effort label backfill for historical rows), `tests/helpers/background-job-test-matrix.ts`.
**Contracts:** typed background job (BACKGROUND_JOB_METADATA entry, cancellable: true) that reports dangling `(source_type, source_id)` refs per workspace — read-only, `{ modified: 0 }`, results to job payload; backfill resolves rec titles via the now-live rows (B5) where possible. Slice acceptance line: `learnings-slice` is the only reader of `action_outcomes` — verify its win rendering prefers snapshots (read `server/intelligence/learnings-slice.ts`, update if it re-derives labels).

**Test assertions:** sweep counts a seeded dangling ref, mutates nothing (FM-2: job errors → job status failed); backfill fills labels only where NULL.

### Task B13 — R89-PR1 Attribution at the three seams + `gbp_review_reply` (Model: Sonnet)
**Owns:** `server/playbooks.ts`, `server/webflow-seo-bulk-accept-fixes-job.ts`, `server/google-business-profile-review-response-publish-job.ts`, `shared/types/outcome-tracking.ts` (new ActionType member — triggers the exhaustive lockstep), the 14-file lockstep set (ScoringConfig defaults, label maps, `server/schemas/outcome-schemas.ts` zod enum, `ALL_ACTION_TYPES` pins in `tests/unit/outcome-scoring-defaults.test.ts`, admin filter/label files per inventory), seam tests (`tests/unit/playbooks-outcome-tracking.test.ts` create, `webflow-seo-bulk-accept-fixes-job.test.ts`, `google-business-profile-routes.test.ts`), `docs/rules/outcome-engine-stubs.md`.
**Contracts:** copy the #1419 worked example (`recordSchemaOutcomeAction` in `publish-schema-to-live.ts`): each seam records a tracked action with `attribution: 'platform_executed'` + source snapshot (B11's param) at the moment the external write succeeds. **Owner decision applied: mint `gbp_review_reply`** — ships dark (job can't fire until Google API access opens; recording logic is exercised by tests now, correct from day one later). Playbook gap is the brief-creation half only (client-action half already stamps).

**Test assertions:** per seam — successful external call records exactly one action with platform_executed + snapshot; failed external call records NO action and the job status is `failed` (FM-2); ScoringConfig completeness test green with the new member.

### Task B14 — R89-PR2 Attribution required at the write layer (Model: Opus — contract-shape judgment)
**Owns:** `server/outcome-tracking.ts` (recordAction `attribution` becomes required internally), `server/routes/outcomes.ts` + `server/schemas/outcome-schemas.ts` (route keeps backward-compat: missing attribution → explicit `not_acted_on` + deprecation warn — NEVER the silent `platform_executed` claim the audit flagged), internal call-site sweep (all sites pass attribution explicitly), `src/api/outcomes.ts` typed wrapper, write-path tests.
**Contracts:** the hazard being closed is the inverted application default (`?? 'platform_executed'` at outcome-tracking.ts:339). Internal API: required param. External HTTP/MCP surface: tolerate-old (defaults to the honest `not_acted_on`, logged) — no breaking change to MCP holders of persistent keys.

**Test assertions:** internal recordAction without attribution fails typecheck (compile-time — assert via a `// @ts-expect-error` fixture); HTTP POST without attribution stores `not_acted_on` + warn log; no call site relies on the old default (grep-count in test).

### Task B15 — R89-PR3 Provenance column + coverage funnel (Model: Sonnet)
**Owns:** `server/db/migrations/164-outcome-provenance.sql` (additive, live + twin via B10 helpers), `server/outcome-coverage.ts` (create), `tests/unit/outcome-coverage.test.ts` (create), `server/routes/outcomes.ts` (admin coverage endpoint), `src/hooks/admin/useOutcomes.ts`, `src/lib/queryKeys.ts`, `src/components/admin/outcomes/OutcomesOverview.tsx` + `OutcomeDashboard.tsx` (admin-only funnel display), readback tests per inventory.
**Must not touch:** ANY client-facing surface or dollar figure — the coverage funnel is admin-side only (hard stop: client output provably identical). Slice acceptance: if the funnel lands in `LearningsSlice`, extend `shared/types/intelligence.ts` + the slice + formatter together; re-run the AI-quality fixtures.

**Contracts:** `computeOutcomeCoverage(workspaceId): { tracked: number; measured: number; reconciled: number }` from provenance fields with read-fallback `'estimate_ga4'` for legacy NULL rows; React Query key via `queryKeys.*` (pr-check enforces), WS invalidation handler for the OUTCOME_* family.

**Test assertions:** coverage denominators equal row counts by provenance on a seeded workspace; NULL provenance counts as estimate; endpoint requires admin auth.

---

## Task List — Wave B, Lane I (infrastructure)

### Task B16 — R10-PR1 Cron registry + stop hooks (Model: Sonnet)
**Owns:** `server/cron-registry.ts` (create), `tests/unit/cron-registry.test.ts` + `tests/contract/cron-registry-census.test.ts` (create), `server/startup.ts`, `server/index.ts` (gracefulShutdown wiring), the ~19 scheduler modules per inventory (`backup.ts`†, `data-retention.ts`, `anomaly-detection.ts`, `scheduled-audits.ts`, `rank-tracking-scheduler.ts`, `ga4-conversion-snapshot-scheduler.ts`, `intelligence-crons.ts`, `insight-recompute-cron.ts`, `briefing-cron.ts`, `monthly-report.ts`, `weekly-workspace-cron.ts`, `approval-reminders.ts`, `trial-reminders.ts`, `churn-signals.ts`, `email-throttle.ts`, `ai-deduplication.ts`, `webflow-form-poller.ts`, `return-hook-cron.ts`, `server/mcp/handles.ts` TTL sweeper, `server/middleware.ts` module-timer) — † backup.ts adoption AFTER A1 merges; `strategy-issue-cron.ts` + `outcome-crons.ts` adoption deferred to a follow-up commit after B6 (measured R4 collision), `docs/rules/background-generation.md`, `tests/unit/startup.test.ts`, `tests/integration/background-jobs-lifecycle.test.ts`, pr-check trio (new-interval-timer-must-register rule).
**Contracts:** `CRON_METADATA` per Cross-Phase Contracts; **lazy construction** — no timer starts at module load (the startup unit test mocks only 15 of 20 imports; eager construction starts real timers inside vitest, per inventory); every registered cron gets a stop hook wired into gracefulShutdown (9 current gaps, backup has none). Census contract test: every `startSchedulers` import + known module-level timer has a registry entry or a documented event-driven/security exemption.

**Test assertions:** census test fails on an unregistered scheduler import; gracefulShutdown stops every registered timer (spy-based); zero timers created at module import time.

### Task B17 — R10-PR2 Cancel route + job-feed class (Model: Sonnet)
**Owns:** `server/routes/jobs.ts` area (find the cancel route per inventory), `shared/types/background-jobs.ts` (system-job class field if needed), job-feed UI filter (`useBackgroundTasks`/NotificationBell/client work feed per crosscut — client feed excludes cron-originated system jobs), WS acceptance (JOB_* events + invalidation pins).
**Contracts:** cancel route consults `BACKGROUND_JOB_METADATA[type].cancellable` (the verified gap — metadata exists, route ignores it); cron-originated jobs carry a `system` origin marker; client-facing feed filters them out (a nightly backup run must not appear in a client's task panel), admin bell shows everything.

**Test assertions:** cancel of a `cancellable: false` type → 409; system-origin job absent from the client feed query, present in admin.

---

## Task List — Wave C/D (tails)

### Task C1 — R11-T5 Snapshot registry + workspace_id retrofit (Model: Sonnet; after A1, parallel to Lane O tail)
**Owns:** `server/db/snapshot-registry.ts` (create), `tests/contract/snapshot-envelope-registry.test.ts` (create), `docs/rules/snapshot-envelope.md` (create), `server/db/migrations/164-audit-snapshots-workspace-id.sql` (retrofit the 3 legacy site-keyed tables: audit/performance/redirect — **owner decision applied: orphan rows quarantined** to `*_orphaned` copies, never deleted), `server/serp-snapshots-store.ts`, `server/business-listings-store.ts`, `server/llm-mentions-store.ts`, `server/reports.ts`, `server/data-retention.ts`, `server/db/migrate-json.ts` (after B5), pr-check trio.
**Contracts:** registry describes all 13 snapshot tables (name, workspace-scoped?, capture-column, writer module); contract test asserts every `*_snapshots` table in sqlite_master is registered and workspace-scoped (post-retrofit: zero exceptions); retrofit follows R0 rename-to-archive pattern (table rebuild, explicit columns, FK ON DELETE CASCADE like the 10 modern tables). Slice acceptance: 5 snapshot-reading slices (site-health, seo-context, page-profile, local-seo, client-signals/roi) verified green after retrofit.

**Test assertions:** registry census fails on an unregistered snapshot table; rebuild preserves row counts minus quarantined orphans (counted + logged); dev-DB orphans (2 performance rows) land in quarantine.

### Task C2 — R12a Client vocabulary translation map (Model: Sonnet; after B15)
**Owns:** `shared/types/client-vocabulary.ts` (create), `tests/contract/client-vocabulary-map.test.ts` (create), `src/components/client/OutcomeSummary.tsx`, `src/components/client/Briefing/WinsSurface.tsx`, `src/components/admin/outcomes/outcomeConstants.ts` (re-point to shared map), `server/routes/outcomes.ts` (WIN_FALLBACK_LABELS fold), `shared/types/strategy-archetype.ts` + its exhaustiveness test, `src/components/client/the-issue/IssueAlsoOnPlanSection.tsx`, `docs/workflows/ui-vocabulary.md`, `CLAUDE.md`.
**Contracts:** one canonical map folding the 4 drifted `Record<ActionType,string>` maps, modeled on the `evergreenCopy.ts` locked-copy precedent (single module + contract test pinning strings); reads catalog labels (B8) as the source. **OWNER CHECKPOINT: the PR description carries the wording table (action → current wording per surface → proposed canonical) — owner picks winners before merge. This is a client-visible copy change.**

**Test assertions:** every `clientVisible: true` catalog action has a vocabulary entry; contract test pins the chosen strings; the 4 old maps are deleted (grep zero).

### Task C3 — R12b Per-flag burn-down (Model: Sonnet; rolling — one PR per flag family)
**Owns per retirement PR:** `shared/types/feature-flags.ts`, the flag's read sites, `scripts/pr-check.ts` `RETIRED_FLAG_GROUPS` (+ migrationException), `server/db/migrations/164-retire-<family>-flag-overrides.sql` (delete override rows), `scripts/feature-flag-lifecycle.ts` (dated done-targets), `tests/unit/feature-flags.test.ts` + `feature-flag-lifecycle.test.ts`, `src/components/FeatureFlagSettings.tsx`, `docs/rules/feature-flag-lifecycle.md`, `docs/workflows/release-safety.md`.
**Contracts:** retirement = removalCondition verifiably met → global default flipped ON → **pilot-parity check: confirm global default equals current pilot behavior BEFORE deleting any OFF branch** (Swish Dental runs 4 The-Issue flags via per-workspace overrides) → flag-ON real-browser smoke (CLAUDE.md UI/UX rule 13; `preview_*` tools) → OFF branch deleted + RETIRED_FLAG_GROUPS extended + override rows migrated out. First PR also resolves the phantom `client-locations` flag (declare or retire) and adds **dated** done-targets to the lifecycle report. `strategy-trust-ladder-autosend` is permanently exempt — assert its continued existence in the lifecycle test.

**Order:** only families whose removalConditions are already met at execution time (re-derive from `verify:feature-flags` then); The-Issue children retire as their phases ship — most will trail this plan, which is correct.

### Task C4 — Closeout (Controller, Opus)
- [ ] Exit-criteria verification against the Reconcile goals: lexicon enforced (`verify:lexicon` in CI) · one action catalog + honest attribution at every live seam · rows-only rec store, mirror sync verifiable, struck≠completed at DB · execution observable (cron census green) · snapshot/archive parity asserted at boot
- [ ] `npm run verify:platform` + full gates on staging; staging→main promotion per `docs/workflows/deploy.md`
- [ ] Holistic end-to-end review (scaled-code-review across the whole arc) — fix everything it finds, never defer
- [ ] Docs closeout: FEATURE_AUDIT.md entries, `data/roadmap.json` (+ `sort-roadmap.ts`), GLOSSARY/lexicon final sweep, memory update
- [ ] Declare P2-ready: the rebuild may start (Wave C/D stragglers may trail per the exit-criteria rule)

---

## Systemic Improvements (shipped inside tasks)

- **Shared utilities:** `archive-twin.ts` generator (B10) · `cron-registry.ts` (B16) · `snapshot-registry.ts` (C1) · `outcome-coverage.ts` (B15) · `client-vocabulary.ts` (C2)
- **pr-check rules added:** destructive-migration rename-to-archive (A1) · duplicate exported type name + ActivityType minting (A3) · transition-guard regex fix (B3) · live+twin ALTER lockstep (B10) · interval-timer-must-register (B16) · RETIRED_FLAG_GROUPS extensions (C3)
- **New contract tests:** ws-events parity (A5) · lifecycle envelope (B2) · action-catalog completeness (B8) · cron census (B16) · snapshot registry census (C1) · client-vocabulary pins (C2)
- **Feature-class gates:** data-migration class for B5/B7/B11/C1 (staging-verify between expand and contract); infra class for A1/B16; no client-facing class applies until C2 (which carries the owner sign-off)

## Verification Strategy

- Per-PR: the universal gates (§Execution Model) + task-specific `npx vitest run <file> --reporter=verbose` commands listed in each task
- R7 gate: blob-vs-rows SQL evidence table from staging AND prod backup (`scripts/pull-render-latest-backup.sh`), pasted into the B5 PR body
- Destructive migrations (B5, B7, B10, C1): run against a fresh `db:sync-staging` copy locally first; row-count parity asserted pre/post; R0 drill re-run after each destructive merge to staging
- Client-output invariance (whole plan): snapshot the public workspace endpoint + client outcome surfaces for a pilot workspace before Wave B and diff after each lane merges — byte-identical until C2's signed-off wording change
- WS contracts: `npx vitest run tests/contract/ --reporter=verbose` after every lane merge
- Wave B closeout: holistic review + `npm run verify:platform`

## Owner Checkpoints (everything else is autonomous merge-on-green)

1. **A1:** confirm `BACKUP_S3_BUCKET` is live in the Render dashboard (values are `sync:false` — invisible to code).
2. **C2:** pick canonical wording from the table in the PR (client-visible copy).
3. **Any STOP report:** a contract-vs-reality mismatch, a failed R7 gate, or a red that survives one fix attempt halts that lane only; other lanes continue.
