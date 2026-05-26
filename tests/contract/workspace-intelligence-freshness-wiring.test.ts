import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
      'server/routes/content-publish.ts',
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
      'server/local-seo.ts',
      'server/routes/local-seo.ts',
      'server/recommendations.ts',
      'server/routes/recommendations.ts',
      'server/routes/briefing.ts',
      'server/briefing-cron.ts',
    ]) {
      expect(source(path), path).toContain('invalidateIntelligenceCache');
    }
  });
});
