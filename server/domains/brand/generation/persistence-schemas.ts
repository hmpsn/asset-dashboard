import { z } from '../../../middleware/validate.js';
import {
  BRAND_DELIVERABLE_TYPES,
} from '../../../../shared/types/brand-engine.js';
import {
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_ATTEMPT_STAGES,
  BRAND_GENERATION_ATTEMPT_STATUSES,
  BRAND_GENERATION_CONTRACT_VERSION,
  BRAND_GENERATION_ITEM_STATUSES,
  BRAND_GENERATION_LIMITS,
  BRAND_GENERATION_PRESETS,
  BRAND_GENERATION_RUN_STATUSES,
  BRAND_GENERATION_STAGES,
} from '../../../../shared/types/brand-generation.js';
import {
  GENERATION_AUDIT_CHECK_RESULTS,
  GENERATION_EVIDENCE_REQUIREMENT_STAGES,
  GENERATION_EVIDENCE_SOURCE_TYPES,
  GENERATION_EVIDENCE_STATUSES,
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
} from '../../../../shared/types/generation-evidence.js';
import {
  contextModifierSchema,
  finalizedVoiceSnapshotRefSchema,
  generationResolverAttributionSchema,
  voiceDNASchema,
  voiceGuardrailsSchema,
} from '../../../../shared/types/voice-finalization-schemas.js';

export const brandGenerationIdSchema = z.string().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength);
export const brandGenerationFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const brandGenerationTimestampSchema = z.string().datetime();

const masterCallerSchema = z.object({
  kind: z.literal('master_key'),
  scope: z.literal('all'),
  keyId: z.null(),
  keyLabel: z.null(),
}).strict();

const workspaceCallerSchema = z.object({
  kind: z.literal('workspace_key'),
  scope: brandGenerationIdSchema,
  workspaceId: brandGenerationIdSchema,
  keyId: brandGenerationIdSchema,
  keyLabel: z.string().min(1).max(200),
}).strict();

export const brandGenerationMcpExecutionContextSchema = z.object({
  requestId: brandGenerationIdSchema,
  toolName: brandGenerationIdSchema,
  targetWorkspaceId: brandGenerationIdSchema.nullable(),
  caller: z.union([masterCallerSchema, workspaceCallerSchema]),
}).strict();

export const brandGenerationBudgetEstimateSchema = z.object({
  providerCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostMicros: z.number().int().nonnegative(),
  maxConcurrency: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxConcurrency),
}).strict();

export const brandGenerationBudgetLimitsSchema = z.object({
  providerCalls: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxProviderCalls),
  inputTokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxInputTokens),
  outputTokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxOutputTokens),
  maxEstimatedCostMicros: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros),
  maxConcurrency: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxConcurrency),
}).strict();

export const brandGenerationBudgetUsageSchema = z.object({
  providerCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostMicros: z.number().int().nonnegative(),
}).strict();

const atomicSelectionSchema = z.object({
  kind: z.literal('atomic'),
  target: z.enum(BRAND_GENERATION_ATOMIC_TARGETS),
}).strict();

const presetSelectionSchema = z.object({
  kind: z.literal('preset'),
  preset: z.enum(BRAND_GENERATION_PRESETS),
}).strict();

export const brandGenerationSelectionSchema = z.union([
  atomicSelectionSchema,
  presetSelectionSchema,
]);

export const brandGenerationDispatchTargetsSchema = z.array(
  z.enum(BRAND_GENERATION_ATOMIC_TARGETS),
).min(1).max(BRAND_GENERATION_LIMITS.maxTargets - 1).superRefine((targets, ctx) => {
  if (new Set(targets).size !== targets.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Dispatch targets must be unique' });
  }
});

const evidenceSourceRefSchema = z.object({
  sourceType: z.enum(GENERATION_EVIDENCE_SOURCE_TYPES),
  sourceId: brandGenerationIdSchema,
  sourceRevision: z.number().int().nonnegative().optional(),
  fieldPath: z.string().min(1).max(500).optional(),
  label: z.string().min(1).max(500).optional(),
  uri: z.string().min(1).max(2_048).optional(),
  capturedAt: brandGenerationTimestampSchema,
  voiceSampleSource: z.enum(['manual', 'transcript_extraction']).optional(),
}).strict().superRefine((source, ctx) => {
  if (source.sourceType === 'voice_sample' && !source.voiceSampleSource) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Voice samples require an authentic source' });
  }
  if (source.sourceType !== 'voice_sample' && source.voiceSampleSource) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only voice samples carry voiceSampleSource' });
  }
});

export const brandGenerationEvidenceRequirementSchema = z.object({
  id: brandGenerationIdSchema,
  fieldPath: z.string().min(1).max(500),
  claim: z.string().max(10_000),
  reason: z.string().max(10_000),
  requirementStage: z.enum(GENERATION_EVIDENCE_REQUIREMENT_STAGES),
  claimKind: z.enum(['factual', 'structural', 'creative']),
  status: z.enum(GENERATION_EVIDENCE_STATUSES),
  sourceRefs: z.array(evidenceSourceRefSchema).max(100),
  clientSafePrompt: z.string().max(2_000).optional(),
}).strict().superRefine((requirement, ctx) => {
  if (requirement.claimKind === 'creative') {
    if (requirement.status !== 'creative_proposal') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Creative claims require creative_proposal' });
    }
  } else if (requirement.status === 'creative_proposal') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only creative claims may be proposals' });
  }
  if (requirement.status === 'verified' && requirement.sourceRefs.length < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Verified claims require evidence' });
  }
  if (requirement.status === 'conflicting' && requirement.sourceRefs.length < 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conflicting claims require two sources' });
  }
  if (requirement.status === 'missing' && requirement.sourceRefs.length !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Missing claims cannot carry evidence' });
  }
  if (requirement.claimKind === 'factual' && requirement.sourceRefs.some(source =>
    (STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES as readonly string[])
      .includes(source.sourceType))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Structural sources cannot prove facts' });
  }
});

export const brandGeneratedClaimSchema = z.object({
  text: z.string().min(1).max(10_000),
  classification: z.enum(['factual', 'inferred', 'creative_proposal']),
  evidenceKeys: z.array(brandGenerationIdSchema).max(100),
  sourceRefs: z.array(evidenceSourceRefSchema).max(100),
}).strict().superRefine((claim, ctx) => {
  if (claim.classification === 'factual' || claim.classification === 'inferred') {
    if (claim.sourceRefs.length < 1 || claim.evidenceKeys.length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Factual and inferred claims require evidence' });
    }
    if (claim.sourceRefs.some(source =>
      (STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES as readonly string[])
        .includes(source.sourceType))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Structural sources cannot support factual or inferred generated claims' });
    }
  }
});

export const brandGenerationPlaceholderSchema = z.object({
  requirementId: brandGenerationIdSchema,
  token: z.string().regex(/^\[NEEDS CLIENT INPUT: .+\]$/),
  prompt: z.string().min(1).max(2_000),
}).strict();

const auditCheckSchema = z.object({
  id: brandGenerationIdSchema,
  category: z.string().max(200),
  result: z.enum(GENERATION_AUDIT_CHECK_RESULTS),
  message: z.string().max(10_000),
  evidenceRequirementIds: z.array(brandGenerationIdSchema).max(100),
}).strict();

const humanAuditCheckSchema = auditCheckSchema.extend({
  result: z.enum(['needs_human_review', 'not_applicable']),
}).strict();

const modelFindingSchema = z.object({
  code: z.string().min(1).max(200),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().max(10_000),
  affectedTargetIds: z.array(brandGenerationIdSchema).max(BRAND_GENERATION_LIMITS.maxTargets),
  requiresHumanReview: z.boolean(),
}).strict();

const auditBase = {
  modelFindings: z.array(modelFindingSchema).max(200),
  humanRequiredChecks: z.array(humanAuditCheckSchema).max(200),
  revisionCount: z.union([z.literal(0), z.literal(1)]),
  auditedAt: brandGenerationTimestampSchema,
};

export const brandGenerationAuditReportSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('ready_for_human_review'),
    deterministicChecks: z.array(auditCheckSchema.extend({
      result: z.enum(['passed', 'not_applicable']),
    }).strict()).max(200),
    unresolvedRequirementIds: z.tuple([]),
    ...auditBase,
  }).strict(),
  z.object({
    verdict: z.literal('needs_attention'),
    deterministicChecks: z.array(auditCheckSchema).max(200),
    unresolvedRequirementIds: z.array(brandGenerationIdSchema).max(100),
    ...auditBase,
  }).strict(),
  z.object({
    verdict: z.literal('blocked_missing_evidence'),
    deterministicChecks: z.array(auditCheckSchema).max(200),
    unresolvedRequirementIds: z.array(brandGenerationIdSchema).min(1).max(100),
    ...auditBase,
  }).strict(),
]);

export const brandGenerationProvenanceSchema = z.object({
  runId: brandGenerationIdSchema,
  operation: z.string().min(1).max(200),
  provider: z.enum(['openai', 'anthropic', 'deterministic']),
  model: z.string().min(1).max(200),
  inputFingerprint: brandGenerationFingerprintSchema,
  evidenceCapturedAt: brandGenerationTimestampSchema.optional(),
  startedAt: brandGenerationTimestampSchema,
  completedAt: brandGenerationTimestampSchema,
}).strict();

export const brandGenerationSanitizedErrorSchema = z.object({
  code: z.string().min(1).max(200),
  message: z.string().max(2_000),
  retryable: z.boolean(),
  stage: z.string().min(1).max(200).optional(),
}).strict();

export const brandVoiceFoundationDraftSchema = z.object({
  schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
  summary: z.string().min(1).max(10_000),
  voiceDNA: voiceDNASchema,
  guardrails: voiceGuardrailsSchema,
  contextModifiers: z.array(contextModifierSchema).max(100),
  evidenceRequirementIds: z.array(brandGenerationIdSchema).max(100),
  fingerprint: brandGenerationFingerprintSchema,
}).strict();

export const brandDeliverableWriteExpectationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    deliverableId: z.null(),
    expectedVersion: z.literal(0),
  }).strict(),
  z.object({
    kind: z.literal('update'),
    deliverableId: brandGenerationIdSchema,
    expectedVersion: z.number().int().positive(),
  }).strict(),
]);

const approvedDeliverableRefSchema = z.object({
  deliverableId: brandGenerationIdSchema,
  deliverableType: z.enum(BRAND_DELIVERABLE_TYPES),
  version: z.number().int().positive(),
  approvedAt: brandGenerationTimestampSchema,
  contentFingerprint: brandGenerationFingerprintSchema,
  approvalFingerprint: brandGenerationFingerprintSchema,
}).strict();

export const brandGenerationTargetInputSnapshotSchema = z.object({
  schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
  target: z.enum(BRAND_GENERATION_ATOMIC_TARGETS),
  intakeRevision: z.object({
    intakeRevisionId: brandGenerationIdSchema,
    revision: z.number().int().positive(),
    fingerprint: brandGenerationFingerprintSchema,
  }).strict(),
  voiceSnapshot: finalizedVoiceSnapshotRefSchema.nullable(),
  approvedDeliverables: z.array(approvedDeliverableRefSchema).max(BRAND_DELIVERABLE_TYPES.length),
  evidenceRequirementIds: z.array(brandGenerationIdSchema).max(100),
  artifactExpectation: brandDeliverableWriteExpectationSchema.nullable(),
  capturedAt: brandGenerationTimestampSchema,
  fingerprint: brandGenerationFingerprintSchema,
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.target === 'voice_foundation') {
    if (snapshot.voiceSnapshot !== null || snapshot.artifactExpectation !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Foundation snapshots cannot bind voice or artifacts' });
    }
  } else if (snapshot.voiceSnapshot === null || snapshot.artifactExpectation === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Durable targets require voice and artifact expectations' });
  }
});

const missingVoiceReadinessSchema = z.object({
  state: z.literal('missing'),
  blockingReasons: z.array(z.string().min(1).max(2_000)).min(1).max(100),
}).strict();

const provisionalVoiceReadinessSchema = z.object({
  state: z.literal('provisional'),
  foundationItemId: brandGenerationIdSchema,
  blockingReasons: z.array(z.string().min(1).max(2_000)).min(1).max(100),
}).strict();

const finalizedVoiceReadinessSchema = z.object({
  state: z.literal('finalized'),
  snapshot: finalizedVoiceSnapshotRefSchema,
  blockingReasons: z.tuple([]),
}).strict();

const staleVoiceReadinessSchema = z.object({
  state: z.literal('stale'),
  snapshot: finalizedVoiceSnapshotRefSchema,
  blockingReasons: z.array(z.string().min(1).max(2_000)).min(1).max(100),
}).strict();

export const brandVoiceReadinessSchema = z.discriminatedUnion('state', [
  missingVoiceReadinessSchema,
  provisionalVoiceReadinessSchema,
  finalizedVoiceReadinessSchema,
  staleVoiceReadinessSchema,
]);

const budgetRequestSchema = z.object({
  maxProviderCalls: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxEstimatedCostMicros: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
}).strict();

const startCommandBaseSchema = z.object({
  workspaceId: brandGenerationIdSchema,
  intakeRevisionId: brandGenerationIdSchema,
  expectedIntakeRevision: z.number().int().positive(),
  expectedIntakeFingerprint: brandGenerationFingerprintSchema,
  budget: budgetRequestSchema,
}).strict();

const startCommandSchema = z.union([
  startCommandBaseSchema.merge(z.object({
    selection: z.object({ kind: z.literal('atomic'), target: z.literal('voice_foundation') }).strict(),
  }).strict()),
  startCommandBaseSchema.merge(z.object({
    selection: z.object({ kind: z.literal('preset'), preset: z.literal('full_brand_system') }).strict(),
  }).strict()),
  startCommandBaseSchema.merge(z.object({
    selection: z.object({
      kind: z.literal('atomic'),
      target: z.enum(BRAND_DELIVERABLE_TYPES),
    }).strict(),
    expectedVoiceVersion: z.number().int().positive(),
    expectedVoiceFingerprint: brandGenerationFingerprintSchema,
  }).strict()),
  startCommandBaseSchema.merge(z.object({
    selection: z.object({
      kind: z.literal('preset'),
      preset: z.enum(['identity_messaging', 'audience']),
    }).strict(),
    expectedVoiceVersion: z.number().int().positive(),
    expectedVoiceFingerprint: brandGenerationFingerprintSchema,
  }).strict()),
]);

const resumeCommandSchema = z.object({
  workspaceId: brandGenerationIdSchema,
  runId: brandGenerationIdSchema,
  expectedRunRevision: z.number().int().nonnegative(),
  expectedVoiceVersion: z.number().int().positive(),
  expectedVoiceFingerprint: brandGenerationFingerprintSchema,
}).strict();

const revisionCommandSchema = z.object({
  workspaceId: brandGenerationIdSchema,
  runId: brandGenerationIdSchema,
  itemId: brandGenerationIdSchema,
  expectedRunRevision: z.number().int().nonnegative(),
  expectedItemRevision: z.number().int().nonnegative(),
  deliverableId: brandGenerationIdSchema,
  expectedDeliverableVersion: z.number().int().positive(),
  direction: z.string().trim().min(1).max(BRAND_GENERATION_LIMITS.maxDirectionBytes),
}).strict();

export const brandGenerationCommandRequestSnapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
    kind: z.literal('start'),
    command: startCommandSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
    kind: z.literal('resume'),
    command: resumeCommandSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
    kind: z.literal('revision'),
    command: revisionCommandSchema,
  }).strict(),
]);

export const brandGenerationAcceptedCommandResultSchema = z.object({
  runId: brandGenerationIdSchema,
  runRevision: z.number().int().nonnegative(),
  jobId: brandGenerationIdSchema,
  selectionCount: z.number().int().positive().max(BRAND_GENERATION_LIMITS.maxTargets),
  estimate: brandGenerationBudgetEstimateSchema,
  dashboardUrl: z.string().min(1).max(2_048),
}).strict();

const brandGenerationPreflightAttemptOutputBaseSchema = z.object({
  kind: z.literal('preflight'),
  readyForPaidWork: z.boolean(),
  blockingRequirementIds: z.array(brandGenerationIdSchema).max(100),
  requirements: z.array(brandGenerationEvidenceRequirementSchema).max(100),
  placeholders: z.array(brandGenerationPlaceholderSchema).max(100),
  estimate: brandGenerationBudgetEstimateSchema,
}).strict();

function refinePreflightOutput(
  output: z.infer<typeof brandGenerationPreflightAttemptOutputBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  const expectedBlockers = output.requirements
    .filter(requirement => (
      requirement.requirementStage === 'preflight'
      && requirement.status !== 'verified'
    ))
    .map(requirement => requirement.id)
    .sort();
  const declaredBlockers = [...output.blockingRequirementIds].sort();
  if (new Set(declaredBlockers).size !== declaredBlockers.length
    || JSON.stringify(declaredBlockers) !== JSON.stringify(expectedBlockers)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Preflight blockers must exactly match unresolved preflight requirements',
    });
  }
  if (output.readyForPaidWork !== (expectedBlockers.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Paid-work readiness must agree with the preflight blocker set',
    });
  }
  const expectedPlaceholderIds = output.requirements
    .filter(requirement => (
      requirement.requirementStage === 'ready'
      && requirement.status === 'missing'
    ))
    .map(requirement => requirement.id)
    .sort();
  const declaredPlaceholderIds = output.placeholders
    .map(placeholder => placeholder.requirementId)
    .sort();
  if (new Set(declaredPlaceholderIds).size !== declaredPlaceholderIds.length
    || JSON.stringify(declaredPlaceholderIds) !== JSON.stringify(expectedPlaceholderIds)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Preflight placeholders must exactly match missing ready-stage requirements',
    });
  }
}

export const brandGenerationPreflightAttemptOutputSchema =
  brandGenerationPreflightAttemptOutputBaseSchema.superRefine(refinePreflightOutput);

const candidateOutputBase = {
  claims: z.array(brandGeneratedClaimSchema).max(200),
  requirements: z.array(brandGenerationEvidenceRequirementSchema).max(100),
  placeholders: z.array(brandGenerationPlaceholderSchema).max(100),
};

export const brandGenerationFoundationCandidateOutputSchema = z.object({
  kind: z.literal('foundation_candidate'),
  content: z.null(),
  foundationDraft: brandVoiceFoundationDraftSchema,
  ...candidateOutputBase,
}).strict();

export const brandGenerationDeliverableCandidateOutputSchema = z.object({
  kind: z.literal('deliverable_candidate'),
  content: z.string().min(1).max(BRAND_GENERATION_LIMITS.maxContentBytes),
  foundationDraft: z.null(),
  ...candidateOutputBase,
}).strict();

export const brandGenerationAuditAttemptOutputSchema = z.object({
  kind: z.literal('audit'),
  auditReport: brandGenerationAuditReportSchema,
}).strict();

export const brandGenerationAttemptOutputSchema = z.discriminatedUnion('kind', [
  brandGenerationPreflightAttemptOutputBaseSchema,
  brandGenerationFoundationCandidateOutputSchema,
  brandGenerationDeliverableCandidateOutputSchema,
  brandGenerationAuditAttemptOutputSchema,
]).superRefine((output, ctx) => {
  if (output.kind === 'preflight') refinePreflightOutput(output, ctx);
});

export const brandGenerationRunStatusSchema = z.enum(BRAND_GENERATION_RUN_STATUSES);
export const brandGenerationRunStageSchema = z.enum(BRAND_GENERATION_STAGES);
export const brandGenerationItemStatusSchema = z.enum(BRAND_GENERATION_ITEM_STATUSES);
export const brandGenerationAttemptStageSchema = z.enum(BRAND_GENERATION_ATTEMPT_STAGES);
export const brandGenerationAttemptStatusSchema = z.enum(BRAND_GENERATION_ATTEMPT_STATUSES);

const brandGenerationRunCountsSchema = z.object({
  selected: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  readyForHumanReview: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  changesRequested: z.number().int().nonnegative(),
}).strict();

export const brandGenerationEffectPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
    kind: z.literal('command_accepted'),
  }).strict(),
  z.object({
    schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
    kind: z.literal('artifact_committed'),
    deliverableId: brandGenerationIdSchema,
    deliverableType: z.enum(BRAND_DELIVERABLE_TYPES),
    deliverableVersion: z.number().int().positive(),
    deliverableStatus: z.enum(['draft', 'approved']),
  }).strict(),
  z.object({
    schemaVersion: z.literal(BRAND_GENERATION_CONTRACT_VERSION),
    kind: z.literal('command_completed'),
    status: brandGenerationRunStatusSchema,
    counts: brandGenerationRunCountsSchema,
  }).strict(),
]);

export function assertAttemptOutputMatchesStage(
  stage: z.infer<typeof brandGenerationAttemptStageSchema>,
  output: z.infer<typeof brandGenerationAttemptOutputSchema>,
): void {
  const matches = (
    (stage === 'preflight' && output.kind === 'preflight')
    || (stage === 'voice_foundation_generation' && output.kind === 'foundation_candidate')
    || ((stage === 'dependent_generation' || stage === 'revision')
      && output.kind === 'deliverable_candidate')
    || ((stage === 'deterministic_audit' || stage === 'model_audit')
      && output.kind === 'audit')
  );
  if (!matches) throw new Error('Attempt output does not match its durable stage');
}

export { generationResolverAttributionSchema };
