# Generation Quality and Performance Pre-Plan Audit

**Date:** 2026-07-13  
**Status:** Verified pre-implementation evidence and approved delivery graph  
**Scope:** Keyword strategy and Keyword Command Center, Strategy POV and recommendations, content brief/post/copy generation, and shared AI execution/measurement infrastructure

## Purpose and decision boundary

This document records the evidence gathered by the four-lane multi-agent audit before implementation begins. It is a guardrail for the phase plans: implementers must solve the verified integrity and measurement gaps before attempting model or prompt experiments whose value cannot yet be measured.

The findings below distinguish:

- **Verified defect:** current code demonstrably loses authority, reports an incorrect state, risks overwriting a newer decision, or reports a metric it did not calculate.
- **Verified structural gap:** the platform has a strong mechanism, but the audited workflow does not consume it or lacks coverage/telemetry.
- **Measured hypothesis:** expected performance improvement that must be baselined and proven during the phase.
- **Deferred experiment:** potentially valuable quality work that must not be bundled into foundation phases.

No finding authorizes destructive migration, production flag changes, or bypassing the platform's intelligence, state-machine, job, evidence, or AI-operation contracts.

## Existing foundations to preserve

The audit found substantial architecture worth extending rather than replacing:

- `callAI()` is the provider-neutral server entry point, with a named operation registry and structured-output contracts. Provider helpers remain implementation details.
- Workspace Intelligence assembles requested slices in parallel, uses generation-aware single-flight caching, captures slice options in its cache key, and applies formatter token budgets. Generation paths already have shared content/recommendation context builders.
- Strategy POV is the reference implementation for effective-input fingerprints, explicit refresh authority, conditional saves, operator-edit preservation, and single-flight generation.
- Recommendation storage is normalized into `recommendation_items`; recommendation lifecycle has two-axis state, source allow-lists, carry-over, and explicit auto-resolution exemptions.
- Content research/evidence flows retain source snapshots, provenance-sensitive review items, human gates, Zod parsing, background jobs, cancellation, and version history in several subflows.
- Keyword synthesis already uses named structured operations, bounded page-assignment batches, deterministic fallback/backfill, caps, and precomputed comparator scores.
- Provider reads already have geo/language-aware caching and credit metrics in parts of the SEO provider layer.
- The reliability registry, quality fixtures, performance-budget registry, platform traces, and coverage ratchet provide useful enforcement shells. Their audited weakness is incomplete scope and runtime correlation, not absence.

## Verified findings

### A. Shared AI execution, observability, and governance

#### A1. Completed-response caching can replay an explicit regeneration — verified defect

`server/openai-helpers.ts` derives a request key and applies a five-minute completed-response cache to almost every request. Cache bypass is based on the literal feature values `content-brief` and `content-post`, while named operations include other generation/regeneration forms such as brief regeneration, post unification, and Strategy POV. A same-input explicit regenerate can therefore return the previous completed response rather than execute. Cancellable calls bypass sharing, and Anthropic does not implement equivalent completed-response behavior, so semantics also vary by provider.

Required direction:

- Put `none | inflight | ttl` cache policy on the named AI operation contract.
- Default unclassified mutation-sensitive generation to `inflight`, never completed-response TTL.
- Reserve TTL for explicitly safe deterministic reads/classifiers.
- Apply the same policy above both provider helpers and record operation-level hit/miss/inflight reuse.

Affected mechanisms/files: `server/ai.ts`, `server/ai-operation-registry.ts`, `server/openai-helpers.ts`, `server/anthropic-helpers.ts`, `server/ai-deduplication.ts`.

#### A2. Provider telemetry is asymmetric — verified structural gap

OpenAI execution measures duration and writes operation success/error traces with token data. Anthropic retries and logs token usage but does not capture equivalent duration or operation traces on success/failure. Fallback and provider comparison therefore cannot be evaluated consistently.

Required direction: emit provider-neutral operation/run ID, provider, model, attempt, retry delay, fallback, latency, tokens, cache result, and terminal failure without logging raw prompts or secrets.

#### A3. AI statistics report metrics they did not calculate — verified defects

- `server/routes/ai-stats.ts` labels an omitted `since` request as “last N days” but does not derive or pass the requested cutoff, returning all retained usage.
- Its cache hit rate is `cacheSize / (cacheSize + pendingRequests)`. Cache size is not hit count, and idle cache entries can report 100% hit rate.
- `AIRequestDeduplicator.getStats()` exposes size/age/pending state but no request/hit/miss counters, so the true rate cannot currently be calculated.

Required direction: derive the requested time window, persist/reset real counters with explicit denominator semantics, and distinguish inflight joins from completed-cache hits.

#### A4. Performance budgets are registry metadata, not runtime budgets — verified structural gap

`scripts/performance-budgets.ts` currently covers six workflows. Within this program only keyword strategy has an entry; KCC interactions, recommendation generation/recompute, Strategy POV, content brief, content post, and copy generation are absent. Verification validates registry metadata/evidence paths, but runtime code does not compare observed p50/p95 latency, AI/provider calls, token/cost totals, or query counts against these budgets.

`OperationTraceEntry`, job traces, and token-usage entries also lack one durable run/correlation identifier, preventing reliable joins from job → AI operation → provider attempt → artifact.

Required direction: introduce a generation run ID, add target workflows to the registry, record observed distributions, and make the verifier/report compare evidence to the declared budgets before considering release-block enforcement.

#### A5. Green reliability/quality reports omit critical audited workflows — verified coverage gap

The current reliability and quality pipeline IDs cover schema, brief review, SEO editor, client decisions, diagnostics, chats, and brand voice. They do not define dedicated pipelines for keyword-strategy generation, recommendation generation, Strategy POV, content post generation, or copy generation. SEO generation quantity fixtures are grouped under content-brief review. The reports can show 100% with these workflows absent.

Required direction:

- Register distinct critical pipeline IDs and runtime trace maps.
- Require every critical named AI operation to map to a reliability pipeline and performance budget.
- Add malformed/partial/provider-failure/concurrent-edit fixtures, not only happy-path and non-empty floors.

Affected files: `shared/types/ai-reliability.ts`, `scripts/ai-reliability-registry.ts`, AI quality and pipeline-wiring verifiers/tests.

#### A6. Durable generated artifacts lack a common provenance envelope — verified structural gap

Content briefs, generated posts, recommendation sets, and keyword strategy store creation time and selected domain evidence but do not consistently retain operation ID, provider/model, exact effective-input fingerprint, run ID, evidence timestamp, and artifact revision. Strategy POV demonstrates the desired fingerprint/version behavior but is a local exception.

Required direction: define an internal `GenerationProvenance` envelope and additive revision fields for durable artifacts as each owning phase adopts conditional saves. Keep provenance internal unless a separately approved client contract needs a safe projection.

### B. Keyword strategy and Keyword Command Center

#### K1. KCC pays first-paint hydration cost on table interactions — verified performance defect

The rebuilt Keywords surface follows search/filter/sort/page state with the `/initial` query. The initial-view service builds a source snapshot, summary, and rows serially. Summary adds geo, traffic value, topic-cluster, and cannibalization reads. A debounced search therefore recomputes data unrelated to the changed rows.

Required direction: `/initial` is canonical first paint only and seeds independent summary/row caches; subsequent table interaction calls `/rows` and keeps previous row data. Measure first-paint and interaction p50/p95 plus query counts. Target hypothesis: zero summary execution after first paint.

Affected files: `src/components/keywords-rebuilt/KeywordsSurface.tsx`, KCC hooks/API, `server/domains/keyword-command-center/initial-view-service.ts`, `summary-service.ts`.

#### K2. The KCC “skinny” source snapshot invokes the full strategy assembler — verified performance defect

`source-snapshot.ts` calls `assembleStoredKeywordStrategy()`, whose assembler reads full page models, content gaps, quick wins, keyword gaps, clusters, cannibalization, and metrics. KCC then repeats lite page-map, metrics, tracked-keyword/provenance, rank, lost-row, and count reads.

Required direction: create a KCC-owned projection selecting required columns once, derive counts/keys from loaded rows, and leave full detail to keyed detail reads. Target hypothesis: 40–60% fewer KCC queries/heap and detail latency independent of total universe size.

#### K3. Lite page reads discard authoritative search intent — verified quality defect

The full page-keyword row and write mapping include `search_intent`, but `listLiteByWs` omits it and its lite mapper cannot populate it. The KCC read model expects `page.searchIntent`; production therefore falls back to keyword-pattern inference even when stored authority exists. Fixture tests that inject page maps do not cover this adapter.

Required direction: select/map the stored field and add a persisted snapshot/rows integration test through the real lite adapter.

Affected files: `server/page-keywords.ts`, `server/domains/keyword-command-center/read-model.ts`, KCC integration tests.

#### K4. Candidate truncation occurs before requested/voted/priority preservation — verified quality defect

`buildClosedSetBlock()` filters declined candidates, sorts by volume, slices to 200, and only then annotates requested, votes, and priority. Low-volume client-requested, high-vote, local, or strategically high-fit candidates can be invisible to synthesis.

Required direction: build a mandatory requested/voted set, allocate source/intent/market diversity quotas, then fill remaining capacity by value ranking. Gate changed selection semantics per workspace and require 100% requested/voted prompt recall.

#### K5. Commercial evidence is dropped from the keyword pool and recommendation value — verified quality defect

`KeywordPoolCandidate` carries volume, difficulty, and source but not CPC/intent/provenance. Domain candidates enter the pool without CPC; enrichment accepts the pool hit and continues before the branch that could restore CPC. Recommendation opportunity input omits content-gap CPC. Known commercial evidence is replaced by generic proxies, distorting ranking and expected value.

Required direction: extend pool authority field-by-field, preserve CPC/intent/source/provenance through storage, and thread CPC into canonical Opportunity Value with real persisted-path coverage. Correct CPC remains fallback authority before `kwv-conversion-grounded-vpc` adds GA4 economics.

Affected files: `server/keyword-strategy-helpers.ts`, `keyword-strategy-universe.ts`, `keyword-strategy-enrichment.ts`, `server/domains/recommendations/strategy-producers.ts`.

#### K6. Provider discovery is unnecessarily serial and budget enforcement is local — verified performance gap

Competitor-domain collection awaits per domain, while suggestions, related terms, and questions are also sequential. The monthly ceiling is process-local and covers only parts of the provider plan.

Required direction: bounded concurrency of two or three, a unified durable provider-call plan/ledger, partial-failure semantics, and call/credit/cache/latency measurements. Do not increase paid-provider ceilings implicitly.

#### K7. Keyword normalization is ASCII-only — verified internationalization defect

The shared normalizer strips everything outside `[a-z0-9]`; non-Latin keywords can collapse to empty and accents collapse inconsistently. This belongs in the existing keyword-universe overhaul, not a parallel normalizer.

Required direction: Unicode NFKC plus Unicode letter/number preservation, with accented, non-Latin, punctuation, empty-result, and duplicate-equivalence fixtures.

#### K8. Rank freshness is discarded — verified trust gap

Rank reads resolve positions but discard snapshot dates; KCC rows use strategy generation time rather than rank observation time. Operators cannot distinguish a current rank from scheduler lag.

Required direction: carry `rankSnapshotDate`/age into the read model and render stale/unavailable truthfully.

#### K9. Keyword quality fixtures measure quantity more than relevance — verified coverage gap

Existing fixtures protect non-empty generation and deterministic fallback but do not score requested recall, source diversity, CPC/intent completeness, duplicate/cannibalization behavior, local/multilingual relevance, or ranked relevance.

Required direction: deterministic vertical/local/multilingual fixtures and metrics such as mandatory recall, authority-field completeness, source coverage, duplicate rate, and NDCG-style ordering. Semantic-fit model experiments remain deferred until deterministic failures demonstrate a need.

### C. Content brief, post, and copy generation

#### C1. Required-stage failures are persisted and announced as success — verified integrity defect

Content post generation catches introduction, section, and conclusion failures, inserts failure text, continues saving, unconditionally sets the post to `draft`, and lets the job emit generated activity/success. This creates a client/operator trust failure and contaminates downstream review.

Required direction: explicit `needs_attention`/partial terminal state, validation of required stages before `draft`, no success activity for partial artifacts, and stage-specific provider failure/timeout/cancellation tests.

Affected files: `server/content-posts.ts`, content post storage/types, background job/activity tests.

#### C2. Long AI saves can overwrite newer operator edits — verified concurrency defect

Post generation repeatedly saves a mutable whole-row snapshot after long calls without a version condition. Copy regeneration deletes/reinserts sections while preserving only selected metadata, resetting generated copy/status/quality/version. Copy generation records an initial version in steering but performs an unconditional final save.

Required direction: effective-input fingerprint plus artifact revision compare-and-swap. Concurrent operator edits win; background/automatic refresh never replaces edited or approved output; explicit replacement is required. Copy regeneration must preserve protected lifecycle/curation fields.

Affected files: `server/content-posts.ts`, `server/copy-review.ts`, `server/copy-generation.ts`, storage/migrations/types.

#### C3. Structured output schemas permit structurally empty artifacts — verified quality defect

The full brief schema makes the major fields optional and persistence falls back to empty strings/arrays. Copy output requires only one section; missing or unknown plan IDs can be ignored while the job succeeds.

Required direction: separate strict creation schemas from partial merge/update schemas, require exact section-plan census, attempt one bounded repair, then fail without durable mutation.

#### C4. Draft prompts repeatedly carry oversized SEO context — verified performance gap

`buildVoiceContext()` calls the detailed SEO prompt context, including page-map data, without a dedicated content token budget. The block is rebuilt/repeated for introduction, sections, conclusion, unification, and voice scoring.

Required direction: build one budgeted brief-relevant content context and pass smaller stage projections. Preserve exact-once voice DNA/guardrail injection. Target hypothesis: 30–50% fewer input tokens and 15–30% lower generation p95 without completeness/quality regression.

#### C5. External scraped text is not consistently treated as untrusted evidence — verified grounding gap

Raw scraped content is inserted into generation context while the existing untrusted-content wrapper is not used. Scrape failure can produce “no evidence” while prompts still require real PAA/SERP/difficulty/traffic claims.

Required direction: typed evidence envelopes, untrusted wrappers, observed-at/freshness metadata, deterministic observed fields, and explicit `unknown`/`needs_research` behavior when evidence is absent. Never let the model fill missing provider evidence as fact.

#### C6. High-value content stages are unnamed or registry metadata is stale — verified governance gap

Full brief, introduction, section, conclusion, and review calls are not consistently named operations; the creative wrapper hard-codes provider defaults, and some registry execution modes describe synchronous work now executed as jobs.

Required direction: name every high-value stage, validate actual execution mode, and attach reliability/quality/performance contracts.

#### C7. Job idempotency is both too broad and too weak — verified operational gap

Some brief/post active-job checks block every artifact in a workspace, while copy entry generation can enqueue duplicates for the same resource.

Required direction: resource-scoped job keys that dedupe the same artifact/action but allow unrelated workspace artifacts to progress.

#### C8. Voice DNA can be injected twice in AI fixes — verified quality/cost defect

At least one AI-fix path manually injects voice context and then uses system-prompt assembly that injects calibrated voice again.

Required direction: use the canonical voice authority helper and an exact-once prompt harness.

### D. Strategy POV and recommendations

#### S1. Recommendation generation has a stale-read/destructive-write window — verified concurrency defect

Generation reads existing recommendations and lifecycle state, performs expensive assembly, finalizes against the snapshot, then `saveRecommendations()` deletes and reinserts all normalized rows without a revision condition. A send, strike, edit, or client action during generation can be overwritten.

Required direction: set revision/provenance compare-and-swap. On the first conflict, re-finalize already-generated candidates against the latest lifecycle state and retry once without rerunning paid providers. A second conflict fails safely.

Affected files: `server/domains/recommendations/generation-service.ts`, `finalization.ts`, `storage.ts`, recommendation set types/migration.

#### S2. Intelligence recompute and recommendation regeneration are not ordered — verified freshness defect

Intelligence recompute broadcasts new insight state but does not own the dependent recommendation regeneration. Keyword follow-ons can schedule both independently, allowing recommendations to regenerate from the previous insight set.

Required direction: explicit workflow `source mutation → intelligence recompute → debounced recommendation regeneration → freshness broadcast`, using existing job dedupe/rate controls.

#### S3. Source identity and resolution semantics have lifecycle holes — verified integrity gaps

Audit cases found that:

- Resolved signals can remain active or remint an equivalent recommendation.
- Content-gap identity can fall back to generated wording instead of normalized target keyword.
- A suppressed cannibalization issue can preserve unrelated old recommendations when suppression/failure is tracked at category granularity.
- No-traffic quick-win priority caps can be overwritten by the final Opportunity Value pass.
- Strategy deliverable/inbox divergence is reported but not repaired.

Required direction: normalized source identities, source-resolution retirement tests, merge-key-local suppression, final score invariants that preserve evidence caps, and bounded reconciliation with lifecycle state authoritative while preserving client-authored conversation data.

#### S4. Outcome learning applies material adjustments with too little confidence — verified model-policy gap

The current learning path can apply a meaningful score adjustment after a very small sample. Availability is centralized correctly, but sample size/confidence are not strong enough for client justification or aggressive automatic ranking changes.

Required direction: confidence-aware shrinkage and shared thresholds. Client outcome evidence should be hidden below 10 observations, labeled early at 10–29, and treated as established at 30+, using the same confidence authority for scoring and copy.

#### S5. Some folded signals bypass canonical Opportunity Value — verified consistency gap

Not all recommendation producers route scoreable signals through the same value components, so downstream order and client-safe gain framing can diverge.

Required direction: consume canonical resolved value components or explicitly document why a deterministic non-value policy applies; do not create a parallel value model.

#### S6. Strategy POV is the positive reference, not a rewrite target

POV already fingerprints the effective prompt, preserves operator overrides, has explicit refresh semantics, uses version-conditional persistence, and guards in-flight generation. The program should reuse its contracts for other artifacts and only add shared run telemetry/operation coverage where absent.

## Approved delivery and parallelization graph

Each node is one PR into `staging`. Independent sibling PRs use isolated worktrees and exclusive file ownership. Merges are serialized; after each merge every open sibling rebases on current `origin/staging` and reruns gates.

```text
Program-control guardrails
  ├── G1 AI execution governance ───────────────┐
  └── K1 Keyword evidence integrity ─────────┐  │
                                             │  │
G1 + K1 ── Wave 2 parallel ──────────────────┼──┼─────────────────────────┐
  ├── C1 Truthful content generation         │  │                         │
  ├── S1 Recommendation concurrency          │  │                         │
  ├── K2 KCC read-path performance           │  │                         │
  └── K3 Unicode normalization               │  │                         │
                                             │  │                         │
C1 ──> C2 Content edit safety/provenance ──> C3 Content context/evidence │
S1 ──> S2 Recommendation lifecycle ────────> S3 Ordered convergence      │
K1 ──> K4 Candidate recall/diversity                                     │
G1 + C2 + S2 ──> O1 Runtime quality governance <─────────────────────────┘
G1 + O1 ──> K5 Provider performance

K1 + O1 ──> V1 conversion-grounded VPC
K1 + K2 ──> V2 intent portfolio rollup
S2 + O1 ──> V3 confidence-aware outcome evidence
V1 ───────> V4 internal-link value priority
```

### Phase definitions

1. **Wave 0 — program control:** audit, feature spec, cross-phase contracts, acceptance checklists, roadmap rescope. No implementation before guardrails merge.
2. **Wave 1 — roots, parallel:** G1 operation cache/telemetry policy; K1 intent/CPC/provenance preservation.
3. **Wave 2 — integrity/performance, parallel:** C1 truthful content terminal states; S1 recommendation CAS; K2 KCC projection/cache split; K3 Unicode normalization.
4. **Wave 3 — durable safety:** C2 content revision/provenance; S2 recommendation lifecycle reconciliation; K4 candidate recall/diversity.
5. **Wave 4 — convergence/measurement:** C3 budgeted content context/evidence; S3 ordered recompute; O1 runtime budgets/reliability; K5 bounded provider concurrency.
6. **Wave 5 — roadmap companions, parallel:** V1 `kwv-conversion-grounded-vpc`; V2 `kwv-intent-branded-split`; V3 `cda-sc5-outcome-scorecard` confidence grounding.
7. **Wave 6 — downstream value:** V4 `kwv-internal-linking-value-priority` after value authority stabilizes.

### Feature-flag boundary

Correctness, concurrency, observability, authoritative-field restoration, and behavior-parity read performance ship unflagged. New behavior flags are limited to:

- `keyword-synthesis-candidate-recall` — server/per-workspace, default OFF.
- `content-generation-context-v2` — server/per-workspace, default OFF.
- `conversion-grounded-vpc` — server/per-workspace, default OFF.

Do not resurrect retired keyword-hub, keyword-universe-full, or signal-auto-recompute flags. Keep the permanent strategy autosend safety gate OFF. Any new user-facing flag requires a real loading→loaded component test and flag-ON browser smoke with realistic data before rollout.

## Coverage and acceptance gaps to close by phase

- **Content:** required-stage failure, malformed/partial structured output, repair exhaustion, timeout/cancel, duplicate job, concurrent edit, explicit replacement, and no false success activity.
- **Recommendations:** concurrent send/strike/edit/client action, first/second CAS conflict, resolved-source retirement, stable identity, suppression locality, score-cap preservation, and mirror repair without losing conversation data.
- **Keywords:** persisted intent/CPC propagation, mandatory candidate recall, diversity, multilingual normalization, provider partial failure/cost ceiling, and rank freshness.
- **KCC:** `/initial` once, `/rows` thereafter, independent cache invalidation, bounded query counts, stable detail latency, and mobile/error/empty browser smoke.
- **AI infrastructure:** provider parity, explicit operation cache policies, real hit-rate denominators, run correlation, accurate time windows, safe logging, and observed budget reports.
- **Quality evaluation:** deterministic relevance/authority/completeness metrics before subjective live-model scoring; every critical operation mapped to a pipeline, budget, and trace.

Every PR must run focused red→green tests, full typecheck/build, relevant domain suites, `pr-check`, hooks lint, feature-flag verification, and quick platform verification. Provider smoke remains read-only and cost-capped. CI failures are reproduced and fixed; a suspected flaky job may be retried once, but a repeated failure is investigated rather than waived.

## Deferred experiments and explicit non-goals

Do not bundle these into foundation PRs:

- Single-pass versus current layered Opportunity Value compression; shadow-score and calibrate first.
- Semantic-fit model scoring until deterministic fixtures show lexical/rule safeguards are insufficient.
- Content style variants until provenance plus edit/selection/outcome telemetry demonstrates repeatable preference.
- Predictive seasonality until durable series, provider cost, and enough history exist.
- Increased provider spend or concurrency beyond documented ceilings.
- Cross-tenant outcome claims, automatic production flag changes, or autonomous `staging → main` promotion.

The program's order is intentional: make artifacts truthful and edit-safe first, preserve authoritative inputs second, remove measurable waste third, then use trustworthy telemetry to justify smarter scoring and generation experiments.
