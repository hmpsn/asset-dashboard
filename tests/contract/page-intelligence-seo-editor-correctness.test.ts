import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Page Intelligence + SEO Editor correctness contracts', () => {
  it('passes workspace and canonical page identity through single-page Page Intelligence analysis', () => {
    const src = readFileSync('src/components/page-intelligence/usePageIntelligenceAnalysis.ts', 'utf-8'); // readFile-ok — source contract for API wiring

    expect(src).toContain('keywords.analyze({');
    expect(src).toContain('workspaceId,');
    expect(src).toContain('slug: resolvePagePath(page)');
    expect(src).toContain('pagePath: resolvePagePath(page)');
    expect(src).toContain('pageTitle: page.title');
    expect(src).toContain('hasProviderMetrics: kwData.hasProviderMetrics');
  });

  it('passes workspace and canonical page identity through legacy KeywordAnalysis analysis', () => {
    const src = readFileSync('src/components/KeywordAnalysis.tsx', 'utf-8'); // readFile-ok — source contract for legacy keyword analysis caller

    expect(src).toContain('keywords.analyze({');
    expect(src).toContain('workspaceId,');
    expect(src).toContain('slug,');
    expect(src).toContain('pagePath: resolvePagePath(page)');
    expect(src).toContain('pageTitle: page.title');
  });

  it('uses body-scoped workspace access and guards AI-invented keyword metrics before returning or persisting', () => {
    const src = readFileSync('server/routes/webflow-keywords.ts', 'utf-8'); // readFile-ok — source contract for route auth/guards

    expect(src).toContain("import { requireWorkspaceAccessFromBody } from '../auth.js'");
    expect(src).toContain("router.post('/api/webflow/keyword-analysis', requireWorkspaceAccessFromBody()");
    expect(src).toContain("router.post('/api/webflow/keyword-analysis/persist', requireWorkspaceAccessFromBody()");
    expect(src).toContain("applyBulkKeywordGuards(guardedAnalysis, responseMetrics ? kwBlock : '')");
    expect(src).toContain("getProviderMetricsForKeyword(workspaceId, String(guardedAnalysis.primaryKeyword || ''), 'single page analysis response')");
    expect(src).toContain('guardedAnalysis.keywordDifficulty = responseMetrics?.difficulty ?? 0');
    expect(src).toContain('guardedAnalysis.monthlyVolume = responseMetrics?.volume ?? 0');
    expect(src).toContain("const resolvedPrimaryKeyword = analysis.primaryKeyword || existing?.primaryKeyword || ''");
    expect(src).toContain("getProviderMetricsForKeyword(workspaceId, resolvedPrimaryKeyword, 'single page analysis persist')");
    expect(src).toContain('const guardedMetrics = resolvePersistedKeywordMetrics(existing, resolvedPrimaryKeyword, providerMetrics)');
    expect(src).toContain('keywordDifficulty: guardedMetrics.keywordDifficulty');
    expect(src).toContain('monthlyVolume: guardedMetrics.monthlyVolume');
    expect(src).not.toContain('preservedExistingMetrics');
    expect(src).not.toContain('analysis.hasProviderMetrics === true');
  });

  it('broadcasts strategy refreshes after page keyword writes', () => {
    const singleSrc = readFileSync('server/routes/webflow-keywords.ts', 'utf-8'); // readFile-ok — source contract for single-page invalidation
    const bulkSrc = readFileSync('server/page-analysis-job.ts', 'utf-8'); // readFile-ok — source contract for bulk invalidation

    expect(singleSrc).toContain("broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, { pagePath: normalized, source: 'page-analysis' })");
    expect(bulkSrc).toContain("broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, { analyzed, source: 'page-analysis-job' })");
  });

  it('preserves page identity and invalidates SEO Editor cache after direct SEO saves', () => {
    const hookSrc = readFileSync('src/components/editor/useSeoEditorPageWorkflow.ts', 'utf-8'); // readFile-ok — source contract for direct SEO save wiring
    const bulkHookSrc = readFileSync('src/components/editor/useSeoEditorBulkWorkflow.ts', 'utf-8'); // readFile-ok — source contract for bulk SEO save wiring
    const routeSrc = readFileSync('server/routes/webflow.ts', 'utf-8'); // readFile-ok — source contract for direct SEO save route
    const invalidationSrc = readFileSync('src/hooks/useWsInvalidation.ts', 'utf-8'); // readFile-ok — source contract for page state broadcast invalidation

    expect(hookSrc).toContain('slug: page ? resolvePagePath(page) :');
    expect(hookSrc).toContain("pageTitle: page?.title || ''");
    expect(hookSrc).toContain('queryKeys.admin.seoEditor(siteId, workspaceId)');
    expect(bulkHookSrc).toContain('slug: resolvePagePath(page)');
    expect(bulkHookSrc).toContain('publishedPath: page.publishedPath');
    expect(bulkHookSrc).toContain('pageTitle: page.title');
    expect(routeSrc).toContain("const explicitWs = typeof workspaceId === 'string' ? getWorkspace(workspaceId) : undefined");
    expect(routeSrc).toContain("if (typeof workspaceId === 'string' && (!explicitWs || explicitWs.webflowSiteId !== siteId))");
    expect(routeSrc).toContain('if (result.success && siteId)');
    expect(routeSrc).toContain("recordSeoChange(seoWs.id, req.params.pageId, req.body.slug || '', req.body.pageTitle || title || '', changedFields, 'editor')");
    expect(routeSrc).toContain('broadcastToWorkspace(seoWs.id, WS_EVENTS.PAGE_STATE_UPDATED');
    expect(invalidationSrc).toContain('[WS_EVENTS.PAGE_STATE_UPDATED]');
    expect(invalidationSrc).toContain('queryKeys.admin.seoEditorAll()');
    expect(invalidationSrc).toContain('queryKeys.admin.pageJoinPagesAll()');
  });

  it('broadcasts and logs bulk SEO apply writes', () => {
    const routeSrc = readFileSync('server/routes/webflow-seo-apply.ts', 'utf-8'); // readFile-ok — source contract for bulk SEO mutation data-flow

    expect(routeSrc).toContain("source: 'bulk-fix'");
    expect(routeSrc).toContain("source: 'pattern-apply'");
    expect(routeSrc).toContain('broadcastToWorkspace(bulkWsId, WS_EVENTS.PAGE_STATE_UPDATED');
    expect(routeSrc).toContain('broadcastToWorkspace(ws.id, WS_EVENTS.PAGE_STATE_UPDATED');
    expect(routeSrc).toContain("addActivity(ws.id, 'seo_updated'");
    expect(routeSrc).toContain('if (!ws || ws.webflowSiteId !== siteId)');
  });
});
