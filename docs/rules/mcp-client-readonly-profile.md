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
- Every POST transport (`/mcp`, `/mcp/operator`, and `/mcp/client`) applies the
  same MCP-specific per-IP limiter before authentication. The limiter owns one
  shared MCP bucket across profiles; GET and DELETE remain cheap 405 responses
  and do not consume the POST budget.
- Durable MCP bearer tokens are opaque credentials generated from 32 bytes of
  cryptographically secure random entropy. SHA-256 is used only as a
  deterministic lookup fingerprint for those high-entropy tokens; it is not a
  password-derived credential scheme. Plaintext is returned once, never
  persisted, and rotation/revocation remain the recovery boundary.

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

### PR2 fixed GA4 provider contract

- Every dimension, metric, filter, ordering, and provider limit is owned by the
  server. Client inputs never accept GA4 report schemas, property IDs, arbitrary
  filters, or provider URLs.
- Client GA4 adapters validate exact response headers, row widths, numeric
  values, row counts, and safe response metadata. Missing or incompatible
  provider fields fail with a generic MCP error; they never become plausible
  zero-valued success results.
- `get_ga4_campaign_performance` uses `sessionCampaignName` and labels its
  attribution scope `session_campaign`.
- `get_ga4_traffic_sources` uses session-scoped source and medium dimensions.
- `get_ga4_key_events` uses metric `keyEvents` with an exact
  `isKeyEvent == "true"` filter. The similarly named legacy all-event helper is
  not valid authority for this client tool.
- `get_ga4_content_performance` executes separate `pagePath`/views and
  `landingPage`/sessions reports and never joins the two scopes.
- A shared UTC range resolver defaults trailing reads through yesterday.
  Exact dates are paired, inclusive, valid calendar dates, and bounded to 366
  days. `days` cannot be mixed with an exact range.
- Comparison modes are explicit. `previous_period` uses the immediately
  preceding equal-length window; `year_over_year` shifts calendar boundaries
  by one year and clamps February 29 to February 28; `custom` requires a
  bounded equal-length comparison range. Relative change is `null` when its
  comparison denominator is zero.
- Only an exact pinned `eventConfig.eventName` match supplies its exact
  `displayName`. Duplicate configured names degrade to an unmapped/attention
  result. Generic `click` always returns `needs_attention` until destination
  filter authority exists, even when it has a pinned display label.
- GA4 provider logging records only a safe report kind, failure
  classification, sanitized status, and retryability. It never records the
  property ID, request body, exception object, endpoint, provider body, or
  credentials.
