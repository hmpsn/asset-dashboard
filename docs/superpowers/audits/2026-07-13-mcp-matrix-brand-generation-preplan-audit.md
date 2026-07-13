# MCP Matrix + Brand Generation — Pre-plan Audit

**Date:** 2026-07-13
**Branch base:** `origin/staging` at `70ea3bef5`
**Purpose:** Ground the content-matrix and brand-deliverable MCP program in the
current repository before implementation planning.

## Executive verdict

The requested flow is not greenfield, but it is not closed.

- Content matrices, Cartesian service/location cells, page templates, grounded
  brief/post generation, brand identity generation, the unified client Inbox,
  MCP actions, and background jobs all exist.
- A hidden keyword-equality scan currently lets some standalone brief jobs pick
  up template guidance from a matrix. It loses cell identity, variables,
  planned URL, revisions, and atomic lifecycle linkage.
- The matrix UI advertises single and bulk brief generation, but the parent
  callback implements neither action.
- Brand intake is flattened into legacy workspace text. Brand generation is a
  separate one-deliverable HTTP path with no durable intake revision, MCP start
  action, client review, or safe late-result commit.
- “Page set” and “brand suite” generation need normalized durable run/item
  models, deterministic preflight, conditional saves, bounded costs, and honest
  partial outcomes before MCP batch exposure.

The safe implementation order is therefore: close one explicit source-to-
artifact path, prove audit and edit safety, then add bounded batch orchestration.

## Confirmed current capabilities

| Area | Current implementation | Reusable value |
|---|---|---|
| Matrix planning | `ContentTemplate`, `ContentMatrix`, `MatrixCell`; generic dimensions and Cartesian URL/keyword substitution | Existing target planner and UI |
| Matrix lifecycle | Cell states plus brief/post links and status history | Existing client/content-plan projection |
| Brief generation | Grounded background job, page types, keyword lock, research/evidence fields | Canonical first artifact |
| Post generation | Stage-based generation, exact section completeness, `needs_attention`, review and publishing paths | Canonical page draft artifact |
| Template bridge | `resolveBriefTemplateCrossref()` scans cells by normalized keyword | Proof that template-aware generation is partly viable |
| Brand engine | Brandscript, discovery, structured voice profile, 17 identity deliverables and versions | Existing domain foundation |
| Brand MCP | `get_brand_identity`, `update_brand_deliverable` | Read/edit base to extend |
| Inbox | Unified `ClientDeliverable` adapters, send/respond orchestration, Reviews section | Correct client-review spine |
| MCP runtime | Stateless Streamable HTTP, per-key workspace scope, 61 tools, job polling, durable handles | Mature transport/action platform |
| AI runtime | Named operations, provider-neutral run metadata, truthful content completeness | Shared governance to consume |

## Content-matrix gaps

1. **Source identity is ambiguous.**
   `server/content-brief-template-crossref.ts` scans every matrix and takes the
   first keyword match. Duplicate keywords can select the wrong cell.

2. **Template rendering is incomplete.**
   Matrix creation substitutes variables only into URL and keyword patterns.
   It does not resolve title, meta, or section headings; the generation bridge
   does not pass `variableValues`, so prompt-side substitution cannot be
   reliable. Unresolved variables and URL collisions are not rejected.

3. **The template is not truly locked.**
   The brief prompt permits supplementary sections. Exact section identity and
   order are not a persisted generation input contract.

4. **Cell and artifact writes are not one operation.**
   Brief generation records keyword source as `template`, not `matrix`, and does
   not atomically link the brief/post, run provenance, and cell transition.

5. **The matrix blob is not a run ledger.**
   Cells are stored as one JSON array and wholesale-rewritten. Adding attempts,
   stage history, and audit detail there would worsen contention and violate the
   normalized-repeating-data rule.

6. **The current control is inert.**
   `ContentPlanner.handleBulkAction()` explicitly defers `generate_briefs`; the
   detail callback is not wired. Users can click an apparent action with no
   generation result.

7. **Local targeting can invite fabrication.**
   A location dimension currently carries no evidence semantics. Existing page
   guidance may suggest neighborhoods or landmarks without proving them.

8. **MCP cannot inspect or address matrices.**
   `get_keyword_strategy` returns page-keyword assignments, not matrices/cells.
   MCP generation accepts a keyword or brief ID only; there is no matrix read,
   preflight, cell start, batch status, or failed-item retry tool.

9. **Workspace-wide job dedupe blocks safe batching.**
   Existing brief/post starts allow one active job type per workspace. A batch
   cannot recursively launch those jobs and retain coherent parent semantics.

## Brand/onboarding gaps

1. **No typed durable intake.**
   Questionnaire types live inside the React component. The public route accepts
   raw `req.body`, appends prose to `knowledgeBase`, mutates legacy
   `brandVoice`, and synthesizes personas. Resubmission can duplicate data.

2. **The apparent Brandscript prefill is stranded.**
   `prefillFromQuestionnaire()` parses flattened labels, but no production route,
   client, or MCP tool calls it.

3. **Brand generation is not intake-grounded.**
   It reads workspace intelligence, the first Brandscript, voice context, and a
   few accepted story excerpts, but not a preserved intake revision or explicit
   evidence ledger.

4. **The prompt conflicts with never-invent behavior.**
   It asks for specificity and forbids generic placeholders. Missing facts can
   therefore be converted into confident prose instead of a typed requirement.

5. **Late AI writes can overwrite humans.**
   Generate/refine re-read inside a transaction but do not compare the revision
   captured before the paid call. A newer operator edit may be versioned and
   then replaced by the late generation.

6. **Voice has competing authorities.**
   Legacy `workspace.brandVoice`, structured `voice_profiles`, and the
   `voice_guidelines` deliverable can disagree. Current state transitions allow
   `calibrated` without requiring DNA, guardrails, or selected anchor evidence.

7. **No brand generation MCP target.**
   MCP can read identity and edit an existing deliverable, but cannot read the
   intake, generate/audit a suite, finalize voice, poll a brand run, or send a
   review bundle.

8. **No client review/projection.**
   Brand source rows have only `draft|approved`. The client Brand surface is not
   passed its available summary, and client-safe serialization exposes no
   approved identity projection.

9. **Downstream identity injection requires an allow-list.**
   The repository has an explicit owner decision against putting all approved
   identity into every generator. Copy and selected MCP paths already consume
   it; new service/landing/location pages need page-type-specific selection.

10. **Naming is not a current deliverable type.**
    The requested naming output requires a new typed creative-proposal target.
    It must never claim trademark, domain, or legal availability without
    separately verified evidence.

## MCP/runtime gaps and security finding

- The registry is composed from category arrays in `server/mcp/server.ts`; the
  README and contract census have already drifted from the live 61-tool set.
- Handlers do not receive authenticated key ID/label, so new activity cannot
  identify the actual MCP caller. Existing roadmap item
  `mcp-key-label-attribution` remains pending.
- Generic job `result` is untyped and job list is limit-only. New large results
  must live in domain tables and expose cursor-paged reads.
- Pending/running jobs are terminalized after process restart, not resumed. New
  run items therefore need durable checkpoint/retry semantics independent of
  generic in-memory job detail.
- The paid-call counter is useful telemetry, not a hard batch budget. A single
  request could otherwise fan out into unbounded calls.
- The audit found a workspace-scope bypass: a request could supply both
  `workspaceId` and `workspace_id`, have authorization inspect one, and have the
  tool schema consume the other. This planning branch fixes the issue by
  authorizing the field declared by the called tool and rejecting conflicting
  aliases; focused auth/routing tests pass.

## Decisions locked for planning

1. **Canonical content artifact:** extend the current `ContentBrief` →
   `GeneratedPost` path. It already owns matrix cell links and the strongest
   truthful-completion work. Do not create a second matrix generator on top of
   the less-grounded copy-batch implementation.
2. **Canonical target:** `(workspaceId, matrixId, cellId,
   MatrixSourceRevision)`, where matrix/template/cell revisions are monotonic
   integers and legacy cells read as revision `0`.
3. **Canonical batch:** one parent matrix-run job calling extracted domain
   functions directly, with normalized per-cell rows.
4. **Canonical brand input:** an immutable, typed intake revision plus explicit
   evidence references.
5. **Voice authority:** authentic examples first; generated voice foundation is
   provisional until explicit finalization. One frozen voice snapshot per run.
6. **Ready meaning:** automatic generation can reach
   `ready_for_human_review`; after explicit approval and existing export/publish
   checks, orchestration may reach `ready_to_publish`, which is still not
   publication.
7. **Client review:** reuse unified Inbox with one grouped brand bundle.
8. **Orchestration:** durable and resumable; it pauses at operator/client review
   instead of holding a job open or bypassing approval.
9. **Rollout:** two narrow server/workspace flags—one for matrix generation and
   one for brand generation. The final orchestration requires both, not a third
   composite feature flag.

## Dependencies on work already planned

- `genq-content-generation-integrity` C2 must land first so content artifacts
  have generation revisions, provenance, resource-scoped idempotency, and
  conditional saves.
- `genq-content-context-v2` must land before the matrix generator so the new
  surface begins on the budgeted exact-once voice/evidence path. The matrix
  surface consumes that implementation directly; it does not create another
  context flag.
- New named operations must register with AI reliability/quality and runtime
  budget governance as those contracts land.
- `mcp-key-label-attribution` is pulled forward as the MCP foundation phase for
  these new write tools.

## External references not locally verifiable

The request references `ie-pseo-matrix-generation`,
`brand-web-onboarding-system`, and `client-content-playbook` in an external
operations workspace. Those files are not present in this repository. The user
request supplies the intent used here; any additional acceptance criteria in
those documents must be reconciled before implementation P0 is approved.
