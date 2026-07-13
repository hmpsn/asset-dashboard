import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolDefinition,
  type McpToolErrorEnvelope,
  type McpToolExecutionContext,
} from '../../shared/types/mcp-runtime.js';

describe('MCP runtime shared contract', () => {
  it('keeps the stable error-code vocabulary closed', () => {
    expect(Object.values(MCP_TOOL_ERROR_CODES)).toEqual([
      'validation_failed',
      'forbidden',
      'not_found',
      'conflict',
      'precondition_failed',
      'rate_limited',
      'internal_error',
    ]);
  });

  it('types tool definitions, execution identity, and safe error details', () => {
    const definition = {
      name: 'example_tool',
      description: 'Example tool.',
      inputSchema: { type: 'object' as const, properties: {} },
    } satisfies McpToolDefinition;

    const context = {
      requestId: 'request-1',
      toolName: definition.name,
      targetWorkspaceId: 'workspace-1',
      caller: {
        kind: 'workspace_key',
        scope: 'workspace-1',
        workspaceId: 'workspace-1',
        keyId: 'key-1',
        keyLabel: 'Automation',
      },
    } satisfies McpToolExecutionContext;

    const error = {
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The expected revision is stale.',
      retryable: false,
      details: { expectedRevision: 3 },
    } satisfies McpToolErrorEnvelope<{ expectedRevision: number }>;

    expectTypeOf(context.caller.keyId).toEqualTypeOf<string>();
    expectTypeOf(error.details.expectedRevision).toEqualTypeOf<number>();
  });
});
