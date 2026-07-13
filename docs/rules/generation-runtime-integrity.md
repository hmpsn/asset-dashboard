# Generation Runtime Integrity

This rule governs durable AI-generated artifacts and the keyword/intelligence evidence that drives them. It applies across content, keyword strategy, recommendations, Strategy POV, and future generation workflows.

## 1. Completion must be truthful

A job is successful only when every required artifact component has passed its creation schema and was committed. Catching a provider error and inserting failure copy does not turn failure into content.

- Use strict creation schemas for generated artifacts; keep partial-edit schemas separate.
- Permit at most one bounded repair of malformed structured output.
- Do not replace a prior valid artifact when validation or repair fails.
- Persist a distinct attention/error state when useful partial work is intentionally retained.
- Do not emit success-semantic activity, broadcasts, notifications, or downstream jobs for partial or failed output. A committed partial/status mutation still broadcasts its canonical artifact/status-updated event so clients converge truthfully.
- The terminal job result, durable artifact status, activity entry, and user-visible message must agree.

## 2. Long-running saves are version conditional

Any AI or provider call that occurs between reading and writing a durable artifact creates a race window. Snapshot the artifact revision before the call and make the final save conditional on that expected revision.

- Revisions are monotonic and increment for operator edits, lifecycle mutations, and generation commits.
- A version mismatch means the newer durable state wins.
- Automatic/background work never replaces an operator edit or client decision.
- Explicit replacement still uses a revision check; user intent does not authorize overwriting work created after the action began.
- A retry may reuse already-generated output only after revalidating it against current authority. Never rerun a paid provider solely because the commit conflicted.
- Multi-table finalization and the revision comparison belong in one transaction.

## 3. Cache policy belongs to the named operation

AI caching is an execution contract, not a provider-helper heuristic or feature-string exception.

Every named operation declares one policy:

- `none` — neither in-flight coalescing nor completed-response caching;
- `inflight` — identical concurrent requests may share work, but completion is not replayed;
- `ttl` — completed responses may be reused for an explicit positive TTL.

Generation and regeneration default to `inflight`. `ttl` is opt-in and requires a cache-safety test proving that replay cannot suppress an explicit user action, use stale authority, or bypass a mutation. Apply the same policy across providers. Record actual hits, misses, coalesces, and evictions; cache size is not a hit rate.

## 4. Authoritative evidence must survive every boundary

When a producer supplies authoritative intent, CPC/value, source, provenance, freshness, or rank time, adapters and scoring stages must preserve it. Never silently replace known evidence with a heuristic because an intermediate type or SELECT omitted the field.

- Define evidence fields in shared typed contracts before wiring consumers.
- Update storage selection, row mapper, pool/candidate type, merge rules, persisted artifact, scorer, and serializer together where applicable.
- Merge evidence field-by-field; a partial source must not erase stronger existing fields.
- Mark heuristic fallbacks with their basis and lower confidence.
- Test the real persisted read path, not only hand-built in-memory fixtures.
- Requested/client-directed evidence is mandatory before prompt caps or sampling.

## 5. Dependent recompute is ordered

Systems that consume regenerated intelligence must not start independently from the producer they depend on.

The required sequence is:

`source mutation → intelligence recompute succeeds → dependent generation is debounced/enqueued → freshness broadcast`

- A failed producer does not trigger its dependent generator.
- Dedupe keys are resource scoped and preserve unrelated workspace concurrency.
- The consumer records the producer generation/version it used.
- Reads and UI expose stale/refreshing state until convergence completes.
- Broadcast only after the corresponding durable transition commits.
- Do not use timers or parallel fire-and-forget scheduling as a substitute for dependency order.

## 6. Adopted durable artifacts carry run provenance

Every durable generated artifact brought under this contract by its owning implementation phase must be attributable to the exact effective generation run. Content posts, content briefs, copy sections, recommendation sets, keyword strategy, and Strategy POV are the required adoption census for the current program; a phase may not claim closure until its assigned artifacts comply. Store typed provenance containing:

- run ID and named operation;
- provider and model;
- canonical effective-input fingerprint after authority resolution;
- evidence captured/freshness time when evidence is used;
- generation start and completion times.

The fingerprint covers the exact rendered system and user inputs, excluding only an explicit force-refresh nonce. Join job traces, provider attempts, token/cost records, and the artifact through the run ID. Do not store raw prompts or secrets in telemetry. Provenance is internal unless a separate public contract explicitly exposes a safe projection.

## 7. Feature flags protect semantics, not correctness

Flag a generation change when it changes ranking, selection, evidence interpretation, or generated-output semantics. Do not flag correctness fixes, stale-write protection, observability, or behavior-parity performance work.

- Add the catalog entry before the first consumer.
- Default new semantic flags OFF and prefer server-side per-workspace canaries.
- Keep OFF behavior byte/contract compatible unless the specification explicitly changes it.
- Test OFF parity, ON behavior, failure behavior, and real loading-to-loaded transitions where rendering is involved.
- Run a realistic flag-ON staging smoke before promotion.
- Give every non-safety flag a dated retirement target; retirement deletes the OFF branch and follows the full flag lifecycle checklist.
- Never resurrect a retired flag to avoid defining the correct new boundary.
- Agents may enable staging canaries under the approved phase contract; production flag changes require owner approval.

## 8. Review checklist

Before merging generation work, reviewers confirm:

1. Required output completeness and terminal status agree.
2. The final save is revision conditional.
3. The named operation has an explicit safe cache policy.
4. Authoritative evidence survives its real storage/read/scoring path.
5. Dependent recompute ordering is durable and observable.
6. The artifact, job, AI call, and provider attempt share a run ID.
7. Flags cover only new semantics and include OFF/ON/retirement evidence.
8. Failure tests prove that the prior valid artifact and newer human state are preserved.
