import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SEO provider boundary', () => {
  it('keeps keyword strategy generation off provider-specific utility imports', () => {
    const generation = readFileSync('server/keyword-strategy-generation.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    const enrichment = readFileSync('server/keyword-strategy-enrichment.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    expect(enrichment).toContain("from './seo-provider-signals.js'");
    expect(generation).not.toContain("from './semrush.js'");
    expect(enrichment).not.toContain("from './semrush.js'");
  });

  it('removes legacy SEMRush runtime modules entirely', () => {
    expect(existsSync('server/semrush.ts')).toBe(false);
    expect(existsSync('server/providers/semrush-provider.ts')).toBe(false);
  });

  it('uses seo-provider-signals directly for utility imports', () => {
    const enrichmentTest = readFileSync('tests/unit/strategy-enrichment.test.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    const semrushRouteTest = readFileSync('tests/integration/semrush-routes.test.ts', 'utf-8'); // readFile-ok: endpoint migration guard

    expect(enrichmentTest).toContain("from '../../server/seo-provider-signals.js'");
    expect(semrushRouteTest).not.toContain("from '../../server/semrush.js'");
    expect(semrushRouteTest).toContain('/api/seo/status');
  });

  it('uses provider-neutral keyword strategy job params with no legacy semrushMode fallback', () => {
    const component = readFileSync('src/components/KeywordStrategy.tsx', 'utf-8'); // readFile-ok: endpoint migration guard
    const route = readFileSync('server/routes/keyword-strategy.ts', 'utf-8'); // readFile-ok: endpoint migration guard
    const jobs = readFileSync('server/routes/jobs.ts', 'utf-8'); // readFile-ok: endpoint migration guard

    expect(component).toContain('seoDataMode: seoDataAvailable ? seoDataMode :');
    expect(component).not.toContain('semrushMode:');
    expect(route).toContain('seoDataMode: readSeoDataMode(req.body)');
    expect(route).not.toContain('semrushMode?: unknown');
    expect(jobs).toContain('params.seoDataMode');
    expect(jobs).not.toContain('params.semrushMode');
  });
});
