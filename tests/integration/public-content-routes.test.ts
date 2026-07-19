/**
 * Integration tests for public-content routes.
 *
 * Routes covered (server/routes/public-content.ts):
 *   GET  /api/public/seo-strategy/:workspaceId       — fresh → 200 null (no strategy)
 *   GET  /api/public/page-keywords/:workspaceId      — fresh → 200 []
 *   POST /api/public/content-request/:workspaceId    — Zod validated; missing fields → 400; valid → 200
 *   GET  /api/public/content-requests/:workspaceId   — fresh → 200 []
 *   POST /api/public/content-request/:workspaceId/submit — missing fields → 400
 *   GET  /api/public/content-performance/:workspaceId — fresh → 200
 *   GET  /api/public/tracked-keywords/:workspaceId   — fresh → 200 { keywords: [] }
 *
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { upsertBrief, type ContentBrief } from '../../server/content-brief.js';
import { savePost, type GeneratedPost } from '../../server/content-posts.js';
import db from '../../server/db/index.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson } = ctx;

const UNKNOWN_ID = 'ws_pubcontent_unknown_zzz9999';

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`PubContent Test ${ctx.PORT}`).id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

function makePublicPerformanceBrief(workspaceId: string, briefId: string): ContentBrief {
  return {
    id: briefId,
    workspaceId,
    targetKeyword: 'emergency dentist cost',
    secondaryKeywords: ['same-day extraction', 'after-hours dental care'],
    suggestedTitle: 'Emergency Dentist Cost Guide',
    suggestedMetaDesc: 'Costs and next steps for emergency dental care.',
    outline: [{ heading: 'Emergency care costs', notes: 'Explain urgent dental pricing.', keywords: ['dental abscess'] }],
    wordCountTarget: 1400,
    intent: 'informational',
    audience: 'patients',
    competitorInsights: 'Competitors answer urgent care cost questions.',
    internalLinkSuggestions: [],
    createdAt: '2026-06-14T00:00:00.000Z',
    realPeopleAlsoAsk: ['How much does emergency dental care cost?'],
    topicalEntities: [],
    serpAnalysis: {
      contentType: 'guide',
      avgWordCount: 1300,
      commonElements: ['insurance coverage'],
      gaps: [],
    },
    sourceEvidence: {
      capturedAt: '2026-06-14T00:00:00.000Z',
      scrapedReferences: [
        {
          url: 'https://competitor.example/private-source',
          title: 'Private competitor page',
          metaDescription: 'Private source',
          headings: [{ level: 2, text: 'Private heading' }],
          bodyText: 'Competitor-only private source text must never be serialized publicly.',
          wordCount: 500,
          fetchedAt: '2026-06-14T00:00:00.000Z',
        },
      ],
      serpResults: [
        {
          position: 1,
          title: 'Emergency dentist cost',
          url: 'https://example.com/emergency-dentist',
          snippet: 'Walk-in dentist',
        },
      ],
    },
    generationRevision: 4,
    generationProvenance: {
      runId: 'run_public_brief',
      operation: 'content-brief-generate',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      inputFingerprint: 'a'.repeat(64),
      startedAt: '2026-06-14T00:00:00.000Z',
      completedAt: '2026-06-14T00:00:01.000Z',
    },
  };
}

function makePublicPerformancePost(workspaceId: string, postId: string, briefId: string): GeneratedPost {
  return {
    id: postId,
    workspaceId,
    briefId,
    targetKeyword: 'emergency dentist cost',
    title: 'Emergency Dentist Cost and Same-Day Extraction',
    metaDescription: 'How much emergency dental care costs, including insurance coverage.',
    introduction: '<p>Emergency dentist cost depends on the treatment and insurance coverage.</p>',
    sections: [
      {
        index: 0,
        heading: 'Same-day extraction for a dental abscess',
        content: '<p>Same-day extraction may be needed when a dental abscess is severe.</p>',
        wordCount: 120,
        targetWordCount: 200,
        keywords: ['same-day extraction', 'dental abscess'],
        status: 'done',
      },
    ],
    conclusion: '<p>How much does emergency dental care cost? Ask for pricing before treatment starts.</p>',
    totalWordCount: 500,
    targetWordCount: 1400,
    status: 'approved',
    generationDiagnostics: [{
      stage: 'section',
      code: 'provider_error',
      message: 'Internal provider detail',
      sectionIndex: 0,
      occurredAt: '2026-06-14T00:00:00.000Z',
    }],
    aiReview: {
      review: {
        factual_accuracy: { pass: false, reason: 'Needs human review', humanReviewRequired: true },
        brand_voice: { pass: true, reason: 'On voice' },
        internal_links: { pass: true, reason: 'Includes links' },
        no_hallucinations: { pass: false, reason: 'Needs human review', humanReviewRequired: true },
        meta_optimized: { pass: true, reason: 'Optimized' },
        word_count_target: { pass: true, reason: 'Acceptable' },
      },
      reviewedAt: '2026-06-14T00:00:00.000Z',
      model: 'test-model',
    },
    generationRevision: 7,
    generationProvenance: {
      runId: 'run_public_post',
      operation: 'content-post-section',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      inputFingerprint: 'b'.repeat(64),
      startedAt: '2026-06-14T00:00:00.000Z',
      completedAt: '2026-06-14T00:00:01.000Z',
    },
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/seo-strategy/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/seo-strategy/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api(`/api/public/seo-strategy/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 null for fresh workspace with no strategy', async () => {
    const res = await api(`/api/public/seo-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // A fresh workspace with no strategy and no page keywords returns null
    expect(body).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/page-keywords/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/page-keywords/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api(`/api/public/page-keywords/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 empty array for fresh workspace', async () => {
    const res = await api(`/api/public/page-keywords/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/content-request/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/public/content-request/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson(`/api/public/content-request/${UNKNOWN_ID}`, {
      topic: 'Test Topic',
      targetKeyword: 'test keyword',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when topic is missing', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      targetKeyword: 'test keyword',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when targetKeyword is missing', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Test Topic',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when body is empty', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when topic is empty string', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: '',
      targetKeyword: 'test keyword',
    });
    expect(res.status).toBe(400);
  });

  it('creates a content request with valid body', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Integration Test Topic',
      targetKeyword: 'integration testing',
      priority: 'medium',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; topic: string; targetKeyword: string; status: string };
    expect(typeof body.id).toBe('string');
    expect(body.topic).toBe('Integration Test Topic');
    expect(body.targetKeyword).toBe('integration testing');
    expect(typeof body.status).toBe('string');
  });

  it('strips HTML from public plain-text content request fields before persisting', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: '<strong>HTML Topic</strong>',
      targetKeyword: '<em>html keyword</em>',
      rationale: '<p>Needs cleanup</p>',
      clientNote: '<a href="https://example.com">Client note</a>',
      priority: 'medium',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; topic: string; targetKeyword: string };
    expect(body.topic).toBe('HTML Topic');
    expect(body.targetKeyword).toBe('html keyword');
    expect(body).not.toHaveProperty('rationale');
    expect(body).not.toHaveProperty('clientNote');
    expect(getContentRequest(wsId, body.id)).toMatchObject({
      rationale: 'Needs cleanup',
      clientNote: 'Client note',
    });
  });

  it('accepts optional fields without error', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Optional Fields Topic',
      targetKeyword: 'optional fields',
      intent: 'informational',
      priority: 'high',
      rationale: 'Testing optional fields',
      clientNote: 'A note',
      serviceType: 'full_post',
      pageType: 'blog',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { serviceType: string; pageType: string };
    expect(body.serviceType).toBe('full_post');
    expect(body.pageType).toBe('blog');
  });

  it('rejects invalid priority enum', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}`, {
      topic: 'Enum Test',
      targetKeyword: 'test',
      priority: 'invalid_priority',
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/content-requests/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/content-requests/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api(`/api/public/content-requests/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 with an array for a fresh workspace (may include previously created requests)', async () => {
    const wsB = createWorkspace(`PubContent Requests Empty ${ctx.PORT}`);
    try {
      const res = await api(`/api/public/content-requests/${wsB.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(wsB.id);
    }
  });

  it('returns the previously created request', async () => {
    const res = await api(`/api/public/content-requests/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; topic: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Each item must have required fields
    const item = body[0];
    expect(typeof item.id).toBe('string');
    expect(typeof item.topic).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/content-request/:workspaceId/submit
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/public/content-request/:workspaceId/submit', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson(`/api/public/content-request/${UNKNOWN_ID}/submit`, {
      topic: 'Test',
      targetKeyword: 'test',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when topic is missing', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      targetKeyword: 'some keyword',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when targetKeyword is missing', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      topic: 'Some topic',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when both required fields are empty strings', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      topic: '',
      targetKeyword: '',
    });
    expect(res.status).toBe(400);
  });

  it('creates a request with valid body', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      topic: 'Client Submitted Topic',
      targetKeyword: 'client topic keyword',
      notes: 'Some client notes',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; topic: string; source: string };
    expect(typeof body.id).toBe('string');
    expect(body.topic).toBe('Client Submitted Topic');
    expect(body.source).toBe('client');
  });

  it('strips HTML from client-submitted request notes before persisting', async () => {
    const res = await postJson(`/api/public/content-request/${wsId}/submit`, {
      topic: '<strong>Client HTML Topic</strong>',
      targetKeyword: '<em>client html keyword</em>',
      notes: '<p>Plain client note</p>',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; topic: string; targetKeyword: string };
    expect(body.topic).toBe('Client HTML Topic');
    expect(body.targetKeyword).toBe('client html keyword');
    expect(body).not.toHaveProperty('rationale');
    expect(body).not.toHaveProperty('clientNote');
    expect(getContentRequest(wsId, body.id)).toMatchObject({
      rationale: 'Plain client note',
      clientNote: 'Plain client note',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/content-performance/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/content-performance/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api(`/api/public/content-performance/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 for a fresh workspace', async () => {
    const res = await api(`/api/public/content-performance/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response should be an object (not null/undefined)
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('returns client-safe coverage summary without raw C4 evidence or AI review internals', async () => {
    const workspace = createWorkspace(`PubContent Perf Privacy ${ctx.PORT}`);
    const briefId = `brief_public_${Date.now()}`;
    const postId = `post_public_${Date.now()}`;
    try {
      const request = createContentRequest(workspace.id, {
        topic: 'Emergency dentist guide',
        targetKeyword: 'emergency dentist cost',
        intent: 'informational',
        priority: 'high',
        rationale: 'Public privacy test',
        targetPageSlug: '/emergency-dentist-cost',
      });
      upsertBrief(workspace.id, makePublicPerformanceBrief(workspace.id, briefId));
      savePost(workspace.id, makePublicPerformancePost(workspace.id, postId, briefId));
      updateContentRequest(workspace.id, request.id, { briefId, postId, status: 'delivered' });

      const res = await api(`/api/public/content-performance/${workspace.id}`);
      expect(res.status).toBe(200);
	      const body = await res.json() as { items: Array<Record<string, unknown>> };
	      const item = body.items.find(i => i.requestId === request.id);
	      expect(item).toBeDefined();
	      expect(Object.keys(item ?? {}).sort()).toEqual([
	        'coverage',
	        'daysSincePublish',
	        'ga4',
	        'gsc',
	        'itemId',
	        'pageType',
	        'publishedAt',
	        'requestId',
	        'source',
	        'status',
	        'targetKeyword',
	        'targetPageSlug',
	        'topic',
	      ].sort());

	      expect(item?.coverage).toMatchObject({
	        status: 'partial',
	        requiredCount: 7,
	        matchedCount: 5,
	        missingCount: 2,
	        coveragePct: 71,
	      });
	      expect(Object.keys(item?.coverage as Record<string, unknown>).sort()).toEqual([
	        'coveragePct',
	        'matchedCount',
	        'missingCount',
	        'missingTerms',
	        'requiredCount',
	        'status',
	      ].sort());
	      expect((item?.coverage as { missingTerms?: unknown[] }).missingTerms).toEqual([]);
	      expect(item?.joinback).toBeUndefined();
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('scrapedReferences');
      expect(serialized).not.toContain('styleExamples');
      expect(serialized).not.toContain('bodyText');
      expect(serialized).not.toContain('Competitor-only private source text');
      expect(serialized).not.toContain('aiReview');
      expect(serialized).not.toContain('test-model');
      expect(serialized).not.toContain('generationRevision');
      expect(serialized).not.toContain('generationProvenance');
      expect(serialized).not.toContain('run_public_');
      expect(serialized).not.toContain('inputFingerprint');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspace.id);
      db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspace.id);
      db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspace.id);
      deleteWorkspace(workspace.id);
    }
  });
});

describe('public generated artifact projections', () => {
  it('never returns generation revisions, provenance, run ids, or input fingerprints', async () => {
    const workspace = createWorkspace(`PubContent Artifact Privacy ${ctx.PORT}`);
    const briefId = `brief_public_artifact_${Date.now()}`;
    const postId = `post_public_artifact_${Date.now()}`;
    try {
      upsertBrief(workspace.id, makePublicPerformanceBrief(workspace.id, briefId));
      savePost(workspace.id, makePublicPerformancePost(workspace.id, postId, briefId));
      const request = createContentRequest(workspace.id, {
        topic: 'Emergency dentist guide',
        targetKeyword: 'emergency dentist cost',
        intent: 'informational',
        priority: 'high',
        rationale: 'Public artifact privacy test',
        initialStatus: 'in_progress',
      });
      updateContentRequest(workspace.id, request.id, {
        briefId,
        postId,
        status: 'post_review',
      });

      const briefResponse = await api(`/api/public/content-brief/${workspace.id}/${briefId}`);
      expect(briefResponse.status).toBe(200);
      const briefBody = await briefResponse.json() as Record<string, unknown>;
      expect(briefBody).not.toHaveProperty('sourceEvidence');
      expect(briefBody).not.toHaveProperty('generationRevision');
      expect(briefBody).not.toHaveProperty('generationProvenance');

      const postResponse = await api(`/api/public/content-posts/${workspace.id}/${postId}`);
      expect(postResponse.status).toBe(200);
      const postBody = await postResponse.json() as Record<string, unknown>;
      expect(postBody).not.toHaveProperty('aiReview');
      expect(postBody).not.toHaveProperty('generationDiagnostics');
      expect(postBody).not.toHaveProperty('generationRevision');
      expect(postBody).not.toHaveProperty('generationProvenance');
      const serialized = JSON.stringify(postBody);
      expect(serialized).not.toContain('run_public_post');
      expect(serialized).not.toContain('inputFingerprint');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspace.id);
      db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspace.id);
      db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspace.id);
      deleteWorkspace(workspace.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/tracked-keywords/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/public/tracked-keywords/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api(`/api/public/tracked-keywords/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 with empty keywords array for fresh workspace', async () => {
    const wsC = createWorkspace(`PubContent Tracked ${ctx.PORT}`);
    try {
      const res = await api(`/api/public/tracked-keywords/${wsC.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { keywords: unknown[] };
      expect(body).toHaveProperty('keywords');
      expect(Array.isArray(body.keywords)).toBe(true);
      expect(body.keywords).toHaveLength(0);
    } finally {
      deleteWorkspace(wsC.id);
    }
  });
});
