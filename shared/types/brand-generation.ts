import type { GenerationProvenance } from './ai-execution.js';
import {
  BRAND_DELIVERABLE_TYPES,
  type BrandDeliverableStatus,
  type ContextModifier,
  type BrandDeliverableType,
  type VoiceDNA,
  type VoiceGuardrails,
} from './brand-engine.js';
import type { BrandIntakeRevisionRef } from './brand-intake.js';
import type { McpToolExecutionContext } from './mcp-runtime.js';
import {
  type AuthenticVoiceEvidenceSourceRef,
  GENERATION_RUN_STATUSES,
  type GenerationAuditReport,
  type GenerationAutomaticRevisionCount,
  type GenerationEvidenceRequirement,
  type GenerationFactualEvidenceSourceRef,
  type GenerationEvidenceSourceRef,
  type GenerationHumanReviewerAttribution,
  type GenerationOperatorAttribution,
  type GenerationPlaceholderProjection,
  type GenerationResolverAttribution,
  type GenerationRunCounts,
  type GenerationSanitizedError,
} from './generation-evidence.js';

export const BRAND_GENERATION_CONTRACT_VERSION = 1 as const;

/**
 * Hard public and paid-work bounds for the first brand-generation runtime.
 * The provider/token ceilings cover the largest supported 19-target
 * bootstrap-plus-durable suite with generate/fallback + audit + one
 * revision/fallback + post-revision audit, while remaining a
 * finite reservation that can be enforced before every provider call.
 */
export const BRAND_GENERATION_LIMITS = {
  defaultItemPageSize: 25,
  maxItemPageSize: 100,
  maxTargets: BRAND_DELIVERABLE_TYPES.length + 1,
  maxProviderCalls: (BRAND_DELIVERABLE_TYPES.length + 1) * 6,
  maxInputTokens: 5_000_000,
  maxOutputTokens: 250_000,
  maxEstimatedUsdMicros: 100_000_000,
  maxConcurrency: 3,
  maxIdLength: 200,
  maxIdempotencyKeyLength: 200,
  maxCursorLength: 2_048,
  maxDirectionBytes: 2 * 1_024,
  /** Internal audit-derived direction after control stripping; human input keeps the larger bound. */
  maxAutomaticDirectionBytes: 512,
  maxContentBytes: 64 * 1_024,
  maxFoundationBytes: 128 * 1_024,
  maxSnapshotBytes: 512 * 1_024,
  /** Maximum exact provider instruction payload for any one reserved dispatch. */
  maxPromptBytes: 40 * 1_024,
  /** Acceptance keeps this much provider-envelope slack for finite wrapper/report drift. */
  providerStageClosureSafetyBytes: 512,
  /** Base generation prompt cap leaves deterministic headroom for audit/refinement. */
  maxBasePromptBytes: 24 * 1_024,
  /** Candidate core projected into refine/audit prompts; frozen requirements are supplied once. */
  maxCandidateSnapshotBytes: 4 * 1_024,
  /** Normalized durable candidate may also carry the frozen requirement/placeholder snapshot. */
  maxResolvedCandidateSnapshotBytes: 256 * 1_024,
  /** Cross-target consistency context is a bounded digest, never N full candidates. */
  maxRelatedCandidateContextBytes: 3 * 1_024,
  providerPromptFramingTokenCeiling: 512,
} as const;

export const BRAND_GENERATION_ATOMIC_TARGETS = [
  'voice_foundation',
  ...BRAND_DELIVERABLE_TYPES,
] as const;

export type BrandGenerationAtomicTarget =
  | 'voice_foundation'
  | BrandDeliverableType;

export type BrandTargetVoicePolicy = 'bootstrap' | 'requires_finalized_voice';

export interface BrandAtomicTargetPolicy {
  voicePolicy: BrandTargetVoicePolicy;
  persistence: 'run_item' | 'brand_deliverable';
  claimPolicy: 'creative_proposal' | 'mixed';
}

const REQUIRES_FINALIZED_VOICE = {
  voicePolicy: 'requires_finalized_voice',
  persistence: 'brand_deliverable',
  claimPolicy: 'mixed',
} as const;

/** Exhaustive policy for direct atomic dispatch. */
export const BRAND_DELIVERABLE_TARGET_POLICY = {
  voice_foundation: {
    voicePolicy: 'bootstrap',
    persistence: 'run_item',
    claimPolicy: 'mixed',
  },
  mission: REQUIRES_FINALIZED_VOICE,
  vision: REQUIRES_FINALIZED_VOICE,
  values: REQUIRES_FINALIZED_VOICE,
  tagline: {
    ...REQUIRES_FINALIZED_VOICE,
    claimPolicy: 'creative_proposal',
  },
  elevator_pitch: REQUIRES_FINALIZED_VOICE,
  archetypes: REQUIRES_FINALIZED_VOICE,
  personality_traits: REQUIRES_FINALIZED_VOICE,
  voice_guidelines: REQUIRES_FINALIZED_VOICE,
  tone_examples: REQUIRES_FINALIZED_VOICE,
  messaging_pillars: REQUIRES_FINALIZED_VOICE,
  differentiators: REQUIRES_FINALIZED_VOICE,
  positioning_matrix: REQUIRES_FINALIZED_VOICE,
  brand_story: REQUIRES_FINALIZED_VOICE,
  personas: REQUIRES_FINALIZED_VOICE,
  customer_journey: REQUIRES_FINALIZED_VOICE,
  objection_handling: REQUIRES_FINALIZED_VOICE,
  emotional_triggers: REQUIRES_FINALIZED_VOICE,
  naming: {
    ...REQUIRES_FINALIZED_VOICE,
    claimPolicy: 'creative_proposal',
  },
} as const satisfies Record<BrandGenerationAtomicTarget, BrandAtomicTargetPolicy>;

export const BRAND_GENERATION_PRESETS = [
  'identity_messaging',
  'audience',
  'full_brand_system',
] as const;

export type BrandGenerationPreset = (typeof BRAND_GENERATION_PRESETS)[number];
export type BrandGenerationPresetStartMode = 'requires_finalized_voice' | 'bootstrap_then_resume';

export interface BrandGenerationPresetPolicy {
  startMode: BrandGenerationPresetStartMode;
  initialTargets: readonly BrandGenerationAtomicTarget[];
  resumeTargets: readonly BrandGenerationAtomicTarget[];
}

export const IDENTITY_MESSAGING_TARGETS = [
  'mission',
  'vision',
  'values',
  'tagline',
  'elevator_pitch',
  'archetypes',
  'personality_traits',
  'voice_guidelines',
  'tone_examples',
  'messaging_pillars',
  'differentiators',
  'positioning_matrix',
  'brand_story',
  'naming',
] as const satisfies readonly BrandDeliverableType[];

export const AUDIENCE_TARGETS = [
  'personas',
  'customer_journey',
  'objection_handling',
  'emotional_triggers',
] as const satisfies readonly BrandDeliverableType[];

export const BRAND_GENERATION_PRESET_POLICY = {
  identity_messaging: {
    startMode: 'requires_finalized_voice',
    initialTargets: IDENTITY_MESSAGING_TARGETS,
    resumeTargets: [],
  },
  audience: {
    startMode: 'requires_finalized_voice',
    initialTargets: AUDIENCE_TARGETS,
    resumeTargets: [],
  },
  full_brand_system: {
    startMode: 'bootstrap_then_resume',
    initialTargets: ['voice_foundation'],
    resumeTargets: BRAND_DELIVERABLE_TYPES,
  },
} as const satisfies Record<BrandGenerationPreset, BrandGenerationPresetPolicy>;

export const BRAND_VOICE_READINESS_STATES = ['missing', 'provisional', 'finalized', 'stale'] as const;
export type BrandVoiceReadinessState = (typeof BRAND_VOICE_READINESS_STATES)[number];

/** Operator-selected proof that a source is authentic rather than generated output. */
export type AuthenticVoiceAnchorRef = AuthenticVoiceEvidenceSourceRef & {
  selectedBy: GenerationOperatorAttribution;
  selectedAt: string;
};

export interface FinalizedVoiceSnapshotRef {
  voiceProfileId: string;
  voiceVersion: number;
  finalizedBy: GenerationOperatorAttribution;
  finalizedAt: string;
  fingerprint: string;
  anchorEvidenceRefs: [AuthenticVoiceAnchorRef, ...AuthenticVoiceAnchorRef[]];
}

export interface ApprovedBrandDeliverableRef {
  deliverableId: string;
  deliverableType: BrandDeliverableType;
  version: number;
  approvedAt: string;
  contentFingerprint: string;
  approvalFingerprint: string;
}

export type BrandVoiceReadiness =
  | {
      state: 'missing';
      blockingReasons: [string, ...string[]];
    }
  | {
      state: 'provisional';
      foundationItemId: string;
      blockingReasons: [string, ...string[]];
    }
  | {
      state: 'finalized';
      snapshot: FinalizedVoiceSnapshotRef;
      blockingReasons: [];
    }
  | {
      state: 'stale';
      snapshot: FinalizedVoiceSnapshotRef;
      blockingReasons: [string, ...string[]];
    };

export const BRAND_GENERATION_RUN_STATUSES = GENERATION_RUN_STATUSES;

export type BrandGenerationRunStatus = (typeof BRAND_GENERATION_RUN_STATUSES)[number];

export const BRAND_GENERATION_ITEM_STATUSES = [
  'queued',
  'preflighting',
  'generating',
  'auditing_deterministic',
  'auditing_model',
  'revising',
  'ready_for_human_review',
  'approved',
  'changes_requested',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
  'cancelled',
  'failed',
] as const;

export type BrandGenerationItemStatus = (typeof BRAND_GENERATION_ITEM_STATUSES)[number];

export interface BrandGenerationRunCounts extends GenerationRunCounts {
  approved: number;
  changesRequested: number;
}

export interface BrandGenerationBudgetEstimate {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Integer micro-dollars for the bounded reservation, not an invoice. */
  estimatedCostMicros: number;
  maxConcurrency: number;
}

export interface BrandGenerationBudgetLimits {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  maxEstimatedCostMicros: number;
  maxConcurrency: number;
}

/** Durable committed reservation. Provider work must reserve before dispatch. */
export interface BrandGenerationBudgetUsage {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
}

export interface BrandGenerationBudget {
  estimate: BrandGenerationBudgetEstimate;
  limits: BrandGenerationBudgetLimits;
  reserved: BrandGenerationBudgetUsage;
}

export const BRAND_GENERATION_STAGES = [
  'preflight',
  'voice_foundation_generation',
  'awaiting_voice_review',
  'awaiting_voice_finalization',
  'dependent_generation',
  'deterministic_audit',
  'model_audit',
  'revision',
  'awaiting_operator_review',
  'complete',
] as const;

export type BrandGenerationStage = (typeof BRAND_GENERATION_STAGES)[number];

export type BrandGenerationSelection =
  | { kind: 'atomic'; target: BrandGenerationAtomicTarget }
  | { kind: 'preset'; preset: BrandGenerationPreset };

type BrandGenerationAtomicSelectionPlan = {
  [Target in BrandGenerationAtomicTarget]: {
    selection: { kind: 'atomic'; target: Target };
    selectedTargets: readonly [Target];
  };
}[BrandGenerationAtomicTarget];

type BrandGenerationPresetSelectionPlan =
  | {
      selection: { kind: 'preset'; preset: 'identity_messaging' };
      selectedTargets: typeof IDENTITY_MESSAGING_TARGETS;
    }
  | {
      selection: { kind: 'preset'; preset: 'audience' };
      selectedTargets: typeof AUDIENCE_TARGETS;
    }
  | {
      selection: { kind: 'preset'; preset: 'full_brand_system' };
      selectedTargets:
        | typeof BRAND_GENERATION_PRESET_POLICY.full_brand_system.initialTargets
        | typeof BRAND_GENERATION_PRESET_POLICY.full_brand_system.resumeTargets;
    };

/** Selection and current dispatch targets are one discriminated persisted contract. */
export type BrandGenerationRunSelectionPlan =
  | BrandGenerationAtomicSelectionPlan
  | BrandGenerationPresetSelectionPlan;

interface BrandGenerationRunBase {
  id: string;
  workspaceId: string;
  intakeRevision: BrandIntakeRevisionRef;
  status: BrandGenerationRunStatus;
  stage: BrandGenerationStage;
  revision: number;
  /** Immutable start/selection identity; never overwritten by resume. */
  selectionFingerprint: string;
  /** Immutable effective input identity captured by the initial command. */
  effectiveInputFingerprint: string;
  /** Current execution pointer only; immutable command jobs live in the command ledger. */
  currentJobId: string | null;
  voiceReadiness: BrandVoiceReadiness;
  counts: BrandGenerationRunCounts;
  budget: BrandGenerationBudget;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface PublicIdentifiedBrandGenerationCreator {
  actorId: string;
  actorLabel?: string;
}

/** Public run attribution never exposes MCP key identity or system internals. */
export type PublicBrandGenerationCreatorAttribution =
  | (PublicIdentifiedBrandGenerationCreator & { actorType: 'operator' })
  | (PublicIdentifiedBrandGenerationCreator & { actorType: 'client' })
  | { actorType: 'mcp' }
  | { actorType: 'system' };

/** Safe HTTP/MCP projection. Operational idempotency and key context are omitted. */
export type BrandGenerationRun = BrandGenerationRunBase
  & BrandGenerationRunSelectionPlan
  & { createdBy: PublicBrandGenerationCreatorAttribution };

/** Internal durable run. It must be projected before crossing a public boundary. */
export type PersistedBrandGenerationRun = BrandGenerationRunBase
  & BrandGenerationRunSelectionPlan
  & {
    idempotencyKey: string;
    createdBy: GenerationResolverAttribution;
    mcpExecutionContext: McpToolExecutionContext | null;
  };

export type BrandGeneratedClaim =
  | {
      text: string;
      classification: 'factual';
      evidenceKeys: [string, ...string[]];
      sourceRefs: [GenerationFactualEvidenceSourceRef, ...GenerationFactualEvidenceSourceRef[]];
    }
  | {
      text: string;
      classification: 'inferred';
      evidenceKeys: [string, ...string[]];
      sourceRefs: [GenerationFactualEvidenceSourceRef, ...GenerationFactualEvidenceSourceRef[]];
    }
  | {
      text: string;
      classification: 'creative_proposal';
      evidenceKeys: string[];
      sourceRefs: GenerationEvidenceSourceRef[];
    };

/** Structured provisional voice output. It is never a durable BrandDeliverable. */
export interface BrandVoiceFoundationDraft {
  schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
  summary: string;
  voiceDNA: VoiceDNA;
  guardrails: VoiceGuardrails;
  contextModifiers: ContextModifier[];
  evidenceRequirementIds: string[];
  fingerprint: string;
}

export type BrandDeliverableWriteExpectation =
  | {
      kind: 'create';
      deliverableId: null;
      expectedVersion: 0;
    }
  | {
      kind: 'update';
      deliverableId: string;
      expectedVersion: number;
    };

/** Small immutable authority envelope used to rebuild the exact paid prompt. */
export interface BrandGenerationTargetInputSnapshot {
  schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
  target: BrandGenerationAtomicTarget;
  intakeRevision: BrandIntakeRevisionRef;
  voiceSnapshot: FinalizedVoiceSnapshotRef | null;
  approvedDeliverables: ApprovedBrandDeliverableRef[];
  evidenceRequirementIds: string[];
  artifactExpectation: BrandDeliverableWriteExpectation | null;
  capturedAt: string;
  fingerprint: string;
}

interface BrandGenerationItemBase {
  id: string;
  runId: string;
  status: BrandGenerationItemStatus;
  revision: number;
  inputSnapshot: BrandGenerationTargetInputSnapshot | null;
  claims: BrandGeneratedClaim[];
  requirements: GenerationEvidenceRequirement[];
  placeholders: GenerationPlaceholderProjection[];
  auditReport: GenerationAuditReport | null;
  attemptCount: number;
  automaticRevisionCount: GenerationAutomaticRevisionCount;
  effectiveInputFingerprint: string | null;
  provenance: GenerationProvenance | null;
  error: GenerationSanitizedError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

type DurableBrandDeliverableCommit =
  | {
      committedDeliverableId: null;
      committedDeliverableVersion: null;
    }
  | {
      committedDeliverableId: string;
      committedDeliverableVersion: number;
    };

/** A provisional foundation can never masquerade as a durable BrandDeliverable. */
export type BrandGenerationItem =
  | (BrandGenerationItemBase & {
      target: 'voice_foundation';
      content: null;
      foundationDraft: BrandVoiceFoundationDraft | null;
      artifactExpectation: null;
      committedDeliverableId: null;
      committedDeliverableVersion: null;
    })
  | (BrandGenerationItemBase & {
      target: BrandDeliverableType;
      content: string | null;
      foundationDraft: null;
      artifactExpectation: BrandDeliverableWriteExpectation;
    } & DurableBrandDeliverableCommit);

export const BRAND_GENERATION_ATTEMPT_STAGES = [
  'preflight',
  'voice_foundation_generation',
  'dependent_generation',
  'deterministic_audit',
  'model_audit',
  'revision',
] as const;

export type BrandGenerationAttemptStage =
  (typeof BRAND_GENERATION_ATTEMPT_STAGES)[number];

export const BRAND_GENERATION_ATTEMPT_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type BrandGenerationAttemptStatus =
  (typeof BRAND_GENERATION_ATTEMPT_STATUSES)[number];

export interface BrandGenerationPreflightAttemptOutput {
  kind: 'preflight';
  readyForPaidWork: boolean;
  blockingRequirementIds: string[];
  requirements: GenerationEvidenceRequirement[];
  placeholders: GenerationPlaceholderProjection[];
  estimate: BrandGenerationBudgetEstimate;
}

interface BrandGenerationCandidateAttemptOutputBase {
  claims: BrandGeneratedClaim[];
  requirements: GenerationEvidenceRequirement[];
  placeholders: GenerationPlaceholderProjection[];
}

export type BrandGenerationFoundationCandidateAttemptOutput =
  BrandGenerationCandidateAttemptOutputBase & {
    kind: 'foundation_candidate';
    content: null;
    foundationDraft: BrandVoiceFoundationDraft;
  };

export type BrandGenerationDeliverableCandidateAttemptOutput =
  BrandGenerationCandidateAttemptOutputBase & {
    kind: 'deliverable_candidate';
    content: string;
    foundationDraft: null;
  };

/** Paid candidate retained even when the artifact CAS later conflicts. */
export type BrandGenerationCandidateAttemptOutput =
  | BrandGenerationFoundationCandidateAttemptOutput
  | BrandGenerationDeliverableCandidateAttemptOutput;

export interface BrandGenerationAuditAttemptOutput {
  kind: 'audit';
  auditReport: GenerationAuditReport;
}

interface BrandGenerationAttemptBase {
  id: string;
  runId: string;
  itemId: string;
  commandId: string;
  jobId: string;
  attemptNumber: number;
  expectedRunRevision: number;
  expectedItemRevision: number;
  expectedDeliverableVersion: number | null;
  /** Frozen authority/source snapshot shared by candidate and audit stages. */
  sourceInputFingerprint: string;
  /** Exact rendered prompt or deterministic stage input for this attempt. */
  effectiveInputFingerprint: string;
  budgetUsage: BrandGenerationBudgetUsage;
  provenance: GenerationProvenance | null;
  startedAt: string;
}

type BrandGenerationAttemptStageCheckpoint =
  | (BrandGenerationAttemptBase & {
      stage: 'preflight';
      output: BrandGenerationPreflightAttemptOutput | null;
    })
  | (BrandGenerationAttemptBase & {
      stage: 'voice_foundation_generation';
      output: BrandGenerationFoundationCandidateAttemptOutput | null;
    })
  | (BrandGenerationAttemptBase & {
      stage: 'dependent_generation' | 'revision';
      output: BrandGenerationDeliverableCandidateAttemptOutput | null;
    })
  | (BrandGenerationAttemptBase & {
      stage: 'deterministic_audit' | 'model_audit';
      output: BrandGenerationAuditAttemptOutput | null;
    });

type BrandGenerationAttemptLifecycle =
  | { status: 'running'; output: null; error: null; completedAt: null }
  | {
      status: 'completed';
      output:
        | BrandGenerationPreflightAttemptOutput
        | BrandGenerationCandidateAttemptOutput
        | BrandGenerationAuditAttemptOutput;
      error: null;
      completedAt: string;
    }
  | {
      status: 'failed';
      output: null;
      error: GenerationSanitizedError;
      completedAt: string;
    }
  | {
      status: 'cancelled';
      output: null;
      error: GenerationSanitizedError | null;
      completedAt: string;
    };

/** Stage output and lifecycle truth are both discriminated and must agree. */
export type BrandGenerationAttempt =
  BrandGenerationAttemptStageCheckpoint & BrandGenerationAttemptLifecycle;

type BootstrapBrandGenerationStartSelection =
  | {
      selection: { kind: 'atomic'; target: 'voice_foundation' };
      expectedVoiceVersion?: never;
      expectedVoiceFingerprint?: never;
    }
  | {
      selection: { kind: 'preset'; preset: 'full_brand_system' };
      expectedVoiceVersion?: never;
      expectedVoiceFingerprint?: never;
    };

type FinalizedVoiceBrandGenerationStartSelection =
  | {
      selection: {
        kind: 'atomic';
        target: Exclude<BrandGenerationAtomicTarget, 'voice_foundation'>;
      };
      expectedVoiceVersion: number;
      expectedVoiceFingerprint: string;
    }
  | {
      selection: { kind: 'preset'; preset: Exclude<BrandGenerationPreset, 'full_brand_system'> };
      expectedVoiceVersion: number;
      expectedVoiceFingerprint: string;
    };

export interface BrandGenerationBudgetRequest {
  maxProviderCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostMicros: number;
  maxConcurrency: number;
}

interface StartBrandGenerationRequestBase {
  workspaceId: string;
  intakeRevisionId: string;
  expectedIntakeRevision: number;
  expectedIntakeFingerprint: string;
  budget: BrandGenerationBudgetRequest;
  idempotencyKey: string;
  createdBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

/** Bootstrap starts omit voice; every durable direct/preset start requires an exact version. */
export type StartBrandGenerationRequest = StartBrandGenerationRequestBase & (
  | BootstrapBrandGenerationStartSelection
  | FinalizedVoiceBrandGenerationStartSelection
);

export interface BrandGenerationCommandResult {
  runId: string;
  runRevision: number;
  jobId: string;
  selectionCount: number;
  estimate: BrandGenerationBudgetEstimate;
  dashboardUrl: string;
  /** True only on an idempotent projection of an already-accepted command. */
  existing: boolean;
}

/** Immutable accepted result; replay adds `existing: true` at the response edge. */
export type BrandGenerationAcceptedCommandResult = Omit<
  BrandGenerationCommandResult,
  'existing'
>;

export const BRAND_GENERATION_COMMAND_KINDS = ['start', 'resume', 'revision'] as const;
export type BrandGenerationCommandKind = (typeof BRAND_GENERATION_COMMAND_KINDS)[number];

export const BRAND_GENERATION_REVISION_SOURCE_STATUSES = [
  'ready_for_human_review',
  'changes_requested',
  'needs_attention',
  'conflict',
] as const satisfies readonly BrandGenerationItemStatus[];

export type BrandGenerationRevisionSourceStatus =
  (typeof BRAND_GENERATION_REVISION_SOURCE_STATUSES)[number];

type DistributiveOmit<T, Keys extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, Keys>>
  : never;

/** Business identity only; actor, request correlation, and idempotency live beside it. */
export type StartBrandGenerationCommandSnapshot = DistributiveOmit<
  StartBrandGenerationRequest,
  'idempotencyKey' | 'createdBy' | 'mcpExecutionContext'
>;
export type ResumeBrandGenerationCommandSnapshot = DistributiveOmit<
  ResumeBrandGenerationRequest,
  'idempotencyKey' | 'resumedBy' | 'mcpExecutionContext'
>;
export type ReviseBrandGenerationItemCommandSnapshot = DistributiveOmit<
  ReviseBrandGenerationItemRequest,
  'idempotencyKey' | 'requestedBy' | 'mcpExecutionContext'
>;

interface BrandGenerationCommandBase {
  id: string;
  runId: string;
  workspaceId: string;
  kind: BrandGenerationCommandKind;
  idempotencyKey: string;
  requestFingerprint: string;
  jobId: string;
  result: BrandGenerationAcceptedCommandResult;
  actor: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
  createdAt: string;
}

/** Immutable command/result ledger makes every accepted write exactly replayable. */
export type BrandGenerationCommand =
  | (BrandGenerationCommandBase & {
      kind: 'start';
      requestSnapshot: {
        schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
        kind: 'start';
        command: StartBrandGenerationCommandSnapshot;
      };
      itemId: null;
      expectedRunRevision: null;
      expectedItemRevision: null;
      expectedDeliverableVersion: null;
      priorItemStatus: null;
    })
  | (BrandGenerationCommandBase & {
      kind: 'resume';
      requestSnapshot: {
        schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
        kind: 'resume';
        command: ResumeBrandGenerationCommandSnapshot;
      };
      itemId: null;
      expectedRunRevision: number;
      expectedItemRevision: null;
      expectedDeliverableVersion: null;
      priorItemStatus: null;
    })
  | (BrandGenerationCommandBase & {
      kind: 'revision';
      requestSnapshot: {
        schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
        kind: 'revision';
        command: ReviseBrandGenerationItemCommandSnapshot;
      };
      itemId: string;
      expectedRunRevision: number;
      expectedItemRevision: number;
      expectedDeliverableVersion: number;
      priorItemStatus: BrandGenerationRevisionSourceStatus;
    });

export const BRAND_GENERATION_EFFECT_KINDS = [
  'command_accepted',
  'artifact_committed',
  'command_completed',
] as const;

export type BrandGenerationEffectKind =
  (typeof BRAND_GENERATION_EFFECT_KINDS)[number];

export type BrandGenerationEffectPayload =
  | {
      schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
      kind: 'command_accepted';
    }
  | {
      schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
      kind: 'artifact_committed';
      deliverableId: string;
      deliverableType: BrandDeliverableType;
      deliverableVersion: number;
      deliverableStatus: BrandDeliverableStatus;
    }
  | {
      schemaVersion: typeof BRAND_GENERATION_CONTRACT_VERSION;
      kind: 'command_completed';
      status: BrandGenerationRunStatus;
      counts: BrandGenerationRunCounts;
    };

interface BrandGenerationEffectEventBase {
  sequence: number;
  effectKey: string;
  workspaceId: string;
  runId: string;
  commandId: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  appliedAt: string | null;
  createdAt: string;
}

/** Durable transactional-outbox event for post-commit activity and invalidation. */
export type BrandGenerationEffectEvent =
  | (BrandGenerationEffectEventBase & {
      kind: 'command_accepted';
      itemId: null;
      payload: Extract<BrandGenerationEffectPayload, { kind: 'command_accepted' }>;
    })
  | (BrandGenerationEffectEventBase & {
      kind: 'artifact_committed';
      itemId: string;
      payload: Extract<BrandGenerationEffectPayload, { kind: 'artifact_committed' }>;
    })
  | (BrandGenerationEffectEventBase & {
      kind: 'command_completed';
      itemId: null;
      payload: Extract<BrandGenerationEffectPayload, { kind: 'command_completed' }>;
    });

export interface BrandGenerationEffectCursor {
  sequence: number;
}

export type StartBrandGenerationResult = BrandGenerationCommandResult;

export interface ResumeBrandGenerationRequest {
  workspaceId: string;
  runId: string;
  expectedRunRevision: number;
  expectedVoiceVersion: number;
  expectedVoiceFingerprint: string;
  idempotencyKey: string;
  resumedBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

export type ResumeBrandGenerationResult = BrandGenerationCommandResult;

export interface GetBrandGenerationRequest {
  workspaceId: string;
  runId: string;
  cursor?: string;
  limit?: number;
}

export interface BrandGenerationItemPage {
  items: BrandGenerationItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GetBrandGenerationResult {
  run: BrandGenerationRun;
  itemPage: BrandGenerationItemPage;
}

export interface ReviseBrandGenerationItemRequest {
  workspaceId: string;
  runId: string;
  itemId: string;
  expectedRunRevision: number;
  expectedItemRevision: number;
  deliverableId: string;
  expectedDeliverableVersion: number;
  direction: string;
  idempotencyKey: string;
  requestedBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

export type ReviseBrandGenerationItemResult = BrandGenerationCommandResult;

/** The generic background job never stores generated content or audit reports. */
export interface BrandGenerationJobResult {
  runId: string;
  counts: BrandGenerationRunCounts;
  terminalStatus: BrandGenerationRunStatus;
}

export const BRAND_REVIEW_ITEM_DECISIONS = ['approve', 'changes_requested'] as const;
export type BrandReviewDecision = (typeof BRAND_REVIEW_ITEM_DECISIONS)[number];

/** Evolves independently from the paid-generation persistence contract above. */
export const BRAND_REVIEW_CONTRACT_VERSION = 1 as const;

export const BRAND_REVIEW_BUNDLE_KINDS = ['voice_foundation', 'brand_suite'] as const;
export type BrandReviewBundleKind = (typeof BRAND_REVIEW_BUNDLE_KINDS)[number];

export const BRAND_REVIEW_MIRROR_ITEM_STATUSES = [
  'awaiting_client',
  'approved',
  'changes_requested',
] as const;
export type BrandReviewMirrorItemStatus =
  (typeof BRAND_REVIEW_MIRROR_ITEM_STATUSES)[number];

interface BrandReviewItemDecisionBase {
  runId: string;
  itemId: string;
  expectedGenerationItemRevision: number;
  resultingGenerationItemRevision: number;
  deliverableId: string;
  deliverableType: BrandDeliverableType;
  expectedDeliverableVersion: number;
  decidedAt: string;
}

/** Review is always human; a changes request is never allowed to lose its note. */
export type BrandReviewItemDecision = BrandReviewItemDecisionBase & (
  | {
      decision: 'approve';
      note?: string;
      decidedBy: GenerationHumanReviewerAttribution;
    }
  | {
      decision: 'changes_requested';
      note: string;
      decidedBy: GenerationHumanReviewerAttribution;
    }
);

interface BrandVoiceFoundationReviewDecisionBase {
  runId: string;
  itemId: string;
  expectedGenerationItemRevision: number;
  resultingGenerationItemRevision: number;
  decidedAt: string;
}

/**
 * Client feedback on the provisional foundation is durable review evidence only.
 * It never approves or finalizes a VoiceProfile and never masquerades as a
 * BrandDeliverable decision.
 */
export type BrandVoiceFoundationReviewDecision =
  BrandVoiceFoundationReviewDecisionBase & (
    | {
        decision: 'approve';
        note?: string;
        decidedBy: GenerationHumanReviewerAttribution;
      }
    | {
        decision: 'changes_requested';
        note: string;
        decidedBy: GenerationHumanReviewerAttribution;
      }
  );

export type BrandReviewPersistedDecision =
  | BrandReviewItemDecision
  | BrandVoiceFoundationReviewDecision;

/** The only client-authored decision shape accepted by the review boundary. */
export type BrandReviewClientDecisionRequest =
  | {
      deliverableItemId: string;
      /** Opaque CAS token for the exact review projection the client saw. */
      reviewToken: string;
      decision: 'approve';
      note?: string;
    }
  | {
      deliverableItemId: string;
      /** Opaque CAS token for the exact review projection the client saw. */
      reviewToken: string;
      decision: 'changes_requested';
      note: string;
    };

/**
 * Version-frozen server input consumed by the unified deliverable adapter.
 * Requirement IDs are validation-only and are deliberately not serialized into
 * the client-facing projection.
 */
interface BrandReviewMirrorItemInputBase {
  clientItemId?: string;
  createdAt?: string;
  generationItemId: string;
  generationItemRevision: number;
  content: string;
  mirrorStatus: BrandReviewMirrorItemStatus;
  unresolvedRequirementIds: string[];
  hasCanonicalPlaceholder: boolean;
}

export interface BrandVoiceFoundationReviewMirrorItemInput
  extends BrandReviewMirrorItemInputBase {
  target: 'voice_foundation';
  generationStatus: 'ready_for_human_review';
  sourceDeliverableId: null;
  sourceDeliverableVersion: null;
  sourceDeliverableStatus: null;
  decision: BrandVoiceFoundationReviewDecision | null;
}

export interface BrandSuiteReviewMirrorItemInput extends BrandReviewMirrorItemInputBase {
  target: BrandDeliverableType;
  generationStatus: Extract<
    BrandGenerationItemStatus,
    'ready_for_human_review' | 'approved' | 'changes_requested'
  >;
  sourceDeliverableId: string;
  sourceDeliverableVersion: number;
  sourceDeliverableStatus: BrandDeliverableStatus;
  decision: BrandReviewItemDecision | null;
}

export type BrandReviewMirrorItemInput =
  | BrandVoiceFoundationReviewMirrorItemInput
  | BrandSuiteReviewMirrorItemInput;

interface BrandReviewDeliverableInputBase {
  runId: string;
  runRevision: number;
}

export type BrandReviewDeliverableInput = BrandReviewDeliverableInputBase & (
  | {
      reviewKind: 'voice_foundation';
      items: [BrandVoiceFoundationReviewMirrorItemInput];
    }
  | {
      reviewKind: 'brand_suite';
      items: [BrandSuiteReviewMirrorItemInput, ...BrandSuiteReviewMirrorItemInput[]];
    }
);

/** Private persisted payload; public serializers must project the safe types below. */
export interface BrandReviewBundlePayload {
  schemaVersion: typeof BRAND_REVIEW_CONTRACT_VERSION;
  family: 'brand_generation';
  reviewKind: BrandReviewBundleKind;
  runId: string;
  runRevision: number;
}

interface BrandReviewItemPayloadBase extends BrandReviewBundlePayload {
  generationItemId: string;
  generationItemRevision: number;
}

/** Private persisted child payload used for source/generation CAS decisions. */
export type BrandReviewItemPayload = BrandReviewItemPayloadBase & (
  | {
      reviewKind: 'voice_foundation';
      target: 'voice_foundation';
      sourceDeliverableId: null;
      expectedDeliverableVersion: null;
      decision: BrandVoiceFoundationReviewDecision | null;
    }
  | {
      reviewKind: 'brand_suite';
      target: BrandDeliverableType;
      sourceDeliverableId: string;
      expectedDeliverableVersion: number;
      decision: BrandReviewItemDecision | null;
    }
);

interface ClientBrandReviewPayloadBase {
  schemaVersion: typeof BRAND_REVIEW_CONTRACT_VERSION;
  family: 'brand_generation';
}

/** Safe payload exposed through the authenticated client Inbox read. */
export type ClientBrandReviewBundlePayload = ClientBrandReviewPayloadBase & (
  | { reviewKind: 'voice_foundation' }
  | { reviewKind: 'brand_suite' }
);

/** Safe child metadata; excludes run/source IDs, versions, actor data, and evidence. */
export type ClientBrandReviewItemPayload = ClientBrandReviewPayloadBase & (
  | { reviewKind: 'voice_foundation'; target: 'voice_foundation'; reviewToken: string }
  | { reviewKind: 'brand_suite'; target: BrandDeliverableType; reviewToken: string }
);

export interface BrandReviewDeliverableReceipt {
  deliverableId: string;
  reviewKind: BrandReviewBundleKind;
  runId: string;
  runRevision: number;
  status: 'awaiting_client' | 'partial' | 'approved' | 'changes_requested';
  itemCount: number;
  existing: boolean;
}

interface BrandReviewDecisionReceiptBase {
  reviewDeliverableId: string;
  runId: string;
  runRevision: number;
  previousGenerationItemRevision: number;
  generationItemRevision: number;
  bundleStatus: 'partial' | 'approved' | 'changes_requested';
}

/** Durable, kind-safe human-review evidence for the future onboarding orchestrator. */
export type BrandReviewDecisionReceipt = BrandReviewDecisionReceiptBase & (
  | {
      reviewKind: 'voice_foundation';
      sourceDeliverableVersion: null;
      decision: BrandVoiceFoundationReviewDecision;
    }
  | {
      reviewKind: 'brand_suite';
      sourceDeliverableVersion: number;
      decision: BrandReviewItemDecision;
    }
);

/**
 * Explicit allowlist returned to the authenticated client after one item-level
 * decision. Run/source identities, revisions, evidence, and reviewer attribution
 * remain private to the durable review ledger.
 */
export interface ClientBrandReviewDecisionReceipt {
  reviewDeliverableId: string;
  deliverableItemId: string;
  itemStatus: 'approved' | 'changes_requested';
  bundleStatus: 'partial' | 'approved' | 'changes_requested';
}

/** Deliberately excludes intake, prompts, evidence internals, and draft output. */
export interface ClientBrandSummary {
  workspaceId: string;
  approvedDeliverables: Array<{
    deliverableType: BrandDeliverableType;
    content: string;
    version: number;
  }>;
  voiceSummary: string | null;
  updatedAt: string;
}
