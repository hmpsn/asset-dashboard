import { listDiagnosticReports } from './diagnostic-store.js';
import type { ClientDiagnosticSummary, DiagnosticReport } from '../shared/types/diagnostics.js';

export const CLIENT_DIAGNOSTIC_LIMIT = 5;

const INTERNAL_DIAGNOSTIC_TERMS = /\b(dataforseo|semrush|gsc|ga4|google search console|google analytics|openai|anthropic|api|provider|probe|crawler|raw|diagnostic context|source unavailable|source failed|failed source|internal (report|context|detail|note|error))\b/i;

function clientSafeTitle(title: string, fallback: string): string {
  const trimmed = title.trim();
  if (!trimmed || INTERNAL_DIAGNOSTIC_TERMS.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function projectClientDiagnosticReport(report: DiagnosticReport): ClientDiagnosticSummary | null {
  const clientSummary = report.clientSummary.trim();
  if (report.status !== 'completed' || !report.completedAt || clientSummary.length === 0) {
    return null;
  }

  return {
    id: report.id,
    insightId: report.insightId,
    anomalyType: report.anomalyType,
    affectedPages: report.affectedPages,
    clientSummary,
    rootCauses: report.rootCauses
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 3)
      .map(({ rank, title, confidence }) => ({
        rank,
        title: clientSafeTitle(title, 'Visibility signal changed'),
        confidence,
      })),
    remediationActions: report.remediationActions
      .slice(0, 3)
      .map(({ priority, title }) => ({
        priority,
        title: clientSafeTitle(title, 'Review the affected page'),
      })),
    createdAt: report.createdAt,
    completedAt: report.completedAt,
  };
}

export function listClientDiagnosticSummaries(
  workspaceId: string,
  limit = CLIENT_DIAGNOSTIC_LIMIT,
): ClientDiagnosticSummary[] {
  return listDiagnosticReports(workspaceId)
    .map(projectClientDiagnosticReport)
    .filter((report): report is ClientDiagnosticSummary => report !== null)
    .slice(0, limit);
}
