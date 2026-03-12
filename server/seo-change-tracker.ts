/**
 * SEO Change Performance Tracker
 * Records when SEO changes (title, description, OG) are applied to pages,
 * then compares GSC metrics before/after to show impact over time.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { getValidToken } from './google-auth.js';

const CHANGE_DIR = getDataDir('seo-changes');

// ── Data Model ──

export interface SeoChangeEvent {
  id: string;
  workspaceId: string;
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  fields: string[];           // e.g. ['title', 'description']
  source: string;             // 'editor' | 'bulk-fix' | 'approval' | 'cart-fix' | etc.
  changedAt: string;          // ISO timestamp
}

export interface PageImpact {
  change: SeoChangeEvent;
  before: { clicks: number; impressions: number; ctr: number; position: number } | null;
  after: { clicks: number; impressions: number; ctr: number; position: number } | null;
  daysSinceChange: number;
  tooRecent: boolean;          // < 7 days, not enough data
}

// ── Persistence ──

function getChangesPath(workspaceId: string): string {
  return path.join(CHANGE_DIR, `${workspaceId}.json`);
}

function readChanges(workspaceId: string): SeoChangeEvent[] {
  try {
    const fp = getChangesPath(workspaceId);
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { return []; }
}

function writeChanges(workspaceId: string, changes: SeoChangeEvent[]): void {
  fs.writeFileSync(getChangesPath(workspaceId), JSON.stringify(changes, null, 2));
}

// ── Public API ──

export function recordSeoChange(
  workspaceId: string,
  pageId: string,
  pageSlug: string,
  pageTitle: string,
  fields: string[],
  source: string,
): SeoChangeEvent {
  const changes = readChanges(workspaceId);

  // Deduplicate: if same page changed in the last hour, update the existing entry
  const recentIdx = changes.findIndex(c =>
    c.pageId === pageId &&
    Date.now() - new Date(c.changedAt).getTime() < 3600_000
  );

  const event: SeoChangeEvent = {
    id: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    pageId,
    pageSlug,
    pageTitle,
    fields,
    source,
    changedAt: new Date().toISOString(),
  };

  if (recentIdx >= 0) {
    // Merge fields and update
    const existing = changes[recentIdx];
    event.fields = [...new Set([...existing.fields, ...fields])];
    event.id = existing.id; // keep original id
    changes[recentIdx] = event;
  } else {
    changes.push(event);
  }

  // Keep max 500 events per workspace
  if (changes.length > 500) changes.splice(0, changes.length - 500);

  writeChanges(workspaceId, changes);
  return event;
}

export function getSeoChanges(workspaceId: string, limit = 100): SeoChangeEvent[] {
  const changes = readChanges(workspaceId);
  return changes.slice(-limit).reverse(); // newest first
}

// ── GSC Impact Comparison ──

const GSC_API = 'https://www.googleapis.com/webmasters/v3';

interface GscPageMetrics {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function fetchPageMetrics(
  gscSiteUrl: string,
  token: string,
  startDate: string,
  endDate: string,
): Promise<GscPageMetrics[]> {
  const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
  const res = await fetch(`${GSC_API}/sites/${encodedSiteUrl}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: 5000,
      type: 'web',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GSC API error (${res.status}): ${err}`);
  }

  const data = await res.json() as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
  return (data.rows || []).map(r => ({
    page: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(2),
    position: +r.position.toFixed(1),
  }));
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}

function matchPage(gscUrl: string, slug: string): boolean {
  const normalizedSlug = slug.startsWith('/') ? slug : `/${slug}`;
  const gscLower = gscUrl.toLowerCase();
  // Match by slug in the URL path
  return gscLower.endsWith(normalizedSlug.toLowerCase()) ||
    gscLower.endsWith(`${normalizedSlug.toLowerCase()}/`);
}

export async function getSeoChangeImpact(
  workspaceId: string,
  gscSiteUrl: string,
  siteId: string,
  limit = 50,
): Promise<PageImpact[]> {
  const changes = readChanges(workspaceId);
  if (changes.length === 0) return [];

  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const now = new Date();
  const dataDelay = 3; // GSC data has ~3 day delay

  // Get the date range we need: from 28 days before the oldest change to now minus delay
  const recentChanges = changes.slice(-limit);
  const oldestChange = new Date(recentChanges[0].changedAt);

  // Before period: 28 days ending at the change date (minus delay)
  const globalBeforeStart = new Date(oldestChange);
  globalBeforeStart.setDate(globalBeforeStart.getDate() - 28 - dataDelay);
  const globalAfterEnd = new Date(now);
  globalAfterEnd.setDate(globalAfterEnd.getDate() - dataDelay);

  // Fetch all page data for the full range in 2 calls: before window and after window
  // We'll use per-change date ranges for comparison
  const results: PageImpact[] = [];

  for (const change of recentChanges.slice().reverse()) { // newest first
    const changeDate = new Date(change.changedAt);
    const daysSinceChange = Math.floor((now.getTime() - changeDate.getTime()) / (1000 * 60 * 60 * 24));
    const tooRecent = daysSinceChange < 7;

    if (tooRecent) {
      results.push({ change, before: null, after: null, daysSinceChange, tooRecent: true });
      continue;
    }

    // Before: 28 days ending 3 days before the change
    const beforeEnd = new Date(changeDate);
    beforeEnd.setDate(beforeEnd.getDate() - dataDelay);
    const beforeStart = new Date(beforeEnd);
    beforeStart.setDate(beforeStart.getDate() - 28);

    // After: from (change + 3 days) to (now - 3 days), max 28 days
    const afterStart = new Date(changeDate);
    afterStart.setDate(afterStart.getDate() + dataDelay);
    const afterEnd = new Date(now);
    afterEnd.setDate(afterEnd.getDate() - dataDelay);

    // Cap after period to 28 days
    if (afterEnd.getTime() - afterStart.getTime() > 28 * 86400_000) {
      afterStart.setTime(afterEnd.getTime() - 28 * 86400_000);
    }

    if (afterEnd <= afterStart) {
      results.push({ change, before: null, after: null, daysSinceChange, tooRecent: true });
      continue;
    }

    try {
      const [beforeData, afterData] = await Promise.all([
        fetchPageMetrics(gscSiteUrl, token, fmt(beforeStart), fmt(beforeEnd)),
        fetchPageMetrics(gscSiteUrl, token, fmt(afterStart), fmt(afterEnd)),
      ]);

      const slug = change.pageSlug || '';
      const beforeMatch = beforeData.find(p => matchPage(p.page, slug));
      const afterMatch = afterData.find(p => matchPage(p.page, slug));

      results.push({
        change,
        before: beforeMatch ? { clicks: beforeMatch.clicks, impressions: beforeMatch.impressions, ctr: beforeMatch.ctr, position: beforeMatch.position } : null,
        after: afterMatch ? { clicks: afterMatch.clicks, impressions: afterMatch.impressions, ctr: afterMatch.ctr, position: afterMatch.position } : null,
        daysSinceChange,
        tooRecent: false,
      });
    } catch (err) {
      console.error(`[SEO Change Tracker] GSC fetch error for ${change.pageSlug}:`, err);
      results.push({ change, before: null, after: null, daysSinceChange, tooRecent: false });
    }
  }

  return results;
}
