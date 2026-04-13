/**
 * Diagnostic Reports store — CRUD for deep diagnostic investigation reports.
 * Follows the analytics-insights-store pattern: stmt cache, row mapper, typed CRUD.
 */

import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { DiagnosticReport, DiagnosticStatus, DiagnosticContext, RootCause, RemediationAction } from '../shared/types/diagnostics.js';

// ── Row interface (SQLite shape) ────────────────────────────────────

interface DiagnosticReportRow {
  id: string;
  workspace_id: string;
  insight_id: string | null;
  anomaly_type: string;
  affected_pages: string;
  status: string;
  diagnostic_context: string;
  root_causes: string;
  remediation_actions: string;
  admin_report: string;
  client_summary: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// ── Stmt cache ──────────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO diagnostic_reports (id, workspace_id, insight_id, anomaly_type, affected_pages, status)
    VALUES (@id, @workspace_id, @insight_id, @anomaly_type, @affected_pages, @status)
  `),
  getById: db.prepare(`SELECT * FROM diagnostic_reports WHERE id = ?`),
  listByWorkspace: db.prepare(`
    SELECT * FROM diagnostic_reports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50
  `),
  // ws-scope-ok: id is a UUID primary key (workspace-unique); status-ok: internal store transitions only
  updateStatus: db.prepare(`
    UPDATE diagnostic_reports SET status = @status, error_message = @error_message WHERE id = @id
  `),
  // ws-scope-ok: id is a UUID primary key (workspace-unique)
  updateCompleted: db.prepare(`
    UPDATE diagnostic_reports
    SET status = 'completed',
        diagnostic_context = @diagnostic_context,
        root_causes = @root_causes,
        remediation_actions = @remediation_actions,
        admin_report = @admin_report,
        client_summary = @client_summary,
        completed_at = datetime('now')
    WHERE id = @id
  `),
  deleteByWorkspace: db.prepare(`DELETE FROM diagnostic_reports WHERE workspace_id = ?`),
  getByInsightId: db.prepare(`
    SELECT * FROM diagnostic_reports WHERE workspace_id = ? AND insight_id = ? ORDER BY created_at DESC LIMIT 1
  `),
}));

// ── Row mapper ──────────────────────────────────────────────────────

function rowToReport(row: DiagnosticReportRow): DiagnosticReport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    insightId: row.insight_id,
    anomalyType: row.anomaly_type,
    affectedPages: parseJsonFallback<string[]>(row.affected_pages, []),
    status: row.status as DiagnosticStatus,
    diagnosticContext: parseJsonFallback<DiagnosticContext>(row.diagnostic_context, {} as DiagnosticContext),
    rootCauses: parseJsonFallback<RootCause[]>(row.root_causes, []),
    remediationActions: parseJsonFallback<RemediationAction[]>(row.remediation_actions, []),
    adminReport: row.admin_report,
    clientSummary: row.client_summary,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function createDiagnosticReport(
  workspaceId: string,
  insightId: string,
  anomalyType: string,
  affectedPages: string[],
): DiagnosticReport {
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    insight_id: insightId,
    anomaly_type: anomalyType,
    affected_pages: JSON.stringify(affectedPages),
    status: 'running',
  });
  return getDiagnosticReport(id)!;
}

export function getDiagnosticReport(id: string): DiagnosticReport | null {
  const row = stmts().getById.get(id) as DiagnosticReportRow | undefined;
  return row ? rowToReport(row) : null;
}

export function listDiagnosticReports(workspaceId: string): DiagnosticReport[] {
  const rows = stmts().listByWorkspace.all(workspaceId) as DiagnosticReportRow[];
  return rows.map(rowToReport);
}

export function getReportForInsight(workspaceId: string, insightId: string): DiagnosticReport | null {
  const row = stmts().getByInsightId.get(workspaceId, insightId) as DiagnosticReportRow | undefined;
  return row ? rowToReport(row) : null;
}

export function markDiagnosticFailed(id: string, errorMessage: string): void {
  stmts().updateStatus.run({ id, status: 'failed', error_message: errorMessage });
}

export function completeDiagnosticReport(
  id: string,
  result: {
    diagnosticContext: DiagnosticContext;
    rootCauses: RootCause[];
    remediationActions: RemediationAction[];
    adminReport: string;
    clientSummary: string;
  },
): DiagnosticReport | null {
  stmts().updateCompleted.run({
    id,
    diagnostic_context: JSON.stringify(result.diagnosticContext),
    root_causes: JSON.stringify(result.rootCauses),
    remediation_actions: JSON.stringify(result.remediationActions),
    admin_report: result.adminReport,
    client_summary: result.clientSummary,
  });
  return getDiagnosticReport(id);
}
