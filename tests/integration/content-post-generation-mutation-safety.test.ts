import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

const generationState = vi.hoisted(() => ({
  failVoiceContext: false,
  failStage: null as 'introduction' | 'section' | 'conclusion' | 'all' | null,
  emptyStage: null as 'introduction' | 'section' | 'conclusion' | null,
  emptyUnification: false,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/content-posts-ai.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/content-posts-ai.js')>();
  const countWords = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;

  return {
    ...original,
    buildVoiceContext: vi.fn(async () => {
      if (generationState.failVoiceContext) {
        throw new Error('Voice context unavailable');
      }
      return 'calibrated-voice';
    }),
    generateIntroduction: vi.fn(async () => {
      if (generationState.failStage === 'introduction' || generationState.failStage === 'all') throw new Error('<b>intro provider failed</b>');
      if (generationState.emptyStage === 'introduction') return '<p> </p>';
      return '<p>Draft introduction for the generated post.</p>';
    }),
    generateSection: vi.fn(async (_brief, section: { heading: string }, index: number) => {
      if (generationState.failStage === 'section' || generationState.failStage === 'all') throw new Error('<b>section provider failed</b>');
      if (generationState.emptyStage === 'section') return '<div><span></span></div>';
      return `<p>${section.heading} body ${index + 1} with practical guidance.</p>`;
    }),
    generateConclusion: vi.fn(async () => {
      if (generationState.failStage === 'conclusion' || generationState.failStage === 'all') throw new Error('<b>conclusion provider failed</b>');
      if (generationState.emptyStage === 'conclusion') return '<p>&nbsp;</p>';
      return '<p>Draft conclusion with a clear next step.</p>';
    }),
    unifyPost: vi.fn(async () => generationState.emptyUnification
      ? { introduction: '<p></p>', sections: ['<div>&nbsp;</div>'], conclusion: '<span></span>' }
      : null),
    generateSeoMeta: vi.fn(async () => ({
      seoTitle: 'Generated SEO Title',
      seoMetaDescription: 'Generated SEO meta description for the drafted post.',
    })),
    countHtmlWords: vi.fn(countWords),
  };
});

import db from '../../server/db/index.js';
import { createJob, clearCompletedJobs, listJobs } from '../../server/jobs.js';
import { getPost, listPostVersions, listPosts, savePost } from '../../server/content-posts-db.js';
import {
  generatePost,
  markPostGenerationCancelled,
  markPostGenerationFailed,
} from '../../server/content-posts.js';
import { getBrief } from '../../server/content-brief.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { GeneratedPost } from '../../shared/types/content.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';
const originalAppPassword = process.env.APP_PASSWORD;

function makeBriefRow(id: string) {
  return {
    id,
    workspace_id: workspaceId,
    target_keyword: 'local seo guide',
    secondary_keywords: JSON.stringify(['local seo', 'seo services']),
    suggested_title: 'Local SEO Guide',
    suggested_meta_desc: 'A practical guide to local SEO.',
    outline: JSON.stringify([
      {
        heading: 'What local SEO solves',
        notes: 'Explain the core problem.',
        wordCount: 280,
        keywords: ['local seo'],
      },
    ]),
    word_count_target: 1200,
    intent: 'commercial',
    audience: 'Small business owners',
    competitor_insights: 'Competitors emphasize map pack wins.',
    internal_link_suggestions: JSON.stringify(['/services/seo']),
    created_at: new Date().toISOString(),
    executive_summary: null,
    content_format: null,
    tone_and_style: null,
    people_also_ask: null,
    topical_entities: null,
    serp_analysis: null,
    difficulty_score: null,
    traffic_potential: null,
    cta_recommendations: null,
    eeat_guidance: null,
    content_checklist: null,
    schema_recommendations: null,
    page_type: 'service',
    reference_urls: null,
    real_people_also_ask: null,
    real_top_results: null,
    keyword_locked: 0,
    keyword_source: null,
    keyword_validation: null,
    template_id: null,
    title_variants: null,
    meta_desc_variants: null,
  };
}

function seedBrief(id: string): void {
  db.prepare(`
    INSERT INTO content_briefs
      (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at,
       executive_summary, content_format, tone_and_style, people_also_ask,
       topical_entities, serp_analysis, difficulty_score, traffic_potential,
       cta_recommendations, eeat_guidance, content_checklist, schema_recommendations,
       page_type, reference_urls, real_people_also_ask, real_top_results,
       keyword_locked, keyword_source, keyword_validation, template_id,
       title_variants, meta_desc_variants)
    VALUES
      (@id, @workspace_id, @target_keyword, @secondary_keywords, @suggested_title,
       @suggested_meta_desc, @outline, @word_count_target, @intent, @audience,
       @competitor_insights, @internal_link_suggestions, @created_at,
       @executive_summary, @content_format, @tone_and_style, @people_also_ask,
       @topical_entities, @serp_analysis, @difficulty_score, @traffic_potential,
       @cta_recommendations, @eeat_guidance, @content_checklist, @schema_recommendations,
       @page_type, @reference_urls, @real_people_also_ask, @real_top_results,
       @keyword_locked, @keyword_source, @keyword_validation, @template_id,
       @title_variants, @meta_desc_variants)
  `).run(makeBriefRow(id));
}

function resetWorkspaceState(): void {
  clearCompletedJobs({ workspaceId });
  db.prepare('DELETE FROM jobs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_post_versions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
}

function countRows(table: 'content_posts' | 'activity_log' | 'jobs'): number {
  const row = db.prepare(`SELECT COALESCE(COUNT(*), 0) AS count FROM ${table} WHERE workspace_id = ?`).get(workspaceId) as { count: number };
  return row.count;
}

function activityTitles(type: string): string[] {
  return db.prepare(`
    SELECT title
    FROM activity_log
    WHERE workspace_id = ? AND type = ?
    ORDER BY created_at DESC
  `).all(workspaceId, type).map((row: { title: string }) => row.title);
}

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForJob(jobId: string, timeoutMs = 8_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api(`/api/jobs/${jobId}`);
    if (res.status === 200) {
      const job = await res.json() as Record<string, unknown>;
      const status = job.status;
      if (status === 'done' || status === 'error' || status === 'cancelled') return job;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

beforeAll(async () => {
  await startTestServer();
  const workspace = createWorkspace('Content Post Mutation Safety');
  workspaceId = workspace.id;
}, 30_000);

beforeEach(() => {
  resetWorkspaceState();
  broadcastState.calls = [];
  generationState.failVoiceContext = false;
  generationState.failStage = null;
  generationState.emptyStage = null;
  generationState.emptyUnification = false;
});

afterAll(async () => {
  resetWorkspaceState();
  deleteWorkspace(workspaceId);
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

describe('content post generation mutation safety', () => {
  it('writes the generated post lifecycle, completes the job, and surfaces through admin read paths', async () => {
    const briefId = 'brief-mutation-success';
    seedBrief(briefId);

    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; briefId: string; status: string; jobId: string };
    expect(started).toMatchObject({
      briefId,
      status: 'generating',
    });

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId,
      type: BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION,
      status: 'done',
      result: {
        postId: started.id,
        briefId,
      },
    });

    const postRes = await api(`/api/content-posts/${workspaceId}/${started.id}`);
    expect(postRes.status).toBe(200);
    const post = await postRes.json() as {
      id: string;
      status: string;
      seoTitle?: string;
      seoMetaDescription?: string;
      sections: Array<{ status: string; content: string }>;
    };
    expect(post).toMatchObject({
      id: started.id,
      status: 'draft',
      seoTitle: 'Generated SEO Title',
      seoMetaDescription: 'Generated SEO meta description for the drafted post.',
    });
    expect(post.sections).toHaveLength(1);
    expect(post.sections[0]).toMatchObject({
      status: 'done',
      content: '<p>What local SEO solves body 1 with practical guidance.</p>',
    });

    const listRes = await api(`/api/content-posts/${workspaceId}`);
    expect(listRes.status).toBe(200);
    const posts = await listRes.json() as Array<{ id: string; status: string; briefId: string }>;
    expect(posts).toEqual([
      expect.objectContaining({ id: started.id, status: 'draft', briefId }),
    ]);

    expect(getPost(workspaceId, started.id)?.status).toBe('draft');
    expect(listPosts(workspaceId)).toHaveLength(1);
    expect(countRows('content_posts')).toBe(1);
    expect(activityTitles('post_generated')).toContain('Content generated for "local seo guide"');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.CONTENT_UPDATED,
        payload: expect.objectContaining({
          postId: started.id,
          briefId,
          action: 'post_generation_started',
        }),
      }),
      expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.CONTENT_UPDATED,
        payload: expect.objectContaining({
          postId: started.id,
          briefId,
          action: 'post_generated',
        }),
      }),
      expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.POST_UPDATED,
        payload: expect.objectContaining({
          postId: started.id,
          status: 'generating',
        }),
      }),
      expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.POST_UPDATED,
        payload: expect.objectContaining({
          postId: started.id,
          status: 'draft',
        }),
      }),
    ]));
  });

  it.each(['introduction', 'section', 'conclusion'] as const)(
    'persists useful partial output as needs_attention when the %s stage fails without success semantics',
    async (stage) => {
      const briefId = `brief-partial-${stage}`;
      seedBrief(briefId);
      generationState.failStage = stage;

      const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
      expect(startRes.status).toBe(200);
      const started = await startRes.json() as { id: string; jobId: string };

      const job = await waitForJob(started.jobId);
      expect(job.status).toBe('error');
      expect(job.result).toMatchObject({ postId: started.id, status: 'needs_attention' });

      const post = getPost(workspaceId, started.id);
      expect(post?.status).toBe('needs_attention');
      expect(post?.generationDiagnostics).toEqual([
        expect.objectContaining({ stage, code: 'provider_error' }),
      ]);
      expect(post?.generationDiagnostics?.[0].message).not.toContain('<');
      expect(activityTitles('post_generated')).toEqual([]);
      expect(broadcastState.calls).toContainEqual(expect.objectContaining({
        event: WS_EVENTS.POST_UPDATED,
        payload: expect.objectContaining({ postId: started.id, status: 'needs_attention' }),
      }));
    },
  );

  it.each(['introduction', 'section', 'conclusion'] as const)(
    'classifies markup-only %s output as invalid_output rather than a draft',
    async (stage) => {
      const briefId = `brief-empty-${stage}`;
      seedBrief(briefId);
      generationState.emptyStage = stage;

      const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
      const started = await startRes.json() as { id: string; jobId: string };
      const job = await waitForJob(started.jobId);
      const post = getPost(workspaceId, started.id);

      expect(job).toMatchObject({ status: 'error', result: { status: 'needs_attention' } });
      expect(post?.status).toBe('needs_attention');
      expect(post?.generationDiagnostics).toContainEqual(expect.objectContaining({
        stage,
        code: 'invalid_output',
        message: 'The AI provider returned no usable visible content for this stage.',
      }));
      expect(activityTitles('post_generated')).toEqual([]);
    },
  );

  it('retains every valid pre-unification stage when the unifier returns markup-only replacements', async () => {
    const briefId = 'brief-empty-unifier';
    seedBrief(briefId);
    generationState.emptyUnification = true;

    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);
    const post = getPost(workspaceId, started.id);

    expect(job.status).toBe('done');
    expect(post).toMatchObject({
      status: 'draft',
      introduction: '<p>Draft introduction for the generated post.</p>',
      conclusion: '<p>Draft conclusion with a clear next step.</p>',
      unificationStatus: 'failed',
    });
    expect(post?.sections[0].content).toContain('practical guidance');
  });

  it('persists an unusable initial generation as error without success semantics', async () => {
    const briefId = 'brief-unusable';
    seedBrief(briefId);
    generationState.failStage = 'all';

    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);
    const post = getPost(workspaceId, started.id);

    expect(job).toMatchObject({ status: 'error', result: { postId: started.id, status: 'error' } });
    expect(post?.status).toBe('error');
    expect(post?.generationDiagnostics).toHaveLength(3);
    expect(activityTitles('post_generated')).toEqual([]);
  });

  it('preserves a prior valid artifact when full regeneration fails', async () => {
    const briefId = 'brief-regeneration-preserve';
    seedBrief(briefId);
    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const before = getPost(workspaceId, started.id)!;
    const brief = getBrief(workspaceId, briefId)!;

    generationState.failStage = 'section';
    await expect(generatePost(workspaceId, brief, started.id)).rejects.toThrow('The AI provider could not complete this stage.');

    expect(getPost(workspaceId, started.id)).toEqual(before);

    markPostGenerationFailed(workspaceId, brief, started.id, new Error('job wrapper failure'));
    expect(getPost(workspaceId, started.id)).toEqual(before);

    markPostGenerationCancelled(workspaceId, brief, started.id);
    expect(getPost(workspaceId, started.id)).toEqual(before);
    expect(activityTitles('content_updated')).toEqual(expect.arrayContaining([
      'Content regeneration failed for "local seo guide"',
      'Content regeneration cancelled for "local seo guide"',
    ]));

    generationState.failStage = null;
    const abortController = new AbortController();
    await expect(generatePost(workspaceId, brief, started.id, {
      signal: abortController.signal,
      onProgress: ({ message }) => {
        if (message === 'Generating SEO metadata...') abortController.abort();
      },
    })).rejects.toThrow('Generation cancelled by user');
    expect(getPost(workspaceId, started.id)).toEqual(before);
  });

  it('preserves the exact prior post and emits no success side effects when section regeneration fails', async () => {
    const briefId = 'brief-section-regeneration-failure';
    seedBrief(briefId);
    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const before = getPost(workspaceId, started.id)!;
    const versionsBefore = listPostVersions(workspaceId, started.id);
    const activitiesBefore = activityTitles('content_updated');
    broadcastState.calls = [];
    generationState.failStage = 'section';

    const response = await postJson(`/api/content-posts/${workspaceId}/${started.id}/regenerate-section`, {
      sectionIndex: 0,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The AI provider could not complete this stage.',
      diagnostic: expect.objectContaining({ stage: 'section', code: 'provider_error' }),
    });
    expect(getPost(workspaceId, started.id)).toEqual(before);
    expect(listPostVersions(workspaceId, started.id)).toEqual(versionsBefore);
    expect(activityTitles('content_updated')).toEqual(activitiesBefore);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('moves needs_attention to draft only after a successful section repair restores exact completeness', async () => {
    const briefId = 'brief-section-repair-success';
    seedBrief(briefId);
    generationState.emptyStage = 'section';
    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    expect(getPost(workspaceId, started.id)?.status).toBe('needs_attention');
    generationState.emptyStage = null;
    broadcastState.calls = [];

    const response = await postJson(`/api/content-posts/${workspaceId}/${started.id}/regenerate-section`, {
      sectionIndex: 0,
    });
    expect(response.status).toBe(200);
    const repaired = await response.json() as GeneratedPost;
    expect(repaired.status).toBe('draft');
    expect(repaired.generationDiagnostics).toBeUndefined();
    expect(repaired.sections[0]).toMatchObject({ status: 'done' });
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.POST_UPDATED,
      payload: expect.objectContaining({ postId: started.id }),
    }));
  });

  it('persists a sanitized typed diagnostic for cancelled initial generation', async () => {
    seedBrief('brief-cancel-diagnostics');
    const brief = getBrief(workspaceId, 'brief-cancel-diagnostics')!;
    const now = new Date().toISOString();
    const post: GeneratedPost = {
      id: 'post-cancel-diagnostics',
      workspaceId,
      briefId: 'brief-cancel-diagnostics',
      targetKeyword: 'cancelled generation',
      title: 'Cancelled generation',
      metaDescription: 'meta',
      introduction: '',
      sections: [{ index: 0, heading: 'Body', content: '', wordCount: 0, targetWordCount: 100, keywords: [], status: 'generating' }],
      conclusion: '',
      totalWordCount: 0,
      targetWordCount: 1000,
      status: 'generating',
      createdAt: now,
      updatedAt: now,
    };
    savePost(workspaceId, post);

    markPostGenerationCancelled(workspaceId, brief, post.id);
    const cancelled = getPost(workspaceId, post.id);
    expect(cancelled?.generationDiagnostics).toContainEqual(expect.objectContaining({
      stage: 'generation',
      code: 'cancelled',
      message: 'Generation was cancelled before this stage completed.',
    }));
  });

  it('marks the post and job as failed when generation crashes after the skeleton write', async () => {
    const briefId = 'brief-mutation-failure';
    seedBrief(briefId);
    generationState.failVoiceContext = true;

    const startRes = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId });
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };

    const job = await waitForJob(started.jobId);
    expect(job).toMatchObject({
      workspaceId,
      type: BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION,
      status: 'error',
      result: {
        postId: started.id,
        briefId,
        status: 'error',
      },
    });
    expect(job.error).toBe('Voice context unavailable');

    const failedPost = getPost(workspaceId, started.id);
    expect(failedPost).toMatchObject({
      id: started.id,
      status: 'error',
      unificationStatus: 'failed',
      unificationNote: 'Voice context unavailable',
      generationDiagnostics: [expect.objectContaining({
        stage: 'generation',
        code: 'provider_error',
        message: 'The AI provider could not complete this stage.',
      })],
    });
    expect(failedPost?.sections).toHaveLength(1);
    expect(failedPost?.sections[0]).toMatchObject({
      status: 'error',
      error: 'Voice context unavailable',
    });
    expect(activityTitles('content_updated')).toContain('Content generation failed for "local seo guide"');
    expect(broadcastState.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.CONTENT_UPDATED,
        payload: expect.objectContaining({
          postId: started.id,
          briefId,
          action: 'post_generation_failed',
          status: 'error',
        }),
      }),
      expect.objectContaining({
        workspaceId,
        event: WS_EVENTS.POST_UPDATED,
        payload: expect.objectContaining({
          postId: started.id,
          status: 'error',
        }),
      }),
    ]));
  });

  it('rejects missing briefs without creating jobs, posts, activity, or broadcasts', async () => {
    const jobsBefore = listJobs(workspaceId).length;
    const res = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId: 'brief-missing' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Brief not found' });

    expect(listJobs(workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('content_posts')).toBe(0);
    expect(countRows('activity_log')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects duplicate active generation starts without writing another post or emitting broadcasts', async () => {
    seedBrief('brief-duplicate');
    const activeJob = createJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, {
      message: 'Generating post...',
      workspaceId,
      total: 5,
    });

    const jobsBefore = listJobs(workspaceId).length;
    const res = await postJson(`/api/content-posts/${workspaceId}/generate`, { briefId: 'brief-duplicate' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Content post generation is already running for this workspace',
      jobId: activeJob.id,
    });

    expect(listJobs(workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('content_posts')).toBe(0);
    expect(countRows('activity_log')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
