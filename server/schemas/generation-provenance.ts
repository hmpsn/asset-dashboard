import { z } from '../middleware/validate.js';

const generationProviderSchema = z.enum(['openai', 'anthropic', 'deterministic']);
/** Read compatibility for pre-G1 recommendation/keyword rows with descriptive tokens. */
export const storedGenerationFingerprintSchema = z.string().min(1).max(512);
export const canonicalGenerationFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const generationTimestampSchema = z.string().datetime();

const generationExecutionProvenanceObjectSchema = z.object({
  runId: z.string().min(1).max(200),
  executionChainId: z.string().min(1).max(200).optional(),
  operation: z.string().min(1).max(200),
  provider: generationProviderSchema,
  model: z.string().min(1).max(200),
  inputFingerprint: storedGenerationFingerprintSchema,
  startedAt: generationTimestampSchema,
  completedAt: generationTimestampSchema,
}).strict();

export const generationExecutionProvenanceSchema = generationExecutionProvenanceObjectSchema.superRefine((execution, ctx) => {
  if (Date.parse(execution.completedAt) < Date.parse(execution.startedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completedAt'],
      message: 'completedAt must not precede startedAt',
    });
  }
});

export const generationProvenanceSchema = generationExecutionProvenanceObjectSchema.extend({
  executions: z.array(generationExecutionProvenanceSchema).min(1).max(500).optional(),
  evidenceCapturedAt: generationTimestampSchema.optional(),
}).strict().superRefine((provenance, ctx) => {
  if (Date.parse(provenance.completedAt) < Date.parse(provenance.startedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completedAt'],
      message: 'completedAt must not precede startedAt',
    });
  }
  if (!provenance.executions) return;
  const accepted = provenance.executions.filter(execution => (
    execution.runId === provenance.runId
    && execution.operation === provenance.operation
    && execution.provider === provenance.provider
    && execution.model === provenance.model
    && execution.startedAt === provenance.startedAt
    && execution.completedAt === provenance.completedAt
  ));
  if (accepted.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executions'],
      message: 'executions must contain the accepted top-level execution exactly once',
    });
  }
  if (new Set(provenance.executions.map(execution => execution.runId)).size !== provenance.executions.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executions'],
      message: 'execution run ids must be unique',
    });
  }
  if (provenance.executionChainId
    && provenance.executions.some(execution => execution.executionChainId !== provenance.executionChainId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executions'],
      message: 'every execution must share the top-level execution chain',
    });
  }
  if (!provenance.executionChainId
    && provenance.executions.some(execution => execution.executionChainId !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executionChainId'],
      message: 'composite execution chains must be declared at the top level',
    });
  }
});

/** Strict write boundary for newly generated provenance. */
export const canonicalGenerationProvenanceSchema = generationProvenanceSchema.superRefine(
  (provenance, ctx) => {
    if (!canonicalGenerationFingerprintSchema.safeParse(provenance.inputFingerprint).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputFingerprint'],
        message: 'new provenance requires a canonical SHA-256 input fingerprint',
      });
    }
    provenance.executions?.forEach((execution, index) => {
      if (!canonicalGenerationFingerprintSchema.safeParse(execution.inputFingerprint).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['executions', index, 'inputFingerprint'],
          message: 'new provenance executions require canonical SHA-256 fingerprints',
        });
      }
    });
  },
);
