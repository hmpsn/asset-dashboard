/**
 * Shared scoring constants and logic for SEO audit page scores.
 * Imported by both server (audit-page.ts, helpers.ts) and client (SeoAudit.tsx).
 * These are the single source of truth — do not duplicate in other files.
 *
 * Weights calibrated to match industry tools (SEMRush, Ahrefs):
 *   error:   critical −15, other −10
 *   warning: critical −5, moderate −3, other −2
 *   info:    0 (no score impact — industry standard)
 */

export const CRITICAL_CHECKS = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
]);

export const MODERATE_CHECKS = new Set([
  'content-length', 'heading-hierarchy', 'internal-links', 'img-alt',
  'og-tags', 'og-image', 'link-text', 'url', 'lang', 'viewport',
  'duplicate-description', 'img-filesize', 'html-size',
]);

/**
 * Compute a 0–100 SEO page score from an array of audit issues.
 * Errors are meaningful deductions (broken fundamentals).
 * Warnings are mild deductions (improvement opportunities).
 * Info/notices have zero score impact (aspirational recommendations).
 */
export function computePageScore(
  issues: ReadonlyArray<{ check: string; severity: string }>,
): number {
  let score = 100;
  for (const issue of issues) {
    const isCritical = CRITICAL_CHECKS.has(issue.check);
    const isModerate = MODERATE_CHECKS.has(issue.check);
    if (issue.severity === 'error') {
      score -= isCritical ? 15 : 10;
    } else if (issue.severity === 'warning') {
      score -= isCritical ? 5 : isModerate ? 3 : 2;
    }
    // info severity: no score impact
  }
  return Math.max(0, Math.min(100, score));
}
