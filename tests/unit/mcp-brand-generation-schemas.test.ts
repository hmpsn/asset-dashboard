import { describe, expect, it } from 'vitest';

import {
  BRAND_GENERATION_LIMITS,
} from '../../shared/types/brand-generation.js';
import {
  getBrandGenerationInputSchema,
  resumeBrandDeliverableGenerationInputSchema,
  startBrandDeliverableGenerationInputSchema,
  startBrandDeliverableRevisionInputSchema,
} from '../../shared/types/mcp-brand-generation-schemas.js';

const fingerprint = 'a'.repeat(64);
const budget = {
  max_provider_calls: BRAND_GENERATION_LIMITS.maxProviderCalls,
  max_input_tokens: BRAND_GENERATION_LIMITS.maxInputTokens,
  max_output_tokens: BRAND_GENERATION_LIMITS.maxOutputTokens,
  max_estimated_cost_micros: BRAND_GENERATION_LIMITS.maxEstimatedUsdMicros,
  max_concurrency: BRAND_GENERATION_LIMITS.maxConcurrency,
};
const startBase = {
  workspace_id: 'ws_brand',
  intake_revision_id: 'bir_1',
  expected_intake_revision: 3,
  expected_intake_fingerprint: fingerprint,
  budget,
  idempotency_key: 'brand-generation-command-1',
};

describe('brand-generation MCP input schemas', () => {
  it('accepts bootstrap starts only without a claimed finalized voice', () => {
    expect(startBrandDeliverableGenerationInputSchema.safeParse({
      ...startBase,
      selection: { kind: 'atomic', target: 'voice_foundation' },
    }).success).toBe(true);
    expect(startBrandDeliverableGenerationInputSchema.safeParse({
      ...startBase,
      selection: { kind: 'preset', preset: 'full_brand_system' },
      expected_voice_version: 1,
      expected_voice_fingerprint: fingerprint,
    }).success).toBe(false);
  });

  it('requires an exact finalized voice tuple for every durable target and preset', () => {
    expect(startBrandDeliverableGenerationInputSchema.safeParse({
      ...startBase,
      selection: { kind: 'atomic', target: 'tagline' },
    }).success).toBe(false);
    expect(startBrandDeliverableGenerationInputSchema.safeParse({
      ...startBase,
      selection: { kind: 'preset', preset: 'identity_messaging' },
      expected_voice_version: 2,
      expected_voice_fingerprint: fingerprint,
    }).success).toBe(true);
  });

  it('enforces hard paid-work bounds and strict top-level inputs', () => {
    expect(startBrandDeliverableGenerationInputSchema.safeParse({
      ...startBase,
      selection: { kind: 'atomic', target: 'tagline' },
      expected_voice_version: 2,
      expected_voice_fingerprint: fingerprint,
      budget: { ...budget, max_provider_calls: budget.max_provider_calls + 1 },
    }).success).toBe(false);
    expect(startBrandDeliverableGenerationInputSchema.safeParse({
      ...startBase,
      selection: { kind: 'atomic', target: 'voice_foundation' },
      raw_prompt: 'must never cross the boundary',
    }).success).toBe(false);
  });

  it('bounds snapshot reads and rejects unknown paging fields', () => {
    expect(getBrandGenerationInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      item_limit: BRAND_GENERATION_LIMITS.maxItemPageSize,
    }).success).toBe(true);
    expect(getBrandGenerationInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      item_limit: BRAND_GENERATION_LIMITS.maxItemPageSize + 1,
    }).success).toBe(false);
    expect(getBrandGenerationInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      expected_run_revision: 1,
    }).success).toBe(false);
  });

  it('locks resume and revision commands to exact durable versions', () => {
    expect(resumeBrandDeliverableGenerationInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      expected_run_revision: 2,
      expected_voice_version: 1,
      expected_voice_fingerprint: fingerprint,
      idempotency_key: 'resume-1',
    }).success).toBe(true);
    expect(startBrandDeliverableRevisionInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      item_id: 'bgi_1',
      expected_run_revision: 2,
      expected_item_revision: 5,
      deliverable_id: 'bid_1',
      expected_deliverable_version: 3,
      direction: 'Make the language warmer without adding claims.',
      idempotency_key: 'revision-1',
    }).success).toBe(true);
    expect(startBrandDeliverableRevisionInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      item_id: 'bgi_1',
      expected_run_revision: 2,
      expected_item_revision: 5,
      deliverable_id: 'bid_1',
      expected_deliverable_version: 0,
      direction: 'Revise.',
      idempotency_key: 'revision-2',
    }).success).toBe(false);
    expect(startBrandDeliverableRevisionInputSchema.safeParse({
      workspace_id: 'ws_brand',
      run_id: 'bgr_1',
      item_id: 'bgi_1',
      expected_run_revision: 2,
      expected_item_revision: 5,
      deliverable_id: 'bid_1',
      expected_deliverable_version: 3,
      direction: 'é'.repeat(BRAND_GENERATION_LIMITS.maxDirectionBytes),
      idempotency_key: 'revision-3',
    }).success).toBe(false);
  });
});
