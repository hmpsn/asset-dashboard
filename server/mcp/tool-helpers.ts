import type { ZodError } from 'zod';
import { MCP_TOOL_ERROR_CODES } from '../../shared/types/mcp-runtime.js';
import { createLogger } from '../logger.js';
import { getWorkspace } from '../workspaces.js';
import type { Workspace } from '../../shared/types/workspace.js';
import {
  mcpJsonV1Error,
  mcpZodValidationError,
  type McpToolErrorDetails,
} from './tool-errors.js';

const log = createLogger('mcp-tool-helpers');

export type McpToolErrorResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
};
export type McpToolSuccessResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

export function mcpValidationError(
  message: string,
  details?: McpToolErrorDetails,
): McpToolErrorResponse {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
    message,
    retryable: false,
    ...(details ? { details } : {}),
  }) as McpToolErrorResponse;
}

export function mcpNotFoundError(
  message: string,
  details?: McpToolErrorDetails,
): McpToolErrorResponse {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message,
    retryable: false,
    ...(details ? { details } : {}),
  }) as McpToolErrorResponse;
}

export function mcpConflictError(
  message: string,
  details?: McpToolErrorDetails,
): McpToolErrorResponse {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message,
    retryable: true,
    ...(details ? { details } : {}),
  }) as McpToolErrorResponse;
}

export function mcpPreconditionError(
  message: string,
  details?: McpToolErrorDetails,
): McpToolErrorResponse {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message,
    retryable: false,
    ...(details ? { details } : {}),
  }) as McpToolErrorResponse;
}

export function mcpRateLimitedError(
  message: string,
  details?: McpToolErrorDetails,
): McpToolErrorResponse {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.RATE_LIMITED,
    message,
    retryable: true,
    ...(details ? { details } : {}),
  }) as McpToolErrorResponse;
}

export function mcpInternalError(): McpToolErrorResponse {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
    message: 'The tool could not complete because of an internal error.',
    retryable: false,
  }) as McpToolErrorResponse;
}

export function mcpSuccess(payload: unknown): McpToolSuccessResponse {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

/**
 * Type predicate that narrows a `T | McpToolErrorResponse` union to the error
 * branch. Use this guard when the success value's fields are accessed afterward
 * (e.g. requireWorkspace → workspace.webflowSiteId).
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
    return mcpNotFoundError('Workspace not found.', {
      resource_type: 'workspace',
    });
  }
  return ws;
}

export function buildDashboardUrl(workspaceId: string, tab?: string): string {
  const base = (process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
  const path = tab ? `/ws/${workspaceId}/${tab}` : `/ws/${workspaceId}`;
  return base ? `${base}${path}` : path;
}

export function zodErrorToMcp(error: ZodError): McpToolErrorResponse {
  return mcpZodValidationError(error) as McpToolErrorResponse;
}
