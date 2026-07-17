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
- P1 reserves 25 names. The three P2 read models are intentionally absent from
  discovery until their registry entries exist; no placeholder handler or stub
  response is allowed.
- Compact discovery may replace top-level prose and remove nested JSON-Schema
  `description` metadata. It must preserve names, schema types, properties,
  required fields, enums, bounds, patterns, unions, defaults, and every other
  validation keyword. The full-profile definitions are never mutated.
- Operator discovery JSON plus initialize instructions is at most 32 KiB UTF-8.
  Measurement uses the exact JSON-serialized `tools` array and exact instruction
  string returned by the server.

## P1 operator tool-name contract

The canonical list lives in `server/mcp/profiles.ts`. P1 discovers the 22 names
already registered. P2 activates the three reserved read models:

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

- [ ] `/mcp` full discovery and initialize instructions are byte-identical to the
      pre-P1 baseline.
- [ ] `/mcp/operator` authenticates only the master key in P1.
- [ ] Operator discovery is exactly the registered intersection of the canonical
      25-name allowlist.
- [ ] A hidden registered tool returns `not_found` and its handler is not called.
- [ ] Compact projection preserves every non-description schema field.
- [ ] Discovery plus instructions is no more than 32 KiB UTF-8.
- [ ] Existing workspace keys and `/mcp` calls remain compatible.
- [ ] No UI, database, paid-call, generation, approval, send, or publication
      behavior changes.

