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
export type SchemaDeliveryMethod = 'webflow-api' | 'manual-native-schema-field';
export type SchemaDeliveryStatus = 'ready' | 'published' | 'manual-required' | 'failed';
export type SchemaDeliveryReason =
  | 'webflow-inline-script-limit'
  | 'webflow-register-failed'
  | 'webflow-apply-failed'
  | 'validation-errors';

export interface SchemaDeliveryDecision {
  method: SchemaDeliveryMethod;
  status: SchemaDeliveryStatus;
  reason?: SchemaDeliveryReason;
  message: string;
  /** JSON-LD only. Never include a <script> wrapper in this value. */
  jsonLd: string;
  characterCount?: number;
  apiLimit?: number;
}

export interface SchemaPublishResponse {
  success: boolean;
  delivery: SchemaDeliveryDecision;
  /** Whether the schema was written to the page custom-code slot. */
  published?: boolean;
  /** Whether the site publish call ran successfully after the schema write. */
  sitePublished?: boolean;
  error?: string;
}

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
