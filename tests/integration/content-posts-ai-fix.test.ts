/**
 * Integration tests for POST /api/content-posts/:workspaceId/:postId/ai-fix
 *
 * Architecture note: Uses createApp() + http.Server in-process (not createTestContext/child
 * process) so that vi.mock can intercept callOpenAI calls in the server's AI dispatch path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── Module-level mocks (hoisted by Vitest) ────────────────────────────────────
import {
  setupOpenAIMocks,
  mockOpenAIJsonResponse,
  mockOpenAIResponse,
  mockOpenAIError,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({})),
  buildIntelPrompt: vi.fn(async () => ''),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

// ── Imports (after mock declarations) ─────────────────────────────────────────
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getPost, savePost } from '../../server/content-posts-db.js';

// ── Test server helpers ────────────────────────────────────────────────────────

let baseUrl = '';
let stopServer: () => void;
let wsId = '';
let postId = '';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD; // bypass auth gate in-process
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  stopServer = () => server.close();
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();

  const ws = createWorkspace('AI Fix Test Workspace');
  wsId = ws.id;
  postId = `post_test_aifix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  savePost(wsId, {
    id: postId,
    workspaceId: wsId,
    briefId: 'brief_none',
    targetKeyword: 'test keyword',
    title: 'Test Post',
    metaDescription: 'A test post',
    seoTitle: 'Test Post',
    seoMetaDescription: 'A test post description',
    introduction: '<p>This is the introduction.</p>',
    sections: [
      {
        index: 0,
        heading: 'Section One',
        content: '<p>Section one content here.</p>',
        wordCount: 5,
        targetWordCount: 100,
        keywords: [],
        status: 'done',
      },
    ],
    conclusion: '<p>This is the conclusion.</p>',
    totalWordCount: 20,
    targetWordCount: 500,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  stopServer?.();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

beforeEach(() => {
  resetOpenAIMocks();
  broadcastState.calls = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/content-posts/:wsId/:postId/ai-fix', () => {
  it('returns 400 for unknown issueKey', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'not_a_real_key',
      reason: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'brand_voice',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown post', async () => {
    mockOpenAIResponse('content-fix', '<p>Fixed</p>');
    const res = await postJson(`/api/content-posts/${wsId}/not_a_real_post/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'voice mismatch',
    });
    expect(res.status).toBe(404);
  });

  it('brand_voice — returns AiFixResult targeting introduction', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIResponse('content-fix', '<p>Improved introduction.</p>');
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'Brand voice too informal',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.field).toBe('introduction');
    expect(body.suggestedText).toContain('Improved introduction');
    expect(body.originalText).toBe('<p>This is the introduction.</p>');
    expect(typeof body.explanation).toBe('string');

    const after = getPost(wsId, postId);
    expect(after?.introduction).toBe(before?.introduction);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('word_count_target — returns AiFixResult targeting a section', async () => {
    mockOpenAIResponse('content-fix', '<p>Expanded section content here with more words.</p>');
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'word_count_target',
      reason: 'Word count too low',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.field).toBe('section');
    expect(body.sectionIndex).toBe(0);
    expect(body.suggestedText).toContain('Expanded');
  });

  it('meta_optimized — returns AiFixResult with JSON suggestedText', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIJsonResponse('content-fix', {
      seoTitle: 'Optimized Test Post Title',
      seoMetaDescription: 'An optimized meta description for the test post that is 150 characters long and includes the keyword.',
      reasoning: 'Extra model commentary should not break the response.',
    });
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'meta_optimized',
      reason: 'Meta description too short',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.field).toBe('meta');
    const parsed = JSON.parse(body.suggestedText);
    expect(parsed).toHaveProperty('seoTitle');
    expect(parsed).toHaveProperty('seoMetaDescription');
    expect(parsed).not.toHaveProperty('reasoning');

    const after = getPost(wsId, postId);
    expect(after?.seoTitle).toBe(before?.seoTitle);
    expect(after?.seoMetaDescription).toBe(before?.seoMetaDescription);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('meta_optimized — rejects malformed AI meta JSON without mutating or broadcasting', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIJsonResponse('content-fix', {
      seoTitle: 'Optimized Test Post Title',
      seoMetaDescription: 42,
    });

    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'meta_optimized',
      reason: 'Meta description too short',
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to parse AI meta response' });

    expect(getPost(wsId, postId)).toEqual(before);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('meta_optimized — rejects blank AI meta fields without mutating or broadcasting', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIJsonResponse('content-fix', {
      seoTitle: '   ',
      seoMetaDescription: 'An optimized meta description for the test post that is 150 characters long and includes the keyword.',
    });

    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'meta_optimized',
      reason: 'Meta title is missing',
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to parse AI meta response' });

    expect(getPost(wsId, postId)).toEqual(before);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('meta_optimized — rejects AI meta fields that sanitize to blank without mutating or broadcasting', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIJsonResponse('content-fix', {
      seoTitle: '<script></script>',
      seoMetaDescription: 'An optimized meta description for the test post that is 150 characters long and includes the keyword.',
    });

    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'meta_optimized',
      reason: 'Meta title is missing',
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to parse AI meta response' });

    expect(getPost(wsId, postId)).toEqual(before);
    expect(broadcastState.calls).toHaveLength(0);
  });

  // FM-2: external API failure must produce 500 + { error: string }, not silent success
  it('returns 500 with error shape when AI call fails', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIError('content-fix', 'OpenAI rate limit exceeded');
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'test',
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/AI fix failed/);

    expect(getPost(wsId, postId)).toEqual(before);
    expect(broadcastState.calls).toHaveLength(0);
  });

  // Cross-tenant isolation: post from a different workspace must not be reachable
  it('returns 404 when postId belongs to a different workspace', async () => {
    const otherWs = createWorkspace('AI Fix Cross-Tenant Workspace');
    try {
      const res = await postJson(`/api/content-posts/${otherWs.id}/${postId}/ai-fix`, {
        issueKey: 'brand_voice',
        reason: 'cross-tenant probe',
      });
      expect(res.status).toBe(404);
    } finally {
      deleteWorkspace(otherWs.id);
    }
  });

  // XSS hardening: AI-returned <script> tags must be stripped server-side
  it('sanitizes <script> tags out of AI suggestedText', async () => {
    mockOpenAIResponse('content-fix', '<p>Improved.</p><script>alert(1)</script><a href="javascript:void(0)">x</a>');
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'sanitize probe',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestedText).not.toContain('<script');
    expect(body.suggestedText).not.toContain('javascript:');
    expect(body.suggestedText).toContain('<p>Improved.</p>');
  });
});

describe('POST /api/content-posts/:wsId/:postId/ai-review', () => {
  it('returns 500 without mutating when AI review JSON has the wrong shape', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIJsonResponse('content-review', {
      factual_accuracy: { pass: 'yes', reason: 'Wrong pass type.' },
      brand_voice: { pass: true, reason: 'Tone is consistent.' },
      internal_links: { pass: true, reason: 'Internal links are present.' },
      no_hallucinations: { pass: false, reason: 'Needs human review.' },
      meta_optimized: { pass: true, reason: 'Metadata is in range.' },
      word_count_target: { pass: true, reason: 'Word count is in range.' },
    });

    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to parse AI review response' });

    expect(getPost(wsId, postId)).toEqual(before);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('marks provenance-sensitive checklist items as human-review required even when AI returns pass', async () => {
    const before = getPost(wsId, postId);
    mockOpenAIJsonResponse('content-review', {
      factual_accuracy: { pass: true, reason: 'No suspicious claims detected.', confidence: 0.95 },
      brand_voice: { pass: true, reason: 'Tone is consistent.' },
      internal_links: { pass: true, reason: 'Internal links are present.' },
      no_hallucinations: { pass: true, reason: 'No obvious fabricated statistics detected.' },
      meta_optimized: { pass: true, reason: 'Metadata is in range.' },
      word_count_target: { pass: true, reason: 'Word count is in range.' },
      summary: 'Extra model commentary should not fail the review.',
    });

    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-review`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as {
      review: Record<string, { pass: boolean; reason: string; humanReviewRequired?: boolean }>;
    };

    expect(body.review.factual_accuracy.pass).toBe(false);
    expect(body.review.factual_accuracy.humanReviewRequired).toBe(true);
    expect(body.review.factual_accuracy.reason).toMatch(/Human verification is required/);
    expect(body.review.no_hallucinations.pass).toBe(false);
    expect(body.review.no_hallucinations.humanReviewRequired).toBe(true);
    expect(body.review.brand_voice.pass).toBe(true);
    expect(body.review.internal_links.pass).toBe(true);
    expect(body.review.factual_accuracy).not.toHaveProperty('confidence');
    expect(body.review).not.toHaveProperty('summary');

    const after = getPost(wsId, postId);
    expect(after?.reviewChecklist).toBe(before?.reviewChecklist);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
