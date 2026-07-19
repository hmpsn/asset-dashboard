# hmpsn.studio MCP Action Server

This directory implements the hmpsn.studio **MCP (Model Context Protocol) action server** — the
programmatic surface an AI agent (Claude.ai connector, Claude Code, or any MCP client) uses to
operate the agency platform: list and manage client workspaces, read intelligence/insights,
author and ship content, run keyword/SEO jobs, generate schema, and triage the inbox.

It is the canonical onboarding doc for the MCP surface. When you add, rename, or remove a tool,
update this file in the same commit.

---

## Overview

- **Endpoints:** `POST /mcp` exposes the backward-compatible full profile; `POST /mcp/operator`
  exposes the compact desktop-operator profile. Both are mounted in `server/app.ts` via
  `server/mcp/index.ts` and carry their own Bearer-token auth rather than the admin `APP_PASSWORD`
  gate (see [Auth](#auth)).
- **Transport:** MCP over **stateless Streamable HTTP**. `handleMcpRequest` (`server/mcp/server.ts`)
  builds a **fresh `Server` + `StreamableHTTPServerTransport` per request** (`sessionIdGenerator:
  undefined`, `enableJsonResponse: true`) — the SDK's stateless transport cannot be reused across
  requests (message-ID collisions), so tool definitions are declared once in the canonical
  `MCP_TOOL_REGISTRY` (`server/mcp/tool-registry.ts`) and applied to each new `Server` instance.
  Responses are returned as JSON-RPC objects, not SSE streams.
- **Handshake instructions:** the full profile carries the unchanged `MCP_SERVER_INSTRUCTIONS`
  (`server/mcp/instructions.ts`). The operator profile carries the compact
  `MCP_OPERATOR_PROFILE_INSTRUCTIONS` (`server/mcp/profiles.ts`) with explicit paid-generation,
  review, and client-send confirmation gates.
- **Clients:** Claude.ai (remote MCP connector) and Claude Code connect over this endpoint with a
  Bearer token.
- **Server identity:** `{ name: 'hmpsn-studio', version: '1.0.0' }`.

### Server profiles

| Endpoint | Credential | Discovery | Intended use |
|----------|------------|-----------|--------------|
| `POST /mcp` | Master key or per-workspace key, subject to existing scope rules | All 105 canonical tools and the unchanged full instructions | Advanced and backward-compatible access |
| `POST /mcp/operator` | Master key only | Compact registered intersection of the canonical 25-name operator allowlist | Normal desktop studio administration |

The operator profile exposes 25 tools: `list_workspaces`, `get_portfolio_brief`,
`get_workspace_decision_brief`, `get_client_view`, `get_brand_identity`,
`create_brand_deliverable`, `update_brand_deliverable`, `get_brand_voice`,
`list_content_templates`, `get_content_template`, `create_content_template`,
`update_content_template`, `create_content_matrix`, `update_content_matrix_cell`,
`list_content_matrices`, `get_content_matrix`, `resolve_content_matrix_cells`,
`accept_content_template_generation_upgrade`, `preview_content_matrix_generation`,
`resolve_content_matrix_evidence`, `start_content_matrix_generation`,
`get_content_matrix_generation`, `retry_content_matrix_generation`, `get_job_status`, and
`send_to_client`.

Operator discovery replaces top-level prose with explicit compact descriptions and removes only
nested JSON-schema `description` metadata. All schema validation constraints remain intact, and
the serialized tool catalog plus operator instructions is contract-tested at 32,222 bytes, below
the 32 KiB UTF-8 ceiling. Repeated input/output schema subtrees use lossless draft-07 references;
no validation field is removed to meet the budget. Discovery and invocation use the same allowlist:
calling any hidden or unregistered tool
returns the generic `json_v1` `not_found` envelope without reflecting the supplied name.

The operator profile changes neither tool semantics nor authorization inside allowed handlers.
Preview remains side-effect free; paid generation still requires an exact accepted preview and
explicit human confirmation; generated work still stops for human review; and no tool gains an
automatic approval, client-send, or publication path.

### Workspace scope and parameter casing (gotcha)

Most tools operate on **one** client workspace. Seven tools are explicitly global and therefore
master-key only: `list_workspaces`, `get_portfolio_brief`, `create_workspace`, `list_library_templates`,
`get_library_template`, `promote_template_to_library`, and `instantiate_library_template`.
`get_pending_work` has a declared, optional `workspaceId`; omitting it requests a cross-workspace
summary and is also master-key only.

For workspace-scoped tools, the parameter name is **not** uniform:

- Most tools use **`workspace_id`** (snake_case).
- A number of **read** tools use **`workspaceId`** (camelCase): `get_workspace_overview`, insights,
  intelligence, the content analysis reads (`get_content_decay` / `get_keyword_analysis` /
  `get_seo_context` / `get_content_performance`), client signals (`get_client_signals` /
  `get_pending_work`), and brand (`get_brand_identity` / `create_brand_deliverable` /
  `update_brand_deliverable`).

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

The P1 `/mcp/operator` boundary adds `mcpMasterKeyOnlyMiddleware` after normal authentication.
It accepts only the canonical master identity (`scope: 'all'` with no workspace-key ID or label)
and returns the same generic 401 for workspace keys; it never re-reads or re-compares bearer
material. Capability-scoped operator credentials are intentionally deferred to P5. `/mcp` retains
both key types unchanged.

### Scope enforcement (security-critical)

For a per-workspace key (`!isMcpMasterKeyAuth(auth)`), `executeMcpTool` checks the workspace field
declared by the registered tool **after** parsing, because the workspace id lives in the JSON body,
not a header/URL. Fail-closed:

- **Cross-workspace** id (`argWorkspaceId !== auth.scope`) → rejected.
- **Explicit global tools** (`list_workspaces`, `create_workspace`, `list_library_templates`,
  `get_library_template`, `promote_template_to_library`, and `instantiate_library_template`) →
  rejected for scoped keys.
- **Optional workspace field omitted** (`get_pending_work`) → rejected for scoped keys, since a
  workspace key must not enumerate across all workspaces.
- **Conflicting `workspaceId` / `workspace_id` aliases** → rejected for every caller.

Only the canonical master identity bypasses both checks. A workspace-key row whose durable
workspace ID happens to equal the reserved `all` sentinel remains workspace-scoped because its
key ID and label distinguish it from the environment master key.

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

### Error contract

Every registered tool uses `json_v1`: an error is a text content item containing a JSON
`{ code, message, retryable, details? }` envelope. Registry-owned unknown-tool and authorization
rejections are deliberately generic so caller tool/workspace values cannot be reflected as
secrets.

`server/mcp/tool-errors.ts` builds and privately marks the `json_v1` response and filters optional
details as defense in depth. The registry rejects any JSON-tool error that did not cross that
constructor, including a raw handler result, and maps thrown failures to the generic envelope.
Raw arguments, prompts, evidence, secrets, exception messages, and stacks must enter neither MCP
responses nor registry logs. Registry rejection logs use only registered tool names and stable
failure classes; unknown names and mismatched workspace values are never logged or reflected.

---

## Tool inventory

`MCP_TOOL_REGISTRY` (`server/mcp/tool-registry.ts`) is the single authority for discovery,
dispatch, workspace scope, and error compatibility. It composes **19 categories** for a total of
**105 tools**. Each category remains a `*Tools: Tool[]` array + a `handle*Tool(name, args, context?)`
dispatcher in `server/mcp/tools/<category>.ts`; the registry snapshots immutable definitions and
connects each one to its category handler. A production dispatch census calls every registered
name with inert invalid input, asserts the exact 19 family-array→handler identities, and pins the
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

### operator briefs (`tools/operator-briefs.ts`)
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_portfolio_brief` | R | Master-only, DB-only deterministic studio priority queue. Defaults to 10 workspaces and caps at 25; returns exact counts plus bounded durable drill-down IDs. |
| `get_workspace_decision_brief` | R | Bounded blockers, pending decisions, client risks, and deterministic next-safe-action hints from five purpose-selected intelligence slices. The engine still has 15 registered slices; this read model intentionally uses only `insights`, `contentPipeline`, `siteHealth`, `clientSignals`, and `operational`. |
| `get_client_view` | R | Exact public, tier-gated client intelligence projection. It fails closed rather than falling back to admin-only learnings. |

All three return legacy text JSON plus validated `structuredContent: { data: ... }` under explicit
root-object output schemas. They make no AI/provider call and trigger no paid work, job, mutation,
broadcast, approval, send, or publication path.

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
| `get_brand_identity` | R | Structured approved identity + voice status, with approved/pending/total deliverable counts; `includeDeliverables:true` adds every deliverable with `version`. |
| `create_brand_deliverable` | W | Store operator-authored content as a new draft. Duplicate workspace/type conflicts; human approval remains required. |
| `update_brand_deliverable` | W | Edit a deliverable's content. Optimistic concurrency via `expectedVersion`; resets to `draft`. |

### brand-intake-actions (`tools/brand-intake-actions.ts`) — immutable evidence authority
| Tool | R/W | Purpose |
|------|-----|---------|
| `submit_brand_intake` | W | Submit questionnaire fields as an immutable MCP-sourced intake revision; durable keyed retries are safe and missing fields remain empty. |
| `get_brand_intake` | R | Read the current or named immutable intake revision with field-level evidence availability. |
| `resolve_brand_intake_evidence` | W | Create/reuse a version-safe superseding revision for one exact typed field requirement and factual source. |

### brand-voice-actions (`tools/brand-voice-actions.ts`) — operator-authorized voice authority
| Tool | R/W | Purpose |
|------|-----|---------|
| `get_brand_voice` | R | Read the current profile, exact missing authority prerequisites, all pending chat proposals, one bounded page of eligible authentic anchors, and a bounded latest-finalization summary. |
| `get_pending_approvals` | R | Read every Brand & AI item awaiting a human decision, with full content and the reason it is pending. It cannot approve anything. |
| `create_brand_voice_profile` | W | Idempotently ensure a mutable voice profile exists without overwriting an existing draft. |
| `update_brand_voice_draft` | W | Replace proposed DNA, guardrails, or context modifiers at an exact profile revision; never finalizes. |
| `add_brand_voice_sample` | W | Add a revision-safe proposed sample. MCP-added samples cannot become finalization anchors until a human attests them in the platform. |
| `add_brand_voice_samples` | W | Add 1–25 proposed samples with one revision guard and one profile revision bump. All remain human-attestation gated. |
| `finalize_brand_voice` | W | Consume a short-lived, one-time authorization created by a human operator and bound to the exact profile revision, voice fields, anchors, ratings, and idempotency key. The MCP key remains internal execution provenance only and is never returned. |

Voice finalization is deliberately a two-boundary workflow:

1. Use `create_brand_voice_profile`, `update_brand_voice_draft`, and `add_brand_voice_samples` to prepare the exact draft through chat. Every MCP-added sample remains proposed and cannot enter the authentic anchor pool until a human explicitly attests it in the platform.
2. Call `get_pending_approvals` to present the complete Brand & AI review queue, or `get_brand_voice` for voice-specific readiness, pending proposals, and eligible authentic samples. `get_brand_voice` returns one page in `eligible_anchors.items`; while `eligible_anchors.has_more` is true, pass `eligible_anchors.next_cursor` back as `anchor_cursor`. Generated, MCP-proposed, calibration-loop, identity-approved, and copy-approved samples are forbidden as anchors.
3. A human operator creates the exact, short-lived authorization through the authenticated `POST /api/voice/:workspaceId/finalization-authorizations` HTTP boundary. MCP cannot create it or submit a caller-authored operator identity.
4. Call `finalize_brand_voice` with only `workspace_id` and the one-time `authorization_token`. A replay returns the original finalization without duplicating activity or broadcasts. On a revision conflict, or when an anchor cursor conflicts because its profile/intake revision changed, restart `get_brand_voice` from the first page and request a new authorization; never retry the stale authorization.

### brand-generation-actions (`tools/brand-generation-actions.ts`) — grounded, review-gated brand generation

| Tool | R/W | Purpose |
|------|-----|---------|
| `start_brand_deliverable_generation` | W | **[Paid API]** Start one atomic deliverable, an ordered preset, or the voice-foundation stage of a full brand system from one exact immutable intake revision. Durable deliverables require the exact finalized voice version/fingerprint. |
| `get_brand_generation` | R | Read one durable run plus a cursor-paged item slice. Returns public attribution and bounded summaries; never exposes idempotency keys, MCP key identity, raw prompts, or evidence bodies. |
| `resume_brand_deliverable_generation` | W | **[Paid API]** Resume a paused `full_brand_system` run after explicit human voice finalization, using the exact run revision and finalized voice version/fingerprint. |
| `start_brand_deliverable_revision` | W | **[Paid API]** Start one review-directed revision using exact run, item, and deliverable versions. A newer human edit always wins the conditional save. |

Brand generation is a durable background workflow, not a synchronous copy endpoint. Start returns `run_id` and `job_id`; poll `get_job_status`, then read paged detail with `get_brand_generation`. A `full_brand_system` start creates only a provisional `voice_foundation`, truthfully finishes its first job at `awaiting_voice_finalization`, and creates no dependent deliverables until a human finalizes voice and calls `resume_brand_deliverable_generation`. Every generated deliverable stops at `ready_for_human_review` or a truthful attention/error state. These tools never approve, send, publish, claim name availability, or treat placeholder prose as evidence. Reuse the same idempotency key only for the byte-equivalent business command; on revision conflicts, re-read before retrying.

### brand-content-onboarding-actions (`tools/brand-content-onboarding-actions.ts`) — gated intake→brand→content coordination

| Tool | R/W | Purpose |
|------|-----|---------|
| `start_brand_content_onboarding` | W | **[Paid API]** Create one durable coordinator from an exact intake revision and non-empty exact matrix-cell selection, then start only the existing `full_brand_system` child. |
| `get_brand_content_onboarding` | R | Read the current onboarding status, gate, frozen brand authority, and child references without operational idempotency or MCP key identity. |
| `resume_brand_content_onboarding` | W | **[Conditionally paid]** Evaluate one durable gate and, only after human voice finalization, potentially resume the existing dependent-brand child. |

The coordinator does not replace the underlying generators or review systems. A non-empty page selection is required; standalone brand-only work uses the brand-generation tools. Brand reviews still use `send_to_client`; voice finalization still requires the existing human-operator authorization; content generation requires an authenticated human authorization at the HTTP boundary; and each generated page still needs the existing review-only matrix approval. MCP cannot supply those human decisions. A returned `paid_job_id` is an accepted child job to poll with `get_job_status`. `ready_to_publish` is a verified handoff state, never an automatic publish.

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
| `send_to_client` | W | Turn a saved brief/post into a client-facing request, or send an exact ready brand-generation run as a grouped Inbox review; **emails the client**. |
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

### content-matrix-actions (`tools/content-matrix-actions.ts`) — structural planning and bounded generation
| Tool | R/W | Purpose |
|------|-----|---------|
| `list_content_templates` | R | Cursor-paged template summaries without full section blobs. |
| `get_content_template` | R | Complete reusable template, including variables, sections, contracts, patterns, mapping, and revision. |
| `create_content_template` | W | Create a reusable template; `optional: true` sections are included only when their exact cell evidence is verified. |
| `update_content_template` | W | Revision-safe partial template update, including optional section markers. |
| `duplicate_content_template` | W | Duplicate a template as a new starting point. |
| `list_library_templates` | R | Master-key cursor page of immutable studio templates, optionally filtered by vertical. |
| `get_library_template` | R | Master-key complete immutable studio template snapshot and source provenance. |
| `promote_template_to_library` | W | Master-key explicit promotion of one exact generation-ready workspace template revision. |
| `instantiate_library_template` | W | Master-key copy into a workspace with fresh section IDs and no live inheritance. |
| `create_content_matrix` | W | Create a matrix directly from a template plus Cartesian dimensions; Page Strategy is not required. |
| `update_content_matrix_cell` | W | Revision-safe per-cell keyword, URL, variable, or schema override with path and workspace collision validation. |
| `list_pseo_blueprint_entries` | R | Cursor-page Page Strategy collection entries and template/matrix links; empty means no collection entries have been generated. |
| `list_content_matrices` | R | Cursor-paged matrix summaries, optionally filtered by template. |
| `get_content_matrix` | R | Matrix metadata plus a revision-bound cursor page of cells. |
| `resolve_content_matrix_cells` | R | Resolve selected durable cell IDs into deterministic structural targets with explicit optional-section omissions, blockers, or an exact legacy-template upgrade proposal. No AI call or generation run. |
| `accept_content_template_generation_upgrade` | W | Explicitly accept or reject the exact version-conditional deterministic template upgrade proposal. |
| `preview_content_matrix_generation` | R | Freeze exact generation inputs, report optional omissions, and return bounded call, token, and cost estimates without paid work. |
| `resolve_content_matrix_evidence` | W | Resolve one typed factual requirement and invalidate the prior preview. |
| `start_content_matrix_generation` | W | **[Paid API]** Start one bounded, idempotent background batch from exact preview fingerprints and accepted budget ceilings. |
| `get_content_matrix_generation` | R | Read one durable batch plus cursor-paged item outcomes, audit findings, artifact revisions, and approval evidence. |
| `retry_content_matrix_generation` | W | **[Paid API]** Resume selected failed or needs-attention checkpoints from exact revisions. |
| `get_pseo_matrix_plan` | R | Read one collection entry, linked template variables, and exact source authority for safe materialization. |
| `create_content_matrix_from_pseo_plan` | W | Blueprint-linked convenience route that idempotently creates and links one validated matrix. Never starts generation. |

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
  `save_post` (post-request handle), `send_to_client` (brief/post handle). The independent
  `send_to_client.brand_generation` target uses durable run identity and an exact revision, not a
  handle.

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
- **Single-use:** a successful `consumeHandle` deletes the row. Saved-artifact
  handles used by `send_to_client` are consumed inside the same transaction as
  the durable send, so a failed send leaves the handle available for retry.
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
- `start_content_matrix_generation` and `retry_content_matrix_generation` (one event per accepted job;
  exact idempotent replays repair or reuse the same durable event)
- `start_brand_deliverable_generation`, `resume_brand_deliverable_generation`, and
  `start_brand_deliverable_revision` (one event per accepted job)
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

1. **Define the input schema** in `shared/types/mcp-action-schemas.ts` or a bounded MCP schema
   module such as `shared/types/mcp-matrix-schemas.ts`. Every top-level property
   needs a `.describe()` (enforced by the contract test below). Build the MCP JSON Schema with
   `toMcpJsonSchema(...)`.
2. **Add the tool def + handler** in the right `server/mcp/tools/<category>.ts` file: push a
   `{ name, description, inputSchema }` entry onto the category's `*Tools` array and add a `case`/`if`
   branch to its `handle*Tool` dispatcher. Validate args with the Zod schema, return
   `mcpSuccess(...)`; errors use the branded helpers in `tool-helpers.ts` or
   `mcpJsonV1Error(...)` with a stable public envelope. If the family validates workspace/external
   state before switching on `name`, also update its exported handled-name manifest; the census
   requires that manifest to equal the advertised definitions.
3. **Register the family in `server/mcp/tool-registry.ts`.** A new category supplies its name,
   definitions, handler, global-tool declarations (normally none), and default error contract once.
   Production families use `json_v1`. Discovery, scope resolution, and dispatch are derived from the one
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

Use the shared helpers in `server/mcp/tool-helpers.ts` (`requireWorkspace`, `mcpSuccess`, the typed
error helpers, `zodErrorToMcp`, and `buildDashboardUrl`) rather than hand-rolling responses. Every
error must cross the constructors in `server/mcp/tool-errors.ts` so the registry can verify and
sanitize the result.
