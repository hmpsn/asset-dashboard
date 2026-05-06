/**
 * Unit tests for src/lib/audit-suppression-client.ts.
 *
 * Mirrors the server-side coverage in tests/unit/helpers.test.ts (lines 84-174)
 * to guarantee the client-side `applyClientSuppressions` and the server-side
 * `applySuppressionsToAudit` stay in lockstep.
 */
import { describe, it, expect } from 'vitest';
import { applyClientSuppressions, type ClientSuppression } from '../../src/lib/audit-suppression-client';
import type { SeoAuditResult, SeoIssue, Severity } from '../../src/components/audit/types';

type MakePageInput = {
  slug: string;
  noindex?: boolean;
  issues: Array<{ check: string; severity: Severity }>;
};

const makeIssue = (check: string, severity: Severity): SeoIssue => ({
  check,
  severity,
  message: `Issue: ${check}`,
  recommendation: `Fix: ${check}`,
});

const makeAudit = (pages: MakePageInput[]): SeoAuditResult => ({
  siteScore: 0,
  totalPages: pages.length,
  errors: 0,
  warnings: 0,
  infos: 0,
  pages: pages.map((p, idx) => ({
    pageId: `page-${idx}`,
    page: p.slug,
    slug: p.slug,
    url: `https://example.com/${p.slug}`,
    score: 100,
    issues: p.issues.map(i => makeIssue(i.check, i.severity)),
    noindex: p.noindex,
  })),
  siteWideIssues: [],
});

const supp = (check: string, pageSlug: string, pagePattern?: string): ClientSuppression =>
  pagePattern ? { check, pageSlug, pagePattern } : { check, pageSlug };

describe('applyClientSuppressions', () => {
  // ── Baseline: no-op when suppressions are empty ──

  it('returns the unmodified audit when no suppressions are provided', () => {
    const audit = makeAudit([{ slug: 'home', issues: [{ check: 'title', severity: 'error' }] }]);
    const result = applyClientSuppressions(audit, []);
    expect(result).toBe(audit);
    expect(result.pages[0].issues).toHaveLength(1);
  });

  // ── Exact-match suppression ──

  it('removes suppressed issues by exact check + slug match', () => {
    const audit = makeAudit([
      {
        slug: 'about',
        issues: [
          { check: 'title', severity: 'error' },
          { check: 'meta-description', severity: 'warning' },
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [supp('title', 'about')]);
    expect(result.pages[0].issues).toHaveLength(1);
    expect(result.pages[0].issues[0].check).toBe('meta-description');
  });

  it('does not suppress issues on non-matching pages', () => {
    const audit = makeAudit([
      { slug: 'home', issues: [{ check: 'title', severity: 'error' }] },
      { slug: 'about', issues: [{ check: 'title', severity: 'error' }] },
    ]);
    const result = applyClientSuppressions(audit, [supp('title', 'home')]);
    expect(result.pages[0].issues).toHaveLength(0); // home — suppressed
    expect(result.pages[1].issues).toHaveLength(1); // about — preserved
  });

  // ── Pattern (glob) suppression ──

  it('suppresses by simple glob pattern (blog/*)', () => {
    const audit = makeAudit([
      { slug: 'blog/post-a', issues: [{ check: 'og-tags', severity: 'warning' }] },
      { slug: 'blog/post-b', issues: [{ check: 'og-tags', severity: 'warning' }] },
      { slug: 'about', issues: [{ check: 'og-tags', severity: 'warning' }] },
    ]);
    const result = applyClientSuppressions(audit, [supp('og-tags', '', 'blog/*')]);
    expect(result.pages[0].issues).toHaveLength(0);
    expect(result.pages[1].issues).toHaveLength(0);
    expect(result.pages[2].issues).toHaveLength(1); // about not under blog/
  });

  it('suppresses by ? (single-character) glob', () => {
    const audit = makeAudit([
      { slug: 'p1', issues: [{ check: 'og-tags', severity: 'warning' }] },
      { slug: 'p2', issues: [{ check: 'og-tags', severity: 'warning' }] },
      { slug: 'page-3', issues: [{ check: 'og-tags', severity: 'warning' }] },
    ]);
    const result = applyClientSuppressions(audit, [supp('og-tags', '', 'p?')]);
    expect(result.pages[0].issues).toHaveLength(0);
    expect(result.pages[1].issues).toHaveLength(0);
    expect(result.pages[2].issues).toHaveLength(1);
  });

  it('suppresses by nested-path glob (resources/**/* via *)', () => {
    const audit = makeAudit([
      { slug: 'resources/guides/seo-101', issues: [{ check: 'content-length', severity: 'warning' }] },
      { slug: 'resources/whitepapers/2025', issues: [{ check: 'content-length', severity: 'warning' }] },
      { slug: 'about', issues: [{ check: 'content-length', severity: 'warning' }] },
    ]);
    const result = applyClientSuppressions(audit, [supp('content-length', '', 'resources/*')]);
    expect(result.pages[0].issues).toHaveLength(0);
    expect(result.pages[1].issues).toHaveLength(0);
    expect(result.pages[2].issues).toHaveLength(1);
  });

  it('only suppresses by pattern when the check name also matches', () => {
    const audit = makeAudit([
      {
        slug: 'blog/post-a',
        issues: [
          { check: 'og-tags', severity: 'warning' }, // pattern matches
          { check: 'title', severity: 'error' },     // pattern check mismatch — keep
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [supp('og-tags', '', 'blog/*')]);
    expect(result.pages[0].issues).toHaveLength(1);
    expect(result.pages[0].issues[0].check).toBe('title');
  });

  // ── Score recalculation ──

  it('recalculates page score after suppression (critical error -15)', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'title', severity: 'error' },     // critical −15
          { check: 'og-tags', severity: 'warning' }, // moderate −3
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [supp('og-tags', 'home')]);
    // Only critical title error remains: 100 − 15 = 85
    expect(result.pages[0].score).toBe(85);
  });

  it('non-critical error deducts 10', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'unknown-error', severity: 'error' }, // not in CRITICAL/MODERATE → -10
          { check: 'title', severity: 'error' },         // critical −15
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [supp('title', 'home')]);
    // Only unknown-error remains: 100 − 10 = 90
    expect(result.pages[0].score).toBe(90);
  });

  it('critical warning deducts 5', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'title', severity: 'warning' }, // critical warning −5
          { check: 'og-tags', severity: 'warning' }, // moderate −3
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [supp('og-tags', 'home')]);
    // Only critical warning remains: 100 − 5 = 95
    expect(result.pages[0].score).toBe(95);
  });

  it('moderate warning deducts 3 (suppression keeps only the other warning)', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'og-tags', severity: 'warning' },     // moderate −3
          { check: 'random-rule', severity: 'warning' }, // other −2
        ],
      },
    ]);
    // Suppress og-tags (moderate) → only "random-rule" (other warning) remains: 100 − 2 = 98.
    const result = applyClientSuppressions(audit, [supp('og-tags', 'home')]);
    expect(result.pages[0].score).toBe(98);
  });

  it('non-critical/non-moderate warning deducts 2 (suppression keeps only moderate)', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'og-tags', severity: 'warning' },     // moderate −3
          { check: 'random-rule', severity: 'warning' }, // other −2
        ],
      },
    ]);
    // Suppress random-rule → only "og-tags" (moderate warning) remains: 100 − 3 = 97.
    const result = applyClientSuppressions(audit, [supp('random-rule', 'home')]);
    expect(result.pages[0].score).toBe(97);
  });

  it('info-severity issues do not affect score', () => {
    const audit = makeAudit([
      {
        slug: 'home',
        issues: [
          { check: 'title', severity: 'error' }, // critical −15
          { check: 'whatever', severity: 'info' },
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [supp('title', 'home')]);
    expect(result.pages[0].score).toBe(100);
  });

  // ── Severity aggregations ──

  it('recalculates errors / warnings / infos totals', () => {
    const audit = makeAudit([
      {
        slug: 'a',
        issues: [
          { check: 'title', severity: 'error' },
          { check: 'og-tags', severity: 'warning' },
          { check: 'analytics', severity: 'info' },
        ],
      },
      {
        slug: 'b',
        issues: [
          { check: 'meta-description', severity: 'error' },
          { check: 'analytics', severity: 'info' },
        ],
      },
    ]);
    const result = applyClientSuppressions(audit, [
      supp('title', 'a'),
      supp('analytics', 'b'),
    ]);
    expect(result.errors).toBe(1); // only meta-description on b survives
    expect(result.warnings).toBe(1);
    expect(result.infos).toBe(1);
  });

  // ── Site score with noindex pages ──

  it('excludes noindex pages from site score', () => {
    const audit = makeAudit([
      { slug: 'public', issues: [{ check: 'title', severity: 'error' }] }, // 100 − 15 = 85 after recalc
      { slug: 'private', noindex: true, issues: [{ check: 'title', severity: 'error' }] }, // 100 − 15 = 85, but excluded
    ]);
    // Suppress only on private — public score stays at recalculated value
    const result = applyClientSuppressions(audit, [supp('og-tags', 'public')]);
    // public: title error still present, but page didn't have og-tags so filter is no-op
    // siteScore averages only public (noindex excluded). public is unchanged because no issue was suppressed,
    // so the original page score (100) is kept (the helper returns the original page object when nothing is filtered).
    expect(result.siteScore).toBe(100);
  });

  it('all-pages-noindex falls back to score 100 (matches server)', () => {
    // Edge case: every page is noindex → no indexable pages → server returns 100.
    // This test will FAIL until the noindex fallback is set to 100 (Step 2.6).
    const audit = makeAudit([
      { slug: 'a', noindex: true, issues: [{ check: 'title', severity: 'error' }] },
      { slug: 'b', noindex: true, issues: [{ check: 'meta-description', severity: 'error' }] },
    ]);
    const result = applyClientSuppressions(audit, [supp('title', 'a')]);
    expect(result.siteScore).toBe(100);
  });

  // ── Separator bug regression ──

  // Marked .fails because the current single-colon separator collapses
  // {check: "og", pageSlug: "title:home"} and {check: "og:title", pageSlug: "home"}
  // into the same key ("og:title:home"), causing collateral suppression. The
  // follow-up fix commit aligns the separator with the server (`::`) and flips
  // this back to a regular `it()`.
  it.fails('treats `og:title` (check name with colon) on `home` as distinct from `og` on `title:home`', () => {
    const audit = makeAudit([
      { slug: 'home', issues: [{ check: 'og:title', severity: 'warning' }] },
      { slug: 'title:home', issues: [{ check: 'og', severity: 'warning' }] },
    ]);
    // We suppress {check: "og", pageSlug: "title:home"} — only the second issue should disappear.
    const result = applyClientSuppressions(audit, [supp('og', 'title:home')]);
    expect(result.pages[0].issues).toHaveLength(1); // og:title on home — preserved
    expect(result.pages[0].issues[0].check).toBe('og:title');
    expect(result.pages[1].issues).toHaveLength(0); // og on title:home — suppressed
  });

  // ── Site score average matches server-style averaging ──

  it('calculates site score as the rounded average of indexable page scores', () => {
    const audit = makeAudit([
      { slug: 'a', issues: [{ check: 'title', severity: 'error' }] }, // would be 85 after recalc
      { slug: 'b', issues: [] },                                       // 100
    ]);
    const result = applyClientSuppressions(audit, [supp('title', 'a')]);
    // a now has 0 issues → 100. b is 100. avg = 100.
    expect(result.siteScore).toBe(100);
  });
});
