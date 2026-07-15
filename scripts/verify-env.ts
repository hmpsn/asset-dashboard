import 'dotenv/config';

import {
  resolveProviderEnvProfile,
  validateProviderEnvironment,
  type ProviderEnvironment,
} from './env-contract.js';

function main(): void {
  let profile;
  try {
    profile = resolveProviderEnvProfile(process.argv.slice(2), process.env as ProviderEnvironment);
  } catch (err) {
    console.error(`verify:env — FAIL: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const result = validateProviderEnvironment(profile, process.env as ProviderEnvironment);
  if (!result.ok) {
    console.error(`verify:env — FAIL (${profile})`);
    for (const issue of result.issues) {
      console.error(`  - ${issue.key}: ${issue.message}`);
    }
    console.error('No environment values were printed. Correct the named keys and run verify:env again.');
    process.exitCode = 1;
    return;
  }

  console.log(`verify:env — OK (${profile}). Required provider configuration is present and structurally valid.`);
}

main();
