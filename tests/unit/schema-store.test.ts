import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  deleteSchemaPlan,
  deleteSchemaSnapshot,
  getOrSeedSiteTemplate,
  getPageTypes,
  getSchemaCmsFieldMapping,
  getSchemaCmsFieldMappings,
  getSchemaPlan,
  getSchemaSnapshot,
  getSiteTemplate,
  patchSiteTemplate,
  removePageFromSnapshot,
  savePageType,
  savePageTypes,
  saveSchemaCmsFieldMapping,
  saveSchemaPlan,
  saveSchemaSnapshot,
  saveSiteTemplate,
  updatePageSchemaInSnapshot,
  updateSchemaPlanRoles,
  updateSchemaPlanStatus,
} from '../../server/schema-store.js';
import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';
import type { SchemaSitePlan } from '../../shared/types/schema-plan.js';

const SITE_ID = 'schema-store-site';
const WS_ID = 'schema-store-ws';

const pageSuggestion = (pageId: string, slug: string, template: Record<string, unknown>): SchemaPageSuggestion => ({
  pageId,
  pageTitle: pageId === 'home' ? 'Home' : 'Service',
  slug,
  url: `https://example.com${slug === '/' ? '' : slug}`,
  existingSchemas: [],
  suggestedSchemas: [{ type: 'WebPage', reason: 'Test fixture', priority: 'high', template }],
});

function cleanup() {
  db.prepare('DELETE FROM schema_snapshots WHERE site_id = ?').run(SITE_ID);
  db.prepare('DELETE FROM schema_site_templates WHERE site_id = ?').run(SITE_ID);
  db.prepare('DELETE FROM schema_site_plans WHERE site_id = ?').run(SITE_ID);
  db.prepare('DELETE FROM schema_page_types WHERE site_id = ?').run(SITE_ID);
  db.prepare('DELETE FROM schema_cms_field_mappings WHERE site_id = ?').run(SITE_ID);
  db.prepare('DELETE FROM schema_publish_history WHERE site_id = ?').run(SITE_ID);
}

describe('schema-store', () => {
  beforeEach(cleanup);

  it('saves, retrieves, updates, prunes, and deletes schema snapshots', () => {
    const snapshot = saveSchemaSnapshot(SITE_ID, WS_ID, [
      pageSuggestion('home', '/', { '@type': 'WebPage', name: 'Home' }),
      pageSuggestion('service', '/services', { '@type': 'Service', name: 'Old Service' }),
    ]);

    expect(snapshot.pageCount).toBe(2);
    expect(getSchemaSnapshot(SITE_ID)?.results).toHaveLength(2);

    expect(updatePageSchemaInSnapshot(SITE_ID, 'service', { '@type': 'Service', name: 'Updated Service' })).toBe(true);
    expect(getSchemaSnapshot(SITE_ID)?.results[1].suggestedSchemas[0].template).toMatchObject({ name: 'Updated Service' });

    expect(updatePageSchemaInSnapshot(SITE_ID, 'missing', { name: 'Nope' })).toBe(false);
    expect(removePageFromSnapshot(SITE_ID, 'home')).toBe(true);
    expect(getSchemaSnapshot(SITE_ID)?.pageCount).toBe(1);
    expect(removePageFromSnapshot(SITE_ID, 'home')).toBe(false);

    expect(deleteSchemaSnapshot(SITE_ID)).toBe(true);
    expect(getSchemaSnapshot(SITE_ID)).toBeNull();
    expect(deleteSchemaSnapshot(SITE_ID)).toBe(false);
  });

  it('auto-seeds a site template from the homepage snapshot graph', () => {
    saveSchemaSnapshot(SITE_ID, WS_ID, [
      pageSuggestion('home', '/', {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', '@id': 'https://example.com/#organization', name: 'Example Co', url: 'https://example.com' },
          { '@type': 'WebSite', '@id': 'https://example.com/#website', name: 'Example Site' },
        ],
      }),
    ]);

    const seeded = getOrSeedSiteTemplate(SITE_ID);
    expect(seeded?.organizationNode.name).toBe('Example Co');
    expect(seeded?.websiteNode.name).toBe('Example Site');
    expect(getSiteTemplate(SITE_ID)?.workspaceId).toBe(WS_ID);
  });

  it('saves templates, preserves createdAt on update, and patch-merges nodes', () => {
    const first = saveSiteTemplate(SITE_ID, WS_ID, { name: 'First', url: 'https://example.com' }, { name: 'Site' });
    const second = saveSiteTemplate(SITE_ID, WS_ID, { name: 'Second', url: 'https://example.com' }, { name: 'Site 2' });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);

    const patched = patchSiteTemplate(SITE_ID, { logo: 'https://example.com/logo.png' }, { inLanguage: 'en-US' });
    expect(patched?.organizationNode).toMatchObject({ name: 'Second', logo: 'https://example.com/logo.png' });
    expect(patched?.websiteNode).toMatchObject({ name: 'Site 2', inLanguage: 'en-US' });
    expect(patchSiteTemplate('missing-site')).toBeNull();
  });

  it('persists schema plans and mutates status and roles', () => {
    const plan: SchemaSitePlan = {
      id: 'plan-schema-store',
      siteId: SITE_ID,
      workspaceId: WS_ID,
      siteUrl: 'https://example.com',
      canonicalEntities: [{ type: 'Organization', name: 'Example', canonicalUrl: 'https://example.com', id: 'org' }],
      pageRoles: [{ pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'WebPage', entityRefs: ['org'] }],
      status: 'draft',
      generatedAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:00.000Z',
    };

    saveSchemaPlan(plan);
    expect(getSchemaPlan(SITE_ID)?.pageRoles[0].role).toBe('homepage');

    const sent = updateSchemaPlanStatus(SITE_ID, 'sent_to_client', 'batch-1');
    expect(sent?.status).toBe('sent_to_client');
    expect(sent?.clientPreviewBatchId).toBe('batch-1');

    const updated = updateSchemaPlanRoles(SITE_ID, [
      { pagePath: '/services', pageTitle: 'Services', role: 'service', primaryType: 'Service', entityRefs: ['org'] },
    ]);
    expect(updated?.pageRoles[0].role).toBe('service');

    expect(updateSchemaPlanStatus('missing-site', 'active')).toBeNull();
    expect(deleteSchemaPlan(SITE_ID)).toBe(true);
    expect(getSchemaPlan(SITE_ID)).toBeNull();
  });

  it('persists page type selections and CMS field mappings', () => {
    savePageType(SITE_ID, 'home', 'homepage');
    savePageTypes(SITE_ID, { service: 'service', blog: 'blog' });

    expect(getPageTypes(SITE_ID)).toMatchObject({ home: 'homepage', service: 'service', blog: 'blog' });

    const mapping = saveSchemaCmsFieldMapping({
      siteId: SITE_ID,
      collectionId: 'collection-1',
      collectionName: 'Blog Posts',
      collectionSlug: 'blog-posts',
      schemaFieldSlug: 'schema-json',
      collectionRole: 'blog',
      fieldMappings: { title: 'name', description: 'summary', datePublished: 'published-on' },
    });

    expect(mapping.updatedAt).toBeDefined();
    expect(getSchemaCmsFieldMapping(SITE_ID, 'collection-1')?.fieldMappings?.title).toBe('name');
    expect(getSchemaCmsFieldMappings(SITE_ID)).toHaveLength(1);
    expect(getSchemaCmsFieldMapping(SITE_ID, 'missing')).toBeNull();
  });
});
