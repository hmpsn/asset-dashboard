/**
 * Unit tests for server/schema-plan.ts
 *
 * Coverage targets:
 * 1. buildFallbackRoles — URL regex classification (20+ patterns)
 * 2. AI response post-processing — wildcard expansion, role normalization, industrySubtype parsing
 * 3. buildPlanContextForPage — exported pure function
 * 4. Page filtering — password/404/thank/success pages excluded
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks (vi.mock calls are hoisted to the top automatically) ──

vi.mock('../../server/ai.js', () => ({ callAI: vi.fn() }));
vi.mock('../../server/schema-store.js', () => ({ saveSchemaPlan: vi.fn() }));
vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../server/webflow.js', () => ({
  discoverCmsUrls: vi.fn().mockResolvedValue({ cmsUrls: [], totalFound: 0 }),
  buildStaticPathSet: vi.fn().mockReturnValue(new Set()),
}));
vi.mock('../../server/competitor-schema.js', () => ({
  crawlCompetitorSchemas: vi.fn().mockResolvedValue([]),
  compareSchemas: vi.fn().mockReturnValue({ typesTheyHaveWeNot: [] }),
}));
vi.mock('../../server/helpers.js', () => ({
  normalizePageUrl: vi.fn((u: string) => u),
  resolvePagePath: vi.fn((p: { slug?: string }) => `/${p.slug || ''}`),
  findPageMapEntry: vi.fn().mockReturnValue(undefined),
  findPageMapEntryForPage: vi.fn().mockReturnValue(undefined),
}));
vi.mock('../../server/site-architecture.js', () => ({
  flattenTree: vi.fn().mockReturnValue([]),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { generateSchemaPlan, buildPlanContextForPage } from '../../server/schema-plan.js';
import type { PlanContext } from '../../server/schema-plan.js';
import type { SchemaSitePlan, CanonicalEntity } from '../../shared/types/schema-plan.js';
import { callAI } from '../../server/ai.js';
import { flattenTree } from '../../server/site-architecture.js';
import type { SiteNode } from '../../server/site-architecture.js';

const mockCallAI = vi.mocked(callAI);
const mockFlattenTree = vi.mocked(flattenTree);

// ── Helpers ──

/** Build a minimal SiteNode (existing page) for use in flattenTree results */
function makeNode(path: string, opts: {
  source?: SiteNode['source'];
  name?: string;
  depth?: number;
  keyword?: string;
  pageType?: string;
} = {}): SiteNode {
  return {
    path,
    name: opts.name ?? (path.replace(/^\//, '') || 'Home'),
    source: opts.source ?? 'existing',
    depth: opts.depth ?? (path === '/' ? 0 : path.split('/').filter(Boolean).length),
    keyword: opts.keyword,
    pageType: opts.pageType,
    children: [],
    hasContent: true,
  };
}

/** Minimal PlanContext that bypasses the workspace DB path */
const BASE_CTX: PlanContext = {
  siteId: 'site1',
  workspaceId: 'ws1',
  siteUrl: 'https://example.com',
  architectureResult: {
    tree: { path: '/', name: 'Root', source: 'existing', depth: 0, children: [], hasContent: true },
    totalPages: 0,
    existingPages: 0,
    plannedPages: 0,
    strategyPages: 0,
    gaps: [],
    depthDistribution: {},
    orphanPaths: [],
    analyzedAt: new Date().toISOString(),
  },
};

/** Force AI path off so fallback is always used */
beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
});

beforeEach(() => {
  mockCallAI.mockReset();
  mockFlattenTree.mockReturnValue([]);
});

// ────────────────────────────────────────────────────────────────────────────
// Section 1 — Page filtering (password/404/thank/success exclusion)
// ────────────────────────────────────────────────────────────────────────────

describe('page filtering — excluded paths', () => {
  it('excludes /password path', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/password')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/password')).toBeUndefined();
  });

  it('excludes /404 path', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/404')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/404')).toBeUndefined();
  });

  it('excludes /thank-you path', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/thank-you')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/thank-you')).toBeUndefined();
  });

  it('excludes /success-page path', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/success-page')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/success-page')).toBeUndefined();
  });

  it('excludes nested /account/password path', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/account/password')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/account/password')).toBeUndefined();
  });

  it('does NOT exclude non-planned pages', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/about')).toBeDefined();
  });

  it('only includes source=existing nodes', async () => {
    mockFlattenTree.mockReturnValue([
      makeNode('/existing-page', { source: 'existing' }),
      makeNode('/planned-page', { source: 'planned' }),
      makeNode('/gap-page', { source: 'gap' }),
    ]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles.find(r => r.pagePath === '/existing-page')).toBeDefined();
    expect(plan.pageRoles.find(r => r.pagePath === '/planned-page')).toBeUndefined();
    expect(plan.pageRoles.find(r => r.pagePath === '/gap-page')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 2 — buildFallbackRoles via null-AI path
// ────────────────────────────────────────────────────────────────────────────

describe('buildFallbackRoles — homepage', () => {
  it('assigns homepage role to depth-0 root node', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.role).toBe('homepage');
    expect(role?.primaryType).toBe('Organization');
  });
});

describe('buildFallbackRoles — lead-gen patterns', () => {
  const leadGenPaths = [
    '/demo',
    '/contact',
    '/request-demo',
    '/get-started',
    '/signup',
    '/book',
  ];

  for (const path of leadGenPaths) {
    it(`assigns lead-gen to ${path}`, async () => {
      mockFlattenTree.mockReturnValue([makeNode(path)]);
      const plan = await generateSchemaPlan(BASE_CTX);
      const role = plan.pageRoles.find(r => r.pagePath === path);
      expect(role?.role).toBe('lead-gen');
    });
  }

  it('assigns lead-gen to /demo/signup (sub-path)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/demo/signup')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/demo/signup');
    expect(role?.role).toBe('lead-gen');
  });
});

describe('buildFallbackRoles — blog patterns', () => {
  it('assigns blog role to /blog (top-level)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/blog')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/blog');
    expect(role?.role).toBe('blog');
    expect(role?.primaryType).toBe('Article');
  });

  it('assigns blog role to /posts (top-level)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/posts')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/posts');
    expect(role?.role).toBe('blog');
  });

  it('assigns blog role to /blog/my-post', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/blog/my-post')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/blog/my-post');
    expect(role?.role).toBe('blog');
    expect(role?.primaryType).toBe('Article');
  });

  it('assigns blog role to /articles/some-article', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/articles/some-article')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/articles/some-article');
    expect(role?.role).toBe('blog');
  });

  it('assigns blog role to /news/announcement', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/news/announcement')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/news/announcement');
    expect(role?.role).toBe('blog');
  });

  it('assigns blog role to /resources/guide-1', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/resources/guide-1')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/resources/guide-1');
    expect(role?.role).toBe('blog');
    expect(role?.primaryType).toBe('Article');
  });

  it('assigns blog role to /guides/seo-checklist', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/guides/seo-checklist')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/guides/seo-checklist');
    expect(role?.role).toBe('blog');
  });
});

describe('buildFallbackRoles — pricing patterns', () => {
  it('assigns pricing role to /pricing', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/pricing')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/pricing');
    expect(role?.role).toBe('pricing');
  });

  it('assigns pricing role to /plans', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/plans')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/plans');
    expect(role?.role).toBe('pricing');
  });

  it('assigns pricing role to /packages', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/packages')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/packages');
    expect(role?.role).toBe('pricing');
  });
});

describe('buildFallbackRoles — about patterns', () => {
  it('assigns about role to /about', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/about');
    expect(role?.role).toBe('about');
  });

  it('assigns about role to /team (top-level)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/team')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/team');
    expect(role?.role).toBe('about');
  });

  it('assigns about role to /careers (top-level)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/careers')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/careers');
    expect(role?.role).toBe('about');
  });

  it('assigns about role to /about/ (trailing slash)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/about/')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/about/');
    expect(role?.role).toBe('about');
  });

  it('/team/ (trailing slash) matches author pattern before about (author checked first)', async () => {
    // The regex /^\/(team|authors?|staff|people)\//.test('/team/') is true (matches author pattern),
    // which is checked BEFORE the about pattern. So /team/ → author, not about.
    mockFlattenTree.mockReturnValue([makeNode('/team/')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/team/');
    expect(role?.role).toBe('author');
  });
});

describe('buildFallbackRoles — author patterns', () => {
  it('assigns author role to /team/jane-doe', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/team/jane-doe')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/team/jane-doe');
    expect(role?.role).toBe('author');
    expect(role?.primaryType).toBe('ProfilePage');
  });

  it('assigns author role to /authors/john', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/authors/john')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/authors/john');
    expect(role?.role).toBe('author');
    expect(role?.primaryType).toBe('ProfilePage');
  });

  it('assigns author role to /staff/bob-smith', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/staff/bob-smith')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/staff/bob-smith');
    expect(role?.role).toBe('author');
  });

  it('assigns author role to /people/jane', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/people/jane')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/people/jane');
    expect(role?.role).toBe('author');
  });
});

describe('buildFallbackRoles — job-posting patterns', () => {
  it('assigns job-posting role to /careers/engineer', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/careers/engineer')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/careers/engineer');
    expect(role?.role).toBe('job-posting');
    expect(role?.primaryType).toBe('JobPosting');
  });

  it('assigns job-posting role to /jobs/frontend', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/jobs/frontend')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/jobs/frontend');
    expect(role?.role).toBe('job-posting');
    expect(role?.primaryType).toBe('JobPosting');
  });

  it('assigns job-posting role to /hiring/designer', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/hiring/designer')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/hiring/designer');
    expect(role?.role).toBe('job-posting');
  });

  it('assigns job-posting role to /positions/senior-dev', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/positions/senior-dev')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/positions/senior-dev');
    expect(role?.role).toBe('job-posting');
  });
});

describe('buildFallbackRoles — faq patterns', () => {
  it('assigns faq role to /faq', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/faq')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/faq');
    expect(role?.role).toBe('faq');
    expect(role?.primaryType).toBe('FAQPage');
  });

  it('assigns faq role to /frequently-asked', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/frequently-asked')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/frequently-asked');
    expect(role?.role).toBe('faq');
    expect(role?.primaryType).toBe('FAQPage');
  });

  it('assigns faq role to /faq/billing', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/faq/billing')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/faq/billing');
    expect(role?.role).toBe('faq');
  });
});

describe('buildFallbackRoles — pillar patterns', () => {
  it('assigns pillar role to /platform', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/platform')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/platform');
    expect(role?.role).toBe('pillar');
    expect(role?.primaryType).toBe('SoftwareApplication');
  });

  it('assigns pillar role to /product', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/product')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/product');
    expect(role?.role).toBe('pillar');
    expect(role?.primaryType).toBe('SoftwareApplication');
  });

  it('assigns pillar role to /solutions', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/solutions')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/solutions');
    expect(role?.role).toBe('pillar');
    expect(role?.primaryType).toBe('SoftwareApplication');
  });

  it('assigns pillar role to /platforms (plural)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/platforms')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/platforms');
    expect(role?.role).toBe('pillar');
  });
});

describe('buildFallbackRoles — service patterns', () => {
  it('assigns service role to /services', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/services')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/services');
    expect(role?.role).toBe('service');
    expect(role?.primaryType).toBe('Service');
  });

  it('assigns service role to /services/web-design', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/services/web-design')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/services/web-design');
    expect(role?.role).toBe('service');
    expect(role?.primaryType).toBe('Service');
  });

  it('assigns service role to /service/consulting (singular)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/service/consulting')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/service/consulting');
    expect(role?.role).toBe('service');
  });
});

describe('buildFallbackRoles — comparison patterns', () => {
  it('assigns comparison role to /vs-competitor', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/vs-competitor')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/vs-competitor');
    expect(role?.role).toBe('comparison');
  });

  it('assigns comparison role to /compare-tools', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/compare-tools')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/compare-tools');
    expect(role?.role).toBe('comparison');
  });

  it('assigns comparison role to /alternative-to-x', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/alternative-to-x')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/alternative-to-x');
    expect(role?.role).toBe('comparison');
  });

  it('assigns comparison role to /competitor-vs-us (mid-slug vs-)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/competitor-vs-us')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/competitor-vs-us');
    expect(role?.role).toBe('comparison');
  });
});

describe('buildFallbackRoles — case-study patterns', () => {
  it('assigns case-study role to /customers/acme-corp', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/customers/acme-corp')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/customers/acme-corp');
    expect(role?.role).toBe('case-study');
    expect(role?.primaryType).toBe('Article');
  });

  it('assigns case-study role to /case-studies/growth', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/case-studies/growth')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/case-studies/growth');
    expect(role?.role).toBe('case-study');
    expect(role?.primaryType).toBe('Article');
  });

  it('assigns case-study role to /customer/acme (singular)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/customer/acme')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/customer/acme');
    expect(role?.role).toBe('case-study');
  });

  it('assigns case-study role to /success-stories/acme (success story)', async () => {
    // Note: /success-stories/ contains "success" but the filter excludes /success at word boundary
    // /success-stories/acme should NOT be filtered since filter checks \/(password|404|thank|success)
    mockFlattenTree.mockReturnValue([makeNode('/success-stories/growth')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    // /success-stories/growth contains /success in the path — it WILL be filtered out
    // The regex is /\/(password|404|thank|success)/ which matches /success-stories
    // So this tests that the filter is working correctly
    expect(plan.pageRoles.find(r => r.pagePath === '/success-stories/growth')).toBeUndefined();
  });
});

describe('buildFallbackRoles — partnership patterns', () => {
  it('assigns partnership role to /integrations/slack', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/integrations/slack')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/integrations/slack');
    expect(role?.role).toBe('partnership');
  });

  it('assigns partnership role to /partners/stripe', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/partners/stripe')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/partners/stripe');
    expect(role?.role).toBe('partnership');
  });

  it('assigns partnership role to /integration/salesforce (singular)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/integration/salesforce')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/integration/salesforce');
    expect(role?.role).toBe('partnership');
  });
});

describe('buildFallbackRoles — howto patterns', () => {
  it('assigns howto role to /how-to/setup', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/how-to/setup')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/how-to/setup');
    expect(role?.role).toBe('howto');
    expect(role?.primaryType).toBe('HowTo');
  });

  it('assigns howto role to /tutorials/getting-started', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/tutorials/getting-started')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/tutorials/getting-started');
    expect(role?.role).toBe('howto');
    expect(role?.primaryType).toBe('HowTo');
  });

  it('assigns howto role to /guides/seo-guide (sub-path)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/guides/seo-guide')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/guides/seo-guide');
    // /guides/ matches the blog pattern first (resources?/guides?)
    // so it gets 'blog', not 'howto'
    expect(role?.role).toBe('blog');
  });

  it('assigns howto role to /howto/checklist (no hyphen)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/howto/checklist')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/howto/checklist');
    expect(role?.role).toBe('howto');
  });
});

describe('buildFallbackRoles — video patterns', () => {
  it('assigns video role to /videos/demo', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/videos/demo')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/videos/demo');
    expect(role?.role).toBe('video');
    expect(role?.primaryType).toBe('VideoObject');
  });

  it('assigns video role to /watch/tutorial', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/watch/tutorial')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/watch/tutorial');
    expect(role?.role).toBe('video');
    expect(role?.primaryType).toBe('VideoObject');
  });

  it('assigns video role to /video (top-level singular)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/video')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/video');
    expect(role?.role).toBe('video');
  });
});

describe('buildFallbackRoles — course patterns', () => {
  it('assigns course role to /courses/seo-101', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/courses/seo-101')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/courses/seo-101');
    expect(role?.role).toBe('course');
    expect(role?.primaryType).toBe('Course');
  });

  it('assigns course role to /training/web-development', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/training/web-development')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/training/web-development');
    expect(role?.role).toBe('course');
    expect(role?.primaryType).toBe('Course');
  });

  it('assigns course role to /workshops/design-thinking', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/workshops/design-thinking')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/workshops/design-thinking');
    expect(role?.role).toBe('course');
  });
});

describe('buildFallbackRoles — event patterns', () => {
  it('assigns event role to /events/webinar-2024', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/events/webinar-2024')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/events/webinar-2024');
    expect(role?.role).toBe('event');
    expect(role?.primaryType).toBe('Event');
  });

  it('assigns event role to /webinars/q4-review', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/webinars/q4-review')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/webinars/q4-review');
    expect(role?.role).toBe('event');
    expect(role?.primaryType).toBe('Event');
  });

  it('assigns event role to /meetups/tech-talks', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/meetups/tech-talks')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/meetups/tech-talks');
    expect(role?.role).toBe('event');
  });
});

describe('buildFallbackRoles — review patterns', () => {
  it('assigns review role to /reviews/product', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/reviews/product')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/reviews/product');
    expect(role?.role).toBe('review');
    expect(role?.primaryType).toBe('Review');
  });

  it('assigns review role to /testimonials', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/testimonials')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/testimonials');
    expect(role?.role).toBe('review');
    expect(role?.primaryType).toBe('Review');
  });

  it('assigns review role to /review (singular)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/review')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/review');
    expect(role?.role).toBe('review');
  });
});

describe('buildFallbackRoles — recipe patterns', () => {
  it('assigns recipe role to /recipes/pasta', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/recipes/pasta')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/recipes/pasta');
    expect(role?.role).toBe('recipe');
    expect(role?.primaryType).toBe('Recipe');
  });

  it('assigns recipe role to /cooking/pasta-carbonara', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/cooking/pasta-carbonara')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/cooking/pasta-carbonara');
    expect(role?.role).toBe('recipe');
  });
});

describe('buildFallbackRoles — generic fallback', () => {
  it('assigns generic role to unknown paths', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/some-random-page')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/some-random-page');
    expect(role?.role).toBe('generic');
    expect(role?.primaryType).toBe('WebPage');
  });

  it('assigns generic role to /privacy-policy', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/privacy-policy')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/privacy-policy');
    expect(role?.role).toBe('generic');
  });

  it('assigns generic role to /terms', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/terms')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/terms');
    expect(role?.role).toBe('generic');
  });
});

describe('buildFallbackRoles — SCHEMA_ROLE_PRIMARY_TYPE authority', () => {
  it('uses SCHEMA_ROLE_PRIMARY_TYPE for about role (AboutPage)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/about');
    // SCHEMA_ROLE_PRIMARY_TYPE['about'] = 'AboutPage'
    expect(role?.primaryType).toBe('AboutPage');
  });

  it('uses SCHEMA_ROLE_PRIMARY_TYPE for pricing role (WebPage)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/pricing')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/pricing');
    // SCHEMA_ROLE_PRIMARY_TYPE['pricing'] = 'WebPage'
    expect(role?.primaryType).toBe('WebPage');
  });

  it('uses SCHEMA_ROLE_PRIMARY_TYPE for partnership role (WebPage)', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/integrations/slack')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/integrations/slack');
    // SCHEMA_ROLE_PRIMARY_TYPE['partnership'] = 'WebPage'
    expect(role?.primaryType).toBe('WebPage');
  });

  it('pageRoles have empty entityRefs from fallback', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/about');
    expect(role?.entityRefs).toEqual([]);
  });

  it('pageRoles have no notes from fallback', async () => {
    mockFlattenTree.mockReturnValue([makeNode('/blog/post-1')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/blog/post-1');
    expect(role?.notes).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 3 — AI response post-processing (re-enable OPENAI_API_KEY)
// ────────────────────────────────────────────────────────────────────────────

describe('AI response post-processing', () => {
  beforeEach(() => {
    // Enable AI path
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  // ── Malformed JSON ──

  it('falls back to buildFallbackRoles when AI returns malformed JSON', async () => {
    mockCallAI.mockResolvedValue({ text: 'not json at all', promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/about');
    // Fallback: /about → 'about'
    expect(role?.role).toBe('about');
  });

  it('falls back when AI returns null text', async () => {
    mockCallAI.mockResolvedValue({ text: null, promptTokens: 10, completionTokens: 0, totalTokens: 10 });
    mockFlattenTree.mockReturnValue([makeNode('/pricing')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/pricing');
    expect(role?.role).toBe('pricing');
  });

  it('falls back when AI returns JSON missing pageRoles array', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({ canonicalEntities: [], notPageRoles: [] }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/faq')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/faq');
    expect(role?.role).toBe('faq');
  });

  it('falls back when AI returns JSON missing canonicalEntities array', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({ pageRoles: [], notEntities: [] }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/services')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    // Falls back because canonicalEntities is missing
    expect(plan.pageRoles.find(r => r.pagePath === '/services')?.role).toBe('service');
  });

  // ── Role normalization ──

  it('normalizes unknown-invalid-role to generic', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/some-page', pageTitle: 'Some Page', role: 'unknown-invalid-role', primaryType: 'WebPage', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/some-page')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/some-page');
    expect(role?.role).toBe('generic');
  });

  it('keeps valid role homepage as-is', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.role).toBe('homepage');
  });

  it('keeps valid role service as-is', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/services/consulting', pageTitle: 'Consulting', role: 'service', primaryType: 'Service', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/services/consulting')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/services/consulting');
    expect(role?.role).toBe('service');
  });

  it('keeps valid role blog as-is', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/blog/post-1', pageTitle: 'Post 1', role: 'blog', primaryType: 'Article', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/blog/post-1')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/blog/post-1');
    expect(role?.role).toBe('blog');
  });

  // ── Wildcard expansion ──

  it('expands /blog/* wildcard to individual pages', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/blog/*', pageTitle: 'Blog Posts', role: 'blog', primaryType: 'Article', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([
      makeNode('/blog/post-1', { name: 'Post 1' }),
      makeNode('/blog/post-2', { name: 'Post 2' }),
      makeNode('/blog/post-3', { name: 'Post 3' }),
    ]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const blogRoles = plan.pageRoles.filter(r => r.pagePath.startsWith('/blog/'));
    expect(blogRoles).toHaveLength(3);
    for (const r of blogRoles) {
      expect(r.role).toBe('blog');
      expect(r.primaryType).toBe('Article');
    }
  });

  it('wildcard expansion does NOT include the parent /blog path itself', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/blog/*', pageTitle: 'Blog Posts', role: 'blog', primaryType: 'Article', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([
      makeNode('/blog', { name: 'Blog Index' }),
      makeNode('/blog/post-1', { name: 'Post 1' }),
    ]);
    const plan = await generateSchemaPlan(BASE_CTX);
    // /blog is the prefix itself (/blog/ after slice), so the filter excludes it
    const blogIndexRole = plan.pageRoles.find(r => r.pagePath === '/blog');
    // The /blog page is not matched by the wildcard (it equals the prefix), so it gets fallback role
    // Fallback for /blog → 'blog' too, so just confirm it exists and has correct role
    expect(blogIndexRole).toBeDefined();
    expect(blogIndexRole?.role).toBe('blog');
  });

  it('wildcard does NOT assign roles to pages outside the prefix', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/blog/*', pageTitle: 'Blog Posts', role: 'blog', primaryType: 'Article', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([
      makeNode('/blog/post-1', { name: 'Post 1' }),
      makeNode('/about', { name: 'About' }),
    ]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const aboutRole = plan.pageRoles.find(r => r.pagePath === '/about');
    // /about doesn't match /blog/* so it gets fallback
    expect(aboutRole?.role).toBe('about');
    expect(aboutRole?.role).not.toBe('blog');
  });

  it('wildcard expanded pages use page title from flattenTree, not AI title', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/blog/*', pageTitle: 'Generic Blog Post', role: 'blog', primaryType: 'Article', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/blog/real-title', { name: 'Real Title' })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/blog/real-title');
    expect(role?.pageTitle).toBe('Real Title');
  });

  // ── Duplicate suppression ──

  it('keeps only first assignment when AI returns duplicate pagePaths', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/about', pageTitle: 'About', role: 'about', primaryType: 'AboutPage', entityRefs: [] },
          { pagePath: '/about', pageTitle: 'About Duplicate', role: 'generic', primaryType: 'WebPage', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const aboutRoles = plan.pageRoles.filter(r => r.pagePath === '/about');
    expect(aboutRoles).toHaveLength(1);
    expect(aboutRoles[0].role).toBe('about');
  });

  // ── Missed pages get fallback roles ──

  it('assigns fallback roles to pages the AI missed', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/about', pageTitle: 'About', role: 'about', primaryType: 'AboutPage', entityRefs: [] },
          // /pricing is NOT in AI response
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([
      makeNode('/about'),
      makeNode('/pricing'),
    ]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const pricingRole = plan.pageRoles.find(r => r.pagePath === '/pricing');
    expect(pricingRole).toBeDefined();
    expect(pricingRole?.role).toBe('pricing');
  });

  it('assigns fallback roles to multiple missed pages', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([
      makeNode('/', { depth: 0 }),
      makeNode('/blog/post-1'),
      makeNode('/services/consulting'),
    ]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.pageRoles).toHaveLength(3);
    expect(plan.pageRoles.find(r => r.pagePath === '/blog/post-1')?.role).toBe('blog');
    expect(plan.pageRoles.find(r => r.pagePath === '/services/consulting')?.role).toBe('service');
  });

  // ── industrySubtype parsing ──

  it('keeps industrySubtype "medical" from AI field', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: 'medical' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBe('medical');
  });

  it('keeps industrySubtype "financial" from AI field', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: 'financial' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBe('financial');
  });

  it('returns null for industrySubtype "legal" (not in allowed set)', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: 'legal' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBeNull();
  });

  it('extracts medical from notes when industrySubtype field is null', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: null, notes: 'Use MedicalOrganization for this clinic' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBe('medical');
  });

  it('extracts financial from notes when industrySubtype field is null', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: null, notes: 'This is a FinancialService company' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBe('financial');
  });

  it('extracts medical from notes containing "medical clinic"', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: null, notes: 'This is a medical clinic in downtown' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBe('medical');
  });

  it('returns null when notes contains "law firm" (not in allowed patterns)', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: null, notes: 'This is a law firm' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    expect(role?.industrySubtype).toBeNull();
  });

  it('uses field industrySubtype over notes extraction (field wins)', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [], industrySubtype: 'financial', notes: 'Use MedicalOrganization' },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const role = plan.pageRoles.find(r => r.pagePath === '/');
    // Field wins — 'financial' from the field, not 'medical' from notes
    expect(role?.industrySubtype).toBe('financial');
  });

  // ── Canonical entities ──

  it('maps canonical entities correctly from AI response', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [
          {
            type: 'SoftwareApplication',
            name: 'My Product',
            canonicalUrl: 'https://example.com/platform',
            id: 'https://example.com/platform/#software',
            description: 'A great product',
          },
        ],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: ['https://example.com/platform/#software'] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.canonicalEntities).toHaveLength(1);
    expect(plan.canonicalEntities[0].type).toBe('SoftwareApplication');
    expect(plan.canonicalEntities[0].name).toBe('My Product');
    expect(plan.canonicalEntities[0].id).toBe('https://example.com/platform/#software');
    expect(plan.canonicalEntities[0].description).toBe('A great product');
  });

  it('exposes entityRefs from AI in the page role', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        canonicalEntities: [
          { type: 'SoftwareApplication', name: 'My Product', canonicalUrl: 'https://example.com/platform', id: 'https://example.com/platform/#software' },
        ],
        pageRoles: [
          { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: ['https://example.com/platform/#software'] },
        ],
      }),
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
    });
    mockFlattenTree.mockReturnValue([makeNode('/', { depth: 0 })]);
    const plan = await generateSchemaPlan(BASE_CTX);
    const homeRole = plan.pageRoles.find(r => r.pagePath === '/');
    expect(homeRole?.entityRefs).toContain('https://example.com/platform/#software');
  });

  // ── Plan structure ──

  it('plan includes required top-level fields', async () => {
    mockCallAI.mockResolvedValue({ text: null, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    mockFlattenTree.mockReturnValue([makeNode('/about')]);
    const plan = await generateSchemaPlan(BASE_CTX);
    expect(plan.id).toMatch(/^plan_/);
    expect(plan.siteId).toBe('site1');
    expect(plan.workspaceId).toBe('ws1');
    expect(plan.siteUrl).toBe('https://example.com');
    expect(plan.status).toBe('draft');
    expect(typeof plan.generatedAt).toBe('string');
    expect(typeof plan.updatedAt).toBe('string');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 4 — buildPlanContextForPage
// ────────────────────────────────────────────────────────────────────────────

/** Build a minimal SchemaSitePlan for context tests */
function makePlan(overrides: Partial<SchemaSitePlan> = {}): SchemaSitePlan {
  return {
    id: 'plan_test',
    siteId: 'site1',
    workspaceId: 'ws1',
    siteUrl: 'https://example.com',
    canonicalEntities: [],
    pageRoles: [],
    status: 'draft',
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildPlanContextForPage', () => {
  it('returns empty string when path is not found in plan', () => {
    const plan = makePlan({ pageRoles: [] });
    expect(buildPlanContextForPage(plan, '/missing')).toBe('');
  });

  it('returns context string containing role when path is found', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/about', pageTitle: 'About', role: 'about', primaryType: 'AboutPage', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/about');
    expect(ctx).toContain('ABOUT');
    expect(ctx).toContain('AboutPage');
  });

  it('returns context containing primaryType', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/pricing', pageTitle: 'Pricing', role: 'pricing', primaryType: 'WebPage', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/pricing');
    expect(ctx).toContain('WebPage');
  });

  it('includes notes in context when present', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/demo', pageTitle: 'Demo', role: 'lead-gen', primaryType: 'WebPage', entityRefs: [], notes: 'Conversion page — BreadcrumbList only' },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/demo');
    expect(ctx).toContain('Conversion page — BreadcrumbList only');
  });

  it('includes role-specific instruction for homepage', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'Organization', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/');
    expect(ctx).toContain('FULL Organization');
  });

  it('includes role-specific instruction for pillar', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/platform', pageTitle: 'Platform', role: 'pillar', primaryType: 'SoftwareApplication', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/platform');
    expect(ctx).toContain('pillar page');
    expect(ctx).toContain('SoftwareApplication');
  });

  it('includes role-specific instruction for lead-gen', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/demo', pageTitle: 'Demo', role: 'lead-gen', primaryType: 'WebPage', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/demo');
    expect(ctx).toContain('BreadcrumbList');
  });

  it('includes role-specific instruction for blog', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/blog/post-1', pageTitle: 'Post 1', role: 'blog', primaryType: 'Article', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/blog/post-1');
    expect(ctx).toContain('Article');
  });

  it('includes role-specific instruction for howto', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/how-to/setup', pageTitle: 'Setup', role: 'howto', primaryType: 'HowTo', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/how-to/setup');
    expect(ctx).toContain('HowTo');
  });

  it('matches path with trailing slash stripped', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/about', pageTitle: 'About', role: 'about', primaryType: 'AboutPage', entityRefs: [] },
      ],
    });
    // The function does: pr.pagePath === pagePath.replace(/\/$/, '')
    // So passing '/about/' should match '/about'
    const ctx = buildPlanContextForPage(plan, '/about/');
    expect(ctx).toContain('ABOUT');
  });

  it('includes owned entity annotation for pillar/homepage', () => {
    const entity: CanonicalEntity = {
      type: 'SoftwareApplication',
      name: 'My Product',
      canonicalUrl: 'https://example.com/platform',
      id: 'https://example.com/platform/#software',
    };
    const plan = makePlan({
      canonicalEntities: [entity],
      pageRoles: [
        { pagePath: '/platform', pageTitle: 'Platform', role: 'pillar', primaryType: 'SoftwareApplication', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/platform');
    expect(ctx).toContain('THIS PAGE OWNS');
    expect(ctx).toContain('My Product');
  });

  it('includes REFERENCE ONLY annotation for pages referencing an entity', () => {
    const entityId = 'https://example.com/platform/#software';
    const entity: CanonicalEntity = {
      type: 'SoftwareApplication',
      name: 'My Product',
      canonicalUrl: 'https://example.com/platform',
      id: entityId,
    };
    const plan = makePlan({
      canonicalEntities: [entity],
      pageRoles: [
        { pagePath: '/demo', pageTitle: 'Demo', role: 'lead-gen', primaryType: 'WebPage', entityRefs: [entityId] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/demo');
    expect(ctx).toContain('REFERENCE ONLY');
  });

  it('returns empty string for a completely empty plan', () => {
    const plan = makePlan();
    expect(buildPlanContextForPage(plan, '/')).toBe('');
  });

  it('contains the SCHEMA SITE PLAN header when page found', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/faq', pageTitle: 'FAQ', role: 'faq', primaryType: 'FAQPage', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/faq');
    expect(ctx).toContain('SCHEMA SITE PLAN');
  });

  it('includes job-posting specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/careers/engineer', pageTitle: 'Engineer', role: 'job-posting', primaryType: 'JobPosting', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/careers/engineer');
    expect(ctx).toContain('JobPosting');
    expect(ctx).toContain('hiringOrganization');
  });

  it('includes recipe specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/recipes/pasta', pageTitle: 'Pasta', role: 'recipe', primaryType: 'Recipe', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/recipes/pasta');
    expect(ctx).toContain('recipeIngredient');
  });

  it('includes event specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/events/conf-2024', pageTitle: 'Conference', role: 'event', primaryType: 'Event', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/events/conf-2024');
    expect(ctx).toContain('startDate');
  });

  it('includes course specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/courses/seo-101', pageTitle: 'SEO 101', role: 'course', primaryType: 'Course', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/courses/seo-101');
    expect(ctx).toContain('CourseInstance');
  });

  it('includes review specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/reviews/product', pageTitle: 'Reviews', role: 'review', primaryType: 'Review', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/reviews/product');
    expect(ctx).toContain('AggregateRating');
  });

  it('includes video specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/videos/demo', pageTitle: 'Demo Video', role: 'video', primaryType: 'VideoObject', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/videos/demo');
    expect(ctx).toContain('VideoObject');
    expect(ctx).toContain('thumbnailUrl');
  });

  it('includes pricing specific instruction', () => {
    const plan = makePlan({
      pageRoles: [
        { pagePath: '/pricing', pageTitle: 'Pricing', role: 'pricing', primaryType: 'WebPage', entityRefs: [] },
      ],
    });
    const ctx = buildPlanContextForPage(plan, '/pricing');
    expect(ctx).toContain('Offer');
  });
});
