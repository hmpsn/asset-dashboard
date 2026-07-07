import type { AuditSuppression } from './seo-audit-suppressions.js';
import { getEffectiveAudit, hasAuditSuppressions } from './audit-suppression-projection.js';
import {
  getLatestSnapshot,
  getLatestSnapshotBefore,
  listSnapshotsDetailed,
  listSnapshots,
  type SnapshotSummary,
  type AuditSnapshot,
} from './reports.js';

export { getEffectiveAudit } from './audit-suppression-projection.js';

export function getEffectivePreviousScore(
  snapshot: AuditSnapshot,
  suppressions: AuditSuppression[] | undefined,
): number | undefined {
  if (!hasAuditSuppressions(suppressions)) return snapshot.previousScore;
  const previous = getLatestSnapshotBefore(snapshot.siteId, snapshot.id);
  return previous
    ? getEffectiveAudit(previous.audit, suppressions).siteScore
    : snapshot.previousScore;
}

export function toEffectiveAuditSnapshot(
  snapshot: AuditSnapshot,
  suppressions: AuditSuppression[] | undefined,
): AuditSnapshot {
  const audit = getEffectiveAudit(snapshot.audit, suppressions);
  if (!hasAuditSuppressions(suppressions)) {
    return {
      ...snapshot,
      audit,
    };
  }
  return {
    ...snapshot,
    audit,
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
  if (!hasAuditSuppressions(suppressions)) return listSnapshots(siteId);
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
