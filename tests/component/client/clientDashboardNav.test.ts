import { describe, it, expect } from 'vitest';
import { buildClientDashboardNav } from '../../../src/components/client/client-dashboard/clientDashboardNav';
import type { WorkspaceInfo } from '../../../src/components/client/types';
import type { Tier } from '../../../src/components/ui';

// Minimal WorkspaceInfo factory — only fields used by buildClientDashboardNav
function makeWs(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: 'ws-1',
    name: 'Test',
    ...overrides,
  };
}

function callNav({
  tier = 'growth' as Tier,
  ws = makeWs(),
  betaMode = false,
  contentPlanSummary = null,
  strategyData = { keywords: [] } as unknown,
  clientIaV2 = false,
}: {
  tier?: Tier;
  ws?: WorkspaceInfo;
  betaMode?: boolean;
  contentPlanSummary?: { totalCells: number } | null;
  strategyData?: unknown;
  clientIaV2?: boolean;
} = {}) {
  return buildClientDashboardNav({
    ws,
    effectiveTier: tier,
    betaMode,
    contentPlanSummary,
    strategyData,
    clientIaV2,
  });
}

describe('buildClientDashboardNav — strategy item visibility + lock', () => {
  it('free tier + seoClientView=true → strategy present and locked', () => {
    const nav = callNav({ tier: 'free', ws: makeWs({ seoClientView: true }) });
    const stratItem = nav.find(n => n.id === 'strategy');
    expect(stratItem).toBeDefined();
    expect(stratItem?.locked).toBe(true);
  });

  it('paid tier + seoClientView=false → strategy absent (hidden, no upgrade path)', () => {
    const nav = callNav({ tier: 'growth', ws: makeWs({ seoClientView: false }) });
    const stratItem = nav.find(n => n.id === 'strategy');
    expect(stratItem).toBeUndefined();
  });

  it('paid tier + seoClientView=true → strategy present and unlocked', () => {
    const nav = callNav({ tier: 'growth', ws: makeWs({ seoClientView: true }) });
    const stratItem = nav.find(n => n.id === 'strategy');
    expect(stratItem).toBeDefined();
    expect(stratItem?.locked).toBe(false);
  });

  it('paid tier + seoClientView=undefined → strategy present and unlocked (default open)', () => {
    const nav = callNav({ tier: 'growth', ws: makeWs({ seoClientView: undefined }) });
    const stratItem = nav.find(n => n.id === 'strategy');
    expect(stratItem).toBeDefined();
    expect(stratItem?.locked).toBe(false);
  });

  it('free tier + seoClientView=false → strategy absent (hidden takes precedence)', () => {
    const nav = callNav({ tier: 'free', ws: makeWs({ seoClientView: false }) });
    const stratItem = nav.find(n => n.id === 'strategy');
    expect(stratItem).toBeUndefined();
  });
});

describe('buildClientDashboardNav — Client IA v2 flag branch', () => {
  it('clientIaV2=true (paid, non-beta, strategyData) → exactly [overview, inbox, results, deep-dive, settings]', () => {
    const nav = callNav({
      tier: 'growth',
      betaMode: false,
      strategyData: { keywords: [] } as unknown,
      ws: makeWs({ seoClientView: true }),
      clientIaV2: true,
    });
    expect(nav.map(n => n.id)).toEqual(['overview', 'inbox', 'results', 'deep-dive', 'settings']);
    expect(nav.map(n => n.label)).toEqual(['Overview', 'Inbox', 'Results', 'Deep Dive', 'Settings']);
    expect(nav.length).toBe(5);
    // None of the IA v2 shell tabs are tier-locked. Non-vacuous: nav is the 5-item set asserted above.
    expect(nav.every(n => n.locked === false)).toBe(true); // every-ok
  });

  it('clientIaV2=true free tier → Inbox + Results dropped (paid-gated), Overview/Deep Dive/Settings remain', () => {
    const nav = callNav({ tier: 'free', clientIaV2: true });
    expect(nav.map(n => n.id)).toEqual(['overview', 'deep-dive', 'settings']);
  });

  it('clientIaV2=true paid beta → Results dropped (betaMode gate), Inbox remains', () => {
    const nav = callNav({ tier: 'premium', betaMode: true, clientIaV2: true });
    expect(nav.map(n => n.id)).toEqual(['overview', 'inbox', 'deep-dive', 'settings']);
  });

  it('clientIaV2=true paid, no strategyData → Results dropped, Inbox remains', () => {
    const nav = callNav({ tier: 'growth', strategyData: null, clientIaV2: true });
    expect(nav.map(n => n.id)).toEqual(['overview', 'inbox', 'deep-dive', 'settings']);
  });

  it('clientIaV2=false → returns the EXACT pre-existing legacy nav (byte-identical)', () => {
    // Snapshot of the legacy 11-tab nav for a paid, non-beta workspace with
    // strategy visible + strategyData present. This locks the flag-OFF branch so
    // the IA v2 collapse can never silently mutate the legacy shell.
    const nav = callNav({
      tier: 'growth',
      betaMode: false,
      contentPlanSummary: null,
      strategyData: { keywords: [] } as unknown,
      ws: makeWs({ seoClientView: true }),
      clientIaV2: false,
    });
    expect(nav.map(n => ({ id: n.id, label: n.label, locked: n.locked }))).toEqual([
      { id: 'overview', label: 'Insights', locked: false },
      { id: 'performance', label: 'Performance', locked: false },
      { id: 'health', label: 'Site Health', locked: false },
      { id: 'strategy', label: 'SEO Strategy', locked: false },
      { id: 'inbox', label: 'Inbox', locked: false },
      { id: 'plans', label: 'Plans', locked: false },
      { id: 'roi', label: 'ROI', locked: false },
      { id: 'brand', label: 'Brand', locked: false },
    ]);
  });
});
