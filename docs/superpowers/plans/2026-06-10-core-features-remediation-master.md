# Core-Features Audit Remediation — Master Run Plan (2026-06-10)

> **For agentic workers:** This is the run-level plan for remediating [docs/audits/2026-06-10-core-features-audit.md](../../audits/2026-06-10-core-features-audit.md) (27 ranked items + minor list; raw evidence in [2026-06-10-core-features-audit-findings.json](../../audits/2026-06-10-core-features-audit-findings.json)). It also absorbs five outstanding items from the [2026-06-09 run](./2026-06-09-audit-remediation-master.md). Each PR gets its own detailed contract+test-centric plan in this directory, authored just-in-time against the then-current `staging` head. REQUIRED SUB-SKILLS per PR: `superpowers:executing-plans` or `superpowers:subagent-driven-development`, plus the code-review gate from CLAUDE.md. Platform: **Claude/Anthropic** — model ladder is Haiku (mechanical) / Sonnet (implementation with local judgment) / Opus (cross-context, prompt engineering, and ALL reviewers — never downgraded).

**Goal:** Land the audit's Wave 1 ("Now") items, the sequenced Wave 2 ("Next") items, and the five absorbed old-run items as lane-parallel, serially-merged PRs into `staging`.

**Plans are contract + test-centric** (docs/PLAN_WRITING_GUIDE.md): per-PR plans lock contracts, test assertions, ownership, and verification commands — never pre-baked implementation bodies. Execution discipline per task: read real code → run the failing test red → minimal implementation → green + typecheck → commit. If real code contradicts a contract, STOP and report.

---

## Old-run absorption status (verified 2026-06-10)

Confirmed via `gh pr list` + `git log`:

| Old-run PR | State | Disposition |
|---|---|---|
| PR 1–6 (#1160–#1165) | **MERGED** to staging | Done — not absorbed |
| PR 7 (#1166, `claude/audit-pr7-performance`, getWorkspaceBySiteId indexing) | **OPEN** | NOT absorbed — merges independently before this run's first code PR; rebase Wave 0 branches after it lands |
| PR 3b — passwordless portal closure | Outstanding | → **Lane E (E3)**, after E1 (#2) — see sequencing note in E |
| PR 4b — sync AI routes → jobs | Outstanding | → **Lane C (C2)**, before #12 |
| PR 5b/5c — insight enrichment + renderers + the two unwired state machines | Outstanding | → **Lane G (G2)** |
| PR 6b — dead inbox-component deletion | Outstanding | → folded into **Wave 0 Haiku sweep (H1)**, separate commit |
| PR 7b — InsightsSlice.byType cap | Outstanding | → **Lane G (G3)**, consumer redirection is an explicit prerequisite |

## Decision log (owner-confirmed 2026-06-10 — baked in, do not revisit)

| Decision | Choice |
|---|---|
| #2 scope | Guard all four public-portal GETs (`public-portal.ts:246, 331, 459, 622`) with `requireClientPortalAuth('workspaceId')` from `server/middleware.ts`. Verified safe: admin HMAC passes through (`middleware.ts:208-210`); passwordless preserved (`:219-220`) — #2 does NOT change passwordless semantics; 3b does, later |
| #23 | NO briefing-v2 cutover this run. #5 targets the LIVE legacy client overview; backporting WinsSurface to legacy folds into #5's scope |
| #18 | NO Keyword Hub P5 flag flip. #4 blocker fixes land now, dormant behind the flag. #18 + #25 OUT of this run (parked, re-enter on owner signal) |
| #25 | Deferred — zero new provider spend this run |
| Merge authority | Autonomous merge to `staging` when CI green + code review clean; `staging → main` stays with owner |
| Learnings-consumer freeze | **No NEW consumers of workspace learnings anywhere in the run until A1 (#1) is merged AND verified on staging.** Binds A4, A6, and any opportunistic work |

---

## Wave 1 citation re-verification (done 2026-06-10 on current head)

Every Wave 1 item's citations were re-checked by grep/read before this plan was written. Per-PR plans must re-verify again at authoring time (staging moves between merges; PR #1166 will shift some line numbers in workspace-store call sites).

| Item | Status | Notes |
|---|---|---|
| #1 | **VERIFIED** | `outcome-scoring-defaults.ts:27-46` (`content_refreshed` → phantom `click_recovery`); `outcome-backfill.ts:197` hardcodes `'audit_fix_applied'` (drifted from cited :196 — trivial); `workspace-learnings.ts:216-226` bins GSC **position**; `outcome-learning-default-path.ts:65-79` matches against provider **KD**; correct mapping `recommendationOutcomeActionType(rec.type, rec.source)` exists at `routes/recommendations.ts:~205`; `'disabled'` already in the `LearningsSlice.availability` union (`shared/types/intelligence.ts:239`) — the switch just isn't implemented |
| #2 | **VERIFIED** | Unguarded GETs at `public-portal.ts:246` (audit-summary), `:331` (keyword-feedback), `:459` (business-priorities), `:622` (content-gap-votes). `requireClientPortalAuth` already imported in the file (`:15`) and used on sibling routes (`:265` audit-detail) — pattern-consistent fix |
| #3 | **VERIFIED** | `generateBriefForRequest` is exactly `content-brief-generation-job.ts:203-309`: GSC/provider/GA4 enrichment but **no** `scrapeUrls`/`scrapeSerpData`, **no** `recordAction`. Standalone path has both (`:114-141`, `:176`) |
| #4 | **VERIFIED** | `KeywordActionMenu.tsx:90` — `onAction(a.type, a.disabledReason ? { force: true } : undefined)` one-click bypass. No add-keyword input anywhere in `src/components/KeywordHub.tsx` / `src/components/keyword-hub/` |
| #6 | **VERIFIED** | `ai-operation-registry.ts:277` `keyword-site-synthesis` on `gpt-5.4-mini`; called with 3000 tokens at `keyword-strategy-ai-synthesis.ts:1379,1386`; `GenerationQuality` is `log.info`-only at `keyword-strategy-generation.ts:588-603` |
| #7 | **VERIFIED** | Admin GET destructure in `routes/keyword-strategy.ts:~253` omits `siteKeywordMetrics`; `public-content.ts:138,165` re-attaches it (the mirror pattern) |
| #8 | **VERIFIED** | `clientDashboardNav.ts:29` (drifted from :28) `strategyLocked = effectiveTier === 'free' || !ws.seoClientView`; `ContentPlanTab.tsx:62-64` docx→csv / pdf→json; `OverviewTab.tsx:286` "ROI N" badge on a 0-100 value; `InsightsEngine.tsx:169` `/* silently fail */`; `ContentBriefs.tsx` 14 catch blocks; `routes/outcomes.ts:395` fabricated `'<action_type> action'` recommendation string (consumed by E5 too) |
| #9 | **VERIFIED** | No `lost_visibility` in the `InsightType` union (`shared/types/analytics.ts:190-208`); detection lives in `client-discovered-queries.ts` / `rank-tracking-scheduler.ts` / `keyword-command-center.ts` and feeds only the KCC filter chip (`:1122`) — pure wiring confirmed |
| #10 | **VERIFIED** | `routes/outcomes.ts:145-193` — per-workspace loop with nested `getActionsByWorkspace` + per-action `getOutcomesForAction` loops, synchronous on the main thread |
| #5 (gated) | **VERIFIED** | `src/components/client/OutcomeSummary.tsx` exists, zero mounting imports; `useClientOutcomeSummary` hook live in `src/hooks/client/useClientOutcomes.ts`; `WinsSurface` only mounted by `Briefing/InsightsBriefingPage.tsx` (dark flag) |
| Absorbed 5b/5c | VERIFIED | `competitor_alert` / `anomaly_digest` in union; renderer surfaces are `src/components/insights/InsightFeed.tsx` (admin) + `src/components/client/InsightsDigest.tsx` (client); merged PR #1164 only covered page_health collision + guessed-fields/invalidation — enrichment, 9 renderers, site-level unification still open. `REQUEST_TRANSITIONS` (`state-machines.ts:238`) + `MATRIX_CELL_TRANSITIONS` (`:222`) have **zero consumers** outside the file |
| Absorbed 6b | VERIFIED | `src/components/client/inbox/InboxTabLayouts.tsx` + `useInboxTabShell.ts` exist, referenced only by each other — dead |
| Absorbed 7b | VERIFIED | byType consumers enumerated below (G3) |
| Dead-code sweep | VERIFIED | `FixRecommendations.tsx`, `WeCalledIt.tsx`, `ClientActionDetailModal.tsx`, `InsightCards.tsx` — zero component imports each (`PredictionShowcaseCard` imports only the `WeCalledItEntry` **type**, not the component). `server/copy-voice-feedback.ts` referenced only by `tests/unit/copy-voice-feedback.test.ts` + two contract tests (`voice-authority-consumer-inventory`, `ai-dispatch-migration`) — #16's scope does not wire it → **delete**, with surgical contract-test edits. `OutcomeSummary.tsx` is NOT in the sweep (E5 mounts it) |

No item required a NEEDS-RECHECK downgrade.

### #9 ↔ 5b collision resolution

#9 mints a **new InsightType** (`lost_visibility`), which per the four-part lockstep rule touches `shared/types/analytics.ts` (union + `InsightDataMap`), `server/schemas/`, and the renderer switches (`InsightFeed.tsx`, `InsightsDigest.tsx`). 5b adds renderer cases for the 9 default-falling types plus the renderer-coverage contract test in the **same files**. → Both live in **Lane G, sequential**: **G1 (#9) first** (Wave 1 urgency — the proactive alert that justifies a retainer), **G2 (5b/5c) second**; G2's contract test ("every InsightDataMap key has a non-default rendering path") then locks in G1's renderer permanently. G3 (7b) last in the lane.

### 7b prerequisite — InsightsSlice.byType consumer inventory (grep-verified)

Capping `byType` (top 25/type by impactScore) without redirection causes count regressions in:

1. `server/intelligence/insights-slice.ts:listAllInsightsFromSlice` — flattens `byType` (falls back to `all`); consumed by `server/monthly-digest.ts:69`, `server/admin-chat-context.ts:619`, `server/intelligence/diagnostic-context-builder.ts:38,77`
2. `server/routes/client-intelligence.ts:42` — hand-rolled `Object.values(insights.byType).flat()`
3. `server/meeting-brief-generator.ts:48,161` — `byType.ranking_opportunity?.length` used as a **count**

(`server/intelligence/formatters.ts` reads only `insights.all` / `topByImpact` — safe.)

**Internal task order inside G3 (hard dependency edge):** (a) add uncapped `countsByType: Partial<Record<InsightType, number>>` to `InsightsSlice` in `shared/types/intelligence.ts` + populate in the assembler; (b) redirect consumers 1–3 to `all` / `countsByType`; (c) only then apply the per-type cap; (d) MCP payload size before/after check.

---

## Lane structure, file ownership, and waves

Lanes run in parallel (separate worktrees, exclusive ownership); PRs within a lane are strictly serial. **Merge queue is serial run-wide** (see Run-level protocol).

### Ownership map (Rule 2 — exclusive while the lane has an open PR)

```
Lane A — Outcomes/Learnings        OWNS: server/outcome-*.ts, server/workspace-learnings.ts,
                                         server/outcome-learning-default-path.ts, server/routes/outcomes.ts,
                                         shared/types/outcome-tracking.ts
Lane B — Keyword Hub               OWNS: server/keyword-command-center.ts, server/routes/keyword-command-center.ts,
                                         src/components/KeywordHub.tsx, src/components/keyword-hub/*,
                                         src/components/keyword-command-center/*
Lane C — Content                   OWNS: server/content-brief-generation-job.ts, server/routes/content-posts.ts,
                                         server/routes/content-publish.ts, server/routes/copy-pipeline.ts,
                                         server/routes/llms-txt.ts, server/routes/aeo-review.ts,
                                         server/domains/content/*
Lane D — Recommendations           OWNS: server/recommendations.ts, server/routes/recommendations.ts,
                                         src/components/InsightsEngine.tsx (D1 only — coordinate with E2's toast fix
                                         via merge order, see graph)
Lane E — Client portal             OWNS: src/components/client/* (except inbox/* during H1 and the G-lane renderer
                                         InsightsDigest.tsx), server/routes/public-portal.ts,
                                         server/routes/public-analytics.ts, tests/integration/* portal-auth harness (E3)
Lane F — Strategy                  OWNS: server/keyword-strategy-*.ts, server/ai-operation-registry.ts,
                                         server/routes/keyword-strategy.ts, src/components/WorkspaceOverview.tsx (F2)
Lane G — Insights (new)            OWNS: server/insights*.ts + insight enrichment path, server/state-machines.ts wiring
                                         targets, server/intelligence/insights-slice.ts, shared/types/analytics.ts,
                                         server/schemas/* (insight schemas), src/components/insights/InsightFeed.tsx,
                                         src/components/client/InsightsDigest.tsx,
                                         server/routes/client-intelligence.ts + meeting-brief-generator.ts (G3 redirects)
```

**Shared/sequential files (any lane needing them coordinates through the serial merge queue + rebase):** `scripts/pr-check.ts` + `docs/rules/automated-rules.md` (multiple PRs add rules — each runs `npm run rules:generate` in the same commit; conflicts resolved at rebase), `shared/types/intelligence.ts` (A1 availability switch vs G3 countsByType — A1 merges first), `server/ws-events.ts` (G1 if a new event constant is needed), `server/middleware.ts` (READ-only for E1; E3 may modify — no other lane touches it).

---

## PR catalog

Per-PR plans are authored just-in-time. Every PR inherits the **run protocol** (bottom) and these standing gates: `npm run typecheck` · `npx vite build` · `npx vitest run` (full) · `npm run pr-check` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet` · code review (`requesting-code-review` single-agent; **`scaled-code-review` whenever parallel subagents were used**) · all review-surfaced bugs fixed in-PR · doc sync (FEATURE_AUDIT / roadmap / BRAND_DESIGN as applicable).

### Wave 0 — immediate, independent

#### E1 — Guard the four public-portal GETs (audit #2) — Lane E
- **Scope:** Add `requireClientPortalAuth('workspaceId')` to the GETs at `public-portal.ts:246, 331, 459, 622`. No semantic change for admin (HMAC pass-through) or passwordless workspaces (current default preserved — 3b changes that later, separately).
- **Owns:** `server/routes/public-portal.ts`, new integration test file. **Reads:** `server/middleware.ts` (do NOT modify).
- **Contracts:** none new — reuses the existing middleware.
- **Tests:** integration, against the **public** endpoints (CLAUDE.md "integration tests must cover the actual read path"): (a) no credential + password-configured workspace → 401 on all four; (b) admin HMAC → 200; (c) client JWT for the workspace → 200; (d) passwordless workspace → 200 (preserved); (e) client JWT for workspace A against workspace B → 401.
- **Model:** Sonnet. **Reviewer:** Opus.
- **Edges:** none in; **E3 (3b) depends on this merging first** (3b flips the passwordless default these tests pin — E3's plan updates assertion (d) deliberately).

#### H1 — Dead-code sweep + 6b inbox deletions — early Haiku PR
- **Scope, commit 1 (sweep):** delete `src/components/client/FixRecommendations.tsx`, `WeCalledIt.tsx`, `ClientActionDetailModal.tsx`, `InsightCards.tsx`; delete `server/copy-voice-feedback.ts` + `tests/unit/copy-voice-feedback.test.ts`; surgical edits to `tests/contract/voice-authority-consumer-inventory.test.ts` + `tests/contract/ai-dispatch-migration.test.ts` (remove references, keep the rest of each test intact). Do **NOT** delete `OutcomeSummary.tsx` or `useClientOutcomes.ts` (E5 mounts them) or `PredictionShowcaseCard.tsx` (live in OverviewTab:420). Re-grep every deletion target for imports immediately before deleting (verified clean 2026-06-10, but staging moves).
- **Scope, commit 2 (6b — kept separate because the test edits are nontrivial):** delete `src/components/client/inbox/InboxTabLayouts.tsx` + `useInboxTabShell.ts`; strip InboxTab's dead props + their `ClientDashboard.tsx` threading (re-count the dead props at plan time — old plan said 9); check upstream legacy fetches for remaining consumers before stripping.
- **Owns:** the deleted files, `src/components/client/InboxTab.tsx`, `src/components/client/ClientDashboard.tsx` (prop threading only), the named test files. **Reads:** everything else.
- **Tests:** full suite green is the test; plus grep-proof in the PR body (`grep -rn <Name> src/ server/ tests/` empty per deletion).
- **Doc sync:** CLAUDE.md client-inbox component list + FEATURE_AUDIT entries for removed components, same PR.
- **Model:** Haiku (commit 1), Sonnet (commit 2 — InboxTab prop surgery needs judgment). **Reviewer:** Opus.
- **Edges:** none in; rebase after PR #1166 merges. E5 and G2 touch neighboring client components — H1 merges before Wave 2 starts to avoid churn.

### Wave 1 — lane-parallel

#### A1 — Fix learnings corruption (audit #1) — Lane A — THE CRITICAL PATH
- **Scope:** (1) backfill uses `recommendationOutcomeActionType(rec.type, rec.source)` instead of hardcoded `'audit_fix_applied'` (`outcome-backfill.ts:197`); (2) filter `not_acted_on` from measurement + learnings aggregation; (3) generic metric-presence guard — phantom primary metrics (e.g. `click_recovery`) score `inconclusive`, never neutral/loss; (4) disable the difficulty multiplier until rebinned (position-bins vs provider-KD mismatch, `workspace-learnings.ts:216-226` / `outcome-learning-default-path.ts:65-79`); (5) implement the `disabled` availability switch (`LearningsSlice.availability` — union value already exists).
- **Owns:** `server/outcome-backfill.ts`, `server/outcome-measurement*.ts`, `server/outcome-scoring-defaults.ts`, `server/workspace-learnings.ts`, `server/outcome-learning-default-path.ts`, `shared/types/intelligence.ts` (availability semantics only), unit + integration tests. **Reads:** `server/routes/recommendations.ts` (mapping fn — do not modify; if its signature must change, STOP/NEEDS_CONTEXT).
- **Contracts (Rule 1, exported for downstream):** the metric-presence guard helper signature; the availability-switch read path (consumers already obey `LearningsSlice.availability` per CLAUDE.md — A1 makes `disabled` reachable). These must be in the merged PR before A4/A6/E5 plans lock.
- **Tests:** unit — backfill maps each rec type to its mapped action type (assert ≠ `audit_fix_applied` for non-audit types); `not_acted_on` rows excluded from win-rate aggregation; phantom-metric action scores `inconclusive`; difficulty multiplier returns 1.0 while disabled. Integration — learnings summary over seeded mixed fixtures produces no fabricated loss lines; availability `disabled` propagates through `buildContentGenerationContext`.
- **Model:** Opus (cross-context scoring semantics, widest blast radius in the run). **Reviewer:** Opus.
- **Edges out:** gates A4 (#15), A6 (#22), E5 (#5), and the run-wide learnings-consumer freeze (lifted only after A1 verified on staging).

#### A2 — Outcomes overview aggregate SQL (audit #10) — Lane A, serial after A1
- **Scope:** replace the ~3×W×A synchronous per-action loops in `GET /api/outcomes/overview` (`routes/outcomes.ts:145-193`) with aggregate SQL (`COALESCE` on every `SUM` per pr-check rule; `workspace_id` scoping).
- **Owns:** `server/routes/outcomes.ts`, `server/outcome-tracking.ts` (new aggregate readers via `createStmtCache`), tests.
- **Tests:** integration — endpoint parity against seeded fixtures (same counts/winRate/scoredLast30d as the loop version, divergent fixtures across 2 workspaces); a coarse latency assertion is optional, correctness parity is the gate.
- **Model:** Sonnet. **Reviewer:** Opus.
- **Edges:** after A1 (same-lane serialization; no semantic dependency). Gates E5 together with A1.

#### B1 — Hub cutover blockers (audit #4) — Lane B
- **Scope:** (1) `KeywordActionMenu.tsx:90` — protected-keyword actions open `<ConfirmDialog>` (shared primitive) instead of silently passing `{ force: true }`; (2) add-keyword input in the Hub header writing through the existing add path. Both land dormant behind the existing P5 flag — **no flag flip** (#18 parked).
- **Owns:** `src/components/keyword-command-center/KeywordActionMenu.tsx`, `src/components/KeywordHub.tsx`, `src/components/keyword-hub/*`, component tests. **Reads:** `server/keyword-command-center.ts` action types, `shared/types/` Hub contracts.
- **Tests:** component — protected action click renders ConfirmDialog, confirm dispatches with `force: true`, cancel dispatches nothing; add-keyword input submits → mutation called with entered keyword; flag-off snapshot unchanged.
- **Model:** Sonnet. **Reviewer:** Opus.
- **Edges:** none. Parked #18 re-enters only on owner signal after these are verified on staging.

#### C1 — Request-driven brief enrichment parity (audit #3) — Lane C
- **Scope:** extract a shared enrichment helper from the standalone path (scrape refs + SERP via `scrapeUrls`/`scrapeSerpData`) and call it from `generateBriefForRequest` (`content-brief-generation-job.ts:203-309`); add `recordAction` on the request path mirroring the standalone call at `:176`.
- **Owns:** `server/content-brief-generation-job.ts` (+ new helper module if extracted), tests. **Reads:** `server/web-scraper.ts`, `server/outcome-tracking.ts`.
- **Contracts (Rule 1):** the shared enrichment helper signature (input: workspace + keyword + optional refs; output: scrapedRefs/serpData/stylePages) is pre-committed in this PR — **C4 (#16) consumes its output shape to persist source text; do not let C4 re-derive it.**
- **Tests:** integration — request-driven job produces a brief with `scrapedReferences`/`serpData` populated (mocked scraper) AND a recorded action with `sourceType` for the request; **FM-2** — scraper mock throws → brief still generates, degradation logged, no fake success in the evidence fields; action recording failure → job still completes with warn.
- **Model:** Sonnet. **Reviewer:** Opus.
- **Edges out:** C4 imports the helper contract.

#### F1 — Site-synthesis model upgrade + GenerationQuality persistence + admin metrics re-attach (audit #6 + #7, one PR) — Lane F
- **Scope:** (1) `keyword-site-synthesis` op → `gpt-5.4` with ~4-5k max tokens (registry `:277` + call sites `keyword-strategy-ai-synthesis.ts:1379,1386`); (2) persist `GenerationQuality` rows (new table or store — migration + `rowToX` + write at `keyword-strategy-generation.ts:~603`, replacing log-only); (3) re-attach `siteKeywordMetrics` in the admin GET (`routes/keyword-strategy.ts:~253`), mirroring `public-content.ts:165`; (4) fix the masking guard test with **divergent** fixtures (the current test seeds identical fixtures and can't see the omission).
- **Owns:** `server/ai-operation-registry.ts`, `server/keyword-strategy-ai-synthesis.ts`, `server/keyword-strategy-generation.ts`, `server/routes/keyword-strategy.ts`, new migration + store module, tests. **Reads:** `server/routes/public-content.ts` (mirror reference — do not modify).
- **Tests:** contract — registry entry asserts model/timeout/executionMode; integration — admin GET returns `siteKeywordMetrics` when the assembled strategy has them and the fixture diverges from the public route's; generation run persists a `GenerationQuality` row with poolSize/aiReturnedCount/suppressedCount/backfilledCount/floorHit; **FM-2** — AI failure path still writes a quality row recording the deterministic-backfill floor.
- **Model:** Opus (prompt/model-allocation judgment on the highest-leverage AI call). **Reviewer:** Opus.
- **Edges:** none in. DB-column+mapper lockstep rule applies (migration + interface + mapper + write path same commit).

#### G1 — Lost-visibility insight minting (audit #9) — Lane G (moved from Lane F per collision check)
- **Scope:** wire the existing daily lost-visibility detection (`client-discovered-queries.ts` / `rank-tracking-scheduler.ts`) into: (1) a new `lost_visibility` insight (full four-part registration: `InsightType` union + typed `LostVisibilityData` + `InsightDataMap` entry in `shared/types/analytics.ts`; Zod schema in `server/schemas/`; renderer cases in `InsightFeed.tsx` + `InsightsDigest.tsx`); (2) an `opportunity_event`; (3) a briefing story candidate. Broadcast + `useWorkspaceEvents` invalidation both halves (Data Flow Rules 1–2); client renderer narrative-framed, no purple, TierGate where applicable.
- **Owns:** `shared/types/analytics.ts`, `server/schemas/` (new schema file), the insight-minting bridge module, `src/components/insights/InsightFeed.tsx`, `src/components/client/InsightsDigest.tsx`, `server/ws-events.ts` (if a new constant is needed), tests. **Reads:** detection modules (`client-discovered-queries.ts` etc. — read-only; if detection output needs a new field, STOP/NEEDS_CONTEXT).
- **Contracts (Rule 1):** the `lost_visibility` InsightDataMap entry is pre-committed here — G2's renderer-coverage contract test must include it.
- **Tests:** integration — seeded lost-visibility rows → insight minted with correct severity/impactScore, idempotent re-run (no dupes), resolution respected; bridge rules per docs/rules/bridge-authoring.md (bridgeSource, `applyScoreAdjustment`, `{ modified: N }`, no manual broadcast); frontend handler invalidates the right query keys (contract test).
- **Model:** Sonnet (pattern-following against the existing insight bridges; Opus review). **Reviewer:** Opus.
- **Edges out:** G2 sequentially after.

#### E2 — Client trust batch (audit #8) — Lane E, after E1
- **Scope:** five cheap fixes: (1) split tier-lock vs admin-hidden on Strategy nav (`clientDashboardNav.ts:29` — `!ws.seoClientView` hides, only `tier === 'free'` locks-with-upgrade); (2) honest export labels in `ContentPlanTab.tsx:62-64` (CSV/JSON labels, or real formats — decide at plan time, label fix is the floor); (3) WinsSurface dead "See full history" link + free-tier teaser counting all-time as "this month"; (4) relabel the `OverviewTab.tsx:286` "ROI N" badge honestly (it's a 0-100 opportunity score); (5) mutation-failure toasts in `InsightsEngine.tsx:169` + the swallowed catches in `ContentBriefs.tsx` (14 catch sites — fix the silent ones, keep deliberate degradations commented).
- **Owns:** `src/components/client/client-dashboard/clientDashboardNav.ts`, `src/components/client/ContentPlanTab.tsx`, `src/components/client/Briefing/WinsSurface.tsx`, `src/components/client/OverviewTab.tsx`, `src/components/InsightsEngine.tsx`, `src/components/ContentBriefs.tsx`, component tests. **Note:** D1 also renders InsightsEngine admin-side — E2 merges before D1 starts (graph below).
- **Tests:** component — nav item states for (free, paid+hidden, paid+visible); toast appears on mutation rejection in InsightsEngine + ContentBriefs critical paths; WinsSurface teaser uses month-windowed count fixture.
- **Model:** Sonnet. **Reviewer:** Opus. UI gate: preview screenshots desktop + mobile; `grep -r "purple-" src/components/client/` clean.
- **Edges:** after E1 (same-lane serialization).

### Wave 2 — after the relevant Wave 1 lane PRs merge

#### E5 — Mount OutcomeSummary + dollar attribution (audit #5) — Lane E — **gated on A1 AND A2 merged**
- **Scope:** mount `OutcomeSummary` on the LIVE legacy client Overview (owner decision — no briefing-v2 work); surface `attributed_value` in OutcomeTopWins + WinsSurface; **backport WinsSurface to the legacy overview** (folded in per #23 decision); fix the fabricated recommendation string at `routes/outcomes.ts:395` (resolve the real source title via sourceType/sourceId, fallback to an honest generic).
- **Owns:** `src/components/client/OutcomeSummary.tsx` (revive/trim), legacy overview mount point (`OverviewTab.tsx` region — coordinate: E2 merged already), `src/components/client/Briefing/WinsSurface.tsx`, `server/routes/outcomes.ts` (`:395` block), `src/hooks/client/useClientOutcomes.ts`, tests. **Reads:** A1/A2's merged outcome semantics.
- **Tests:** integration on the **public** summary endpoint (actual read path); component — scorecard renders per tier with TierGate; win entries show real source titles for recommendation-sourced wins; attributed_value renders formatted.
- **Model:** Sonnet. **Reviewer:** Opus. Screenshots desktop + mobile.
- **Edges in:** A1 + A2 merged (numbers must be honest before they're shown); E2 merged (shared files).

#### A3 — Strategy outcome visibility (audit #14) — Lane A
- **Scope:** drop the once-ever guard (`keyword-strategy-persistence.ts:184` — verified); record per-keyword actions for net-new pageMap primaries (real pageUrl → scoreable).
- **Owns:** `server/keyword-strategy-persistence.ts`, `server/outcome-tracking.ts` (idempotency key shape), tests. **Edges in:** A1 merged (don't multiply corrupted learnings); coordinate with Lane F (persistence file is F-adjacent — F1 merged first; re-grep at plan time).
- **Tests:** regen on a workspace with an existing strategy action records a new action; per-keyword actions created only for net-new primaries (idempotent re-run); transitions valid per state machine.
- **Model:** Sonnet. **Reviewer:** Opus.

#### A4 — Keyword-level outcome bridge (audit #15) — Lane A — **gated on A1 merged + verified on staging** (learnings-consumer freeze)
- **Scope:** `recordAction` on Hub track/promote; score against `rank_snapshots` vs stored baselines; client requested-keyword rank-trend card.
- **Owns:** `server/outcome-measurement*` (rank-snapshot reader), the Hub action seam **by contract with Lane B** (B2 merged first — A4 calls a function B2 exports rather than editing `keyword-command-center.ts`; if that contract isn't in place, A4's plan pre-commits it), client trend-card component, tests.
- **Tests:** integration — track action + seeded rank_snapshots → outcome scored on schedule; FM-2 — missing snapshots → `inconclusive`, not fabricated; card renders 180d series.
- **Model:** Sonnet. **Reviewer:** Opus.

#### A5 — predictedEmv snapshots + effort priors (audit #20) — Lane A
- **Scope:** snapshot `predictedEmv` on ALL completion paths (audit: nulled on backfill paths); aggregate time-to-completion into effortDays; schedule the P6 realized-vs-predicted calibration job.
- **Owns:** `server/outcome-backfill.ts`, `server/outcome-tracking.ts`, calibration cron module, tests. **Edges in:** A1, A3 merged (same files).
- **Model:** Sonnet. **Reviewer:** Opus.

#### A6 — Cross-workspace platform_learnings priors (audit #22) — Lane A — **freeze-gated on A1 staging-verified**
- **Scope:** anonymized cross-workspace win-rate priors as the `no_data`/`degraded` fallback tier (pattern precedent: `keyword_metrics_cache`).
- **Owns:** new migration + store + the fallback seam in `server/outcome-learning-default-path.ts`, `shared/types/intelligence.ts` (if the slice grows a field — pre-commit), tests.
- **Model:** Opus (cross-context design: new data tier feeding every consumer). **Reviewer:** Opus.

#### B2 — Close the client keyword loop (audit #13) — Lane B
- **Scope:** requested-keyword list with one-click add (reuse the MCP `add_keyword_to_strategy` write path — import, don't reimplement); make ADD_TO_STRATEGY write the strategy artifact or relabel honestly (`keyword-command-center.ts:3287-3295` — verified phantom: feedback + tracked row only); "applies at next update" note on declines; "feedback since last generation" nudge (`KeywordStrategy.tsx:421-423` counts exist).
- **Owns:** `server/keyword-command-center.ts`, `server/routes/keyword-command-center.ts`, `src/components/KeywordStrategy.tsx` (nudge region — READ-coordinate with Lane F: F1 touched the route, not this component; re-grep), Hub components, tests. **Contracts out:** the strategy-write function A4 will call from track/promote.
- **Tests:** integration — ADD_TO_STRATEGY actually mutates the strategy artifact (or the UI label changes — owner-honest either way, plan decides); decline note renders; nudge appears when feedback newer than `generatedAt`.
- **Model:** Sonnet. **Reviewer:** Opus.

#### C2 — Absorbed 4b: sync AI routes → jobs — Lane C — **before C3 (#12), both touch content routes**
- **Scope:** migrate to the background job platform: copy single-entry generation (`copy-pipeline.ts:65-93`, sync `generateCopyForEntry`), blueprint generation (same route file), and the 4 admin crawls (llms.txt ×3 sync call sites in `llms-txt.ts`, AEO site review `aeo-review.ts:108`, LinkChecker + internal-links — locate at plan time, likely `webflow-analysis.ts`). Each returns `{ jobId }`, registers in `BACKGROUND_JOB_TYPES` with label/cancellable/resultBehavior, surfaces via `useBackgroundTasks` + TaskPanel.
- **Contracts (Rule 1 — pre-committed by this PR):** the **shared frontend job-progress pattern** (one hook/util wrapping start→track→invalidate for editor-adjacent generations). **C3 (#12 publish job) and any later lane work MUST consume it, not re-implement.** Named in `shared/types/background-jobs.ts` + a `src/hooks/` utility.
- **Owns:** the route files above, `shared/types/background-jobs.ts`, new job runner modules, the shared frontend hook, tests. 
- **Tests:** integration per migrated route — POST returns `{ jobId }`, job completes with result parity vs the old sync response (seeded workspace); FM-2 — AI/provider failure → job status `failed`, no partial-success; cancellation honored where declared.
- **Model:** Sonnet. **Reviewer:** Opus (parallel subagents likely → `scaled-code-review`).

#### C3 — Publish service extraction (audit #12) — Lane C — **pre-plan-audit REQUIRED before its plan**
- **Scope:** extract one `publishPostToWebflow` domain service in `server/domains/content/`, running through the job platform (consumes C2's job-progress contract); fixes silent fire-and-forget auto-publish (`content-posts.ts:369-441`, hatch at `:385`), the skipped `queueKeywordStrategyPostUpdateFollowOns` on the approval path (only `routes/content-publish.ts` calls it today), and field-map drift between the two divergent publish copies.
- **Owns:** `server/domains/content/publish*.ts` (new), `server/routes/content-posts.ts`, `server/routes/content-publish.ts`, tests. **Edges in:** C2 merged. **Edges out:** D2's publish-resolution hook.
- **Tests:** integration — approval-path publish runs as a job, failure surfaces as job `failed` + activity (not silent warn); follow-ons queued on BOTH paths; field-map parity contract test between old fixtures and the unified service.
- **Model:** Opus (cross-context extraction; route-to-service per platform-organization rules). **Reviewer:** Opus.

#### C4 — Persist AI review results + scraped source text (audit #16) — Lane C
- **Scope:** persist AI review verdicts (today discarded on editor close, `content-posts.ts:570-581`) and the scraped SERP/reference source text on the brief (consumes C1's enrichment-helper output shape). Enables the real-text evidence ledger later (#27 — parked).
- **Owns:** migration + brief/review store columns (typed interfaces, `parseJsonSafe`), `server/routes/content-posts.ts` review seam, `server/content-brief-generation-job.ts` persistence seam, tests. **Edges in:** C1 (contract), C3 (same route file — serialize after).
- **Tests:** integration — review run persists verdicts retrievable after "editor close"; brief row carries source text; Zod schema matches stored shape (optional fields per the schema-vs-stored-shape rule).
- **Model:** Sonnet. **Reviewer:** Opus.

#### D1 — Admin recommendations surface (audit #19) — Lane D
- **Scope:** full admin queue (not the borrowed client component with `tier="premium"` hardcoded at `WorkspaceHome.tsx:628`), dismissed-recs view + un-dismiss, OV breakdown inspection, `addActivity` on client rec PATCH/DELETE (admin currently blind to client triage).
- **Owns:** new `src/components/admin/` rec surface, `src/components/WorkspaceHome.tsx` (swap mount), `server/routes/recommendations.ts` (activity calls + any admin list endpoint), tests. **Edges in:** E2 merged (InsightsEngine file).
- **Tests:** integration — client PATCH/DELETE writes activity rows; un-dismiss transition valid per state machine; admin endpoint workspace-scoped.
- **Model:** Sonnet. **Reviewer:** Opus.

#### D2 — Recs ↔ content reconciliation (audit #11) — Lane D — **publish-resolution hook gated on C3**
- **Scope:** add `contentPipeline` to the slices list (`recommendations.ts:1085-1095` — verified it's dropped); suppress recs matching in-flight briefs/posts; resolve gap recs on publish (hook into C3's domain service); content-rec CTA → existing brief-purchase flow (`mapToProduct` returns `{}` for content at `:879-902`).
- **Owns:** `server/recommendations.ts`, `server/routes/recommendations.ts`, client CTA seam in the rec card component, tests. **Edges in:** C3 merged (the hook); D1 merged (lane serial).
- **Tests:** integration — generation with an in-flight brief suppresses the matching gap rec; publish resolves the rec (status transition validated); CTA produces the purchase flow payload.
- **Model:** Opus (cross-context: recs + content + client purchase). **Reviewer:** Opus.

#### E3 — Absorbed 3b: passwordless portal closure — Lane E — **after E1; changes the passwordless default**
- **Scope:** "closed until configured" (owner decision 2026-06-09): client-portal reads return 401 until a client credential exists; admin frontend's own `/api/public/*` consumption keeps working via admin-token pass-through; seed/demo fixtures get passwords so local dev + e2e stay green; the ~100-file test-harness migration (portal tests authenticate instead of relying on passwordless pass-through). E1's test (d) assertion is flipped here deliberately.
- **Owns:** `server/middleware.ts` (`:219-220` seam), `tests/` portal harness + affected integration files, `scripts/seed-demo` fixtures, tests. 
- **Tests:** integration matrix — passwordless workspace public GET → 401; configured workspace + client JWT → 200; admin HMAC → 200; `npm run seed:demo && npm run smoke:core` green.
- **Model:** Sonnet orchestrating + Haiku for the mechanical harness edits (file-ownership-partitioned batches). **Reviewer:** Opus + `scaled-code-review` (parallel batch).

#### E4 — Server-side grounding for client chat (audit #17) — Lane E
- **Scope:** replace `req.body.context` verbatim-JSON injection (`public-analytics.ts:302` `z.record(z.unknown())`, serialized at `:509`) with slice-derived blocks via the shared intelligence context builders; client hints become enum-validated, size-capped fields only.
- **Owns:** `server/routes/public-analytics.ts`, prompt-assembly seam, tests. **Edges in:** E3 (lane serial).
- **Tests:** integration — oversized/injected `context` rejected by schema; prompt contains slice-derived block (assert via mocked `callAI` capture), never client JSON; FM-2 — slice failure degrades to minimal grounding, no 500.
- **Model:** Opus (prompt engineering + security boundary). **Reviewer:** Opus.

#### F2 — WorkspaceOverview "Needs Attention" deep links (audit #21) — Lane F
- **Scope:** deep links + severity sorting on the dead-text list (`WorkspaceOverview.tsx:110-124` — verified no onClick); per-workspace attribution. Use `adminPath()` helpers; honor the `?tab=` two-halves contract for any tab-targeted link (receiver wiring verified per target).
- **Owns:** `src/components/WorkspaceOverview.tsx`, tests. **Edges in:** F1 (lane serial).
- **Model:** Sonnet. **Reviewer:** Opus.

#### G2 — Absorbed 5b/5c: insight enrichment + renderers + state machines — Lane G — after G1
- **Scope:** (1) `competitor_alert` enrichment through the enrichAndUpsert path (impactScore/domain); (2) `anomaly_digest` pruning/auto-resolve mirroring the boost-reversal loop; (3) renderer cases for the 9 default-falling InsightTypes in `InsightFeed.tsx` + `InsightsDigest.tsx` (client variants narrative-framed, no purple); (4) site-level audit unification; (5) **contract test: every `InsightDataMap` key has a non-default rendering path** — must include G1's `lost_visibility`; (6) wire `REQUEST_TRANSITIONS` + `MATRIX_CELL_TRANSITIONS` (`state-machines.ts:238/:222`, zero consumers verified) via `validateTransition` at their mutation sites + GUARD_SIGNALS entries.
- **Owns:** insight enrichment modules, both renderer files, `server/state-machines.ts` consumers (the request + matrix-cell mutation sites — enumerate at plan time), `tests/contract/` renderer-coverage test, tests. **Edges in:** G1 merged (same files, contract test covers its type).
- **Tests:** the renderer-coverage contract test; transition guard tests (illegal transition rejected at the store layer) for both newly wired machines; enrichment integration (competitor_alert rows carry impactScore/domain post-upsert).
- **Model:** Sonnet. **Reviewer:** Opus.

#### G3 — Absorbed 7b: InsightsSlice.byType cap — Lane G — after G2
- **Scope & hard internal ordering:** (a) add `countsByType` to `InsightsSlice` (`shared/types/intelligence.ts:232` region) + populate in `insights-slice.ts`; (b) **redirect the verified consumers first** — `listAllInsightsFromSlice` (and through it `monthly-digest.ts:69`, `admin-chat-context.ts:619`, `diagnostic-context-builder.ts:38,77` — redirect the helper to `all`), `routes/client-intelligence.ts:42`, `meeting-brief-generator.ts:48,161` (counts → `countsByType`); (c) then cap `byType` at top 25/type by impactScore; (d) MCP payload size before/after measurement in the PR body.
- **Owns:** `server/intelligence/insights-slice.ts`, `shared/types/intelligence.ts`, the three consumer files, tests. **Edges in:** G2 (lane serial); A1 merged (A1 also touches `shared/types/intelligence.ts` — A1 first).
- **Tests:** contract — counts reported by redirected consumers equal pre-cap totals on a >25/type fixture; `byType` lists capped at 25 ordered by impactScore; `all` unaffected.
- **Model:** Sonnet. **Reviewer:** Opus.

---

## Task dependency graph (Rule 4)

```
Pre-run:
  PR #1166 (old PR 7) merges independently → rebase all Wave 0 branches after it lands

Wave 0 (parallel):
  E1 (#2 portal GET guards)  ∥  H1 (dead-code sweep + 6b)

Wave 1 (parallel lanes, after Wave 0 merges):
  A1 (#1 learnings fix)  ∥  B1 (#4 Hub blockers)  ∥  C1 (#3 brief parity)
  ∥  F1 (#6+#7 synthesis/metrics)  ∥  G1 (#9 lost-visibility insight)  ∥  E2 (#8 trust batch, after E1)

Sequential within lanes (Wave 1 → Wave 2):
  Lane A: A1 → A2 (#10) → A3 (#14) → A5 (#20) → A4 (#15, also freeze-gated) → A6 (#22, freeze-gated)
  Lane B: B1 → B2 (#13)
  Lane C: C1 → C2 (4b) → C3 (#12, pre-plan-audit) → C4 (#16)
  Lane D: D1 (#19, after E2) → D2 (#11, after C3)
  Lane E: E1 → E2 → E5 (#5, after A1+A2) → E3 (3b) → E4 (#17)
  Lane F: F1 → F2 (#21)
  Lane G: G1 → G2 (5b/5c + state machines) → G3 (7b, after A1 for shared/types/intelligence.ts)

Gated edges (cross-lane, explicit):
  A1 ∧ A2  → E5            (outcome numbers must be honest before display)
  A1 (staging-verified) → A4, A6, and lifts the run-wide learnings-consumer freeze
  C2 → C3                  (job-progress contract; both touch content routes)
  C3 → D2                  (publish-resolution hook)
  C1 → C4                  (enrichment-helper output contract)
  E1 → E3                  (#2 ships safe-under-passwordless first; 3b then changes the default)
  E2 → D1                  (InsightsEngine file ownership handoff)
  G1 → G2 → G3             (InsightType registration → renderer contract test → slice cap)
  H1 → Wave 2 client-component PRs (E5, G2 renderers) — deletions land before adjacent edits
  #27 (parked) re-enters only after C4 (#16)
```

PR counts: **Wave 0: 2 · Wave 1: 7 (A1, A2, B1, C1, F1, G1, E2) · Wave 2: 16 — total 25.**

---

## Cross-PR contracts (Rule 1 / Rule 6 roll-up)

| Contract | Carried by | Consumed by |
|---|---|---|
| Metric-presence guard + `disabled` availability switch semantics | A1 | A4, A5, A6, E5, all learnings consumers |
| Brief enrichment helper (scrape/SERP output shape) | C1 | C4 |
| Shared frontend job-progress hook + `BACKGROUND_JOB_TYPES` entries | C2 | C3, any later generation UI |
| `publishPostToWebflow` domain service | C3 | D2 (gap-rec resolution hook) |
| `lost_visibility` InsightType four-part registration | G1 | G2 (contract test), client/admin feeds |
| Renderer-coverage contract test (`InsightDataMap` ↔ renderer) | G2 | every future insight PR |
| `InsightsSlice.countsByType` | G3 | meeting-brief, client-intelligence, future count consumers |
| Hub strategy-write function (ADD_TO_STRATEGY artifact write) | B2 | A4 (track/promote recordAction seam) |
| Portal auth posture: E1 pins passwordless-open; E3 flips to closed-until-configured | E1 → E3 | all portal integration tests |

## Systemic improvements roll-up

- **pr-check rules** (each with `npm run rules:generate` in the same commit; serialize via the merge queue): unauthenticated `router.get` in public-portal without a portal-auth middleware (E1); sync-AI route without `{ jobId }` outside the allowlist — extend the existing background-generation rule (C2); fabricated-string pattern in client-facing outcome serialization if mechanizable (E5, optional).
- **Contract tests:** renderer coverage (G2); byType count parity (G3); publish field-map parity (C3); explicit portal-auth matrix (E1/E3).
- **Shared utilities:** brief enrichment helper (C1); job-progress hook (C2); metric-presence guard (A1).
- **Feature-class gates:** client-visible PRs (E2, E5, G1, G2, B1) follow the client-visible definition-of-done; job PRs (C2, C3) follow the background-job golden path.

## Run-level protocol

**Merge-order policy:** staging merges are **strictly serialized** run-wide — one PR in the queue at a time, even across lanes. Before merge: `git fetch origin staging && git rebase origin/staging`, re-run full gates on the rebased head. After each merge: confirm the Render staging deploy goes healthy before the next merge (deploy failure = stop and fix). Lanes may develop in parallel worktrees continuously; only merging is serial.

**Checkpoint protocol after every parallel batch (Rule 3):** (1) `git diff` review of all modified files; (2) grep duplicate imports in any file touched by 2+ agents; (3) check for conflicting edits; (4) `npm run typecheck`; (5) `npx vitest run` full suite. Then `scaled-code-review` before the PR opens (any PR that used parallel subagents); single-agent PRs use `requesting-code-review`. All review-surfaced bugs fixed in-PR — never deferred.

**Per-PR plan authoring:** branch `claude/core-<lane><n>-<slug>` off latest `origin/staging`; author `docs/superpowers/plans/2026-06-10-<lane><n>-<slug>.md` (contracts + test assertions, no pre-baked bodies); re-verify this plan's citations against the rebased head; if reality contradicts a finding, STOP that item and note it in the PR body. C3 additionally runs the `pre-plan-audit` skill first.

**Failure handling:** CI red → fix on branch, re-push. A finding wrong on re-verification → drop + document. Never expand scope beyond the plan except review-surfaced bugs.

## Verification strategy (run-level; each per-PR plan names exact commands)

- Standing gates per PR (listed at the top of the PR catalog).
- E1/E3: manual curl matrix — no-credential GET on the four endpoints (401 with password set), admin HMAC (200), client JWT cross-workspace (401), passwordless (200 pre-E3, 401 post-E3).
- C2: trigger each migrated job on a seeded workspace (`npm run seed:demo`), observe TaskPanel progress, verify result parity vs the old sync responses.
- A1: before/after learnings summary diff on a seeded corrupted-fixture workspace, asserted in tests + shown in the PR body.
- F1: one real strategy generation on staging post-merge; inspect the persisted GenerationQuality row.
- UI PRs (B1, E2, E5, G1, G2, F2, D1): preview screenshots desktop + mobile; `grep -r "purple-" src/components/client/` clean.
- G3: MCP intelligence payload byte size before/after in the PR body.
- After every staging merge: staging deploy healthy before the next merge.

## Parked items + re-entry conditions

| Item | Parked because | Re-entry condition |
|---|---|---|
| #18 Hub P5 cutover/flag flip | Owner decision | Owner signal, after B1's blocker fixes are verified on staging |
| #25 Provider SERP position checks | Zero new provider spend this run | Owner approves provider budget |
| #23 briefing-v2 blend/cutover | Owner decision — E5 backports WinsSurface to legacy instead | Owner sets a cutover date; revisit after E5 ships |
| #24 recommendation_sets normalization | L-effort substrate work | Before any P5/P6 calibration feature that needs stable rec identity (A5's calibration job consumes what exists; full normalization waits) |
| #26 Workspace goals + trajectory | New data model, "Later" tier | After the proof-of-value wave (E5, A-lane) ships and retention impact is observed |
| #27 Content performance join-back + term-coverage grading | Prerequisite is #16 | After C4 (#16) merges; owner prioritization |

**The run is complete when the 25 catalog PRs are merged to staging, not when the audit report is empty.** Remaining minor-list items not folded into a catalog PR stay documented in the audit for opportunistic adjacent work.
