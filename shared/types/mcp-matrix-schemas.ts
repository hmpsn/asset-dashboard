import { z } from 'zod';
import {
  MATRIX_GENERATION_BATCH_LIMITS,
  MATRIX_GENERATION_SOURCE_LIMITS,
  MATRIX_READ_LIMITS,
} from './matrix-generation.js';
import { GENERATION_EVIDENCE_SOURCE_TYPES } from './generation-evidence.js';

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

const pseoMatrixDimensionSchema = z.object({
  variable_name: z.string().trim().min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensionNameBytes)
    .describe('Exact variable name declared by the blueprint entry\'s linked content template.'),
  values: z.array(z.string().trim().min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensionValueBytes))
    .min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxValuesPerDimension)
    .describe('Ordered, unique, non-empty values for this matrix dimension.'),
}).strict();

const pseoMatrixPlanSourceRevisionSchema = z.object({
  entry_updated_at: z.string().datetime({ offset: true })
    .describe('Exact updated_at token returned by get_pseo_matrix_plan.'),
  template_id: durableIdSchema
    .describe('Exact linked template ID returned by get_pseo_matrix_plan.'),
  template_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact linked template revision returned by get_pseo_matrix_plan.'),
}).strict();

export const getPseoMatrixPlanInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  blueprint_id: durableIdSchema
    .describe('Durable site-blueprint ID containing the collection entry.'),
  entry_id: durableIdSchema
    .describe('Durable collection blueprint-entry ID to inspect.'),
}).strict();

export const listPseoBlueprintEntriesInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  cursor: cursorSchema.optional()
    .describe('Opaque collection-entry cursor bound to this workspace.'),
  limit: z.number().int().min(1).max(MATRIX_READ_LIMITS.maxPageSize).optional()
    .describe(`Page size; defaults to ${MATRIX_READ_LIMITS.defaultPageSize} and caps at ${MATRIX_READ_LIMITS.maxPageSize}.`),
}).strict();

export const createContentMatrixFromPseoPlanInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  blueprint_id: durableIdSchema
    .describe('Durable site-blueprint ID containing the collection entry.'),
  entry_id: durableIdSchema
    .describe('Durable collection blueprint-entry ID to link to the created matrix.'),
  expected_source_revision: pseoMatrixPlanSourceRevisionSchema
    .describe('Exact entry/template authority returned by get_pseo_matrix_plan.'),
  dimensions: z.array(pseoMatrixDimensionSchema)
    .min(1)
    .max(MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxDimensions)
    .describe('Explicit service/location or other template-variable dimensions for the Cartesian matrix.'),
}).strict().superRefine((value, ctx) => {
  let cellCount = 1;
  for (const dimension of value.dimensions) {
    cellCount *= dimension.values.length;
    if (cellCount > MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions'],
        message: `Dimensions generate more than ${MATRIX_GENERATION_SOURCE_LIMITS.matrix.maxGeneratedCells} cells`,
      });
      return;
    }
  }
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

export const previewContentMatrixGenerationInputSchema = z.object({
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
    .describe('Explicit durable cells and exact source revisions to preview without paid work.'),
});

const artifactRevisionExpectationsSchema = z.object({
  brief: z.object({
    artifact_type: z.literal('content_brief'),
    artifact_id: durableIdSchema.nullable(),
    generation_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  post: z.object({
    artifact_type: z.literal('generated_post'),
    artifact_id: durableIdSchema.nullable(),
    generation_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
}).strict();

const evidenceValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().trim().min(1).max(12_000) }).strict(),
  z.object({ kind: z.literal('number'), value: z.number().finite(), unit: z.string().trim().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('text_list'), value: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('date'), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal('url'), value: z.string().url().max(2_048) }).strict(),
]);

const evidenceSourceRefSchema = z.object({
  source_type: z.enum(GENERATION_EVIDENCE_SOURCE_TYPES),
  source_id: durableIdSchema,
  source_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  field_path: z.string().trim().min(1).max(512).optional(),
  label: z.string().trim().min(1).max(512).optional(),
  uri: z.string().url().max(2_048).optional(),
  captured_at: z.string().datetime(),
}).strict();

export const resolveContentMatrixEvidenceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  matrix_id: durableIdSchema.describe('Durable content matrix ID.'),
  cell_id: durableIdSchema.describe('Durable matrix cell ID.'),
  requirement_id: z.string().trim().min(1).max(512)
    .describe('Stable requirement ID returned by generation preview.'),
  value: evidenceValueSchema.describe('Typed factual value that resolves the requirement.'),
  source_ref: evidenceSourceRefSchema
    .describe('Durable factual source reference; matrix/template structure is rejected.'),
  expected_source_revision: sourceRevisionSchema
    .describe('Exact matrix, template, and cell revisions from the staleable preview.'),
  expected_artifact_revisions: artifactRevisionExpectationsSchema
    .describe('Exact linked brief/post revisions observed by the preview.'),
  idempotency_key: z.string().trim().min(1).max(200)
    .describe('Caller-stable replay key for this exact evidence mutation.'),
}).strict();

const batchBudgetSchema = z.object({
  max_provider_calls: z.number().int().positive()
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxProviderCalls)
    .describe('Maximum provider calls the caller accepts for this batch.'),
  max_input_tokens: z.number().int().positive()
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxInputTokens)
    .describe('Maximum input tokens the caller accepts for this batch.'),
  max_output_tokens: z.number().int().positive()
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxOutputTokens)
    .describe('Maximum output tokens the caller accepts for this batch.'),
  max_estimated_usd: z.number().positive()
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxEstimatedUsd)
    .describe('Maximum estimated USD cost the caller accepts for this batch.'),
  max_concurrency: z.number().int().min(1)
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxConcurrency)
    .describe('Maximum concurrent matrix pages the caller accepts.'),
}).strict();

const startSelectionSchema = matrixResolutionSelectionSchema.extend({
  expected_preview_fingerprint: fingerprintSchema
    .describe('Exact effective-input fingerprint returned by generation preview.'),
}).strict();

export const startContentMatrixGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  matrix_id: durableIdSchema.describe('Durable content matrix ID.'),
  selections: z.array(startSelectionSchema)
    .min(1)
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxItems)
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
    .describe('One to 25 unique previewed cells with exact source and preview revisions.'),
  accepted_budget: batchBudgetSchema
    .describe('Hard ceilings that must cover the aggregate preview estimate.'),
  idempotency_key: z.string().trim().min(1).max(200)
    .describe('Caller-stable replay key for this exact batch snapshot.'),
}).strict();

export const getContentMatrixGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  run_id: durableIdSchema.describe('Durable matrix generation run ID.'),
  cursor: cursorSchema.optional()
    .describe('Opaque item cursor bound to the current run revision.'),
  limit: z.number().int().min(1).max(MATRIX_READ_LIMITS.maxPageSize).optional()
    .describe(`Item page size; defaults to 25 and caps at ${MATRIX_READ_LIMITS.maxPageSize}.`),
}).strict();

const retryItemSchema = z.object({
  item_id: durableIdSchema,
  expected_item_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  source_revision: sourceRevisionSchema,
  expected_artifact_revisions: artifactRevisionExpectationsSchema,
  reusable_checkpoint_fingerprint: fingerprintSchema.nullable(),
}).strict();

export const retryContentMatrixGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  run_id: durableIdSchema.describe('Durable matrix generation run ID.'),
  expected_run_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact run revision returned by get_content_matrix_generation.'),
  items: z.array(retryItemSchema)
    .min(1)
    .max(MATRIX_GENERATION_BATCH_LIMITS.maxItems)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.item_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'item_id'],
            message: 'item_id values must be unique',
          });
        }
        seen.add(item.item_id);
      });
    })
    .describe('Explicit failed or needs-attention items with exact reusable checkpoints.'),
  idempotency_key: z.string().trim().min(1).max(200)
    .describe('Caller-stable replay key for this exact retry selection.'),
}).strict();

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
export type PreviewContentMatrixGenerationInput = z.infer<
  typeof previewContentMatrixGenerationInputSchema
>;
export type ResolveContentMatrixEvidenceInput = z.infer<
  typeof resolveContentMatrixEvidenceInputSchema
>;
export type StartContentMatrixGenerationInput = z.infer<
  typeof startContentMatrixGenerationInputSchema
>;
export type GetContentMatrixGenerationInput = z.infer<
  typeof getContentMatrixGenerationInputSchema
>;
export type RetryContentMatrixGenerationInput = z.infer<
  typeof retryContentMatrixGenerationInputSchema
>;
export type AcceptContentTemplateGenerationUpgradeInput = z.infer<
  typeof acceptContentTemplateGenerationUpgradeInputSchema
>;
