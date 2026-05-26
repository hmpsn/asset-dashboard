/**
 * Unit tests for server/sales-report-html.ts — pure helper functions.
 *
 * Note: server/authority-context.ts does not exist in this codebase.
 * This file covers the pure formatting and scoring helpers in sales-report-html.ts,
 * which are all exercised through the exported renderSalesReportHTML function.
 *
 * Pure helpers tested (indirectly, via renderSalesReportHTML output):
 * - scoreColor(score)     → hex color string
 * - scoreLabel(score)     → label string
 * - severityIcon(s)       → emoji icon
 * - categoryLabel(cat)    → human-readable category
 * - escHtml(s)            → HTML-escaped string
 */
import { describe, it, expect } from 'vitest';
import { renderSalesReportHTML } from '../../server/sales-report-html.js';
import type { SalesAuditResult, SalesIssue, SalesPageResult } from '../../server/sales-audit.js';

// ─── fixtures ─────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<SalesIssue> = {}): SalesIssue {
  return {
    check: 'title',
    severity: 'error',
    category: 'content',
    message: 'Missing page title',
    recommendation: 'Add a descriptive title tag to every page.',
    ...overrides,
  };
}

function makePage(overrides: Partial<SalesPageResult> = {}): SalesPageResult {
  return {
    page: 'Home',
    url: 'https://example.com/',
    score: 90,
    issues: [],
    ...overrides,
  };
}

function makeReport(overrides: Partial<SalesAuditResult> & { id?: string } = {}): SalesAuditResult & { id?: string } {
  return {
    url: 'https://example.com',
    siteName: 'Example Site',
    siteScore: 75,
    totalPages: 10,
    errors: 2,
    warnings: 3,
    infos: 1,
    pages: [],
    siteWideIssues: [],
    quickWins: [],
    topRisks: [],
    generatedAt: '2026-05-25T12:00:00.000Z',
    ...overrides,
  };
}

// ─── renderSalesReportHTML — basic structure ──────────────────────────────────

describe('renderSalesReportHTML — basic structure', () => {
  it('returns a valid HTML string', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('includes site name in the title tag', () => {
    const html = renderSalesReportHTML(makeReport({ siteName: 'My Agency Site' }));
    expect(html).toContain('My Agency Site');
  });

  it('includes the site URL in the report', () => {
    const html = renderSalesReportHTML(makeReport({ url: 'https://mysite.com' }));
    expect(html).toContain('https://mysite.com');
  });

  it('includes the site score in the output', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 82 }));
    expect(html).toContain('82');
  });

  it('includes total pages count', () => {
    const html = renderSalesReportHTML(makeReport({ totalPages: 42 }));
    expect(html).toContain('42');
  });

  it('includes the generated date formatted as long date', () => {
    const html = renderSalesReportHTML(makeReport({ generatedAt: '2026-05-25T12:00:00.000Z' }));
    // The date is formatted as "May 25, 2026"
    expect(html).toContain('2026');
  });
});

// ─── scoreColor — tested via ring stroke color in output ─────────────────────

describe('scoreColor (via rendered HTML)', () => {
  it('uses green (#22c55e) for score ≥ 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 80 }));
    expect(html).toContain('#22c55e');
  });

  it('uses green (#22c55e) for perfect score 100', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 100 }));
    expect(html).toContain('#22c55e');
  });

  it('uses yellow (#eab308) for score 60–79', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 60 }));
    expect(html).toContain('#eab308');
  });

  it('uses yellow (#eab308) for score 79', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 79 }));
    expect(html).toContain('#eab308');
  });

  it('uses orange (#f97316) for score 40–59', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 40 }));
    expect(html).toContain('#f97316');
  });

  it('uses orange (#f97316) for score 59', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 59 }));
    expect(html).toContain('#f97316');
  });

  it('uses red (#ef4444) for score < 40', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 39 }));
    expect(html).toContain('#ef4444');
  });

  it('uses red (#ef4444) for score 0', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 0 }));
    expect(html).toContain('#ef4444');
  });
});

// ─── scoreLabel — tested via label text in output ─────────────────────────────

describe('scoreLabel (via rendered HTML)', () => {
  it('shows "Strong" for score ≥ 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 85 }));
    expect(html).toContain('Strong');
  });

  it('shows "Needs Work" for score 60–79', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 65 }));
    expect(html).toContain('Needs Work');
  });

  it('shows "At Risk" for score 40–59', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 50 }));
    expect(html).toContain('At Risk');
  });

  it('shows "Critical" for score < 40', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 20 }));
    expect(html).toContain('Critical');
  });
});

// ─── scoreContext — narrative based on score range ───────────────────────────

describe('scoreContext narrative (via rendered HTML)', () => {
  it('shows well-optimized text for score ≥ 90', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 90 }));
    expect(html).toContain('well-optimized');
  });

  it('shows solid foundation text for score 80–89', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 84 }));
    expect(html).toContain('solid SEO foundation');
  });

  it('shows gaps text for score 60–79', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 70 }));
    expect(html).toContain('several SEO gaps');
  });

  it('shows critical deficiencies text for score 40–59', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 45 }));
    expect(html).toContain('critical SEO deficiencies');
  });

  it('shows fundamental issues text for score < 40', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 15 }));
    expect(html).toContain('fundamental SEO issues');
  });
});

// ─── escHtml — HTML entity escaping ──────────────────────────────────────────

describe('escHtml (via rendered HTML)', () => {
  it('escapes & in site name', () => {
    const html = renderSalesReportHTML(makeReport({ siteName: 'Smith & Jones' }));
    expect(html).toContain('Smith &amp; Jones');
    expect(html).not.toContain('Smith & Jones');
  });

  it('escapes < in site name', () => {
    const html = renderSalesReportHTML(makeReport({ siteName: 'Site <Test>' }));
    expect(html).toContain('Site &lt;Test&gt;');
  });

  it('escapes " in site name', () => {
    const html = renderSalesReportHTML(makeReport({ siteName: 'Site "Name"' }));
    expect(html).toContain('&quot;');
  });

  it('escapes & in URL', () => {
    const html = renderSalesReportHTML(makeReport({ url: 'https://example.com?a=1&b=2' }));
    expect(html).toContain('https://example.com?a=1&amp;b=2');
  });

  it('escapes characters in issue messages', () => {
    const issue = makeIssue({ message: 'Title has <script> tag' });
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── severityIcon (via rendered HTML) ─────────────────────────────────────────

describe('severityIcon (via rendered HTML)', () => {
  it('uses 🔴 for error severity', () => {
    const issue = makeIssue({ severity: 'error' });
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
    expect(html).toContain('🔴');
  });

  it('uses 🟡 for warning severity', () => {
    const issue = makeIssue({ severity: 'warning' });
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
    expect(html).toContain('🟡');
  });

  it('uses 🔵 for info severity', () => {
    const issue = makeIssue({ severity: 'info' });
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
    expect(html).toContain('🔵');
  });

  it('uses 🔵 for unknown severity', () => {
    // Force unknown severity via type cast
    const issue = makeIssue({ severity: 'unknown' as 'info' });
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
    expect(html).toContain('🔵');
  });
});

// ─── categoryLabel (via issue table) ─────────────────────────────────────────

describe('categoryLabel (via rendered HTML)', () => {
  const cases: Array<{ cat: string; label: string }> = [
    { cat: 'content', label: 'Content' },
    { cat: 'technical', label: 'Technical' },
    { cat: 'social', label: 'Social Media' },
    { cat: 'performance', label: 'Performance' },
    { cat: 'accessibility', label: 'Accessibility' },
  ];

  for (const { cat, label } of cases) {
    it(`renders "${label}" for category "${cat}"`, () => {
      const issue = makeIssue({ category: cat as SalesIssue['category'] });
      const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
      expect(html).toContain(label);
    });
  }

  it('falls back to "Technical" for unknown category', () => {
    const issue: SalesIssue = {
      check: 'test',
      severity: 'info',
      message: 'Test',
      recommendation: 'Fix it',
      // category is omitted
    };
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [issue] }));
    expect(html).toContain('Technical');
  });
});

// ─── issue deduplication and sorting ─────────────────────────────────────────

describe('issue deduplication and severity sorting', () => {
  it('deduplicates issues with same check+severity key', () => {
    const issues = [
      makeIssue({ check: 'title', severity: 'error', message: 'Missing title' }),
      makeIssue({ check: 'title', severity: 'error', message: 'Missing title' }),
      makeIssue({ check: 'title', severity: 'error', message: 'Missing title' }),
    ];
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: issues }));
    // Should show ×3 count
    expect(html).toContain('×3');
  });

  it('does not show count marker for unique issues', () => {
    const issues = [
      makeIssue({ check: 'title', severity: 'error', message: 'Missing title' }),
      makeIssue({ check: 'meta-description', severity: 'warning', message: 'No meta desc' }),
    ];
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: issues }));
    // Each appears once, no ×N marker expected
    expect(html).not.toContain('×1');
  });

  it('sorts errors before warnings in the All Issues Found section', () => {
    const issues = [
      makeIssue({ check: 'meta-description', severity: 'warning', message: 'No meta desc' }),
      makeIssue({ check: 'title', severity: 'error', message: 'Missing title' }),
    ];
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: issues }));
    // Both messages should appear
    expect(html).toContain('No meta desc');
    expect(html).toContain('Missing title');
    // In the "All Issues Found" section the table is sorted: errors first.
    // Extract just the All Issues Found section to test ordering there.
    const sectionStart = html.indexOf('All Issues Found');
    const sectionEnd = html.indexOf('Site-Wide Issues', sectionStart);
    const section = sectionEnd > sectionStart ? html.slice(sectionStart, sectionEnd) : html.slice(sectionStart);
    const errorIdx = section.indexOf('🔴');
    const warningIdx = section.indexOf('🟡');
    expect(errorIdx).toBeGreaterThanOrEqual(0);
    expect(warningIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeLessThan(warningIdx);
  });
});

// ─── visibility risk assessment ───────────────────────────────────────────────

describe('visibility risk assessment', () => {
  it('includes the Search Visibility Risk Assessment section', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html).toContain('Search Visibility Risk Assessment');
  });

  it('shows missing titles count when pages have title errors', () => {
    const page = makePage({
      score: 30,
      issues: [makeIssue({ check: 'title', severity: 'error', message: 'Missing title' })],
    });
    const html = renderSalesReportHTML(makeReport({ pages: [page], totalPages: 5 }));
    expect(html).toContain('Missing titles');
  });

  it('shows missing descriptions count when pages have meta-description issues', () => {
    const page = makePage({
      score: 50,
      issues: [makeIssue({ check: 'meta-description', severity: 'warning', message: 'No description' })],
    });
    const html = renderSalesReportHTML(makeReport({ pages: [page], totalPages: 5 }));
    expect(html).toContain('Missing descriptions');
  });

  it('shows percentage of pages with issues', () => {
    const pages = [
      makePage({ score: 90, issues: [] }),
      makePage({ score: 50, issues: [makeIssue()] }),
      makePage({ score: 40, issues: [makeIssue()] }),
      makePage({ score: 80, issues: [] }),
    ];
    const html = renderSalesReportHTML(makeReport({ pages, totalPages: 4 }));
    // 2 of 4 pages = 50%
    expect(html).toContain('50%');
  });

  it('shows 0% when no pages have issues', () => {
    const pages = [makePage({ score: 95, issues: [] }), makePage({ score: 88, issues: [] })];
    const html = renderSalesReportHTML(makeReport({ pages, totalPages: 2 }));
    expect(html).toContain('0% of pages have at least one SEO issue');
  });
});

// ─── quickWins section ────────────────────────────────────────────────────────

describe('quickWins section', () => {
  it('renders quick wins when present', () => {
    const win = makeIssue({
      check: 'meta-description',
      severity: 'warning',
      message: 'Add a meta description',
      recommendation: 'Write a 150-160 character description.',
    });
    const html = renderSalesReportHTML(makeReport({ quickWins: [win] }));
    expect(html).toContain('Quick Wins');
    expect(html).toContain('Add a meta description');
  });

  it('omits quick wins section when empty', () => {
    const html = renderSalesReportHTML(makeReport({ quickWins: [] }));
    // Quick Wins section title should not appear
    expect(html).not.toContain('<h2>Quick Wins</h2>');
  });

  it('shows impact percentage when affected pages > 1', () => {
    const win = makeIssue({ check: 'meta-description', severity: 'warning', message: 'Add meta desc', recommendation: 'Add it' });
    const pages = [
      makePage({ issues: [makeIssue({ check: 'meta-description', severity: 'warning', message: 'No desc', recommendation: 'Add it' })] }),
      makePage({ issues: [makeIssue({ check: 'meta-description', severity: 'warning', message: 'No desc', recommendation: 'Add it' })] }),
      makePage({ issues: [] }),
    ];
    const html = renderSalesReportHTML(makeReport({ quickWins: [win], pages, totalPages: 3 }));
    // 2 of 3 = 67%
    expect(html).toContain('67%');
  });
});

// ─── What's Working Well section ─────────────────────────────────────────────

describe("What's Working Well section", () => {
  it('shows SSL positive signal when no SSL site-wide issue', () => {
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [] }));
    expect(html).toContain('SSL certificate is properly configured');
  });

  it('shows robots.txt positive signal when no robots-txt error', () => {
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [] }));
    expect(html).toContain('robots.txt is properly configured');
  });

  it('shows sitemap positive signal when no sitemap error', () => {
    const html = renderSalesReportHTML(makeReport({ siteWideIssues: [] }));
    expect(html).toContain('XML sitemap is present and accessible');
  });

  it('highlights perfect-scoring pages (≥ 95)', () => {
    const pages = [makePage({ score: 97 }), makePage({ score: 82 })];
    const html = renderSalesReportHTML(makeReport({ pages }));
    expect(html).toContain('near-perfect SEO scores');
  });

  it('highlights pages scoring 80+', () => {
    const pages = [makePage({ score: 85 })];
    const html = renderSalesReportHTML(makeReport({ pages }));
    expect(html).toContain('scoring 80+');
  });

  it('omits Working Well section when no positive signals', () => {
    // All site-wide issues are critical, suppressing positive signals
    const siteWideIssues = [
      makeIssue({ check: 'ssl', severity: 'error', message: 'SSL missing', recommendation: 'Add SSL' }),
      makeIssue({ check: 'robots-txt', severity: 'error', message: 'robots.txt missing', recommendation: 'Add robots.txt' }),
      makeIssue({ check: 'sitemap', severity: 'error', message: 'sitemap missing', recommendation: 'Add sitemap' }),
    ];
    const html = renderSalesReportHTML(makeReport({ siteWideIssues, pages: [] }));
    // With no pages and all site-wide issues blocking positives, Working Well should not appear
    expect(html).not.toContain("What&#x27;s Working Well");
  });
});

// ─── top risks section ────────────────────────────────────────────────────────

describe('topRisks section', () => {
  it('renders top risks when present', () => {
    const risk = makeIssue({
      check: 'ssl',
      severity: 'error',
      message: 'No SSL certificate',
      recommendation: 'Install SSL certificate',
      opportunityCost: 'Browsers warn users, hurting trust and conversions.',
    });
    const html = renderSalesReportHTML(makeReport({ topRisks: [risk] }));
    expect(html).toContain('Top Risks');
    expect(html).toContain('No SSL certificate');
    expect(html).toContain('Browsers warn users');
  });

  it('omits top risks section when empty', () => {
    const html = renderSalesReportHTML(makeReport({ topRisks: [] }));
    expect(html).not.toContain('<h2>Top Risks</h2>');
  });

  it('omits opportunityCost block when not provided', () => {
    const risk = makeIssue({ check: 'ssl', severity: 'error', message: 'No SSL', recommendation: 'Add SSL' });
    const html = renderSalesReportHTML(makeReport({ topRisks: [risk] }));
    // risk-cost div should not be present
    expect(html).not.toContain('class="risk-cost"');
  });
});

// ─── recommended next steps ───────────────────────────────────────────────────

describe('recommended next steps section', () => {
  it('always includes the basic next steps', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html).toContain('Recommended Next Steps');
    expect(html).toContain('unique title, meta description, and H1 tag');
  });

  it('adds critical error fix step when errors exist', () => {
    const pages = [makePage({ issues: [makeIssue({ severity: 'error' })] })];
    const html = renderSalesReportHTML(makeReport({ pages, siteWideIssues: [makeIssue({ severity: 'error' })] }));
    expect(html).toContain('critical errors');
  });

  it('adds follow-up audit step when score < 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 60 }));
    expect(html).toContain('Schedule a follow-up audit');
  });

  it('does not add follow-up audit step when score ≥ 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 80 }));
    expect(html).not.toContain('Schedule a follow-up audit');
  });

  it('includes quick wins count in next steps when wins present', () => {
    const win = makeIssue({ check: 'og-tags', severity: 'warning', message: 'Add OG tags', recommendation: 'Fix it' });
    const html = renderSalesReportHTML(makeReport({ quickWins: [win], siteScore: 70 }));
    expect(html).toContain('1 quick win');
  });
});

// ─── page-by-page breakdown ───────────────────────────────────────────────────

describe('page-by-page breakdown', () => {
  it('renders page names and URLs', () => {
    const pages = [
      makePage({ page: 'Home', url: 'https://example.com/', score: 95 }),
      makePage({ page: 'About', url: 'https://example.com/about', score: 60 }),
    ];
    const html = renderSalesReportHTML(makeReport({ pages }));
    expect(html).toContain('Page-by-Page Breakdown');
    expect(html).toContain('Home');
    expect(html).toContain('About');
    expect(html).toContain('https://example.com/about');
  });

  it('shows "No issues found" for pages with no issues', () => {
    const pages = [makePage({ score: 100, issues: [] })];
    const html = renderSalesReportHTML(makeReport({ pages }));
    expect(html).toContain('No issues found');
  });

  it('renders page score badge', () => {
    const pages = [makePage({ score: 72 })];
    const html = renderSalesReportHTML(makeReport({ pages }));
    expect(html).toContain('72');
  });

  it('shows page issue messages', () => {
    const page = makePage({
      score: 40,
      issues: [makeIssue({ message: 'Title too long' })],
    });
    const html = renderSalesReportHTML(makeReport({ pages: [page] }));
    expect(html).toContain('Title too long');
  });

  it('uses correct score color for page score badge', () => {
    // Score 40 → orange
    const page = makePage({ score: 40 });
    const html = renderSalesReportHTML(makeReport({ pages: [page] }));
    expect(html).toContain('#f97316');
  });
});

// ─── footer ───────────────────────────────────────────────────────────────────

describe('footer', () => {
  it('includes pages scanned in footer', () => {
    const html = renderSalesReportHTML(makeReport({ totalPages: 15 }));
    expect(html).toContain('15 pages scanned');
  });

  it('includes "Prepared by" attribution in footer', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html).toContain('Prepared by');
  });
});
