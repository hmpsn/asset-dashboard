/**
 * Integration tests for briefing-cron.runBriefingForWorkspace().
 *
 * Covers the per-workspace briefing runner contract:
 * - Tier gate (free → skipped)
 * - Duplicate-week guard + manual bypass
 * - AI invalid-JSON / invalid-schema → skipped
 * - Happy path → generated draft persisted
 *
 * No HTTP — exercises the runner function directly. broadcast + email are
 * mocked at module level; index.ts is never imported here so we avoid the
 * "broadcast() called before init" startup error.
 *
 * Note: callAI() is the unified AI dispatcher (server/ai.ts → returns { text, tokens }).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Mocks (must come before any module that imports these transitively) ──────

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../../server/email.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/email.js')>('../../server/email.js');
  return {
    ...actual,
    notifyClientBriefingReady: vi.fn(),
    isEmailConfigured: () => false,
  };
});

vi.mock('../../server/ai.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/ai.js')>('../../server/ai.js');
  return {
    ...actual,
    callAI: vi.fn(),
  };
});

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { runBriefingForWorkspace } from '../../server/briefing-cron.js';
import { getBriefingByWeek } from '../../server/briefing-store.js';
import { upsertSchedule } from '../../server/scheduled-audits.js';
import db from '../../server/db/index.js';
import { callAI } from '../../server/ai.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAIResponse(stories: Array<Record<string, unknown>>) {
  return {
    text: JSON.stringify({ stories }),
    tokens: { prompt: 10, completion: 20, total: 30 },
  };
}

function validStoryFixture() {
  return [
    {
      id: 's1',
      category: 'win',
      isHeadline: true,
      headline: 'Organic traffic rose 12% this week',
      narrative: 'Your top landing pages drove a sustained increase in organic visits.',
      metrics: [],
      drillIn: { page: 'performance' },
      sourceRefs: [],
    },
    {
      id: 's2',
      category: 'risk',
      isHeadline: false,
      headline: 'Two pages slowed below the LCP threshold',
      narrative: 'Two product pages now load slower than 2.5s; worth a perf audit.',
      metrics: [],
      drillIn: { page: 'health' },
      sourceRefs: [],
    },
    {
      id: 's3',
      category: 'opportunity',
      isHeadline: false,
      headline: 'New ranking opportunity surfaced',
      narrative: 'A keyword cluster gained 4 positions, sitting just outside the top-3.',
      metrics: [],
      drillIn: { page: 'strategy' },
      sourceRefs: [],
    },
  ];
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('briefing-cron / runBriefingForWorkspace', () => {
  let wsCleanup: () => void;
  let wsId: string;

  beforeAll(() => {
    const seeded = seedWorkspace({ tier: 'growth' });
    wsId = seeded.workspaceId;
    wsCleanup = seeded.cleanup;
    // Seed a fresh audit run so the pre-flight freshness check passes for non-manual tests.
    // (Without this, the runner defers up to 3 times before generating.)
    upsertSchedule(wsId, {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 10,
      lastRunAt: new Date().toISOString(),
      lastScore: 85,
    });
  });

  afterAll(() => {
    wsCleanup();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(wsId);
    db.prepare('UPDATE workspaces SET last_briefing_run_week_of = NULL WHERE id = ?').run(wsId);
    vi.mocked(callAI).mockReset();
  });

  it('generates a draft and persists it for an eligible workspace', async () => {
    vi.mocked(callAI).mockResolvedValue(makeAIResponse(validStoryFixture()));
    const r = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r.status).toBe('generated');
    const draft = getBriefingByWeek(wsId, r.weekOf);
    expect(draft?.stories).toHaveLength(3);
    expect(draft?.status).toBe('draft');
  });

  it('skips workspaces on the free tier', async () => {
    db.prepare("UPDATE workspaces SET tier = 'free' WHERE id = ?").run(wsId);
    const r = await runBriefingForWorkspace(wsId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('free');
    db.prepare("UPDATE workspaces SET tier = 'growth' WHERE id = ?").run(wsId);
  });

  it('refuses to re-run when lastBriefingRunWeekOf matches current week', async () => {
    vi.mocked(callAI).mockResolvedValue(makeAIResponse(validStoryFixture()));
    const r1 = await runBriefingForWorkspace(wsId, { manual: false });
    expect(r1.status).toBe('generated');
    const r2 = await runBriefingForWorkspace(wsId, { manual: false });
    expect(r2.status).toBe('duplicate');
  });

  it('manual: true bypasses the duplicate guard', async () => {
    vi.mocked(callAI).mockResolvedValue(makeAIResponse(validStoryFixture()));
    const r1 = await runBriefingForWorkspace(wsId, { manual: false });
    expect(r1.status).toBe('generated');
    const r2 = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r2.status).toBe('generated');
  });

  it('returns "skipped" when AI response is invalid JSON', async () => {
    vi.mocked(callAI).mockResolvedValue({
      text: 'not valid json',
      tokens: { prompt: 10, completion: 20, total: 30 },
    });
    const r = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('AI response invalid');
  });

  it('returns "skipped" when AI response fails Zod validation (only 2 stories)', async () => {
    vi.mocked(callAI).mockResolvedValue(makeAIResponse(validStoryFixture().slice(0, 2)));
    const r = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r.status).toBe('skipped');
  });
});
