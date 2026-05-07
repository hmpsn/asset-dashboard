import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SEO provider boundary', () => {
  it('keeps keyword strategy generation off provider-specific utility imports', () => {
    const generation = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    const enrichment = readFileSync('server/keyword-strategy-enrichment.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    expect(enrichment).toContain("from './seo-provider-signals.js'");
    expect(generation).not.toContain("from './semrush.js'");
    expect(enrichment).not.toContain("from './semrush.js'");
  });

  it('removes legacy SEMRush helper re-export bridge entirely', () => {
    const source = readFileSync('server/semrush.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    expect(source).not.toContain("export { trendDirection, parseSerpFeatures, hasSerpOpportunity } from './seo-provider-signals.js';");
    expect(source).not.toContain('const SERP_FEATURE_MAP');
    expect(source).not.toContain('export function trendDirection');
  });

  it('uses seo-provider-signals directly for utility imports', () => {
    const enrichmentTest = readFileSync('tests/unit/strategy-enrichment.test.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    const semrushRouteTest = readFileSync('tests/integration/semrush-routes.test.ts', 'utf-8'); // readFile-ok: endpoint migration guard

    expect(enrichmentTest).toContain("from '../../server/seo-provider-signals.js'");
    expect(semrushRouteTest).toContain("from '../../server/seo-provider-signals.js'");
  });

  it('uses provider-neutral keyword strategy job params while accepting legacy callers', () => {
    const component = readFileSync('src/components/KeywordStrategy.tsx', 'utf-8'); // readFile-ok: endpoint migration guard
    const route = readFileSync('server/routes/keyword-strategy.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    const jobs = readFileSync('server/routes/jobs.ts', 'utf-8'); // readFile-ok: endpoint migration guard

    expect(component).toContain('seoDataMode: seoDataAvailable ? seoDataMode :');
    expect(component).not.toContain('semrushMode:');
    expect(route).toContain('seoDataMode: readSeoDataMode(req.body)');
    expect(route).toContain('semrushMode?: unknown');
    expect(jobs).toContain('params.seoDataMode');
    expect(jobs).toContain('params.semrushMode');
  });
});
