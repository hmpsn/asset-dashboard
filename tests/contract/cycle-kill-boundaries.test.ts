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
});
