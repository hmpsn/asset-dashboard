# Generation Quality and Performance Program Specification

**Status:** Approved for phased implementation  
**Date:** 2026-07-13  
**Target branch:** `staging`  
**Owning contexts:** Platform foundation, SEO health, content pipeline, strategy/recommendations, outcome engine

## 1. Goal and success definition

Make keyword, content, strategy, and recommendation generation safe enough to trust, cheap enough to scale, and observable enough to improve. The program fixes integrity defects before introducing new scoring or generation behavior.

The program succeeds when:

- a generation job never reports success for an incomplete required artifact;
- an AI result never overwrites a newer operator or client decision;
- authoritative keyword evidence survives every adapter and scoring boundary;
- explicit regeneration cannot replay a completed cached response;
- recommendation refresh always consumes the latest completed intelligence generation;
- durable generated artifacts can be correlated to their operation, inputs, evidence, provider, model, and job run;
- runtime latency, tokens, provider calls, cache behavior, and quality can be evaluated per critical workflow;
- the selected companion roadmap items consume the corrected evidence and confidence contracts instead of creating parallel models.

## 2. Scope and delivery boundaries

### Core program

1. **AI execution governance** — operation-level cache policy, provider-neutral telemetry, real cache counters, and run correlation.
2. **Keyword evidence integrity** — stored intent, CPC, source, provenance, rank freshness, Unicode normalization, candidate recall, and KCC read-path efficiency.
3. **Content generation integrity** — strict artifact completeness, truthful partial failure, edit-safe commits, resource-scoped jobs, prompt budgeting, and evidence freshness.
4. **Recommendation integrity** — version-conditional commits, stable source identity, resolved-source retirement, mirror reconciliation, and ordered intelligence convergence.
5. **Runtime quality governance** — observed workflow budgets and dedicated reliability/quality fixtures for keyword strategy, recommendations, Strategy POV, and content generation.

### Approved roadmap companions

- `kwv-conversion-grounded-vpc`: use fresh, sufficiently supported GA4 conversion economics; corrected CPC remains the fallback.
- `kwv-intent-branded-split`: present workspace intent mix from authoritative stored intent only.
- `cda-sc5-outcome-scorecard`: confidence-gated, workspace-only outcome evidence.
- `kwv-internal-linking-value-priority`: consume the resolved canonical value score after its basis is stable.
- The Unicode normalizer closes the applicable task in `keyword-universe-overhaul`.
- Ordered convergence becomes the remaining contract of `strategy-redesign-phase-5c-auto-recompute`.

### Out of scope

- semantic embeddings or speculative business-fit scoring without verified bad-fit examples;
- content style variants, seasonality, or other model experiments before provenance and runtime evaluation exist;
- cross-tenant outcome claims or training;
- autonomous production flag changes or `staging` to `main` promotion;
- destructive migrations;
- replacement of current AI provider interfaces or public client API shapes unless separately approved;
- resurrection of retired flags, including `keyword-hub`, `keyword-universe-full`, or `signal-auto-recompute`.

## 3. Ownership snapshots and sequencing

Every PR starts from the latest `origin/staging`. Parallel work uses isolated worktrees and exclusive ownership. Shared contracts land before consumers. Merges are serialized; every unmerged sibling rebases and reruns gates after each merge.

| Lane | Bounded-context ownership | Primary write surface | Must not own |
|---|---|---|---|
| Controller | Program spec, rule docs, roadmap, feature audit, shared contract integration | `docs/`, `data/roadmap.json`, `FEATURE_AUDIT.md`, shared barrels | Domain implementations |
| G1 AI governance | Platform foundation | AI dispatcher, operation registry, provider helpers, observability | Content/keyword/recommendation domain behavior |
| K1–K5 Keywords | SEO health / Keyword Hub | Keyword adapters, strategy universe, KCC services/hooks, keyword tests | AI dispatcher, content persistence |
| C1–C3 Content | Content pipeline | Brief/copy/post generation, content jobs, schemas, persistence | Recommendation lifecycle, keyword scoring |
| S1–S3 Strategy | Strategy/recommendations | Recommendation generation/storage/reconciliation and intelligence follow-ons | Content generation, provider helpers |
| O1 Runtime quality | Platform observability / AI reliability | Budget registry, traces, reliability fixtures, stats | Product generation semantics |
| V1–V4 Companions | Outcome/value consumers | Canonical scoring and presentation consumers | New duplicate value or confidence models |

Shared-file ownership is controller-only during parallel batches. If a lane needs a shared type, migration number, event constant, feature flag, barrel export, roadmap entry, or generated rule update, the controller lands that contract first and then redispatches the lane.

Dependency order:

1. G1 and K1.
2. C1, S1, K2, and Unicode normalization in parallel.
3. Content provenance/edit safety, recommendation lifecycle reconciliation, and candidate recall.
4. Content context efficiency, ordered convergence, runtime governance, and provider performance.
5. VPC, intent mix, and outcome scorecard in parallel.
6. Internal-link value priority.

## 4. Shared contracts and behavior

### AI execution

Add an internal `AIExecutionPolicy` keyed by named operation:

- `none`: no coalescing or completed-response cache;
- `inflight`: coalesce identical concurrent work only;
- `ttl`: completed-response caching with an explicit positive TTL.

Generation and regeneration operations default to `inflight`. A completed-response TTL is permitted only when declared in the named operation registry and covered by a cache-safety test. Legacy/unclassified generation must never receive implicit TTL caching. OpenAI and Anthropic emit the same execution metadata and trace dimensions.

### Generation provenance and conditional saves

Define a shared internal `GenerationProvenance` envelope containing:

- `runId`, named `operation`, provider, and model;
- canonical effective-input fingerprint;
- evidence captured/freshness timestamp when evidence is used;
- generation start and completion timestamps.

For a multi-call artifact, `runId`/provider/model identify the accepted execution
that authorizes the adopted output, while optional `executionChainId` correlates
the logical job and an ordered bounded `executions` list records every accepted
contributing execution with its own exact effective-input fingerprint. The
artifact-level fingerprint is the canonical digest of those ordered fingerprints
plus deterministic authority inputs. Rejected or superseded attempts remain in
execution traces and are never mislabeled as adopted artifact provenance.

Content posts, content briefs, copy sections, recommendation sets, and keyword strategy gain an additive monotonic `generation_revision` and typed provenance JSON. Strategy POV retains its existing edit-safe fingerprint/version behavior and joins the shared run-correlation envelope. The revision is read before paid/long-running work and checked in the final write transaction. A mismatch means the newer durable state wins.

- Content conflict: do not save generated output; fail with a safe conflict result that tells the operator the draft changed.
- Recommendation conflict: re-finalize the already-generated candidates against the latest lifecycle state and retry the commit once. Do not repeat paid provider work. A second conflict fails safely.

Provenance remains internal; no public/client serializer change is included.

### Truthful artifact completion

- Required brief and copy creation use strict creation schemas distinct from partial-update schemas.
- Copy generation must return exactly the planned section census. Unknown, duplicate, or missing section IDs are invalid.
- One bounded structured-output repair is allowed. If repair fails, durable output is not replaced.
- On initial generation, a required-stage failure may persist a new `needs_attention` artifact only when useful successful stages and structured diagnostics are retained; it emits the canonical artifact/status update but no success-semantic activity, notification, broadcast, or downstream job. On regeneration, the prior valid artifact is preserved and diagnostics are stored on the failed run/job rather than replacing it.
- Only a complete required artifact may enter `draft` or trigger downstream success behavior.

### Evidence and recompute

- Stored intent, CPC, source, provenance, and rank snapshot time remain typed and present through read adapters, candidate pooling, enrichment, persistence, and scoring.
- Requested and voted keywords are mandatory members before the synthesis cap; diversity quotas precede value-ranked fill.
- Intelligence/recommendation convergence is ordered: mutation → intelligence recompute → debounced recommendation regeneration → freshness broadcast.
- Recommendation source identity uses normalized producer identity, never generated wording. Resolved or suppressed sources cannot remint active recommendations.

## 5. Feature flags and rollout

Only changed product semantics receive new flags:

| Flag | Default | Scope | Exit criterion |
|---|---|---|---|
| `keyword-synthesis-candidate-recall` | OFF | Server, per workspace | 100% requested/voted recall; quality fixtures and canary show no relevance regression |
| `content-generation-context-v2` | OFF | Server, per workspace | Complete artifact rate does not regress; prompt tokens and p95 latency improve |
| `conversion-grounded-vpc` | OFF | Server, per workspace | Fresh/supported GA4 path verified; CPC fallback and client-safe bands verified |

Correctness fixes, concurrency protection, observability, Unicode-safe identity, and behavior-parity KCC performance ship unflagged. `strategy-divergence-sweep` remains the staging observation/repair gate until the documented soak reports zero unresolved divergence. `strategy-trust-ladder-autosend` remains permanently OFF.

Flags are added to the catalog before consumers. Each flag requires OFF parity, a real loading-to-loaded test where client rendering is involved, a flag-ON browser/job smoke with realistic data, a dated removal target, and no autonomous production enablement.

## 6. Failure behavior and recovery

- **Provider timeout/error:** record provider, attempt, latency, and terminal reason. Preserve the prior artifact. Partial content uses `needs_attention` only when useful stages were durably retained by contract.
- **Malformed structured output:** one repair attempt, then fail without replacing the prior valid artifact.
- **Revision conflict:** newer durable state wins; no blind retry of paid generation.
- **Missing or stale authoritative evidence:** use the documented typed fallback and record the basis/confidence. Never silently substitute inferred intent/CPC as authoritative evidence.
- **Partial provider discovery failure:** retain successful sources, identify the missing source, and enforce the workflow call/credit budget.
- **Recompute failure:** do not enqueue dependent recommendation regeneration; expose stale freshness and retry through existing job policy.
- **Mirror divergence:** repair only from the authoritative recommendation lifecycle while preserving client-authored comments/responses; otherwise report and leave both records unchanged.
- **CI failure:** reproduce deterministic failures and fix them. Retry a suspected flaky job once; a repeat is treated as deterministic. No phase merges red.
- **Staging failure:** disable only the affected staging canary and ship a corrective PR before dependent work continues.

## 7. Success metrics and acceptance gates

Baseline metrics are captured before semantic canaries. Each run records workflow, run/job/artifact IDs, operation, provider/model, attempts, fallbacks, latency, input/output tokens, cache outcome, provider calls/credits, query count where budgeted, and terminal artifact status.

| Area | Required outcome |
|---|---|
| Integrity | Zero successful jobs with incomplete required artifacts; zero silent stale overwrites in concurrency tests |
| Cache correctness | Zero completed-response cache hits for explicit generation/regeneration; actual hit/miss accounting |
| Keyword evidence | 100% persisted-path survival for intent/CPC/source/provenance; 100% requested/voted prompt recall |
| KCC | `/initial` once per canonical first paint; subsequent search/filter/sort/page uses `/rows`; target 40–60% fewer read queries |
| Content efficiency | Target 30–50% fewer prompt input tokens with no completeness or first-pass acceptance regression |
| Convergence | Recommendation generation starts only after the latest successful intelligence generation it consumes |
| Observability | Every critical durable artifact joins to one generation run and named operation |
| Quality governance | Dedicated deterministic reliability/quality fixtures for keyword strategy, recommendations, Strategy POV, and content generation |
| Companion confidence | VPC exposes internal source/confidence and retains CPC fallback; scorecard hides evidence below 10 observations, labels 10–29 early, and treats 30+ as established |

Every PR runs targeted red/green tests plus typecheck, build, full Vitest, `pr-check`, hooks lint, feature-flag verification, and quick platform verification. User-facing flags additionally require real flag-ON staging smoke. Provider smoke is read-only and cost-capped.

## 8. Autonomous merge protocol and stop conditions

For each phase: branch from current staging, implement with exclusive ownership, review the complete diff, run gates, push a draft PR to `staging`, resolve actionable reviews, poll CI, rebase if staging advances, rerun gates, and squash-merge only when green. Verify staging health and phase-specific behavior before starting dependent work.

Autonomy pauses only for destructive migrations, missing paid-provider authority/credentials, an unresolved product-contract contradiction, repeated external CI infrastructure failure, production release/flag changes, or a fix that materially expands this specification.
