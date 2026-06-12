import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { cancelJob, createJob } from '../../server/jobs.js';

const MCP_TEST_KEY = 'test-mcp-key-jobs';
const ctx = createEphemeralTestContext(import.meta.url, {
  env: { MCP_API_KEY: MCP_TEST_KEY },
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
      clientInfo: { name: 'mcp-jobs-integration-test', version: '1.0.0' },
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

describe('MCP job tools (integration)', () => {
  it('start_keyword_strategy_generation creates a keyword strategy job', async () => {
    const result = await callMcpTool('start_keyword_strategy_generation', {
      workspace_id: ws.workspaceId,
      options: { mode: 'full' },
    });
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      job_id: string;
      job_type: string;
      dashboard_url: string;
    };
    expect(payload.ok).toBe(true);
    expect(typeof payload.job_id).toBe('string');
    expect(payload.job_type).toBe('keyword-strategy');
    expect(payload.dashboard_url).toContain(`/ws/${ws.workspaceId}`);

    const jobRes = await ctx.api(`/api/jobs/${payload.job_id}`);
    expect(jobRes.status).toBe(200);
    const job = await jobRes.json() as { id: string; type: string };
    expect(job.id).toBe(payload.job_id);
    expect(job.type).toBe('keyword-strategy');
  });

  it('start_keyword_strategy_generation rejects a second active job', async () => {
    const activeJob = createJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
      workspaceId: ws.workspaceId,
      message: 'Generating keyword strategy...',
      total: 100,
    });

    const second = await callMcpTool('start_keyword_strategy_generation', { workspace_id: ws.workspaceId });
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toMatch(/already running|already being generated/i);
    cancelJob(activeJob.id);
  });

  it('start_seo_audit validates required site_id', async () => {
    const result = await callMcpTool('start_seo_audit', {
      workspace_id: ws.workspaceId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Validation failed/i);
  });

  it('start_seo_audit rejects site ids that do not belong to workspace', async () => {
    const result = await callMcpTool('start_seo_audit', {
      workspace_id: ws.workspaceId,
      site_id: 'site-does-not-belong',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not linked to site/i);
  });

  it('start_local_seo_refresh creates a local SEO refresh job payload', async () => {
    const result = await callMcpTool('start_local_seo_refresh', {
      workspace_id: ws.workspaceId,
      refresh_body: {},
    });
    expect(result.isError).toBeFalsy();

    const payload = JSON.parse(result.content[0].text) as {
      ok: boolean;
      job_id: string;
      job_type: string;
      selected_market_count: number;
      selected_keyword_count: number;
      dashboard_url: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.job_type).toBe('local-seo-refresh');
    expect(typeof payload.selected_market_count).toBe('number');
    expect(typeof payload.selected_keyword_count).toBe('number');
    expect(payload.dashboard_url).toContain(`/ws/${ws.workspaceId}/local-seo`);
  });

  it('supports get_job_status, list_jobs, and cancel_job tools', async () => {
    const started = await callMcpTool('start_local_seo_refresh', {
      workspace_id: ws.workspaceId,
      refresh_body: {},
    });
    expect(started.isError).toBeFalsy();
    const startedPayload = JSON.parse(started.content[0].text) as { job_id: string };

    const status = await callMcpTool('get_job_status', {
      workspace_id: ws.workspaceId,
      job_id: startedPayload.job_id,
    });
    expect(status.isError).toBeFalsy();
    const statusPayload = JSON.parse(status.content[0].text) as { job: { id: string } };
    expect(statusPayload.job.id).toBe(startedPayload.job_id);

    const listed = await callMcpTool('list_jobs', {
      workspace_id: ws.workspaceId,
    });
    expect(listed.isError).toBeFalsy();
    const listPayload = JSON.parse(listed.content[0].text) as { jobs: Array<{ id: string }> };
    expect(listPayload.jobs.some(job => job.id === startedPayload.job_id)).toBe(true);

    const cancelled = await callMcpTool('cancel_job', {
      workspace_id: ws.workspaceId,
      job_id: startedPayload.job_id,
    });
    expect(cancelled.isError).toBeFalsy();
    const cancelledPayload = JSON.parse(cancelled.content[0].text) as { job: { status: string } };
    expect(['cancelled', 'done', 'error']).toContain(cancelledPayload.job.status);
  });
});
