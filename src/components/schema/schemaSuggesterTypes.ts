import type { ValidationFinding } from '../../../shared/types/schema-validation';
import type { SchemaGenerationDiagnostics } from '../../../shared/types/schema-generation';

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
