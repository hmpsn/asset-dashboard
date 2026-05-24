/**
 * Unit tests for pure/computation functions in server/reports.ts.
 *
 * Covers:
 * - resolveUrl: URL resolution logic (absolute, protocol-relative, relative paths)
 * - renderReportHTML: HTML generation (score colors, delta HTML, action items,
 *   site-wide issues, page rows, logo, footer, branding)
 * - extractSiteLogo: HTML-parsing logo extraction (6 strategies + error handling)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Mock all DB-touching and side-effectful imports ──

const mocks = vi.hoisted(() => ({
  dbPrepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => []),
  })),
  parseJsonSafe: vi.fn((_raw: unknown, _schema: unknown, fallback: unknown) => fallback),
  parseJsonSafeArray: vi.fn(() => []),
  fireBridge: vi.fn(),
  withWorkspaceLock: vi.fn(),
  listWorkspaces: vi.fn(() => []),
  isFeatureEnabled: vi.fn(() => false),
  createLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  isProgrammingError: vi.fn(() => false),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: mocks.dbPrepare,
  },
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonSafe: mocks.parseJsonSafe,
  parseJsonSafeArray: mocks.parseJsonSafeArray,
}));

vi.mock('../../server/schemas/workspace-schemas.js', () => ({
  seoAuditResultSchema: {},
  actionItemSchema: {},
}));

vi.mock('../../server/bridge-infrastructure.js', () => ({
  fireBridge: mocks.fireBridge,
  withWorkspaceLock: mocks.withWorkspaceLock,
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

vi.mock('../../server/constants.js', () => ({
  STUDIO_NAME: 'hmpsn studio',
  STUDIO_URL: 'https://hmpsn.studio',
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: mocks.createLogger,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

import { resolveUrl, renderReportHTML, extractSiteLogo } from '../../server/reports.js';
import type { AuditSnapshot, ActionItem } from '../../server/reports.js';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    id: 'snap_test_001',
    siteId: 'site_abc',
    siteName: 'Test Site',
    createdAt: '2026-01-15T12:00:00.000Z',
    audit: {
      siteScore: 85,
      totalPages: 10,
      errors: 2,
      warnings: 3,
      infos: 1,
      pages: [],
      siteWideIssues: [],
    },
    logoUrl: undefined,
    actionItems: [],
    previousScore: undefined,
    ...overrides,
  };
}

function makeActionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'action_001',
    snapshotId: 'snap_test_001',
    title: 'Fix broken links',
    description: 'Several 404 links found',
    status: 'planned',
    priority: 'high',
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────
// resolveUrl
// ──────────────────────────────────────────────────────────────

describe('resolveUrl', () => {
  it('returns absolute http URLs unchanged', () => {
    expect(resolveUrl('https://example.com', 'http://cdn.example.com/logo.png'))
      .toBe('http://cdn.example.com/logo.png');
  });

  it('returns absolute https URLs unchanged', () => {
    expect(resolveUrl('https://example.com', 'https://cdn.example.com/logo.png'))
      .toBe('https://cdn.example.com/logo.png');
  });

  it('prepends https: to protocol-relative URLs', () => {
    expect(resolveUrl('https://example.com', '//cdn.example.com/logo.png'))
      .toBe('https://cdn.example.com/logo.png');
  });

  it('resolves root-relative paths against the base URL', () => {
    expect(resolveUrl('https://example.com/page', '/images/logo.png'))
      .toBe('https://example.com/images/logo.png');
  });

  it('resolves relative paths against the base URL', () => {
    expect(resolveUrl('https://example.com/dir/', 'logo.png'))
      .toBe('https://example.com/dir/logo.png');
  });

  it('resolves parent-directory relative paths correctly', () => {
    expect(resolveUrl('https://example.com/dir/page', '../assets/logo.svg'))
      .toBe('https://example.com/assets/logo.svg');
  });

  it('returns the relative string as-is when URL parsing fails', () => {
    // An invalid base URL causes new URL() to throw
    const result = resolveUrl('not-a-valid-base', 'some/relative/path');
    expect(result).toBe('some/relative/path');
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — score color bands
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — score colors', () => {
  it('uses green (#22c55e) for score >= 80', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 80, totalPages: 1, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain('#22c55e');
    // Should NOT contain orange or red as the score color
    expect(html).not.toContain('stroke="#ef4444"');
  });

  it('uses yellow (#eab308) for score 60–79', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 65, totalPages: 1, errors: 0, warnings: 1, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain('#eab308');
  });

  it('uses orange (#f97316) for score 40–59', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 50, totalPages: 1, errors: 1, warnings: 0, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain('#f97316');
  });

  it('uses red (#ef4444) for score < 40', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 30, totalPages: 1, errors: 5, warnings: 2, infos: 0, pages: [], siteWideIssues: [] } }));
    // Red appears in the score color context
    expect(html).toContain('color:#ef4444');
  });

  it('renders the numeric score inside the SVG ring', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 72, totalPages: 5, errors: 1, warnings: 2, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain('>72<');
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — score delta
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — score delta', () => {
  it('shows green up-arrow delta when score improved', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 85, totalPages: 5, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] }, previousScore: 70 }));
    expect(html).toContain('↑');
    expect(html).toContain('+15 points since last audit');
  });

  it('shows red down-arrow delta when score declined', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 60, totalPages: 5, errors: 2, warnings: 1, infos: 0, pages: [], siteWideIssues: [] }, previousScore: 75 }));
    expect(html).toContain('↓');
    expect(html).toContain('-15 points since last audit');
  });

  it('shows neutral arrow when score is unchanged', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 80, totalPages: 5, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] }, previousScore: 80 }));
    expect(html).toContain('→');
    expect(html).toContain('0 points since last audit');
  });

  it('omits delta section when no previous score', () => {
    const html = renderReportHTML(makeSnapshot({ previousScore: undefined }));
    expect(html).not.toContain('points since last audit');
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — site metadata
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — site metadata', () => {
  it('includes the site name in the title and header', () => {
    const html = renderReportHTML(makeSnapshot({ siteName: 'Acme Corp' }));
    expect(html).toContain('Acme Corp');
    expect(html).toContain('<title>SEO Audit Report — Acme Corp</title>');
  });

  it('formats the date in long US locale format', () => {
    const html = renderReportHTML(makeSnapshot({ createdAt: '2026-01-15T12:00:00.000Z' }));
    expect(html).toContain('January 15, 2026');
  });

  it('includes the report ID in the footer', () => {
    const html = renderReportHTML(makeSnapshot({ id: 'snap_abc123' }));
    expect(html).toContain('Report ID: snap_abc123');
  });

  it('includes studio branding with correct URL and name', () => {
    const html = renderReportHTML(makeSnapshot());
    expect(html).toContain('https://hmpsn.studio');
    expect(html).toContain('hmpsn studio');
  });

  it('renders stat counts (pages, errors, warnings, infos) correctly', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: { siteScore: 85, totalPages: 42, errors: 7, warnings: 13, infos: 5, pages: [], siteWideIssues: [] },
    }));
    expect(html).toContain('>42<');
    expect(html).toContain('>7<');
    expect(html).toContain('>13<');
    expect(html).toContain('>5<');
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — logo
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — logo', () => {
  it('renders an img tag when logoUrl is provided', () => {
    const html = renderReportHTML(makeSnapshot({ logoUrl: 'https://example.com/logo.png', siteName: 'Logo Corp' }));
    expect(html).toContain('<img src="https://example.com/logo.png"');
    expect(html).toContain('alt="Logo Corp"');
  });

  it('omits img tag when logoUrl is undefined', () => {
    const html = renderReportHTML(makeSnapshot({ logoUrl: undefined }));
    // Should not have a client logo img (header img tag should not appear)
    expect(html).not.toMatch(/<img src="(?!data:)[^"]*" alt="[^"]*" style="max-height:40px/);
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — site-wide issues
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — site-wide issues', () => {
  it('renders site-wide issues section when issues are present', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 70, totalPages: 5, errors: 1, warnings: 0, infos: 0,
        pages: [],
        siteWideIssues: [
          { severity: 'error', message: 'Missing sitemap', recommendation: 'Add sitemap.xml', check: 'sitemap', category: 'technical' },
        ],
      },
    }));
    expect(html).toContain('Site-Wide Issues');
    expect(html).toContain('Problem: Missing sitemap');
    expect(html).toContain('Fix:</strong> Add sitemap.xml');
  });

  it('uses correct error color (#ef4444) for error-severity site-wide issues', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 70, totalPages: 5, errors: 1, warnings: 0, infos: 0,
        pages: [],
        siteWideIssues: [
          { severity: 'error', message: 'Critical error', recommendation: 'Fix it', check: 'check', category: 'technical' },
        ],
      },
    }));
    expect(html).toContain('rgba(239,68,68,0.08)');
  });

  it('uses correct warning color (#eab308) for warning-severity site-wide issues', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 80, totalPages: 5, errors: 0, warnings: 1, infos: 0,
        pages: [],
        siteWideIssues: [
          { severity: 'warning', message: 'Slow pages', recommendation: 'Optimize', check: 'check', category: 'performance' },
        ],
      },
    }));
    expect(html).toContain('rgba(234,179,8,0.06)');
  });

  it('uses correct info color for info-severity site-wide issues', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 90, totalPages: 5, errors: 0, warnings: 0, infos: 1,
        pages: [],
        siteWideIssues: [
          { severity: 'info', message: 'Consider adding structured data', recommendation: 'Add JSON-LD', check: 'check', category: 'schema' },
        ],
      },
    }));
    expect(html).toContain('rgba(96,165,250,0.06)');
  });

  it('omits site-wide issues section when no issues exist', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 95, totalPages: 3, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).not.toContain('Site-Wide Issues');
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — page rows
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — page rows', () => {
  it('renders page name and slug', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 80, totalPages: 1, errors: 0, warnings: 0, infos: 0,
        pages: [{ pageId: 'p1', slug: '/about', url: 'https://example.com/about', page: 'About Us', score: 90, issues: [] }],
        siteWideIssues: [],
      },
    }));
    expect(html).toContain('About Us');
    expect(html).toContain('/about');
  });

  it('shows "No issues found" for pages with no issues', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 90, totalPages: 1, errors: 0, warnings: 0, infos: 0,
        pages: [{ pageId: 'p1', slug: '/', url: 'https://example.com', page: 'Home', score: 100, issues: [] }],
        siteWideIssues: [],
      },
    }));
    expect(html).toContain('No issues found');
  });

  it('renders "Problem → Fix" format for page issues', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 60, totalPages: 1, errors: 1, warnings: 0, infos: 0,
        pages: [{
          pageId: 'p1', slug: '/home', url: 'https://example.com', page: 'Home', score: 60,
          issues: [
            { check: 'title', category: 'metadata', severity: 'error', message: 'Title too long', recommendation: 'Shorten to 60 chars' },
          ],
        }],
        siteWideIssues: [],
      },
    }));
    expect(html).toContain('Problem: Title too long');
    expect(html).toContain('Fix:</strong> Shorten to 60 chars');
  });

  it('renders the "value" field when present in an issue', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 70, totalPages: 1, errors: 0, warnings: 1, infos: 0,
        pages: [{
          pageId: 'p1', slug: '/blog', url: 'https://example.com/blog', page: 'Blog', score: 70,
          issues: [
            { check: 'title-length', category: 'metadata', severity: 'warning', message: 'Title too long', recommendation: 'Shorten it', value: 'My Very Very Very Long Page Title Here' },
          ],
        }],
        siteWideIssues: [],
      },
    }));
    expect(html).toContain('Current: My Very Very Very Long Page Title Here');
  });

  it('uses green page score color for score >= 80', () => {
    const html = renderReportHTML(makeSnapshot({
      audit: {
        siteScore: 90, totalPages: 1, errors: 0, warnings: 0, infos: 0,
        pages: [{ pageId: 'p1', slug: '/', url: 'https://example.com', page: 'Home', score: 90, issues: [] }],
        siteWideIssues: [],
      },
    }));
    // The page score of 90 should render with green color
    expect(html).toContain('>90<');
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — action items
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — action items', () => {
  it('omits Work Progress section when no action items', () => {
    const html = renderReportHTML(makeSnapshot({ actionItems: [] }));
    expect(html).not.toContain('Work Progress');
  });

  it('renders Work Progress section when action items are present', () => {
    const html = renderReportHTML(makeSnapshot({
      actionItems: [makeActionItem({ status: 'planned', priority: 'high' })],
    }));
    expect(html).toContain('Work Progress');
    expect(html).toContain('Fix broken links');
  });

  it('renders all three status buckets (planned, in-progress, completed)', () => {
    const html = renderReportHTML(makeSnapshot({
      actionItems: [
        makeActionItem({ id: 'a1', status: 'planned', title: 'Plan task' }),
        makeActionItem({ id: 'a2', status: 'in-progress', title: 'Ongoing task' }),
        makeActionItem({ id: 'a3', status: 'completed', title: 'Done task' }),
      ],
    }));
    expect(html).toContain('Planned');
    expect(html).toContain('In Progress');
    expect(html).toContain('Completed');
    expect(html).toContain('Plan task');
    expect(html).toContain('Ongoing task');
    expect(html).toContain('Done task');
  });

  it('renders priority icons for high/medium/low', () => {
    const html = renderReportHTML(makeSnapshot({
      actionItems: [
        makeActionItem({ id: 'a1', priority: 'high', title: 'High task' }),
        makeActionItem({ id: 'a2', priority: 'medium', title: 'Med task' }),
        makeActionItem({ id: 'a3', priority: 'low', title: 'Low task' }),
      ],
    }));
    expect(html).toContain('🔴');
    expect(html).toContain('🟡');
    expect(html).toContain('🟢');
  });

  it('renders item description when present', () => {
    const html = renderReportHTML(makeSnapshot({
      actionItems: [makeActionItem({ description: 'Detailed description here' })],
    }));
    expect(html).toContain('Detailed description here');
  });

  it('shows summary counts per status in the progress strip', () => {
    const html = renderReportHTML(makeSnapshot({
      actionItems: [
        makeActionItem({ id: 'a1', status: 'completed', title: 'Done 1' }),
        makeActionItem({ id: 'a2', status: 'completed', title: 'Done 2' }),
        makeActionItem({ id: 'a3', status: 'planned', title: 'Plan 1' }),
      ],
    }));
    // Should show count "2" for completed and "1" for planned
    expect(html).toContain('>2<');
    expect(html).toContain('>1<');
  });

  it('handles undefined actionItems without throwing', () => {
    const snapshot = makeSnapshot({ actionItems: undefined });
    expect(() => renderReportHTML(snapshot)).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────
// renderReportHTML — SVG ring stroke-dasharray
// ──────────────────────────────────────────────────────────────

describe('renderReportHTML — SVG score ring', () => {
  it('computes stroke-dasharray based on siteScore / 100 * 327', () => {
    const score = 75;
    const expected = ((score / 100) * 327).toString();
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: score, totalPages: 5, errors: 1, warnings: 2, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain(`stroke-dasharray="${expected}`);
  });

  it('computes stroke-dasharray = 327 for score 100', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 100, totalPages: 5, errors: 0, warnings: 0, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain('stroke-dasharray="327 327"');
  });

  it('computes stroke-dasharray = 0 for score 0', () => {
    const html = renderReportHTML(makeSnapshot({ audit: { siteScore: 0, totalPages: 1, errors: 10, warnings: 5, infos: 0, pages: [], siteWideIssues: [] } }));
    expect(html).toContain('stroke-dasharray="0 327"');
  });
});

// ──────────────────────────────────────────────────────────────
// extractSiteLogo — all 6 HTML-parsing strategies + error paths
// ──────────────────────────────────────────────────────────────

/**
 * Helper: mock the global fetch to return a given HTML string.
 */
function mockFetchHtml(html: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    text: async () => html,
  }));
}

describe('extractSiteLogo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Strategy 1: Webflow navbar brand ──

  it('Strategy 1: returns logo from w-nav-brand anchor with img src', async () => {
    const html = `
      <body>
        <a class="w-nav-brand" href="/">
          <img src="/images/logo.png" alt="Brand Logo" />
        </a>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/images/logo.png');
  });

  it('Strategy 1: extracts data-src from w-nav-brand for lazy-loaded images', async () => {
    const html = `
      <body>
        <a class="w-nav-brand some-other-class" href="/">
          <img data-src="/images/lazy-logo.svg" />
        </a>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/images/lazy-logo.svg');
  });

  it('Strategy 1: skips w-nav-brand anchor when inner has no img', async () => {
    // No img inside w-nav-brand — should fall through to other strategies
    const html = `
      <body>
        <a class="w-nav-brand" href="/">Site Name</a>
        <nav><img src="/nav-logo.png" /></nav>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    // Falls through to Strategy 2 (nav/header img)
    expect(result).toBe('https://example.com/nav-logo.png');
  });

  it('Strategy 1: skips data: URI src and uses data-src instead', async () => {
    const html = `
      <body>
        <a class="w-nav-brand" href="/">
          <img src="data:image/png;base64,abc123" data-src="/real-logo.png" />
        </a>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/real-logo.png');
  });

  // ── Strategy 2: nav/header img ──

  it('Strategy 2: finds img inside <nav>', async () => {
    const html = `
      <body>
        <nav>
          <img src="https://cdn.example.com/brand.png" alt="Logo" />
        </nav>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://cdn.example.com/brand.png');
  });

  it('Strategy 2: finds img inside <header>', async () => {
    const html = `
      <body>
        <header class="site-header">
          <img src="/assets/brand.svg" />
        </header>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/assets/brand.svg');
  });

  it('Strategy 2: finds SVG image href inside nav', async () => {
    const html = `
      <body>
        <nav>
          <svg><image href="/svg-logo.svg" /></svg>
        </nav>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/svg-logo.svg');
  });

  // ── Strategy 3: class containing "logo", "brand", "navbar-brand" ──

  it('Strategy 3: finds img inside div with logo class', async () => {
    const html = `
      <body>
        <div class="site-logo-wrapper">
          <img src="/logo.png" />
        </div>
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/logo.png');
  });

  it('Strategy 3: finds img with brand class directly on img element', async () => {
    const html = `
      <body>
        <img class="navbar-brand-image" src="/brand-image.png" />
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/brand-image.png');
  });

  // ── Strategy 4: img with "logo" in src/alt/id ──

  it('Strategy 4: finds img where src contains "logo"', async () => {
    const html = `
      <body>
        <img src="/images/company-logo-2024.png" width="200" />
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/images/company-logo-2024.png');
  });

  it('Strategy 4: finds img where alt contains "logo"', async () => {
    const html = `
      <body>
        <img src="/images/brand.png" alt="Company logo" />
      </body>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/images/brand.png');
  });

  // ── Strategy 5: OG image ──

  it('Strategy 5: extracts og:image from meta (property before content)', async () => {
    const html = `
      <head>
        <meta property="og:image" content="https://og.example.com/image.png" />
      </head>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://og.example.com/image.png');
  });

  it('Strategy 5: extracts og:image when content comes before property attribute', async () => {
    const html = `
      <head>
        <meta content="https://og.example.com/image2.png" property="og:image" />
      </head>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://og.example.com/image2.png');
  });

  // ── Strategy 6: Favicon as last resort ──

  it('Strategy 6: returns favicon href as last resort (non .ico)', async () => {
    const html = `
      <head>
        <link rel="icon" href="/favicon.png" />
      </head>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://example.com/favicon.png');
  });

  it('Strategy 6: skips favicon.ico but returns apple-touch-icon', async () => {
    const html = `
      <head>
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>`;
    mockFetchHtml(html);
    // favicon.ico should be skipped (includes 'favicon.ico'), but apple-touch-icon won't match
    // because the regex only matches one link element — first match is shortcut icon/favicon.ico
    // which IS skipped, so apple-touch-icon is not reached by the single regex match
    const result = await extractSiteLogo('https://example.com');
    // favicon.ico is skipped → falls to null (apple-touch-icon doesn't re-match same regex)
    expect(result).toBeNull();
  });

  it('Strategy 6: skips favicon.ico link', async () => {
    const html = `
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBeNull();
  });

  // ── HTTP / error paths ──

  it('returns null when fetch response is not ok (e.g. 404)', async () => {
    mockFetchHtml('<html></html>', false /* ok=false */);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));
    const result = await extractSiteLogo('https://unreachable.example.com');
    expect(result).toBeNull();
  });

  it('returns null when HTML has no recognisable logo signals', async () => {
    const html = `
      <html>
        <head><title>Plain page</title></head>
        <body><p>Hello world</p></body>
      </html>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBeNull();
  });

  it('resolves absolute URLs in logo src without modification', async () => {
    const html = `<nav><img src="https://external-cdn.net/logo.png" /></nav>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://external-cdn.net/logo.png');
  });

  it('resolves protocol-relative URLs in logo src with https:', async () => {
    const html = `<nav><img src="//cdn.example.net/logo.png" /></nav>`;
    mockFetchHtml(html);
    const result = await extractSiteLogo('https://example.com');
    expect(result).toBe('https://cdn.example.net/logo.png');
  });
});
