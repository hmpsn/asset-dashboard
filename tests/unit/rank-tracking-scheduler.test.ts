/**
 * Unit tests for the rank-tracking background scheduler.
 *
 * Verifies:
 * - runRankTrackingSnapshots() skips workspaces without GSC configured
 * - It calls getSearchOverview with ws.webflowSiteId (not ws.id)
 * - It stores a snapshot when GSC returns data
 * - It skips workspaces with no webflowSiteId
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock getSearchOverview — must be hoisted before any imports that use it
vi.mock('../../server/search-console.js', () => ({
  getSearchOverview: vi.fn(),
}));

import { runRankTrackingSnapshots } from '../../server/rank-tracking-scheduler.js';
import { getSearchOverview } from '../../server/search-console.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getLatestRanks, addTrackedKeyword } from '../../server/rank-tracking.js';

const mockGetSearchOverview = vi.mocked(getSearchOverview);

let testWsId = '';

beforeEach(() => {
  vi.clearAllMocks();
  // Create workspace WITHOUT webflowSiteId so tests can opt-in as needed
  const ws = createWorkspace('Scheduler Test Workspace');
  testWsId = ws.id;
});

afterEach(() => {
  if (testWsId) deleteWorkspace(testWsId);
  testWsId = '';
});

describe('runRankTrackingSnapshots', () => {
  it('skips workspaces with no gscPropertyUrl', async () => {
    // workspace has no GSC property set
    await runRankTrackingSnapshots([testWsId]);
    expect(mockGetSearchOverview).not.toHaveBeenCalled();
  });

  it('calls getSearchOverview with webflowSiteId, not workspace UUID', async () => {
    updateWorkspace(testWsId, {
      gscPropertyUrl: 'sc-domain:example.com',
      webflowSiteId: 'wf-site-abc123',  // explicitly set
    });
    mockGetSearchOverview.mockResolvedValueOnce({ topQueries: [] });

    await runRankTrackingSnapshots([testWsId]);

    expect(mockGetSearchOverview).toHaveBeenCalledWith(
      'wf-site-abc123',        // must be webflowSiteId, not the UUID
      'sc-domain:example.com',
      7,
    );
    expect(mockGetSearchOverview).not.toHaveBeenCalledWith(
      testWsId,                // workspace UUID must NOT be used
      expect.anything(),
      expect.anything(),
    );
  });

  it('skips workspaces with gscPropertyUrl but no webflowSiteId', async () => {
    updateWorkspace(testWsId, { gscPropertyUrl: 'sc-domain:example.com' });
    // webflowSiteId is undefined — no token can be found

    await runRankTrackingSnapshots([testWsId]);

    expect(mockGetSearchOverview).not.toHaveBeenCalled();
  });

  it('stores a snapshot when GSC returns query data', async () => {
    updateWorkspace(testWsId, {
      gscPropertyUrl: 'sc-domain:example.com',
      webflowSiteId: 'wf-site-abc123',  // explicitly set
    });
    mockGetSearchOverview.mockResolvedValueOnce({
      topQueries: [
        { query: 'seo audit tool', position: 4.2, clicks: 120, impressions: 900, ctr: 0.133 },
        { query: 'webflow seo', position: 7.1, clicks: 55, impressions: 410, ctr: 0.134 },
      ],
    });

    // Track the keyword so getLatestRanks can resolve it from the snapshot
    addTrackedKeyword(testWsId, 'seo audit tool');

    await runRankTrackingSnapshots([testWsId]);

    const latest = getLatestRanks(testWsId);
    expect(latest.length).toBeGreaterThan(0);
    const top = latest.find(r => r.query === 'seo audit tool');
    expect(top).toBeDefined();
    expect(top!.position).toBeCloseTo(4.2);
  });

  it('continues processing other workspaces when one throws', async () => {
    const ws2 = createWorkspace('Second WS', 'wf-site-second');
    updateWorkspace(testWsId, {
      gscPropertyUrl: 'sc-domain:example.com',
      webflowSiteId: 'wf-site-abc123',
    });
    updateWorkspace(ws2.id, {
      gscPropertyUrl: 'sc-domain:second.com',
      webflowSiteId: 'wf-site-second',
    });

    mockGetSearchOverview
      .mockRejectedValueOnce(new Error('GSC auth failed'))  // first workspace throws
      .mockResolvedValueOnce({ topQueries: [] });           // second workspace succeeds

    await runRankTrackingSnapshots([testWsId, ws2.id]);

    expect(mockGetSearchOverview).toHaveBeenCalledTimes(2);
    deleteWorkspace(ws2.id);
  });
});
