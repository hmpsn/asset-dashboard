# SEO Editor Write Targets

The SEO Editor is the shared admin surface for static Webflow pages and Webflow CMS items. Write behavior must always flow through a resolved target type before any save, publish, approval, AI bulk rewrite, or tracking mutation.

## Contract

- Static Webflow pages resolve to `targetType: 'static-page'` and write through page SEO APIs.
- Real CMS collection items resolve to `targetType: 'cms-item'` and write through collection item APIs with `collectionId` and real `itemId`.
- Sitemap-only CMS rows resolve to `targetType: 'manual'`; they are visible for awareness but cannot be saved, published, bulk rewritten, or sent to the client.
- Never make synthetic discovery IDs writable. Legacy approval data may use `cms-*`; resolver-only manual rows may use `manual:*`. Neither shape is a real Webflow page or item ID.
- Nested paths and trailing-slash variants must be normalized before matching static, CMS, and manual targets.

## Data Flow

Every durable mutation from this surface must update page edit state, log meaningful activity, broadcast a workspace-scoped event, and invalidate both static SEO editor and CMS editor query keys when the changed data can appear in either view.
