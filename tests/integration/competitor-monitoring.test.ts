import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { detectCompetitorAlerts } from '../../server/competitor-snapshot-store.js';

let seed: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  seed = seedWorkspace({ tier: 'growth' });
});

afterAll(() => {
  seed.cleanup();
});

describe('competitor monitoring', () => {
  it('detectCompetitorAlerts surfaces keyword_gained when position improves by ≥5', () => {
    const ws = seed.workspaceId;
    const domain = 'competitor.com';
    const prev = {
      id: 'snap1', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-15',
      keywordCount: 10, organicTraffic: 5000, createdAt: '2026-04-15',
      topKeywords: [{ keyword: 'seo tools', position: 14, volume: 500 }],
    };
    const curr = {
      id: 'snap2', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-22',
      keywordCount: 10, organicTraffic: 5200, createdAt: '2026-04-22',
      topKeywords: [{ keyword: 'seo tools', position: 4, volume: 500 }],
    };
    const alerts = detectCompetitorAlerts(ws, domain, curr, prev);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertType).toBe('keyword_gained');
    expect(alerts[0].positionChange).toBe(10);
    expect(alerts[0].severity).toBe('critical');
  });

  it('detectCompetitorAlerts ignores low-volume keywords', () => {
    const ws = seed.workspaceId;
    const domain = 'competitor2.com';
    const prev = {
      id: 'snap3', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-15',
      keywordCount: 2, organicTraffic: 100, createdAt: '2026-04-15',
      topKeywords: [{ keyword: 'niche phrase', position: 10, volume: 50 }],
    };
    const curr = {
      id: 'snap4', workspaceId: ws, competitorDomain: domain, snapshotDate: '2026-04-22',
      keywordCount: 2, organicTraffic: 100, createdAt: '2026-04-22',
      topKeywords: [{ keyword: 'niche phrase', position: 2, volume: 50 }],
    };
    const alerts = detectCompetitorAlerts(ws, domain, curr, prev);
    expect(alerts).toHaveLength(0);
  });
});
