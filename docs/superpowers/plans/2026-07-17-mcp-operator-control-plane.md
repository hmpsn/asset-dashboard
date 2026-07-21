# MCP Operator Control Plane Program

## Overview

Build an additive, compact MCP surface for Claude/ChatGPT desktop administration
while the Insights Engine remains the authoritative database and client-view
layer. The program is backend-first, one staging-first PR per phase, and excludes
active UI rebuild surfaces. Cross-phase invariants live in
`docs/rules/mcp-operator-control-plane.md`.

Primary bounded context: `platform-foundation`. Secondary integrations:
`workspace-command-center`, `analytics-intelligence`, `client-portal`,
`brand-engine`, and `content-pipeline`. There are no frontend query keys,
WebSocket events, or UI routes in P1.

## Dependency graph

The reliability-closure amendment is sequential and staging-first. Every arrow
means the preceding PR is merged, CI-green, and smoke-verified on staging before
the next worktree is created:

```text
P0 ready-preview repair (complete)
  → P1 compact operator profile
  → P2 deterministic decision/client views
  → M0 single-cell set-audit consistency
  → P3 structured outputs and annotations
  → M1-M8 matrix reliability/quality closure
  → P4 workspace alias normalization
  → P5 capability-scoped credentials
  → P6 MCP telemetry and usage reporting
  → P7 desktop workflow prompts
  → one staging-to-main release
```

M0-M8 are defined by the approved MCP and Matrix Reliability Closure Program.
They preserve the evidence ledger and human approval/send/publication gates. No
phase syncs a local database from staging, and paid Rinse generation remains an
explicit owner-confirmed checkpoint after M6.

P1 execution:

```text
shared profile contracts + guardrails commit
  → red unit/contract/integration tests
  → coupled routing/registry/auth implementation
  → focused verification
  → two independent GPT-5.5 reviews
  → full verification + staging PR/CI/deploy smoke
```

P1 routing, registry filtering, compact projection, and invocation enforcement
are one coupled implementation task. Tests have exclusive ownership and are
committed red before implementation begins. Shared docs and contracts are owned
sequentially by the orchestrator.

P2 execution:

```text
typed brief/output schemas + slice ID guardrails commit
  → red unit/contract/integration tests
  → bounded pending-decision slice projection
  → pure deterministic operator read models
  → MCP adapter + canonical registry activation
  → focused verification + byte-budget measurement
  → two independent GPT-5.5 reviews
  → full verification + staging PR/CI/deploy smoke
```

P2 keeps the Insights Engine facade authoritative. The workspace decision brief
requests a purpose-specific five-of-fifteen projection: exactly `insights`,
`contentPipeline`, `siteHealth`, `clientSignals`, and `operational`. The other ten
registered slices remain available to their existing consumers and the full MCP
surface. The client view uses the exact tier selector and public projection.
Portfolio assembly reads existing persistence stores only. No builder may call AI,
a provider, a job starter, a mutation, or a paid-operation counter.

## Phase acceptance

### P1 — Compact Desktop Operator Profile

- Add `McpServerProfile = 'full' | 'operator'`.
- Preserve `POST /mcp` and add master-key-only `POST /mcp/operator`.
- Use the canonical 25-name allowlist for both discovery and dispatch. The three
  P2 names remain reserved/non-discoverable until implemented.
- Return generic `not_found` for hidden registered tools.
- Preserve the exact full-profile discovery and instruction bytes.
- Keep operator discovery plus instructions at or below 32 KiB UTF-8.
- Exclude `src/**`, AdminChat, navigation, design-system files, migrations, and
  active UI-rebuild surfaces.

### P2 — Insights-backed operator read models

- `get_portfolio_brief` defaults to 10 rows, caps at 25, and ranks only after a
  total-order comparison of pending requests, approval items, client actions,
  workspace name, and workspace ID. It returns stable reason codes and bounded
  durable drill-down IDs, never Cockpit prose or intelligence payloads.
- `get_workspace_decision_brief` defaults each queue to 10 and caps at 25. It
  projects only bounded blockers, pending decisions, client-risk signals,
  explicit slice availability, and deterministic next-safe-action codes.
- `get_client_view` uses `computeEffectiveTier()`,
  `clientIntelligenceSlicesForTier()`, and `buildClientIntelligenceView()` in the
  same sequence as the public route. Missing client-safe learnings fail closed.
- All three retain text JSON and add schema-validated
  `structuredContent: { data }` under explicit root-object output schemas.
- No raw insight data, prompt blocks, evidence, current/proposed approval values,
  client-action payloads, request descriptions, churn descriptions, recent
  activity prose, AI/provider calls, jobs, mutations, or paid calls.
- Exclude `src/**`, AdminChat, navigation, design-system files, migrations, and
  active UI-rebuild surfaces.

### P3 — Structured contracts

Add validated structured outputs, explicit output schemas, and annotations for
all active operator tools without removing text JSON compatibility. The complete
self-contained contract has a 64 KiB hard ceiling and 48 KiB optimization target;
the historical 32 KiB P1/P2 ceiling is superseded rather than met with lossy or
externally unresolved schemas.

### P4 — Workspace aliases

Normalize deprecated `workspaceId` centrally before authorization and handler
validation; conflicting aliases fail closed.

### P5 — Capability credentials

Add normalized capabilities and all-workspace operator credentials, preserving
legacy key access and the environment master key as break-glass authority.

### P6 — Usage telemetry

Persist bounded daily aggregates only and report transport bytes, paid triggers,
and separately attributable provider usage without claiming desktop subscription
token visibility.

### P7 — Desktop prompts

Add portfolio triage, client-view review, and safely confirmed matrix-generation
prompts after Claude Desktop and ChatGPT Desktop compatibility smoke.

P7 is dependency-relaxed from parked P3–P6 because it changes no tools, schemas,
aliases, credentials, telemetry, storage, or authorization. Implement the three
immutable names from `shared/types/mcp-prompts.ts` through additive
`prompts/list` and `prompts/get` handlers on `/mcp/operator` only; preserve the
full `/mcp` initialize capability set unchanged. Add equivalent
copyable starters to `server/mcp/README.md` for clients without native prompt
discovery. The generation workflow must invalidate stale confirmation after any
new preview, require fresh preview-specific confirmation immediately before paid
start, require separate exact-item/available-budget confirmation before a
same-authority retry, and stop at human review. Changed authority returns to
preview/start instead of retry.

P7 execution:

```text
shared prompt vocabulary + guardrail/spec commit
  → red unit/integration contract tests
  → immutable prompt registry/rendering
  → additive transport handlers
  → copyable compatibility starters
  → focused verification
  → two independent GPT-5.5 reviews
  → full verification + staging PR/CI/read-only smoke
```

Exclusive ownership after the contracts commit:

- Test agent: only the two new P7 test files.
- Prompt implementation agent: `server/mcp/prompts.ts` only.
- Transport integration remains sequential and orchestrator-owned in
  `server/mcp/server.ts`.
- Compatibility documentation and closeout records remain orchestrator-owned.

## File ownership — P1

Orchestrator owns shared/coordination files:

- `shared/types/mcp-runtime.ts`
- `server/mcp/profiles.ts`
- `CLAUDE.md`
- `docs/rules/mcp-operator-control-plane.md`
- this plan
- `FEATURE_AUDIT.md`
- `data/roadmap.json`

Test agent owns only new P1 test files. Implementation agent owns only the MCP
transport/registry/auth files explicitly assigned after the red-test commit. Any
need for another file is `NEEDS_CONTEXT` and stops that agent.

## File ownership — P2

Orchestrator owns shared contracts and coordination files:

- `shared/types/mcp-operator-briefs.ts`
- `shared/types/mcp-runtime.ts`
- `shared/types/intelligence.ts`
- `docs/rules/mcp-operator-control-plane.md`
- this plan
- sequential closeout edits to `server/mcp/README.md`, `FEATURE_AUDIT.md`, and
  `data/roadmap.json`

After the contracts commit, implementation ownership is exclusive:

- Insights slice agent: bounded pending-decision reader plus
  `server/intelligence/operational-slice.ts`.
- Read-model agent: `server/domains/analytics-intelligence/operator-read-models.ts`.
- MCP adapter agent: `server/mcp/tools/operator-briefs.ts` and the canonical
  registry registration.
- Test agent: only new P2 test files and explicitly assigned census fixtures.

An agent that requires a file outside its assignment stops with `NEEDS_CONTEXT`.
The orchestrator reconciles shared-file changes, adjudicates review findings, and
is the only writer for closeout documentation.

## Verification

- Focused unit, contract, and real-HTTP integration tests with red → green proof.
- `npm run typecheck`
- `npx vite build`
- `npm run pr-check`
- `npm run lint:hooks`
- full `npx vitest run`
- independent runtime/spec/security review
- independent code-quality/backward-compatibility/performance review
- staging `/mcp` and `/mcp/operator` handshake, discovery-byte, hidden-tool, and
  representative invocation smoke; no paid call.
