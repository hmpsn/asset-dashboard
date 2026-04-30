/**
 * Integration test: lean schema generator end-to-end for each page kind.
 * Uses synthetic page meta + HTML; no DB or HTTP server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import db from '../../server/db/index.js';

vi.mock('../../server/ai.js', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: 'A clean description.',
    tokens: { prompt: 100, completion: 20, total: 120 },
  }),
}));

import { generateLeanSchema } from '../../server/schema/generator.js';
import { callAI } from '../../server/ai.js';

const baseInput = {
  pageId: 'p1',
  pageMeta: { title: 'X', slug: 'x', publishedPath: '/x', seo: { description: 'desc' } },
  html: '<html><body>Body content for the page.</body></html>',
  baseUrl: 'https://example.com',
  workspace: { name: 'Acme', publisherLogoUrl: null, businessProfile: null, defaultLocale: 'en' },
};

describe('generateLeanSchema', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
  });

  it('produces a SchemaPageSuggestion with one suggestion entry', async () => {
    const out = await generateLeanSchema(baseInput);
    expect(out.pageId).toBe('p1');
    expect(out.suggestedSchemas).toHaveLength(1);
    expect(out.suggestedSchemas[0].priority).toBe('high');
  });

  it('classifies blog posts as BlogPosting', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/my-post' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0]['@type']).toBe('BlogPosting');
  });

  it('classifies case studies as Article (not Service)', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/our-work/expero' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0]['@type']).toBe('Article');
  });

  it('emits Organization + WebSite for the homepage', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { title: 'Home', slug: '', publishedPath: '/', seo: undefined },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    const types = graph.map(n => n['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('produces validationErrors=undefined on clean output', async () => {
    const out = await generateLeanSchema(baseInput);
    expect(out.validationErrors).toBeUndefined();
  });

  it('emits exactly 2 nodes (primary + breadcrumb) for non-homepage pages', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as unknown[]);
    expect(graph.length).toBe(2);
  });

  it('never emits duplicate WebPage nodes (the bug we are fixing)', async () => {
    const paths = ['/services/design', '/our-work/expero', '/blog/my-post', '/about', '/'];
    for (const p of paths) {
      const out = await generateLeanSchema({
        ...baseInput,
        pageMeta: { ...baseInput.pageMeta, publishedPath: p },
      });
      const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
      const webPageCount = graph.filter(n => n['@type'] === 'WebPage').length;
      expect(webPageCount, `${p} should not have multiple WebPage nodes`).toBeLessThanOrEqual(1);
    }
  });

  it('strips trailing slash from baseUrl to prevent //path canonical URLs', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      baseUrl: 'https://example.com/',  // trailing slash
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/about' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    const node = graph[0];
    // @id and url must not have double-slash after the domain (i.e., no //path)
    const idStr = String(node['@id'] ?? '');
    expect(idStr.replace(/^https?:\/\//, '')).not.toContain('//');
    expect(out.url).not.toContain('//about');  // single slash only
    expect(out.url).toBe('https://example.com/about');
  });

  it('appends FAQPage when page HTML contains accordion patterns', async () => {
    const htmlWithFaq = `<html><body>
      <details><summary>What is your turnaround time?</summary><p>Two weeks.</p></details>
      <details><summary>Do you offer refunds?</summary><p>Yes, within 30 days.</p></details>
    </body></html>`;
    const out = await generateLeanSchema({
      ...baseInput,
      html: htmlWithFaq,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const faqNode = graph.find(n => n['@type'] === 'FAQPage');
    expect(faqNode).toBeDefined();
    expect((faqNode!.mainEntity as unknown[])).toHaveLength(2);
  });

  it('appends FAQPage on a BlogPosting even when base schema has pre-existing validation errors (FAQ rollback uses error-diff, not absolute count)', async () => {
    // BlogPosting REQUIRES datePublished. This HTML deliberately omits the
    // <time itemprop="datePublished"> microformat AND no CMS dates are passed,
    // so the base BlogPosting schema will have a 'missing datePublished' error.
    // Pre-fix, the FAQ append would see post-validation errors > 0 and roll
    // back the (perfectly valid) FAQPage. Post-fix, the rollback only fires
    // when FAQ-introduced errors appear — base errors don't count.
    const htmlNoDateWithFaq = `<html><body>
      <p>Body content</p>
      <details><summary>What did you do?</summary><p>We launched.</p></details>
      <details><summary>Why?</summary><p>Demand was strong.</p></details>
    </body></html>`;
    const out = await generateLeanSchema({
      ...baseInput,
      html: htmlNoDateWithFaq,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/launch-faq', seo: { description: 'desc' } },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map(n => n['@type']);
    expect(types).toContain('BlogPosting');
    expect(types).toContain('FAQPage');  // The bug-fix: FAQPage survives even with base errors
    const faqNode = graph.find(n => n['@type'] === 'FAQPage');
    expect((faqNode!.mainEntity as unknown[])).toHaveLength(2);
    // The surfaced validation errors should still include the base error so admins see it.
    expect(out.validationFindings).toBeDefined();
    expect(out.validationFindings!.some(f => f.field === 'datePublished')).toBe(true);
  });

  it('does NOT append FAQPage when accordion has fewer than 2 pairs', async () => {
    const htmlWithOneFaq = `<html><body>
      <details><summary>Single Q</summary><p>Single A</p></details>
    </body></html>`;
    const out = await generateLeanSchema({
      ...baseInput,
      html: htmlWithOneFaq,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'FAQPage')).toBeUndefined();
  });
});

describe('generateLeanSchema: per-kind primary @type', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
  });

  const cases = [
    { path: '/', expectedFirstType: 'Organization', kind: 'Homepage' },
    { path: '/blog/my-post', expectedFirstType: 'BlogPosting', kind: 'BlogPosting' },
    { path: '/blog', expectedFirstType: 'CollectionPage', kind: 'BlogIndex' },
    { path: '/services/web-design', expectedFirstType: 'Service', kind: 'Service' },
    { path: '/services', expectedFirstType: 'CollectionPage', kind: 'ServiceIndex' },
    { path: '/our-work/expero', expectedFirstType: 'Article', kind: 'CaseStudy' },
    { path: '/our-work', expectedFirstType: 'CollectionPage', kind: 'CaseStudyIndex' },
    { path: '/about', expectedFirstType: 'AboutPage', kind: 'AboutPage' },
    { path: '/contact', expectedFirstType: 'ContactPage', kind: 'ContactPage' },
    { path: '/privacy-policy', expectedFirstType: 'WebPage', kind: 'Legal' },
    { path: '/random/deep/path', expectedFirstType: 'WebPage', kind: 'WebPage (fallback)' },
  ];

  it.each(cases)('emits $expectedFirstType for $kind ($path)', async ({ path, expectedFirstType }) => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: path },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    expect(graph[0]['@type']).toBe(expectedFirstType);
  });

  it('emits LocalBusiness as second graph node when workspace has business profile address', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/' },
      workspace: {
        name: 'Acme',
        publisherLogoUrl: null,
        businessProfile: {
          phone: '+1-555-0100',
          email: 'hi@acme.com',
          address: { street: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
          socialProfiles: [],
          openingHours: 'Mo-Fr 09:00-17:00',
        },
        defaultLocale: 'en',
      },
    });
    const graph = out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map(n => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('LocalBusiness');
  });
});

describe('paid-grade output (Pillar 2)', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
  });

  it('strips brand suffix from name and breadcrumb leaf', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, title: 'Privacy Policy | Acme', publishedPath: '/privacy-policy' },
      workspace: { ...baseInput.workspace, name: 'Acme', defaultLocale: 'en' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    expect(graph[0].name).toBe('Privacy Policy');
    const bc = graph.find(n => n['@type'] === 'BreadcrumbList');
    const items = bc?.itemListElement as Array<Record<string, unknown>>;
    expect(items[items.length - 1].name).toBe('Privacy Policy');
  });

  it('emits isPartOf, breadcrumb, inLanguage on the primary node', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, publishedPath: '/services/design' },
      workspace: { ...baseInput.workspace, defaultLocale: 'en' },
    });
    const node = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.isPartOf).toEqual({ '@id': 'https://example.com/#website' });
    expect(node.breadcrumb).toEqual({ '@id': 'https://example.com/services/design#breadcrumb' });
    expect(node.inLanguage).toBe('en');
  });

  it('CMS Article gets datePublished + author from cmsFieldData', async () => {
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: {
        ...baseInput.pageMeta,
        publishedPath: '/blog/my-post',
        cmsFieldData: { 'published-on': '2026-01-15T00:00:00Z', 'author-name': 'Jane Doe' },
      },
      workspace: { ...baseInput.workspace, defaultLocale: 'en' },
    });
    const node = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node['@type']).toBe('BlogPosting');
    expect(node.datePublished).toBe('2026-01-15T00:00:00Z');
    expect(node.author).toEqual({ '@type': 'Person', 'name': 'Jane Doe' });
  });

  it('homepage WebSite does NOT emit potentialAction (no site-search guarantee)', async () => {
    // Pillar 2.1: SearchAction would misrepresent capability when site has no
    // search endpoint. Re-add behind a workspace flag in schema-yoast-parity-fields.
    const out = await generateLeanSchema({
      ...baseInput,
      pageMeta: { title: 'Home', slug: '', publishedPath: '/', seo: undefined },
      workspace: { ...baseInput.workspace, defaultLocale: 'en' },
    });
    const graph = (out.suggestedSchemas[0].template['@graph'] as Array<Record<string, unknown>>);
    const website = graph.find(n => n['@type'] === 'WebSite');
    expect(website?.potentialAction).toBeUndefined();
    expect(website?.inLanguage).toBe('en');
  });
});

// Fixture helpers for page-element enrichment tests.
// Paths are relative to this test file: tests/integration/ → tests/fixtures/page-elements/
function fixturePageElementsHtml(name: string): string {
  return readFileSync(join(__dirname, `../fixtures/page-elements/${name}`), 'utf-8');
}

// Unique workspace IDs per test so page_elements writes don't collide across tests.
const PE_WS_IDS = {
  video: 'ws_test_pe_video',
  howto: 'ws_test_pe_howto',
  citation: 'ws_test_pe_citation',
  noElements: 'ws_test_pe_none',
  mixed: 'ws_test_pe_mixed',
  cacheHit: 'ws_test_pe_cache_hit',
  refresh: 'ws_test_pe_refresh',
  nullToSet: 'ws_test_pe_null_to_set',
};

describe('lean schema generator — page-element enrichment (PR1)', () => {
  beforeEach(() => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({
      text: 'A clean description.',
      tokens: { prompt: 100, completion: 20, total: 120 },
    });
    // Seed workspace rows so the FK on page_elements.workspace_id holds. Without
    // this, upsertPageElements throws SQLITE_CONSTRAINT_FOREIGNKEY and the
    // generator's catch silently falls back to in-memory enrichment — the tests
    // would still pass for emission shape but would not exercise the persistence
    // path. Seeding lets cache-hit / staleness tests verify real DB behavior.
    for (const wsId of Object.values(PE_WS_IDS)) {
      db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
        VALUES (?, ?, ?, ?)
      `).run(wsId, `Test PE WS ${wsId}`, wsId, new Date().toISOString());
      db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
    }
  });

  it('emits VideoObject in @graph when HTML contains a YouTube embed', async () => {
    const html = fixturePageElementsHtml('webflow-blog-with-youtube.html');
    const out = await generateLeanSchema({
      ...baseInput,
      pageId: 'pe-video-test',
      pageMeta: {
        title: 'Blog Post with YouTube',
        slug: 'how-web-vitals-affect-seo',
        publishedPath: '/blog/how-web-vitals-affect-seo',
        seo: { description: 'A blog post about web vitals and YouTube.' },
        sourcePublishedAt: null,
        // VideoObject pre-emission gate requires datePublished — supplied via lastPublished fallback in extractPageData.
        lastPublished: '2026-04-15T00:00:00Z',
      },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: PE_WS_IDS.video },
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const video = graph.find(n => n['@type'] === 'VideoObject');
    expect(video).toBeDefined();
    expect(video!.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0');
  });

  it('emits HowTo in @graph when HTML contains a how-to ordered list', async () => {
    const html = fixturePageElementsHtml('webflow-blog-howto.html');
    const out = await generateLeanSchema({
      ...baseInput,
      pageId: 'pe-howto-test',
      pageMeta: {
        title: 'How to Bake Sourdough',
        slug: 'how-to-bake-sourdough',
        publishedPath: '/blog/how-to-bake-sourdough',
        seo: { description: 'Learn how to bake sourdough in 5 steps.' },
        sourcePublishedAt: null,
      },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: PE_WS_IDS.howto },
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const howTo = graph.find(n => n['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect((howTo!.step as Array<Record<string, unknown>>)).toHaveLength(5);
  });

  it('emits Article.citation[] when HTML contains outbound external links', async () => {
    const html = fixturePageElementsHtml('webflow-blog-with-citations.html');
    const out = await generateLeanSchema({
      ...baseInput,
      pageId: 'pe-citation-test',
      pageMeta: {
        title: 'The state of Core Web Vitals in 2026',
        slug: 'core-web-vitals-2026',
        publishedPath: '/blog/core-web-vitals-2026',
        seo: { description: 'A survey of CWV metrics in 2026.' },
        sourcePublishedAt: null,
      },
      html,
      baseUrl: 'https://www.hmpsn.studio',
      workspace: { ...baseInput.workspace, id: PE_WS_IDS.citation },
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    const primary = graph[0];
    const citations = primary.citation as Array<Record<string, unknown>>;
    expect(citations).toHaveLength(2);
    expect(citations[0].url).toBe('https://web.dev/articles/vitals');
  });

  it('falls back to no-enrichment schema when HTML has no detectable elements', async () => {
    const html = fixturePageElementsHtml('webflow-no-elements.html');
    const out = await generateLeanSchema({
      ...baseInput,
      pageId: 'pe-none-test',
      pageMeta: {
        title: 'Plain Page',
        slug: 'plain-page',
        publishedPath: '/blog/plain-page',
        seo: { description: 'A plain page with no structured elements.' },
        sourcePublishedAt: null,
      },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: PE_WS_IDS.noElements },
    });
    const tpl = out.suggestedSchemas[0].template as Record<string, unknown>;
    const graph = tpl['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find(n => n['@type'] === 'VideoObject')).toBeUndefined();
    expect(graph.find(n => n['@type'] === 'HowTo')).toBeUndefined();
    expect(graph[0].citation).toBeUndefined();
  });

  it('emits Article + BreadcrumbList + VideoObject + HowTo + citations all in the same @graph with unique @ids', async () => {
    const html = fixturePageElementsHtml('webflow-mixed-elements.html');
    const wsId = PE_WS_IDS.mixed;
    const out = await generateLeanSchema({
      ...baseInput,
      pageId: 'pe-mixed-test',
      pageMeta: {
        title: 'How to set up Webflow + GSC',
        slug: 'webflow-gsc-setup',
        publishedPath: '/blog/webflow-gsc-setup',
        seo: { description: 'Combined video + how-to + citation example.' },
        sourcePublishedAt: null,
        // datePublished required for VideoObject pre-emission gate.
        lastPublished: '2026-04-15T00:00:00Z',
      },
      html,
      baseUrl: 'https://www.example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const graph = (out.suggestedSchemas[0].template as Record<string, unknown>)['@graph'] as Array<Record<string, unknown>>;
    const types = graph.map(n => n['@type']);
    expect(types).toEqual(expect.arrayContaining(['BlogPosting', 'BreadcrumbList', 'VideoObject', 'HowTo']));
    const ids = graph.map(n => n['@id']).filter(Boolean) as string[];
    expect(new Set(ids).size).toBe(ids.length); // unique
    const primary = graph.find(n => n['@type'] === 'BlogPosting')!;
    expect(primary.citation).toBeDefined();
    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
  });

  it('cache hit: second call with same sourcePublishedAt re-uses stored catalog (no re-extraction)', async () => {
    // Use a fixture that produces a deterministic, non-empty catalog.
    const html = fixturePageElementsHtml('webflow-blog-with-youtube.html');
    const wsId = PE_WS_IDS.cacheHit;
    const baseMeta = {
      title: 'Cache hit test',
      slug: 'cache-hit',
      publishedPath: '/blog/cache-hit',
      seo: { description: 'desc' },
      sourcePublishedAt: '2026-04-01T00:00:00Z',
    };

    await generateLeanSchema({
      ...baseInput,
      pageId: 'cache-1',
      pageMeta: baseMeta,
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const row1 = db.prepare('SELECT updated_at FROM page_elements WHERE workspace_id = ? AND page_path = ?').get(wsId, '/blog/cache-hit') as { updated_at: string };
    expect(row1).toBeDefined();
    const firstExtractedAt = row1.updated_at;

    // Second call with the SAME sourcePublishedAt should not refresh the row.
    await generateLeanSchema({
      ...baseInput,
      pageId: 'cache-2',
      pageMeta: baseMeta,
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const row2 = db.prepare('SELECT updated_at FROM page_elements WHERE workspace_id = ? AND page_path = ?').get(wsId, '/blog/cache-hit') as { updated_at: string };
    expect(row2.updated_at).toBe(firstExtractedAt); // same row, untouched

    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
  });

  it('staleness: third call with NEWER sourcePublishedAt triggers re-extraction', async () => {
    const html = fixturePageElementsHtml('webflow-blog-with-youtube.html');
    const wsId = PE_WS_IDS.refresh;
    const baseMeta = {
      title: 'Refresh test',
      slug: 'refresh',
      publishedPath: '/blog/refresh',
      seo: { description: 'desc' },
    };

    await generateLeanSchema({
      ...baseInput,
      pageId: 'r1',
      pageMeta: { ...baseMeta, sourcePublishedAt: '2026-04-01T00:00:00Z' },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const row1 = db.prepare('SELECT updated_at, source_published_at FROM page_elements WHERE workspace_id = ? AND page_path = ?').get(wsId, '/blog/refresh') as { updated_at: string; source_published_at: string };
    expect(row1.source_published_at).toBe('2026-04-01T00:00:00Z');

    // Wait one millisecond so a fresh ISO timestamp differs.
    await new Promise(r => setTimeout(r, 5));

    await generateLeanSchema({
      ...baseInput,
      pageId: 'r2',
      pageMeta: { ...baseMeta, sourcePublishedAt: '2026-05-01T00:00:00Z' },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const row2 = db.prepare('SELECT updated_at, source_published_at FROM page_elements WHERE workspace_id = ? AND page_path = ?').get(wsId, '/blog/refresh') as { updated_at: string; source_published_at: string };
    expect(row2.source_published_at).toBe('2026-05-01T00:00:00Z');
    expect(row2.updated_at).not.toBe(row1.updated_at); // re-extracted

    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
  });

  it('staleness: stored.sourcePublishedAt=null + input.sourcePublishedAt=set triggers re-extraction (CMS migration scenario)', async () => {
    const html = fixturePageElementsHtml('webflow-blog-with-youtube.html');
    const wsId = PE_WS_IDS.nullToSet;
    const baseMeta = {
      title: 'Null→set test',
      slug: 'null-to-set',
      publishedPath: '/blog/null-to-set',
      seo: { description: 'desc' },
    };

    // First call: stored will have sourcePublishedAt=null (static page).
    await generateLeanSchema({
      ...baseInput,
      pageId: 'n1',
      pageMeta: { ...baseMeta, sourcePublishedAt: null },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const row1 = db.prepare('SELECT updated_at, source_published_at FROM page_elements WHERE workspace_id = ? AND page_path = ?').get(wsId, '/blog/null-to-set') as { updated_at: string; source_published_at: string | null };
    expect(row1.source_published_at).toBeNull();

    await new Promise(r => setTimeout(r, 5));

    // Second call: page now has a published-at timestamp (CMS conversion).
    // Pre-fix this would have NEVER refreshed, freezing the catalog forever.
    await generateLeanSchema({
      ...baseInput,
      pageId: 'n2',
      pageMeta: { ...baseMeta, sourcePublishedAt: '2026-05-01T00:00:00Z' },
      html,
      baseUrl: 'https://example.com',
      workspace: { ...baseInput.workspace, id: wsId },
    });
    const row2 = db.prepare('SELECT updated_at, source_published_at FROM page_elements WHERE workspace_id = ? AND page_path = ?').get(wsId, '/blog/null-to-set') as { updated_at: string; source_published_at: string };
    expect(row2.source_published_at).toBe('2026-05-01T00:00:00Z');
    expect(row2.updated_at).not.toBe(row1.updated_at);

    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run(wsId);
  });
});
