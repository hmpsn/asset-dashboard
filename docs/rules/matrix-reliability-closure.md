# Matrix Reliability Closure

This is the cross-lane contract for the compressed matrix reliability program.
The owning bounded context is `content-pipeline`; MCP and HTTP are adapters over the
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
  reports whether the bounded result was truncated. It fails closed as
  `not_found` across workspace, matrix, or cell boundaries. Legacy accepted runs
  derive the same exact IDs from their persisted verified requirement refs. If
  one item exceeds the cap, the opaque run cursor remains on that item and
  advances its evidence offset; callers preserve evidence-read mode while the
  item repeats until every consumed row is reachable.
- Internal-link evidence uses `kind: "link_list"` with
  `value: [{ href: "/workspace-relative-path", anchorText: "Visible text" }]`.
  MCP uses the same shape with `anchor_text`; destinations never accept an
  origin, query, fragment, protocol-relative path, or raw provider URL.
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

## Output-integrity PR contracts

- Heading synchronization runs before every initial matrix artifact commit and again after
  automatic revision. Heading presence is governed by `heading.level`, not by whether a literal
  fallback exists. Headingless blocks contain no H2; visible blocks contain exactly one first H2;
  locked headings match the rendered authority byte-for-byte; unlocked section metadata is
  derived from the rendered H2. The deterministic census remains a redundant backstop.
- `ResolvedPageBlockManifest.totalWordCountTarget` remains template-body authority. The final
  sanitized template-section HTML must fall within ±10% of that body target. Introduction and
  conclusion are not silently charged against a target that never budgeted them.
- Every stored section count and the stored full-page total must equal the actual sanitized HTML,
  including after automatic revision.
- Secondary keywords are topical targets, not mandatory exact strings. Existing deterministic
  primary-keyword placement checks remain unchanged; they intentionally accept natural ordering.
- Unification returns typed outcomes that distinguish a short-input skip, an invalid candidate,
  and a provider failure. Under-target guidance may expand only from existing frozen authority or
  typed placeholders; no repeated paid correction loop is added.
- Prompt-policy changes are gated by `content-matrix-output-quality-v2`. Heading/count truth and
  typed outcome correctness are unflagged. Preview freezes the resolved policy value into the
  accepted target and fingerprint; generation, audit, recovery, and retry must never re-read the
  live flag for an accepted run. Mixed-model automatic revision remains prohibited.
- A welded geo/service phrase is a revision-driving model-audit warning when it can be repaired
  without changing facts, evidence, locked headings, or keyword authority.

## Output-integrity dependency and ownership graph

```text
Shared flag + heading contract + red tests (orchestrator, committed first)
  ├─ Heading integrity lane: heading helper, stage/revision/commit/audit seams, focused tests
  └─ Unification lane: typed outcomes + prompt semantics, content-post tests
       ↓ diff/typecheck checkpoint
Sequential matrix quality integration: persisted count/body-target audit + final notes
  → focused/full verification → two independent reviews → staging PR
```

The heading lane owns matrix generation domain files and their focused tests. The unification lane
owns `server/content-posts-ai.ts`, `server/content-posts.ts`, and their focused tests. Neither lane
may touch shared flags, documentation, roadmap, UI, evidence, approval, send, or publish files.
