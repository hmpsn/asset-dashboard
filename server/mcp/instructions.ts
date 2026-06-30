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

export const MCP_SERVER_INSTRUCTIONS = `${STUDIO_NAME} is an SEO / web-analytics agency platform. Every tool operates on ONE client workspace and needs a workspace id — call \`list_workspaces\` first to get ids, and \`get_workspace_overview\` for a snapshot of pending work. NOTE the casing split: most tools name the parameter \`workspace_id\` (snake_case), but most READ tools (workspace overview/intelligence, insights, content reads, client signals, and brand) use \`workspaceId\` (camelCase) while action/write tools use \`workspace_id\` (snake_case). Don't assume — match each tool's own schema.

CONTENT AUTHORING IS A HANDLE PIPELINE. \`prepare_brief_context\` returns a \`brief_request_handle\` plus the brief schema — YOU generate the brief locally, then \`save_brief\` (returns a \`brief_handle\`). Repeat with \`prepare_post_context\` → \`save_post\` (returns a \`post_handle\`). Finally \`send_to_client\` turns a saved brief/post into a client-facing request AND emails the client. Handles are single-use, expire ~15 minutes after creation, and are scoped to one workspace + kind: if a handle errors as not-found or expired, re-run the tool that produced it — never retry the consumer with a stale handle.

PREFER SERVER-SIDE GROUNDED GENERATION FOR HEAVY WRITING. Instead of authoring locally, \`start_brief_generation\` and \`start_post_generation\` ([Paid API]) run the full research-backed brief/post generation on the server as a background job (GSC/GA4 enrichment, SERP + competitor scraping, section-by-section drafting, unification, SEO meta) and persist the result. They return a \`job_id\` — poll \`get_job_status\`, then read the result with \`get_brief\`/\`get_post\`. Use \`start_post_generation\` with a saved \`brief_id\`; use the local handle pipeline only when you need to hand-author or heavily steer the draft.

EDITING EXISTING ITEMS USES OPTIMISTIC CONCURRENCY. For briefs/posts call \`get_brief\`/\`get_post\` for the current \`revision\` token and pass it back as \`expected_revision\`; for brand deliverables call \`get_brand_identity\` (with \`includeDeliverables: true\`) for the current \`version\` and pass it as \`expectedVersion\` to \`update_brand_deliverable\`. On a conflict error, re-fetch and retry — do not force the write.

KEYWORD RESEARCH. \`research_keywords\` ([Paid API] — one paid call per term) returns a \`research_handle\` you pass to \`add_keyword_to_strategy\`.

PAID APIS COST REAL MONEY — use deliberately: \`research_keywords\`, \`start_keyword_strategy_generation\`, \`start_local_seo_refresh\`, \`start_brief_generation\`, \`start_post_generation\`, and \`get_workspace_intelligence\` when \`enrich_with_backlinks\` or \`resolve_entity_references\` is set. The \`start_*\` tools are long-running jobs: they return a \`job_id\` — poll \`get_job_status\` rather than blocking.

DESTRUCTIVE / IRREVERSIBLE — confirm intent before calling: \`delete_workspace\`, \`delete_brief\`, \`delete_post\`, \`replace_keyword_strategy\`, \`revert_post_version\`.

All writes are workspace-scoped and recorded in the activity log.`;
