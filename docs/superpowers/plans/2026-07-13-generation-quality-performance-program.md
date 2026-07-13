# Generation Quality and Performance Program — Execution Plan

> Controller-owned plan. Active platform: Codex/OpenAI. PR #1520 is merged to `staging` as `730c1eb62`; it is a completed prerequisite, not work to repeat. Every implementation PR starts from the then-current `origin/staging`.

**Goal:** Make keyword, strategy/recommendation, and content generation truthful, edit-safe, evidence-preserving, measurable, and faster before investing in additional model experiments.

**Authority:** the approved program plan → [cross-phase contracts](./2026-07-13-generation-quality-cross-phase-contracts.md) → current subsystem rules and source code. If current source contradicts a proposed contract, stop that lane and report the contradiction; do not guess or use `as any` to force compatibility.

## Execution Discipline

For every task: **read the real code; write and run a test that fails for the intended reason; implement minimally against real signatures; rerun the focused test and `npm run typecheck`; commit.** Never transcribe an implementation body from this plan and never skip the red.

Each numbered implementation unit is one PR to `staging`. A phase N+1 PR may not begin until its declared dependency is merged, CI-green, deployed to staging, and smoke-verified. Independent siblings may be developed concurrently in isolated worktrees, but merge one at a time; after every sibling merge, rebase remaining siblings on current `origin/staging` and rerun their full gates.

## Bounded Contexts and Integration Surfaces

| Lane | Primary bounded context | Secondary integrations | Behavior class |
|---|---|---|---|
| G / O | `platform-foundation` | all AI-consuming contexts, `analytics-intelligence` | new governance plus compatible instrumentation |
| K | `seo-health` | `analytics-intelligence`, outcomes/ROI, Keyword Hub UI; K5 provider mechanics are `integrations`-owned | correctness, behavior-preserving read optimization, then flagged ranking change |
| C | `content-pipeline` | `brand-engine`, `analytics-intelligence`, background jobs | correctness, durability, then flagged prompt-context change |
| S | `analytics-intelligence` | `seo-health`, inbox, outcomes/ROI, client portal | concurrency and lifecycle correctness |
| V | `outcomes-roi` or the consuming context named per task | keyword, content, client portal | evidence-backed roadmap value |

Existing API routes, React Query keys, and workspace broadcasts remain stable unless a phase explicitly adds a typed field. Mutations continue to log activity and broadcast canonical `WS_EVENTS`; frontend consumers continue invalidating existing query keys through `useWorkspaceEvents`. Public/client serializers must not expose generation provenance unless separately approved.

## Exact PR Dependency Graph

```text
P0 program-control docs/roadmap/guardrails
 ├─ G1 AI execution governance ───────────────────────────────┐
 └─ K1 keyword evidence integrity ───────┐                    │
                                         ├─ K2 KCC read path  │
                                         ├─ K3 Unicode norm.  │
                                         └─ K4 recall flag ───┤
G1 ─┬─ C1 truthful content generation ── C2 edit safety ── C3 context-v2 flag
    ├─ S1 recommendation CAS ──────────── S2 lifecycle repair ── S3 ordered convergence
    └─ O1 runtime quality governance <──────────────────── K/C/S telemetry

K1 + O1 ── V1 conversion-grounded VPC
K1 + K2 ── V2 intent/branded split
O1 + S2 ── V3 confidence-aware outcome scorecard
V1 + S2 ── V4 internal-link value priority
```

P0 is this program-control PR. `G1 ∥ K1` may run in parallel. After G1, `C1 ∥ S1`; after K1, `K2 ∥ K3` may run in parallel. K4 waits for K1 and K3. C2 waits for C1 and G1; S2 waits for S1 and K1. O1 may be developed after G1 but merges only after it can consume the stable telemetry emitted by the completed K/C/S roots. No sibling writes another sibling's files.

## File Ownership and Dispatch Pattern

Before each parallel batch, the controller commits shared types, migration(s), exported signatures, constants, feature-flag catalog entries, and barrel exports. Implementers import those contracts and must not recreate them.

Every dispatch prompt must provide:

- **OWN:** exact domain modules, routes or components, and focused tests.
- **READ ONLY:** shared contracts, `server/jobs.ts`, event/query-key registries, roadmap and feature audit unless assigned to the controller.
- **STOP:** any required edit outside OWN returns `NEEDS_CONTEXT`; the agent does not edit it.

Controller-only coordination files: `data/roadmap.json`, `FEATURE_AUDIT.md`, shared barrels, migration numbering, feature-flag catalog/groups, `server/ws-events.ts`, generated rules, and these program documents. Only one agent owns a frontend surface. Only one agent owns each DB table and mapper family per batch.

Model assignments:

- `GPT-5.5`: G1, C2, S1/S2/S3, O1, prompt/evidence contracts, cross-context integration, and all specification/code-quality/adversarial reviews.
- `GPT-5.4`: K1–K4, C1/C3, V1–V4, bounded services, UI, and focused tests.
- `GPT-5.4-Mini`: controller-approved mechanical fixture/docs updates only.

## Phase PRs and Acceptance Contracts

### P0 — Program Control

**Owner:** controller. **Dependency:** merged roadmap audit `730c1eb62`.

- Commit this execution plan and the cross-phase contract document.
- Add/rescope roadmap records and feature audit entries in the same PR; sort the roadmap.
- Record that retired `keyword-hub`, `keyword-universe-full`, and `signal-auto-recompute` flags must never return. Preserve permanent safety gates such as `strategy-trust-ladder-autosend`.
- Pass docs/roadmap validation, `npm run pr-check`, typecheck, and full CI; merge before implementation dispatch.

### G1 — AI Execution Governance

**Owner:** `platform-foundation`; GPT-5.5. **Own pattern:** AI dispatcher, operation registry, provider helpers, telemetry/dedup tests.

- Add typed operation cache policy: `none`, `inflight`, or explicit TTL. Unclassified generation defaults to inflight-only; completed-response caching requires a named operation policy.
- Preserve `callAI(): Promise<string>` while adding a metadata-returning execution path for new consumers.
- Emit provider-neutral run ID, operation, attempt, retry/fallback, latency, tokens, and real cache hit/miss traces for OpenAI and Anthropic.
- Correct AI usage-window and cache-rate calculations without changing authentication or public exposure.
- Tests prove explicit regeneration never replays a completed cached response, safe TTL operations do, concurrent identical inflight calls deduplicate, providers emit equivalent traces, and prompt/secret content is not recorded.

### K1 — Keyword Evidence Integrity

**Owner:** `seo-health`; GPT-5.4. **Own pattern:** page-keyword adapters, universe/enrichment/value producer, persisted-path tests.

- Read/map stored `search_intent` on the lightweight page path.
- Preserve CPC, intent, source, and provenance through candidate pool, enrichment, stored strategy, and Opportunity Value.
- Corrected CPC remains the fallback for later conversion-grounded scoring.
- Tests begin from persisted rows and prove authoritative intent/CPC survive to KCC and recommendation scoring; fixture-only object injection is insufficient.

### C1 — Truthful Content Generation

**Owner:** `content-pipeline`; GPT-5.4. **Depends:** G1.

- Separate strict creation schemas from partial update schemas for briefs/copy.
- Require the exact planned-section census; allow one bounded repair, then fail without committing an incomplete artifact.
- Add `needs_attention` to generated-post lifecycle through the canonical transition registry. Census every status consumer (shared types, schemas, mappers, routes, filters, badges/actions, public serializers, lifecycle/state-machine tests) and define legal transitions/fallback rendering in this PR.
- On initial generation, required-stage failure may persist `needs_attention` only with useful stages plus structured diagnostics and the canonical status-update event; it emits no success semantics. On regeneration, preserve the prior valid artifact and record diagnostics on the failed run/job. Only complete artifacts become `draft`.
- Jobs and activity logs report partial/failure honestly and never record `post_generated` for an incomplete post.
- Cover success, malformed output, missing section, provider error at each stage, repair success/failure, cancellation, and retry.

### S1 — Recommendation Generation Concurrency

**Owner:** `analytics-intelligence`; GPT-5.5. **Depends:** G1.

- Add version-conditional recommendation-set commits.
- On one conflict, re-finalize already-generated candidates against the latest lifecycle state and retry without repeating the paid provider call. A second conflict fails safely.
- Test concurrent send, dismiss/strike, operator edit, and client action during generation; the concurrent decision always wins and provider-call count remains one.

### K2 — KCC Read-Path Performance

**Owner:** `seo-health`; GPT-5.4. **Depends:** K1.

- `/initial` hydrates canonical first paint and seeds independent summary/rows caches; search, filter, sort, and pagination use `/rows` with previous-data retention.
- Replace the full strategy assembler with a KCC-owned projection that reads each required source once.
- Add authoritative rank snapshot time/age and honest stale/unavailable states without changing route meaning or visuals.
- Acceptance: one `/initial` call per mount, no summary execution after interaction, backward-compatible parity for existing fields plus typed freshness API/hook/component coverage, query-count regression test, mobile browser smoke, and materially improved measured p50/p95/query count recorded in PR evidence.

### K3 — Unicode Keyword Normalization

**Owner:** `seo-health`; GPT-5.4. **Depends:** K1.

- Complete the existing `keyword-universe-overhaul` normalization task with Unicode NFKC and Unicode letters/numbers.
- Define deterministic whitespace/punctuation/accent behavior without changing persisted externally mirrored values.
- Test accented Latin, non-Latin scripts, compatibility characters, punctuation-only input, empty output, and duplicate equivalence.

### C2 — Content Edit Safety and Provenance

**Owner:** `content-pipeline`; GPT-5.5. **Depends:** G1 + C1.

- Add additive generation revisions and typed internal provenance for content posts, content briefs, and copy sections using the shared contract; cover every mapper, mutation, and internal/public serializer in lockstep.
- Save only against the expected revision. Operator edits and approved content win; automatic work never replaces them. Explicit replacement is a distinct authorized action.
- Scope job dedupe by resource, not workspace, so unrelated artifacts run concurrently and the same artifact cannot duplicate.
- Test edit during every long AI stage, approved-state protection, explicit replacement, duplicate same-resource job, independent-resource concurrency, and migration/mapper/serializer lockstep.

### S2 — Recommendation Lifecycle Reconciliation

**Owner:** `analytics-intelligence`; GPT-5.5. **Depends:** S1 + K1.

- Add recommendation provenance/revision storage and stable normalized producer identities.
- Resolved sources cannot remint active recommendations. Suppression is merge-key local, not category-wide. Evidence priority caps survive final score normalization.
- Recommendation lifecycle is authoritative for mirrors while preserving client comments/responses.
- Before adding repair behavior, the controller updates the existing `strategy-divergence-sweep` catalog label, purpose, and removal condition from read-only reporting to observation/repair semantics; do not create a replacement flag.
- Upgrade divergence sweeping from reporting to bounded repair under that updated gate. Tests prove flag-OFF/read-only parity and flag-ON bounded repair/idempotence, in addition to remint prevention, identity stability across wording changes, local suppression, provider/category partial failure, priority invariants, mirror repair, comments, and broadcasts.

### K1b — Keyword Strategy Provenance Adoption

**Owner:** `seo-health`; GPT-5.4. **Depends:** G1 + K1. **Ships in the K1 PR unless migration/file ownership requires an immediately following dependent PR.**

- Add keyword-strategy generation revision, effective-input fingerprint, and shared run provenance across migration, mapper, synthesis commit, and internal serialization.
- Make the long-running synthesis save version-conditional so a concurrent operator strategy edit wins without repeating paid provider work.
- Register keyword strategy in the critical-operation provenance census and cover conflict, retry, and public-serializer omission paths.

### K4 — Candidate Recall and Diversity

**Owner:** `seo-health`; GPT-5.4. **Depends:** K1 + K3.

- Add one new server/per-workspace flag, `keyword-synthesis-candidate-recall`, default OFF with dated retirement target.
- Before the cap, include all requested/voted candidates, then satisfy deterministic source/intent/market quotas, then value-rank the remaining slots.
- Flag-OFF is byte-for-byte selection parity. Flag-ON achieves 100% requested/voted recall, deterministic ordering, no duplicates, and bounded prompt size across local, multilingual, low-volume, and sparse-provider fixtures.

### C3 — Content Context and Evidence Efficiency

**Owner:** `content-pipeline`; GPT-5.4, prompt review by GPT-5.5. **Depends:** C2.

- Add `content-generation-context-v2`, default OFF and workspace-aware, with dated retirement target.
- Build one token-budgeted brief-relevant context; stage calls receive minimal projections and voice/guardrails exactly once.
- Treat scraped text as untrusted evidence with observed-at/freshness; missing evidence produces unknown/needs-research, never invented certainty.
- Flag-OFF parity and flag-ON real-render/generation smoke are mandatory. Promote only with no completeness/first-pass-quality regression and measured token/latency improvement.

### S3 — Ordered Intelligence Convergence

**Owner:** `analytics-intelligence`; GPT-5.5. **Depends:** S2.

- Implement one ordered workflow: mutation → intelligence recompute → debounced recommendation regeneration → freshness broadcast.
- Reuse background-job dedupe/rate controls and existing canonical events. Never resurrect `signal-auto-recompute`.
- Test burst coalescing, failure/retry at each step, latest-evidence ordering, no premature broadcast, and no recommendation generation before successful intelligence completion.

### O1 — Runtime Quality Governance

**Owner:** `platform-foundation`; GPT-5.5. **Depends:** G1 plus merged stable telemetry from K1/C2/S2.

- Correlate job, AI operation, provider attempts, durable artifact, and outcome by run ID.
- Add observed p50/p95 latency, tokens, cost, provider calls, cache behavior, and query counts to workflow budgets.
- Add dedicated critical reliability/quality pipelines for keyword strategy, recommendations, Strategy POV, and content generation; require critical named operations to map to a pipeline and budget.
- Acceptance: deterministic fixtures fail when a pipeline/operation/budget is missing; runtime evidence is queryable without prompts/secrets; reports no longer claim 100% by omission.

### K5 — Provider Performance

**Owner:** `integrations`; GPT-5.4. **Secondary consumer:** `seo-health`. **Depends:** G1 + O1.

- Add bounded concurrency for competitor and discovery calls using one durable call/credit budget and explicit partial-failure policy.
- Test concurrency ceiling, cache reuse, exhausted budget, provider-specific failure, deterministic merge order, and cancellation.
- Record before/after latency, calls, credits, hit rate, and partial failures; do not expand live-provider spend during tests.

### V1–V4 — Dependent Roadmap Value

- **V1 `kwv-conversion-grounded-vpc`** (`outcomes-roi`, GPT-5.4; K1 + O1): new `conversion-grounded-vpc` workspace flag, fresh/sufficient GA4 economics first, corrected CPC fallback, typed source/confidence, calibrated client-safe gain bands.
- **V2 `kwv-intent-branded-split`** (`seo-health`, GPT-5.4; K1 + K2): presentation-only workspace intent mix from authoritative stored intent; no new classifier and no flag.
- **V3 `cda-sc5-outcome-scorecard`** (`outcomes-roi`, GPT-5.4; O1 + S2): workspace-only evidence; hide below 10 observations, label 10–29 early, 30+ established; one confidence calculation for learning and client copy.
- **V4 `kwv-internal-linking-value-priority`** (`seo-health`, GPT-5.4; V1 + S2): consume canonical resolved value/optimization/rank inputs with deterministic fallback; do not create another value model.

Each V PR owns its domain service/UI/tests only; shared score/confidence contracts are controller-precommitted. Tests prove flag fallback, evidence thresholds, attribution honesty, deterministic ordering, public read-path serialization where client-facing, and workspace-scoped cache invalidation.

## Systemic Improvements and Feature-Class Gates

- Extract shared execution metadata/provenance and compare-and-swap helpers when used by content and recommendations; do not duplicate them.
- Add pr-check/contract enforcement for critical named-operation pipeline/budget registration, new generation writes lacking conditional revisions, and forbidden resurrection of retired flag keys.
- Extend real adapter/integration coverage, concurrency tests, provider-error tests, transition tests, flag loading→loaded component tests, and browser flag-ON smoke.
- Apply background-generation, AI-generation, analytics, client-visible, and database-migration definitions of done as relevant. Use platform golden paths and the PR-readiness checklist before review.
- Model/style/seasonality experiments remain deferred until O1 provides attributable runtime evidence and the integrity phases are merged.

## Autonomous PR, CI, and Staging Loop

For every PR, the controller:

1. Fetches and branches from current `origin/staging`; confirms roadmap, active flag catalog, migration head, and clean worktree.
2. Precommits shared contracts before parallel dispatch; caps work at three write lanes with exclusive ownership.
3. Reviews each batch diff for ownership drift, duplicated contracts/imports, unsafe casts, raw provider imports, stale events/query keys, and public serializer leakage.
4. Runs focused red→green tests, domain smoke, then:

```bash
npm run typecheck
npx vite build
npx vitest run
npm run pr-check
npm run lint:hooks
npm run verify:feature-flags
npm run verify:platform:quick
npx tsx scripts/sort-roadmap.ts
```

5. Runs feature-specific AI reliability/quality/wiring, performance-budget, lexicon, deferred-ledger, migration, bundle, and browser checks where affected.
6. Requests independent GPT-5.5 spec, code-quality, and adversarial/failure-mode reviews; fixes every confirmed actionable bug in the PR.
7. Updates `FEATURE_AUDIT.md`, roadmap status/notes, feature catalog if sales-relevant, generated rules, and design docs if UI patterns changed.
8. Pushes a draft PR to `staging`, marks ready after local review, then polls CI. It fixes deterministic failures; it may retry a suspected flaky job once. A repeated failure is investigated and fixed, never waved through.
9. Merges only with all required checks green, no actionable review threads, and branch current with staging. Squash-merges, waits for staging deploy, verifies `/api/health`, and runs phase-specific smoke.
10. If staging fails, disables only an already-authorized staging canary and ships a corrective PR before dependents. It never changes production flags or promotes `staging` to `main` autonomously.

## Stop Conditions

Pause only the affected lane and report evidence when:

- current source contradicts a locked shared contract or requires a material product decision;
- a destructive migration, new paid-provider authority/spend, production flag/release change, or cross-tenant data use would be required;
- required staging credentials/workspace are unavailable for a flag-ON gate;
- CI infrastructure fails repeatedly after one retry and repository changes cannot correct it;
- a fix would materially expand the phase or collide with another lane's exclusive ownership.

All other implementation defects, review findings, flaky tests with a repository cause, and staging regressions are fixed autonomously before the lane advances.
