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

/**
 * Extract a workspace id from tool arguments, if the tool carries one.
 *
 * Tool schemas in this server use BOTH casings for the same concept:
 *   - `workspaceId` (e.g. get_workspace_overview)
 *   - `workspace_id` (e.g. update_workspace, delete_workspace)
 * Scope enforcement must consider both so a workspace-scoped key cannot reach a
 * sibling workspace through whichever casing a given tool happens to use.
 */
function extractWorkspaceIdArg(args: Record<string, unknown>): string | undefined {
  const camel = args.workspaceId;
  if (typeof camel === 'string' && camel.length > 0) return camel;
  const snake = args.workspace_id;
  if (typeof snake === 'string' && snake.length > 0) return snake;
  return undefined;
}

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
      const argWorkspaceId = extractWorkspaceIdArg(safeArgs as Record<string, unknown>);
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
