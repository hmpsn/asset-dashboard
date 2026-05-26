/**
 * Extended unit tests for server/schema-suggester.ts
 * Wave 12 — targeting uncovered branches in exported pure functions:
 *   - PAGE_TYPE_LABELS / PAGE_TYPE_SCHEMA_MAP completeness
 *   - isWeakCmsPlanRole
 *   - shouldCollectionRoleOverridePlan (all branches)
 *   - pageKindForRole (blog-index special case)
 *   - extractEeatFromBrief (regex extraction, null path)
 *   - buildSiteContextPages (merge logic, dedup, CMS skip)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks (vi.hoisted + vi.mock) ─────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getSchemaPlan: vi.fn(),
  getPageTypes: vi.fn(),
  isUtilitySchemaPath: vi.fn(),
  resolvePagePath: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../server/schema-store.js', () => ({
  getSchemaPlan: mocks.getSchemaPlan,
  getPageTypes: mocks.getPageTypes,
}));

vi.mock('../../server/schema/site-inventory.js', () => ({
  isUtilitySchemaPath: mocks.isUtilitySchemaPath,
  buildSiteInventory: vi.fn(),
}));

vi.mock('../../server/helpers.js', () => ({
  resolvePagePath: mocks.resolvePagePath,
  fetchPublishedHtml: vi.fn(),
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

// Mock modules with heavy dependencies that aren't under test
vi.mock('../../server/webflow.js', () => ({
  discoverSitemapUrls: vi.fn().mockResolvedValue([]),
  resolveStaticPagePathsFromSitemap: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/schema/index.js', () => ({
  generateLeanSchema: vi.fn(),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/seo-audit.js', () => ({
  fetchPageMeta: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/url-helpers.js', () => ({
  resolveBaseUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/schema/extractors/page-elements/ai-budget.js', () => ({
  createAiBudget: vi.fn().mockReturnValue({ remaining: 0 }),
}));

vi.mock('../../server/schema/site-context.js', () => ({
  assembleSiteContext: vi.fn().mockReturnValue({}),
}));

vi.mock('../../server/schema/rich-results.js', () => ({
  checkRichResultsEligibility: vi.fn().mockReturnValue([]),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  PAGE_TYPE_LABELS,
  PAGE_TYPE_SCHEMA_MAP,
  SCHEMA_ROLE_TO_PAGE_KIND,
  isWeakCmsPlanRole,
  shouldCollectionRoleOverridePlan,
  pageKindForRole,
  extractEeatFromBrief,
  buildSiteContextPages,
} from '../../server/schema-suggester.js';
import type { ContentBrief } from '../../shared/types/content.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBrief(eeatGuidance?: ContentBrief['eeatGuidance']): ContentBrief {
  return {
    id: 'brief-1',
    workspaceId: 'ws-1',
    targetKeyword: 'test keyword',
    secondaryKeywords: [],
    suggestedTitle: 'Test Title',
    suggestedMetaDesc: 'Test description',
    outline: [],
    wordCountTarget: 1000,
    intent: 'informational',
    audience: 'general',
    competitorInsights: '',
    internalLinkSuggestions: [],
    createdAt: '2024-01-01T00:00:00Z',
    eeatGuidance,
  };
}

// ── PAGE_TYPE_LABELS completeness ─────────────────────────────────────────────

describe('PAGE_TYPE_LABELS', () => {
  it('has a label for every key in PAGE_TYPE_SCHEMA_MAP', () => {
    const mapKeys = Object.keys(PAGE_TYPE_SCHEMA_MAP) as (keyof typeof PAGE_TYPE_SCHEMA_MAP)[];
    for (const key of mapKeys) {
      expect(PAGE_TYPE_LABELS[key], `Missing label for page type "${key}"`).toBeTruthy();
    }
  });

  it('has a schema entry for every key in PAGE_TYPE_LABELS', () => {
    const labelKeys = Object.keys(PAGE_TYPE_LABELS) as (keyof typeof PAGE_TYPE_LABELS)[];
    for (const key of labelKeys) {
      expect(PAGE_TYPE_SCHEMA_MAP[key], `Missing schema map entry for label key "${key}"`).toBeDefined();
    }
  });

  it('auto type has empty primary and secondary arrays', () => {
    expect(PAGE_TYPE_SCHEMA_MAP.auto.primary).toEqual([]);
    expect(PAGE_TYPE_SCHEMA_MAP.auto.secondary).toEqual([]);
  });

  it('homepage primary schemas include Organization and WebSite', () => {
    expect(PAGE_TYPE_SCHEMA_MAP.homepage.primary).toContain('Organization');
    expect(PAGE_TYPE_SCHEMA_MAP.homepage.primary).toContain('WebSite');
  });

  it('faq primary schemas include FAQPage', () => {
    expect(PAGE_TYPE_SCHEMA_MAP.faq.primary).toContain('FAQPage');
  });

  it('blog primary schemas include BlogPosting', () => {
    expect(PAGE_TYPE_SCHEMA_MAP.blog.primary).toContain('BlogPosting');
  });
});

// ── SCHEMA_ROLE_TO_PAGE_KIND ──────────────────────────────────────────────────

describe('SCHEMA_ROLE_TO_PAGE_KIND', () => {
  it('maps homepage to Homepage kind', () => {
    expect(SCHEMA_ROLE_TO_PAGE_KIND.homepage).toBe('Homepage');
  });

  it('maps blog to BlogPosting kind', () => {
    expect(SCHEMA_ROLE_TO_PAGE_KIND.blog).toBe('BlogPosting');
  });

  it('maps location to Location kind', () => {
    expect(SCHEMA_ROLE_TO_PAGE_KIND.location).toBe('Location');
  });

  it('does not have a mapping for author (not in SCHEMA_ROLE_TO_PAGE_KIND)', () => {
    // author is a SchemaPageType but not in SCHEMA_ROLE_TO_PAGE_KIND
    expect(SCHEMA_ROLE_TO_PAGE_KIND['author' as keyof typeof SCHEMA_ROLE_TO_PAGE_KIND]).toBeUndefined();
  });
});

// ── isWeakCmsPlanRole ─────────────────────────────────────────────────────────

describe('isWeakCmsPlanRole', () => {
  it('returns true for generic', () => {
    expect(isWeakCmsPlanRole('generic')).toBe(true);
  });

  it('returns true for lead-gen', () => {
    expect(isWeakCmsPlanRole('lead-gen')).toBe(true);
  });

  it('returns true for audience', () => {
    expect(isWeakCmsPlanRole('audience')).toBe(true);
  });

  it('returns true for pillar', () => {
    expect(isWeakCmsPlanRole('pillar')).toBe(true);
  });

  it('returns true for partnership', () => {
    expect(isWeakCmsPlanRole('partnership')).toBe(true);
  });

  it('returns true for comparison', () => {
    expect(isWeakCmsPlanRole('comparison')).toBe(true);
  });

  it('returns false for blog (strong role)', () => {
    expect(isWeakCmsPlanRole('blog')).toBe(false);
  });

  it('returns false for service (strong role)', () => {
    expect(isWeakCmsPlanRole('service')).toBe(false);
  });

  it('returns false for homepage (strong role)', () => {
    expect(isWeakCmsPlanRole('homepage')).toBe(false);
  });

  it('returns false for location (strong role)', () => {
    expect(isWeakCmsPlanRole('location')).toBe(false);
  });
});

// ── shouldCollectionRoleOverridePlan ─────────────────────────────────────────

describe('shouldCollectionRoleOverridePlan', () => {
  it('returns true when all conditions are met (isCmsItem, weak planRole, collectionRole with mapped source)', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'generic',
      collectionRole: 'blog',
      collectionRoleSource: 'mapped',
    })).toBe(true);
  });

  it('returns true with inferred source as well', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'pillar',
      collectionRole: 'service',
      collectionRoleSource: 'inferred',
    })).toBe(true);
  });

  it('returns false when isCmsItem is false', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: false,
      planRole: 'generic',
      collectionRole: 'blog',
      collectionRoleSource: 'mapped',
    })).toBe(false);
  });

  it('returns false when isCmsItem is undefined', () => {
    expect(shouldCollectionRoleOverridePlan({
      planRole: 'generic',
      collectionRole: 'blog',
      collectionRoleSource: 'mapped',
    })).toBe(false);
  });

  it('returns false when planRole is missing', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      collectionRole: 'blog',
      collectionRoleSource: 'mapped',
    })).toBe(false);
  });

  it('returns false when planRole is a strong role (not weak)', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'blog',     // strong role — should NOT be overridden
      collectionRole: 'service',
      collectionRoleSource: 'mapped',
    })).toBe(false);
  });

  it('returns false when collectionRole is missing', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'generic',
      collectionRoleSource: 'mapped',
    })).toBe(false);
  });

  it('returns false when collectionRoleSource is none', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'generic',
      collectionRole: 'blog',
      collectionRoleSource: 'none',
    })).toBe(false);
  });

  it('returns false when collectionRoleSource is undefined', () => {
    expect(shouldCollectionRoleOverridePlan({
      isCmsItem: true,
      planRole: 'generic',
      collectionRole: 'blog',
    })).toBe(false);
  });
});

// ── pageKindForRole ───────────────────────────────────────────────────────────

describe('pageKindForRole', () => {
  it('returns undefined for blog role on /blog (index path)', () => {
    expect(pageKindForRole('blog', '/blog')).toBeUndefined();
  });

  it('returns undefined for blog role on /blogs', () => {
    expect(pageKindForRole('blog', '/blogs')).toBeUndefined();
  });

  it('returns undefined for blog role on /news', () => {
    expect(pageKindForRole('blog', '/news')).toBeUndefined();
  });

  it('returns undefined for blog role on /insights', () => {
    expect(pageKindForRole('blog', '/insights')).toBeUndefined();
  });

  it('returns undefined for blog role on /resources', () => {
    expect(pageKindForRole('blog', '/resources')).toBeUndefined();
  });

  it('returns BlogPosting for blog role on a non-index path', () => {
    expect(pageKindForRole('blog', '/blog/my-post')).toBe('BlogPosting');
  });

  it('returns BlogPosting for blog role on /some-article', () => {
    expect(pageKindForRole('blog', '/some-article')).toBe('BlogPosting');
  });

  it('returns Homepage for homepage role', () => {
    expect(pageKindForRole('homepage', '/')).toBe('Homepage');
  });

  it('returns Service for service role', () => {
    expect(pageKindForRole('service', '/services')).toBe('Service');
  });

  it('returns undefined for a role not in SCHEMA_ROLE_TO_PAGE_KIND (e.g. faq)', () => {
    // 'faq' has no entry in SCHEMA_ROLE_TO_PAGE_KIND
    expect(pageKindForRole('faq', '/faq')).toBeUndefined();
  });

  it('handles trailing slash on blog index path', () => {
    // /blog/ should normalize to /blog and be treated as index
    expect(pageKindForRole('blog', '/blog/')).toBeUndefined();
  });
});

// ── extractEeatFromBrief ──────────────────────────────────────────────────────

describe('extractEeatFromBrief', () => {
  it('returns null when eeatGuidance is absent', () => {
    const brief = makeBrief(undefined);
    expect(extractEeatFromBrief(brief)).toBeNull();
  });

  it('returns null when eeatGuidance fields yield no extractable data', () => {
    const brief = makeBrief({
      expertise: 'Extensive knowledge of the subject.',
      experience: 'Many years of experience.',
      authority: 'Well regarded in the field.',
      trust: 'Trusted source.',
    });
    // No name patterns matched, no credential patterns, no expertise topics
    expect(extractEeatFromBrief(brief)).toBeNull();
  });

  it('extracts author name from "Written by Jane Smith" (without title prefix)', () => {
    // Note: "Written by Dr. Jane Smith" does NOT match — the regex requires
    // [A-Z][a-z]+ after "written by", and "Dr." has a trailing period that
    // prevents the subsequent space+capital word pattern from matching.
    const brief = makeBrief({
      expertise: 'Written by Jane Smith',
      experience: '',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorName).toMatch(/Jane Smith/);
  });

  it('extracts author name from "Author: John Doe" pattern', () => {
    const brief = makeBrief({
      expertise: '',
      experience: 'Author: John Doe',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorName).toMatch(/John Doe/);
  });

  it('extracts author name from "Reviewed by Alice Chen" pattern (no title)', () => {
    // "Reviewed by Dr. Alice Chen" does NOT match — same Dr. period issue.
    // "Reviewed by Alice Chen" matches correctly.
    const brief = makeBrief({
      expertise: '',
      experience: 'Reviewed by Alice Chen on this topic.',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorName).toMatch(/Alice Chen/);
  });

  it('does NOT extract name from "Written by Dr. Jane Smith" — documents regex limitation', () => {
    // The Dr. prefix prevents matching: [A-Z][a-z]+ captures "Dr" but then
    // the pattern fails on ". Jane" (period+space instead of space).
    // This is a known limitation of the current regex.
    const brief = makeBrief({
      expertise: 'Written by Dr. Jane Smith',
      experience: '',
      authority: '',
      trust: '',
    });
    // extractEeatFromBrief may still return something from title pattern (Dr matches
    // the credential pattern). We just verify authorName is specifically not extracted
    // from the "Written by" path.
    const result = extractEeatFromBrief(brief);
    // If a result is returned, authorName should NOT be "Jane Smith" (partial name)
    if (result?.authorName) {
      expect(result.authorName).not.toBe('Jane Smith');
    }
  });

  it('extracts title from credentials pattern in expertise', () => {
    const brief = makeBrief({
      expertise: 'Title: Senior SEO Specialist with 10 years.',
      experience: '',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.authorTitle).toMatch(/Senior SEO Specialist/);
  });

  it('extracts expertise topics from "expertise in X, Y, and Z" pattern', () => {
    const brief = makeBrief({
      expertise: 'Expert in SEO, content marketing, and link building.',
      experience: '',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.expertiseTopics).toBeDefined();
    expect(result!.expertiseTopics!.length).toBeGreaterThan(0);
  });

  it('extracts expertise from "specializes in" pattern', () => {
    const brief = makeBrief({
      expertise: 'She specializes in technical SEO and site architecture.',
      experience: '',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    expect(result).not.toBeNull();
    expect(result!.expertiseTopics).toBeDefined();
  });

  it('returns null when expertise topics are too short (< 2 chars)', () => {
    // Single letter words should be filtered out
    const brief = makeBrief({
      expertise: 'Expertise in a, b.',
      experience: '',
      authority: '',
      trust: '',
    });
    const result = extractEeatFromBrief(brief);
    // filtered topics (all 1 char) → expertiseTopics empty → returns null
    expect(result).toBeNull();
  });
});

// ── buildSiteContextPages ─────────────────────────────────────────────────────

describe('buildSiteContextPages', () => {
  beforeEach(() => {
    // Default: resolvePagePath just uses the slug
    mocks.resolvePagePath.mockImplementation((page: { slug?: string; publishedPath?: string }) => {
      if (page.publishedPath) return page.publishedPath;
      return page.slug ? `/${page.slug}` : '/';
    });
    // Default: not a utility path
    mocks.isUtilitySchemaPath.mockReturnValue({ isUtility: false });
  });

  it('returns static pages when no CMS items', () => {
    const staticPages = [
      { id: 'p1', title: 'Home', slug: '', publishedPath: '/' },
      { id: 'p2', title: 'About', slug: 'about', publishedPath: '/about' },
    ];
    const result = buildSiteContextPages(staticPages as any, [], null);
    expect(result).toHaveLength(2);
  });

  it('merges CMS items that have paths not in static pages', () => {
    const staticPages = [
      { id: 'p1', title: 'Home', slug: '', publishedPath: '/' },
    ];
    const cmsItems = [
      {
        pageId: 'cms-1',
        path: '/blog/post-1',
        title: 'Post One',
        collectionId: 'col-1',
        collectionName: 'Blog',
        collectionSlug: 'blog',
        itemId: 'item-1',
        lastPublished: null,
      },
    ];
    mocks.getSchemaPlan.mockReturnValue(null);
    const result = buildSiteContextPages(staticPages as any, cmsItems as any, null);
    expect(result).toHaveLength(2);
    expect(result.some(p => p.title === 'Post One')).toBe(true);
  });

  it('does not duplicate a page if CMS item path matches a static page path', () => {
    const staticPages = [
      { id: 'p1', title: 'Blog Index', slug: 'blog', publishedPath: '/blog' },
    ];
    const cmsItems = [
      {
        pageId: 'cms-1',
        path: '/blog',  // Same as static page
        title: 'Blog CMS Version',
        collectionId: 'col-1',
        collectionName: 'Blog',
        collectionSlug: 'blog',
        itemId: 'item-1',
        lastPublished: null,
      },
    ];
    const result = buildSiteContextPages(staticPages as any, cmsItems as any, null);
    // Static page wins — no duplicate
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Blog Index');
  });

  it('skips CMS items that are utility paths (no active plan role)', () => {
    const staticPages: any[] = [];
    const cmsItems = [
      {
        pageId: 'cms-404',
        path: '/404',
        title: '404 Page',
        collectionId: 'col-1',
        collectionName: 'System',
        collectionSlug: 'system',
        itemId: 'item-1',
        lastPublished: null,
      },
    ];
    mocks.isUtilitySchemaPath.mockReturnValue({ isUtility: true, reason: 'system error page' });
    const result = buildSiteContextPages(staticPages, cmsItems as any, null);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when both static and CMS inputs are empty', () => {
    const result = buildSiteContextPages([], [], null);
    expect(result).toHaveLength(0);
  });

  it('handles case-insensitive path deduplication', () => {
    const staticPages = [
      { id: 'p1', title: 'About', slug: 'About', publishedPath: '/About' },
    ];
    const cmsItems = [
      {
        pageId: 'cms-1',
        path: '/about',  // lowercase variant
        title: 'About CMS',
        collectionId: 'col-1',
        collectionName: 'Pages',
        collectionSlug: 'pages',
        itemId: 'item-1',
        lastPublished: null,
      },
    ];
    const result = buildSiteContextPages(staticPages as any, cmsItems as any, null);
    // The static page /About and CMS /about both normalize to /about — only one entry
    expect(result).toHaveLength(1);
  });
});
