import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock GA4 at the module boundary so the in-process cron does not make real network calls.
// getGA4Conversions returns conversions for connected workspaces; the magic property id
// 'GA4_ERROR' throws so the FM-2 honest-degradation path is exercised.
vi.mock('../../server/google-analytics.js', () => ({
  getGA4Conversions: vi.fn(async (propertyId: string) => {
    if (propertyId === 'GA4_ERROR') throw new Error('GA4 unavailable');
    return [
      { eventName: 'phone_call', conversions: 5, users: 40, rate: 4 },
      { eventName: 'form_submit', conversions: 3, users: 20, rate: 2 },
    ];
  }),
}));

import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { runGa4ConversionSnapshots } from '../../server/ga4-conversion-snapshot-scheduler.js';
import { loadGa4SnapshotHistory } from '../../server/ga4-snapshots.js';
import { updateWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
let wsId: string;
let cleanup: () => void;

beforeAll(async () => {
  await ctx.startServer();
  const s = seedWorkspace();
  wsId = s.workspaceId;
  cleanup = s.cleanup;
  updateWorkspace(wsId, { ga4PropertyId: '123456' });
});
afterAll(async () => {
  cleanup();
  await ctx.stopServer();
});

describe('runGa4ConversionSnapshots', () => {
  it('persists one snapshot row per GA4-connected workspace per pass', async () => {
    await runGa4ConversionSnapshots();
    const hist = loadGa4SnapshotHistory(wsId);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[hist.length - 1].totalConversions).toBe(8); // 5 + 3
  });
  it('skips (no throw) a workspace whose GA4 call errors — FM-2 honest degradation', async () => {
    const s2 = seedWorkspace();
    updateWorkspace(s2.workspaceId, { ga4PropertyId: 'GA4_ERROR' });
    await expect(runGa4ConversionSnapshots()).resolves.not.toThrow();
    expect(loadGa4SnapshotHistory(s2.workspaceId)).toHaveLength(0);
    s2.cleanup();
  });
});
