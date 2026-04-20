/**
 * Analytics annotations store — CRUD for date-tagged annotations
 * on analytics charts (site changes, algorithm updates, campaigns).
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

export type AnnotationCategory = 'site_change' | 'algorithm_update' | 'campaign' | 'other';

export interface Annotation {
  id: string;
  workspaceId: string;
  date: string;
  label: string;
  category: string;
  createdBy: string | null;
  createdAt: string;
  pageUrl?: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO analytics_annotations (id, workspace_id, date, label, category, created_by, page_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  select: db.prepare(`
    SELECT id, workspace_id AS workspaceId, date, label, category, created_by AS createdBy, created_at AS createdAt, page_url AS pageUrl
    FROM analytics_annotations
    WHERE workspace_id = ?
    ORDER BY date DESC
  `),
  delete: db.prepare(
    `DELETE FROM analytics_annotations WHERE id = ? AND workspace_id = ?`
  ),
}));

export function createAnnotation(opts: {
  workspaceId: string;
  date: string;
  label: string;
  category: string;
  createdBy?: string;
  pageUrl?: string;
}): { id: string } {
  const id = randomUUID();
  stmts().insert.run(id, opts.workspaceId, opts.date, opts.label, opts.category, opts.createdBy ?? null, opts.pageUrl ?? null);
  return { id };
}

export function getAnnotations(
  workspaceId: string,
  opts?: { startDate?: string; endDate?: string; category?: string },
): Annotation[] {
  let rows = stmts().select.all(workspaceId) as Annotation[];

  if (opts?.startDate) {
    rows = rows.filter(r => r.date >= opts.startDate!);
  }
  if (opts?.endDate) {
    rows = rows.filter(r => r.date <= opts.endDate!);
  }
  if (opts?.category) {
    rows = rows.filter(r => r.category === opts.category);
  }

  return rows;
}

export function updateAnnotation(
  id: string,
  workspaceId: string,
  opts: { label?: string; date?: string; category?: string; pageUrl?: string },
): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (opts.label !== undefined) { sets.push('label = ?'); vals.push(opts.label); }
  if (opts.date !== undefined) { sets.push('date = ?'); vals.push(opts.date); }
  if (opts.category !== undefined) { sets.push('category = ?'); vals.push(opts.category); }
  if (opts.pageUrl !== undefined) { sets.push('page_url = ?'); vals.push(opts.pageUrl); }

  if (sets.length === 0) return false;

  vals.push(id, workspaceId);
  // Dynamic column set prevents caching — statement shape varies per call
  const stmt = db.prepare(`UPDATE analytics_annotations SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`);
  const result = stmt.run(...vals);
  return result.changes > 0;
}

export function deleteAnnotation(id: string, workspaceId: string): boolean {
  const result = stmts().delete.run(id, workspaceId);
  return result.changes > 0;
}
