import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const root = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf-8'); // readFile-ok - freshness wiring guard: asserts mutation surfaces clear intelligence caches before broadcasting domain events.
}

describe('workspace intelligence freshness wiring', () => {
  it('content pipeline mutation surfaces clear both content-pipeline and intelligence caches', () => {
    for (const path of [
      'server/routes/content-briefs.ts',
      'server/content-posts.ts',
      'server/routes/content-matrices.ts',
      // C3 (audit item #12): the publish mutation's freshness boundary moved into the shared
      // publishPostToWebflow() service, consumed by BOTH the manual route and the auto-publish job.
      'server/domains/content/publish-post-to-webflow.ts',
      'server/routes/suggested-briefs.ts',
      'server/routes/content-decay.ts',
      'server/content-subscriptions.ts',
      'server/mcp/tools/content-actions.ts',
    ]) {
      expect(source(path), path).toContain('invalidateContentPipelineIntelligence');
    }
  });

  it('copy pipeline mutations use the shared content pipeline freshness boundary', () => {
    const copyPipeline = source('server/routes/copy-pipeline.ts');

    expect(copyPipeline).toContain('function notifyCopyPipelineUpdated');
    expect(copyPipeline).toContain('invalidateContentPipelineIntelligence(workspaceId)');
    expect(copyPipeline).not.toContain("from '../workspace-intelligence.js'");
  });

  it('non-content intelligence mutation surfaces clear workspace intelligence before domain broadcasts', () => {
    for (const path of [
      'server/domains/local-seo/events.ts',
      'server/routes/local-seo.ts',
      'server/domains/recommendations/generation-service.ts',
      'server/routes/recommendations.ts',
      'server/routes/briefing.ts',
      'server/briefing-cron.ts',
    ]) {
      expect(source(path), path).toContain('invalidateIntelligenceCache');
    }
    expect(source('server/local-seo.ts')).toContain("from './domains/local-seo/configuration-actions.js'");
    expect(source('server/local-seo.ts')).toContain("from './domains/local-seo/refresh-runner.js'");
  });

  it('content decay invalidates when analysis and refresh recommendations mutate cached slice inputs', () => {
    const route = source('server/routes/content-decay.ts');

    expect(route.indexOf('const analysis = await analyzeContentDecay(ws);')).toBeGreaterThan(-1);
    expect(route.indexOf('invalidateContentPipelineIntelligence(ws.id);')).toBeGreaterThan(
      route.indexOf('const analysis = await analyzeContentDecay(ws);')
    );
    expect(route.indexOf('const updated = await generateBatchRecommendations(ws, existing, maxPages);')).toBeGreaterThan(-1);
    expect(route.lastIndexOf('invalidateContentPipelineIntelligence(ws.id);')).toBeGreaterThan(
      route.indexOf('const updated = await generateBatchRecommendations(ws, existing, maxPages);')
    );
  });

  it('recommendation page-state writes broadcast page-state freshness', () => {
    const route = source('server/routes/recommendations.ts');
    const generator = source('server/domains/recommendations/generation-service.ts');
    const finalization = source('server/domains/recommendations/finalization.ts');
    const adminKeys = getWorkspaceInvalidationKeys(WS_EVENTS.PAGE_STATE_UPDATED, 'ws-fresh', undefined, 'admin');
    const clientKeys = getWorkspaceInvalidationKeys(WS_EVENTS.PAGE_STATE_UPDATED, 'ws-fresh', undefined, 'client-dashboard');

    expect(route).toContain('updatedPageStateIds.push(resolvedPageId)');
    expect(route).toContain('WS_EVENTS.PAGE_STATE_UPDATED');
    expect(finalization).toContain('autoResolvedPageStateIds.push(resolvedPageId)');
    expect(generator).toContain('WS_EVENTS.PAGE_STATE_UPDATED');
    expect(adminKeys).toContainEqual(queryKeys.shared.pageEditStates('ws-fresh', false));
    expect(adminKeys).toContainEqual(queryKeys.shared.pageEditStates('ws-fresh', true));
    expect(clientKeys).toContainEqual(queryKeys.shared.pageEditStates('ws-fresh', false));
    expect(clientKeys).toContainEqual(queryKeys.shared.pageEditStates('ws-fresh', true));
  });
});
