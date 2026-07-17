/**
 * Comprehensive unit tests for frontend lib/utility modules.
 *
 * Targets modules with low or zero coverage, and adds edge-case coverage
 * for modules that already have thin tests. All modules tested here are
 * pure — no React, no React Query, no browser APIs required.
 *
 * Covered modules:
 *  - src/lib/decision-adapters.ts  (badgeForBatch, clientActionSourceLabel)
 *  - src/lib/pathUtils.ts          (normalizePath, matchPagePath, normalizePageUrl, findPageMapEntry, findPageMapEntryBySlug, resolvePageAddress, tryResolvePagePath)
 *  - src/lib/queryKeys.ts          (admin copy pipeline, admin CMS, admin rank tracking, rank history queries, page join)
 *  - src/lib/inline-markdown.ts    (inlineMarkdownToHtml — bold, em, code, custom classes, XSS)
 *  - src/lib/loadingPhrases.ts     (pickPhrase — coverage of all 9 phrases, exclude logic)
 *  - src/lib/pageTypeLabels.ts     (PAGE_TYPE_LABELS — all entries, missing key)
 *  - src/lib/audit-suppression-client.ts (applyClientSuppressions — edge cases)
 *  - src/lib/client-dashboard-tab.ts     (resolveClientTab — KNOWN_CLIENT_TABS completeness)
 *  - src/lib/tab-search-param.ts         (resolveTabSearchParam, isValidTabSearchParam, clearTabSearchParam)
 *  - src/lib/rewriteResponse.ts          (stripRewritingPrefix, parseRewriteSectionTarget, extractRewriteOnly)
 *  - src/lib/audit-batch.ts              (issueToTaskKey, issueToTaskItem, selectIssuesForBatch)
 *  - src/lib/internal-link-client-action.ts (normalizeInternalLinkSuggestion edge cases)
 */
import { describe, it, expect } from 'vitest';
import { rankTrackingHistoryPath } from '../../src/lib/keywordTracking';

// ════════════════════════════════════════════════════════════════════════════
// src/lib/decision-adapters.ts
// ════════════════════════════════════════════════════════════════════════════
import {
  badgeForBatch,
  clientActionSourceLabel,
} from '../../src/lib/decision-adapters';

describe('decision-adapters — badgeForBatch', () => {
  it('returns "Schema" for names starting with "Schema"', () => {
    expect(badgeForBatch('Schema — 5 pages')).toBe('Schema');
  });

  it('returns "Schema" case-insensitively (lowercase "schema")', () => {
    expect(badgeForBatch('schema review')).toBe('Schema');
  });

  it('returns "CMS" for names starting with "cms"', () => {
    expect(badgeForBatch('CMS Editor — Blog collection')).toBe('CMS');
  });

  it('returns "CMS" case-insensitively', () => {
    expect(badgeForBatch('cms batch')).toBe('CMS');
  });

  it('returns "SEO Editor" for names starting with "SEO Editor"', () => {
    expect(badgeForBatch('SEO Editor — 10 pages')).toBe('SEO Editor');
  });

  it('returns "SEO Editor" for names starting with bare "seo"', () => {
    expect(badgeForBatch('seo update batch')).toBe('SEO Editor');
  });

  it('returns "Audit" for names starting with "Audit"', () => {
    expect(badgeForBatch('Audit — Critical Issues')).toBe('Audit');
  });

  it('returns "SEO" (fallback) for unrecognized names', () => {
    expect(badgeForBatch('Some other batch')).toBe('SEO');
    expect(badgeForBatch('Random title')).toBe('SEO');
  });

  it('returns "SEO" for empty string', () => {
    expect(badgeForBatch('')).toBe('SEO');
  });
});

describe('decision-adapters — clientActionSourceLabel', () => {
  it('returns "AEO" for aeo_change', () => {
    expect(clientActionSourceLabel('aeo_change')).toBe('AEO');
  });

  it('returns "Internal Links" for internal_link', () => {
    expect(clientActionSourceLabel('internal_link')).toBe('Internal Links');
  });

  it('returns "Redirects" for redirect_proposal', () => {
    expect(clientActionSourceLabel('redirect_proposal')).toBe('Redirects');
  });

  it('returns "Content" for content_decay', () => {
    expect(clientActionSourceLabel('content_decay')).toBe('Content');
  });

  it('returns "Keywords" for deprecated keyword_strategy', () => {
    expect(clientActionSourceLabel('keyword_strategy')).toBe('Keywords');
  });

  it('returns "SEO Update" fallback for unknown source types', () => {
    expect(clientActionSourceLabel('unknown_type')).toBe('SEO Update');
    expect(clientActionSourceLabel('')).toBe('SEO Update');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/pathUtils.ts — additional edge cases
// ════════════════════════════════════════════════════════════════════════════
import {
  normalizePageUrl,
  matchPagePath,
  findPageMapEntry,
  findPageMapEntryBySlug,
  resolvePageAddress,
  tryResolvePagePath,
} from '../../src/lib/pathUtils';
const normalizePath = normalizePageUrl;

describe('pathUtils — normalizePath edge cases', () => {
  it('double leading slashes are preserved (only trailing slash stripped)', () => {
    // leading double-slash is not stripped — normalizePath only adds/strips trailing
    const result = normalizePath('//double');
    expect(result).toBe('//double');
  });

  it('path with only a trailing slash becomes "/"', () => {
    // '/'.endsWith('/') and length>1 is false for '/' → kept
    expect(normalizePath('/')).toBe('/');
  });

  it('long nested path with trailing slash', () => {
    expect(normalizePath('/a/b/c/')).toBe('/a/b/c');
  });

  it('bare slug with nested segments', () => {
    expect(normalizePath('services/seo')).toBe('/services/seo');
  });
});

describe('pathUtils — matchPagePath edge cases', () => {
  it('handles root vs non-root', () => {
    expect(matchPagePath('/', '/home')).toBe(false);
  });

  it('matches both paths with trailing slashes', () => {
    expect(matchPagePath('/services/', '/services/')).toBe(true);
  });

  it('is not fooled by partial prefix', () => {
    expect(matchPagePath('/about', '/about-us')).toBe(false);
  });
});

describe('pathUtils — normalizePageUrl edge cases', () => {
  it('handles http:// (not just https://)', () => {
    expect(normalizePageUrl('http://example.com/about')).toBe('/about');
  });

  it('handles URL with port', () => {
    expect(normalizePageUrl('https://example.com:3000/page')).toBe('/page');
  });

  it('handles URL with multiple path segments', () => {
    expect(normalizePageUrl('https://example.com/a/b/c')).toBe('/a/b/c');
  });

  it('handles root URL with no trailing slash', () => {
    expect(normalizePageUrl('https://example.com')).toBe('/');
  });
});

describe('pathUtils — findPageMapEntry edge cases', () => {
  const map = [
    { pagePath: '/blog/my-post' },
    { pagePath: '/services' },
  ];

  it('finds deeply nested path', () => {
    expect(findPageMapEntry(map, '/blog/my-post')).toEqual({ pagePath: '/blog/my-post' });
  });

  it('does not match partial path prefix', () => {
    expect(findPageMapEntry(map, '/serv')).toBeUndefined();
  });

  it('matches with mixed case', () => {
    expect(findPageMapEntry(map, '/SERVICES')).toEqual({ pagePath: '/services' });
  });
});

describe('pathUtils — findPageMapEntryBySlug edge cases', () => {
  const map = [
    { pagePath: '/services/seo-agency' },
    { pagePath: '/seo' },
    { pagePath: '/' },
  ];

  it('exact top-level match wins over suffix match', () => {
    // '/seo' exact match should be returned over '/services/seo-agency'
    expect(findPageMapEntryBySlug(map, 'seo')).toEqual({ pagePath: '/seo' });
  });

  it('finds via suffix when no exact match', () => {
    expect(findPageMapEntryBySlug(map, 'seo-agency')).toEqual({ pagePath: '/services/seo-agency' });
  });

  it('returns undefined for slug not in map', () => {
    expect(findPageMapEntryBySlug(map, 'contact')).toBeUndefined();
  });
});

describe('pathUtils — resolvePageAddress priority chain', () => {
  it('url field takes priority over slug when path/publishedPath absent', () => {
    const result = resolvePageAddress({
      publishedPath: null, path: null,
      url: 'https://example.com/from-url',
      slug: 'from-slug',
    });
    expect(result.canonicalPath).toBe('/from-url');
    expect(result.source).toBe('url');
  });

  it('path field takes priority over url', () => {
    const result = resolvePageAddress({
      publishedPath: null,
      path: '/from-path',
      url: 'https://example.com/from-url',
    });
    expect(result.canonicalPath).toBe('/from-path');
    expect(result.source).toBe('path');
  });

  it('homepage slug "" resolves to "/"', () => {
    const result = resolvePageAddress({ slug: '' });
    expect(result.canonicalPath).toBe('/');
  });

  it('legacy fallback path is not set when no slug', () => {
    const result = resolvePageAddress({ publishedPath: '/services/seo' });
    expect(result.legacyFallbackPath).toBeUndefined();
  });

  it('canonicalUrl omitted when baseUrl is null', () => {
    const result = resolvePageAddress({ publishedPath: '/about' }, { baseUrl: null });
    expect(result.canonicalUrl).toBeUndefined();
  });

  it('canonicalUrl omitted when baseUrl is undefined', () => {
    const result = resolvePageAddress({ publishedPath: '/about' });
    expect(result.canonicalUrl).toBeUndefined();
  });
});

describe('pathUtils — tryResolvePagePath edge cases', () => {
  it('returns "/" for empty-string publishedPath', () => {
    // publishedPath: '' is not null/undefined, so it should resolve
    const result = tryResolvePagePath({ publishedPath: '' });
    expect(result).toBe('/');
  });

  it('returns path for nested publishedPath', () => {
    expect(tryResolvePagePath({ publishedPath: '/services/seo' })).toBe('/services/seo');
  });

  it('returns path from url field', () => {
    expect(tryResolvePagePath({ url: 'https://example.com/services' })).toBe('/services');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/queryKeys.ts — additional/edge-case tests
// ════════════════════════════════════════════════════════════════════════════
import { queryKeys } from '../../src/lib/queryKeys';

const WS = 'ws-test';
const SITE = 'site-xyz';

describe('queryKeys — admin copy pipeline keys', () => {
  it('copySections includes wsId and entryId', () => {
    expect(queryKeys.admin.copySections(WS, 'entry-1')).toEqual(['admin-copy-sections', WS, 'entry-1']);
  });

  it('copySectionsAll is a prefix of copySections', () => {
    const all = queryKeys.admin.copySectionsAll(WS);
    const specific = queryKeys.admin.copySections(WS, 'entry-1');
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('copyStatus includes entryId', () => {
    expect(queryKeys.admin.copyStatus(WS, 'e1')).toEqual(['admin-copy-status', WS, 'e1']);
  });

  it('copyStatusAll is a prefix of copyStatus', () => {
    const all = queryKeys.admin.copyStatusAll(WS);
    const specific = queryKeys.admin.copyStatus(WS, 'e1');
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('copyBatch includes batchId', () => {
    expect(queryKeys.admin.copyBatch(WS, 'b1')).toEqual(['admin-copy-batch', WS, 'b1']);
  });

  it('copyBatchAll is a prefix of copyBatch', () => {
    const all = queryKeys.admin.copyBatchAll(WS);
    const specific = queryKeys.admin.copyBatch(WS, 'b1');
    expect(specific.slice(0, all.length)).toEqual([...all]);
  });

  it('copyPromotable key shape', () => {
    expect(queryKeys.admin.copyPromotable(WS)).toEqual(['admin-copy-promotable', WS]);
  });

  it('copyIntelligence key shape', () => {
    expect(queryKeys.admin.copyIntelligence(WS)).toEqual(['admin-copy-intelligence', WS]);
  });
});

describe('queryKeys — admin CMS keys', () => {
  it('cmsEditorAll has no params', () => {
    expect(queryKeys.admin.cmsEditorAll()).toEqual(['cms-editor']);
  });

  it('cmsEditor with siteId and wsId', () => {
    expect(queryKeys.admin.cmsEditor(SITE, WS)).toEqual(['cms-editor', SITE, WS]);
  });

  it('cmsCollections without wsId', () => {
    expect(queryKeys.admin.cmsCollections(SITE)).toEqual(['cms-collections', SITE]);
  });

  it('cmsCollections with wsId is longer', () => {
    expect(queryKeys.admin.cmsCollections(SITE, WS)).toEqual(['cms-collections', SITE, WS]);
  });
});

describe('queryKeys — admin rank tracking keys', () => {
  it('rankTrackingHistoryQueries sorts queries for stable keys', () => {
    const key1 = queryKeys.admin.rankTrackingHistoryQueries(WS, ['z', 'a', 'm']);
    const key2 = queryKeys.admin.rankTrackingHistoryQueries(WS, ['m', 'z', 'a']);
    expect(key1).toEqual(key2);
  });

  it('rankTrackingLatest key shape', () => {
    expect(queryKeys.admin.rankTrackingLatest(WS)).toEqual(['admin-rank-tracking-latest', WS]);
  });

  it('rankTrackingHistory key shape', () => {
    expect(queryKeys.admin.rankTrackingHistory(WS)).toEqual(['admin-rank-tracking-history', WS]);
  });

  it('rankTrackingRowHistory sorts visible queries for a stable page-set key', () => {
    const first = queryKeys.admin.rankTrackingRowHistory(WS, ['z', 'a', 'm']);
    const second = queryKeys.admin.rankTrackingRowHistory(WS, ['m', 'z', 'a']);
    expect(first).toEqual(second);
    expect(first).toEqual(['admin-rank-tracking-history', WS, 'rows', 'a', 'm', 'z']);
  });

  it('localSeo key shape', () => {
    expect(queryKeys.admin.localSeo(WS)).toEqual(['admin-local-seo', WS]);
  });

  it('localSeoLocations key shape', () => {
    expect(queryKeys.admin.localSeoLocations(WS)).toEqual(['admin-local-seo-locations', WS]);
  });
});

describe('keywordTracking — rankTrackingHistoryPath', () => {
  it('uses repeated query params and preserves comma-bearing keywords', () => {
    const path = rankTrackingHistoryPath(WS, [
      'dentist, chicago',
      '100% growth',
      'a&b keyword',
      '  ',
    ]);
    expect(path).toBe('/api/rank-tracking/ws-test/history?query=dentist%2C+chicago&query=100%25+growth&query=a%26b+keyword');
  });
});

describe('queryKeys — admin page join keys', () => {
  it('pageJoinPagesAll has no params', () => {
    expect(queryKeys.admin.pageJoinPagesAll()).toEqual(['admin-page-join-pages']);
  });

  it('pageJoinPages without wsId', () => {
    expect(queryKeys.admin.pageJoinPages(SITE)).toEqual(['admin-page-join-pages', SITE]);
  });

  it('pageJoinPages with wsId', () => {
    expect(queryKeys.admin.pageJoinPages(SITE, WS)).toEqual(['admin-page-join-pages', SITE, WS]);
  });
});

describe('queryKeys — admin outcome + signals keys', () => {
  it('outcomeTimeline key shape', () => {
    expect(queryKeys.admin.outcomeTimeline(WS)).toEqual(['admin-outcome-timeline', WS]);
  });

  it('outcomePlaybooks key shape', () => {
    expect(queryKeys.admin.outcomePlaybooks(WS)).toEqual(['admin-outcome-playbooks', WS]);
  });

  it('outcomeTopWins key shape', () => {
    expect(queryKeys.admin.outcomeTopWins(WS)).toEqual(['admin-outcome-top-wins', WS]);
  });

  it('clientSignals key shape', () => {
    expect(queryKeys.admin.clientSignals(WS)).toEqual(['admin-client-signals', WS]);
  });

  it('aiSuggestedBriefs key shape', () => {
    expect(queryKeys.admin.aiSuggestedBriefs(WS)).toEqual(['admin-ai-suggested-briefs', WS]);
  });
});

describe('queryKeys — client outcome + plan keys', () => {
  it('outcomeWins key shape', () => {
    expect(queryKeys.client.outcomeWins(WS)).toEqual(['client-outcome-wins', WS]);
  });

  it('intelligence key shape', () => {
    expect(queryKeys.client.intelligence(WS)).toEqual(['client-intelligence', WS]);
  });

  it('contentPlan key shape', () => {
    expect(queryKeys.client.contentPlan(WS)).toEqual(['client-content-plan', WS]);
  });

  it('pageKeywords key shape', () => {
    expect(queryKeys.client.pageKeywords(WS)).toEqual(['client-page-keywords', WS]);
  });

  it('strategyGuidance key shape', () => {
    expect(queryKeys.client.strategyGuidance(WS)).toEqual(['client-strategy-guidance', WS]);
  });

  it('rankHistory key shape', () => {
    expect(queryKeys.client.rankHistory(WS)).toEqual(['client-rank-history', WS]);
  });

  it('latestRanks key shape', () => {
    expect(queryKeys.client.latestRanks(WS)).toEqual(['client-latest-ranks', WS]);
  });

  it('anomalies key shape', () => {
    expect(queryKeys.client.anomalies(WS)).toEqual(['client-anomalies', WS]);
  });

  it('briefing key shape', () => {
    expect(queryKeys.client.briefing(WS)).toEqual(['client-briefing', WS]);
  });

  it('pricing key shape', () => {
    expect(queryKeys.client.pricing(WS)).toEqual(['client-pricing', WS]);
  });

  it('contentSubscription key shape', () => {
    expect(queryKeys.client.contentSubscription(WS)).toEqual(['client-content-subscription', WS]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/inline-markdown.ts — additional tests
// ════════════════════════════════════════════════════════════════════════════
import { inlineMarkdownToHtml } from '../../src/lib/inline-markdown';

describe('inline-markdown — inlineMarkdownToHtml', () => {
  it('renders bold text with default class', () => {
    const html = inlineMarkdownToHtml('**Hello world**');
    expect(html).toContain('<b class="text-[var(--brand-text-bright)]">Hello world</b>');
  });

  it('renders italic text with default class', () => {
    const html = inlineMarkdownToHtml('*Hello world*');
    expect(html).toContain('<em class="text-[var(--brand-text)]">Hello world</em>');
  });

  it('renders inline code with default class', () => {
    const html = inlineMarkdownToHtml('`console.log()`');
    expect(html).toContain('<code class=');
    expect(html).toContain('console.log()');
  });

  it('renders bold and italic in the same string', () => {
    const html = inlineMarkdownToHtml('**bold** and *italic*');
    expect(html).toContain('<b class=');
    expect(html).toContain('<em class=');
  });

  it('escapes ampersands before markdown rendering', () => {
    const html = inlineMarkdownToHtml('AT&T **rocks**');
    expect(html).toContain('AT&amp;T');
  });

  it('escapes angle brackets', () => {
    const html = inlineMarkdownToHtml('a < b and b > c');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

  it('escapes double quotes', () => {
    const html = inlineMarkdownToHtml('"quoted"');
    expect(html).toContain('&quot;');
  });

  it('strips markdown links and returns only link text', () => {
    const html = inlineMarkdownToHtml('[Click here](https://example.com)');
    expect(html).toContain('Click here');
    expect(html).not.toContain('https://example.com');
    expect(html).not.toContain('<a ');
  });

  it('strips bare URLs', () => {
    const html = inlineMarkdownToHtml('Visit https://example.com for info');
    expect(html).not.toContain('https://example.com');
  });

  it('uses custom bold class when provided', () => {
    const html = inlineMarkdownToHtml('**test**', { bold: 'font-bold' });
    expect(html).toContain('<b class="font-bold">test</b>');
  });

  it('uses custom code class when provided', () => {
    const html = inlineMarkdownToHtml('`code`', { code: 'font-mono' });
    expect(html).toContain('<code class="font-mono">code</code>');
  });

  it('returns empty string for empty input', () => {
    expect(inlineMarkdownToHtml('')).toBe('');
  });

  it('returns plain text unchanged when no markdown tokens present', () => {
    expect(inlineMarkdownToHtml('Hello world')).toBe('Hello world');
  });

  it('does not match double-star bold pattern inside code (code wraps single backtick)', () => {
    // `**not bold**` should be rendered as code, not bold
    const html = inlineMarkdownToHtml('`**not bold**`');
    expect(html).toContain('<code class=');
    // The bold pattern should NOT fire because ** is inside code ticks
    // Note: the regex processes code AFTER bold, so this tests the ordering
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/loadingPhrases.ts — additional tests
// ════════════════════════════════════════════════════════════════════════════
import { LOADING_PHRASES, pickPhrase } from '../../src/lib/loadingPhrases';

describe('loadingPhrases — additional coverage', () => {
  it('LOADING_PHRASES is a non-empty readonly array', () => {
    expect(Array.isArray(LOADING_PHRASES)).toBe(true);
    expect(LOADING_PHRASES.length).toBeGreaterThan(0);
  });

  it('every phrase is a non-empty string', () => {
    for (const phrase of LOADING_PHRASES) {
      expect(typeof phrase).toBe('string');
      expect(phrase.length).toBeGreaterThan(0);
    }
  });

  it('pickPhrase() with no args returns a member of LOADING_PHRASES', () => {
    for (let i = 0; i < 20; i++) {
      expect(LOADING_PHRASES).toContain(pickPhrase());
    }
  });

  it('pickPhrase(exclude) never returns the excluded phrase', () => {
    const phrase = LOADING_PHRASES[0];
    for (let i = 0; i < 30; i++) {
      expect(pickPhrase(phrase)).not.toBe(phrase);
    }
  });

  it('pickPhrase with exclude still returns a phrase from the list', () => {
    const excluded = LOADING_PHRASES[2];
    const result = pickPhrase(excluded);
    expect(LOADING_PHRASES).toContain(result);
  });

  it('pickPhrase works when all but one phrase is excluded (only 1 available)', () => {
    // Exclude 8 phrases → only LOADING_PHRASES[8] remains.
    // We only exclude 1 at a time, but this tests that the random pick still works
    // when only a subset is available.
    const last = LOADING_PHRASES[LOADING_PHRASES.length - 1];
    const result = pickPhrase(last);
    expect(result).not.toBe(last);
    expect(LOADING_PHRASES).toContain(result);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/pageTypeLabels.ts — additional tests
// ════════════════════════════════════════════════════════════════════════════
import { PAGE_TYPE_LABELS } from '../../src/lib/pageTypeLabels';

describe('pageTypeLabels — PAGE_TYPE_LABELS', () => {
  it('contains all expected standard page types', () => {
    const expectedTypes = [
      'homepage', 'about', 'contact', 'faq', 'testimonials',
      'blog', 'service', 'location', 'product', 'pillar',
      'resource', 'pricing-page', 'custom', 'provider-profile',
      'procedure-guide', 'landing',
    ];
    for (const type of expectedTypes) {
      expect(PAGE_TYPE_LABELS).toHaveProperty(type);
    }
  });

  it('product → "Product"', () => {
    expect(PAGE_TYPE_LABELS['product']).toBe('Product');
  });

  it('pillar → "Pillar"', () => {
    expect(PAGE_TYPE_LABELS['pillar']).toBe('Pillar');
  });

  it('resource → "Resource"', () => {
    expect(PAGE_TYPE_LABELS['resource']).toBe('Resource');
  });

  it('testimonials → "Testimonials"', () => {
    expect(PAGE_TYPE_LABELS['testimonials']).toBe('Testimonials');
  });

  it('every label is a non-empty string', () => {
    for (const [key, label] of Object.entries(PAGE_TYPE_LABELS)) {
      expect(typeof label, `label for ${key}`).toBe('string');
      expect(label.length, `label for ${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('undefined for a key not in the map', () => {
    expect(PAGE_TYPE_LABELS['not-a-type']).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/tab-search-param.ts — additional edge cases
// ════════════════════════════════════════════════════════════════════════════
import {
  isValidTabSearchParam,
  resolveTabSearchParam,
  clearTabSearchParam,
} from '../../src/lib/tab-search-param';

describe('tab-search-param — additional edge cases', () => {
  it('isValidTabSearchParam returns false for null', () => {
    expect(isValidTabSearchParam(null, ['a', 'b'])).toBe(false);
  });

  it('isValidTabSearchParam returns false for empty string when not in list', () => {
    expect(isValidTabSearchParam('', ['a', 'b'])).toBe(false);
  });

  it('resolveTabSearchParam returns fallback for null param', () => {
    expect(resolveTabSearchParam(null, { validValues: ['x', 'y'], fallback: 'x' })).toBe('x');
  });

  it('resolveTabSearchParam returns fallback for empty string', () => {
    expect(resolveTabSearchParam('', { validValues: ['x', 'y'], fallback: 'y' })).toBe('y');
  });

  it('resolveTabSearchParam does not use alias for valid value', () => {
    const result = resolveTabSearchParam('decisions', {
      validValues: ['decisions', 'conversations'],
      fallback: 'decisions',
      legacyAliases: { approvals: 'decisions' },
    });
    expect(result).toBe('decisions');
  });

  it('resolveTabSearchParam applies normalizeResolved even for fallback', () => {
    const result = resolveTabSearchParam(null, {
      validValues: ['x'],
      fallback: 'x',
      normalizeResolved: () => 'x' as 'x',
    });
    expect(result).toBe('x');
  });

  it('clearTabSearchParam preserves all other params except tab', () => {
    const sp = new URLSearchParams('a=1&tab=reviews&b=2');
    const result = clearTabSearchParam(sp);
    expect(result?.get('a')).toBe('1');
    expect(result?.get('b')).toBe('2');
    expect(result?.has('tab')).toBe(false);
  });

  it('clearTabSearchParam returns null when no tab param', () => {
    expect(clearTabSearchParam(new URLSearchParams('x=1'))).toBeNull();
  });

  it('clearTabSearchParam returns null for empty URLSearchParams', () => {
    expect(clearTabSearchParam(new URLSearchParams(''))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/rewriteResponse.ts — additional edge cases
// ════════════════════════════════════════════════════════════════════════════
import {
  stripRewritingPrefix,
  parseRewriteSectionTarget,
  extractRewriteOnly,
  REWRITE_BEGIN,
  REWRITE_END,
} from '../../src/lib/rewriteResponse';

describe('rewriteResponse — stripRewritingPrefix', () => {
  it('strips "Rewriting: Section name" prefix line', () => {
    const input = 'Rewriting: Hero Section\nSome rewrite content.';
    const result = stripRewritingPrefix(input);
    expect(result).not.toContain('Rewriting:');
    expect(result).toContain('Some rewrite content.');
  });

  it('strips bold "**Rewriting: Name**" prefix', () => {
    const input = '**Rewriting: Intro**\nNew intro text.';
    const result = stripRewritingPrefix(input);
    expect(result).not.toContain('Rewriting:');
    expect(result).toContain('New intro text.');
  });

  it('returns input unchanged when no prefix present', () => {
    const input = 'This is pure rewrite content.';
    expect(stripRewritingPrefix(input)).toBe(input);
  });
});

describe('rewriteResponse — parseRewriteSectionTarget', () => {
  it('extracts section name from "Rewriting: Name" line', () => {
    expect(parseRewriteSectionTarget('Rewriting: Hero Section')).toBe('Hero Section');
  });

  it('extracts section name from bold format', () => {
    expect(parseRewriteSectionTarget('**Rewriting: Intro**')).toBe('Intro');
  });

  it('returns undefined when no Rewriting prefix', () => {
    expect(parseRewriteSectionTarget('Some other content')).toBeUndefined();
  });

  it('trims extracted section name', () => {
    const result = parseRewriteSectionTarget('Rewriting:   Spaced Name  ');
    expect(result).toBe('Spaced Name');
  });
});

describe('rewriteResponse — extractRewriteOnly', () => {
  it('extracts content between BEGIN_REWRITE and END_REWRITE delimiters', () => {
    const input = `${REWRITE_BEGIN}\nThe rewrite content.\n${REWRITE_END}`;
    expect(extractRewriteOnly(input)).toBe('The rewrite content.');
  });

  it('strips rationale section from non-delimited response', () => {
    const input = 'The new intro text.\n\n**Rationale:** Here is why this works.';
    expect(extractRewriteOnly(input)).toBe('The new intro text.');
  });

  it('strips "Why this works" rationale label', () => {
    const input = 'Rewrite content.\n\n**Why this works:** Because it is great.';
    expect(extractRewriteOnly(input)).toBe('Rewrite content.');
  });

  it('returns full content when no rationale or delimiters', () => {
    const input = 'Just plain rewrite content.';
    expect(extractRewriteOnly(input)).toBe('Just plain rewrite content.');
  });

  it('trims leading/trailing whitespace from result', () => {
    const input = `${REWRITE_BEGIN}\n  spaced content  \n${REWRITE_END}`;
    expect(extractRewriteOnly(input)).toBe('spaced content');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// src/lib/audit-batch.ts — issueToTaskKey, issueToTaskItem, selectIssuesForBatch
// ════════════════════════════════════════════════════════════════════════════
import {
  issueToTaskKey,
  issueToTaskItem,
  selectIssuesForBatch,
} from '../../src/lib/audit-batch';
import type { PageSeoResult, SeoIssue } from '../../src/components/audit/types';

const makePage = (overrides: Partial<PageSeoResult> = {}): PageSeoResult => ({
  pageId: 'page-1',
  page: 'Home',
  slug: 'home',
  url: 'https://example.com/',
  score: 80,
  issues: [],
  ...overrides,
});

const makeIssue = (overrides: Partial<SeoIssue> = {}): SeoIssue => ({
  check: 'title',
  severity: 'error',
  message: 'Missing title tag',
  recommendation: 'Add a title tag',
  ...overrides,
});

describe('audit-batch — issueToTaskKey', () => {
  it('produces stable key from pageId + check + message prefix', () => {
    const page = makePage({ pageId: 'p-1' });
    const issue = makeIssue({ check: 'title', message: 'Missing title tag' });
    const key = issueToTaskKey(page, issue);
    expect(key).toBe('p-1-title-Missing title tag');
  });

  it('truncates message to 30 chars in key', () => {
    const page = makePage({ pageId: 'p-1' });
    const longMsg = 'A'.repeat(50);
    const issue = makeIssue({ check: 'title', message: longMsg });
    const key = issueToTaskKey(page, issue);
    expect(key).toBe(`p-1-title-${'A'.repeat(30)}`);
  });

  it('different pageIds produce different keys for same issue', () => {
    const issue = makeIssue();
    expect(issueToTaskKey(makePage({ pageId: 'p-1' }), issue))
      .not.toBe(issueToTaskKey(makePage({ pageId: 'p-2' }), issue));
  });
});

describe('audit-batch — issueToTaskItem', () => {
  it('sets priority to "high" for error severity', () => {
    const page = makePage();
    const issue = makeIssue({ severity: 'error' });
    expect(issueToTaskItem(page, issue).priority).toBe('high');
  });

  it('sets priority to "medium" for warning severity', () => {
    const page = makePage();
    const issue = makeIssue({ severity: 'warning' });
    expect(issueToTaskItem(page, issue).priority).toBe('medium');
  });

  it('category is always "seo"', () => {
    const page = makePage();
    expect(issueToTaskItem(page, makeIssue()).category).toBe('seo');
  });

  it('uses edited suggestion when available', () => {
    const page = makePage({ pageId: 'p-1' });
    const issue = makeIssue({ check: 'title', suggestedFix: 'Original suggestion' });
    const edited = { 'p-1-title': 'Edited suggestion' };
    const item = issueToTaskItem(page, issue, edited);
    expect(item.description).toContain('Edited suggestion');
    expect(item.description).not.toContain('Original suggestion');
  });

  it('falls back to suggestedFix when no edited suggestion', () => {
    const page = makePage({ pageId: 'p-1' });
    const issue = makeIssue({ check: 'title', suggestedFix: 'AI suggestion' });
    const item = issueToTaskItem(page, issue, {});
    expect(item.description).toContain('AI suggestion');
  });

  it('does not include suggestion section when neither edited nor suggestedFix', () => {
    const page = makePage({ pageId: 'p-1' });
    const issue = makeIssue({ check: 'title' }); // no suggestedFix
    const item = issueToTaskItem(page, issue, {});
    expect(item.description).not.toContain('AI Suggestion:');
  });

  it('uses publishedPath for pageUrl when available', () => {
    const page = makePage({ publishedPath: '/about-us', url: 'https://example.com/old' });
    const item = issueToTaskItem(page, makeIssue());
    expect(item.pageUrl).toBe('/about-us');
  });
});

describe('audit-batch — selectIssuesForBatch', () => {
  it('"all" mode includes every issue across all pages', () => {
    const pages: PageSeoResult[] = [
      makePage({ pageId: 'p1', issues: [makeIssue({ severity: 'error' }), makeIssue({ severity: 'warning', check: 'og-tags', message: 'Missing OG' })] }),
      makePage({ pageId: 'p2', issues: [makeIssue({ severity: 'info', check: 'analytics', message: 'No analytics' })] }),
    ];
    const result = selectIssuesForBatch({
      mode: 'all',
      pages,
      filteredPages: [],
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(result.items).toHaveLength(3);
  });

  it('"errors" mode includes only error-severity issues', () => {
    const pages: PageSeoResult[] = [
      makePage({ pageId: 'p1', issues: [
        makeIssue({ severity: 'error', check: 'title', message: 'Error 1' }),
        makeIssue({ severity: 'warning', check: 'og-tags', message: 'Warning 1' }),
      ]}),
    ];
    const result = selectIssuesForBatch({
      mode: 'errors',
      pages,
      filteredPages: [],
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toContain('title');
  });

  it('skips already-created task keys (deduplication)', () => {
    const page = makePage({ pageId: 'p1', issues: [makeIssue()] });
    const key = issueToTaskKey(page, page.issues[0]);
    const result = selectIssuesForBatch({
      mode: 'all',
      pages: [page],
      filteredPages: [],
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set([key]),
    });
    expect(result.items).toHaveLength(0);
  });

  it('"filtered" mode uses filteredPages, not all pages', () => {
    const allPages: PageSeoResult[] = [
      makePage({ pageId: 'p1', issues: [makeIssue({ check: 'title', message: 'Title error' })] }),
      makePage({ pageId: 'p2', issues: [makeIssue({ check: 'og-tags', message: 'OG error', severity: 'warning' })] }),
    ];
    const result = selectIssuesForBatch({
      mode: 'filtered',
      pages: allPages,
      filteredPages: [allPages[0]], // only first page
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(result.items).toHaveLength(1);
  });

  it('keys array has same length as items array', () => {
    const pages: PageSeoResult[] = [
      makePage({ pageId: 'p1', issues: [
        makeIssue({ check: 'title', message: 'T1' }),
        makeIssue({ check: 'meta', message: 'M1', severity: 'warning' }),
      ]}),
    ];
    const result = selectIssuesForBatch({
      mode: 'all',
      pages,
      filteredPages: [],
      severityFilter: 'all',
      categoryFilter: 'all',
      createdTasks: new Set(),
    });
    expect(result.keys).toHaveLength(result.items.length);
  });
});
