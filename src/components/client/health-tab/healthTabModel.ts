import { CAT_LABELS } from '../types';
import type { AuditDetail, PageAuditResult, SeoIssue } from '../types';
import type { SeverityFilter } from './useHealthTabShell';

interface CategoryStats {
  errors: number;
  warnings: number;
  infos: number;
}

interface FixTypeGroup {
  check: string;
  label: string;
  severity: SeoIssue['severity'];
  pages: Array<{
    pageId: string;
    page: string;
    url: string;
    recommendation?: string;
  }>;
}

const CHECK_IMPACT: Record<string, string> = {
  title: 'The page title is the first thing people see in Google search results. It directly controls whether they click or scroll past.',
  'meta-description': 'Google shows this text below your link in search results. A missing or poor description means fewer people click through to your site.',
  h1: 'The main heading tells Google what your page is about. Without it, your page is harder to rank for relevant searches.',
  canonical: 'Without this, Google may split your ranking power across multiple URLs - weakening your position for all of them.',
  'duplicate-title': 'Having two pages with the same title confuses Google about which one to show. It can reduce rankings for both.',
  'duplicate-description': 'Duplicate descriptions make it harder for Google to understand what makes each page unique.',
  'img-alt': 'Missing alt text hides your images from Google Image Search and creates accessibility barriers for screen reader users.',
  'og-tags': 'Without these, links shared to social media show no title, description, or image - significantly reducing click-through.',
  'og-image': 'Without a preview image, social shares look bare and get far fewer clicks than posts with rich previews.',
  'structured-data': 'Schema markup can unlock rich results in Google - stars, FAQs, breadcrumbs - which stand out and get more clicks.',
  'internal-links': 'Internal links spread authority across your site and help Google discover all your pages.',
  'content-length': "Pages with thin content are less likely to rank. Google prefers pages that fully answer a user's question.",
  'redirect-chains': 'Every redirect hop slows your page down and weakens the SEO authority passed through the link.',
  'mixed-content': 'HTTP content on an HTTPS page triggers browser security warnings that erode visitor trust.',
  ssl: 'Google gives a small ranking boost to secure HTTPS pages. Insecure pages also display warnings in browsers.',
  viewport: "Without a viewport tag, your page won't scale correctly on mobile - and most searches now happen on phones.",
  lang: 'The language attribute helps Google serve your content to the right audience in the right language.',
  robots: 'The robots meta tag controls whether Google can index this page. An incorrect setting can hide it from search entirely.',
  'heading-hierarchy': 'A clear heading structure (H1, H2, H3) helps Google understand your content and helps visitors scan the page.',
  cwv: 'Google uses page speed and stability as a ranking signal - slow or jumpy pages rank lower and lose visitors.',
  'cwv-lcp': 'Slow loading speed causes visitors to leave before your page even appears. Google penalizes slow-loading pages.',
  'cwv-cls': 'Content that shifts while loading frustrates visitors and can cause accidental clicks. Google flags this as poor experience.',
  'aeo-author': 'AI answer engines (ChatGPT, Google AI Overviews) prefer citing content with named, credentialed authors.',
  'aeo-date': "Undated content gets deprioritized by AI systems that can't verify freshness - a quick fix with lasting benefit.",
  'aeo-answer-first': 'AI systems extract the first substantive paragraph as their citation. Generic intros waste that prime position.',
  'aeo-faq-no-schema': 'FAQ schema makes Q&A pairs directly extractable by AI answer engines and can unlock rich results in Google.',
  'aeo-hidden-content': "Content hidden in accordions or tabs often isn't read by search crawlers or AI systems.",
  'aeo-citations': 'Pages that cite authoritative sources (.gov, .edu, journals) are trusted more by AI systems.',
  'aeo-dark-patterns': 'Aggressive overlays and autoplay reduce content accessibility for AI retrieval systems.',
};

const FIX_TYPE_LABELS: Record<string, string> = {
  title: 'Page Titles',
  'meta-description': 'Meta Descriptions',
  h1: 'Headings (H1)',
  canonical: 'Canonical Tags',
  'img-alt': 'Image Alt Text',
  'og-tags': 'Social Media Tags',
  'og-image': 'Social Media Images',
  'structured-data': 'Schema / Structured Data',
  'internal-links': 'Internal Links',
  'content-length': 'Content Length',
  'redirect-chains': 'Redirect Chains',
  'mixed-content': 'Mixed Content',
  ssl: 'SSL / HTTPS',
  viewport: 'Mobile Viewport',
  robots: 'Robots / Indexing',
  'heading-hierarchy': 'Heading Structure',
  cwv: 'Core Web Vitals',
  'duplicate-title': 'Duplicate Titles',
  'duplicate-description': 'Duplicate Descriptions',
};

export function checkImpact(check: string): string | null {
  const normalizedCheck = check.toLowerCase();
  return CHECK_IMPACT[normalizedCheck] || null;
}

export function filterAuditPages(
  pages: PageAuditResult[],
  searchTerm: string,
  severityFilter: SeverityFilter,
  showInfoItems: boolean,
  resolveLiveUrl: (url: string) => string,
): PageAuditResult[] {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  return pages.filter((page) => {
    if (normalizedSearch) {
      const pageMatch = page.page.toLowerCase().includes(normalizedSearch);
      const liveUrlMatch = resolveLiveUrl(page.url).toLowerCase().includes(normalizedSearch);
      if (!pageMatch && !liveUrlMatch) return false;
    }

    if (severityFilter === 'all') {
      if (!showInfoItems) return page.issues.some((issue) => issue.severity !== 'info');
      return true;
    }

    return page.issues.some((issue) => issue.severity === severityFilter);
  });
}

export function buildCategoryStats(detail: AuditDetail | null): Record<string, CategoryStats> {
  if (!detail) return {};

  const categories: Record<string, CategoryStats> = {};
  detail.audit.pages.forEach((page) =>
    page.issues.forEach((issue) => {
      const category = issue.category || 'other';
      if (!categories[category]) categories[category] = { errors: 0, warnings: 0, infos: 0 };

      if (issue.severity === 'error') categories[category].errors += 1;
      else if (issue.severity === 'warning') categories[category].warnings += 1;
      else categories[category].infos += 1;
    }),
  );
  return categories;
}

export function countInfoIssues(detail: AuditDetail | null): number {
  if (!detail) return 0;
  return detail.audit.pages.reduce(
    (sum, page) => sum + page.issues.filter((issue) => issue.severity === 'info').length,
    0,
  );
}

export function buildFixTypeGroups(
  detail: AuditDetail,
  severityFilter: SeverityFilter,
  showInfoItems: boolean,
): FixTypeGroup[] {
  const groups = new Map<string, FixTypeGroup>();

  detail.audit.pages.forEach((page) => {
    page.issues.forEach((issue) => {
      if (!showInfoItems && issue.severity === 'info') return;
      if (severityFilter !== 'all' && issue.severity !== severityFilter) return;

      const key = issue.check || 'other';
      if (!groups.has(key)) {
        const fallbackLabel = issue.category
          ? `${CAT_LABELS[issue.category]?.label || issue.category}: ${key}`
          : key;
        groups.set(key, {
          check: key,
          label: FIX_TYPE_LABELS[key.toLowerCase()] || fallbackLabel,
          severity: issue.severity,
          pages: [],
        });
      }

      const group = groups.get(key);
      if (!group) return;

      if (issue.severity === 'error' && group.severity !== 'error') group.severity = 'error';
      else if (issue.severity === 'warning' && group.severity === 'info') group.severity = 'warning';

      group.pages.push({
        pageId: page.pageId,
        page: page.page,
        url: page.url,
        recommendation: issue.recommendation,
      });
    });
  });

  return [...groups.values()].sort((a, b) => {
    const severityScore = (severity: string) => (severity === 'error' ? 3 : severity === 'warning' ? 2 : 1);
    const severityDiff = severityScore(b.severity) - severityScore(a.severity);
    if (severityDiff !== 0) return severityDiff;
    return b.pages.length - a.pages.length;
  });
}
