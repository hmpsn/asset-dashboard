# Matrix Reliability Closure

This is the cross-lane contract for the compressed pre-paid reliability PR.
The owning bounded context is `content`; MCP and HTTP are adapters over the
same domain services. No lane may weaken evidence, voice finalization, human
review, paid confirmation, send, approval, or publication gates.

## Shared invariants

- Preview checks the matrix-generation feature flag before page-census or other
  provider-backed work.
- Preview, start, and retry failures use the stable shared reason vocabulary and
  derive `retryable` from the actual reason. No preview TTL is invented; source
  drift requires an immediate fresh preview.
- Requirement diagnostics state whether the returned requirement set is
  complete. Source-limit and census failures are bounded and expose only stable
  stage/code/status metadata, never provider text, prompts, evidence, or secrets.
- Normal evidence submission cannot satisfy a human-only replacement approval.
- Paid stages consume the exact evidence row IDs accepted by preview, including
  superseded rows. They never substitute a newer current value.
- Artifact revisions are write-time CAS. General service, location, and CTA
  evidence survives generated-artifact replacement; section evidence continues
  to invalidate when template authority changes.
- `include_evidence_values` is opt-in, returns at most ten exact frozen rows, and
  fails closed as `not_found` across workspace, matrix, or cell boundaries.
- MCP job status authorization and projection read durable SQLite state and then
  refresh the process cache. Restart recovery records the existing explicit
  interruption error on every nonterminal matrix item before terminalizing it.
- Template contract-v1 creation validates URL, keyword, title, and metadata
  patterns through the canonical renderer with exact caller-facing field paths.

## Parallel ownership

- Preview truth/diagnostics owns preview and read-service contracts.
- Job freshness owns `server/jobs.ts`, job MCP projection, and recovery tests.
- Template validation owns template service/route tests and does not edit the
  matrix MCP adapter.
- Evidence durability starts only after preview contracts land and owns evidence
  repository/read semantics.
- Shared types, MCP/HTTP adapters, documentation, roadmap, and final integration
  remain orchestrator-owned.

No lane may edit an unowned file without stopping for reassignment.
