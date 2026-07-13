/** Minimal transport-neutral shape shared by MCP registry consumers. */
export interface McpToolDefinition<TInputSchema = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
}

export const MCP_TOOL_ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  PRECONDITION_FAILED: 'precondition_failed',
  RATE_LIMITED: 'rate_limited',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type McpToolErrorCode =
  (typeof MCP_TOOL_ERROR_CODES)[keyof typeof MCP_TOOL_ERROR_CODES];

export interface McpToolErrorEnvelope<TDetails = never> {
  readonly code: McpToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: TDetails;
}

export interface McpMasterKeyCaller {
  readonly kind: 'master_key';
  readonly scope: 'all';
  readonly keyId: null;
  readonly keyLabel: null;
}

export interface McpWorkspaceKeyCaller {
  readonly kind: 'workspace_key';
  readonly scope: string;
  readonly workspaceId: string;
  readonly keyId: string;
  readonly keyLabel: string;
}

export type McpToolCaller = McpMasterKeyCaller | McpWorkspaceKeyCaller;

/**
 * Immutable identity resolved at the authenticated MCP execution boundary.
 * It deliberately excludes bearer tokens, raw arguments, prompts, and evidence.
 */
export interface McpToolExecutionContext {
  readonly requestId: string;
  readonly toolName: string;
  readonly targetWorkspaceId: string | null;
  readonly caller: McpToolCaller;
}
