import type {
  AuthenticVoiceEvidenceSourceRef,
  GenerationEvidenceRequirement,
} from './generation-evidence.js';

export const BRAND_INTAKE_SCHEMA_VERSION = 1 as const;

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
  buyingStage: 'awareness' | 'consideration' | 'decision' | 'mixed';
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

export interface BrandIntakeSubmitter {
  actorType: 'client' | 'operator' | 'mcp' | 'system';
  actorId: string;
  actorLabel?: string;
}

/** Immutable, fingerprinted revision consumed by brand-generation runs. */
export interface BrandIntakeRevision {
  id: string;
  workspaceId: string;
  revision: number;
  schemaVersion: typeof BRAND_INTAKE_SCHEMA_VERSION;
  payload: BrandIntakePayload;
  fingerprint: string;
  source: BrandIntakeSource;
  submitter: BrandIntakeSubmitter;
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
  fieldPath: string;
  requirement: GenerationEvidenceRequirement;
}
