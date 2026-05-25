/**
 * Wave 22 — Unit tests for server/sales-report-html.ts
 *
 * Internal pure helpers (not exported):
 *   - scoreColor(score): returns hex color based on score thresholds
 *   - scoreLabel(score): returns text label (Strong/Needs Work/At Risk/Critical)
 *   - severityIcon(s): returns emoji icon for severity level
 *   - categoryLabel(cat?): returns human-readable category name
 *   - escHtml(s): HTML entity escaping
 *
 * Exported:
 *   - renderSalesReportHTML(report): produces full HTML string
 *
 * Tests verify all helper behaviors via rendered output, plus
 * the data-analyst enhancement sections (score context, visibility risk,
 * working well, next steps, quick wins, deduplication).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { SalesAuditResult, SalesIssue, SalesPageResult } from '../../server/sales-audit.js';

let renderSalesReportHTML: (report: SalesAuditResult & { id?: string }) => string;

beforeAll(async () => {
  const mod = await import('../../server/sales-report-html.js');
  renderSalesReportHTML = mod.renderSalesReportHTML;
});

// ── Fixture factory ───────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<SalesIssue> = {}): SalesIssue {
  return {
    check: 'title',
    severity: 'error',
    category: 'content',
    message: 'Missing title tag',
    recommendation: 'Add a descriptive title tag',
    ...overrides,
  };
}

function makePage(overrides: Partial<SalesPageResult> = {}): SalesPageResult {
  return {
    page: 'Homepage',
    url: 'https://example.com',
    score: 85,
    issues: [],
    ...overrides,
  };
}

function makeReport(overrides: Partial<SalesAuditResult> = {}): SalesAuditResult {
  return {
    url: 'https://example.com',
    siteName: 'Example Site',
    siteScore: 75,
    totalPages: 10,
    errors: 2,
    warnings: 5,
    infos: 1,
    pages: [makePage()],
    siteWideIssues: [],
    quickWins: [],
    topRisks: [],
    generatedAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

// ── Document structure ────────────────────────────────────────────────────────

describe('renderSalesReportHTML — document structure', () => {
  it('returns a string starting with DOCTYPE', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('includes site name in the page title', () => {
    const html = renderSalesReportHTML(makeReport({ siteName: 'Acme Corp' }));
    expect(html).toContain('SEO Report — Acme Corp');
  });

  it('displays the site URL in the header', () => {
    const html = renderSalesReportHTML(makeReport({ url: 'https://acme.example.com' }));
    expect(html).toContain('https://acme.example.com');
  });

  it('shows total pages count', () => {
    const html = renderSalesReportHTML(makeReport({ totalPages: 42 }));
    expect(html).toContain('42');
  });

  it('includes generation date in human-readable format', () => {
    const html = renderSalesReportHTML(makeReport({ generatedAt: '2026-05-01T12:00:00.000Z' }));
    expect(html).toContain('May 1, 2026');
  });

  it('includes STUDIO_NAME in footer', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html).toContain('hmpsn studio');
  });
});

// ── scoreColor helper (via rendered score ring) ───────────────────────────────

describe('renderSalesReportHTML — scoreColor', () => {
  it('uses green (#22c55e) for score >= 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 85 }));
    expect(html).toContain('#22c55e');
  });

  it('uses yellow (#eab308) for score >= 60 and < 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 65 }));
    expect(html).toContain('#eab308');
  });

  it('uses orange (#f97316) for score >= 40 and < 60', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 50 }));
    expect(html).toContain('#f97316');
  });

  it('uses red (#ef4444) for score < 40', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 30 }));
    expect(html).toContain('#ef4444');
  });

  it('uses green exactly at boundary score 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 80 }));
    expect(html).toContain('#22c55e');
  });

  it('uses yellow exactly at boundary score 60', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 60 }));
    expect(html).toContain('#eab308');
  });
});

// ── scoreLabel helper ─────────────────────────────────────────────────────────

describe('renderSalesReportHTML — scoreLabel', () => {
  it('shows "Strong" for score >= 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 90 }));
    expect(html).toContain('Strong');
  });

  it('shows "Needs Work" for score >= 60 and < 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 70 }));
    expect(html).toContain('Needs Work');
  });

  it('shows "At Risk" for score >= 40 and < 60', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 45 }));
    expect(html).toContain('At Risk');
  });

  it('shows "Critical" for score < 40', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 25 }));
    expect(html).toContain('Critical');
  });
});

// ── escHtml helper ────────────────────────────────────────────────────────────

describe('renderSalesReportHTML — HTML escaping', () => {
  it('escapes ampersands in site name', () => {
    const html = renderSalesReportHTML(makeReport({ siteName: 'Smith & Jones' }));
    expect(html).toContain('Smith &amp; Jones');
    expect(html).not.toContain('Smith & Jones');
  });

  it('escapes < and > in issue messages', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ message: 'Tag <script> found', recommendation: 'Remove it' })],
    }));
    expect(html).toContain('Tag &lt;script&gt; found');
  });

  it('escapes double quotes in recommendation text', () => {
    const html = renderSalesReportHTML(makeReport({
      topRisks: [makeIssue({ message: 'Issue', recommendation: 'Use "canonical" tags', severity: 'error' })],
    }));
    expect(html).toContain('Use &quot;canonical&quot; tags');
  });

  it('escapes URL containing & in site URL', () => {
    const html = renderSalesReportHTML(makeReport({ url: 'https://example.com?a=1&b=2' }));
    expect(html).toContain('https://example.com?a=1&amp;b=2');
  });
});

// ── severityIcon helper ───────────────────────────────────────────────────────

describe('renderSalesReportHTML — severityIcon', () => {
  it('shows red circle emoji for error severity', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ severity: 'error', message: 'Error issue', recommendation: 'Fix it' })],
    }));
    expect(html).toContain('🔴');
  });

  it('shows yellow circle emoji for warning severity', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ severity: 'warning', message: 'Warning issue', recommendation: 'Improve it' })],
    }));
    expect(html).toContain('🟡');
  });

  it('shows blue circle emoji for info severity', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ severity: 'info', message: 'Info issue', recommendation: 'Consider it' })],
    }));
    expect(html).toContain('🔵');
  });
});

// ── categoryLabel helper ──────────────────────────────────────────────────────

describe('renderSalesReportHTML — categoryLabel', () => {
  it('labels "content" category as "Content"', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ category: 'content', message: 'Content issue', recommendation: 'Fix' })],
    }));
    expect(html).toContain('Content');
  });

  it('labels "technical" category as "Technical"', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ category: 'technical', message: 'Technical issue', recommendation: 'Fix' })],
    }));
    expect(html).toContain('Technical');
  });

  it('labels "social" category as "Social Media"', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ category: 'social', message: 'Social issue', recommendation: 'Fix' })],
    }));
    expect(html).toContain('Social Media');
  });

  it('falls back to "Technical" for unknown category', () => {
    const html = renderSalesReportHTML(makeReport({
      siteWideIssues: [makeIssue({ category: undefined, message: 'Unknown cat issue', recommendation: 'Fix' })],
    }));
    expect(html).toContain('Technical');
  });
});

// ── Score context (data-analyst enhancement) ──────────────────────────────────

describe('renderSalesReportHTML — scoreContext', () => {
  it('shows "well-optimized" message for score >= 90', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 92 }));
    expect(html).toContain('well-optimized');
  });

  it('shows "solid SEO foundation" message for score 80-89', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 82 }));
    expect(html).toContain('solid SEO foundation');
  });

  it('shows "SEO gaps" message for score 60-79', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 65 }));
    expect(html).toContain('SEO gaps');
  });

  it('shows "critical SEO deficiencies" message for score 40-59', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 45 }));
    expect(html).toContain('critical SEO deficiencies');
  });

  it('shows "fundamental SEO issues" message for score < 40', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 20 }));
    expect(html).toContain('fundamental SEO issues');
  });
});

// ── Top risks section ─────────────────────────────────────────────────────────

describe('renderSalesReportHTML — top risks', () => {
  it('renders top risks section when topRisks is non-empty', () => {
    const html = renderSalesReportHTML(makeReport({
      topRisks: [makeIssue({ message: 'No SSL certificate', recommendation: 'Add SSL', opportunityCost: 'Losing trust signals' })],
    }));
    expect(html).toContain('Top Risks');
    expect(html).toContain('No SSL certificate');
  });

  it('renders opportunityCost when provided', () => {
    const html = renderSalesReportHTML(makeReport({
      topRisks: [makeIssue({ message: 'No SSL', recommendation: 'Add SSL', opportunityCost: 'Up to 50% of visitors may see browser warnings' })],
    }));
    expect(html).toContain('Up to 50% of visitors may see browser warnings');
  });

  it('omits top risks section when topRisks is empty', () => {
    const html = renderSalesReportHTML(makeReport({ topRisks: [] }));
    expect(html).not.toContain('Top Risks');
  });
});

// ── Quick wins section ────────────────────────────────────────────────────────

describe('renderSalesReportHTML — quick wins', () => {
  it('renders quick wins section when present', () => {
    const html = renderSalesReportHTML(makeReport({
      quickWins: [makeIssue({ check: 'title', message: 'Add title tags', recommendation: 'Create unique titles', severity: 'warning' })],
      pages: [
        makePage({ issues: [makeIssue({ check: 'title', severity: 'warning', message: 'Missing title', recommendation: 'Add title' })] }),
      ],
      totalPages: 5,
    }));
    expect(html).toContain('Quick Wins');
    expect(html).toContain('Add title tags');
  });

  it('shows affected page percentage for wins affecting multiple pages', () => {
    const html = renderSalesReportHTML(makeReport({
      quickWins: [makeIssue({ check: 'title', message: 'Add title tags', recommendation: 'Create unique titles', severity: 'warning' })],
      pages: [
        makePage({ issues: [makeIssue({ check: 'title', severity: 'warning', message: 'Missing title', recommendation: 'Add title' })] }),
        makePage({ page: 'About', url: 'https://example.com/about', score: 70, issues: [makeIssue({ check: 'title', severity: 'warning', message: 'Missing title', recommendation: 'Add title' })] }),
      ],
      totalPages: 4,
    }));
    // 2 affected pages out of 4 = 50%
    expect(html).toContain('50%');
  });

  it('omits quick wins section when array is empty', () => {
    const html = renderSalesReportHTML(makeReport({ quickWins: [] }));
    expect(html).not.toContain('Quick Wins');
  });
});

// ── Issue deduplication ───────────────────────────────────────────────────────

describe('renderSalesReportHTML — issue deduplication', () => {
  it('deduplicates issues from multiple pages by check+severity', () => {
    const titleError = makeIssue({ check: 'title', severity: 'error', message: 'Missing title', recommendation: 'Add title' });
    const html = renderSalesReportHTML(makeReport({
      pages: [
        makePage({ issues: [titleError], url: 'https://example.com/a', page: 'Page A' }),
        makePage({ issues: [titleError], url: 'https://example.com/b', page: 'Page B' }),
        makePage({ issues: [titleError], url: 'https://example.com/c', page: 'Page C' }),
      ],
      totalPages: 3,
    }));
    // Should show ×3 count in the All Issues table
    expect(html).toContain('×3');
  });

  it('does not show count multiplier for single-occurrence issues', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [makePage({ issues: [makeIssue({ message: 'Unique issue', recommendation: 'Fix it' })] })],
    }));
    // count === 1 → no ×N shown
    const allIssuesSection = html.match(/<h2>All Issues Found<\/h2>([\s\S]*?)<\/div>/)?.[0] ?? '';
    expect(allIssuesSection).not.toMatch(/×1/);
  });
});

// ── Page-by-page breakdown ────────────────────────────────────────────────────

describe('renderSalesReportHTML — page breakdown', () => {
  it('shows "No issues found" for pages with zero issues', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [makePage({ page: 'Homepage', score: 100, issues: [] })],
    }));
    expect(html).toContain('No issues found');
  });

  it('renders page score badge with scoreColor background', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [makePage({ page: 'Blog', url: 'https://example.com/blog', score: 30, issues: [] })],
    }));
    // score 30 → red (#ef4444)
    expect(html).toContain('#ef4444');
  });

  it('includes page name and URL in breakdown', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [makePage({ page: 'Services Page', url: 'https://example.com/services', score: 80, issues: [] })],
    }));
    expect(html).toContain('Services Page');
    expect(html).toContain('https://example.com/services');
  });
});

// ── Visibility risk assessment ────────────────────────────────────────────────

describe('renderSalesReportHTML — visibility risk cards', () => {
  it('shows missing titles risk card when title errors exist', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [
        makePage({ issues: [makeIssue({ check: 'title', severity: 'error', message: 'Missing title', recommendation: 'Add title' })] }),
      ],
      totalPages: 2,
    }));
    expect(html).toContain('Missing titles');
    expect(html).toContain('Invisible to search');
  });

  it('shows missing alt text risk card when img-alt issues exist', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [
        makePage({ issues: [makeIssue({ check: 'img-alt', severity: 'warning', message: 'Images missing alt', recommendation: 'Add alt text' })] }),
      ],
      totalPages: 2,
    }));
    expect(html).toContain('Missing alt text');
    expect(html).toContain('Accessibility gap');
  });

  it('shows percentage of pages with issues', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [
        makePage({ issues: [makeIssue()] }),
        makePage({ page: 'About', url: 'https://example.com/about', score: 100, issues: [] }),
      ],
      totalPages: 2,
    }));
    expect(html).toContain('50%');
  });
});

// ── Recommended next steps ────────────────────────────────────────────────────

describe('renderSalesReportHTML — recommended next steps', () => {
  it('always includes the "unique title, meta description, H1" step', () => {
    const html = renderSalesReportHTML(makeReport());
    expect(html).toContain('unique title');
  });

  it('mentions follow-up audit when score < 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 55 }));
    expect(html).toContain('30 days');
  });

  it('does NOT mention 30-day follow-up when score >= 80', () => {
    const html = renderSalesReportHTML(makeReport({ siteScore: 85 }));
    // "Schedule a follow-up audit in 30 days" only added when siteScore < 80
    const nextStepsHtml = html.match(/Recommended Next Steps([\s\S]*?)<\/div>\s*<\/div>/)?.[0] ?? '';
    expect(nextStepsHtml).not.toContain('30 days');
  });

  it('mentions fixing critical errors when errorCount > 0', () => {
    const html = renderSalesReportHTML(makeReport({
      pages: [makePage({ issues: [makeIssue({ severity: 'error', message: 'Error', recommendation: 'Fix' })] })],
    }));
    expect(html).toContain('critical errors');
  });
});
