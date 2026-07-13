import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types';
import type { Request, Response } from 'express';
import { createLogger } from '../logger.js';
import { isServerRequestId } from '../request-correlation.js';
import { MCP_SERVER_INSTRUCTIONS } from './instructions.js';
import type { McpAuthContext } from './auth.js';
import {
  executeMcpTool,
  listMcpToolDefinitions,
} from './tool-registry.js';

const log = createLogger('mcp-server');

function requestIdFor(req: Request): string {
  const requestId = (req as Request & { requestId?: unknown }).requestId;
  return isServerRequestId(requestId)
    ? requestId
    : randomUUID();
}

// Factory: create a fresh Server + Transport per request.
// The MCP SDK's stateless transport cannot be reused across requests — doing
// so causes message-ID collisions. Discovery, scope, and dispatch all resolve
// through the canonical registry applied to each fresh Server instance.
function createMcpServer(auth: McpAuthContext, requestId: string) {
  const mcpServer = new Server(
    { name: 'hmpsn-studio', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listMcpToolDefinitions(),
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const knownDefinition = listMcpToolDefinitions().find(definition => definition.name === name);
    log.debug(
      knownDefinition ? { tool: knownDefinition.name } : { knownTool: false },
      'MCP tool call',
    );

    return executeMcpTool({
      name,
      args: args ?? {},
      auth,
      requestId,
    });
  });

  return mcpServer;
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  // Defense in depth: mcpAuthMiddleware always sets req.mcpAuth before this
  // handler runs. If it is somehow absent, fail closed rather than defaulting
  // to all-workspace scope.
  const auth = req.mcpAuth;
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Create a fresh server + transport per request (required by stateless MCP SDK mode).
  // enableJsonResponse: true returns JSON-RPC objects directly rather than SSE streams.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(auth, requestIdFor(req));
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body as unknown);
  } finally {
    await server.close();
  }
}
