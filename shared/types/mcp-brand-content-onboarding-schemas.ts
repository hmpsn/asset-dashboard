import { z } from 'zod';

import { BRAND_CONTENT_ONBOARDING_STATUSES } from './brand-content-onboarding.js';
import { BRAND_GENERATION_LIMITS } from './brand-generation.js';
import { MATRIX_READ_LIMITS } from './matrix-generation.js';

const id = z.string().trim().min(1).max(128);
const idempotencyKey = z.string().trim().min(1).max(128);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const sourceRevision = z.object({
  matrix_revision: revision,
  template_revision: revision,
  cell_revision: revision,
}).strict();

const matrixSelection = z.array(z.object({
  matrix_id: id,
  cell_id: id,
  source_revision: sourceRevision,
  structural_fingerprint: fingerprint,
  preview_fingerprint: fingerprint.nullable(),
}).strict()).min(1).max(MATRIX_READ_LIMITS.maxResolveSelection);

const brandBudget = z.object({
  max_provider_calls: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxProviderCalls),
  max_input_tokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxInputTokens),
  max_output_tokens: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxOutputTokens),
  max_estimated_cost_micros: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros),
  max_concurrency: z.number().int().min(1).max(BRAND_GENERATION_LIMITS.maxConcurrency),
}).strict();

export const startBrandContentOnboardingInputSchema = z.object({
  workspace_id: id.describe('Workspace that owns the exact intake and matrix selection.'),
  intake_revision_id: id.describe('Exact immutable brand-intake revision ID.'),
  expected_intake_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    .describe('Expected revision number for optimistic authority validation.'),
  expected_intake_fingerprint: fingerprint
    .describe('Expected fingerprint of the immutable intake revision.'),
  matrix_selection: matrixSelection
    .describe('Non-empty durable matrix-cell selection for the eventual page-set child.'),
  brand_budget: brandBudget.describe('Explicit bounded budget for the full brand-system child run.'),
  idempotency_key: idempotencyKey.describe('Caller-owned key for exactly-once start acceptance.'),
}).strict();

export const getBrandContentOnboardingInputSchema = z.object({
  workspace_id: id.describe('Workspace that owns the onboarding run.'),
  run_id: id.describe('Durable onboarding run ID.'),
}).strict();

export const resumeBrandContentOnboardingInputSchema = z.object({
  workspace_id: id.describe('Workspace that owns the onboarding run.'),
  run_id: id.describe('Durable onboarding run ID.'),
  expected_revision: revision.describe('Expected run revision for optimistic concurrency.'),
  expected_status: z.enum(BRAND_CONTENT_ONBOARDING_STATUSES)
    .describe('Expected current lifecycle status.'),
  gate_evidence_id: id.describe('ID of the durable child run, review, voice finalization, or matrix run expected at this gate.'),
  idempotency_key: idempotencyKey.describe('Caller-owned key for exactly-once gate evaluation.'),
}).strict();

export type StartBrandContentOnboardingInput = z.infer<
  typeof startBrandContentOnboardingInputSchema
>;
export type GetBrandContentOnboardingInput = z.infer<
  typeof getBrandContentOnboardingInputSchema
>;
export type ResumeBrandContentOnboardingInput = z.infer<
  typeof resumeBrandContentOnboardingInputSchema
>;
