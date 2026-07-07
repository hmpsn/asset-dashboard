import type { SeoAuditResult } from './seo-audit.js';
import { enrichAuditCategoryScoring } from './audit-category-scores.js';
import { CRITICAL_CHECKS, MODERATE_CHECKS, computePageScore } from '../shared/scoring.js';

export const CRITICAL_CHECKS_SET = new Set(CRITICAL_CHECKS);
export const MODERATE_CHECKS_SET = new Set(MODERATE_CHECKS);

export interface AuditSuppression { check: string; pageSlug: string; pagePattern?: string; reason?: string; createdAt: string }

/** Convert a simple glob pattern to a RegExp. Supports * (any chars) and ? (single char). */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i');
}

export function applySuppressionsToAudit(
  audit: SeoAuditResult,
  suppressions: AuditSuppression[],
): SeoAuditResult {
  if (!suppressions || suppressions.length === 0) return enrichAuditCategoryScoring(audit);

  const exactSupps = suppressions.filter(s => !s.pagePattern);
  const suppSet = new Set(exactSupps.map(s => `${s.check}::${s.pageSlug}`));
  const patternSupps = suppressions.filter(s => s.pagePattern);
  const patternMatchers = patternSupps.map(s => ({
    check: s.check,
    regex: globToRegex(s.pagePattern!),
  }));

  let totalErrors = 0, totalWarnings = 0, totalInfos = 0;

  const filteredPages = audit.pages.map(page => {
    const filteredIssues = page.issues.filter(issue => {
      if (suppSet.has(`${issue.check}::${page.slug}`)) return false;
      for (const pm of patternMatchers) {
        if (pm.check === issue.check && pm.regex.test(page.slug)) return false;
      }
      return true;
    });

    const score = computePageScore(filteredIssues);

    for (const i of filteredIssues) {
      if (i.severity === 'error') totalErrors++;
      else if (i.severity === 'warning') totalWarnings++;
      else totalInfos++;
    }

    return { ...page, issues: filteredIssues, score };
  });

  for (const i of audit.siteWideIssues) {
    if (i.severity === 'error') totalErrors++;
    else if (i.severity === 'warning') totalWarnings++;
    else totalInfos++;
  }

  const indexedPages = filteredPages.filter(p => !p.noindex);
  const siteScore = indexedPages.length > 0
    ? Math.round(indexedPages.reduce((s, r) => s + r.score, 0) / indexedPages.length)
    : 100;

  return enrichAuditCategoryScoring({
    ...audit,
    siteScore,
    totalPages: filteredPages.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: totalInfos,
    pages: filteredPages,
    siteWideIssues: audit.siteWideIssues,
    cwvSummary: audit.cwvSummary,
  });
}
