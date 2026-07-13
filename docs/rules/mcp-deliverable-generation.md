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
provisional foundation from accepted intake and authentic samples without an
already-finalized voice profile. The workflow must then pause for review and
explicit finalization before any dependent brand or content generation.

Preview returns the selected item count, blockers, placeholder-eligible gaps,
estimated paid calls/tokens/cost, and an effective-input fingerprint. Start must
present that fingerprint so the approved selection cannot drift before dispatch.

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

## 4. Evidence and placeholder honesty

- Factual claims require durable evidence references. Creative proposals such
  as names and taglines are labeled as proposals, never verified facts.
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
- Factual accuracy and no-hallucination checks remain human-review-required;
  AI review never auto-passes provenance-sensitive items.
- Local and service page sets require cell-specific grounded value. Pure
  variable substitution cannot pass the substantive-uniqueness audit.

## 5. Voice has one authority

- Authentic client-supplied examples and approved source material outrank
  generated prose as voice evidence.
- A generated voice foundation is provisional until explicitly finalized.
  Finalization requires non-empty DNA, guardrails, and selected authentic anchor
  evidence. A brand-suite run pauses at this gate; provisional voice cannot
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
- Dedupe is resource-scoped. Independent cells may run concurrently; the same
  source revision and idempotency key may not create duplicate paid work.

## 7. Conditional commits and truthful completion

- Paid generation reads the expected artifact revision before dispatch and
  commits only if that revision still matches. A newer operator or client edit
  always wins.
- Retry resumes missing/failed stages and never repeats a successful paid stage
  unless explicit replacement was authorized.
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
  It may satisfy the post's approved/exportable preconditions and record durable
  approval evidence, but it never invokes publish policy or a CMS job—even when
  auto-publish is configured. Every selected page must be individually approved
  before a page-set workflow becomes `ready_to_publish`.

## 8. Audit and revision limits

- Deterministic checks run before model review and again after revision.
- Model review uses a named operation and a validated structured output. It may
  assess voice, persona fit, SEO, AEO, CTA clarity, and cross-item consistency.
- Automatic revision is bounded to one pass total per item across item-level and
  set-level audits. Continued failures become actionable findings instead of an
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
- Workspace authorization is checked against the workspace field declared by
  the called tool schema. Conflicting `workspaceId` and `workspace_id` aliases
  are invalid for every caller.
- The authenticated MCP key ID/label and tool name flow into activity and run
  attribution. A generic `mcp-chat` source is not sufficient for new writes.
- Tool registry, discovery, dispatch, schema census, and workspace-argument
  census share one canonical registry and contract test.

## 10. Brand review and projection

- Brand client review reuses the unified `ClientDeliverable` spine; it does not
  create a parallel approval system. A grouped bundle has one typed item per
  source `BrandDeliverable` and records approve/changes-requested per item.
- Drafts, raw intake, prompts, internal evidence, and audit reasoning are never
  exposed by client serializers.
- Item approval updates only that source row through its legal state machine and
  only when the expected version matches. Changes requested preserves the note,
  keeps/returns that source in draft, and opens a version-safe revision path.
  The bundle stays `partial` until all items are terminal and becomes `approved`
  only when all are approved.
- Voice-foundation review is a separate gate. Client approval of a voice item
  never finalizes a `VoiceProfile`; an operator explicitly finalizes after
  selecting authentic anchors.
- Only approved, explicitly client-visible brand fields pre-seed the client
  dashboard and downstream brand slice.
- An intake-to-brand-to-content orchestration is a durable workflow that pauses
  at review/approval boundaries. Human gates are resumable states, not long-
  running jobs and not bypasses hidden behind “one click.”
