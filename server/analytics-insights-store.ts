import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { AnalyticsInsight, InsightType, InsightSeverity } from '../shared/types/analytics.js';

// ── SQLite row shape ──

interface InsightRow {
  id: string;
  workspace_id: string;
  page_id: string | null;
  insight_type: string;
  data: string;
  severity: string;
  computed_at: string;
}

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO analytics_insights (id, workspace_id, page_id, insight_type, data, severity, computed_at)
    VALUES (@id, @workspace_id, @page_id, @insight_type, @data, @severity, @computed_at)
    ON CONFLICT(workspace_id, COALESCE(page_id, '__workspace__'), insight_type) DO UPDATE SET
      id          = excluded.id,
      data        = excluded.data,
      severity    = excluded.severity,
      computed_at = excluded.computed_at
  `),
  selectByWorkspace: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ?`,
  ),
  selectByWorkspaceAndType: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? AND insight_type = ?`,
  ),
  selectOne: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? AND page_id IS ? AND insight_type = ?`,
  ),
  deleteByWorkspace: db.prepare(
    `DELETE FROM analytics_insights WHERE workspace_id = ?`,
  ),
}));

function rowToInsight(row: InsightRow): AnalyticsInsight {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pageId: row.page_id,
    insightType: row.insight_type as InsightType,
    data: JSON.parse(row.data),
    severity: row.severity as InsightSeverity,
    computedAt: row.computed_at,
  };
}

export interface UpsertInsightParams {
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: Record<string, unknown>;
  severity: InsightSeverity;
}

export function upsertInsight(params: UpsertInsightParams): AnalyticsInsight {
  const now = new Date().toISOString();
  const id = `ins_${randomUUID().slice(0, 8)}`;

  stmts().upsert.run({
    id,
    workspace_id: params.workspaceId,
    page_id: params.pageId,
    insight_type: params.insightType,
    data: JSON.stringify(params.data),
    severity: params.severity,
    computed_at: now,
  });

  // Fetch back to get the actual row (id may differ on conflict-replace)
  const row = stmts().selectOne.get(params.workspaceId, params.pageId, params.insightType) as InsightRow;
  return rowToInsight(row);
}

export function getInsights(workspaceId: string, insightType?: InsightType): AnalyticsInsight[] {
  if (insightType) {
    const rows = stmts().selectByWorkspaceAndType.all(workspaceId, insightType) as InsightRow[];
    return rows.map(rowToInsight);
  }
  const rows = stmts().selectByWorkspace.all(workspaceId) as InsightRow[];
  return rows.map(rowToInsight);
}

export function getInsight(
  workspaceId: string,
  pageId: string | null,
  insightType: InsightType,
): AnalyticsInsight | undefined {
  const row = stmts().selectOne.get(workspaceId, pageId, insightType) as InsightRow | undefined;
  return row ? rowToInsight(row) : undefined;
}

export function deleteInsightsForWorkspace(workspaceId: string): number {
  const info = stmts().deleteByWorkspace.run(workspaceId);
  return info.changes;
}
