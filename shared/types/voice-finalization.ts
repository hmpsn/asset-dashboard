import type {
  CalibrationRating,
  ContextModifier,
  VoiceDNA,
  VoiceGuardrails,
  VoiceProfileStatus,
  VoiceSampleContext,
} from './brand-engine.js';
import type {
  AuthenticVoiceAnchorRef,
  BrandVoiceReadiness,
  FinalizedVoiceSnapshotRef,
} from './brand-generation.js';
import type {
  GenerationOperatorAttribution,
  GenerationResolverAttribution,
} from './generation-evidence.js';

export const VOICE_FINALIZATION_LIMITS = {
  maxIdLength: 128,
  maxIdempotencyKeyLength: 128,
  maxAuthorizationTokenLength: 256,
  maxActorLabelLength: 200,
  maxTraitCount: 20,
  maxGuardrailItemsPerGroup: 50,
  maxContextModifiers: 20,
  maxAnchors: 25,
  maxCalibrationSelections: 100,
  maxShortTextLength: 500,
  maxTextLength: 10_000,
  maxSnapshotJsonBytes: 512 * 1024,
  maxAuthorizationJsonBytes: 512 * 1024,
  authorizationTtlSeconds: 15 * 60,
} as const;

/** Caller addresses only durable candidate rows; the server derives evidence refs. */
export type VoiceAnchorSelector =
  | {
      kind: 'voice_sample';
      voiceSampleId: string;
    }
  | {
      kind: 'brand_intake_sample';
      intakeRevisionId: string;
      intakeRevision: number;
      sampleId: string;
    };

/** Operator preference evidence; generated variations never become authentic anchors. */
export interface VoiceCalibrationSelection {
  sessionId: string;
  variationIndex: number;
  rating: CalibrationRating;
  selected: boolean;
  feedback?: string;
}

/** Immutable server-derived copy of the exact generated variation evaluated. */
export interface VoiceCalibrationSelectionSnapshot
  extends VoiceCalibrationSelection {
  promptType: string;
  variationText: string;
}

/** Frozen authentic content and its derived evidence identity. */
export interface FinalizedVoiceAnchorSnapshot {
  selector: VoiceAnchorSelector;
  content: string;
  context: VoiceSampleContext;
  evidenceRef: AuthenticVoiceAnchorRef;
}

/** Immutable versioned authority consumed by downstream generation. */
export interface FinalizedVoiceSnapshot extends FinalizedVoiceSnapshotRef {
  id: string;
  workspaceId: string;
  profileRevision: number;
  voiceDNA: VoiceDNA;
  guardrails: VoiceGuardrails;
  contextModifiers: ContextModifier[];
  anchors: [FinalizedVoiceAnchorSnapshot, ...FinalizedVoiceAnchorSnapshot[]];
  calibrationSelections: VoiceCalibrationSelectionSnapshot[];
  executionActor: GenerationResolverAttribution;
  createdAt: string;
}

export interface VoiceProfileFinalizationInput {
  expectedProfileRevision: number;
  voiceDNA: VoiceDNA;
  guardrails: VoiceGuardrails;
  contextModifiers: ContextModifier[];
  anchorSelectors: [VoiceAnchorSelector, ...VoiceAnchorSelector[]];
  calibrationSelections: VoiceCalibrationSelection[];
  idempotencyKey: string;
}

export interface FinalizeBrandVoiceRequest extends VoiceProfileFinalizationInput {
  workspaceId: string;
  finalizedBy: GenerationOperatorAttribution;
  executionActor: GenerationResolverAttribution;
  authorizationId?: string;
}

export interface FinalizeBrandVoiceResult {
  snapshot: FinalizedVoiceSnapshot;
  /** Current readiness; an exact replay after a later edit truthfully returns stale. */
  readiness: BrandVoiceReadiness;
  profileRevision: number;
  created: boolean;
  replayed: boolean;
}

export interface EligibleVoiceAnchor {
  selector: VoiceAnchorSelector;
  content: string;
  context: VoiceSampleContext;
  sourceLabel: string;
  capturedAt: string;
}

export interface BrandVoiceProfileSummary {
  id: string;
  revision: number;
  status: VoiceProfileStatus;
  voiceDNA?: VoiceDNA;
  guardrails?: VoiceGuardrails;
  contextModifiers: ContextModifier[];
  updatedAt: string;
}

export interface GetBrandVoiceResult {
  profile: BrandVoiceProfileSummary | null;
  readiness: BrandVoiceReadiness;
  eligibleAnchors: EligibleVoiceAnchor[];
  latestSnapshot: FinalizedVoiceSnapshot | null;
}

/** Exact operator-approved command stored before an MCP key may execute it. */
export interface CreateVoiceFinalizationAuthorizationRequest
  extends VoiceProfileFinalizationInput {
  workspaceId: string;
  authorizedBy: GenerationOperatorAttribution;
}

export interface VoiceFinalizationAuthorizationRef {
  authorizationId: string;
  workspaceId: string;
  voiceProfileId: string;
  expectedProfileRevision: number;
  authorizedBy: GenerationOperatorAttribution;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  finalizationId: string | null;
}

export interface CreateVoiceFinalizationAuthorizationResult {
  authorization: VoiceFinalizationAuthorizationRef;
  /** One-time bearer secret. Storage retains only its SHA-256 digest. */
  authorizationToken: string;
}

export interface ConsumeVoiceFinalizationAuthorizationRequest {
  workspaceId: string;
  authorizationToken: string;
  executionActor: GenerationResolverAttribution;
}
