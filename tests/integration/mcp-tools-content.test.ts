import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { getPost, snapshotPostVersion } from '../../server/content-posts-db.js';
import { getBrief, updateBriefAtRevision } from '../../server/content-brief.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { canonicalGenerationFingerprint } from '../../server/generation-provenance.js';
import { canonicalGenerationProvenanceSchema } from '../../server/schemas/generation-provenance.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';
import db from '../../server/db/index.js';

/**
 * Seeds a calibrated voice profile (with Layer-2 DNA + guardrails) and an
 * approved identity deliverable so prepare_*_context exercises the real brand
 * slice read path — proving the P2 regression (brand voice + identity reach the
 * MCP agent path) end to end.
 */
function seedCalibratedBrand(workspaceId: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO voice_profiles (id, workspace_id, status, voice_dna_json, guardrails_json, created_at, updated_at)
    VALUES (?, ?, 'calibrated', ?, ?, ?, ?)
  `).run(
    `vp_${randomUUID().slice(0, 8)}`,
    workspaceId,
    JSON.stringify({
      personalityTraits: ['Witty', 'Direct'],
      toneSpectrum: { formal_casual: 8, serious_playful: 8, technical_accessible: 8 },
      sentenceStyle: 'Short punchy lines',
      vocabularyLevel: 'Conversational',
      humorStyle: 'Dry',
    }),
    JSON.stringify({
      forbiddenWords: ['synergy'],
      requiredTerminology: [],
      toneBoundaries: ['Never condescending'],
      antiPatterns: [],
    }),
    now,
    now,
  );
  db.prepare(`
    INSERT INTO brand_identity_deliverables (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
    VALUES (?, ?, 'mission', ?, 'approved', 1, 'professional', ?, ?)
  `).run(`bid_${randomUUID().slice(0, 8)}`, workspaceId, 'Help solo founders win their market.', now, now);
}

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

function expectCanonicalExternalProvenance(
  value: unknown,
  operation: 'mcp-external-brief-generation' | 'mcp-external-post-generation',
): GenerationProvenance {
  const parsed = canonicalGenerationProvenanceSchema.safeParse(value);
  expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
  if (!parsed.success) throw parsed.error;
  const provenance = parsed.data as GenerationProvenance;
  expect(provenance).toMatchObject({
    operation,
    provider: 'external',
    model: 'unreported',
  });
  expect(provenance.runId).toMatch(/^external_[0-9a-f-]+$/);
  expect(provenance.executionChainId).toBe(provenance.runId);
  expect(provenance.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
  return provenance;
}

function countWorkspaceArtifacts(table: 'content_briefs' | 'content_posts'): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
    .get(ws.workspaceId) as { count: number };
  return row.count;
}

function countWorkspaceHandles(kind: 'brief-request' | 'post-request'): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM mcp_handles
    WHERE workspace_id = ? AND kind = ?
  `).get(ws.workspaceId, kind) as { count: number };
  return row.count;
}

function readHandlePayload(token: string): Record<string, unknown> {
  const row = db.prepare(`SELECT payload FROM mcp_handles WHERE token = ?`).get(token) as {
    payload: string;
  } | undefined;
  if (!row) throw new Error(`Missing test handle: ${token}`);
  return JSON.parse(row.payload) as Record<string, unknown>;
}

function handleExists(token: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM mcp_handles WHERE token = ?').get(token));
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

async function initializeMcpSession(): Promise<void> {
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
}

async function callMcpToolRequest(name: string, args: Record<string, unknown>) {
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

async function callMcpTool(name: string, args: Record<string, unknown>) {
  await initializeMcpSession();
  return callMcpToolRequest(name, args);
}

function errorEnvelope(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? '{}') as {
    code?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
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
    // Brand keys are always present; for a bare workspace identity is null + voice none.
    expect(payload.brand_identity).toBeNull();
    expect(payload.voice_status).toBe('none');
    expect(String(payload.dashboard_url)).toContain(`/ws/${ws.workspaceId}/content`);
  });

  it('prepare_brief_context surfaces brand identity + calibrated voice without doubling the voice block', async () => {
    seedCalibratedBrand(ws.workspaceId);
    try {
      const result = await callMcpTool('prepare_brief_context', {
        workspace_id: ws.workspaceId,
        topic: 'best CRMs for solopreneurs',
        layout: buildLayout(),
      });
      expect(result.isError).toBeFalsy();

      const payload = JSON.parse(result.content[0].text) as {
        brand_identity: { mission?: string } | null;
        voice_status: string;
        prompt_context: string;
      };
      // Structured identity reaches the agent for per-page-type emphasis.
      expect(payload.brand_identity).not.toBeNull();
      expect(payload.brand_identity?.mission).toBe('Help solo founders win their market.');
      expect(payload.voice_status).toBe('calibrated');
      // Layer-2 DNA + identity blocks are injected into the prompt context.
      expect(payload.prompt_context).toContain('BRAND VOICE RULES');
      expect(payload.prompt_context).toContain('synergy'); // forbidden-word guardrail token
      expect(payload.prompt_context.match(/synergy/g)?.length).toBe(1); // DNA token appears exactly once — no double-inject
      expect(payload.prompt_context).toContain('Help solo founders win their market.');
      // NO double-voice: the Layer-2 block header appears exactly once.
      expect(payload.prompt_context.match(/BRAND VOICE RULES/g)?.length).toBe(1);
    } finally {
      db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(ws.workspaceId);
      db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(ws.workspaceId);
    }
  });

  it('prepare_post_context surfaces brand identity + calibrated voice without doubling the voice block', async () => {
    seedCalibratedBrand(ws.workspaceId);
    try {
      const preparedBrief = await callMcpTool('prepare_brief_context', {
        workspace_id: ws.workspaceId,
        topic: 'best CRMs for solopreneurs',
        layout: buildLayout(),
      });
      const briefHandle = JSON.parse(preparedBrief.content[0].text).brief_request_handle as string;
      const saved = await callMcpTool('save_brief', {
        workspace_id: ws.workspaceId,
        brief_request_handle: briefHandle,
        content: buildBriefContent(),
      });
      const savedPayload = JSON.parse(saved.content[0].text) as {
        brief_id: string;
        revision: number;
      };

      const result = await callMcpTool('prepare_post_context', {
        workspace_id: ws.workspaceId,
        brief_id: savedPayload.brief_id,
      });
      expect(result.isError).toBeFalsy();

      const payload = JSON.parse(result.content[0].text) as {
        brand_identity: { mission?: string } | null;
        voice_status: string;
        prompt_context: string;
        brief_revision: number;
      };
      expect(payload.brand_identity?.mission).toBe('Help solo founders win their market.');
      expect(payload.voice_status).toBe('calibrated');
      expect(payload.prompt_context).toContain('BRAND VOICE RULES');
      expect(payload.prompt_context).toContain('Help solo founders win their market.');
      expect(payload.prompt_context.match(/BRAND VOICE RULES/g)?.length).toBe(1);
      expect(payload.brief_revision).toBe(savedPayload.revision);
    } finally {
      db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(ws.workspaceId);
      db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(ws.workspaceId);
    }
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

  it('rejects an illegal parent lifecycle before issuing a brief-generation handle', async () => {
    const parent = createContentRequest(ws.workspaceId, {
      topic: 'Unpaid parent request',
      targetKeyword: 'best crm for solopreneurs',
      intent: 'commercial',
      priority: 'medium',
      rationale: 'Lifecycle preflight fixture',
      initialStatus: 'pending_payment',
      dedupe: false,
    });
    const handlesBefore = countWorkspaceHandles('brief-request');

    const rejected = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'Unpaid parent request',
      parent_request_id: parent.id,
      layout: buildLayout(),
    });

    expect(rejected.isError).toBe(true);
    expect(errorEnvelope(rejected)).toMatchObject({
      code: 'precondition_failed',
      details: { failure_code: 'source_authority_mismatch' },
    });
    expect(countWorkspaceHandles('brief-request')).toBe(handlesBefore);
  });

  it('rejects a terminal parent lifecycle before issuing a post-generation handle', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'Terminal parent post fixture',
      target_keyword: 'best crm for solopreneurs',
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(
      preparedBrief.content[0].text,
    ) as { brief_request_handle: string };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
    });
    const { brief_id: briefId } = JSON.parse(savedBrief.content[0].text) as {
      brief_id: string;
    };
    const parent = createContentRequest(ws.workspaceId, {
      topic: 'Terminal parent post fixture',
      targetKeyword: 'best crm for solopreneurs',
      intent: 'commercial',
      priority: 'medium',
      rationale: 'Lifecycle preflight fixture',
      initialStatus: 'brief_generated',
      dedupe: false,
    });
    expect(updateContentRequest(ws.workspaceId, parent.id, {
      briefId,
      status: 'declined',
    })?.status).toBe('declined');
    const handlesBefore = countWorkspaceHandles('post-request');

    const rejected = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: briefId,
      parent_request_id: parent.id,
    });

    expect(rejected.isError).toBe(true);
    expect(errorEnvelope(rejected)).toMatchObject({
      code: 'precondition_failed',
      details: { failure_code: 'source_authority_mismatch' },
    });
    expect(countWorkspaceHandles('post-request')).toBe(handlesBefore);
  });

  it('save_brief persists revision 1 with canonical external provenance and logs the activity', async () => {
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
    const savedPayload = JSON.parse(saved.content[0].text) as {
      brief_id: string;
      brief_handle: string;
      revision: number;
      generation_provenance: unknown;
    };
    expect(savedPayload.revision).toBe(1);
    const responseProvenance = expectCanonicalExternalProvenance(
      savedPayload.generation_provenance,
      'mcp-external-brief-generation',
    );

    const persistedBrief = getBrief(ws.workspaceId, savedPayload.brief_id);
    expect(persistedBrief?.generationRevision).toBe(1);
    expect(persistedBrief?.generationProvenance).toEqual(responseProvenance);

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

  it('rejects a save-time brief parent override without consuming the prepared handle', async () => {
    const createdRequest = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'retryable parent link',
      target_keyword: 'best crm for solopreneurs',
    });
    const { request_id: parentRequestId } = JSON.parse(createdRequest.content[0].text) as {
      request_id: string;
    };
    const prepared = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'retryable parent link',
      parent_request_id: parentRequestId,
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(prepared.content[0].text) as {
      brief_request_handle: string;
    };
    const beforeCount = countWorkspaceArtifacts('content_briefs');

    const failed = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
      parent_request_id: 'different-parent-request',
    });

    expect(failed.isError).toBe(true);
    expect(errorEnvelope(failed)).toMatchObject({ code: 'precondition_failed' });
    expect(countWorkspaceArtifacts('content_briefs')).toBe(beforeCount);

    const retried = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
      parent_request_id: parentRequestId,
    });
    expect(retried.isError, retried.content[0]?.text).toBeFalsy();
    const retriedPayload = JSON.parse(retried.content[0].text) as {
      brief_id: string;
      revision: number;
    };
    expect(retriedPayload.revision).toBe(1);
    expect(getBrief(ws.workspaceId, retriedPayload.brief_id)).toBeDefined();
    expect(countWorkspaceArtifacts('content_briefs')).toBe(beforeCount + 1);
    expect(getContentRequest(ws.workspaceId, parentRequestId)?.briefId).toBe(retriedPayload.brief_id);
  });

  it('rolls back brief adoption when its prepared parent request changes', async () => {
    const createdRequest = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'stale prepared brief parent',
      target_keyword: 'best crm for solopreneurs',
    });
    const { request_id: parentRequestId } = JSON.parse(createdRequest.content[0].text) as {
      request_id: string;
    };
    const parentBefore = getContentRequest(ws.workspaceId, parentRequestId);
    expect(parentBefore).toBeDefined();

    const prepared = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'stale prepared brief parent',
      parent_request_id: parentRequestId,
      layout: buildLayout(),
    });
    const {
      brief_request_handle: briefRequestHandle,
      dashboard_url: _dashboardUrl,
      ...effectivePreparedInput
    } = JSON.parse(prepared.content[0].text) as {
      brief_request_handle: string;
      dashboard_url: string;
      parent_request: { id: string; updatedAt: string };
      target_keyword: string;
      [key: string]: unknown;
    };
    const preparedPayload = effectivePreparedInput as typeof effectivePreparedInput & {
      parent_request: { id: string; updatedAt: string };
      target_keyword: string;
    };
    expect(preparedPayload.parent_request).toEqual({
      id: parentRequestId,
      updatedAt: parentBefore?.updatedAt,
    });
    expect(preparedPayload.target_keyword).toBe('best crm for solopreneurs');
    const handlePayload = readHandlePayload(briefRequestHandle) as {
      parentRequest?: { id: string; updatedAt: string };
      generation?: { inputFingerprint?: string };
    };
    expect(handlePayload.parentRequest).toEqual(preparedPayload.parent_request);
    expect(handlePayload.generation?.inputFingerprint).toBe(
      canonicalGenerationFingerprint(effectivePreparedInput),
    );

    const changed = updateContentRequest(ws.workspaceId, parentRequestId, {
      clientNote: 'Operator changed the request after context preparation.',
    });
    expect(changed?.updatedAt).not.toBe(parentBefore?.updatedAt);
    const briefsBefore = countWorkspaceArtifacts('content_briefs');

    const rejected = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
    });
    expect(rejected.isError).toBe(true);
    expect(errorEnvelope(rejected)).toMatchObject({ code: 'precondition_failed' });
    expect(countWorkspaceArtifacts('content_briefs')).toBe(briefsBefore);
    expect(countWorkspaceHandles('brief-request')).toBe(1);

    const retried = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
    });
    expect(retried.isError).toBe(true);
    expect(errorEnvelope(retried)).toMatchObject({ code: 'precondition_failed' });
    expect(retried.content[0].text).not.toContain('already consumed');
    expect(countWorkspaceArtifacts('content_briefs')).toBe(briefsBefore);
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

  it('keeps a brief handle reusable when the durable send fails, then consumes it with the retry', async () => {
    const createdRequest = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'retryable brief send',
      target_keyword: 'best crm for solopreneurs',
    });
    const { request_id: parentRequestId } = JSON.parse(createdRequest.content[0].text) as {
      request_id: string;
    };
    const prepared = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'retryable brief send',
      parent_request_id: parentRequestId,
      layout: buildLayout(),
    });
    const { brief_request_handle: requestHandle } = JSON.parse(prepared.content[0].text) as {
      brief_request_handle: string;
    };
    const saved = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: requestHandle,
      parent_request_id: parentRequestId,
      content: buildBriefContent(),
    });
    const { brief_handle: briefHandle } = JSON.parse(saved.content[0].text) as {
      brief_handle: string;
    };
    db.prepare(`
      UPDATE content_topic_requests SET status = 'declined'
      WHERE id = ? AND workspace_id = ?
    `).run(parentRequestId, ws.workspaceId);

    const failed = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      brief_handle: briefHandle,
    });

    expect(failed.isError).toBe(true);
    expect(handleExists(briefHandle)).toBe(true);
    expect(getContentRequest(ws.workspaceId, parentRequestId)?.status).toBe('declined');

    db.prepare(`
      UPDATE content_topic_requests SET status = 'brief_generated'
      WHERE id = ? AND workspace_id = ?
    `).run(parentRequestId, ws.workspaceId);
    const retried = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      brief_handle: briefHandle,
    });

    expect(retried.isError, retried.content[0]?.text).toBeFalsy();
    expect(handleExists(briefHandle)).toBe(false);
    expect(getContentRequest(ws.workspaceId, parentRequestId)?.status).toBe('client_review');
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

  it('keeps a post handle reusable when the durable send fails, then consumes it with the retry', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'retryable post send brief',
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(
      preparedBrief.content[0].text,
    ) as { brief_request_handle: string };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
    });
    const { brief_id: briefId } = JSON.parse(savedBrief.content[0].text) as {
      brief_id: string;
    };
    const parent = createContentRequest(ws.workspaceId, {
      topic: 'retryable post send',
      targetKeyword: 'best crm for solopreneurs',
      intent: 'commercial',
      priority: 'medium',
      rationale: 'Retryable MCP post-send fixture',
      initialStatus: 'brief_generated',
      dedupe: false,
    });
    expect(updateContentRequest(ws.workspaceId, parent.id, { briefId })).toBeDefined();
    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: briefId,
      parent_request_id: parent.id,
    });
    const { post_request_handle: postRequestHandle } = JSON.parse(
      preparedPost.content[0].text,
    ) as { post_request_handle: string };
    const savedPost = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: postRequestHandle,
      parent_request_id: parent.id,
      content: buildPostContent(briefId),
    });
    const { post_handle: postHandle } = JSON.parse(savedPost.content[0].text) as {
      post_handle: string;
    };
    db.prepare(`
      UPDATE content_topic_requests SET status = 'approved'
      WHERE id = ? AND workspace_id = ?
    `).run(parent.id, ws.workspaceId);

    const failed = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      post_handle: postHandle,
    });

    expect(failed.isError).toBe(true);
    expect(handleExists(postHandle)).toBe(true);
    expect(getContentRequest(ws.workspaceId, parent.id)?.status).toBe('approved');

    db.prepare(`
      UPDATE content_topic_requests SET status = 'in_progress'
      WHERE id = ? AND workspace_id = ?
    `).run(parent.id, ws.workspaceId);
    const retried = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      post_handle: postHandle,
    });

    expect(retried.isError, retried.content[0]?.text).toBeFalsy();
    expect(handleExists(postHandle)).toBe(false);
    expect(getContentRequest(ws.workspaceId, parent.id)?.status).toBe('post_review');
  });

  it('prepare_post_context rejects a brief edit that lands while context is being assembled and issues no handle', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'mid-prepare brief edit',
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(preparedBrief.content[0].text) as {
      brief_request_handle: string;
    };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
    });
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as {
      brief_id: string;
      revision: number;
    };
    const handlesBefore = countWorkspaceHandles('post-request');

    await initializeMcpSession();
    let pendingPrepare: ReturnType<typeof callMcpToolRequest> | undefined;
    try {
      // Keep the operator edit uncommitted while the child server takes its initial WAL
      // snapshot. The final IMMEDIATE recheck waits on this writer, then must observe
      // the committed revision before it can issue a post-request handle.
      db.exec('BEGIN IMMEDIATE');
      const editedBrief = updateBriefAtRevision(
        ws.workspaceId,
        savedBriefPayload.brief_id,
        savedBriefPayload.revision,
        { suggestedTitle: 'Operator edit committed during post preparation' },
      );
      expect(editedBrief?.generationRevision).toBe(savedBriefPayload.revision + 1);

      pendingPrepare = callMcpToolRequest('prepare_post_context', {
        workspace_id: ws.workspaceId,
        brief_id: savedBriefPayload.brief_id,
      });
      await new Promise(resolve => setTimeout(resolve, 750));
      db.exec('COMMIT');
    } finally {
      if (db.inTransaction) db.exec('ROLLBACK');
    }

    expect(pendingPrepare).toBeDefined();
    const conflicted = await pendingPrepare!;
    expect(conflicted.isError).toBe(true);
    expect(errorEnvelope(conflicted)).toMatchObject({
      code: 'conflict',
      retryable: true,
      details: {
        resource_type: 'content_brief',
        expected_revision: savedBriefPayload.revision,
        current_revision: savedBriefPayload.revision + 1,
      },
    });
    expect(countWorkspaceHandles('post-request')).toBe(handlesBefore);

    const reprepared = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload.brief_id,
    });
    expect(reprepared.isError, reprepared.content[0]?.text).toBeFalsy();
    const repreparedPayload = JSON.parse(reprepared.content[0].text) as {
      post_request_handle: string;
      brief_revision: number;
      brief: { suggestedTitle: string };
    };
    expect(repreparedPayload.post_request_handle).toMatch(/^post-request_/);
    expect(repreparedPayload.brief_revision).toBe(savedBriefPayload.revision + 1);
    expect(repreparedPayload.brief.suggestedTitle).toBe('Operator edit committed during post preparation');
  });

  it('save_post rejects a prepared context after the source brief is edited and writes no post', async () => {
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'stale post context',
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(preparedBrief.content[0].text) as {
      brief_request_handle: string;
    };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
    });
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as {
      brief_id: string;
      revision: number;
    };
    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload.brief_id,
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as {
      post_request_handle: string;
      brief_revision: number;
    };
    expect(preparedPostPayload.brief_revision).toBe(savedBriefPayload.revision);

    const editedBrief = updateBriefAtRevision(
      ws.workspaceId,
      savedBriefPayload.brief_id,
      savedBriefPayload.revision,
      { suggestedTitle: 'Operator-edited title after post preparation' },
    );
    expect(editedBrief?.generationRevision).toBe(savedBriefPayload.revision + 1);
    const postsBefore = countWorkspaceArtifacts('content_posts');

    const rejected = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: preparedPostPayload.post_request_handle,
      content: buildPostContent(savedBriefPayload.brief_id),
    });

    expect(rejected.isError).toBe(true);
    expect(errorEnvelope(rejected)).toMatchObject({
      code: 'conflict',
      details: {
        resource_type: 'content_brief',
        expected_revision: savedBriefPayload.revision,
        current_revision: editedBrief?.generationRevision,
      },
    });
    expect(countWorkspaceArtifacts('content_posts')).toBe(postsBefore);
  });

  it('rejects a save-time post parent override without consuming the prepared handle', async () => {
    const createdRequest = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'retryable post parent link',
      target_keyword: 'best crm for solopreneurs',
    });
    const { request_id: parentRequestId } = JSON.parse(createdRequest.content[0].text) as {
      request_id: string;
    };
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'retryable post parent link',
      parent_request_id: parentRequestId,
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(preparedBrief.content[0].text) as {
      brief_request_handle: string;
    };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
      parent_request_id: parentRequestId,
    });
    const { brief_id: briefId } = JSON.parse(savedBrief.content[0].text) as { brief_id: string };
    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: briefId,
      parent_request_id: parentRequestId,
    });
    const { post_request_handle: postRequestHandle } = JSON.parse(preparedPost.content[0].text) as {
      post_request_handle: string;
    };
    const postsBefore = countWorkspaceArtifacts('content_posts');

    const failed = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: postRequestHandle,
      content: buildPostContent(briefId),
      parent_request_id: 'different-parent-request',
    });

    expect(failed.isError).toBe(true);
    expect(errorEnvelope(failed)).toMatchObject({ code: 'precondition_failed' });
    expect(countWorkspaceArtifacts('content_posts')).toBe(postsBefore);

    const retried = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: postRequestHandle,
      content: buildPostContent(briefId),
      parent_request_id: parentRequestId,
    });
    expect(retried.isError, retried.content[0]?.text).toBeFalsy();
    const retriedPayload = JSON.parse(retried.content[0].text) as {
      post_id: string;
      revision: number;
    };
    expect(retriedPayload.revision).toBe(1);
    expect(getPost(ws.workspaceId, retriedPayload.post_id)).toBeDefined();
    expect(countWorkspaceArtifacts('content_posts')).toBe(postsBefore + 1);
  });

  it('rolls back post adoption when its prepared parent request changes', async () => {
    const createdRequest = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'stale prepared post parent',
      target_keyword: 'best crm for solopreneurs',
    });
    const { request_id: parentRequestId } = JSON.parse(createdRequest.content[0].text) as {
      request_id: string;
    };
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'stale prepared post parent',
      parent_request_id: parentRequestId,
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(preparedBrief.content[0].text) as {
      brief_request_handle: string;
    };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      parent_request_id: parentRequestId,
      content: buildBriefContent(),
    });
    const { brief_id: briefId } = JSON.parse(savedBrief.content[0].text) as { brief_id: string };
    const parentBefore = getContentRequest(ws.workspaceId, parentRequestId);
    expect(parentBefore?.briefId).toBe(briefId);

    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: briefId,
      parent_request_id: parentRequestId,
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as {
      post_request_handle: string;
      parent_request: { id: string; updatedAt: string };
    };
    expect(preparedPostPayload.parent_request).toEqual({
      id: parentRequestId,
      updatedAt: parentBefore?.updatedAt,
    });

    const changedAt = new Date(Date.parse(parentBefore!.updatedAt) + 1_000).toISOString();
    db.prepare(`
      UPDATE content_topic_requests
      SET client_note = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run('Operator changed the request after post preparation.', changedAt, parentRequestId, ws.workspaceId);
    const postsBefore = countWorkspaceArtifacts('content_posts');

    const rejected = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: preparedPostPayload.post_request_handle,
      content: buildPostContent(briefId),
    });
    expect(rejected.isError).toBe(true);
    expect(errorEnvelope(rejected)).toMatchObject({ code: 'precondition_failed' });
    expect(countWorkspaceArtifacts('content_posts')).toBe(postsBefore);
    expect(countWorkspaceHandles('post-request')).toBe(1);

    const retried = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: preparedPostPayload.post_request_handle,
      content: buildPostContent(briefId),
    });
    expect(retried.isError).toBe(true);
    expect(errorEnvelope(retried)).toMatchObject({ code: 'precondition_failed' });
    expect(retried.content[0].text).not.toContain('already consumed');
    expect(countWorkspaceArtifacts('content_posts')).toBe(postsBefore);
  });

  it('save_post persists revision 1 with canonical external provenance and links its parent request', async () => {
    const createdRequest = await callMcpTool('create_content_request', {
      workspace_id: ws.workspaceId,
      topic: 'parent-linked MCP post',
      target_keyword: 'best crm for solopreneurs',
    });
    const { request_id: parentRequestId } = JSON.parse(createdRequest.content[0].text) as {
      request_id: string;
    };
    const preparedBrief = await callMcpTool('prepare_brief_context', {
      workspace_id: ws.workspaceId,
      topic: 'parent-linked MCP post',
      parent_request_id: parentRequestId,
      target_keyword: 'best crm for solopreneurs',
      layout: buildLayout(),
    });
    const { brief_request_handle: briefRequestHandle } = JSON.parse(preparedBrief.content[0].text) as {
      brief_request_handle: string;
    };
    const savedBrief = await callMcpTool('save_brief', {
      workspace_id: ws.workspaceId,
      brief_request_handle: briefRequestHandle,
      content: buildBriefContent(),
      parent_request_id: parentRequestId,
    });
    expect(savedBrief.isError, savedBrief.content[0]?.text).toBeFalsy();
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as {
      brief_id: string;
      revision: number;
    };
    expect(getContentRequest(ws.workspaceId, parentRequestId)).toMatchObject({
      briefId: savedBriefPayload.brief_id,
      status: 'brief_generated',
    });

    const preparedPost = await callMcpTool('prepare_post_context', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload.brief_id,
      parent_request_id: parentRequestId,
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as {
      post_request_handle: string;
      brief_revision: number;
    };
    expect(preparedPostPayload.brief_revision).toBe(savedBriefPayload.revision);
    const savedPost = await callMcpTool('save_post', {
      workspace_id: ws.workspaceId,
      post_request_handle: preparedPostPayload.post_request_handle,
      parent_request_id: parentRequestId,
      content: buildPostContent(savedBriefPayload.brief_id),
    });
    expect(savedPost.isError, savedPost.content[0]?.text).toBeFalsy();
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as {
      post_id: string;
      revision: number;
      generation_provenance: unknown;
    };
    expect(savedPostPayload.revision).toBe(1);
    const responseProvenance = expectCanonicalExternalProvenance(
      savedPostPayload.generation_provenance,
      'mcp-external-post-generation',
    );

    const persistedPost = getPost(ws.workspaceId, savedPostPayload.post_id);
    expect(persistedPost).toMatchObject({
      id: savedPostPayload.post_id,
      briefId: savedBriefPayload.brief_id,
      generationRevision: 1,
    });
    expect(persistedPost?.generationProvenance).toEqual(responseProvenance);
    expect(getContentRequest(ws.workspaceId, parentRequestId)).toMatchObject({
      briefId: savedBriefPayload.brief_id,
      postId: savedPostPayload.post_id,
      status: 'in_progress',
    });
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
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_id: string; revision: number };

    const sent = await callMcpTool('send_to_client', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      expected_revision: savedPayload.revision,
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
    const listPayload = JSON.parse(listed.content[0].text) as { briefs: Array<{ brief_id: string; revision: number }> };
    const listedBrief = listPayload.briefs.find(item => item.brief_id === savedPayload.brief_id);
    expect(listedBrief).toBeDefined();

    const fetched = await callMcpTool('get_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
    });
    const fetchedPayload = JSON.parse(fetched.content[0].text) as { revision: number };
    expect(Number.isInteger(fetchedPayload.revision)).toBe(true);

    const patched = await callMcpTool('update_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedPayload.brief_id,
      expected_revision: fetchedPayload.revision,
      mode: 'patch',
      updates: { suggestedTitle: 'Updated CRM Brief Title' },
    });
    expect(patched.isError).toBeFalsy();
    const patchedPayload = JSON.parse(patched.content[0].text) as { revision: number };
    expect(Number.isInteger(patchedPayload.revision)).toBe(true);

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
    expect(errorEnvelope(conflict)).toMatchObject({
      code: 'conflict',
      details: { resource_type: 'content_brief' },
    });

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
    const listPayload = JSON.parse(listed.content[0].text) as { posts: Array<{ post_id: string; revision: number }> };
    const listedPost = listPayload.posts.find(item => item.post_id === savedPostPayload.post_id);
    expect(listedPost).toBeDefined();

    const fetched = await callMcpTool('get_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
    });
    const fetchedPayload = JSON.parse(fetched.content[0].text) as { revision: number };
    expect(Number.isInteger(fetchedPayload.revision)).toBe(true);

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
    const patchedPayload = JSON.parse(patched.content[0].text) as { revision: number };
    expect(Number.isInteger(patchedPayload.revision)).toBe(true);

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
    expect(errorEnvelope(conflict)).toMatchObject({
      code: 'conflict',
      details: { resource_type: 'content_post' },
    });

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
      expected_revision: storedPost!.generationRevision,
    });
    expect(reverted.isError).toBeFalsy();
    const revertedPayload = JSON.parse(reverted.content[0].text) as { post_id: string; version_id: string; revision: number };
    expect(revertedPayload.post_id).toBe(savedPostPayload.post_id);
    expect(revertedPayload.version_id).toBe(versionsPayload.versions[0].version_id);
    expect(Number.isInteger(revertedPayload.revision)).toBe(true);
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
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as { brief_id: string; revision: number };

    const deletedBrief = await callMcpTool('delete_brief', {
      workspace_id: ws.workspaceId,
      brief_id: savedBriefPayload.brief_id,
      expected_revision: savedBriefPayload.revision,
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
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string; revision: number };

    const deletedPost = await callMcpTool('delete_post', {
      workspace_id: ws.workspaceId,
      post_id: savedPostPayload.post_id,
      expected_revision: savedPostPayload.revision,
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
    expect(errorEnvelope(result)).toMatchObject({ code: 'precondition_failed' });
  });
});
