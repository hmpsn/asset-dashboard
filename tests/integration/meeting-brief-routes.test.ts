// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { upsertMeetingBrief } from '../../server/meeting-brief-store.js';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

const BASE_BRIEF = {
  workspaceId: '',
  generatedAt: '2026-05-18T00:00:00.000Z',
  situationSummary: 'A concise summary.',
  wins: ['Win'],
  attention: ['Attention'],
  recommendations: [{ action: 'Do this', rationale: 'Because it helps' }],
  blueprintProgress: null,
  metrics: {
    siteHealthScore: 81,
    openRankingOpportunities: 2,
    contentInPipeline: 3,
    overallWinRate: 67,
    criticalIssues: 1,
  },
};

vi.mock('../../server/meeting-brief-generator.js', () => ({
  assembleMeetingBriefMetrics: vi.fn(),
  buildBriefPrompt: vi.fn(),
  generateMeetingBrief: vi.fn(async (workspaceId: string) => ({ ...BASE_BRIEF, workspaceId })),
}));

import { generateMeetingBrief as mockGenerateMeetingBrief } from '../../server/meeting-brief-generator.js';

const REQUEST_TIMEOUT_MS = 20_000;

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('integration: meeting brief routes', () => {
  let seeded: SeededFullWorkspace;
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    closeServer = server.close;
  }, REQUEST_TIMEOUT_MS);

  afterAll(async () => {
    await closeServer?.();
  }, REQUEST_TIMEOUT_MS);

  beforeEach(() => {
    seeded = seedWorkspace();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.prepare('DELETE FROM meeting_briefs WHERE workspace_id = ?').run(seeded.workspaceId);
    seeded.cleanup();
  });

  it('returns 500 when BRIEF_UNCHANGED is reported but no cached brief exists', async () => {
    vi.mocked(mockGenerateMeetingBrief).mockRejectedValueOnce(new Error('BRIEF_UNCHANGED'));

    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/meeting-brief/generate`, {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({}));

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to generate meeting brief' });
  });

  it('returns cached brief with unchanged=true when BRIEF_UNCHANGED is reported and cache exists', async () => {
    upsertMeetingBrief({ ...BASE_BRIEF, workspaceId: seeded.workspaceId, situationSummary: 'Cached brief' });
    vi.mocked(mockGenerateMeetingBrief).mockRejectedValueOnce(new Error('BRIEF_UNCHANGED'));

    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/meeting-brief/generate`, {
      method: 'POST',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unchanged).toBe(true);
    expect(body.brief).toMatchObject({
      workspaceId: seeded.workspaceId,
      situationSummary: 'Cached brief',
    });
  });
});
