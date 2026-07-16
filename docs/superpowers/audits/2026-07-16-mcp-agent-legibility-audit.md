# MCP agent-legibility audit

Date: 2026-07-16

## Outcome

The appendix identifies three kinds of work, but only two belong in the first
PR:

1. Migrate the 13 legacy MCP families (61 tools) from `legacy_text` to the
   branded `json_v1` error contract.
2. Document single-brace template placeholders at the template and matrix
   entry points.

The other three documentation/read-model findings are already fixed on
`staging`:

- `tone_spectrum` declares the 1–10 range and says that higher values move
  toward the second pole.
- `submit_brand_intake` documents the 128 KiB normalized payload cap and its
  validation error names the offending path.
- `get_brand_identity` returns deliverable counts and
  `availability: pending_approval` when approval is outstanding.

## Existing seam

The registry currently contains 18 tool families. Five already use `json_v1`;
13 use `legacy_text`. The latter comprise 61 tools across workspaces,
intelligence, insights, content reads, brand identity, clients, keyword
actions, content actions, recommendation actions, content generation, schema,
analytics reads, and jobs.

`json_v1` errors must be created by `server/mcp/tool-errors.ts`. The registry
rejects an unbranded error result, which prevents a handler from returning an
arbitrary JSON string that may contain arguments, prompts, credentials,
evidence, exception messages, or stacks. The migration therefore cannot be a
registry-only contract flip.

The legacy `mcpError(message)` helper accepts arbitrary text. Some call sites
interpolate thrown exception messages. Retaining that helper unchanged under
`json_v1` would preserve the leak and would not provide reliable error codes.
The smallest safe migration is a short set of typed constructors for the
existing public error classes, followed by direct call-site conversion. Raw
exceptions remain in server logs only.

## Casing is a separate change

The registry deliberately rejects a schema declaring both `workspaceId` and
`workspace_id`, and authorization derives the workspace field from the schema.
Adding aliases without changing that boundary could authorize one spelling and
dispatch the other. The deprecated camelCase alias work therefore needs its
own auth-focused PR, including conflict rejection and a removal date. It is not
part of the error migration.

## Contracts that must remain unchanged

- MCP callers cannot approve client work or self-authorize voice finalization.
- Brand edits reset approval to draft.
- Evidence and page-generation preconditions remain blocking.
- Human review remains required before publish/send.
- Unexpected failures never echo raw exceptions to MCP callers.

## Adversarial implementation review

The post-implementation pass found and closed three ordinary safety gaps:

- bulk insight resolution returned `InvalidTransitionError.message` inside an
  otherwise successful batch payload; it now reports `invalid_transition`;
- post-section validation used a rejected numeric index inside `constraint`;
  it now returns a stable field rule without reflecting the supplied value;
- content preparation previously collapsed known source-authority mismatches
  and unexpected persistence failures into the same response class. Known
  mismatches now return `precondition_failed`; unexpected failures are logged
  and return generic `internal_error`.

No human gate or successful mutation behavior was changed during this review.
