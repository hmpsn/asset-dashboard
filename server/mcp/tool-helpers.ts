import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { createLogger } from '../logger.js';
import { getWorkspace } from '../workspaces.js';
import type { Workspace } from '../../shared/types/workspace.js';

const log = createLogger('mcp-tool-helpers');

export type McpToolErrorResponse = CallToolResult;
export type McpToolSuccessResponse = CallToolResult;

export function mcpError(message: string): McpToolErrorResponse {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function mcpSuccess(payload: unknown): McpToolSuccessResponse {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

/**
 * Type predicate that narrows a `T | McpToolErrorResponse` union to the error
 * branch. `CallToolResult` carries a passthrough index signature, so a bare
 * `'isError' in value` check does NOT narrow the success branch back to `T`
 * (TS keeps it as the union). Use this guard when the success value's fields
 * are accessed afterward (e.g. requireWorkspace → workspace.webflowSiteId).
 */
export function isMcpError<T>(value: T | McpToolErrorResponse): value is McpToolErrorResponse {
  return typeof value === 'object'
    && value !== null
    && (value as McpToolErrorResponse).isError === true;
}

export function requireWorkspace(workspaceId: string): Workspace | McpToolErrorResponse {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    log.warn({ workspaceId }, 'Workspace not found for MCP tool call');
    return mcpError(`Workspace not found: ${workspaceId}`);
  }
  return ws;
}

export function buildDashboardUrl(workspaceId: string, tab?: string): string {
  const base = (process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
  const path = tab ? `/ws/${workspaceId}/${tab}` : `/ws/${workspaceId}`;
  return base ? `${base}${path}` : path;
}

export function zodErrorToMcp(error: unknown): McpToolErrorResponse {
  const issues = (error as { issues?: unknown[] })?.issues;
  if (Array.isArray(issues)) {
    return mcpError(`Validation failed: ${JSON.stringify(issues)}`);
  }
  return mcpError(`Validation failed: ${String(error)}`);
}
