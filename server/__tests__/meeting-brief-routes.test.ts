// @vitest-environment node
/**
 * Integration tests for meeting-brief routes.
 *
 * GET  /api/workspaces/:workspaceId/meeting-brief
 * POST /api/workspaces/:workspaceId/meeting-brief/generate
 *
 * Uses an in-process HTTP server via createApp() so vi.mock interceptors apply.
 * APP_PASSWORD is '' in test env — auth gate passes through without a token.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import db from '../db/index.js';

// ---------------------------------------------------------------------------
// Module-level vi.mock declarations — hoisted before imports by Vitest
// ---------------------------------------------------------------------------

vi.mock('../broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const MOCK_BRIEF = {
  workspaceId: '',
  generatedAt: '2026-04-07T12:00:00Z',
  situationSummary: 'Test summary.',
  wins: ['Win 1'],
  attention: ['Issue 1'],
  recommendations: [{ action: 'Do something', rationale: 'Because' }],
  blueprintProgress: null,
  metrics: {
    siteHealthScore: 80,
    openRankingOpportunities: 3,
    contentInPipeline: 2,
    overallWinRate: 65,
    criticalIssues: 1,
  },
};

vi.mock('../meeting-brief-generator.js', async () => {
  const { upsertMeetingBrief } = await import('../meeting-brief-store.js'); // dynamic-import-ok
  return {
    generateMeetingBrief: vi.fn(async (workspaceId: string) => {
      const brief = { ...MOCK_BRIEF, workspaceId };
      upsertMeetingBrief(brief);
      return brief;
    }),
    assembleMeetingBriefMetrics: vi.fn(),
    buildBriefPrompt: vi.fn(),
  };
});

// Import mock handle so individual tests can reconfigure generateMeetingBrief
import { generateMeetingBrief as mockGenerateMeetingBrief } from '../meeting-brief-generator.js';

// ---------------------------------------------------------------------------
// In-process server helper
// ---------------------------------------------------------------------------

async function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  stop: () => void;
}> {
  const { createApp } = await import('../app.js'); // dynamic-import-ok
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl, stop: () => server.close() };
}

async function getJson(baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function postJson(baseUrl: string, path: string, data?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Meeting Brief routes', () => {
  let workspaceId: string;
  let baseUrl: string;
  let stopServer: () => void;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    workspaceId = `test-mb-routes-${suffix}`;

    db.prepare(`
      INSERT OR IGNORE INTO workspaces (id, name, folder, live_domain, tier, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(workspaceId, 'Test MB Workspace', `test-mb-${suffix}`, 'test.example.com', 'free', new Date().toISOString());

    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    stopServer = srv.stop;
  });

  afterEach(() => {
    stopServer();
    db.prepare('DELETE FROM meeting_briefs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  });

  it('GET returns { brief: null } when no brief has been generated', async () => {
    const { status, body } = await getJson(baseUrl, `/api/workspaces/${workspaceId}/meeting-brief`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).brief).toBeNull();
  });

  it('POST /generate returns 200 with the generated brief', async () => {
    const { status, body } = await postJson(baseUrl, `/api/workspaces/${workspaceId}/meeting-brief/generate`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('brief');
    const brief = b.brief as Record<string, unknown>;
    expect(brief.workspaceId).toBe(workspaceId);
    expect(brief.situationSummary).toBe('Test summary.');
    expect(brief.wins).toEqual(['Win 1']);
  });

  it('POST /generate returns cached brief with unchanged:true when data has not changed', async () => {
    const { upsertMeetingBrief } = await import('../meeting-brief-store.js'); // dynamic-import-ok
    // Pre-seed a brief so the route has something to return
    const cached = { ...MOCK_BRIEF, workspaceId, situationSummary: 'Cached summary.' };
    upsertMeetingBrief(cached);

    // Configure mock to throw BRIEF_UNCHANGED (simulating unchanged hash)
    vi.mocked(mockGenerateMeetingBrief).mockRejectedValueOnce(new Error('BRIEF_UNCHANGED'));

    const { status, body } = await postJson(baseUrl, `/api/workspaces/${workspaceId}/meeting-brief/generate`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.unchanged).toBe(true);
    expect(b).toHaveProperty('brief');
    const brief = b.brief as Record<string, unknown>;
    expect(brief.situationSummary).toBe('Cached summary.');
  });

  it('GET returns the stored brief after generation', async () => {
    // First generate
    await postJson(baseUrl, `/api/workspaces/${workspaceId}/meeting-brief/generate`);

    // Then fetch — should find a stored brief now
    const { status, body } = await getJson(baseUrl, `/api/workspaces/${workspaceId}/meeting-brief`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.brief).not.toBeNull();
    const brief = b.brief as Record<string, unknown>;
    expect(brief.workspaceId).toBe(workspaceId);
    expect(brief.situationSummary).toBe('Test summary.');
  });
});
