import { z } from 'zod';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  MATRIX_READ_LIMITS,
} from './matrix-generation.js';

const workspaceIdSchema = z.string().trim().min(1, 'workspace_id is required')
  .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes)
  .describe('The workspace ID this matrix operation targets.');
const durableIdSchema = z.string().trim().min(1)
  .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxTemplateIdBytes);
const cursorSchema = z.string().trim().min(1).max(2_048)
  .regex(/^[A-Za-z0-9_-]+$/, 'cursor must be an opaque base64url token');
const fingerprintSchema = z.string().regex(
  /^[a-f0-9]{64}$/,
  'must be a lowercase SHA-256 fingerprint',
);
const sourceRevisionSchema = z.object({
  matrix_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  template_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  cell_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const listContentMatricesInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  template_id: durableIdSchema.optional()
    .describe('Optional template ID filter. Matrices do not have a matrix-level status.'),
  cursor: cursorSchema.optional()
    .describe('Opaque matrix-page cursor bound to the active template filter.'),
  limit: z.number().int().min(1).max(MATRIX_READ_LIMITS.maxPageSize).optional()
    .describe(`Page size; defaults to ${MATRIX_READ_LIMITS.defaultPageSize} and caps at ${MATRIX_READ_LIMITS.maxPageSize}.`),
});

export const getContentMatrixInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  matrix_id: durableIdSchema.describe('Durable content matrix ID.'),
  cursor: cursorSchema.optional()
    .describe('Opaque cell cursor bound to the matrix ID, matrix revision, and exact cell snapshot.'),
  limit: z.number().int().min(1).max(MATRIX_READ_LIMITS.maxPageSize).optional()
    .describe(`Cell page size; defaults to ${MATRIX_READ_LIMITS.defaultPageSize} and caps at ${MATRIX_READ_LIMITS.maxPageSize}.`),
});

const matrixResolutionSelectionSchema = z.object({
  cell_id: durableIdSchema,
  expected_source_revision: sourceRevisionSchema,
});

export const resolveContentMatrixCellsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  matrix_id: durableIdSchema.describe('Durable content matrix ID.'),
  selections: z.array(matrixResolutionSelectionSchema)
    .min(1)
    .max(MATRIX_READ_LIMITS.maxResolveSelection)
    .superRefine((selections, ctx) => {
      const seen = new Set<string>();
      selections.forEach((selection, index) => {
        if (seen.has(selection.cell_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'cell_id'],
            message: 'cell_id values must be unique',
          });
        }
        seen.add(selection.cell_id);
      });
    })
    .describe(`One to ${MATRIX_READ_LIMITS.maxResolveSelection} unique cell IDs with exact matrix, template, and cell revisions.`),
});

export const acceptContentTemplateGenerationUpgradeInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  template_id: durableIdSchema.describe('Durable content template ID.'),
  expected_template_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact template revision used to create the deterministic proposal.'),
  proposal_fingerprint: fingerprintSchema
    .describe('Lowercase SHA-256 fingerprint of the exact deterministic proposal.'),
  decision: z.enum(['accept', 'reject'])
    .describe('accept writes the exact proposal; reject is a durable no-op response.'),
  idempotency_key: z.string().trim().min(1).max(200)
    .describe('Caller-stable key for safely replaying this exact decision.'),
});

export type ListContentMatricesInput = z.infer<typeof listContentMatricesInputSchema>;
export type GetContentMatrixInput = z.infer<typeof getContentMatrixInputSchema>;
export type ResolveContentMatrixCellsInput = z.infer<typeof resolveContentMatrixCellsInputSchema>;
export type AcceptContentTemplateGenerationUpgradeInput = z.infer<
  typeof acceptContentTemplateGenerationUpgradeInputSchema
>;
