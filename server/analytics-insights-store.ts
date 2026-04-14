import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { AnalyticsInsight, InsightType, InsightSeverity, InsightDomain, InsightDataMap, AnomalyDigestData } from '../shared/types/analytics.js';
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
  resolution_status: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolution_source: string | null;
  bridge_source: string | null;
}

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO analytics_insights (
      id, workspace_id, page_id, insight_type, data, severity, computed_at,
      page_title, strategy_keyword, strategy_alignment, audit_issues,
      pipeline_status, anomaly_linked, impact_score, domain, resolution_source,
      bridge_source
    )
    VALUES (
      @id, @workspace_id, @page_id, @insight_type, @data, @severity, @computed_at,
      @page_title, @strategy_keyword, @strategy_alignment, @audit_issues,
      @pipeline_status, @anomaly_linked, @impact_score, @domain, @resolution_source,
      @bridge_source
    )
    ON CONFLICT(workspace_id, COALESCE(page_id, '__workspace__'), insight_type) DO UPDATE SET
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
      domain             = excluded.domain,
      resolution_source  = COALESCE(excluded.resolution_source, resolution_source),
      bridge_source      = excluded.bridge_source
      -- resolution_status, resolution_note, resolved_at intentionally omitted:
      -- background recomputation must not un-resolve admin work.
  `),
  selectByWorkspace: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? ORDER BY impact_score DESC`,
  ),
  selectByWorkspaceAndType: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? AND insight_type = ? ORDER BY impact_score DESC`,
  ),
  selectOne: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? AND page_id IS ? AND insight_type = ?`,
  ),
  deleteByWorkspace: db.prepare(
    `DELETE FROM analytics_insights WHERE workspace_id = ?`,
  ),
  selectByDomain: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? AND domain = ? ORDER BY impact_score DESC`,
  ),
  updateResolution: db.prepare(
    `UPDATE analytics_insights SET resolution_status = ?, resolution_note = ?, resolution_source = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?`,
  ),
  selectUnresolved: db.prepare(
    `SELECT * FROM analytics_insights WHERE workspace_id = ? AND (resolution_status IS NULL OR resolution_status != 'resolved') AND severity IN ('critical', 'warning') ORDER BY impact_score DESC LIMIT 25`,
  ),
  selectById: db.prepare(
    `SELECT * FROM analytics_insights WHERE id = ? AND workspace_id = ?`,
  ),
  deleteStaleByType: db.prepare(
    `DELETE FROM analytics_insights WHERE workspace_id = ? AND insight_type = ? AND computed_at < ? AND resolution_status IS NULL AND bridge_source IS NULL`,
  ),
  stampData: db.prepare(
    `UPDATE analytics_insights SET data = ? WHERE id = ? AND workspace_id = ?`, // ws-scope-ok: both id and workspace_id in WHERE
  ),
  deleteById: db.prepare(
    `DELETE FROM analytics_insights WHERE id = ? AND workspace_id = ?`,
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
    resolutionStatus: (row.resolution_status as AnalyticsInsight['resolutionStatus']) ?? null,
    resolutionNote: row.resolution_note ?? null,
    resolvedAt: row.resolved_at ?? null,
    resolutionSource: row.resolution_source ?? null,
    bridgeSource: row.bridge_source ?? null,
  };
}

export interface UpsertInsightParams {
  workspaceId: string;
  pageId: string | null;
  insightType: InsightType;
  data: InsightDataMap[InsightType];
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
  resolutionSource?: string | null;
  bridgeSource?: string | null;
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
    resolution_source: params.resolutionSource ?? null,
    bridge_source: params.bridgeSource ?? null,
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
  const info = stmts().deleteStaleByType.run(workspaceId, insightType, olderThan);
  return info.changes;
}

// ── Anomaly Digest helpers ──────────────────────────────────────

/**
 * Upsert an anomaly digest insight with deduplication.
 * The dedupKey becomes the pageId so the partial unique index
 * (workspace_id, insight_type, page_id WHERE insight_type='anomaly_digest')
 * prevents duplicate rows for the same anomaly type + metric combo.
 */
export function upsertAnomalyDigestInsight(params: {
  workspaceId: string;
  anomalyType: string;
  metric: string;
  data: AnomalyDigestData;
  severity: InsightSeverity;
  domain: InsightDomain;
  impactScore: number;
}): AnalyticsInsight {
  const dedupKey = `anomaly:${params.anomalyType}:${params.metric}`;
  return upsertInsight({
    workspaceId: params.workspaceId,
    pageId: dedupKey,
    insightType: 'anomaly_digest',
    data: params.data,
    severity: params.severity,
    anomalyLinked: true,
    impactScore: params.impactScore,
    domain: params.domain,
  });
}

/**
 * Fetch insights for a workspace filtered by domain, ordered by impact_score DESC.
 */
export function getInsightsByDomain(
  workspaceId: string,
  domain: string,
): AnalyticsInsight[] {
  const rows = stmts().selectByDomain.all(workspaceId, domain) as InsightRow[];
  return rows.map(rowToInsight);
}

// ── Resolution tracking ──────────────────────────────────────────

export function getInsightById(id: string, workspaceId: string): AnalyticsInsight | undefined {
  const row = stmts().selectById.get(id, workspaceId) as InsightRow | undefined;
  return row ? rowToInsight(row) : undefined;
}

export function resolveInsight(
  insightId: string,
  workspaceId: string,
  status: 'in_progress' | 'resolved',
  note?: string,
  resolutionSource?: string,
): AnalyticsInsight | undefined {
  const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
  const changes = stmts().updateResolution.run(status, note ?? null, resolutionSource ?? null, resolvedAt, insightId, workspaceId);
  // If workspace_id didn't match, UPDATE affects 0 rows — return undefined so the route sends 404
  if (changes.changes === 0) return undefined;
  return getInsightById(insightId, workspaceId);
}

export function getUnresolvedInsights(workspaceId: string): AnalyticsInsight[] {
  const rows = stmts().selectUnresolved.all(workspaceId) as InsightRow[];
  return rows.map(rowToInsight);
}

/**
 * Batch-delete insights by ID. Used by the validation pass to suppress
 * contradictory, duplicate, or low-confidence entries after computation.
 * Returns the total number of rows deleted.
 */
export function suppressInsights(workspaceId: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  const run = db.transaction(() => {
    let deleted = 0;
    for (const id of ids) {
      const info = stmts().deleteById.run(id, workspaceId);
      deleted += info.changes;
    }
    return deleted;
  });
  return run();
}

/**
 * Stamps a completed diagnostic report ID onto an anomaly digest insight's data blob.
 * Called by the diagnostic orchestrator after completeDiagnosticReport() succeeds,
 * so insight-narrative.ts can enrich the client summary with the report's clientSummary.
 */
export function stampDiagnosticReportId(workspaceId: string, insightId: string, reportId: string): void {
  const row = stmts().selectById.get(insightId, workspaceId) as InsightRow | undefined;
  if (!row) return;
  const parsed = parseJsonFallback<Record<string, unknown>>(row.data, {});
  stmts().stampData.run(JSON.stringify({ ...parsed, diagnosticReportId: reportId }), insightId, workspaceId);
}
