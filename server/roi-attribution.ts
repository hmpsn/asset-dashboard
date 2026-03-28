// server/roi-attribution.ts
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import type { ROIHighlight } from '../shared/types/narrative.js';

const log = createLogger('roi-attribution');

// ── Path normalization ─────────────────────────────────────────────────────
// Used at BOTH write and read paths to ensure consistent lookup.
// Strips leading and trailing slashes, lowercases.
function normalizePath(url: string): string {
  try {
    const pathname = url.startsWith('http') ? new URL(url).pathname : url;
    return pathname.toLowerCase().replace(/^\//, '').replace(/\/$/, '');
  } catch {
    return url.toLowerCase().replace(/^\//, '').replace(/\/$/, '');
  }
}

// ── Prepared statement cache ───────────────────────────────────────────────
interface ROIAttributionRow {
  id: string;
  workspace_id: string;
  action_type: string;
  action_date: string;
  page_url: string;
  description: string;
  clicks_before: number | null;
  clicks_after: number | null;
  impressions_before: number | null;
  impressions_after: number | null;
  position_before: number | null;
  position_after: number | null;
  measured_at: string | null;
  measurement_window_days: number;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`INSERT INTO roi_attributions
    (id, workspace_id, action_type, action_date, page_url, description,
     clicks_before, impressions_before, position_before, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateOutcome: db.prepare(`UPDATE roi_attributions
    SET clicks_after = ?, impressions_after = ?, position_after = ?, measured_at = datetime('now')
    WHERE id = ?`),
  getHighlights: db.prepare(`SELECT * FROM roi_attributions
    WHERE workspace_id = ? AND measured_at IS NOT NULL
    ORDER BY (COALESCE(clicks_after, 0) - COALESCE(clicks_before, 0)) DESC
    LIMIT ?`),
  getUnmeasured: db.prepare(`SELECT * FROM roi_attributions
    WHERE measured_at IS NULL
    AND julianday('now') - julianday(action_date) >= measurement_window_days`),
}));

// ── Public functions ───────────────────────────────────────────────────────

/**
 * Record an optimization action for ROI tracking.
 * Normalizes page_url at write time for consistent lookup.
 */
export function recordOptimization(params: {
  workspaceId: string;
  actionType: 'content_refresh' | 'brief_published' | 'seo_fix' | 'schema_added';
  pageUrl: string;
  description: string;
  clicksBefore?: number;
  impressionsBefore?: number;
  positionBefore?: number;
}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const normalizedUrl = normalizePath(params.pageUrl);

  stmts().insert.run(
    id, params.workspaceId, params.actionType, now, normalizedUrl, params.description,
    params.clicksBefore ?? null, params.impressionsBefore ?? null, params.positionBefore ?? null, now,
  );

  log.info(
    { workspaceId: params.workspaceId, pageUrl: normalizedUrl, actionType: params.actionType },
    'ROI optimization recorded',
  );
  return id;
}

/**
 * Measure the outcome of a previously recorded optimization.
 */
export function measureOutcome(attributionId: string, params: {
  clicksAfter: number;
  impressionsAfter: number;
  positionAfter: number;
}): void {
  stmts().updateOutcome.run(params.clicksAfter, params.impressionsAfter, params.positionAfter, attributionId);
}

/**
 * Get ROI highlights for a workspace (monthly digest + client dashboard).
 * Only returns attributions where both before and after metrics are available.
 */
export function getROIHighlights(workspaceId: string, limit = 10): ROIHighlight[] {
  const rows = stmts().getHighlights.all(workspaceId, limit) as ROIAttributionRow[];
  return rows.map(row => ({
    pageTitle: cleanUrlToTitle(row.page_url),
    pageUrl: row.page_url,
    action: formatActionType(row.action_type),
    result: formatResult(row),
    clicksGained: (row.clicks_after ?? 0) - (row.clicks_before ?? 0),
  }));
}

/**
 * Get unmeasured optimizations older than the measurement window.
 */
export function getUnmeasuredOptimizations(): ROIAttributionRow[] {
  return stmts().getUnmeasured.all() as ROIAttributionRow[];
}

// ── Private helpers ────────────────────────────────────────────────────────

function cleanUrlToTitle(url: string): string {
  const slug = url.split('/').filter(Boolean).pop() ?? 'Home';
  if (!slug || slug === '') return 'Home';
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatActionType(type: string): string {
  const map: Record<string, string> = {
    content_refresh: 'Content refresh',
    brief_published: 'New content published',
    seo_fix: 'SEO fix applied',
    schema_added: 'Schema markup added',
  };
  return map[type] ?? type;
}

function formatResult(row: ROIAttributionRow): string {
  const parts: string[] = [];
  if (row.position_before != null && row.position_after != null) {
    const improved = row.position_after < row.position_before;
    parts.push(`Position ${improved ? 'improved' : 'changed'} from ${Math.round(row.position_before)} to ${Math.round(row.position_after)}`);
  }
  if (row.clicks_before != null && row.clicks_after != null) {
    const diff = row.clicks_after - row.clicks_before;
    if (diff > 0) parts.push(`+${diff.toLocaleString()} clicks`);
  }
  return parts.join(' · ') || 'Measurement pending';
}
