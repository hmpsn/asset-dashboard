import type { ValidationFinding } from '../../../shared/types/schema-validation';
import type { SchemaGenerationDiagnostics } from '../../../shared/types/schema-generation';
import type { CmsSchemaFieldMapping, SchemaFieldTarget } from '../../../shared/types/site-inventory';

export interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

export interface RichResultEligibility {
  type: string;
  eligible: boolean;
  feature: string;
  missingFields?: string[];
}

export interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  publishedPath?: string | null;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
  validationFindings?: ValidationFinding[];
  richResultsEligibility?: RichResultEligibility[];
  generationDiagnostics?: SchemaGenerationDiagnostics;
  lastPublishedAt?: string | null;
}

export interface SchemaPageOption {
  id: string;
  title: string;
  slug: string;
}

export interface CmsMappingField {
  slug: string;
  displayName: string;
  type: string;
  target?: SchemaFieldTarget;
}

export interface CmsMappingCollection {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  fields: CmsMappingField[];
  recommendedFieldSlug?: string;
  mapping: CmsSchemaFieldMapping | null;
}

export interface CmsMappingsResponse {
  collections: CmsMappingCollection[];
}

export type SchemaMappingCollection = CmsMappingCollection & {
  schemaRole: 'location' | 'service';
};
