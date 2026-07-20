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
 *   npm run verify:model-currency -- --require-keys      # armed (nightly CI)
 *   npm run verify:model-currency -- --check-sampling    # also re-verify the
 *       per-model sampling contracts in server/model-manifest.ts against the
 *       live APIs. Added after the 2026-07-20 P0: a temperature contract that
 *       was INFERRED from model lineage rather than probed 400'd every brief
 *       and post generation. A mismatch fails the run.
 *
 * Without a provider's API key that provider's models are SKIPPED gracefully
 * (exit 0) — local/dev without provider creds are not blocked. The nightly
 * workflow runs ARMED (`--require-keys`): missing keys fail the run, and so do
 * 401/403 auth rejections — otherwise a rotated-out secret would turn every
 * nightly into a silent false pass, recreating the exact blind spot this
 * tripwire exists to close. The server also runs a non-blocking variant at
 * boot (server/model-currency.ts).
 */
import { ACTIVE_MODEL_IDS } from '../server/model-manifest.js';
import { checkModelCurrency, checkSamplingContracts } from '../server/model-currency.js';

const requireKeys = process.argv.includes('--require-keys');
const checkSampling = process.argv.includes('--check-sampling');

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
    } else if (requireKeys && (result.httpStatus === 401 || result.httpStatus === 403)) {
      // Armed mode: a revoked/expired key would otherwise make every run a
      // silent false pass — exactly the blind spot this tripwire exists to
      // close. Auth failures fail loudly when keys are required.
      failed += 1;
      console.error(`❌ ${result.provider}/${result.model}: provider rejected the API key (${result.detail}) — the tripwire is DISARMED. Fix the key.`);
    } else {
      // Transient provider/network trouble is not a currency verdict — surface
      // it without failing the run so flaky networks don't cry wolf.
      console.log(`⚠️  ${result.provider}/${result.model}: check inconclusive — ${result.detail}`);
    }
  }

  const checked = results.length;
  console.log(`\nmodel-currency: ${checked} checked, ${warned} deprecation warning(s), ${failed} retired`);

  // --check-sampling re-verifies every RECORDED sampling contract against the
  // live provider APIs. Added after the 2026-07-20 P0, where a contract
  // inferred from model lineage (rather than probed) 400'd all content
  // generation. A mismatch here means the manifest is lying about a model.
  if (checkSampling) {
    const sampling = await checkSamplingContracts();
    let mismatched = 0;
    for (const r of sampling) {
      if (r.status === 'match') {
        console.log(`✅ ${r.provider}/${r.model}: sampling contract matches (supports=${r.recorded})`);
      } else if (r.status === 'mismatch') {
        mismatched += 1;
        console.error(`❌ ${r.provider}/${r.model}: SAMPLING CONTRACT WRONG — manifest says supports=${r.recorded}, provider says ${r.observed}. Update the contract in server/model-manifest.ts and its pinned fixture in tests/contract/model-sampling-contracts.test.ts.`);
      } else {
        console.log(`⚠️  ${r.provider}/${r.model}: sampling probe inconclusive — ${r.detail}`);
      }
    }
    console.log(`sampling-contracts: ${sampling.length} probed, ${mismatched} mismatched`);
    if (mismatched > 0) process.exit(1);
  }

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('model-currency check crashed:', err);
  process.exit(1);
});
