import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { getPost, snapshotPostVersion } from '../../server/content-posts-db.js';

const MCP_TEST_KEY = 'test-mcp-key-content';
const ctx = createEphemeralTestContext(import.meta.url, {
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

  it('prepare_brief_context returns target hints when provided', async () => {
    const result = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'best CRMs for solopreneurs',
      target_keyword: 'best crm for solopreneurs',
      target_page_path: '/blog/best-crm',
      layout: buildLayout(),
    });
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.target_keyword).toBe('best crm for solopreneurs');
    expect(payload.target_page_path).toBe('/blog/best-crm');
    expect(String(payload.prompt_context)).toContain('## Brief Target');
    expect(String(payload.prompt_context)).toContain('Target keyword: best crm for solopreneurs');
    expect(String(payload.prompt_context)).toContain('Target page path: /blog/best-crm');
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

  it('send_to_client supports brief_id target without handle', async () => {
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
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_id: string };

    const sent = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      note: 'send by id',
    });
    expect(sent.isError).toBeFalsy();
    const payload = JSON.parse(sent.content[0].text) as { target: string; request_id: string };
    expect(payload.target).toBe('brief');
    expect(typeof payload.request_id).toBe('string');
  });

  it('supports content request list/get/create MCP tools', async () => {
    const created = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'HVAC checklist',
      target_keyword: 'hvac checklist',
    });
    expect(created.isError).toBeFalsy();
    const createdPayload = JSON.parse(created.content[0].text) as { request_id: string };
    expect(typeof createdPayload.request_id).toBe('string');

    const listed = await callMcpTool('list_content_requests', {
      workspace_id: ws.workspaceId,
    });
    expect(listed.isError).toBeFalsy();
    const listPayload = JSON.parse(listed.content[0].text) as { requests: Array<{ request_id: string }> };
    expect(listPayload.requests.length).toBeGreaterThan(0);

    const fetched = await callMcpTool('get_content_request', {
      workspace_id: ws.workspaceId,
      request_id: createdPayload.request_id,
    });
    expect(fetched.isError).toBeFalsy();
    const fetchedPayload = JSON.parse(fetched.content[0].text) as { request: { id: string } };
    expect(fetchedPayload.request.id).toBe(createdPayload.request_id);
  });

  it('supports list/get/update for existing briefs with revision conflict protection', async () => {
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
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_id: string };

    const listed = await callMcpTool('list_briefs', { workspace_id: ws.workspaceId });
    expect(listed.isError).toBeFalsy();
    const listPayload = JSON.parse(listed.content[0].text) as { briefs: Array<{ brief_id: string; revision: string }> };
    const listedBrief = listPayload.briefs.find(item => item.brief_id === savedPayload.brief_id);
    expect(listedBrief).toBeDefined();

    const fetched = await callMcpTool('get_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
    });
    const fetchedPayload = JSON.parse(fetched.content[0].text) as { revision: string };
    expect(typeof fetchedPayload.revision).toBe('string');

    const patched = await callMcpTool('update_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      expected_revision: fetchedPayload.revision,
      mode: 'patch',
      updates: { suggestedTitle: 'Updated CRM Brief Title' },
    });
    expect(patched.isError).toBeFalsy();
    const patchedPayload = JSON.parse(patched.content[0].text) as { revision: string };
    expect(typeof patchedPayload.revision).toBe('string');

    const replaced = await callMcpTool('update_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      expected_revision: patchedPayload.revision,
      mode: 'replace',
      content: {
        ...buildBriefContent(),
        suggestedTitle: 'Replaced CRM Brief Title',
      },
    });
    expect(replaced.isError).toBeFalsy();

    const conflict = await callMcpTool('update_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      expected_revision: fetchedPayload.revision,
      mode: 'patch',
      updates: { suggestedTitle: 'Should fail with stale revision' },
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toContain('Revision conflict');

    const invalidField = await callMcpTool('update_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      expected_revision: patchedPayload.revision,
      mode: 'patch',
      updates: {},
    });
    expect(invalidField.isError).toBe(true);

    const wrongWorkspace = await callMcpTool('update_brief', {
      workspace_id: 'missing-workspace',
      brief_id: savedPayload.brief_id,
      expected_revision: patchedPayload.revision,
      mode: 'patch',
      updates: { suggestedTitle: 'nope' },
    });
    expect(wrongWorkspace.isError).toBe(true);

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}`);
    const activities = await activityRes.json() as Array<{
      metadata?: { source?: string; action?: string };
    }>;
    const updateActivity = activities.find((entry) => entry.metadata?.action === 'mcp_brief_updated');
    expect(updateActivity).toBeDefined();
    expect(updateActivity?.metadata?.source).toBe('mcp-chat');
  });

  it('supports list/get/update for existing posts with revision conflict protection', async () => {
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
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string };

    const listed = await callMcpTool('list_posts', { workspace_id: ws.workspaceId });
    expect(listed.isError).toBeFalsy();
    const listPayload = JSON.parse(listed.content[0].text) as { posts: Array<{ post_id: string; revision: string }> };
    const listedPost = listPayload.posts.find(item => item.post_id === savedPostPayload.post_id);
    expect(listedPost).toBeDefined();

    const fetched = await callMcpTool('get_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
    });
    const fetchedPayload = JSON.parse(fetched.content[0].text) as { revision: string };
    expect(typeof fetchedPayload.revision).toBe('string');

    const patched = await callMcpTool('update_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
      expected_revision: fetchedPayload.revision,
      mode: 'patch',
      updates: {
        title: 'Updated CRM Post Title',
        sections: [{ index: 0, content: '<p>Updated first section.</p>' }],
      },
    });
    expect(patched.isError).toBeFalsy();
    const patchedPayload = JSON.parse(patched.content[0].text) as { revision: string };
    expect(typeof patchedPayload.revision).toBe('string');

    const replaced = await callMcpTool('update_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
      expected_revision: patchedPayload.revision,
      mode: 'replace',
      content: {
        title: 'Replaced CRM Post Title',
        metaDescription: 'Updated post description',
        introduction: '<p>New intro.</p>',
        sections: [
          {
            index: 0,
            heading: 'New Section',
            content: '<p>Rewritten body.</p>',
            wordCount: 2,
            targetWordCount: 140,
            keywords: ['best crm for solopreneurs'],
            status: 'done' as const,
          },
        ],
        conclusion: '<p>New conclusion.</p>',
      },
    });
    expect(replaced.isError, replaced.content[0]?.text).toBeFalsy();

    const conflict = await callMcpTool('update_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
      expected_revision: fetchedPayload.revision,
      mode: 'patch',
      updates: { title: 'Should fail with stale revision' },
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0].text).toContain('Revision conflict');

    const invalidField = await callMcpTool('update_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
      expected_revision: patchedPayload.revision,
      mode: 'patch',
      updates: {},
    });
    expect(invalidField.isError).toBe(true);

    const wrongWorkspace = await callMcpTool('update_post', {
      workspace_id: 'missing-workspace',
      post_id: savedPostPayload.post_id,
      expected_revision: patchedPayload.revision,
      mode: 'patch',
      updates: { title: 'nope' },
    });
    expect(wrongWorkspace.isError).toBe(true);

    const activityRes = await ctx.api(`/api/activity?workspaceId=${ws.workspaceId}`);
    const activities = await activityRes.json() as Array<{
      metadata?: { source?: string; action?: string };
    }>;
    const updateActivity = activities.find((entry) => entry.metadata?.action === 'mcp_post_updated');
    expect(updateActivity).toBeDefined();
    expect(updateActivity?.metadata?.source).toBe('mcp-chat');
  });

  it('supports list_briefs/list_posts optional status + page_type filters', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'filtered CRM brief',
      layout: buildLayout(),
    });
    const preparedBriefPayload = JSON.parse(preparedBrief.content[0].text) as { brief_request_handle: string };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: preparedBriefPayload.brief_request_handle,
      content: buildBriefContent(),
    });
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as { brief_id: string; brief_handle: string };

    await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      brief_handle: savedBriefPayload.brief_handle,
      note: 'filter status',
    });

    const briefs = await callMcpTool('list_briefs', {
      workspace_id: ws.workspaceId,
      status: 'client_review',
      page_type: 'blog',
    });
    const briefList = JSON.parse(briefs.content[0].text) as { briefs: Array<{ brief_id: string; page_type: string | null; status: string | null }> };
    expect(briefList.briefs.some(brief => brief.brief_id === savedBriefPayload.brief_id)).toBe(true);
    const filteredBrief = briefList.briefs.find(brief => brief.brief_id === savedBriefPayload.brief_id);
    expect(filteredBrief?.page_type).toBe('blog');
    expect(filteredBrief?.status).toBe('client_review');

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
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string };

    const posts = await callMcpTool('list_posts', {
      workspace_id: ws.workspaceId,
      status: 'draft',
      page_type: 'blog',
    });
    const postList = JSON.parse(posts.content[0].text) as { posts: Array<{ post_id: string; page_type: string | null; status: string }> };
    expect(postList.posts.some(post => post.post_id === savedPostPayload.post_id)).toBe(true);
    const filteredPost = postList.posts.find(post => post.post_id === savedPostPayload.post_id);
    expect(filteredPost?.page_type).toBe('blog');
    expect(filteredPost?.status).toBe('draft');
  });

  it('supports list_post_versions and revert_post_version', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'versioned CRM post',
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
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string };

    const storedPost = getPost(ws.workspaceId, savedPostPayload.post_id);
    expect(storedPost).toBeDefined();
    snapshotPostVersion(storedPost!, 'manual_edit', 'integration-test');

    const versionsResult = await callMcpTool('list_post_versions', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
    });
    const versionsPayload = JSON.parse(versionsResult.content[0].text) as { versions: Array<{ version_id: string }> };
    expect(versionsPayload.versions.length).toBeGreaterThan(0);

    const reverted = await callMcpTool('revert_post_version', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
      version_id: versionsPayload.versions[0].version_id,
    });
    expect(reverted.isError).toBeFalsy();
    const revertedPayload = JSON.parse(reverted.content[0].text) as { post_id: string; version_id: string; revision: string };
    expect(revertedPayload.post_id).toBe(savedPostPayload.post_id);
    expect(revertedPayload.version_id).toBe(versionsPayload.versions[0].version_id);
    expect(typeof revertedPayload.revision).toBe('string');
  });

  it('supports delete_brief and delete_post', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'delete brief topic',
      layout: buildLayout(),
    });
    const preparedBriefPayload = JSON.parse(preparedBrief.content[0].text) as { brief_request_handle: string };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: preparedBriefPayload.brief_request_handle,
      content: buildBriefContent(),
    });
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as { brief_id: string };

    const deletedBrief = await callMcpTool('delete_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload.brief_id,
    });
    expect(deletedBrief.isError).toBeFalsy();
    const deletedBriefPayload = JSON.parse(deletedBrief.content[0].text) as { deleted: boolean };
    expect(deletedBriefPayload.deleted).toBe(true);

    const briefRes = await ctx.api(`/api/content-briefs/${ws.workspaceId}/${savedBriefPayload.brief_id}`);
    expect(briefRes.status).toBe(404);

    const preparedBrief2 = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'delete post topic',
      layout: buildLayout(),
    });
    const preparedBriefPayload2 = JSON.parse(preparedBrief2.content[0].text) as { brief_request_handle: string };
    const savedBrief2 = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: preparedBriefPayload2.brief_request_handle,
      content: buildBriefContent(),
    });
    const savedBriefPayload2 = JSON.parse(savedBrief2.content[0].text) as { brief_id: string };

    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload2.brief_id,
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as { post_request_handle: string };
    const savedPost = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: preparedPostPayload.post_request_handle,
      content: buildPostContent(savedBriefPayload2.brief_id),
    });
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string };

    const deletedPost = await callMcpTool('delete_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
    });
    expect(deletedPost.isError).toBeFalsy();
    const deletedPostPayload = JSON.parse(deletedPost.content[0].text) as { deleted: boolean };
    expect(deletedPostPayload.deleted).toBe(true);

    const postRes = await ctx.api(`/api/content-posts/${ws.workspaceId}/${savedPostPayload.post_id}`);
    expect(postRes.status).toBe(404);
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
