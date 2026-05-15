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
import { clientTools, handleClientTool } from './tools/clients.js';

const log = createLogger('mcp-server');

const ALL_TOOLS = [
  ...workspaceTools,
  ...intelligenceTools,
  ...insightTools,
  ...contentTools,
  ...clientTools,
];

// Factory: create a fresh Server + Transport per request.
// The MCP SDK's stateless transport cannot be reused across requests —
// doing so causes message-ID collisions. Tool registrations are defined
// once (ALL_TOOLS / handlers) and applied to each new Server instance.
function createMcpServer() {
  const mcpServer = new Server(
    { name: 'hmpsn-studio', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log.debug({ tool: name }, 'MCP tool call');

    const safeArgs = args ?? {};

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
    if (clientTools.some(t => t.name === name)) {
      return handleClientTool(name, safeArgs);
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  });

  return mcpServer;
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // Create a fresh server + transport per request (required by stateless MCP SDK mode).
  // enableJsonResponse: true — return JSON-RPC objects directly rather than SSE streams,
  // which simplifies both the client interface and integration test assertions.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
    enableJsonResponse: true,
  });
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body as unknown);
}
