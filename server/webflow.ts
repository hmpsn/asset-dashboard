/**
 * Barrel re-export file for backward compatibility.
 * All Webflow API functions have been split into domain sub-modules:
 *   - webflow-assets.ts  (asset CRUD, folders, upload, usage scanning)
 *   - webflow-pages.ts   (pages, SEO, publishing, schema, sitemap discovery)
 *   - webflow-cms.ts     (collections, items, schema)
 *   - webflow-client.ts  (shared fetch helper + token)
 */
export * from './webflow-assets.js';
export * from './webflow-pages.js';
export * from './webflow-cms.js';
