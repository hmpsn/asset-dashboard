import type { SeoAuditResult } from './seo-audit.js';
import { applySuppressionsToAudit, type AuditSuppression } from './helpers.js';
import {
  getLatestSnapshot,
  getLatestSnapshotBefore,
  getSnapshot,
  listSnapshots,
  type AuditSnapshot,
  type SnapshotSummary,
} from './reports.js';

function hasSuppressions(suppressions: AuditSuppression[] | undefined): suppressions is AuditSuppression[] {
  return Array.isArray(suppressions) && suppressions.length > 0;
}

function normalizeAuditShape(audit: SeoAuditResult): SeoAuditResult {
  return {
    ...audit,
    infos: audit.infos ?? 0,
    pages: Array.isArray(audit.pages) ? audit.pages : [],
    siteWideIssues: Array.isArray(audit.siteWideIssues) ? audit.siteWideIssues : [],
  };
}

export function getEffectiveAudit(
  audit: SeoAuditResult,
  suppressions: AuditSuppression[] | undefined,
): SeoAuditResult {
  return hasSuppressions(suppressions)
    ? applySuppressionsToAudit(normalizeAuditShape(audit), suppressions)
    : audit;
}

export function getEffectivePreviousScore(
  snapshot: AuditSnapshot,
  suppressions: AuditSuppression[] | undefined,
): number | undefined {
  if (!hasSuppressions(suppressions)) return snapshot.previousScore;
  const previous = getLatestSnapshotBefore(snapshot.siteId, snapshot.id);
  return previous
    ? getEffectiveAudit(previous.audit, suppressions).siteScore
    : snapshot.previousScore;
}

export function toEffectiveAuditSnapshot(
  snapshot: AuditSnapshot,
  suppressions: AuditSuppression[] | undefined,
): AuditSnapshot {
  if (!hasSuppressions(suppressions)) return snapshot;
  return {
    ...snapshot,
    audit: getEffectiveAudit(snapshot.audit, suppressions),
    previousScore: getEffectivePreviousScore(snapshot, suppressions),
  };
}

export function getLatestEffectiveSnapshot(
  siteId: string,
  suppressions: AuditSuppression[] | undefined,
): AuditSnapshot | null {
  const latest = getLatestSnapshot(siteId);
  return latest ? toEffectiveAuditSnapshot(latest, suppressions) : null;
}

export function listEffectiveSnapshotSummaries(
  siteId: string,
  suppressions: AuditSuppression[] | undefined,
): SnapshotSummary[] {
  const summaries = listSnapshots(siteId);
  if (!hasSuppressions(suppressions)) return summaries;
  return summaries.map(summary => {
    const snapshot = getSnapshot(summary.id);
    if (!snapshot) return summary;
    const audit = getEffectiveAudit(snapshot.audit, suppressions);
    return {
      id: summary.id,
      createdAt: summary.createdAt,
      siteScore: audit.siteScore,
      totalPages: audit.totalPages,
      errors: audit.errors,
      warnings: audit.warnings,
      infos: audit.infos,
    };
  });
}
