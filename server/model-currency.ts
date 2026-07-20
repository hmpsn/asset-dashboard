/**
 * Model-currency checker — asks each provider whether a manifest model ID
 * still resolves. Shared by the CI tripwire (scripts/verify-model-currency.ts,
 * which FAILS on a retired ID) and the non-blocking startup check
 * (runStartupModelCurrencyCheck, which alerts through the observability path
 * instead of refusing to boot — a model retirement should page us, not take
 * production down harder than the retirement itself).
 */
import {
  ACTIVE_MODEL_IDS,
  ANTHROPIC_CHAT_MODELS,
  OPENAI_CHAT_MODELS,
  getAnthropicRequestPolicy,
  getOpenAIRequestPolicy,
} from './model-manifest.js';
import { createLogger } from './logger.js';
import { isLocalFakeProviderModeEnabled } from './local-provider-mode.js';
import { Sentry, isSentryEnabled } from './sentry.js';

const log = createLogger('model-currency');

export interface ModelCurrencyResult {
  provider: 'openai' | 'anthropic';
  model: string;
  status: 'ok' | 'deprecated' | 'retired' | 'inconclusive';
  detail?: string;
  /** HTTP status of a non-OK provider response (absent on network errors). */
  httpStatus?: number;
}

/** Keys in a provider model payload that signal scheduled removal. */
const DEPRECATION_KEY_PATTERN = /deprecat|retir|sunset/i;

function findDeprecationMetadata(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const hits: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (DEPRECATION_KEY_PATTERN.test(key) && value !== null && value !== undefined && value !== false) {
      hits.push(`${key}=${JSON.stringify(value)}`);
    }
  }
  return hits.length > 0 ? hits.join(', ') : undefined;
}

async function checkOneModel(
  entry: { provider: 'openai' | 'anthropic'; model: string },
  timeoutMs: number,
): Promise<ModelCurrencyResult> {
  const { provider, model } = entry;
  const url = provider === 'anthropic'
    ? `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`
    : `https://api.openai.com/v1/models/${encodeURIComponent(model)}`;
  const headers: Record<string, string> = provider === 'anthropic'
    ? {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      }
    : { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) {
      return { provider, model, status: 'retired', detail: 'provider models API returned 404' };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        provider,
        model,
        status: 'inconclusive',
        detail: `HTTP ${res.status}: ${text.slice(0, 120)}`,
        httpStatus: res.status,
      };
    }
    const payload = await res.json().catch(() => undefined);
    const deprecation = findDeprecationMetadata(payload);
    if (deprecation) return { provider, model, status: 'deprecated', detail: deprecation };
    return { provider, model, status: 'ok' };
  } catch (err) {
    return {
      provider,
      model,
      status: 'inconclusive',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkModelCurrency(opts?: {
  models?: ReadonlyArray<{ provider: 'openai' | 'anthropic'; model: string }>;
  timeoutMs?: number;
}): Promise<ModelCurrencyResult[]> {
  const models = opts?.models ?? ACTIVE_MODEL_IDS;
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  return Promise.all(models.map(entry => checkOneModel(entry, timeoutMs)));
}

// --- Sampling-contract verification (the 2026-07-20 P0 guard) ---

export interface SamplingContractResult {
  provider: 'openai' | 'anthropic';
  model: string;
  /** What the manifest claims. */
  recorded: boolean;
  /** What the provider actually did when sent a non-default sampling param. */
  observed: boolean | null;
  status: 'match' | 'mismatch' | 'inconclusive';
  detail?: string;
}

/**
 * Send a deliberately non-default sampling param and see whether the provider
 * accepts it. A 400 means the model rejects custom sampling; a 200 means it
 * accepts. Any other outcome is inconclusive (network, quota, auth) and must
 * NOT be reported as a contract verdict.
 *
 * Deliberately tiny: 1 token of output per probe.
 */
async function probeSamplingSupport(
  provider: 'openai' | 'anthropic',
  model: string,
  timeoutMs: number,
): Promise<{ observed: boolean | null; detail?: string }> {
  try {
    const res = provider === 'openai'
      ? await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_completion_tokens: 1,
          temperature: 0.5,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      : await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

    if (res.ok) return { observed: true };
    const text = await res.text().catch(() => '');
    // Only a param-rejection 400 is evidence the contract forbids sampling.
    if (res.status === 400 && /temperature/i.test(text)) {
      return { observed: false, detail: text.slice(0, 140) };
    }
    return { observed: null, detail: `HTTP ${res.status}: ${text.slice(0, 140)}` };
  } catch (err) {
    return { observed: null, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Verify every recorded sampling contract against the live provider APIs.
 *
 * This is the periodic half of the guard added after the 2026-07-20 outage:
 * the contract test pins the recorded values in CI, and this re-verifies those
 * values against the providers so drift (or an assumption that was wrong from
 * the start) surfaces in the nightly rather than in a client's generation run.
 */
export async function checkSamplingContracts(opts?: {
  timeoutMs?: number;
}): Promise<SamplingContractResult[]> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const targets: Array<{ provider: 'openai' | 'anthropic'; model: string; recorded: boolean }> = [
    ...(process.env.OPENAI_API_KEY
      ? OPENAI_CHAT_MODELS.map(model => ({
        provider: 'openai' as const,
        model,
        recorded: getOpenAIRequestPolicy(model).supportsCustomTemperature,
      }))
      : []),
    ...(process.env.ANTHROPIC_API_KEY
      ? ANTHROPIC_CHAT_MODELS.map(model => ({
        provider: 'anthropic' as const,
        model,
        recorded: getAnthropicRequestPolicy(model).supportsSamplingParams,
      }))
      : []),
  ];

  return Promise.all(targets.map(async (target) => {
    const { observed, detail } = await probeSamplingSupport(target.provider, target.model, timeoutMs);
    const status = observed === null
      ? 'inconclusive' as const
      : observed === target.recorded ? 'match' as const : 'mismatch' as const;
    return { ...target, observed, status, detail };
  }));
}

/**
 * Non-blocking startup check: verify every manifest model still resolves at
 * its provider, alerting (Sentry + error log) on any retired ID and warning on
 * deprecation metadata. Providers without a configured key are skipped —
 * local/dev environments are not the audience for this alert.
 */
export function runStartupModelCurrencyCheck(): void {
  // Spawned test servers and fake-provider dev environments must not hit
  // provider APIs at boot — the tripwire's audience is real deployments + CI.
  if (process.env.NODE_ENV === 'test' || isLocalFakeProviderModeEnabled()) return;
  const models = ACTIVE_MODEL_IDS.filter(entry =>
    entry.provider === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY,
  );
  if (models.length === 0) return;

  void checkModelCurrency({ models }).then(results => {
    for (const result of results) {
      if (result.status === 'retired') {
        const message = `Model ${result.provider}/${result.model} is retired or unknown (404) — live call paths WILL fail. Update server/model-manifest.ts.`;
        log.error({ provider: result.provider, model: result.model }, message);
        if (isSentryEnabled) Sentry.captureMessage(message, 'error');
      } else if (result.status === 'deprecated') {
        log.warn(
          { provider: result.provider, model: result.model, detail: result.detail },
          `Model ${result.provider}/${result.model} carries deprecation metadata — schedule a manifest update`,
        );
      }
    }
  }).catch(err => {
    // Currency checking must never destabilize boot.
    log.warn({ err }, 'startup model-currency check failed to run');
  });
}
