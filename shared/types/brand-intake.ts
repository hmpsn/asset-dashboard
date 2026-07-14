import type {
  AuthenticVoiceEvidenceSourceRef,
  GenerationEvidenceResolution,
  GenerationEvidenceRequirement,
  GenerationFactualEvidenceSourceRef,
  GenerationResolverAttribution,
} from './generation-evidence.js';

export const BRAND_INTAKE_SCHEMA_VERSION = 1 as const;
export const BRAND_INTAKE_WORKSPACE_EVENT_DOMAIN = 'brand-intake' as const;
export const BRAND_INTAKE_WORKSPACE_EVENT_ACTION = 'revision_created' as const;

export const BRAND_INTAKE_LIMITS = {
  maxPayloadBytes: 128 * 1024,
  maxIdLength: 128,
  maxIdempotencyKeyLength: 128,
  maxShortTextLength: 200,
  maxToneLength: 500,
  maxTextLength: 5_000,
  maxExampleLength: 10_000,
  maxUrlLength: 2_048,
  maxListItems: 20,
  maxListItemLength: 100,
  maxAuthenticSamples: 25,
  maxEvidenceResolutions: 22,
  maxEvidenceSnapshotBytes: 1024 * 1024,
  maxActorLabelLength: 200,
} as const;

export const BRAND_INTAKE_BUYING_STAGES = [
  'awareness',
  'consideration',
  'decision',
  'mixed',
] as const;

export type BrandIntakeBuyingStage = (typeof BRAND_INTAKE_BUYING_STAGES)[number];

export interface BrandIntakeBusinessInfo {
  businessName: string;
  industry: string;
  description: string;
  services: string;
  locations: string;
  differentiators: string;
  website: string;
}

export interface BrandIntakeAudienceInfo {
  primaryAudience: string;
  painPoints: string;
  goals: string;
  objections: string;
  /** Empty means the legacy/public input omitted this field; `mixed` is an explicit All stages answer. */
  buyingStage: BrandIntakeBuyingStage | '';
  secondaryAudience: string;
}

export interface BrandIntakeVoiceInfo {
  tone: string;
  personality: string[];
  avoidWords: string;
  contentFormats: string[];
  existingExamples: string;
}

export interface BrandIntakeCompetitorInfo {
  competitors: string;
  whatTheyDoBetter: string;
  whatYouDoBetter: string;
  referenceUrls: string;
}

/** Shared wire payload matching the existing onboarding questionnaire. */
export interface BrandIntakeQuestionnaireData {
  business: BrandIntakeBusinessInfo;
  audience: BrandIntakeAudienceInfo;
  brand: BrandIntakeVoiceInfo;
  competitors: BrandIntakeCompetitorInfo;
}

export const BRAND_INTAKE_FIELD_PATHS = [
  'business.businessName',
  'business.industry',
  'business.description',
  'business.services',
  'business.locations',
  'business.differentiators',
  'business.website',
  'audience.primaryAudience',
  'audience.painPoints',
  'audience.goals',
  'audience.objections',
  'audience.buyingStage',
  'audience.secondaryAudience',
  'brand.tone',
  'brand.personality',
  'brand.avoidWords',
  'brand.contentFormats',
  'brand.existingExamples',
  'competitors.competitors',
  'competitors.whatTheyDoBetter',
  'competitors.whatYouDoBetter',
  'competitors.referenceUrls',
] as const;

export type BrandIntakeFieldPath = (typeof BRAND_INTAKE_FIELD_PATHS)[number];

export type BrandIntakeEvidenceRequirementId = `brand-intake:${BrandIntakeFieldPath}`;

export function brandIntakeEvidenceRequirementId(
  fieldPath: BrandIntakeFieldPath,
): BrandIntakeEvidenceRequirementId {
  return `brand-intake:${fieldPath}`;
}

export type BrandIntakeFieldValueKind =
  | 'text'
  | 'text_list'
  | 'url'
  | 'url_list'
  | 'buying_stage';

export interface BrandIntakeFieldPolicy {
  section: keyof BrandIntakeQuestionnaireData;
  valueKind: BrandIntakeFieldValueKind;
  evidenceClass: 'business_fact' | 'audience_statement' | 'brand_preference' | 'reference';
}

export const BRAND_INTAKE_FIELD_POLICY = {
  'business.businessName': { section: 'business', valueKind: 'text', evidenceClass: 'business_fact' },
  'business.industry': { section: 'business', valueKind: 'text', evidenceClass: 'business_fact' },
  'business.description': { section: 'business', valueKind: 'text', evidenceClass: 'business_fact' },
  'business.services': { section: 'business', valueKind: 'text', evidenceClass: 'business_fact' },
  'business.locations': { section: 'business', valueKind: 'text', evidenceClass: 'business_fact' },
  'business.differentiators': { section: 'business', valueKind: 'text', evidenceClass: 'business_fact' },
  'business.website': { section: 'business', valueKind: 'url', evidenceClass: 'reference' },
  'audience.primaryAudience': { section: 'audience', valueKind: 'text', evidenceClass: 'audience_statement' },
  'audience.painPoints': { section: 'audience', valueKind: 'text', evidenceClass: 'audience_statement' },
  'audience.goals': { section: 'audience', valueKind: 'text', evidenceClass: 'audience_statement' },
  'audience.objections': { section: 'audience', valueKind: 'text', evidenceClass: 'audience_statement' },
  'audience.buyingStage': { section: 'audience', valueKind: 'buying_stage', evidenceClass: 'audience_statement' },
  'audience.secondaryAudience': { section: 'audience', valueKind: 'text', evidenceClass: 'audience_statement' },
  'brand.tone': { section: 'brand', valueKind: 'text', evidenceClass: 'brand_preference' },
  'brand.personality': { section: 'brand', valueKind: 'text_list', evidenceClass: 'brand_preference' },
  'brand.avoidWords': { section: 'brand', valueKind: 'text', evidenceClass: 'brand_preference' },
  'brand.contentFormats': { section: 'brand', valueKind: 'text_list', evidenceClass: 'brand_preference' },
  'brand.existingExamples': { section: 'brand', valueKind: 'text', evidenceClass: 'reference' },
  'competitors.competitors': { section: 'competitors', valueKind: 'text', evidenceClass: 'business_fact' },
  'competitors.whatTheyDoBetter': { section: 'competitors', valueKind: 'text', evidenceClass: 'business_fact' },
  'competitors.whatYouDoBetter': { section: 'competitors', valueKind: 'text', evidenceClass: 'business_fact' },
  'competitors.referenceUrls': { section: 'competitors', valueKind: 'url_list', evidenceClass: 'reference' },
} as const satisfies Record<BrandIntakeFieldPath, BrandIntakeFieldPolicy>;

export interface BrandIntakeAuthenticSample {
  id: string;
  kind: 'client_written' | 'approved_existing_copy' | 'accepted_source_excerpt';
  content: string;
  context: 'headline' | 'body' | 'cta' | 'about' | 'service' | 'social' | 'seo';
  sourceRef: AuthenticVoiceEvidenceSourceRef;
}

/** Stored, schema-versioned form of the existing questionnaire payload. */
export interface BrandIntakePayload extends BrandIntakeQuestionnaireData {
  schemaVersion: typeof BRAND_INTAKE_SCHEMA_VERSION;
  authenticSamples: BrandIntakeAuthenticSample[];
}

export const BRAND_INTAKE_SOURCES = ['client_portal', 'admin', 'mcp', 'migration'] as const;
export type BrandIntakeSource = (typeof BRAND_INTAKE_SOURCES)[number];

export const BRAND_INTAKE_MUTATION_KINDS = ['submission', 'evidence_resolution'] as const;
export type BrandIntakeMutationKind = (typeof BRAND_INTAKE_MUTATION_KINDS)[number];

export const BRAND_INTAKE_RESOLUTION_SOURCE_TYPES = [
  'client_submission',
  'operator_submission',
  'external_research',
  'operator_attestation',
] as const;

export type BrandIntakeResolutionSourceType =
  (typeof BRAND_INTAKE_RESOLUTION_SOURCE_TYPES)[number];

export interface BrandIntakeSubmitter {
  actorType: 'client' | 'operator' | 'mcp' | 'system';
  actorId: string;
  actorLabel?: string;
}

export const BRAND_INTAKE_SOURCE_ACTOR_POLICY = {
  client_portal: 'client',
  admin: 'operator',
  mcp: 'mcp',
  migration: 'system',
} as const satisfies Record<BrandIntakeSource, BrandIntakeSubmitter['actorType']>;

export type BrandIntakeResolutionSourceRef = Omit<
  GenerationFactualEvidenceSourceRef,
  'sourceType'
> & {
  sourceType: BrandIntakeResolutionSourceType;
};

export type BrandIntakeResolverAttribution = Omit<
  GenerationResolverAttribution,
  'actorType'
> & {
  actorType: 'operator' | 'client' | 'mcp';
};

export type BrandIntakeEvidenceValue =
  | { kind: 'text'; value: string }
  | { kind: 'text_list'; value: string[] }
  | { kind: 'url'; value: string }
  | { kind: 'url_list'; value: string[] }
  | { kind: 'buying_stage'; value: BrandIntakeBuyingStage };

export type BrandIntakeEvidenceResolution = Omit<
  GenerationEvidenceResolution<number, []>,
  'requirementId' | 'value' | 'sourceRef' | 'resolvedBy'
> & {
  requirementId: BrandIntakeEvidenceRequirementId;
  fieldPath: BrandIntakeFieldPath;
  value: BrandIntakeEvidenceValue;
  sourceRef: BrandIntakeResolutionSourceRef;
  resolvedBy: BrandIntakeResolverAttribution;
};

/** Immutable, fingerprinted revision consumed by brand-generation runs. */
export interface BrandIntakeRevision {
  id: string;
  workspaceId: string;
  revision: number;
  schemaVersion: typeof BRAND_INTAKE_SCHEMA_VERSION;
  payload: BrandIntakePayload;
  evidenceResolutions: BrandIntakeEvidenceResolution[];
  fingerprint: string;
  source: BrandIntakeSource;
  submitter: BrandIntakeSubmitter;
  mutationKind: BrandIntakeMutationKind;
  supersedesRevisionId: string | null;
  supersededByRevisionId: string | null;
  createdAt: string;
}

export interface BrandIntakeRevisionRef {
  intakeRevisionId: string;
  revision: number;
  fingerprint: string;
}

/** Field-level evidence projection derived from a durable intake revision. */
export interface BrandIntakeEvidenceRef {
  intakeRevisionId: string;
  section: keyof BrandIntakeQuestionnaireData;
  fieldPath: BrandIntakeFieldPath;
  requirement: GenerationEvidenceRequirement;
}

export const BRAND_INTAKE_EVIDENCE_AVAILABILITIES = [
  'submitted',
  'resolved',
  'missing',
] as const;

export type BrandIntakeEvidenceAvailability =
  (typeof BRAND_INTAKE_EVIDENCE_AVAILABILITIES)[number];

export interface BrandIntakeFieldEvidence {
  requirementId: BrandIntakeEvidenceRequirementId;
  fieldPath: BrandIntakeFieldPath;
  availability: BrandIntakeEvidenceAvailability;
  sourceRefs: GenerationFactualEvidenceSourceRef[];
  resolution: BrandIntakeEvidenceResolution | null;
}

/**
 * Internal compatibility-projection ownership snapshot.
 *
 * Workspace competitor domains predate durable intake and have no row-level
 * provenance. Freezing both sets per immutable revision lets a later intake
 * remove only domains that B0 actually added, without deleting a manual domain
 * that happened to overlap a submitted competitor.
 */
export interface BrandIntakeCompatibilityProjectionState {
  preservedCompetitorDomains: string[];
  intakeOwnedCompetitorDomains: string[];
}

export interface BrandIntakeSubmissionRequest {
  workspaceId: string;
  payload: BrandIntakePayload;
  source: BrandIntakeSource;
  submitter: BrandIntakeSubmitter;
}

export interface BrandIntakeSubmissionResult {
  revision: BrandIntakeRevision;
  created: boolean;
  projectionChanged: boolean;
}

export interface GetBrandIntakeRequest {
  workspaceId: string;
  intakeRevisionId?: string;
}

export interface GetBrandIntakeResult {
  revision: BrandIntakeRevision | null;
  fieldEvidence: BrandIntakeFieldEvidence[];
}

export interface ResolveBrandIntakeEvidenceRequest {
  workspaceId: string;
  intakeRevisionId: string;
  expectedRevision: number;
  requirementId: BrandIntakeEvidenceRequirementId;
  fieldPath: BrandIntakeFieldPath;
  value: BrandIntakeEvidenceValue;
  sourceRef: BrandIntakeResolutionSourceRef;
  resolvedBy: BrandIntakeResolverAttribution;
  idempotencyKey: string;
}

export interface ResolveBrandIntakeEvidenceResult {
  revision: BrandIntakeRevision;
  created: boolean;
  replayed: boolean;
}

export interface PublicOnboardingSaveResponse {
  ok: true;
  message: 'Onboarding responses saved successfully';
}

/** Safe metadata for the existing WORKSPACE_UPDATED event. */
export interface BrandIntakeWorkspaceUpdatedMetadata {
  domain: typeof BRAND_INTAKE_WORKSPACE_EVENT_DOMAIN;
  action: typeof BRAND_INTAKE_WORKSPACE_EVENT_ACTION;
  cause: BrandIntakeMutationKind;
  intakeRevisionId: string;
  revision: number;
}
