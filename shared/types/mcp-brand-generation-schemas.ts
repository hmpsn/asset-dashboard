import { z } from 'zod';

import {
  BRAND_DELIVERABLE_TARGET_POLICY,
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_LIMITS,
  BRAND_GENERATION_PRESETS,
} from './brand-generation.js';

const utf8Encoder = new TextEncoder();

const workspaceIdSchema = z.string().trim().min(1)
  .max(BRAND_GENERATION_LIMITS.maxIdLength);
const durableIdSchema = z.string().trim().min(1)
  .max(BRAND_GENERATION_LIMITS.maxIdLength);
const idempotencyKeySchema = z.string().trim().min(1)
  .max(BRAND_GENERATION_LIMITS.maxIdempotencyKeyLength);
const fingerprintSchema = z.string().regex(
  /^[a-f0-9]{64}$/,
  'must be a lowercase SHA-256 fingerprint',
);
export const brandGenerationCursorSchema = z.string().trim().min(1)
  .max(BRAND_GENERATION_LIMITS.maxCursorLength)
  .regex(
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    'item_cursor must be an opaque signed base64url token',
  );

const selectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('atomic'),
    target: z.enum(BRAND_GENERATION_ATOMIC_TARGETS),
  }).strict(),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(BRAND_GENERATION_PRESETS),
  }).strict(),
]);

const budgetSchema = z.object({
  max_provider_calls: z.number().int().min(1)
    .max(BRAND_GENERATION_LIMITS.maxProviderCalls),
  max_input_tokens: z.number().int().min(1)
    .max(BRAND_GENERATION_LIMITS.maxInputTokens),
  max_output_tokens: z.number().int().min(1)
    .max(BRAND_GENERATION_LIMITS.maxOutputTokens),
  max_estimated_cost_micros: z.number().int().min(1)
    .max(BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros),
  max_concurrency: z.number().int().min(1)
    .max(BRAND_GENERATION_LIMITS.maxConcurrency),
}).strict();

export const startBrandDeliverableGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema
    .describe('Workspace whose accepted brand intake and voice authority will be used.'),
  intake_revision_id: durableIdSchema
    .describe('Exact immutable brand-intake revision ID.'),
  expected_intake_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact monotonic intake revision used to prepare this start.'),
  expected_intake_fingerprint: fingerprintSchema
    .describe('Fingerprint of the exact immutable intake revision.'),
  selection: selectionSchema
    .describe('One atomic target or one ordered preset; arrays and mixed selections are invalid.'),
  expected_voice_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
    .describe('Required exact finalized voice version for every durable target; omitted for voice foundation/full-suite bootstrap.'),
  expected_voice_fingerprint: fingerprintSchema.optional()
    .describe('Required immutable voice fingerprint whenever expected_voice_version is present.'),
  budget: budgetSchema
    .describe('Caller ceiling bounded by the platform hard paid-work limits.'),
  idempotency_key: idempotencyKeySchema
    .describe('Caller-stable key bound to this exact intake, selection, voice, and budget command.'),
}).strict().superRefine((value, ctx) => {
  const bootstrap = value.selection.kind === 'atomic'
    ? BRAND_DELIVERABLE_TARGET_POLICY[value.selection.target].voicePolicy === 'bootstrap'
    : value.selection.preset === 'full_brand_system';
  const hasVoiceVersion = value.expected_voice_version !== undefined;
  const hasVoiceFingerprint = value.expected_voice_fingerprint !== undefined;
  if (bootstrap && (hasVoiceVersion || hasVoiceFingerprint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_voice_version'],
      message: 'bootstrap starts must not claim finalized voice authority',
    });
  }
  if (!bootstrap && (!hasVoiceVersion || !hasVoiceFingerprint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_voice_version'],
      message: 'durable brand generation requires an exact finalized voice version and fingerprint',
    });
  }
});

export const getBrandGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema
    .describe('Workspace that owns the durable brand-generation run.'),
  run_id: durableIdSchema
    .describe('Durable brand-generation run ID.'),
  item_cursor: brandGenerationCursorSchema.optional()
    .describe('Opaque item cursor bound to the workspace, run ID, run revision, and stable position.'),
  item_limit: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxItemPageSize).optional()
    .describe(`Item page size; defaults to ${BRAND_GENERATION_LIMITS.defaultItemPageSize} and caps at ${BRAND_GENERATION_LIMITS.maxItemPageSize}.`),
}).strict();

export const resumeBrandDeliverableGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema
    .describe('Workspace that owns the paused full-brand-system run.'),
  run_id: durableIdSchema
    .describe('Paused full-brand-system run ID.'),
  expected_run_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact run revision read before this resume command.'),
  expected_voice_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact durable finalized voice version that unlocks dependent generation.'),
  expected_voice_fingerprint: fingerprintSchema
    .describe('Fingerprint of the exact immutable finalized voice snapshot.'),
  idempotency_key: idempotencyKeySchema
    .describe('Caller-stable key bound to this exact run revision and voice authority.'),
}).strict();

export const startBrandDeliverableRevisionInputSchema = z.object({
  workspace_id: workspaceIdSchema
    .describe('Workspace that owns the generated brand deliverable.'),
  run_id: durableIdSchema
    .describe('Durable brand-generation run ID.'),
  item_id: durableIdSchema
    .describe('Generated durable-deliverable item to revise; voice foundation is not accepted.'),
  expected_run_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact run revision read before requesting the revision.'),
  expected_item_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact item revision read before requesting the revision.'),
  deliverable_id: durableIdSchema
    .describe('Exact committed BrandDeliverable ID linked by the item.'),
  expected_deliverable_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe('Exact current BrandDeliverable version; a later operator edit wins.'),
  direction: z.string().trim().min(1).refine(
    value => utf8Encoder.encode(value).byteLength <= BRAND_GENERATION_LIMITS.maxDirectionBytes,
    `direction must not exceed ${BRAND_GENERATION_LIMITS.maxDirectionBytes} UTF-8 bytes`,
  )
    .describe('Explicit review direction; generated content and raw evidence are not accepted here.'),
  idempotency_key: idempotencyKeySchema
    .describe('Caller-stable key bound to this exact revision request.'),
}).strict();

export type StartBrandDeliverableGenerationInput = z.infer<
  typeof startBrandDeliverableGenerationInputSchema
>;
export type GetBrandGenerationInput = z.infer<typeof getBrandGenerationInputSchema>;
export type ResumeBrandDeliverableGenerationInput = z.infer<
  typeof resumeBrandDeliverableGenerationInputSchema
>;
export type StartBrandDeliverableRevisionInput = z.infer<
  typeof startBrandDeliverableRevisionInputSchema
>;
