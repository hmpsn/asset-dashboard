import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function readSource(path: string): string {
  return readFileSync(path, 'utf-8'); // readFile-ok - source contract guard for cycle-kill boundaries.
}

describe('cycle-kill boundary contracts', () => {
  it('keeps impact-band as the leaf owner of the client-safe impact band type', () => {
    const impactBandSource = readSource('shared/types/impact-band.ts');
    const fixCatalogSource = readSource('shared/types/fix-catalog.ts');

    expect(impactBandSource).toContain('export interface ImpactBand');
    expect(impactBandSource).not.toContain('./fix-catalog');
    expect(fixCatalogSource).toContain("export type { ImpactBand } from './impact-band.js'");
  });

  it('keeps briefing templates off their registry barrel', () => {
    const dir = 'server/briefing-templates';
    const templateFiles = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !['index.ts', 'context.ts'].includes(file));

    expect(templateFiles.length).toBeGreaterThan(0);
    for (const file of templateFiles) {
      const source = readSource(join(dir, file));
      expect(source).not.toContain("from './index.js'");
      if (/import type \{ TemplateContext \}/.test(source)) {
        expect(source).toContain("from './context.js'");
      }
    }
  });

  it('keeps audit suppression projection below the reports store', () => {
    const reportsSource = readSource('server/reports.ts');
    const viewsSource = readSource('server/audit-snapshot-views.ts');

    expect(reportsSource).toContain("from './audit-suppression-projection.js'");
    expect(reportsSource).not.toContain("from './audit-snapshot-views.js'");
    expect(viewsSource).toContain("from './reports.js'");
  });

  it('keeps schema data extraction independent from template helpers', () => {
    const dataSourcesSource = readSource('server/schema/data-sources.ts');
    const helpersSource = readSource('server/schema/templates/helpers.ts');
    const sanitizerSource = readSource('server/schema/schema-text-sanitizer.ts');

    expect(dataSourcesSource).toContain("from './schema-text-sanitizer.js'");
    expect(dataSourcesSource).not.toContain("from './templates/helpers.js'");
    expect(helpersSource).toContain("export { scrubBrandSuffix } from '../schema-text-sanitizer.js'");
    expect(sanitizerSource).toContain('export function scrubBrandSuffix');
  });

  it('keeps small frontend cycles on leaf type modules', () => {
    const healthModelSource = readSource('src/components/client/health-tab/healthTabModel.ts');
    const cockpitRowSource = readSource('src/components/strategy/CockpitRow.tsx');
    const backingQueueSource = readSource('src/components/strategy/issue/BackingMovesQueue.tsx');
    const strategyCockpitSource = readSource('src/components/strategy/StrategyCockpit.tsx');

    expect(healthModelSource).toContain("from './healthTabTypes'");
    expect(healthModelSource).not.toContain("from './useHealthTabShell'");
    expect(cockpitRowSource).toContain("from './cockpitTypes'");
    expect(cockpitRowSource).not.toContain("from './StrategyCockpit'");
    expect(backingQueueSource).toContain("from '../cockpitTypes'");
    expect(strategyCockpitSource).toContain("export type { CockpitActions } from './cockpitTypes'");
  });

  it('keeps admin fix context on a leaf type module instead of App.tsx', () => {
    const appSource = readSource('src/App.tsx');
    const fixContextSource = readSource('src/types/fix-context.ts');
    const consumers = [
      'src/components/ContentBriefs.tsx',
      'src/components/ContentPipeline.tsx',
      'src/components/PageIntelligence.tsx',
      'src/components/SchemaSuggester.tsx',
      'src/components/SeoEditor.tsx',
      'src/components/SeoEditorWrapper.tsx',
      'src/components/editor/useSeoEditorSessionState.ts',
    ];

    expect(fixContextSource).toContain('export interface FixContext');
    expect(appSource).not.toContain('export interface FixContext');
    expect(appSource).toContain("from './types/fix-context'");
    for (const file of consumers) {
      const source = readSource(file);
      expect(source).toContain('types/fix-context');
      expect(source).not.toMatch(/from ['"](?:\.\.\/)+App['"]/);
    }
  });

  it('keeps cycle-sensitive local SEO consumers off the broad facade', () => {
    const consumers = [
      'server/keyword-strategy-ai-synthesis.ts',
      'server/keyword-strategy-universe.ts',
      'server/keyword-strategy-synthesis/context.ts',
      'server/intelligence/seo-context-slice.ts',
      'server/domains/keyword-command-center/source-snapshot.ts',
      'server/domains/keyword-command-center/detail-service.ts',
      'server/domains/keyword-command-center/rows-service.ts',
      'server/domains/keyword-command-center/summary-service.ts',
    ];

    for (const file of consumers) {
      const source = readSource(file);
      expect(source).not.toMatch(/from ['"](?:\.\.?\/)+local-seo\.js['"]/);
    }
  });

  it('keeps schema template type resolution in a schema leaf utility', () => {
    const templateTypes = readSource('server/schema/template-schema-types.ts');
    const matrices = readSource('server/content-matrices.ts');
    const templates = readSource('server/content-templates.ts');
    const queue = readSource('server/schema-queue.ts');

    expect(templateTypes).toContain('export function getSchemaTypesForTemplate');
    expect(templateTypes).toContain("from './role-type-registry.js'");
    expect(matrices).not.toContain("from './schema-suggester.js'");
    expect(matrices).toContain("export { getSchemaTypesForTemplate } from './schema/template-schema-types.js'");
    expect(templates).toContain("from './schema/template-schema-types.js'");
    expect(queue).toContain("from './schema/template-schema-types.js'");
  });

  it('keeps CWV helper modules off the SEO audit orchestrator for types', () => {
    const cwvTypes = readSource('server/seo-audit-cwv-types.ts');
    const cwv = readSource('server/seo-audit-cwv.ts');
    const siteChecks = readSource('server/seo-audit-site-checks.ts');
    const audit = readSource('server/seo-audit.ts');

    expect(cwvTypes).toContain('export interface CwvSummary');
    expect(cwv).toContain("from './seo-audit-cwv-types.js'");
    expect(siteChecks).toContain("from './seo-audit-cwv-types.js'");
    expect(cwv).not.toContain("from './seo-audit.js'");
    expect(siteChecks).not.toContain("from './seo-audit.js'");
    expect(audit).toContain("export type { CwvMetricSummary, CwvStrategyResult, CwvSummary } from './seo-audit-cwv-types.js'");
  });
});
