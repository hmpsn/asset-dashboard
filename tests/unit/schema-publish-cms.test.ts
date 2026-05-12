import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getCapturedRequests,
  mockWebflowSuccess,
  resetWebflowMocks,
  setupWebflowMocks,
} from '../mocks/webflow.js';

setupWebflowMocks();

import type { SchemaPageSuggestion } from '../../server/schema-suggester.js';
import { deleteSchemaSnapshot, saveSchemaSnapshot } from '../../server/schema-store.js';
import { publishSchemaToCmsField } from '../../server/routes/webflow-schema.js';

const SITE_ID = 'site-cms-publish-unit';
const WORKSPACE_ID = 'ws-cms-publish-unit';
const PAGE_ID = 'cms-blog-example-post';
const COLLECTION_ID = 'collection-blog';
const ITEM_ID = 'item-example';
const FIELD_SLUG = 'schema-json-ld';

const SCHEMA: Record<string, unknown> = {
  '@context': 'https://schema.org',
  '@graph': [{
    '@type': 'WebPage',
    '@id': 'https://example.com/blog/example-post#webpage',
    name: 'Example Post',
    url: 'https://example.com/blog/example-post',
    description: 'A useful example post.',
    isPartOf: { '@id': 'https://example.com/#website' },
    inLanguage: 'en',
  }],
};

function seedCmsSnapshot(): void {
  const suggestion: SchemaPageSuggestion = {
    pageId: PAGE_ID,
    pageTitle: 'Example Post',
    slug: 'blog/example-post',
    url: 'https://example.com/blog/example-post',
    existingSchemas: [],
    suggestedSchemas: [{
      type: 'WebPage',
      reason: 'Test schema.',
      priority: 'medium',
      template: SCHEMA,
    }],
    validationErrors: [],
    generationDiagnostics: {
      plannedRole: 'blog',
      effectiveRole: 'blog',
      roleSource: 'collection-inferred',
      emittedTypes: ['WebPage'],
      skippedSchemaTypes: [],
      missingRequiredFields: [],
      richResultsEligibility: [],
      validationStatus: 'valid',
      collection: {
        collectionId: COLLECTION_ID,
        collectionName: 'Blog Posts',
        collectionSlug: 'blog',
        itemId: ITEM_ID,
        itemPath: '/blog/example-post',
      },
      cmsDeliveryStatus: {
        mode: 'cms-field',
        status: 'ready',
        fieldSlug: FIELD_SLUG,
        message: 'CMS field ready.',
      },
    },
  };
  saveSchemaSnapshot(SITE_ID, WORKSPACE_ID, [suggestion]);
}

afterEach(() => {
  deleteSchemaSnapshot(SITE_ID);
  resetWebflowMocks();
});

describe('publishSchemaToCmsField', () => {
  it('publishes an unchanged CMS schema field when publishAfter is requested', async () => {
    seedCmsSnapshot();
    const schemaJson = JSON.stringify(SCHEMA);
    mockWebflowSuccess(`/collections/${COLLECTION_ID}`, {
      fields: [{ id: 'field-schema', displayName: 'Schema JSON-LD', type: 'PlainText', slug: FIELD_SLUG }],
    });
    mockWebflowSuccess(`/collections/${COLLECTION_ID}/items/${ITEM_ID}`, {
      fieldData: { [FIELD_SLUG]: schemaJson },
    });
    mockWebflowSuccess(`/collections/${COLLECTION_ID}/items/publish`, {});

    const result = await publishSchemaToCmsField({
      siteId: SITE_ID,
      pageId: PAGE_ID,
      schema: SCHEMA,
      publishAfter: true,
      token: 'token-test',
    });

    expect(result).toMatchObject({
      mode: 'cms-field',
      status: 'unchanged',
      fieldSlug: FIELD_SLUG,
      message: `CMS field unchanged: ${FIELD_SLUG}; CMS item published.`,
    });
    expect(getCapturedRequests()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        endpoint: `/collections/${COLLECTION_ID}/items/publish`,
        method: 'POST',
        body: { itemIds: [ITEM_ID] },
      }),
    ]));
    expect(getCapturedRequests().some(req => req.method === 'PATCH')).toBe(false);
  });
});

describe('schema publish validation gate', () => {
  it('runs structural lean validation before Google rich-result eligibility validation', () => {
    const routeSource = readFileSync('server/routes/webflow-schema.ts', 'utf-8'); // readFile-ok — publish route validation contract guard
    const structuralIndex = routeSource.indexOf("validateLeanSchema(schema, 'WebPage')");
    const googleIndex = routeSource.indexOf('validateForGoogleRichResults(schema)');

    expect(structuralIndex).toBeGreaterThan(-1);
    expect(googleIndex).toBeGreaterThan(-1);
    expect(structuralIndex).toBeLessThan(googleIndex);
  });
});
