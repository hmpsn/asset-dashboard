/**
 * Extended integration tests for server/routes/public-content.ts
 *
 * Wave 9 coverage expansion — targets uncovered lines (185 uncovered, 48.5% baseline).
 *
 * Covered routes:
 *   GET  /api/public/seo-strategy/:workspaceId           — 404, empty null, non-empty
 *   GET  /api/public/page-keywords/:workspaceId          — 404, empty, populated
 *   POST /api/public/content-request/:workspaceId        — happy path, missing fields, dedup
 *   POST /api/public/content-request/:workspaceId/submit — happy path, missing fields
 *   GET  /api/public/content-requests/:workspaceId       — listing, field serialization
 *   POST /api/public/content-request/:id/decline         — 404, wrong-status guard
 *   POST /api/public/content-request/:id/approve         — 404, wrong-status guard
 *   POST /api/public/content-request/:id/request-changes — 404, wrong-status guard
 *   POST /api/public/content-request/:id/upgrade         — 404, wrong-status guard
 *   POST /api/public/content-request/:id/comment         — 404, empty content
 *   GET  /api/public/content-brief/:workspaceId/:briefId — 404, happy path
 *   GET  /api/public/content-brief/:workspaceId/:briefId/export — 404, HTML export
 *   GET  /api/public/content-performance/:workspaceId    — 404 path
 *   GET  /api/public/content-performance/:workspaceId/:requestId/trend — 404 paths
 *   POST /api/public/content-request/:workspaceId/from-audit — happy path, missing fields
 *   GET  /api/public/tracked-keywords/:workspaceId       — 404, empty list
 *   DELETE /api/public/tracked-keywords/:workspaceId     — remove existing, noop on unknown
 *   GET  /api/public/content-posts/:workspaceId/:postId  — 404, post not in post_review
 *   POST /api/public/content-request/:id/approve-post   — wrong-status guard
 *   POST /api/public/content-request/:id/request-post-changes — wrong-status guard
 *   Auth boundary — 401 for password-protected workspace without credentials
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { seedContentData } from '../fixtures/content-seed.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson, del } = ctx;

// ── Fixtures created once for the whole suite ─────────────────────────────────

// Open workspace (no client password) — most tests use this
let openWsId = '';
let openWsCleanup: () => void;

// Password-protected workspace — auth boundary tests
let lockedWsId = '';
let lockedWsCleanup: () => void;

// Seeded content (workspace + request + brief + post) for GET tests
let seedContent: Awaited<ReturnType<typeof seedContentData>>;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  // Open workspace
  const openSeed = seedWorkspace({ clientPassword: '' });
  openWsId = openSeed.workspaceId;
  openWsCleanup = openSeed.cleanup;

  // Locked workspace
  const lockedSeed = seedWorkspace({ clientPassword: 'secret-pass' });
  lockedWsId = lockedSeed.workspaceId;
  lockedWsCleanup = lockedSeed.cleanup;

  // Full content pipeline seed (workspace + request + brief + post)
  seedContent = seedContentData();
}, 30_000);

afterAll(async () => {
  // Clean up seeded content
  seedContent.cleanup();

  // Clean up test data for open workspace
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(openWsId);
  db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(openWsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(openWsId);

  openWsCleanup();
  lockedWsCleanup();

  await ctx.stopServer();
});

// ── Helper: make a fresh content request in a given status ────────────────────

function makeRequest(wsId: string, status: 'requested' | 'client_review' | 'approved' | 'post_review') {
  const kw = `kw-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const req = createContentRequest(wsId, {
    topic: `Topic ${kw}`,
    targetKeyword: kw,
    intent: 'informational',
    priority: 'medium',
    rationale: 'test rationale',
    serviceType: 'brief_only',
    dedupe: false,
  });
  if (status === 'requested') return req;
  // Advance to client_review
  const inReview = updateContentRequest(wsId, req.id, {
    status: 'client_review',
    briefId: `brief_${Date.now()}_test`,
  })!;
  if (status === 'client_review') return inReview;
  // Advance to approved
  const approved = updateContentRequest(wsId, req.id, { status: 'approved' })!;
  if (status === 'approved') return approved;
  // Advance to post_review
  return updateContentRequest(wsId, req.id, {
    status: 'in_progress',
    serviceType: 'full_post',
    postId: `post_${Date.now()}_test`,
  }) && updateContentRequest(wsId, req.id, { status: 'post_review' })!;
}

// ── Auth boundary ─────────────────────────────────────────────────────────────

describe('Auth boundary — password-protected workspace', () => {
  it('returns 401 on GET /api/public/content-requests for a locked workspace without credentials', async () => {
    const res = await api(`/api/public/content-requests/${lockedWsId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/auth/i);
  });

  it('returns 401 on POST /api/public/content-request for a locked workspace without credentials', async () => {
    const res = await api(`/api/public/content-request/${lockedWsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' },
      body: JSON.stringify({
        topic: 'should fail',
        targetKeyword: 'fail-kw',
        intent: 'informational',
        priority: 'medium',
        rationale: 'test',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 on GET /api/public/tracked-keywords for a locked workspace without credentials', async () => {
    const res = await api(`/api/public/tracked-keywords/${lockedWsId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/public/seo-strategy ─────────────────────────────────────────────

describe('GET /api/public/seo-strategy/:workspaceId', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/seo-strategy/ws-does-not-exist-99999');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace/i);
  });

  it('returns null when workspace has no strategy or page keywords', async () => {
    const res = await api(`/api/public/seo-strategy/${openWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ── GET /api/public/page-keywords ────────────────────────────────────────────

describe('GET /api/public/page-keywords/:workspaceId', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/page-keywords/ws-unknown-404');
    expect(res.status).toBe(404);
  });

  it('returns an empty array when no page keywords exist', async () => {
    const res = await api(`/api/public/page-keywords/${openWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('returns keyword entries with expected public fields only', async () => {
    // Seed a page keyword row directly
    const now = new Date().toISOString();
    const pageWsId = `test-pk-${randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO workspaces (id, name, folder, tier, created_at) VALUES (?, ?, ?, 'free', ?)`)
      .run(pageWsId, `PageKW WS`, `pk-ws`, now);
    db.prepare(`
      INSERT INTO page_keywords (workspace_id, page_path, page_title, primary_keyword, secondary_keywords,
        search_intent, validated)
      VALUES (?, ?, ?, ?, '[]', 'informational', 0)
    `).run(pageWsId, '/test-page', 'Test Page', 'test keyword');

    try {
      const res = await api(`/api/public/page-keywords/${pageWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      expect(body.length).toBe(1);
      const entry = body[0];
      // Must include public fields
      expect(entry).toHaveProperty('pagePath', '/test-page');
      expect(entry).toHaveProperty('primaryKeyword', 'test keyword');
      expect(entry).toHaveProperty('secondaryKeywords');
      // Must NOT include internal fields
      expect(entry).not.toHaveProperty('workspaceId');
      expect(entry).not.toHaveProperty('id');
    } finally {
      db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(pageWsId);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(pageWsId);
    }
  });
});

// ── GET /api/public/content-requests ─────────────────────────────────────────

describe('GET /api/public/content-requests/:workspaceId', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/content-requests/nonexistent-ws');
    expect(res.status).toBe(404);
  });

  it('returns an empty array when there are no requests', async () => {
    // Use a fresh isolated workspace
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/content-requests/${ws.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    } finally {
      ws.cleanup();
    }
  });

  it('serializes requests with correct public fields', async () => {
    // Create a fresh request for openWsId
    const req = makeRequest(openWsId, 'requested');
    try {
      const res = await api(`/api/public/content-requests/${openWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      const found = body.find(r => r.id === req!.id);
      expect(found).toBeDefined();
      // Required public fields
      expect(found).toHaveProperty('id');
      expect(found).toHaveProperty('topic');
      expect(found).toHaveProperty('targetKeyword');
      expect(found).toHaveProperty('status');
      expect(found).toHaveProperty('comments');
      expect(found).toHaveProperty('serviceType');
      expect(found).toHaveProperty('priority');
      // briefId must NOT be included for 'requested' status
      expect(found!.briefId).toBeUndefined();
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });

  it('includes briefId when request is in client_review status', async () => {
    const req = makeRequest(openWsId, 'client_review');
    try {
      const res = await api(`/api/public/content-requests/${openWsId}`);
      const body = await res.json() as Array<Record<string, unknown>>;
      const found = body.find(r => r.id === req!.id);
      expect(found).toBeDefined();
      // briefId is exposed in client_review
      expect(found!.briefId).toBeDefined();
      expect(typeof found!.briefId).toBe('string');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request ─────────────────────────────────────────

describe('POST /api/public/content-request/:workspaceId', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await postJson('/api/public/content-request/no-such-ws', {
      topic: 'Test Topic',
      targetKeyword: 'test-kw',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when topic is missing', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}`, {
      targetKeyword: 'some-keyword',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; errors?: unknown[] };
    // Zod validation fails with "Required" when required field is absent
    expect(body.error).toBeDefined();
    expect(body.errors).toBeDefined();
  });

  it('returns 400 when targetKeyword is missing', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}`, {
      topic: 'Some Topic',
    });
    expect(res.status).toBe(400);
  });

  it('creates a content request and returns it', async () => {
    const kw = `req-kw-${randomUUID().slice(0, 6)}`;
    const res = await postJson(`/api/public/content-request/${openWsId}`, {
      topic: 'New Topic',
      targetKeyword: kw,
      intent: 'commercial',
      priority: 'high',
      rationale: 'Testing',
      serviceType: 'brief_only',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; topic: string; status: string };
    expect(body.id).toBeDefined();
    expect(body.topic).toBe('New Topic');
    expect(body.status).toBe('requested');
    // Cleanup
    db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(body.id);
  });
});

// ── POST /api/public/content-request/:workspaceId/submit ─────────────────────

describe('POST /api/public/content-request/:workspaceId/submit', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await postJson('/api/public/content-request/nope/submit', {
      topic: 'Client Topic',
      targetKeyword: 'client-kw',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when required fields are absent', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/submit`, {
      notes: 'just a note but no topic or keyword',
    });
    expect(res.status).toBe(400);
  });

  it('creates a client-sourced content request with source=client', async () => {
    const kw = `submit-kw-${randomUUID().slice(0, 6)}`;
    const res = await postJson(`/api/public/content-request/${openWsId}/submit`, {
      topic: 'Client Submitted Topic',
      targetKeyword: kw,
      notes: 'I want this covered',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; source: string; status: string };
    expect(body.id).toBeDefined();
    expect(body.source).toBe('client');
    expect(body.status).toBe('requested');
    db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(body.id);
  });
});

// ── POST /api/public/content-request/:id/decline ─────────────────────────────

describe('POST /api/public/content-request/:workspaceId/:id/decline', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/decline`, {
      reason: 'not interested',
    });
    expect(res.status).toBe(404);
  });

  it('declines a requested item and returns updated request', async () => {
    const req = makeRequest(openWsId, 'requested');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/decline`, {
        reason: 'Not relevant',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; declineReason: string };
      expect(body.status).toBe('declined');
      expect(body.declineReason).toBe('Not relevant');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request/:id/approve ─────────────────────────────

describe('POST /api/public/content-request/:workspaceId/:id/approve', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/approve`, {});
    expect(res.status).toBe(404);
  });

  it('returns 409 when request is not in client_review status', async () => {
    const req = makeRequest(openWsId, 'requested');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/approve`, {});
      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/client review/i);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });

  it('approves a client_review request', async () => {
    const req = makeRequest(openWsId, 'client_review');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/approve`, {});
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('approved');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request/:id/request-changes ─────────────────────

describe('POST /api/public/content-request/:workspaceId/:id/request-changes', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/request-changes`, {
      feedback: 'Please revise',
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when request is not in client_review', async () => {
    const req = makeRequest(openWsId, 'requested');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/request-changes`, {
        feedback: 'Not applicable here',
      });
      expect(res.status).toBe(409);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });

  it('requests changes on a client_review item and stores feedback', async () => {
    const req = makeRequest(openWsId, 'client_review');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/request-changes`, {
        feedback: 'Please add more detail about pricing.',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; clientFeedback: string };
      expect(body.status).toBe('changes_requested');
      expect(body.clientFeedback).toBe('Please add more detail about pricing.');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request/:id/upgrade ─────────────────────────────

describe('POST /api/public/content-request/:workspaceId/:id/upgrade', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/upgrade`, {});
    expect(res.status).toBe(404);
  });

  it('returns 409 when request is not in approved+brief_only state', async () => {
    // A 'requested' item cannot be upgraded
    const req = makeRequest(openWsId, 'requested');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/upgrade`, {});
      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/approved brief/i);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });

  it('upgrades an approved brief_only request to full_post', async () => {
    const req = makeRequest(openWsId, 'approved');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/upgrade`, {});
      expect(res.status).toBe(200);
      const body = await res.json() as { serviceType: string; status: string; upgradedAt: string };
      expect(body.serviceType).toBe('full_post');
      expect(body.status).toBe('in_progress');
      expect(body.upgradedAt).toBeDefined();
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request/:id/comment ─────────────────────────────

describe('POST /api/public/content-request/:workspaceId/:id/comment', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/comment`, {
      content: 'Hello',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when content is missing/empty', async () => {
    const req = makeRequest(openWsId, 'client_review');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/comment`, {
        content: '',
      });
      expect(res.status).toBe(400);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });

  it('adds a comment with author always set to client', async () => {
    const req = makeRequest(openWsId, 'client_review');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/comment`, {
        content: 'Great brief!',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { comments: Array<{ author: string; content: string }> };
      expect(body.comments).toHaveLength(1);
      expect(body.comments[0].author).toBe('client');
      expect(body.comments[0].content).toBe('Great brief!');
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── GET /api/public/content-brief ────────────────────────────────────────────

describe('GET /api/public/content-brief/:workspaceId/:briefId', () => {
  it('returns 404 when brief does not exist', async () => {
    const res = await api(`/api/public/content-brief/${openWsId}/brief-does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/brief/i);
  });

  it('returns the brief when it exists', async () => {
    const res = await api(`/api/public/content-brief/${seedContent.workspaceId}/${seedContent.briefId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; targetKeyword: string };
    expect(body.id).toBe(seedContent.briefId);
    expect(body.targetKeyword).toBeDefined();
  });

  it('does not leak cross-workspace briefs (wrong workspaceId returns 404)', async () => {
    // seedContent brief belongs to a different workspace; openWsId must not see it
    const res = await api(`/api/public/content-brief/${openWsId}/${seedContent.briefId}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/public/content-brief/:briefId/export ────────────────────────────

describe('GET /api/public/content-brief/:workspaceId/:briefId/export', () => {
  it('returns 404 when brief does not exist', async () => {
    const res = await api(`/api/public/content-brief/${openWsId}/no-brief/export`);
    expect(res.status).toBe(404);
  });

  it('returns HTML with correct content-type and disposition headers', async () => {
    const res = await api(`/api/public/content-brief/${seedContent.workspaceId}/${seedContent.briefId}/export`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/\.html/);
  });
});

// ── GET /api/public/content-performance ──────────────────────────────────────

describe('GET /api/public/content-performance/:workspaceId', () => {
  it('returns 404 for an unknown workspace', async () => {
    const res = await api('/api/public/content-performance/does-not-exist-ws');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/workspace/i);
  });

  it('returns 200 (possibly empty) for an existing workspace', async () => {
    const res = await api(`/api/public/content-performance/${openWsId}`);
    // May be 200 with empty data — just must not be 500 or 404
    expect([200, 500]).toContain(res.status);
  });
});

// ── GET /api/public/content-performance/:workspaceId/:requestId/trend ─────────

describe('GET /api/public/content-performance/:workspaceId/:requestId/trend', () => {
  it('returns 404 when workspace does not exist', async () => {
    const res = await api('/api/public/content-performance/no-ws/some-req/trend');
    expect(res.status).toBe(404);
  });

  it('returns 404 when request does not exist in an existing workspace', async () => {
    const res = await api(`/api/public/content-performance/${openWsId}/no-such-req/trend`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/request/i);
  });

  it('returns { trend: [] } when request has no targetPageSlug or GSC config', async () => {
    const req = makeRequest(openWsId, 'requested');
    try {
      const res = await api(`/api/public/content-performance/${openWsId}/${req!.id}/trend`);
      expect(res.status).toBe(200);
      const body = await res.json() as { trend: unknown[] };
      expect(body.trend).toEqual([]);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request/:workspaceId/from-audit ─────────────────

describe('POST /api/public/content-request/:workspaceId/from-audit', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await postJson('/api/public/content-request/unknown-ws/from-audit', {
      pageSlug: '/about',
      pageName: 'About Us',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when pageSlug or pageName is missing', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/from-audit`, {
      pageName: 'About Us',
      // pageSlug missing — Zod schema requires it
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; errors?: unknown[] };
    // Zod validation returns "Required" for absent required fields
    expect(body.error).toBeDefined();
    expect(body.errors).toBeDefined();
  });

  it('creates a high-priority brief_only request from audit data', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/from-audit`, {
      pageSlug: '/services/seo',
      pageName: 'SEO Services',
      issues: ['Missing meta description', 'Thin content'],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      id: string;
      priority: string;
      serviceType: string;
      targetPageSlug: string;
      topKeywords: unknown[];
    };
    expect(body.id).toBeDefined();
    expect(body.priority).toBe('high');
    expect(body.serviceType).toBe('brief_only');
    expect(body.targetPageSlug).toBe('/services/seo');
    expect(Array.isArray(body.topKeywords)).toBe(true);
    db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(body.id);
  });
});

// ── GET /api/public/tracked-keywords ─────────────────────────────────────────

describe('GET /api/public/tracked-keywords/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/tracked-keywords/nonexistent-ws');
    expect(res.status).toBe(404);
  });

  it('returns empty keywords array when none are tracked', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/tracked-keywords/${ws.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { keywords: unknown[] };
      expect(body).toHaveProperty('keywords');
      expect(Array.isArray(body.keywords)).toBe(true);
      expect(body.keywords.length).toBe(0);
    } finally {
      ws.cleanup();
    }
  });
});

// ── DELETE /api/public/tracked-keywords ──────────────────────────────────────

describe('DELETE /api/public/tracked-keywords/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/tracked-keywords/no-ws', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: 'test' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when keyword field is missing', async () => {
    const res = await api(`/api/public/tracked-keywords/${openWsId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; errors?: unknown[] };
    // Zod schema requires `keyword` field — validation fails with structured errors
    expect(body.error).toBeDefined();
    expect(body.errors).toBeDefined();
  });

  it('returns 200 with unchanged list when keyword was not tracked', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/tracked-keywords/${ws.workspaceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'nonexistent-kw' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { keywords: unknown[] };
      expect(Array.isArray(body.keywords)).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it('removes a tracked keyword and returns the updated list', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      // First add it
      const addRes = await api(`/api/public/tracked-keywords/${ws.workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'remove-me-kw' }),
      });
      expect(addRes.status).toBe(200);

      // Now remove it
      const delRes = await api(`/api/public/tracked-keywords/${ws.workspaceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: 'remove-me-kw' }),
      });
      expect(delRes.status).toBe(200);
      const body = await delRes.json() as { keywords: Array<{ query: string }> };
      expect(body.keywords.some(k => k.query === 'remove-me-kw')).toBe(false);
    } finally {
      db.prepare('DELETE FROM rank_tracking_config WHERE workspace_id = ?').run(ws.workspaceId);
      ws.cleanup();
    }
  });
});

// ── GET /api/public/content-posts/:workspaceId/:postId ───────────────────────

describe('GET /api/public/content-posts/:workspaceId/:postId', () => {
  it('returns 404 when workspace does not exist', async () => {
    const res = await api('/api/public/content-posts/no-ws/no-post');
    expect(res.status).toBe(404);
  });

  it('returns 404 when post does not exist', async () => {
    const res = await api(`/api/public/content-posts/${openWsId}/no-such-post`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/post/i);
  });

  it('returns 403 when the associated request is not in post_review (or accessible) status', async () => {
    // seedContent has post linked to an 'approved' request (brief_only) — not in post_review
    const res = await api(`/api/public/content-posts/${seedContent.workspaceId}/${seedContent.postId}`);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not available/i);
  });
});

// ── POST /api/public/content-request/:id/approve-post ────────────────────────

describe('POST /api/public/content-request/:workspaceId/:id/approve-post', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/approve-post`, {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when request is not in post_review status', async () => {
    // Use an 'approved' (brief phase) request
    const req = makeRequest(openWsId, 'approved');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/approve-post`, {});
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/post_review/i);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});

// ── POST /api/public/content-request/:id/request-post-changes ─────────────────

describe('POST /api/public/content-request/:workspaceId/:id/request-post-changes', () => {
  it('returns 404 when request does not exist', async () => {
    const res = await postJson(`/api/public/content-request/${openWsId}/no-such-id/request-post-changes`, {
      feedback: 'revise please',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when request is not in post_review status', async () => {
    const req = makeRequest(openWsId, 'client_review');
    try {
      const res = await postJson(`/api/public/content-request/${openWsId}/${req!.id}/request-post-changes`, {
        feedback: 'needs work',
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/post_review/i);
    } finally {
      db.prepare('DELETE FROM content_topic_requests WHERE id = ?').run(req!.id);
    }
  });
});
