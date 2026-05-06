import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SEO provider boundary', () => {
  it('keeps keyword strategy generation off provider-specific utility imports', () => {
    const source = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    expect(source).toContain("from './seo-provider-signals.js'");
    expect(source).not.toContain("from './semrush.js'");
  });

  it('keeps legacy SEMRush helper exports as provider-neutral re-exports only', () => {
    const source = readFileSync('server/semrush.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    expect(source).toContain("export { trendDirection, parseSerpFeatures, hasSerpOpportunity } from './seo-provider-signals.js';");
    expect(source).not.toContain('const SERP_FEATURE_MAP');
    expect(source).not.toContain('export function trendDirection');
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
