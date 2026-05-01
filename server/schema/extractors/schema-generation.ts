/**
 * Haiku-powered schema generation for unknown page types.
 * Called when the generator classifies a page as WebPage but semantic data exists.
 * Falls back to a minimal WebPage graph on any error.
 */
import { callAnthropicWithTools } from '../../anthropic-helpers.js';
import type { AnthropicToolDefinition } from '../../anthropic-helpers.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import type { PageData } from '../data-sources.js';
import { createLogger } from '../../logger.js';

const log = createLogger('schema/extractors/schema-generation');

// Static schema.org type reference — cached across calls (large constant).
// Covers the ~30 business-relevant types most likely for unknown pages.
const SCHEMA_TYPE_REFERENCE = `## Schema.org Type Reference
Use ONLY these types. Choose the most specific applicable type.

LocalBusiness subtypes: Dentist, Physician, Attorney, LegalService, FinancialService,
  ProfessionalService, HomeAndConstructionBusiness, InsuranceAgency, RealEstateAgent,
  HealthAndBeautyBusiness, MedicalBusiness, MedicalClinic

Other business types: FoodEstablishment, Restaurant, Hotel, Store, AutoDealer

Content types: Product, Course, Event, ItemList, HowTo

Organization types: Organization, NGO, EducationalOrganization

Page types (fallback only): WebPage, AboutPage, ContactPage, CollectionPage

For each node include: @context, @type, @id (full URL), name, url.
Add only properties you have data for — omit undefined fields entirely.`;

// Input type — workspace fields needed for generation context
interface GenerationWorkspace {
  id: string;
  name: string;
  industry?: string;
  topKeywords?: string[];
  [key: string]: unknown;
}

const GENERATE_TOOL: AnthropicToolDefinition = {
  name: 'generate_schema',
  description: 'Generate schema.org JSON-LD for the page as a @graph array.',
  input_schema: {
    type: 'object',
    properties: {
      graph: {
        type: 'array',
        description: 'Array of schema.org nodes. Each node must have @context, @type, @id.',
        items: {
          type: 'object',
          properties: {
            '@context': { type: 'string' },
            '@type': { type: 'string' },
            '@id': { type: 'string' },
          },
          required: ['@type', '@id'],
        },
      },
    },
    required: ['graph'],
  },
};

export async function generateSchemaForUnknownType(input: {
  semantics: SemanticPageData;
  pageData: PageData;
  workspace: GenerationWorkspace;
  baseUrl: string;
}): Promise<Record<string, unknown>> {
  const { semantics, pageData, workspace } = input;

  const fallback: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${pageData.canonicalUrl}#webpage`,
      'name': pageData.cleanTitle ?? pageData.title,
      'url': pageData.canonicalUrl,
      'description': pageData.description,
    }],
  };

  try {
    const userMessage = [
      `## Business Context`,
      `Name: ${workspace.name}`,
      workspace.industry ? `Industry: ${workspace.industry}` : '',
      workspace.topKeywords?.length
        ? `Top keywords: ${(workspace.topKeywords as string[]).slice(0, 5).join(', ')}`
        : '',
      '',
      `## Page`,
      `Title: ${pageData.cleanTitle ?? pageData.title}`,
      `URL: ${pageData.canonicalUrl}`,
      pageData.description ? `Description: ${pageData.description}` : '',
      '',
      `## Extracted Semantic Data`,
      JSON.stringify(semantics, null, 2),
    ].filter(Boolean).join('\n');

    const { toolInput } = await callAnthropicWithTools({
      model: 'claude-haiku-4-5-20251001',
      system: `${SCHEMA_TYPE_REFERENCE}

Generate schema.org JSON-LD for the page described below.
Choose the most specific applicable type from the reference above.
Only use types from the reference. Only emit fields you have data for.
The output MUST be a valid @graph array — every node needs @type, @id, and @context.`,
      userMessage,
      tools: [GENERATE_TOOL],
      forceTool: 'generate_schema',
      maxTokens: 2048,
      feature: 'schema-generation-unknown',
      workspaceId: workspace.id,
    });

    const graph = toolInput.graph as Array<Record<string, unknown>>;
    if (!Array.isArray(graph) || graph.length === 0) return fallback;

    return { '@context': 'https://schema.org', '@graph': graph };
  } catch (err) {
    log.warn({ err, url: pageData.canonicalUrl }, 'generateSchemaForUnknownType failed — using WebPage fallback');
    return fallback;
  }
}
