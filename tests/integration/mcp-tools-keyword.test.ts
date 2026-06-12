import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const MCP_TEST_KEY = 'test-mcp-key-keyword';
const ctx = createEphemeralTestContext(import.meta.url, {
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

  it('supports keyword strategy read/remove/batch/replace tools', async () => {
    const firstAdd = await callMcpTool('add_keyword_to_strategy', {
      workspace_id: ws.workspaceId,
      term: 'hvac tune up checklist',
      target: { kind: 'new_page', topic: 'HVAC Tune-Up Checklist', intent: 'informational' },
    });
    expect(firstAdd.isError).toBeFalsy();

    const strategyRead = await callMcpTool('get_keyword_strategy', {
      workspace_id: ws.workspaceId,
    });
    expect(strategyRead.isError).toBeFalsy();
    const strategyPayload = JSON.parse(strategyRead.content[0].text) as { entries: Array<{ pagePath: string }> };
    expect(strategyPayload.entries.length).toBeGreaterThan(0);

    const targetPath = '/planned/hvac-tune-up-checklist';
    const removed = await callMcpTool('remove_page_keyword', {
      workspace_id: ws.workspaceId,
      page_path: targetPath,
    });
    expect(removed.isError).toBeFalsy();

    const batch = await callMcpTool('add_keywords_batch', {
      workspace_id: ws.workspaceId,
      entries: [
        {
          pagePath: '/services/hvac-maintenance',
          pageTitle: 'HVAC Maintenance',
          primaryKeyword: 'hvac maintenance service',
          secondaryKeywords: ['hvac service plan'],
        },
      ],
    });
    expect(batch.isError).toBeFalsy();

    const replaced = await callMcpTool('replace_keyword_strategy', {
      workspace_id: ws.workspaceId,
      entries: [
        {
          pagePath: '/services/ac-repair',
          pageTitle: 'AC Repair',
          primaryKeyword: 'ac repair service',
          secondaryKeywords: ['emergency ac repair'],
        },
      ],
    });
    expect(replaced.isError).toBeFalsy();
  });
});
