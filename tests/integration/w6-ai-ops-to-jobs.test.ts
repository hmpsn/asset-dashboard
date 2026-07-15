/**
 * Integration tests — W6.2: five synchronous AI route handlers migrated to the
 * background job platform.
 *
 *   1. POST /api/content-briefs/:ws/:brief/regenerate          → CONTENT_BRIEF_REGENERATE job
 *   2. POST /api/content-briefs/:ws/:brief/regenerate-outline  → CONTENT_BRIEF_REGENERATE job
 *   3. POST /api/content-posts/:ws/:post/ai-review             → CONTENT_POST_REVIEW job
 *   4. POST /api/content-posts/:ws/:post/ai-fix                → CONTENT_POST_FIX job
 *   5. POST /api/content-posts/:ws/:post/score-voice           → CONTENT_POST_VOICE_SCORE job
 *
 * Per op:
 *   - POST returns 202 { jobId: string }
 *   - job runs with mocked AI and reaches 'done'
 *   - the result lands in the domain store (brief persisted / aiReview persisted /
 *     voiceScore persisted) and/or job.result
 *   - FM-2: mocked AI throws → job status 'error', not success
 *
 * Uses the in-process createApp() + vi.mock pattern so callOpenAI is intercepted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  setupOpenAIMocks,
  mockOpenAIResponse,
  mockOpenAIJsonResponse,
  mockOpenAIError,
  resetOpenAIMocks,
} from '../mocks/openai.js';

setupOpenAIMocks();

const postAiEffectFailureState = vi.hoisted(() => ({
  failActivityType: null as 'post_ai_review' | 'post_voice_scored' | null,
  failIntelligenceInvalidation: false,
}));

const postAiJobTerminalFailureState = vi.hoisted(() => ({
  failNextDone: false,
}));

vi.mock('../../server/jobs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/jobs.js')>();
  return {
    ...actual,
    updateJob: vi.fn((
      id: string,
      update: Parameters<typeof actual.updateJob>[1],
    ) => {
      if (postAiJobTerminalFailureState.failNextDone && update.status === 'done') {
        postAiJobTerminalFailureState.failNextDone = false;
        throw new Error('injected job completion persistence failure');
      }
      return actual.updateJob(id, update);
    }),
  };
});

vi.mock('../../server/activity-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/activity-log.js')>();
  return {
    ...actual,
    addActivity: vi.fn((...args: Parameters<typeof actual.addActivity>) => {
      if (postAiEffectFailureState.failActivityType === args[1]) {
        postAiEffectFailureState.failActivityType = null;
        throw new Error(`injected ${args[1]} activity failure`);
      }
      return actual.addActivity(...args);
    }),
  };
});

vi.mock('../../server/intelligence-freshness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/intelligence-freshness.js')>();
  return {
    ...actual,
    invalidateContentPipelineIntelligence: vi.fn((workspaceId: string) => {
      if (postAiEffectFailureState.failIntelligenceInvalidation) {
        postAiEffectFailureState.failIntelligenceInvalidation = false;
        throw new Error('injected intelligence invalidation failure');
      }
      return actual.invalidateContentPipelineIntelligence(workspaceId);
    }),
  };
});

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(async () => ({})),
  buildIntelPrompt: vi.fn(async () => ''),
  invalidateIntelligenceCache: vi.fn(),
}));

vi.mock('../../server/intelligence/generation-context-builders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/intelligence/generation-context-builders.js')>();
  return {
    ...actual,
    buildContentGenerationContext: vi.fn(async () => ({ promptContext: '', learningsAvailability: 'not_requested' as const })),
    buildSeoPromptContext: vi.fn(async () => ({ seoPromptContext: '', learningsAvailability: 'not_requested' as const })),
  };
});

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getPost, savePost } from '../../server/content-posts-db.js';
import { getBrief } from '../../server/content-brief.js';
import { addActivity } from '../../server/activity-log.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import db from '../../server/db/index.js';

// ── Server bootstrap ────────────────────────────────────────────────────────

let baseUrl = '';
let stopServer: () => void;
let wsId = '';
let briefId = '';
let postId = '';
const SOURCE_POST_FINGERPRINT = 'b'.repeat(64);
const originalAppPassword = process.env.APP_PASSWORD;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.OPENAI_API_KEY = 'test-key'; // regenerateBrief asserts this is set
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  stopServer = () => server.close();
}

function postJson(path: string, body: unknown): Promise<Response> {
  const briefMatch = path.match(/^\/api\/content-briefs\/([^/]+)\/([^/]+)\/regenerate(?:-outline)?$/);
  const requestBody = briefMatch && body && typeof body === 'object' && !('expectedRevision' in body)
    ? { ...body, expectedRevision: getBrief(briefMatch[1], briefMatch[2])?.generationRevision ?? 0 }
    : body;
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
}

function getJob(jobId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/jobs/${jobId}`);
}

/** POST then poll /api/jobs/:id until terminal. */
async function startAndWait(
  path: string,
  body: unknown,
  timeoutMs = 10_000,
): Promise<{ startRes: Response; startBody: { jobId?: string; error?: string }; job: Record<string, unknown> | null }> {
  const startRes = await postJson(path, body);
  if (startRes.status !== 202) {
    const startBody = (await startRes.json().catch(() => ({}))) as { error?: string };
    return { startRes, startBody, job: null };
  }
  const startBody = (await startRes.json()) as { jobId: string };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await getJob(startBody.jobId);
    if (res.status === 200) {
      const job = (await res.json()) as Record<string, unknown>;
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        return { startRes, startBody, job };
      }
    }
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for job ${startBody.jobId}`);
}

function seedBrief(id: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO content_briefs
       (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
        suggested_meta_desc, outline, word_count_target, intent, audience,
        competitor_insights, internal_link_suggestions, created_at)
     VALUES
       (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
        @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
        @competitor_insights, @internal_link_suggestions, @created_at)`,
  ).run({
    id,
    workspace_id: wsId,
    target_keyword: 'test keyword',
    secondary_keywords: JSON.stringify(['secondary']),
    suggested_title: 'Original Title',
    suggested_meta_desc: 'Original meta',
    outline: JSON.stringify([{ heading: 'Section 1', notes: 'Notes', wordCount: 300, keywords: ['test keyword'] }]),
    word_count_target: 1500,
    intent: 'informational',
    audience: 'general',
    competitor_insights: '',
    internal_link_suggestions: JSON.stringify(['/about']),
    created_at: new Date().toISOString(),
  });
}

function seedPost(id: string): void {
  const now = new Date().toISOString();
  savePost(wsId, {
    id,
    workspaceId: wsId,
    briefId,
    targetKeyword: 'test keyword',
    title: 'Test Post',
    metaDescription: 'A test post',
    seoTitle: 'Test Post Title Here',
    seoMetaDescription: 'A test post meta description that is fairly long for SEO purposes here.',
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
    generationRevision: 0,
    generationProvenance: {
      runId: 'seed-post-run',
      operation: 'seed-post',
      provider: 'deterministic',
      model: 'fixture',
      inputFingerprint: SOURCE_POST_FINGERPRINT,
      startedAt: '2026-07-14T00:00:00.000Z',
      completedAt: '2026-07-14T00:00:00.000Z',
    },
    createdAt: now,
    updatedAt: now,
  });
}

const REVIEW_JSON = {
  factual_accuracy: { pass: false, reason: 'needs review' },
  brand_voice: { pass: true, reason: 'consistent' },
  internal_links: { pass: false, reason: 'no links' },
  no_hallucinations: { pass: false, reason: 'needs review' },
  meta_optimized: { pass: true, reason: 'good' },
  word_count_target: { pass: true, reason: 'within range' },
};

// Full content-brief JSON shape consumed by parseContentBriefSchema on regenerate.
const BRIEF_JSON = {
  executiveSummary: 'Regenerated summary',
  suggestedTitle: 'Regenerated Title',
  titleVariants: ['Variant A', 'Variant B'],
  suggestedMetaDesc: 'Regenerated meta',
  metaDescVariants: ['Meta A', 'Meta B'],
  secondaryKeywords: ['secondary'],
  contentFormat: 'guide',
  toneAndStyle: 'professional',
  outline: [{ heading: 'New Section', subheadings: [], notes: 'notes', wordCount: 300, keywords: ['test keyword'] }],
  wordCountTarget: 1500,
  intent: 'informational',
  audience: 'general',
  peopleAlsoAsk: [],
  topicalEntities: [],
  serpAnalysis: { contentType: 'guide', avgWordCount: 1500, commonElements: [], gaps: [] },
  difficultyScore: 40,
  trafficPotential: 'medium',
  competitorInsights: 'insights',
  ctaRecommendations: [],
  internalLinkSuggestions: ['/about'],
  eeatGuidance: { experience: 'x', expertise: 'y', authority: 'z', trust: 'w' },
  contentChecklist: [],
  schemaRecommendations: [],
};

const OUTLINE_JSON = [
  { heading: 'Answer-first section', subheadings: [], notes: 'notes', wordCount: 300, keywords: ['test keyword'] },
  { heading: 'Second section', subheadings: [], notes: 'notes', wordCount: 300, keywords: ['secondary'] },
];

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('W6 AI Ops Workspace');
  wsId = ws.id;
  briefId = 'brief_w6_aiops';
  postId = `post_w6_aiops_${Date.now()}`;
  seedBrief(briefId);
  seedPost(postId);
}, 25_000);

afterAll(() => {
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  stopServer?.();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
});

beforeEach(() => {
  resetOpenAIMocks();
  postAiEffectFailureState.failActivityType = null;
  postAiEffectFailureState.failIntelligenceInvalidation = false;
  postAiJobTerminalFailureState.failNextDone = false;
  vi.mocked(addActivity).mockClear();
  vi.mocked(broadcastToWorkspace).mockClear();
  db.prepare('UPDATE content_briefs SET superseded_by = NULL WHERE workspace_id = ? AND id = ?')
    .run(wsId, briefId);
});

// ── 1. Brief regenerate ────────────────────────────────────────────────────

describe('POST /api/content-briefs/:ws/:brief/regenerate — CONTENT_BRIEF_REGENERATE job', () => {
  it('returns 202 { jobId }, job reaches done, new brief persisted', async () => {
    mockOpenAIJsonResponse('content-brief-regenerate', BRIEF_JSON);
    const { startRes, startBody, job } = await startAndWait(
      `/api/content-briefs/${wsId}/${briefId}/regenerate`,
      { feedback: 'make it punchier' },
    );
    expect(startRes.status).toBe(202);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    expect(job?.type).toBe(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE);
    const result = job?.result as { briefId?: string } | undefined;
    expect(typeof result?.briefId).toBe('string');
    // New brief is persisted to the content_briefs store with the regenerated title.
    const persisted = getBrief(wsId, result!.briefId!);
    expect(persisted?.suggestedTitle).toBe('Regenerated Title');
  });

  it('keeps the committed successor and done job when a post-commit event throws', async () => {
    mockOpenAIJsonResponse('content-brief-regenerate', BRIEF_JSON);
    vi.mocked(broadcastToWorkspace).mockClear();
    vi.mocked(broadcastToWorkspace).mockImplementationOnce(() => {
      throw new Error('injected brief event failure');
    });

    const { startRes, job } = await startAndWait(
      `/api/content-briefs/${wsId}/${briefId}/regenerate`,
      { feedback: 'retain success through event failure' },
    );

    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('done');
    expect(job?.error).toBeFalsy();
    const result = job?.result as { briefId?: string } | undefined;
    expect(getBrief(wsId, result?.briefId ?? '')?.suggestedTitle).toBe('Regenerated Title');
    // The failed CONTENT_UPDATED event does not suppress BRIEF_UPDATED.
    expect(vi.mocked(broadcastToWorkspace).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves a committed successor when terminal bookkeeping fails', async () => {
    mockOpenAIJsonResponse('content-brief-regenerate', BRIEF_JSON);
    postAiJobTerminalFailureState.failNextDone = true;

    const { startRes, job } = await startAndWait(
      `/api/content-briefs/${wsId}/${briefId}/regenerate`,
      { feedback: 'terminal truth' },
    );

    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
    expect(job?.message).toBe('Brief regeneration committed, but completion tracking failed');
    expect(job?.error).toContain('completion persistence failure');
    const result = job?.result as {
      briefId?: string;
      code?: string;
      artifactCommitted?: boolean;
    } | undefined;
    expect(result).toMatchObject({
      code: 'completion_tracking_failed',
      artifactCommitted: true,
    });
    expect(getBrief(wsId, result?.briefId ?? '')?.suggestedTitle).toBe('Regenerated Title');
    expect(vi.mocked(addActivity)).not.toHaveBeenCalledWith(
      wsId,
      'brief_generated',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('missing feedback → 400 (no job created)', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/${briefId}/regenerate`, {});
    expect(res.status).toBe(400);
  });

  it('unknown brief → 404', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/not_a_brief/regenerate`, { feedback: 'x' });
    expect(res.status).toBe(404);
  });

  it('FM-2: AI throws → job status error, not done', async () => {
    mockOpenAIError('content-brief-regenerate', 'AI provider unavailable');
    const { startRes, job } = await startAndWait(
      `/api/content-briefs/${wsId}/${briefId}/regenerate`,
      { feedback: 'fail please' },
    );
    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
    expect(typeof job?.error).toBe('string');
  });
});

// ── 2. Brief regenerate-outline ─────────────────────────────────────────────

describe('POST /api/content-briefs/:ws/:brief/regenerate-outline — CONTENT_BRIEF_REGENERATE job', () => {
  it('returns 202 { jobId }, job reaches done, outline persisted', async () => {
    mockOpenAIJsonResponse('content-brief-outline', OUTLINE_JSON);
    const { startRes, startBody, job } = await startAndWait(
      `/api/content-briefs/${wsId}/${briefId}/regenerate-outline`,
      { feedback: 'reorder sections' },
    );
    expect(startRes.status).toBe(202);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    expect(job?.type).toBe(BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE);
    const result = job?.result as { briefId?: string } | undefined;
    const persisted = getBrief(wsId, result!.briefId!);
    expect(persisted?.outline?.[0]?.heading).toBe('Answer-first section');
  });

  it('unknown brief → 404', async () => {
    const res = await postJson(`/api/content-briefs/${wsId}/not_a_brief/regenerate-outline`, {});
    expect(res.status).toBe(404);
  });

  it('FM-2: AI throws → job status error', async () => {
    mockOpenAIError('content-brief-outline', 'AI provider unavailable');
    const { job } = await startAndWait(
      `/api/content-briefs/${wsId}/${briefId}/regenerate-outline`,
      { feedback: 'fail' },
    );
    expect(job?.status).toBe('error');
  });
});

// ── 3. ai-review ────────────────────────────────────────────────────────────

describe('POST /api/content-posts/:ws/:post/ai-review — CONTENT_POST_REVIEW job', () => {
  it('returns 202 { jobId }, job reaches done, aiReview persisted, result returned', async () => {
    mockOpenAIJsonResponse('content-review', REVIEW_JSON);
    const { startRes, startBody, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/ai-review`,
      { expectedRevision: getPost(wsId, postId)!.generationRevision },
    );
    expect(startRes.status).toBe(202);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    expect(job?.type).toBe(BACKGROUND_JOB_TYPES.CONTENT_POST_REVIEW);
    const result = job?.result as {
      review?: Record<string, unknown>;
      sourceRevision?: number;
      provenance?: { operation?: string; inputFingerprint?: string };
    } | undefined;
    expect(result?.review).toBeTruthy();
    expect(result?.sourceRevision).toEqual(expect.any(Number));
    expect(result?.provenance).toMatchObject({
      operation: 'content-post-review',
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    // Verdicts persisted to the post (domain store).
    const persisted = getPost(wsId, postId);
    expect(persisted?.aiReview?.review).toBeTruthy();
    // Provenance-sensitive items are forced to human review.
    expect(persisted?.aiReview?.review.factual_accuracy.pass).toBe(false);
    expect(persisted?.generationProvenance?.inputFingerprint).toBe(SOURCE_POST_FINGERPRINT);
  });

  it('keeps the committed review and done job when activity recording throws', async () => {
    mockOpenAIJsonResponse('content-review', REVIEW_JSON);
    postAiEffectFailureState.failActivityType = 'post_ai_review';
    const revisionBefore = getPost(wsId, postId)!.generationRevision;

    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/ai-review`,
      { expectedRevision: revisionBefore },
    );

    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('done');
    expect(job?.error).toBeFalsy();
    expect(getPost(wsId, postId)).toMatchObject({
      generationRevision: revisionBefore + 1,
      aiReview: { review: expect.any(Object) },
    });
    expect(postAiEffectFailureState.failActivityType).toBeNull();
    expect(vi.mocked(broadcastToWorkspace)).toHaveBeenCalledWith(
      wsId,
      WS_EVENTS.CONTENT_UPDATED,
      expect.objectContaining({ postId, action: 'ai_review_completed' }),
    );
  });

  it('emits no review-success effects before terminal job persistence succeeds', async () => {
    mockOpenAIJsonResponse('content-review', REVIEW_JSON);
    postAiJobTerminalFailureState.failNextDone = true;
    const revisionBefore = getPost(wsId, postId)!.generationRevision;

    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/ai-review`,
      { expectedRevision: revisionBefore },
    );

    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
    expect(job?.error).toContain('completion persistence failure');
    expect(job?.message).toBe('AI review complete, but completion tracking failed');
    expect(job?.result).toMatchObject({
      code: 'completion_tracking_failed',
      artifactCommitted: true,
      review: expect.any(Object),
    });
    expect(getPost(wsId, postId)).toMatchObject({
      generationRevision: revisionBefore + 1,
      aiReview: { review: expect.any(Object) },
    });
    expect(vi.mocked(addActivity)).not.toHaveBeenCalledWith(
      wsId,
      'post_ai_review',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(vi.mocked(broadcastToWorkspace)).not.toHaveBeenCalledWith(
      wsId,
      WS_EVENTS.CONTENT_UPDATED,
      expect.objectContaining({ postId, action: 'ai_review_completed' }),
    );
  });

  it('unknown post → 404', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/not_a_post/ai-review`, { expectedRevision: 0 });
    expect(res.status).toBe(404);
  });

  it('FM-2: AI throws → job status error, no successful review', async () => {
    mockOpenAIError('content-review', 'AI provider unavailable');
    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/ai-review`,
      { expectedRevision: getPost(wsId, postId)!.generationRevision },
    );
    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
    expect(typeof job?.error).toBe('string');
  });
});

// ── 4. ai-fix ───────────────────────────────────────────────────────────────

describe('POST /api/content-posts/:ws/:post/ai-fix — CONTENT_POST_FIX job', () => {
  it('returns 202 { jobId }, job reaches done, AiFixResult in result', async () => {
    mockOpenAIResponse('content-post-feedback-fix', '<p>Rewritten introduction.</p>');
    const { startRes, startBody, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/ai-fix`,
      {
        issueKey: 'brand_voice',
        reason: 'voice mismatch',
        expectedRevision: getPost(wsId, postId)!.generationRevision,
      },
    );
    expect(startRes.status).toBe(202);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    expect(job?.type).toBe(BACKGROUND_JOB_TYPES.CONTENT_POST_FIX);
    const result = job?.result as {
      field?: string;
      suggestedText?: string;
      sourceRevision?: number;
      provenance?: { operation?: string; inputFingerprint?: string };
    } | undefined;
    expect(result?.field).toBe('introduction');
    expect(result?.suggestedText).toContain('Rewritten introduction');
    expect(result?.sourceRevision).toEqual(expect.any(Number));
    expect(result?.provenance).toMatchObject({
      operation: 'content-post-feedback-fix',
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('unknown issueKey → 400 (no job created)', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'not_a_real_key',
      reason: 'x',
      expectedRevision: getPost(wsId, postId)!.generationRevision,
    });
    expect(res.status).toBe(400);
  });

  it('unknown post → 404', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/not_a_post/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'x',
      expectedRevision: 0,
    });
    expect(res.status).toBe(404);
  });

  it('FM-2: AI throws → job status error', async () => {
    mockOpenAIError('content-post-feedback-fix', 'AI provider unavailable');
    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/ai-fix`,
      {
        issueKey: 'brand_voice',
        reason: 'fail',
        expectedRevision: getPost(wsId, postId)!.generationRevision,
      },
    );
    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
  });
});

// ── 5. score-voice ──────────────────────────────────────────────────────────

describe('POST /api/content-posts/:ws/:post/score-voice — CONTENT_POST_VOICE_SCORE job', () => {
  it('returns 202 { jobId }, job reaches done, voiceScore persisted', async () => {
    mockOpenAIJsonResponse('voice-scoring', { voiceScore: 82, voiceFeedback: 'Strong brand voice match.' });
    const { startRes, startBody, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/score-voice`,
      { expectedRevision: getPost(wsId, postId)!.generationRevision },
    );
    expect(startRes.status).toBe(202);
    expect(typeof startBody.jobId).toBe('string');
    expect(job?.status).toBe('done');
    expect(job?.type).toBe(BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE);
    expect(job?.result).toMatchObject({
      sourceRevision: expect.any(Number),
      provenance: {
        operation: 'voice-scoring',
        inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    const persisted = getPost(wsId, postId);
    expect(persisted?.voiceScore).toBe(82);
    expect(persisted?.voiceFeedback).toContain('Strong brand voice');
    expect(persisted?.generationProvenance?.inputFingerprint).toBe(SOURCE_POST_FINGERPRINT);
  });

  it('keeps the committed voice score and done job when cache invalidation throws', async () => {
    mockOpenAIJsonResponse('voice-scoring', {
      voiceScore: 88,
      voiceFeedback: 'Voice result survives optional effect failures.',
    });
    postAiEffectFailureState.failIntelligenceInvalidation = true;
    const revisionBefore = getPost(wsId, postId)!.generationRevision;

    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/score-voice`,
      { expectedRevision: revisionBefore },
    );

    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('done');
    expect(job?.error).toBeFalsy();
    expect(getPost(wsId, postId)).toMatchObject({
      generationRevision: revisionBefore + 1,
      voiceScore: 88,
      voiceFeedback: 'Voice result survives optional effect failures.',
    });
    expect(postAiEffectFailureState.failIntelligenceInvalidation).toBe(false);
    expect(vi.mocked(broadcastToWorkspace)).toHaveBeenCalledWith(
      wsId,
      WS_EVENTS.POST_UPDATED,
      { postId },
    );
    expect(vi.mocked(addActivity)).toHaveBeenCalledWith(
      wsId,
      'post_voice_scored',
      expect.any(String),
      'Score: 88',
      expect.objectContaining({ postId, voiceScore: 88, action: 'voice_score_completed' }),
    );
  });

  it('emits no voice-success effects before terminal job persistence succeeds', async () => {
    mockOpenAIJsonResponse('voice-scoring', {
      voiceScore: 91,
      voiceFeedback: 'Committed before terminal tracking failed.',
    });
    postAiJobTerminalFailureState.failNextDone = true;
    const revisionBefore = getPost(wsId, postId)!.generationRevision;

    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/score-voice`,
      { expectedRevision: revisionBefore },
    );

    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
    expect(job?.error).toContain('completion persistence failure');
    expect(job?.message).toBe('Brand voice scored, but completion tracking failed');
    expect(job?.result).toMatchObject({
      code: 'completion_tracking_failed',
      artifactCommitted: true,
      postId,
      post: expect.objectContaining({ voiceScore: 91 }),
    });
    expect(getPost(wsId, postId)).toMatchObject({
      generationRevision: revisionBefore + 1,
      voiceScore: 91,
      voiceFeedback: 'Committed before terminal tracking failed.',
    });
    expect(vi.mocked(addActivity)).not.toHaveBeenCalledWith(
      wsId,
      'post_voice_scored',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(vi.mocked(broadcastToWorkspace)).not.toHaveBeenCalledWith(
      wsId,
      WS_EVENTS.POST_UPDATED,
      { postId },
    );
  });

  it('unknown post → 404', async () => {
    const res = await postJson(`/api/content-posts/${wsId}/not_a_post/score-voice`, { expectedRevision: 0 });
    expect(res.status).toBe(404);
  });

  it('FM-2: AI throws → job status error', async () => {
    mockOpenAIError('voice-scoring', 'AI provider unavailable');
    const { startRes, job } = await startAndWait(
      `/api/content-posts/${wsId}/${postId}/score-voice`,
      { expectedRevision: getPost(wsId, postId)!.generationRevision },
    );
    expect(startRes.status).toBe(202);
    expect(job?.status).toBe('error');
  });
});
