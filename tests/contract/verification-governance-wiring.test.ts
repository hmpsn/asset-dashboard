import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationGovernanceReport,
  VERIFICATION_GOVERNANCE_REGISTRY,
  type PackageJsonLike,
} from '../../scripts/report-verification-governance.js';

function readText(path: string): string {
  return readFileSync(path, 'utf8'); // readFile-ok — governance contract: checks CI/docs/config wiring for verify scripts and deleted verifier references.
}

describe('verification governance wiring', () => {
  it('classifies every package verify script and wires blocking checks into CI', () => {
    const packageJson = JSON.parse(readText('package.json')) as PackageJsonLike;
    const ci = readText('.github/workflows/ci.yml');
    const activeDocs = [
      'CLAUDE.md',
      'docs/rules/design-system-enforcement.md',
      'docs/rules/verification-governance.md',
      'docs/testing/coverage-ratchet-ci.md',
      'scripts/pr-check.ts',
      'vite.config.ts',
    ].map(path => ({ path, source: readText(path) }));

    const report = buildVerificationGovernanceReport(
      packageJson,
      [{ path: '.github/workflows/ci.yml', source: ci }],
      activeDocs,
      VERIFICATION_GOVERNANCE_REGISTRY,
    );

    expect(report.pass).toBe(true);
    expect(report.unclassifiedScripts).toEqual([]);
    expect(report.missingPrCiScripts).toEqual([]);
    expect(report.missingPushCiScripts).toEqual([]);
    expect(report.secretBackedBlockingScripts).toEqual([]);
    expect(report.deletedReferenceMatches).toEqual([]);
  });

  it('keeps verify:feature-flags and verify:governance in PR quality CI', () => {
    const ci = readText('.github/workflows/ci.yml');

    expect(ci).toContain('npm run verify:feature-flags');
    expect(ci).toContain('npm run verify:governance');
  });

  it('keeps deleted script paths out of active docs/tooling references', () => {
    const activeFiles = [
      'CLAUDE.md',
      'docs/rules/design-system-enforcement.md',
      'docs/rules/verification-governance.md',
      'scripts/pr-check.ts',
      '.github/workflows/ci.yml',
      'package.json',
    ];
    const deletedScriptReferences = [
      'verify-styleguide-parity.ts',
      'scripts/codemods/phase5-',
      'scripts/diagnose-h1.ts',
      'scripts/poc-lean-schema.ts',
      'scripts/sync-staging-data.sh',
      'scripts/validate-endpoints-precise.js',
    ];

    for (const path of activeFiles) {
      const source = readText(path);
      for (const reference of deletedScriptReferences) {
        expect(source).not.toContain(reference);
      }
    }
  });

  it('documents the coverage ratchet script as the coverage floor authority', () => {
    const coverageDoc = readText('docs/testing/coverage-ratchet-ci.md');
    const viteConfig = readText('vite.config.ts');

    expect(coverageDoc).toContain('scripts/report-coverage-ratchet.ts');
    expect(coverageDoc).toContain('COVERAGE_RATCHET_FLOORS');
    expect(viteConfig).not.toContain('Baseline 2026-05-05');
    expect(viteConfig).not.toContain('thresholds: {');
  });

  it('keeps full coverage off automatic push CI and on manual release verification', () => {
    const ci = readText('.github/workflows/ci.yml');
    const coverageDoc = readText('docs/testing/coverage-ratchet-ci.md');

    expect(ci).toContain('workflow_dispatch:');
    expect(ci).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(ci).not.toContain('"$EVENT_NAME" == "push" && "$REF_NAME" == "main"');
    expect(VERIFICATION_GOVERNANCE_REGISTRY['verify:coverage-ratchet'].classification).toBe('release-check');
    expect(coverageDoc).toMatch(/Staging\s+and main push CI also stay fast/);
    expect(coverageDoc).toContain('The manually dispatched coverage job');
  });

  it('bounds the local full-suite verifier so integration servers can start reliably', () => {
    const verifier = readText('scripts/verify-platform.ts');

    expect(verifier).toContain("args: ['vitest', 'run', '--maxWorkers=4']");
  });
});
