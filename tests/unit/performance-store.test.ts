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
  getPageSpeedPageMetrics,
  getPageSpeedPageScore,
  getPageSpeedSummary,
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

  it('projects PageSpeed summaries and CWV pass rates without loading the full snapshot result', () => {
    savePageSpeed(SITE_ID, 'mobile', {
      strategy: 'mobile',
      averageScore: 85,
      averageVitals: { LCP: 3150, INP: 235, FID: 80, CLS: 0.15, FCP: 1800, SI: 3200, TBT: 120, TTI: 4000 },
      pages: [
        { url: 'https://example.com/good', page: 'Good', score: 95, vitals: { LCP: 2100, INP: 120, CLS: 0.05 } },
        { url: 'https://example.com/slow', page: 'Slow', score: 42, vitals: { LCP: 4200, INP: 350, CLS: 0.25 } },
      ],
      largePayload: 'x'.repeat(10_000),
    });

    const summary = getPageSpeedSummary(SITE_ID, 'mobile');

    expect(summary).toMatchObject({
      siteId: SITE_ID,
      strategy: 'mobile',
      averageScore: 85,
      hasAverageVitals: true,
      averageVitals: { LCP: 3150, INP: 235, FID: 80, CLS: 0.15 },
      pageCount: 2,
      cwvPassingPages: 1,
      cwvPassRate: 0.5,
      worstPages: [
        { url: 'https://example.com/slow', page: 'Slow', score: 42 },
        { url: 'https://example.com/good', page: 'Good', score: 95 },
      ],
    });
  });

  it('uses SQLite JSON projection for PageSpeed summary/page-score reads instead of parsing full blobs', () => {
    const statementsStart = performanceStoreSrc.indexOf('getPageSpeedSummaryProjection: db.prepare');
    const helpersStart = performanceStoreSrc.indexOf('export function getPageSpeedPageMetrics');
    const singlePageStart = performanceStoreSrc.indexOf('// ── Single-page PageSpeed ──');
    const statementBlock = performanceStoreSrc.slice(statementsStart, helpersStart);
    const helperBlock = performanceStoreSrc.slice(helpersStart, singlePageStart);

    expect(statementsStart).toBeGreaterThan(0);
    expect(helpersStart).toBeGreaterThan(statementsStart);
    expect(statementBlock).toContain('json_extract');
    expect(statementBlock).toContain('json_each');
    expect(statementBlock).toContain('json_valid(result)');
    expect(helperBlock).not.toContain('parseJsonFallback');
    expect(helperBlock).not.toContain("load('pagespeed");
    expect(helperBlock).not.toContain('getPageSpeed(');
  });

  it('falls back to legacy mobile PageSpeed rows for projections only on mobile', () => {
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots
        (sub, site_id, created_at, result)
      VALUES ('pagespeed', ?, ?, ?)
    `).run(SITE_ID, new Date().toISOString(), JSON.stringify({
      averageScore: 82,
      averageVitals: { LCP: 2400, FID: 50, INP: null, CLS: 0.08 },
      pages: [{ slug: '/legacy', score: 82, vitals: { LCP: 2400, FID: 50, CLS: 0.08 } }],
    }));

    expect(getPageSpeedSummary(SITE_ID, 'mobile')?.averageScore).toBe(82);
    expect(getPageSpeedSummary(SITE_ID, 'desktop')).toBeNull();
  });

  it('projects PageSpeed page scores with URL identity matching', () => {
    savePageSpeed(SITE_ID, 'mobile', {
      averageScore: 80,
      averageVitals: { LCP: 2500, FID: 50, INP: null, CLS: 0.05 },
      pages: [
        { slug: 'seo', url: 'https://example.com/services/seo#top', score: 94, vitals: { LCP: 2400, FID: 70, CLS: 0.06 } },
        { slug: 'seo', url: 'https://example.com/seo', score: 45, vitals: { LCP: 4400, INP: 420, CLS: 0.22 } },
      ],
    });

    expect(getPageSpeedPageScore(SITE_ID, 'mobile', '/services/seo')).toBe(94);
    expect(getPageSpeedPageScore(SITE_ID, 'mobile', '/seo')).toBe(45);
    expect(getPageSpeedPageScore(SITE_ID, 'desktop', '/seo')).toBeNull();
  });

  it('ignores non-object PageSpeed page entries during projection', () => {
    savePageSpeed(SITE_ID, 'mobile', {
      averageScore: 75,
      averageVitals: { LCP: 3000, FID: 80, INP: null, CLS: 0.1 },
      pages: [
        'legacy bad entry',
        null,
        { url: 'https://example.com/good', score: 88, vitals: { LCP: 2200, FID: 40, CLS: 0.04 } },
      ],
    });

    expect(getPageSpeedPageMetrics(SITE_ID, 'mobile')).toHaveLength(1);
    expect(getPageSpeedSummary(SITE_ID, 'mobile')).toMatchObject({
      pageCount: 1,
      cwvPassingPages: 1,
      cwvPassRate: 1,
      worstPages: [{ url: 'https://example.com/good', score: 88 }],
    });
  });

  it('selects worst PageSpeed pages after requiring URL-capable rows', () => {
    savePageSpeed(SITE_ID, 'mobile', {
      averageScore: 70,
      averageVitals: { LCP: 3000, FID: 80, INP: null, CLS: 0.1 },
      pages: [
        { page: 'No URL 1', score: 1 },
        { page: 'No URL 2', score: 2 },
        { page: 'No URL 3', score: 3 },
        { page: 'No URL 4', score: 4 },
        { page: 'No URL 5', score: 5 },
        { url: 'https://example.com/slow', page: 'Slow', score: 60 },
      ],
    });

    expect(getPageSpeedSummary(SITE_ID, 'mobile')?.worstPages).toEqual([
      { url: 'https://example.com/slow', page: 'Slow', score: 60 },
    ]);
  });

  it('skips malformed PageSpeed projection rows without breaking full snapshot APIs', () => {
    db.prepare(`
      INSERT OR REPLACE INTO performance_snapshots
        (sub, site_id, created_at, result)
      VALUES ('pagespeed:mobile', ?, ?, ?)
    `).run(SITE_ID, new Date().toISOString(), '{bad json');

    expect(getPageSpeed(SITE_ID, 'mobile')).toBeNull();
    expect(getPageSpeedSummary(SITE_ID, 'mobile')).toBeNull();
    expect(getPageSpeedPageMetrics(SITE_ID, 'mobile')).toEqual([]);
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
