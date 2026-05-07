import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SchemaSuggester CMS workflow extraction', () => {
  it('keeps CMS template and field-mapping API ownership in the focused hook', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const hook = readFileSync('src/components/schema/useSchemaSuggesterCmsWorkflow.ts', 'utf-8'); // readFile-ok — intentional CMS workflow ownership guard

    expect(component).toContain('useSchemaSuggesterCmsWorkflow');
    expect(component).not.toContain('schema-cms-field-mappings');
    expect(component).not.toContain('schema-cms-template');
    expect(component).not.toContain('useMutation');
    expect(component).not.toContain('useQuery');
    expect(component).not.toContain('schemaCmsFieldMappings');

    expect(hook).toContain('schema-cms-field-mappings');
    expect(hook).toContain('schema-cms-template');
    expect(hook).toContain('queryKeys.admin.schemaCmsFieldMappings');
    expect(hook).toContain('useMutation');
    expect(hook).toContain('useQuery');
    expect(hook).toContain('getSafe<CmsTemplatePage[]>');
    expect(hook).toContain('publishCmsTemplate');
    expect(hook).toContain('copyCmsTemplate');
  });

  it('leaves page-card rendering in SchemaSuggester while publishing workflow moves separately', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional slice boundary guard

    expect(component).toContain('BulkPublishPanel');
    expect(component).toContain('useSchemaSuggesterPublishingWorkflow');
    expect(component).toContain('SchemaPageCard');
  });
});
