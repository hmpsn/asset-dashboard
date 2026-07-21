import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types';
import type { Request, Response } from 'express';
import type { McpServerProfile } from '../../shared/types/mcp-runtime.js';
import { MCP_SERVER_PROFILES } from '../../shared/types/mcp-runtime.js';
import { createLogger } from '../logger.js';
import { isServerRequestId } from '../request-correlation.js';
import { MCP_SERVER_INSTRUCTIONS } from './instructions.js';
import { MCP_OPERATOR_PROFILE_INSTRUCTIONS } from './profiles.js';
import {
  getMcpOperatorPrompt,
  listMcpOperatorPrompts,
} from './prompts.js';
import { isMcpMasterKeyAuth, type McpAuthContext } from './auth.js';
import {
  executeMcpTool,
  executeOperatorMcpTool,
  listMcpToolDefinitions,
  listMcpToolDefinitionsForProfile,
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
function createMcpServer(
  auth: McpAuthContext,
  requestId: string,
  profile: McpServerProfile,
) {
  const isOperator = profile === MCP_SERVER_PROFILES.OPERATOR;
  const instructions = isOperator
    ? MCP_OPERATOR_PROFILE_INSTRUCTIONS
    : MCP_SERVER_INSTRUCTIONS;
  const toolDefinitions = isOperator
    ? listMcpToolDefinitionsForProfile(profile)
    : listMcpToolDefinitions();
  const executeTool = isOperator
    ? executeOperatorMcpTool
    : executeMcpTool;
  const mcpServer = new Server(
    { name: 'hmpsn-studio', version: '1.0.0' },
    {
      capabilities: isOperator
        ? { tools: {}, prompts: {} }
        : { tools: {} },
      instructions,
    },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const knownDefinition = toolDefinitions.find(definition => definition.name === name);
    log.debug(
      knownDefinition ? { tool: knownDefinition.name } : { knownTool: false },
      'MCP tool call',
    );

    return executeTool({
      name,
      args: args ?? {},
      auth,
      requestId,
    });
  });

  if (isOperator) {
    mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: listMcpOperatorPrompts(),
    }));

    mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => (
      getMcpOperatorPrompt(
        request.params.name,
        request.params.arguments ?? {},
      )
    ));
  }

  return mcpServer;
}

export async function handleMcpRequest(
  req: Request,
  res: Response,
  profile: McpServerProfile = MCP_SERVER_PROFILES.FULL,
): Promise<void> {
  // Defense in depth: mcpAuthMiddleware always sets req.mcpAuth before this
  // handler runs. If it is somehow absent, fail closed rather than defaulting
  // to all-workspace scope.
  const auth = req.mcpAuth;
  if (
    !auth
    || (
      profile === MCP_SERVER_PROFILES.OPERATOR
      && !isMcpMasterKeyAuth(auth)
    )
  ) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Create a fresh server + transport per request (required by stateless MCP SDK mode).
  // enableJsonResponse: true returns JSON-RPC objects directly rather than SSE streams.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(auth, requestIdFor(req), profile);
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body as unknown);
  } finally {
    await server.close();
  }
}
