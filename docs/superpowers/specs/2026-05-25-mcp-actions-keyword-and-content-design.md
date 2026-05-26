# MCP Actions — Keyword Research & Content Generation Design Spec

**Date:** 2026-05-25
**Status:** Draft
**Author:** Joshua Hampson
**Predecessor:** [2026-05-15-mcp-server-design.md](./2026-05-15-mcp-server-design.md) (read-only MCP v1)

---

## Overview

Extend the existing read-only MCP server (`server/mcp/`) with the first batch of **action tools** — write-capable tools that let Claude (via Claude Code or Claude.ai) do real work inside a workspace from chat: research keywords, add them to strategy, generate briefs/posts against a layout, send drafts to the client inbox, and trigger background jobs.

The driving use cases are operator-level:

1. *"Research this keyword for workspace X and add it to the strategy under the 'comparison' cluster."*
2. *"Here's a Webflow CMS template. Generate a brief for the topic 'best CRMs for solopreneurs', then a draft post against that template, and send it to the client for approval."*
3. *"Kick off a site health audit for workspace Y."*

This is **not** an in-app chat product. The user is in Claude Code or Claude.ai with the studio MCP connected; the chat model is Claude, paid via the user's Claude subscription. The MCP layer is a **context provider and validated persistence layer** — it does not orchestrate AI calls of its own for generation tasks.

---

## Architecture

### Core principle: MCP is a data layer, not an AI orchestrator

For generation tasks (briefs, posts), the MCP tool:

1. Assembles context using existing intelligence builders (`buildContentGenerationContext()`, voice profile, slices, learnings).
2. Returns the context bundle + layout schema + instructions to the chat.
3. The chat model (Claude) does the actual generation inline.
4. A separate `save_*` tool validates the generated output with Zod and persists via the existing service function.

For lookups that hit paid APIs (DataForSEO, SEMRush, Webflow reads), the MCP tool makes the call directly — the chat model can't reach those services.

For background jobs, the MCP tool calls the existing job-trigger function in `server/jobs.ts` and returns `{ jobId, dashboardUrl }`.

This split is the spine of every action: **MCP fetches data and persists results; Claude does the reasoning and writing.**

### Module layout

New code lives under `server/mcp/tools/` next to the existing read-only tool files:

```
server/mcp/
  server.ts           — existing
  auth.ts             — existing
  index.ts            — existing
  handles.ts          — NEW: in-memory handle store with TTL
  tools/
    workspaces.ts     — existing
    intelligence.ts   — existing
    insights.ts       — existing
    content.ts        — existing
    clients.ts        — existing
    keyword-actions.ts  — NEW: research_keyword, research_keywords_bulk, add_keyword_to_strategy
    content-actions.ts  — NEW: prepare_brief_context, save_brief, prepare_post_context, save_post, send_to_client
    job-actions.ts      — NEW: start_seo_strategy_generation, start_site_health_audit, start_local_seo_refresh, start_competitive_analysis
```

All existing read-only tools and routes are unchanged.

### Auth

Inherits the existing MCP bearer-token middleware (`server/mcp/auth.ts`). No new auth surface. Action tools live behind the same gate as read tools.

### Activity source tag

Every mutating tool logs activity with `source: 'mcp-chat'` so the in-platform activity feed makes the origin explicit. Requires extending the activity source enum in `shared/types/activity.ts` to include `'mcp-chat'`.

---

## Tool surface (v1)

**12 tools total** (3 keyword + 5 content + 4 job). Every tool's first argument is `workspace_id` — no implicit "current workspace" state.

### Keyword research (3 tools)

#### `research_keyword(workspace_id, term, market?)`
- **Cost:** `[Paid API]` — DataForSEO/SEMRush via `SeoDataProvider`.
- **Returns:** `{ research_handle, term, volume, difficulty, intent, top_serp_results[], market, warning? }`.
- `research_handle` is a short-lived (15 min, in-memory) reference that can be passed to `add_keyword_to_strategy`.
- After N paid calls in the current MCP session (default N=20), response includes `warning: 'paid_call_count: <n>'`. Does not block.

#### `research_keywords_bulk(workspace_id, terms[], market?)`
- **Cost:** `[Paid API, Bulk]` — tool description explicitly tells the model to confirm in chat before calling.
- **Returns:** `{ handles: [{ term, research_handle, ...metrics }], warning? }`.
- Same soft-cap counter as single-term research.

#### `add_keyword_to_strategy(workspace_id, research_handle | term, cluster?, priority?)`
- **Returns:** `{ keyword_id, dashboard_url }`.
- Writes via the existing keyword-strategy service (broadcasts `keyword-strategy:updated`, logs activity).
- If `research_handle` is given, attaches the cached metrics. If raw `term` is given, the keyword is added with `metrics_status: 'pending'` (existing field — same path the admin UI uses when adding without research).

### Content generation (5 tools)

#### `prepare_brief_context(workspace_id, topic, layout)`
- **No AI call inside the tool.**
- `layout` is `{ type: 'cms', template_id } | { type: 'outline', structure: TypedOutline }`.
- **Returns:** `{ context_block, layout_schema, instructions, brief_request_handle }`.
- `context_block` is the formatted voice profile + intelligence slices + learnings block from `buildContentGenerationContext()`.
- `layout_schema` is the Zod schema (as JSON Schema) the chat must produce against.
- `instructions` is a short prose block telling the chat model how to format the brief.
- `brief_request_handle` ties the eventual `save_brief` call back to this context (so we can attribute and audit).

#### `save_brief(workspace_id, brief_request_handle, content)`
- **Returns:** `{ brief_id, brief_handle, dashboard_url }`.
- Validates `content` against the brief Zod schema.
- Persists via existing content-brief service (broadcasts, activity log).
- `brief_handle` is a short-lived reference for `send_to_client`.

#### `prepare_post_context(workspace_id, brief_id | topic, layout)`
- **No AI call inside the tool.**
- Same shape as `prepare_brief_context` but for full post generation.
- If `brief_id` given, the context includes the brief as authoritative source.
- **Returns:** `{ context_block, layout_schema, instructions, post_request_handle }`.

#### `save_post(workspace_id, post_request_handle, content)`
- **Returns:** `{ post_id, post_handle, dashboard_url }`.
- Validates against post Zod schema.
- Persists as a draft via existing content-post service.

#### `send_to_client(workspace_id, brief_handle | post_handle, note?)`
- **Explicit commit step.** No `send: true` flag on save tools.
- Routes the draft to the client inbox Reviews section (per `docs/rules/inbox-section-routing.md`: briefs and posts are Reviews regardless of note presence).
- Broadcasts `client-actions:updated`, logs activity with `source: 'mcp-chat'`.
- **Returns:** `{ inbox_item_id, dashboard_url }`.

### Job triggers (4 tools)

All fire-and-forget. Return `{ jobId, dashboard_url }`. No streaming. The chat must clarify to the user that the job is running, not complete.

- `start_seo_strategy_generation(workspace_id)`
- `start_site_health_audit(workspace_id)`
- `start_local_seo_refresh(workspace_id)`
- `start_competitive_analysis(workspace_id)`

Each is a thin wrapper around the existing job-trigger function in `server/jobs.ts`. Job-type strings must already exist in `BACKGROUND_JOB_TYPES` (`shared/types/background-jobs.ts`); the spec does not introduce new job types.

---

## Handles

Short-lived in-memory references (`handles.ts`) used to chain tool calls without the model fabricating IDs.

- **Storage:** `Map<handleId, { kind, workspaceId, payload, createdAt }>` in MCP server memory.
- **TTL:** 15 minutes. Expired handles return a clear error: `"Handle expired. Re-run research/preparation."`.
- **Kinds:** `keyword-research`, `keyword-research-bulk`, `brief-request`, `brief`, `post-request`, `post`.
- **Loss on restart:** acceptable v1 tradeoff. If the MCP restarts mid-chat, the model is told to re-run the prep step.
- **No write tool accepts a raw DB id where a handle is expected** — handles carry the workspace scope and prevent cross-workspace mistakes.

---

## Cost & safety model

### Soft cap on paid lookups
- Per-MCP-session counter (in memory, resets on restart).
- Default threshold: 20 paid calls/session.
- Past threshold, response includes `warning: 'paid_call_count: <n>'`. Tool does **not** block.
- Bulk tools (`research_keywords_bulk`) explicitly tell the model to confirm in chat before calling, via tool description.

### No hard caps
- Real cost protection lives in DataForSEO/SEMRush billing alerts, not the MCP.
- Honor-system caps work for the current single-operator use case.

### Two-step send-to-client
- `save_brief`/`save_post` persist as drafts. They do **not** send.
- `send_to_client` is a separate explicit tool with its own confirmation surface in chat.
- A draft saved but never sent is still discoverable in the dashboard.

### Activity log clarity
- All MCP writes log with `source: 'mcp-chat'`.
- The activity feed UI must render this source distinctly (small badge) so the operator can audit which mutations came from chat vs the admin UI.

---

## Validation & schemas

Every `save_*` tool validates its payload with a Zod schema co-located with the tool. Schemas reference existing shared types where possible.

### Layout schemas

```
LayoutCms     = { type: 'cms',     template_id: string }
LayoutOutline = { type: 'outline', structure: TypedOutline }

TypedOutline = {
  sections: Array<{
    heading: { level: 1|2|3, text: string }
    description?: string
    bullets?: string[]
    callout?: 'info' | 'cta' | 'quote'
  }>
}
```

The outline is intentionally strict. Freeform structure strings ("H1, intro, 3 H2s, CTA") are rejected. The model must produce a typed outline, which forces consistency and gives us a stable parse target.

### Brief / post payload schemas
- Brief: matches the existing content-brief shape used by the admin UI. Adding a brief via MCP and via UI produce the same DB rows.
- Post: matches the existing content-post shape, including Webflow CMS field mapping when `layout.type === 'cms'`.

If a generated payload fails validation, the `save_*` tool returns the Zod error verbatim. The chat is expected to correct and retry.

---

## Architectural rules baked into v1

These set the pattern for every future action tool, not just this batch.

1. **MCP tools never call AI for generation.** Generation tools assemble context and persist; the chat model does the inference.
2. **All writes go through existing service functions.** No direct DB writes from `server/mcp/`. If a service requires a parameter, the MCP tool requires it.
3. **Every mutating tool returns `{ ..., dashboard_url }`.** The chat says "added — view it here" and the operator clicks through to verify.
4. **Paid-API tools start their description with `[Paid API]`** so the model surfaces cost in reasoning.
5. **Bulk paid-API tools start with `[Paid API, Bulk]`** and instruct the model to confirm in chat.
6. **Workspace scoping is mandatory and explicit** on every tool. Tool descriptions tell the model to confirm the workspace name when ambiguous.
7. **No read-then-write fusion.** Read tools and write tools are separate. The model decides whether to write based on the read result. No `research_and_add_if_good_enough`.
8. **Handles, not raw DB ids, for chained writes.**
9. **Activity log source = `mcp-chat`** for every mutation.

---

## Out of scope (roadmap, not v1)

- **Reference-URL layout source** (`{ type: 'url', value }`) — adds scraping, robots.txt handling, parser robustness. Defer.
- **Figma layout source** — Figma API integration, structure extraction. Defer.
- **Google Doc layout source** — Google Docs API, content extraction. Defer.
- **Workspace context mutations** (add competitor, update persona, set brand voice sample) — better in the admin UI for now.
- **Direct insight/recommendation creation from chat** — high-trust write, better in admin UI.
- **Tool consolidation** (e.g., one `start_job(type, workspace_id)` instead of four). Revisit once we know which job triggers actually get used.
- **Durable handle store** (SQLite-backed). Promote if in-memory loss becomes annoying.
- **Hard caps on paid-API usage.** Revisit if team members get MCP access or runaway loops happen in practice.
- **Streaming job status back to chat.** Currently fire-and-forget with `{ jobId }`.

---

## Acceptance criteria

A user (Joshua) can, from a single Claude Code session connected to the studio MCP:

1. Ask Claude to research a keyword for workspace X, see volume/difficulty/SERP, then ask to add it to a named cluster — and the keyword appears in the workspace strategy with metrics attached.
2. Paste a Webflow CMS template ref (or provide a typed outline), ask Claude to generate a brief on a topic, then a post against that brief — and both land as drafts in the platform.
3. Ask Claude to send the post draft to the client for approval — and it appears in the client inbox Reviews section with the operator note.
4. Trigger a site health audit and see the job appear in the in-platform task panel.
5. Open the activity feed and see all five mutations tagged with `source: mcp-chat`.

All of this without making any AI API call billed to the operator's OpenAI/Anthropic account — generation is paid via Claude subscription, lookups are paid via existing DataForSEO/SEMRush spend.

---

## Open questions

1. **Soft cap threshold value.** Default of 20 is a guess. Validate against actual session usage after v1 ships.
2. **Brief vs post layout coupling.** Should `prepare_post_context` *require* a `brief_id`, or accept a raw topic? Spec currently allows both; flag for review during plan-writing.
3. **CMS template introspection.** `LayoutCms` references a `template_id` — does the existing Webflow integration expose template field schemas in a form `prepare_*_context` can serialize? If not, the spec needs a small bridge step before plan-writing.
4. **Outline schema strictness.** Is the proposed `TypedOutline` rich enough to cover the actual layouts you want, or do we need image slots, embed slots, link blocks?
5. **`mcp-chat` activity source badge UI.** Where in the activity feed does the badge render, and does it need a filter? Probably a small UI follow-up, not part of the action-tool plan itself.

---

## Predecessor and successor work

- **Predecessor:** [2026-05-15-mcp-server-design.md](./2026-05-15-mcp-server-design.md) — read-only MCP v1, currently shipped.
- **Successor specs (not yet written):**
  - URL/Figma/Google-Doc layout sources
  - Workspace context mutation tools
  - Tool consolidation pass once usage patterns settle
