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
  upsertPageResultInSnapshot,
  updateSchemaPlanRoles,
  updateSchemaPlanStatus,
} from '../../server/schema-store.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
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

  it('upsertPageResultInSnapshot creates a snapshot when none exists', () => {
    expect(getSchemaSnapshot(SITE_ID)).toBeNull();

    const result = upsertPageResultInSnapshot(
      SITE_ID,
      WS_ID,
      pageSuggestion('service', '/services', { '@type': 'Service', name: 'New Service' }),
    );
    expect(result).toBe(true);

    const snapshot = getSchemaSnapshot(SITE_ID);
    expect(snapshot?.pageCount).toBe(1);
    expect(snapshot?.workspaceId).toBe(WS_ID);
    expect(snapshot?.results[0].pageId).toBe('service');
    expect(snapshot?.results[0].suggestedSchemas[0].template).toMatchObject({ name: 'New Service' });
  });

  it('upsertPageResultInSnapshot appends a missing page and preserves existing pages + metadata', () => {
    saveSchemaSnapshot(SITE_ID, WS_ID, [
      pageSuggestion('home', '/', { '@type': 'WebPage', name: 'Home' }),
    ]);
    const before = getSchemaSnapshot(SITE_ID);
    const homeCreatedAt = before?.createdAt;

    expect(upsertPageResultInSnapshot(
      SITE_ID,
      WS_ID,
      pageSuggestion('service', '/services', { '@type': 'Service', name: 'Service' }),
    )).toBe(true);

    const after = getSchemaSnapshot(SITE_ID);
    expect(after?.pageCount).toBe(2);
    expect(after?.id).toBe(before?.id);
    expect(after?.createdAt).toBe(homeCreatedAt);
    expect(after?.results.map(r => r.pageId).sort()).toEqual(['home', 'service']);
    expect(after?.results.find(r => r.pageId === 'home')?.suggestedSchemas[0].template).toMatchObject({ name: 'Home' });
  });

  it('upsertPageResultInSnapshot replaces the full result for an existing page', () => {
    saveSchemaSnapshot(SITE_ID, WS_ID, [
      pageSuggestion('home', '/', { '@type': 'WebPage', name: 'Home' }),
      pageSuggestion('service', '/services', { '@type': 'Service', name: 'Old Service' }),
    ]);

    expect(upsertPageResultInSnapshot(
      SITE_ID,
      WS_ID,
      pageSuggestion('service', '/services', { '@type': 'Service', name: 'Regenerated Service' }),
    )).toBe(true);

    const snapshot = getSchemaSnapshot(SITE_ID);
    expect(snapshot?.pageCount).toBe(2);
    expect(snapshot?.results.find(r => r.pageId === 'service')?.suggestedSchemas[0].template).toMatchObject({ name: 'Regenerated Service' });
    expect(snapshot?.results.find(r => r.pageId === 'home')?.suggestedSchemas[0].template).toMatchObject({ name: 'Home' });
  });

  it('normalizes corrupt snapshot results payload to empty array instead of leaking wrong shape', () => {
    db.prepare(`
      INSERT INTO schema_snapshots (id, site_id, workspace_id, created_at, results, page_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('snap_bad', SITE_ID, WS_ID, '2026-05-01T00:00:00.000Z', '{"not":"an-array"}', 99);

    const snapshot = getSchemaSnapshot(SITE_ID);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.results).toEqual([]);
    expect(snapshot?.pageCount).toBe(99);
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

  it('normalizes template names to workspace name when workspace context exists', () => {
    const workspace = createWorkspace('Faros');
    const template = saveSiteTemplate(
      SITE_ID,
      workspace.id,
      { '@type': 'Organization', name: 'Faros AI', url: 'https://www.faros.ai' },
      { '@type': 'WebSite', name: 'Faros AI', url: 'https://www.faros.ai' },
    );

    expect(template.organizationNode.name).toBe('Faros');
    expect(template.websiteNode.name).toBe('Faros');
    expect(getSiteTemplate(SITE_ID)?.organizationNode.name).toBe('Faros');
    expect(getSiteTemplate(SITE_ID)?.websiteNode.name).toBe('Faros');

    deleteWorkspace(workspace.id);
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
      { pagePath: '/services', pageTitle: 'Services', role: 'service', primaryType: 'WebPage', entityRefs: ['org'] },
    ]);
    expect(updated?.pageRoles[0].role).toBe('service');
    expect(updated?.pageRoles[0].primaryType).toBe('Service');
    expect(updated?.pageRoles[0].entityRefs).toEqual([]);

    const referenced = updateSchemaPlanRoles(SITE_ID, [
      { pagePath: '/for-founders', pageTitle: 'For Founders', role: 'audience', primaryType: 'Service', entityRefs: [] },
    ]);
    expect(referenced?.pageRoles[0].primaryType).toBe('WebPage');
    expect(referenced?.pageRoles[0].entityRefs).toEqual(['org']);

    const ambiguousRefs = updateSchemaPlanRoles(SITE_ID, [
      { pagePath: '/for-startups', pageTitle: 'For Startups', role: 'audience', primaryType: 'Service', entityRefs: [] },
    ], [
      { type: 'Organization', name: 'Example', canonicalUrl: 'https://example.com', id: 'org' },
      { type: 'Service', name: 'Consulting', canonicalUrl: 'https://example.com/services', id: 'service' },
    ]);
    expect(ambiguousRefs?.pageRoles[0].primaryType).toBe('WebPage');
    expect(ambiguousRefs?.pageRoles[0].entityRefs).toEqual([]);

    expect(updateSchemaPlanStatus('missing-site', 'active')).toBeNull();
    expect(deleteSchemaPlan(SITE_ID)).toBe(true);
    expect(getSchemaPlan(SITE_ID)).toBeNull();
  });

  it('normalizes corrupt plan arrays to [] so role updates do not crash', () => {
    db.prepare(`
      INSERT INTO schema_site_plans
        (id, site_id, workspace_id, site_url, canonical_entities, page_roles, status, client_preview_batch_id, generated_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'plan_bad',
      SITE_ID,
      WS_ID,
      'https://example.com',
      '{"bad":"shape"}',
      '"also-bad"',
      'draft',
      null,
      '2026-05-05T00:00:00.000Z',
      '2026-05-05T00:00:00.000Z',
    );

    const plan = getSchemaPlan(SITE_ID);

    expect(plan).not.toBeNull();
    expect(plan?.canonicalEntities).toEqual([]);
    expect(plan?.pageRoles).toEqual([]);

    const updated = updateSchemaPlanRoles(SITE_ID, [
      { pagePath: '/', pageTitle: 'Home', role: 'homepage', primaryType: 'WebPage', entityRefs: [] },
    ]);
    expect(updated?.pageRoles).toHaveLength(1);
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

  it('drops corrupt field_mappings JSON shape to undefined instead of returning invalid arrays', () => {
    db.prepare(`
      INSERT INTO schema_cms_field_mappings
        (site_id, collection_id, collection_name, collection_slug, schema_field_slug, collection_role, field_mappings, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SITE_ID,
      'collection_bad',
      'Broken Collection',
      'broken-collection',
      null,
      null,
      '["not","an","object"]',
      '2026-05-03T00:00:00.000Z',
    );

    const mapping = getSchemaCmsFieldMapping(SITE_ID, 'collection_bad');

    expect(mapping).not.toBeNull();
    expect(mapping?.fieldMappings).toBeUndefined();
  });
});
