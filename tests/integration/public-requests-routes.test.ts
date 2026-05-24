/**
 * Integration tests for server/routes/public-requests.ts
 *
 * Covers:
 * - POST /api/public/requests/:workspaceId — create request (Zod validated)
 * - GET /api/public/requests/:workspaceId — list requests (empty state)
 * - GET /api/public/requests/:workspaceId/:requestId — get single request
 * - POST /api/public/requests/:workspaceId/:requestId/notes — add note
 *
 * Rate-limit notes:
 * - publicWriteLimiter: 10 writes/min per IP per path
 * - publicApiLimiter: 60 reads/min per IP per path
 * - globalPublicLimiter: 200/min per IP (global)
 * Each workspace creates separate path keys, so tests use distinct workspaces
 * whenever the POST count per workspace approaches 10.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const PORT = 13501;
const ctx = createTestContext(PORT);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('PublicRequests-13501').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── GET /api/public/requests/:workspaceId ─────────────────────────────────────

describe('GET /api/public/requests/:workspaceId — list requests', () => {
  it('returns 404 for unknown workspace', async () => {
    // The workspace existence middleware returns 404 for unknown workspaceId
    const res = await api('/api/public/requests/no-such-ws-13501');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns empty array for fresh workspace', async () => {
    const wsEmpty = createWorkspace('PublicRequests-13501-Empty').id;
    try {
      const res = await api(`/api/public/requests/${wsEmpty}`);
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(wsEmpty);
    }
  });
});

// ── GET /api/public/requests/:workspaceId/:requestId ──────────────────────────

describe('GET /api/public/requests/:workspaceId/:requestId — single request', () => {
  it('returns 404 for unknown request id', async () => {
    const res = await api(`/api/public/requests/${wsId}/req_nonexistent_13501`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});

// ── POST /api/public/requests/:workspaceId — create request (validation) ──────
// publicWriteLimiter: 10 writes/min per IP per path.
// Each validation sub-group uses its own workspace to avoid exhausting the bucket.

describe('POST /api/public/requests/:workspaceId — create request (missing fields)', () => {
  let wsVal = '';
  beforeAll(() => { wsVal = createWorkspace('PublicRequests-13501-Val').id; });
  afterAll(() => { deleteWorkspace(wsVal); });

  it('returns 400 for missing title', async () => {
    const res = await postJson(`/api/public/requests/${wsVal}`, {
      description: 'No title provided',
      category: 'bug',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing description', async () => {
    const res = await postJson(`/api/public/requests/${wsVal}`, {
      title: 'Some title',
      category: 'seo',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing category', async () => {
    const res = await postJson(`/api/public/requests/${wsVal}`, {
      title: 'Some title',
      description: 'Some description',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid category value', async () => {
    const res = await postJson(`/api/public/requests/${wsVal}`, {
      title: 'Test',
      description: 'Test description',
      category: 'billing',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid priority value', async () => {
    const res = await postJson(`/api/public/requests/${wsVal}`, {
      title: 'Test',
      description: 'Test description',
      category: 'bug',
      priority: 'drop-everything',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for title exceeding max length (500)', async () => {
    const res = await postJson(`/api/public/requests/${wsVal}`, {
      title: 'x'.repeat(501),
      description: 'Test description',
      category: 'bug',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/public/requests/:workspaceId — create request (success paths)', () => {
  it('creates a request with minimal valid fields', async () => {
    const ws = createWorkspace('PublicRequests-13501-MinFields').id;
    try {
      const res = await postJson(`/api/public/requests/${ws}`, {
        title: 'Fix homepage hero',
        description: 'The hero section needs updating',
        category: 'content',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; title: string; category: string; priority: string };
      expect(body.id).toBeTruthy();
      expect(body.title).toBe('Fix homepage hero');
      expect(body.category).toBe('content');
      expect(body.priority).toBe('medium'); // default
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('creates a request with all optional fields', async () => {
    const ws = createWorkspace('PublicRequests-13501-AllFields').id;
    try {
      const res = await postJson(`/api/public/requests/${ws}`, {
        title: 'Update nav links',
        description: 'Navigation links are broken on mobile',
        category: 'design',
        priority: 'high',
        pageUrl: 'https://example.com/nav',
        submittedBy: 'Client User',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; priority: string; submittedBy: string };
      expect(body.priority).toBe('high');
      expect(body.submittedBy).toBe('Client User');
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('accepts all valid category values', async () => {
    // Each category gets its own workspace to avoid rate limiting
    const categories = ['bug', 'content', 'design', 'seo', 'feature', 'other'] as const;
    for (const category of categories) {
      const ws = createWorkspace(`PublicRequests-13501-Cat-${category}`).id;
      try {
        const res = await postJson(`/api/public/requests/${ws}`, {
          title: `Test ${category}`,
          description: `Testing category ${category}`,
          category,
        });
        expect(res.status).toBe(200);
      } finally {
        deleteWorkspace(ws);
      }
    }
  });

  it('newly created request appears in list', async () => {
    const ws = createWorkspace('PublicRequests-13501-List').id;
    try {
      const createRes = await postJson(`/api/public/requests/${ws}`, {
        title: 'Should appear in list',
        description: 'Test request for list verification',
        category: 'seo',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      const listRes = await api(`/api/public/requests/${ws}`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json() as Array<{ id: string }>;
      expect(list.some(r => r.id === created.id)).toBe(true);
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('single request GET works after creation', async () => {
    const ws = createWorkspace('PublicRequests-13501-Single').id;
    try {
      const createRes = await postJson(`/api/public/requests/${ws}`, {
        title: 'Single read test',
        description: 'Testing single request read path',
        category: 'feature',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      const getRes = await api(`/api/public/requests/${ws}/${created.id}`);
      expect(getRes.status).toBe(200);
      const body = await getRes.json() as { id: string; title: string };
      expect(body.id).toBe(created.id);
      expect(body.title).toBe('Single read test');
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('404 for workspace-scoped read with wrong workspace', async () => {
    const wsA = createWorkspace('PublicRequests-13501-WsA').id;
    const wsB = createWorkspace('PublicRequests-13501-WsB').id;
    try {
      const createRes = await postJson(`/api/public/requests/${wsA}`, {
        title: 'Cross-workspace test',
        description: 'Should not be visible from another workspace',
        category: 'bug',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      // Try to read the request via a different workspace URL
      const getRes = await api(`/api/public/requests/${wsB}/${created.id}`);
      expect(getRes.status).toBe(404);
    } finally {
      deleteWorkspace(wsA);
      deleteWorkspace(wsB);
    }
  });
});

// ── POST /api/public/requests/:workspaceId/:requestId/notes ───────────────────

describe('POST /api/public/requests/:workspaceId/:requestId/notes — add note', () => {
  it('returns 404 for unknown request id', async () => {
    const res = await postJson(`/api/public/requests/${wsId}/req_nonexistent_13501/notes`, {
      content: 'This request does not exist',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing note content', async () => {
    const ws = createWorkspace('PublicRequests-13501-NoteVal1').id;
    try {
      const createRes = await postJson(`/api/public/requests/${ws}`, {
        title: 'Note test request',
        description: 'Testing note validation',
        category: 'other',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      const res = await postJson(`/api/public/requests/${ws}/${created.id}/notes`, {});
      expect(res.status).toBe(400);
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('returns 400 for empty string note content', async () => {
    const ws = createWorkspace('PublicRequests-13501-NoteVal2').id;
    try {
      const createRes = await postJson(`/api/public/requests/${ws}`, {
        title: 'Empty note test',
        description: 'Testing empty note rejection',
        category: 'other',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      const res = await postJson(`/api/public/requests/${ws}/${created.id}/notes`, {
        content: '',
      });
      expect(res.status).toBe(400);
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('adds a note to a request successfully', async () => {
    const ws = createWorkspace('PublicRequests-13501-NoteSuccess').id;
    try {
      const createRes = await postJson(`/api/public/requests/${ws}`, {
        title: 'Add note success test',
        description: 'Testing note creation',
        category: 'content',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      const noteRes = await postJson(`/api/public/requests/${ws}/${created.id}/notes`, {
        content: 'This is a client note.',
      });
      expect(noteRes.status).toBe(200);
      const updated = await noteRes.json() as { id: string; notes: Array<{ author: string; content: string }> };
      expect(updated.notes).toHaveLength(1);
      expect(updated.notes[0].author).toBe('client');
      expect(updated.notes[0].content).toBe('This is a client note.');
    } finally {
      deleteWorkspace(ws);
    }
  });

  it('returns 404 when adding note with wrong workspace id', async () => {
    const wsNote = createWorkspace('PublicRequests-13501-NoteWs').id;
    const wsWrong = createWorkspace('PublicRequests-13501-NoteWsWrong').id;
    try {
      const createRes = await postJson(`/api/public/requests/${wsNote}`, {
        title: 'Cross-ws note guard',
        description: 'Note added to wrong workspace',
        category: 'seo',
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { id: string };

      const res = await postJson(`/api/public/requests/${wsWrong}/${created.id}/notes`, {
        content: 'Cross-workspace note attempt',
      });
      expect(res.status).toBe(404);
    } finally {
      deleteWorkspace(wsNote);
      deleteWorkspace(wsWrong);
    }
  });
});
