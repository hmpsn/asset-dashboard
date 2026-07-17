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

Sequential phases:

```text
P0 ready-preview repair (complete)
  → P1 compact operator profile
  → P2 deterministic decision/client views
  → P3 structured outputs and annotations
  → P4 workspace alias normalization
  → P5 capability-scoped credentials
  → P6 MCP telemetry and usage reporting
  → P7 desktop workflow prompts
```

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

Add bounded deterministic portfolio, workspace-decision, and client-safe views.
No AI/provider calls; the client projection must match the public tier-gated view.

### P3 — Structured contracts

Add validated structured outputs, explicit output schemas, and annotations for
all active operator tools without removing text JSON compatibility.

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

