// tests/integration/webflow-id-semantics.test.ts
//
// Semantic correctness tests for Webflow ID types.
//
// Webflow uses several distinct entity IDs — siteId, pageId, collectionId,
// assetId, itemId — that are all opaque strings at the TypeScript level.
// The type system cannot catch ID confusion (passing a siteId where a pageId
// is expected). These tests seed a workspace with known, distinguishable IDs
// and verify that each outbound Webflow API call puts the correct ID in the
// correct URL position.
//
// What this catches:
//   - Swapped siteId/pageId (e.g., listPages(pageId) instead of listPages(siteId))
//   - collectionId used where siteId is expected (or vice versa)
//   - Wrong entity ID in URL path segments for CRUD operations
//
// Pattern:
//   1. Seed workspace with known, distinguishable IDs
//   2. Mock Webflow API to return success for any matching endpoint
//   3. Call the server function under test
//   4. Capture the outbound request URL
//   5. Assert the correct ID appears in the expected URL position

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupWebflowMocks,
  mockWebflowSuccess,
  getCapturedRequests,
  resetWebflowMocks,
} from '../mocks/webflow.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';

// Must call at module-level — vi.mock is hoisted before imports.
setupWebflowMocks();

// Import server modules that make Webflow API calls
import {
  listPages,
  getPageDomNodes,
  getPageDom,
  updatePageSeo,
  getPageMeta,
  publishSite,
  getSiteSubdomain,
  publishSchemaToPage,
  retractSchemaFromPage,
  listSites,
} from '../../server/webflow-pages.js';

import {
  listCollections,
  getCollectionItem,
  listCollectionItems,
  getCollectionSchema,
  createCollectionItem,
  updateCollectionItem,
  publishCollectionItems,
} from '../../server/webflow-cms.js';

import {
  listAssets,
  getAsset,
  updateAsset,
  listAssetFolders,
  createAssetFolder,
  deleteAsset,
} from '../../server/webflow-assets.js';

// ---------------------------------------------------------------------------
// Test IDs — deliberately distinct so ID confusion is obvious in assertions
// ---------------------------------------------------------------------------

const SITE_ID = 'site_67f8a1b2c3d4e5f6';
const PAGE_ID = 'page_12a3b4c5d6e7f890';
const COLLECTION_ID = 'coll_aa11bb22cc33dd44';
const ITEM_ID = 'item_ff00ee11dd22cc33';
const ASSET_ID = 'asset_5566778899aabbcc';
const TOKEN = 'test-token-semantic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find all captured requests whose endpoint contains a given substring. */
function requestsContaining(substring: string) {
  return getCapturedRequests().filter(r => r.endpoint.includes(substring));
}

/** Assert that a captured endpoint starts with the expected prefix. */
function assertEndpointPrefix(endpoint: string, expectedPrefix: string) {
  expect(endpoint.startsWith(expectedPrefix)).toBe(true);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Webflow ID Semantics — correct entity IDs in API URLs', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    resetWebflowMocks();
    ws = seedWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  // =========================================================================
  // Page operations — must use pageId in /pages/{pageId} endpoints
  // =========================================================================

  describe('Page operations use pageId (not siteId or collectionId)', () => {

    it('listPages uses siteId in /sites/{siteId}/pages', async () => {
      mockWebflowSuccess(/\/sites\/.*\/pages/, { pages: [] });

      await listPages(SITE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const req = requests[0];
      expect(req.endpoint).toContain(`/sites/${SITE_ID}/pages`);
      // Must NOT contain pageId or collectionId in the sites endpoint
      expect(req.endpoint).not.toContain(PAGE_ID);
      expect(req.endpoint).not.toContain(COLLECTION_ID);
    });

    it('getPageDomNodes uses pageId in /pages/{pageId}/dom', async () => {
      mockWebflowSuccess(/\/pages\/.*\/dom/, {
        nodes: [],
        pagination: { total: 0 },
      });

      await getPageDomNodes(PAGE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const req = requests[0];
      expect(req.endpoint).toContain(`/pages/${PAGE_ID}/dom`);
      // Must NOT use siteId or collectionId in place of pageId
      expect(req.endpoint).not.toContain(SITE_ID);
      expect(req.endpoint).not.toContain(COLLECTION_ID);
    });

    it('getPageDom uses pageId in /pages/{pageId}/dom', async () => {
      mockWebflowSuccess(/\/pages\/.*\/dom/, {});

      await getPageDom(PAGE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toContain(`/pages/${PAGE_ID}/dom`);
      expect(requests[0].endpoint).not.toContain(SITE_ID);
    });

    it('updatePageSeo uses pageId in PUT /pages/{pageId}', async () => {
      mockWebflowSuccess(/\/pages\//, {});

      await updatePageSeo(
        PAGE_ID,
        { seo: { title: 'New Title', description: 'New desc' } },
        TOKEN,
      );

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const putReq = requests.find(r => r.method === 'PUT');
      expect(putReq).toBeDefined();
      expect(putReq!.endpoint).toBe(`/pages/${PAGE_ID}`);
      // Must NOT accidentally use siteId in the page endpoint
      expect(putReq!.endpoint).not.toContain(SITE_ID);
      expect(putReq!.endpoint).not.toContain(COLLECTION_ID);
    });

    it('getPageMeta uses pageId in GET /pages/{pageId}', async () => {
      mockWebflowSuccess(/\/pages\//, { title: 'Test Page' });

      await getPageMeta(PAGE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe(`/pages/${PAGE_ID}`);
      expect(requests[0].endpoint).not.toContain(SITE_ID);
    });
  });

  // =========================================================================
  // Site operations — must use siteId in /sites/{siteId} endpoints
  // =========================================================================

  describe('Site operations use siteId (not pageId or collectionId)', () => {

    it('publishSite uses siteId in POST /sites/{siteId}/publish', async () => {
      mockWebflowSuccess(/\/sites\/.*\/publish/, {});

      await publishSite(SITE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const postReq = requests.find(r => r.method === 'POST');
      expect(postReq).toBeDefined();
      expect(postReq!.endpoint).toBe(`/sites/${SITE_ID}/publish`);
      expect(postReq!.endpoint).not.toContain(PAGE_ID);
      expect(postReq!.endpoint).not.toContain(COLLECTION_ID);
    });

    it('getSiteSubdomain uses siteId in GET /sites/{siteId}', async () => {
      mockWebflowSuccess(/\/sites\//, { shortName: 'test-site' });

      await getSiteSubdomain(SITE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe(`/sites/${SITE_ID}`);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
    });

    it('listSites uses /sites with no entity ID in path', async () => {
      mockWebflowSuccess('/sites', { sites: [] });

      await listSites(TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe('/sites');
    });
  });

  // =========================================================================
  // CMS collection operations — must use collectionId, not siteId/pageId
  // =========================================================================

  describe('CMS operations use collectionId (not siteId or pageId)', () => {

    it('listCollections uses siteId in /sites/{siteId}/collections', async () => {
      mockWebflowSuccess(/\/sites\/.*\/collections/, { collections: [] });

      await listCollections(SITE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe(`/sites/${SITE_ID}/collections`);
      // siteId is correct here — collections are listed per-site
      expect(requests[0].endpoint).not.toContain(COLLECTION_ID);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
    });

    it('getCollectionItem uses collectionId and itemId in /collections/{collectionId}/items/{itemId}', async () => {
      mockWebflowSuccess(/\/collections\/.*\/items\//, { fieldData: {} });

      await getCollectionItem(COLLECTION_ID, ITEM_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const req = requests[0];
      expect(req.endpoint).toBe(`/collections/${COLLECTION_ID}/items/${ITEM_ID}`);
      // Must NOT use siteId or pageId in the collection item path
      expect(req.endpoint).not.toContain(SITE_ID);
      expect(req.endpoint).not.toContain(PAGE_ID);
    });

    it('listCollectionItems uses collectionId in /collections/{collectionId}/items', async () => {
      mockWebflowSuccess(/\/collections\/.*\/items/, {
        items: [],
        pagination: { total: 0 },
      });

      await listCollectionItems(COLLECTION_ID, 100, 0, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toContain(`/collections/${COLLECTION_ID}/items`);
      expect(requests[0].endpoint).not.toContain(SITE_ID);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
    });

    it('getCollectionSchema uses collectionId in /collections/{collectionId}', async () => {
      mockWebflowSuccess(/\/collections\//, { fields: [] });

      await getCollectionSchema(COLLECTION_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe(`/collections/${COLLECTION_ID}`);
      expect(requests[0].endpoint).not.toContain(SITE_ID);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
    });

    it('createCollectionItem uses collectionId in POST /collections/{collectionId}/items', async () => {
      mockWebflowSuccess(/\/collections\/.*\/items/, { id: 'new-item-1' });

      await createCollectionItem(
        COLLECTION_ID,
        { name: 'Test', slug: 'test' },
        true,
        TOKEN,
      );

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const postReq = requests.find(r => r.method === 'POST');
      expect(postReq).toBeDefined();
      expect(postReq!.endpoint).toBe(`/collections/${COLLECTION_ID}/items`);
      expect(postReq!.endpoint).not.toContain(SITE_ID);
      expect(postReq!.endpoint).not.toContain(PAGE_ID);
    });

    it('updateCollectionItem uses collectionId + itemId in PATCH /collections/{collectionId}/items/{itemId}', async () => {
      mockWebflowSuccess(/\/collections\/.*\/items\//, {});

      await updateCollectionItem(
        COLLECTION_ID,
        ITEM_ID,
        { 'seo-title': 'Updated' },
        TOKEN,
      );

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const patchReq = requests.find(r => r.method === 'PATCH');
      expect(patchReq).toBeDefined();
      expect(patchReq!.endpoint).toBe(`/collections/${COLLECTION_ID}/items/${ITEM_ID}`);
      // Verify neither siteId nor pageId leaked into the collection item URL
      expect(patchReq!.endpoint).not.toContain(SITE_ID);
      expect(patchReq!.endpoint).not.toContain(PAGE_ID);
    });

    it('publishCollectionItems uses collectionId in POST /collections/{collectionId}/items/publish', async () => {
      mockWebflowSuccess(/\/collections\/.*\/items\/publish/, {});

      await publishCollectionItems(COLLECTION_ID, [ITEM_ID], TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const postReq = requests.find(r => r.method === 'POST');
      expect(postReq).toBeDefined();
      expect(postReq!.endpoint).toBe(`/collections/${COLLECTION_ID}/items/publish`);
      expect(postReq!.endpoint).not.toContain(SITE_ID);
      expect(postReq!.endpoint).not.toContain(PAGE_ID);
    });
  });

  // =========================================================================
  // Asset operations — must use assetId in /assets/{assetId} endpoints
  //                     and siteId in /sites/{siteId}/assets endpoints
  // =========================================================================

  describe('Asset operations use correct entity IDs', () => {

    it('listAssets uses siteId in /sites/{siteId}/assets', async () => {
      mockWebflowSuccess(/\/sites\/.*\/assets/, { assets: [] });

      await listAssets(SITE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toContain(`/sites/${SITE_ID}/assets`);
      expect(requests[0].endpoint).not.toContain(ASSET_ID);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
      expect(requests[0].endpoint).not.toContain(COLLECTION_ID);
    });

    it('getAsset uses assetId in /assets/{assetId}', async () => {
      mockWebflowSuccess(/\/assets\//, {
        id: ASSET_ID,
        displayName: 'test.jpg',
        size: 1024,
        contentType: 'image/jpeg',
      });

      await getAsset(ASSET_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe(`/assets/${ASSET_ID}`);
      // Must NOT use siteId or pageId in the asset endpoint
      expect(requests[0].endpoint).not.toContain(SITE_ID);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
      expect(requests[0].endpoint).not.toContain(COLLECTION_ID);
    });

    it('updateAsset uses assetId in GET /assets/{assetId} and PATCH /assets/{assetId}', async () => {
      // updateAsset first GETs the current asset, then PATCHes it
      mockWebflowSuccess(/\/assets\//, {
        id: ASSET_ID,
        displayName: 'photo.jpg',
        size: 2048,
        contentType: 'image/jpeg',
        altText: 'Old alt',
      });

      await updateAsset(ASSET_ID, { altText: 'New alt text' }, TOKEN);

      const requests = getCapturedRequests();
      // Should have at least 2 requests: GET (current) + PATCH (update)
      expect(requests.length).toBeGreaterThanOrEqual(2);
      const getReq = requests.find(r => r.method === 'GET');
      const patchReq = requests.find(r => r.method === 'PATCH');
      expect(getReq).toBeDefined();
      expect(patchReq).toBeDefined();
      // Both must target /assets/{assetId}
      expect(getReq!.endpoint).toBe(`/assets/${ASSET_ID}`);
      expect(patchReq!.endpoint).toBe(`/assets/${ASSET_ID}`);
      // Neither should contain site, page, or collection IDs
      expect(getReq!.endpoint).not.toContain(SITE_ID);
      expect(patchReq!.endpoint).not.toContain(SITE_ID);
    });

    it('deleteAsset uses assetId in DELETE /assets/{assetId}', async () => {
      mockWebflowSuccess(/\/assets\//, {});

      await deleteAsset(ASSET_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const delReq = requests.find(r => r.method === 'DELETE');
      expect(delReq).toBeDefined();
      expect(delReq!.endpoint).toBe(`/assets/${ASSET_ID}`);
      expect(delReq!.endpoint).not.toContain(SITE_ID);
      expect(delReq!.endpoint).not.toContain(PAGE_ID);
    });

    it('listAssetFolders uses siteId in /sites/{siteId}/asset_folders', async () => {
      mockWebflowSuccess(/\/sites\/.*\/asset_folders/, { assetFolders: [] });

      await listAssetFolders(SITE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].endpoint).toBe(`/sites/${SITE_ID}/asset_folders`);
      expect(requests[0].endpoint).not.toContain(ASSET_ID);
      expect(requests[0].endpoint).not.toContain(PAGE_ID);
    });

    it('createAssetFolder uses siteId in POST /sites/{siteId}/asset_folders', async () => {
      mockWebflowSuccess(/\/sites\/.*\/asset_folders/, { id: 'folder-new-1' });

      await createAssetFolder(SITE_ID, 'Optimized Images', undefined, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const postReq = requests.find(r => r.method === 'POST');
      expect(postReq).toBeDefined();
      expect(postReq!.endpoint).toBe(`/sites/${SITE_ID}/asset_folders`);
      expect(postReq!.endpoint).not.toContain(ASSET_ID);
      expect(postReq!.endpoint).not.toContain(PAGE_ID);
    });
  });

  // =========================================================================
  // Cross-entity operations — functions that take BOTH siteId and pageId
  // must put each in the correct URL position
  // =========================================================================

  describe('Cross-entity operations place each ID in the correct URL segment', () => {

    it('publishSchemaToPage: siteId for script registration, pageId for custom code', async () => {
      // publishSchemaToPage makes multiple calls:
      //   1. GET /sites/{siteId}/registered_scripts  (list existing scripts)
      //   2. POST /sites/{siteId}/registered_scripts/inline  (register new script)
      //   3. GET /pages/{pageId}/custom_code  (list existing page code blocks)
      //   4. PUT /pages/{pageId}/custom_code  (apply the script to the page)
      mockWebflowSuccess(/\/sites\/.*\/registered_scripts/, { registeredScripts: [] });
      mockWebflowSuccess(/\/sites\/.*\/registered_scripts\/inline/, {
        id: 'script-registered-1',
        displayName: 'JSON-LD Schema',
        version: '1.0.0',
      });
      mockWebflowSuccess(/\/pages\/.*\/custom_code/, { scripts: [] });

      const schema = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Test',
      };

      await publishSchemaToPage(SITE_ID, PAGE_ID, schema, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);

      // Site-scoped requests: must use SITE_ID, not PAGE_ID
      const siteRequests = requests.filter(r =>
        r.endpoint.includes('/sites/') && r.endpoint.includes('/registered_scripts'),
      );
      expect(siteRequests.length).toBeGreaterThan(0);
      for (const req of siteRequests) {
        expect(req.endpoint).toContain(`/sites/${SITE_ID}/`);
        expect(req.endpoint).not.toContain(PAGE_ID);
        expect(req.endpoint).not.toContain(COLLECTION_ID);
      }

      // Page-scoped requests: must use PAGE_ID, not SITE_ID
      const pageRequests = requests.filter(r =>
        r.endpoint.includes('/pages/') && r.endpoint.includes('/custom_code'),
      );
      expect(pageRequests.length).toBeGreaterThan(0);
      for (const req of pageRequests) {
        expect(req.endpoint).toContain(`/pages/${PAGE_ID}/`);
        expect(req.endpoint).not.toContain(SITE_ID);
        expect(req.endpoint).not.toContain(COLLECTION_ID);
      }
    });

    it('retractSchemaFromPage: siteId for script lookup, pageId for custom code removal', async () => {
      // retractSchemaFromPage:
      //   1. GET /sites/{siteId}/registered_scripts
      //   2. GET /pages/{pageId}/custom_code
      //   3. PUT /pages/{pageId}/custom_code (with schema scripts removed)
      const schemaScriptId = 'script-schema-1';
      mockWebflowSuccess(/\/sites\/.*\/registered_scripts/, {
        registeredScripts: [
          { id: schemaScriptId, displayName: 'JSON-LD Schema (test1234)', version: '1.0.0' },
        ],
      });
      mockWebflowSuccess(/\/pages\/.*\/custom_code/, {
        scripts: [
          { id: schemaScriptId, location: 'header', version: '1.0.0' },
          { id: 'other-script', location: 'footer', version: '2.0.0' },
        ],
      });

      await retractSchemaFromPage(SITE_ID, PAGE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);

      // Verify siteId is used for registered_scripts lookups
      const scriptLookups = requests.filter(r => r.endpoint.includes('/registered_scripts'));
      expect(scriptLookups.length).toBeGreaterThan(0);
      for (const req of scriptLookups) {
        expect(req.endpoint).toContain(`/sites/${SITE_ID}/`);
        expect(req.endpoint).not.toContain(PAGE_ID);
      }

      // Verify pageId is used for custom_code operations
      const codeOps = requests.filter(r => r.endpoint.includes('/custom_code'));
      expect(codeOps.length).toBeGreaterThan(0);
      for (const req of codeOps) {
        expect(req.endpoint).toContain(`/pages/${PAGE_ID}/`);
        expect(req.endpoint).not.toContain(SITE_ID);
      }
    });
  });

  // =========================================================================
  // Negative: verify IDs are never swapped across entity types
  // =========================================================================

  describe('ID confusion guards — IDs never appear in wrong entity paths', () => {

    it('siteId never appears in /pages/ path segment', async () => {
      // Call a page operation with the correct pageId
      mockWebflowSuccess(/\/pages\//, {});
      await updatePageSeo(PAGE_ID, { seo: { title: 'Test' } }, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const pagesRequests = requests.filter(r => r.endpoint.startsWith('/pages/'));
      expect(pagesRequests.length).toBeGreaterThan(0);
      for (const req of pagesRequests) {
        // The siteId must never show up in a /pages/ URL
        expect(req.endpoint).not.toContain(SITE_ID);
      }
    });

    it('pageId never appears in /collections/ path segment', async () => {
      mockWebflowSuccess(/\/collections\//, { fields: [] });
      await getCollectionSchema(COLLECTION_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const collectionRequests = requests.filter(r => r.endpoint.startsWith('/collections/'));
      expect(collectionRequests.length).toBeGreaterThan(0);
      for (const req of collectionRequests) {
        expect(req.endpoint).not.toContain(PAGE_ID);
        expect(req.endpoint).not.toContain(SITE_ID);
      }
    });

    it('collectionId never appears in /assets/ path segment', async () => {
      mockWebflowSuccess(/\/assets\//, {
        id: ASSET_ID,
        displayName: 'test.jpg',
        size: 512,
        contentType: 'image/jpeg',
      });
      await getAsset(ASSET_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const assetRequests = requests.filter(r => r.endpoint.startsWith('/assets/'));
      expect(assetRequests.length).toBeGreaterThan(0);
      for (const req of assetRequests) {
        expect(req.endpoint).not.toContain(COLLECTION_ID);
        expect(req.endpoint).not.toContain(PAGE_ID);
        expect(req.endpoint).not.toContain(SITE_ID);
      }
    });

    it('collectionId + itemId: both appear in correct order in URL', async () => {
      // /collections/{collectionId}/items/{itemId} — order matters
      mockWebflowSuccess(/\/collections\/.*\/items\//, {});

      await updateCollectionItem(COLLECTION_ID, ITEM_ID, { title: 'Updated' }, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      const patchReq = requests.find(r => r.method === 'PATCH');
      expect(patchReq).toBeDefined();

      // Verify the URL structure is /collections/{COLLECTION_ID}/items/{ITEM_ID}
      const endpoint = patchReq!.endpoint;
      const collectionPos = endpoint.indexOf(COLLECTION_ID);
      const itemPos = endpoint.indexOf(ITEM_ID);

      // collectionId must appear BEFORE itemId in the URL
      expect(collectionPos).toBeGreaterThan(-1);
      expect(itemPos).toBeGreaterThan(-1);
      expect(collectionPos).toBeLessThan(itemPos);

      // Verify the exact structure
      expect(endpoint).toBe(`/collections/${COLLECTION_ID}/items/${ITEM_ID}`);
    });
  });

  // =========================================================================
  // Token routing — workspace token flows to the correct Webflow call
  // =========================================================================

  describe('Token is passed through to webflowFetch', () => {

    it('page operation forwards tokenOverride', async () => {
      mockWebflowSuccess(/\/pages\//, {});
      await getPageMeta(PAGE_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].token).toBe(TOKEN);
    });

    it('CMS operation forwards tokenOverride', async () => {
      mockWebflowSuccess(/\/collections\//, { fields: [] });
      await getCollectionSchema(COLLECTION_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].token).toBe(TOKEN);
    });

    it('asset operation forwards tokenOverride', async () => {
      mockWebflowSuccess(/\/assets\//, {
        id: ASSET_ID,
        displayName: 'test.jpg',
        size: 100,
        contentType: 'image/jpeg',
      });
      await getAsset(ASSET_ID, TOKEN);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].token).toBe(TOKEN);
    });
  });
});
