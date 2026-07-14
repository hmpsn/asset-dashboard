import { z } from '../../../middleware/validate.js';
import {
  BRAND_GENERATION_LIMITS,
} from '../../../../shared/types/brand-generation.js';
import {
  GENERATION_AUDIT_CHECK_RESULTS,
  GENERATION_AUDIT_VERDICTS,
  type GenerationAuditReport,
} from '../../../../shared/types/generation-evidence.js';
import {
  contextModifierSchema,
  voiceDNASchema,
  voiceGuardrailsSchema,
} from '../../../../shared/types/voice-finalization-schemas.js';
import { parseStructuredAIOutput } from '../../../ai-structured-output.js';

const boundedText = z.string().trim().min(1).max(BRAND_GENERATION_LIMITS.maxContentBytes);
const boundedShortText = z.string().trim().min(1).max(1_000);
const boundedId = z.string().trim().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength);
const evidenceKeysSchema = z.array(boundedId).max(100)
  .superRefine((keys, ctx) => {
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evidence keys must be unique.',
      });
    }
  });

export const brandRawAIClaimSchema = z.object({
  text: boundedText,
  classification: z.enum(['factual', 'inferred', 'creative_proposal']),
  evidenceKeys: evidenceKeysSchema,
}).strict().superRefine((claim, ctx) => {
  if (
    (claim.classification === 'factual' || claim.classification === 'inferred')
    && claim.evidenceKeys.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidenceKeys'],
      message: 'Factual and inferred claims require at least one accepted evidence key.',
    });
  }
});

const unresolvedRequirementIdsSchema = z.array(boundedId).max(100)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unresolved requirement IDs must be unique.',
      });
    }
  });

function enforceCandidateSnapshotBytes(value: unknown, ctx: z.RefinementCtx): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `candidate snapshot exceeds ${BRAND_GENERATION_LIMITS.maxCandidateSnapshotBytes} UTF-8 bytes`,
    });
  }
}

export const brandFoundationAIOutputSchema = z.object({
  summary: boundedText,
  voiceDNA: voiceDNASchema,
  guardrails: voiceGuardrailsSchema,
  contextModifiers: z.array(contextModifierSchema).max(20),
  claims: z.array(brandRawAIClaimSchema).max(100),
  unresolvedRequirementIds: unresolvedRequirementIdsSchema,
}).strict().superRefine(enforceCandidateSnapshotBytes);

export const brandDeliverableAIOutputSchema = z.object({
  content: boundedText,
  claims: z.array(brandRawAIClaimSchema).max(100),
  unresolvedRequirementIds: unresolvedRequirementIdsSchema,
}).strict().superRefine(enforceCandidateSnapshotBytes);

export const brandModelAuditFindingSchema = z.object({
  code: boundedId,
  severity: z.enum(['info', 'warning', 'error']),
  message: boundedShortText,
  affectedTargetIds: z.array(boundedId).max(100),
  requiresHumanReview: z.boolean(),
}).strict();

export const brandModelAuditAIOutputSchema = z.object({
  findings: z.array(brandModelAuditFindingSchema).max(100),
  revisionRecommended: z.boolean(),
  rationale: boundedShortText,
}).strict();

const generationAuditCheckSchema = z.object({
  id: boundedId,
  category: boundedId,
  result: z.enum(GENERATION_AUDIT_CHECK_RESULTS),
  message: boundedShortText,
  evidenceRequirementIds: z.array(boundedId).max(100),
}).strict();

const humanRequiredCheckSchema = generationAuditCheckSchema.extend({
  result: z.enum(['needs_human_review', 'not_applicable']),
}).strict();

const generationModelFindingSchema = z.object({
  code: boundedId,
  severity: z.enum(['info', 'warning', 'error']),
  message: boundedShortText,
  affectedTargetIds: z.array(boundedId).max(100),
  requiresHumanReview: z.boolean(),
}).strict();

const generationAuditReportBase = z.object({
  deterministicChecks: z.array(generationAuditCheckSchema).max(100),
  modelFindings: z.array(generationModelFindingSchema).max(100),
  humanRequiredChecks: z.array(humanRequiredCheckSchema).max(20),
  revisionCount: z.union([z.literal(0), z.literal(1)]),
  auditedAt: z.string().datetime(),
  unresolvedRequirementIds: z.array(boundedId).max(100),
});

export const brandGenerationAuditReportSchema = z.discriminatedUnion('verdict', [
  generationAuditReportBase.extend({
    verdict: z.literal(GENERATION_AUDIT_VERDICTS[0]),
  }).strict(),
  generationAuditReportBase.extend({
    verdict: z.literal(GENERATION_AUDIT_VERDICTS[1]),
  }).strict(),
  generationAuditReportBase.extend({
    verdict: z.literal(GENERATION_AUDIT_VERDICTS[2]),
    unresolvedRequirementIds: z.array(boundedId).min(1).max(100),
  }).strict(),
]).superRefine((report, ctx) => {
  if (report.verdict !== 'ready_for_human_review') return;
  if (report.unresolvedRequirementIds.length !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unresolvedRequirementIds'],
      message: 'Ready audit reports cannot retain unresolved requirements.',
    });
  }
  report.deterministicChecks.forEach((check, index) => {
    if (check.result !== 'passed' && check.result !== 'not_applicable') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deterministicChecks', index, 'result'],
        message: 'Ready audit reports cannot retain failed deterministic checks.',
      });
    }
  });
});

export type BrandRawAIClaim = z.infer<typeof brandRawAIClaimSchema>;
export type BrandFoundationAIOutput = z.infer<typeof brandFoundationAIOutputSchema>;
export type BrandDeliverableAIOutput = z.infer<typeof brandDeliverableAIOutputSchema>;
export type BrandModelAuditAIOutput = z.infer<typeof brandModelAuditAIOutputSchema>;

export function parseBrandFoundationAIOutput(raw: string): BrandFoundationAIOutput {
  return parseStructuredAIOutput(raw, brandFoundationAIOutputSchema, 'brand-deliverable-generate:foundation');
}

export function parseBrandDeliverableAIOutput(raw: string): BrandDeliverableAIOutput {
  return parseStructuredAIOutput(raw, brandDeliverableAIOutputSchema, 'brand-deliverable-generate:deliverable');
}

export function parseBrandModelAuditAIOutput(raw: string): BrandModelAuditAIOutput {
  return parseStructuredAIOutput(raw, brandModelAuditAIOutputSchema, 'brand-deliverable-audit');
}

/** The deterministic producer validates its own output before persistence. */
export function parseBrandGenerationAuditReport(value: unknown): GenerationAuditReport {
  return brandGenerationAuditReportSchema.parse(value) as GenerationAuditReport;
}
