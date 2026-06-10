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
}: {
  tier?: Tier;
  ws?: WorkspaceInfo;
} = {}) {
  return buildClientDashboardNav({
    ws,
    effectiveTier: tier,
    betaMode: false,
    contentPlanSummary: null,
    strategyData: { keywords: [] } as unknown,
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
