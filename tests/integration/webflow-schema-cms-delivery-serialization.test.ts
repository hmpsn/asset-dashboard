// tests/integration/webflow-schema-cms-delivery-serialization.test.ts
//
// W3.2 — Integration test: GET /api/webflow/schema-snapshot/:siteId must carry
// top-level cmsDeliveryStatus on CMS page results so the frontend can drive
// the status-aware publish UI without fabricating it from diagnostics.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { upsertPageResultInSnapshot, deleteSchemaSnapshot } from '../../server/schema-store.js';
import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const SITE_ID = `schema-cms-serial-${Date.now()}`;
let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Schema CMS Serialization Test WS');
  workspaceId = ws.id;
  updateWorkspace(workspaceId, { webflowSiteId: SITE_ID, webflowToken: 'cms-serial-token' });
}, 30_000);

afterAll(async () => {
  deleteSchemaSnapshot(SITE_ID);
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

function makeCmsPageResult(pageId: string): SchemaPageSuggestion {
  return {
    pageId,
    pageTitle: 'Example CMS Post',
    slug: 'blog/example',
    url: 'https://example.test/blog/example',
    existingSchemas: [],
    suggestedSchemas: [
      { type: 'WebPage', reason: 'generated', priority: 'high', template: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Example CMS Post' } },
    ],
    generationDiagnostics: {
      plannedRole: 'blog',
      effectiveRole: 'blog',
      roleSource: 'collection-inferred',
      emittedTypes: ['WebPage'],
      skippedSchemaTypes: [],
      richResultsEligibility: [],
      validationStatus: 'valid',
      collection: { collectionId: 'col-1', collectionName: 'Blog Posts', collectionSlug: 'blog', itemId: 'item-1' },
      cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', fieldSlug: 'schema-json', message: 'CMS field ready.' },
    },
    // Top-level cmsDeliveryStatus mirrors diagnostics — set by schema-suggester at generation time
    cmsDeliveryStatus: { mode: 'cms-field', status: 'ready', fieldSlug: 'schema-json', message: 'CMS field ready.' },
  };
}

function makeBlockedCmsPageResult(pageId: string): SchemaPageSuggestion {
  return {
    pageId,
    pageTitle: 'Unmapped CMS Post',
    slug: 'blog/unmapped',
    url: 'https://example.test/blog/unmapped',
    existingSchemas: [],
    suggestedSchemas: [
      { type: 'WebPage', reason: 'generated', priority: 'medium', template: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Unmapped' } },
    ],
    cmsDeliveryStatus: { mode: 'cms-field', status: 'blocked', message: 'No mapped field for this collection.' },
  };
}

describe('GET /api/webflow/schema-snapshot — CMS page cmsDeliveryStatus is serialized', () => {
  it('carries top-level cmsDeliveryStatus on a ready CMS page result', async () => {
    const pageId = `cms-ready-${Date.now()}`;
    upsertPageResultInSnapshot(SITE_ID, workspaceId, makeCmsPageResult(pageId));

    const res = await api(`/api/webflow/schema-snapshot/${SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const page = body.results.find((r: { pageId: string }) => r.pageId === pageId);
    expect(page).toBeDefined();
    expect(page.cmsDeliveryStatus).toBeDefined();
    expect(page.cmsDeliveryStatus.mode).toBe('cms-field');
    expect(page.cmsDeliveryStatus.status).toBe('ready');
    expect(page.cmsDeliveryStatus.fieldSlug).toBe('schema-json');
  });

  it('carries top-level cmsDeliveryStatus on a blocked CMS page result', async () => {
    const pageId = `cms-blocked-${Date.now()}`;
    upsertPageResultInSnapshot(SITE_ID, workspaceId, makeBlockedCmsPageResult(pageId));

    const res = await api(`/api/webflow/schema-snapshot/${SITE_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    const page = body.results.find((r: { pageId: string }) => r.pageId === pageId);
    expect(page).toBeDefined();
    expect(page.cmsDeliveryStatus).toBeDefined();
    expect(page.cmsDeliveryStatus.status).toBe('blocked');
  });

  it('omits cmsDeliveryStatus from static page results', async () => {
    const pageId = `page-static-${Date.now()}`;
    const staticPage: SchemaPageSuggestion = {
      pageId,
      pageTitle: 'Static Page',
      slug: '/services',
      url: 'https://example.test/services',
      existingSchemas: [],
      suggestedSchemas: [
        { type: 'WebPage', reason: 'generated', priority: 'high', template: { '@type': 'WebPage' } },
      ],
      // No cmsDeliveryStatus
    };
    upsertPageResultInSnapshot(SITE_ID, workspaceId, staticPage);

    const res = await api(`/api/webflow/schema-snapshot/${SITE_ID}`);
    const body = await res.json();

    const page = body.results.find((r: { pageId: string }) => r.pageId === pageId);
    expect(page).toBeDefined();
    // Static pages should not have cmsDeliveryStatus
    expect(page.cmsDeliveryStatus).toBeUndefined();
  });
});
