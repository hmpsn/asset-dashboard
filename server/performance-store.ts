/**
 * Persistent storage for performance tool results.
 * Saves per-site snapshots so results survive navigation and deploys.
 * Covers: PageWeight, PageSpeed, LinkChecker, InternalLinks, CompetitorCompare.
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';

const PERF_DIR = getDataDir('performance');

function ensureDir(sub: string) {
  const dir = path.join(PERF_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(sub: string, siteId: string): string {
  return path.join(ensureDir(sub), `${siteId}.json`);
}

interface Snapshot<T> {
  siteId: string;
  createdAt: string;
  result: T;
}

function save<T>(sub: string, siteId: string, result: T): Snapshot<T> {
  const snapshot: Snapshot<T> = {
    siteId,
    createdAt: new Date().toISOString(),
    result,
  };
  fs.writeFileSync(filePath(sub, siteId), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function load<T>(sub: string, siteId: string): Snapshot<T> | null {
  const fp = filePath(sub, siteId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Page Weight ──

export function savePageWeight(siteId: string, result: unknown) {
  return save('page-weight', siteId, result);
}

export function getPageWeight(siteId: string) {
  return load('page-weight', siteId);
}

// ── PageSpeed Insights ──

export function savePageSpeed(siteId: string, result: unknown) {
  return save('pagespeed', siteId, result);
}

export function getPageSpeed(siteId: string) {
  return load('pagespeed', siteId);
}

// ── Single-page PageSpeed ──

export function saveSinglePageSpeed(siteId: string, pageKey: string, result: unknown) {
  return save('pagespeed-single', `${siteId}_${pageKey}`, result);
}

export function getSinglePageSpeed(siteId: string, pageKey: string) {
  return load('pagespeed-single', `${siteId}_${pageKey}`);
}

// ── Dead Link Checker ──

export function saveLinkCheck(siteId: string, result: unknown) {
  return save('link-check', siteId, result);
}

export function getLinkCheck(siteId: string) {
  return load('link-check', siteId);
}

// ── Internal Links ──

export function saveInternalLinks(siteId: string, result: unknown) {
  return save('internal-links', siteId, result);
}

export function getInternalLinks(siteId: string) {
  return load('internal-links', siteId);
}

// ── Competitor Comparison ──
// Key by both URLs since it's not site-specific

function competitorKey(myUrl: string, competitorUrl: string): string {
  // Normalize URLs to create a stable key
  const normalize = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/[^a-z0-9]/gi, '_');
  return `${normalize(myUrl)}_vs_${normalize(competitorUrl)}`;
}

export function saveCompetitorCompare(myUrl: string, competitorUrl: string, result: unknown) {
  return save('competitor', competitorKey(myUrl, competitorUrl), result);
}

export function getCompetitorCompare(myUrl: string, competitorUrl: string) {
  return load('competitor', competitorKey(myUrl, competitorUrl));
}

// Get latest comparison for a given myUrl (any competitor)
export function getLatestCompetitorCompareForSite(myUrl: string): { createdAt: string; result: unknown } | null {
  const dir = path.join(PERF_DIR, 'competitor');
  if (!fs.existsSync(dir)) return null;
  try {
    const normalize = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
    const myNorm = normalize(myUrl);
    let latest: { createdAt: string; result: unknown } | null = null;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        const snapMyUrl = normalize(data.result?.mySite?.url || '');
        if (snapMyUrl === myNorm || myNorm.includes(snapMyUrl) || snapMyUrl.includes(myNorm)) {
          if (!latest || data.createdAt > latest.createdAt) {
            latest = { createdAt: data.createdAt, result: data.result };
          }
        }
      } catch { /* skip corrupt files */ }
    }
    return latest;
  } catch { return null; }
}

// List all saved competitor comparisons
export function listCompetitorCompares(): Array<{ key: string; createdAt: string; myUrl?: string; competitorUrl?: string }> {
  const dir = path.join(PERF_DIR, 'competitor');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          return {
            key: f.replace('.json', ''),
            createdAt: data.createdAt,
            myUrl: data.result?.mySite?.url,
            competitorUrl: data.result?.competitor?.url,
          };
        } catch { return null; }
      })
      .filter(Boolean) as Array<{ key: string; createdAt: string; myUrl?: string; competitorUrl?: string }>;
  } catch { return []; }
}
