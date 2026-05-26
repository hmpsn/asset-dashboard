/**
 * Integration tests for suggested-briefs API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/suggested-briefs/:workspaceId          (list, with/without ?all=true)
 * - GET /api/suggested-briefs/:workspaceId/:briefId (get one)
 * - PATCH /api/suggested-briefs/:workspaceId/:briefId (update status)
 * - POST /api/suggested-briefs/:workspaceId/:briefId/snooze
 * - POST /api/suggested-briefs/:workspaceId/:briefId/dismiss
 *
 * Port: 13564
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13564);
const { api, patchJson, postJson } = ctx;

let testWsId = '';

// ── Seed helper ────────────────────────────────────────────────────────────────

function seedBrief(overrides: Partial<{
  id: string;
  workspace_id: string;
  keyword: string;
  page_url: string | null;
  source: string;
  reason: string;
  priority: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  dismissed_keyword_hash: string | null;
}> = {}): string {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO suggested_briefs
      (id, workspace_id, keyword, page_url, source, reason, priority, status,
       created_at, resolved_at, snoozed_until, dismissed_keyword_hash)
    VALUES
      (@id, @workspace_id, @keyword, @page_url, @source, @reason, @priority, @status,
       @created_at, @resolved_at, @snoozed_until, @dismissed_keyword_hash)
  `).run({
    id,
    workspace_id: overrides.workspace_id ?? testWsId,
    keyword: overrides.keyword ?? 'best seo tools',
    page_url: overrides.page_url ?? null,
    source: overrides.source ?? 'content_decay',
    reason: overrides.reason ?? 'Page traffic declined by 40%',
    priority: overrides.priority ?? 'high',
    status: overrides.status ?? 'pending',
    created_at: overrides.created_at ?? new Date().toISOString(),
    resolved_at: overrides.resolved_at ?? null,
    snoozed_until: overrides.snoozed_until ?? null,
    dismissed_keyword_hash: overrides.dismissed_keyword_hash ?? null,
  });
  return id;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Suggested Briefs Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM suggested_briefs WHERE workspace_id = ?').run(testWsId);
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/suggested-briefs/:workspaceId — list', () => {
  it('returns empty array for a fresh workspace', async () => {
    const freshWs = createWorkspace('Fresh WS for Suggested Briefs');
    try {
      const res = await api(`/api/suggested-briefs/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns a seeded brief in the list', async () => {
    const briefId = seedBrief({ keyword: 'list-test keyword' });
    try {
      const res = await api(`/api/suggested-briefs/${testWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const found = body.find((b: { id: string }) => b.id === briefId);
      expect(found).toBeDefined();
      expect(found.keyword).toBe('list-test keyword');
      expect(found.status).toBe('pending');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });

  it('without ?all=true does NOT include dismissed briefs', async () => {
    const dismissedId = seedBrief({ keyword: 'dismissed-filter-test', status: 'dismissed' });
    try {
      const res = await api(`/api/suggested-briefs/${testWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const found = body.find((b: { id: string }) => b.id === dismissedId);
      expect(found).toBeUndefined();
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(dismissedId);
    }
  });

  it('with ?all=true includes dismissed briefs', async () => {
    const dismissedId = seedBrief({ keyword: 'all-flag-test', status: 'dismissed' });
    try {
      const res = await api(`/api/suggested-briefs/${testWsId}?all=true`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const found = body.find((b: { id: string }) => b.id === dismissedId);
      expect(found).toBeDefined();
      expect(found.status).toBe('dismissed');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(dismissedId);
    }
  });
});

describe('GET /api/suggested-briefs/:workspaceId/:briefId — get one', () => {
  it('returns 404 for a nonexistent briefId', async () => {
    const res = await api(`/api/suggested-briefs/${testWsId}/${randomUUID()}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns the brief when it exists', async () => {
    const briefId = seedBrief({ keyword: 'get-one-test' });
    try {
      const res = await api(`/api/suggested-briefs/${testWsId}/${briefId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(briefId);
      expect(body.keyword).toBe('get-one-test');
      expect(body.workspaceId).toBe(testWsId);
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });
});

describe('PATCH /api/suggested-briefs/:workspaceId/:briefId — update status', () => {
  it('accepts status=accepted and returns updated brief', async () => {
    const briefId = seedBrief({ keyword: 'patch-accept-test' });
    try {
      const res = await patchJson(`/api/suggested-briefs/${testWsId}/${briefId}`, { status: 'accepted' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(briefId);
      expect(body.status).toBe('accepted');
      expect(body.resolvedAt).toBeTruthy();
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });

  it('accepts status=dismissed and returns updated brief', async () => {
    const briefId = seedBrief({ keyword: 'patch-dismiss-test' });
    try {
      const res = await patchJson(`/api/suggested-briefs/${testWsId}/${briefId}`, { status: 'dismissed' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(briefId);
      expect(body.status).toBe('dismissed');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });

  it('returns 400 for an invalid status value', async () => {
    const briefId = seedBrief({ keyword: 'patch-invalid-test' });
    try {
      const res = await patchJson(`/api/suggested-briefs/${testWsId}/${briefId}`, { status: 'bogus' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });
});

describe('POST /api/suggested-briefs/:workspaceId/:briefId/snooze', () => {
  it('snoozes the brief until the given date', async () => {
    const briefId = seedBrief({ keyword: 'snooze-test' });
    try {
      const res = await postJson(`/api/suggested-briefs/${testWsId}/${briefId}/snooze`, {
        until: '2099-12-31',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(briefId);
      expect(body.status).toBe('snoozed');
      expect(body.snoozedUntil).toBe('2099-12-31');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });

  it('returns 400 for an invalid date format', async () => {
    const briefId = seedBrief({ keyword: 'snooze-invalid-date-test' });
    try {
      const res = await postJson(`/api/suggested-briefs/${testWsId}/${briefId}/snooze`, {
        until: 'not-a-date',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });
});

describe('POST /api/suggested-briefs/:workspaceId/:briefId/dismiss', () => {
  it('marks the brief as dismissed', async () => {
    const briefId = seedBrief({ keyword: 'dismiss-endpoint-test' });
    try {
      const res = await postJson(`/api/suggested-briefs/${testWsId}/${briefId}/dismiss`, {});
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(briefId);
      expect(body.status).toBe('dismissed');
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });

  it('subsequent GET list (no ?all) does not include the dismissed brief', async () => {
    const briefId = seedBrief({ keyword: 'dismiss-filter-verify-test' });
    try {
      // Dismiss via the endpoint
      const dismissRes = await postJson(`/api/suggested-briefs/${testWsId}/${briefId}/dismiss`, {});
      expect(dismissRes.status).toBe(200);

      // List without ?all=true — dismissed items should be excluded
      const listRes = await api(`/api/suggested-briefs/${testWsId}`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      const found = list.find((b: { id: string }) => b.id === briefId);
      expect(found).toBeUndefined();
    } finally {
      db.prepare('DELETE FROM suggested_briefs WHERE id = ?').run(briefId);
    }
  });
});
