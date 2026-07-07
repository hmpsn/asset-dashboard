import type { SeoAuditResult } from './seo-audit.js';
import { applySuppressionsToAudit, type AuditSuppression } from './seo-audit-suppressions.js';
import { enrichAuditCategoryScoring } from './audit-category-scores.js';

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
    : enrichAuditCategoryScoring(normalized);
}

export function hasAuditSuppressions(
  suppressions: AuditSuppression[] | undefined,
): suppressions is AuditSuppression[] {
  return hasSuppressions(suppressions);
}
