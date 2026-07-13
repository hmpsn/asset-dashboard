import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  McpToolCaller,
  McpToolExecutionContext,
} from '../../shared/types/mcp-runtime.js';

const executionContextStorage = new AsyncLocalStorage<McpToolExecutionContext>();

function snapshotCaller(caller: McpToolCaller): McpToolCaller {
  if (caller.kind === 'master_key') {
    return Object.freeze({
      kind: 'master_key',
      scope: 'all',
      keyId: null,
      keyLabel: null,
    });
  }

  return Object.freeze({
    kind: 'workspace_key',
    scope: caller.scope,
    workspaceId: caller.workspaceId,
    keyId: caller.keyId,
    keyLabel: caller.keyLabel,
  });
}

/**
 * Run one MCP tool execution with an immutable, concurrency-safe identity snapshot.
 *
 * This compatibility bridge lets existing downstream activity writes inherit the
 * authenticated caller without threading transport details through every domain
 * function. Durable generation runs must still persist an explicitly passed
 * execution context because async-local state does not survive resume/restart.
 */
export function runWithMcpToolExecutionContext<T>(
  context: McpToolExecutionContext,
  fn: () => T,
): T {
  const snapshot = Object.freeze({
    requestId: context.requestId,
    toolName: context.toolName,
    targetWorkspaceId: context.targetWorkspaceId,
    caller: snapshotCaller(context.caller),
  });

  return executionContextStorage.run(snapshot, fn);
}

/** Return the immutable identity for the current MCP tool execution, if any. */
export function getMcpToolExecutionContext(): McpToolExecutionContext | undefined {
  return executionContextStorage.getStore();
}
