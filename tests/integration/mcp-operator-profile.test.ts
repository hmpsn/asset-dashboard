import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const MCP_MASTER_KEY = 'test-mcp-operator-master-key';
const OPERATOR_PATH = '/mcp/operator';
const FULL_DISCOVERY_SHA256 = 'b8178da1ab61dcb9abeb6bd2c6c41953ce97bbf6cf4151c39a8e552bb9c7c9cb';
const FULL_INSTRUCTIONS_SHA256 = '442536613942c966472445b3d5519c4629d63bbebfed78e5b90295c1c68c67fd';
const ctx = createEphemeralTestContext(import.meta.url, {
  env: { MCP_API_KEY: MCP_MASTER_KEY },
});

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: unknown;
}

interface McpInitializeResult {
  instructions?: string;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface McpCallResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

let workspace: SeededFullWorkspace;
let workspaceKeyId: string | undefined;
let workspacePlaintextKey: string | undefined;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function mcpPost(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return ctx.api(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function initialize(path: string, token: string): Promise<McpInitializeResult> {
  const response = await mcpPost(path, {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'operator-profile-integration', version: '1.0.0' },
    },
    id: 1,
  }, token);
  expect(response.status).toBe(200);
  const body = await response.json() as JsonRpcResponse<McpInitializeResult>;
  expect(body.error).toBeUndefined();
  expect(body.result).toBeDefined();
  return body.result!;
}

async function listTools(path: string, token: string): Promise<McpToolDefinition[]> {
  const response = await mcpPost(path, {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 2,
  }, token);
  expect(response.status).toBe(200);
  const body = await response.json() as JsonRpcResponse<{ tools: McpToolDefinition[] }>;
  expect(body.error).toBeUndefined();
  expect(body.result).toBeDefined();
  expect(Array.isArray(body.result!.tools)).toBe(true);
  return body.result!.tools;
}

async function callTool(
  path: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult> {
  const response = await mcpPost(path, {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name, arguments: args },
    id: 3,
  }, token);
  expect(response.status).toBe(200);
  const body = await response.json() as JsonRpcResponse<McpCallResult>;
  expect(body.error).toBeUndefined();
  expect(body.result).toBeDefined();
  expect(body.result!.content.length).toBeGreaterThan(0);
  return body.result!;
}

function parseText(result: McpCallResult): unknown {
  const first = result.content[0];
  expect(first?.type).toBe('text');
  return JSON.parse(first?.text ?? '{}') as unknown;
}

beforeAll(async () => {
  await ctx.startServer();
  workspace = seedWorkspace();

  const response = await ctx.postJson('/api/admin/mcp-api-keys', {
    workspaceId: workspace.workspaceId,
    label: 'Operator profile integration key',
  });
  expect(response.status).toBe(200);
  const created = await response.json() as {
    key: { id: string };
    plaintextKeyOnceShown: string;
  };
  workspaceKeyId = created.key.id;
  workspacePlaintextKey = created.plaintextKeyOnceShown;
  expect(workspacePlaintextKey).toMatch(/^mcp_/);
});

afterAll(async () => {
  if (workspaceKeyId) {
    const response = await ctx.del(`/api/admin/mcp-api-keys/${workspaceKeyId}`);
    expect([200, 409]).toContain(response.status);
  }
  workspace?.cleanup();
  await ctx.stopServer();
});

describe('MCP operator profile HTTP boundary', () => {
  it('returns compact instructions and all 25 allowlisted tools within the byte budget', async () => {
    const initialized = await initialize(OPERATOR_PATH, MCP_MASTER_KEY);
    expect(typeof initialized.instructions).toBe('string');
    expect(initialized.instructions!.length).toBeGreaterThan(0);

    const tools = await listTools(OPERATOR_PATH, MCP_MASTER_KEY);
    const names = tools.map(tool => tool.name);
    expect(tools).toHaveLength(25);
    expect(new Set(names).size).toBe(25);
    expect(names).toEqual([
      'list_workspaces',
      'get_portfolio_brief',
      'get_workspace_decision_brief',
      'get_client_view',
      'get_brand_identity',
      'create_brand_deliverable',
      'update_brand_deliverable',
      'send_to_client',
      'list_content_templates',
      'get_content_template',
      'create_content_template',
      'update_content_template',
      'create_content_matrix',
      'update_content_matrix_cell',
      'list_content_matrices',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'accept_content_template_generation_upgrade',
      'preview_content_matrix_generation',
      'resolve_content_matrix_evidence',
      'start_content_matrix_generation',
      'get_content_matrix_generation',
      'retry_content_matrix_generation',
      'get_brand_voice',
      'get_job_status',
    ]);
    const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8')
      + Buffer.byteLength(initialized.instructions!, 'utf8');
    expect(bytes).toBeLessThanOrEqual(32 * 1024);
  });

  it('returns generic json_v1 not_found for a registered but hidden tool', async () => {
    const result = await callTool(
      OPERATOR_PATH,
      MCP_MASTER_KEY,
      'get_workspace_overview',
      { workspaceId: workspace.workspaceId },
    );
    expect(result.isError).toBe(true);
    expect(parseText(result)).toEqual({
      code: 'not_found',
      message: 'The requested tool does not exist.',
      retryable: false,
    });
  });

  it('dispatches the allowed cheap list_workspaces read', async () => {
    const result = await callTool(OPERATOR_PATH, MCP_MASTER_KEY, 'list_workspaces');
    expect(result.isError).not.toBe(true);
    const payload = parseText(result);
    expect(Array.isArray(payload)).toBe(true);
    expect((payload as Array<{ id?: string }>).length).toBeGreaterThan(0);
    expect((payload as Array<{ id?: string }>).some(item => item.id === workspace.workspaceId)).toBe(true);
  });

  it('keeps the full /mcp profile additive at 105 tools and invokes a tool hidden from operator', async () => {
    const initialized = await initialize('/mcp', MCP_MASTER_KEY);
    expect(typeof initialized.instructions).toBe('string');
    expect(Buffer.byteLength(initialized.instructions!, 'utf8')).toBe(11_862);
    expect(sha256(initialized.instructions!)).toBe(FULL_INSTRUCTIONS_SHA256);

    const tools = await listTools('/mcp', MCP_MASTER_KEY);
    expect(tools).toHaveLength(105);
    expect(sha256(JSON.stringify(tools))).toBe(FULL_DISCOVERY_SHA256);
    expect(tools.some(tool => tool.name === 'get_workspace_overview')).toBe(true);

    const result = await callTool('/mcp', MCP_MASTER_KEY, 'get_workspace_overview', {
      workspaceId: workspace.workspaceId,
    });
    expect(result.isError).not.toBe(true);
    expect(parseText(result)).toMatchObject({ id: workspace.workspaceId });
  });

  it('rejects missing and incorrect bearer credentials at the operator endpoint', async () => {
    const request = { jsonrpc: '2.0', method: 'tools/list', id: 4 };
    const missing = await mcpPost(OPERATOR_PATH, request);
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: 'Unauthorized' });

    const incorrect = await mcpPost(OPERATOR_PATH, request, 'wrong-operator-key');
    expect(incorrect.status).toBe(401);
    await expect(incorrect.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('accepts a real workspace key at /mcp but rejects it generically at /mcp/operator', async () => {
    expect(typeof workspacePlaintextKey).toBe('string');
    const fullResult = await callTool(
      '/mcp',
      workspacePlaintextKey!,
      'get_workspace_overview',
      { workspaceId: workspace.workspaceId },
    );
    expect(fullResult.isError).not.toBe(true);
    expect(parseText(fullResult)).toMatchObject({ id: workspace.workspaceId });

    const operatorResponse = await mcpPost(OPERATOR_PATH, {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 5,
    }, workspacePlaintextKey);
    expect(operatorResponse.status).toBe(401);
    await expect(operatorResponse.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
