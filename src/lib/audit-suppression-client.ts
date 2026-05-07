/**
 * Client-side mirror of server/helpers.ts `applySuppressionsToAudit`.
 * Filters audit issues by suppression rules (exact + glob pattern), recalculates
 * page scores, and aggregates severity totals.
 *
 * Extracted from src/components/SeoAudit.tsx so the logic can be unit-tested in
 * isolation. Keep this in sync with `applySuppressionsToAudit` in
 * `server/helpers.ts` — divergence between client and server suppression
 * behavior produces silent UI/data drift.
 */
import type { SeoAuditResult } from '../components/audit/types';
import { computePageScore } from '../../shared/scoring';

export interface ClientSuppression {
  check: string;
  pageSlug: string;
  pagePattern?: string;
}

/**
 * Apply suppression rules to an audit result. Returns the original `data`
 * untouched when no suppressions are active.
 */
export function applyClientSuppressions(
  data: SeoAuditResult,
  suppressions: readonly ClientSuppression[],
): SeoAuditResult {
  const exactSupps = suppressions.filter(s => !s.pagePattern);
  const patternSupps = suppressions.filter(s => s.pagePattern);
  // `::` separator matches server/helpers.ts so a check name containing a
  // single colon (e.g. `og:title`) cannot collide with a different
  // {check, pageSlug} pair when concatenated.
  const suppSet = new Set(exactSupps.map(s => `${s.check}::${s.pageSlug}`));
  if (suppSet.size === 0 && patternSupps.length === 0) return data;

  // Simple glob matcher for client-side pattern filtering
  const patternMatchers = patternSupps.map(s => {
    const escaped = s.pagePattern!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return { check: s.check, regex: new RegExp(`^${regexStr}$`, 'i') };
  });

  const pages = data.pages.map(page => {
    const filtered = page.issues.filter(i => {
      if (suppSet.has(`${i.check}::${page.slug}`)) return false;
      for (const pm of patternMatchers) {
        if (pm.check === i.check && pm.regex.test(page.slug)) return false;
      }
      return true;
    });
    if (filtered.length === page.issues.length) return page;
    const score = computePageScore(filtered);
    return { ...page, issues: filtered, score };
  });

  const errors = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'error').length, 0);
  const warnings = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'warning').length, 0);
  const infos = pages.reduce((sum, p) => sum + p.issues.filter(i => i.severity === 'info').length, 0);
  // Exclude noindex pages from site score — they don't affect search rankings
  const indexedPages = pages.filter(p => !p.noindex);
  const siteScore = indexedPages.length > 0 ? Math.round(indexedPages.reduce((sum, p) => sum + p.score, 0) / indexedPages.length) : 100;

  return { ...data, pages, errors, warnings, infos, siteScore };
}
