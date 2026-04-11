/**
 * SEO Change Performance Tracker
 * Records when SEO changes (title, description, OG) are applied to pages,
 * then compares GSC metrics before/after to show impact over time.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { getValidToken } from './google-auth.js';
import { createLogger } from './logger.js';

const log = createLogger('seo-change-tracker');

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

// ── SQLite row shape ──

interface ChangeRow {
  id: string;
  workspace_id: string;
  page_id: string;
  page_slug: string;
  page_title: string;
  fields: string;
  source: string;
  changed_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO seo_changes (id, workspace_id, page_id, page_slug, page_title, fields, source, changed_at)
         VALUES (@id, @workspace_id, @page_id, @page_slug, @page_title, @fields, @source, @changed_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM seo_changes WHERE workspace_id = ? ORDER BY changed_at ASC`,
  ),
  selectByWorkspaceSource: db.prepare(
    `SELECT * FROM seo_changes WHERE workspace_id = ? AND source LIKE ? ORDER BY changed_at ASC`,
  ),
  selectRecentByPage: db.prepare(
    `SELECT * FROM seo_changes WHERE workspace_id = ? AND page_id = ? AND changed_at > ? ORDER BY changed_at DESC LIMIT 1`,
  ),
  updateById: db.prepare(
    `UPDATE seo_changes SET fields = @fields, changed_at = @changed_at WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  countByWorkspace: db.prepare(
    `SELECT COUNT(*) as cnt FROM seo_changes WHERE workspace_id = ?`,
  ),
  pruneOldest: db.prepare(
    `DELETE FROM seo_changes WHERE workspace_id = ? AND id NOT IN (
           SELECT id FROM seo_changes WHERE workspace_id = ? ORDER BY changed_at DESC LIMIT 500
         )`,
  ),
}));

function rowToEvent(row: ChangeRow): SeoChangeEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pageId: row.page_id,
    pageSlug: row.page_slug,
    pageTitle: row.page_title,
    fields: parseJsonFallback<string[]>(row.fields, []),
    source: row.source,
    changedAt: row.changed_at,
  };
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
  // Deduplicate: if same page changed in the last hour, update the existing entry
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recent = stmts().selectRecentByPage.get(workspaceId, pageId, oneHourAgo) as ChangeRow | undefined;

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

  if (recent) {
    // Merge fields and update
    const existingFields: string[] = parseJsonFallback<string[]>(recent.fields, []);
    event.fields = [...new Set([...existingFields, ...fields])];
    event.id = recent.id; // keep original id
    stmts().updateById.run({
      id: event.id,
      workspace_id: workspaceId,
      fields: JSON.stringify(event.fields),
      changed_at: event.changedAt,
    });
  } else {
    stmts().insert.run({
      id: event.id,
      workspace_id: workspaceId,
      page_id: pageId,
      page_slug: pageSlug,
      page_title: pageTitle,
      fields: JSON.stringify(event.fields),
      source,
      changed_at: event.changedAt,
    });
  }

  // Keep max 500 events per workspace
  stmts().pruneOldest.run(workspaceId, workspaceId);

  return event;
}

export function getSeoChanges(workspaceId: string, limit = 100): SeoChangeEvent[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as ChangeRow[];
  return rows.slice(-limit).reverse().map(rowToEvent); // newest first
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
  sourceFilter?: string,
): Promise<PageImpact[]> {
  const allChanges = sourceFilter
    ? stmts().selectByWorkspaceSource.all(workspaceId, `${sourceFilter}%`) as ChangeRow[]
    : stmts().selectByWorkspace.all(workspaceId) as ChangeRow[];
  if (allChanges.length === 0) return [];

  const token = await getValidToken(siteId);
  if (!token) throw new Error('Not connected to Google');

  const now = new Date();
  const dataDelay = 3; // GSC data has ~3 day delay

  // Get the date range we need: from 28 days before the oldest change to now minus delay
  const recentChanges = allChanges.slice(-limit);

  const results: PageImpact[] = [];

  for (const row of [...recentChanges].reverse()) { // newest first
    const change = rowToEvent(row);
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
      log.error({ err: err }, `GSC fetch error for ${change.pageSlug}:`);
      results.push({ change, before: null, after: null, daysSinceChange, tooRecent: false });
    }
  }

  return results;
}

// ── Schema Impact Summary ──

export interface SchemaImpactSummary {
  totalDeployments: number;
  pagesWithData: number;
  tooRecent: number;
  avgClicksDelta: number | null;
  avgImpressionsDelta: number | null;
  avgCtrDelta: number | null;
  avgPositionDelta: number | null;
  deployments: PageImpact[];
}

export async function getSchemaImpactSummary(
  workspaceId: string,
  gscSiteUrl: string,
  siteId: string,
  limit = 30,
): Promise<SchemaImpactSummary> {
  const impacts = await getSeoChangeImpact(workspaceId, gscSiteUrl, siteId, limit, 'schema');

  const withData = impacts.filter(i => !i.tooRecent && i.before && i.after);
  const tooRecent = impacts.filter(i => i.tooRecent).length;

  let avgClicksDelta: number | null = null;
  let avgImpressionsDelta: number | null = null;
  let avgCtrDelta: number | null = null;
  let avgPositionDelta: number | null = null;

  if (withData.length > 0) {
    const sum = withData.reduce(
      (acc, i) => {
        acc.clicks += i.after!.clicks - i.before!.clicks;
        acc.impressions += i.after!.impressions - i.before!.impressions;
        acc.ctr += i.after!.ctr - i.before!.ctr;
        acc.position += i.after!.position - i.before!.position;
        return acc;
      },
      { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    );
    avgClicksDelta = +(sum.clicks / withData.length).toFixed(1);
    avgImpressionsDelta = +(sum.impressions / withData.length).toFixed(1);
    avgCtrDelta = +(sum.ctr / withData.length).toFixed(2);
    avgPositionDelta = +(sum.position / withData.length).toFixed(1);
  }

  return {
    totalDeployments: impacts.length,
    pagesWithData: withData.length,
    tooRecent,
    avgClicksDelta,
    avgImpressionsDelta,
    avgCtrDelta,
    avgPositionDelta,
    deployments: impacts,
  };
}
