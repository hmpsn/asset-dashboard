/**
 * Integration tests for the MCP server.
 * Port: 13229
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const MCP_TEST_KEY = 'test-mcp-key-abc123';
const ctx = createTestContext(13229);

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(async () => {
  process.env.MCP_API_KEY = MCP_TEST_KEY;
  await ctx.startServer();
  ws = seedWorkspace();
});

afterAll(async () => {
  ws.cleanup();
  await ctx.stopServer();
  delete process.env.MCP_API_KEY;
});

// Helper: POST a JSON-RPC message to /mcp with optional Bearer token
async function mcpPost(
  body: unknown,
  token?: string,
): Promise<Response> {
  return ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Helper: perform MCP initialize handshake, then call a tool
async function mcpToolCall(
  toolName: string,
  toolArgs: Record<string, unknown> = {},
): Promise<unknown> {
  // MCP requires initialize before tool calls
  await mcpPost(
    {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 0,
    },
    MCP_TEST_KEY,
  );

  const res = await mcpPost(
    {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
      id: 1,
    },
    MCP_TEST_KEY,
  );

  expect(res.status).toBe(200);
  const body = await res.json() as { result?: { content: Array<{ type: string; text: string }> }; error?: unknown };
  expect(body.result).toBeDefined();
  expect(body.result!.content.length).toBeGreaterThan(0);
  return JSON.parse(body.result!.content[0].text);
}

describe('MCP auth', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with a wrong Bearer token', async () => {
    const res = await mcpPost(
      { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      'wrong-key',
    );
    expect(res.status).toBe(401);
  });

  it('accepts requests with the correct Bearer token', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        id: 0,
      },
      MCP_TEST_KEY,
    );
    expect(res.status).toBe(200);
  });
});

describe('list_workspaces', () => {
  it('returns an array of workspace summaries', async () => {
    const result = await mcpToolCall('list_workspaces') as unknown[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const first = result[0] as Record<string, unknown>;
    expect(typeof first.id).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.tier).toBe('string');
  });
});

describe('get_workspace_overview', () => {
  it('returns overview for a known workspace', async () => {
    const result = await mcpToolCall('get_workspace_overview', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    expect(result.id).toBe(ws.workspaceId);
    expect(typeof result.name).toBe('string');
    expect(typeof result.tier).toBe('string');
    expect(typeof result.pendingApprovals).toBe('number');
    expect(typeof result.pendingRequests).toBe('number');
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_workspace_overview', arguments: { workspaceId: 'nonexistent-ws' } },
        id: 2,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean; content: Array<{ text: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content[0].text).toContain('Workspace not found');
  });
});

describe('get_workspace_intelligence', () => {
  it('returns an intelligence bundle for a known workspace', async () => {
    const result = await mcpToolCall('get_workspace_intelligence', {
      workspaceId: ws.workspaceId,
    }) as Record<string, unknown>;
    expect(result.workspaceId).toBe(ws.workspaceId);
    expect(typeof result.assembledAt).toBe('string');
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_workspace_intelligence',
          arguments: { workspaceId: 'nonexistent-ws' },
        },
        id: 3,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});

describe('get_insights', () => {
  it('returns an array for a known workspace', async () => {
    const result = await mcpToolCall('get_insights', {
      workspaceId: ws.workspaceId,
    }) as unknown[];
    expect(Array.isArray(result)).toBe(true);
  });

  it('accepts a type filter', async () => {
    const result = await mcpToolCall('get_insights', {
      workspaceId: ws.workspaceId,
      type: 'content_decay',
    }) as Array<Record<string, unknown>>;
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result.every(i => i.insightType === 'content_decay')).toBe(true); // every-ok — length guard above
    }
  });

  it('returns an error for an unknown workspace', async () => {
    const res = await mcpPost(
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_insights', arguments: { workspaceId: 'nonexistent' } },
        id: 4,
      },
      MCP_TEST_KEY,
    );
    const body = await res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });
});

describe('get_anomalies', () => {
  it('returns an array of anomaly_digest insights', async () => {
    const result = await mcpToolCall('get_anomalies', {
      workspaceId: ws.workspaceId,
    }) as unknown[];
    expect(Array.isArray(result)).toBe(true);
    // May be empty if no anomalies seeded — that is valid
  });
});
