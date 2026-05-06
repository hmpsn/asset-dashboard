import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('SchemaSuggester publishing workflow extraction', () => {
  it('keeps page publish and approval API ownership in the focused hook', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional extraction contract guard
    const hook = readFileSync('src/components/schema/useSchemaSuggesterPublishingWorkflow.ts', 'utf-8'); // readFile-ok — intentional publishing workflow ownership guard

    expect(component).toContain('useSchemaSuggesterPublishingWorkflow');
    expect(component).not.toContain('schema-publish');
    expect(component).not.toContain('/api/approvals/');
    expect(component).not.toContain('schemaApi.retract');
    expect(component).not.toContain('usePageEditStates');

    expect(hook).toContain('schema-publish');
    expect(hook).toContain('/api/approvals/');
    expect(hook).toContain('schemaApi.retract');
    expect(hook).toContain('usePageEditStates');
    expect(hook).toContain('publishAllToWebflow');
    expect(hook).toContain('sendSingleSchemaToClient');
  });

  it('keeps page-card rendering and schema impact display in SchemaSuggester', () => {
    const component = readFileSync('src/components/SchemaSuggester.tsx', 'utf-8'); // readFile-ok — intentional shell ownership guard

    expect(component).toContain('SchemaPageCard');
    expect(component).toContain('BulkPublishPanel');
    expect(component).toContain('Schema Impact');
    expect(component).toContain('schemaImpactApi.get');
  });
});
