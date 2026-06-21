/**
 * Integration tests for strategy-issue-cron.runIssuePushForWorkspace() (The Issue, Phase 3).
 *
 * The pushed-Issue cron pre-bakes the weekly POV draft, marks the ISO week, and rings the
 * OPERATOR doorbell — exactly ONCE per ISO week per eligible workspace. These tests exercise
 * the runner function directly (no HTTP) and assert:
 *   - the cron pre-bakes the POV + marks the week + rings the doorbell exactly once;
 *   - a second run in the same week is a no-op (idempotent — DB week guard);
 *   - a flag-OFF workspace is skipped (never pre-baked, never doorbell);
 *   - manual-bypass forces a run even when the week is already stamped;
 *   - POV_UNCHANGED still counts as "ready" (the cheap no-op path).
 *
 * generateStrategyPov is mocked at module level so no live AI call fires. broadcast +
 * activity-log are mocked so we can assert the doorbell rang without a real WS/DB write.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Mocks (must come before any module that imports these transitively) ──────

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
}));

const generateStrategyPovMock = vi.fn();
vi.mock('../../server/strategy-pov-generator.js', () => ({
  generateStrategyPov: (...args: unknown[]) => generateStrategyPovMock(...args),
  POV_UNCHANGED: 'POV_UNCHANGED',
}));

const addActivityMock = vi.fn();
vi.mock('../../server/activity-log.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/activity-log.js')>(
    '../../server/activity-log.js',
  );
  return { ...actual, addActivity: (...args: unknown[]) => addActivityMock(...args) };
});

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { getWorkspace } from '../../server/workspaces.js';
import { runIssuePushForWorkspace } from '../../server/strategy-issue-cron.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedActiveRec(workspaceId: string, recId = 'rec-issue-1'): void {
  const ts = new Date().toISOString();
  const rec: Recommendation = {
    id: recId,
    workspaceId,
    priority: 'fix_now',
    type: 'content',
    title: `Rec ${recId}`,
    description: 'desc',
    insight: 'why this matters to the client',
    impact: 'high',
    effort: 'low',
    impactScore: 60,
    source: 'audit:content',
    affectedPages: ['/blog/example'],
    trafficAtRisk: 10,
    impressionsAtRisk: 500,
    estimatedGain: 'Capture meaningful organic demand',
    actionType: 'manual',
    targetKeyword: `keyword-${recId}`,
    status: 'pending',
    clientStatus: 'curated', // active for the operator (isActiveRec → true)
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
  };
  const recs = [rec];
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: ts,
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

function clearWeekMarker(workspaceId: string): void {
  db.prepare('UPDATE workspaces SET last_issue_pushed_week_of = NULL WHERE id = ?').run(workspaceId);
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('strategy-issue-cron / runIssuePushForWorkspace (The Issue, Phase 3)', () => {
  let wsCleanup: () => void;
  let wsId: string;

  beforeAll(() => {
    const seeded = seedWorkspace();
    wsId = seeded.workspaceId;
    wsCleanup = seeded.cleanup;
  });

  afterAll(() => {
    setWorkspaceFlagOverride('strategy-the-issue', wsId, null);
    wsCleanup();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    clearWeekMarker(wsId);
    setWorkspaceFlagOverride('strategy-the-issue', wsId, true);
    seedActiveRec(wsId);
    generateStrategyPovMock.mockReset();
    generateStrategyPovMock.mockResolvedValue({ situation: 'ok' });
    addActivityMock.mockReset();
    vi.mocked(broadcastToWorkspace).mockReset();
  });

  it('pre-bakes the POV, marks the week, and rings the doorbell exactly once for an eligible workspace', async () => {
    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('pushed');
    expect(r.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // (a) pre-baked the admin-variant POV exactly once
    expect(generateStrategyPovMock).toHaveBeenCalledTimes(1);
    expect(generateStrategyPovMock).toHaveBeenCalledWith(wsId, { variant: 'admin' });

    // (b) marked the week on the workspace row
    expect(getWorkspace(wsId)?.lastIssuePushedWeekOf).toBe(r.weekOf);

    // (c) rang the operator doorbell — activity entry + broadcast, exactly once each
    expect(addActivityMock).toHaveBeenCalledTimes(1);
    expect(addActivityMock).toHaveBeenCalledWith(
      wsId,
      'strategy_issue_pushed',
      expect.stringContaining('drafted and ready to curate'),
      undefined,
      expect.objectContaining({ weekOf: r.weekOf }),
    );
    expect(broadcastToWorkspace).toHaveBeenCalledTimes(1);
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      wsId,
      'strategy:issue-pushed',
      expect.objectContaining({ weekOf: r.weekOf }),
    );
  });

  it('a second run in the same week is a no-op (idempotent — DB week guard)', async () => {
    const r1 = await runIssuePushForWorkspace(wsId);
    expect(r1.status).toBe('pushed');

    const r2 = await runIssuePushForWorkspace(wsId);
    expect(r2.status).toBe('duplicate');
    expect(r2.weekOf).toBe(r1.weekOf);

    // The POV was pre-baked + doorbell rung only on the FIRST run.
    expect(generateStrategyPovMock).toHaveBeenCalledTimes(1);
    expect(addActivityMock).toHaveBeenCalledTimes(1);
    expect(broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('POV_UNCHANGED still counts as ready (cheap no-op path) and marks the week + rings the doorbell', async () => {
    generateStrategyPovMock.mockRejectedValueOnce(new Error('POV_UNCHANGED'));
    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('unchanged');
    expect(getWorkspace(wsId)?.lastIssuePushedWeekOf).toBe(r.weekOf);
    // Still rings the doorbell (the draft is already ready).
    expect(addActivityMock).toHaveBeenCalledTimes(1);
    expect(broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('skips a flag-OFF workspace — never pre-bakes, never rings the doorbell', async () => {
    setWorkspaceFlagOverride('strategy-the-issue', wsId, false);
    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('not eligible');
    expect(generateStrategyPovMock).not.toHaveBeenCalled();
    expect(addActivityMock).not.toHaveBeenCalled();
    expect(broadcastToWorkspace).not.toHaveBeenCalled();
    expect(getWorkspace(wsId)?.lastIssuePushedWeekOf ?? null).toBeNull();
  });

  it('skips a workspace with no active recommendation set (nothing to curate)', async () => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    expect(loadRecommendations(wsId)).toBeNull();
    const r = await runIssuePushForWorkspace(wsId);
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('not eligible');
    expect(generateStrategyPovMock).not.toHaveBeenCalled();
  });

  it('manual-bypass forces a run even when the week is already stamped', async () => {
    const r1 = await runIssuePushForWorkspace(wsId);
    expect(r1.status).toBe('pushed');

    const r2 = await runIssuePushForWorkspace(wsId, { manual: true });
    expect(r2.status).toBe('pushed'); // not 'duplicate'
    expect(r2.weekOf).toBe(r1.weekOf);

    // Manual bypass pre-baked + rang the doorbell a SECOND time.
    expect(generateStrategyPovMock).toHaveBeenCalledTimes(2);
    expect(addActivityMock).toHaveBeenCalledTimes(2);
    expect(broadcastToWorkspace).toHaveBeenCalledTimes(2);
  });
});
