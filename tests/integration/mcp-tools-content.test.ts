import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

const MCP_TEST_KEY = 'test-mcp-key-content';
const ctx = createTestContext(13704, {
  env: { MCP_API_KEY: MCP_TEST_KEY },
});

let ws: SeededFullWorkspace;

function buildLayout() {
  return {
    type: 'outline' as const,
    structure: {
      sections: [
        { heading: { level: 1 as const, text: 'Best CRMs for Solopreneurs' } },
        { heading: { level: 2 as const, text: 'What to look for' }, bullets: ['Automation', 'Pipelines'] },
      ],
    },
  };
}

function buildBriefContent() {
  return {
    targetKeyword: 'best crm for solopreneurs',
    secondaryKeywords: ['solo founder crm', 'simple sales crm'],
    suggestedTitle: 'Best CRM Tools for Solopreneurs',
    suggestedMetaDesc: 'Compare top CRM tools and pick the best fit for solo founders.',
    outline: [
      { heading: 'Why a CRM matters', notes: 'Frame the pain points' },
      { heading: 'Top CRM options', notes: 'Compare features and pricing' },
    ],
    wordCountTarget: 1400,
    intent: 'commercial',
    audience: 'solopreneurs',
    competitorInsights: 'Competitors emphasize automation and price transparency.',
    internalLinkSuggestions: ['/pricing', '/features', '/templates'],
    pageType: 'blog' as const,
    executiveSummary: 'Actionable comparison guide for solo founders evaluating CRM options.',
  };
}

function buildPostContent(briefId: string) {
  return {
    briefId,
    targetKeyword: 'best crm for solopreneurs',
    title: 'Best CRM Tools for Solopreneurs in 2026',
    metaDescription: 'Evaluate CRM tools built for solo founders with practical tradeoffs.',
    introduction: '<p>Choosing a CRM as a solo founder is about speed and simplicity.</p>',
    sections: [
      {
        index: 0,
        heading: 'What solopreneurs need from a CRM',
        content: '<p>Focus on automation, visibility, and low admin overhead.</p>',
        wordCount: 120,
        targetWordCount: 140,
        keywords: ['best crm for solopreneurs'],
        status: 'done' as const,
      },
      {
        index: 1,
        heading: 'Top options compared',
        content: '<p>Compare core features, onboarding effort, and pricing.</p>',
        wordCount: 220,
        targetWordCount: 240,
        keywords: ['crm pricing', 'solo founder crm'],
        status: 'done' as const,
      },
    ],
    conclusion: '<p>Pick a CRM you can keep up-to-date weekly.</p>',
    totalWordCount: 1020,
    targetWordCount: 1200,
  };
}

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
      clientInfo: { name: 'mcp-content-integration-test', version: '1.0.0' },
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

describe('MCP content tools (integration)', () => {
  it('prepare_brief_context returns schemas, prompt context, and a brief handle', async () => {
    const result = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'best CRMs for solopreneurs',
      layout: buildLayout(),
    });
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(typeof payload.brief_request_handle).toBe('string');
    expect(String(payload.brief_request_handle)).toMatch(/^brief-request_/);
    expect(payload.prompt_context).toBeDefined();
    expect(payload.layout_schema).toBeDefined();
    expect(payload.brief_schema).toBeDefined();
    expect(String(payload.dashboard_url)).toContain(`/ws/${ws.workspaceId}/content`);
  });

  it('save_brief persists a brief and logs mcp_brief_saved activity', async () => {
    const prepared = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'best CRMs for solopreneurs',
      layout: buildLayout(),
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { brief_request_handle: string };

    const saved = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: preparedPayload.brief_request_handle,
      content: buildBriefContent(),
    });
    expect(saved.isError).toBeFalsy();
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_id: string; brief_handle: string };

    const briefRes = await ctx.api(`/api/content-briefs/${ws.workspaceId}/${savedPayload.brief_id}`);
    expect(briefRes.status).toBe(200);
    const brief = await briefRes.json() as { id: string; targetKeyword: string };
    expect(brief.id).toBe(savedPayload.brief_id);
    expect(brief.targetKeyword).toBe('best crm for solopreneurs');

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}`);
    expect(activityRes.status).toBe(200);
    const activities = await activityRes.json() as Array<{
      type: string;
      metadata?: { source?: string; action?: string };
    }>;
    const savedActivity = activities.find((entry) => entry.metadata?.action === 'mcp_brief_saved');
    expect(savedActivity).toBeDefined();
    expect(savedActivity?.type).toBe('brief_generated');
    expect(savedActivity?.metadata?.source).toBe('mcp-chat');
  });

  it('send_to_client for brief writes brief_sent_for_review activity', async () => {
    const prepared = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'best CRMs for solopreneurs',
      layout: buildLayout(),
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { brief_request_handle: string };
    const saved = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: preparedPayload.brief_request_handle,
      content: buildBriefContent(),
    });
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_handle: string };

    const sent = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      brief_handle: savedPayload.brief_handle,
      note: 'ready for client review',
    });
    expect(sent.isError).toBeFalsy();
    const sentPayload = JSON.parse(sent.content[0].text) as { request_id: string; target: string };
    expect(sentPayload.target).toBe('brief');

    const requestRes = await ctx.api(`/api/content-requests/${ws.workspaceId}/${sentPayload.request_id}`);
    expect(requestRes.status).toBe(200);

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}`);
    const activities = await activityRes.json() as Array<{
      type: string;
      metadata?: { source?: string; action?: string };
    }>;
    const sentActivity = activities.find((entry) => entry.metadata?.action === 'mcp_brief_sent_to_client');
    expect(sentActivity).toBeDefined();
    expect(sentActivity?.type).toBe('brief_sent_for_review');
    expect(sentActivity?.metadata?.source).toBe('mcp-chat');
  });

  it('send_to_client for post writes post_sent_for_review activity', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'best CRMs for solopreneurs',
      layout: buildLayout(),
    });
    const preparedBriefPayload = JSON.parse(preparedBrief.content[0].text) as { brief_request_handle: string };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: preparedBriefPayload.brief_request_handle,
      content: buildBriefContent(),
    });
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as { brief_id: string };

    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload.brief_id,
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as { post_request_handle: string };
    const savedPost = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: preparedPostPayload.post_request_handle,
      content: buildPostContent(savedBriefPayload.brief_id),
    });
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string; post_handle: string };

    const postRes = await ctx.api(`/api/content-posts/${ws.workspaceId}/${savedPostPayload.post_id}`);
    expect(postRes.status).toBe(200);

    const sent = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      post_handle: savedPostPayload.post_handle,
      note: 'ready for client review',
    });
    expect(sent.isError).toBeFalsy();
    const sentPayload = JSON.parse(sent.content[0].text) as { request_id: string; target: string };
    expect(sentPayload.target).toBe('post');

    const requestRes = await ctx.api(`/api/content-requests/${ws.workspaceId}/${sentPayload.request_id}`);
    expect(requestRes.status).toBe(200);

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}`);
    const activities = await activityRes.json() as Array<{
      type: string;
      metadata?: { source?: string; action?: string };
    }>;
    const sentActivity = activities.find((entry) => entry.metadata?.action === 'mcp_post_sent_to_client');
    expect(sentActivity).toBeDefined();
    expect(sentActivity?.type).toBe('post_sent_for_review');
    expect(sentActivity?.metadata?.source).toBe('mcp-chat');
  });

  it('save_brief rejects unknown handles', async () => {
    const result = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: 'brief-request_00000000-0000-0000-0000-000000000000',
      content: buildBriefContent(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Handle not found|expired/i);
  });
});
