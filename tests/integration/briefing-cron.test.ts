/**
 * Integration tests for briefing-cron.runBriefingForWorkspace().
 *
 * Phase 2.5a: cron now uses deterministic story templates instead of an
 * AI call. Tests seed real `analytics_insights` rows + a workspace with
 * keyword strategy and verify the cron projects them into a draft.
 *
 * No HTTP — exercises the runner function directly. broadcast + email
 * are mocked at module level; index.ts is never imported here so we
 * avoid the "broadcast() called before init" startup error.
 *
 * The legacy AI-error / Zod-failure / fenced-JSON tests have been
 * removed: those code paths are no longer reachable from the main cron
 * path. The Phase 2.5d cleanup will delete the underlying scaffolding.
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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { runBriefingForWorkspace } from '../../server/briefing-cron.js';
import { getBriefingByWeek } from '../../server/briefing-store.js';
import { upsertSchedule } from '../../server/scheduled-audits.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';
import db from '../../server/db/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedRankingMover(wsId: string, pageOverride = '/services/fleet') {
  return upsertInsight({
    workspaceId: wsId,
    pageId: pageOverride,
    insightType: 'ranking_mover',
    severity: 'positive',
    data: {
      query: 'fleet maintenance austin',
      pageUrl: pageOverride,
      currentPosition: 4,
      previousPosition: 11,
      positionChange: 7, // positive = improved (moved up) per JSDoc
      currentClicks: 142,
      previousClicks: 23,
      impressions: 1840,
    },
    pageTitle: 'Fleet Maintenance — Austin',
    impactScore: 75,
  });
}

function seedRankingOpportunity(wsId: string, pageOverride = '/services/hvac') {
  return upsertInsight({
    workspaceId: wsId,
    pageId: pageOverride,
    insightType: 'ranking_opportunity',
    severity: 'opportunity',
    data: {
      query: 'hvac repair austin',
      pageUrl: pageOverride,
      currentPosition: 11,
      impressions: 2400,
      estimatedTrafficGain: 250,
    },
    pageTitle: 'HVAC Repair — Austin',
    impactScore: 68,
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('briefing-cron / runBriefingForWorkspace (deterministic templates)', () => {
  let wsCleanup: () => void;
  let wsId: string;

  beforeAll(() => {
    const seeded = seedWorkspace({ tier: 'growth' });
    wsId = seeded.workspaceId;
    wsCleanup = seeded.cleanup;
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
    db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(wsId);
    db.prepare('UPDATE workspaces SET last_briefing_run_week_of = NULL WHERE id = ?').run(wsId);
    vi.clearAllMocks();
  });

  it('skips workspaces on the free tier', async () => {
    db.prepare("UPDATE workspaces SET tier = 'free' WHERE id = ?").run(wsId);
    const r = await runBriefingForWorkspace(wsId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('free');
    db.prepare("UPDATE workspaces SET tier = 'growth' WHERE id = ?").run(wsId);
  });

  it('skips when no eligible stories can be projected', async () => {
    // The seeded `upsertSchedule` creates an audit_delta candidate (we need
    // it to pass the pre-flight freshness check), but no template handles
    // the period_change category from a raw audit_delta source — so without
    // any seeded analytics_insights, every candidate is rejected by templates.
    const r = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/no candidates|no eligible stories/);
  });

  it('generates a draft when seeded insights project into stories', async () => {
    seedRankingMover(wsId);
    seedRankingOpportunity(wsId);
    const r = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r.status).toBe('generated');
    const draft = getBriefingByWeek(wsId, r.weekOf);
    expect(draft).not.toBeNull();
    expect(draft!.stories.length).toBeGreaterThanOrEqual(1);
    // Voice contract: every story narrative cites a number AND avoids hedge words
    const HEDGES = /\b(potentially|could|may|appears to|suggests|might|seems)\b/i;
    for (const story of draft!.stories) {
      expect(story.narrative.length).toBeGreaterThan(0);
      expect(story.narrative).toMatch(/\d/); // contains a digit
      expect(story.narrative).not.toMatch(HEDGES);
      expect(story.dataReceipt).toBeTruthy();
    }
    // Source metadata records the deterministic-templates sentinel, not an AI model
    expect(draft!.sourceMetadata?.model).toBe('deterministic-templates-v1');
  });

  it('promotes one story to hero (isHeadline=true), excluding "competitive"', async () => {
    seedRankingMover(wsId); // win category
    seedRankingOpportunity(wsId); // opportunity category
    const r = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r.status).toBe('generated');
    const draft = getBriefingByWeek(wsId, r.weekOf);
    const heroes = draft!.stories.filter((s) => s.isHeadline);
    expect(heroes).toHaveLength(1);
    expect(heroes[0].category).not.toBe('competitive');
  });

  it('refuses to re-run when lastBriefingRunWeekOf matches current week', async () => {
    seedRankingMover(wsId);
    const r1 = await runBriefingForWorkspace(wsId, { manual: false });
    expect(r1.status).toBe('generated');
    const r2 = await runBriefingForWorkspace(wsId, { manual: false });
    expect(r2.status).toBe('duplicate');
  });

  it('manual: true bypasses the duplicate guard', async () => {
    seedRankingMover(wsId);
    const r1 = await runBriefingForWorkspace(wsId, { manual: false });
    expect(r1.status).toBe('generated');
    const r2 = await runBriefingForWorkspace(wsId, { manual: true });
    expect(r2.status).toBe('generated');
  });
});
