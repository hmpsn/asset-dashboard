/**
 * Pure-logic unit tests for server/schema-queue.ts
 *
 * Tests focus on:
 *  - generateSchemaSkeleton: WebPage + BreadcrumbList + Organization always present,
 *    primaryType node generation per schema type, URL normalisation,
 *    cell.expectedSchemaTypes override, cell.targetKeyword propagation,
 *    mainEntity link when primaryType present
 */

import { describe, it, expect, vi } from 'vitest';
import type { MatrixCell, ContentTemplate } from '../../shared/types/content.js';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));
vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) },
}));
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));
vi.mock('../../server/content-matrices.js', () => ({
  getMatrix: vi.fn(() => null),
  getSchemaTypesForTemplate: vi.fn((pageType: string) => {
    const map: Record<string, string[]> = {
      blog: ['BlogPosting', 'BreadcrumbList'],
      service: ['Service', 'BreadcrumbList'],
      faq: ['FAQPage', 'BreadcrumbList'],
      product: ['Product', 'BreadcrumbList'],
    };
    return map[pageType] ?? ['WebPage', 'BreadcrumbList'];
  }),
}));
vi.mock('../../server/workspaces.js', () => ({ getWorkspace: vi.fn(() => null) }));

import { generateSchemaSkeleton } from '../../server/schema-queue.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    id: 'cell_01',
    variableValues: { service: 'SEO Audit', location: 'Austin' },
    targetKeyword: 'SEO audit Austin',
    plannedUrl: 'services/seo-audit-austin',
    status: 'planned',
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<ContentTemplate> = {}): ContentTemplate {
  return {
    id: 'tpl_01',
    workspaceId: 'ws_01',
    name: 'Service Page',
    pageType: 'service',
    variables: [],
    sections: [],
    urlPattern: 'services/{service}-{location}',
    keywordPattern: '{service} {location}',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const SITE_URL = 'https://acme.com';

// ── Base graph structure ───────────────────────────────────────────────────

describe('generateSchemaSkeleton — base structure', () => {
  it('returns an object with @context and @graph', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    expect(skeleton['@context']).toBe('https://schema.org');
    expect(Array.isArray(skeleton['@graph'])).toBe(true);
  });

  it('@graph always contains a WebPage node', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    expect(graph.some(n => n['@type'] === 'WebPage')).toBe(true);
  });

  it('@graph always contains a BreadcrumbList node', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    expect(graph.some(n => n['@type'] === 'BreadcrumbList')).toBe(true);
  });

  it('@graph always contains an Organization node', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    expect(graph.some(n => n['@type'] === 'Organization')).toBe(true);
  });

  it('WebPage node contains the page url', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const webPage = graph.find(n => n['@type'] === 'WebPage')!;
    expect(typeof webPage['url']).toBe('string');
    expect(String(webPage['url'])).toContain('acme.com');
  });

  it('BreadcrumbList has Home as position 1', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const crumbs = graph.find(n => n['@type'] === 'BreadcrumbList') as Record<string, unknown>;
    const items = crumbs['itemListElement'] as Record<string, unknown>[];
    expect(items[0]['position']).toBe(1);
    expect(items[0]['name']).toBe('Home');
    expect(items[0]['item']).toBe(SITE_URL);
  });

  it('BreadcrumbList position 2 uses targetKeyword as name', () => {
    const cell = makeCell({ targetKeyword: 'Custom Keyword' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const crumbs = graph.find(n => n['@type'] === 'BreadcrumbList') as Record<string, unknown>;
    const items = crumbs['itemListElement'] as Record<string, unknown>[];
    expect(items[1]['name']).toBe('Custom Keyword');
  });

  it('Organization node references siteUrl', () => {
    const skeleton = generateSchemaSkeleton(makeCell(), makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const org = graph.find(n => n['@type'] === 'Organization')!;
    expect(org['url']).toBe(SITE_URL);
  });
});

// ── URL normalisation ──────────────────────────────────────────────────────

describe('generateSchemaSkeleton — URL normalisation', () => {
  it('prepends siteUrl when plannedUrl is relative (no leading slash)', () => {
    const cell = makeCell({ plannedUrl: 'services/seo' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const webPage = graph.find(n => n['@type'] === 'WebPage')!;
    expect(String(webPage['url'])).toBe(`${SITE_URL}/services/seo`);
  });

  it('prepends siteUrl when plannedUrl starts with /', () => {
    const cell = makeCell({ plannedUrl: '/services/seo' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const webPage = graph.find(n => n['@type'] === 'WebPage')!;
    // Should not double-slash
    expect(String(webPage['url'])).not.toContain('//services');
    expect(String(webPage['url'])).toContain('acme.com');
  });

  it('uses plannedUrl as-is when it is already an absolute URL', () => {
    const cell = makeCell({ plannedUrl: 'https://other.com/page' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const webPage = graph.find(n => n['@type'] === 'WebPage')!;
    expect(String(webPage['url'])).toBe('https://other.com/page');
  });
});

// ── Primary type nodes ─────────────────────────────────────────────────────

describe('generateSchemaSkeleton — primaryType from expectedSchemaTypes', () => {
  it('adds Service node when expectedSchemaTypes includes Service', () => {
    const cell = makeCell({ expectedSchemaTypes: ['Service'] });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    expect(graph.some(n => n['@type'] === 'Service')).toBe(true);
  });

  it('Service node uses targetKeyword as name', () => {
    const cell = makeCell({ expectedSchemaTypes: ['Service'], targetKeyword: 'HVAC Repair Austin' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const svc = graph.find(n => n['@type'] === 'Service')!;
    expect(svc['name']).toBe('HVAC Repair Austin');
  });

  it('Service node has provider reference to organization', () => {
    const cell = makeCell({ expectedSchemaTypes: ['Service'] });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const svc = graph.find(n => n['@type'] === 'Service') as Record<string, unknown>;
    expect((svc['provider'] as Record<string, unknown>)['@id']).toBe(`${SITE_URL}/#organization`);
  });

  it('adds BlogPosting node and sets headline', () => {
    const cell = makeCell({ expectedSchemaTypes: ['BlogPosting'], targetKeyword: 'Top 10 SEO Tips' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate({ pageType: 'blog' }), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const post = graph.find(n => n['@type'] === 'BlogPosting') as Record<string, unknown>;
    expect(post).toBeDefined();
    expect(post['headline']).toBe('Top 10 SEO Tips');
    expect((post['publisher'] as Record<string, unknown>)['@id']).toBe(`${SITE_URL}/#organization`);
  });

  it('adds Product node with name', () => {
    const cell = makeCell({ expectedSchemaTypes: ['Product'], targetKeyword: 'Enterprise Plan' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate({ pageType: 'product' }), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const product = graph.find(n => n['@type'] === 'Product')!;
    expect(product['name']).toBe('Enterprise Plan');
  });

  it('adds FAQPage node with name', () => {
    const cell = makeCell({ expectedSchemaTypes: ['FAQPage'], targetKeyword: 'Common Questions' });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate({ pageType: 'faq' }), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const faq = graph.find(n => n['@type'] === 'FAQPage')!;
    expect(faq['name']).toBe('Common Questions');
  });

  it('links WebPage.mainEntity to the primary type @id', () => {
    const cell = makeCell({ expectedSchemaTypes: ['Service'] });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const webPage = graph.find(n => n['@type'] === 'WebPage') as Record<string, unknown>;
    const svc = graph.find(n => n['@type'] === 'Service') as Record<string, unknown>;
    expect((webPage['mainEntity'] as Record<string, unknown>)['@id']).toBe(svc['@id']);
  });

  it('does not add mainEntity when there is no primaryType', () => {
    // All types are excluded from being primaryType: WebPage, BreadcrumbList, Organization, WebSite
    const cell = makeCell({ expectedSchemaTypes: ['WebPage', 'BreadcrumbList', 'Organization'] });
    const skeleton = generateSchemaSkeleton(cell, makeTemplate(), SITE_URL);
    const graph = skeleton['@graph'] as Record<string, unknown>[];
    const webPage = graph.find(n => n['@type'] === 'WebPage') as Record<string, unknown>;
    expect(webPage['mainEntity']).toBeUndefined();
  });
});
