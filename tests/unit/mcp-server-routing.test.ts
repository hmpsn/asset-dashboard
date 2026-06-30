import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { throwOnHandle: false };
  const serverInstances: any[] = [];
  const transportInstances: any[] = [];

  const mockHandlers = {
    workspace: vi.fn(async () => ({ content: [{ type: 'text', text: 'workspace' }] })),
    intelligence: vi.fn(async () => ({ content: [{ type: 'text', text: 'intelligence' }] })),
    insight: vi.fn(async () => ({ content: [{ type: 'text', text: 'insight' }] })),
    content: vi.fn(async () => ({ content: [{ type: 'text', text: 'content' }] })),
    brand: vi.fn(async () => ({ content: [{ type: 'text', text: 'brand' }] })),
    client: vi.fn(async () => ({ content: [{ type: 'text', text: 'client' }] })),
    keywordAction: vi.fn(async () => ({ content: [{ type: 'text', text: 'keyword' }] })),
    contentAction: vi.fn(async () => ({ content: [{ type: 'text', text: 'content-action' }] })),
    recommendationAction: vi.fn(async () => ({ content: [{ type: 'text', text: 'recommendation-action' }] })),
    contentGenerationAction: vi.fn(async () => ({ content: [{ type: 'text', text: 'content-generation-action' }] })),
    schemaAction: vi.fn(async () => ({ content: [{ type: 'text', text: 'schema-action' }] })),
    jobAction: vi.fn(async () => ({ content: [{ type: 'text', text: 'job' }] })),
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

  return { state, serverInstances, transportInstances, mockHandlers, MockServer, MockTransport };
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
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/mcp/tools/workspaces.js', () => ({
  workspaceTools: [{ name: 'workspace_tool' }],
  handleWorkspaceTool: h.mockHandlers.workspace,
}));

vi.mock('../../server/mcp/tools/intelligence.js', () => ({
  intelligenceTools: [{ name: 'intelligence_tool' }],
  handleIntelligenceTool: h.mockHandlers.intelligence,
}));

vi.mock('../../server/mcp/tools/insights.js', () => ({
  insightTools: [{ name: 'insight_tool' }],
  handleInsightTool: h.mockHandlers.insight,
}));

vi.mock('../../server/mcp/tools/content.js', () => ({
  contentTools: [{ name: 'content_tool' }],
  handleContentTool: h.mockHandlers.content,
}));

vi.mock('../../server/mcp/tools/brand.js', () => ({
  brandTools: [{ name: 'brand_tool' }],
  handleBrandTool: h.mockHandlers.brand,
}));

vi.mock('../../server/mcp/tools/clients.js', () => ({
  clientTools: [{ name: 'client_tool' }],
  handleClientTool: h.mockHandlers.client,
}));

vi.mock('../../server/mcp/tools/keyword-actions.js', () => ({
  keywordActionTools: [{ name: 'keyword_action_tool' }],
  handleKeywordActionTool: h.mockHandlers.keywordAction,
}));

vi.mock('../../server/mcp/tools/content-actions.js', () => ({
  contentActionTools: [{ name: 'content_action_tool' }],
  handleContentActionTool: h.mockHandlers.contentAction,
}));

vi.mock('../../server/mcp/tools/recommendation-actions.js', () => ({
  recommendationActionTools: [{ name: 'recommendation_action_tool' }],
  handleRecommendationActionTool: h.mockHandlers.recommendationAction,
}));

vi.mock('../../server/mcp/tools/content-generation-actions.js', () => ({
  contentGenerationActionTools: [{ name: 'content_generation_action_tool' }],
  handleContentGenerationActionTool: h.mockHandlers.contentGenerationAction,
}));

vi.mock('../../server/mcp/tools/schema-actions.js', () => ({
  schemaActionTools: [{ name: 'schema_action_tool' }],
  handleSchemaActionTool: h.mockHandlers.schemaAction,
}));

vi.mock('../../server/mcp/tools/job-actions.js', () => ({
  jobActionTools: [{ name: 'job_action_tool' }],
  handleJobActionTool: h.mockHandlers.jobAction,
}));

import { handleMcpRequest } from '../../server/mcp/server.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types';
import { MCP_SERVER_INSTRUCTIONS } from '../../server/mcp/instructions.js';

describe('mcp server routing', () => {
  beforeEach(() => {
    h.serverInstances.length = 0;
    h.transportInstances.length = 0;
    h.state.throwOnHandle = false;
    for (const fn of Object.values(h.mockHandlers)) fn.mockClear();
  });

  it('constructs the Server with the agent instructions string in its options', async () => {
    await handleMcpRequest({ body: {} } as never, {} as never);

    const server = h.serverInstances.at(-1);
    expect(server).toBeDefined();
    const options = server.options as { instructions?: string; capabilities?: unknown };
    expect(options.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(options.instructions!.length).toBeGreaterThan(0);
    // capabilities must still be present (instructions is additive, not a replacement).
    expect(options.capabilities).toBeDefined();
  });

  it('registers list + call handlers and dispatches each tool family', async () => {
    await handleMcpRequest({ body: {} } as never, {} as never);

    const server = h.serverInstances.at(-1);
    expect(server).toBeDefined();

    const listHandler = server.handlers.get(ListToolsRequestSchema);
    const callHandler = server.handlers.get(CallToolRequestSchema);

    expect(listHandler).toBeTypeOf('function');
    expect(callHandler).toBeTypeOf('function');

    const listResult = await listHandler({} as never) as { tools: Array<{ name: string }> };
    expect(listResult.tools.map(t => t.name)).toEqual([
      'workspace_tool',
      'intelligence_tool',
      'insight_tool',
      'content_tool',
      'brand_tool',
      'client_tool',
      'keyword_action_tool',
      'content_action_tool',
      'recommendation_action_tool',
      'content_generation_action_tool',
      'schema_action_tool',
      'job_action_tool',
    ]);

    await callHandler({ params: { name: 'workspace_tool', arguments: { a: 1 } } } as never);
    await callHandler({ params: { name: 'intelligence_tool', arguments: { b: 1 } } } as never);
    await callHandler({ params: { name: 'insight_tool', arguments: { c: 1 } } } as never);
    await callHandler({ params: { name: 'content_tool', arguments: { d: 1 } } } as never);
    await callHandler({ params: { name: 'brand_tool', arguments: { h: 1 } } } as never);
    await callHandler({ params: { name: 'client_tool', arguments: { e: 1 } } } as never);
    await callHandler({ params: { name: 'keyword_action_tool', arguments: { f: 1 } } } as never);
    await callHandler({ params: { name: 'content_action_tool', arguments: { g: 1 } } } as never);
    await callHandler({ params: { name: 'recommendation_action_tool', arguments: { r: 1 } } } as never);
    await callHandler({ params: { name: 'content_generation_action_tool', arguments: { i: 1 } } } as never);
    await callHandler({ params: { name: 'schema_action_tool', arguments: { s: 1 } } } as never);
    await callHandler({ params: { name: 'job_action_tool' } } as never);

    expect(h.mockHandlers.workspace).toHaveBeenCalledWith('workspace_tool', { a: 1 });
    expect(h.mockHandlers.intelligence).toHaveBeenCalledWith('intelligence_tool', { b: 1 });
    expect(h.mockHandlers.insight).toHaveBeenCalledWith('insight_tool', { c: 1 });
    expect(h.mockHandlers.content).toHaveBeenCalledWith('content_tool', { d: 1 });
    expect(h.mockHandlers.brand).toHaveBeenCalledWith('brand_tool', { h: 1 });
    expect(h.mockHandlers.client).toHaveBeenCalledWith('client_tool', { e: 1 });
    expect(h.mockHandlers.keywordAction).toHaveBeenCalledWith('keyword_action_tool', { f: 1 });
    expect(h.mockHandlers.contentAction).toHaveBeenCalledWith('content_action_tool', { g: 1 });
    expect(h.mockHandlers.recommendationAction).toHaveBeenCalledWith('recommendation_action_tool', { r: 1 });
    expect(h.mockHandlers.contentGenerationAction).toHaveBeenCalledWith('content_generation_action_tool', { i: 1 });
    expect(h.mockHandlers.schemaAction).toHaveBeenCalledWith('schema_action_tool', { s: 1 });
    expect(h.mockHandlers.jobAction).toHaveBeenCalledWith('job_action_tool', {});

    const unknown = await callHandler({ params: { name: 'unknown_tool', arguments: { z: 1 } } } as never) as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain('Unknown tool: unknown_tool');
  });

  it('creates stateless transport and closes server after handling request', async () => {
    const req = { body: { jsonrpc: '2.0', method: 'tools/list' } };
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
    await expect(handleMcpRequest({ body: {} } as never, {} as never)).rejects.toThrow('transport boom');

    const server = h.serverInstances.at(-1);
    expect(server?.close).toHaveBeenCalledTimes(1);
  });
});
