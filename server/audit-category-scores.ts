import { computePageScore } from '../shared/scoring.js';
import {
  AUDIT_CATEGORY_SCORE_VERSION,
  AUDIT_DISPLAY_CATEGORIES,
  AUDIT_DISPLAY_CATEGORY_LABELS,
  type AuditCategoryScore,
  type AuditDisplayCategory,
} from '../shared/types/seo-audit.js';

type AuditSeverity = 'error' | 'warning' | 'info';

interface AuditIssueLike {
  check: string;
  severity: AuditSeverity;
  category?: string;
  displayCategory?: AuditDisplayCategory;
}

interface AuditPageLike<Issue extends AuditIssueLike = AuditIssueLike> {
  score: number;
  issues: Issue[];
  noindex?: boolean;
}

interface AuditResultLike<Page extends AuditPageLike = AuditPageLike, Issue extends AuditIssueLike = AuditIssueLike> {
  pages: Page[];
  siteWideIssues: Issue[];
  categoryScoreVersion?: number;
  categoryScores?: AuditCategoryScore[];
}

const CHECK_DISPLAY_CATEGORY: Record<string, AuditDisplayCategory> = {
  title: 'onpage',
  title_length: 'onpage',
  missing_title: 'onpage',
  'meta-description': 'onpage',
  meta_length: 'onpage',
  missing_meta: 'onpage',
  h1: 'onpage',
  missing_h1: 'onpage',
  duplicate_h1: 'onpage',
  'heading-hierarchy': 'onpage',
  'content-length': 'onpage',
  thin_content: 'onpage',
  low_word_count: 'onpage',
  url: 'onpage',
  'duplicate-title': 'onpage',
  'duplicate-description': 'onpage',
  'og-tags': 'onpage',
  'og-image': 'onpage',
  'aeo-author': 'onpage',
  'aeo-date': 'onpage',
  'aeo-answer-first': 'onpage',
  'aeo-citations': 'onpage',
  'aeo-trust-pages': 'onpage',

  canonical: 'index',
  missing_canonical: 'index',
  robots: 'index',
  'robots-txt': 'index',
  sitemap: 'index',
  ssl: 'index',
  indexability: 'index',
  'mixed-content': 'index',

  'structured-data': 'schema',
  missing_schema: 'schema',
  schema_errors: 'schema',
  'aeo-faq-no-schema': 'schema',

  'internal-links': 'links',
  'link-text': 'links',
  redirects: 'links',
  redirect_chain: 'links',
  redirect_chains: 'links',
  'redirect-chains': 'links',
  broken_link: 'links',
  'dead-links': 'links',
  'orphan-pages': 'links',

  'response-time': 'perf',
  'lazy-loading': 'perf',
  'img-dimensions': 'perf',
  'inline-css': 'perf',
  'inline-js': 'perf',
  'render-blocking': 'perf',
  'img-filesize': 'perf',
  'html-size': 'perf',
  cwv: 'perf',
  'cwv-lcp': 'perf',
  'cwv-cls': 'perf',
  'cwv-tbt': 'perf',

  viewport: 'mobile',
  lang: 'mobile',
  'img-alt': 'mobile',
  accessibility: 'mobile',
  'aeo-hidden-content': 'mobile',
  'aeo-dark-patterns': 'mobile',
};

const LEGACY_CATEGORY_DISPLAY: Record<string, AuditDisplayCategory> = {
  content: 'onpage',
  technical: 'index',
  social: 'onpage',
  performance: 'perf',
  accessibility: 'mobile',
};

export function auditDisplayCategoryFor(check: string | undefined, category?: string): AuditDisplayCategory {
  const normalizedCheck = check?.trim().toLowerCase();
  const byCheck = normalizedCheck ? CHECK_DISPLAY_CATEGORY[normalizedCheck] : undefined;
  if (byCheck) return byCheck;
  const normalizedCategory = category?.trim().toLowerCase();
  return normalizedCategory ? LEGACY_CATEGORY_DISPLAY[normalizedCategory] ?? 'index' : 'index';
}

function withDisplayCategory<Issue extends AuditIssueLike>(issue: Issue): Issue {
  return {
    ...issue,
    displayCategory: issue.displayCategory ?? auditDisplayCategoryFor(issue.check, issue.category),
  };
}

function countIssue(stats: { errors: number; warnings: number; infos: number }, issue: AuditIssueLike): void {
  if (issue.severity === 'error') stats.errors += 1;
  else if (issue.severity === 'warning') stats.warnings += 1;
  else stats.infos += 1;
}

export function computeAuditCategoryScores(
  pages: AuditPageLike[],
  siteWideIssues: AuditIssueLike[],
): AuditCategoryScore[] {
  const indexedPages = pages.filter((page) => !page.noindex);
  return AUDIT_DISPLAY_CATEGORIES.map((category) => {
    const categorySiteWideIssues = siteWideIssues.filter((issue) => {
      const displayCategory = issue.displayCategory ?? auditDisplayCategoryFor(issue.check, issue.category);
      return displayCategory === category;
    });
    const stats = {
      category,
      label: AUDIT_DISPLAY_CATEGORY_LABELS[category],
      score: 100,
      denominatorPages: indexedPages.length,
      affectedPages: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
    };

    if (indexedPages.length > 0) {
      const pageScores = indexedPages.map((page) => {
        const categoryIssues = page.issues.filter((issue) => (
          (issue.displayCategory ?? auditDisplayCategoryFor(issue.check, issue.category)) === category
        ));
        if (categoryIssues.length > 0) stats.affectedPages += 1;
        for (const issue of categoryIssues) countIssue(stats, issue);
        return computePageScore([...categoryIssues, ...categorySiteWideIssues]);
      });
      stats.score = Math.round(pageScores.reduce((sum, score) => sum + score, 0) / pageScores.length);
    } else if (categorySiteWideIssues.length > 0) {
      stats.score = computePageScore(categorySiteWideIssues);
    }

    for (const issue of categorySiteWideIssues) {
      countIssue(stats, issue);
    }

    return stats;
  });
}

export function enrichAuditCategoryScoring<
  Page extends AuditPageLike<Issue>,
  Issue extends AuditIssueLike,
  Audit extends AuditResultLike<Page, Issue>,
>(audit: Audit): Audit {
  const pages = audit.pages.map((page) => ({
    ...page,
    issues: page.issues.map(withDisplayCategory),
  })) as Page[];
  const siteWideIssues = audit.siteWideIssues.map(withDisplayCategory) as Issue[];

  return {
    ...audit,
    pages,
    siteWideIssues,
    categoryScoreVersion: AUDIT_CATEGORY_SCORE_VERSION,
    categoryScores: computeAuditCategoryScores(pages, siteWideIssues),
  };
}
