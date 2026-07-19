# MCP Operator Control Plane

This is the cross-phase contract for the compact desktop operator surface. The
primary bounded context is `platform-foundation`; content, brand, client-portal,
analytics-intelligence, and workspace-command-center remain owners of the tools
and read models exposed through it.

## Profile invariants

- `POST /mcp` is the backward-compatible full profile. Its instructions,
  discovery definitions, invocation behavior, and existing key support remain
  unchanged unless a later phase explicitly adds compatible metadata.
- `POST /mcp/operator` is additive. In P1 it requires the environment master key;
  P5 may additionally admit DB-backed all-workspace operator credentials.
- `McpServerProfile` is transport policy, not authorization. Credential scope,
  workspace scope, capability policy, paid-work gates, human review, send,
  approval, and publication checks remain independently mandatory.
- One canonical operator allowlist controls both discovery and invocation.
  Invoking a registered but hidden tool returns the same generic `not_found`
  envelope as a nonexistent tool and never reaches its handler.
- The canonical profile contains 25 registered names. P1 initially exposed 22;
  P2 activated the three real read models without placeholder handlers or stubs.
- Compact discovery may replace top-level prose and remove nested JSON-Schema
  `description` metadata. It must preserve names, schema types, properties,
  required fields, enums, bounds, patterns, unions, defaults, and every other
  validation keyword. The full-profile definitions are never mutated.
- Operator discovery JSON plus initialize instructions is at most 32 KiB UTF-8.
  Measurement uses the exact JSON-serialized `tools` array and exact instruction
  string returned by the server.

## P1 operator tool-name contract

The canonical list lives in `server/mcp/profiles.ts`. P2 exposes all 25 names,
including these three deterministic read models:

- `get_portfolio_brief`
- `get_workspace_decision_brief`
- `get_client_view`

No other tool may appear on `/mcp/operator` without amending this rule, the
program plan, the allowlist census, and the discovery/invocation tests together.

## Cross-phase exports

### P1 → P2

- `McpServerProfile` and `MCP_SERVER_PROFILES` from
  `shared/types/mcp-runtime.ts`.
- `MCP_OPERATOR_TOOL_NAMES`, compact descriptions/instructions, and
  `isMcpToolAllowedInProfile()` from `server/mcp/profiles.ts`.
- Additive `/mcp/operator` transport boundary with master-key-only P1 auth.
- Profile-aware discovery and invocation enforcement through the canonical MCP
  registry; P2 registers real read models rather than changing routing.

### P2 → P3

- Three bounded, deterministic operator read models with explicit root-object
  output schemas and legacy text JSON plus `structuredContent`.
- Client view fails closed and reuses the public client-safe projection.
- Structured content is validated against the same Zod contract that produces
  its advertised output schema. Parsed legacy text equals `structuredContent.data`.
- Workspace decision assembly requests exactly `insights`, `contentPipeline`,
  `siteHealth`, `clientSignals`, and `operational` through the public intelligence
  facade. This is a narrow five-of-fifteen read model, not the full Insights Engine
  inventory. Missing slices are reported as unavailable, never interpreted as clear.
- Client-risk and pending-decision subreads carry their own availability state;
  an internally failed subread cannot be interpreted as an empty queue.
- The operational pending-decision projection is capped at 25 and contains only
  durable IDs, bounded labels, normalized priority, and creation time. It omits
  values, payloads, notes, prompts, evidence, and activity descriptions, and is
  not added to prompt formatters.
- Client-risk source refs use durable churn-signal IDs. No synthetic source ID is
  invented for aggregate site-health or pipeline blockers.

### P3 → P4

- Explicit output policies and annotations for every active operator tool.
- An operator census that fails when a newly active tool lacks either contract.

### P4 → P5

- Central workspace alias normalization occurs before authorization and handler
  validation. Handlers never resolve aliases independently.

### P5 → P6

- Exhaustive tool capability policy and DB-backed all-workspace operator
  credentials. The master key remains break-glass access.

### P6 → P7

- Bounded daily usage aggregates and an all-workspace operator usage report.
- Desktop prompts consume tools only; resources remain deferred.

## P1 acceptance checklist

- [x] `/mcp` full discovery and initialize instructions are byte-identical to the
      pre-P1 baseline.
- [x] `/mcp/operator` authenticates only the canonical master identity in P1.
- [x] Operator discovery is exactly the registered intersection of the canonical
      25-name allowlist.
- [x] A hidden registered tool returns `not_found` and its handler is not called.
- [x] Compact projection preserves every validation field, including fields named
      `description`, while removing schema annotation prose.
- [x] Discovery plus instructions is no more than 32 KiB UTF-8 (25,217 bytes).
- [x] Existing workspace keys and `/mcp` calls remain compatible.
- [x] No UI, database, paid-call, generation, approval, send, or publication
      behavior changes.

## P2 acceptance checklist

- [x] Portfolio defaults to 10, caps at 25, and has a total deterministic order
      independent of database row order.
- [x] Portfolio reason codes and drill-down IDs reconcile to exact pending counts.
- [x] Workspace decision view requests exactly the five purpose-selected slices and caps
      decisions, blockers, and risk signals at the caller limit (maximum 25).
- [x] Missing slices or failed queue/risk subreads produce explicit `data_unavailable` state and never an unsafe
      `no_action_required` hint.
- [x] Client view deep-equals the public tier-gated projection for free, trial,
      growth, and premium workspaces, including fail-closed learnings.
- [x] Parsed text JSON deep-equals `structuredContent.data`, and all three wrapper
      objects validate against their advertised root output schema.
- [x] Operator discovery exposes all 25 names and remains at or below 32 KiB
      (32,222 bytes including instructions).
- [x] Workspace keys cannot invoke the global portfolio tool or cross workspace;
      `/mcp/operator` remains master-key-only in P2.
- [x] No raw prompt/evidence/payload fields, provider/AI calls, paid triggers,
      jobs, mutations, broadcasts, sends, approvals, or publication paths.
- [x] No UI, migration, local/staging database sync, or staging-data replacement.
