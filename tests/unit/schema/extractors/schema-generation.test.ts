import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../server/anthropic-helpers.js', () => ({
  callAnthropicWithTools: vi.fn(),
}));

import { callAnthropicWithTools } from '../../../../server/anthropic-helpers.js';
import { generateSchemaForUnknownType } from '../../../../server/schema/extractors/schema-generation.js';
import type { SemanticPageData } from '../../../../shared/types/page-elements.js';

const MOCK_GRAPH = [
  {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    '@id': 'https://swishsmiles.com/location/north-austin#dentist',
    'name': 'Swish Dental North Austin',
  },
];

describe('generateSchemaForUnknownType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { graph: MOCK_GRAPH } as Record<string, unknown>,
      promptTokens: 800, completionTokens: 400,
    });
  });

  it('returns a @graph array from Haiku response', async () => {
    const semantics: SemanticPageData = {
      phone: '(512) 555-1234',
      services: ['Teeth Whitening', 'Implants'],
    };
    const result = await generateSchemaForUnknownType({
      semantics,
      pageData: {
        title: 'North Austin Dentist',
        canonicalUrl: 'https://swishsmiles.com/location/north-austin',
        description: 'Dental care in North Austin',
      } as never,
      workspace: { id: 'ws1', name: 'Swish Dental', industry: 'dental' } as never,
      baseUrl: 'https://swishsmiles.com',
    });
    expect(result['@graph']).toBeDefined();
    expect(Array.isArray(result['@graph'])).toBe(true);
    expect((result['@graph'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('falls back to minimal WebPage graph when Haiku throws', async () => {
    vi.mocked(callAnthropicWithTools).mockRejectedValue(new Error('API error'));
    const result = await generateSchemaForUnknownType({
      semantics: {},
      pageData: {
        title: 'Test',
        canonicalUrl: 'https://example.com/test',
        description: '',
      } as never,
      workspace: { id: 'ws1', name: 'Test' } as never,
      baseUrl: 'https://example.com',
    });
    expect(result['@graph']).toBeDefined();
    const graph = result['@graph'] as Array<Record<string, unknown>>;
    expect(graph.some(n => n['@type'] === 'WebPage')).toBe(true);
  });

  it('falls back to WebPage when Haiku returns empty graph', async () => {
    vi.mocked(callAnthropicWithTools).mockResolvedValue({
      toolInput: { graph: [] } as Record<string, unknown>,
      promptTokens: 100, completionTokens: 50,
    });
    const result = await generateSchemaForUnknownType({
      semantics: { pageCategory: 'pricing' },
      pageData: {
        title: 'Pricing',
        canonicalUrl: 'https://example.com/pricing',
        description: '',
      } as never,
      workspace: { id: 'ws1', name: 'Test' } as never,
      baseUrl: 'https://example.com',
    });
    const graph = result['@graph'] as Array<Record<string, unknown>>;
    expect(graph.some(n => n['@type'] === 'WebPage')).toBe(true);
  });
});
