# Reconcile Plan (R0–R12) Pre-Plan Audit

**Date:** 2026-07-01
**Spec:** `docs/audits/2026-07-01-readiness-atlas-verification.md` (verification audit + six ratified owner decisions) — full size retained, parallelization maximized per owner directive
**Code HEAD:** `e5745db2b` (branch `readiness-atlas-audit` = that + audit-report commit `3b1358af0`)
**Total findings:** **912 inventory entries** across 12 ticket scopes; **224 unique modify/create/delete files**; collision matrix computed from measured file sets (15 agents, 2 workflow runs; machine-readable scope in [2026-07-01-reconcile-plan-audit-inventories.json](./2026-07-01-reconcile-plan-audit-inventories.json))

Every file in the eventual plan must trace to an inventory entry in the companion JSON — no file enters the plan from memory.

---

## 1. Verified scope per ticket

Counts are modify/create/delete files (verify-only entries excluded). PR chains follow expand→backfill→staging-verify→contract for destructive data changes.

| Ticket | Files | Verified scope (headline) | PR chain |
|---|---|---|---|
| **R0** Backup safety | 19 | Retention default is **3 days** driving BOTH local and S3 prunes (`server/backup.ts:25`); `.env.example` documents 7 (a lie); `render.yaml` doesn't declare `BACKUP_RETENTION_DAYS` at all, so prod runs the 3-day code default on a 1 GB disk. Interval is anchored to process start (every deploy resets the 24 h clock). **No restore script exists** — restore is a manual runbook (`docs/workflows/data-integrity-recovery.md`). Existing pieces to reuse: `/api/admin/db-export`, `scripts/pull-render-latest-backup.sh`, `runDataIntegrityRecoveryReport`. | PR1: retention split (local vs S3) + render.yaml declarations + `scripts/restore-drill.ts` + destructive-migrations contract doc + pr-check DROP-TABLE rule (baseline: 6 existing DROP migrations). Drill run = merge evidence. |
| **R1** Lexicon | 15 | GLOSSARY.md is a flat 40-entry list with **zero enforcement** (nothing references it). Duplicate-export census: **26 duplicate exported type names** (30+ sites), incl. a deliberate 19-name GA4/GSC mirror block — the collision rule must ship with a seeded allowlist-with-burn-down (each entry names its resolving ticket) or it fails on day one. Registry/verifier/CI templates verified live (`FEATURE_FLAG_CATALOG`, `scripts/feature-flag-lifecycle.ts`, ci.yml:144). | PR1: registry (`shared/types/lexicon.ts`) + `verify:lexicon` + word-class GLOSSARY restructure + mockup-vocabulary PROPOSED intake. PR2: pr-check rules (name-collision, ActivityType-minting guard) + 4-scenario test fixtures. |
| **R2** Renames | 7 | Brand-side rename touches only **3 production files + 2 tests**; `DeliverableStateStatus` (state-machines.ts:216) is **value-identical to the spine type with zero importers** → delete or alias. Hazard: naive find/replace corrupts 9 function names across 20 files (`clientActionDeliverableType`, `mapWorkOrderStatusToDeliverableStatus`, …) — word-boundary rename only. | Single atomic PR (string-literal-rename rule: whole repo, one commit). |
| **R3** Lifecycle envelope | 37 | 16 transition tables + 36 `validateTransition` sites confirmed, **plus a 17th parallel hand-rolled machine in `server/copy-review.ts` (`VALID_TRANSITIONS`/`isValidTransition`)** — highest-value fold. Census: 34 exported `*Status` unions + ~15 server-local ≈ 16 mapped / ~14 unmapped-lifecycle-candidates / ~20 classifications (never mapped). Bonus rot found: CLAUDE.md and development-patterns.md both show a **stale 2-arg `validateTransition` API** in their examples. | PR1: `shared/types/lifecycle.ts` envelope + census doc + fix stale doc examples + DB-trigger deferral ADR (zero behavior change). PR2+: new maps for unmapped lifecycles with idempotent self-edges + FM-2 tests (new guards can break flows that relied on illegal-but-tolerated moves). |
| **R4** Two-axis hardening | 23 | Both dual-write mirrors swallow failures (`recommendation-dual-write.ts:98-103`, `client-action-dual-write.ts:113-117`) and **all three callers discard the result**; two divergence-by-construction paths exist (act-on never advances the mirror; deliverable respond never advances the rec). Constraint must be a **trigger pair, not CHECK** (SQLite CHECK can't be added to an existing table without rebuild). R7-before-R4 re-confirmed: `recommendation_items` has 0 rows locally; a constraint on it bites only after the cutover. | PR1: typed mirror result + all 3 callers observe it + act-on syncs mirror + struck-guard in status-service (app-level). PR2: migration — trigger pair on recommendation_items. Guards BEFORE trigger (else regen rollbacks become opaque 500s). |
| **R5** Action catalog | 13 | Five vocabularies verified distinct; MCP action enums actually live in `shared/types/mcp-action-schemas.ts` (not `server/mcp/tools/*`). Three existing seam mappers found (not one). Code-only: `action_type` columns are unconstrained TEXT → **no migration, no expand/contract chain**. Phantom-entry caution: keep-markers have live UI producers — do not drop. | PR1: `shared/types/action-catalog.ts` + lockstep contract test + docs (additive, nothing reads it). PR2: consumer cutover (generators/scorers/MCP read catalog metadata). |
| **R6** Snapshot-on-write | 39 | The string link spans **16 source kinds** (not 8) written by **20 recordAction call sites across 14 files**; ≥83% of dev-DB actions no longer resolve to a living source — confirming snapshot-on-write over any FK. `tracked_actions` already carries `baseline_snapshot` (pattern precedent). Sharpest edge: **archive-twin column order** — ALTER appends at end while `archived_at` sits mid-table; any positional `INSERT…SELECT *` silently corrupts archives. R7 dependency is **narrower than ratified**: only the integrity-sweep's rec resolver + backfill title resolution need R7; the snapshot columns themselves don't. | PR1 (expand): migration adds snapshot column(s) to live + archive twins + all 20 call sites threaded + snapshot-first title resolution with fallback intact + ADR + contract doc. PR2 (after R7): integrity-sweep job + backfill + fallback demotion. |
| **R7** Blob→rows cutover | 18 | Fork exactly as described; **direct blob SQL is confined to `storage.ts` + `migrate-json.ts` + ~8 test files** — every runtime consumer reads through the facade, so dual-read holds with zero consumer changes. **Local dev DB: 6 non-empty blobs, 0 item rows — the fallback is load-bearing for 100% of local rec data.** Missed by the skeleton: `migrate-json.ts:818-827` is a **second blob writer** (legacy seeder would silently lose data post-cutover). | PR1: `materializeAllRecommendationItems()` backfill sweep + boot wiring + count logging. **GATE: staging + prod count verification (items ≥ valid blob recs per workspace; Zod drops investigated, not tolerated).** PR2 (contract): remove fallback, blob write becomes `'[]'`, rewrite migrate-json to emit rows, migration blanks blobs. |
| **R8+R9** Seams + funnel | 36 | All three seam files verified exact; none contains any recordAction call. Playbook gap narrower than audit implied (client-action half already stamps via feedback loop). **GBP seam has no fitting ActionType** → owner decision (below). Provenance column on `action_outcomes` is a conditional additive migration (+ archive twin). R9-thin = coverage metric in learnings-slice + admin surface only. | PR1 (R8a): stamp the three seams copying the #1419 pattern. PR2 (R8b): make `attribution` required at the API/type layer (external-contract change — MCP/route callers). PR3 (R9-thin): provenance column + coverage funnel in learnings-slice + admin display. |
| **R10** Cron registry | 35 | **19 boot-wired subsystems + 4 module-level timers (incl. MCP TTL sweeper) = ~34 setIntervals, 3 construction patterns, 9 stop-hook gaps** (backup has NO stop; 4 stops exist but were never wired into gracefulShutdown). Test trap: `tests/unit/startup.test.ts` mocks only 15 of 20 imports — an eagerly-constructing registry would start real timers inside vitest; construction must stay lazy. R4 file collision dissolved by dropping the throttledUntil conversion. | PR1: `server/cron-registry.ts` (CRON_METADATA mirroring BACKGROUND_JOB_METADATA) + generalized `createIntervalCron` + adopt all modules + wire stop-hooks. PR2: cancel route consults `BACKGROUND_JOB_METADATA[type].cancellable` + job-feed system-jobs class/filter decision. |
| **R11** Envelope + twins | 18 | Exactly 13 snapshot tables confirmed; envelope divergence **narrower than "13 tables need rework"** — 10/13 already carry workspace_id+FK; the 3 legacy site-keyed tables (audit/performance/redirect, born migration 004) are the real work. T7: build a **schema-generated archive-twin module** (`server/db/archive-twins.ts`) + boot drift-assert, replacing hand-copied column lists. T7 is self-contained — **no dependency on T5**. | PR1 (T7): twin generator + boot assert + archive rebuild migration (rename-to-old per R0 contract) + lockstep pr-check rule. PR2+ (T5): envelope interface + retrofit workspace_id to the 3 legacy tables (orphan policy = owner decision). |
| **R12** Translation + burn-down | 20 | Ledger = 29 catalog flags (3 reserved, 4 review-due, 1 stale candidate) **+ 1 undeclared phantom (`client-locations`)**. Rename layer scattered across ~20 sites; **4 drifted `Record<ActionType,string>` label maps** are the translation map's seed content; `the-issue/evergreenCopy.ts` is the locked-copy-module precedent to copy. Burn-down enforcement already half-exists: `RETIRED_FLAG_GROUPS` in pr-check + `verify:feature-flags` in CI — extend, don't invent. Pilot hazard: Swish Dental runs 4 The-Issue flags via per-workspace overrides with autosend explicitly 0 — every burn-down PR must confirm global default = pilot behavior BEFORE deleting the OFF branch. | PR1 (R12a): `shared/types/client-vocabulary.ts` + fold the 4 drifted maps + contract test (client-visible wording = owner sign-off). PR2+ (R12b): one retirement PR per flag family as removalConditions land, each extending RETIRED_FLAG_GROUPS; autosend permanently exempt. |

## 2. Collision matrix → lane derivation

**Bookkeeping collisions (not lane blockers).** Nearly every ticket touches `CLAUDE.md`, `FEATURE_AUDIT.md`, `data/roadmap.json`, `scripts/pr-check.ts` (+ its test + generated doc), `package.json`. These are append-mostly; resolved by the single merge queue (rebase + `npm run rules:generate` per merge), not by serializing lanes.

**Real code collisions (measured, run-2 canonical):**

| Pair | Shared files | Resolution |
|---|---|---|
| R2×R3 | `state-machines.ts`, `brand-identity.ts` | Same lane, R2 (S) first |
| R4×R7 | `domains/recommendations/storage.ts`, `routes/recommendations.ts`, strategy-recommendations.md | Same lane, R7 first (already ratified) |
| R6×R7 / R4×R6 | `routes/recommendations.ts`; `client-deliverables.ts`, `outcome-crons.ts` | R6's rec-route touch lands after R7-PR2; coordinate via merge queue |
| R6×R89 | `outcome-tracking.ts`, `shared/types/outcome-tracking.ts`, `routes/outcomes.ts` + 3 tests | **Outcome lane — serialized** |
| R6×R11 / R89×R11 | `outcome-tracking.ts` (archive fns) + round-trip test | R11-T7 (twin generator) runs FIRST in the outcome lane — generated column lists de-risk R6/R89's column adds |
| R5×R6 / R5×R89 | `routes/outcomes.ts` | R5's catalog PRs precede R6/R89 in the lane |
| R0×R10 | `server/backup.ts` | R0 (Wave A) lands before R10 registry-izes backup |
| R7×R10 | `server/index.ts` | R7-PR1 boot wiring merges before R10's startup adoption |
| R4×R10 | `strategy-issue-cron.ts`, `outcome-crons.ts` | R10's adoption of these 2 modules scheduled after R4 lands (or trivial rebase) |
| R7×R11 | `db/migrate-json.ts` | R7-PR2 rewrites the rec seeder; R11 touches snapshot seeding — merge-queue rebase |
| R10×R11 | `data-retention.ts` | Merge-queue rebase |
| R4×R12 | `shared/types/feature-flags.ts` | Append-only catalog edits — rebase |

**Shared spines needing explicit treatment** (from cross-cutting maps):
- `server/ws-events.ts` + `src/lib/wsEvents.ts` are a **manual lockstep mirror with NO parity test** — a server-only event addition slips both existing contract nets. → New Wave-A parity contract test (systemic improvement).
- **Migration numbering:** ~6 tickets mint migrations at "next free slot" (164+ at HEAD) → single merge queue with renumber-at-merge is mandatory, exactly as the Parallelization Map's one-merge-at-a-time rule intended.
- MCP surface: 61 tools; `mcp-action-schemas.ts` is the enum re-declaration hotspot (R2/R3/R4/R5/R7 all touch its territory) — all changes must be additive/tolerate-old (persistent API keys, migration 163).

## 3. Parallelization strategy (measured, maximum safe width)

```
WAVE A (fully parallel, no shared code files)
  A1  R0  backup safety                        ── gates all destructive PRs
  A2  R1  lexicon (PR1 registry, PR2 pr-check) ── root barrier (small)
  A3  R7-PR1 backfill sweep (additive)         ── starts immediately; verify gate runs during Wave B
  A4  WS parity contract test (new, S)         ── systemic improvement

BARRIER: R1 merged. R0 merged before any destructive/contract PR.

WAVE B (4 lanes, file-disjoint by measurement)
  Lane V (vocabulary)      R2 → R3-PR1 (envelope+census) → R3-PR2+ (new maps)
  Lane R (recommendations) R7 verify GATE (staging+prod counts) → R7-PR2 (contract) → R4-PR1 (guards) → R4-PR2 (trigger)
  Lane O (outcomes, serialized within)  R5 (catalog → cutover) → R11-T7 (twin generator) → R6 (expand → sweep) → R8+9 (seams → required-attribution → funnel)
  Lane I (infra)           R10-PR1 (registry+stops) → R10-PR2 (cancel route + feed filter)
                           [R10 adoption of strategy-issue-cron/outcome-crons scheduled after R4 lands]

WAVE C/D (tails, parallel once their lane prerequisites land)
  R11-T5 envelope + legacy workspace_id retrofit   (after R0; independent of Lane O's tail)
  R12a translation map                              (after R1; after Lane O's R8+9 → routes/outcomes.ts clears)
  R12b per-flag burn-down                           (ongoing; one PR per family as removalConditions land; pilot-parity check each)
```

- **The true critical path is Lane O** (4 tickets sharing the outcome core), not the R3 barrier the original plan serialized everything behind. Lane V/R/I run beside it in full.
- **Cross-lane rules:** single merge queue, one migration-minting PR at a time, renumber at merge; every PR that touches a shared spine (ws-events, mcp-action-schemas, pr-check) rebases + regenerates before merge; R3's envelope must not pre-empt R4's two-axis shape (hard boundary: strategy-recommendations.md + pr-check rules 21/22 stay intact).
- **Per-ticket acceptance lines** (from cross-cutting maps, non-negotiable): WS payload + invalidation handlers + pinned contract tests updated in the same PR (R4/R6/R7/R10/R11/R12); intelligence-slice read paths named and updated (R6: learnings-slice is the only reader of action_outcomes; R7: 6 rec-reading slices; R11: 5 snapshot-reading slices); MCP additive-only with instructions.ts + README in the same commit.
- **Estimated totals: ~24–28 PRs** (12 tickets, chains included, plus ~4–6 rolling burn-down PRs). Consistent with the earlier 2× elapsed-time estimate; lane width now caps elapsed at max(Lane O, Lane R) instead of the sum.

## 4. Owner decisions surfaced by the inventories (new)

1. **GBP ActionType (R8):** no existing ActionType fits a review-reply publish. Mint `gbp_review_reply` (honest taxonomy; triggers the mechanical 14-file exhaustiveness lockstep — that seam existing is the point) vs reuse `local_visibility_won` (S-sized but dishonest vocabulary). *Recommend: mint new — matches the "honest vocabulary" principle of the whole reconcile.*
2. **R11 orphan policy:** the 3 legacy snapshot tables have rows with no workspace linkage (dev shows 2 orphans; prod unknown). Delete vs quarantine-table vs nullable-forever. *Recommend: quarantine (reversible).*
3. **R12a canonical wording:** folding the 4 drifted label maps forces choosing one string per action — a silent client-visible copy change. Owner picks winners at PR time (options table in the PR description).
4. **R1 mockup-vocabulary intake semantics:** PROPOSED word class only, or also pre-reserve type names? *Recommend: PROPOSED-only; P2 promotes them.*

## 5. Prevention (what stops this from recurring)

New mechanized guards shipped inside the tickets themselves: destructive-migration pr-check rule + rename-to-archive contract (R0); name-collision rule with allowlist burn-down + ActivityType-minting guard + `verify:lexicon` in CI (R1); transition-guard regex fix + copy-review fold + state-machine coverage contract extension (R3); action-catalog lockstep contract test (R5); live+twin ALTER lockstep rule + generated archive twins (R11); RETIRED_FLAG_GROUPS extension per burn-down (R12); WS-mirror parity contract test (Wave A). Root cause across all of them: registries existed for flags/jobs but not for words, crons, twins, or event mirrors — every prevention item is "make the next layer look like the flag registry," which is the Reconcile Plan's own (correct) thesis.

## 6. Model assignments

| Task type | Model | Reasoning |
|---|---|---|
| R2 rename sweep, bookkeeping regen, label-map folding | Haiku | Mechanical, word-boundary constrained |
| R0, R5, R6 threading, R8 seams, R10 adoption, R11 twins, R12a | Sonnet | Implementation with local judgment |
| R1 lexicon design, R3 census judgment, R4 authority design, R7 cutover + verify gates, per-wave diff review | Opus | Cross-context judgment, contract interpretation |
| Wave-level orchestration + scaled-code-review | Opus | Full-context review (mandatory: parallel-agent work) |

## 7. Provenance & caveats

- Runs `wf_0e923a2e-5e4` (2×15 agents; resume re-executed rather than cache-replayed, so run 2 is canonical — inter-run classification variance of modify vs verify-only is why counts differ slightly from any earlier snapshot). ~4.5 M tokens, 1,435 tool calls total.
- All DB counts are **local dev DB** (`~/.asset-dashboard/dashboard.db`), not prod. Two prod re-verifications are load-bearing and gated in the PR chains: R7's blob-vs-rows counts (the entire cutover gate) and R11's orphan counts/row sizes. Run `npm run db:sync-staging` immediately before cutting those PRs.
- The machine-readable scope (per-ticket file lists, PR chains, migrations, risks, counts) is the companion JSON; writing-plans must draw file lists from it exclusively.
