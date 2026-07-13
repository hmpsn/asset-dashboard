import type { AuthenticVoiceSampleSource } from './brand-engine.js';

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

/** Matrix/template identity proves structure, never a business fact. */
export const STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES = [
  'content_matrix',
  'content_matrix_cell',
  'content_template',
] as const satisfies readonly GenerationEvidenceSourceType[];

export type StructuralOnlyGenerationEvidenceSourceType =
  (typeof STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES)[number];

export type GenerationFactualEvidenceSourceType = Exclude<
  GenerationEvidenceSourceType,
  StructuralOnlyGenerationEvidenceSourceType
>;

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

/** Source identity allowed to support a factual generated claim. */
export type GenerationFactualEvidenceSourceRef = Omit<
  GenerationEvidenceSourceRef,
  'sourceType'
> & {
  sourceType: GenerationFactualEvidenceSourceType;
};

/** Source classes allowed to back an authentic voice sample or anchor. */
export const AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES = [
  'client_submission',
  'operator_submission',
  'brand_intake',
  'voice_sample',
  'external_research',
] as const;

export type AuthenticVoiceEvidenceSourceType =
  (typeof AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES)[number];

/**
 * A voice source that is independent of generated brand/page output. Generated
 * deliverables, voice profiles, matrix structure, and templates cannot qualify.
 */
type AuthenticVoiceEvidenceSourceRefBase = Omit<
  GenerationEvidenceSourceRef,
  'sourceType'
>;

export type AuthenticVoiceEvidenceSourceRef =
  | (AuthenticVoiceEvidenceSourceRefBase & {
      sourceType: Exclude<AuthenticVoiceEvidenceSourceType, 'voice_sample'>;
      voiceSampleSource?: never;
    })
  | (AuthenticVoiceEvidenceSourceRefBase & {
      sourceType: 'voice_sample';
      /** Generated calibration/approval samples are deliberately excluded. */
      voiceSampleSource: AuthenticVoiceSampleSource;
    });

interface GenerationEvidenceRequirementBase {
  id: string;
  fieldPath: string;
  claim: string;
  reason: string;
  requirementStage: GenerationEvidenceRequirementStage;
  /** Safe wording for a client/operator resolution prompt; never a raw prompt. */
  clientSafePrompt?: string;
}

type SourceBackedGenerationEvidenceRequirement<
  TClaimKind extends 'factual' | 'structural',
  TSourceRef extends GenerationEvidenceSourceRef,
> =
  | (GenerationEvidenceRequirementBase & {
      claimKind: TClaimKind;
      status: 'verified';
      sourceRefs: [TSourceRef, ...TSourceRef[]];
    })
  | (GenerationEvidenceRequirementBase & {
      claimKind: TClaimKind;
      status: 'conflicting';
      sourceRefs: [
        TSourceRef,
        TSourceRef,
        ...TSourceRef[],
      ];
    })
  | (GenerationEvidenceRequirementBase & {
      claimKind: TClaimKind;
      status: 'missing';
      sourceRefs: [];
    })
  | (GenerationEvidenceRequirementBase & {
      claimKind: TClaimKind;
      status: 'inferred';
      sourceRefs: TSourceRef[];
    });

/** Classification-specific source cardinality prevents unsupported facts from looking grounded. */
export type GenerationEvidenceRequirement =
  | SourceBackedGenerationEvidenceRequirement<
      'factual',
      GenerationFactualEvidenceSourceRef
    >
  | SourceBackedGenerationEvidenceRequirement<
      'structural',
      GenerationEvidenceSourceRef
    >
  | (GenerationEvidenceRequirementBase & {
      claimKind: 'creative';
      status: 'creative_proposal';
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

export type GenerationOperatorAttribution = GenerationResolverAttribution & {
  actorType: 'operator';
};

export type GenerationHumanReviewerAttribution = GenerationResolverAttribution & {
  actorType: 'operator' | 'client';
};

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

export type GenerationHumanRequiredAuditCheck = Omit<GenerationAuditCheck, 'result'> & {
  /** AI/deterministic paths may route or omit this check, never auto-pass it. */
  result: 'needs_human_review' | 'not_applicable';
};

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

export const GENERATION_AUTOMATIC_REVISION_COUNTS = [0, 1] as const;
export type GenerationAutomaticRevisionCount =
  (typeof GENERATION_AUTOMATIC_REVISION_COUNTS)[number];

interface GenerationAuditReportBase {
  deterministicChecks: GenerationAuditCheck[];
  modelFindings: GenerationModelAuditFinding[];
  humanRequiredChecks: GenerationHumanRequiredAuditCheck[];
  revisionCount: GenerationAutomaticRevisionCount;
  auditedAt: string;
}

type GenerationReadyDeterministicCheck = Omit<GenerationAuditCheck, 'result'> & {
  result: 'passed' | 'not_applicable';
};

/** Ready reports cannot retain unresolved evidence or failed deterministic checks. */
export type GenerationAuditReport =
  | (Omit<GenerationAuditReportBase, 'deterministicChecks'> & {
      verdict: 'ready_for_human_review';
      deterministicChecks: GenerationReadyDeterministicCheck[];
      unresolvedRequirementIds: [];
    })
  | (GenerationAuditReportBase & {
      verdict: 'needs_attention';
      unresolvedRequirementIds: string[];
    })
  | (GenerationAuditReportBase & {
      verdict: 'blocked_missing_evidence';
      unresolvedRequirementIds: [string, ...string[]];
    });

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
