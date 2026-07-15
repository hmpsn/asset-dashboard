import type { BrandIntakeRevisionRef } from './brand-intake.js';
import type {
  ApprovedBrandDeliverableRef,
  BrandGenerationBudgetRequest,
  FinalizedVoiceSnapshotRef,
} from './brand-generation.js';
import type {
  GenerationHumanReviewerAttribution,
  GenerationResolverAttribution,
} from './generation-evidence.js';
import type {
  MatrixGenerationBatchBudget,
  MatrixGenerationInputSelection,
  MatrixSourceRevision,
} from './matrix-generation.js';
import type { McpToolExecutionContext } from './mcp-runtime.js';

export const BRAND_CONTENT_ONBOARDING_STATUSES = [
  'intake_ready',
  'brand_generating',
  'awaiting_voice_review',
  'awaiting_voice_finalization',
  'brand_generating_dependents',
  'awaiting_operator_review',
  'awaiting_client_review',
  'awaiting_content_authorization',
  'content_generating',
  'awaiting_content_review',
  'ready_to_publish',
  'needs_attention',
  'cancelled',
  'failed',
] as const;

export type BrandContentOnboardingStatus =
  (typeof BRAND_CONTENT_ONBOARDING_STATUSES)[number];

export const BRAND_CONTENT_ONBOARDING_GATES = [
  'intake_accepted',
  'voice_reviewed',
  'voice_finalized',
  'operator_brand_reviewed',
  'client_brand_reviewed',
  'content_authorized',
  'all_pages_approved',
  'publish_preconditions_passed',
] as const;

export type BrandContentOnboardingGate =
  (typeof BRAND_CONTENT_ONBOARDING_GATES)[number];

interface BrandContentOnboardingGateEvidenceBase {
  id: string;
  recordedBy: GenerationResolverAttribution;
  recordedAt: string;
}

export interface MatrixPageApprovalRef {
  approvalId: string;
  matrixRunId: string;
  matrixRunRevision: number;
  matrixItemId: string;
  matrixItemRevision: number;
  matrixId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  postId: string;
  postGenerationRevision: number;
  approvedBy: GenerationHumanReviewerAttribution;
  approvedAt: string;
}

/** Gate-specific proof; arbitrary IDs cannot masquerade as another gate. */
export type BrandContentOnboardingGateEvidence =
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'intake_accepted';
      intakeRevision: BrandIntakeRevisionRef;
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'voice_reviewed';
      brandRunId: string;
      foundationItemId: string;
      foundationItemRevision: number;
      reviewDeliverableId: string;
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'voice_finalized';
      voice: FinalizedVoiceSnapshotRef;
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'operator_brand_reviewed';
      brandRunId: string;
      brandRunRevision: number;
      reviewDeliverableId: string;
      reviewedItemIds: [string, ...string[]];
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'client_brand_reviewed';
      brandRunId: string;
      brandRunRevision: number;
      reviewDeliverableId: string;
      approvedItemIds: [string, ...string[]];
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'content_authorized';
      authorizationId: string;
      matrixSelectionFingerprint: string;
      authorizedCellIds: [string, ...string[]];
      authorizedBy: GenerationHumanReviewerAttribution;
      authorizedAt: string;
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'all_pages_approved';
      pageApprovals: [MatrixPageApprovalRef, ...MatrixPageApprovalRef[]];
    })
  | (BrandContentOnboardingGateEvidenceBase & {
      gate: 'publish_preconditions_passed';
      pageApprovalsFingerprint: string;
      preconditionCheckIds: [string, ...string[]];
      checkedAt: string;
    });

export interface BrandContentOnboardingInputs {
  intakeRevision: BrandIntakeRevisionRef;
  matrixSelection: MatrixGenerationInputSelection;
}

export interface BrandContentOnboardingChildren {
  brandRunId: string | null;
  voiceReviewDeliverableId: string | null;
  brandReviewDeliverableId: string | null;
  matrixRunId: string | null;
  pageApprovals: MatrixPageApprovalRef[];
}

export type BrandContentOnboardingResumeStatus = Exclude<
  BrandContentOnboardingStatus,
  'needs_attention' | 'cancelled' | 'failed' | 'ready_to_publish'
>;

/** Durable orchestration record; waiting human gates never keep a generic job running. */
export interface BrandContentOnboardingRun {
  id: string;
  workspaceId: string;
  status: BrandContentOnboardingStatus;
  revision: number;
  idempotencyKey: string;
  inputs: BrandContentOnboardingInputs;
  finalizedVoice: FinalizedVoiceSnapshotRef | null;
  approvedIdentity: ApprovedBrandDeliverableRef[];
  children: BrandContentOnboardingChildren;
  currentGate: BrandContentOnboardingGate | null;
  gateEvidence: BrandContentOnboardingGateEvidence[];
  attentionResumeStatus: BrandContentOnboardingResumeStatus | null;
  createdBy: GenerationResolverAttribution;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type PublicBrandContentOnboardingCreatorAttribution =
  | (GenerationResolverAttribution & { actorType: 'operator' | 'client' })
  | { actorType: 'mcp' | 'system' };

type PublicGateEvidenceProjection<T> = T extends BrandContentOnboardingGateEvidence
  ? Omit<T, 'recordedBy'> & {
      recordedBy: PublicBrandContentOnboardingCreatorAttribution;
    }
  : never;

export type PublicBrandContentOnboardingGateEvidence =
  PublicGateEvidenceProjection<BrandContentOnboardingGateEvidence>;

/** Safe HTTP/MCP projection; operational idempotency and MCP key identity stay private. */
export type PublicBrandContentOnboardingRun = Omit<
  BrandContentOnboardingRun,
  'idempotencyKey' | 'createdBy' | 'gateEvidence'
> & {
  createdBy: PublicBrandContentOnboardingCreatorAttribution;
  gateEvidence: PublicBrandContentOnboardingGateEvidence[];
};

export interface StartBrandContentOnboardingRequest {
  workspaceId: string;
  intakeRevisionId: string;
  expectedIntakeRevision: number;
  expectedIntakeFingerprint: string;
  matrixSelection: MatrixGenerationInputSelection;
  brandBudget: BrandGenerationBudgetRequest;
  idempotencyKey: string;
  startedBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}

export interface GetBrandContentOnboardingRequest {
  workspaceId: string;
  runId: string;
}

export interface BrandContentOnboardingCommandResult {
  run: PublicBrandContentOnboardingRun;
  advanced: boolean;
  replayed: boolean;
  /** Present only when this command accepted existing paid child work. */
  paidJobId: string | null;
}

export type StartBrandContentOnboardingResult = BrandContentOnboardingCommandResult;
export type ResumeBrandContentOnboardingResult = BrandContentOnboardingCommandResult;

export interface AuthorizeBrandContentGenerationRequest {
  workspaceId: string;
  runId: string;
  expectedRevision: number;
  expectedStatus: 'awaiting_content_authorization';
  authorizationId: string;
  expectedMatrixSelectionFingerprint: string;
  acceptedBudget: MatrixGenerationBatchBudget;
  idempotencyKey: string;
  authorizedBy: GenerationHumanReviewerAttribution;
}

export type AuthorizeBrandContentGenerationResult = BrandContentOnboardingCommandResult;

export interface ResumeBrandContentOnboardingRequest {
  workspaceId: string;
  runId: string;
  expectedRevision: number;
  expectedStatus: BrandContentOnboardingStatus;
  gateEvidenceId: string;
  idempotencyKey: string;
  resumedBy: GenerationResolverAttribution;
  mcpExecutionContext: McpToolExecutionContext | null;
}
