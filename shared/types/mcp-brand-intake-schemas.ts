import { z } from 'zod';
import {
  BRAND_INTAKE_BUYING_STAGES,
  BRAND_INTAKE_FIELD_PATHS,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_RESOLUTION_SOURCE_TYPES,
  brandIntakeEvidenceRequirementId,
} from './brand-intake.js';
import {
  brandIntakeEvidenceRequirementIdSchema,
  brandIntakeEvidenceValueSchema,
  refineBrandIntakeEvidenceFieldValue,
} from './brand-intake-schemas.js';

const workspaceIdSchema = z.string().trim().min(1, 'workspace_id is required')
  .max(BRAND_INTAKE_LIMITS.maxIdLength)
  .describe('The workspace whose durable brand intake is being addressed.');
const durableIdSchema = z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength);

const optionalText = (max: number, description: string) => z.string().trim().max(max)
  .optional().default('').describe(description);
const optionalList = (description: string) => z.array(
  z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxListItemLength),
).max(BRAND_INTAKE_LIMITS.maxListItems).optional().default([]).describe(description);

export const submitBrandIntakeInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  questionnaire: z.object({
    business: z.object({
      business_name: optionalText(BRAND_INTAKE_LIMITS.maxShortTextLength, 'Business or brand name; leave empty when not supplied.'),
      industry: optionalText(BRAND_INTAKE_LIMITS.maxShortTextLength, 'Industry; leave empty when not supplied.'),
      description: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Factual business description; do not invent missing facts.'),
      services: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Services explicitly supplied by the operator or client.'),
      locations: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Locations explicitly supplied by the operator or client.'),
      differentiators: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Differentiators supported by the submitted intake.'),
      website: optionalText(BRAND_INTAKE_LIMITS.maxUrlLength, 'Absolute HTTP(S) website URL, or empty when unknown.'),
    }).strict().optional().default({}),
    audience: z.object({
      primary_audience: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Primary audience stated in the intake.'),
      pain_points: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Audience pain points stated in the intake.'),
      goals: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Audience goals stated in the intake.'),
      objections: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Audience objections stated in the intake.'),
      buying_stage: z.union([z.enum(BRAND_INTAKE_BUYING_STAGES), z.literal('')])
        .optional().default('').describe('Buying stage, or empty when not supplied.'),
      secondary_audience: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Secondary audience stated in the intake.'),
    }).strict().optional().default({}),
    brand: z.object({
      tone: optionalText(BRAND_INTAKE_LIMITS.maxToneLength, 'Desired brand tone from the intake.'),
      personality: optionalList('Desired personality traits from the intake.'),
      avoid_words: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Words or phrases the brand asks writers to avoid.'),
      content_formats: optionalList('Content formats the brand expects to use.'),
      existing_examples: optionalText(BRAND_INTAKE_LIMITS.maxExampleLength, 'Existing examples supplied for reference; do not fabricate examples.'),
    }).strict().optional().default({}),
    competitors: z.object({
      competitors: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Competitors explicitly identified in the intake.'),
      what_they_do_better: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Submitted view of competitor strengths.'),
      what_you_do_better: optionalText(BRAND_INTAKE_LIMITS.maxTextLength, 'Submitted view of the brand strengths.'),
      reference_urls: optionalText(
        BRAND_INTAKE_LIMITS.maxUrlLength * BRAND_INTAKE_LIMITS.maxListItems,
        'Newline-separated absolute HTTP(S) reference URLs, or empty.',
      ),
    }).strict().optional().default({}),
  }).strict().describe('Questionnaire fields to store as one immutable MCP-sourced intake revision.'),
  idempotency_key: z.string().trim().min(1)
    .max(BRAND_INTAKE_LIMITS.maxIdempotencyKeyLength)
    .describe('Caller-stable key bound to this exact intake submission across delayed retries.'),
}).strict();

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
  refineBrandIntakeEvidenceFieldValue({
    fieldPath: value.field_path,
    value: value.value,
  }, ctx);
  if (value.requirement_id !== brandIntakeEvidenceRequirementId(value.field_path)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requirement_id'],
      message: `requirement_id must address ${value.field_path}`,
    });
  }
});

export type GetBrandIntakeInput = z.infer<typeof getBrandIntakeInputSchema>;
export type SubmitBrandIntakeInput = z.infer<typeof submitBrandIntakeInputSchema>;
export type ResolveBrandIntakeEvidenceInput = z.infer<
  typeof resolveBrandIntakeEvidenceInputSchema
>;
