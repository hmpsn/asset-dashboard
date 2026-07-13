/** Evidence classifications shared by matrix and brand generation. */
export const GENERATION_EVIDENCE_STATUSES = [
  'verified',
  'inferred',
  'missing',
  'conflicting',
  'creative_proposal',
] as const;

export type GenerationEvidenceStatus = (typeof GENERATION_EVIDENCE_STATUSES)[number];

/**
 * `preflight` blocks paid work, `ready` permits a typed placeholder but blocks
 * review readiness, and `optional_omit` removes unsupported optional detail.
 */
export const GENERATION_EVIDENCE_REQUIREMENT_STAGES = [
  'preflight',
  'ready',
  'optional_omit',
] as const;

export type GenerationEvidenceRequirementStage =
  (typeof GENERATION_EVIDENCE_REQUIREMENT_STAGES)[number];

export interface GenerationEvidenceStagePolicy {
  blocksPaidWork: boolean;
  permitsTypedPlaceholderWhenMissing: boolean;
  blocksReviewReady: boolean;
}

export const GENERATION_EVIDENCE_STAGE_POLICY = {
  preflight: {
    blocksPaidWork: true,
    permitsTypedPlaceholderWhenMissing: false,
    blocksReviewReady: true,
  },
  ready: {
    blocksPaidWork: false,
    permitsTypedPlaceholderWhenMissing: true,
    blocksReviewReady: true,
  },
  optional_omit: {
    blocksPaidWork: false,
    permitsTypedPlaceholderWhenMissing: false,
    blocksReviewReady: false,
  },
} as const satisfies Record<GenerationEvidenceRequirementStage, GenerationEvidenceStagePolicy>;

export const GENERATION_EVIDENCE_SOURCE_TYPES = [
  'client_submission',
  'operator_submission',
  'brand_intake',
  'brand_deliverable',
  'voice_sample',
  'voice_profile',
  'workspace_intelligence',
  'workspace_profile',
  'client_location',
  'content_matrix',
  'content_matrix_cell',
  'content_matrix_cell_evidence',
  'content_template',
  'seo_provider',
  'external_research',
  'operator_attestation',
] as const;

export type GenerationEvidenceSourceType = (typeof GENERATION_EVIDENCE_SOURCE_TYPES)[number];

/** Durable source identity only; raw private evidence is not embedded here. */
export interface GenerationEvidenceSourceRef {
  sourceType: GenerationEvidenceSourceType;
  sourceId: string;
  sourceRevision?: number;
  fieldPath?: string;
  label?: string;
  uri?: string;
  capturedAt: string;
}

interface GenerationEvidenceRequirementBase {
  id: string;
  fieldPath: string;
  claim: string;
  reason: string;
  requirementStage: GenerationEvidenceRequirementStage;
  /** Safe wording for a client/operator resolution prompt; never a raw prompt. */
  clientSafePrompt?: string;
}

/** Classification-specific source cardinality prevents unsupported facts from looking grounded. */
export type GenerationEvidenceRequirement =
  | (GenerationEvidenceRequirementBase & {
      status: 'verified';
      sourceRefs: [GenerationEvidenceSourceRef, ...GenerationEvidenceSourceRef[]];
    })
  | (GenerationEvidenceRequirementBase & {
      status: 'conflicting';
      sourceRefs: [
        GenerationEvidenceSourceRef,
        GenerationEvidenceSourceRef,
        ...GenerationEvidenceSourceRef[],
      ];
    })
  | (GenerationEvidenceRequirementBase & {
      status: 'missing';
      sourceRefs: [];
    })
  | (GenerationEvidenceRequirementBase & {
      status: 'inferred' | 'creative_proposal';
      sourceRefs: GenerationEvidenceSourceRef[];
    });

/** Placeholder rendering is legal only for a structured `missing + ready` requirement. */
export function canRenderGenerationPlaceholder(
  requirement: GenerationEvidenceRequirement,
): boolean {
  return requirement.status === 'missing' && requirement.requirementStage === 'ready';
}

/** Values accepted by version-safe evidence-resolution mutations. */
export type GenerationEvidenceValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number; unit?: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text_list'; value: string[] }
  | { kind: 'date'; value: string }
  | { kind: 'url'; value: string };

export interface GenerationResolverAttribution {
  actorType: 'operator' | 'client' | 'mcp' | 'system';
  actorId: string;
  actorLabel?: string;
}

export interface GenerationArtifactRevision {
  artifactType: 'content_brief' | 'generated_post' | 'brand_deliverable' | 'voice_profile' | 'brand_intake';
  artifactId: string;
  revision: number;
}

/**
 * A structured resolution. Editing rendered placeholder prose never creates
 * this record and therefore never resolves the underlying requirement.
 */
export interface GenerationEvidenceResolution<
  TSourceRevision = number,
  TArtifactRevisions = GenerationArtifactRevision[],
> {
  id: string;
  requirementId: string;
  value: GenerationEvidenceValue;
  sourceRef: GenerationEvidenceSourceRef;
  resolvedBy: GenerationResolverAttribution;
  expectedSourceRevision: TSourceRevision;
  expectedArtifactRevisions: TArtifactRevisions;
  resolvedAt: string;
}

export interface GenerationPlaceholderProjection {
  requirementId: string;
  token: `[NEEDS CLIENT INPUT: ${string}]`;
  prompt: string;
}

export const GENERATION_AUDIT_CHECK_RESULTS = [
  'passed',
  'failed',
  'needs_human_review',
  'not_applicable',
] as const;

export type GenerationAuditCheckResult = (typeof GENERATION_AUDIT_CHECK_RESULTS)[number];

export interface GenerationAuditCheck {
  id: string;
  category: string;
  result: GenerationAuditCheckResult;
  message: string;
  evidenceRequirementIds: string[];
}

export interface GenerationModelAuditFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  affectedTargetIds: string[];
  requiresHumanReview: boolean;
}

export const GENERATION_AUDIT_VERDICTS = [
  'ready_for_human_review',
  'needs_attention',
  'blocked_missing_evidence',
] as const;

export type GenerationAuditVerdict = (typeof GENERATION_AUDIT_VERDICTS)[number];

export interface GenerationAuditReport {
  deterministicChecks: GenerationAuditCheck[];
  modelFindings: GenerationModelAuditFinding[];
  humanRequiredChecks: GenerationAuditCheck[];
  revisionCount: number;
  unresolvedRequirementIds: string[];
  verdict: GenerationAuditVerdict;
  auditedAt: string;
}

/** Truthful domain-run outcomes shared by matrix and brand generation. */
export const GENERATION_RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_review',
  'completed',
  'completed_with_errors',
  'blocked',
  'conflict',
  'cancelled',
  'failed',
] as const;

export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number];

export interface GenerationRunCounts {
  selected: number;
  queued: number;
  running: number;
  readyForHumanReview: number;
  needsAttention: number;
  blocked: number;
  conflicts: number;
  failed: number;
  cancelled: number;
}

export interface GenerationSanitizedError {
  code: string;
  message: string;
  retryable: boolean;
  stage?: string;
}
