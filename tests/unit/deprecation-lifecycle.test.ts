import { describe, expect, it } from 'vitest';
import {
  DEPRECATION_CONTRACT_KINDS,
  DEPRECATION_REGISTRY,
  DEPRECATION_STATES,
  buildDeprecationLifecycleReport,
  findDeprecationPolicyGaps,
  formatDeprecationLifecycleReportMarkdown,
} from '../../scripts/deprecation-lifecycle.js';

describe('deprecation lifecycle audit', () => {
  it('covers the full lifecycle taxonomy with no policy gaps', () => {
    const report = buildDeprecationLifecycleReport();

    expect(report.generatedBy).toBe('scripts/deprecation-lifecycle.ts');
    expect(report.totalEntries).toBe(DEPRECATION_REGISTRY.length);
    expect(report.missingStates).toEqual([]);
    expect(report.policyGaps).toEqual([]);
  });

  it('keeps explicit state accounting aligned with the registry', () => {
    const report = buildDeprecationLifecycleReport();

    const stateTotal = DEPRECATION_STATES.reduce((sum, state) => sum + report.counts.states[state], 0);
    expect(stateTotal).toBe(DEPRECATION_REGISTRY.length);
  });

  it('keeps contract accounting aligned with contract taxonomy', () => {
    const report = buildDeprecationLifecycleReport();

    const contractTotal = DEPRECATION_CONTRACT_KINDS.reduce((sum, kind) => sum + report.counts.contracts[kind], 0);
    expect(contractTotal).toBeGreaterThanOrEqual(DEPRECATION_REGISTRY.length);
  });

  it('formats markdown output with lifecycle and registry sections', () => {
    const markdown = formatDeprecationLifecycleReportMarkdown();

    expect(markdown).toContain('# Deprecation Lifecycle Report');
    expect(markdown).toContain('## Lifecycle Counts');
    expect(markdown).toContain('## Human Verification Queue');
    expect(markdown).toContain('## Registry');
  });

  it('requires human verification for deprecated/migrated/removed entries', () => {
    const guarded = DEPRECATION_REGISTRY.filter(entry => (
      entry.state === 'deprecated' || entry.state === 'migrated' || entry.state === 'removed'
    ));

    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded.every(entry => entry.requiresHumanVerification)).toBe(true); // every-ok: guarded length asserted directly above
  });

  it('exposes no ad-hoc policy violations from rule checks', () => {
    expect(findDeprecationPolicyGaps()).toEqual([]);
  });
});
