import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('canonical SEO copy operation adapters', () => {
  const metadataAdapters = [
    'server/routes/webflow-seo-rewrite.ts',
    'server/routes/webflow-seo-bulk-rewrite.ts',
    'server/webflow-seo-bulk-rewrite-job.ts',
  ] as const;

  it('routes every metadata-variation adapter through the shared service', () => {
    for (const file of metadataAdapters) {
      const source = read(file);
      expect(source, file).toContain('generateSeoMetadataVariations');
      expect(source, file).not.toContain('callCreativeAI');
      expect(source, file).not.toContain('normalizeSeoRewriteVariations');
      expect(source, file).not.toContain('normalizeSeoRewritePairs');
      expect(source, file).not.toContain('parseJsonFallback');
      expect(source, file).not.toContain('gscBlock');
      expect(source, file).not.toContain('ctrUnderperformanceFlag');
      expect(source, file).toContain('searchPerformance');
    }
  });

  it('routes the richer page-copy set through its named shared operation', () => {
    const source = read('server/routes/webflow-seo-page-tools.ts');
    expect(source).toContain('generateSeoPageCopySet');
    expect(source).not.toContain('MODEL_ROLES.utilityExtraction');
    expect(source).not.toContain("feature: 'content-score'");
    expect(source).not.toContain('callAI');
  });

  it('keeps suggestion persistence outside the pure generation service', () => {
    const service = read('server/domains/seo-health/seo-copy-generation.ts');
    expect(service).not.toContain('saveSuggestion');
    expect(service).not.toContain('updateJob');
    expect(service).not.toContain('updateWebflow');
    expect(service).not.toContain('broadcastToWorkspace');
  });
});
