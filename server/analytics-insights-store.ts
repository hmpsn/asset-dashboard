import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { AnalyticsInsight, InsightType, InsightSeverity, InsightDomain } from '../shared/types/analytics.js';
import { parseJsonFallback } from './db/json-validation.js';

// ── SQLite row shape ──

interface InsightRow {
  id: string;
  workspace_id: string;
  page_id: string | null;
  insight_type: string;
  data: string;
  severity: string;
  computed_at: string;
  page_title: string | null;
  strategy_keyword: string | null;
  strategy_alignment: string | null;
  audit_issues: string | null;
  pipeline_status: string | null;
  anomaly_linked: number | null;
  impact_score: number | null;
  domain: string | null;
}

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO analytics_insights (
      id, workspace_id, page_id, insight_type, data, severity, computed_at,
      page_title, strategy_keyword, strategy_alignment, audit_issues,
      pipeline_status, anomaly_linked, impact_score, domain
    )
    VALUES (
      @id, @workspace_id, @page_id, @insight_type, @data, @severity, @computed_at,
      @page_title, @strategy_keyword, @strategy_alignment, @audit_issues,
      @pipeline_status, @anomaly_linked, @impact_score, @domain
    )
    ON CONFLICT(workspace_id, COALESCE(page_id, '__workspace__'), insight_type) DO UPDATE SET
      id                 = excluded.id,
      data               = excluded.data,
      severity           = excluded.severity,
      computed_at        = excluded.computed_at,
      page_title         = excluded.page_title,
      strategy_keyword   = excluded.strategy_keyword,
      strategy_alignment = excluded.strategy_alignment,
      audit_issues       = excluded.audit_issues,
      pipeline_status    = excluded.pipeline_status,
      anomaly_linked     = excluded.anomaly_linked,
      impact_score       = excluded.impact_score,
      domain             = excluded.domain
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
    data: parseJsonFallback(row.data, {}),
    severity: row.severity as InsightSeverity,
    computedAt: row.computed_at,
    pageTitle: row.page_title ?? undefined,
    strategyKeyword: row.strategy_keyword ?? undefined,
    strategyAlignment: (row.strategy_alignment as AnalyticsInsight['strategyAlignment']) ?? undefined,
    auditIssues: row.audit_issues ?? undefined,
    pipelineStatus: (row.pipeline_status as AnalyticsInsight['pipelineStatus']) ?? undefined,
    anomalyLinked: row.anomaly_linked != null ? row.anomaly_linked !== 0 : undefined,
    impactScore: row.impact_score ?? undefined,
    domain: (row.domain as InsightDomain) ?? undefined,
  };
}

export interface UpsertInsightParams {
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: Record<string, unknown>;
  severity: InsightSeverity;
  // Enrichment fields (Phase 1)
  pageTitle?: string | null;
  strategyKeyword?: string | null;
  strategyAlignment?: string | null;
  auditIssues?: string | null;
  pipelineStatus?: string | null;
  anomalyLinked?: boolean;
  impactScore?: number;
  domain?: InsightDomain;
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
    page_title: params.pageTitle ?? null,
    strategy_keyword: params.strategyKeyword ?? null,
    strategy_alignment: params.strategyAlignment ?? null,
    audit_issues: params.auditIssues ?? null,
    pipeline_status: params.pipelineStatus ?? null,
    anomaly_linked: params.anomalyLinked ? 1 : 0,
    impact_score: params.impactScore ?? 0,
    domain: params.domain ?? 'cross',
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

/**
 * Delete insights for a workspace+type whose computed_at is older than the given
 * threshold. Used after a computation cycle to prune rows that dropped out of
 * the current top-N set (e.g. a quick win that improved to position 2).
 */
export function deleteStaleInsightsByType(
  workspaceId: string,
  insightType: InsightType,
  olderThan: string,
): number {
  const stmt = db.prepare(
    `DELETE FROM analytics_insights WHERE workspace_id = ? AND insight_type = ? AND computed_at < ?`,
  );
  const info = stmt.run(workspaceId, insightType, olderThan);
  return info.changes;
}
