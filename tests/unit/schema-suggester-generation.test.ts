import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SchemaSuggester generation workflow extraction', () => {
  it('keeps schema generation background job ownership in the focused hook', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const hook = readFileSync('src/components/schema/useSchemaSuggesterGeneration.ts', 'utf-8'); // readFile-ok — intentional background job ownership guard

    expect(component).toContain('useSchemaSuggesterGeneration');
    expect(component).not.toContain('useBackgroundTasks');
    expect(component).not.toContain("startJob('schema-generator'");
    expect(hook).toContain('useBackgroundTasks');
    expect(hook).toContain('BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR');
    expect(hook).toContain('startJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR');
    expect(hook).toContain('queryKeys.admin.schemaSnapshot(siteId, workspaceId)');
  });

  it('keeps snapshot hydration and fix-context single-page generation in the workflow hook', () => {
    const hook = readFileSync('src/components/schema/useSchemaSuggesterGeneration.ts', 'utf-8'); // readFile-ok — intentional behavior preservation guard

    expect(hook).toContain('useSchemaSnapshot(siteId, workspaceId)');
    expect(hook).toContain('useWebflowPages(siteId, workspaceId)');
    expect(hook).toContain("fixContext.targetRoute === 'seo-schema'");
    expect(hook).toContain('generateSinglePage(fixContext.pageId!)');
    expect(hook).toContain('lastPublishedAt: page.lastPublishedAt');
  });

  it('keeps persisted page mappings out of explicit single-page overrides', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional authority-order guard
    const setup = readFileSync('src/components/schema/SchemaGeneratorSetup.tsx', 'utf-8'); // readFile-ok — intentional authority-order guard
    const hook = readFileSync('src/components/schema/useSchemaSuggesterGeneration.ts', 'utf-8'); // readFile-ok — intentional authority-order guard

    expect(hook).toContain('singlePageTypeOverrides');
    expect(hook).toContain('const pt = singlePageTypeOverrides[pageId]');
    expect(hook).not.toContain('const pt = pageTypes[pageId]');
    expect(component).toContain('setSinglePageTypeOverrides');
    expect(component).toContain('onPageTypeSelect={(pageId, pageType)');
    expect(setup).toContain('onPageTypeSelect: (pageId: string, pageType: string) => void');
  });
});
