import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

export interface Annotation {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  description?: string;
  color?: string; // hex color
  createdAt: string;
}

// ── SQLite row shape ──

interface AnnotationRow {
  id: string;
  workspace_id: string;
  date: string;
  label: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO annotations (id, workspace_id, date, label, description, color, created_at)
         VALUES (@id, @workspace_id, @date, @label, @description, @color, @created_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM annotations WHERE workspace_id = ? ORDER BY date ASC`,
  ),
  deleteById: db.prepare(
    `DELETE FROM annotations WHERE id = ? AND workspace_id = ?`,
  ),
}));

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    date: row.date,
    label: row.label,
    description: row.description ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.created_at,
  };
}

export function listAnnotations(workspaceId: string): Annotation[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as AnnotationRow[];
  return rows.map(rowToAnnotation);
}

export function addAnnotation(workspaceId: string, date: string, label: string, description?: string, color?: string): Annotation {
  const entry: Annotation = {
    id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date,
    label,
    description,
    color: color || '#2dd4bf',
    createdAt: new Date().toISOString(),
  };
  stmts().insert.run({
    id: entry.id,
    workspace_id: workspaceId,
    date: entry.date,
    label: entry.label,
    description: entry.description ?? null,
    color: entry.color ?? null,
    created_at: entry.createdAt,
  });
  return entry;
}

export function deleteAnnotation(workspaceId: string, annotationId: string): boolean {
  const info = stmts().deleteById.run(annotationId, workspaceId);
  return info.changes > 0;
}
