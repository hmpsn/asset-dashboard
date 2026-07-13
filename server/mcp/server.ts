import { Server } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types';
import type { Request, Response } from 'express';
import { createLogger } from '../logger.js';
import { workspaceTools, handleWorkspaceTool } from './tools/workspaces.js';
import { intelligenceTools, handleIntelligenceTool } from './tools/intelligence.js';
import { insightTools, handleInsightTool } from './tools/insights.js';
import { contentTools, handleContentTool } from './tools/content.js';
import { brandTools, handleBrandTool } from './tools/brand.js';
import { clientTools, handleClientTool } from './tools/clients.js';
import { keywordActionTools, handleKeywordActionTool } from './tools/keyword-actions.js';
import { contentActionTools, handleContentActionTool } from './tools/content-actions.js';
import { recommendationActionTools, handleRecommendationActionTool } from './tools/recommendation-actions.js';
import { contentGenerationActionTools, handleContentGenerationActionTool } from './tools/content-generation-actions.js';
import { schemaActionTools, handleSchemaActionTool } from './tools/schema-actions.js';
import { analyticsReadActionTools, handleAnalyticsReadActionTool } from './tools/analytics-read-actions.js';
import { jobActionTools, handleJobActionTool } from './tools/job-actions.js';
import { MCP_SERVER_INSTRUCTIONS } from './instructions.js';
import type { McpAuthContext } from './auth.js';

const log = createLogger('mcp-server');

const ALL_TOOLS = [
  ...workspaceTools,
  ...intelligenceTools,
  ...insightTools,
  ...contentTools,
  ...brandTools,
  ...clientTools,
  ...keywordActionTools,
  ...contentActionTools,
  ...recommendationActionTools,
  ...contentGenerationActionTools,
  ...schemaActionTools,
  ...analyticsReadActionTools,
  ...jobActionTools,
];

type WorkspaceArgumentName = 'workspaceId' | 'workspace_id';

interface WorkspaceScopeResolution {
  workspaceId?: string;
  conflictingAliases?: {
    workspaceId: string;
    workspace_id: string;
  };
}

const TOOL_BY_NAME = new Map(
  ALL_TOOLS.map(tool => [tool.name, tool] as const),
);

/**
 * Resolve the workspace field that a tool actually declares and therefore
 * consumes. Tool schemas use both camelCase and snake_case, so inspecting the
 * first raw alias present would let an undeclared decoy field authorize a
 * different declared workspace field.
 */
function declaredWorkspaceArgument(toolName: string): WorkspaceArgumentName | undefined {
  const tool = TOOL_BY_NAME.get(toolName) as {
    inputSchema?: { properties?: Record<string, unknown> };
  } | undefined;
  const properties = tool?.inputSchema?.properties;
  if (!properties) return undefined;

  const hasCamel = Object.prototype.hasOwnProperty.call(properties, 'workspaceId');
  const hasSnake = Object.prototype.hasOwnProperty.call(properties, 'workspace_id');

  // No current tool should declare both. Fail closed for scoped keys if a future
  // schema does, until it defines a single canonical authorization field.
  if (hasCamel === hasSnake) return undefined;
  return hasCamel ? 'workspaceId' : 'workspace_id';
}

function resolveWorkspaceScope(
  toolName: string,
  args: Record<string, unknown>,
): WorkspaceScopeResolution {
  const camel = typeof args.workspaceId === 'string' && args.workspaceId.length > 0
    ? args.workspaceId
    : undefined;
  const snake = typeof args.workspace_id === 'string' && args.workspace_id.length > 0
    ? args.workspace_id
    : undefined;

  if (camel !== undefined && snake !== undefined && camel !== snake) {
    return {
      conflictingAliases: {
        workspaceId: camel,
        workspace_id: snake,
      },
    };
  }

  const declaredArgument = declaredWorkspaceArgument(toolName);
  if (!declaredArgument) return {};

  const declaredValue = args[declaredArgument];
  return {
    workspaceId: typeof declaredValue === 'string' && declaredValue.length > 0
      ? declaredValue
      : undefined,
  };
}

// Factory: create a fresh Server + Transport per request.
// The MCP SDK's stateless transport cannot be reused across requests —
// doing so causes message-ID collisions. Tool registrations are defined
// once (ALL_TOOLS / handlers) and applied to each new Server instance.
function createMcpServer(auth: McpAuthContext) {
  const mcpServer = new Server(
    { name: 'hmpsn-studio', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log.debug({ tool: name }, 'MCP tool call');

    const safeArgs = args ?? {};

    const workspaceScope = resolveWorkspaceScope(
      name,
      safeArgs as Record<string, unknown>,
    );

    // Conflicting aliases are invalid for every caller, including the master
    // key. Besides being ambiguous, accepting them would make authorization and
    // tool validation depend on which layer happens to inspect which alias.
    if (workspaceScope.conflictingAliases) {
      log.warn(
        { tool: name },
        'MCP tool call supplied conflicting workspace aliases — rejected',
      );
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: 'Validation failed: workspaceId and workspace_id must match when both are provided.',
        }],
      };
    }

    // ── Workspace-scope enforcement (SECURITY-CRITICAL) ──────────────────────
    // A per-workspace key (auth.scope !== 'all') may only operate on its own
    // workspace. The master key (scope 'all') is unaffected. We enforce HERE,
    // after the tool name + args are parsed, because workspace_id is a tool
    // ARGUMENT in the JSON body, not a URL/header value reachable in the HTTP
    // middleware. Fail-closed:
    //   - cross-workspace workspace_id              → reject
    //   - no-workspace_id tools (e.g. list_workspaces) → reject for scoped keys,
    //     because a workspace key must not enumerate/act across all workspaces.
    if (auth.scope !== 'all') {
      const argWorkspaceId = workspaceScope.workspaceId;
      if (argWorkspaceId === undefined) {
        log.warn({ tool: name, scope: auth.scope }, 'Workspace-scoped key called a tool without a workspace_id argument — rejected');
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: `Forbidden: this API key is scoped to a single workspace and cannot call "${name}", which is not workspace-scoped.`,
          }],
        };
      }
      if (argWorkspaceId !== auth.scope) {
        log.warn({ tool: name, requested: argWorkspaceId, scope: auth.scope }, 'Workspace-scoped key attempted cross-workspace access — rejected');
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: `Forbidden: this API key is scoped to workspace ${auth.scope} and cannot operate on workspace ${argWorkspaceId}.`,
          }],
        };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (workspaceTools.some(t => t.name === name)) {
      return handleWorkspaceTool(name, safeArgs);
    }
    if (intelligenceTools.some(t => t.name === name)) {
      return handleIntelligenceTool(name, safeArgs);
    }
    if (insightTools.some(t => t.name === name)) {
      return handleInsightTool(name, safeArgs);
    }
    if (contentTools.some(t => t.name === name)) {
      return handleContentTool(name, safeArgs);
    }
    if (brandTools.some(t => t.name === name)) {
      return handleBrandTool(name, safeArgs);
    }
    if (clientTools.some(t => t.name === name)) {
      return handleClientTool(name, safeArgs);
    }
    if (keywordActionTools.some(t => t.name === name)) {
      return handleKeywordActionTool(name, safeArgs);
    }
    if (contentActionTools.some(t => t.name === name)) {
      return handleContentActionTool(name, safeArgs);
    }
    if (recommendationActionTools.some(t => t.name === name)) {
      return handleRecommendationActionTool(name, safeArgs);
    }
    if (contentGenerationActionTools.some(t => t.name === name)) {
      return handleContentGenerationActionTool(name, safeArgs);
    }
    if (schemaActionTools.some(t => t.name === name)) {
      return handleSchemaActionTool(name, safeArgs);
    }
    if (analyticsReadActionTools.some(t => t.name === name)) {
      return handleAnalyticsReadActionTool(name, safeArgs);
    }
    if (jobActionTools.some(t => t.name === name)) {
      return handleJobActionTool(name, safeArgs);
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  });

  return mcpServer;
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // Defense in depth: mcpAuthMiddleware always sets req.mcpAuth before this
  // handler runs. If it is somehow absent (handler reached without the
  // middleware), fail-closed rather than defaulting to all-workspace scope.
  const auth = req.mcpAuth;
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Create a fresh server + transport per request (required by stateless MCP SDK mode).
  // enableJsonResponse: true — return JSON-RPC objects directly rather than SSE streams,
  // which simplifies both the client interface and integration test assertions.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
    enableJsonResponse: true,
  });
  const server = createMcpServer(auth);
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body as unknown);
  } finally {
    await server.close();
  }
}
