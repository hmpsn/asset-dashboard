/**
 * Model manifest — single source of truth for every concrete LLM model ID the
 * platform calls, what each costs, and which request parameters each model
 * family accepts.
 *
 * The contract (2026-07 model upgrade, see docs/rules/model-manifest.md):
 * - Call sites and the AI operation registry reference semantic roles or the
 *   exported constants below — never inline model-ID string literals. The next
 *   model upgrade should be an edit to THIS file (plus prompt re-tuning), not
 *   a repo-wide sweep.
 * - Pricing lives here once. `server/openai-helpers.ts` (estimateCost) and
 *   `server/platform-observability-report.ts` (estimateAiCostUsd) both
 *   delegate to `estimateModelCostUsd()`. Historical rows are retained because
 *   cost dashboards re-price usage entries logged under old model IDs.
 * - Per-model-family request-parameter rules (does the model accept
 *   `temperature`? what thinking config does it need?) live here and are
 *   consulted by the provider helpers. Call sites carry no per-model param
 *   knowledge — that coupling is what made past migrations painful.
 * - `scripts/verify-model-currency.ts` iterates ACTIVE_MODEL_IDS against each
 *   provider's models API (fail on retired/404, warn on deprecation) so a
 *   model retirement can never again sit unnoticed in a live code path.
 */

// --- Semantic roles → concrete model IDs ---

export const MODEL_ROLES = {
  /**
   * ALL Claude-side creative generation (brand deliverables, website copy,
   * post/blog sections, calibration, blueprint strategy, pSEO matrix batch).
   * Uniform Opus routing — no per-op split (owner decision, 2026-07-19):
   * Opus 4.8 prose is clearer/warmer with fewer AI vocal tics, the exact axis
   * the studio competes on. ~2.2× Claude-side spend vs the 4.6 baseline,
   * accepted with numbers.
   */
  creativeWriter: 'claude-opus-4-8',
  /** OpenAI-side structured synthesis / analysis workhorse (succeeds gpt-5.4, price-identical). */
  structuredSynthesis: 'gpt-5.6-terra',
  /** OpenAI-side bulk/cheap structured utility work (succeeds gpt-5.4-mini AND gpt-5.4-nano; no smaller 5.6 tier exists). */
  utilityExtraction: 'gpt-5.6-luna',
  /**
   * Anthropic-side schema-filling tool-use utility (callAnthropicWithTools).
   * Deliberately kept on Haiku 4.5: the work is speed/cost-shaped, not
   * judgment-shaped (owner decision, 2026-07-19 — not bumped to Sonnet, not
   * swapped to Luna). Escape hatch: per-call bump to `claude-sonnet-5`.
   */
  utilityExtractionAnthropic: 'claude-haiku-4-5-20251001',
  /**
   * Cross-provider creative recovery: the OpenAI-side fallback of the
   * Claude-preferred creative dispatch plus brand recovery/audit paths.
   * Deliberately stays OpenAI (succeeds gpt-5.5, price-identical) — an
   * Anthropic fallback here would delete the provider-outage protection.
   */
  creativeRecovery: 'gpt-5.6-sol',
  /** Image generation. */
  image: 'gpt-image-2',
} as const;

export type ModelRole = keyof typeof MODEL_ROLES;

// --- Model catalogs (drive the provider helpers' option unions) ---

/**
 * Anthropic models callers may request. `claude-sonnet-5` carries no default
 * op routing but stays available as the designed per-call escape hatch
 * ($3/$15; intro $2/$10 through 2026-08-31).
 */
export const ANTHROPIC_CHAT_MODELS = [
  MODEL_ROLES.creativeWriter,
  'claude-sonnet-5',
  'claude-haiku-4-5',
  MODEL_ROLES.utilityExtractionAnthropic,
] as const;
export type AnthropicChatModel = (typeof ANTHROPIC_CHAT_MODELS)[number];

/** OpenAI chat models callers may request. */
export const OPENAI_CHAT_MODELS = [
  MODEL_ROLES.creativeRecovery,
  MODEL_ROLES.structuredSynthesis,
  MODEL_ROLES.utilityExtraction,
  'chat-latest',
] as const;
export type OpenAIChatModel = (typeof OPENAI_CHAT_MODELS)[number];

export const DEFAULT_ANTHROPIC_MODEL: AnthropicChatModel = MODEL_ROLES.creativeWriter;
export const DEFAULT_OPENAI_MODEL: OpenAIChatModel = MODEL_ROLES.utilityExtraction;

/**
 * Every concrete model ID the platform actively calls, with the provider to
 * validate it against. Consumed by scripts/verify-model-currency.ts (CI
 * tripwire) and the non-blocking startup currency check.
 * `chat-latest` is a provider alias, validated as-is.
 */
export const ACTIVE_MODEL_IDS: ReadonlyArray<{ provider: 'openai' | 'anthropic'; model: string }> = [
  { provider: 'anthropic', model: MODEL_ROLES.creativeWriter },
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  { provider: 'anthropic', model: 'claude-haiku-4-5' },
  { provider: 'anthropic', model: MODEL_ROLES.utilityExtractionAnthropic },
  { provider: 'openai', model: MODEL_ROLES.creativeRecovery },
  { provider: 'openai', model: MODEL_ROLES.structuredSynthesis },
  { provider: 'openai', model: MODEL_ROLES.utilityExtraction },
  { provider: 'openai', model: MODEL_ROLES.image },
];

// --- Pricing (single source; USD per million tokens) ---

interface ModelPricingRow {
  /** First matching row wins — keep more-specific prefixes before generic ones. */
  matches: (model: string) => boolean;
  inputPerMTok: number;
  outputPerMTok: number;
  /** `historical` rows price usage entries logged before a migration; never delete them. */
  status: 'current' | 'historical';
}

const MTOK = 1_000_000;

/**
 * Ordered pricing table. Current rows verified 2026-07-19 (GPT-5.6 GA pricing;
 * Anthropic list pricing — Sonnet 5 books at the standard $3/$15, not the
 * intro rate). Historical rows keep old usage entries priced truthfully.
 */
const MODEL_PRICING_TABLE: ModelPricingRow[] = [
  // Current — OpenAI GPT-5.6 family
  { matches: m => m.startsWith('gpt-5.6-sol'), inputPerMTok: 5, outputPerMTok: 30, status: 'current' },
  { matches: m => m.startsWith('gpt-5.6-terra'), inputPerMTok: 2.5, outputPerMTok: 15, status: 'current' },
  { matches: m => m.startsWith('gpt-5.6-luna'), inputPerMTok: 1, outputPerMTok: 6, status: 'current' },
  // Current — Anthropic
  { matches: m => m.includes('claude-opus-4'), inputPerMTok: 5, outputPerMTok: 25, status: 'current' },
  { matches: m => m.includes('claude-sonnet-5'), inputPerMTok: 3, outputPerMTok: 15, status: 'current' },
  { matches: m => m.includes('claude-haiku-4-5'), inputPerMTok: 1, outputPerMTok: 5, status: 'current' },
  // Historical — OpenAI GPT-5.4/5.5 generation
  { matches: m => m.startsWith('gpt-5.5'), inputPerMTok: 5, outputPerMTok: 30, status: 'historical' },
  { matches: m => m.startsWith('gpt-5.4-nano'), inputPerMTok: 0.2, outputPerMTok: 1.25, status: 'historical' },
  { matches: m => m.startsWith('gpt-5.4-mini'), inputPerMTok: 0.75, outputPerMTok: 4.5, status: 'historical' },
  { matches: m => m.startsWith('gpt-5.4'), inputPerMTok: 2.5, outputPerMTok: 15, status: 'historical' },
  // Historical — OpenAI GPT-4.1 generation (startsWith so dated variants like
  // gpt-4.1-mini-2025-04-14 keep matching their tier)
  { matches: m => m.startsWith('gpt-4.1-nano'), inputPerMTok: 0.1, outputPerMTok: 0.4, status: 'historical' },
  { matches: m => m.startsWith('gpt-4.1-mini'), inputPerMTok: 0.4, outputPerMTok: 1.6, status: 'historical' },
  { matches: m => m.startsWith('gpt-4.1'), inputPerMTok: 2, outputPerMTok: 8, status: 'historical' },
  // Historical — gpt-4o family (was in the old callOpenAI union, so old usage
  // logs can carry these; they previously priced at the fallback rate)
  { matches: m => m.startsWith('gpt-4o-mini'), inputPerMTok: 0.15, outputPerMTok: 0.6, status: 'historical' },
  { matches: m => m.startsWith('gpt-4o'), inputPerMTok: 2.5, outputPerMTok: 10, status: 'historical' },
  // Historical — Anthropic Sonnet 4.x + Claude 3.5 generation
  { matches: m => m.includes('claude-sonnet-4'), inputPerMTok: 3, outputPerMTok: 15, status: 'historical' },
  { matches: m => m.includes('claude-3-5-sonnet'), inputPerMTok: 3, outputPerMTok: 15, status: 'historical' },
  { matches: m => m.includes('claude-3-5-haiku'), inputPerMTok: 0.8, outputPerMTok: 4, status: 'historical' },
];

/** Unknown models price at the current default utility tier (Luna). */
const FALLBACK_PRICING = { inputPerMTok: 1, outputPerMTok: 6 };

/**
 * Canonical cost estimator. Both cost surfaces (openai-helpers usage tracking
 * and the platform observability report) delegate here — never fork this.
 */
export function estimateModelCostUsd(entry: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const row = MODEL_PRICING_TABLE.find(r => r.matches(entry.model));
  const pricing = row ?? FALLBACK_PRICING;
  return (
    (entry.promptTokens * pricing.inputPerMTok) / MTOK +
    (entry.completionTokens * pricing.outputPerMTok) / MTOK
  );
}

// --- Per-family request-parameter rules ---

export interface AnthropicRequestPolicy {
  /**
   * `temperature`/`top_p`/`top_k` are fully REMOVED on Opus 4.7+/Sonnet 5 —
   * any value 400s the request. Helpers must omit sampling params when false.
   */
  supportsSamplingParams: boolean;
  /**
   * Explicit thinking config to send. Opus 4.8 runs thinking OFF when the
   * field is omitted; creative/judgment work deliberately opts into adaptive
   * thinking (Opus prose quality peaks at higher effort — the point of the
   * upgrade). Sonnet 5 runs adaptive by default, so nothing is sent there.
   */
  thinking?: { type: 'adaptive' };
  /** Effort pairing for the adaptive-thinking creative path. */
  outputConfig?: { effort: 'high' };
  /**
   * Extra output-token budget added on top of the caller's content-sized
   * maxTokens. Adaptive thinking shares the max_tokens budget with the
   * response; without headroom, thinking would starve the content budget that
   * call sites tuned for the pre-thinking models.
   */
  thinkingHeadroomTokens: number;
}

const OPUS_ADAPTIVE_POLICY: AnthropicRequestPolicy = {
  supportsSamplingParams: false,
  thinking: { type: 'adaptive' },
  outputConfig: { effort: 'high' },
  thinkingHeadroomTokens: 4096,
};

export function getAnthropicRequestPolicy(model: string): AnthropicRequestPolicy {
  if (model.startsWith('claude-opus-4-8') || model.startsWith('claude-opus-4-7')) {
    return OPUS_ADAPTIVE_POLICY;
  }
  if (model.startsWith('claude-sonnet-5')) {
    // Adaptive thinking is already the omitted-field default on Sonnet 5;
    // sampling params are rejected the same as on Opus 4.7+.
    return { supportsSamplingParams: false, thinkingHeadroomTokens: 4096 };
  }
  // Haiku 4.5 and older families keep the classic request surface.
  return { supportsSamplingParams: true, thinkingHeadroomTokens: 0 };
}

export interface OpenAIRequestPolicy {
  /**
   * gpt-5.5 accepted only its default temperature; its successor gpt-5.6-sol
   * keeps that contract. Terra/Luna (gpt-5.4 lineage) accept custom values.
   */
  supportsCustomTemperature: boolean;
}

export function getOpenAIRequestPolicy(model: string): OpenAIRequestPolicy {
  return {
    supportsCustomTemperature: !(model.startsWith('gpt-5.5') || model.startsWith('gpt-5.6-sol')),
  };
}
