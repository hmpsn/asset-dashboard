# Generation Runtime Integrity

This rule governs durable AI-generated artifacts and the keyword/intelligence evidence that drives them. It applies across content, keyword strategy, recommendations, Strategy POV, and future generation workflows.

## 1. Completion must be truthful

A job is successful only when every required artifact component has passed its creation schema and was committed. Catching a provider error and inserting failure copy does not turn failure into content.

- Use strict creation schemas for generated artifacts; keep partial-edit schemas separate.
- Permit at most one bounded repair of malformed structured output.
- Do not replace a prior valid artifact when validation or repair fails.
- Persist a distinct attention/error state when useful partial work is intentionally retained.
- Do not emit success-semantic activity, broadcasts, notifications, or downstream jobs for partial or failed output. A committed partial/status mutation still broadcasts its canonical artifact/status-updated event so clients converge truthfully.
- The terminal job result, durable artifact/domain status, activity entry, and
  user-visible message must tell the same truth. If terminal bookkeeping itself
  fails after commit, any fallback result identifies that tracking failure and
  preserves the committed domain outcome.
- Commit the required artifact/domain transition, then persist and verify the
  terminal job state before optional success effects. Activity, broadcasts,
  cache invalidation, notifications, outcome tracking, reconciliation cleanup,
  and follow-on scheduling are each isolated effects: one failure cannot turn
  committed work into an HTTP/job failure or suppress the remaining effects.
  Retryable effects use durable idempotency/reconciliation keys rather than
  replaying the primary mutation.
- A terminal-job bookkeeping failure after artifact/domain commit is an explicit
  `completion_tracking_failed` outcome, not a generation failure. Never relabel
  or rewrite the committed artifact/domain result through a fallback failure
  path. Suppress optional completion effects until the durable terminal job state
  is verified. A manually managed worker releases resource claims idempotently
  only in its final drained cleanup, including when both terminal bookkeeping
  writes fail; claim release does not reclassify the committed outcome.
- When an external publish succeeds and the subsequent local
  version-conditional stamp loses, persist the external item identity and state in a
  reconciliation ledger. A retry reuses that item rather than creating a
  duplicate, and the platform does not claim locally reconciled publication
  until the conditional stamp succeeds. Post deletion is blocked while a
  resource-scoped post/publish job is active or an unresolved reconciliation
  exists; it becomes eligible only after the worker drains and reconciliation is
  resolved.
- External publish acceptance freezes the effective non-secret target/field-map
  configuration, a one-way token identity, and every source-artifact value used
  in the payload. Revalidate that authority before each external mutation and
  after external success. A partial local item stamp, a stamp from another
  collection, or unresolved identity in any collection fails closed; never
  create a second external item under a newly configured target.
- Every detached worker launch observes its outer promise rejection and logs it
  with job/resource identity. A durable terminal fallback does not make an
  unhandled rejected promise safe.

## 2. Long-running saves are version conditional

Any AI or provider call that occurs between reading and writing a durable artifact creates a race window. Snapshot the artifact revision before the call and make the final save conditional on that expected revision.

- Revisions are monotonic and increment for operator edits, lifecycle mutations, and generation commits.
- A version mismatch means the newer durable state wins.
- Automatic/background work never replaces an operator edit or client decision.
- Explicit replacement still uses a revision check; user intent does not authorize overwriting work created after the action began.
- Debounced editor writes bind their authority when the edit is authored, before
  the timer or flush enqueues it. A newer canonical token rejects the stale
  payload without rebasing it onto that token or issuing a write.
- A client suggestion's claimed original text is provenance-sensitive authority,
  not descriptive caller input. Compare it to the authoritative artifact inside
  the same revision-conditional boundary and reject a mismatch without appending
  a suggestion or advancing the revision.
- A retry may reuse already-generated output only after revalidating it against current authority. Never rerun a paid provider solely because the commit conflicted.
- An explicitly selected durable parent/request identity is command authority,
  never a best-effort reuse hint. If it is missing or belongs to another
  workspace, abort the whole mutation; do not fall back to another row or create
  a replacement.
- A one-time saved-artifact handle used by a durable send is consumed as the
  final synchronous authorization step inside that send transaction. A failed
  lifecycle, revision, link, or write leaves the handle available for a safe
  retry; post-commit notifications run only after both writes commit.
- When a request mutation advances linked artifact revisions, its established
  workspace event must invalidate both request readers and every linked
  brief/post authority cache on admin and client surfaces. Do not add a
  caller-specific duplicate artifact event as a substitute for the shared
  invalidation contract.
- Multi-table finalization and the revision comparison belong in one transaction.
- A dependent artifact adopts output only if its exact source generation
  revision still matches inside that transaction. One-time preparation-handle
  consumption, artifact creation, and any parent/link mutation are one atomic
  unit; validation, source conflict, or link failure rolls back both the handle
  deletion and every artifact write.
- When an external prepared flow will advance a parent lifecycle, prove that
  transition is legal before the caller performs paid work, repeat the check in
  the final authoritative preparation snapshot, and revalidate it inside atomic
  adoption. Later authority drift requires a fresh preparation, not a rebase of
  the old handle.

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

For a multi-call artifact, the top-level run/provider/model identify the accepted
execution that authorizes the adopted output. Store an `executionChainId` for
the logical workflow and an ordered bounded list of accepted contributing
executions, each with its exact effective-input fingerprint. The artifact-level
fingerprint is a canonical digest of those ordered fingerprints plus any
deterministic authority inputs. Rejected, malformed, or superseded attempts stay
in execution traces and must not be presented as adopted artifact provenance.

The fingerprint covers the exact rendered system and user inputs, excluding only an explicit force-refresh nonce. Join job traces, provider attempts, token/cost records, and the artifact through the run ID. Do not store raw prompts or secrets in telemetry. Provenance is internal unless a separate public contract explicitly exposes a safe projection.

When the server prepares context for prose generated outside the platform, it
can attest only to the exact server-prepared context and its lifecycle. The
preparation record therefore fingerprints that complete prepared context after
authority resolution, and adopted output records `provider: 'external'` and
`model: 'unreported'` with a server-issued external run ID and named external
operation. Never invent a provider or model from caller text. Consuming the
preparation record still follows the source-revision and atomic-adoption rules
above.

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
6. The artifact, job, AI call, and provider attempt share a run ID, or an
   external MCP artifact truthfully records `external`/`unreported` against the
   exact prepared-context fingerprint.
7. Source revision, suggestion-original identity, and parent-lifecycle legality
   are preflighted and revalidated;
   one-time handle consumption, artifact adoption, and parent/link updates are
   atomic where applicable.
8. Required artifact/domain completion is never relabeled when terminal-job
   bookkeeping fails; optional effects wait for a verified durable terminal, and
   manually managed claims release only after the worker drains.
9. External-success/local-conflict retries reuse retained identity, and deletion
   remains blocked during an active claim or unresolved reconciliation.
10. Flags cover only new semantics and include OFF/ON/retirement evidence.
11. Failure tests prove that the prior valid artifact and newer human state are preserved.

## 9. Structured page output is contract driven

Generated page structure that affects meaning or navigation must be explicit authority, not a prompt hint.

- A template block declares structured rendering (for example, a semantic table) and required internal linking in typed contracts before generation.
- Preserve semantic HTML through every sanitizer, adapter, revision, and persistence boundary. Audit the required structure after the final accepted revision; substantive text alone is not proof that a declared structure survived.
- Internal links come only from a bounded workspace-census-backed allowlist frozen during free preflight and included in the generation fingerprint. Reject external, unknown, duplicate, and target/self destinations before paid work.
- A declared internal-link block with fewer than its required verified anchors fails; zero links never pass vacuously. A revision may add or retarget anchors only within the frozen block allowlist.
- Heading freedom is resolved per block. Literal AEO/question headings remain locked; conversion-oriented blocks may generate branded headings while retaining the template text only as reference/fallback authority.
- An automatic prose revision uses the same homogeneous provider/model that produced the accepted prose. Mixed or missing prose provenance, provider unavailability, or disabled exact-model dispatch preserves the valid draft and yields an attention state instead of silently crossing models.
- Post-revision voice review explicitly covers grammatical person, reader address, register, tone boundaries, and anti-patterns in addition to lexical banned/required terms.
