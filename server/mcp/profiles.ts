import type { McpServerProfile } from '../../shared/types/mcp-runtime.js';
import { MCP_SERVER_PROFILES } from '../../shared/types/mcp-runtime.js';
import { STUDIO_NAME } from '../constants.js';

/**
 * Canonical desktop-operator surface. Three read-model names are reserved here
 * for P2 and become discoverable only after they are registered.
 */
export const MCP_OPERATOR_TOOL_NAMES = Object.freeze([
  'list_workspaces',
  'get_portfolio_brief',
  'get_workspace_decision_brief',
  'get_client_view',
  'get_brand_identity',
  'create_brand_deliverable',
  'update_brand_deliverable',
  'get_brand_voice',
  'list_content_templates',
  'get_content_template',
  'create_content_template',
  'update_content_template',
  'create_content_matrix',
  'update_content_matrix_cell',
  'list_content_matrices',
  'get_content_matrix',
  'resolve_content_matrix_cells',
  'accept_content_template_generation_upgrade',
  'preview_content_matrix_generation',
  'resolve_content_matrix_evidence',
  'start_content_matrix_generation',
  'get_content_matrix_generation',
  'retry_content_matrix_generation',
  'get_job_status',
  'send_to_client',
] as const);

export type McpOperatorToolName = (typeof MCP_OPERATOR_TOOL_NAMES)[number];

export const MCP_OPERATOR_TOOL_DESCRIPTIONS = Object.freeze({
  list_workspaces: 'List workspace summaries and durable workspace IDs.',
  get_portfolio_brief: 'Read the bounded deterministic studio priority brief.',
  get_workspace_decision_brief: 'Read bounded blockers, decisions, risks, and safe next actions.',
  get_client_view: 'Read exactly the client-safe, tier-gated intelligence projection.',
  get_brand_identity: 'Read approved and draft brand-identity deliverables for one workspace.',
  create_brand_deliverable: 'Create an operator-authored brand deliverable as a review-gated draft.',
  update_brand_deliverable: 'Revision-safely update a review-gated brand deliverable.',
  get_brand_voice: 'Read finalized voice authority, prerequisites, and eligible anchors.',
  list_content_templates: 'List bounded content-template summaries for one workspace.',
  get_content_template: 'Read one content template and its exact revision.',
  create_content_template: 'Create a workspace-owned content template without generation.',
  update_content_template: 'Revision-safely update a content template without generation.',
  create_content_matrix: 'Create a validated Cartesian matrix without previewing or generating.',
  update_content_matrix_cell: 'Revision-safely override one matrix cell and invalidate old previews.',
  list_content_matrices: 'List bounded content-matrix summaries for one workspace.',
  get_content_matrix: 'Read one matrix and a bounded, revision-tied page of cells.',
  resolve_content_matrix_cells: 'Resolve structures and blockers without AI or paid work.',
  accept_content_template_generation_upgrade: 'Accept or reject one exact deterministic template upgrade.',
  preview_content_matrix_generation: 'Freeze authority, blockers, fingerprint, and estimate without paid work.',
  resolve_content_matrix_evidence: 'Revision-safely resolve one stable evidence requirement.',
  start_content_matrix_generation: 'Start explicitly confirmed paid generation from exact accepted previews.',
  get_content_matrix_generation: 'Read bounded durable outcomes for a matrix-generation run.',
  retry_content_matrix_generation: 'Retry explicitly selected failed checkpoints under exact revisions.',
  get_job_status: 'Poll one background job by its durable job ID.',
  send_to_client: 'Explicitly send a saved review target to the client and notify them.',
} satisfies Readonly<Record<McpOperatorToolName, string>>);

const operatorToolNames = new Set<string>(MCP_OPERATOR_TOOL_NAMES);

export function isMcpToolAllowedInProfile(
  profile: McpServerProfile,
  toolName: string,
): boolean {
  return profile === MCP_SERVER_PROFILES.FULL || operatorToolNames.has(toolName);
}

export function operatorToolDescription(toolName: McpOperatorToolName): string {
  return MCP_OPERATOR_TOOL_DESCRIPTIONS[toolName];
}

export const MCP_OPERATOR_PROFILE_INSTRUCTIONS = `${STUDIO_NAME} desktop operator profile. Use this compact surface for external studio administration; use the full /mcp endpoint only when an advanced tool is genuinely required.

Start with list_workspaces and copy durable IDs exactly. Match each tool's schema, including workspace_id versus workspaceId. Read tools are deterministic; use their bounded query options whenever available.

Brand identity and voice remain human-governed. create_brand_deliverable and update_brand_deliverable save review-gated drafts; they do not approve content. Finalized voice and approved identity remain mandatory wherever generation requires them.

For matrix work: list/get the template and matrix, resolve exact cells, accept only an exact proposed template upgrade, preview, resolve typed evidence blockers, then preview again. Preview is free and side-effect free. It freezes exact source/artifact revisions, authority, fingerprint, omissions, and the paid-work estimate.

start_content_matrix_generation and retry_content_matrix_generation trigger paid provider work. Before either call, show the human the ready targets, accepted fingerprint/estimate, and hard limits, then require explicit confirmation. Never infer confirmation and never call paid generation merely because preview is ready. Generation stops at human review and never auto-approves, sends, or publishes.

send_to_client creates a client-facing review request and may notify the client. Require explicit human intent for the exact target before calling it.

On conflict, re-read the resource and use current revisions; never force a stale edit. Poll returned jobs with get_job_status. Errors use the json_v1 envelope with code, message, retryable, and optional safe details. Hidden tools are unavailable on this profile.`;
