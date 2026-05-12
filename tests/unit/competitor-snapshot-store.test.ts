import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  detectCompetitorAlerts,
  getLatestCompetitorSnapshot,
  linkAlertToInsight,
  listUnlinkedCompetitorAlerts,
  saveCompetitorAlerts,
  saveCompetitorSnapshot,
  snapshotExistsForDate,
} from '../../server/competitor-snapshot-store.js';

const WS_ID = 'competitor-store-ws';
const OTHER_WS_ID = 'competitor-store-other-ws';
const DOMAIN = 'competitor.example.com';

describe('competitor-snapshot-store', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM competitor_alerts WHERE workspace_id LIKE 'competitor-store-%'").run();
    db.prepare("DELETE FROM competitor_snapshots WHERE workspace_id LIKE 'competitor-store-%'").run();
  });

  it('saves snapshots and returns the latest by snapshot date', () => {
    saveCompetitorSnapshot(WS_ID, DOMAIN, '2026-05-01', [{ keyword: 'old keyword', position: 8, volume: 500 }], 1, 1000);
    const latest = saveCompetitorSnapshot(WS_ID, DOMAIN, '2026-05-02', [{ keyword: 'new keyword', position: 2, volume: 900 }], 1, 2000);

    expect(latest.keywordCount).toBe(1);
    expect(getLatestCompetitorSnapshot(WS_ID, DOMAIN)?.topKeywords[0].keyword).toBe('new keyword');
    expect(snapshotExistsForDate(WS_ID, DOMAIN, '2026-05-02')).toBe(true);
    expect(snapshotExistsForDate(WS_ID, DOMAIN, '2026-05-03')).toBe(false);
    expect(getLatestCompetitorSnapshot(OTHER_WS_ID, DOMAIN)).toBeNull();
  });

  it('detects new, gained, and lost keyword alerts with severity', () => {
    const previous = saveCompetitorSnapshot(WS_ID, DOMAIN, '2026-05-01', [
      { keyword: 'ranking gain', position: 15, volume: 1000 },
      { keyword: 'lost keyword', position: 5, volume: 800 },
      { keyword: 'small volume', position: 8, volume: 20 },
    ]);
    const current = saveCompetitorSnapshot(WS_ID, DOMAIN, '2026-05-02', [
      { keyword: 'ranking gain', position: 4, volume: 1000 },
      { keyword: 'new winner', position: 2, volume: 700 },
      { keyword: 'small volume', position: 1, volume: 20 },
    ]);

    const alerts = detectCompetitorAlerts(WS_ID, DOMAIN, current, previous, { positionChangeThreshold: 5, minVolume: 100 });

    expect(alerts.map(a => a.alertType).sort()).toEqual(['keyword_gained', 'keyword_lost', 'new_keyword']);
    expect(alerts.find(a => a.keyword === 'ranking gain')).toMatchObject({ positionChange: 11, severity: 'critical' });
    expect(alerts.find(a => a.keyword === 'new winner')).toMatchObject({ alertType: 'new_keyword', severity: 'critical' });
    expect(alerts.find(a => a.keyword === 'small volume')).toBeUndefined();
    expect(listUnlinkedCompetitorAlerts(WS_ID)).toHaveLength(0);

    saveCompetitorAlerts(alerts);
    expect(listUnlinkedCompetitorAlerts(WS_ID)).toHaveLength(3);
  });

  it('links alerts to insights and removes them from the unlinked queue', () => {
    const previous = saveCompetitorSnapshot(WS_ID, DOMAIN, '2026-05-01', [
      { keyword: 'ranking gain', position: 20, volume: 1000 },
    ]);
    const current = saveCompetitorSnapshot(WS_ID, DOMAIN, '2026-05-02', [
      { keyword: 'ranking gain', position: 10, volume: 1000 },
    ]);
    const [alert] = detectCompetitorAlerts(WS_ID, DOMAIN, current, previous);
    saveCompetitorAlerts([alert]);

    linkAlertToInsight(alert.id, 'insight-1', WS_ID);

    expect(listUnlinkedCompetitorAlerts(WS_ID)).toEqual([]);
  });
});
