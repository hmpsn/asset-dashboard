/**
 * Client MCP transport integration coverage.
 *
 * This drives the actual HTTP router, credential store, discovery projection,
 * and canonical MCP registry. It intentionally uses no staging data or remote
 * provider calls: PR1 proves the security boundary; PR2 owns live analytics
 * provider fixture coverage.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/google-auth.js', () => ({
  isGlobalConnected: () => true,
}));

vi.mock('../../server/analytics-data.js', () => ({
  fetchSearchOverview: vi.fn(async () => ({
    dateRange: { start: '2026-06-01', end: '2026-06-07' },
    totalClicks: 120,
    totalImpressions: 2_400,
    avgCtr: 5,
    avgPosition: 4.2,
    topQueries: [{
      query: 'test search query',
      clicks: 42,
      impressions: 800,
      ctr: 5.25,
      position: 3.1,
    }],
    topPages: [{
      page: 'https://example.test/services?unsafe=query#fragment',
      clicks: 42,
      impressions: 800,
      ctr: 5.25,
      position: 3.1,
    }],
  })),
  fetchPerformanceTrend: vi.fn(async () => ([{
    date: '2026-06-01',
    clicks: 18,
    impressions: 350,
    ctr: 5.14,
    position: 4.2,
  }])),
  fetchSearchComparison: vi.fn(async () => null),
}));

import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createMcpApiKey, revokeMcpApiKey } from '../../server/mcp/api-keys.js';
import { handleClientAnalyticsReadActionTool } from '../../server/mcp/tools/analytics-read-actions.js';
import { fetchSearchOverview } from '../../server/analytics-data.js';

const MASTER_KEY = 'mcp-client-profile-master-key';
const ctx = createEphemeralTestContext(import.meta.url);

let workspaces: {
  wsA: ReturnType<typeof seedWorkspace>;
  wsB: ReturnType<typeof seedWorkspace>;
  cleanup: () => void;
};
let clientKey: ReturnType<typeof createMcpApiKey>;
let fullKey: ReturnType<typeof createMcpApiKey>;

interface McpRpcResponse {
  result?: {
    isError?: boolean;
    content?: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
    tools?: Array<{
      name: string;
      inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
      outputSchema?: unknown;
      annotations?: unknown;
    }>;
  };
  error?: unknown;
}

beforeAll(async () => {
  process.env.MCP_API_KEY = MASTER_KEY;
  await ctx.startServer();
  const wsA = seedWorkspace({ gscPropertyUrl: 'sc-domain:client-profile.test' });
  const wsB = seedWorkspace();
  workspaces = {
    wsA,
    wsB,
    cleanup: () => {
      wsA.cleanup();
      wsB.cleanup();
    },
  };
  clientKey = createMcpApiKey(workspaces.wsA.workspaceId, 'client-profile', 'client');
  fullKey = createMcpApiKey(workspaces.wsA.workspaceId, 'full-profile');
}, 30_000);

afterAll(async () => {
  if (clientKey) revokeMcpApiKey(clientKey.id);
  if (fullKey) revokeMcpApiKey(fullKey.id);
  workspaces?.cleanup();
  await ctx.stopServer();
  delete process.env.MCP_API_KEY;
});

function headers(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function rpc(
  path: '/mcp' | '/mcp/operator' | '/mcp/client',
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ response: Response; body: McpRpcResponse }> {
  const response = await ctx.api(path, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
      id: 1,
    }),
  });
  const body = (await response.json()) as McpRpcResponse;
  return { response, body };
}

async function listTools(
  path: '/mcp' | '/mcp/operator' | '/mcp/client',
  token: string,
): Promise<{ response: Response; tools: NonNullable<McpRpcResponse['result']>['tools'] }> {
  const { response, body } = await rpc(path, token, 'tools/list');
  return { response, tools: body.result?.tools };
}

function errorEnvelope(body: McpRpcResponse): Record<string, unknown> {
  const text = body.result?.content?.[0]?.text;
  expect(body.result?.isError).toBe(true);
  expect(typeof text).toBe('string');
  return JSON.parse(text!) as Record<string, unknown>;
}

function toolErrorEnvelope(result: Awaited<ReturnType<typeof handleClientAnalyticsReadActionTool>>): Record<string, unknown> {
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}

describe('client MCP profile', () => {
  it('accepts a client key only on /mcp/client and rejects every other credential/profile pairing', async () => {
    const clientAtClient = await listTools('/mcp/client', clientKey.plaintextKeyOnceShown);
    expect(clientAtClient.response.status).toBe(200);

    for (const [path, token] of [
      ['/mcp', clientKey.plaintextKeyOnceShown],
      ['/mcp/operator', clientKey.plaintextKeyOnceShown],
      ['/mcp/client', fullKey.plaintextKeyOnceShown],
      ['/mcp/client', MASTER_KEY],
    ] as const) {
      const result = await ctx.api(path, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      expect(result.status, `${path} must reject this credential`).toBe(401);
    }
  });

  it('retains legacy full-key and master-only operator transport behavior', async () => {
    const fullAtFull = await listTools('/mcp', fullKey.plaintextKeyOnceShown);
    expect(fullAtFull.response.status).toBe(200);
    expect(fullAtFull.tools?.some(tool => tool.name === 'update_workspace')).toBe(true);

    const masterAtOperator = await listTools('/mcp/operator', MASTER_KEY);
    expect(masterAtOperator.response.status).toBe(200);
    expect(masterAtOperator.tools?.map(tool => tool.name)).toContain('get_portfolio_brief');
  });

  it('discovers exactly six workspace-free, structured, read-only analytics tools', async () => {
    const { response, tools } = await listTools('/mcp/client', clientKey.plaintextKeyOnceShown);
    expect(response.status).toBe(200);
    expect(tools?.map(tool => tool.name)).toEqual([
      'get_search_performance',
      'get_ga4_campaign_performance',
      'get_ga4_period_comparison',
      'get_ga4_traffic_sources',
      'get_ga4_key_events',
      'get_ga4_content_performance',
    ]);

    for (const tool of tools ?? []) {
      expect(tool.inputSchema?.properties).not.toHaveProperty('workspace_id');
      expect(tool.inputSchema?.properties).not.toHaveProperty('workspaceId');
      expect(tool.inputSchema?.required ?? []).not.toContain('workspace_id');
      expect(tool.inputSchema?.required ?? []).not.toContain('workspaceId');
      expect(tool.outputSchema).toMatchObject({ type: 'object', required: ['data'] });
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('fails caller-supplied workspace aliases before dispatch and preserves not_found indistinguishability', async () => {
    const call = (name: string, args: Record<string, unknown>) => rpc(
      '/mcp/client',
      clientKey.plaintextKeyOnceShown,
      'tools/call',
      { name, arguments: args },
    );

    for (const name of [
      'get_search_performance',
      'get_ga4_campaign_performance',
      'get_ga4_period_comparison',
      'get_ga4_traffic_sources',
      'get_ga4_key_events',
      'get_ga4_content_performance',
    ]) {
      const ownSnake = await call(name, { workspace_id: workspaces.wsA.workspaceId });
      expect(ownSnake.response.status).toBe(200);
      expect(errorEnvelope(ownSnake.body)).toMatchObject({ code: 'validation_failed' });

      const ownCamel = await call(name, { workspaceId: workspaces.wsA.workspaceId });
      expect(ownCamel.response.status).toBe(200);
      expect(errorEnvelope(ownCamel.body)).toMatchObject({ code: 'validation_failed' });
    }

    const write = await call('update_workspace', {});
    const unknown = await call('not_a_registered_tool', {});
    expect(write.response.status).toBe(200);
    expect(unknown.response.status).toBe(200);
    expect(write.body.result).toEqual(unknown.body.result);
    expect(errorEnvelope(write.body)).toMatchObject({ code: 'not_found' });
  });

  it('projects an injected-workspace result as matching legacy JSON and structuredContent.data', async () => {
    const result = await handleClientAnalyticsReadActionTool('get_search_performance', {
      workspace_id: workspaces.wsA.workspaceId,
      days: 7,
    });
    expect(result.isError).not.toBe(true);
    const legacy = JSON.parse(result.content[0]?.text ?? '') as unknown;
    expect(result.structuredContent).toEqual({ data: legacy });
    expect(legacy).toMatchObject({
      source: 'google_search_console',
      date_range: { start: '2026-06-01', end: '2026-06-07' },
      totals: { ctr: 5 },
      top_queries: [{ ctr: 5.25 }],
      top_pages: [{ page: 'https://example.test/services' }],
    });
  });

  it('rejects invalid calendar dates and exact ranges longer than 366 days before provider dispatch', async () => {
    const providerCallsBefore = vi.mocked(fetchSearchOverview).mock.calls.length;
    const invalidDate = await handleClientAnalyticsReadActionTool('get_search_performance', {
      workspace_id: workspaces.wsA.workspaceId,
      start_date: '2026-02-30',
      end_date: '2026-03-01',
    });
    expect(toolErrorEnvelope(invalidDate)).toMatchObject({ code: 'validation_failed' });

    const oversized = await handleClientAnalyticsReadActionTool('get_search_performance', {
      workspace_id: workspaces.wsA.workspaceId,
      start_date: '2025-01-01',
      end_date: '2026-01-02',
    });
    expect(toolErrorEnvelope(oversized)).toMatchObject({ code: 'validation_failed' });
    expect(fetchSearchOverview).toHaveBeenCalledTimes(providerCallsBefore);
  });

  it('truncates 51 provider rows to the client bound and labels both truncation flags', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      clicks: index + 1,
      impressions: 1_000 + index,
      ctr: 4.5,
      position: 3.2,
    }));
    vi.mocked(fetchSearchOverview).mockResolvedValueOnce({
      dateRange: { start: '2026-06-01', end: '2026-06-07' },
      totalClicks: 120,
      totalImpressions: 2_400,
      avgCtr: 5,
      avgPosition: 4.2,
      topQueries: rows.map((row, index) => ({ ...row, query: `query-${index}` })),
      topPages: rows.map((row, index) => ({
        ...row,
        page: `https://example.test/page-${index}?private=query#fragment`,
      })),
    });

    const result = await handleClientAnalyticsReadActionTool('get_search_performance', {
      workspace_id: workspaces.wsA.workspaceId,
      days: 7,
    });
    expect(result.isError).not.toBe(true);
    const legacy = JSON.parse(result.content[0]?.text ?? '') as {
      top_queries: unknown[];
      top_pages: Array<{ page: string }>;
      data_quality: Record<string, unknown>;
    };
    expect(legacy.top_queries).toHaveLength(50);
    expect(legacy.top_pages).toHaveLength(50);
    expect(legacy.top_pages[0]?.page).toBe('https://example.test/page-0');
    expect(legacy.data_quality).toMatchObject({
      returned_queries: 50,
      returned_pages: 50,
      query_results_truncated: true,
      page_results_truncated: true,
    });
    expect(result.structuredContent).toEqual({ data: legacy });
  });

  it('returns 405 for unsupported GET and DELETE client transport requests', async () => {
    for (const method of ['GET', 'DELETE'] as const) {
      const response = await ctx.api('/mcp/client', { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });
});
