/**
 * D2 (audit #11) — Recs ↔ content reconciliation.
 *
 * Covers the three halves of the reconciliation loop:
 *   1. Generation suppression — a content-gap rec is NOT minted when the pipeline already
 *      has an in-flight brief/post for the same target keyword (read via the contentPipeline
 *      intelligence slice, not a direct store read).
 *   2. Publish resolution — publishing a post through the C3 domain service
 *      (`publishPostToWebflow`, exercised via the real manual-publish route) completes the
 *      matching content-gap rec, best-effort: a resolution failure never fails the publish
 *      (FM-2), and a failed publish never resolves the rec.
 *   3. CTA mapping — content-gap recs now carry the brief-purchase product + targetKeyword.
 *
 * Uses the in-process createApp() + port-0 pattern from content-posts-workflow.test.ts —
 * the publish path needs vi.mock + webflow fetch mocks, which cannot reach a
 * createEphemeralTestContext child process.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import {
  setupWebflowMocks,
  mockWebflowSuccess,
  mockWebflowError,
  resetWebflowMocks,
} from '../mocks/webflow.js';

setupWebflowMocks();

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

// FM-2 lever: when set, the publish service's rec-resolution hook throws. The wrapper
// delegates to the real implementation otherwise, so the happy-path test exercises the
// genuine resolver.
const resolveState = vi.hoisted(() => ({ shouldThrow: false, calls: 0 }));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

// Stub background follow-on jobs (llms.txt regen + rec regen) — they fire extra work that
// is irrelevant here and the real rec regen would clobber the seeded rec sets.
vi.mock('../../server/keyword-strategy-follow-ons.js', () => ({
  queueKeywordStrategyPostUpdateFollowOns: vi.fn(),
}));

vi.mock('../../server/domains/recommendations/resolution-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/domains/recommendations/resolution-service.js')>();
  return {
    ...actual,
    resolveContentRecommendationsForPublishedPost: (workspaceId: string, targetKeyword: string | null | undefined) => {
      resolveState.calls += 1;
      if (resolveState.shouldThrow) throw new Error('rec resolution boom (test)');
      return actual.resolveContentRecommendationsForPublishedPost(workspaceId, targetKeyword);
    },
  };
});

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { upsertContentGap, deleteAllContentGaps } from '../../server/content-gaps.js';
import { savePost, getPost } from '../../server/content-posts-db.js';
import {
  generateRecommendations,
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
  RecSource,
} from '../../server/recommendations.js';
import { invalidateIntelligenceCache } from '../../server/workspace-intelligence.js';
import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { GeneratedPost } from '../../shared/types/content.js';
import type { Recommendation } from '../../shared/types/recommendations.js';
import type { ContentGap } from '../../shared/types/workspace.js';

let baseUrl = '';
let server: http.Server | undefined;
const createdWorkspaces: string[] = [];

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
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

function makeWorkspace(name: string): string {
  const ws = createWorkspace(name);
  createdWorkspaces.push(ws.id);
  return ws.id;
}

/** Content-gap minting is gated on `ws.keywordStrategy` — give the workspace a minimal blob. */
function seedMinimalStrategy(workspaceId: string): void {
  db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?').run(
    JSON.stringify({ siteKeywords: [], pageMap: [], opportunities: [], generatedAt: new Date().toISOString() }),
    workspaceId,
  );
}

function makeGap(targetKeyword: string, overrides: Partial<ContentGap> = {}): ContentGap {
  return {
    topic: `Guide to ${targetKeyword}`,
    targetKeyword,
    intent: 'informational',
    priority: 'high',
    rationale: `The site has no page targeting "${targetKeyword}".`,
    suggestedPageType: 'blog',
    volume: 1200,
    difficulty: 25,
    ...overrides,
  };
}

function seedBrief(workspaceId: string, briefId: string, targetKeyword: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_briefs
      (id, workspace_id, target_keyword, secondary_keywords, suggested_title,
       suggested_meta_desc, outline, word_count_target, intent, audience,
       competitor_insights, internal_link_suggestions, created_at)
    VALUES (?, ?, ?, '[]', ?, ?, '[]', ?, ?, ?, '', '[]', ?)
  `).run(
    briefId,
    workspaceId,
    targetKeyword,
    `How to ${targetKeyword}`,
    `All about ${targetKeyword}.`,
    1500,
    'informational',
    'general audience',
    now,
  );
}

function makePost(workspaceId: string, targetKeyword: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  const now = new Date().toISOString();
  const id = `post_d2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    workspaceId,
    briefId: `brief_d2_${id}`,
    targetKeyword,
    title: `Post about ${targetKeyword}`,
    metaDescription: 'D2 reconciliation post.',
    introduction: '<p>Intro.</p>',
    sections: [{
      index: 0,
      heading: 'Section 1',
      content: '<p>Body copy.</p>',
      wordCount: 3,
      targetWordCount: 200,
      keywords: [targetKeyword],
      status: 'done',
    }],
    conclusion: '<p>Conclusion.</p>',
    totalWordCount: 10,
    targetWordCount: 900,
    status: 'approved',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeContentRec(workspaceId: string, targetKeyword: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_d2_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId,
    priority: 'ongoing',
    type: 'content',
    title: `Create content: Guide to ${targetKeyword}`,
    description: `Create a page targeting "${targetKeyword}".`,
    insight: 'Content gap detected.',
    impact: 'high',
    effort: 'high',
    impactScore: 60,
    source: RecSource.strategyContentGap(),
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'New organic traffic',
    actionType: 'content_creation',
    targetKeyword,
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecSet(workspaceId: string, recs: Recommendation[]): void {
  saveRecommendations({
    workspaceId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  });
}

function configurePublishTarget(workspaceId: string): void {
  updateWorkspace(workspaceId, {
    webflowSiteId: `site_d2_${workspaceId}`,
    webflowToken: 'wf-token-d2-reconciliation',
    publishTarget: {
      collectionId: 'collection_d2_recs',
      collectionName: 'Blog Posts',
      fieldMap: {
        title: 'name',
        slug: 'slug',
        body: 'post-body',
        metaTitle: 'seo-title',
        metaDescription: 'seo-description',
        publishDate: 'published-on',
      },
    },
  });
}

async function publishPost(workspaceId: string, postId: string): Promise<Response> {
  const post = getPost(workspaceId, postId);
  return fetch(`${baseUrl}/api/content-posts/${workspaceId}/${postId}/publish-to-webflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: post?.generationRevision ?? 0 }),
  });
}

beforeAll(async () => {
  await startTestServer();
});

beforeEach(() => {
  setupWebflowMocks();
  broadcastState.calls = [];
  resolveState.shouldThrow = false;
  resolveState.calls = 0;
});

afterAll(async () => {
  resetWebflowMocks();
  for (const wsId of createdWorkspaces) {
    db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(wsId);
    db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(wsId);
    deleteAllContentGaps(wsId);
    deleteWorkspace(wsId);
  }
  await stopTestServer();
});

// ─── 1. Generation suppression ───────────────────────────────────────────────

describe('generateRecommendations — in-flight pipeline suppression', () => {
  it('skips content-gap recs whose target keyword has an in-flight brief, mints the rest with the brief product', async () => {
    const wsId = makeWorkspace('D2 Suppression Workspace');
    seedMinimalStrategy(wsId);
    upsertContentGap(wsId, makeGap('emergency plumbing repair'));
    upsertContentGap(wsId, makeGap('water heater installation'));
    // In-flight brief for the first gap (keywordComparisonKey-normalised match).
    seedBrief(wsId, `brief_d2_suppress_${Date.now()}`, 'Emergency Plumbing Repair');
    invalidateIntelligenceCache(wsId);

    const set = await generateRecommendations(wsId);
    const contentRecs = set.recommendations.filter(r => r.type === 'content' && r.status !== 'completed');

    // Suppressed: the pipeline is already producing this content.
    expect(contentRecs.find(r => r.targetKeyword === 'emergency plumbing repair')).toBeUndefined();

    // Not suppressed: minted with targetKeyword + the existing brief-purchase product.
    const minted = contentRecs.find(r => r.targetKeyword === 'water heater installation');
    expect(minted).toBeDefined();
    expect(minted?.productType).toBe('brief_blog');
    expect(minted?.productPrice).toBe(125);
    expect(minted?.actionType).toBe('content_creation');
  });

  it('suppresses content-gap recs matching an in-flight (unpublished) post', async () => {
    const wsId = makeWorkspace('D2 Post Suppression Workspace');
    seedMinimalStrategy(wsId);
    upsertContentGap(wsId, makeGap('drain cleaning services'));
    const post = makePost(wsId, 'drain cleaning services', { status: 'draft' });
    savePost(wsId, post);
    invalidateIntelligenceCache(wsId);

    const set = await generateRecommendations(wsId);
    // The single seeded gap is the only content-gap candidate — with the in-flight post
    // it must not mint at all (length assertion so this cannot pass vacuously).
    const active = set.recommendations.filter(r => r.type === 'content' && r.status !== 'completed');
    expect(active).toHaveLength(0);
  });

  it('a prior pending rec suppressed by an in-flight brief auto-resolves with truthful "in progress" copy, not "no longer detected"', async () => {
    const wsId = makeWorkspace('D2 Truthful Copy Workspace');
    seedMinimalStrategy(wsId);
    // The gap is STILL detected — only the in-flight brief suppresses re-minting.
    upsertContentGap(wsId, makeGap('sump pump maintenance'));
    seedRecSet(wsId, [makeContentRec(wsId, 'sump pump maintenance')]);
    seedBrief(wsId, `brief_d2_truthful_${Date.now()}`, 'Sump Pump Maintenance');
    invalidateIntelligenceCache(wsId);

    const set = await generateRecommendations(wsId);
    const resolved = set.recommendations.find(
      r => r.targetKeyword === 'sump pump maintenance' && r.status === 'completed',
    );
    expect(resolved).toBeDefined();
    // Truthful copy: the gap was suppressed because content is in production — it was
    // NOT "no longer detected" (the gap row still exists).
    expect(resolved?.insight).toContain('already in progress');
    expect(resolved?.insight).not.toContain('no longer detected');
  });
});

// ─── 2. Publish-time resolution (C3 domain service hook) ────────────────────

describe('publishPostToWebflow — content-gap rec resolution', () => {
  it('publishing a post resolves the matching pending content rec and broadcasts', async () => {
    const wsId = makeWorkspace('D2 Publish Resolution Workspace');
    configurePublishTarget(wsId);
    mockWebflowSuccess(/\/collections\/collection_d2_recs\/items$/, { id: 'wf_d2_item' });
    mockWebflowSuccess(/\/collections\/collection_d2_recs\/items\/publish$/, {});

    const matching = makeContentRec(wsId, 'sewer line inspection');
    const unrelated = makeContentRec(wsId, 'totally different keyword');
    seedRecSet(wsId, [matching, unrelated]);

    const post = makePost(wsId, 'Sewer Line Inspection');
    savePost(wsId, post);

    const res = await publishPost(wsId, post.id);
    expect(res.status).toBe(200);

    const set = loadRecommendations(wsId);
    expect(set?.recommendations.find(r => r.id === matching.id)?.status).toBe('completed');
    expect(set?.recommendations.find(r => r.id === unrelated.id)?.status).toBe('pending');

    // Both-halves rule: the resolution must announce itself.
    expect(broadcastState.calls.some(c =>
      c.workspaceId === wsId
      && c.event === WS_EVENTS.RECOMMENDATIONS_UPDATED
      && (c.payload as { resolved?: number })?.resolved === 1,
    )).toBe(true);
  });

  it('FM-2: a rec-resolution failure never fails the publish', async () => {
    const wsId = makeWorkspace('D2 Resolution Failure Workspace');
    configurePublishTarget(wsId);
    mockWebflowSuccess(/\/collections\/collection_d2_recs\/items$/, { id: 'wf_d2_item_fm2' });
    mockWebflowSuccess(/\/collections\/collection_d2_recs\/items\/publish$/, {});

    seedRecSet(wsId, [makeContentRec(wsId, 'leak detection')]);
    const post = makePost(wsId, 'leak detection');
    savePost(wsId, post);

    resolveState.shouldThrow = true;
    const res = await publishPost(wsId, post.id);
    expect(res.status).toBe(200);
    expect(resolveState.calls).toBe(1);

    // Publish succeeded and stamped the post despite the resolution throw.
    const stored = getPost(wsId, post.id);
    expect(stored?.webflowItemId).toBe('wf_d2_item_fm2');
    expect(stored?.publishedAt).toBeTruthy();
  });

  it('FM-2: a failed publish does not resolve the matching rec', async () => {
    const wsId = makeWorkspace('D2 Publish Failure Workspace');
    configurePublishTarget(wsId);
    mockWebflowError(/\/collections\/collection_d2_recs\/items$/, 500, 'Webflow create failed');

    const rec = makeContentRec(wsId, 'pipe replacement');
    seedRecSet(wsId, [rec]);
    const post = makePost(wsId, 'pipe replacement');
    savePost(wsId, post);

    const res = await publishPost(wsId, post.id);
    expect(res.status).toBe(500);

    const set = loadRecommendations(wsId);
    expect(set?.recommendations.find(r => r.id === rec.id)?.status).toBe('pending');
    expect(resolveState.calls).toBe(0);
  });
});
