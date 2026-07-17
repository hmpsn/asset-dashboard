import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { throwOnHandle: false };
  const serverInstances: any[] = [];
  const transportInstances: any[] = [];
  const definitions = [{
    name: 'registered_tool',
    description: 'Registered tool.',
    inputSchema: { type: 'object', properties: {} },
  }];
  const listMcpToolDefinitions = vi.fn(() => definitions);
  const executeMcpTool = vi.fn(async () => ({
    content: [{ type: 'text', text: 'registered' }],
  }));
  const mcpLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  class MockServer {
    handlers = new Map<unknown, (req: unknown) => Promise<unknown>>();
    connect = vi.fn(async (transport: any) => {
      transport.boundServer = this;
    });
    close = vi.fn(async () => {});

    constructor(public meta: unknown, public options: unknown) {
      serverInstances.push(this);
    }

    setRequestHandler(schema: unknown, handler: (req: unknown) => Promise<unknown>) {
      this.handlers.set(schema, handler);
    }
  }

  class MockTransport {
    boundServer: MockServer | null = null;
    handleRequest = vi.fn(async () => {
      if (state.throwOnHandle) throw new Error('transport boom');
    });

    constructor(public options: { sessionIdGenerator?: unknown; enableJsonResponse?: boolean }) {
      transportInstances.push(this);
    }
  }

  return {
    state,
    serverInstances,
    transportInstances,
    definitions,
    listMcpToolDefinitions,
    executeMcpTool,
    mcpLog,
    MockServer,
    MockTransport,
  };
});

vi.mock('@modelcontextprotocol/sdk/server', () => ({
  Server: h.MockServer,
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp', () => ({
  StreamableHTTPServerTransport: h.MockTransport,
}));

vi.mock('@modelcontextprotocol/sdk/types', () => ({
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => h.mcpLog,
}));

vi.mock('../../server/mcp/tool-registry.js', () => ({
  listMcpToolDefinitions: h.listMcpToolDefinitions,
  executeMcpTool: h.executeMcpTool,
}));

import { handleMcpRequest } from '../../server/mcp/server.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types';
import { MCP_SERVER_INSTRUCTIONS } from '../../server/mcp/instructions.js';
import { MCP_SERVER_PROFILES } from '../../shared/types/mcp-runtime.js';

describe('mcp server transport routing', () => {
  beforeEach(() => {
    h.serverInstances.length = 0;
    h.transportInstances.length = 0;
    h.state.throwOnHandle = false;
    h.listMcpToolDefinitions.mockClear();
    h.executeMcpTool.mockClear();
    h.mcpLog.debug.mockClear();
  });

  it('constructs the Server with the agent instructions string in its options', async () => {
    await handleMcpRequest({
      body: {},
      requestId: 'req-instructions',
      mcpAuth: { scope: 'all' },
    } as never, {} as never);

    const server = h.serverInstances.at(-1);
    expect(server).toBeDefined();
    const options = server.options as { instructions?: string; capabilities?: unknown };
    expect(options.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(options.instructions!.length).toBeGreaterThan(0);
    expect(options.capabilities).toBeDefined();
  });

  it('uses the registry as the sole source for discovery and execution', async () => {
    const auth = { scope: 'all' as const };
    const serverRequestId = '7b8c9d0e-1234-4abc-8def-0123456789ab';
    await handleMcpRequest({
      body: {},
      requestId: serverRequestId,
      mcpAuth: auth,
    } as never, {} as never);

    const server = h.serverInstances.at(-1);
    const listHandler = server.handlers.get(ListToolsRequestSchema);
    const callHandler = server.handlers.get(CallToolRequestSchema);

    expect(listHandler).toBeTypeOf('function');
    expect(callHandler).toBeTypeOf('function');
    await expect(listHandler({} as never)).resolves.toEqual({ tools: h.definitions });

    await expect(callHandler({
      params: { name: 'registered_tool', arguments: { workspaceId: 'ws-1' } },
    } as never)).resolves.toEqual({ content: [{ type: 'text', text: 'registered' }] });
    expect(h.executeMcpTool).toHaveBeenCalledWith({
      name: 'registered_tool',
      args: { workspaceId: 'ws-1' },
      auth,
      requestId: serverRequestId,
    });
    expect(h.mcpLog.debug).toHaveBeenCalledWith(
      { tool: 'registered_tool' },
      'MCP tool call',
    );
  });

  it('does not put an unknown caller-controlled tool name in transport logs', async () => {
    const toolNameSecret = 'whsec_abcdefghijklmnopqrstuvwxyz';
    await handleMcpRequest({
      body: {},
      requestId: '7b8c9d0e-1234-4abc-8def-0123456789ab',
      mcpAuth: { scope: 'all' },
    } as never, {} as never);
    const server = h.serverInstances.at(-1);
    const callHandler = server.handlers.get(CallToolRequestSchema);

    await callHandler({ params: { name: toolNameSecret } } as never);

    expect(h.mcpLog.debug).toHaveBeenCalledWith({ knownTool: false }, 'MCP tool call');
    expect(JSON.stringify(h.mcpLog.debug.mock.calls)).not.toContain(toolNameSecret);
  });

  it('passes an empty argument object and creates a request id when middleware did not attach one', async () => {
    await handleMcpRequest({ body: {}, mcpAuth: { scope: 'all' } } as never, {} as never);
    const server = h.serverInstances.at(-1);
    const callHandler = server.handlers.get(CallToolRequestSchema);

    await callHandler({ params: { name: 'registered_tool' } } as never);
    expect(h.executeMcpTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'registered_tool',
      args: {},
      auth: { scope: 'all' },
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }));
  });

  it('reuses a server-owned UUID attached by request middleware', async () => {
    const requestId = '7b8c9d0e-1234-4abc-8def-0123456789ab';
    await handleMcpRequest({
      body: {},
      requestId,
      mcpAuth: { scope: 'all' },
    } as never, {} as never);
    const server = h.serverInstances.at(-1);
    const callHandler = server.handlers.get(CallToolRequestSchema);

    await callHandler({ params: { name: 'registered_tool' } } as never);
    expect(h.executeMcpTool).toHaveBeenCalledWith(expect.objectContaining({ requestId }));
  });

  it.each([
    ['an ordinary caller correlation id', 'trace.parent_01:span-02'],
    ['a bearer-shaped value containing whitespace', 'Bearer sk-live-secret'],
    ['an MCP key', 'mcp_AbCdEf0123456789_-'],
    ['an API key', 'sk-proj-AbCdEf0123456789'],
    ['a compact JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature_123'],
    ['an allowlisted Bearer value', 'Bearer:sk-live-secret'],
    ['a GitHub token', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'],
    ['an AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['a Slack token', 'xoxb-1234567890-abcdefghij'],
    ['a webhook secret', 'whsec_abcdefghijklmnopqrstuvwxyz'],
    ['an oversized value', 'a'.repeat(129)],
  ])('replaces non-server %s with a generated request id', async (_label, requestId) => {
    await handleMcpRequest({
      body: {},
      requestId,
      mcpAuth: { scope: 'all' },
    } as never, {} as never);
    const server = h.serverInstances.at(-1);
    const callHandler = server.handlers.get(CallToolRequestSchema);

    await callHandler({ params: { name: 'registered_tool' } } as never);
    expect(h.executeMcpTool).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    }));
    expect(h.executeMcpTool).not.toHaveBeenCalledWith(expect.objectContaining({ requestId }));
  });

  it('fails closed if the auth middleware context is absent', async () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    await handleMcpRequest({ body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(h.serverInstances).toHaveLength(0);
  });

  it('fails closed when the operator profile receives any workspace-key identity', async () => {
    for (const mcpAuth of [
      {
        scope: 'ws-operator-denied',
        keyId: 'key-operator-denied',
        label: 'Workspace key',
      },
      {
        scope: 'all',
        keyId: 'key-sentinel-collision',
        label: 'Workspace named all',
      },
    ]) {
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      await handleMcpRequest(
        { body: {}, mcpAuth } as never,
        res as never,
        MCP_SERVER_PROFILES.OPERATOR,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    }
    expect(h.serverInstances).toHaveLength(0);
    expect(h.transportInstances).toHaveLength(0);
  });

  it('creates stateless transport and closes server after handling request', async () => {
    const req = {
      body: { jsonrpc: '2.0', method: 'tools/list' },
      requestId: 'req-transport',
      mcpAuth: { scope: 'all' },
    };
    const res = {};

    await handleMcpRequest(req as never, res as never);

    const transport = h.transportInstances.at(-1);
    const server = h.serverInstances.at(-1);

    expect(transport?.options.enableJsonResponse).toBe(true);
    expect(transport?.options.sessionIdGenerator).toBeUndefined();
    expect(server?.connect).toHaveBeenCalledTimes(1);
    expect(transport?.handleRequest).toHaveBeenCalledWith(req, res, req.body);
    expect(server?.close).toHaveBeenCalledTimes(1);
  });

  it('still closes server when request handling throws', async () => {
    h.state.throwOnHandle = true;
    await expect(handleMcpRequest({
      body: {},
      requestId: 'req-error',
      mcpAuth: { scope: 'all' },
    } as never, {} as never)).rejects.toThrow('transport boom');

    const server = h.serverInstances.at(-1);
    expect(server?.close).toHaveBeenCalledTimes(1);
  });
});
