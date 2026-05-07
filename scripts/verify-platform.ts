#!/usr/bin/env tsx
/**
 * verify-platform.ts — repeatable platform verification runner
 *
 * Default mode runs the recommended CI-style verification stack:
 *   1) npm run typecheck
 *   2) npx vite build
 *   3) targeted decomposition/migration regression suites
 *   4) npx vitest run (full suite)
 *   5) npx tsx scripts/pr-check.ts
 *
 * Options:
 *   --quick      Skip full `npx vitest run` (keeps targeted suites).
 *   --with-e2e   Append `npx playwright test` at the end.
 *   --plan       Print commands only; do not execute.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Step = {
  label: string;
  cmd: string;
  args: string[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));

const isQuick = args.has('--quick');
const withE2E = args.has('--with-e2e');
const planOnly = args.has('--plan');

const steps: Step[] = [
  { label: 'Typecheck', cmd: 'npm', args: ['run', 'typecheck'] },
  { label: 'Build', cmd: 'npx', args: ['vite', 'build'] },
  {
    label: 'Targeted intelligence suite',
    cmd: 'npx',
    args: [
      'vitest',
      'run',
      'tests/unit/workspace-intelligence.test.ts',
      'tests/format-for-prompt.test.ts',
      'tests/intelligence-integration.test.ts',
      '--reporter=verbose',
    ],
  },
  {
    label: 'Targeted SEO-context migration suite',
    cmd: 'npx',
    args: [
      'vitest',
      'run',
      'tests/unit/seo-context-voice-profile.test.ts',
      'tests/unit/helpers.buildSchemaContext.test.ts',
      '--reporter=verbose',
    ],
  },
  {
    label: 'Targeted guardrail suite',
    cmd: 'npx',
    args: [
      'vitest',
      'run',
      'tests/pr-check.test.ts',
      'tests/bridge-pairing.test.ts',
      'tests/bridges-simple.test.ts',
      '--reporter=verbose',
    ],
  },
];

if (!isQuick) {
  steps.push({ label: 'Full test suite', cmd: 'npx', args: ['vitest', 'run'] });
}

steps.push({ label: 'PR checks', cmd: 'npx', args: ['tsx', 'scripts/pr-check.ts'] });

if (withE2E) {
  steps.push({ label: 'E2E suite', cmd: 'npx', args: ['playwright', 'test'] });
}

function printBanner(): void {
  const mode = isQuick ? 'quick' : 'full';
  const e2e = withE2E ? ' + e2e' : '';
  console.log(`verify-platform mode: ${mode}${e2e}`);
  console.log(`workspace: ${ROOT}`);
  console.log('');
}

function printPlan(): void {
  printBanner();
  steps.forEach((step, idx) => {
    const n = String(idx + 1).padStart(2, '0');
    console.log(`${n}. ${step.label}`);
    console.log(`    ${step.cmd} ${step.args.join(' ')}`);
  });
  console.log('');
}

function runSteps(): never {
  printBanner();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const n = String(i + 1).padStart(2, '0');
    console.log(`\n[${n}/${steps.length}] ${step.label}`);
    console.log(`$ ${step.cmd} ${step.args.join(' ')}`);

    const result = spawnSync(step.cmd, step.args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    if (result.status !== 0) {
      console.error(`\n✗ verify-platform failed at step ${n}: ${step.label}`);
      process.exit(result.status ?? 1);
    }
  }

  console.log('\n✓ verify-platform passed');
  process.exit(0);
}

if (planOnly) {
  printPlan();
  process.exit(0);
}

runSteps();
