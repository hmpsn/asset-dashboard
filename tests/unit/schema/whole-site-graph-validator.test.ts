import { describe, expect, it } from 'vitest';
import { validateWholeSiteSchemaGraph } from '../../../server/schema/whole-site-graph-validator.js';
import type { SchemaPageSuggestion } from '../../../server/schema-suggester.js';
import type { SchemaSitePlan } from '../../../shared/types/schema-plan.js';

const baseUrl = 'https://example.com';

function page(path: string, schema: Record<string, unknown>, pageId = `page-${path.replace(/\W+/g, '-')}`): SchemaPageSuggestion {
  return {
    pageId,
    pageTitle: path === '/' ? 'Home' : path,
    slug: path,
    url: `${baseUrl}${path === '/' ? '' : path}`,
    existingSchemas: [],
    suggestedSchemas: [{
      type: 'WebPage',
      reason: 'Test schema.',
      priority: 'medium',
      template: schema,
    }],
  };
}

function graph(nodes: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes,
  };
}

const siteTemplate = {
  siteId: 'site-test',
  workspaceId: 'ws-test',
  organizationNode: {
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    name: 'Example Co',
    url: baseUrl,
  },
  websiteNode: {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    name: 'Example Co',
    url: baseUrl,
    publisher: { '@id': `${baseUrl}/#organization` },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('validateWholeSiteSchemaGraph', () => {
  it('accepts a coherent page graph with sitewide references resolved by the site template', () => {
    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      pages: [page('/services/seo', graph([
        {
          '@type': 'Service',
          '@id': `${baseUrl}/services/seo#service`,
          name: 'SEO',
          url: `${baseUrl}/services/seo`,
          provider: { '@id': `${baseUrl}/#organization` },
        },
        {
          '@type': 'BreadcrumbList',
          '@id': `${baseUrl}/services/seo#breadcrumb`,
          itemListElement: [],
        },
      ]))],
    });

    expect(result.status).toBe('valid');
    expect(result.findings).toEqual([]);
    expect(result.nodeCount).toBe(4);
    expect(result.referenceCount).toBe(2);
  });

  it('reports dangling @id references across the whole site graph', () => {
    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      pages: [page('/services/seo', graph([
        {
          '@type': 'Service',
          '@id': `${baseUrl}/services/seo#service`,
          name: 'SEO',
          url: `${baseUrl}/services/seo`,
          provider: { '@id': `${baseUrl}/#missing-organization` },
        },
      ]))],
    });

    expect(result.status).toBe('errors');
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      ruleId: 'schema-graph-dangling-reference',
      targetId: `${baseUrl}/#missing-organization`,
      pagePath: '/services/seo',
    }));
  });

  it('reports conflicting values for the same canonical node id', () => {
    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      pages: [page('/contact', graph([
        {
          '@type': 'Organization',
          '@id': `${baseUrl}/#organization`,
          name: 'Different Co',
          url: baseUrl,
        },
      ]))],
    });

    expect(result.status).toBe('errors');
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      ruleId: 'schema-graph-conflicting-node',
      field: 'name',
      sourceId: `${baseUrl}/#organization`,
    }));
  });

  it('reports active schema plan role and primary type mismatches without inventing a second plan', () => {
    const activePlan: SchemaSitePlan = {
      id: 'plan-test',
      siteId: 'site-test',
      workspaceId: 'ws-test',
      siteUrl: baseUrl,
      canonicalEntities: [{
        type: 'Service',
        name: 'SEO',
        canonicalUrl: `${baseUrl}/services/seo`,
        id: `${baseUrl}/services/seo#service`,
      }],
      pageRoles: [{
        pagePath: '/services/seo',
        pageTitle: 'SEO',
        role: 'service',
        primaryType: 'Service',
        entityRefs: [],
      }],
      status: 'active',
      generatedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const servicePage = page('/services/seo', graph([
      {
        '@type': 'Article',
        '@id': `${baseUrl}/services/seo#article`,
        headline: 'SEO',
        url: `${baseUrl}/services/seo`,
        isPartOf: { '@id': `${baseUrl}/#website` },
      },
    ]));
    servicePage.generationDiagnostics = {
      plannedRole: 'blog',
      effectiveRole: 'blog',
      roleSource: 'auto-detect',
      emittedTypes: ['Article'],
      skippedSchemaTypes: [],
      richResultsEligibility: [],
      validationStatus: 'valid',
    };

    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      activePlan,
      pages: [servicePage],
    });

    expect(result.status).toBe('errors');
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        ruleId: 'schema-graph-planned-entity-missing',
        targetId: `${baseUrl}/services/seo#service`,
      }),
      expect.objectContaining({
        severity: 'warning',
        ruleId: 'schema-graph-plan-role-mismatch',
        pagePath: '/services/seo',
      }),
      expect.objectContaining({
        severity: 'warning',
        ruleId: 'schema-graph-plan-primary-type-mismatch',
        pagePath: '/services/seo',
      }),
    ]));
  });

  it('reports duplicate site identity nodes with competing ids', () => {
    const result = validateWholeSiteSchemaGraph({
      pages: [page('/', graph([
        {
          '@type': 'Organization',
          '@id': `${baseUrl}/#organization`,
          name: 'Example Co',
          url: baseUrl,
        },
        {
          '@type': 'Organization',
          '@id': `${baseUrl}/#org`,
          name: 'Example Co',
          url: baseUrl,
        },
        {
          '@type': 'WebSite',
          '@id': `${baseUrl}/#website`,
          publisher: { '@id': `${baseUrl}/#organization` },
        },
      ]))],
    });

    expect(result.status).toBe('errors');
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      ruleId: 'schema-graph-duplicate-site-identity',
      type: 'Organization',
    }));
  });

  it('warns when multiple page schemas emit the same root identity body', () => {
    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      pages: [
        page('/', graph([
          {
            '@type': 'LocalBusiness',
            '@id': `${baseUrl}/#localbusiness`,
            name: 'Example Co',
            url: baseUrl,
          },
        ]), 'home'),
        page('/contact', graph([
          {
            '@type': 'ContactPage',
            '@id': `${baseUrl}/contact#contactpage`,
            mainEntity: { '@id': `${baseUrl}/#localbusiness` },
          },
          {
            '@type': 'LocalBusiness',
            '@id': `${baseUrl}/#localbusiness`,
            name: 'Example Co',
            url: baseUrl,
          },
        ]), 'contact'),
      ],
    });

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'warning',
      ruleId: 'schema-graph-duplicate-site-identity-body',
      sourceId: `${baseUrl}/#localbusiness`,
    }));
  });

  it('treats Blog output as compatible with an Article primary type for blog index plans', () => {
    const activePlan: SchemaSitePlan = {
      id: 'plan-blog',
      siteId: 'site-test',
      workspaceId: 'ws-test',
      siteUrl: baseUrl,
      canonicalEntities: [],
      pageRoles: [{
        pagePath: '/insights',
        pageTitle: 'Insights',
        role: 'blog',
        primaryType: 'Article',
        entityRefs: [],
      }],
      status: 'active',
      generatedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const blogPage = page('/insights', graph([
      {
        '@type': 'Blog',
        '@id': `${baseUrl}/insights#blog`,
        blogPost: [{ '@id': `${baseUrl}/insights/post#article` }],
      },
    ]));
    blogPage.generationDiagnostics = {
      plannedRole: 'blog',
      effectiveRole: 'blog',
      roleSource: 'site-plan',
      emittedTypes: ['Blog'],
      skippedSchemaTypes: [],
      richResultsEligibility: [],
      validationStatus: 'valid',
    };

    const result = validateWholeSiteSchemaGraph({ siteTemplate, activePlan, pages: [blogPage] });

    expect(result.findings.find(finding => finding.ruleId === 'schema-graph-plan-primary-type-mismatch')).toBeUndefined();
  });

  it('treats CMS article output as compatible with partnership plan roles', () => {
    const activePlan: SchemaSitePlan = {
      id: 'plan-partnership',
      siteId: 'site-test',
      workspaceId: 'ws-test',
      siteUrl: baseUrl,
      canonicalEntities: [],
      pageRoles: [{
        pagePath: '/insights/partner-story',
        pageTitle: 'Partner Story',
        role: 'partnership',
        primaryType: 'WebPage',
        entityRefs: [],
      }],
      status: 'active',
      generatedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const articlePage = page('/insights/partner-story', graph([
      {
        '@type': 'BlogPosting',
        '@id': `${baseUrl}/insights/partner-story#article`,
        headline: 'Partner Story',
      },
      {
        '@type': 'WebPage',
        '@id': `${baseUrl}/insights/partner-story#webpage`,
        about: { '@id': `${baseUrl}/insights/partner-story#article` },
      },
    ]));
    articlePage.generationDiagnostics = {
      plannedRole: 'partnership',
      effectiveRole: 'blog',
      roleSource: 'collection-inferred',
      emittedTypes: ['BlogPosting', 'WebPage'],
      skippedSchemaTypes: [],
      richResultsEligibility: [],
      validationStatus: 'valid',
    };

    const result = validateWholeSiteSchemaGraph({ siteTemplate, activePlan, pages: [articlePage] });

    expect(result.findings.find(finding => finding.ruleId === 'schema-graph-plan-role-mismatch')).toBeUndefined();
  });

  it('reports hub pages that reference non-child pages', () => {
    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      pages: [
        page('/services', graph([
          {
            '@type': 'CollectionPage',
            '@id': `${baseUrl}/services#collection`,
            name: 'Services',
            mainEntity: {
              '@type': 'ItemList',
              itemListElement: [{
                '@type': 'ListItem',
                position: 1,
                item: { '@id': `${baseUrl}/blog/post#article` },
              }],
            },
          },
        ])),
        page('/blog/post', graph([
          {
            '@type': 'Article',
            '@id': `${baseUrl}/blog/post#article`,
            headline: 'Post',
          },
        ])),
      ],
    });

    expect(result.status).toBe('errors');
    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      ruleId: 'schema-graph-broken-hub-child',
      pagePath: '/services',
      targetId: `${baseUrl}/blog/post#article`,
    }));
  });

  it('allows same-page ItemList references for offer and pricing-style graphs', () => {
    const result = validateWholeSiteSchemaGraph({
      siteTemplate,
      pages: [page('/pricing', graph([
        {
          '@type': 'WebPage',
          '@id': `${baseUrl}/pricing#webpage`,
          name: 'Pricing',
          mainEntity: {
            '@type': 'ItemList',
            itemListElement: [{
              '@type': 'ListItem',
              position: 1,
              item: { '@id': `${baseUrl}/pricing#offer-1` },
            }],
          },
          isPartOf: { '@id': `${baseUrl}/#website` },
        },
        {
          '@type': 'Offer',
          '@id': `${baseUrl}/pricing#offer-1`,
          name: 'Growth Plan',
        },
      ]))],
    });

    expect(result.status).toBe('valid');
    expect(result.findings.find(finding => finding.ruleId === 'schema-graph-broken-hub-child')).toBeUndefined();
  });
});
