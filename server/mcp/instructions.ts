/**
 * Server-level MCP instructions — the orientation string returned to every agent
 * in the `initialize` response, before its first tool call. This is the single
 * highest-leverage piece of agent guidance: it's the only text every connecting
 * client is guaranteed to receive up front (per-tool descriptions are only seen
 * once a tool is inspected).
 *
 * Keep it WORKFLOW- and GOTCHA-focused, not an exhaustive tool list (tools carry
 * their own descriptions). Every concrete claim here is verified against the tool
 * schemas/handlers — when a tool, handle field, or param name changes, update this
 * string in the same commit (the content contract is asserted by
 * tests/unit/mcp-instructions.test.ts).
 */
import { STUDIO_NAME } from '../constants.js';

export const MCP_SERVER_INSTRUCTIONS = `${STUDIO_NAME} is an SEO / web-analytics agency platform. Most tools operate on ONE client workspace and need a workspace id — call \`list_workspaces\` first to get ids, and \`get_workspace_overview\` for a snapshot of pending work. \`list_workspaces\` and \`create_workspace\` are explicit global tools and require the master key. \`get_pending_work\` may omit \`workspaceId\` for a cross-workspace summary with the master key; a per-workspace key must always supply its own workspace id. NOTE the casing split: most tools name the parameter \`workspace_id\` (snake_case), but several tools (workspace overview/intelligence, insights, content reads, client signals, and brand) use \`workspaceId\` (camelCase). Don't assume — match each tool's own schema.

CONTENT AUTHORING IS A HANDLE PIPELINE. \`prepare_brief_context\` returns a \`brief_request_handle\` plus the brief schema — YOU generate the brief locally, then \`save_brief\` (returns a \`brief_handle\`). Repeat with \`prepare_post_context\` → \`save_post\` (returns a \`post_handle\`). Finally \`send_to_client\` turns a saved brief/post into a client-facing request AND emails the client. Handles are single-use, expire ~15 minutes after creation, and are scoped to one workspace + kind: if a handle errors as not-found or expired, re-run the tool that produced it — never retry the consumer with a stale handle.

PREFER SERVER-SIDE GROUNDED GENERATION FOR HEAVY WRITING. Instead of authoring locally, \`start_brief_generation\` and \`start_post_generation\` ([Paid API]) run the full research-backed brief/post generation on the server as a background job (GSC/GA4 enrichment, SERP + competitor scraping, section-by-section drafting, unification, SEO meta) and persist the result. They return a \`job_id\` — poll \`get_job_status\`, then read the result with \`get_brief\`/\`get_post\`. Use \`start_post_generation\` with a saved \`brief_id\`; use the local handle pipeline only when you need to hand-author or heavily steer the draft.

CONTENT MATRIX STRUCTURAL PLANNING IS FREE AND REVISION-SAFE. Use \`list_content_matrices\`, then \`get_content_matrix\` for bounded matrix/cell pages. Pass each selected cell's exact \`expected_source_revision\` to \`resolve_content_matrix_cells\`; a source edit conflicts instead of mixing snapshots. Resolution returns structural targets, blockers, or an exact legacy-template upgrade proposal—it does not call AI, create a generation run, or claim paid-generation readiness. Apply or reject that exact proposal with \`accept_content_template_generation_upgrade\`; acceptance is version-conditional, so re-read and resolve again after a conflict.

BRAND INTAKE IS IMMUTABLE AND EVIDENCE-ADDRESSED. Use \`get_brand_intake\` to read the current or named intake revision plus field-level evidence availability. To correct or evidence-resolve an exact current field, pass that exact \`intake_revision_id\`, \`expected_revision\`, stable \`requirement_id\`, matching \`field_path\`, typed value, factual \`source_ref\`, and a caller-stable \`idempotency_key\` to \`resolve_brand_intake_evidence\`. A resolution creates or reuses a superseding revision; it never mutates the source revision in place. Re-read after a conflict. Placeholder text or deleting text never counts as evidence.

EDITING EXISTING ITEMS USES OPTIMISTIC CONCURRENCY. For briefs/posts call \`get_brief\`/\`get_post\` for the current \`revision\` token and pass it back as \`expected_revision\`; for brand deliverables call \`get_brand_identity\` (with \`includeDeliverables: true\`) for the current \`version\` and pass it as \`expectedVersion\` to \`update_brand_deliverable\`. On a conflict error, re-fetch and retry — do not force the write.

KEYWORD RESEARCH. \`research_keywords\` ([Paid API] — one paid call per term) returns a \`research_handle\` you pass to \`add_keyword_to_strategy\`.

PAID APIS COST REAL MONEY — use deliberately: \`research_keywords\`, \`start_keyword_strategy_generation\`, \`start_local_seo_refresh\`, \`start_brief_generation\`, \`start_post_generation\`, and \`get_workspace_intelligence\` when \`enrich_with_backlinks\` or \`resolve_entity_references\` is set. The \`start_*\` tools are long-running jobs: they return a \`job_id\` — poll \`get_job_status\` rather than blocking.

DESTRUCTIVE / IRREVERSIBLE — confirm intent before calling: \`delete_workspace\`, \`delete_brief\`, \`delete_post\`, \`replace_keyword_strategy\`, \`revert_post_version\`.

WORKSPACE WRITES ARE ATTRIBUTED INTERNALLY. Activity records capture the MCP request, tool, and authenticated key identity for operator audit. Per-key ids and labels are internal-only and are removed from client-facing activity and live broadcasts.

ERROR COMPATIBILITY. Existing tools retain their legacy text errors. New \`json_v1\` tools return a stable JSON envelope in the text payload with \`code\`, \`message\`, \`retryable\`, and optional safe \`details\`; raw arguments, prompts, secrets, evidence, exceptions, and stacks are never returned.`;
