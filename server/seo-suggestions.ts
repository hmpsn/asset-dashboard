/**
 * SEO Suggestions — persistent storage for bulk-generated title/description variations.
 *
 * Each suggestion holds 3 AI-generated variations for a single page + field.
 * Users can select a preferred variation, then apply it to Webflow later.
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { SEO_SUGGESTION_TRANSITIONS, InvalidTransitionError } from './state-machines.js';
import { createLogger } from './logger.js';

const log = createLogger('seo-suggestions');

/**
 * Partition a set of suggestion ids for a bulk terminal-marking write into the ids
 * whose CURRENT status legally transitions to `target`, filtering out both idempotent
 * no-ops (already at `target`) and illegal moves (e.g. re-applying a dismissed
 * suggestion). Bulk writes are skip-and-report: an illegal id is logged and dropped,
 * never thrown, so one bad id can't abort the whole batch.
 */
function legalSuggestionIdsForTarget(
  workspaceId: string,
  ids: string[],
  target: 'applied' | 'dismissed',
): string[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, status FROM seo_suggestions WHERE workspace_id = ? AND id IN (${placeholders})`,
  ).all(workspaceId, ...ids) as Array<{ id: string; status: string }>;
  const legal: string[] = [];
  for (const row of rows) {
    if (row.status === target) continue; // idempotent no-op — already terminal at target
    const allowed = SEO_SUGGESTION_TRANSITIONS[row.status] ?? [];
    if (allowed.includes(target)) {
      legal.push(row.id);
    } else {
      // Illegal move (applied → dismissed, dismissed → applied). Skip-and-report.
      log.warn(
        { workspaceId, suggestionId: row.id, from: row.status, to: target },
        new InvalidTransitionError('seo_suggestion', row.status, target).message,
      );
    }
  }
  return legal;
}
export interface SeoSuggestion {
  id: string;
  workspaceId: string;
  siteId: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: 'title' | 'description';
  currentValue: string;
  variations: string[];
  selectedIndex: number | null;
  status: 'pending' | 'applied' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

interface SuggestionRow {
  id: string;
  workspace_id: string;
  site_id: string;
  page_id: string;
  page_title: string;
  page_slug: string;
  field: string;
  current_value: string;
  variations: string;
  selected_index: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToSuggestion(row: SuggestionRow): SeoSuggestion {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    pageSlug: row.page_slug,
    field: row.field as 'title' | 'description',
    currentValue: row.current_value,
    variations: parseJsonFallback(row.variations, []),
    selectedIndex: row.selected_index,
    status: row.status as 'pending' | 'applied' | 'dismissed',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Upsert a suggestion (replaces any existing suggestion for the same page + field). */
export function saveSuggestion(opts: {
  workspaceId: string;
  siteId: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: 'title' | 'description';
  currentValue: string;
  variations: string[];
}): SeoSuggestion {
  const id = randomUUID();
  const now = new Date().toISOString();
  const variationsJson = JSON.stringify(opts.variations);

  db.prepare(`
    INSERT INTO seo_suggestions (id, workspace_id, site_id, page_id, page_title, page_slug, field, current_value, variations, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(workspace_id, page_id, field) DO UPDATE SET
      site_id = excluded.site_id,
      page_title = excluded.page_title,
      page_slug = excluded.page_slug,
      current_value = excluded.current_value,
      variations = excluded.variations,
      selected_index = NULL,
      status = 'pending',
      updated_at = excluded.updated_at
  `).run(id, opts.workspaceId, opts.siteId, opts.pageId, opts.pageTitle, opts.pageSlug, opts.field, opts.currentValue, variationsJson, now, now);

  // Fetch the actual row (may have been an update, keeping original id)
  const row = db.prepare(`SELECT * FROM seo_suggestions WHERE workspace_id = ? AND page_id = ? AND field = ?`)
    .get(opts.workspaceId, opts.pageId, opts.field) as SuggestionRow;
  return rowToSuggestion(row);
}

/** List all pending suggestions for a workspace, optionally filtered by field. */
export function listSuggestions(workspaceId: string, field?: 'title' | 'description'): SeoSuggestion[] {
  const sql = field
    ? `SELECT * FROM seo_suggestions WHERE workspace_id = ? AND status = 'pending' AND field = ? ORDER BY created_at DESC`
    : `SELECT * FROM seo_suggestions WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at DESC`;
  const rows = (field
    ? db.prepare(sql).all(workspaceId, field)
    : db.prepare(sql).all(workspaceId)) as SuggestionRow[];
  return rows.map(rowToSuggestion);
}

/** Read one pending suggestion for mutation context. */
export function getPendingSuggestion(workspaceId: string, suggestionId: string): SeoSuggestion | null {
  const row = db.prepare(`
    SELECT * FROM seo_suggestions
    WHERE workspace_id = ? AND id = ? AND status = 'pending'
  `).get(workspaceId, suggestionId) as SuggestionRow | undefined;
  return row ? rowToSuggestion(row) : null;
}

/** Read pending suggestions before a bulk status mutation. */
export function listPendingSuggestionsByIds(workspaceId: string, suggestionIds?: string[]): SeoSuggestion[] {
  if (!suggestionIds?.length) return listSuggestions(workspaceId);
  const placeholders = suggestionIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM seo_suggestions
    WHERE workspace_id = ? AND status = 'pending' AND id IN (${placeholders})
    ORDER BY created_at DESC
  `).all(workspaceId, ...suggestionIds) as SuggestionRow[];
  return rows.map(rowToSuggestion);
}

/** Select a variation for a suggestion. */
export function selectVariation(workspaceId: string, suggestionId: string, selectedIndex: number): boolean {
  const result = db.prepare(`
    UPDATE seo_suggestions SET selected_index = ?, updated_at = datetime('now')
    WHERE id = ? AND workspace_id = ? AND status = 'pending'
  `).run(selectedIndex, suggestionId, workspaceId);
  return result.changes > 0;
}

/** Select a variation by page + field (alternative to by ID). */
export function selectVariationByPage(workspaceId: string, pageId: string, field: string, selectedIndex: number): boolean {
  const result = db.prepare(`
    UPDATE seo_suggestions SET selected_index = ?, updated_at = datetime('now')
    WHERE workspace_id = ? AND page_id = ? AND field = ? AND status = 'pending'
  `).run(selectedIndex, workspaceId, pageId, field);
  return result.changes > 0;
}

/** Get all suggestions that have a selected variation, ready to apply. */
export function getSelectedSuggestions(workspaceId: string): SeoSuggestion[] {
  const rows = db.prepare(`
    SELECT * FROM seo_suggestions
    WHERE workspace_id = ? AND status = 'pending' AND selected_index IS NOT NULL
    ORDER BY created_at DESC
  `).all(workspaceId) as SuggestionRow[];
  return rows.map(rowToSuggestion);
}

/** Mark suggestions as applied after pushing to Webflow. */
export function markApplied(workspaceId: string, suggestionIds: string[]): void {
  if (!suggestionIds.length) return;
  // Guard pending → applied per row (SEO_SUGGESTION_TRANSITIONS). Idempotent re-apply
  // of an already-applied id is skipped; an illegal move (dismissed → applied) is
  // logged and dropped — the batch never throws.
  const legalIds = legalSuggestionIdsForTarget(workspaceId, suggestionIds, 'applied');
  if (!legalIds.length) return;
  const placeholders = legalIds.map(() => '?').join(',');
  db.prepare(`
    UPDATE seo_suggestions SET status = 'applied', updated_at = datetime('now') -- status-ok: legalSuggestionIdsForTarget() guards pending→applied before this write
    WHERE workspace_id = ? AND id IN (${placeholders})
  `).run(workspaceId, ...legalIds);
}

/** Dismiss (discard) suggestions. */
export function dismissSuggestions(workspaceId: string, suggestionIds?: string[]): number {
  if (suggestionIds?.length) {
    // Guard pending → dismissed per row. Re-dismissing an already-dismissed
    // suggestion is a no-op (skipped, not thrown); applied → dismissed is illegal and
    // dropped with a warning.
    const legalIds = legalSuggestionIdsForTarget(workspaceId, suggestionIds, 'dismissed');
    if (!legalIds.length) return 0;
    const placeholders = legalIds.map(() => '?').join(',');
    // txn-ok — if-branch returns early; the two writes are in mutually exclusive paths
    const result = db.prepare(`
      UPDATE seo_suggestions SET status = 'dismissed', updated_at = datetime('now') -- status-ok: legalSuggestionIdsForTarget() guards pending→dismissed before this write
      WHERE workspace_id = ? AND id IN (${placeholders})
    `).run(workspaceId, ...legalIds);
    return result.changes;
  }
  // Dismiss all pending for workspace — the WHERE status = 'pending' filter IS the
  // guard (only pending → dismissed rows are touched; no illegal origin is possible).
  const result = db.prepare(`
    UPDATE seo_suggestions SET status = 'dismissed', updated_at = datetime('now') -- status-ok: WHERE status = 'pending' structurally enforces the only legal origin (pending→dismissed)
    WHERE workspace_id = ? AND status = 'pending'
  `).run(workspaceId);
  return result.changes;
}

/** Get suggestion count summary for a workspace. */
export function getSuggestionCounts(workspaceId: string): { pending: number; selected: number; total: number } {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN status = 'pending' AND selected_index IS NOT NULL THEN 1 ELSE 0 END), 0) as selected
    FROM seo_suggestions
    WHERE workspace_id = ?
  `).get(workspaceId) as { total: number; pending: number; selected: number };
  return { pending: row.pending || 0, selected: row.selected || 0, total: row.total || 0 };
}
