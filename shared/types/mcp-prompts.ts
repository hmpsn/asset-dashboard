export const MCP_OPERATOR_PROMPT_NAMES = Object.freeze([
  'triage_studio_portfolio',
  'review_workspace_as_client',
  'run_content_matrix_generation_safely',
] as const);

export type McpOperatorPromptName =
  (typeof MCP_OPERATOR_PROMPT_NAMES)[number];
