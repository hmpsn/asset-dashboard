import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  getCompetitorCompare,
  getInternalLinks,
  getLatestCompetitorCompareForSite,
  getLinkCheck,
  getPageSpeed,
  getPageWeight,
  getSinglePageSpeed,
  listCompetitorCompares,
  saveCompetitorCompare,
  saveInternalLinks,
  saveLinkCheck,
  savePageSpeed,
  savePageWeight,
  saveSinglePageSpeed,
} from '../../server/performance-store.js';

const SITE_ID = 'perf-store-site';
const OTHER_SITE_ID = 'perf-store-other';
const MY_URL = 'https://perf-store.example.com/';
const COMPETITOR_URL = 'https://competitor.example.com/';

function cleanup() {
  db.prepare("DELETE FROM performance_snapshots WHERE site_id LIKE 'perf-store-%' OR site_id LIKE 'perf_store_%'").run();
}

describe('performance-store', () => {
  beforeEach(cleanup);

  it('saves and retrieves each performance snapshot subtype independently', () => {
    savePageWeight(SITE_ID, { totalBytes: 1234 });
    savePageSpeed(SITE_ID, 'mobile', { score: 91 });
    saveLinkCheck(SITE_ID, { brokenLinks: 2 });
    saveInternalLinks(SITE_ID, { orphanPages: ['/old'] });

    expect(getPageWeight(SITE_ID)?.result).toEqual({ totalBytes: 1234 });
    expect(getPageSpeed(SITE_ID, 'mobile')?.result).toEqual({ score: 91 });
    expect(getLinkCheck(SITE_ID)?.result).toEqual({ brokenLinks: 2 });
    expect(getInternalLinks(SITE_ID)?.result).toEqual({ orphanPages: ['/old'] });
    expect(getPageWeight(OTHER_SITE_ID)).toBeNull();
  });

  it('overwrites snapshots with the same subtype and site id', () => {
    savePageSpeed(SITE_ID, 'mobile', { score: 70 });
    savePageSpeed(SITE_ID, 'mobile', { score: 95 });

    expect(getPageSpeed(SITE_ID, 'mobile')?.result).toEqual({ score: 95 });
  });

  it('stores mobile and desktop PageSpeed snapshots independently', () => {
    savePageSpeed(SITE_ID, 'mobile', { score: 70 });
    savePageSpeed(SITE_ID, 'desktop', { score: 95 });

    expect(getPageSpeed(SITE_ID, 'mobile')?.result).toEqual({ score: 70 });
    expect(getPageSpeed(SITE_ID, 'desktop')?.result).toEqual({ score: 95 });
  });

  it('falls back to legacy PageSpeed snapshots for mobile reads only', () => {
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots
        (sub, site_id, created_at, result)
      VALUES ('pagespeed', ?, ?, ?)
    `).run(SITE_ID, new Date().toISOString(), JSON.stringify({ score: 82 }));

    expect(getPageSpeed(SITE_ID, 'mobile')?.result).toEqual({ score: 82 });
    expect(getPageSpeed(SITE_ID, 'desktop')).toBeNull();
  });

  it('stores single-page PageSpeed snapshots by page key', () => {
    saveSinglePageSpeed(SITE_ID, '/services', { score: 88 });
    saveSinglePageSpeed(SITE_ID, '/blog', { score: 77 });

    expect(getSinglePageSpeed(SITE_ID, '/services')?.result).toEqual({ score: 88 });
    expect(getSinglePageSpeed(SITE_ID, '/blog')?.result).toEqual({ score: 77 });
    expect(getSinglePageSpeed(SITE_ID, '/missing')).toBeNull();
  });

  it('normalizes competitor comparison keys and lists saved comparisons', () => {
    saveCompetitorCompare(MY_URL, COMPETITOR_URL, {
      mySite: { url: 'https://perf-store.example.com' },
      competitor: { url: 'https://competitor.example.com' },
      winner: 'mine',
    });

    expect(getCompetitorCompare('http://perf-store.example.com', 'http://competitor.example.com')?.result).toMatchObject({ winner: 'mine' });

    const list = listCompetitorCompares().filter(item => item.myUrl?.includes('perf-store.example.com'));
    expect(list).toHaveLength(1);
    expect(list[0].competitorUrl).toBe('https://competitor.example.com');
  });

  it('returns the latest competitor comparison for a site and skips malformed rows', () => {
    saveCompetitorCompare(MY_URL, 'https://alpha.example.com', {
      mySite: { url: 'https://perf-store.example.com' },
      competitor: { url: 'https://alpha.example.com' },
      label: 'old',
    });
    saveCompetitorCompare(MY_URL, 'https://beta.example.com', {
      mySite: { url: 'https://perf-store.example.com/' },
      competitor: { url: 'https://beta.example.com' },
      label: 'new',
    });
    db.prepare("UPDATE performance_snapshots SET created_at = ? WHERE sub = 'competitor' AND site_id LIKE ?")
      .run('2026-01-01T00:00:00.000Z', '%alpha%');
    db.prepare("UPDATE performance_snapshots SET created_at = ? WHERE sub = 'competitor' AND site_id LIKE ?")
      .run('2026-02-01T00:00:00.000Z', '%beta%');
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots (sub, site_id, created_at, result)
      VALUES ('competitor', 'perf_store_malformed', '2026-03-01T00:00:00.000Z', '{bad json')
    `).run();

    expect(getLatestCompetitorCompareForSite('https://perf-store.example.com')?.result).toMatchObject({ label: 'new' });
  });
});
