import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const performanceStoreSrc = readFileSync( // readFile-ok — intentional static analysis of performance-store competitor projection contract
  resolve(import.meta.dirname, '../../server/performance-store.ts'),
  'utf8',
);

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
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots (sub, site_id, created_at, result)
      VALUES ('competitor', 'perf_store_list_malformed', '2026-03-01T00:00:00.000Z', '{bad json')
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots (sub, site_id, created_at, result)
      VALUES ('competitor', 'perf_store_partial_valid', '2026-03-02T00:00:00.000Z', ?)
    `).run(JSON.stringify({ label: 'legacy-partial-valid-row' }));

    expect(getCompetitorCompare('http://perf-store.example.com', 'http://competitor.example.com')?.result).toMatchObject({ winner: 'mine' });

    const list = listCompetitorCompares().filter(item => item.myUrl?.includes('perf-store.example.com'));
    expect(list).toHaveLength(1);
    expect(list[0].competitorUrl).toBe('https://competitor.example.com');
    const allList = listCompetitorCompares();
    expect(allList.some(item => item.key === 'perf_store_list_malformed')).toBe(false);
    const partial = allList.find(item => item.key === 'perf_store_partial_valid');
    expect(partial).toEqual({
      key: 'perf_store_partial_valid',
      createdAt: '2026-03-02T00:00:00.000Z',
      myUrl: undefined,
      competitorUrl: undefined,
    });
  });

  it('uses SQLite JSON projection for competitor list/latest selection instead of parsing every result blob', () => {
    const projectionStart = performanceStoreSrc.indexOf('listCompetitorProjection: db.prepare');
    const latestStart = performanceStoreSrc.indexOf('export function getLatestCompetitorCompareForSite');
    const listStart = performanceStoreSrc.indexOf('export function listCompetitorCompares');
    const end = performanceStoreSrc.indexOf('\n}', listStart) + 2;
    const latestBody = performanceStoreSrc.slice(latestStart, listStart);
    const listBody = performanceStoreSrc.slice(listStart, end);

    expect(projectionStart).toBeGreaterThan(0);
    expect(performanceStoreSrc.slice(projectionStart, latestStart)).toContain('json_extract');
    expect(performanceStoreSrc.slice(projectionStart, latestStart)).toContain('json_valid(result)');
    expect(latestBody).toContain('listCompetitorProjection.all()');
    expect(listBody).toContain('listCompetitorProjection.all()');
    expect(listBody).not.toContain('parseJsonFallback');
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
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots (sub, site_id, created_at, result)
      VALUES ('competitor', 'perf_store_partial_newer', '2026-04-01T00:00:00.000Z', ?)
    `).run(JSON.stringify({ label: 'newer-but-no-my-url' }));

    expect(getLatestCompetitorCompareForSite('https://perf-store.example.com')?.result).toMatchObject({ label: 'new' });
    expect(getLatestCompetitorCompareForSite('https://www.perf-store.example.com')?.result).toMatchObject({ label: 'new' });
  });
});
