import type { McpServerProfile } from '../../shared/types/mcp-runtime.js';
import { MCP_SERVER_PROFILES } from '../../shared/types/mcp-runtime.js';
import { STUDIO_NAME } from '../constants.js';

/** Canonical 25-tool desktop-operator surface. */
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
  list_workspaces: 'List workspaces; return IDs.',
  get_portfolio_brief: 'Read bounded priority queue.',
  get_workspace_decision_brief: 'Read blockers, risks, safe actions.',
  get_client_view: 'Read exact client-safe view.',
  get_brand_identity: 'Read identity drafts/approvals.',
  create_brand_deliverable: 'Create review-gated draft.',
  update_brand_deliverable: 'Update draft by revision.',
  get_brand_voice: 'Read finalized voice.',
  list_content_templates: 'List bounded templates.',
  get_content_template: 'Read template/revision.',
  create_content_template: 'Create template; no generation.',
  update_content_template: 'Update template by revision.',
  create_content_matrix: 'Create validated matrix.',
  update_content_matrix_cell: 'Update cell by revision.',
  list_content_matrices: 'List bounded matrices.',
  get_content_matrix: 'Read matrix/cell page.',
  resolve_content_matrix_cells: 'Resolve cells/blockers.',
  accept_content_template_generation_upgrade: 'Accept/reject exact upgrade.',
  preview_content_matrix_generation: 'Preview blockers/fingerprint/cost.',
  resolve_content_matrix_evidence: 'Resolve stable evidence.',
  start_content_matrix_generation: 'Start confirmed paid generation.',
  get_content_matrix_generation: 'Read generation outcomes.',
  retry_content_matrix_generation: 'Retry failed checkpoints.',
  get_job_status: 'Poll background job.',
  send_to_client: 'Send saved target to client.',
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

export const MCP_OPERATOR_PROFILE_INSTRUCTIONS = `${STUDIO_NAME} operator. Start with list_workspaces; copy IDs and follow schemas.

Brand drafts are not approvals; generation requires finalized voice and approved identity.

For matrices, resolve cells/evidence, accept the exact upgrade, then preview. Preview is free and side-effect-free. Before paid start/retry, show targets, fingerprint, estimate, and limits; get explicit human confirmation—never infer it. Generation ends at human review; never auto-approve, send, or publish.

send_to_client needs explicit intent for its saved target. On conflict, re-read revisions. Poll with get_job_status. Hidden tools are unavailable; use full /mcp for advanced work.`;
