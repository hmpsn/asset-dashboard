import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const MCP_TEST_KEY = 'test-mcp-key-keyword';
const ctx = createTestContext(13700, {
  env: {
    MCP_API_KEY: MCP_TEST_KEY,
    DATAFORSEO_LOGIN: '',
    DATAFORSEO_PASSWORD: '',
    SEMRUSH_API_KEY: '',
  },
});

let ws: SeededFullWorkspace;

async function mcpPost(body: unknown): Promise<Response> {
  return ctx.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      Authorization: `Bearer ${MCP_TEST_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

async function callMcpTool(name: string, args: Record<string, unknown>) {
  await mcpPost({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-keyword-integration-test', version: '1.0.0' },
    },
    id: 0,
  });

  const res = await mcpPost({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });

  expect(res.status).toBe(200);
  const body = await res.json() as {
    result: { isError?: boolean; content: Array<{ type: string; text: string }> };
  };
  expect(body.result).toBeDefined();
  expect(body.result.content.length).toBeGreaterThan(0);
  return body.result;
}

beforeAll(async () => {
  await ctx.startServer();
});

afterAll(async () => {
  await ctx.stopServer();
});

beforeEach(() => {
  ws = seedWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

describe('MCP keyword tools (integration)', () => {
  it('research_keywords returns mcpError when no SEO provider is configured', async () => {
    const result = await callMcpTool('research_keywords', {
      workspace_id: ws.workspaceId,
      terms: ['best crm for solopreneurs'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No SEO data provider is configured/i);
  });

  it('research_keywords rejects empty terms via validation', async () => {
    const result = await callMcpTool('research_keywords', {
      workspace_id: ws.workspaceId,
      terms: [],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Validation failed/i);
  });

  it('research_keywords returns mcpError for unknown workspace', async () => {
    const result = await callMcpTool('research_keywords', {
      workspace_id: 'ws-does-not-exist',
      terms: ['crm'],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Workspace not found/i);
  });

  it('add_keyword_to_strategy persists a new-page keyword and logs activity', async () => {
    const result = await callMcpTool('add_keyword_to_strategy', {
      workspace_id: ws.workspaceId,
      term: 'best solo crm 2026',
      target: { kind: 'new_page', topic: 'CRM Comparison Guide', intent: 'commercial' },
    });
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      term: string;
      page_path: string;
      dashboard_url: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.term).toBe('best solo crm 2026');
    expect(payload.page_path).toBe('/planned/crm-comparison-guide');
    expect(payload.dashboard_url).toContain(`/ws/${ws.workspaceId}/content-plan`);

    const strategyRes = await ctx.api(`/api/webflow/keyword-strategy/${ws.workspaceId}`);
    expect(strategyRes.status).toBe(200);
    const strategy = await strategyRes.json() as { pageMap?: Array<{ primaryKeyword?: string }> } | null;
    expect(strategy).not.toBeNull();
    expect(Array.isArray(strategy?.pageMap)).toBe(true);
    expect(strategy!.pageMap!.some((page) => page.primaryKeyword === 'best solo crm 2026')).toBe(true);

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}`);
    expect(activityRes.status).toBe(200);
    const activities = await activityRes.json() as Array<{
      type: string;
      metadata?: { source?: string; action?: string };
    }>;
    const keywordAdded = activities.find((entry) => entry.metadata?.action === 'mcp_keyword_added');
    expect(keywordAdded).toBeDefined();
    expect(keywordAdded?.type).toBe('keyword_added');
    expect(keywordAdded?.metadata?.source).toBe('mcp-chat');
  });

  it('add_keyword_to_strategy appends to an existing_page target path', async () => {
    const result = await callMcpTool('add_keyword_to_strategy', {
      workspace_id: ws.workspaceId,
      term: 'bookkeeping for freelancers',
      target: { kind: 'existing_page', page_url: 'https://example.com/services/bookkeeping' },
    });
    expect(result.isError).toBeFalsy();

    const strategyRes = await ctx.api(`/api/webflow/keyword-strategy/${ws.workspaceId}`);
    expect(strategyRes.status).toBe(200);
    const strategy = await strategyRes.json() as {
      pageMap?: Array<{ pagePath?: string; primaryKeyword?: string }>;
    } | null;
    expect(strategy).not.toBeNull();
    const existingPage = strategy?.pageMap?.find((page) => page.pagePath === '/services/bookkeeping');
    expect(existingPage).toBeDefined();
    expect(existingPage?.primaryKeyword).toBe('bookkeeping for freelancers');
  });
});
