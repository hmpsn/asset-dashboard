import type { SchemaPageRole } from './schema-plan';

export type SchemaRoleSource = 'ui' | 'site-plan' | 'auto-detect';
export type SchemaValidationStatus = 'valid' | 'warnings' | 'errors';

export interface SkippedSchemaType {
  type: string;
  reason: string;
  missingFields?: string[];
}

export interface SchemaRichResultEligibility {
  type: string;
  eligible: boolean;
  feature: string;
  missingFields?: string[];
}

export interface SchemaGenerationDiagnostics {
  plannedRole?: SchemaPageRole;
  effectiveRole?: SchemaPageRole;
  roleSource: SchemaRoleSource;
  emittedTypes: string[];
  skippedSchemaTypes: SkippedSchemaType[];
  richResultsEligibility: SchemaRichResultEligibility[];
  validationStatus: SchemaValidationStatus;
}
