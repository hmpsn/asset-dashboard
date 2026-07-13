import type { GenerationProvenance } from './ai-execution.js';
import {
  TEMPLATE_SECTION_GENERATION_ROLES,
  type BriefPageType,
  type TemplateAeoContract,
  type TemplateCtaContract,
  type TemplateSectionGenerationRole,
} from './content.js';
import type {
  ApprovedBrandDeliverableRef,
  FinalizedVoiceSnapshotRef,
} from './brand-generation.js';
import {
  GENERATION_RUN_STATUSES,
  type GenerationAuditReport,
  type GenerationEvidenceRequirement,
  type GenerationEvidenceResolution,
  type GenerationEvidenceSourceRef,
  type GenerationEvidenceValue,
  type GenerationRunCounts,
  type GenerationRunStatus,
  type GenerationSanitizedError,
  type GenerationResolverAttribution,
} from './generation-evidence.js';

export interface MatrixSourceRevision {
  matrixRevision: number;
  templateRevision: number;
  cellRevision: number;
}

export const MATRIX_GENERATION_RUN_STATUSES = GENERATION_RUN_STATUSES;
export type MatrixGenerationRunStatus = (typeof MATRIX_GENERATION_RUN_STATUSES)[number];

export const RESOLVED_PAGE_BLOCK_SOURCES = ['system', 'template'] as const;
export type ResolvedPageBlockSource = (typeof RESOLVED_PAGE_BLOCK_SOURCES)[number];

export const RESOLVED_PAGE_BLOCK_GENERATION_ROLES = [
  'introduction',
  ...TEMPLATE_SECTION_GENERATION_ROLES,
  'conclusion',
] as const;

export type ResolvedPageBlockGenerationRole =
  | 'introduction'
  | TemplateSectionGenerationRole
  | 'conclusion';

export const RESOLVED_SYSTEM_BLOCK_IDS = {
  introduction: 'system:introduction',
  conclusion: 'system:conclusion',
} as const;

export interface ResolvedPageBlockHeadingContract {
  level: 1 | 2 | 3 | 4 | 5 | 6 | null;
  renderedText: string | null;
  locked: boolean;
}

interface ResolvedPageBlockBase {
  order: number;
  heading: ResolvedPageBlockHeadingContract;
  guidance: string;
  wordCountTarget?: number;
  aeoContract: TemplateAeoContract;
  ctaContract: TemplateCtaContract;
}

export interface ResolvedSystemIntroductionBlock extends ResolvedPageBlockBase {
  id: typeof RESOLVED_SYSTEM_BLOCK_IDS.introduction;
  source: 'system';
  generationRole: 'introduction';
}

export interface ResolvedTemplatePageBlock extends ResolvedPageBlockBase {
  id: `template:${string}`;
  source: 'template';
  sourceSectionId: string;
  generationRole: TemplateSectionGenerationRole;
}

export interface ResolvedSystemConclusionBlock extends ResolvedPageBlockBase {
  id: typeof RESOLVED_SYSTEM_BLOCK_IDS.conclusion;
  source: 'system';
  generationRole: 'conclusion';
}

export type ResolvedPageBlock =
  | ResolvedSystemIntroductionBlock
  | ResolvedTemplatePageBlock
  | ResolvedSystemConclusionBlock;

export type ResolvedPageBlockSequence = [
  ResolvedSystemIntroductionBlock,
  ...ResolvedTemplatePageBlock[],
  ResolvedSystemConclusionBlock,
];

/** Complete immutable block census, including stable system wrappers. */
export interface ResolvedPageBlockManifest {
  generationContractVersion: number;
  blocks: ResolvedPageBlockSequence;
  totalWordCountTarget: number;
  fingerprint: string;
}

export interface ResolvedMatrixKeyword {
  value: string;
  source: 'target' | 'custom' | 'recommended';
  evidenceRefs: GenerationEvidenceSourceRef[];
  validation?: {
    volume: number;
    difficulty: number;
    cpc: number;
    validatedAt: string;
  };
}

export interface ResolvedMatrixStructuralTarget {
  workspaceId: string;
  matrixId: string;
  templateId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  variableValues: Record<string, string>;
  slugSubstitutions: Record<string, string>;
  proseSubstitutions: Record<string, string>;
  targetKeyword: ResolvedMatrixKeyword;
  plannedUrl: string;
  title: string;
  metaDescription: string;
  renderedHeadings: string[];
  pageType: BriefPageType;
  schemaTypes: string[];
  blockManifest: ResolvedPageBlockManifest;
  generationContractVersion: number;
  structuralRequirements: GenerationEvidenceRequirement[];
  structuralBlockingRequirementIds: string[];
  structuralFingerprint: string;
}

export interface MatrixGenerationCostEstimate {
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  maxConcurrency: number;
}

export interface MatrixArtifactRevisionExpectations {
  brief: {
    artifactType: 'content_brief';
    artifactId: string | null;
    generationRevision: number;
  };
  post: {
    artifactType: 'generated_post';
    artifactId: string | null;
    generationRevision: number;
  };
}

/** M1-ready target; this is the first shape allowed to claim generation readiness. */
export interface MatrixGenerationPreviewTarget extends ResolvedMatrixStructuralTarget {
  voiceSnapshot: FinalizedVoiceSnapshotRef;
  identitySnapshot: ApprovedBrandDeliverableRef[];
  evidenceRequirements: GenerationEvidenceRequirement[];
  evidenceCapturedAt: string;
  evidenceFreshThrough: string;
  expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
  effectiveInputFingerprint: string;
  blockingRequirementIds: string[];
  estimatedPaidBudget: MatrixGenerationCostEstimate;
}

export interface ContentTemplateGenerationUpgradeProposal {
  templateId: string;
  expectedTemplateRevision: number;
  proposalFingerprint: string;
  generationContractVersion: number;
  blocks: ResolvedPageBlockSequence;
  blockers: GenerationEvidenceRequirement[];
}

export const MATRIX_GENERATION_ITEM_STATUSES = [
  'queued',
  'preflighting',
  'preflighted',
  'generating_brief',
  'generating_post',
  'auditing_deterministic',
  'auditing_model',
  'revising',
  'ready_for_human_review',
  'needs_attention',
  'blocked_missing_evidence',
  'conflict',
  'cancelled',
  'failed',
] as const;

export type MatrixGenerationItemStatus = (typeof MATRIX_GENERATION_ITEM_STATUSES)[number];

export const MATRIX_GENERATION_STAGES = [
  'preflight',
  'brief_generation',
  'post_generation',
  'deterministic_audit',
  'model_audit',
  'revision',
] as const;

export type MatrixGenerationStage = (typeof MATRIX_GENERATION_STAGES)[number];

export interface MatrixGenerationSelectionItem {
  matrixId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  structuralFingerprint: string;
  previewFingerprint: string | null;
}

export type MatrixGenerationEvidenceResolution = GenerationEvidenceResolution<
  MatrixSourceRevision,
  MatrixArtifactRevisionExpectations
> & {
  workspaceId: string;
  matrixId: string;
  cellId: string;
};

/** Cell-addressed mutation contract; it is valid before a generation run exists. */
export interface ResolveMatrixGenerationEvidenceRequest {
  workspaceId: string;
  matrixId: string;
  cellId: string;
  requirementId: string;
  value: GenerationEvidenceValue;
  sourceRef: GenerationEvidenceSourceRef;
  resolvedBy: GenerationResolverAttribution;
  expectedSourceRevision: MatrixSourceRevision;
  expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
  idempotencyKey: string;
}

export interface MatrixGenerationRun {
  id: string;
  workspaceId: string;
  matrixId: string;
  templateId: string;
  status: GenerationRunStatus;
  revision: number;
  idempotencyKey: string;
  selectionFingerprint: string;
  selections: MatrixGenerationSelectionItem[];
  jobId: string | null;
  counts: GenerationRunCounts;
  createdBy: GenerationResolverAttribution;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MatrixGenerationItem {
  id: string;
  runId: string;
  workspaceId: string;
  matrixId: string;
  cellId: string;
  sourceRevision: MatrixSourceRevision;
  status: MatrixGenerationItemStatus;
  revision: number;
  structuralTarget: ResolvedMatrixStructuralTarget | null;
  previewTarget: MatrixGenerationPreviewTarget | null;
  briefId: string | null;
  postId: string | null;
  auditReport: GenerationAuditReport | null;
  attemptCount: number;
  automaticRevisionCount: number;
  error: GenerationSanitizedError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MatrixGenerationAttempt {
  id: string;
  itemId: string;
  attemptNumber: number;
  stage: MatrixGenerationStage;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  effectiveInputFingerprint: string;
  provenance: GenerationProvenance | null;
  error: GenerationSanitizedError | null;
  startedAt: string;
  completedAt: string | null;
}

export interface RetryMatrixGenerationItem {
  itemId: string;
  expectedItemRevision: number;
  sourceRevision: MatrixSourceRevision;
  expectedArtifactRevisions: MatrixArtifactRevisionExpectations;
  reusableCheckpointFingerprint: string | null;
}

interface MatrixGenerationRetryRequestBase {
  runId: string;
  expectedRunRevision: number;
  items: [RetryMatrixGenerationItem, ...RetryMatrixGenerationItem[]];
  idempotencyKey: string;
}

export interface MatrixGenerationReplacementAuthorization {
  authorizedBy: GenerationResolverAttribution;
  reason: string;
  authorizedAt: string;
}

export type RetryMatrixGenerationRequest =
  | (MatrixGenerationRetryRequestBase & {
      mode: 'resume';
      replacementAuthorization?: never;
    })
  | (MatrixGenerationRetryRequestBase & {
      mode: 'replace';
      replacementAuthorization: MatrixGenerationReplacementAuthorization;
    });
