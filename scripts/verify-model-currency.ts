/**
 * Model-currency tripwire.
 *
 * TRUST BOUNDARY: the model manifest (server/model-manifest.ts) pins every
 * concrete model ID the platform calls, but nothing in typecheck/tests can see
 * whether a provider has DEPRECATED or RETIRED one of those IDs — a retired
 * model 404s only at request time, in production, on a paid call path. Two
 * retired Claude 3.5 IDs sat live in server/anthropic-helpers.ts for ~9 months
 * because no automated check ever asked the providers "does this model still
 * exist?". This script is that check.
 *
 * For each entry in ACTIVE_MODEL_IDS it hits the provider's models API:
 *   - Anthropic: GET https://api.anthropic.com/v1/models/{id}
 *   - OpenAI:    GET https://api.openai.com/v1/models/{id}
 * A 404 (model retired/unknown) FAILS the run (exit 1). Any deprecation
 * metadata the provider returns (keys matching /deprecat|retir|sunset/i) is
 * surfaced as a loud WARNING so the swap can be scheduled before retirement.
 *
 * Usage:
 *   npm run verify:model-currency
 *   npm run verify:model-currency -- --require-keys   # fail if a key is absent
 *
 * Without a provider's API key that provider's models are SKIPPED gracefully
 * (exit 0) — local/dev and CI without provider creds are not blocked. The
 * nightly workflow passes real keys so the tripwire actually fires there; the
 * server also runs a non-blocking variant at boot (server/model-currency.ts).
 */
import { ACTIVE_MODEL_IDS } from '../server/model-manifest.js';
import { checkModelCurrency } from '../server/model-currency.js';

const requireKeys = process.argv.includes('--require-keys');

async function main(): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const missingKeyProviders = [
    ...(anthropicKey ? [] : ['anthropic']),
    ...(openaiKey ? [] : ['openai']),
  ];
  if (missingKeyProviders.length > 0) {
    for (const provider of missingKeyProviders) {
      console.log(`⚠️  ${provider}: no API key configured — skipping ${provider} model checks`);
    }
    if (requireKeys) {
      console.error('❌ --require-keys set and at least one provider key is missing');
      process.exit(1);
    }
  }

  const results = await checkModelCurrency({
    models: ACTIVE_MODEL_IDS.filter(entry =>
      entry.provider === 'anthropic' ? !!anthropicKey : !!openaiKey,
    ),
  });

  let failed = 0;
  let warned = 0;
  for (const result of results) {
    if (result.status === 'ok') {
      console.log(`✅ ${result.provider}/${result.model}: resolves`);
    } else if (result.status === 'deprecated') {
      warned += 1;
      console.log(`⚠️  ${result.provider}/${result.model}: DEPRECATION metadata present — ${result.detail}`);
    } else if (result.status === 'retired') {
      failed += 1;
      console.error(`❌ ${result.provider}/${result.model}: RETIRED or unknown (404) — a live call path would fail. Update server/model-manifest.ts.`);
    } else {
      // Transient provider/network trouble is not a currency verdict — surface
      // it without failing the run so flaky networks don't cry wolf.
      console.log(`⚠️  ${result.provider}/${result.model}: check inconclusive — ${result.detail}`);
    }
  }

  const checked = results.length;
  console.log(`\nmodel-currency: ${checked} checked, ${warned} deprecation warning(s), ${failed} retired`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('model-currency check crashed:', err);
  process.exit(1);
});
