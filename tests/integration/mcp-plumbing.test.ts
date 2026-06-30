/**
 * Plumbing test for the MCP P1+P2 surface.
 *
 * Exercises the REAL HTTP path end-to-end against the spawned test server —
 * auth middleware → handleMcpRequest → workspace-scope enforcement → tool
 * dispatch — for (a) the newly-added tools being registered + callable, and
 * (b) the per-workspace API key scope enforcement. This is the closest local
 * proxy for the on-main E2E: it hits /mcp over HTTP with a real Bearer key
 * (master) and a real per-workspace key minted via createMcpApiKey.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createMcpApiKey, revokeMcpApiKey } from '../../server/mcp/api-keys.js';

const MASTER_KEY = 'plumbing-master-key-xyz';
const ctx = createEphemeralTestContext(import.meta.url);

let wsA: ReturnType<typeof seedWorkspace>;
let wsB: ReturnType<typeof seedWorkspace>;
let perWsKey: string;
let perWsKeyId: string;

beforeAll(async () => {
  process.env.MCP_API_KEY = MASTER_KEY;
  await ctx.startServer();
  wsA = seedWorkspace();
  wsB = seedWorkspace();
  const created = createMcpApiKey(wsA.workspaceId, 'plumbing-test-key');
  perWsKey = created.plaintextKeyOnceShown;
  perWsKeyId = created.id;
});

afterAll(async () => {
  revokeMcpApiKey(perWsKeyId);
  wsA.cleanup();
  wsB.cleanup();
  await ctx.stopServer();
  delete process.env.MCP_API_KEY;
});

async function mcpPost(body: unknown, token?: string): Promise<Response> {
  return ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function initialize(token: string): Promise<void> {
  await mcpPost(
    {
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'plumbing', version: '1.0' } },
      id: 0,
    },
    token,
  );
}

interface ToolResult {
  result?: { isError?: boolean; content: Array<{ type: string; text: string }> };
  error?: unknown;
}

async function callTool(name: string, args: Record<string, unknown>, token: string): Promise<ToolResult> {
  await initialize(token);
  const res = await mcpPost(
    { jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 1 },
    token,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ToolResult;
}

describe('MCP plumbing — P1+P2 tools are registered', () => {
  it('tools/list includes the newly-added tools', async () => {
    await initialize(MASTER_KEY);
    const res = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, MASTER_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    const expected = [
      // P1
      'advance_content_status', 'publish_post', 'resolve_insight',
      'respond_to_approval_item', 'respond_to_client_action',
      // P2
      'list_recommendations', 'apply_recommendation',
      'generate_schema', 'validate_schema', 'publish_schema',
      'start_brief_generation', 'start_post_generation',
      'get_search_performance',
    ];
    for (const t of expected) {
      expect(names, `tools/list is missing ${t}`).toContain(t);
    }
  });
});

describe('MCP plumbing — new tools dispatch over real HTTP', () => {
  it('list_recommendations dispatches and returns a recommendations payload', async () => {
    const body = await callTool('list_recommendations', { workspace_id: wsA.workspaceId }, MASTER_KEY);
    expect(body.result?.isError).toBeFalsy();
    const payload = JSON.parse(body.result!.content[0].text) as Record<string, unknown>;
    expect(payload).toHaveProperty('recommendations');
    expect(Array.isArray(payload.recommendations)).toBe(true);
  });

  it('get_search_performance fails gracefully when no GSC property is connected', async () => {
    const body = await callTool('get_search_performance', { workspace_id: wsA.workspaceId }, MASTER_KEY);
    expect(body.result?.isError).toBe(true);
    expect(body.result!.content[0].text).toMatch(/Google Search Console|Google is not connected/i);
  });
});

describe('MCP plumbing — per-workspace API key scope enforcement', () => {
  it('a workspace-scoped key operates on its own workspace', async () => {
    const body = await callTool('list_recommendations', { workspace_id: wsA.workspaceId }, perWsKey);
    expect(body.result?.isError).toBeFalsy();
  });

  it('a workspace-scoped key is REJECTED on a different workspace (scope enforcement)', async () => {
    const body = await callTool('list_recommendations', { workspace_id: wsB.workspaceId }, perWsKey);
    expect(body.result?.isError).toBe(true);
    expect(body.result!.content[0].text).toMatch(/Forbidden|scoped to workspace/i);
  });

  it('an unknown key is rejected at the HTTP layer (401)', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, 'definitely-not-a-real-key');
    expect(res.status).toBe(401);
  });

  it('the master key still operates on any workspace', async () => {
    const body = await callTool('list_recommendations', { workspace_id: wsB.workspaceId }, MASTER_KEY);
    expect(body.result?.isError).toBeFalsy();
  });
});
