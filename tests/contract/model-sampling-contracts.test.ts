/**
 * Per-model sampling-contract census.
 *
 * WHY THIS EXISTS: on 2026-07-20 all brief and post generation went down
 * platform-wide because `getOpenAIRequestPolicy` derived the sampling contract
 * from model lineage (`startsWith('gpt-5.5')`) on the assumption that a
 * successor model inherits its predecessor's request surface. It does not.
 * `gpt-5.6-terra` rejects any non-default temperature, so every call passing
 * one returned 400. The defect was not the boolean — it was that a provider API
 * contract lived as an unverified assumption in a code comment with no test.
 *
 * This suite makes that class of mistake fail in CI instead of in a client's
 * generation run:
 *   - every model in both unions has a RECORDED contract (compile-time via
 *     `satisfies Record<Model, …>`, re-asserted here at runtime),
 *   - the recorded values are pinned to what the provider APIs actually
 *     returned when probed (the fixture below),
 *   - unknown models fall back to the safe side (send nothing optional).
 *
 * The pinned fixture is deliberately duplicated from the manifest rather than
 * imported wholesale: a test that reads the same object it asserts on proves
 * nothing. Update the fixture ONLY after re-probing the live API — see
 * `npm run verify:model-currency -- --check-sampling`, which performs that
 * probe in the nightly.
 */
import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_CHAT_MODELS,
  ANTHROPIC_MODEL_CONTRACTS,
  OPENAI_CHAT_MODELS,
  OPENAI_MODEL_CONTRACTS,
  SAMPLING_CONTRACTS_VERIFIED_AT,
  getAnthropicRequestPolicy,
  getOpenAIRequestPolicy,
} from '../../server/model-manifest.js';

/**
 * Ground truth captured by probing both provider APIs on 2026-07-20.
 * OpenAI: POST /v1/chat/completions with temperature 0.5.
 * Anthropic: POST /v1/messages with temperature 0.7.
 */
const PROBED_OPENAI_ACCEPTS_CUSTOM_TEMPERATURE: Record<string, boolean> = {
  // 400 unsupported_value: "Only the default (1) value is supported"
  'gpt-5.6-terra': false,
  'gpt-5.6-luna': false,
  'gpt-5.6-sol': false,
  'chat-latest': false,
};

const PROBED_ANTHROPIC_ACCEPTS_SAMPLING_PARAMS: Record<string, boolean> = {
  // 400 "`temperature` is deprecated for this model."
  'claude-opus-4-8': false,
  'claude-sonnet-5': false,
  // 200 OK
  'claude-haiku-4-5': true,
  'claude-haiku-4-5-20251001': true,
};

describe('model sampling contracts — completeness', () => {
  it('records a contract for every supported OpenAI model', () => {
    for (const model of OPENAI_CHAT_MODELS) {
      expect(
        Object.prototype.hasOwnProperty.call(OPENAI_MODEL_CONTRACTS, model),
        `No sampling contract recorded for OpenAI model "${model}". Probe the API for its temperature support and add a row to OPENAI_MODEL_CONTRACTS — do not infer it from a related model.`,
      ).toBe(true);
    }
  });

  it('records a contract for every supported Anthropic model', () => {
    for (const model of ANTHROPIC_CHAT_MODELS) {
      expect(
        Object.prototype.hasOwnProperty.call(ANTHROPIC_MODEL_CONTRACTS, model),
        `No sampling contract recorded for Anthropic model "${model}". Probe the API for its sampling-param support and add a row to ANTHROPIC_MODEL_CONTRACTS.`,
      ).toBe(true);
    }
  });

  it('records no contract for a model that is not supported (no stale rows)', () => {
    for (const model of Object.keys(OPENAI_MODEL_CONTRACTS)) {
      expect(OPENAI_CHAT_MODELS as readonly string[]).toContain(model);
    }
    for (const model of Object.keys(ANTHROPIC_MODEL_CONTRACTS)) {
      expect(ANTHROPIC_CHAT_MODELS as readonly string[]).toContain(model);
    }
  });

  it('carries a verification date so a stale census is visible', () => {
    expect(SAMPLING_CONTRACTS_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('model sampling contracts — pinned to probed provider behavior', () => {
  it('matches the probed OpenAI temperature contract for every model', () => {
    for (const model of OPENAI_CHAT_MODELS) {
      const probed = PROBED_OPENAI_ACCEPTS_CUSTOM_TEMPERATURE[model];
      expect(
        probed,
        `Model "${model}" has no probed result. Probe the live API and record it here before shipping.`,
      ).toBeDefined();
      expect(
        getOpenAIRequestPolicy(model).supportsCustomTemperature,
        `Recorded contract for "${model}" disagrees with the probed API behavior.`,
      ).toBe(probed);
    }
  });

  it('matches the probed Anthropic sampling contract for every model', () => {
    for (const model of ANTHROPIC_CHAT_MODELS) {
      const probed = PROBED_ANTHROPIC_ACCEPTS_SAMPLING_PARAMS[model];
      expect(probed, `Model "${model}" has no probed result.`).toBeDefined();
      expect(
        getAnthropicRequestPolicy(model).supportsSamplingParams,
        `Recorded contract for "${model}" disagrees with the probed API behavior.`,
      ).toBe(probed);
    }
  });

  it('regression: no GPT-5.6 tier accepts a custom temperature (the outage)', () => {
    // The exact assertion that would have caught the 2026-07-20 P0. terra was
    // assumed to inherit gpt-5.4's contract; it does not.
    for (const model of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol']) {
      expect(getOpenAIRequestPolicy(model).supportsCustomTemperature).toBe(false);
    }
  });
});

describe('model sampling contracts — unknown models fail safe', () => {
  it('omits temperature for an unrecorded OpenAI model', () => {
    // Sending an unsupported param is a hard 400; omitting a supported one only
    // costs variance. Unknown must therefore resolve to the conservative side.
    expect(getOpenAIRequestPolicy('gpt-9.9-unreleased').supportsCustomTemperature).toBe(false);
  });

  it('omits sampling params and thinking config for an unrecorded Anthropic model', () => {
    const policy = getAnthropicRequestPolicy('claude-unreleased-9');
    expect(policy.supportsSamplingParams).toBe(false);
    expect(policy.thinking).toBeUndefined();
    expect(policy.thinkingHeadroomTokens).toBe(0);
  });

  it('does not resolve a contract by prefix (the root cause of the outage)', () => {
    // 'gpt-5.6-terra-preview' is NOT 'gpt-5.6-terra'. A prefix-derived policy
    // would silently hand it terra's contract; a recorded-contract lookup must
    // fall back to the safe default instead.
    expect(getOpenAIRequestPolicy('gpt-5.6-terra-preview').supportsCustomTemperature).toBe(false);
    expect(getAnthropicRequestPolicy('claude-haiku-4-5-preview').supportsSamplingParams).toBe(false);
  });
});
