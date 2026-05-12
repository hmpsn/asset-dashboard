import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SchemaSuggester CMS workflow extraction', () => {
  it('keeps CMS field-mapping API ownership in the focused hook and strips legacy CMS templates', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const hook = readFileSync('src/components/schema/useSchemaSuggesterCmsWorkflow.ts', 'utf-8'); // readFile-ok — intentional CMS workflow ownership guard

    expect(component).toContain('useSchemaSuggesterCmsWorkflow');
    expect(component).not.toContain('schema-cms-field-mappings');
    expect(component).not.toContain('schema-cms-template');
    expect(component).not.toContain('CmsTemplatePanel');
    expect(component).not.toContain('useMutation');
    expect(component).not.toContain('useQuery');
    expect(component).not.toContain('schemaCmsFieldMappings');

    expect(hook).toContain('schema-cms-field-mappings');
    expect(hook).not.toContain('schema-cms-template');
    expect(hook).toContain('queryKeys.admin.schemaCmsFieldMappings');
    expect(hook).toContain('useMutation');
    expect(hook).toContain('useQuery');
    expect(hook).not.toContain('CmsTemplatePage');
    expect(hook).not.toContain('publishCmsTemplate');
    expect(hook).not.toContain('copyCmsTemplate');
  });

  it('leaves page-card rendering in SchemaSuggester while publishing workflow moves separately', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional slice boundary guard

    expect(component).toContain('BulkPublishPanel');
    expect(component).toContain('useSchemaSuggesterPublishingWorkflow');
    expect(component).toContain('SchemaPageCard');
  });

  it('removes legacy free-form CMS template and consistency routes from schema routes', () => {
    const routes = readFileSync('server/routes/webflow-schema.ts', 'utf-8'); // readFile-ok — legacy route removal guard
    const api = readFileSync('src/api/seo.ts', 'utf-8'); // readFile-ok — legacy frontend wrapper removal guard

    expect(routes).not.toContain('schema-cms-template');
    expect(routes).not.toContain('cms-template-pages');
    expect(routes).not.toContain('schema-validate-consistency');
    expect(routes).toContain('schema-graph-validation');
    expect(api).not.toContain('/api/schema/${wsId}');
    expect(api).toContain('schema-retract');
  });

  it('keeps saved page types below active schema plans in generation authority', () => {
    const source = readFileSync('server/schema-suggester.ts', 'utf-8'); // readFile-ok — authority-order contract guard
    const activePlanIndex = source.indexOf('if (planRole && !shouldCollectionBeatPlan)');
    const persistedIndex = source.indexOf('if (opts.persistedPageType && opts.persistedPageType !==');
    const savedTypesIndex = source.indexOf('const savedPageTypes = getPageTypes(siteId)');

    expect(savedTypesIndex).toBeGreaterThan(0);
    expect(activePlanIndex).toBeGreaterThan(0);
    expect(persistedIndex).toBeGreaterThan(activePlanIndex);
    expect(source).toContain('persistedPageType: savedPageTypes[page.id]');
    expect(source).toContain("source: 'saved-page-type'");
    expect(source).toContain("schemaRoleOverride: { role, source: 'ui' as const");
    expect(source).toContain("schemaRoleOverride: { role, source: 'saved-page-type' as const");
  });
});
