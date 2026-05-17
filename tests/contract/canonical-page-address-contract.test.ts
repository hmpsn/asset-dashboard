import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const approvalsRoute = readFileSync(join(import.meta.dirname, '../../server/routes/approvals.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for approval outcome tracking.
const schemaRoute = readFileSync(join(import.meta.dirname, '../../server/routes/webflow-schema.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for schema outcome tracking.
const pageToolsRoute = readFileSync(join(import.meta.dirname, '../../server/routes/webflow-seo-page-tools.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for live page HTML fetches.
const rewriteRoute = readFileSync(join(import.meta.dirname, '../../server/routes/webflow-seo-rewrite.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for SEO rewrite fetches.
const jobsRoute = readFileSync(join(import.meta.dirname, '../../server/routes/jobs.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for background SEO writes.
const contentPostsRoute = readFileSync(join(import.meta.dirname, '../../server/routes/content-posts.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for content outcome tracking.
const webflowKeywordsRoute = readFileSync(join(import.meta.dirname, '../../server/routes/webflow-keywords.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for keyword intelligence context.
const schemaGenerator = readFileSync(join(import.meta.dirname, '../../server/schema/generator.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for lean schema suggestions.
const schemaSuggester = readFileSync(join(import.meta.dirname, '../../server/schema-suggester.ts'), 'utf-8'); // readFile-ok — canonical page-address contract guard for schema suggestion publishing paths.
const schemaPublishingHook = readFileSync(join(import.meta.dirname, '../../src/components/schema/useSchemaSuggesterPublishingWorkflow.ts'), 'utf-8'); // readFile-ok — frontend must forward canonical publishedPath for schema publishes.
const seoDerived = readFileSync(join(import.meta.dirname, '../../src/components/editor/seoEditorDerived.ts'), 'utf-8'); // readFile-ok — SEO approvals must persist canonical path metadata.

describe('canonical page-address route wiring', () => {
  it('approval outcome tracking stores normalized canonical paths', () => {
    expect(approvalsRoute).toContain('publishedPath: z.string().nullable().optional()');
    expect(approvalsRoute).toContain('const rawAppliedPagePath = appliedItem.publishedPath || appliedItem.pageSlug ||');
    expect(approvalsRoute).toContain('normalizePageUrl(rawAppliedPagePath)');
    expect(approvalsRoute).toContain('const rawPagePath = item.publishedPath || item.pageSlug ||');
    expect(approvalsRoute).toContain('normalizePageUrl(rawPagePath)');
    expect(approvalsRoute).not.toContain('pageUrl: item.pageSlug ? `/${item.pageSlug}` : null');
    expect(approvalsRoute).not.toContain('captureBaselineFromGsc(action.id, req.params.workspaceId, `/${item.pageSlug}`)');
  });

  it('schema publish paths receive and use publishedPath before pageSlug fallback', () => {
    expect(schemaPublishingHook).toContain('publishedPath: pageData?.publishedPath');
    expect(schemaRoute).toContain('const rawCmsPublishedPath = req.body.publishedPath || req.body.pageSlug ||');
    expect(schemaRoute).toContain('normalizePageUrl(rawCmsPublishedPath)');
    expect(schemaRoute).toContain('const rawPublishedPath = req.body.publishedPath || req.body.pageSlug ||');
    expect(schemaRoute).toContain('normalizePageUrl(rawPublishedPath)');
    expect(schemaGenerator).toContain('publishedPath: input.pageMeta.publishedPath');
    expect(schemaSuggester).toContain('publishedPath: lean.publishedPath');
    expect(schemaRoute).not.toContain('pageUrl: req.body.pageSlug ? `/${req.body.pageSlug}` : null');
    expect(schemaRoute).not.toContain('captureBaselineFromGsc(schemaAction.id, pubWs.id, `/${req.body.pageSlug}`)');
  });

  it('SEO approval payloads carry the canonical page path', () => {
    expect(seoDerived).toContain('publishedPath?: string | null');
    expect(seoDerived).toContain('const publishedPath = resolvePagePath(page)');
  });

  it('live page fetch routes normalize page paths before URL construction', () => {
    expect(pageToolsRoute).toContain('normalizePageUrl(req.query.path)');
    expect(rewriteRoute).toContain('const normalizedPagePath = typeof pagePath ===');
    expect(rewriteRoute).toContain("`${baseUrl.replace(/\\/+$/, '')}${normalizedPagePath === '/' ? '' : normalizedPagePath}`");
  });

  it('background and AI read paths do not persist or prompt with raw leaf slugs', () => {
    expect(jobsRoute).toContain("const seoChangePagePath = bulkJobPagePath || (page.slug ? normalizePageUrl(page.slug) : '')");
    expect(contentPostsRoute).toContain('const publishedPagePath = slug ? normalizePageUrl(slug) : null');
    expect(contentPostsRoute).not.toContain('pageUrl: slug ? `/${slug}` : null');
    expect(webflowKeywordsRoute).toContain('const pagePath = slug ? normalizePageUrl(slug) : undefined');
    expect(webflowKeywordsRoute).not.toContain("slug.startsWith('/') ? slug : `/${slug}`");
  });
});
