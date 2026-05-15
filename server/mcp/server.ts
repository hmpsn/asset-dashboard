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

// Singleton: one server + one transport for the application lifetime.
// Each request calls transport.handleRequest() on the shared transport.
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

  const safeArgs = (args ?? {}) as Record<string, unknown>;

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

const mcpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless — no session tracking
});

// Wire server to transport once at startup
mcpServer.connect(mcpTransport).catch((err) => {
  log.error({ err }, 'Failed to connect MCP server to transport');
});

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  await mcpTransport.handleRequest(req, res, req.body as unknown);
}
