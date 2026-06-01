/**
 * PR7 · Spine B — decay & rank-decline detector tests.
 *
 * Calls the extracted detectors (server/scoring/opportunity-detectors.ts) directly
 * with real DB-backed dependencies mocked at the source-read layer. Verifies:
 *   1. Flag OFF → writes NO opportunity events and triggers NO regen.
 *   2. Flag ON → writes a `decay` / `rank_drop` event for each high-urgency row and
 *      enqueues exactly one debounced regen per affected workspace.
 *
 * triggerOpportunityRegen is mocked (its debounce/dynamic-import behaviour is
 * covered by opportunity-regen-debounce.test.ts) so the detector test asserts the
 * "enqueue once per workspace" contract without booting the rec pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  listWorkspaces: vi.fn(),
  loadDecayAnalysis: vi.fn(),
  getLatestRanks: vi.fn(),
  insertOpportunityEvent: vi.fn(),
  triggerOpportunityRegen: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/feature-flags.js', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('../../server/workspaces.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../../server/content-decay.js', () => ({ loadDecayAnalysis: mocks.loadDecayAnalysis }));
vi.mock('../../server/rank-tracking.js', () => ({ getLatestRanks: mocks.getLatestRanks }));
vi.mock('../../server/opportunity-events.js', () => ({ insertOpportunityEvent: mocks.insertOpportunityEvent }));
vi.mock('../../server/scoring/opportunity-regen.js', () => ({ triggerOpportunityRegen: mocks.triggerOpportunityRegen }));

import { runDecayDetector, runRankDeclineDetector, RANK_DROP_MIN_DELTA } from '../../server/scoring/opportunity-detectors.js';

const DECAY_ANALYSIS = {
  workspaceId: 'ws_decay',
  analyzedAt: '2026-05-25T00:00:00.000Z',
  totalPages: 10,
  decayingPages: [
    { page: '/services/hvac', severity: 'critical', clickDeclinePct: -90 },
    { page: '/blog/old', severity: 'warning', isRepeatDecay: true, clickDeclinePct: -37 },
    { page: '/blog/fine', severity: 'watch', clickDeclinePct: -6 },
  ],
  summary: { critical: 1, warning: 1, watch: 1, totalDecaying: 3, avgDeclinePct: -44 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkspaces.mockReturnValue([{ id: 'ws_decay' }]);
  mocks.loadDecayAnalysis.mockReturnValue(DECAY_ANALYSIS);
  mocks.getLatestRanks.mockReturnValue([]);
});

afterEach(() => vi.clearAllMocks());

describe('runDecayDetector', () => {
  it('writes NO events and triggers NO regen when the events flag is OFF', () => {
    mocks.isFeatureEnabled.mockReturnValue(false);
    const result = runDecayDetector();
    expect(result).toEqual({ workspacesWithEvents: 0, totalEvents: 0 });
    expect(mocks.insertOpportunityEvent).not.toHaveBeenCalled();
    expect(mocks.triggerOpportunityRegen).not.toHaveBeenCalled();
  });

  it('writes a decay event for critical + repeat-decay pages and triggers one regen when ON', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    const result = runDecayDetector();

    // critical + repeat-decay = 2; the 'watch' page is skipped.
    expect(result).toEqual({ workspacesWithEvents: 1, totalEvents: 2 });
    expect(mocks.insertOpportunityEvent).toHaveBeenCalledTimes(2);
    const pagePaths = mocks.insertOpportunityEvent.mock.calls.map(c => c[0].pagePath).sort();
    expect(pagePaths).toEqual(['/blog/old', '/services/hvac']);
    for (const call of mocks.insertOpportunityEvent.mock.calls) {
      expect(call[0].type).toBe('decay');
      expect(call[0].workspaceId).toBe('ws_decay');
      expect(call[0].boost).toBeGreaterThan(0);
      expect(call[0].halfLifeDays).toBeGreaterThan(0);
    }
    // One debounced regen for the affected workspace.
    expect(mocks.triggerOpportunityRegen).toHaveBeenCalledTimes(1);
    expect(mocks.triggerOpportunityRegen).toHaveBeenCalledWith('ws_decay');
  });

  it('gives a repeat-decay page a higher boost than a plain critical page', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    runDecayDetector();
    const byPage = new Map(mocks.insertOpportunityEvent.mock.calls.map(c => [c[0].pagePath, c[0].boost]));
    expect(byPage.get('/blog/old')!).toBeGreaterThan(byPage.get('/services/hvac')!);
  });

  it('does nothing for a workspace with no persisted decay analysis', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    mocks.loadDecayAnalysis.mockReturnValue(null);
    const result = runDecayDetector();
    expect(result).toEqual({ workspacesWithEvents: 0, totalEvents: 0 });
    expect(mocks.triggerOpportunityRegen).not.toHaveBeenCalled();
  });
});

describe('runRankDeclineDetector', () => {
  it('writes NO events when the events flag is OFF', () => {
    mocks.isFeatureEnabled.mockReturnValue(false);
    mocks.getLatestRanks.mockReturnValue([
      { query: 'hvac', position: 12, change: -5, pagePath: '/services/hvac', clicks: 0, impressions: 0, ctr: 0 },
    ]);
    expect(runRankDeclineDetector()).toEqual({ workspacesWithEvents: 0, totalEvents: 0 });
    expect(mocks.insertOpportunityEvent).not.toHaveBeenCalled();
  });

  it('emits a rank_drop event only for crossings past the threshold', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    mocks.getLatestRanks.mockReturnValue([
      // change = prev − current; NEGATIVE = dropped. -5 ≤ -RANK_DROP_MIN_DELTA → crossing.
      { query: 'big drop', position: 12, change: -5, pagePath: '/services/hvac', clicks: 0, impressions: 0, ctr: 0 },
      // -1 is a small drop, NOT a crossing → skipped.
      { query: 'small drop', position: 6, change: -1, pagePath: '/services/plumbing', clicks: 0, impressions: 0, ctr: 0 },
      // improvement (moved up) → skipped.
      { query: 'improved', position: 3, change: 4, pagePath: '/services/electric', clicks: 0, impressions: 0, ctr: 0 },
      // no pagePath → skipped.
      { query: 'untracked', position: 20, change: -8, clicks: 0, impressions: 0, ctr: 0 },
    ]);
    const result = runRankDeclineDetector();
    expect(result).toEqual({ workspacesWithEvents: 1, totalEvents: 1 });
    expect(mocks.insertOpportunityEvent).toHaveBeenCalledTimes(1);
    const ev = mocks.insertOpportunityEvent.mock.calls[0][0];
    expect(ev.type).toBe('rank_drop');
    expect(ev.pagePath).toBe('/services/hvac');
    expect(ev.keyword).toBe('big drop');
    expect(mocks.triggerOpportunityRegen).toHaveBeenCalledWith('ws_decay');
  });

  it('exposes a positive RANK_DROP_MIN_DELTA threshold', () => {
    expect(RANK_DROP_MIN_DELTA).toBeGreaterThan(0);
  });
});
