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
    const body = await res.json() as { topic: string; targetKeyword: string; rationale: string; clientNote: string };
    expect(body.topic).toBe('HTML Topic');
    expect(body.targetKeyword).toBe('html keyword');
    expect(body.rationale).toBe('Needs cleanup');
    expect(body.clientNote).toBe('Client note');
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
    const body = await res.json() as { topic: string; targetKeyword: string; rationale: string; clientNote: string };
    expect(body.topic).toBe('Client HTML Topic');
    expect(body.targetKeyword).toBe('client html keyword');
    expect(body.rationale).toBe('Plain client note');
    expect(body.clientNote).toBe('Plain client note');
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
