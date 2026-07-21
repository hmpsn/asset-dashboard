import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const MCP_MASTER_KEY = 'test-mcp-operator-prompts-master-key';
const ctx = createEphemeralTestContext(import.meta.url, {
  env: { MCP_API_KEY: MCP_MASTER_KEY },
});

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

async function post(path: string, body: unknown): Promise<JsonRpcResponse<unknown>> {
  const response = await ctx.api(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MCP_MASTER_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<JsonRpcResponse<unknown>>;
}

beforeAll(async () => {
  await ctx.startServer();
});

afterAll(async () => {
  await ctx.stopServer();
});

describe('MCP operator prompt HTTP boundary', () => {
  it('advertises prompts only on the operator profile while preserving tool discovery', async () => {
    const operator = await post('/mcp/operator', {
      jsonrpc: '2.0', method: 'initialize', id: 1,
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'operator-prompts-test', version: '1.0.0' },
      },
    });
    expect(operator.error).toBeUndefined();
    expect(operator.result).toMatchObject({
      capabilities: { tools: {}, prompts: {} },
    });

    const full = await post('/mcp', {
      jsonrpc: '2.0', method: 'initialize', id: 2,
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'full-prompts-test', version: '1.0.0' },
      },
    });
    expect(full.error).toBeUndefined();
    expect(full.result).toMatchObject({ capabilities: { tools: {} } });
    expect((full.result as { capabilities?: { prompts?: unknown } }).capabilities?.prompts)
      .toBeUndefined();

    const tools = await post('/mcp/operator', {
      jsonrpc: '2.0', method: 'tools/list', id: 3,
    });
    expect((tools.result as { tools: unknown[] }).tools).toHaveLength(25);
  });

  it('lists and renders all three prompts with strict generic failures', async () => {
    const listed = await post('/mcp/operator', {
      jsonrpc: '2.0', method: 'prompts/list', id: 4,
    });
    expect((listed.result as { prompts: Array<{ name: string }> }).prompts.map(item => item.name))
      .toEqual([
        'triage_studio_portfolio',
        'review_workspace_as_client',
        'run_content_matrix_generation_safely',
      ]);

    for (const [name, args] of [
      ['triage_studio_portfolio', {}],
      ['review_workspace_as_client', { workspace_id: 'ws_abc-123' }],
      ['run_content_matrix_generation_safely', {
        workspace_id: 'ws_abc-123', matrix_id: 'mtx_def-456',
      }],
    ] as const) {
      const rendered = await post('/mcp/operator', {
        jsonrpc: '2.0', method: 'prompts/get', id: 5,
        params: { name, arguments: args },
      });
      expect(rendered.error).toBeUndefined();
      expect((rendered.result as { messages: unknown[] }).messages).toHaveLength(1);
    }

    const unknown = await post('/mcp/operator', {
      jsonrpc: '2.0', method: 'prompts/get', id: 6,
      params: { name: 'secret_unknown_name', arguments: {} },
    });
    expect(unknown.result).toBeUndefined();
    expect(unknown.error?.message).toContain('Unknown prompt.');
    expect(unknown.error?.message).not.toContain('secret_unknown_name');

    const invalid = await post('/mcp/operator', {
      jsonrpc: '2.0', method: 'prompts/get', id: 7,
      params: {
        name: 'review_workspace_as_client',
        arguments: { workspace_id: 'secret-invalid-value', extra: 'secret-extra' },
      },
    });
    expect(invalid.result).toBeUndefined();
    expect(invalid.error?.message).toContain('Invalid prompt arguments.');
    expect(invalid.error?.message).not.toContain('secret-invalid-value');
    expect(invalid.error?.message).not.toContain('secret-extra');
  });
});

