import { describe, expect, it } from 'vitest';

import {
  buildVerificationGovernanceReport,
  formatVerificationGovernanceReportAsMarkdown,
  type VerificationGovernanceEntry,
} from '../../scripts/report-verification-governance.js';

const knownEntry: VerificationGovernanceEntry = {
  classification: 'pr-ci-blocking',
  owner: 'platform-foundation',
  rationale: 'fixture',
};

describe('verification governance report', () => {
  it('fails when a verify script is missing a registry classification', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
          'verify:new': 'tsx scripts/new.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run verify:known' }],
      [],
      {
        'verify:known': knownEntry,
      },
    );

    expect(report.pass).toBe(false);
    expect(report.unclassifiedScripts).toEqual(['verify:new']);
  });

  it('fails when active docs reference a deleted script', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run verify:known' }],
      [{ path: 'CLAUDE.md', source: 'Run npx tsx scripts/verify-styleguide-parity.ts' }],
      {
        'verify:known': knownEntry,
      },
    );

    expect(report.pass).toBe(false);
    expect(report.deletedReferenceMatches).toEqual([
      { path: 'CLAUDE.md', reference: 'scripts/verify-styleguide-parity.ts' },
      { path: 'CLAUDE.md', reference: 'verify-styleguide-parity.ts' },
    ]);
  });

  it('fails when active docs reference a retired one-off script', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run verify:known' }],
      [{ path: 'docs/workflows/example.md', source: 'Run npx tsx scripts/poc-lean-schema.ts' }],
      {
        'verify:known': knownEntry,
      },
    );

    expect(report.pass).toBe(false);
    expect(report.deletedReferenceMatches).toEqual([
      { path: 'docs/workflows/example.md', reference: 'scripts/poc-lean-schema.ts' },
      { path: 'docs/workflows/example.md', reference: 'poc-lean-schema.ts' },
    ]);
  });

  it('fails when a workflow references a retired one-off script', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
        },
      },
      [
        {
          path: '.github/workflows/ci.yml',
          source: 'run: npx tsx scripts/validate-endpoints-precise.js && npm run verify:known',
        },
      ],
      [],
      {
        'verify:known': knownEntry,
      },
    );

    expect(report.pass).toBe(false);
    expect(report.deletedReferenceMatches).toEqual([
      { path: '.github/workflows/ci.yml', reference: 'scripts/validate-endpoints-precise.js' },
      { path: '.github/workflows/ci.yml', reference: 'validate-endpoints-precise.js' },
    ]);
  });

  it('fails when a PR-blocking verifier is not wired into CI', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run pr-check' }],
      [],
      {
        'verify:known': knownEntry,
      },
    );

    expect(report.pass).toBe(false);
    expect(report.missingPrCiScripts).toEqual(['verify:known']);
  });

  it('does not count a non-ci workflow as PR-blocking CI wiring', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
        },
      },
      [{ path: '.github/workflows/pr-check-nightly.yml', source: 'run: npm run verify:known' }],
      [],
      {
        'verify:known': knownEntry,
      },
    );

    expect(report.pass).toBe(false);
    expect(report.missingPrCiScripts).toEqual(['verify:known']);
  });

  it('keeps secret-backed verifiers out of blocking CI', () => {
    const registry = {
      'verify:stripe-prices': {
        classification: 'secret-backed',
        owner: 'billing-monetization',
        rationale: 'requires Stripe secrets',
      },
    } satisfies Record<string, VerificationGovernanceEntry>;

    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:stripe-prices': 'tsx scripts/verify-stripe-prices.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run pr-check' }],
      [],
      registry,
    );

    expect(report.pass).toBe(true);
    expect(report.secretBackedBlockingScripts).toEqual([]);
  });

  it('fails when a secret-backed verifier is accidentally wired into CI', () => {
    const registry = {
      'verify:stripe-prices': {
        classification: 'secret-backed',
        owner: 'billing-monetization',
        rationale: 'requires Stripe secrets',
      },
    } satisfies Record<string, VerificationGovernanceEntry>;

    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:stripe-prices': 'tsx scripts/verify-stripe-prices.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run verify:stripe-prices' }],
      [],
      registry,
    );

    expect(report.pass).toBe(false);
    expect(report.secretBackedBlockingScripts).toEqual(['verify:stripe-prices']);
  });

  it('formats a concise markdown report', () => {
    const report = buildVerificationGovernanceReport(
      {
        scripts: {
          'verify:known': 'tsx scripts/known.ts',
        },
      },
      [{ path: '.github/workflows/ci.yml', source: 'run: npm run verify:known' }],
      [],
      {
        'verify:known': knownEntry,
      },
    );

    const markdown = formatVerificationGovernanceReportAsMarkdown(report);

    expect(markdown).toContain('# Verification Governance Report');
    expect(markdown).toContain('Result: PASS');
    expect(markdown).toContain('`verify:known`');
  });
});
