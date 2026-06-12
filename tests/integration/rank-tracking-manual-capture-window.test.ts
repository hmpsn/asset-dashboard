/**
 * Integration test for the manual "Capture snapshot" route's GSC metric window
 * (Keyword Universe Overhaul, Task 4).
 *
 * The manual capture route (POST /api/rank-tracking/:workspaceId/snapshot) used
 * to pass a hard-coded `7`-day window to getSearchOverview, while the daily
 * scheduler used 28. Because both UPSERT into rank_snapshots under the same date
 * key, the displayed clicks/impressions swung ~4× depending on which ran last.
 *
 * This test asserts the route now fetches with days === GSC_METRIC_WINDOW_DAYS
 * (28), unifying the manual + scheduled windows.
 *
 * Architecture: in-process Express app mounting the rank-tracking router with
 * search-console mocked, so vi.mock intercepts the GSC fetch and we can assert
 * its call args. (The spawned out-of-process server used by the sibling
 * rank-tracking integration tests cannot observe vi.mock.) Port: dynamic
 * (listen(0)) — no port conflict possible.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ── search-console mock (hoisted so vi.mock runs before the router imports it) ──
const gscState = vi.hoisted(() => ({
  calls: [] as unknown[][],
}));

vi.mock('../../server/search-console.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/search-console.js')>();
  return {
    ...actual,
    getSearchOverview: vi.fn(async (...args: unknown[]) => {
      gscState.calls.push(args);
      return {
        totalClicks: 0,
        totalImpressions: 0,
        avgCtr: 0,
        avgPosition: 0,
        topQueries: [
          { query: 'cosmetic dentistry', clicks: 12, impressions: 300, ctr: 4, position: 6.1 },
        ],
        topPages: [],
        dateRange: { start: '2026-05-08', end: '2026-06-02' },
      };
    }),
  };
});

// Isolate the route from the side-effect collaborators — this test only asserts
// the GSC fetch window, not the snapshot store / activity / broadcast plumbing.
vi.mock('../../server/rank-tracking.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/rank-tracking.js')>();
  return { ...actual, storeRankSnapshot: vi.fn() };
});

vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// ── deferred imports (after vi.mock) ───────────────────────────────────────────
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { getSearchOverview } from '../../server/search-console.js';
import { GSC_METRIC_WINDOW_DAYS } from '../../shared/keyword-window.js';

const mockGetSearchOverview = vi.mocked(getSearchOverview);

let baseUrl = '';
let server: http.Server | null = null;
let wsId = '';

beforeAll(async () => {
  const { default: rankTrackingRouter } = await import('../../server/routes/rank-tracking.js');
  const app = express();
  app.use(express.json());
  app.use(rankTrackingRouter);
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const ws = createWorkspace('Manual Capture Window WS', 'wf-site-manual-capture');
  wsId = ws.id;
  // The route requires BOTH a GSC property and a Webflow site to reach the fetch.
  updateWorkspace(wsId, {
    gscPropertyUrl: 'sc-domain:example.com',
    webflowSiteId: 'wf-site-manual-capture',
  });
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close(err => (err ? reject(err) : resolve()));
    });
  }
});

describe('POST /api/rank-tracking/:workspaceId/snapshot — metric window', () => {
  it('invokes getSearchOverview with days === GSC_METRIC_WINDOW_DAYS (28), not 7', async () => {
    mockGetSearchOverview.mockClear();
    gscState.calls.length = 0;

    const res = await fetch(`${baseUrl}/api/rank-tracking/${wsId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    expect(mockGetSearchOverview).toHaveBeenCalledTimes(1);
    const callArgs = mockGetSearchOverview.mock.calls[0];
    // signature: getSearchOverview(siteId, gscSiteUrl, days, ...)
    expect(callArgs[0]).toBe('wf-site-manual-capture');
    expect(callArgs[1]).toBe('sc-domain:example.com');
    expect(callArgs[2]).toBe(GSC_METRIC_WINDOW_DAYS);
    expect(callArgs[2]).toBe(28);
    // Regression guard: the old hard-coded 7-day window must be gone.
    expect(callArgs[2]).not.toBe(7);
  });
});
