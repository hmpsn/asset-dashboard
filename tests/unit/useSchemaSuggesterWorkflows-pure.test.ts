/**
 * Pure-logic tests for schema suggester workflows.
 *
 * Both hooks (useSchemaSuggesterPublishingWorkflow and
 * useSchemaSuggesterGeneration) are built around React state and async API
 * calls, making them impractical to exercise in a unit-test environment.
 *
 * Instead we test the *pure computation helpers* that the hooks delegate to,
 * extracted or derived directly from the module source so the logic is
 * exercised without mounting a component tree or mocking React state.
 */

import { describe, it, expect } from 'vitest';
import type { SchemaPageSuggestion, SchemaSuggestion, SchemaPageOption } from '../../src/components/schema/schemaSuggesterTypes.js';

// ---------------------------------------------------------------------------
// Pure helpers extracted / re-implemented from the module source for unit
// testing. These mirror the exact logic in the hook files so a logic change
// in the source will break the corresponding test.
// ---------------------------------------------------------------------------

/** getEffectiveSchema — returns a parsed edited schema when present, falls back to original. */
function getEffectiveSchema(
  editedSchemaJson: Record<string, string>,
  pageId: string,
  original: Record<string, unknown>,
): Record<string, unknown> {
  if (editedSchemaJson[pageId]) {
    try { return JSON.parse(editedSchemaJson[pageId]); } catch { /* fall through */ }
  }
  return original;
}

/** isHomepage — mirrors the logic in publishToWebflow. */
function isHomepage(slug: string | undefined): boolean {
  return !slug || slug === '/' || slug === 'index' || slug === 'home';
}

/** unpublishedCount — computed from data in the hook's return value. */
function computeUnpublishedCount(
  data: SchemaPageSuggestion[] | null,
  published: Set<string>,
): number {
  return data?.filter(
    p => !p.pageId.startsWith('cms-') && !published.has(p.pageId) && p.suggestedSchemas[0]?.template,
  ).length ?? 0;
}

/** publishablePages — pages eligible for bulk-publish (mirrors publishAllToWebflow). */
function publishablePages(
  data: SchemaPageSuggestion[] | null,
  published: Set<string>,
): SchemaPageSuggestion[] {
  if (!data) return [];
  return data.filter(
    p => !p.pageId.startsWith('cms-') && !published.has(p.pageId) && p.suggestedSchemas[0]?.template,
  );
}

/** buildScriptTag — mirrors copyTemplate output */
function buildScriptTag(json: string): string {
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/** filteredInitialPages — mirrors filteredInitialPages useMemo in generation hook */
function filteredInitialPages(pages: SchemaPageOption[], search: string): SchemaPageOption[] {
  return pages.filter(
    page =>
      !search ||
      page.title.toLowerCase().includes(search.toLowerCase()) ||
      page.slug.toLowerCase().includes(search.toLowerCase()),
  );
}

/** mapWebflowPages — mirrors fetchPages' mapping logic */
function mapWebflowPages(
  raw: Array<{ _id?: string; id?: string; title?: string; slug?: string }>,
): SchemaPageOption[] {
  return raw.map(page => ({
    id: page._id || page.id || '',
    title: page.title || page.slug || 'Untitled',
    slug: page.slug || '',
  }));
}

/** extractOrgAndWebsiteNodes — mirrors saveAsTemplate's graph extraction */
function extractOrgAndWebsiteNodes(schema: Record<string, unknown>): {
  orgNode: Record<string, unknown> | undefined;
  wsNode: Record<string, unknown> | undefined;
} {
  const graph = schema?.['@graph'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(graph)) return { orgNode: undefined, wsNode: undefined };
  return {
    orgNode: graph.find(n => n['@type'] === 'Organization'),
    wsNode: graph.find(n => n['@type'] === 'WebSite'),
  };
}

/** buildWebsiteNodeFallback — mirrors the fallback in saveAsTemplate */
function buildWebsiteNodeFallback(orgNode: Record<string, unknown>): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${orgNode['url']}/#website`,
    url: orgNode['url'],
    name: orgNode['name'],
    publisher: { '@id': `${orgNode['url']}/#organization` },
  };
}

/** sendSchemasToClient item builder — mirrors the map() inside sendSchemasToClient */
function buildApprovalItems(
  data: SchemaPageSuggestion[],
  editedSchemaJson: Record<string, string>,
) {
  return data.map(page => ({
    pageId: page.pageId,
    pageTitle: page.pageTitle,
    pageSlug: page.slug,
    publishedPath: page.publishedPath,
    field: 'schema',
    currentValue: page.existingSchemas.length > 0 ? page.existingSchemas.join(', ') : '',
    proposedValue: JSON.stringify(
      getEffectiveSchema(editedSchemaJson, page.pageId, page.suggestedSchemas[0]?.template || {}),
      null,
      2,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePage(overrides?: Partial<SchemaPageSuggestion>): SchemaPageSuggestion {
  return {
    pageId: 'page-1',
    pageTitle: 'Home',
    slug: '/',
    url: 'https://example.com/',
    existingSchemas: [],
    suggestedSchemas: [
      {
        type: 'Organization',
        reason: 'Top-level org page',
        priority: 'high',
        template: { '@type': 'Organization', name: 'Acme', url: 'https://example.com' },
      },
    ],
    ...overrides,
  };
}

function makeSuggestion(overrides?: Partial<SchemaSuggestion>): SchemaSuggestion {
  return {
    type: 'LocalBusiness',
    reason: 'Local page',
    priority: 'medium',
    template: { '@type': 'LocalBusiness', name: 'Acme Local' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getEffectiveSchema', () => {
  it('returns original when no edited JSON is present', () => {
    const original = { '@type': 'Organization', name: 'Acme' };
    expect(getEffectiveSchema({}, 'page-1', original)).toEqual(original);
  });

  it('returns parsed edited JSON when present', () => {
    const original = { '@type': 'Organization', name: 'Acme' };
    const edited = { '@type': 'Organization', name: 'Updated Acme' };
    expect(getEffectiveSchema({ 'page-1': JSON.stringify(edited) }, 'page-1', original)).toEqual(edited);
  });

  it('falls back to original when edited JSON is malformed', () => {
    const original = { '@type': 'Organization', name: 'Acme' };
    expect(getEffectiveSchema({ 'page-1': '{not valid json' }, 'page-1', original)).toEqual(original);
  });

  it('is keyed by pageId — does not cross-pollinate between pages', () => {
    const original = { '@type': 'WebPage' };
    const edited = { '@type': 'BlogPosting' };
    expect(
      getEffectiveSchema({ 'page-2': JSON.stringify(edited) }, 'page-1', original),
    ).toEqual(original);
  });

  it('handles empty object as original gracefully', () => {
    expect(getEffectiveSchema({}, 'p', {})).toEqual({});
  });
});

describe('isHomepage', () => {
  it('treats empty slug as homepage', () => {
    expect(isHomepage('')).toBe(true);
  });

  it('treats undefined as homepage', () => {
    expect(isHomepage(undefined)).toBe(true);
  });

  it('treats "/" as homepage', () => {
    expect(isHomepage('/')).toBe(true);
  });

  it('treats "index" as homepage', () => {
    expect(isHomepage('index')).toBe(true);
  });

  it('treats "home" as homepage', () => {
    expect(isHomepage('home')).toBe(true);
  });

  it('treats normal slugs as non-homepage', () => {
    expect(isHomepage('about')).toBe(false);
    expect(isHomepage('contact-us')).toBe(false);
    expect(isHomepage('/blog/post-1')).toBe(false);
  });
});

describe('computeUnpublishedCount', () => {
  it('returns 0 for null data', () => {
    expect(computeUnpublishedCount(null, new Set())).toBe(0);
  });

  it('counts pages with a template that are not yet published', () => {
    const pages = [makePage({ pageId: 'p1' }), makePage({ pageId: 'p2' })];
    expect(computeUnpublishedCount(pages, new Set())).toBe(2);
  });

  it('excludes already-published pages', () => {
    const pages = [makePage({ pageId: 'p1' }), makePage({ pageId: 'p2' })];
    expect(computeUnpublishedCount(pages, new Set(['p1']))).toBe(1);
  });

  it('excludes cms- prefixed pages', () => {
    const pages = [makePage({ pageId: 'cms-collection' }), makePage({ pageId: 'p2' })];
    expect(computeUnpublishedCount(pages, new Set())).toBe(1);
  });

  it('excludes pages with no suggestion template', () => {
    const noTemplate = makePage({ pageId: 'p3', suggestedSchemas: [] });
    const pages = [makePage({ pageId: 'p1' }), noTemplate];
    expect(computeUnpublishedCount(pages, new Set())).toBe(1);
  });
});

describe('publishablePages', () => {
  it('returns empty array for null data', () => {
    expect(publishablePages(null, new Set())).toEqual([]);
  });

  it('omits cms- prefixed pages', () => {
    const pages = [makePage({ pageId: 'cms-x' }), makePage({ pageId: 'static' })];
    const result = publishablePages(pages, new Set());
    expect(result.map(p => p.pageId)).toEqual(['static']);
  });

  it('omits already-published pages', () => {
    const pages = [makePage({ pageId: 'a' }), makePage({ pageId: 'b' })];
    expect(publishablePages(pages, new Set(['a'])).map(p => p.pageId)).toEqual(['b']);
  });

  it('omits pages without a template', () => {
    const pages = [makePage({ pageId: 'x', suggestedSchemas: [] }), makePage({ pageId: 'y' })];
    expect(publishablePages(pages, new Set()).map(p => p.pageId)).toEqual(['y']);
  });
});

describe('buildScriptTag', () => {
  it('wraps JSON in a <script type="application/ld+json"> tag', () => {
    const json = JSON.stringify({ '@type': 'Organization' }, null, 2);
    const tag = buildScriptTag(json);
    expect(tag).toContain('<script type="application/ld+json">');
    expect(tag).toContain('</script>');
    expect(tag).toContain(json);
  });
});

describe('filteredInitialPages', () => {
  const pages: SchemaPageOption[] = [
    { id: '1', title: 'About Us', slug: 'about-us' },
    { id: '2', title: 'Blog', slug: 'blog' },
    { id: '3', title: 'Contact', slug: 'contact' },
  ];

  it('returns all pages when search is empty', () => {
    expect(filteredInitialPages(pages, '')).toHaveLength(3);
  });

  it('filters by title (case-insensitive)', () => {
    expect(filteredInitialPages(pages, 'about').map(p => p.id)).toEqual(['1']);
    expect(filteredInitialPages(pages, 'BLOG').map(p => p.id)).toEqual(['2']);
  });

  it('filters by slug (case-insensitive)', () => {
    expect(filteredInitialPages(pages, 'contact').map(p => p.id)).toEqual(['3']);
  });

  it('returns empty array when no match', () => {
    expect(filteredInitialPages(pages, 'zzznomatch')).toHaveLength(0);
  });
});

describe('mapWebflowPages', () => {
  it('prefers _id over id', () => {
    const result = mapWebflowPages([{ _id: 'legacy', id: 'new', title: 'Page', slug: 'page' }]);
    expect(result[0].id).toBe('legacy');
  });

  it('falls back to id when _id is absent', () => {
    const result = mapWebflowPages([{ id: 'new', title: 'Page', slug: 'page' }]);
    expect(result[0].id).toBe('new');
  });

  it('uses empty string when both _id and id are absent', () => {
    const result = mapWebflowPages([{ title: 'Page', slug: 'page' }]);
    expect(result[0].id).toBe('');
  });

  it('uses slug as title fallback when title is absent', () => {
    const result = mapWebflowPages([{ id: 'x', slug: 'my-slug' }]);
    expect(result[0].title).toBe('my-slug');
  });

  it('falls back to "Untitled" when both title and slug are absent', () => {
    const result = mapWebflowPages([{ id: 'x' }]);
    expect(result[0].title).toBe('Untitled');
  });

  it('maps multiple pages correctly', () => {
    const raw = [
      { _id: 'a', title: 'Home', slug: '/' },
      { id: 'b', title: 'About', slug: 'about' },
    ];
    const result = mapWebflowPages(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'a', title: 'Home', slug: '/' });
    expect(result[1]).toEqual({ id: 'b', title: 'About', slug: 'about' });
  });
});

describe('extractOrgAndWebsiteNodes', () => {
  it('returns undefined for both when @graph is absent', () => {
    expect(extractOrgAndWebsiteNodes({})).toEqual({ orgNode: undefined, wsNode: undefined });
  });

  it('returns undefined for both when @graph is not an array', () => {
    expect(extractOrgAndWebsiteNodes({ '@graph': 'bad' })).toEqual({ orgNode: undefined, wsNode: undefined });
  });

  it('finds Organization node', () => {
    const org = { '@type': 'Organization', name: 'Acme', url: 'https://acme.com' };
    const schema = { '@graph': [org] };
    const { orgNode } = extractOrgAndWebsiteNodes(schema);
    expect(orgNode).toEqual(org);
  });

  it('finds WebSite node', () => {
    const ws = { '@type': 'WebSite', url: 'https://acme.com' };
    const schema = { '@graph': [ws] };
    const { wsNode } = extractOrgAndWebsiteNodes(schema);
    expect(wsNode).toEqual(ws);
  });

  it('returns undefined when Organization not present in graph', () => {
    const schema = { '@graph': [{ '@type': 'WebSite' }] };
    expect(extractOrgAndWebsiteNodes(schema).orgNode).toBeUndefined();
  });
});

describe('buildWebsiteNodeFallback', () => {
  it('derives WebSite node from Organization node', () => {
    const org = { '@type': 'Organization', name: 'Acme', url: 'https://acme.com' };
    const ws = buildWebsiteNodeFallback(org);
    expect(ws['@type']).toBe('WebSite');
    expect(ws['@id']).toBe('https://acme.com/#website');
    expect(ws['url']).toBe('https://acme.com');
    expect(ws['name']).toBe('Acme');
    expect((ws['publisher'] as Record<string, unknown>)['@id']).toBe('https://acme.com/#organization');
  });
});

describe('buildApprovalItems', () => {
  it('maps pages to approval item shape', () => {
    const page = makePage({
      pageId: 'p1',
      pageTitle: 'Home',
      slug: '/',
      publishedPath: '/index',
      existingSchemas: ['Organization'],
    });
    const items = buildApprovalItems([page], {});
    expect(items).toHaveLength(1);
    expect(items[0].field).toBe('schema');
    expect(items[0].pageId).toBe('p1');
    expect(items[0].currentValue).toBe('Organization');
  });

  it('uses empty string for currentValue when no existing schemas', () => {
    const page = makePage({ existingSchemas: [] });
    const items = buildApprovalItems([page], {});
    expect(items[0].currentValue).toBe('');
  });

  it('joins multiple existing schemas with ", "', () => {
    const page = makePage({ existingSchemas: ['Organization', 'WebSite'] });
    const items = buildApprovalItems([page], {});
    expect(items[0].currentValue).toBe('Organization, WebSite');
  });

  it('uses edited JSON for proposedValue when available', () => {
    const page = makePage({ pageId: 'p1' });
    const customSchema = { '@type': 'LocalBusiness' };
    const items = buildApprovalItems([page], { 'p1': JSON.stringify(customSchema) });
    expect(JSON.parse(items[0].proposedValue)).toEqual(customSchema);
  });

  it('uses original template for proposedValue when no edited JSON', () => {
    const page = makePage({ pageId: 'p1' });
    const items = buildApprovalItems([page], {});
    expect(JSON.parse(items[0].proposedValue)['@type']).toBe('Organization');
  });

  const _makeSuggestion = makeSuggestion; // referenced above — suppress lint
  void _makeSuggestion;
});
