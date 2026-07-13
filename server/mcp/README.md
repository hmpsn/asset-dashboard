# hmpsn.studio MCP Action Server

This directory implements the hmpsn.studio **MCP (Model Context Protocol) action server** — the
programmatic surface an AI agent (Claude.ai connector, Claude Code, or any MCP client) uses to
operate the agency platform: list and manage client workspaces, read intelligence/insights,
author and ship content, run keyword/SEO jobs, generate schema, and triage the inbox.

It is the canonical onboarding doc for the MCP surface. When you add, rename, or remove a tool,
update this file in the same commit.

---

## Overview

- **Endpoint:** `POST /mcp` (mounted in `server/app.ts` via `server/mcp/index.ts`). It is **not**
  behind the admin `APP_PASSWORD` gate — it carries its own Bearer-token auth (see [Auth](#auth)).
- **Transport:** MCP over **stateless Streamable HTTP**. `handleMcpRequest` (`server/mcp/server.ts`)
  builds a **fresh `Server` + `StreamableHTTPServerTransport` per request** (`sessionIdGenerator:
  undefined`, `enableJsonResponse: true`) — the SDK's stateless transport cannot be reused across
  requests (message-ID collisions), so tool definitions are declared once in the canonical
  `MCP_TOOL_REGISTRY` (`server/mcp/tool-registry.ts`) and applied to each new `Server` instance.
  Responses are returned as JSON-RPC objects, not SSE streams.
- **Handshake instructions:** every `initialize` response carries `MCP_SERVER_INSTRUCTIONS`
  (`server/mcp/instructions.ts`) — the agent-facing orientation string (workspace-id requirement,
  the casing split, the content-authoring handle pipeline, paid-API and destructive-tool warnings).
  Its concrete claims are asserted by `tests/unit/mcp-instructions.test.ts`; keep it in sync with
  the tool schemas.
- **Clients:** Claude.ai (remote MCP connector) and Claude Code connect over this endpoint with a
  Bearer token.
- **Server identity:** `{ name: 'hmpsn-studio', version: '1.0.0' }`.

### Workspace scope and parameter casing (gotcha)

Most tools operate on **one** client workspace. Two tools are explicitly global and therefore
master-key only: `list_workspaces` and `create_workspace`. `get_pending_work` has a declared,
optional `workspaceId`; omitting it requests a cross-workspace summary and is also master-key only.

For workspace-scoped tools, the parameter name is **not** uniform:

- Most tools use **`workspace_id`** (snake_case).
- A number of **read** tools use **`workspaceId`** (camelCase): `get_workspace_overview`, insights,
  intelligence, the content analysis reads (`get_content_decay` / `get_keyword_analysis` /
  `get_seo_context` / `get_content_performance`), client signals (`get_client_signals` /
  `get_pending_work`), and brand (`get_brand_identity` / `update_brand_deliverable`).

Match each tool's own schema. The registry records the one workspace field each tool actually
declares and rejects conflicting aliases, so an undeclared decoy field cannot authorize access to
a sibling workspace.

---

## Auth

Auth is **fail-closed** at every step. Implemented in `server/mcp/auth.ts` (`mcpAuthMiddleware`) and
`server/mcp/api-keys.ts`; the per-workspace scope is enforced at the canonical registry execution
boundary (`executeMcpTool` in `server/mcp/tool-registry.ts`).

Send the key as a Bearer token: `Authorization: Bearer <key>`.

| Key | Source | Scope | Notes |
|-----|--------|-------|-------|
| **Master key** | env `MCP_API_KEY` | `all` (every workspace) | Constant-time compared. Backward-compatible; no per-key label. If `MCP_API_KEY` is unset it never matches an empty/absent token. |
| **Per-workspace key** | `mcp_api_keys` table (sha256-hashed) | exactly **one** workspace | Plaintext shown **once** at creation (`mcp_` prefix, 32 bytes base64url). Only the hash is stored. Revocable via `revoked_at` (idempotent) — this is how rotation works. `last_used_at` is touched on each authenticated call. |

### Scope enforcement (security-critical)

For a per-workspace key (`auth.scope !== 'all'`), `executeMcpTool` checks the workspace field
declared by the registered tool **after** parsing, because the workspace id lives in the JSON body,
not a header/URL. Fail-closed:

- **Cross-workspace** id (`argWorkspaceId !== auth.scope`) → rejected.
- **Explicit global tools** (`list_workspaces`, `create_workspace`) → rejected for scoped keys.
- **Optional workspace field omitted** (`get_pending_work`) → rejected for scoped keys, since a
  workspace key must not enumerate across all workspaces.
- **Conflicting `workspaceId` / `workspace_id` aliases** → rejected for every caller.

The master key (`scope: 'all'`) bypasses both checks.

> The `mcp_api_keys` table is created by migration `163-mcp-api-keys.sql`. The store API
> (`createMcpApiKey`, `listMcpApiKeys`, `findActiveKeyByHash`, `revokeMcpApiKey`, `touchLastUsed`,
> `hashMcpApiKey`) lives in `server/mcp/api-keys.ts`. Plaintext is unrecoverable after creation — a
> lost key must be rotated, not recovered.
>
> Operators mint / list / revoke per-workspace keys from the dashboard at **Settings → MCP API Keys**
> (`src/components/McpApiKeysSettings.tsx` → `GET/POST/DELETE /api/admin/mcp-api-keys`, HMAC-only).

Workspace mutations retain an internal MCP execution attribution record: bounded request
correlation id, tool name, target workspace, and authenticated key id/label. That identity is
available to operators in the durable activity log but is stripped from client-facing activity
projections and workspace live broadcasts. Request correlation is diagnostic only—never an
idempotency or uniqueness authority. The server generates the UUID used by HTTP logs, the response
header, and durable attribution; every caller-supplied `X-Request-ID` value is ignored rather than
retained, reflected, or classified by a finite credential denylist.

### Error compatibility

The registry assigns each tool an explicit error contract:

- The existing **61 tools** remain `legacy_text`; registered handler-owned responses are unchanged.
  Registry-owned unknown-tool and authorization rejections are deliberately generic so caller
  tool/workspace values cannot be reflected as secrets.
- New tools use `json_v1`: an error is a text content item containing a JSON
  `{ code, message, retryable, details? }` envelope.

`server/mcp/tool-errors.ts` builds and privately marks the `json_v1` response and filters optional
details as defense in depth. The registry rejects any JSON-tool error that did not cross that
constructor, including a raw handler result, and maps thrown failures to the generic envelope.
Raw arguments, prompts, evidence, secrets, exception messages, and stacks must enter neither MCP
responses nor registry logs. Registry rejection logs use only registered tool names and stable
failure classes; unknown names and mismatched workspace values are never logged or reflected.

---

## Tool inventory

`MCP_TOOL_REGISTRY` (`server/mcp/tool-registry.ts`) is the single authority for discovery,
dispatch, workspace scope, and error compatibility. It composes **13 categories** for a total of
**61 tools**. Each category remains a `*Tools: Tool[]` array + a `handle*Tool(name, args, context?)`
dispatcher in `server/mcp/tools/<category>.ts`; the registry snapshots immutable definitions and
connects each one to its category handler. A production dispatch census calls every registered
name with inert invalid input, asserts the exact 13 family-array→handler identities, and pins the
handled-name manifests for families that validate workspace input before dispatch. Discovery
therefore cannot silently outgrow or be paired with the wrong family switch.

Legend: **W** = write/mutation (broadcasts + logs activity), **R** = read-only, **[Paid API]** =
increments the paid-call counter.

### workspaces (`tools/workspaces.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `list_workspaces` | R | List all workspaces with tier + pending-work counts. (No `workspace_id` → master-key only.) |
| `get_workspace_overview` | R | Snapshot of one workspace: health, tier, pending counts, portal URL. |
| `create_workspace` | W | Create a workspace for onboarding/automation. |
| `update_workspace` | W | Update a workspace via an allowlist of safe operational fields. |
| `delete_workspace` | W | Delete a workspace (requires `confirm: "delete_workspace"`). **Destructive.** |

### intelligence (`tools/intelligence.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_workspace_intelligence` | R | Full intelligence bundle (same context AdminChat uses). [Paid API] only when `enrich_with_backlinks` or `resolve_entity_references` is set. Pass `slices` to shrink the response. |

### insights (`tools/insights.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_insights` | R | Stored insights, optionally filtered by type/domain. |
| `get_anomalies` | R | Detected anomalies (`anomaly_digest`); unresolved by default. |
| `get_unresolved_insights` | R | Unresolved insight queue, impact-ordered. |
| `resolve_insight` | W | Mark one insight `resolved`/`in_progress` (records an outcome baseline). |
| `bulk_resolve_insights` | W | Resolve up to 100 insights in one call. |

### content (`tools/content.ts`) — read-only analysis
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_content_decay` | R | Pages losing organic traffic, sorted by decay severity. |
| `get_keyword_analysis` | R | Keyword gaps, topic clusters, cannibalization, lost-visibility queries. |
| `get_seo_context` | R | SEO context slice: domain health, brand voice, business context, GSC signals. |
| `get_content_performance` | R | Post/request performance with GSC + GA4 metrics and brief coverage. |

### brand (`tools/brand.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_brand_identity` | R | Structured brand identity + voice status; `includeDeliverables:true` adds every deliverable with `version`. |
| `update_brand_deliverable` | W | Edit a deliverable's content. Optimistic concurrency via `expectedVersion`; resets to `draft`. |

### clients (`tools/clients.ts`) — inbox / client signals
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_client_signals` | R | Portal engagement: last login, response rate, flagged concerns. |
| `get_pending_work` | R | Pending approvals/requests/actions. **Omit `workspaceId`** for a cross-workspace summary (master-key only). |
| `respond_to_client_action` | W | Update a client action's status (completed/archived/approved/changes_requested/pending). |
| `respond_to_approval_item` | W | **Decline / request changes only** on one approval item — an agent CANNOT approve on the client's behalf. |

### keyword-actions (`tools/keyword-actions.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `research_keywords` | R | **[Paid API]** — one paid call per term. Issues a `research_handle` per term. |
| `add_keyword_to_strategy` | W | Persist a keyword to a page (consumes a `research_handle` or takes a raw term). |
| `get_keyword_strategy` | R | Read page-level keyword targeting (`lite` for a skinny payload). |
| `remove_page_keyword` | W | Remove keyword targeting for a page path. |
| `add_keywords_batch` | W | Batch upsert page-keyword entries. |
| `replace_keyword_strategy` | W | Replace the full page-keyword set. **Destructive.** |

### content-actions (`tools/content-actions.ts`) — authoring pipeline + lifecycle
| Tool | R/W | Purpose |
|------|-----|---------|
| `list_briefs` | R | List briefs with `revision` tokens. |
| `get_brief` | R | One brief + `revision` token. |
| `update_brief` | W | Patch/replace a brief (`expected_revision` conflict check). |
| `list_posts` | R | List posts with `revision` tokens. |
| `get_post` | R | One post + `revision` token. |
| `update_post` | W | Patch/replace a post (`expected_revision` conflict check). |
| `prepare_brief_context` | R | Build brief-writing context + brand voice; **issues `brief_request_handle`**. |
| `save_brief` | W | Persist a brief (consumes `brief_request_handle`); **issues `brief_handle`**. |
| `prepare_post_context` | R | Build post-drafting context from a saved brief; **issues `post_request_handle`**. |
| `save_post` | W | Persist a post (consumes `post_request_handle`); **issues `post_handle`**. |
| `send_to_client` | W | Turn a saved brief/post into a client-facing request **and email the client**. |
| `list_content_requests` | R | List content topic requests. |
| `get_content_request` | R | One content request by id. |
| `create_content_request` | W | Create a content topic request. |
| `advance_content_status` | W | Operator workflow: `in_progress` / `delivered`. |
| `publish_post` | W | Publish to the **LIVE** Webflow site. Post MUST be `approved`. **Irreversible, client-visible.** |
| `delete_brief` | W | Delete a brief. **Destructive.** |
| `delete_post` | W | Delete a post. **Destructive.** |
| `list_post_versions` | R | List a post's historical versions. |
| `revert_post_version` | W | Revert a post to a prior version. **Destructive.** |

### recommendation-actions (`tools/recommendation-actions.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `list_recommendations` | R | Recommendations; defaults to the ACTIVE set (`filter:'all'` for full history). |
| `apply_recommendation` | W | Curation lifecycle: `send` / `throttle` (needs `throttle_days`) / `strike`. |

### content-generation-actions (`tools/content-generation-actions.ts`) — server-side grounded generation
| Tool | R/W | Purpose |
|------|-----|---------|
| `start_brief_generation` | W | **[Paid API]** Background job: full research-backed brief generation. Returns `job_id`. |
| `start_post_generation` | W | **[Paid API]** Background job: full post generation from a saved brief. Returns `job_id`. |

### schema-actions (`tools/schema-actions.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `generate_schema` | W | Generate JSON-LD `@graph` for a page + validation findings; persists to the snapshot (does not publish). |
| `validate_schema` | R | Validate structural + Google Rich Results rules (`page_id` or raw `schema_json`). |
| `publish_schema` | W | Publish schema to the **LIVE** site. **Validate-first**: refuses to publish on validation errors. |

### analytics-read-actions (`tools/analytics-read-actions.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_search_performance` | R | Read GSC clicks, impressions, CTR, position, daily trend, top queries/pages, and optional previous-period comparison for an explicit or trailing date range. |

### job-actions (`tools/job-actions.ts`) — background jobs
| Tool | R/W | Purpose |
|------|-----|---------|
| `start_keyword_strategy_generation` | W | **[Paid API]** Background keyword-strategy job. Returns `job_id`. |
| `start_seo_audit` | W | Background SEO audit job. Returns `job_id`. |
| `start_local_seo_refresh` | W | **[Paid API]** Background local-SEO visibility refresh. Returns `job_id`. |
| `get_job_status` | R | Status + latest payload for one job (workspace-scoped). |
| `list_jobs` | R | Recent jobs for a workspace. |
| `cancel_job` | W | Cancel a running job. |

---

## Handle pipeline

Large or multi-step tool outputs are returned as an opaque **handle** (a short token) instead of a
giant inline blob; a follow-up tool redeems it. Implemented in `server/mcp/handles.ts`.

**Issue → redeem protocol**

- **Issuers:** `research_keywords` (`keyword-research`), `prepare_brief_context` (`brief-request`),
  `save_brief` (`brief`), `prepare_post_context` (`post-request`), `save_post` (`post`).
- **Consumers:** `add_keyword_to_strategy` (research handle), `save_brief` (brief-request handle),
  `save_post` (post-request handle), `send_to_client` (brief/post handle).

Canonical content-authoring flow:

```
prepare_brief_context  → brief_request_handle ─┐
                                               ▼
                          save_brief  → brief_handle ─┐
prepare_post_context  → post_request_handle ─┐        │
                                             ▼        │
                          save_post   → post_handle ─┤
                                                      ▼
                          send_to_client  (request created + client emailed)
```

**Durability & guarantees**

- **Durable:** stored in the `mcp_handles` SQLite table (created by migration
  `162-mcp-handle-store.sql`) — survives restart and works across multiple server instances.
- **TTL:** ~15 minutes (`DEFAULT_TTL_MS`). A background sweeper deletes expired rows every 5
  minutes (`.unref()`'d; off under `NODE_ENV=test`).
- **`MAX_HANDLES`:** capped at 10,000 (override via `MCP_MAX_HANDLES`); the oldest rows are evicted
  by insertion order when the cap is exceeded.
- **Single-use:** a successful `consumeHandle` deletes the row.
- **Scoped:** each handle is bound to one **workspace** and one **kind**; a kind or workspace
  mismatch is rejected.

**If a handle errors as not-found or expired, re-run the tool that produced it** — never retry the
consumer with a stale handle.

---

## Paid-call metering

`server/mcp/paid-call-counter.ts` records calls to paid external providers. It is
**informational only — no hard cap, no refusal of calls** (owner decision).

- **Durable:** counts live in the `mcp_paid_call_counts` SQLite table (migration
  `162-mcp-handle-store.sql`), so the signal survives restarts and spans instances.
- **Global + per-workspace:** every paid call increments the global aggregate (synthetic
  `__global__` key) and, when a `workspaceId` is supplied, that workspace's counter.
- **Warn threshold:** default **100** (override via `MCP_PAID_CALL_WARN_AFTER`). Once the **global**
  count reaches the threshold, paid-tool responses include an informational `warning` string. The
  call still proceeds.

**Metered (paid) tools** — those marked `[Paid API]` and calling `recordPaidCall()`:

- `research_keywords` (one paid call **per term**)
- `start_keyword_strategy_generation`
- `start_local_seo_refresh`
- `start_brief_generation`
- `start_post_generation`
- `get_workspace_intelligence` — only when `enrich_with_backlinks` or `resolve_entity_references`
  is set (per the handshake instructions; the counter is incremented inside the enrichment path).

---

## Rate limiting

The `/mcp` endpoint has its own per-IP limiter (`mcpLimiter` in `server/middleware.ts`, wired in
`server/app.ts`):

- **Default:** **120 requests / minute / IP** — generous for a normal multi-step agent workflow,
  meant to bound a runaway agent loop or a leaked-key abuser.
- **Override:** env `MCP_RATE_LIMIT_PER_MIN`.
- Applied as a top-level path check (not an `app.use('/mcp', ...)` mount) so `req.path` stays the
  full `/mcp` and the limiter keys a dedicated `${ip}:/mcp` bucket (no collision with the
  `/api/public/` limiters). **Skipped under `NODE_ENV=test`** (high-volume integration tests from
  one IP would legitimately exceed it; the limiter is unit-tested directly).

---

## Adding a tool

Four steps, all in the same commit:

1. **Define the input schema** in `shared/types/mcp-action-schemas.ts`. Every top-level property
   needs a `.describe()` (enforced by the contract test below). Build the MCP JSON Schema with
   `toMcpJsonSchema(...)`.
2. **Add the tool def + handler** in the right `server/mcp/tools/<category>.ts` file: push a
   `{ name, description, inputSchema }` entry onto the category's `*Tools` array and add a `case`/`if`
   branch to its `handle*Tool` dispatcher. Validate args with the Zod schema, return
   `mcpSuccess(...)`; legacy tools keep `mcpError(...)`, while new `json_v1` tools use
   `mcpJsonV1Error(...)` with a stable public envelope. If the family validates workspace/external
   state before switching on `name`, also update its exported handled-name manifest; the census
   requires that manifest to equal the advertised definitions.
3. **Register compatibility in `server/mcp/tool-registry.ts`.** A new category supplies its name,
   definitions, handler, global-tool declarations (normally none), and default error contract once.
   A new `json_v1` tool added to an existing legacy category adds its name to that registration's
   `errorContractOverrides`. Discovery, scope resolution, and dispatch are derived from the one
   registration; do not add a second spread or dispatch chain.
4. **Register in the tests** so coverage stays complete:
   - `tests/contract/mcp-tool-input-schema-properties.test.ts` (every top-level schema prop is
     `.describe()`'d)
   - `tests/contract/mcp-tool-dispatch-census.test.ts` (every discovered name reaches its handler)
   - `tests/unit/mcp-tool-registry.test.ts` (registry invariants and category routing)
   - `tests/unit/mcp-server-routing.test.ts` (the transport delegates to the registry)

**pr-check guardrails to respect inside `server/mcp/tools/`:**

- **No raw `stmts().run(...)` writes** in tool files — route DB writes through the owning service
  module (the same path the admin routes use), never raw statements in MCP handlers.
- **`addActivity(...)` must tag `{ source: 'mcp-chat' }`** so MCP-originated activity is attributable.
- **Write paths must broadcast** — every mutation calls `broadcastToWorkspace(...)` with a
  `WS_EVENTS.*` constant (never an inline string literal), and invalidates intelligence/pipeline
  caches where relevant, so admin and client UIs stay live.

Use the shared helpers in `server/mcp/tool-helpers.ts` (`requireWorkspace`, `mcpSuccess`,
`mcpError`, `zodErrorToMcp`, `buildDashboardUrl`) rather than hand-rolling responses. `mcpError`
and `zodErrorToMcp` are legacy-only; a `json_v1` handler uses the constructors in
`server/mcp/tool-errors.ts` so the registry can verify the result.
