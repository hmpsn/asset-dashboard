# Generation Quality and Performance Program — Cross-Phase Contracts

> These contracts prevent parallel phases from inventing incompatible execution metadata, freshness semantics, identities, cache behavior, or feature flags. The controller updates this document in the same commit as any approved contract amendment.

## Program Invariants

- PR #1520 is complete at `730c1eb62`; all branches start from current `origin/staging`.
- Retired `keyword-hub`, `keyword-universe-full`, and `signal-auto-recompute` flags never return. Existing permanent safety gates remain intact.
- Durable AI writes are truthful, version-conditional, and attributable to an execution run. Automatic generation never overwrites newer operator/client state.
- Authoritative evidence is preserved field-by-field; unknown data stays unknown. No downstream consumer reconstructs CPC, intent, identity, freshness, or confidence from display text.
- Existing public/client payloads remain compatible. Internal provenance is not serialized publicly unless a later approved contract explicitly opts in.
- Operation cache behavior is declared centrally. Explicit generation/regeneration is never served from a completed-response cache.

## Shared Contract Shapes

Names below are the required semantic contracts; the shared-contract task must reconcile exact placement with current source and barrels before implementer dispatch.

### AI execution policy

- `AIExecutionPolicy.cache`: discriminated union of `none`, `inflight`, or `ttl` with an explicit positive TTL.
- `AIExecutionMetadata`: `runId`, named `operation`, provider, model, attempts, fallback-used, cache outcome, start/completion timestamps, duration, and token usage where supplied.
- Existing `callAI(opts): Promise<AICallResult>` remains source-compatible. New durable generators use a metadata-returning dispatcher path or backward-compatible metadata extension; provider helpers remain dispatcher implementation details.
- Traces store identifiers and measurements, never raw prompts, generated content, secrets, or provider credentials.

### Durable generation provenance

- `GenerationProvenance`: run ID, named operation, provider/model, canonical effective-input fingerprint, evidence captured/observed time where applicable, and generation start/completion times.
- `generationRevision`: monotonic artifact revision used in compare-and-swap saves; it is distinct from the input fingerprint and provider retry count.
- A force-refresh nonce may bypass caches but never becomes the persisted canonical fingerprint.
- A successful conditional save records execution metadata and increments revision atomically. A stale save changes nothing and returns an explicit conflict result.

### Evidence and confidence

- Keyword candidates preserve independent optional fields for volume, difficulty, CPC, intent, source, provenance, and evidence time; merging one field never erases another authoritative field.
- Conversion-grounded value exposes an internal source (`conversion` or corrected `cpc_fallback`) and confidence; client copy consumes resolved safe bands, not raw precision.
- Outcome confidence uses one workspace-scoped observation count rule: fewer than 10 hidden, 10–29 early evidence, 30+ established.
- External scraped evidence is marked untrusted and carries observed-at/freshness. Absence renders unknown/needs-research and cannot authorize fabricated facts.

## Phase Exports and Consumers

### G1 exports

- Central operation cache policy and named-operation registration.
- Metadata-returning AI execution path and provider-neutral trace fields.
- Real cache hit/miss counters and run IDs.

**Consumed by:** C1–C3, S1–S3, K5, O1, and later durable AI generators. Consumers import; they do not call provider helpers or build local caches/traces.

### K1 exports

- Persisted lightweight page reads with authoritative `searchIntent`.
- Keyword pool/strategy fields that retain CPC, intent, source, and provenance.
- Corrected CPC value available to canonical Opportunity Value.

**Consumed by:** K2/K4, S2 recommendation producers, V1 conversion fallback, V2 intent mix, and V4 internal-link priority.

### C1 exports

- Strict create-output validation and exact planned-section completeness.
- Generated-post lifecycle includes `needs_attention` with legal transitions and honest activity/job outcomes.

**Consumed by:** C2 conditional saves and C3 context-v2 quality acceptance. Later phases do not weaken creation schemas to accommodate partial provider output.

### S1 exports

- Version-conditional recommendation-set commit with an explicit conflict result.
- One bounded re-finalization retry over already-generated candidates.

**Consumed by:** S2 lifecycle reconciliation and S3 convergence. No consumer repeats a paid generation merely to resolve a commit race.

### K2 exports

- First-paint initial view plus independently cacheable summary and row read models.
- Authoritative rank snapshot timestamp/age.

**Consumed by:** V2 presentation. UI interactions use rows-only reads and existing workspace-scoped invalidation.

### K3 exports

- K3a: a persisted-identity census, deterministic v2 equivalence policy, collision rules, and a ban on mutating raw provider/display values.
- K3b: versioned v1/v2 identity helpers, additive dual-read/dual-write compatibility, collision-safe backfill, and legacy aliases for identities whose raw spelling is unrecoverable.
- K3c: one canonical Unicode-safe keyword normalizer after staging verifies the additive backfill.

**Consumed by:** K4 selection identities and any touched keyword producer. No phase introduces an independent normalization implementation or removes legacy aliases without a separate verified retirement PR.

### C2 exports

- Content artifact `generationRevision`, internal `GenerationProvenance`, conditional-save behavior, and resource-scoped job identity.

**Consumed by:** C3. Context-v2 generation must persist its own effective-input fingerprint through this contract and preserve newer edits.

### S2 exports

- Recommendation-set provenance/revision, stable normalized producer identity, resolved-source retirement, local suppression, priority preservation, and bounded mirror repair.

**Consumed by:** S3, V3, and V4. Recommendation lifecycle remains authoritative; client comments/responses remain preserved mirror data.

### K4 exports

- Flagged deterministic candidate-selection policy with requested/voted mandatory inclusion, diversity quotas, value-ranked fill, and a hard prompt cap.

**Consumed by:** keyword synthesis only. The flag does not gate K1 evidence correctness or K3 normalization.

### C3 exports

- Flagged budgeted content context, stage projections, exact-once voice/guardrail assembly, and typed evidence freshness.

**Consumed by:** content generation operations. The OFF path remains current behavior until staging quality/token evidence authorizes promotion.

### S3 exports

- Ordered job dependency: intelligence success precedes debounced recommendation regeneration; freshness broadcasts only after terminal state.

**Consumed by:** recommendation/UI cache consumers through existing canonical workspace events. `signal-auto-recompute` is not recreated.

### O1 exports

- Run-correlated runtime observations and workflow budgets.
- Critical reliability/quality pipeline mappings for keyword strategy, recommendations, Strategy POV, and content generation.

**Consumed by:** K5 performance evidence, V1 calibration, V3 confidence reporting, later experiments, and release decisions.

### V1–V4 exports

- V1 exports resolved value, source, and confidence with corrected CPC fallback.
- V2 exports presentation-only authoritative intent mix.
- V3 exports workspace-only outcome confidence and honest client-safe evidence labels.
- V4 consumes canonical resolved inputs and exports deterministic internal-link priority; it does not create a new value model.

## Persistence and Compatibility

- Content and recommendation migrations are additive. Migration number is allocated only from current staging immediately before its PR.
- Migration, DB row type, mapper, write path, Zod validation, archive twin where applicable, and internal/admin serialization move in lockstep.
- Internal provenance fields are optional for legacy rows and required on newly successful generation after the owning phase ships. Reads degrade legacy rows to “provenance unavailable,” never fabricated metadata.
- Compare-and-swap updates occur in the same transaction as artifact content/status and provenance. Conflict paths do not partially update activity, mirror, or generation metadata.
- No destructive table drops are authorized by this program.

## Feature-Flag Contracts

Only these new flags are authorized:

| Flag | Scope | Default | Gates | Does not gate |
|---|---|---|---|---|
| `keyword-synthesis-candidate-recall` | server, per workspace | OFF | candidate inclusion/order semantics | evidence-field correctness or normalization |
| `content-generation-context-v2` | server, per workspace | OFF | context/prompt projection semantics | truthful status, validation, CAS safety |
| `conversion-grounded-vpc` | server, per workspace | OFF | GA4-grounded value resolution | corrected CPC fallback plumbing |

Each catalog entry has owner, purpose, rollout and dated retirement target; its PR includes OFF parity and ON real-path tests. Client UI must not assume a per-workspace server override reaches global `useFeatureFlag`. Production flag changes and flag retirement are outside autonomous authority.

The existing `strategy-divergence-sweep` gate may protect S2 repair during staging observation. It is not renamed or duplicated. Permanent safety-gate behavior remains unchanged.

## Job, Event, and Cache Contracts

- Long AI/provider workflows use the background-job platform. Resource identity participates in dedupe; unrelated resources in one workspace may run concurrently.
- S3 owns ordering between intelligence and recommendation jobs. Other phases must not enqueue an independent competing follow-on.
- Mutations broadcast canonical events only after committed durable state. Every workspace event has an existing/new `useWorkspaceEvents` invalidation for the owning query keys.
- KCC `/initial` seeds summary/row caches; subsequent interaction reads rows only. Workspace mutation invalidates both without forcing summary work for local table controls.
- AI execution caches and workspace-intelligence caches remain separate: operation cache policy never substitutes for intelligence generation-aware invalidation.

## Cross-Phase Failure Semantics

- Provider or schema failure before a durable commit records a failed job/trace and leaves prior durable data intact.
- On initial content generation, a required-stage failure may persist an explicitly `needs_attention` artifact only when useful stages and structured diagnostics are retained; it emits the canonical status update but never records or broadcasts success. On regeneration, preserve the prior valid artifact and attach diagnostics to the failed run/job.
- A stale revision returns a conflict; automatic paths preserve the newer durable artifact. One recommendation re-finalization retry is allowed; content does not silently retry over an edit.
- Partial keyword-provider failure preserves successful evidence with source-specific failure metadata and deterministic ordering; it never converts unknown values to zero.
- Missing/stale evidence lowers availability/confidence or yields unknown; it does not cause stronger claims.

## Contract Verification

Each consuming PR must include focused assertions for its imported contracts plus the program gates. The controller additionally verifies:

- every critical named AI operation maps to an execution policy, reliability pipeline, and workflow budget;
- no imports bypass `callAI` for provider helpers;
- no duplicate generation provenance, confidence, keyword normalization, or Opportunity Value types/helpers were introduced;
- no retired flag literal exists in active catalogs or read sites;
- public serializers omit internal provenance and preserve backward compatibility;
- concurrent-write tests prove zero partial commits and correct activity/broadcast behavior;
- feature-flag OFF parity and workspace-aware ON behavior are exercised through the real read/generation path.

Any amendment that changes a field, status, cache default, identity, flag boundary, event, or job ordering must update this document and all dependent unmerged plans/branches before implementation continues.
