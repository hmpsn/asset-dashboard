import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
  throwEvents: new Set<string>(),
}));

const generationState = vi.hoisted(() => ({
  failVoiceContext: false,
  failStage: null as 'introduction' | 'section' | 'conclusion' | 'all' | null,
  emptyStage: null as 'introduction' | 'section' | 'conclusion' | null,
  unificationResult: 'none' as 'none' | 'empty' | 'mixed-invalid' | 'wrong-size',
  executionCount: 0,
  onStage: null as null | ((stage: 'context' | 'introduction' | 'section' | 'conclusion' | 'unification' | 'seo') => void | Promise<void>),
}));

const jobTerminalFailureState = vi.hoisted(() => ({
  failNextDone: null as 'before_commit' | 'after_commit' | null,
  failNextErrorBeforeCommit: false,
}));

vi.mock('../../server/jobs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/jobs.js')>();
  return {
    ...actual,
    updateJob: vi.fn((
      id: string,
      update: Parameters<typeof actual.updateJob>[1],
    ) => {
      if (update.status === 'error' && jobTerminalFailureState.failNextErrorBeforeCommit) {
        jobTerminalFailureState.failNextErrorBeforeCommit = false;
        throw new Error('injected post completion fallback persistence failure');
      }
      if (update.status !== 'done' || jobTerminalFailureState.failNextDone === null) {
        return actual.updateJob(id, update);
      }
      const failureMode = jobTerminalFailureState.failNextDone;
      jobTerminalFailureState.failNextDone = null;
      if (failureMode === 'before_commit') {
        throw new Error('injected post completion persistence failure');
      }
      actual.updateJob(id, update);
      throw new Error('injected post completion observer failure');
    }),
  };
});

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
    if (broadcastState.throwEvents.has(event)) throw new Error(`Injected ${event} broadcast failure`);
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
  const emitExecution = (
    operation: string,
    options?: { executionChainId?: string; onExecution?: (value: unknown) => void },
  ) => {
    generationState.executionCount += 1;
    options?.onExecution?.({
      execution: {
        runId: `${operation}-${generationState.executionCount}`,
        executionChainId: options.executionChainId,
        operation,
        provider: 'openai',
        model: 'test-model',
        attempts: 1,
        cacheOutcome: 'miss',
        startedAt: '2026-07-14T00:00:00.000Z',
        completedAt: '2026-07-14T00:00:01.000Z',
        durationMs: 1000,
      },
      inputFingerprint: 'a'.repeat(64),
    });
  };

  return {
    ...original,
    buildVoiceContext: vi.fn(async () => {
      generationState.onStage?.('context');
      if (generationState.failVoiceContext) {
        throw new Error('Voice context unavailable');
      }
      return 'calibrated-voice';
    }),
    generateIntroduction: vi.fn(async (...args: unknown[]) => {
      emitExecution('content-post-introduction', args[4] as Parameters<typeof emitExecution>[1]);
      generationState.onStage?.('introduction');
      if (generationState.failStage === 'introduction' || generationState.failStage === 'all') throw new Error('<b>intro provider failed</b>');
      if (generationState.emptyStage === 'introduction') return '<p> </p>';
      return '<p>Draft introduction for the generated post.</p>';
    }),
    generateSection: vi.fn(async (_brief, section: { heading: string }, index: number, ...args: unknown[]) => {
      emitExecution('content-post-section', args[4] as Parameters<typeof emitExecution>[1]);
      await generationState.onStage?.('section');
      if (generationState.failStage === 'section' || generationState.failStage === 'all') throw new Error('<b>section provider failed</b>');
      if (generationState.emptyStage === 'section') return '<div><span></span></div>';
      return `<p>${section.heading} body ${index + 1} with practical guidance.</p>`;
    }),
    generateConclusion: vi.fn(async (...args: unknown[]) => {
      emitExecution('content-post-conclusion', args[4] as Parameters<typeof emitExecution>[1]);
      generationState.onStage?.('conclusion');
      if (generationState.failStage === 'conclusion' || generationState.failStage === 'all') throw new Error('<b>conclusion provider failed</b>');
      if (generationState.emptyStage === 'conclusion') return '<p>&nbsp;</p>';
      return '<p>Draft conclusion with a clear next step.</p>';
    }),
    unifyPost: vi.fn(async (...args: unknown[]) => {
      emitExecution('content-post-unify', args[4] as Parameters<typeof emitExecution>[1]);
      generationState.onStage?.('unification');
      if (generationState.unificationResult === 'empty') {
        return { introduction: '<p></p>', sections: ['<div>&nbsp;</div>'], conclusion: '<span></span>' };
      }
      if (generationState.unificationResult === 'mixed-invalid') {
        return {
          introduction: '<p>Rewritten introduction that must not persist.</p>',
          sections: ['<div>&nbsp;</div>'],
          conclusion: '<p>Rewritten conclusion that must not persist.</p>',
        };
      }
      if (generationState.unificationResult === 'wrong-size') {
        return {
          introduction: '<p>Rewritten introduction that must not persist.</p>',
          sections: ['<p>First rewrite</p>', '<p>Unexpected extra rewrite</p>'],
          conclusion: '<p>Rewritten conclusion that must not persist.</p>',
          invalidReason: 'section_census_mismatch' as const,
        };
      }
      return null;
    }),
    generateSeoMeta: vi.fn(async (...args: unknown[]) => {
      emitExecution('content-post-seo-meta', args[3] as Parameters<typeof emitExecution>[1]);
      generationState.onStage?.('seo');
      return {
        seoTitle: 'Generated SEO Title',
        seoMetaDescription: 'Generated SEO meta description for the drafted post.',
      };
    }),
    countHtmlWords: vi.fn(countWords),
  };
});

import db from '../../server/db/index.js';
import { clearCompletedJobs, getJobResourceClaims, listJobs, updateJob } from '../../server/jobs.js';
import { getPost, listPostVersions, listPosts, savePost, updatePostField } from '../../server/content-posts-db.js';
import {
  generatePost,
  createContentPostGenerationJob,
  markPostGenerationCancelled,
  markPostGenerationFailed,
  regenerateSection,
} from '../../server/content-posts.js';
import { getBrief, updateBriefAtRevision } from '../../server/content-brief.js';
import { BACKGROUND_JOB_TYPES, JOB_RESOURCE_TYPES } from '../../shared/types/background-jobs.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { GeneratedPost } from '../../shared/types/content.js';
import type {
  GenerationExecutionProvenance,
  GenerationProvenance,
} from '../../shared/types/ai-execution.js';

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

async function startGenerationRequest(briefId: string): Promise<Response> {
  return postJson(`/api/content-posts/${workspaceId}/generate`, {
    briefId,
    expectedBriefRevision: getBrief(workspaceId, briefId)?.generationRevision ?? 0,
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

async function waitForReleasedJobClaims(jobId: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const claims = getJobResourceClaims(jobId);
    if (claims.length > 0 && claims.every(claim => !claim.active)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for job ${jobId} resource claims to release`);
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
  generationState.unificationResult = 'none';
  generationState.executionCount = 0;
  generationState.onStage = null;
  jobTerminalFailureState.failNextDone = null;
  jobTerminalFailureState.failNextErrorBeforeCommit = false;
  broadcastState.throwEvents.clear();
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

    const startRes = await startGenerationRequest(briefId);
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
    expect(getPost(workspaceId, started.id)?.generationProvenance?.executions?.map(execution => execution.operation)).toEqual([
      'content-post-introduction',
      'content-post-section',
      'content-post-conclusion',
      'content-post-seo-meta',
    ]);
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

  it('keeps a successful generation and job terminal when content broadcasts fail', async () => {
    const briefId = 'brief-generation-post-commit-failure';
    seedBrief(briefId);
    broadcastState.throwEvents.add(WS_EVENTS.CONTENT_UPDATED);

    const startRes = await startGenerationRequest(briefId);
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      status: 'done',
      result: { postId: started.id, briefId },
    });
    expect(getPost(workspaceId, started.id)?.status).toBe('draft');
    expect(activityTitles('post_generated')).toContain('Content generated for "local seo guide"');
    expect(broadcastState.calls.filter(call => call.event === WS_EVENTS.POST_UPDATED)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ status: 'generating' }) }),
        expect.objectContaining({ payload: expect.objectContaining({ status: 'draft' }) }),
      ]),
    );
  });

  it('preserves a committed draft and reports completion tracking failure without generation-failure semantics', async () => {
    const briefId = 'brief-generation-terminal-persistence-failure';
    seedBrief(briefId);
    jobTerminalFailureState.failNextDone = 'before_commit';

    const startRes = await startGenerationRequest(briefId);
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      status: 'error',
      error: 'injected post completion persistence failure',
      message: 'Post committed, but completion tracking failed',
      result: {
        postId: started.id,
        briefId,
        status: 'draft',
        code: 'completion_tracking_failed',
        artifactCommitted: true,
        generationRevision: expect.any(Number),
      },
    });
    expect(getPost(workspaceId, started.id)).toMatchObject({
      id: started.id,
      status: 'draft',
      generationDiagnostics: undefined,
      introduction: '<p>Draft introduction for the generated post.</p>',
      conclusion: '<p>Draft conclusion with a clear next step.</p>',
    });
    expect(activityTitles('post_generated')).toEqual([]);
    expect(activityTitles('content_updated')).toEqual([]);
    expect(broadcastState.calls.some(call => (
      call.payload.action === 'post_generated'
      || call.payload.action === 'post_generation_failed'
    ))).toBe(false);
  });

  it('releases both generation claims after the worker drains when success and fallback terminal writes both fail', async () => {
    const briefId = 'brief-generation-double-terminal-persistence-failure';
    seedBrief(briefId);
    jobTerminalFailureState.failNextDone = 'before_commit';
    jobTerminalFailureState.failNextErrorBeforeCommit = true;

    const startRes = await startGenerationRequest(briefId);
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForReleasedJobClaims(started.jobId);

    const drainedJob = listJobs(workspaceId).find(job => job.id === started.jobId);
    expect(drainedJob?.status).toBe('running');
    expect(drainedJob?.result).toBeUndefined();
    expect(getPost(workspaceId, started.id)).toMatchObject({
      id: started.id,
      status: 'draft',
      introduction: '<p>Draft introduction for the generated post.</p>',
      conclusion: '<p>Draft conclusion with a clear next step.</p>',
    });
    expect(getJobResourceClaims(started.jobId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceType: JOB_RESOURCE_TYPES.CONTENT_POST_FOR_BRIEF,
        resourceId: briefId,
        active: false,
      }),
      expect.objectContaining({
        resourceType: JOB_RESOURCE_TYPES.CONTENT_POST,
        resourceId: started.id,
        active: false,
      }),
    ]));
    expect(activityTitles('post_generated')).toEqual([]);
    expect(activityTitles('content_updated')).toEqual([]);
    expect(broadcastState.calls.some(call => (
      call.payload.action === 'post_generated'
      || call.payload.action === 'post_generation_failed'
    ))).toBe(false);

    const retry = createContentPostGenerationJob(
      workspaceId,
      getBrief(workspaceId, briefId)!,
      undefined,
      getBrief(workspaceId, briefId)!.generationRevision,
    );
    expect(retry.jobId).not.toBe(started.jobId);
    updateJob(retry.jobId, { status: 'error', error: 'test cleanup' });
  });

  it('verifies the durable done terminal and continues success effects when only its observer throws', async () => {
    const briefId = 'brief-generation-terminal-observer-failure';
    seedBrief(briefId);
    jobTerminalFailureState.failNextDone = 'after_commit';

    const startRes = await startGenerationRequest(briefId);
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      status: 'done',
      result: { postId: started.id, briefId },
    });
    expect(getPost(workspaceId, started.id)?.status).toBe('draft');
    expect(activityTitles('post_generated')).toContain('Content generated for "local seo guide"');
    expect(activityTitles('content_updated')).toEqual([]);
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.CONTENT_UPDATED,
      payload: expect.objectContaining({
        postId: started.id,
        briefId,
        action: 'post_generated',
      }),
    }));
  });

  it.each(['context', 'introduction', 'section', 'conclusion', 'unification', 'seo'] as const)(
    'preserves an operator edit injected during %s and records a conflict without failure/success semantics',
    async (stage) => {
      const briefId = `brief-conflict-${stage}`;
      seedBrief(briefId);
      generationState.onStage = (observedStage) => {
        if (observedStage !== stage) return;
        generationState.onStage = null;
        const current = listPosts(workspaceId)[0];
        if (!current) throw new Error('Expected generation skeleton');
        updatePostField(
          workspaceId,
          current.id,
          { title: `Operator winner at ${stage}` },
          current.generationRevision,
        );
      };

      const startRes = await startGenerationRequest(briefId);
      expect(startRes.status).toBe(200);
      const started = await startRes.json() as { id: string; jobId: string };
      const job = await waitForJob(started.jobId);

      expect(job).toMatchObject({
        status: 'error',
        result: {
          postId: started.id,
          status: 'conflict',
          code: 'generation_revision_conflict',
        },
      });
      expect(getPost(workspaceId, started.id)).toMatchObject({
        title: `Operator winner at ${stage}`,
        status: 'generating',
      });
      expect(activityTitles('post_generated')).toEqual([]);
      expect(activityTitles('content_updated')).toEqual([]);
      expect(broadcastState.calls.some(call => (
        call.payload.action === 'post_generated'
        || call.payload.action === 'post_generation_failed'
      ))).toBe(false);
    },
  );

  it.each(['introduction', 'section', 'conclusion', 'unification', 'seo'] as const)(
    'rejects the stale post when a same-shape brief edit lands during the %s paid stage',
    async (stage) => {
      const briefId = `brief-authority-${stage}`;
      seedBrief(briefId);
      const sourceBrief = getBrief(workspaceId, briefId)!;
      generationState.onStage = (observedStage) => {
        if (observedStage !== stage) return;
        generationState.onStage = null;
        updateBriefAtRevision(
          workspaceId,
          briefId,
          sourceBrief.generationRevision,
          { suggestedTitle: `New brief authority at ${stage}` },
        );
      };

      const startRes = await startGenerationRequest(briefId);
      expect(startRes.status).toBe(200);
      const started = await startRes.json() as { id: string; jobId: string };
      const job = await waitForJob(started.jobId);

      expect(job).toMatchObject({
        status: 'error',
        result: {
          postId: started.id,
          briefId,
          status: 'conflict',
          code: 'generation_revision_conflict',
          expectedRevision: sourceBrief.generationRevision,
        },
      });
      expect(getBrief(workspaceId, briefId)).toMatchObject({
        suggestedTitle: `New brief authority at ${stage}`,
        outline: sourceBrief.outline,
        generationRevision: sourceBrief.generationRevision + 1,
      });
      expect(getPost(workspaceId, started.id)?.status).toBe('generating');
      expect(activityTitles('post_generated')).toEqual([]);
      expect(activityTitles('content_updated')).toEqual([]);
      expect(broadcastState.calls.some(call => (
        call.payload.action === 'post_generated'
        || call.payload.action === 'post_generation_failed'
      ))).toBe(false);
    },
  );

  it.each(['introduction', 'section', 'conclusion'] as const)(
    'persists useful partial output as needs_attention when the %s stage fails without success semantics',
    async (stage) => {
      const briefId = `brief-partial-${stage}`;
      seedBrief(briefId);
      generationState.failStage = stage;

      const startRes = await startGenerationRequest(briefId);
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

      const startRes = await startGenerationRequest(briefId);
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
    generationState.unificationResult = 'empty';

    const startRes = await startGenerationRequest(briefId);
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

  it.each(['mixed-invalid', 'wrong-size'] as const)(
    'applies unification atomically when the candidate is %s',
    async (unificationResult) => {
      const briefId = `brief-unifier-${unificationResult}`;
      seedBrief(briefId);
      generationState.unificationResult = unificationResult;

      const startRes = await startGenerationRequest(briefId);
      const started = await startRes.json() as { id: string; jobId: string };
      const job = await waitForJob(started.jobId);
      const post = getPost(workspaceId, started.id);

      expect(job.status).toBe('done');
      expect(post).toMatchObject({
        status: 'draft',
        introduction: '<p>Draft introduction for the generated post.</p>',
        conclusion: '<p>Draft conclusion with a clear next step.</p>',
        unificationStatus: 'failed',
        unificationNote: 'Unification returned unusable replacement content; the valid pre-unification draft was retained.',
      });
      expect(post?.sections).toHaveLength(1);
      expect(post?.sections[0].content).toContain('practical guidance');
      expect(post?.introduction).not.toContain('Rewritten');
      expect(post?.conclusion).not.toContain('Rewritten');
    },
  );

  it('persists an unusable initial generation as error without success semantics', async () => {
    const briefId = 'brief-unusable';
    seedBrief(briefId);
    generationState.failStage = 'all';

    const startRes = await startGenerationRequest(briefId);
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
    const startRes = await startGenerationRequest(briefId);
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
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const before = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    const versionsBefore = listPostVersions(workspaceId, started.id);
    const activitiesBefore = activityTitles('content_updated');
    broadcastState.calls = [];
    generationState.failStage = 'section';

    const response = await postJson(`/api/content-posts/${workspaceId}/${started.id}/regenerate-section`, {
      sectionIndex: 0,
      expectedRevision: before.generationRevision,
      expectedBriefRevision: sourceBrief.generationRevision,
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

  it('rejects a stale source brief before accepting a repair job or calling the section provider', async () => {
    const briefId = 'brief-section-repair-stale-acceptance';
    seedBrief(briefId);
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const before = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    const executionsBefore = generationState.executionCount;
    updateBriefAtRevision(
      workspaceId,
      briefId,
      sourceBrief.generationRevision,
      { suggestedTitle: 'New authority before repair acceptance' },
    );
    broadcastState.calls = [];

    const response = await postJson(
      `/api/content-posts/${workspaceId}/${started.id}/regenerate-section`,
      {
        sectionIndex: 0,
        expectedRevision: before.generationRevision,
        expectedBriefRevision: sourceBrief.generationRevision,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'generation_revision_conflict' });
    expect(generationState.executionCount).toBe(executionsBefore);
    expect(listJobs(workspaceId).filter(job => (
      job.type === BACKGROUND_JOB_TYPES.CONTENT_POST_FIX
    ))).toHaveLength(0);
    expect(getPost(workspaceId, started.id)).toEqual(before);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rechecks source-brief authority after context assembly and before the paid section call', async () => {
    const briefId = 'brief-section-repair-pre-provider-race';
    seedBrief(briefId);
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const before = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    const executionsBefore = generationState.executionCount;
    broadcastState.calls = [];
    generationState.onStage = (stage) => {
      if (stage !== 'context') return;
      generationState.onStage = null;
      updateBriefAtRevision(
        workspaceId,
        briefId,
        sourceBrief.generationRevision,
        { suggestedTitle: 'New authority during repair context assembly' },
      );
    };

    const response = await postJson(
      `/api/content-posts/${workspaceId}/${started.id}/regenerate-section`,
      {
        sectionIndex: 0,
        expectedRevision: before.generationRevision,
        expectedBriefRevision: sourceBrief.generationRevision,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'generation_revision_conflict' });
    expect(generationState.executionCount).toBe(executionsBefore);
    expect(getPost(workspaceId, started.id)).toEqual(before);
    expect(listJobs(workspaceId).filter(job => (
      job.type === BACKGROUND_JOB_TYPES.CONTENT_POST_FIX
    ))).toEqual([
      expect.objectContaining({ status: 'error' }),
    ]);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects a section repair when its source brief changes while the provider is blocked', async () => {
    const briefId = 'brief-section-repair-brief-race';
    seedBrief(briefId);
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const before = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    const versionsBefore = listPostVersions(workspaceId, started.id);
    const activitiesBefore = activityTitles('content_updated');
    broadcastState.calls = [];

    let signalProviderEntered!: () => void;
    const providerEntered = new Promise<void>(resolve => { signalProviderEntered = resolve; });
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>(resolve => { releaseProvider = resolve; });
    generationState.onStage = async (stage) => {
      if (stage !== 'section') return;
      generationState.onStage = null;
      signalProviderEntered();
      await providerRelease;
    };

    const responsePromise = postJson(
      `/api/content-posts/${workspaceId}/${started.id}/regenerate-section`,
      {
        sectionIndex: 0,
        expectedRevision: before.generationRevision,
        expectedBriefRevision: sourceBrief.generationRevision,
      },
    );
    await providerEntered;
    const revisedBrief = updateBriefAtRevision(
      workspaceId,
      briefId,
      sourceBrief.generationRevision,
      { suggestedTitle: 'New operator-owned brief authority' },
    );
    releaseProvider();
    const response = await responsePromise;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'generation_revision_conflict',
    });
    expect(revisedBrief).toMatchObject({
      suggestedTitle: 'New operator-owned brief authority',
      generationRevision: sourceBrief.generationRevision + 1,
    });
    expect(getPost(workspaceId, started.id)).toEqual(before);
    expect(listPostVersions(workspaceId, started.id)).toEqual(versionsBefore);
    expect(activityTitles('content_updated')).toEqual(activitiesBefore);
    expect(broadcastState.calls).toHaveLength(0);
    const repairJobs = listJobs(workspaceId).filter(job => (
      job.type === BACKGROUND_JOB_TYPES.CONTENT_POST_FIX
    ));
    expect(repairJobs).toEqual([
      expect.objectContaining({
        status: 'error',
        result: {
          postId: started.id,
          sectionIndex: 0,
          status: 'error',
        },
      }),
    ]);
    expect(repairJobs.some(job => job.status === 'done')).toBe(false);
  });

  it('moves needs_attention to draft only after a successful section repair restores exact completeness', async () => {
    const briefId = 'brief-section-repair-success';
    seedBrief(briefId);
    generationState.emptyStage = 'section';
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const beforeRepair = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    expect(beforeRepair.status).toBe('needs_attention');
    generationState.emptyStage = null;
    broadcastState.calls = [];

    const response = await postJson(`/api/content-posts/${workspaceId}/${started.id}/regenerate-section`, {
      sectionIndex: 0,
      expectedRevision: beforeRepair.generationRevision,
      expectedBriefRevision: sourceBrief.generationRevision,
    });
    expect(response.status).toBe(200);
    const repaired = await response.json() as GeneratedPost;
    const storedRepair = getPost(workspaceId, started.id)!;
    expect(repaired.status).toBe('draft');
    expect(repaired.generationDiagnostics).toBeUndefined();
    expect(repaired.sections[0]).toMatchObject({ status: 'done' });
    expect(storedRepair.generationProvenance?.executions?.slice(0, -1))
      .toEqual(beforeRepair.generationProvenance?.executions);
    const acceptedRepair = storedRepair.generationProvenance?.executions?.at(-1);
    expect(acceptedRepair?.operation).toBe('content-post-section');
    expect(storedRepair.generationProvenance).toMatchObject({
      runId: acceptedRepair?.runId,
      operation: acceptedRepair?.operation,
      provider: acceptedRepair?.provider,
      model: acceptedRepair?.model,
      startedAt: acceptedRepair?.startedAt,
      completedAt: acceptedRepair?.completedAt,
    });
    expect(JSON.stringify(storedRepair.generationProvenance)).not.toContain('Draft introduction');
    expect(JSON.stringify(storedRepair.generationProvenance)).not.toContain('Regenerate this section');
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.POST_UPDATED,
      payload: expect.objectContaining({ postId: started.id }),
    }));
  });

  it('reports a committed section repair as successful when one post-commit broadcast fails', async () => {
    const briefId = 'brief-section-repair-post-commit-failure';
    seedBrief(briefId);
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const beforeRepair = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    broadcastState.calls = [];
    broadcastState.throwEvents.add(WS_EVENTS.CONTENT_UPDATED);

    const response = await postJson(`/api/content-posts/${workspaceId}/${started.id}/regenerate-section`, {
      sectionIndex: 0,
      expectedRevision: beforeRepair.generationRevision,
      expectedBriefRevision: sourceBrief.generationRevision,
    });

    expect(response.status).toBe(200);
    const repaired = await response.json() as GeneratedPost;
    expect(repaired.generationRevision).toBe(beforeRepair.generationRevision + 1);
    expect(getPost(workspaceId, started.id)?.generationRevision).toBe(repaired.generationRevision);
    expect(listJobs(workspaceId).filter(job => (
      job.type === BACKGROUND_JOB_TYPES.CONTENT_POST_FIX
    ))).toEqual([
      expect.objectContaining({ status: 'done' }),
    ]);
    expect(broadcastState.calls.map(call => call.event)).toContain(WS_EVENTS.CONTENT_UPDATED);
    expect(broadcastState.calls.map(call => call.event)).toContain(WS_EVENTS.POST_UPDATED);
  });

  it('preserves a committed section repair when terminal completion tracking fails', async () => {
    const briefId = 'brief-section-repair-terminal-persistence-failure';
    seedBrief(briefId);
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const beforeRepair = getPost(workspaceId, started.id)!;
    const sourceBrief = getBrief(workspaceId, briefId)!;
    const activitiesBefore = activityTitles('content_updated');
    broadcastState.calls = [];
    jobTerminalFailureState.failNextDone = 'before_commit';

    const response = await postJson(`/api/content-posts/${workspaceId}/${started.id}/regenerate-section`, {
      sectionIndex: 0,
      expectedRevision: beforeRepair.generationRevision,
      expectedBriefRevision: sourceBrief.generationRevision,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Section regenerated, but completion tracking failed',
      code: 'completion_tracking_failed',
      artifactCommitted: true,
      postId: started.id,
      sectionIndex: 0,
      generationRevision: beforeRepair.generationRevision + 1,
    });
    expect(getPost(workspaceId, started.id)).toMatchObject({
      generationRevision: beforeRepair.generationRevision + 1,
      sections: [expect.objectContaining({ status: 'done' })],
    });
    expect(listJobs(workspaceId).filter(job => (
      job.type === BACKGROUND_JOB_TYPES.CONTENT_POST_FIX
    ))).toEqual([
      expect.objectContaining({
        status: 'error',
        message: 'Section regenerated, but completion tracking failed',
        result: expect.objectContaining({
          code: 'completion_tracking_failed',
          artifactCommitted: true,
        }),
      }),
    ]);
    expect(activityTitles('content_updated')).toEqual(activitiesBefore);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('bounds prior composite contributors while retaining the accepted section repair on top', async () => {
    const briefId = 'brief-section-repair-bounded-provenance';
    seedBrief(briefId);
    const startRes = await startGenerationRequest(briefId);
    const started = await startRes.json() as { id: string; jobId: string };
    await waitForJob(started.jobId);
    const generated = getPost(workspaceId, started.id)!;
    const executionChainId = 'bounded-section-repair-chain';
    const contributors: GenerationExecutionProvenance[] = Array.from(
      { length: 500 },
      (_, index) => ({
        runId: `prior-run-${index}`,
        executionChainId,
        operation: 'content-post-section',
        provider: 'openai',
        model: 'test-model',
        inputFingerprint: 'a'.repeat(64),
        startedAt: '2026-07-14T00:00:00.000Z',
        completedAt: '2026-07-14T00:00:01.000Z',
      }),
    );
    const priorAccepted = contributors.at(-1)!;
    const saturatedProvenance: GenerationProvenance = {
      ...priorAccepted,
      inputFingerprint: 'b'.repeat(64),
      executions: contributors,
    };
    const saturated = savePost(workspaceId, {
      ...generated,
      generationProvenance: saturatedProvenance,
    });

    const sourceBrief = getBrief(workspaceId, briefId)!;
    const repaired = await regenerateSection(
      workspaceId,
      started.id,
      0,
      sourceBrief,
      saturated.generationRevision,
      sourceBrief.generationRevision,
    );

    const retained = repaired?.generationProvenance?.executions;
    expect(retained).toHaveLength(500);
    expect(retained?.[0].runId).toBe('prior-run-1');
    expect(retained?.at(-2)?.runId).toBe('prior-run-499');
    expect(retained?.at(-1)?.operation).toBe('content-post-section');
    expect(repaired?.generationProvenance?.runId).toBe(retained?.at(-1)?.runId);
    expect(new Set(retained?.map(execution => execution.runId)).size).toBe(500);
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

    const startRes = await startGenerationRequest(briefId);
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

  it('keeps the error artifact truthful but suppresses optional effects when the job error terminal cannot persist', async () => {
    const briefId = 'brief-failure-terminal-persistence-failure';
    seedBrief(briefId);
    generationState.failVoiceContext = true;
    jobTerminalFailureState.failNextErrorBeforeCommit = true;

    const startRes = await startGenerationRequest(briefId);
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      status: 'error',
      error: 'injected post completion fallback persistence failure',
      message: 'Post committed, but completion tracking failed',
      result: {
        postId: started.id,
        briefId,
        status: 'error',
        code: 'completion_tracking_failed',
        artifactCommitted: true,
      },
    });
    expect(getPost(workspaceId, started.id)).toMatchObject({
      status: 'error',
      unificationStatus: 'failed',
      unificationNote: 'Voice context unavailable',
    });
    expect(activityTitles('content_updated')).toEqual([]);
    expect(broadcastState.calls.some(call => (
      call.payload.action === 'post_generation_failed'
      || call.payload.status === 'error'
    ))).toBe(false);
    const claims = getJobResourceClaims(started.jobId);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every(claim => !claim.active)).toBe(true); // every-ok: non-empty claim census asserted above
  });

  it('retains the persisted error terminal when a later optional failure broadcast throws', async () => {
    const briefId = 'brief-failure-post-commit-effect-failure';
    seedBrief(briefId);
    generationState.failVoiceContext = true;
    broadcastState.throwEvents.add(WS_EVENTS.POST_UPDATED);

    const startRes = await startGenerationRequest(briefId);
    expect(startRes.status).toBe(200);
    const started = await startRes.json() as { id: string; jobId: string };
    const job = await waitForJob(started.jobId);

    expect(job).toMatchObject({
      status: 'error',
      error: 'Voice context unavailable',
      result: {
        postId: started.id,
        briefId,
        status: 'error',
      },
    });
    expect(getPost(workspaceId, started.id)?.status).toBe('error');
    expect(activityTitles('content_updated')).toContain('Content generation failed for "local seo guide"');
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.CONTENT_UPDATED,
      payload: expect.objectContaining({
        postId: started.id,
        briefId,
        action: 'post_generation_failed',
      }),
    }));
    expect(broadcastState.calls).toContainEqual(expect.objectContaining({
      event: WS_EVENTS.POST_UPDATED,
      payload: expect.objectContaining({ postId: started.id, status: 'error' }),
    }));
  });

  it('rejects missing briefs without creating jobs, posts, activity, or broadcasts', async () => {
    const jobsBefore = listJobs(workspaceId).length;
    const res = await startGenerationRequest('brief-missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Brief not found' });

    expect(listJobs(workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('content_posts')).toBe(0);
    expect(countRows('activity_log')).toBe(0);
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('rejects duplicate active generation starts without writing another post or emitting broadcasts', async () => {
    seedBrief('brief-duplicate');
    const brief = getBrief(workspaceId, 'brief-duplicate')!;
    const active = createContentPostGenerationJob(
      workspaceId,
      brief,
      undefined,
      brief.generationRevision,
    );

    const jobsBefore = listJobs(workspaceId).length;
    const res = await startGenerationRequest('brief-duplicate');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'A job is already active for this resource',
      code: 'active_job_resource_conflict',
      jobId: active.jobId,
    });

    expect(listJobs(workspaceId)).toHaveLength(jobsBefore);
    expect(countRows('content_posts')).toBe(1);
    expect(countRows('activity_log')).toBe(0);
    expect(broadcastState.calls.filter(call => call.payload.action === 'post_generation_started')).toHaveLength(1);
    updateJob(active.jobId, { status: 'error', error: 'test cleanup' });
  });
});
