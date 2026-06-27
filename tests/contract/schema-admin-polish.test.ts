import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_ROLE_LABELS } from '../../shared/types/schema-plan';
import { SCHEMA_PAGE_ROLE_VALUES, SCHEMA_PAGE_TYPE_OPTIONS } from '../../src/components/schema/schemaPageTypeOptions';

const ROOT = join(__dirname, '../..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('schema admin polish contracts', () => {
  it('keeps SchemaSuggester on the shared PageHeader and TabBar primitives with ?tab= support', () => {
    const source = read('src/components/SchemaSuggester.tsx'); // readFile-ok — source contract for schema shell primitives.

    expect(source).toContain('<PageHeader');
    expect(source).toContain('<TabBar');
    expect(source).toContain('useSearchParams');
    expect(source).toContain('resolveTabSearchParam<SchemaSubTab>');
    expect(source).not.toContain('const schemaTabBar =');
    expect(source).not.toContain("variant=\"ghost\"\n          size=\"sm\"\n          className={cn(");
  });

  it('keeps schema page-type controls on the single shared option source', () => {
    const setup = read('src/components/schema/SchemaGeneratorSetup.tsx'); // readFile-ok — source contract for initial picker option source.
    const pageCard = read('src/components/schema/SchemaPageCard.tsx'); // readFile-ok — source contract for card option source.
    const planPanel = read('src/components/schema/SchemaPlanPanel.tsx'); // readFile-ok — source contract for plan role option source.

    expect(setup).toContain('SCHEMA_PAGE_TYPE_OPTIONS');
    expect(pageCard).toContain('options={SCHEMA_PAGE_TYPE_OPTIONS}');
    expect(pageCard).not.toContain("{ value: 'homepage', label: 'Homepage' }");
    expect(planPanel).toContain('SCHEMA_PAGE_ROLE_VALUES');
    expect(planPanel).not.toContain('const ROLE_OPTIONS');
  });

  it('derives schema page-type options from the shared schema role labels', () => {
    expect(new Set(SCHEMA_PAGE_ROLE_VALUES)).toEqual(new Set(Object.keys(SCHEMA_ROLE_LABELS)));
    expect(SCHEMA_PAGE_ROLE_VALUES).toEqual([
      'homepage',
      'pillar',
      'service',
      'audience',
      'lead-gen',
      'blog',
      'about',
      'contact',
      'location',
      'product',
      'partnership',
      'faq',
      'case-study',
      'comparison',
      'author',
      'howto',
      'video',
      'job-posting',
      'course',
      'event',
      'review',
      'pricing',
      'recipe',
      'generic',
    ]);
    expect(SCHEMA_PAGE_TYPE_OPTIONS[0]).toEqual({ value: 'auto', label: 'Auto-detect' });
    expect(SCHEMA_PAGE_TYPE_OPTIONS.find(option => option.value === 'author')?.label).toBe('Author Profile');
    expect(SCHEMA_PAGE_TYPE_OPTIONS.find(option => option.value === 'howto')?.label).toBe(SCHEMA_ROLE_LABELS.howto);
  });

  it('does not attach unused prompt-only fields to SchemaContext', () => {
    const schemaSuggester = read('server/schema-suggester.ts'); // readFile-ok — source contract for SchemaContext shape.
    const contextBuilder = read('server/schema/context-builder.ts'); // readFile-ok — source contract for generation context assembly.

    for (const forbidden of [
      'businessContext?: string',
      'searchIntent?: string',
      'knowledgeBase?: string',
      '_personasBlock?: string',
    ]) {
      expect(schemaSuggester).not.toContain(forbidden);
    }

    expect(contextBuilder).not.toContain('formatPersonasForPrompt');
    expect(contextBuilder).not.toContain('ctx.businessContext');
    expect(contextBuilder).not.toContain('ctx.knowledgeBase');
    expect(contextBuilder).not.toContain('ctx._personasBlock');
  });
});
