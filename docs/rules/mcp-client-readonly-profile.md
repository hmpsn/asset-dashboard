# MCP Client Read-Only Profile

This is the cross-phase contract for the client-facing MCP transport. The
primary bounded context is `platform-foundation`; `analytics-intelligence` and
`integrations` own the read models and Google provider adapters it exposes.

## Permanent boundary

- `POST /mcp/client` is the single client endpoint. Clients configure it once
  with a unique credential bound to one workspace.
- A durable client credential authenticates only at `/mcp/client`. It is
  rejected at `/mcp` and `/mcp/operator`; full credentials and the environment
  master key are rejected at `/mcp/client`.
- Endpoint discovery and invocation use one canonical client allowlist.
  Registered-but-hidden and unknown tools return the same generic `not_found`
  result without reaching a handler.
- Every client tool is aggregate, read-only, idempotent, non-destructive,
  non-paid, and bounded to connected workspace data. A contract census enforces
  those properties. Tool annotations are descriptive; the allowlist and
  credential binding are the authorization boundary.
- Client discovery omits workspace identifiers. Invocation rejects
  caller-supplied `workspace_id` and `workspaceId`, then injects the workspace
  from the authenticated credential before canonical authorization and handler
  validation.
- Client success results retain legacy text JSON and also return validated
  `structuredContent: { data: ... }` under an explicit root-object output
  schema.
- Client results and logs never expose credentials, provider tokens, raw
  provider errors, user identifiers, prompts, evidence, or unbounded provider
  response bodies.

## Task dependencies and ownership

Sequential:

1. Shared profile/key/schema contracts and migration.
2. Credential store/auth/API implementation.
3. Client discovery/dispatch projection and HTTP transport.
4. Integrated contract and HTTP verification.

PR2 begins only after PR1 is merged to staging and its credential boundary is
smoke-tested. Provider adapters and fixtures may then proceed in parallel under
exclusive file ownership before one sequential MCP integration pass.

## PR1 → PR2 contracts

### Storage

- `mcp_api_keys.profile` is `full | client`, non-null, and defaults legacy rows
  and omitted creation requests to `full`.

### Shared types

- `MCP_SERVER_PROFILES.CLIENT` / `McpServerProfile`.
- `MCP_API_KEY_PROFILES` / `McpApiKeyProfile`.
- Workspace-free client analytics input schemas and root `{ data }` output
  schemas from `shared/types/mcp-client-analytics.ts`.

### Runtime

- `/mcp/client` accepts only active workspace credentials whose durable profile
  is `client`.
- `MCP_CLIENT_TOOL_NAMES` is the sole discovery and dispatch allowlist.
- PR1 activates only `get_search_performance`; PR2 expands the same allowlist to
  exactly six analytics/search tools.

## PR1 acceptance

- Legacy keys remain `full` and continue to work at `/mcp`.
- Client credentials work only at `/mcp/client`.
- Client discovery contains only `get_search_performance`, with no workspace
  field and an explicit output schema/read-only annotation contract.
- The server injects credential workspace scope; forged or inherited workspace
  aliases are rejected before dispatch.
- Hidden mutation tools return generic `not_found` and never reach handlers.
- No UI, provider mutation, AI, paid call, job, approval, send, publication,
  database synchronization, or staging-data replacement occurs.

## PR2 acceptance

- The client allowlist contains GSC plus five bounded GA4 read tools.
- GA4 campaign attribution is explicitly session-scoped; period comparisons
  return exact ranges; page-view and landing-page results remain separate.
- Key events use GA4 key-event authority. Existing pinned `eventConfig`
  supplies only exact event-name/display-name mappings; unmatched events are
  never assigned inferred business meaning.
- Outputs retain bounded data-quality and freshness metadata and fail safely on
  incompatible or failed provider reports.
