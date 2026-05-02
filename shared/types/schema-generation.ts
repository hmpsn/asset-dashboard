import type { SchemaPageRole } from './schema-plan';
import type {
  SchemaCmsDeliveryStatus,
  SchemaCollectionIdentity,
  SchemaEvidenceSource,
  SchemaFieldEvidence,
  SchemaFieldResolutionStatus,
} from './site-inventory';

export type SchemaRoleSource = 'ui' | 'site-plan' | 'collection-map' | 'collection-inferred' | 'auto-detect';
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
  collection?: SchemaCollectionIdentity;
  emittedTypes: string[];
  skippedSchemaTypes: SkippedSchemaType[];
  missingRequiredFields?: string[];
  evidenceSources?: Partial<Record<string, SchemaEvidenceSource>>;
  fieldEvidence?: SchemaFieldEvidence[];
  fieldResolutionStatuses?: SchemaFieldResolutionStatus[];
  richResultsEligibility: SchemaRichResultEligibility[];
  validationStatus: SchemaValidationStatus;
  cmsDeliveryStatus?: SchemaCmsDeliveryStatus;
}
