import type { GenerationProvenance } from './ai-execution.js';
import {
  BRAND_DELIVERABLE_TYPES,
  type BrandDeliverableType,
} from './brand-engine.js';
import type { BrandIntakeRevisionRef } from './brand-intake.js';
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
  idempotencyKey: string;
  effectiveInputFingerprint: string;
  jobId: string | null;
  voiceReadiness: BrandVoiceReadiness;
  counts: BrandGenerationRunCounts;
  createdBy: GenerationResolverAttribution;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type BrandGenerationRun = BrandGenerationRunBase & BrandGenerationRunSelectionPlan;

export type BrandGeneratedClaim =
  | {
      text: string;
      classification: 'factual';
      sourceRefs: [GenerationFactualEvidenceSourceRef, ...GenerationFactualEvidenceSourceRef[]];
    }
  | {
      text: string;
      classification: 'inferred' | 'creative_proposal';
      sourceRefs: GenerationEvidenceSourceRef[];
    };

interface BrandGenerationItemBase {
  id: string;
  runId: string;
  status: BrandGenerationItemStatus;
  revision: number;
  content: string | null;
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

type DurableBrandDeliverableLink =
  | { deliverableId: null; expectedDeliverableVersion: null }
  | { deliverableId: string; expectedDeliverableVersion: number };

/** A provisional foundation can never masquerade as a durable BrandDeliverable. */
export type BrandGenerationItem =
  | (BrandGenerationItemBase & {
      target: 'voice_foundation';
      deliverableId: null;
      expectedDeliverableVersion: null;
    })
  | (BrandGenerationItemBase & {
      target: BrandDeliverableType;
    } & DurableBrandDeliverableLink);

export interface BrandGenerationAttempt {
  id: string;
  itemId: string;
  attemptNumber: number;
  stage: BrandGenerationStage;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  effectiveInputFingerprint: string;
  provenance: GenerationProvenance | null;
  error: GenerationSanitizedError | null;
  startedAt: string;
  completedAt: string | null;
}

export const BRAND_REVIEW_ITEM_DECISIONS = ['approve', 'changes_requested'] as const;
export type BrandReviewDecision = (typeof BRAND_REVIEW_ITEM_DECISIONS)[number];

interface BrandReviewItemDecisionBase {
  runId: string;
  itemId: string;
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
