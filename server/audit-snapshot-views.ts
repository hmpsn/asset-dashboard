import type { SeoAuditResult } from './seo-audit.js';
import { applySuppressionsToAudit, type AuditSuppression } from './helpers.js';
import {
  getLatestSnapshot,
  getLatestSnapshotBefore,
  listSnapshotsDetailed,
  listSnapshots,
  type SnapshotSummary,
  type AuditSnapshot,
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
  const normalized = normalizeAuditShape(audit);
  return hasSuppressions(suppressions)
    ? applySuppressionsToAudit(normalized, suppressions)
    : normalized;
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
  if (!hasSuppressions(suppressions)) return listSnapshots(siteId);
  const snapshots = listSnapshotsDetailed(siteId);
  return snapshots.map((snapshot, idx) => {
    const audit = getEffectiveAudit(snapshot.audit, suppressions);
    const previous = snapshots[idx + 1];
    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      siteScore: audit.siteScore,
      previousScore: previous
        ? getEffectiveAudit(previous.audit, suppressions).siteScore
        : snapshot.previousScore,
      totalPages: audit.totalPages,
      errors: audit.errors,
      warnings: audit.warnings,
      infos: audit.infos,
    };
  });
}
