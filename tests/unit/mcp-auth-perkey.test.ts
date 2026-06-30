/**
 * Per-workspace MCP API key auth + caller identity + scope enforcement.
 *
 * Covers:
 *  - master key (env MCP_API_KEY) → scope 'all', unchanged behavior, no label
 *  - a valid per-workspace key → scope = workspaceId + label attached, last_used_at touched
 *  - a revoked key → rejected (fail-closed)
 *  - an unknown key → rejected (fail-closed)
 *  - scope enforcement in handleMcpRequest:
 *      • workspace-A key calling a tool with workspace_id=B → rejected
 *      • workspace-A key calling a tool with workspace_id=A → allowed
 *      • workspace-A key calling a no-workspace_id tool (list_workspaces) → rejected
 *      • master key → allowed regardless of workspace_id
 *
 * The MCP SDK + tool-family modules are mocked (mirroring mcp-server-routing.test.ts)
 * so we can grab the CallToolRequestSchema handler and exercise the scope block
 * directly. The auth middleware + key store run against the real test DB.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the MCP SDK + tool families so handleMcpRequest is inspectable ──────
const h = vi.hoisted(() => {
  const serverInstances: any[] = [];

  const workspaceHandler = vi.fn(async () => ({ content: [{ type: 'text', text: 'workspace' }] }));

  class MockServer {
    handlers = new Map<unknown, (req: unknown) => Promise<unknown>>();
    connect = vi.fn(async (transport: any) => { transport.boundServer = this; });
    close = vi.fn(async () => {});
    constructor(public meta: unknown, public options: unknown) { serverInstances.push(this); }
    setRequestHandler(schema: unknown, handler: (req: unknown) => Promise<unknown>) {
      this.handlers.set(schema, handler);
    }
  }

  class MockTransport {
    boundServer: MockServer | null = null;
    handleRequest = vi.fn(async () => {});
    constructor(public options: unknown) {}
  }

  return { serverInstances, workspaceHandler, MockServer, MockTransport };
});

vi.mock('@modelcontextprotocol/sdk/server', () => ({ Server: h.MockServer }));
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp', () => ({
  StreamableHTTPServerTransport: h.MockTransport,
}));
vi.mock('@modelcontextprotocol/sdk/types', () => ({
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
}));

// Mock every tool family. Only the workspace family carries a spy; the others
// just need a name + a no-op handler so handleMcpRequest's dispatch compiles.
vi.mock('../../server/mcp/tools/workspaces.js', () => ({
  workspaceTools: [
    { name: 'list_workspaces' },
    { name: 'get_workspace_overview' },
    { name: 'update_workspace' },
  ],
  handleWorkspaceTool: h.workspaceHandler,
}));
// Other tool families: empty tool lists + no-op handlers (inlined — vi.mock
// factories are hoisted and cannot reference module-level variables).
vi.mock('../../server/mcp/tools/intelligence.js', () => ({ intelligenceTools: [], handleIntelligenceTool: vi.fn() }));
vi.mock('../../server/mcp/tools/insights.js', () => ({ insightTools: [], handleInsightTool: vi.fn() }));
vi.mock('../../server/mcp/tools/content.js', () => ({ contentTools: [], handleContentTool: vi.fn() }));
vi.mock('../../server/mcp/tools/brand.js', () => ({ brandTools: [], handleBrandTool: vi.fn() }));
vi.mock('../../server/mcp/tools/clients.js', () => ({ clientTools: [], handleClientTool: vi.fn() }));
vi.mock('../../server/mcp/tools/keyword-actions.js', () => ({ keywordActionTools: [], handleKeywordActionTool: vi.fn() }));
vi.mock('../../server/mcp/tools/content-actions.js', () => ({ contentActionTools: [], handleContentActionTool: vi.fn() }));
vi.mock('../../server/mcp/tools/job-actions.js', () => ({ jobActionTools: [], handleJobActionTool: vi.fn() }));

import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types';
import { mcpAuthMiddleware } from '../../server/mcp/auth.js';
import { handleMcpRequest } from '../../server/mcp/server.js';
import {
  createMcpApiKey,
  findActiveKeyByHash,
  hashMcpApiKey,
  revokeMcpApiKey,
} from '../../server/mcp/api-keys.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const MASTER = 'master-key-for-tests';
const prevMaster = process.env.MCP_API_KEY;

const cleanupWorkspaceIds: string[] = [];
afterAll(() => {
  for (const id of cleanupWorkspaceIds) deleteWorkspace(id);
  if (prevMaster === undefined) delete process.env.MCP_API_KEY;
  else process.env.MCP_API_KEY = prevMaster;
});

function createRes() {
  return {
    statusCode: 0 as number,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: vi.fn(function (this: any, payload: unknown) { this.body = payload; return this; }),
  };
}

// Drive a tool call through the real scope-enforcement block by grabbing the
// CallToolRequestSchema handler from the per-request mock Server.
async function callTool(
  mcpAuth: { scope: string; label?: string; keyId?: string },
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> {
  h.serverInstances.length = 0;
  await handleMcpRequest({ body: {}, mcpAuth } as never, createRes() as never);
  const server = h.serverInstances.at(-1);
  const callHandler = server.handlers.get(CallToolRequestSchema);
  return callHandler({ params: { name: toolName, arguments: args } } as never);
}

describe('mcp per-workspace api key store', () => {
  it('creates a key, returns plaintext once, stores only the hash, and finds it by hash', () => {
    const ws = createWorkspace(`MCP Key Store ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    const { id, plaintextKeyOnceShown } = createMcpApiKey(ws.id, 'CI key');
    expect(plaintextKeyOnceShown).toMatch(/^mcp_/);
    expect(id).toBeTruthy();

    const found = findActiveKeyByHash(hashMcpApiKey(plaintextKeyOnceShown));
    expect(found).toEqual({ id, workspaceId: ws.id, label: 'CI key' });
  });

  it('ignores revoked keys (rotation)', () => {
    const ws = createWorkspace(`MCP Key Revoke ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    const { id, plaintextKeyOnceShown } = createMcpApiKey(ws.id, 'rotating');
    const hash = hashMcpApiKey(plaintextKeyOnceShown);
    expect(findActiveKeyByHash(hash)).not.toBeNull();

    expect(revokeMcpApiKey(id)).toBe(true);
    expect(findActiveKeyByHash(hash)).toBeNull();
    // Idempotent — revoking again does nothing.
    expect(revokeMcpApiKey(id)).toBe(false);
  });

  it('supports multiple active keys per workspace', () => {
    const ws = createWorkspace(`MCP Multi Key ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    const a = createMcpApiKey(ws.id, 'key-a');
    const b = createMcpApiKey(ws.id, 'key-b');
    expect(findActiveKeyByHash(hashMcpApiKey(a.plaintextKeyOnceShown))?.label).toBe('key-a');
    expect(findActiveKeyByHash(hashMcpApiKey(b.plaintextKeyOnceShown))?.label).toBe('key-b');
  });
});

describe('mcpAuthMiddleware — master + per-workspace keys', () => {
  beforeEach(() => {
    process.env.MCP_API_KEY = MASTER;
  });

  it('master key → scope all, no label (unchanged behavior)', () => {
    const req: any = { headers: { authorization: `Bearer ${MASTER}` } };
    const res = createRes();
    const next = vi.fn();
    mcpAuthMiddleware(req, res as never, next as never);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.mcpAuth).toEqual({ scope: 'all' });
    expect(req.mcpAuth.label).toBeUndefined();
  });

  it('valid per-workspace key → scope = workspaceId + label', () => {
    const ws = createWorkspace(`MCP Auth Scoped ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);
    const { id, plaintextKeyOnceShown } = createMcpApiKey(ws.id, 'agent-bot');

    const req: any = { headers: { authorization: `Bearer ${plaintextKeyOnceShown}` } };
    const res = createRes();
    const next = vi.fn();
    mcpAuthMiddleware(req, res as never, next as never);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.mcpAuth).toEqual({ scope: ws.id, label: 'agent-bot', keyId: id });
  });

  it('revoked key → rejected', () => {
    const ws = createWorkspace(`MCP Auth Revoked ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);
    const { id, plaintextKeyOnceShown } = createMcpApiKey(ws.id, 'dead');
    revokeMcpApiKey(id);

    const req: any = { headers: { authorization: `Bearer ${plaintextKeyOnceShown}` } };
    const res = createRes();
    const next = vi.fn();
    mcpAuthMiddleware(req, res as never, next as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.mcpAuth).toBeUndefined();
  });

  it('unknown key → rejected', () => {
    const req: any = { headers: { authorization: 'Bearer mcp_totally-unknown-key' } };
    const res = createRes();
    const next = vi.fn();
    mcpAuthMiddleware(req, res as never, next as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('missing master env + non-matching key → rejected (fail-closed)', () => {
    delete process.env.MCP_API_KEY;
    const req: any = { headers: { authorization: 'Bearer anything' } };
    const res = createRes();
    const next = vi.fn();
    mcpAuthMiddleware(req, res as never, next as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('handleMcpRequest — workspace scope enforcement', () => {
  beforeEach(() => {
    h.workspaceHandler.mockClear();
  });

  it('master key (scope all) may call any tool with any workspace_id', async () => {
    const result = await callTool({ scope: 'all' }, 'get_workspace_overview', { workspaceId: 'ws-anything' });
    expect(result.isError).toBeUndefined();
    expect(h.workspaceHandler).toHaveBeenCalledWith('get_workspace_overview', { workspaceId: 'ws-anything' });
  });

  it('workspace-A key calling tool with workspace_id=A is allowed (camelCase)', async () => {
    const result = await callTool({ scope: 'ws-A', label: 'a' }, 'get_workspace_overview', { workspaceId: 'ws-A' });
    expect(result.isError).toBeUndefined();
    expect(h.workspaceHandler).toHaveBeenCalledWith('get_workspace_overview', { workspaceId: 'ws-A' });
  });

  it('workspace-A key calling tool with workspace_id=A is allowed (snake_case)', async () => {
    const result = await callTool({ scope: 'ws-A', label: 'a' }, 'update_workspace', { workspace_id: 'ws-A' });
    expect(result.isError).toBeUndefined();
    expect(h.workspaceHandler).toHaveBeenCalledWith('update_workspace', { workspace_id: 'ws-A' });
  });

  it('workspace-A key calling tool with workspace_id=B is rejected', async () => {
    const result = await callTool({ scope: 'ws-A', label: 'a' }, 'get_workspace_overview', { workspaceId: 'ws-B' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Forbidden');
    expect(h.workspaceHandler).not.toHaveBeenCalled();
  });

  it('workspace-A key calling a no-workspace_id tool (list_workspaces) is rejected', async () => {
    const result = await callTool({ scope: 'ws-A', label: 'a' }, 'list_workspaces', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not workspace-scoped');
    expect(h.workspaceHandler).not.toHaveBeenCalled();
  });
});
