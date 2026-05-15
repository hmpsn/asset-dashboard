# MCP Server — Design Spec

**Date:** 2026-05-15  
**Status:** Draft  
**Author:** Joshua Hampson

---

## Overview

Add a Model Context Protocol (MCP) server to the existing Express backend so AI agents — primarily Claude.ai and Claude Code — can read workspace intelligence data without opening the dashboard. The v1 scope is read-only: ~10 tools that expose the same intelligence layer that already powers AdminChat. Action tools (content rewrites, audit triggers, approvals) are explicitly out of scope for v1 and will be designed separately.

The driving use case is operator-level access: Joshua connecting his own Claude sessions to query workspace health, surface insights, diagnose client issues, and feed data into ad-hoc content work (e.g., identifying decaying pages before rewriting them in the Claude interface).

---

## Architecture

### Approach: Intelligence Facade

MCP tools call `buildWorkspaceIntelligence()` and the existing intelligence slice functions directly — the same layer that powers AdminChat and the AI context assembly. No new data access patterns. No changes to existing routes or frontend code.

### Module layout

```
server/mcp/
  server.ts        — MCP SDK Server instance, tool registration, Express mount
  auth.ts          — Bearer token middleware (validates MCP_API_KEY)
  index.ts         — mounts the MCP router on app at POST /mcp
  tools/
    workspaces.ts  — list_workspaces, get_workspace_overview
    intelligence.ts — get_workspace_intelligence
    insights.ts    — get_insights, get_anomalies
    content.ts     — get_content_decay, get_keyword_analysis, get_seo_context
    clients.ts     — get_client_signals, get_pending_work
```

All new code is isolated inside `server/mcp/`. Existing files touched: `server/app.ts` (route registration only).

### Data flow

```
Claude.ai / Claude Code
  → POST /mcp  (Authorization: Bearer <MCP_API_KEY>)
    → server/mcp/auth.ts          validates token
    → server/mcp/server.ts        MCP SDK routes to tool handler
    → server/mcp/tools/*.ts       tool calls slice functions
    → buildWorkspaceIntelligence() / assemble*() slice functions
    → SQLite (direct read, WAL mode)
    → structured tool response back to Claude
```

### Dependency

One new npm dependency: `@modelcontextprotocol/sdk`. No other new deps.

---

## Transport

**`StreamableHTTPServerTransport`** — the current MCP SDK standard for HTTP servers. Single `POST /mcp` endpoint; responses stream back in the same connection. Works with both Claude.ai and Claude Code without SSE complexity or separate request/response endpoints.

Clients configure the server once in their MCP settings:
- **Server URL:** `https://<your-domain>/mcp`
- **Auth header:** `Authorization: Bearer <MCP_API_KEY>`

---

## Authentication

### v1 — Operator key

A single `MCP_API_KEY` environment variable set in Render (never committed). `server/mcp/auth.ts` reads `Authorization: Bearer <key>` from the request header and returns `401 { error: "Unauthorized" }` if it is missing or incorrect. All tools are accessible to a valid operator key — no further scoping in v1.

Key management: generate with `openssl rand -hex 32`, store in Render env vars and in your local MCP client config. Rotate by changing the env var and redeploying.

### v2 — Workspace-scoped client tokens (future)

When rolling out to clients, add a `mcp_tokens` table:

```sql
CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER
);
```

The auth middleware checks whether the incoming token is the operator key (full access) or a workspace-scoped token (restricted to that workspace's data). Tool definitions do not change — scope enforcement lives entirely in `auth.ts` and is passed as context to the tool handler. This is a clean two-tier extension with no tool-layer changes.

---

## Tool Inventory

All tools are read-only in v1. Parameters use Zod schemas validated by the MCP SDK.

### Workspace tools (`tools/workspaces.ts`)

**`list_workspaces`**  
All workspaces with health score, tier, trial status, and pending item counts. The "which client needs attention right now?" scan across the portfolio.  
Params: none  
Data source: `workspaces` table + health score assembly

**`get_workspace_overview`**  
Detailed single-workspace snapshot: health breakdown, tier, pending approvals count, recent activity entries, active feature flags.  
Params: `workspaceId: string`  
Data source: existing workspace overview query + activity log

### Intelligence tools (`tools/intelligence.ts`)

**`get_workspace_intelligence`**  
Full intelligence bundle — identical to what `buildWorkspaceIntelligence()` assembles for AdminChat. Includes SEO context, content signals, client signals, brand voice block, and keyword context. Use when you need complete context before making a decision about a workspace.  
Params: `workspaceId: string`, `slices?: string[]` (default: all)  
Data source: `buildWorkspaceIntelligence()` in `server/workspace-intelligence.ts`

### Insight tools (`tools/insights.ts`)

**`get_insights`**  
Stored insights for a workspace, optionally filtered by insight type (quick-win, risk, opportunity, etc.) and limited by count. Returns the insight title, summary, and associated data payload.  
Params: `workspaceId: string`, `type?: InsightType`, `limit?: number` (default: 20)  
Data source: `insights` table via existing query functions

**`get_anomalies`**  
Detected anomalies for a workspace — traffic drops, rank changes, indexation issues. Returns unresolved anomalies by default.  
Params: `workspaceId: string`, `resolved?: boolean` (default: false)  
Data source: `anomalies` table via existing query functions

### Content & SEO tools (`tools/content.ts`)

**`get_content_decay`**  
Pages losing organic traffic over time, sorted by decay severity. The starting point for rewrite prioritization — surfaces which pages to address first.  
Params: `workspaceId: string`, `limit?: number` (default: 20)  
Data source: `content_decay` table via existing slice

**`get_keyword_analysis`**  
Keyword gaps, cannibalization conflicts, and topic cluster coverage for a workspace. The "what should we be writing about?" read before content planning.  
Params: `workspaceId: string`  
Data source: keyword strategy tables via existing slice

**`get_seo_context`**  
Domain health, indexation status, GSC ranking signals, and site architecture summary. Use before any content or schema work to understand the site's current SEO state.  
Params: `workspaceId: string`  
Data source: `SeoContextSlice` via `buildWorkspaceIntelligence()`

### Client signal tools (`tools/clients.ts`)

**`get_client_signals`**  
Client portal engagement: last login, decision response rate, flagged concerns, conversation activity. The "how is this client feeling about the engagement?" read.  
Params: `workspaceId: string`  
Data source: `ClientSignalsSlice` via `buildWorkspaceIntelligence()`

**`get_pending_work`**  
All pending approvals, content requests, and client actions for a workspace — or across all workspaces when no `workspaceId` is provided. The cross-portfolio inbox read.  
Params: `workspaceId?: string` (omit to query all workspaces)  
Data source: `approvals`, `content_requests`, `client_actions` tables

---

## Error Handling

Tool errors are returned as structured MCP error objects — the SDK handles wire format. Each tool wraps its data access in try/catch and returns a descriptive error message on failure (e.g., `"Workspace not found: <id>"`, `"Intelligence slice unavailable — check server logs"`). Claude surfaces these as tool call failures with explanations rather than opaque crashes.

Specific cases:
- Unknown `workspaceId` → `"Workspace not found: <id>"` (does not reveal whether other workspaces exist)
- Intelligence assembly failure → falls back to partial data where possible, errors on catastrophic failures
- Missing `MCP_API_KEY` env var at startup → server logs a clear warning; auth middleware returns 401 for all requests

---

## Testing

**File:** `tests/integration/mcp.test.ts`  
**Port:** 13357 (next available after current high-water mark of 13356)

Test coverage:
1. **Auth rejection** — missing `Authorization` header returns 401; wrong key returns 401; correct key passes through
2. **`list_workspaces`** — returns array with expected shape (id, name, healthScore, tier, pendingCount)
3. **`get_workspace_overview`** — returns correct workspace data; unknown ID returns error object (not 500)
4. **`get_workspace_intelligence`** — returns non-empty intelligence bundle for a seeded workspace
5. **`get_insights`** — returns insights array; `type` filter narrows results; empty result is valid
6. **`get_anomalies`** — returns unresolved anomalies by default; `resolved: true` flips to resolved
7. **`get_content_decay`** — returns decay array sorted by severity; `limit` is respected
8. **`get_keyword_analysis`** — returns gaps + clusters structure
9. **`get_seo_context`** — returns SEO context shape with expected fields
10. **`get_client_signals`** — returns engagement signals object
11. **`get_pending_work`** — without workspaceId returns cross-workspace array; with workspaceId filters correctly

Uses existing `seedWorkspace()` / `seedWorkspace().cleanup()` pattern. No new test infrastructure needed.

---

## Out of Scope (v1)

The following are explicitly deferred to a future action-tools phase:

- `create_content_request`
- `approve_batch`
- `trigger_audit`
- `send_to_client`
- `rewrite_page` / `apply_seo_suggestion`
- Per-client MCP token management UI
- Rate limiting (operator-only v1 doesn't need it; add before client rollout)

---

## Post-Ship Checklist

- [ ] `MCP_API_KEY` added to Render environment variables (staging + production)
- [ ] `FEATURE_AUDIT.md` updated with MCP server entry
- [ ] `data/roadmap.json` updated
- [ ] Connection verified in Claude.ai MCP settings against staging URL
- [ ] Connection verified in Claude Code via `.claude/settings.json` MCP config
- [ ] `npm run typecheck && npx vite build && npx vitest run` all green
- [ ] `npx tsx scripts/pr-check.ts` zero violations
