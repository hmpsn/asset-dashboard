import { describe, expect, it } from 'vitest';
import { summarizeSchemaResults } from '../../src/components/schema/SchemaResultsSummary';
import type { SchemaPageSuggestion } from '../../src/components/schema/schemaSuggesterTypes';

function page(overrides: Partial<SchemaPageSuggestion> = {}): SchemaPageSuggestion {
  return {
    pageId: 'page-1',
    pageTitle: 'Home',
    slug: '/',
    url: 'https://example.com/',
    existingSchemas: [],
    suggestedSchemas: [{ type: 'WebPage', reason: 'Base schema', priority: 'high', template: { '@graph': [{ '@type': 'WebPage' }] } }],
    ...overrides,
  };
}

describe('SchemaSuggester results summary', () => {
  it('counts pages with warnings once while preserving total graph type counts', () => {
    const stats = summarizeSchemaResults([
      page({
        existingSchemas: ['old-json-ld'],
        validationFindings: [
          { severity: 'warning', type: 'Organization', message: 'Missing logo', field: 'publisher.logo', ruleId: 'required-field-missing' },
          { severity: 'warning', type: 'Organization', message: 'Missing logo again', field: 'publisher.logo', ruleId: 'required-field-missing' },
        ],
      }),
      page({
        pageId: 'page-2',
        slug: '/about',
        validationErrors: ['Invalid JSON-LD'],
        suggestedSchemas: [{ type: 'AboutPage', reason: 'About page', priority: 'medium', template: { '@graph': [{ '@type': 'AboutPage' }, { '@type': 'Organization' }] } }],
      }),
    ]);

    expect(stats).toEqual({
      pagesWithExisting: 1,
      pagesWithErrors: 1,
      pagesWithWarnings: 1,
      fixesAvailable: 1,
      totalTypes: 3,
    });
  });
});
