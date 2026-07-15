import { parseStructuredAIOutput } from '../../../ai-structured-output.js';
import { z } from '../../../middleware/validate.js';

const modelFindingSchema = z.object({
  code: z.string().trim().min(1).max(120),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().trim().min(1).max(2_000),
  affectedTargetIds: z.array(z.string().trim().min(1).max(200)).min(1).max(32),
  requiresHumanReview: z.boolean(),
}).strict();

export const matrixGenerationModelAuditAIOutputSchema = z.object({
  revisionRecommended: z.boolean(),
  findings: z.array(modelFindingSchema).max(50),
}).strict();

export type MatrixGenerationModelAuditAIOutput = z.infer<
  typeof matrixGenerationModelAuditAIOutputSchema
>;

const revisedBlockSchema = z.object({
  targetId: z.string().trim().min(1).max(200),
  html: z.string().trim().min(1).max(200_000),
}).strict();

export const matrixGenerationRevisionAIOutputSchema = z.object({
  blocks: z.array(revisedBlockSchema).min(1).max(64),
}).strict();

export type MatrixGenerationRevisionAIOutput = z.infer<
  typeof matrixGenerationRevisionAIOutputSchema
>;

const setAuditFindingSchema = z.object({
  code: z.string().trim().min(1).max(120),
  kind: z.enum(['prose', 'provenance']),
  severity: z.enum(['warning', 'error']),
  message: z.string().trim().min(1).max(2_000),
  affectedItemIds: z.array(z.string().trim().min(1).max(200)).min(1).max(25),
  affectedTargetIds: z.array(z.string().trim().min(1).max(420)).min(1).max(64),
  requiresHumanReview: z.boolean(),
  revisionRecommended: z.boolean(),
}).strict();

export const matrixGenerationSetAuditAIOutputSchema = z.object({
  findings: z.array(setAuditFindingSchema).max(100),
}).strict();

export type MatrixGenerationSetAuditAIOutput = z.infer<
  typeof matrixGenerationSetAuditAIOutputSchema
>;

export function parseMatrixGenerationModelAuditAIOutput(
  raw: string,
): MatrixGenerationModelAuditAIOutput {
  return parseStructuredAIOutput(
    raw,
    matrixGenerationModelAuditAIOutputSchema,
    'content-matrix-item-audit',
  );
}

export function parseMatrixGenerationRevisionAIOutput(
  raw: string,
): MatrixGenerationRevisionAIOutput {
  return parseStructuredAIOutput(
    raw,
    matrixGenerationRevisionAIOutputSchema,
    'content-matrix-item-revise',
  );
}

export function parseMatrixGenerationSetAuditAIOutput(
  raw: string,
): MatrixGenerationSetAuditAIOutput {
  return parseStructuredAIOutput(
    raw,
    matrixGenerationSetAuditAIOutputSchema,
    'content-matrix-set-audit',
  );
}
