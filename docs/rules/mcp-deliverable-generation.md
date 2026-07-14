# MCP Deliverable Generation

This rule governs MCP-triggered generation of durable content and brand
deliverables, especially multi-item runs. It complements
`generation-runtime-integrity.md`, `content-quality-grounding.md`,
`background-generation.md`, and `brand-engine.md`.

## 1. Address the durable source, never a display value

- A matrix page target is identified by `(workspaceId, matrixId, cellId)`.
  Keyword equality is not an identity and must never select a cell.
- A brand generation target is identified by a durable intake revision and an
  explicit deliverable type or bundle.
- Every start request includes the expected source revision and a caller
  idempotency key. A stale revision fails before paid work begins.
- The run snapshots source identity, resolved inputs, and the effective-input
  fingerprint. Later source edits make the run stale; they do not silently
  change work already in flight.
- Batch starts carry one full source-revision envelope per item. Generation-
  owned projection for one item must not advance a shared definition revision
  and falsely stale its siblings.
- Before any JSON-backed matrix/template mutation reserializes a whole stored
  array or object, compare the raw persisted census with the validated hydrated
  shape inside the same transaction. Missing/dropped/normalized fields fail
  closed; an unrelated rename or cell edit must never erase a corrupt sibling.
- When a matrix definition edit changes a matched cell's effective template,
  rendered URL, keyword, variables, or schema target, preserve only its explicit
  keyword-research inputs and reset lifecycle, review flags, history, and linked
  brief/post IDs to `planned`. Never relabel an old published artifact as the
  newly rendered target.
- External URL discovery happens before the authoritative matrix/template/cell
  snapshot, or the source is re-read and CAS-checked after discovery. No awaited
  network work may sit between the final source snapshot and structural resolve.

## 2. Preflight before paid work

Preflight is deterministic and side-effect free. Structural preflight resolves
source identity, source revisions, templates, variables, URLs, page types, and
the complete rendered block manifest without needing voice or AI context.
Generation-ready preview additionally freezes the effective voice, identity,
evidence, artifact revision, selection, and paid-work estimate. It must finish
before any AI or paid-provider call.

The evidence policy is typed per requirement:

- `preflight` requirements block paid generation. They include verified service
  availability, substantive location relevance for a location target, source
  identity, supported page type/template shape, and finalized voice for content
  generation.
- `ready` requirements may render the canonical typed placeholder and produce a
  `needs_attention` draft, but they block `ready_for_human_review`, client send,
  and `ready_to_publish`. Typical examples are required hours, pricing, staff,
  credentials, statistics, or CTA contact details.
- `optional_omit` requirements are omitted cleanly. They never invite invented
  copy or a placeholder that the page does not need.

The voice-foundation bootstrap is the only voice exception: it may generate a
provisional foundation from accepted intake without an already-finalized voice
profile. Missing authentic samples remain a typed `ready` requirement: the
foundation may be preserved as `needs_attention`, but it cannot become voice
authority. The workflow pauses at `awaiting_voice_finalization` until an
operator supplies/selects authentic anchors and finalizes a later immutable
voice version; no dependent brand or content generation may run first.

Preview returns the selected item count, blockers, placeholder-eligible gaps,
estimated paid calls/tokens/cost, and an effective-input fingerprint. Start must
present that fingerprint so the approved selection cannot drift before dispatch.
A paid run selection is a non-empty tuple of previewed cells and every selection
has a non-null preview fingerprint; a looser pre-preview onboarding selection is
never sufficient to dispatch paid work.

## 3. Structure is code; prose is generated

- URL, keyword, title, metadata, and section templates are rendered by one
  canonical deterministic renderer with separate slug and prose modes.
- A locked template means the complete ordered `ResolvedPageBlockManifest`,
  including system-owned introduction/conclusion blocks and every template-
  owned block. The AI may not add, remove, rename, or reorder blocks.
- New templates declare a `generationContractVersion` and explicit generation
  roles. A legacy template is never silently upgraded: structural preflight
  returns a deterministic upgrade proposal, an operator explicitly accepts and
  saves it through a version-conditional mutation, and ambiguous AEO/CTA roles
  or unsupported page types remain blocked.
- Keyword-position, AEO, CTA, schema, and page-type policies are typed inputs and
  typed audit rules, not suggestions hidden only in prompt prose.
- Matrix dimension values are targeting labels, not evidence. A `location`
  value does not prove an office, service area, landmark relationship, review,
  license, availability, or local experience.
- Planned-URL collision checks use a complete authoritative path census: durable
  analysis paths, exact published-post paths, every other matrix cell, fresh
  Webflow pages, and the complete same-site sitemap (including CMS items).
  Discovery failure, stale fallback data, malformed URL identities, and bare CMS
  slugs that cannot resolve to exactly one sitemap path all block preflight.
  Collision equality is exact canonical path equality, never leaf-slug equality
  across unrelated directories.

## 4. Evidence and placeholder honesty

- Factual claims require durable evidence references. Creative proposals such
  as names and taglines are labeled as proposals, never verified facts.
- Evidence requirements declare `claimKind`. Factual refs exclude the
  structural-only matrix, matrix-cell, and template source classes; normalized
  cell evidence remains eligible. A targeting label cannot type-check as proof.
- Missing `ready` facts remain typed unresolved requirements and render with the
  canonical token `[NEEDS CLIENT INPUT: ...]`. The token is a presentation of
  structured state, not the only detection mechanism. `preflight` gaps block
  generation; `optional_omit` gaps are omitted.
- Unresolved `ready` requirements prevent a ready verdict, client send, and the
  later `ready_to_publish` state.
- A requirement is resolved only by a version-safe domain mutation that attaches
  a typed value and durable source/evidence reference to the owning authority.
  Deleting or replacing placeholder text in an artifact never clears structured
  requirement state. Immutable brand intake resolution creates a superseding
  intake revision; matrix-cell resolution persists in a normalized context-owned
  evidence store and advances that cell's source revision. Both require a fresh
  preview/audit before readiness can change. Content evidence resolution is
  cell-scoped and does not require a run/item, because `preflight` evidence can
  block before any run exists.
- Brand-intake requirement identity is `brand-intake:<fieldPath>`. Shared
  schemas validate the finite field path, the value kind assigned to that
  field, and the exact requirement/field pairing before any adapter reaches the
  domain service.
- The immutable intake evidence array has both a 22-field census and a 1 MiB
  UTF-8 aggregate bound enforced in shared validation and storage. Per-item
  validity alone is insufficient because every individually legal resolution
  must still fit the accumulated revision snapshot.
- Brand-intake normalization must preserve evidence intent: an omitted buying
  stage is the durable empty sentinel, while `mixed` is the explicit “All
  stages” answer. Do not use a valid answer as a missing-value default.
- Brand-intake replay identity includes submission provenance. Reuse an
  identical revision only for the same source, actor type, and actor ID;
  otherwise persist the confirmation as a successor. Enforce the exact source
  pairs client_portal/client, admin/operator, mcp/mcp, migration/system before
  activity classification.
- Brand-intake compatibility projection snapshots competitor ownership as
  disjoint preserved/manual and intake-owned sets on every immutable revision.
  Later projection may remove only intake-owned domains; overlap with submitted
  payload text is not provenance.
- Rendered factual and inferred claims both require non-empty, fact-capable,
  non-structural accepted evidence. Factual accuracy remains human-review-
  required for either classification. No-hallucination review remains human-
  required for every generated candidate because an AI-authored claim ledger
  cannot prove that it contains every assertion in the prose; AI review never
  auto-passes provenance-sensitive items.
- Local and service page sets require cell-specific grounded value. Pure
  variable substitution cannot pass the substantive-uniqueness audit.

## 5. Voice has one authority

- Authentic client-supplied examples and approved source material outrank
  generated prose as voice evidence. Authentic source refs exclude generated
  deliverables/profiles and structural matrix/template/intelligence sources;
  finalized anchors record the selecting operator and timestamp. When the ref
  addresses a `voice_sample`, its origin is exactly `manual` or
  `transcript_extraction`; calibration-loop and generated approval samples are
  ineligible.
- A generated voice foundation is provisional until explicitly finalized.
  Finalization requires non-empty DNA, guardrails, and selected authentic anchor
  evidence and records the finalizing operator. A brand-suite run pauses at this gate; provisional voice cannot
  drive dependent identity, messaging, or content generation.
- `BrandGenerationAtomicTarget` is exactly
  `'voice_foundation' | BrandDeliverableType`; the provisional foundation lives
  only in the run item/attempt ledger and is never persisted as a
  `BrandDeliverable`. Const-owned completeness maps classify atomic brand
  targets separately from orchestration presets. `voice_foundation` is the sole
  atomic `bootstrap` target; every durable deliverable requires the exact
  finalized voice version.
  `full_brand_system` is the sole `bootstrap_then_resume` preset: its initial
  start may create only the foundation, and dependents remain forbidden until
  the finalized-version resume. Other presets require finalized voice at start.
- Persisted selection/dispatch shapes preserve the same invariant: an atomic
  foundation run has only the foundation target, and its item cannot carry a
  durable brand-deliverable ID or version.
- Downstream generation uses one immutable voice snapshot for an entire run and
  injects it exactly once through the canonical prompt assembly path.
- Only approved brand identity enters downstream page generation, selected by
  an explicit page-type allow-list. Never dump every brand deliverable into
  every prompt.

## 6. Durable run and item state

- Multi-item work uses a domain-owned run table plus normalized item rows. Do
  not append unbounded attempt history to a matrix or intake JSON blob.
- Generic background-job results contain a bounded summary and durable run ID,
  never a full generated page set. Item detail is cursor-paged from the domain
  store.
- A parent worker calls reusable domain generation services directly. It must
  not recursively start single-artifact jobs.
- Every item checkpoints stages, provenance, evidence, artifact IDs, audit
  results, attempts, and a sanitized error. Cancellation and restart recovery
  leave an honest resumable state.
- Brand command acceptance precedes generic-job creation and freezes the exact
  job ID/result. Exact replay/restart recovery may recreate either a missing job
  or only the exact `initJobs()` restart-error tombstone when that current
  command has zero attempts and its command-owned items are still at their
  accepted boundary. Eligibility is scoped to that command, so paid attempts
  from an earlier completed start do not prevent repair of a never-started
  resume. A restart never silently repeats interrupted paid work: running
  attempts/items terminalize honestly and completed candidates survive.
- Recovery keyset-pages every active and terminal candidate instead of stopping
  at the first 100 rows. When the durable run already reached a terminal state
  but its generic job was left as the exact restart tombstone, reconciliation
  restores the bounded job result from the durable run without changing an
  artifact or dispatching paid work.
- Revision acceptance clears the prior audit/provenance lineage. Cancellation
  or restart interruption therefore preserves the existing content/version
  but restores the item to `changes_requested`, never to an unaudited
  `ready_for_human_review` state.
- Brand batch audits begin only after every selected candidate stage has
  settled. Candidate ordering is canonical, deterministic audit is its own
  durable checkpoint before paid model review, and a final commit binds the
  candidate to its lifecycle-successor audit, command, source fingerprint,
  artifact expectation, and revision count.
- Every attempt stores both the frozen authority/source fingerprint and the
  exact stage-effective fingerprint. Paid stages bind the latter to the final
  provider-rendered instruction envelope after creative-JSON wrapping,
  research-mode injection, Anthropic/OpenAI system-message placement, and
  structured response-format selection. Successful provenance must match the
  successful reservation's fingerprint; candidate and audit prompts are
  expected to differ while sharing one source.
- Provider holds are derived pessimistically from the rendered prompt's UTF-8
  bytes plus bounded framing overhead, the requested output ceiling, and the
  selected provider's token rates. Reported successful usage must fit inside
  that durable hold; fixed token guesses are not a budget boundary.
- Before command acceptance, brand generation proves the complete required-stage
  provider closure after JSON/research/message-placement wrapping. Resume and
  revision acceptance also checks `reserved + command estimate <= run limits`
  atomically; an accepted command is never knowingly larger than remaining
  durable capacity.
- B2 caps the final provider instruction envelope at 40 KiB and reserves a
  512-byte acceptance safety margin. Base generation is capped at 24 KiB; the
  raw candidate core and compact refine/audit prompt projection at 4 KiB; the
  resolved durable candidate at 256 KiB; the complete cross-target audit context
  at one 3 KiB digest; and automatic audit-derived revision direction at 512
  bytes. The full-run input ceiling is 5,000,000 tokens. The digest retains every
  related target ID and full candidate fingerprint plus a bounded excerpt; it
  never repeats N full candidates inside each of N audit prompts.
- Every hydrated frozen input verifies its canonical snapshot self-hash plus the
  fingerprints of its approved-input references before any paid dispatch.
- Acceptance, artifact commit, and command completion transactionally enqueue
  `command_accepted`, `artifact_committed`, and `command_completed` effect
  events. Deterministic effect keys make activity writes and MCP paid-call
  metering exactly-once; retryable workspace broadcasts and intelligence-cache
  invalidation are at-least-once.
- Dedupe is resource-scoped. Independent cells may run concurrently; the same
  source revision and idempotency key may not create duplicate paid work.
- Free structural matrix reads do not create a generation run. The first run
  repository accepts only an already-previewed non-empty selection; structural
  code must never manufacture a preview fingerprint to exercise the ledger.
- Matrix run uniqueness is workspace + matrix + idempotency key. Replaying the
  same selection fingerprint returns the existing run; reusing the key for a
  different fingerprint conflicts. Durable run snapshots survive matrix or
  template deletion, while workspace deletion may cascade them.
- Cell evidence is append-only/versioned with exact source revision and
  current/superseded linkage. Never model evidence as one destructively
  overwritten row per requirement.

## 7. Conditional commits and truthful completion

- Paid generation reads the expected artifact revision before dispatch and
  commits only if that revision still matches. A newer operator or client edit
  always wins.
- A review-ready brand candidate is the only output that may create/update the
  legacy `BrandDeliverable` row. `needs_attention` and
  `blocked_missing_evidence` candidates remain in the generation item/attempt
  ledger so no legacy approval path can bypass the automatic gate.
- Retry resumes missing/failed stages and never repeats a successful paid stage
  unless explicit replacement was authorized.
- An explicit human-directed revision that is cancelled, restart-interrupted,
  or fails an ordinary provider/output/audit/budget stage preserves its human
  content/version and returns to retryable `changes_requested`. Artifact CAS
  loss remains `conflict` because the newer human artifact wins.
- Domain run/item status distinguishes complete, complete-with-errors,
  cancelled, blocked, conflict, and failed. Generic `BackgroundJobStatus`
  remains `pending|running|done|error|cancelled`; its bounded result reports the
  durable run ID and rich terminal domain status. Partial work is never reported
  as success.
- `ready_for_human_review` is an audit verdict, not an approval or publication
  state. After explicit human approval and existing export/publish preconditions
  pass, the workflow may become `ready_to_publish`; it still never auto-publishes.
- Orchestration must represent page review as its own durable waiting state.
  `content_generating` cannot transition directly to `ready_to_publish`.
- Matrix page approval uses a review-only, version-conditional domain mutation.
  It freezes the full matrix/template/cell source revision plus expected
  run/item/post revisions, may satisfy the post's approved/exportable
  preconditions, and records durable approval evidence with a human
  operator/client actor, but it never invokes
  publish policy or a CMS job—even when auto-publish is configured. Every
  selected page must be individually approved before a page-set workflow becomes
  `ready_to_publish`.

## 8. Audit and revision limits

- Deterministic checks run before model review and again after revision.
- A ready audit report has zero unresolved requirements and no failed
  deterministic result. A missing-evidence verdict carries a non-empty
  requirement tuple. Human-required checks may remain human-required or be
  inapplicable; automated paths cannot mark them passed.
- Model review uses a named operation and a validated structured output. It may
  assess voice, persona fit, SEO, AEO, CTA clarity, and cross-item consistency.
- Automatic revision is bounded to one pass total per item across item-level and
  set-level audits; the shared audit, brand-item, and matrix-item counter type is
  exactly `0|1`. Continued failures become actionable findings instead of an
  unbounded AI loop.
- Batch generation runs deterministic set checks after item audits for URL
  duplication, typed keyword overlap/cannibalization, block-manifest coverage,
  structured claim/evidence conflicts, and configured overlap thresholds. A
  separate named, schema-validated model audit assesses factual consistency and
  substantive uniqueness but cannot certify truth; provenance-sensitive
  verdicts remain human-required. Structural conflicts require matrix/template
  correction and retry; prose-only consistency findings may use the item's
  still-unused single revision allowance.
- All attempts retain run/provider/model correlation without storing raw
  prompts, secrets, or client-only evidence in logs.

## 9. MCP boundary and caller attribution

- New action tools use snake_case inputs, stable JSON error codes, authoritative
  IDs, bounded selections, explicit revisions, and idempotency keys.
- Matrix list/detail cursors bind their filter/source revision and use hard
  page limits. List cursors also bind the workspace, and list summaries expose
  bounded counts rather than unbounded nested dimension values. A changed matrix
  conflicts instead of mixing two cell snapshots; multi-cell structural
  resolution rejects duplicate or oversized selections.
- Brand-voice anchor reads use the same bounded-cursor discipline. Follow
  `eligible_anchors.next_cursor` while `has_more` is true. The cursor binds the
  workspace plus current voice-profile and intake revisions; a conflict means
  restart from the first page, never continue a mixed authority snapshot. The
  latest finalization is projected as a summary only, although the server
  strictly validates the bounded frozen detail internally before claiming it.
- Brand-generation item paging uses the shared opaque signed-cursor contract at
  both HTTP and MCP boundaries: exactly two non-empty base64url segments joined
  by one dot. The decoded cursor remains bound to workspace, run revision, and
  stable position; malformed or stale cursors fail closed.
- Template-upgrade acceptance binds its idempotency key to the exact proposal
  fingerprint and source revision. The same mutation may replay; reusing the key
  for a different proposal conflicts. Rejection does not mutate the template.
- Workspace authorization is checked against the workspace field declared by
  the called tool schema. Conflicting `workspaceId` and `workspace_id` aliases
  are invalid for every caller.
- The authenticated MCP key ID/label and tool name flow into activity and run
  attribution. A generic `mcp-chat` source is not sufficient for new writes.
- Human authority never comes from an MCP key. When an action requires operator
  attribution, the tool consumes a short-lived one-time authorization created
  through an authenticated operator boundary and bound to the exact resource
  revision and mutation payload. Persist only the bearer-token digest, derive
  the operator from that authorization, record the MCP key separately as the
  executor, and make replay return the already-committed result. The consumed
  authorization tuple (timestamp, finalization backlink, execution actor) is
  immutable audit proof and must validate against the finalization's versioned
  stored command; a pair of matching unverified fingerprint strings is not
  sufficient authority.
- MCP key ID/label attribution is internal operational evidence. Preserve it in
  full admin activity and durable run provenance, but remove it from workspace
  broadcasts and client-visible activity projections.
- Public matrix-run DTOs omit both the idempotency key and full MCP execution
  context. Project MCP/system creators to `{ actorType }`; retain operator/client
  IDs and optional labels only for human review history.
- Request-scoped compatibility context may enrich legacy activity writers, but
  every durable generation run snapshots the explicit execution context; a
  restart/resume path must never depend on ambient request state.
- Every successful MCP brand-generation command response, including an exact
  replay, records one durable paid-trigger event keyed by the accepted job ID.
  The event insert and global/workspace counter increments share one immediate
  transaction: replay cannot double-count, while replay after a crash between
  command acceptance and metering repairs the missing increment exactly once.
- Tool registry, discovery, dispatch, schema census, and workspace-argument
  census share one canonical registry and contract test.
- Registry definitions are immutable snapshots, and production definition names
  are censused against exact family-handler identity and any pre-dispatch
  handled-name manifest so early workspace validation cannot hide a missing or
  wrong dispatch branch.
- Request correlation is server-owned diagnostic metadata, not authority.
  Generate the UUID before logging, response attachment, activity, or durable
  run attribution and ignore every caller `X-Request-ID`; arbitrary caller text
  cannot be proven non-secret with a finite denylist. Rejection logs/results use
  stable classifications, not raw unknown tool names or workspace arguments.
- Error compatibility is per tool. Existing handlers remain legacy text while
  registry-owned unknown/auth rejections are generic and non-reflective; every
  `json_v1` scope error, handler-returned error, and thrown error must cross the
  sanitizing registry boundary. Unvalidated results degrade to a generic safe
  envelope rather than being serialized.

## 10. Brand review and projection

- Brand client review reuses the unified `ClientDeliverable` spine; it does not
  create a parallel approval system. A grouped bundle has one typed item per
  source `BrandDeliverable` and records approve/changes-requested per item.
- Foundation and durable-suite review are separate, independently versioned
  payload variants with stable `brand_generation:<reviewKind>:<runId>` natural
  keys. A same-run revision preserves approved children and database-owned item
  identity metadata; it cannot duplicate the bundle or reset prior approvals.
- Drafts, raw intake, prompts, internal evidence, and audit reasoning are never
  exposed by client serializers. Private run/source IDs, revisions, actor data,
  requirements, provenance, and MCP identity are projected away too.
- Item approval updates only that source row through its legal state machine and
  only when both the frozen generation-item revision and source version match.
  The source, generation item/run counts, and mirror child commit atomically;
  the generic mirror-first response path is forbidden. Changes requested
  preserves the note, keeps/returns that source in draft, and opens a
  version-safe revision path.
  Only operator/client actors may decide an item; system/MCP actors cannot
  auto-approve, and `changes_requested` always carries its note.
  The bundle stays `partial` until all items are terminal and becomes `approved`
  only when all are approved.
- Voice-foundation review is a separate gate. Client approval of a voice item
  never finalizes a `VoiceProfile` and never mutates the provisional B2 item; it
  records human-review evidence only. An operator explicitly finalizes after
  selecting authentic anchors.
- Only approved, explicitly client-visible brand fields pre-seed the client
  dashboard and downstream brand slice.
- An intake-to-brand-to-content orchestration is a durable workflow that pauses
  at review/approval boundaries. Human gates are resumable states, not long-
  running jobs and not bypasses hidden behind “one click.”
- Content authorization carries a durable authorization ID and a named
  operator/client authorizer. A system/MCP recorder cannot stand in for the
  human authorization proof.
