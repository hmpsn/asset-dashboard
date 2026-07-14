import { z } from 'zod';
import {
  BRAND_INTAKE_FIELD_PATHS,
  BRAND_INTAKE_FIELD_POLICY,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_RESOLUTION_SOURCE_TYPES,
  brandIntakeEvidenceRequirementId,
} from './brand-intake.js';
import {
  brandIntakeEvidenceRequirementIdSchema,
  brandIntakeEvidenceValueSchema,
} from './brand-intake-schemas.js';

const workspaceIdSchema = z.string().trim().min(1, 'workspace_id is required')
  .max(BRAND_INTAKE_LIMITS.maxIdLength)
  .describe('The workspace whose durable brand intake is being addressed.');
const durableIdSchema = z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength);

const mcpResolutionSourceRefSchema = z.object({
  source_type: z.enum(BRAND_INTAKE_RESOLUTION_SOURCE_TYPES),
  source_id: durableIdSchema,
  source_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  field_path: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxShortTextLength).optional(),
  label: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxActorLabelLength).optional(),
  uri: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxUrlLength).optional(),
  captured_at: z.string().datetime(),
}).strict();

export const getBrandIntakeInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  intake_revision_id: durableIdSchema.optional()
    .describe('Optional immutable intake revision ID; omit to read the current revision.'),
}).strict();

export const resolveBrandIntakeEvidenceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  intake_revision_id: durableIdSchema
    .describe('Exact immutable intake revision that owns the unresolved field.'),
  expected_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact monotonic intake revision used to prepare this resolution.'),
  requirement_id: brandIntakeEvidenceRequirementIdSchema
    .describe('Stable requirement identity supplied by the intake evidence read model.'),
  field_path: z.enum(BRAND_INTAKE_FIELD_PATHS)
    .describe('Finite questionnaire field path; arbitrary JSON paths are rejected.'),
  value: brandIntakeEvidenceValueSchema
    .describe('Typed replacement value whose kind must match the selected field policy.'),
  source_ref: mcpResolutionSourceRefSchema
    .describe('Durable factual evidence; generated and structural sources are not allowed.'),
  idempotency_key: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdempotencyKeyLength)
    .describe('Caller-stable key bound to this exact resolution mutation.'),
}).strict().superRefine((value, ctx) => {
  const expectedKind = BRAND_INTAKE_FIELD_POLICY[value.field_path].valueKind;
  if (value.value.kind !== expectedKind) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value', 'kind'],
      message: `${value.field_path} requires evidence value kind ${expectedKind}`,
    });
  }
  if (value.requirement_id !== brandIntakeEvidenceRequirementId(value.field_path)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requirement_id'],
      message: `requirement_id must address ${value.field_path}`,
    });
  }
});

export type GetBrandIntakeInput = z.infer<typeof getBrandIntakeInputSchema>;
export type ResolveBrandIntakeEvidenceInput = z.infer<
  typeof resolveBrandIntakeEvidenceInputSchema
>;
