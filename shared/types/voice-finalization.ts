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
  defaultEligibleAnchorPageSize: 25,
  maxEligibleAnchorPageSize: 100,
  maxAnchorCursorLength: 2_048,
  maxMutableProfileJsonBytes: 128 * 1024,
  authorizationTtlSeconds: 15 * 60,
} as const;

/** Frozen persistence codecs. Add a new version instead of mutating version 1. */
export const VOICE_FINALIZATION_SCHEMA_VERSIONS = {
  snapshot: 1,
  authorizationRequest: 1,
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

export type VoiceFinalizationExecutionAttribution = Omit<
  GenerationResolverAttribution,
  'actorType'
> & {
  actorType: 'operator' | 'mcp';
};

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
  executionActor: VoiceFinalizationExecutionAttribution;
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
  executionActor: VoiceFinalizationExecutionAttribution;
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

/** Bounded immutable-authority reference returned by the default MCP read. */
export interface FinalizedVoiceSnapshotSummary {
  id: string;
  voiceProfileId: string;
  profileRevision: number;
  voiceVersion: number;
  fingerprint: string;
  finalizedBy: GenerationOperatorAttribution;
  finalizedAt: string;
  anchorCount: number;
  calibrationSelectionCount: number;
}

export type BrandVoiceAuthorityReadiness =
  | Extract<BrandVoiceReadiness, { state: 'missing' }>
  | {
      state: 'finalized' | 'stale';
      snapshot: FinalizedVoiceSnapshotSummary;
      blockingReasons: string[];
    };

export interface BrandVoiceAuthorityProfileRef {
  id: string;
  revision: number;
  status: VoiceProfileStatus;
}

export interface GetBrandVoiceAuthoritySummaryResult {
  profile: BrandVoiceAuthorityProfileRef | null;
  readiness: BrandVoiceAuthorityReadiness;
  latestSnapshot: FinalizedVoiceSnapshotSummary | null;
}

export interface EligibleVoiceAnchorPage {
  items: EligibleVoiceAnchor[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Shared bounded readiness contract used by the HTTP and MCP read surfaces. */
export interface GetBrandVoicePageRequest {
  workspaceId: string;
  anchorLimit?: number;
  anchorCursor?: string;
}

export interface GetBrandVoicePageResult {
  profile: BrandVoiceProfileSummary | null;
  readiness: BrandVoiceAuthorityReadiness;
  eligibleAnchors: EligibleVoiceAnchorPage;
  latestSnapshot: FinalizedVoiceSnapshotSummary | null;
}

/** Strict B2 seam: exact immutable authority only, never eligible candidates. */
export interface GetFinalizedVoiceSnapshotForGenerationRequest {
  workspaceId: string;
  expectedVoiceVersion: number;
  expectedFingerprint: string;
  /** Start/resume require current parity; an active worker consumes its frozen version. */
  requireCurrentAuthority: boolean;
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
  /** Delegated authorization consumption is an MCP-only execution seam. */
  executionActor: Omit<VoiceFinalizationExecutionAttribution, 'actorType'> & {
    actorType: 'mcp';
  };
}
